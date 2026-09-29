import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  integrationHealthTable,
  safetyRecordsTable,
  titlesTable,
} from "@workspace/db";
import { inArray, sql } from "drizzle-orm";

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
const insertedTitleIds: number[] = [];

afterEach(async () => {
  if (insertedIds.length) {
    await db
      .delete(integrationHealthTable)
      .where(inArray(integrationHealthTable.id, insertedIds.splice(0)));
  }
  if (insertedTitleIds.length) {
    await db
      .delete(titlesTable)
      .where(inArray(titlesTable.id, insertedTitleIds.splice(0)));
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

  it("preserves each missing refresh count as null for partially populated rows", async () => {
    const attemptsOnlyProvider = "Admin history attempts-only regression";
    const successesOnlyProvider = "Admin history successes-only regression";
    const storedRows = await db
      .insert(integrationHealthTable)
      .values([
        {
          provider: attemptsOnlyProvider,
          status: "degraded",
          successRatePercent: 66.7,
          refreshAttempts: 9,
          successfulRefreshes: null,
        },
        {
          provider: successesOnlyProvider,
          status: "healthy",
          successRatePercent: 50,
          refreshAttempts: null,
          successfulRefreshes: 4,
        },
      ])
      .returning({ id: integrationHealthTable.id });
    insertedIds.push(...storedRows.map((row) => row.id));

    const response = await request(app)
      .get("/api/admin/integrations")
      .expect(200);
    const attemptsOnlyHealth = response.body.find(
      (row: { provider: string }) => row.provider === attemptsOnlyProvider,
    );
    const successesOnlyHealth = response.body.find(
      (row: { provider: string }) => row.provider === successesOnlyProvider,
    );

    expect(attemptsOnlyHealth).toMatchObject({
      provider: attemptsOnlyProvider,
      refreshAttempts: 9,
      successfulRefreshes: null,
    });
    expect(successesOnlyHealth).toMatchObject({
      provider: successesOnlyProvider,
      refreshAttempts: null,
      successfulRefreshes: 4,
    });
  });

  it("reports zero and non-zero malformed rating timestamp counts without changing health status", async () => {
    const zeroCountProvider = "Timestamp health zero regression";
    const malformedProvider = "Timestamp health malformed regression";
    const healthRows = await db
      .insert(integrationHealthTable)
      .values([
        { provider: zeroCountProvider, status: "failing" },
        { provider: malformedProvider, status: "healthy", successRatePercent: 97 },
      ])
      .returning({ id: integrationHealthTable.id });
    insertedIds.push(...healthRows.map((row) => row.id));

    const [title] = await db
      .insert(titlesTable)
      .values({
        type: "movie",
        name: "Malformed timestamp count regression",
      })
      .returning({ id: titlesTable.id });
    insertedTitleIds.push(title.id);

    const [rating] = await db
      .insert(safetyRecordsTable)
      .values({
        titleId: title.id,
        sourceName: malformedProvider,
        tier: 2,
        isCommunity: false,
        status: "available",
        items: [],
      })
      .returning({ id: safetyRecordsTable.id });
    await db.execute(sql`
      update safety_records
      set updated_at = 'infinity'::timestamp
      where id = ${rating.id}
    `);

    const response = await request(app)
      .get("/api/admin/integrations")
      .expect(200);
    const zeroCountHealth = response.body.find(
      (row: { provider: string }) => row.provider === zeroCountProvider,
    );
    const malformedHealth = response.body.find(
      (row: { provider: string }) => row.provider === malformedProvider,
    );

    expect(zeroCountHealth).toMatchObject({
      status: "failing",
      malformedRefreshTimestampCount: 0,
    });
    expect(malformedHealth).toMatchObject({
      status: "healthy",
      successRatePercent: 97,
      malformedRefreshTimestampCount: 1,
    });
  });
});