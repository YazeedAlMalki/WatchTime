import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { catalogSyncItemsTable, catalogSyncRunsTable, db } from "@workspace/db";
import { logger } from "./logger";
import { pruneCatalogRefreshHistory, startCatalogRefresh } from "./catalog-refresh";

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
});