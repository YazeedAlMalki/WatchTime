import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { catalogSyncItemsTable, catalogSyncRunsTable, db, pool } from "@workspace/db";
import { logger } from "./logger";
import { pruneCatalogRefreshHistory, recoverInterruptedRuns, startCatalogRefresh, STALE_QUEUED_REFRESH_MS } from "./catalog-refresh";

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
  it("records and logs a failed startup write without running the sync or rejecting the detached task", async () => {
    const startupError = new Error("unable to mark refresh running");
    const startupSpy = vi.spyOn(db, "transaction").mockRejectedValueOnce(startupError);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const runId = await startCatalogRefresh("manual", []);
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
      });
      expect(runCatalogSyncMock).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandledRejections).toEqual([]);

    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      startupSpy.mockRestore();
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
    const startupSpy = vi.spyOn(db, "transaction").mockRejectedValueOnce(startupError);
    const updateSpy = vi.spyOn(db, "update").mockReturnValueOnce({
      set: () => ({ where: () => Promise.reject(recordError) }),
    } as unknown as ReturnType<typeof db.update>);
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
      updateSpy.mockRestore();
      errorSpy.mockRestore();
      runCatalogSyncMock.mockReset();
    }
  });
});


describe("catalog refresh recovery", () => {
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
    const database = await import("@workspace/db");
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