import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { catalogSyncRunsTable, db, pool } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";

vi.mock("../middlewares/auth", () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireAuth: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

import app from "../app";

const createdRunIds: number[] = [];

afterEach(async () => {
  if (createdRunIds.length) {
    await db.delete(catalogSyncRunsTable)
      .where(inArray(catalogSyncRunsTable.id, createdRunIds.splice(0)));
  }
});

describe("GET /api/admin/catalog-refreshes", () => {
  it("distinguishes stale queued work protected by a live worker from abandoned work", async () => {
    const staleCreatedAt = new Date(Date.now() - 10 * 60 * 1000);
    const storedRuns = await db.insert(catalogSyncRunsTable).values([
      { trigger: "manual", status: "queued", createdAt: staleCreatedAt },
      { trigger: "manual", status: "queued", createdAt: staleCreatedAt },
    ]).returning({ id: catalogSyncRunsTable.id });
    createdRunIds.push(...storedRuns.map((run) => run.id));
    const [protectedRun, abandonedRun] = storedRuns;
    const owner = await pool.connect();

    try {
      await owner.query(
        "select pg_advisory_lock(hashtext('watchtime:catalog-refresh-worker'), $1)",
        [protectedRun.id],
      );

      const readHistory = async () => {
        const response = await request(app).get("/api/admin/catalog-refreshes").expect(200);
        return new Map(response.body.map((run: { id: number }) => [run.id, run]));
      };
      let runsById = await readHistory();
      expect(runsById.get(protectedRun.id)).toMatchObject({
        status: "queued",
        queuedWorkerState: "protected",
      });
      expect(runsById.get(abandonedRun.id)).toMatchObject({
        status: "queued",
        queuedWorkerState: "abandoned",
      });

      await owner.query(
        "select pg_advisory_unlock(hashtext('watchtime:catalog-refresh-worker'), $1)",
        [protectedRun.id],
      );
      runsById = await readHistory();
      expect(runsById.get(protectedRun.id)).toMatchObject({
        status: "queued",
        queuedWorkerState: "abandoned",
      });

      await db.update(catalogSyncRunsTable)
        .set({ status: "running" })
        .where(inArray(catalogSyncRunsTable.id, [protectedRun.id]));
      runsById = await readHistory();
      expect(runsById.get(protectedRun.id)).toMatchObject({
        status: "running",
        queuedWorkerState: null,
      });
    } finally {
      await owner.query("select pg_advisory_unlock_all()");
      owner.release();
    }
  });

  it("keeps history visible and safely serializes unusable run timestamps", async () => {
    const startedAt = new Date("2024-03-04T05:06:07.000Z");
    const finishedAt = new Date("2024-03-04T05:08:09.000Z");
    const storedRuns = await db.insert(catalogSyncRunsTable).values([
      {
        trigger: "manual",
        status: "succeeded",
        startedAt,
        finishedAt,
      },
      {
        trigger: "manual",
        status: "failed",
        startedAt,
        finishedAt,
      },
      {
        trigger: "manual",
        status: "failed",
        startedAt,
        finishedAt,
      },
    ]).returning({ id: catalogSyncRunsTable.id });
    createdRunIds.push(...storedRuns.map((run) => run.id));

    await db.execute(sql`
      update catalog_sync_runs
      set started_at = 'infinity'::timestamptz
      where id = ${storedRuns[1].id}
    `);
    await db.execute(sql`
      update catalog_sync_runs
      set finished_at = '275760-09-13 00:00:00.001+00'::timestamptz
      where id = ${storedRuns[2].id}
    `);

    const response = await request(app)
      .get("/api/admin/catalog-refreshes")
      .expect(200);
    const runsById = new Map(
      response.body.map((run: { id: number }) => [run.id, run]),
    );

    expect(runsById.get(storedRuns[0].id)).toMatchObject({
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    });
    expect(runsById.get(storedRuns[1].id)).toMatchObject({
      startedAt: null,
      finishedAt: finishedAt.toISOString(),
    });
    expect(runsById.get(storedRuns[2].id)).toMatchObject({
      startedAt: startedAt.toISOString(),
      finishedAt: null,
    });
  });
});
