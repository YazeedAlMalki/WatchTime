import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  integrationHealthTable,
  safetyRecordsTable,
  titlesTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

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
    const provider = "Admin history legacy regression";
    const refreshAttempts = 7;
    const successfulRefreshes = 3;
    const successRatePercent =
      (successfulRefreshes / refreshAttempts) * 100;
    const [stored] = await db
      .insert(integrationHealthTable)
      .values({
        provider,
        status: "healthy",
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
      refreshAttempts,
      successfulRefreshes,
    });
    expect(health.successRatePercent).toBeCloseTo(successRatePercent, 5);
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

  it("warns for low accumulated rates across providers with reliable counts, even after recovery", async () => {
    const trackedProviders = [
      "Wikidata",
      "Does the Dog Die?",
      "TVMaze",
      "Wikipedia",
    ];
    const previousRows = await db
      .select()
      .from(integrationHealthTable)
      .where(inArray(integrationHealthTable.provider, trackedProviders));
    await db
      .delete(integrationHealthTable)
      .where(inArray(integrationHealthTable.provider, trackedProviders));

    try {
      const recoveredAt = new Date();
      const insertedRows = await db
        .insert(integrationHealthTable)
        .values(
          trackedProviders.map((provider) => ({
            provider,
            status: "healthy",
            lastSyncAt: recoveredAt,
            lastSuccessAt: recoveredAt,
            successRatePercent: 40,
            refreshAttempts: 5,
            successfulRefreshes: 2,
          })),
        )
        .returning({ id: integrationHealthTable.id });

    const response = await request(app)
      .get("/api/admin/integrations")
      .expect(200);
      for (const provider of trackedProviders) {
        const health = response.body.find(
          (row: { provider: string }) => row.provider === provider,
        );
        expect(health).toMatchObject({
          provider,
          status: "healthy",
          refreshAttempts: 5,
          successfulRefreshes: 2,
          lowAccumulatedSuccessRateAlert: true,
        });
      }

      await db
        .update(integrationHealthTable)
        .set({
          successRatePercent: 50,
          refreshAttempts: 6,
          successfulRefreshes: 3,
        })
        .where(eq(integrationHealthTable.provider, "Does the Dog Die?"));

      const recoveredResponse = await request(app)
        .get("/api/admin/integrations")
        .expect(200);
      const recoveredHealth = recoveredResponse.body.find(
        (row: { provider: string }) => row.provider === "Does the Dog Die?",
      );
      const stillLowHealth = recoveredResponse.body.find(
        (row: { provider: string }) => row.provider === "TVMaze",
      );
      expect(recoveredHealth).toMatchObject({
        provider: "Does the Dog Die?",
        status: "healthy",
        successRatePercent: 50,
        refreshAttempts: 6,
        successfulRefreshes: 3,
        lowAccumulatedSuccessRateAlert: false,
      });
      expect(stillLowHealth.lowAccumulatedSuccessRateAlert).toBe(true);

      await db
        .delete(integrationHealthTable)
        .where(inArray(
          integrationHealthTable.id,
          insertedRows.map((row) => row.id),
        ));

      await db.insert(integrationHealthTable).values({
        provider: "Wikidata",
        status: "healthy",
        successRatePercent: 0,
        refreshAttempts: null,
        successfulRefreshes: null,
      });
      const incompleteResponse = await request(app)
        .get("/api/admin/integrations")
        .expect(200);
      const incompleteHealth = incompleteResponse.body.find(
        (row: { provider: string }) => row.provider === "Wikidata",
      );
      expect(incompleteHealth.lowAccumulatedSuccessRateAlert).toBe(false);
    } finally {
      await db
        .delete(integrationHealthTable)
        .where(inArray(integrationHealthTable.provider, trackedProviders));
      if (previousRows.length) {
        await db.insert(integrationHealthTable).values(previousRows);
      }
    }
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

    const titles = await db
      .insert(titlesTable)
      .values([
        {
          type: "movie",
          name: "Malformed timestamp count regression one",
        },
        {
          type: "movie",
          name: "Malformed timestamp count regression two",
        },
      ])
      .returning({ id: titlesTable.id });
    insertedTitleIds.push(...titles.map((title) => title.id));

    const ratings = await db
      .insert(safetyRecordsTable)
      .values(
        titles.map((title) => ({
          titleId: title.id,
          sourceName: malformedProvider,
          tier: 2,
          isCommunity: false,
          status: "available",
          items: [],
        })),
      )
      .returning({ id: safetyRecordsTable.id });
    await db.execute(sql`
      update safety_records
      set updated_at = 'infinity'::timestamp
      where ${inArray(
        safetyRecordsTable.id,
        ratings.map((rating) => rating.id),
      )}
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
      malformedRefreshTimestampCount: 2,
    });

    await db.execute(sql`
      update safety_records
      set updated_at = case
        when id = ${ratings[0].id} then '275760-09-13 00:00:00.000'::timestamp
        else '275760-09-12 23:59:59.999999'::timestamp
      end
      where id in (${ratings[0].id}, ${ratings[1].id})
    `);
    const supportedBoundaryResponse = await request(app)
      .get("/api/admin/integrations")
      .expect(200);
    const supportedBoundaryHealth = supportedBoundaryResponse.body.find(
      (row: { provider: string }) => row.provider === malformedProvider,
    );

    expect(supportedBoundaryHealth).toMatchObject({
      status: "healthy",
      successRatePercent: 97,
      malformedRefreshTimestampCount: 0,
    });

    await db.execute(sql`
      update safety_records
      set updated_at = '275760-09-13 00:00:00.001'::timestamp
      where id = ${ratings[0].id}
    `);
    const outOfRangeResponse = await request(app)
      .get("/api/admin/integrations")
      .expect(200);
    const outOfRangeHealth = outOfRangeResponse.body.find(
      (row: { provider: string }) => row.provider === malformedProvider,
    );

    expect(outOfRangeHealth).toMatchObject({
      status: "healthy",
      successRatePercent: 97,
      malformedRefreshTimestampCount: 1,
    });

    await db
      .update(safetyRecordsTable)
      .set({ updatedAt: new Date("2026-10-04T12:00:00.000Z") })
      .where(eq(safetyRecordsTable.id, ratings[0].id));

    const repairedResponse = await request(app)
      .get("/api/admin/integrations")
      .expect(200);
    const repairedHealth = repairedResponse.body.find(
      (row: { provider: string }) => row.provider === malformedProvider,
    );

    expect(repairedHealth).toMatchObject({
      status: malformedHealth.status,
      successRatePercent: malformedHealth.successRatePercent,
      malformedRefreshTimestampCount: 0,
    });
  });
});
