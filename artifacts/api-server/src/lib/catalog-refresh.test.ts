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