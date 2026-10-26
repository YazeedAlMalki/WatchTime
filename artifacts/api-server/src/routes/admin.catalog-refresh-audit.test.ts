import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import {
  adminAuditLogTable,
  catalogSyncItemsTable,
  catalogSyncRunsTable,
  db,
  pool,
  usersTable,
} from "@workspace/db";
import { and, eq, getTableName, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

const adminId = "test-catalog-refresh-audit";
const missingAdminId = `test-catalog-refresh-audit-missing-${randomUUID()}`;
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
  await db.delete(adminAuditLogTable).where(inArray(adminAuditLogTable.adminId, [adminId, missingAdminId]));
  if (createdRunIds.length) {
    await db.delete(catalogSyncRunsTable).where(inArray(catalogSyncRunsTable.id, createdRunIds));
    createdRunIds.length = 0;
  }
});

afterAll(async () => {
  await db.delete(usersTable).where(eq(usersTable.id, adminId));
});

describe.each(["manual", "retry"] as const)("%s catalog refresh audit boundary", (trigger) => {
  async function prepareRequest() {
    if (trigger === "manual") {
      return { path: "/api/admin/catalog-refreshes", sourceRunId: undefined };
    }
    const sourceRunId = await createSourceRun("failed");
    return { path: `/api/admin/catalog-refreshes/${sourceRunId}/retry`, sourceRunId };
  }

  it("rolls back the run and items without starting work when the audit insert fails", async () => {
    const { path, sourceRunId } = await prepareRequest();
    const realTransaction = db.transaction.bind(db);
    let queuedRunId: number | undefined;
    const transactionSpy = vi.spyOn(db, "transaction");
    transactionSpy.mockImplementationOnce(
      (fn: Parameters<typeof db.transaction>[0]) => realTransaction((tx) => {
        const wrapped = new Proxy(tx, {
          get(target, prop) {
            if (prop === "insert") {
              return (table: unknown) => {
                if (getTableName(table as any) === getTableName(adminAuditLogTable)) {
                  return { values: async (audit: { entityId: number }) => {
                    expect(audit).toMatchObject({
                      adminId,
                      action: trigger === "retry" ? "retry_catalog_refresh" : "start_catalog_refresh",
                      entityType: "catalog_sync",
                      ...(sourceRunId === undefined ? {} : { details: { sourceRunId } }),
                    });
                    queuedRunId = audit.entityId;
                    createdRunIds.push(audit.entityId);
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

    await request(app).post(path).expect(500);
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
    if (sourceRunId !== undefined) {
      const [sourceRun] = await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, sourceRunId));
      expect(sourceRun.status).toBe("failed");
      const [sourceItem] = await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, sourceRunId));
      expect(sourceItem.status).toBe("failed");
    }
  });

  it("rolls back the queue when PostgreSQL rejects the audit's admin foreign key", async () => {
    const { path, sourceRunId } = await prepareRequest();
    const sourceRunsBefore = sourceRunId === undefined ? [] : await db.select()
      .from(catalogSyncRunsTable).where(eq(catalogSyncRunsTable.id, sourceRunId));
    const sourceItemsBefore = sourceRunId === undefined ? [] : await db.select()
      .from(catalogSyncItemsTable).where(eq(catalogSyncItemsTable.runId, sourceRunId));
    expect(await db.select().from(usersTable)
      .where(eq(usersTable.id, missingAdminId))).toEqual([]);

    const realTransaction = db.transaction.bind(db);
    let queuedRunId: number | undefined;
    let auditInsertError: unknown;
    const transactionSpy = vi.spyOn(db, "transaction");
    transactionSpy.mockImplementationOnce(
      (fn: Parameters<typeof db.transaction>[0]) => realTransaction((tx) => {
        const wrapped = new Proxy(tx, {
          get(target, prop) {
            if (prop === "insert") {
              return (table: Parameters<typeof tx.insert>[0]) => {
                if (getTableName(table) === getTableName(adminAuditLogTable)) {
                  return { values: async (audit: typeof adminAuditLogTable.$inferInsert) => {
                    expect(audit).toMatchObject({
                      adminId,
                      action: trigger === "retry" ? "retry_catalog_refresh" : "start_catalog_refresh",
                      entityType: "catalog_sync",
                      ...(sourceRunId === undefined ? {} : { details: { sourceRunId } }),
                    });
                    queuedRunId = audit.entityId!;
                    createdRunIds.push(queuedRunId);
                    expect(await tx.select().from(catalogSyncRunsTable)
                      .where(eq(catalogSyncRunsTable.id, queuedRunId))).toEqual([
                      expect.objectContaining({ status: "queued", trigger, totalItems: 1 }),
                    ]);
                    expect(await tx.select().from(catalogSyncItemsTable)
                      .where(eq(catalogSyncItemsTable.runId, queuedRunId))).toEqual([
                      expect.objectContaining({
                        itemKey: "catalog-refresh-audit-item",
                        status: "queued",
                      }),
                    ]);
                    // Execute the real INSERT, changing only this request's FK value.
                    // No shared constraint or schema changes are needed to abort the transaction.
                    try {
                      await target.insert(adminAuditLogTable).values({ ...audit, adminId: missingAdminId });
                    } catch (error) {
                      auditInsertError = error;
                      throw error;
                    }
                  } };
                }
                return target.insert(table);
              };
            }
            const value = Reflect.get(target, prop);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return fn(wrapped);
      }) as ReturnType<typeof db.transaction>,
    );

    await request(app).post(path).expect(500);
    expect(auditInsertError).toMatchObject({
      cause: { code: "23503", table: getTableName(adminAuditLogTable) },
    });
    expect(transactionSpy).toHaveBeenCalledOnce();
    expect(queuedRunId).toBeDefined();
    expect(await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, queuedRunId!))).toEqual([]);
    expect(await db.select().from(catalogSyncItemsTable)
      .where(eq(catalogSyncItemsTable.runId, queuedRunId!))).toEqual([]);
    expect(await db.select().from(adminAuditLogTable).where(inArray(
      adminAuditLogTable.adminId, [adminId, missingAdminId],
    ))).toEqual([]);
    expect(await db.select().from(adminAuditLogTable).where(and(
      eq(adminAuditLogTable.entityType, "catalog_sync"),
      eq(adminAuditLogTable.entityId, queuedRunId!),
    ))).toEqual([]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(runCatalogSync).not.toHaveBeenCalled();
    if (sourceRunId !== undefined) {
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, sourceRunId))).toEqual(sourceRunsBefore);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, sourceRunId))).toEqual(sourceItemsBefore);
    }
  });

  it("keeps the request and worker waiting while the audit write is held", async () => {
    const { path, sourceRunId } = await prepareRequest();
    const action = trigger === "retry" ? "retry_catalog_refresh" : "start_catalog_refresh";
    // Reserve a distinct connection before the request opens its transaction.
    const observerClient = await pool.connect();
    const observer = drizzle(observerClient);
    let releaseAudit!: () => void;
    const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve; });
    let auditHeld = false;
    let queuedRunId: number | undefined;
    let requestSettled = false;
    let rowsSeenAtExecution: unknown;
    const realTransaction = db.transaction.bind(db);
    const transactionSpy = vi.spyOn(db, "transaction");
    transactionSpy.mockImplementationOnce(
      (fn: Parameters<typeof db.transaction>[0]) => realTransaction((tx) => {
        const wrapped = new Proxy(tx, {
          get(target, prop) {
            if (prop === "insert") {
              return (table: Parameters<typeof tx.insert>[0]) => {
                if (getTableName(table) === getTableName(adminAuditLogTable)) {
                  return { values: async (audit: typeof adminAuditLogTable.$inferInsert) => {
                    expect(audit).toMatchObject({
                      adminId, action, entityType: "catalog_sync",
                      ...(sourceRunId === undefined ? {} : { details: { sourceRunId } }),
                    });
                    queuedRunId = audit.entityId!;
                    createdRunIds.push(queuedRunId);
                    // Prove the queue exists inside the still-uncommitted transaction.
                    expect(await tx.select().from(catalogSyncRunsTable)
                      .where(eq(catalogSyncRunsTable.id, queuedRunId))).toEqual([
                      expect.objectContaining({ status: "queued", trigger, totalItems: 1 }),
                    ]);
                    expect(await tx.select().from(catalogSyncItemsTable)
                      .where(eq(catalogSyncItemsTable.runId, queuedRunId))).toEqual([
                      expect.objectContaining({ itemKey: "catalog-refresh-audit-item", status: "queued" }),
                    ]);
                    auditHeld = true;
                    await auditGate;
                    await target.insert(adminAuditLogTable).values(audit);
                  } };
                }
                return target.insert(table);
              };
            }
            const value = Reflect.get(target, prop);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return fn(wrapped);
      }) as ReturnType<typeof db.transaction>,
    );
    runCatalogSync.mockImplementationOnce(async () => {
      // Visibility here proves commit preceded worker execution, not just the response.
      rowsSeenAtExecution = {
        runs: await observer.select().from(catalogSyncRunsTable)
          .where(eq(catalogSyncRunsTable.id, queuedRunId!)),
        items: await observer.select().from(catalogSyncItemsTable)
          .where(eq(catalogSyncItemsTable.runId, queuedRunId!)),
        audits: await observer.select().from(adminAuditLogTable).where(and(
          eq(adminAuditLogTable.adminId, adminId),
          eq(adminAuditLogTable.entityId, queuedRunId!),
        )),
      };
      return { selected: 1, succeeded: 1, episodes: 0, failures: [] };
    });
    // Calling .then starts Supertest immediately without awaiting the held response.
    const responsePromise = request(app).post(path).then(
      (response) => { requestSettled = true; return response; },
      (error) => { requestSettled = true; throw error; },
    );

    try {
      await vi.waitFor(() => expect(auditHeld).toBe(true));
      expect(queuedRunId).toBeDefined();
      expect(await observer.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, queuedRunId!))).toEqual([]);
      expect(await observer.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, queuedRunId!))).toEqual([]);
      expect(await observer.select().from(adminAuditLogTable).where(and(
        eq(adminAuditLogTable.adminId, adminId),
        eq(adminAuditLogTable.entityId, queuedRunId!),
      ))).toEqual([]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(requestSettled).toBe(false);
      expect(runCatalogSync).not.toHaveBeenCalled();

      releaseAudit();
      const response = await responsePromise;
      expect(response.status).toBe(202);
      expect(response.body.runId).toBe(queuedRunId);
      await vi.waitFor(() => expect(rowsSeenAtExecution).toEqual({
        runs: [expect.objectContaining({ id: queuedRunId, trigger, totalItems: 1 })],
        items: [expect.objectContaining({ runId: queuedRunId, itemKey: "catalog-refresh-audit-item" })],
        audits: [expect.objectContaining({
          adminId, action, entityType: "catalog_sync", entityId: queuedRunId,
          details: sourceRunId === undefined ? null : { sourceRunId },
        })],
      }));
      expect(runCatalogSync).toHaveBeenCalledOnce();
    } finally {
      // Always unblock the transaction and drain detached work before teardown.
      releaseAudit();
      try {
        const response = await responsePromise;
        if (response.status === 202) await waitForFinishedRun(response.body.runId);
      } finally {
        observerClient.release();
      }
    }
  });

  it("starts work only after the matching audit entry is committed", async () => {
    const { path, sourceRunId } = await prepareRequest();
    const action = trigger === "retry" ? "retry_catalog_refresh" : "start_catalog_refresh";
    let auditSeenAtExecution: unknown;
    runCatalogSync.mockImplementationOnce(async () => {
      const [audit] = await db.select().from(adminAuditLogTable).where(and(
        eq(adminAuditLogTable.adminId, adminId),
        eq(adminAuditLogTable.action, action),
      ));
      auditSeenAtExecution = audit;
      return { selected: 1, succeeded: 1, episodes: 0, failures: [] };
    });

    const response = await request(app).post(path).expect(202);
    const runId = response.body.runId as number;
    createdRunIds.push(runId);
    await vi.waitFor(() => expect(auditSeenAtExecution).toMatchObject({
      adminId,
      action,
      entityType: "catalog_sync",
      entityId: runId,
      details: sourceRunId === undefined ? null : { sourceRunId },
    }));
    await waitForFinishedRun(runId);
    expect(runCatalogSync).toHaveBeenCalledOnce();
    expect(runCatalogSync.mock.calls[0][1]).toEqual([
      expect.objectContaining({ key: "catalog-refresh-audit-item" }),
    ]);
    const [run] = await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, runId));
    expect(run).toMatchObject({ trigger, totalItems: 1 });
  });
});

describe("other catalog refresh starts", () => {
  it("returns 409 without auditing or starting work when there are no failed titles", async () => {
    const sourceRunId = await createSourceRun("succeeded");
    const transactionSpy = vi.spyOn(db, "transaction");
    await request(app).post(`/api/admin/catalog-refreshes/${sourceRunId}/retry`)
      .expect(409, { error: "This run has no failed titles to retry" });
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(runCatalogSync).not.toHaveBeenCalled();
    expect(await db.select().from(adminAuditLogTable)
      .where(eq(adminAuditLogTable.adminId, adminId))).toEqual([]);
  });

  it("still starts scheduled refreshes without an audit prerequisite", async () => {
    runCatalogSync.mockResolvedValueOnce({ selected: 0, succeeded: 0, episodes: 0, failures: [] });
    const transactionSpy = vi.spyOn(db, "transaction");
    const runId = await startCatalogRefresh("scheduled", []);
    createdRunIds.push(runId);
    await waitForFinishedRun(runId);
    expect(runCatalogSync).toHaveBeenCalledOnce();
    expect(transactionSpy).toHaveBeenCalledOnce();
    expect(await db.select().from(adminAuditLogTable).where(and(
      eq(adminAuditLogTable.entityType, "catalog_sync"),
      eq(adminAuditLogTable.entityId, runId),
    ))).toEqual([]);
  });
});

async function createSourceRun(status: "failed" | "succeeded") {
  const [run] = await db.insert(catalogSyncRunsTable).values({
    trigger: "manual",
    status,
    totalItems: 1,
    failedItems: status === "failed" ? 1 : 0,
  }).returning();
  createdRunIds.push(run.id);
  await db.insert(catalogSyncItemsTable).values({
    runId: run.id,
    itemKey: "catalog-refresh-audit-item",
    title: "Catalog refresh audit test",
    provider: "TVMaze",
    status,
  });
  return run.id;
}

async function waitForFinishedRun(runId: number) {
  await vi.waitFor(async () => {
    const [run] = await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, runId));
    expect(run.status).toBe("succeeded");
  });
  // Let the detached runner's final history cleanup settle before teardown.
  await new Promise<void>((resolve) => setImmediate(resolve));
}
