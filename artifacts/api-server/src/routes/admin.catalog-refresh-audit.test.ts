import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  adminAuditLogTable,
  catalogSyncItemsTable,
  catalogSyncRunsTable,
  db,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

const adminId = "test-catalog-refresh-audit";
const runCatalogSync = vi.hoisted(() => vi.fn());
vi.mock("../seed-real", () => ({
  sourceItems: [{
    key: "catalog-refresh-audit-item",
    name: "Catalog refresh audit test",
    source: "tvmaze",
    type: "tv",
    popularity: 0,
  }],
  runCatalogSync,
}));
vi.mock("../middlewares/auth", () => ({
  requireAdmin: (req: any, _res: any, next: any) => {
    req.userId = adminId;
    next();
  },
  requireAuth: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

import app from "../app";
import { startCatalogRefresh } from "../lib/catalog-refresh";

const createdRunIds: number[] = [];

beforeAll(async () => {
  await db.insert(usersTable).values({
    id: adminId,
    email: "catalog-refresh-audit@example.test",
  }).onConflictDoNothing();
});

afterEach(async () => {
  vi.restoreAllMocks();
  runCatalogSync.mockReset();
  await db.delete(adminAuditLogTable).where(eq(adminAuditLogTable.adminId, adminId));
  if (createdRunIds.length) {
    await db.delete(catalogSyncRunsTable).where(inArray(catalogSyncRunsTable.id, createdRunIds));
    createdRunIds.length = 0;
  }
});

afterAll(async () => {
  await db.delete(usersTable).where(eq(usersTable.id, adminId));
});

describe("manual catalog refresh audit boundary", () => {
  it("rolls back the run and items without starting work when the audit insert fails", async () => {
    const realTransaction = db.transaction.bind(db);
    let queuedRunId: number | undefined;
    const transactionSpy = vi.spyOn(db, "transaction").mockImplementationOnce(
      (fn: Parameters<typeof db.transaction>[0]) => realTransaction((tx) => {
        const wrapped = new Proxy(tx, {
          get(target, prop) {
            if (prop === "insert") {
              return (table: unknown) => {
                if (table === adminAuditLogTable) {
                  return { values: async (audit: { entityId: number }) => {
                    queuedRunId = audit.entityId;
                    createdRunIds.push(audit.entityId);
                    // Ensure the failure happens after real queue writes.
                    const items = await tx.select().from(catalogSyncItemsTable)
                      .where(eq(catalogSyncItemsTable.runId, audit.entityId));
                    expect(items).toHaveLength(1);
                    throw new Error("simulated audit insert failure");
                  } };
                }
                return target.insert(table as Parameters<typeof tx.insert>[0]);
              };
            }
            const value = Reflect.get(target, prop);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return fn(wrapped);
      }) as ReturnType<typeof db.transaction>,
    );

    await request(app).post("/api/admin/catalog-refreshes").expect(500);
    expect(transactionSpy).toHaveBeenCalledOnce();
    expect(queuedRunId).toBeDefined();
    expect(await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, queuedRunId!))).toEqual([]);
    expect(await db.select().from(catalogSyncItemsTable)
      .where(eq(catalogSyncItemsTable.runId, queuedRunId!))).toEqual([]);
    expect(await db.select().from(adminAuditLogTable)
      .where(eq(adminAuditLogTable.adminId, adminId))).toEqual([]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(runCatalogSync).not.toHaveBeenCalled();
  });

  it("starts work only after the matching audit entry is committed", async () => {
    let auditSeenAtExecution: unknown;
    runCatalogSync.mockImplementationOnce(async () => {
      const [audit] = await db.select().from(adminAuditLogTable).where(and(
        eq(adminAuditLogTable.adminId, adminId),
        eq(adminAuditLogTable.action, "start_catalog_refresh"),
      ));
      auditSeenAtExecution = audit;
      return { selected: 1, succeeded: 1, episodes: 0, failures: [] };
    });

    const response = await request(app).post("/api/admin/catalog-refreshes").expect(202);
    const runId = response.body.runId as number;
    createdRunIds.push(runId);
    await vi.waitFor(() => expect(auditSeenAtExecution).toMatchObject({
      adminId,
      action: "start_catalog_refresh",
      entityType: "catalog_sync",
      entityId: runId,
    }));
    await waitForFinishedRun(runId);
  });

  it("still starts scheduled refreshes without an audit or startup transaction", async () => {
    runCatalogSync.mockResolvedValueOnce({ selected: 0, succeeded: 0, episodes: 0, failures: [] });
    const transactionSpy = vi.spyOn(db, "transaction");
    const runId = await startCatalogRefresh("scheduled", []);
    createdRunIds.push(runId);
    await waitForFinishedRun(runId);
    expect(runCatalogSync).toHaveBeenCalledOnce();
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(await db.select().from(adminAuditLogTable).where(and(
      eq(adminAuditLogTable.entityType, "catalog_sync"),
      eq(adminAuditLogTable.entityId, runId),
    ))).toEqual([]);
  });
});

async function waitForFinishedRun(runId: number) {
  await vi.waitFor(async () => {
    const [run] = await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, runId));
    expect(run.status).toBe("succeeded");
  });
  // Let the detached runner's final history cleanup settle before teardown.
  await new Promise<void>((resolve) => setImmediate(resolve));
}
