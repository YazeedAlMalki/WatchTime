import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  adminAuditLogTable,
  catalogSyncItemsTable,
  catalogSyncRunsTable,
  contributionsTable,
  db,
  feedbackTable,
  reportsTable,
  safetyRecordsTable,
  titlesTable,
  usersTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

const startCatalogRefresh = vi.hoisted(() => vi.fn());
const retryFailedCatalogTitles = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const refreshWikidataTitle = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, titleId: 1 }));
const refreshDoesTheDogDieTitle = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, titleId: 1 }));

vi.mock("../lib/catalog-refresh", () => ({ startCatalogRefresh, retryFailedCatalogTitles }));
vi.mock("../lib/wikidata", () => ({
  refreshWikidataTitle,
  refreshWikidataBatch: vi.fn(),
}));
vi.mock("../lib/does-the-dog-die", () => ({
  refreshDoesTheDogDieTitle,
  refreshDoesTheDogDieBatch: vi.fn(),
}));
vi.mock("../middlewares/auth", () => ({
  requireAdmin: (req: any, _res: any, next: any) => {
    req.userId = "test-admin-actions";
    next();
  },
  requireAuth: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

import app from "../app";
import type { startCatalogRefresh as startCatalogRefreshImpl } from "../lib/catalog-refresh";

startCatalogRefresh.mockImplementation(async (
  _trigger: string,
  _items: unknown,
  beforeStart: Parameters<typeof startCatalogRefreshImpl>[2],
) => {
  if (beforeStart) await db.transaction((tx) => beforeStart(tx, 123));
  return 123;
});

const adminId = "test-admin-actions";
let titleId: number;
let reportIds: number[] = [];

beforeAll(async () => {
  await db.insert(usersTable).values({ id: adminId, email: "admin-actions@example.test" }).onConflictDoNothing();
  const [title] = await db.insert(titlesTable).values({ name: "Admin actions test title", type: "movie" }).returning();
  titleId = title.id;
});

afterEach(async () => {
  vi.clearAllMocks();
  await db.delete(adminAuditLogTable).where(eq(adminAuditLogTable.adminId, adminId));
  await db.delete(feedbackTable).where(eq(feedbackTable.userId, adminId));
  await db.delete(contributionsTable).where(eq(contributionsTable.userId, adminId));
  await db.delete(safetyRecordsTable).where(eq(safetyRecordsTable.titleId, titleId));
  if (reportIds.length) {
    await db.delete(reportsTable).where(inArray(reportsTable.id, reportIds));
    reportIds = [];
  }
  await db.delete(catalogSyncRunsTable).where(eq(catalogSyncRunsTable.trigger, "admin-actions-test"));
});

afterAll(async () => {
  await db.delete(titlesTable).where(eq(titlesTable.id, titleId));
  await db.delete(usersTable).where(eq(usersTable.id, adminId));
});

describe("restored admin actions", () => {
  it("lists catalog runs with their failed items", async () => {
    const [run] = await db.insert(catalogSyncRunsTable).values({
      trigger: "admin-actions-test",
      status: "partial",
      failedItems: 1,
    }).returning();
    await db.insert(catalogSyncItemsTable).values({
      runId: run.id,
      itemKey: "admin-actions-item",
      title: "Missing episode",
      provider: "TVMaze",
      status: "failed",
      error: "Unavailable",
    });

    const list = await request(app).get("/api/admin/catalog-refreshes").expect(200);
    expect(list.body.find((row: { id: number }) => row.id === run.id)).toMatchObject({
      trigger: "admin-actions-test",
      failedItems: 1,
      failures: [{ title: "Missing episode", provider: "TVMaze", error: "Unavailable" }],
    });
  });

  it("starts a manual run with an audit prerequisite", async () => {
    await request(app).post("/api/admin/catalog-refreshes").expect(202, { runId: 123 });
    expect(startCatalogRefresh).toHaveBeenCalledWith("manual", undefined, expect.any(Function));
    expect(retryFailedCatalogTitles).not.toHaveBeenCalled();
    const audit = await db.select().from(adminAuditLogTable)
      .where(eq(adminAuditLogTable.adminId, adminId));
    expect(audit).toEqual([expect.objectContaining({ action: "start_catalog_refresh", entityId: 123 })]);
  });

  it("refreshes one title with the selected provider instead of running a batch", async () => {
    const [record] = await db.insert(safetyRecordsTable).values({
      titleId,
      sourceName: "Wikidata",
      status: "available",
      isCommunity: false,
      url: "https://www.wikidata.org/wiki/Qadmin-actions-refresh",
      updatedAt: new Date("2026-10-01T00:00:00.000Z"),
      items: [{ category: "MPAA", label: "PG-13", score: null, maxScore: null, description: null }],
    }).returning({ id: safetyRecordsTable.id });
    await db.update(safetyRecordsTable)
      .set({ updatedAt: sql`'infinity'::timestamp` })
      .where(eq(safetyRecordsTable.id, record.id));
    refreshWikidataTitle.mockImplementationOnce(async () => {
      await db.update(safetyRecordsTable)
        .set({ updatedAt: new Date("2026-10-21T00:00:00.000Z") })
        .where(eq(safetyRecordsTable.id, record.id));
      return { ok: true, titleId };
    });

    await request(app).post(`/api/admin/content/${titleId}/refresh`)
      .send({ provider: "wikidata" }).expect(200, { ok: true, titleId });
    expect(refreshWikidataTitle).toHaveBeenCalledWith(titleId);
    expect(refreshDoesTheDogDieTitle).not.toHaveBeenCalled();
    const review = await request(app)
      .get(`/api/admin/content?q=Admin+actions+test+title&region=US&malformedRefreshTimestamp=true&malformedRefreshTimestampProvider=Wikidata`)
      .expect(200);
    expect(review.body).toEqual([]);
    await request(app).post("/api/admin/content/0/refresh").expect(400);
  });

  it("paginates reports after applying status filters with a stable order", async () => {
    const createdAt = new Date("2099-01-01T00:00:00.000Z");
    const inserted = await db.insert(reportsTable).values([
      { userId: adminId, titleId, reason: "wrong_title", status: "dismissed", createdAt },
      { userId: adminId, titleId, reason: "wrong_rating", status: "dismissed", createdAt },
      { userId: adminId, titleId, reason: "incorrect_info", status: "open", createdAt },
      { userId: adminId, titleId, reason: "outdated_info", status: "dismissed", createdAt },
    ]).returning();
    reportIds = inserted.map(({ id }) => id);

    const firstPage = await request(app)
      .get("/api/admin/reports?status=dismissed&limit=1&offset=0").expect(200);
    const secondPage = await request(app)
      .get("/api/admin/reports?status=dismissed&limit=1&offset=1").expect(200);
    const thirdPage = await request(app)
      .get("/api/admin/reports?status=dismissed&limit=1&offset=2").expect(200);

    const unfiltered = await request(app).get("/api/admin/reports").expect(200);
    const dismissedFixtureIds = inserted
      .filter(({ status }) => status === "dismissed")
      .map(({ id }) => id)
      .sort((a, b) => b - a);
    expect([firstPage.body[0].id, secondPage.body[0].id, thirdPage.body[0].id])
      .toEqual(dismissedFixtureIds);
    expect([firstPage, secondPage, thirdPage].every(({ body }) =>
      body.length === 1 && body[0].status === "dismissed")).toBe(true);
    const fixtureIds = new Set(reportIds);
    expect(unfiltered.body.filter((row: { id: number }) => fixtureIds.has(row.id))
      .map((row: { id: number }) => row.id).sort((a: number, b: number) => a - b))
      .toEqual([...fixtureIds].sort((a, b) => a - b));
    expect(firstPage.body[0]).toMatchObject({
      id: dismissedFixtureIds[0],
      titleId,
      titleName: "Admin actions test title",
      status: "dismissed",
    });
  });

  it("filters and paginates feedback by status and category", async () => {
    const createdAt = new Date("2099-01-01T00:00:00.000Z");
    const inserted = await db.insert(feedbackTable).values([
      { userId: adminId, category: "bug", message: "new bug one", status: "new", createdAt },
      { userId: adminId, category: "feature", message: "new feature", status: "new", createdAt },
      { userId: adminId, category: "bug", message: "closed bug", status: "closed", createdAt },
      { userId: adminId, category: "feature", message: "closed feature", status: "closed", createdAt },
      { userId: adminId, category: "bug", message: "new bug two", status: "new", createdAt },
    ]).returning();
    const ids = Object.fromEntries(inserted.map((feedback) => [feedback.message, feedback.id]));
    const fixtureIds = new Set(inserted.map(({ id }) => id));
    const listIds = (body: Array<{ id: number }>) => body.map(({ id }) => id).sort((a, b) => a - b);
    const fixtureListIds = (body: Array<{ id: number }>) =>
      listIds(body.filter(({ id }) => fixtureIds.has(id)));

    const byStatus = await request(app).get("/api/admin/feedback?status=new").expect(200);
    expect(fixtureListIds(byStatus.body)).toEqual([
      ids["new bug one"], ids["new feature"], ids["new bug two"],
    ].sort((a, b) => a - b));
    expect(byStatus.body.every((row: { status: string }) => row.status === "new")).toBe(true);

    const byCategory = await request(app).get("/api/admin/feedback?category=bug").expect(200);
    expect(fixtureListIds(byCategory.body)).toEqual([
      ids["new bug one"], ids["closed bug"], ids["new bug two"],
    ].sort((a, b) => a - b));
    expect(byCategory.body.every((row: { category: string }) => row.category === "bug")).toBe(true);

    const byBoth = await request(app).get("/api/admin/feedback?status=new&category=bug").expect(200);
    expect(byBoth.body).toEqual(expect.arrayContaining([expect.objectContaining({
      id: ids["new bug one"],
      userEmail: "admin-actions@example.test",
      message: "new bug one",
      status: "new",
      category: "bug",
    })]));
    expect(byBoth.body.every((row: { status: string; category: string }) =>
      row.status === "new" && row.category === "bug")).toBe(true);
    expect(fixtureListIds(byBoth.body)).toEqual(
      [ids["new bug one"], ids["new bug two"]].sort((a, b) => a - b),
    );
    const filteredFirstPage = await request(app)
      .get("/api/admin/feedback?status=new&category=bug&limit=1&offset=0").expect(200);
    const filteredSecondPage = await request(app)
      .get("/api/admin/feedback?status=new&category=bug&limit=1&offset=1").expect(200);
    expect([filteredFirstPage.body[0].id, filteredSecondPage.body[0].id])
      .toEqual([ids["new bug two"], ids["new bug one"]]);
    expect([filteredFirstPage, filteredSecondPage].every(({ body }) =>
      body.length === 1 && body[0].status === "new" && body[0].category === "bug")).toBe(true);
  });

  it("bounds contribution pages and filters before paging with deterministic timestamp ties", async () => {
    const createdAt = new Date("2099-01-01T00:00:00.000Z");
    const inserted = await db.insert(contributionsTable).values(
      Array.from({ length: 105 }, (_, index) => ({
        userId: adminId,
        titleId,
        category: "violence" as const,
        severity: "mild" as const,
        status: index % 2 === 0 ? "pending" as const : "approved" as const,
        createdAt,
      })),
    ).returning();
    const descending = [...inserted].sort((a, b) => b.id - a.id);
    const ids = (rows: Array<{ id: number }>) => rows.map(({ id }) => id);

    const defaultPage = await request(app).get("/api/admin/contributions").expect(200);
    expect(ids(defaultPage.body)).toEqual(ids(descending.slice(0, 50)));
    const maxPage = await request(app).get("/api/admin/contributions?limit=100").expect(200);
    expect(ids(maxPage.body)).toEqual(ids(descending.slice(0, 100)));

    const pending = descending.filter(({ status }) => status === "pending");
    const first = await request(app)
      .get("/api/admin/contributions?status=pending&limit=50&offset=0").expect(200);
    const second = await request(app)
      .get("/api/admin/contributions?status=pending&limit=50&offset=50").expect(200);
    expect(ids([...first.body, ...second.body].slice(0, pending.length))).toEqual(ids(pending));
    expect(first.body.every((row: { status: string }) => row.status === "pending")).toBe(true);
    expect(second.body.every((row: { status: string }) => row.status === "pending")).toBe(true);
    expect(first.body[0]).toMatchObject({
      id: pending[0].id,
      titleName: "Admin actions test title",
      createdAt: createdAt.toISOString(),
    });
    const beyondEnd = await request(app)
      .get("/api/admin/contributions?limit=1&offset=1000000").expect(200);
    expect(beyondEnd.body).toEqual([]);
  });

  it.each([
    "limit=0", "limit=101", "limit=-1", "limit=1.5", "limit=nope",
    "offset=-1", "offset=1000001", "offset=0.5", "offset=nope",
    "status=unknown", "status=pending&status=approved", "limit=1&limit=2",
  ])("rejects unsupported contribution filters: %s", async (query) => {
    await request(app).get(`/api/admin/contributions?${query}`).expect(400);
  });

  it("rejects report and feedback pagination outside the supported bounds", async () => {
    await request(app).get("/api/admin/reports?limit=0").expect(400);
    await request(app).get("/api/admin/reports?limit=101").expect(400);
    await request(app).get("/api/admin/feedback?offset=-1").expect(400);
    await request(app).get("/api/admin/feedback?offset=1000001").expect(400);
  });
});
