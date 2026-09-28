import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, integrationHealthTable } from "@workspace/db";
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

const insertedIds: number[] = [];

afterEach(async () => {
  if (insertedIds.length) {
    await db
      .delete(integrationHealthTable)
      .where(inArray(integrationHealthTable.id, insertedIds.splice(0)));
  }
});

describe("GET /api/admin/integrations", () => {
  it("returns persisted refresh counts alongside the rate derived from them", async () => {
    const provider = "Admin history count regression";
    const refreshAttempts = 7;
    const successfulRefreshes = 3;
    const successRatePercent =
      (successfulRefreshes / refreshAttempts) * 100;
    const [stored] = await db
      .insert(integrationHealthTable)
      .values({
        provider,
        status: "degraded",
        successRatePercent,
        refreshAttempts,
        successfulRefreshes,
      })
      .returning({ id: integrationHealthTable.id });
    insertedIds.push(stored.id);

    const response = await request(app)
      .get("/api/admin/integrations")
      .expect(200);
    const health = response.body.find(
      (row: { provider: string }) => row.provider === provider,
    );

    expect(health).toMatchObject({
      provider,
      status: "degraded",
      refreshAttempts,
      successfulRefreshes,
    });
    expect(health.successRatePercent).toBeCloseTo(
      (successfulRefreshes / refreshAttempts) * 100,
    );
  });

  it("preserves null counts for legacy rows", async () => {
    const provider = "Admin history legacy regression";
    const [stored] = await db
      .insert(integrationHealthTable)
      .values({
        provider,
        status: "healthy",
        successRatePercent: 83.3,
        refreshAttempts: null,
        successfulRefreshes: null,
      })
      .returning({ id: integrationHealthTable.id });
    insertedIds.push(stored.id);

    const response = await request(app)
      .get("/api/admin/integrations")
      .expect(200);
    const health = response.body.find(
      (row: { provider: string }) => row.provider === provider,
    );

    expect(health).toMatchObject({
      provider,
      successRatePercent: 83.3,
      refreshAttempts: null,
      successfulRefreshes: null,
    });
  });
});