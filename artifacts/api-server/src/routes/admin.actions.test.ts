import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  adminAuditLogTable,
  catalogSyncItemsTable,
  catalogSyncRunsTable,
  db,
  feedbackTable,
  titlesTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const startCatalogRefresh = vi.hoisted(() => vi.fn().mockResolvedValue(123));
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

const adminId = "test-admin-actions";
let titleId: number;

beforeAll(async () => {
  await db.insert(usersTable).values({ id: adminId, email: "admin-actions@example.test" }).onConflictDoNothing();
  const [title] = await db.insert(titlesTable).values({ name: "Admin actions test title", type: "movie" }).returning();
  titleId = title.id;
});

afterEach(async () => {
  vi.clearAllMocks();
  await db.delete(adminAuditLogTable).where(eq(adminAuditLogTable.adminId, adminId));
  await db.delete(feedbackTable).where(eq(feedbackTable.userId, adminId));
  await db.delete(catalogSyncRunsTable).where(eq(catalogSyncRunsTable.trigger, "admin-actions-test"));
});

afterAll(async () => {
  await db.delete(titlesTable).where(eq(titlesTable.id, titleId));
  await db.delete(usersTable).where(eq(usersTable.id, adminId));
});

describe("restored admin actions", () => {
  it("lists catalog runs with their failed items and starts a manual run", async () => {
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

    await request(app).post("/api/admin/catalog-refreshes").expect(202, { runId: 123 });
    expect(startCatalogRefresh).toHaveBeenCalledWith("manual");
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

  it("lists feedback from feedback records with the author email", async () => {
    const [feedback] = await db.insert(feedbackTable).values({
      userId: adminId,
      category: "bug",
      message: "A test report",
      status: "new",
    }).returning();
    const list = await request(app).get("/api/admin/feedback?status=new&category=bug").expect(200);
    expect(list.body).toContainEqual(expect.objectContaining({
      id: feedback.id,
      userEmail: "admin-actions@example.test",
      message: "A test report",
    }));
    const filtered = await request(app).get("/api/admin/feedback?status=closed").expect(200);
    expect(filtered.body).not.toContainEqual(expect.objectContaining({ id: feedback.id }));
  });
});