import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { catalogSyncItemsTable, catalogSyncRunsTable, db, pool } from "@workspace/db";
import * as databaseModule from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { logger } from "./logger";
import { sourceItems } from "../seed-real";
import { pruneCatalogRefreshHistory, recoverInterruptedRuns, retryFailedCatalogTitles, startCatalogRefresh, STALE_QUEUED_REFRESH_MS } from "./catalog-refresh";

const runCatalogSyncMock = vi.hoisted(() => vi.fn());
vi.mock("../seed-real", async (importOriginal) => ({
  ...await importOriginal<typeof import("../seed-real")>(),
  runCatalogSync: runCatalogSyncMock,
}));

const createdRunIds: number[] = [];

afterEach(async () => {
  if (createdRunIds.length) {
    await db.delete(catalogSyncRunsTable).where(inArray(catalogSyncRunsTable.id, createdRunIds));
    createdRunIds.length = 0;
  }
});

describe("pruneCatalogRefreshHistory", () => {
  it("removes only completed runs before the cutoff and cascades their items", async () => {
    const cutoff = new Date("2026-01-01T00:00:00.000Z");
    const oldFinishedAt = new Date("2025-12-31T23:59:59.000Z");
    const recentFinishedAt = new Date("2026-01-01T00:00:01.000Z");
    const runs = await db.insert(catalogSyncRunsTable).values([
      { trigger: "scheduled", status: "failed", finishedAt: oldFinishedAt },
      { trigger: "manual", status: "partial", finishedAt: recentFinishedAt },
      { trigger: "manual", status: "running", startedAt: oldFinishedAt },
      { trigger: "scheduled", status: "queued" },
    ]).returning({ id: catalogSyncRunsTable.id });
    createdRunIds.push(...runs.map((run) => run.id));

    await db.insert(catalogSyncItemsTable).values(runs.map((run, index) => ({
      runId: run.id,
      itemKey: `retention-test-${run.id}`,
      title: `Retention test ${index}`,
      provider: "TVMaze",
      status: index <= 1 ? "failed" : "queued",
      error: index === 0 ? "old diagnostic details" : index === 1 ? "recent diagnostic details" : null,
    })));

    await expect(pruneCatalogRefreshHistory(cutoff)).resolves.toBe(1);

    const remainingRuns = await db.select({ id: catalogSyncRunsTable.id })
      .from(catalogSyncRunsTable)
      .where(inArray(catalogSyncRunsTable.id, createdRunIds));
    expect(remainingRuns.map((run) => run.id).sort()).toEqual(
      runs.slice(1).map((run) => run.id).sort(),
    );

    const remainingItems = await db.select({
      runId: catalogSyncItemsTable.runId,
      error: catalogSyncItemsTable.error,
    })
      .from(catalogSyncItemsTable)
      .where(inArray(catalogSyncItemsTable.runId, createdRunIds));
    expect(remainingItems.map((item) => item.runId).sort()).toEqual(
      runs.slice(1).map((run) => run.id).sort(),
    );
    expect(remainingItems).toContainEqual({
      runId: runs[1].id,
      error: "recent diagnostic details",
    });
  });
});

describe("catalog refresh startup failure", () => {
  it("makes startup-failed titles retryable after the database recovers without rejecting the detached task", async () => {
    const startupError = new Error("unable to mark refresh running");
    const startupSpy = vi.spyOn(db, "transaction").mockRejectedValueOnce(startupError);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const items = sourceItems.slice(0, 2);
      expect(items).toHaveLength(2);
      const runId = await startCatalogRefresh("manual", items);
      createdRunIds.push(runId);
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(
        { err: startupError, runId }, "catalog refresh failed",
      ));
      await vi.waitFor(async () => {
        const [run] = await db.select().from(catalogSyncRunsTable)
          .where(eq(catalogSyncRunsTable.id, runId));
        expect(run.status).toBe("failed");
        expect(run.error).toBe(startupError.message);
        expect(run.finishedAt).toBeInstanceOf(Date);
        const failedItems = await db.select().from(catalogSyncItemsTable)
          .where(eq(catalogSyncItemsTable.runId, runId));
        expect(failedItems).toHaveLength(items.length);
        for (const item of failedItems) {
          expect(item.status).toBe("failed");
          expect(item.error).toBe(startupError.message);
          expect(item.startedAt).toBeNull();
          expect(item.finishedAt).toEqual(run.finishedAt);
        }
      });
      expect(runCatalogSyncMock).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandledRejections).toEqual([]);

      runCatalogSyncMock.mockImplementationOnce(async (
        ...[_options, retryItems, onProgress]: Parameters<typeof import("../seed-real").runCatalogSync>
      ) => {
        if (!retryItems) throw new Error("Expected explicit retry titles");
        for (const [index, item] of retryItems.entries()) {
          await onProgress!({ item, status: "succeeded", attempted: index + 1, succeeded: index + 1, episodes: 0 });
        }
        return { selected: retryItems.length, succeeded: retryItems.length, episodes: 0, failures: [] };
      });
      const retryRunId = await retryFailedCatalogTitles(runId);
      expect(retryRunId).not.toBeNull();
      createdRunIds.push(retryRunId!);
      await vi.waitFor(async () => {
        const [retryRun] = await db.select().from(catalogSyncRunsTable)
          .where(eq(catalogSyncRunsTable.id, retryRunId!));
        expect(retryRun).toMatchObject({ trigger: "retry", status: "succeeded", totalItems: 2, succeededItems: 2 });
      });
      expect(runCatalogSyncMock).toHaveBeenCalledExactlyOnceWith(
        { dryRun: false, allowPartial: true }, items, expect.any(Function), false,
      );
      const retriedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, retryRunId!));
      expect(retriedItems.map((item) => item.itemKey).sort()).toEqual(items.map((item) => item.key).sort());
      expect(retriedItems.every((item) => item.status === "succeeded")).toBe(true);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      startupSpy.mockRestore();
      errorSpy.mockRestore();
      runCatalogSyncMock.mockReset();
    }
  });

  it("fails only unfinished titles and preserves completed results when a worker throws", async () => {
    const syncError = new Error("database disconnected during refresh");
    const items = sourceItems.slice(0, 4);
    expect(items).toHaveLength(4);
    let completedItems: typeof catalogSyncItemsTable.$inferSelect[] = [];
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    runCatalogSyncMock.mockImplementationOnce(async (
      ...[_options, selected, onProgress]: Parameters<typeof import("../seed-real").runCatalogSync>
    ) => {
      if (!selected) throw new Error("Expected explicit refresh titles");
      await onProgress!({ item: selected[0], status: "succeeded", attempted: 1, succeeded: 1, episodes: 5 });
      await onProgress!({
        item: selected[1], status: "failed", attempted: 2, succeeded: 1, episodes: 5, error: "original provider error",
      });
      await onProgress!({ item: selected[2], status: "running", attempted: 3, succeeded: 1, episodes: 5 });
      completedItems = await db.select().from(catalogSyncItemsTable)
        .where(inArray(catalogSyncItemsTable.itemKey, selected.slice(0, 2).map((item) => item.key)));
      throw syncError;
    });

    try {
      const runId = await startCatalogRefresh("manual", items);
      createdRunIds.push(runId);
      await vi.waitFor(async () => {
        const [run] = await db.select().from(catalogSyncRunsTable)
          .where(eq(catalogSyncRunsTable.id, runId));
        expect(run.status).toBe("failed");
        const results = await db.select().from(catalogSyncItemsTable)
          .where(eq(catalogSyncItemsTable.runId, runId));
        expect(results).toHaveLength(4);
        for (const item of results) {
          if (items.slice(0, 2).some((source) => source.key === item.itemKey)) {
            expect(item).toEqual(completedItems.find((completed) => completed.id === item.id));
          } else {
            expect(item.status).toBe("failed");
            expect(item.error).toBe(syncError.message);
            expect(item.finishedAt).toEqual(run.finishedAt);
          }
        }
      });
    } finally {
      errorSpy.mockRestore();
      runCatalogSyncMock.mockReset();
    }
  });

  it("preserves the recorded startup failure when history cleanup also rejects", async () => {
    const startupError = new Error("unable to mark refresh running");
    const cleanupError = new Error("history deletion failed");
    let rejectCleanup!: (error: Error) => void;
    const cleanupGate = new Promise<never>((_resolve, reject) => {
      rejectCleanup = reject;
    });
    const startupSpy = vi.spyOn(db, "transaction").mockRejectedValueOnce(startupError);
    const deleteSpy = vi.spyOn(db, "delete").mockReturnValueOnce({
      where: () => ({ returning: () => cleanupGate }),
    } as unknown as ReturnType<typeof db.delete>);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const runId = await startCatalogRefresh("manual", []);
      createdRunIds.push(runId);
      await vi.waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(catalogSyncRunsTable));
      const [beforeCleanup] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(beforeCleanup.status).toBe("failed");
      expect(beforeCleanup.error).toBe(startupError.message);
      expect(beforeCleanup.finishedAt).toBeInstanceOf(Date);
      expect(beforeCleanup.startedAt).toBeNull();

      rejectCleanup(cleanupError);
      await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(
        { err: cleanupError }, "unable to prune catalog refresh history",
      ));
      await new Promise<void>((resolve) => setImmediate(resolve));
      const [afterCleanup] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(afterCleanup).toEqual(beforeCleanup);
      expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
        { err: startupError, runId }, "catalog refresh failed",
      );
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(runCatalogSyncMock).not.toHaveBeenCalled();
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      startupSpy.mockRestore();
      deleteSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      runCatalogSyncMock.mockReset();
    }
  });

  it("logs both errors if recording the startup failure also fails", async () => {
    const startupError = new Error("unable to mark refresh running");
    const recordError = new Error("unable to mark refresh failed");
    const startupSpy = vi.spyOn(db, "transaction")
      .mockRejectedValueOnce(startupError)
      .mockRejectedValueOnce(recordError);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const runId = await startCatalogRefresh("manual", []);
      createdRunIds.push(runId);
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(
        { err: recordError, runId }, "unable to record catalog refresh failure",
      ));
      expect(errorSpy).toHaveBeenCalledWith({ err: startupError, runId }, "catalog refresh failed");
      expect(runCatalogSyncMock).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandledRejections).toEqual([]);
      const [queued] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(queued.status).toBe("queued");
      // Once the database is available and the orphan is stale, recovery
      // makes it actionable even though neither failure write succeeded.
      await db.update(catalogSyncRunsTable).set({
        createdAt: new Date(Date.now() - STALE_QUEUED_REFRESH_MS - 1_000),
      }).where(eq(catalogSyncRunsTable.id, runId));
      await recoverInterruptedRuns();
      const [recovered] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(recovered.status).toBe("failed");
      expect(recovered.error).toContain("database outage");
      expect(recovered.finishedAt).toBeInstanceOf(Date);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      startupSpy.mockRestore();
      errorSpy.mockRestore();
      runCatalogSyncMock.mockReset();
    }
  });
});


describe("catalog refresh recovery", () => {
  it("propagates a rejected recovery transaction and releases its catalog lock and client", async () => {
    // Reserve both sessions up front: a lock is reentrant on its owning session,
    // so probing with a client returned by recovery could hide a leaked lock.
    const lockProbe = await pool.connect();
    try {
      const recoveryClient = await pool.connect();
      // Retain the session until cleanup so even a missing unlock cannot leak
      // a session-level lock into later tests through the pool.
      const releaseSpy = vi.spyOn(recoveryClient, "release").mockImplementation(() => {});
      const connectSpy = vi.spyOn(pool, "connect").mockImplementationOnce(() => Promise.resolve(recoveryClient));
      const recoveryError = new Error("recovery transaction rejected");
      const transactionSpy = vi.spyOn(db, "transaction").mockRejectedValueOnce(recoveryError);

      try {
        await expect(recoverInterruptedRuns()).rejects.toBe(recoveryError);
        expect(transactionSpy).toHaveBeenCalledTimes(1);
        expect(releaseSpy).toHaveBeenCalledTimes(1);

        const catalogLock = await lockProbe.query<{ locked: boolean }>(
          "select pg_try_advisory_lock(hashtext('watchtime:catalog-sync')) as locked",
        );
        expect(catalogLock.rows[0].locked).toBe(true);
      } finally {
        transactionSpy.mockRestore();
        connectSpy.mockRestore();
        releaseSpy.mockRestore();
        try {
          await recoveryClient.query("select pg_advisory_unlock_all()");
        } finally {
          recoveryClient.release();
        }
      }
    } finally {
      try {
        await lockProbe.query("select pg_advisory_unlock_all()");
      } finally {
        lockProbe.release();
      }
    }
  });

  it("rolls back a midway title-update failure, releases recovery locks, and recovers on retry", async () => {
    const cutoff = new Date(Date.now() - STALE_QUEUED_REFRESH_MS);
    const staleAt = new Date(cutoff.getTime() - 1_000);
    const runs = await db.insert(catalogSyncRunsTable).values([
      { trigger: "manual", status: "queued", createdAt: staleAt },
      { trigger: "manual", status: "running", createdAt: staleAt, startedAt: staleAt },
    ]).returning();
    const runIds = runs.map((run) => run.id);
    createdRunIds.push(...runIds);
    const items = await db.insert(catalogSyncItemsTable).values(runs.flatMap((run) => [
      {
        runId: run.id, itemKey: "unfinished", title: "Unfinished title", provider: "TVMaze",
        status: run.status, startedAt: run.startedAt,
      },
      {
        runId: run.id, itemKey: "completed", title: "Completed title", provider: "TVMaze",
        status: "succeeded", startedAt: staleAt, finishedAt: staleAt,
      },
      {
        runId: run.id, itemKey: "previously-failed", title: "Failed title", provider: "TVMaze",
        status: "failed", error: "original provider error", finishedAt: staleAt,
      },
    ])).returning();
    const recoveryError = new Error("database unavailable during title recovery");
    const transaction = db.transaction.bind(db);
    let titleUpdates = 0;
    // Reserve a distinct session before recovery so reentrant session locks
    // cannot make a leaked lock appear to have been released.
    const lockProbe = await pool.connect();
    const transactionSpy = vi.spyOn(db, "transaction").mockImplementationOnce((callback, config) =>
      transaction(async (tx) => {
        const update = tx.update.bind(tx);
        const updateSpy = vi.spyOn(tx, "update").mockImplementation((table) => {
          if (table === catalogSyncItemsTable && ++titleUpdates === 2) {
            return {
              set: () => ({
                where: async () => {
                  const pendingRuns = await tx.select().from(catalogSyncRunsTable)
                    .where(inArray(catalogSyncRunsTable.id, runIds)).orderBy(catalogSyncRunsTable.id);
                  expect(pendingRuns.map((run) => run.status)).toEqual(["failed", "failed"]);
                  const [updatedItem] = await tx.select().from(catalogSyncItemsTable)
                    .where(eq(catalogSyncItemsTable.id, items[0].id));
                  expect(updatedItem.status).toBe("failed");
                  expect(updatedItem.finishedAt).toBeInstanceOf(Date);
                  throw recoveryError;
                },
              }),
            } as unknown as ReturnType<typeof tx.update>;
          }
          return update(table);
        });
        try {
          return await callback(tx);
        } finally {
          updateSpy.mockRestore();
        }
      }, config),
    );

    try {
      await expect(recoverInterruptedRuns(cutoff)).rejects.toBe(recoveryError);
      transactionSpy.mockRestore();
      expect(titleUpdates).toBe(2);
      expect(await db.select().from(catalogSyncRunsTable)
        .where(inArray(catalogSyncRunsTable.id, runIds)).orderBy(catalogSyncRunsTable.id)).toEqual(runs);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(inArray(catalogSyncItemsTable.runId, runIds)).orderBy(catalogSyncItemsTable.id)).toEqual(items);

      const catalogLock = await lockProbe.query<{ locked: boolean }>(
        "select pg_try_advisory_lock(hashtext('watchtime:catalog-sync')) as locked",
      );
      expect(catalogLock.rows[0].locked).toBe(true);
      for (const runId of runIds) {
        const workerLock = await lockProbe.query<{ locked: boolean }>(
          "select pg_try_advisory_lock(hashtext('watchtime:catalog-refresh-worker'), $1) as locked", [runId],
        );
        expect(workerLock.rows[0].locked).toBe(true);
      }
      await lockProbe.query("select pg_advisory_unlock_all()");

      await recoverInterruptedRuns(cutoff);
      const recoveredRuns = await db.select().from(catalogSyncRunsTable)
        .where(inArray(catalogSyncRunsTable.id, runIds)).orderBy(catalogSyncRunsTable.id);
      expect(recoveredRuns.map((run) => run.status)).toEqual(["failed", "failed"]);
      expect(recoveredRuns[0].error).toContain("retry the failed titles");
      expect(recoveredRuns[1].error).toBe("Catalog refresh was interrupted by a server restart");
      expect(recoveredRuns.every((run) => run.finishedAt instanceof Date)).toBe(true);
      const recoveredItems = await db.select().from(catalogSyncItemsTable)
        .where(inArray(catalogSyncItemsTable.runId, runIds)).orderBy(catalogSyncItemsTable.id);
      for (const [index, item] of recoveredItems.entries()) {
        if (items[index].itemKey === "unfinished") {
          expect(item.status).toBe("failed");
          expect(item.error).toBe(recoveredRuns.find((run) => run.id === item.runId)?.error);
          expect(item.finishedAt).toBeInstanceOf(Date);
        } else {
          expect(item).toEqual(items[index]);
        }
      }
    } finally {
      transactionSpy.mockRestore();
      await lockProbe.query("select pg_advisory_unlock_all()");
      lockProbe.release();
    }
  });

  it("rolls back an aborted PostgreSQL title update, releases recovery locks, and recovers on retry", async () => {
    const cutoff = new Date(Date.now() - STALE_QUEUED_REFRESH_MS);
    const staleAt = new Date(cutoff.getTime() - 1_000);
    const runs = await db.insert(catalogSyncRunsTable).values([
      { trigger: "manual", status: "queued", createdAt: staleAt },
      { trigger: "manual", status: "running", createdAt: staleAt, startedAt: staleAt },
    ]).returning();
    const runIds = runs.map((run) => run.id);
    createdRunIds.push(...runIds);
    const items = await db.insert(catalogSyncItemsTable).values(runs.flatMap((run) => [
      {
        runId: run.id, itemKey: "unfinished", title: "Unfinished title", provider: "TVMaze",
        status: run.status, startedAt: run.startedAt,
      },
      {
        runId: run.id, itemKey: "completed", title: "Completed title", provider: "TVMaze",
        status: "succeeded", startedAt: staleAt, finishedAt: staleAt,
      },
      {
        runId: run.id, itemKey: "previously-failed", title: "Failed title", provider: "TVMaze",
        status: "failed", error: "original provider error", finishedAt: staleAt,
      },
    ])).returning();

    // Keep both sessions checked out throughout: the transaction connection
    // must be usable after rollback, and the lock probe must never reuse it.
    const lockProbe = await pool.connect();
    try {
      const transactionClient = await pool.connect();
      const transactionDb = drizzle(transactionClient, { schema });
      const querySpy = vi.spyOn(transactionClient, "query");
      let titleUpdates = 0;
      let statementError: unknown;
      const transactionSpy = vi.spyOn(db, "transaction").mockImplementationOnce((callback, config) =>
        transactionDb.transaction(async (tx) => {
          const update = tx.update.bind(tx);
          const updateSpy = vi.spyOn(tx, "update").mockImplementation((table) => {
            if (table === catalogSyncItemsTable && ++titleUpdates === 2) {
              return {
                set: () => ({
                  where: async () => {
                    const pendingRuns = await tx.select().from(catalogSyncRunsTable)
                      .where(inArray(catalogSyncRunsTable.id, runIds)).orderBy(catalogSyncRunsTable.id);
                    expect(pendingRuns.map((run) => run.status)).toEqual(["failed", "failed"]);
                    const [updatedItem] = await tx.select().from(catalogSyncItemsTable)
                      .where(eq(catalogSyncItemsTable.id, items[0].id));
                    expect(updatedItem.status).toBe("failed");
                    expect(updatedItem.finishedAt).toBeInstanceOf(Date);

                    // A real statement error on this transaction connection,
                    // without changing any table, schema, or database setting.
                    try {
                      await tx.execute(sql`select 1 / 0`);
                    } catch (error) {
                      statementError = error;
                      expect(error).toMatchObject({
                        cause: { code: "22012", message: "division by zero" },
                      });
                      // Unlike an application rejection, PostgreSQL now refuses
                      // even a valid statement until the transaction rolls back.
                      await expect(tx.execute(sql`select 1`)).rejects.toMatchObject({
                        cause: { code: "25P02" },
                      });
                      throw error;
                    }
                    throw new Error("Expected PostgreSQL to reject division by zero");
                  },
                }),
              } as unknown as ReturnType<typeof tx.update>;
            }
            return update(table);
          });
          try {
            return await callback(tx);
          } finally {
            updateSpy.mockRestore();
          }
        }, config),
      );

      try {
        const outcome = await recoverInterruptedRuns(cutoff).then(
          () => { throw new Error("Expected recovery to reject the PostgreSQL statement error"); },
          (error: unknown) => error,
        );
        expect(titleUpdates).toBe(2);
        expect(statementError).toBeDefined();
        expect(outcome).toBe(statementError);
        expect(outcome).toMatchObject({
          cause: { code: "22012", message: "division by zero" },
        });
        expect(querySpy).toHaveBeenCalledWith(
          expect.objectContaining({ text: "rollback" }), expect.any(Array),
        );
        // Use the very same retained session, not an arbitrary healthy pool
        // client, to prove rollback cleared PostgreSQL's aborted state.
        const healthy = await transactionClient.query<{ value: number }>("select 1 as value");
        expect(healthy.rows).toEqual([{ value: 1 }]);
        expect(await db.select().from(catalogSyncRunsTable)
          .where(inArray(catalogSyncRunsTable.id, runIds)).orderBy(catalogSyncRunsTable.id)).toEqual(runs);
        expect(await db.select().from(catalogSyncItemsTable)
          .where(inArray(catalogSyncItemsTable.runId, runIds)).orderBy(catalogSyncItemsTable.id)).toEqual(items);

        const catalogLock = await lockProbe.query<{ locked: boolean }>(
          "select pg_try_advisory_lock(hashtext('watchtime:catalog-sync')) as locked",
        );
        expect(catalogLock.rows[0].locked).toBe(true);
        for (const runId of runIds) {
          const workerLock = await lockProbe.query<{ locked: boolean }>(
            "select pg_try_advisory_lock(hashtext('watchtime:catalog-refresh-worker'), $1) as locked", [runId],
          );
          expect(workerLock.rows[0].locked).toBe(true);
        }
        await lockProbe.query("select pg_advisory_unlock_all()");
        transactionSpy.mockRestore();

        await recoverInterruptedRuns(cutoff);
        const recoveredRuns = await db.select().from(catalogSyncRunsTable)
          .where(inArray(catalogSyncRunsTable.id, runIds)).orderBy(catalogSyncRunsTable.id);
        expect(recoveredRuns.map((run) => run.status)).toEqual(["failed", "failed"]);
        expect(recoveredRuns[0].error).toContain("retry the failed titles");
        expect(recoveredRuns[1].error).toBe("Catalog refresh was interrupted by a server restart");
        expect(recoveredRuns.every((run) => run.finishedAt instanceof Date)).toBe(true);
        const recoveredItems = await db.select().from(catalogSyncItemsTable)
          .where(inArray(catalogSyncItemsTable.runId, runIds)).orderBy(catalogSyncItemsTable.id);
        for (const [index, item] of recoveredItems.entries()) {
          if (items[index].itemKey === "unfinished") {
            expect(item.status).toBe("failed");
            expect(item.error).toBe(recoveredRuns.find((run) => run.id === item.runId)?.error);
            expect(item.finishedAt).toBeInstanceOf(Date);
          } else {
            expect(item).toEqual(items[index]);
          }
        }
      } finally {
        transactionSpy.mockRestore();
        querySpy.mockRestore();
        try {
          // Also leave a clean session when an assertion fails before rollback.
          await transactionClient.query("rollback");
          await transactionClient.query("select pg_advisory_unlock_all()");
        } finally {
          transactionClient.release();
        }
      }
    } finally {
      try {
        await lockProbe.query("select pg_advisory_unlock_all()");
      } finally {
        lockProbe.release();
      }
    }
  });

  it("fails stale queued and interrupted runs and unfinished items, but preserves new and completed work", async () => {
    const cutoff = new Date(Date.now() - STALE_QUEUED_REFRESH_MS);
    const staleAt = new Date(cutoff.getTime() - 1_000);
    const runs = await db.insert(catalogSyncRunsTable).values([
      { trigger: "manual", status: "queued", createdAt: staleAt },
      { trigger: "manual", status: "running", createdAt: staleAt },
      { trigger: "manual", status: "queued" },
      { trigger: "manual", status: "queued", createdAt: cutoff },
      { trigger: "manual", status: "succeeded", createdAt: staleAt },
    ]).returning();
    createdRunIds.push(...runs.map((run) => run.id));
    await db.insert(catalogSyncItemsTable).values([
      ...runs.map((run) => ({
        runId: run.id, itemKey: `recovery-${run.id}`, title: "Recovery test", provider: "TVMaze",
      })),
      {
        runId: runs[0].id, itemKey: "already-finished", title: "Completed item", provider: "TVMaze",
        status: "succeeded", finishedAt: staleAt,
      },
    ]);

    await recoverInterruptedRuns(cutoff);

    const recovered = await db.select().from(catalogSyncRunsTable)
      .where(inArray(catalogSyncRunsTable.id, createdRunIds)).orderBy(catalogSyncRunsTable.id);
    expect(recovered.map((run) => run.status)).toEqual(["failed", "failed", "queued", "queued", "succeeded"]);
    expect(recovered[0].error).toContain("retry the failed titles");
    expect(recovered[1].error).toBe("Catalog refresh was interrupted by a server restart");
    for (const run of recovered.slice(0, 2)) {
      expect(run.finishedAt).toBeInstanceOf(Date);
    }
    expect(recovered.slice(2)).toEqual(runs.slice(2));
    const items = await db.select().from(catalogSyncItemsTable)
      .where(inArray(catalogSyncItemsTable.runId, createdRunIds)).orderBy(catalogSyncItemsTable.id);
    expect(items.map((item) => item.status)).toEqual(["failed", "failed", "queued", "queued", "queued", "succeeded"]);
    for (const [index, item] of items.slice(0, 2).entries()) {
      expect(item.error).toBe(recovered[index].error);
      expect(item.finishedAt).toBeInstanceOf(Date);
    }
    expect(items[5].finishedAt).toEqual(staleAt);
    await recoverInterruptedRuns(cutoff);
    expect(await db.select().from(catalogSyncRunsTable)
      .where(inArray(catalogSyncRunsTable.id, createdRunIds)).orderBy(catalogSyncRunsTable.id)).toEqual(recovered);
  });

  it("does not recover queued work while its local startup write is pending, even when stale", async () => {
    let finishStartup!: () => void;
    const startupGate = new Promise<void>((resolve) => { finishStartup = resolve; });
    const startupSpy = vi.spyOn(db, "transaction").mockImplementationOnce(async () => {
      await startupGate;
      return true;
    });
    runCatalogSyncMock.mockResolvedValueOnce({ selected: 0, succeeded: 0, episodes: 0, failures: [] });
    let runId: number | undefined;
    try {
      runId = await startCatalogRefresh("manual", []);
      createdRunIds.push(runId);
      await db.update(catalogSyncRunsTable).set({
        createdAt: new Date(Date.now() - STALE_QUEUED_REFRESH_MS - 1_000),
      }).where(eq(catalogSyncRunsTable.id, runId));
      await recoverInterruptedRuns();
      const [run] = await db.select().from(catalogSyncRunsTable).where(eq(catalogSyncRunsTable.id, runId));
      expect(run.status).toBe("queued");
      expect(run.error).toBeNull();
      expect(run.finishedAt).toBeNull();
    } finally {
      finishStartup();
      if (runId !== undefined) {
        await vi.waitFor(async () => {
          const [run] = await db.select().from(catalogSyncRunsTable).where(eq(catalogSyncRunsTable.id, runId!));
          expect(run.status).toBe("succeeded");
        });
      }
      startupSpy.mockRestore();
      runCatalogSyncMock.mockReset();
    }
  });

  it("does not restart a recovered run when a delayed startup resumes and releases local ownership", async () => {
    // Model another API process: share the real database, but load a separate
    // refresh module so recovery cannot see the delayed worker's local set.
    const database = databaseModule;
    vi.resetModules();
    vi.doMock("@workspace/db", () => database);
    const { recoverInterruptedRuns: recoverFromOtherProcess } = await import("./catalog-refresh");
    let finishStartup!: () => void;
    const startupGate = new Promise<void>((resolve) => { finishStartup = resolve; });
    const transaction = db.transaction.bind(db);
    const startupSpy = vi.spyOn(db, "transaction").mockImplementationOnce(async (callback, config) => {
      await startupGate;
      return transaction(callback, config);
    });
    // Reaching pruning proves executeRun has passed through its finally block.
    const cleanupSpy = vi.spyOn(db, "delete").mockReturnValueOnce({
      where: () => ({ returning: async () => [] }),
    } as unknown as ReturnType<typeof db.delete>);
    runCatalogSyncMock.mockResolvedValue({
      selected: 0, succeeded: 0, episodes: 0, failures: [],
    });
    let runId: number | undefined;
    try {
      runId = await startCatalogRefresh("manual", []);
      createdRunIds.push(runId);
      await vi.waitFor(() => expect(startupSpy).toHaveBeenCalledTimes(1));
      const staleAt = new Date(Date.now() - STALE_QUEUED_REFRESH_MS - 1_000);
      await db.update(catalogSyncRunsTable).set({ createdAt: staleAt })
        .where(eq(catalogSyncRunsTable.id, runId));

      await recoverFromOtherProcess();
      const [recovered] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(recovered.status).toBe("failed");
      expect(recovered.error).toBe(
        "Catalog refresh worker stopped before starting (server restart or database outage); retry the failed titles",
      );
      expect(recovered.finishedAt).toBeInstanceOf(Date);
      expect(recovered.startedAt).toBeNull();
      expect(runCatalogSyncMock).not.toHaveBeenCalled();
      expect(cleanupSpy).not.toHaveBeenCalled();

      finishStartup();
      await vi.waitFor(() => expect(cleanupSpy).toHaveBeenCalledWith(catalogSyncRunsTable));
      expect(runCatalogSyncMock).not.toHaveBeenCalled();
      const [afterStartup] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      // Include error and finishedAt: even a failed/skipped late worker must
      // not overwrite the explanation or timestamp recorded by recovery.
      expect(afterStartup).toEqual(recovered);

      // Make the same id recoverable again to prove the original process no
      // longer excludes it via activeRunIds after the early startup return.
      await db.update(catalogSyncRunsTable).set({
        status: "queued", error: null, finishedAt: null,
      }).where(eq(catalogSyncRunsTable.id, runId));
      await recoverInterruptedRuns();
      const [recoveredAgain] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(recoveredAgain.status).toBe("failed");
      expect(recoveredAgain.error).toBe(recovered.error);
      expect(recoveredAgain.finishedAt).toBeInstanceOf(Date);
      expect(runCatalogSyncMock).not.toHaveBeenCalled();
    } finally {
      finishStartup();
      if (runId !== undefined) {
        await vi.waitFor(() => expect(cleanupSpy).toHaveBeenCalledWith(catalogSyncRunsTable));
      }
      startupSpy.mockRestore();
      cleanupSpy.mockRestore();
      runCatalogSyncMock.mockReset();
      vi.doUnmock("@workspace/db");
      vi.resetModules();
    }
  });

  it("continues a waiting startup after recovery rolls back without retaining recovery diagnostics", async () => {
    // Model recovery in another API process, without the startup's activeRunIds.
    vi.resetModules();
    vi.doMock("@workspace/db", () => databaseModule);
    const { recoverInterruptedRuns: recoverFromOtherProcess } = await import("./catalog-refresh");
    let finishStartup!: () => void;
    const startupGate = new Promise<void>((resolve) => { finishStartup = resolve; });
    let rollbackRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => { rollbackRecovery = resolve; });
    let signalRecoveryWritten!: (run: typeof catalogSyncRunsTable.$inferSelect) => void;
    const recoveryWritten = new Promise<typeof catalogSyncRunsTable.$inferSelect>((resolve) => {
      signalRecoveryWritten = resolve;
    });
    let finishSync!: () => void;
    const syncGate = new Promise<void>((resolve) => { finishSync = resolve; });
    let signalStartupFinished!: () => void;
    const startupCompletion = new Promise<void>((resolve) => { signalStartupFinished = resolve; });
    const recoveryError = new Error("unable to commit catalog recovery");
    const transaction = db.transaction.bind(db);
    let runId: number | undefined;
    const transactionSpy = vi.spyOn(db, "transaction")
      .mockImplementationOnce(async (callback, config) => {
        await startupGate;
        return transaction(callback, config);
      })
      .mockImplementationOnce((callback, config) =>
        transaction(async (tx) => {
          await callback(tx);
          const [writtenRun] = await tx.select().from(catalogSyncRunsTable)
            .where(eq(catalogSyncRunsTable.id, runId!));
          signalRecoveryWritten(writtenRun);
          await recoveryGate;
          throw recoveryError;
        }, config),
      );
    const cleanupSpy = vi.spyOn(db, "delete").mockImplementationOnce(() => {
      signalStartupFinished();
      return {
        where: () => ({ returning: async () => [] }),
      } as unknown as ReturnType<typeof db.delete>;
    });
    const lockProbe = await pool.connect();
    runCatalogSyncMock.mockImplementation(async () => {
      await syncGate;
      return { selected: 0, succeeded: 0, episodes: 0, failures: [] };
    });
    let recoveryOutcome: Promise<unknown> | undefined;
    try {
      runId = await startCatalogRefresh("manual", []);
      createdRunIds.push(runId);
      await vi.waitFor(() => expect(transactionSpy).toHaveBeenCalledTimes(1));
      await db.update(catalogSyncRunsTable).set({
        createdAt: new Date(Date.now() - STALE_QUEUED_REFRESH_MS - 1_000),
      }).where(eq(catalogSyncRunsTable.id, runId));
      const [queuedRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));

      // Attach the rejection handler before releasing recovery to roll back.
      recoveryOutcome = recoverFromOtherProcess().then(
        () => undefined,
        (error: unknown) => error,
      );
      const uncommittedRun = await recoveryWritten;
      expect(uncommittedRun.status).toBe("failed");
      expect(uncommittedRun.error).toBe(
        "Catalog refresh worker stopped before starting (server restart or database outage); retry the failed titles",
      );
      expect(uncommittedRun.finishedAt).toBeInstanceOf(Date);
      expect(uncommittedRun.startedAt).toBeNull();
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId))).toEqual([queuedRun]);

      finishStartup();
      // A real ungranted lock proves startup is waiting on recovery's lease,
      // rather than merely having been scheduled before recovery rolls back.
      await vi.waitFor(async () => {
        const waiting = await lockProbe.query(
          `select 1 from pg_locks
           where locktype = 'advisory'
             and database = (select oid from pg_database where datname = current_database())
             and classid = hashtext('watchtime:catalog-refresh-worker')::oid
             and objid = $1::oid and objsubid = 2 and not granted`,
          [runId],
        );
        expect(waiting.rows).toHaveLength(1);
      });
      expect(runCatalogSyncMock).not.toHaveBeenCalled();
      expect(cleanupSpy).not.toHaveBeenCalled();

      // Ensure a successful completion cannot accidentally share recovery's
      // timestamp even on a fast database.
      await vi.waitFor(() => expect(Date.now()).toBeGreaterThan(uncommittedRun.finishedAt!.getTime()));
      rollbackRecovery();
      await expect(recoveryOutcome).resolves.toBe(recoveryError);
      await vi.waitFor(() => expect(runCatalogSyncMock).toHaveBeenCalledTimes(1));
      expect(runCatalogSyncMock).toHaveBeenCalledWith(
        { dryRun: false, allowPartial: true }, [], expect.any(Function), false,
      );
      const [runningRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(runningRun.status).toBe("running");
      expect(runningRun.startedAt).toBeInstanceOf(Date);
      expect(runningRun.error).toBeNull();
      expect(runningRun.finishedAt).toBeNull();
      expect(cleanupSpy).not.toHaveBeenCalled();

      finishSync();
      await startupCompletion;
      const [completedRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(completedRun.status).toBe("succeeded");
      expect(completedRun.startedAt).toEqual(runningRun.startedAt);
      expect(completedRun.error).toBeNull();
      expect(completedRun.finishedAt).toBeInstanceOf(Date);
      expect(completedRun.finishedAt!.getTime()).toBeGreaterThan(uncommittedRun.finishedAt!.getTime());
      expect(runCatalogSyncMock).toHaveBeenCalledTimes(1);
    } finally {
      finishStartup();
      rollbackRecovery();
      finishSync();
      try {
        await recoveryOutcome;
        if (runId !== undefined) {
          await vi.waitFor(() => expect(cleanupSpy).toHaveBeenCalledWith(catalogSyncRunsTable));
        }
      } finally {
        transactionSpy.mockRestore();
        cleanupSpy.mockRestore();
        lockProbe.release();
        runCatalogSyncMock.mockReset();
        vi.doUnmock("@workspace/db");
        vi.resetModules();
      }
    }
  });

  it("waits for in-progress recovery to commit before a delayed startup resumes", async () => {
    // Model another API process: share the real database, but load a separate
    // refresh module so recovery cannot see the delayed worker's local set.
    const database = databaseModule;
    vi.resetModules();
    vi.doMock("@workspace/db", () => database);
    const { recoverInterruptedRuns: recoverFromOtherProcess } = await import("./catalog-refresh");
    let finishStartup!: () => void;
    const startupGate = new Promise<void>((resolve) => { finishStartup = resolve; });
    let commitRecovery!: () => void;
    const recoveryCommitGate = new Promise<void>((resolve) => { commitRecovery = resolve; });
    let signalRecoveryWritten!: (run: typeof catalogSyncRunsTable.$inferSelect) => void;
    const recoveryWritten = new Promise<typeof catalogSyncRunsTable.$inferSelect>((resolve) => {
      signalRecoveryWritten = resolve;
    });
    let signalStartupLockAttempt!: () => void;
    const startupLockAttempted = new Promise<void>((resolve) => { signalStartupLockAttempt = resolve; });
    let signalStartupFinished!: () => void;
    const startupCompletion = new Promise<void>((resolve) => { signalStartupFinished = resolve; });
    const transaction = db.transaction.bind(db);
    const startupSpy = vi.spyOn(db, "transaction")
      .mockImplementationOnce(async (callback, config) => {
        await startupGate;
        return transaction(async (tx) => {
          const execute = tx.execute.bind(tx);
          const executeSpy = vi.spyOn(tx, "execute").mockImplementation((query) => {
            const pending = execute(query);
            signalStartupLockAttempt();
            return pending;
          });
          try {
            return await callback(tx);
          } finally {
            executeSpy.mockRestore();
          }
        }, config);
      })
      .mockImplementationOnce((callback, config) =>
        transaction(async (tx) => {
          const result = await callback(tx);
          const [writtenRun] = await tx.select().from(catalogSyncRunsTable)
            .where(eq(catalogSyncRunsTable.id, runId!));
          signalRecoveryWritten(writtenRun);
          await recoveryCommitGate;
          return result;
        }, config),
      );
    const cleanupSpy = vi.spyOn(db, "delete").mockImplementationOnce(() => {
      signalStartupFinished();
      return {
        where: () => ({ returning: async () => [] }),
      } as unknown as ReturnType<typeof db.delete>;
    });
    const lockProbe = await pool.connect();
    runCatalogSyncMock.mockResolvedValue({
      selected: 0, succeeded: 0, episodes: 0, failures: [],
    });
    let runId: number | undefined;
    let recoveryPromise: Promise<void> | undefined;
    try {
      runId = await startCatalogRefresh("manual", []);
      createdRunIds.push(runId);
      await vi.waitFor(() => expect(startupSpy).toHaveBeenCalledTimes(1));
      await db.update(catalogSyncRunsTable).set({
        createdAt: new Date(Date.now() - STALE_QUEUED_REFRESH_MS - 1_000),
      }).where(eq(catalogSyncRunsTable.id, runId));

      recoveryPromise = recoverFromOtherProcess();
      const uncommittedRun = await recoveryWritten;
      expect(uncommittedRun.status).toBe("failed");
      expect(uncommittedRun.error).toBe(
        "Catalog refresh worker stopped before starting (server restart or database outage); retry the failed titles",
      );
      expect(uncommittedRun.finishedAt).toBeInstanceOf(Date);

      const heldLock = await lockProbe.query<{ locked: boolean }>(
        "select pg_try_advisory_xact_lock(hashtext('watchtime:catalog-refresh-worker'), $1) as locked",
        [runId],
      );
      expect(heldLock.rows[0].locked).toBe(false);

      finishStartup();
      await startupLockAttempted;
      const completedBeforeRecoveryCommit = await Promise.race([
        startupCompletion.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
      ]);
      expect(completedBeforeRecoveryCommit).toBe(false);
      expect(runCatalogSyncMock).not.toHaveBeenCalled();

      commitRecovery();
      await recoveryPromise;
      await startupCompletion;
      expect(runCatalogSyncMock).not.toHaveBeenCalled();
      const [recovered] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(recovered.status).toBe("failed");
      expect(recovered.error).toBe(uncommittedRun.error);
      expect(recovered.finishedAt).toEqual(uncommittedRun.finishedAt);

      // If the startup's finally block retained local ownership, this recovery
      // would leave the same stale queued run untouched.
      await db.update(catalogSyncRunsTable).set({
        status: "queued", error: null, finishedAt: null,
      }).where(eq(catalogSyncRunsTable.id, runId));
      await recoverInterruptedRuns();
      const [recoveredAgain] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(recoveredAgain.status).toBe("failed");
      expect(recoveredAgain.error).toBe(uncommittedRun.error);
      expect(recoveredAgain.finishedAt).toBeInstanceOf(Date);
      expect(runCatalogSyncMock).not.toHaveBeenCalled();
    } finally {
      finishStartup();
      commitRecovery();
      await recoveryPromise?.catch(() => {});
      if (runId !== undefined) {
        await vi.waitFor(() => expect(cleanupSpy).toHaveBeenCalledWith(catalogSyncRunsTable));
      }
      startupSpy.mockRestore();
      cleanupSpy.mockRestore();
      await lockProbe.query("select pg_advisory_unlock_all()");
      lockProbe.release();
      runCatalogSyncMock.mockReset();
      vi.doUnmock("@workspace/db");
      vi.resetModules();
    }
  });

  it("leaves stale queued work alone when another worker owns the catalog lock", async () => {
    const [run] = await db.insert(catalogSyncRunsTable).values({
      trigger: "manual", status: "queued",
      createdAt: new Date(Date.now() - STALE_QUEUED_REFRESH_MS - 1_000),
    }).returning();
    createdRunIds.push(run.id);
    const client = await pool.connect();
    try {
      await client.query("select pg_advisory_lock(hashtext('watchtime:catalog-sync'))");
      await recoverInterruptedRuns();
      const [unchanged] = await db.select().from(catalogSyncRunsTable).where(eq(catalogSyncRunsTable.id, run.id));
      expect(unchanged).toEqual(run);
    } finally {
      await client.query("select pg_advisory_unlock(hashtext('watchtime:catalog-sync'))");
      client.release();
    }
  });

  it("preserves a stale queued worker owned by another process before provider work starts", async () => {
    const [run] = await db.insert(catalogSyncRunsTable).values({
      trigger: "manual", status: "queued",
      createdAt: new Date(Date.now() - STALE_QUEUED_REFRESH_MS - 1_000),
    }).returning();
    createdRunIds.push(run.id);
    const client = await pool.connect();
    try {
      await client.query(
        "select pg_advisory_lock(hashtext('watchtime:catalog-refresh-worker'), $1)", [run.id],
      );
      await recoverInterruptedRuns();
      const [unchanged] = await db.select().from(catalogSyncRunsTable).where(eq(catalogSyncRunsTable.id, run.id));
      expect(unchanged).toEqual(run);
      await client.query(
        "select pg_advisory_unlock(hashtext('watchtime:catalog-refresh-worker'), $1)", [run.id],
      );
      await recoverInterruptedRuns();
      const [recovered] = await db.select().from(catalogSyncRunsTable).where(eq(catalogSyncRunsTable.id, run.id));
      expect(recovered.status).toBe("failed");
    } finally {
      await client.query(
        "select pg_advisory_unlock(hashtext('watchtime:catalog-refresh-worker'), $1)", [run.id],
      );
      client.release();
    }
  });

  it.each(["queued", "running"] as const)("recovers abandoned runs and unfinished items while a %s run is owned by another worker", async (ownedStatus) => {
    const cutoff = new Date(Date.now() - STALE_QUEUED_REFRESH_MS);
    const staleAt = new Date(cutoff.getTime() - 1_000);
    const runs = await db.insert(catalogSyncRunsTable).values([
      { trigger: "manual", status: ownedStatus, createdAt: staleAt },
      { trigger: "manual", status: "queued", createdAt: staleAt },
      { trigger: "manual", status: "running", createdAt: staleAt },
      { trigger: "manual", status: "succeeded", createdAt: staleAt, finishedAt: staleAt },
    ]).returning();
    createdRunIds.push(...runs.map((run) => run.id));
    const runIds = runs.map((run) => run.id);
    const items = await db.insert(catalogSyncItemsTable).values(runs.flatMap((run) =>
      (["queued", "running", "succeeded", "failed"] as const).map((status) => ({
        runId: run.id,
        itemKey: `mixed-ownership-${run.id}-${status}`,
        title: `Mixed ownership ${status}`,
        provider: "TVMaze",
        status,
        startedAt: status === "queued" ? null : staleAt,
        finishedAt: status === "succeeded" || status === "failed" ? staleAt : null,
        error: status === "failed" ? "Existing provider failure" : null,
      })),
    )).returning();
    const readRuns = () => db.select().from(catalogSyncRunsTable)
      .where(inArray(catalogSyncRunsTable.id, runIds)).orderBy(catalogSyncRunsTable.id);
    const readItems = () => db.select().from(catalogSyncItemsTable)
      .where(inArray(catalogSyncItemsTable.runId, runIds)).orderBy(catalogSyncItemsTable.id);
    const queuedExplanation = "Catalog refresh worker stopped before starting (server restart or database outage); retry the failed titles";
    const runningExplanation = "Catalog refresh was interrupted by a server restart";
    const assertRecoveredRun = (actual: typeof runs[number], original: typeof runs[number]) => {
      expect(actual).toEqual({
        ...original,
        status: "failed",
        error: original.status === "queued" ? queuedExplanation : runningExplanation,
        finishedAt: expect.any(Date),
      });
    };
    const assertRecoveredItems = (actual: typeof items, recoveredRunIds: number[]) => {
      expect(actual).toHaveLength(items.length);
      for (const [index, original] of items.entries()) {
        if (recoveredRunIds.includes(original.runId) && ["queued", "running"].includes(original.status)) {
          const originalRun = runs.find((run) => run.id === original.runId)!;
          expect(actual[index]).toEqual({
            ...original,
            status: "failed",
            error: originalRun.status === "queued" ? queuedExplanation : runningExplanation,
            finishedAt: expect.any(Date),
          });
        } else {
          expect(actual[index]).toEqual(original);
        }
      }
    };

    // Keep the owner's session checked out so recovery cannot reentrantly
    // acquire its advisory lock on a connection borrowed from the pool.
    const lockProbe = await pool.connect();
    try {
      await lockProbe.query(
        "select pg_advisory_lock(hashtext('watchtime:catalog-refresh-worker'), $1)", [runs[0].id],
      );

      await recoverInterruptedRuns(cutoff);

      const recoveredRuns = await readRuns();
      const recoveredItems = await readItems();
      expect(recoveredRuns).toHaveLength(runs.length);
      expect(recoveredRuns[0]).toEqual(runs[0]);
      assertRecoveredRun(recoveredRuns[1], runs[1]);
      assertRecoveredRun(recoveredRuns[2], runs[2]);
      expect(recoveredRuns[3]).toEqual(runs[3]);
      assertRecoveredItems(recoveredItems, [runs[1].id, runs[2].id]);

      const unlocked = await lockProbe.query<{ unlocked: boolean }>(
        "select pg_advisory_unlock(hashtext('watchtime:catalog-refresh-worker'), $1) as unlocked", [runs[0].id],
      );
      expect(unlocked.rows[0].unlocked).toBe(true);
      await recoverInterruptedRuns(cutoff);

      const finalRuns = await readRuns();
      const finalItems = await readItems();
      assertRecoveredRun(finalRuns[0], runs[0]);
      expect(finalRuns.slice(1)).toEqual(recoveredRuns.slice(1));
      assertRecoveredItems(finalItems, runIds.slice(0, 3));
      expect(finalItems.filter((item) => item.runId !== runs[0].id))
        .toEqual(recoveredItems.filter((item) => item.runId !== runs[0].id));
    } finally {
      try {
        await lockProbe.query("select pg_advisory_unlock_all()");
      } finally {
        lockProbe.release();
      }
    }
  });
});

describe("catalog refresh history cleanup failure", () => {
  it("leaves a successful refresh successful and logs the cleanup rejection", async () => {
    const cleanupError = new Error("history deletion failed");
    let rejectCleanup!: (error: Error) => void;
    const cleanupGate = new Promise<never>((_resolve, reject) => {
      rejectCleanup = reject;
    });
    runCatalogSyncMock.mockResolvedValueOnce({
      selected: 0, succeeded: 0, episodes: 0, failures: [],
    });
    const deleteSpy = vi.spyOn(db, "delete").mockReturnValue({
      where: () => ({ returning: () => cleanupGate }),
    } as unknown as ReturnType<typeof db.delete>);
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const runId = await startCatalogRefresh("manual", []);
      createdRunIds.push(runId);
      await vi.waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(catalogSyncRunsTable));
      const [beforeCleanup] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(beforeCleanup.status).toBe("succeeded");
      expect(beforeCleanup.finishedAt).toBeInstanceOf(Date);

      rejectCleanup(cleanupError);
      await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(
        { err: cleanupError }, "unable to prune catalog refresh history",
      ));
      await new Promise<void>((resolve) => setImmediate(resolve));
      const [afterCleanup] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(afterCleanup.status).toBe("succeeded");
      expect(afterCleanup.error).toBeNull();
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      deleteSpy.mockRestore();
      warnSpy.mockRestore();
      runCatalogSyncMock.mockReset();
    }
  });

  it.each(["skipped", "failed"] as const)(
    "leaves a %s refresh unchanged and logs the cleanup rejection",
    async (status) => {
      const cleanupError = new Error("history deletion failed");
      const syncError = new Error("catalog sync failed");
      const expectedError = status === "skipped"
        ? "Another catalog refresh is already running"
        : syncError.message;
      let rejectCleanup!: (error: Error) => void;
      const cleanupGate = new Promise<never>((_resolve, reject) => {
        rejectCleanup = reject;
      });
      if (status === "skipped") {
        runCatalogSyncMock.mockResolvedValueOnce(null);
      } else {
        runCatalogSyncMock.mockRejectedValueOnce(syncError);
      }
      const deleteSpy = vi.spyOn(db, "delete").mockReturnValue({
        where: () => ({ returning: () => cleanupGate }),
      } as unknown as ReturnType<typeof db.delete>);
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
      const unhandledRejections: unknown[] = [];
      const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
      process.on("unhandledRejection", onUnhandledRejection);

      try {
        const runId = await startCatalogRefresh("manual", []);
        createdRunIds.push(runId);
        await vi.waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(catalogSyncRunsTable));
        const [beforeCleanup] = await db.select().from(catalogSyncRunsTable)
          .where(eq(catalogSyncRunsTable.id, runId));
        expect(beforeCleanup.status).toBe(status);
        expect(beforeCleanup.error).toBe(expectedError);
        expect(beforeCleanup.finishedAt).toBeInstanceOf(Date);
        if (status === "failed") {
          expect(errorSpy).toHaveBeenCalledWith(
            { err: syncError, runId }, "catalog refresh failed",
          );
        }

        rejectCleanup(cleanupError);
        await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(
          { err: cleanupError }, "unable to prune catalog refresh history",
        ));
        await new Promise<void>((resolve) => setImmediate(resolve));
        const [afterCleanup] = await db.select().from(catalogSyncRunsTable)
          .where(eq(catalogSyncRunsTable.id, runId));
        expect(afterCleanup.status).toBe(status);
        expect(afterCleanup.error).toBe(expectedError);
        expect(unhandledRejections).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandledRejection);
        deleteSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
        runCatalogSyncMock.mockReset();
      }
    },
  );
});