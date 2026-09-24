import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import request from "supertest";
import { db, safetySyncRunsTable, titlesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const safetyBatchRefreshMock = vi.hoisted(() => vi.fn());
const wikidataBatchRefreshMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/does-the-dog-die", () => ({
  refreshDoesTheDogDieBatch: safetyBatchRefreshMock,
  refreshDoesTheDogDieTitle: vi.fn(),
}));

vi.mock("../lib/wikidata", () => ({
  refreshWikidataBatch: wikidataBatchRefreshMock,
  refreshWikidataTitle: vi.fn(),
}));

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
const titleIds: number[] = [];

afterEach(async () => {
  if (runIds.length) {
    await db.delete(safetySyncRunsTable).where(inArray(safetySyncRunsTable.id, runIds.splice(0)));
  }
  if (titleIds.length) {
    await db.delete(titlesTable).where(inArray(titlesTable.id, titleIds.splice(0)));
  }
});

describe("admin safety sync status", () => {
  it("marks abandoned runs interrupted without hiding the last completed run", async () => {
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
      createdAt: new Date(),
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
    expect(response.body.running).toBeNull();
    expect(response.body.interrupted).toMatchObject({
      id: running.id,
      provider: "does_the_dog_die",
      status: "interrupted",
      offset: 6,
      nextOffset: 6,
      limit: 3,
      completedAt: null,
    });
  });

  it("retries an interrupted run with its saved provider, limit, offset, and catalog snapshot", async () => {
    const catalog = await db
      .select({ id: titlesTable.id })
      .from(titlesTable)
      .orderBy(titlesTable.id);
    const catalogFingerprint = createHash("sha256")
      .update(JSON.stringify(catalog.map(({ id }) => id)))
      .digest("hex");
    const [interrupted] = await db.insert(safetySyncRunsTable).values({
      provider: "wikidata",
      status: "interrupted",
      limit: 2,
      offset: 1,
      catalogFingerprint,
    }).returning();
    runIds.push(interrupted.id);

    const status = await request(app)
      .get("/api/admin/content/refresh-batch")
      .expect(200);
    expect(status.body.interrupted).toMatchObject({
      id: interrupted.id,
      provider: "wikidata",
      limit: 2,
      nextOffset: 1,
      catalogFingerprint,
    });

    wikidataBatchRefreshMock.mockImplementationOnce(
      async ({ limit, offset }: { limit: number; offset: number }) => ({
        offset,
        limit,
        processed: 0,
        results: [],
      }),
    );
    const retried = await request(app)
      .post("/api/admin/content/refresh-batch")
      .send({
        provider: status.body.interrupted.provider,
        limit: status.body.interrupted.limit,
        offset: status.body.interrupted.nextOffset,
        catalogFingerprint: status.body.interrupted.catalogFingerprint,
      })
      .expect(200);
    runIds.push(retried.body.batchId);

    expect(wikidataBatchRefreshMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2, offset: 1 }),
    );
    const [retryRun] = await db
      .select()
      .from(safetySyncRunsTable)
      .where(eq(safetySyncRunsTable.id, retried.body.batchId));
    expect(retryRun).toMatchObject({
      provider: "wikidata",
      limit: 2,
      offset: 1,
      catalogFingerprint,
      status: "completed",
    });
  });

  it("rejects a paused continuation after the catalog changes", async () => {
    const [firstCatalogTitle] = await db
      .select({ id: titlesTable.id })
      .from(titlesTable)
      .orderBy(titlesTable.id)
      .limit(1);
    const firstTestId = (firstCatalogTitle?.id ?? 1) - 3;
    const insertedTitles = await db.insert(titlesTable).values(
      [1, 2, 3].map((index) => ({
        id: firstTestId + index - 1,
        type: "movie" as const,
        name: `__safety_snapshot_resume_test_${index}__`,
        year: null,
        imdbId: null,
        popularity: 0,
      })),
    ).returning({ id: titlesTable.id });
    const createdIds = insertedTitles.map(({ id }) => id).sort((left, right) => left - right);
    titleIds.push(...createdIds);

    safetyBatchRefreshMock.mockImplementationOnce(
      async ({
        limit,
        offset,
        titleSelection,
      }: {
        limit: number;
        offset: number;
        titleSelection: { id: number; name: string }[];
      }) => ({
        offset,
        limit,
        processed: Math.min(limit, titleSelection.length),
        results: titleSelection.slice(0, limit).map((title) => ({
          ok: false,
          titleId: title.id,
          titleName: title.name,
          status: "missing" as const,
        })),
      }),
    );
    const firstBatch = await request(app)
      .post("/api/admin/content/refresh-batch")
      .send({ provider: "does_the_dog_die", limit: 1, offset: 0 })
      .expect(200);
    runIds.push(firstBatch.body.batchId);
    expect(firstBatch.body.results[0].titleId).toBe(createdIds[0]);
    expect(firstBatch.body.catalogFingerprint).toMatch(/^[a-f0-9]{64}$/);

    await db.delete(titlesTable).where(eq(titlesTable.id, createdIds[0]));
    const continuation = await request(app)
      .post("/api/admin/content/refresh-batch")
      .send({
        provider: "does_the_dog_die",
        limit: 1,
        offset: firstBatch.body.nextOffset,
        catalogFingerprint: firstBatch.body.catalogFingerprint,
      })
      .expect(409);

    expect(continuation.body).toMatchObject({
      code: "catalog_changed",
      error: expect.stringContaining("Restart the safety sync from offset 0"),
    });
    const status = await request(app)
      .get("/api/admin/content/refresh-batch")
      .expect(200);
    expect(status.body.lastCompleted.id).toBe(firstBatch.body.batchId);
    expect(status.body.lastCompleted.catalogFingerprint).toBe(firstBatch.body.catalogFingerprint);
    expect(status.body.lastCompleted.results.map((result: { titleId: number }) => result.titleId))
      .toEqual([createdIds[0]]);
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
      startedAt: new Date("2099-01-01T09:55:00.000Z"),
      completedAt: new Date("2099-01-01T10:01:00.000Z"),
      createdAt: new Date("2099-01-01T10:05:00.000Z"),
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
      startedAt: new Date("2099-01-01T09:59:00.000Z"),
      completedAt: new Date("2099-01-01T10:02:00.000Z"),
      createdAt: new Date("2099-01-01T10:00:00.000Z"),
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
      startedAt: new Date("2099-01-01T09:50:00.000Z"),
      completedAt: new Date("2099-01-01T10:00:00.000Z"),
      createdAt: new Date("2099-01-01T10:06:00.000Z"),
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
        completedAt: "2099-01-01T10:02:00.000Z",
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
        completedAt: "2099-01-01T10:01:00.000Z",
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

  it("keeps a batch active while its request is executing", async () => {
    let releaseBatch!: () => void;
    let markBatchStarted!: () => void;
    const batchStarted = new Promise<void>((resolve) => {
      markBatchStarted = resolve;
    });
    const batchGate = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    wikidataBatchRefreshMock.mockImplementationOnce(async () => {
      markBatchStarted();
      await batchGate;
      return { offset: 0, limit: 2, processed: 0, results: [] };
    });

    const postPromise = request(app)
      .post("/api/admin/content/refresh-batch")
      .send({ provider: "wikidata", limit: 2, offset: 0 })
      .then((response) => response);

    try {
      await batchStarted;
      const response = await request(app)
        .get("/api/admin/content/refresh-batch")
        .expect(200);
      if (Number.isInteger(response.body.running?.id)) {
        runIds.push(response.body.running.id);
      }

      expect(response.body.running).toMatchObject({
        provider: "wikidata",
        status: "running",
        limit: 2,
        offset: 0,
      });
      expect(response.body.interrupted).toBeNull();
    } finally {
      releaseBatch();
    }

    const completedResponse = await postPromise;
    expect(completedResponse.status).toBe(200);
    runIds.push(completedResponse.body.batchId);
  });
});