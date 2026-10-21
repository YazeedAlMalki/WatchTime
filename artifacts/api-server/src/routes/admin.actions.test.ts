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
  titlesTable,
  usersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

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
    refreshWikidataTitle.mockResolvedValueOnce({ ok: true, titleId });
    await request(app).post(`/api/admin/content/${titleId}/refresh`)
      .send({ provider: "wikidata" }).expect(200, { ok: true, titleId });
    expect(refreshWikidataTitle).toHaveBeenCalledWith(titleId);
    expect(refreshDoesTheDogDieTitle).not.toHaveBeenCalled();
    await request(app).post("/api/admin/content/0/refresh").expect(400);
  });

  it("returns only reports matching the requested status", async () => {
    const inserted = await db.insert(feedbackTable).values([
      { userId: adminId, category: "bug", message: "new bug", status: "new" },
      { userId: adminId, category: "feature", message: "new feature", status: "new" },
      { userId: adminId, category: "bug", message: "closed bug", status: "closed" },
      { userId: adminId, category: "feature", message: "closed feature", status: "closed" },
    ]).returning();
    reportIds = inserted.map(({ id }) => id);
    const target = inserted.find(({ status }) => status === "approved")!;

    const response = await request(app).get("/api/admin/contributions?status=approved").expect(200);

    const unfiltered = await request(app).get("/api/admin/contributions").expect(200);
    expect(response.body.map((row: { id: number }) => row.id)).toEqual([target.id]);
    expect(response.body[0]).toMatchObject({
      id: target.id,
      titleId,
      titleName: "Admin actions test title",
      status: "resolved",
    });
  });

  it("lists contributions from the moderation queue with their title and requested status", async () => {
    const inserted = await db.insert(feedbackTable).values([
      { userId: adminId, category: "bug", message: "new bug", status: "new" },
      { userId: adminId, category: "feature", message: "new feature", status: "new" },
      { userId: adminId, category: "bug", message: "closed bug", status: "closed" },
      { userId: adminId, category: "feature", message: "closed feature", status: "closed" },
    ]).returning();
    const ids = Object.fromEntries(inserted.map((feedback) => [feedback.message, feedback.id]));
    const fixtureIds = new Set(inserted.map(({ id }) => id));
    const listIds = (body: Array<{ id: number }>) => body.map(({ id }) => id).sort((a, b) => a - b);
    const fixtureListIds = (body: Array<{ id: number }>) =>
      listIds(body.filter(({ id }) => fixtureIds.has(id)));

    const byStatus = await request(app).get("/api/admin/feedback?status=new").expect(200);
    expect(fixtureListIds(byStatus.body)).toEqual([ids["new bug"], ids["new feature"]].sort((a, b) => a - b));
    expect(byStatus.body.every((row: { status: string }) => row.status === "new")).toBe(true);

    const byCategory = await request(app).get("/api/admin/feedback?category=bug").expect(200);
    expect(fixtureListIds(byCategory.body)).toEqual([ids["new bug"], ids["closed bug"]].sort((a, b) => a - b));
    expect(byCategory.body.every((row: { category: string }) => row.category === "bug")).toBe(true);

    const byBoth = await request(app).get("/api/admin/feedback?status=new&category=bug").expect(200);
    expect(byBoth.body).toEqual(expect.arrayContaining([expect.objectContaining({
      id: ids["new bug"],
      userEmail: "admin-actions@example.test",
      message: "new bug",
      status: "new",
      category: "bug",
    })]));
    expect(byBoth.body.every((row: { status: string; category: string }) =>
      row.status === "new" && row.category === "bug")).toBe(true);
    expect(fixtureListIds(byBoth.body)).toEqual([ids["new bug"]]);
  });
});
