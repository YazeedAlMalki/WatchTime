import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
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
        expect(run).toMatchObject({
          totalItems: 2, processedItems: 2, failedItems: 2, succeededItems: 0, episodesUpdated: 0,
        });
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
        expect(run).toMatchObject({
          totalItems: 4, processedItems: 4, failedItems: 3, succeededItems: 1, episodesUpdated: 5,
        });
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

  it("rolls back interrupted failure recording and recovers unfinished titles for retry", async () => {
    const items = sourceItems.slice(0, 4);
    expect(items).toHaveLength(4);
    const syncError = new Error("database disconnected during refresh");
    const recordError = new Error("database disconnected while saving failed titles");
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const transaction = db.transaction.bind(db);
    let transactionSpy: MockInstance<typeof db.transaction> | undefined;
    let runId!: number;
    let beforeRun!: typeof catalogSyncRunsTable.$inferSelect;
    let beforeItems!: typeof catalogSyncItemsTable.$inferSelect[];
    let rejectedTitleUpdates = 0;
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    runCatalogSyncMock.mockImplementationOnce(async (
      ...[_options, selected, onProgress]: Parameters<typeof import("../seed-real").runCatalogSync>
    ) => {
      if (!selected) throw new Error("Expected explicit refresh titles");
      await onProgress!({ item: selected[0], status: "succeeded", attempted: 1, succeeded: 1, episodes: 5 });
      await onProgress!({
        item: selected[1], status: "failed", attempted: 2, succeeded: 1, episodes: 5, error: "original provider error",
      });
      await onProgress!({ item: selected[2], status: "running", attempted: 3, succeeded: 1, episodes: 5 });
      [beforeRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      beforeItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);

      // Progress has committed. Intercept only executeRun's next transaction:
      // the failure recorder, not startup, progress, or later recovery.
      transactionSpy = vi.spyOn(db, "transaction").mockImplementationOnce((callback, config) =>
        transaction(async (tx) => {
          const update = tx.update.bind(tx);
          const updateSpy = vi.spyOn(tx, "update").mockImplementation((table) => {
            if (table === catalogSyncItemsTable) {
              return {
                set: (values: Parameters<ReturnType<typeof tx.update>["set"]>[0]) => ({
                  where: async (condition: Parameters<ReturnType<ReturnType<typeof tx.update>["set"]>["where"]>[0]) => {
                    const [failedRun] = await tx.select().from(catalogSyncRunsTable)
                      .where(eq(catalogSyncRunsTable.id, runId));
                    expect(failedRun).toMatchObject({ status: "failed", error: syncError.message });
                    expect(failedRun.finishedAt).toBeInstanceOf(Date);
                    // Execute real title writes before interrupting the statement's
                    // promise so unchanged rows cannot disguise a missing rollback.
                    await update(table).set(values).where(condition);
                    const pendingItems = await tx.select().from(catalogSyncItemsTable)
                      .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);
                    expect(pendingItems.slice(0, 2)).toEqual(beforeItems.slice(0, 2));
                    for (const item of pendingItems.slice(2)) {
                      expect(item).toMatchObject({
                        status: "failed", error: syncError.message, finishedAt: failedRun.finishedAt,
                      });
                    }
                    rejectedTitleUpdates++;
                    throw recordError;
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
      throw syncError;
    });

    try {
      runId = await startCatalogRefresh("manual", items);
      createdRunIds.push(runId);
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(
        { err: recordError, runId }, "unable to record catalog refresh failure",
      ));
      expect(errorSpy).toHaveBeenCalledWith({ err: syncError, runId }, "catalog refresh failed");
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(rejectedTitleUpdates).toBe(1);
      transactionSpy!.mockRestore();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandledRejections).toEqual([]);
      expect(beforeRun).toMatchObject({ status: "running", error: null, finishedAt: null });
      expect(beforeItems.map((item) => item.status)).toEqual(["succeeded", "failed", "running", "queued"]);
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId))).toEqual([beforeRun]);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id)).toEqual(beforeItems);

      await recoverInterruptedRuns();
      const [recoveredRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(recoveredRun).toMatchObject({
        status: "failed", error: "Catalog refresh was interrupted by a server restart",
      });
      expect(recoveredRun.finishedAt).toBeInstanceOf(Date);
      const recoveredItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);
      expect(recoveredItems.slice(0, 2)).toEqual(beforeItems.slice(0, 2));
      for (const [index, item] of recoveredItems.slice(2).entries()) {
        expect(item).toMatchObject({
          status: "failed", error: recoveredRun.error, startedAt: beforeItems[index + 2].startedAt,
        });
        expect(item.finishedAt).toBeInstanceOf(Date);
      }

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
        expect(retryRun).toMatchObject({
          trigger: "retry", status: "succeeded", totalItems: 3, processedItems: 3, succeededItems: 3, failedItems: 0,
        });
      });
      expect(runCatalogSyncMock).toHaveBeenCalledTimes(2);
      expect(runCatalogSyncMock).toHaveBeenLastCalledWith(
        { dryRun: false, allowPartial: true }, items.slice(1), expect.any(Function), false,
      );
      const retriedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, retryRunId!)).orderBy(catalogSyncItemsTable.id);
      expect(retriedItems.map((item) => item.itemKey)).toEqual(items.slice(1).map((item) => item.key));
      expect(retriedItems.every((item) => item.status === "succeeded")).toBe(true);
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId))).toEqual([recoveredRun]);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id)).toEqual(recoveredItems);
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      transactionSpy?.mockRestore();
      errorSpy.mockRestore();
      runCatalogSyncMock.mockReset();
    }
  });

  it("recovers failed refreshes after a PostgreSQL error aborts failure recording", async () => {
    const items = sourceItems.slice(0, 4);
    expect(items).toHaveLength(4);
    const syncError = new Error("database disconnected during refresh");
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const transaction = db.transaction.bind(db);
    let transactionSpy: MockInstance<typeof db.transaction> | undefined;
    // Keep the checked-out client in a mutable holder because it is assigned
    // from the mocked runner callback and used after that callback completes.
    const transactionSession: { client: any } = { client: null };
    let querySpy: MockInstance<typeof pool.query> | undefined;
    let runId!: number;
    let beforeRun!: typeof catalogSyncRunsTable.$inferSelect;
    let beforeItems!: typeof catalogSyncItemsTable.$inferSelect[];
    let statementError: unknown;

    runCatalogSyncMock.mockImplementationOnce(async (
      ...[_options, selected, onProgress]: Parameters<typeof import("../seed-real").runCatalogSync>
    ) => {
      if (!selected) throw new Error("Expected explicit refresh titles");
      await onProgress!({ item: selected[0], status: "succeeded", attempted: 1, succeeded: 1, episodes: 5 });
      await onProgress!({
        item: selected[1], status: "failed", attempted: 2, succeeded: 1, episodes: 5, error: "original provider error",
      });
      await onProgress!({ item: selected[2], status: "running", attempted: 3, succeeded: 1, episodes: 5 });
      [beforeRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      beforeItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);

      // Use a retained PostgreSQL session for the failure recorder so the test
      // can prove rollback clears the aborted transaction on that same session.
      transactionSession.client = await pool.connect();
      const transactionDb = drizzle(transactionSession.client, { schema });
      querySpy = vi.spyOn(transactionSession.client, "query");
      transactionSpy = vi.spyOn(db, "transaction").mockImplementationOnce((callback, config) =>
        transactionDb.transaction(async (tx) => {
          const update = tx.update.bind(tx);
          const updateSpy = vi.spyOn(tx, "update").mockImplementation((table) => {
            if (table === catalogSyncItemsTable) {
              return {
                set: () => ({
                  where: async () => {
                    const [failedRun] = await tx.select().from(catalogSyncRunsTable)
                      .where(eq(catalogSyncRunsTable.id, runId));
                    expect(failedRun).toMatchObject({ status: "failed", error: syncError.message });
                    expect(failedRun.finishedAt).toBeInstanceOf(Date);
                    const pendingItems = await tx.select().from(catalogSyncItemsTable)
                      .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);
                    expect(pendingItems.slice(0, 2)).toEqual(beforeItems.slice(0, 2));

                    // Cause a real PostgreSQL statement error in the item-write
                    // path; every later statement must fail until rollback.
                    try {
                      await tx.execute(sql`select 1 / 0`);
                    } catch (error) {
                      statementError = error;
                      expect(error).toMatchObject({
                        cause: { code: "22012", message: "division by zero" },
                      });
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
      throw syncError;
    });

    try {
      runId = await startCatalogRefresh("manual", items);
      createdRunIds.push(runId);
      await vi.waitFor(() => expect(statementError).toBeDefined());
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(
        { err: statementError, runId }, "unable to record catalog refresh failure",
      ));
      expect(errorSpy).toHaveBeenCalledWith({ err: syncError, runId }, "catalog refresh failed");
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(querySpy).toHaveBeenCalledWith(
        expect.objectContaining({ text: "rollback" }), expect.any(Array),
      );

      // Reuse the transaction connection itself to prove PostgreSQL is no
      // longer in its aborted state after the failed recorder rolled back.
      const healthy = await transactionSession.client!.query("select 1 as value");
      expect(healthy.rows).toEqual([{ value: 1 }]);
      transactionSpy!.mockRestore();

      expect(beforeRun).toMatchObject({ status: "running", error: null, finishedAt: null });
      expect(beforeItems.map((item) => item.status)).toEqual(["succeeded", "failed", "running", "queued"]);
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId))).toEqual([beforeRun]);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id)).toEqual(beforeItems);

      await recoverInterruptedRuns();
      const [recoveredRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(recoveredRun).toMatchObject({
        status: "failed", error: "Catalog refresh was interrupted by a server restart",
      });
      expect(recoveredRun.finishedAt).toBeInstanceOf(Date);
      const recoveredItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);
      expect(recoveredItems.slice(0, 2)).toEqual(beforeItems.slice(0, 2));
      for (const [index, item] of recoveredItems.slice(2).entries()) {
        expect(item).toMatchObject({
          status: "failed", error: recoveredRun.error, startedAt: beforeItems[index + 2].startedAt,
        });
        expect(item.finishedAt).toBeInstanceOf(Date);
      }

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
        expect(retryRun).toMatchObject({
          trigger: "retry", status: "succeeded", totalItems: 3, processedItems: 3, succeededItems: 3, failedItems: 0,
        });
      });
      expect(runCatalogSyncMock).toHaveBeenCalledTimes(2);
      expect(runCatalogSyncMock).toHaveBeenLastCalledWith(
        { dryRun: false, allowPartial: true }, items.slice(1), expect.any(Function), false,
      );
      const retriedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, retryRunId!)).orderBy(catalogSyncItemsTable.id);
      expect(retriedItems.map((item) => item.itemKey)).toEqual(items.slice(1).map((item) => item.key));
      expect(retriedItems.every((item) => item.status === "succeeded")).toBe(true);
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId))).toEqual([recoveredRun]);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id)).toEqual(recoveredItems);
    } finally {
      transactionSpy?.mockRestore();
      querySpy?.mockRestore();
      if (transactionSession.client) {
        try {
          await transactionSession.client.query("rollback");
          await transactionSession.client.query("select pg_advisory_unlock_all()");
        } finally {
          transactionSession.client.release();
        }
      }
      errorSpy.mockRestore();
      runCatalogSyncMock.mockReset();
    }
  });

  it("keeps a single-title refresh retryable after PostgreSQL aborts failure recording", async () => {
    const [item] = sourceItems;
    const syncError = new Error("provider failed during single-title refresh");
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const transaction = db.transaction.bind(db);
    let transactionSpy: MockInstance<typeof db.transaction> | undefined;
    const transactionSession: { client: any } = { client: null };
    let querySpy: MockInstance<typeof pool.query> | undefined;
    let runId!: number;
    let beforeRun!: typeof catalogSyncRunsTable.$inferSelect;
    let beforeItem!: typeof catalogSyncItemsTable.$inferSelect;
    let statementError: unknown;

    runCatalogSyncMock.mockImplementationOnce(async (
      ...[_options, selected, onProgress]: Parameters<typeof import("../seed-real").runCatalogSync>
    ) => {
      if (!selected || selected.length !== 1) throw new Error("Expected exactly one refresh title");
      await onProgress!({ item: selected[0], status: "running", attempted: 1, succeeded: 0, episodes: 0 });
      [beforeRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      [beforeItem] = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId));

      transactionSession.client = await pool.connect();
      const transactionDb = drizzle(transactionSession.client, { schema });
      querySpy = vi.spyOn(transactionSession.client, "query");
      transactionSpy = vi.spyOn(db, "transaction").mockImplementationOnce((callback, config) =>
        transactionDb.transaction(async (tx) => {
          const update = tx.update.bind(tx);
          const updateSpy = vi.spyOn(tx, "update").mockImplementation((table) => {
            if (table === catalogSyncItemsTable) {
              return {
                set: () => ({
                  where: async () => {
                    const [failedRun] = await tx.select().from(catalogSyncRunsTable)
                      .where(eq(catalogSyncRunsTable.id, runId));
                    expect(failedRun).toMatchObject({ status: "failed", error: syncError.message });
                    expect(failedRun.finishedAt).toBeInstanceOf(Date);
                    const [runningItem] = await tx.select().from(catalogSyncItemsTable)
                      .where(eq(catalogSyncItemsTable.runId, runId));
                    expect(runningItem).toEqual(beforeItem);

                    // Exercise PostgreSQL's aborted-transaction behavior in the
                    // actual failed-item recording transaction.
                    try {
                      await tx.execute(sql`select 1 / 0`);
                    } catch (error) {
                      statementError = error;
                      expect(error).toMatchObject({
                        cause: { code: "22012", message: "division by zero" },
                      });
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
      throw syncError;
    });

    try {
      expect(item).toBeDefined();
      runId = await startCatalogRefresh("manual", [item]);
      createdRunIds.push(runId);
      await vi.waitFor(() => expect(statementError).toBeDefined());
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(
        { err: statementError, runId }, "unable to record catalog refresh failure",
      ));
      expect(errorSpy).toHaveBeenCalledWith({ err: syncError, runId }, "catalog refresh failed");
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(querySpy).toHaveBeenCalledWith(
        expect.objectContaining({ text: "rollback" }), expect.any(Array),
      );

      const healthy = await transactionSession.client!.query("select 1 as value");
      expect(healthy.rows).toEqual([{ value: 1 }]);
      transactionSpy!.mockRestore();
      expect(beforeRun).toMatchObject({ status: "running", error: null, finishedAt: null });
      expect(beforeItem.status).toBe("running");
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId))).toEqual([beforeRun]);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId))).toEqual([beforeItem]);

      await recoverInterruptedRuns();
      const [recoveredRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(recoveredRun).toMatchObject({
        status: "failed", error: "Catalog refresh was interrupted by a server restart",
        totalItems: 1, processedItems: 1, failedItems: 1, succeededItems: 0, episodesUpdated: 0,
      });
      expect(recoveredRun.finishedAt).toBeInstanceOf(Date);
      const [recoveredItem] = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId));
      expect(recoveredItem).toMatchObject({
        itemKey: item.key, status: "failed", error: recoveredRun.error,
      });
      expect(recoveredItem.finishedAt).toBeInstanceOf(Date);

      runCatalogSyncMock.mockImplementationOnce(async (
        ...[_options, retryItems, onProgress]: Parameters<typeof import("../seed-real").runCatalogSync>
      ) => {
        if (!retryItems || retryItems.length !== 1) throw new Error("Expected one explicit retry title");
        await onProgress!({
          item: retryItems[0], status: "succeeded", attempted: 1, succeeded: 1, episodes: 0,
        });
        return { selected: retryItems.length, succeeded: retryItems.length, episodes: 0, failures: [] };
      });
      const retryRunId = await retryFailedCatalogTitles(runId);
      expect(retryRunId).not.toBeNull();
      createdRunIds.push(retryRunId!);
      await vi.waitFor(async () => {
        const [retryRun] = await db.select().from(catalogSyncRunsTable)
          .where(eq(catalogSyncRunsTable.id, retryRunId!));
        expect(retryRun).toMatchObject({
          trigger: "retry", status: "succeeded", totalItems: 1, processedItems: 1,
          succeededItems: 1, failedItems: 0,
        });
      });
      expect(runCatalogSyncMock).toHaveBeenLastCalledWith(
        { dryRun: false, allowPartial: true }, [item], expect.any(Function), false,
      );
      const [retriedItem] = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, retryRunId!));
      expect(retriedItem).toMatchObject({ itemKey: item.key, status: "succeeded", error: null });
    } finally {
      transactionSpy?.mockRestore();
      querySpy?.mockRestore();
      if (transactionSession.client) {
        try {
          await transactionSession.client.query("rollback");
          await transactionSession.client.query("select pg_advisory_unlock_all()");
        } finally {
          transactionSession.client.release();
        }
      }
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

  it("keeps queued titles retryable when startup and failure recording both fail", async () => {
    const startupError = new Error("unable to mark refresh running");
    const recordError = new Error("unable to mark refresh failed");
    const items = sourceItems.slice(0, 3);
    let runId = 0;
    const transaction = db.transaction.bind(db);
    let failureRunUpdateObserved = false;
    const startupSpy = vi.spyOn(db, "transaction")
      .mockRejectedValueOnce(startupError)
      .mockImplementationOnce((callback, config) =>
        transaction(async (tx) => {
          const update = tx.update.bind(tx);
          const updateSpy = vi.spyOn(tx, "update").mockImplementation((table) => {
            if (table === catalogSyncItemsTable) {
              return {
                set: () => ({
                  where: async () => {
                    const [updatedRun] = await tx.select().from(catalogSyncRunsTable)
                      .where(eq(catalogSyncRunsTable.id, runId));
                    expect(updatedRun).toMatchObject({ status: "failed", error: startupError.message });
                    expect(updatedRun.finishedAt).toBeInstanceOf(Date);
                    failureRunUpdateObserved = true;
                    throw recordError;
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
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      expect(items).toHaveLength(3);
      runId = await startCatalogRefresh("manual", items);
      createdRunIds.push(runId);
      const queuedRun = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      const queuedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);
      expect(queuedRun[0]).toMatchObject({
        status: "queued", totalItems: items.length, processedItems: 0, failedItems: 0, succeededItems: 0,
        startedAt: null, finishedAt: null, error: null,
      });
      expect(queuedItems).toHaveLength(items.length);
      expect(queuedItems.map((item) => item.itemKey)).toEqual(items.map((item) => item.key));
      expect(queuedItems.every((item) => item.status === "queued" && item.error === null)).toBe(true);

      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(
        { err: recordError, runId }, "unable to record catalog refresh failure",
      ));
      expect(errorSpy).toHaveBeenCalledWith({ err: startupError, runId }, "catalog refresh failed");
      expect(startupSpy).toHaveBeenCalledTimes(2);
      expect(failureRunUpdateObserved).toBe(true);
      expect(runCatalogSyncMock).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandledRejections).toEqual([]);
      const unchangedRuns = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      const unchangedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);
      expect(unchangedRuns).toEqual(queuedRun);
      expect(unchangedItems).toEqual(queuedItems);

      // Once the database is available and the orphan is stale, recovery
      // makes every originally queued title actionable.
      await db.update(catalogSyncRunsTable).set({
        createdAt: new Date(Date.now() - STALE_QUEUED_REFRESH_MS - 1_000),
      }).where(eq(catalogSyncRunsTable.id, runId));
      await recoverInterruptedRuns();
      const [recovered] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(recovered.status).toBe("failed");
      expect(recovered.error).toContain("database outage");
      expect(recovered.finishedAt).toBeInstanceOf(Date);
      expect(recovered).toMatchObject({
        totalItems: items.length, processedItems: items.length, failedItems: items.length, succeededItems: 0,
      });
      const recoveredItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);
      expect(recoveredItems).toHaveLength(items.length);
      expect(recoveredItems.map((item) => item.itemKey)).toEqual(items.map((item) => item.key));
      expect(recoveredItems.every((item) =>
        item.status === "failed" && item.error === recovered.error && item.finishedAt instanceof Date,
      )).toBe(true);

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
        expect(retryRun).toMatchObject({
          trigger: "retry", status: "succeeded", totalItems: items.length,
          processedItems: items.length, failedItems: 0, succeededItems: items.length,
        });
      });
      expect(runCatalogSyncMock).toHaveBeenCalledExactlyOnceWith(
        { dryRun: false, allowPartial: true }, items, expect.any(Function), false,
      );
      const retriedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, retryRunId!)).orderBy(catalogSyncItemsTable.id);
      expect(retriedItems).toHaveLength(items.length);
      expect(retriedItems.map((item) => item.itemKey)).toEqual(items.map((item) => item.key));
      expect(retriedItems.every((item) => item.status === "succeeded")).toBe(true);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      startupSpy.mockRestore();
      errorSpy.mockRestore();
      runCatalogSyncMock.mockReset();
    }
  });
});

describe("catalog refresh retry audit failure", () => {
  it("keeps the source failures retryable without creating a partial retry run", async () => {
    const items = sourceItems.slice(0, 2);
    const failedAt = new Date("2026-11-02T12:00:00.000Z");
    const [sourceRun] = await db.insert(catalogSyncRunsTable).values({
      trigger: "manual",
      status: "failed",
      totalItems: items.length,
      processedItems: items.length,
      failedItems: items.length,
      error: "original catalog failure",
      finishedAt: failedAt,
    }).returning();
    createdRunIds.push(sourceRun.id);
    const sourceRows = await db.insert(catalogSyncItemsTable).values(items.map((item) => ({
      runId: sourceRun.id,
      itemKey: item.key,
      title: item.name,
      provider: item.source === "tvmaze" ? "TVMaze" as const : "Wikipedia" as const,
      status: "failed" as const,
      error: `original failure for ${item.key}`,
      finishedAt: failedAt,
    }))).returning();
    const previousRetryRuns = await db.select({ id: catalogSyncRunsTable.id })
      .from(catalogSyncRunsTable).where(eq(catalogSyncRunsTable.trigger, "retry"));
    const auditError = new Error("unable to write retry audit");

    await expect(retryFailedCatalogTitles(sourceRun.id, async (tx, retryRunId) => {
      const [queuedRun] = await tx.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, retryRunId));
      expect(queuedRun).toMatchObject({
        trigger: "retry",
        status: "queued",
        totalItems: items.length,
      });
      const queuedItems = await tx.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, retryRunId));
      expect(queuedItems.map((item) => item.itemKey).sort()).toEqual(items.map((item) => item.key).sort());
      throw auditError;
    })).rejects.toBe(auditError);

    expect(await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, sourceRun.id))).toEqual([sourceRun]);
    expect(await db.select().from(catalogSyncItemsTable)
      .where(eq(catalogSyncItemsTable.runId, sourceRun.id))
      .orderBy(catalogSyncItemsTable.id)).toEqual(sourceRows);
    const retryRunsAfterAuditFailure = await db.select({ id: catalogSyncRunsTable.id })
      .from(catalogSyncRunsTable).where(eq(catalogSyncRunsTable.trigger, "retry"));
    expect(retryRunsAfterAuditFailure).toEqual(previousRetryRuns);
    runCatalogSyncMock.mockImplementationOnce(async (
      ...[_options, retryItems, onProgress]: Parameters<typeof import("../seed-real").runCatalogSync>
    ) => {
      if (!retryItems) throw new Error("Expected explicit retry titles");
      for (const [index, item] of retryItems.entries()) {
        await onProgress!({ item, status: "succeeded", attempted: index + 1, succeeded: index + 1, episodes: 0 });
      }
      return { selected: retryItems.length, succeeded: retryItems.length, episodes: 0, failures: [] };
    });

    try {
      const retryRunId = await retryFailedCatalogTitles(sourceRun.id);
      expect(retryRunId).not.toBeNull();
      createdRunIds.push(retryRunId!);
      await vi.waitFor(async () => {
        const [retryRun] = await db.select().from(catalogSyncRunsTable)
          .where(eq(catalogSyncRunsTable.id, retryRunId!));
        expect(retryRun).toMatchObject({
          trigger: "retry",
          status: "succeeded",
          totalItems: items.length,
          succeededItems: items.length,
          failedItems: 0,
        });
      });
      const retriedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, retryRunId!));
      expect(retriedItems.map((item) => item.itemKey).sort()).toEqual(items.map((item) => item.key).sort());
      expect(retriedItems.every((item) => item.status === "succeeded")).toBe(true);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, sourceRun.id))
        .orderBy(catalogSyncItemsTable.id)).toEqual(sourceRows);
      expect(runCatalogSyncMock).toHaveBeenCalledExactlyOnceWith(
        { dryRun: false, allowPartial: true }, items, expect.any(Function), false,
      );
    } finally {
      runCatalogSyncMock.mockReset();
    }
  });
});

describe("catalog refresh recovery", () => {
  it("propagates an initial catalog lock query rejection without starting a transaction and releases its client", async () => {
    const recoveryClient = await pool.connect();
    // Keep the session reserved until cleanup even if recovery releases it.
    const releaseSpy = vi.spyOn(recoveryClient, "release").mockImplementation(() => {});
    const connectSpy = vi.spyOn(pool, "connect").mockImplementationOnce(() => Promise.resolve(recoveryClient));
    const queryError = new Error("catalog advisory-lock query rejected");
    const querySpy = vi.spyOn(recoveryClient, "query").mockRejectedValueOnce(queryError);
    const transactionSpy = vi.spyOn(db, "transaction");

    try {
      await expect(recoverInterruptedRuns()).rejects.toBe(queryError);
      expect(querySpy).toHaveBeenNthCalledWith(
        1,
        "select pg_try_advisory_lock(hashtext('watchtime:catalog-sync')) as locked",
      );
      expect(transactionSpy).not.toHaveBeenCalled();
      expect(releaseSpy).toHaveBeenCalledTimes(1);
    } finally {
      transactionSpy.mockRestore();
      querySpy.mockRestore();
      connectSpy.mockRestore();
      releaseSpy.mockRestore();
      try {
        await recoveryClient.query("select pg_advisory_unlock_all()");
      } finally {
        recoveryClient.release();
      }
    }
  });

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

  it("releases the catalog and every recovered worker lock after committing repairs", async () => {
    const cutoff = new Date(Date.now() - STALE_QUEUED_REFRESH_MS);
    const staleAt = new Date(cutoff.getTime() - 1_000);
    const runs = await db.insert(catalogSyncRunsTable).values([
      { trigger: "manual", status: "queued", createdAt: staleAt },
      { trigger: "manual", status: "running", createdAt: staleAt, startedAt: staleAt },
    ]).returning();
    const runIds = runs.map((run) => run.id);
    createdRunIds.push(...runIds);
    await db.insert(catalogSyncItemsTable).values(runs.map((run) => ({
      runId: run.id, itemKey: `commit-lock-cleanup-${run.id}`,
      title: "Recovery lock cleanup", provider: "TVMaze",
      status: run.status, startedAt: run.startedAt,
    })));

    // Reserve the probe before recovery so it cannot reuse a recovery session:
    // advisory locks are reentrant and would otherwise hide leaked ownership.
    const lockProbe = await pool.connect();
    try {
      await expect(recoverInterruptedRuns(cutoff)).resolves.toBeUndefined();

      const recoveredRuns = await db.select().from(catalogSyncRunsTable)
        .where(inArray(catalogSyncRunsTable.id, runIds)).orderBy(catalogSyncRunsTable.id);
      expect(recoveredRuns).toHaveLength(runs.length);
      for (const run of recoveredRuns) {
        expect(run).toMatchObject({ status: "failed", processedItems: 1, failedItems: 1 });
        expect(run.finishedAt).toBeInstanceOf(Date);
      }
      const recoveredItems = await db.select().from(catalogSyncItemsTable)
        .where(inArray(catalogSyncItemsTable.runId, runIds));
      expect(recoveredItems).toHaveLength(runs.length);
      for (const item of recoveredItems) {
        expect(item.status).toBe("failed");
        expect(item.finishedAt).toBeInstanceOf(Date);
      }

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
    expect(recovered[0]).toMatchObject({ processedItems: 2, failedItems: 1 });
    expect(recovered[1]).toMatchObject({ processedItems: 1, failedItems: 1 });
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

  it.each(["queued", "running"] as const)("reconciles mixed item totals when recovering a %s run without losing successful work", async (status) => {
    const cutoff = new Date(Date.now() - STALE_QUEUED_REFRESH_MS);
    const staleAt = new Date(cutoff.getTime() - 1_000);
    const [run] = await db.insert(catalogSyncRunsTable).values({
      trigger: "manual", status, createdAt: staleAt,
      totalItems: 4, processedItems: 2, succeededItems: 1, failedItems: 1, episodesUpdated: 7,
    }).returning();
    createdRunIds.push(run.id);
    const originalItems = await db.insert(catalogSyncItemsTable).values(
      (["succeeded", "failed", "running", "queued"] as const).map((itemStatus) => ({
        runId: run.id, itemKey: `reconcile-${run.id}-${itemStatus}`,
        title: `Reconcile ${itemStatus}`, provider: "TVMaze", status: itemStatus,
        startedAt: itemStatus === "queued" ? null : staleAt,
        finishedAt: ["succeeded", "failed"].includes(itemStatus) ? staleAt : null,
        error: itemStatus === "failed" ? "Original provider failure" : null,
      })),
    ).returning();

    await recoverInterruptedRuns(cutoff);
    const [recovered] = await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, run.id));
    const results = await db.select().from(catalogSyncItemsTable)
      .where(eq(catalogSyncItemsTable.runId, run.id)).orderBy(catalogSyncItemsTable.id);
    expect(recovered).toMatchObject({
      status: "failed", totalItems: 4, processedItems: results.length,
      failedItems: results.filter((item) => item.status === "failed").length,
      succeededItems: 1, episodesUpdated: 7,
    });
    expect(recovered.failedItems).toBe(3);
    expect(results.slice(0, 2)).toEqual(originalItems.slice(0, 2));
    expect(results.slice(2).every((item) => item.status === "failed" && item.error === recovered.error)).toBe(true);

    await recoverInterruptedRuns(cutoff);
    expect(await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, run.id))).toEqual([recovered]);
  });

  it("keeps a concurrent recovery from changing saved failure details and retries pending work after unlock", async () => {
    // Model two API processes with separate module-local state and one real database.
    const database = databaseModule;
    vi.resetModules();
    vi.doMock("@workspace/db", () => database);
    const { recoverInterruptedRuns: recoverFromOtherProcess } = await import("./catalog-refresh");
    const cutoff = new Date(Date.now() - STALE_QUEUED_REFRESH_MS);
    const [firstRun] = await db.insert(catalogSyncRunsTable).values({
      trigger: "manual",
      status: "running",
      startedAt: new Date(cutoff.getTime() - 1_000),
    }).returning();
    createdRunIds.push(firstRun.id);

    let releaseFirstRecovery!: () => void;
    const firstRecoveryGate = new Promise<void>((resolve) => { releaseFirstRecovery = resolve; });
    let signalFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => { signalFirstWrite = resolve; });
    const transaction = db.transaction.bind(db);
    const transactionSpy = vi.spyOn(db, "transaction").mockImplementationOnce(async (callback, config) => {
      const result = await transaction(callback, config);
      // The failed status, error, and timestamp are committed, but this
      // recovery still owns the catalog lock until its finally block runs.
      signalFirstWrite();
      await firstRecoveryGate;
      return result;
    });
    let firstRecovery: Promise<void> | undefined;

    try {
      firstRecovery = recoverInterruptedRuns(cutoff);
      await firstWrite;
      const [savedFailure] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, firstRun.id));
      expect(savedFailure.status).toBe("failed");
      expect(savedFailure.error).toBe("Catalog refresh was interrupted by a server restart");
      expect(savedFailure.finishedAt).toBeInstanceOf(Date);

      // This run becomes pending after the first process has committed its
      // write. The second process must not sweep it while the first owns the
      // catalog-wide lock.
      const [pendingRun] = await db.insert(catalogSyncRunsTable).values({
        trigger: "manual",
        status: "running",
        startedAt: new Date(cutoff.getTime() - 1_000),
      }).returning();
      createdRunIds.push(pendingRun.id);

      await expect(recoverFromOtherProcess(cutoff)).resolves.toBeUndefined();
      const [unchangedFailure, stillPending] = await db.select().from(catalogSyncRunsTable)
        .where(inArray(catalogSyncRunsTable.id, [firstRun.id, pendingRun.id]))
        .orderBy(catalogSyncRunsTable.id);
      expect(unchangedFailure).toEqual(savedFailure);
      expect(stillPending).toEqual(pendingRun);

      releaseFirstRecovery();
      await firstRecovery;
      firstRecovery = undefined;

      // Once the first process releases its lock, the independent module can
      // recover the work that remained pending.
      await recoverFromOtherProcess(cutoff);
      const [recoveredFailure, recoveredPending] = await db.select().from(catalogSyncRunsTable)
        .where(inArray(catalogSyncRunsTable.id, [firstRun.id, pendingRun.id]))
        .orderBy(catalogSyncRunsTable.id);
      expect(recoveredFailure).toEqual(savedFailure);
      expect(recoveredPending.status).toBe("failed");
      expect(recoveredPending.error).toBe("Catalog refresh was interrupted by a server restart");
      expect(recoveredPending.finishedAt).toBeInstanceOf(Date);
    } finally {
      releaseFirstRecovery();
      await firstRecovery?.catch(() => {});
      transactionSpy.mockRestore();
      vi.doUnmock("@workspace/db");
      vi.resetModules();
    }
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

  it("records a skipped result after same-run recovery rolls back", async () => {
    // Model recovery in another API process, without the startup's activeRunIds.
    vi.resetModules();
    vi.doMock("@workspace/db", () => databaseModule);
    const { recoverInterruptedRuns: recoverFromOtherProcess } = await import("./catalog-refresh");
    let finishStartup!: () => void;
    const startupGate = new Promise<void>((resolve) => { finishStartup = resolve; });
    let rollbackRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => { rollbackRecovery = resolve; });
    let signalRecoveryWritten!: (run: typeof catalogSyncRunsTable.$inferSelect) => void;
    const recoveryWritten = new Promise<Parameters<typeof signalRecoveryWritten>[0]>((resolve) => {
      signalRecoveryWritten = resolve;
    });
    let signalStartupFinished!: () => void;
    const startupCompletion = new Promise<void>((resolve) => { signalStartupFinished = resolve; });
    const recoveryError = new Error("unable to commit catalog recovery");
    const transaction = db.transaction.bind(db);
    const items = sourceItems.slice(0, 2);
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
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);
    runCatalogSyncMock.mockResolvedValueOnce(null);
    let recoveryOutcome: Promise<unknown> | undefined;

    try {
      runId = await startCatalogRefresh("manual", items);
      createdRunIds.push(runId);
      await vi.waitFor(() => expect(transactionSpy).toHaveBeenCalledTimes(1));
      await db.update(catalogSyncRunsTable).set({
        createdAt: new Date(Date.now() - STALE_QUEUED_REFRESH_MS - 1_000),
      }).where(eq(catalogSyncRunsTable.id, runId));
      const [queuedRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      const queuedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);

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
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId))).toEqual([queuedRun]);

      finishStartup();
      // A real ungranted lock proves startup is waiting on recovery's lease.
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

      // Ensure the skipped result cannot reuse recovery's rolled-back timestamp.
      await vi.waitFor(() => expect(Date.now()).toBeGreaterThan(uncommittedRun.finishedAt!.getTime()));
      rollbackRecovery();
      await expect(recoveryOutcome).resolves.toBe(recoveryError);
      await vi.waitFor(() => expect(runCatalogSyncMock).toHaveBeenCalledTimes(1));
      expect(runCatalogSyncMock).toHaveBeenCalledWith(
        { dryRun: false, allowPartial: true }, items, expect.any(Function), false,
      );
      await startupCompletion;
      await vi.waitFor(() => expect(cleanupSpy).toHaveBeenCalledWith(catalogSyncRunsTable));

      const [skippedRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(skippedRun).toMatchObject({
        status: "skipped",
        error: "Another catalog refresh is already running",
        processedItems: 0,
        succeededItems: 0,
        failedItems: 0,
        episodesUpdated: 0,
        finishedAt: expect.any(Date),
      });
      expect(skippedRun.error).not.toBe(uncommittedRun.error);
      expect(skippedRun.finishedAt!.getTime()).toBeGreaterThan(uncommittedRun.finishedAt!.getTime());
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id))
        .toEqual(queuedItems);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandledRejections).toEqual([]);
    } finally {
      finishStartup();
      rollbackRecovery();
      try {
        await recoveryOutcome;
        if (runId !== undefined) {
          await vi.waitFor(() => expect(cleanupSpy).toHaveBeenCalledWith(catalogSyncRunsTable));
        }
      } finally {
        process.off("unhandledRejection", onUnhandledRejection);
        transactionSpy.mockRestore();
        cleanupSpy.mockRestore();
        lockProbe.release();
        runCatalogSyncMock.mockReset();
        vi.doUnmock("@workspace/db");
        vi.resetModules();
      }
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
    let signalRecoveryWritten!: (snapshot: {
      run: typeof catalogSyncRunsTable.$inferSelect;
      items: typeof catalogSyncItemsTable.$inferSelect[];
    }) => void;
    const recoveryWritten = new Promise<Parameters<typeof signalRecoveryWritten>[0]>((resolve) => {
      signalRecoveryWritten = resolve;
    });
    const items = sourceItems.slice(0, 2);
    expect(items).toHaveLength(2);
    let resumeProgress!: () => void;
    const progressGate = new Promise<void>((resolve) => { resumeProgress = resolve; });
    let signalProgressWritten!: () => void;
    const progressWritten = new Promise<void>((resolve) => { signalProgressWritten = resolve; });
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
          const writtenItems = await tx.select().from(catalogSyncItemsTable)
            .where(eq(catalogSyncItemsTable.runId, runId!)).orderBy(catalogSyncItemsTable.id);
          signalRecoveryWritten({ run: writtenRun, items: writtenItems });
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
    runCatalogSyncMock.mockImplementation(async (
      ...[_options, selected, onProgress]: Parameters<typeof import("../seed-real").runCatalogSync>
    ) => {
      if (!selected || !onProgress) throw new Error("Expected explicit titles and progress callback");
      await progressGate;
      for (const [index, item] of selected.entries()) {
        await onProgress({
          item, status: "running", attempted: index + 1, succeeded: index, episodes: index * 3,
        });
        await onProgress({
          item, status: "succeeded", attempted: index + 1, succeeded: index + 1, episodes: (index + 1) * 3,
        });
      }
      signalProgressWritten();
      await syncGate;
      return { selected: selected.length, succeeded: selected.length, episodes: selected.length * 3, failures: [] };
    });
    let recoveryOutcome: Promise<unknown> | undefined;
    try {
      runId = await startCatalogRefresh("manual", items);
      createdRunIds.push(runId);
      await vi.waitFor(() => expect(transactionSpy).toHaveBeenCalledTimes(1));
      await db.update(catalogSyncRunsTable).set({
        createdAt: new Date(Date.now() - STALE_QUEUED_REFRESH_MS - 1_000),
      }).where(eq(catalogSyncRunsTable.id, runId));
      const [queuedRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      const queuedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);
      expect(queuedItems.map((item) => item.itemKey)).toEqual(items.map((item) => item.key));
      for (const item of queuedItems) {
        expect(item).toMatchObject({ status: "queued", error: null, startedAt: null, finishedAt: null });
      }

      // Attach the rejection handler before releasing recovery to roll back.
      recoveryOutcome = recoverFromOtherProcess().then(
        () => undefined,
        (error: unknown) => error,
      );
      const { run: uncommittedRun, items: uncommittedItems } = await recoveryWritten;
      expect(uncommittedRun.status).toBe("failed");
      expect(uncommittedRun.error).toBe(
        "Catalog refresh worker stopped before starting (server restart or database outage); retry the failed titles",
      );
      expect(uncommittedRun.finishedAt).toBeInstanceOf(Date);
      expect(uncommittedRun.startedAt).toBeNull();
      expect(uncommittedItems).toHaveLength(items.length);
      for (const item of uncommittedItems) {
        expect(item).toMatchObject({ status: "failed", error: uncommittedRun.error, startedAt: null });
        expect(item.finishedAt).toBeInstanceOf(Date);
      }
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId))).toEqual([queuedRun]);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id)).toEqual(queuedItems);

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
        { dryRun: false, allowPartial: true }, items, expect.any(Function), false,
      );
      const [runningRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(runningRun.status).toBe("running");
      expect(runningRun.startedAt).toBeInstanceOf(Date);
      expect(runningRun.error).toBeNull();
      expect(runningRun.finishedAt).toBeNull();
      expect(runningRun).toMatchObject({
        totalItems: 2, processedItems: 0, succeededItems: 0, failedItems: 0, episodesUpdated: 0,
      });
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id)).toEqual(queuedItems);
      expect(cleanupSpy).not.toHaveBeenCalled();

      resumeProgress();
      await progressWritten;
      const progressedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);
      expect(progressedItems).toHaveLength(items.length);
      for (const [index, item] of progressedItems.entries()) {
        expect(item).toMatchObject({ id: queuedItems[index].id, status: "succeeded", error: null });
        expect(item.startedAt).toBeInstanceOf(Date);
        expect(item.startedAt!.getTime()).toBeGreaterThan(uncommittedRun.finishedAt!.getTime());
        expect(item.finishedAt).toBeInstanceOf(Date);
        expect(item.finishedAt!.getTime()).toBeGreaterThanOrEqual(item.startedAt!.getTime());
      }
      const [progressedRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(progressedRun).toMatchObject({
        status: "running", totalItems: 2, processedItems: 2, succeededItems: 2,
        failedItems: 0, episodesUpdated: 6, error: null, finishedAt: null,
      });
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
      expect(completedRun).toMatchObject({
        totalItems: 2, processedItems: 2, succeededItems: 2, failedItems: 0, episodesUpdated: 6,
      });
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id)).toEqual(progressedItems);
      expect(runCatalogSyncMock).toHaveBeenCalledTimes(1);
    } finally {
      finishStartup();
      rollbackRecovery();
      resumeProgress();
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

  it("records its own provider failure when the same waiting startup resumes after recovery rolls back", async () => {
    // Independent process-local ownership, but the exact same database instance
    // so the transaction spy can hold recovery's real, uncommitted writes.
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
    let failSync!: () => void;
    const syncGate = new Promise<void>((resolve) => { failSync = resolve; });
    let signalCleanup!: () => void;
    const cleanupReached = new Promise<void>((resolve) => { signalCleanup = resolve; });
    const recoveryError = new Error("unable to commit recovery before provider failure");
    const providerError = new Error("TVMaze unavailable after same-run startup resumed");
    const items = sourceItems.slice(0, 2);
    expect(items).toHaveLength(2);
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
    // Pruning is entered only after executeRun releases local ownership.
    const cleanupSpy = vi.spyOn(db, "delete").mockImplementationOnce(() => {
      signalCleanup();
      return {
        where: () => ({ returning: async () => [] }),
      } as unknown as ReturnType<typeof db.delete>;
    });
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);
    const lockProbe = await pool.connect();
    runCatalogSyncMock.mockImplementation(async () => {
      await syncGate;
      throw providerError;
    });
    let recoveryOutcome: Promise<unknown> | undefined;
    try {
      runId = await startCatalogRefresh("manual", items);
      createdRunIds.push(runId);
      await vi.waitFor(() => expect(transactionSpy).toHaveBeenCalledTimes(1));
      await db.update(catalogSyncRunsTable).set({
        createdAt: new Date(Date.now() - STALE_QUEUED_REFRESH_MS - 1_000),
      }).where(eq(catalogSyncRunsTable.id, runId));
      const [queuedRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      const queuedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);

      // Handle recovery's deliberate rejection before allowing it to roll back.
      recoveryOutcome = recoverFromOtherProcess().then(
        () => undefined,
        (error: unknown) => error,
      );
      const uncommittedRun = await recoveryWritten;
      expect(uncommittedRun).toMatchObject({
        status: "failed", startedAt: null,
        error: "Catalog refresh worker stopped before starting (server restart or database outage); retry the failed titles",
      });
      expect(uncommittedRun.finishedAt).toBeInstanceOf(Date);
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId))).toEqual([queuedRun]);

      finishStartup();
      // Observe a real blocked lease, not just a worker scheduled to start later.
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

      // Distinguish this worker's eventual completion from discarded recovery
      // diagnostics even if the database and provider mock are very fast.
      await vi.waitFor(() => expect(Date.now()).toBeGreaterThan(uncommittedRun.finishedAt!.getTime()));
      rollbackRecovery();
      await expect(recoveryOutcome).resolves.toBe(recoveryError);
      await vi.waitFor(() => expect(runCatalogSyncMock).toHaveBeenCalledTimes(1));
      const [runningRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(runningRun).toMatchObject({ status: "running", error: null, finishedAt: null });
      expect(runningRun.startedAt).toBeInstanceOf(Date);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id)).toEqual(queuedItems);
      expect(cleanupSpy).not.toHaveBeenCalled();

      const providerFailureAt = Date.now();
      failSync();
      await cleanupReached;
      const [failedRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(failedRun).toMatchObject({
        status: "failed", error: providerError.message, startedAt: runningRun.startedAt,
      });
      expect(failedRun.finishedAt).toBeInstanceOf(Date);
      expect(failedRun.finishedAt!.getTime()).toBeGreaterThan(uncommittedRun.finishedAt!.getTime());
      expect(failedRun.finishedAt!.getTime()).toBeGreaterThanOrEqual(providerFailureAt);
      const failedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);
      expect(failedItems).toHaveLength(items.length);
      for (const [index, item] of failedItems.entries()) {
        expect(item).toMatchObject({
          id: queuedItems[index].id, status: "failed", error: providerError.message,
          startedAt: null, finishedAt: failedRun.finishedAt,
        });
      }
      expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
        { err: providerError, runId }, "catalog refresh failed",
      );
      expect(runCatalogSyncMock).toHaveBeenCalledExactlyOnceWith(
        { dryRun: false, allowPartial: true }, items, expect.any(Function), false,
      );
      expect(cleanupSpy).toHaveBeenCalledExactlyOnceWith(catalogSyncRunsTable);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandledRejections).toEqual([]);
    } finally {
      finishStartup();
      rollbackRecovery();
      failSync();
      try {
        await recoveryOutcome;
        if (runId !== undefined) {
          await vi.waitFor(() => expect(cleanupSpy).toHaveBeenCalledWith(catalogSyncRunsTable));
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      } finally {
        process.off("unhandledRejection", onUnhandledRejection);
        transactionSpy.mockRestore();
        cleanupSpy.mockRestore();
        errorSpy.mockRestore();
        lockProbe.release();
        runCatalogSyncMock.mockReset();
        vi.doUnmock("@workspace/db");
        vi.resetModules();
      }
    }
  });

  it("keeps mixed provider results when the same waiting startup resumes after recovery rolls back", async () => {
    // Model recovery in another API process, sharing the database so its
    // uncommitted failure writes can be observed and then rolled back.
    vi.resetModules();
    vi.doMock("@workspace/db", () => databaseModule);
    const { recoverInterruptedRuns: recoverFromOtherProcess } = await import("./catalog-refresh");
    let finishStartup!: () => void;
    const startupGate = new Promise<void>((resolve) => { finishStartup = resolve; });
    let rollbackRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => { rollbackRecovery = resolve; });
    let signalRecoveryWritten!: (snapshot: {
      run: typeof catalogSyncRunsTable.$inferSelect;
      items: typeof catalogSyncItemsTable.$inferSelect[];
    }) => void;
    const recoveryWritten = new Promise<Parameters<typeof signalRecoveryWritten>[0]>((resolve) => {
      signalRecoveryWritten = resolve;
    });
    let resumeProgress!: () => void;
    const progressGate = new Promise<void>((resolve) => { resumeProgress = resolve; });
    let finishSync!: () => void;
    const syncGate = new Promise<void>((resolve) => { finishSync = resolve; });
    let signalProgressWritten!: () => void;
    const progressWritten = new Promise<void>((resolve) => { signalProgressWritten = resolve; });
    let signalCleanup!: () => void;
    const cleanupReached = new Promise<void>((resolve) => { signalCleanup = resolve; });
    const recoveryError = new Error("unable to commit recovery before partial provider result");
    const items = [
      sourceItems[0],
      sourceItems.find((item) => item.source === "tvmaze" && item !== sourceItems[0])!,
      sourceItems.find((item) => item.source === "wikipedia")!,
    ];
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.source)).toEqual(["tvmaze", "tvmaze", "wikipedia"]);
    const providerErrors = [
      "TVMaze episode lookup timed out",
      "Wikipedia article lookup returned no result",
    ];
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
          const writtenItems = await tx.select().from(catalogSyncItemsTable)
            .where(eq(catalogSyncItemsTable.runId, runId!)).orderBy(catalogSyncItemsTable.id);
          signalRecoveryWritten({ run: writtenRun, items: writtenItems });
          await recoveryGate;
          throw recoveryError;
        }, config),
      );
    // Reaching pruning proves the resumed worker released local ownership.
    const cleanupSpy = vi.spyOn(db, "delete").mockImplementationOnce(() => {
      signalCleanup();
      return {
        where: () => ({ returning: async () => [] }),
      } as unknown as ReturnType<typeof db.delete>;
    });
    const lockProbe = await pool.connect();
    runCatalogSyncMock.mockImplementation(async (
      ...[_options, selected, onProgress]: Parameters<typeof import("../seed-real").runCatalogSync>
    ) => {
      if (!selected || !onProgress) throw new Error("Expected explicit titles and progress callback");
      const [successfulItem, tvmazeFailure, wikipediaFailure] = selected;
      await progressGate;
      await onProgress({
        item: successfulItem, status: "running", attempted: 1, succeeded: 0, episodes: 0,
      });
      await onProgress({
        item: successfulItem, status: "succeeded", attempted: 1, succeeded: 1, episodes: 4,
      });
      await onProgress({
        item: tvmazeFailure, status: "running", attempted: 2, succeeded: 1, episodes: 4,
      });
      await onProgress({
        item: tvmazeFailure, status: "failed", attempted: 2, succeeded: 1, episodes: 4,
        error: providerErrors[0],
      });
      await onProgress({
        item: wikipediaFailure, status: "running", attempted: 3, succeeded: 1, episodes: 4,
      });
      await onProgress({
        item: wikipediaFailure, status: "failed", attempted: 3, succeeded: 1, episodes: 4,
        error: providerErrors[1],
      });
      signalProgressWritten();
      await syncGate;
      return {
        selected: 3,
        succeeded: 1,
        episodes: 4,
        failures: [
          { key: tvmazeFailure.key, title: tvmazeFailure.name, provider: "TVMaze", error: providerErrors[0] },
          { key: wikipediaFailure.key, title: wikipediaFailure.name, provider: "Wikipedia", error: providerErrors[1] },
        ],
      };
    });
    let recoveryOutcome: Promise<unknown> | undefined;
    try {
      runId = await startCatalogRefresh("manual", items);
      createdRunIds.push(runId);
      await vi.waitFor(() => expect(transactionSpy).toHaveBeenCalledTimes(1));
      await db.update(catalogSyncRunsTable).set({
        createdAt: new Date(Date.now() - STALE_QUEUED_REFRESH_MS - 1_000),
      }).where(eq(catalogSyncRunsTable.id, runId));
      const [queuedRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      const queuedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);
      expect(queuedItems.map((item) => item.itemKey)).toEqual(items.map((item) => item.key));

      // Handle recovery's deliberate rejection before allowing it to roll back.
      recoveryOutcome = recoverFromOtherProcess().then(
        () => undefined,
        (error: unknown) => error,
      );
      const {
        run: uncommittedRun,
        items: uncommittedItems,
      } = await recoveryWritten;
      expect(uncommittedRun).toMatchObject({
        status: "failed", startedAt: null,
        error: "Catalog refresh worker stopped before starting (server restart or database outage); retry the failed titles",
      });
      expect(uncommittedRun.finishedAt).toBeInstanceOf(Date);
      expect(uncommittedItems).toHaveLength(items.length);
      for (const item of uncommittedItems) {
        expect(item).toMatchObject({
          status: "failed", error: uncommittedRun.error, startedAt: null,
        });
        expect(item.finishedAt).toBeInstanceOf(Date);
      }
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId))).toEqual([queuedRun]);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id)).toEqual(queuedItems);

      finishStartup();
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

      // Completion timestamps must belong to the provider run, not recovery's
      // discarded failure writes, even on a fast database.
      await vi.waitFor(() => expect(Date.now()).toBeGreaterThan(uncommittedRun.finishedAt!.getTime()));
      rollbackRecovery();
      await expect(recoveryOutcome).resolves.toBe(recoveryError);
      await vi.waitFor(() => expect(runCatalogSyncMock).toHaveBeenCalledTimes(1));
      expect(runCatalogSyncMock).toHaveBeenCalledExactlyOnceWith(
        { dryRun: false, allowPartial: true }, items, expect.any(Function), false,
      );
      const [runningRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(runningRun).toMatchObject({
        status: "running", error: null, finishedAt: null,
        totalItems: 3, processedItems: 0, succeededItems: 0, failedItems: 0, episodesUpdated: 0,
      });
      expect(runningRun.startedAt).toBeInstanceOf(Date);
      expect(runningRun.startedAt!.getTime()).toBeGreaterThan(uncommittedRun.finishedAt!.getTime());
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id)).toEqual(queuedItems);

      resumeProgress();
      await progressWritten;
      const progressedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);
      expect(progressedItems).toHaveLength(3);
      expect(progressedItems.map((item) => item.provider)).toEqual(["TVMaze", "TVMaze", "Wikipedia"]);
      expect(progressedItems.map((item) => item.status)).toEqual(["succeeded", "failed", "failed"]);
      expect(progressedItems.map((item) => item.error)).toEqual([null, ...providerErrors]);
      for (const item of progressedItems) {
        expect(item.startedAt).toBeInstanceOf(Date);
        expect(item.startedAt!.getTime()).toBeGreaterThan(uncommittedRun.finishedAt!.getTime());
        expect(item.finishedAt).toBeInstanceOf(Date);
        expect(item.finishedAt!.getTime()).toBeGreaterThan(uncommittedRun.finishedAt!.getTime());
      }
      const [progressedRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(progressedRun).toMatchObject({
        status: "running", error: null, finishedAt: null,
        totalItems: 3, processedItems: 3, succeededItems: 1, failedItems: 2, episodesUpdated: 4,
      });
      expect(cleanupSpy).not.toHaveBeenCalled();

      const providerCompletionAt = Date.now();
      finishSync();
      await cleanupReached;
      const [partialRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(partialRun).toMatchObject({
        status: "partial", error: providerErrors[0], startedAt: runningRun.startedAt,
        totalItems: 3, processedItems: 3, succeededItems: 1, failedItems: 2, episodesUpdated: 4,
      });
      expect(partialRun.finishedAt).toBeInstanceOf(Date);
      expect(partialRun.finishedAt!.getTime()).toBeGreaterThan(uncommittedRun.finishedAt!.getTime());
      expect(partialRun.finishedAt!.getTime()).toBeGreaterThanOrEqual(providerCompletionAt);
      const completedItems = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, runId)).orderBy(catalogSyncItemsTable.id);
      expect(completedItems).toEqual(progressedItems);
      expect(runCatalogSyncMock).toHaveBeenCalledTimes(1);
      expect(cleanupSpy).toHaveBeenCalledExactlyOnceWith(catalogSyncRunsTable);
    } finally {
      finishStartup();
      rollbackRecovery();
      resumeProgress();
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

  it("releases its client without starting recovery or changing stale queued work when another worker owns the catalog lock", async () => {
    const [run] = await db.insert(catalogSyncRunsTable).values({
      trigger: "manual", status: "queued",
      createdAt: new Date(Date.now() - STALE_QUEUED_REFRESH_MS - 1_000),
    }).returning();
    createdRunIds.push(run.id);
    const client = await pool.connect();
    try {
      await client.query("select pg_advisory_lock(hashtext('watchtime:catalog-sync'))");
      const recoveryClient = await pool.connect();
      // Keep this distinct session checked out for the ownership probe and
      // deterministic cleanup, while still observing recovery's release call.
      const releaseSpy = vi.spyOn(recoveryClient, "release").mockImplementation(() => {});
      const querySpy = vi.spyOn(recoveryClient, "query");
      const connectSpy = vi.spyOn(pool, "connect").mockImplementationOnce(() => Promise.resolve(recoveryClient));
      const transactionSpy = vi.spyOn(db, "transaction");
      try {
        await expect(recoverInterruptedRuns()).resolves.toBeUndefined();
        expect(connectSpy).toHaveBeenCalledTimes(1);
        expect(querySpy).toHaveBeenNthCalledWith(1,
          "select pg_try_advisory_lock(hashtext('watchtime:catalog-sync')) as locked",
        );
        await expect(querySpy.mock.results[0].value).resolves.toMatchObject({ rows: [{ locked: false }] });
        expect(transactionSpy).not.toHaveBeenCalled();
        expect(releaseSpy).toHaveBeenCalledTimes(1);
        // A distinct session must still be excluded after recovery's cleanup;
        // probing on the owner would succeed reentrantly and mask a lost lock.
        const lockProbe = await recoveryClient.query<{ locked: boolean }>(
          "select pg_try_advisory_lock(hashtext('watchtime:catalog-sync')) as locked",
        );
        expect(lockProbe.rows[0].locked).toBe(false);
        const ownerUnlock = await client.query<{ unlocked: boolean }>(
          "select pg_advisory_unlock(hashtext('watchtime:catalog-sync')) as unlocked",
        );
        expect(ownerUnlock.rows[0].unlocked).toBe(true);
      } finally {
        transactionSpy.mockRestore();
        connectSpy.mockRestore();
        querySpy.mockRestore();
        releaseSpy.mockRestore();
        try {
          await recoveryClient.query("select pg_advisory_unlock_all()");
        } finally {
          recoveryClient.release();
        }
      }
      const [unchanged] = await db.select().from(catalogSyncRunsTable).where(eq(catalogSyncRunsTable.id, run.id));
      expect(unchanged).toEqual(run);
    } finally {
      try {
        await client.query("select pg_advisory_unlock_all()");
      } finally {
        client.release();
      }
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

  it("recovers newly abandoned runs independently as two workers release their leases separately", async () => {
    const cutoff = new Date(Date.now() - STALE_QUEUED_REFRESH_MS);
    const staleAt = new Date(cutoff.getTime() - 1_000);
    const runs = await db.insert(catalogSyncRunsTable).values([
      { trigger: "manual", status: "queued", createdAt: staleAt },
      { trigger: "manual", status: "running", createdAt: staleAt, startedAt: staleAt },
      { trigger: "manual", status: "running", createdAt: staleAt, startedAt: staleAt },
      { trigger: "manual", status: "succeeded", createdAt: staleAt, startedAt: staleAt, finishedAt: staleAt },
    ]).returning();
    const runIds = runs.map((run) => run.id);
    createdRunIds.push(...runIds);
    const items = await db.insert(catalogSyncItemsTable).values(runs.flatMap((run) =>
      (["queued", "running", "succeeded", "failed"] as const).map((status) => ({
        runId: run.id,
        itemKey: `staggered-ownership-${run.id}-${status}`,
        title: `Staggered ownership ${status}`,
        provider: "TVMaze",
        status,
        startedAt: status === "queued" ? null : staleAt,
        finishedAt: status === "succeeded" || status === "failed" ? staleAt : null,
        error: status === "failed" ? "Saved provider failure" : null,
      })),
    )).returning();
    const readRuns = () => db.select().from(catalogSyncRunsTable)
      .where(inArray(catalogSyncRunsTable.id, runIds)).orderBy(catalogSyncRunsTable.id);
    const readItems = () => db.select().from(catalogSyncItemsTable)
      .where(inArray(catalogSyncItemsTable.runId, runIds)).orderBy(catalogSyncItemsTable.id);
    let previousRuns = await readRuns();
    let previousItems = await readItems();
    const assertRecoveryPass = async (newlyAbandonedIndex: number) => {
      // Different wall-clock times ensure a repeated timestamp write cannot
      // accidentally compare equal to the result saved by the preceding pass.
      const previousFinishedAt = Math.max(
        ...previousRuns.map((run) => run.finishedAt?.getTime() ?? 0),
        ...previousItems.map((item) => item.finishedAt?.getTime() ?? 0),
      );
      await vi.waitFor(() => expect(Date.now()).toBeGreaterThan(previousFinishedAt));
      const passStartedAt = Date.now();
      await recoverInterruptedRuns(cutoff);
      const actualRuns = await readRuns();
      const actualItems = await readItems();
      const newlyAbandonedRun = runs[newlyAbandonedIndex];
      const explanation = newlyAbandonedRun.status === "queued"
        ? "Catalog refresh worker stopped before starting (server restart or database outage); retry the failed titles"
        : "Catalog refresh was interrupted by a server restart";
      expect(actualRuns).toHaveLength(runs.length);
      for (const [index, previous] of previousRuns.entries()) {
        if (previous.id === newlyAbandonedRun.id) {
          expect(actualRuns[index]).toEqual({
            ...previous,
            status: "failed", processedItems: 4, failedItems: 3,
            error: explanation, finishedAt: expect.any(Date),
          });
          expect(actualRuns[index].finishedAt!.getTime()).toBeGreaterThanOrEqual(passStartedAt);
        } else {
          // Includes both still-owned work and already recovered diagnostics,
          // counters and timestamps, plus the previously completed run.
          expect(actualRuns[index]).toEqual(previous);
        }
      }
      expect(actualItems).toHaveLength(items.length);
      for (const [index, previous] of previousItems.entries()) {
        if (previous.runId === newlyAbandonedRun.id && ["queued", "running"].includes(previous.status)) {
          expect(actualItems[index]).toEqual({
            ...previous, status: "failed", error: explanation, finishedAt: expect.any(Date),
          });
          expect(actualItems[index].finishedAt!.getTime()).toBeGreaterThanOrEqual(passStartedAt);
        } else {
          expect(actualItems[index]).toEqual(previous);
        }
      }
      previousRuns = actualRuns;
      previousItems = actualItems;
    };

    // Both owners must remain checked out: returning either session to the
    // pool could let recovery reentrantly acquire that session's worker lease.
    const firstOwner = await pool.connect();
    try {
      const secondOwner = await pool.connect();
      try {
        expect(firstOwner).not.toBe(secondOwner);
        await firstOwner.query(
          "select pg_advisory_lock(hashtext('watchtime:catalog-refresh-worker'), $1)", [runs[0].id],
        );
        await secondOwner.query(
          "select pg_advisory_lock(hashtext('watchtime:catalog-refresh-worker'), $1)", [runs[1].id],
        );

        await assertRecoveryPass(2);

        const firstUnlock = await firstOwner.query<{ unlocked: boolean }>(
          "select pg_advisory_unlock(hashtext('watchtime:catalog-refresh-worker'), $1) as unlocked", [runs[0].id],
        );
        expect(firstUnlock.rows[0].unlocked).toBe(true);
        await assertRecoveryPass(0);

        const secondUnlock = await secondOwner.query<{ unlocked: boolean }>(
          "select pg_advisory_unlock(hashtext('watchtime:catalog-refresh-worker'), $1) as unlocked", [runs[1].id],
        );
        expect(secondUnlock.rows[0].unlocked).toBe(true);
        await assertRecoveryPass(1);
      } finally {
        try {
          await secondOwner.query("select pg_advisory_unlock_all()");
        } finally {
          secondOwner.release();
        }
      }
    } finally {
      try {
        await firstOwner.query("select pg_advisory_unlock_all()");
      } finally {
        firstOwner.release();
      }
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
        processedItems: 4,
        failedItems: 3,
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
      selected: 3, succeeded: 3, episodes: 12, failures: [],
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
      expect(beforeCleanup).toMatchObject({
        status: "succeeded",
        error: null,
        processedItems: 3,
        succeededItems: 3,
        failedItems: 0,
        episodesUpdated: 12,
        finishedAt: expect.any(Date),
      });

      rejectCleanup(cleanupError);
      await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(
        { err: cleanupError }, "unable to prune catalog refresh history",
      ));
      await new Promise<void>((resolve) => setImmediate(resolve));
      const [afterCleanup] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(afterCleanup).toEqual(beforeCleanup);
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      deleteSpy.mockRestore();
      warnSpy.mockRestore();
      runCatalogSyncMock.mockReset();
    }
  });

  it("preserves partial results and their diagnostic when history cleanup rejects", async () => {
    const cleanupError = new Error("history deletion failed");
    const diagnostic = "TVMaze title lookup timed out";
    let rejectCleanup!: (error: Error) => void;
    const cleanupGate = new Promise<never>((_resolve, reject) => {
      rejectCleanup = reject;
    });
    runCatalogSyncMock.mockResolvedValueOnce({
      selected: 3,
      succeeded: 2,
      episodes: 12,
      failures: [{
        key: "tvmaze:partial-cleanup",
        title: "Failed title",
        provider: "TVMaze",
        error: diagnostic,
      }],
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
      expect(beforeCleanup).toMatchObject({
        status: "partial",
        error: diagnostic,
        processedItems: 3,
        succeededItems: 2,
        failedItems: 1,
        episodesUpdated: 12,
        finishedAt: expect.any(Date),
      });

      rejectCleanup(cleanupError);
      await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(
        { err: cleanupError }, "unable to prune catalog refresh history",
      ));
      await new Promise<void>((resolve) => setImmediate(resolve));
      const [afterCleanup] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, runId));
      expect(afterCleanup).toEqual(beforeCleanup);
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
        expect(beforeCleanup).toMatchObject({
          status,
          error: expectedError,
          processedItems: 0,
          succeededItems: 0,
          failedItems: 0,
          episodesUpdated: 0,
          finishedAt: expect.any(Date),
        });
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
        expect(afterCleanup).toEqual(beforeCleanup);
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
