import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, safetySyncRunsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

vi.mock("../middlewares/auth", () => ({
  requireAdmin: (req: any, _res: any, next: any) => {
    req.userId = "test-admin";
    next();
  },
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "test-admin";
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

import app from "../app";

const runIds: number[] = [];

afterEach(async () => {
  if (runIds.length) {
    await db.delete(safetySyncRunsTable).where(inArray(safetySyncRunsTable.id, runIds.splice(0)));
  }
});

describe("admin safety sync status", () => {
  it("returns the latest completed run separately from an active run", async () => {
    const [completed] = await db.insert(safetySyncRunsTable).values({
      provider: "wikidata",
      status: "completed",
      limit: 2,
      offset: 4,
      processed: 2,
      mapped: 1,
      missing: 1,
      errors: 0,
      results: [{
        ok: true,
        titleId: 101,
        titleName: "Saved title",
        externalId: "Q1",
        classifications: 2,
      }],
      startedAt: new Date("2026-09-23T10:00:00.000Z"),
      completedAt: new Date("2026-09-23T10:01:00.000Z"),
      createdAt: new Date("2026-09-23T10:01:00.000Z"),
    }).returning();
    const [running] = await db.insert(safetySyncRunsTable).values({
      provider: "does_the_dog_die",
      status: "running",
      limit: 3,
      offset: 6,
      startedAt: new Date("2026-09-23T10:02:00.000Z"),
      createdAt: new Date("2026-09-23T10:02:00.000Z"),
    }).returning();
    runIds.push(completed.id, running.id);

    const response = await request(app).get("/api/admin/content/refresh-batch").expect(200);

    expect(response.body.lastCompleted).toMatchObject({
      id: completed.id,
      provider: "wikidata",
      status: "completed",
      nextOffset: 6,
      mapped: 1,
      missing: 1,
    });
    expect(response.body.lastCompleted.results).toHaveLength(1);
    expect(response.body.running).toMatchObject({
      id: running.id,
      provider: "does_the_dog_die",
      status: "running",
      offset: 6,
      nextOffset: 6,
      completedAt: null,
    });
  });

  it("returns a bounded history of completed and failed batches by completion time", async () => {
    const [olderCompletion] = await db.insert(safetySyncRunsTable).values({
      provider: "does_the_dog_die",
      status: "completed",
      limit: 5,
      offset: 10,
      processed: 4,
      mapped: 2,
      missing: 1,
      errors: 1,
      startedAt: new Date("2026-09-23T09:55:00.000Z"),
      completedAt: new Date("2026-09-23T10:01:00.000Z"),
      createdAt: new Date("2026-09-23T10:05:00.000Z"),
    }).returning();
    const [newerCompletion] = await db.insert(safetySyncRunsTable).values({
      provider: "wikidata",
      status: "failed",
      limit: 3,
      offset: 14,
      processed: 2,
      mapped: 1,
      missing: 0,
      errors: 1,
      error: "Provider request failed",
      startedAt: new Date("2026-09-23T09:59:00.000Z"),
      completedAt: new Date("2026-09-23T10:02:00.000Z"),
      createdAt: new Date("2026-09-23T10:00:00.000Z"),
    }).returning();
    const [oldestCompletion] = await db.insert(safetySyncRunsTable).values({
      provider: "wikidata",
      status: "completed",
      limit: 1,
      offset: 16,
      processed: 1,
      mapped: 1,
      missing: 0,
      errors: 0,
      startedAt: new Date("2026-09-23T09:50:00.000Z"),
      completedAt: new Date("2026-09-23T10:00:00.000Z"),
      createdAt: new Date("2026-09-23T10:06:00.000Z"),
    }).returning();
    const [running] = await db.insert(safetySyncRunsTable).values({
      provider: "does_the_dog_die",
      status: "running",
      limit: 2,
      offset: 17,
      startedAt: new Date("2026-09-23T10:07:00.000Z"),
    }).returning();
    runIds.push(olderCompletion.id, newerCompletion.id, oldestCompletion.id, running.id);

    const response = await request(app)
      .get("/api/admin/content/refresh-batch/history?limit=2")
      .expect(200);

    expect(response.body).toHaveLength(2);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: newerCompletion.id,
        provider: "wikidata",
        status: "failed",
        completedAt: "2026-09-23T10:02:00.000Z",
        mapped: 1,
        missing: 0,
        errors: 1,
        nextOffset: 16,
        error: "Provider request failed",
      }),
      expect.objectContaining({
        id: olderCompletion.id,
        provider: "does_the_dog_die",
        status: "completed",
        completedAt: "2026-09-23T10:01:00.000Z",
        mapped: 2,
        missing: 1,
        errors: 1,
        nextOffset: 14,
      }),
    ]);
    expect(response.body[0]).not.toHaveProperty("results");
  });

  it("rejects history limits outside the supported range", async () => {
    await request(app)
      .get("/api/admin/content/refresh-batch/history?limit=51")
      .expect(400);
  });
});