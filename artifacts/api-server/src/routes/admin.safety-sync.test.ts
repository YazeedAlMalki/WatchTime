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
});