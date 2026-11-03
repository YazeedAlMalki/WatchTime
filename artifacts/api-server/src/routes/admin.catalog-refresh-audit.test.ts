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
const isolatedAdminIds: string[] = [];
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
    req.userId = req.header("x-test-admin-id") ?? adminId;
    next();
  },
  requireAuth: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

import app from "../app";
import {
  recoverInterruptedRuns,
  startCatalogRefresh,
  STALE_QUEUED_REFRESH_MS,
} from "../lib/catalog-refresh";

const createdRunIds: number[] = [];

function submitCatalogRefresh(path: string, sourceRunId?: number) {
  const pendingRequest = request(app).post(path);
  return sourceRunId === undefined
    ? pendingRequest
    : pendingRequest.send({ itemKeys: ["catalog-refresh-audit-item"] });
}

beforeAll(async () => {
  await db.insert(usersTable).values({
    id: adminId,
    email: "catalog-refresh-audit@example.test",
  }).onConflictDoNothing();
});

afterEach(async () => {
  vi.restoreAllMocks();
  runCatalogSync.mockReset();
  await db.delete(adminAuditLogTable).where(inArray(
    adminAuditLogTable.adminId, [adminId, missingAdminId, ...isolatedAdminIds],
  ));
  if (createdRunIds.length) {
    await db.delete(catalogSyncRunsTable).where(inArray(catalogSyncRunsTable.id, createdRunIds));
    createdRunIds.length = 0;
  }
  if (isolatedAdminIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, isolatedAdminIds.splice(0)));
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

  it("rolls back the run without auditing or starting work when queued items cannot be inserted", async () => {
    const { path, sourceRunId } = await prepareRequest();
    const sourceRunsBefore = sourceRunId === undefined ? [] : await db.select()
      .from(catalogSyncRunsTable).where(eq(catalogSyncRunsTable.id, sourceRunId));
    const sourceItemsBefore = sourceRunId === undefined ? [] : await db.select()
      .from(catalogSyncItemsTable).where(eq(catalogSyncItemsTable.runId, sourceRunId));
    let queuedRunId: number | undefined;
    let itemInsertAttempts = 0;
    const realTransaction = db.transaction.bind(db);
    const transactionSpy = vi.spyOn(db, "transaction");
    transactionSpy.mockImplementationOnce(
      (fn: Parameters<typeof db.transaction>[0]) => realTransaction((tx) => {
        const wrapped = new Proxy(tx, {
          get(target, prop) {
            if (prop === "insert") {
              return (table: Parameters<typeof tx.insert>[0]) => {
                if (getTableName(table) === getTableName(catalogSyncItemsTable)) {
                  return {
                    values: async (items: Array<{ runId: number }>) => {
                      itemInsertAttempts += 1;
                      expect(items).toHaveLength(1);
                      queuedRunId = items[0].runId;
                      createdRunIds.push(queuedRunId);
                      throw new Error("simulated catalog queue insert failure");
                    },
                  };
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

    await submitCatalogRefresh(path, sourceRunId).expect(500);
    expect(transactionSpy).toHaveBeenCalledOnce();
    expect(itemInsertAttempts).toBe(1);
    expect(queuedRunId).toBeDefined();
    expect(await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, queuedRunId!))).toEqual([]);
    expect(await db.select().from(catalogSyncItemsTable)
      .where(eq(catalogSyncItemsTable.runId, queuedRunId!))).toEqual([]);
    expect(await db.select().from(adminAuditLogTable)
      .where(eq(adminAuditLogTable.adminId, adminId))).toEqual([]);
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

    await submitCatalogRefresh(path, sourceRunId).expect(500);
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

  it(trigger === "retry"
    ? "recovers on the same source after PostgreSQL rejects the retry audit's admin foreign key"
    : "recovers after PostgreSQL rejects the manual audit's admin foreign key", async () => {
    const { path, sourceRunId } = await prepareRequest();
    const runIdsBefore = await db.select({ id: catalogSyncRunsTable.id })
      .from(catalogSyncRunsTable).orderBy(catalogSyncRunsTable.id);
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

    await submitCatalogRefresh(path, sourceRunId).expect(500);
    expect(auditInsertError).toMatchObject({
      cause: { code: "23503", table: getTableName(adminAuditLogTable) },
    });
    expect(transactionSpy).toHaveBeenCalledOnce();
    expect(queuedRunId).toBeDefined();
    expect(await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, queuedRunId!))).toEqual([]);
    expect(await db.select().from(catalogSyncItemsTable)
      .where(eq(catalogSyncItemsTable.runId, queuedRunId!))).toEqual([]);
    expect(await db.select({ id: catalogSyncRunsTable.id }).from(catalogSyncRunsTable)
      .orderBy(catalogSyncRunsTable.id)).toEqual(runIdsBefore);
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

      // Retry the exact same failed source on the same pool, with no interception.
      transactionSpy.mockRestore();
      runCatalogSync.mockResolvedValueOnce({
        selected: 1, succeeded: 1, episodes: 0, failures: [],
      });
      const response = await submitCatalogRefresh(path, sourceRunId);
      if (response.body.runId !== undefined) createdRunIds.push(response.body.runId);
      expect(response.status).toBe(202);
      const recoveredRunId = response.body.runId as number;
      expect(recoveredRunId).toEqual(expect.any(Number));
      expect(recoveredRunId).not.toBe(sourceRunId);
      expect(recoveredRunId).not.toBe(queuedRunId);
      await waitForFinishedRun(recoveredRunId);

      expect(runCatalogSync).toHaveBeenCalledOnce();
      expect(runCatalogSync.mock.calls[0][1]).toEqual([
        expect.objectContaining({ key: "catalog-refresh-audit-item" }),
      ]);
      expect(await db.select({ id: catalogSyncRunsTable.id }).from(catalogSyncRunsTable)
        .orderBy(catalogSyncRunsTable.id)).toEqual([...runIdsBefore, { id: recoveredRunId }]);
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, recoveredRunId))).toEqual([
        expect.objectContaining({ trigger: "retry", status: "succeeded", totalItems: 1 }),
      ]);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, recoveredRunId))).toEqual([
        expect.objectContaining({ itemKey: "catalog-refresh-audit-item" }),
      ]);
      expect(await db.select().from(adminAuditLogTable).where(inArray(
        adminAuditLogTable.adminId, [adminId, missingAdminId],
      ))).toEqual([
        expect.objectContaining({
          adminId,
          action: "retry_catalog_refresh",
          entityType: "catalog_sync",
          entityId: recoveredRunId,
          details: { sourceRunId },
        }),
      ]);
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, sourceRunId))).toEqual(sourceRunsBefore);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, sourceRunId))).toEqual(sourceItemsBefore);
    } else {
      // Retry the manual start on the same pool after removing the FK interception.
      transactionSpy.mockRestore();
      runCatalogSync.mockResolvedValueOnce({
        selected: 1, succeeded: 1, episodes: 0, failures: [],
      });
      const response = await submitCatalogRefresh(path, sourceRunId);
      expect(response.status).toBe(202);
      const recoveredRunId = response.body.runId as number;
      createdRunIds.push(recoveredRunId);
      expect(recoveredRunId).toEqual(expect.any(Number));
      expect(recoveredRunId).not.toBe(queuedRunId);
      await waitForFinishedRun(recoveredRunId);

      expect(runCatalogSync).toHaveBeenCalledOnce();
      expect(runCatalogSync.mock.calls[0][1]).toEqual([
        expect.objectContaining({ key: "catalog-refresh-audit-item" }),
      ]);
      expect(await db.select({ id: catalogSyncRunsTable.id }).from(catalogSyncRunsTable)
        .orderBy(catalogSyncRunsTable.id)).toEqual([...runIdsBefore, { id: recoveredRunId }]);
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, recoveredRunId))).toEqual([
        expect.objectContaining({ trigger: "manual", status: "succeeded", totalItems: 1 }),
      ]);
      expect(await db.select().from(adminAuditLogTable).where(inArray(
        adminAuditLogTable.adminId, [adminId, missingAdminId],
      ))).toEqual([
        expect.objectContaining({
          adminId,
          action: "start_catalog_refresh",
          entityType: "catalog_sync",
          entityId: recoveredRunId,
        }),
      ]);
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
    const responsePromise = submitCatalogRefresh(path, sourceRunId).then(
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

    const response = await submitCatalogRefresh(path, sourceRunId).expect(202);
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
  it("retries only the selected failed title and preserves the source run", async () => {
    const sourceRunId = await createSourceRunWithItems([
      "catalog-refresh-audit-item",
      "no-longer-in-current-catalog",
    ]);
    const [sourceRunBefore] = await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, sourceRunId));
    const sourceItemsBefore = await db.select().from(catalogSyncItemsTable)
      .where(eq(catalogSyncItemsTable.runId, sourceRunId))
      .orderBy(catalogSyncItemsTable.id);
    runCatalogSync.mockResolvedValueOnce({
      selected: 1, succeeded: 1, episodes: 0, failures: [],
    });

    const response = await request(app)
      .post(`/api/admin/catalog-refreshes/${sourceRunId}/retry`)
      .send({ itemKeys: ["catalog-refresh-audit-item"] })
      .expect(202);
    const retryRunId = response.body.runId as number;
    createdRunIds.push(retryRunId);
    await waitForFinishedRun(retryRunId);

    expect(runCatalogSync).toHaveBeenCalledOnce();
    expect(runCatalogSync.mock.calls[0][1]).toEqual([
      expect.objectContaining({ key: "catalog-refresh-audit-item" }),
    ]);
    expect(await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, retryRunId))).toEqual([
      expect.objectContaining({ trigger: "retry", status: "succeeded", totalItems: 1 }),
    ]);
    expect(await db.select().from(catalogSyncItemsTable)
      .where(eq(catalogSyncItemsTable.runId, retryRunId))).toEqual([
      expect.objectContaining({ itemKey: "catalog-refresh-audit-item", status: "queued" }),
    ]);
    expect(await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, sourceRunId))).toEqual([sourceRunBefore]);
    expect(await db.select().from(catalogSyncItemsTable)
      .where(eq(catalogSyncItemsTable.runId, sourceRunId))
      .orderBy(catalogSyncItemsTable.id)).toEqual(sourceItemsBefore);
  });

  it("rejects an empty retry selection before creating a run or audit record", async () => {
    const sourceRunId = await createSourceRun("failed");
    const transactionSpy = vi.spyOn(db, "transaction");
    await request(app)
      .post(`/api/admin/catalog-refreshes/${sourceRunId}/retry`)
      .send({ itemKeys: [] })
      .expect(400, { error: "Select at least one failed title to retry" });
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(runCatalogSync).not.toHaveBeenCalled();
    expect(await db.select().from(adminAuditLogTable)
      .where(eq(adminAuditLogTable.adminId, adminId))).toEqual([]);
  });

  it("does not create an empty retry when selected failures are no longer in the source catalog", async () => {
    const sourceRunId = await createSourceRunWithItems(["no-longer-in-current-catalog"]);
    const transactionSpy = vi.spyOn(db, "transaction");
    await request(app)
      .post(`/api/admin/catalog-refreshes/${sourceRunId}/retry`)
      .send({ itemKeys: ["no-longer-in-current-catalog"] })
      .expect(409, { error: "No selected titles remain failed on this run" });
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(runCatalogSync).not.toHaveBeenCalled();
    expect(await db.select().from(adminAuditLogTable)
      .where(eq(adminAuditLogTable.adminId, adminId))).toEqual([]);
  });

  it("attributes retries of the same failed source to each requesting admin", async () => {
    const [firstAdminId, secondAdminId] = [
      `test-catalog-refresh-retry-first-${randomUUID()}`,
      `test-catalog-refresh-retry-second-${randomUUID()}`,
    ];
    isolatedAdminIds.push(firstAdminId, secondAdminId);
    await db.insert(usersTable).values([
      { id: firstAdminId, email: `${firstAdminId}@example.test` },
      { id: secondAdminId, email: `${secondAdminId}@example.test` },
    ]);

    const sourceRunId = await createSourceRun("failed");
    const [sourceRunBefore] = await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, sourceRunId));
    const sourceItemsBefore = await db.select().from(catalogSyncItemsTable)
      .where(eq(catalogSyncItemsTable.runId, sourceRunId));
    const retryRunIds: number[] = [];

    runCatalogSync
      .mockResolvedValueOnce({ selected: 1, succeeded: 1, episodes: 0, failures: [] })
      .mockResolvedValueOnce({ selected: 1, succeeded: 1, episodes: 0, failures: [] });

    for (const requestingAdminId of [firstAdminId, secondAdminId]) {
      const response = await request(app)
        .post(`/api/admin/catalog-refreshes/${sourceRunId}/retry`)
        .set("x-test-admin-id", requestingAdminId)
        .send({ itemKeys: ["catalog-refresh-audit-item"] })
        .expect(202);
      const retryRunId = response.body.runId as number;
      retryRunIds.push(retryRunId);
      createdRunIds.push(retryRunId);
      expect(retryRunId).not.toBe(sourceRunId);
      await waitForFinishedRun(retryRunId);
    }

    expect(retryRunIds[0]).not.toBe(retryRunIds[1]);
    expect(runCatalogSync).toHaveBeenCalledTimes(2);
    for (const retryRunId of retryRunIds) {
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, retryRunId))).toEqual([
        expect.objectContaining({ trigger: "retry", status: "succeeded", totalItems: 1 }),
      ]);
    }
    expect(await db.select().from(adminAuditLogTable).where(inArray(
      adminAuditLogTable.adminId, [firstAdminId, secondAdminId],
    )).orderBy(adminAuditLogTable.adminId)).toEqual([
      expect.objectContaining({
        adminId: firstAdminId,
        action: "retry_catalog_refresh",
        entityType: "catalog_sync",
        entityId: retryRunIds[0],
        details: { sourceRunId },
      }),
      expect.objectContaining({
        adminId: secondAdminId,
        action: "retry_catalog_refresh",
        entityType: "catalog_sync",
        entityId: retryRunIds[1],
        details: { sourceRunId },
      }),
    ]);
    expect(await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, sourceRunId))).toEqual([sourceRunBefore]);
    expect(await db.select().from(catalogSyncItemsTable)
      .where(eq(catalogSyncItemsTable.runId, sourceRunId))).toEqual(sourceItemsBefore);
  });

  it("returns 409 without auditing or starting work when there are no failed titles", async () => {
    const sourceRunId = await createSourceRun("succeeded");
    const transactionSpy = vi.spyOn(db, "transaction");
    await request(app).post(`/api/admin/catalog-refreshes/${sourceRunId}/retry`)
      .send({ itemKeys: ["catalog-refresh-audit-item"] })
      .expect(409, { error: "No selected titles remain failed on this run" });
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(runCatalogSync).not.toHaveBeenCalled();
    expect(await db.select().from(adminAuditLogTable)
      .where(eq(adminAuditLogTable.adminId, adminId))).toEqual([]);
  });

  it("retries only failed titles from a stale run still owned by a worker", async () => {
    const staleAt = new Date(Date.now() - STALE_QUEUED_REFRESH_MS - 1_000);
    const [sourceRun] = await db.insert(catalogSyncRunsTable).values({
      trigger: "manual",
      status: "running",
      createdAt: staleAt,
      startedAt: staleAt,
      totalItems: 3,
      failedItems: 1,
    }).returning();
    createdRunIds.push(sourceRun.id);
    await db.insert(catalogSyncItemsTable).values([
      {
        runId: sourceRun.id,
        itemKey: "still-active-queued-title",
        title: "Still active queued title",
        provider: "TVMaze",
        status: "queued",
      },
      {
        runId: sourceRun.id,
        itemKey: "still-active-running-title",
        title: "Still active running title",
        provider: "TVMaze",
        status: "running",
        startedAt: staleAt,
      },
      {
        runId: sourceRun.id,
        itemKey: "catalog-refresh-audit-item",
        title: "Catalog refresh audit test",
        provider: "TVMaze",
        status: "failed",
        error: "Original provider failure",
        startedAt: staleAt,
        finishedAt: staleAt,
      },
    ]);
    const [sourceRunBefore] = await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, sourceRun.id));
    const sourceItemsBefore = await db.select().from(catalogSyncItemsTable)
      .where(eq(catalogSyncItemsTable.runId, sourceRun.id)).orderBy(catalogSyncItemsTable.id);
    const worker = await pool.connect();

    try {
      await worker.query(
        "select pg_advisory_lock(hashtext('watchtime:catalog-refresh-worker'), $1)",
        [sourceRun.id],
      );

      // A stale run's queued and running rows remain protected while its worker
      // lease is held; only its separately failed title is eligible for retry.
      await recoverInterruptedRuns(new Date(Date.now() - STALE_QUEUED_REFRESH_MS));
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, sourceRun.id))).toEqual([sourceRunBefore]);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, sourceRun.id))
        .orderBy(catalogSyncItemsTable.id)).toEqual(sourceItemsBefore);

      runCatalogSync.mockResolvedValueOnce({
        selected: 1, succeeded: 1, episodes: 0, failures: [],
      });
      const response = await request(app)
        .post(`/api/admin/catalog-refreshes/${sourceRun.id}/retry`)
        .send({ itemKeys: ["catalog-refresh-audit-item"] })
        .expect(202);
      const retryRunId = response.body.runId as number;
      createdRunIds.push(retryRunId);
      await waitForFinishedRun(retryRunId);

      expect(runCatalogSync).toHaveBeenCalledOnce();
      expect(runCatalogSync.mock.calls[0][1]).toEqual([
        expect.objectContaining({ key: "catalog-refresh-audit-item" }),
      ]);
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, retryRunId))).toEqual([
        expect.objectContaining({ trigger: "retry", status: "succeeded", totalItems: 1 }),
      ]);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, retryRunId))).toEqual([
        expect.objectContaining({
          itemKey: "catalog-refresh-audit-item",
          status: "queued",
        }),
      ]);
      expect(await db.select().from(catalogSyncRunsTable)
        .where(eq(catalogSyncRunsTable.id, sourceRun.id))).toEqual([sourceRunBefore]);
      expect(await db.select().from(catalogSyncItemsTable)
        .where(eq(catalogSyncItemsTable.runId, sourceRun.id))
        .orderBy(catalogSyncItemsTable.id)).toEqual(sourceItemsBefore);
    } finally {
      await worker.query(
        "select pg_advisory_unlock(hashtext('watchtime:catalog-refresh-worker'), $1)",
        [sourceRun.id],
      );
      worker.release();
    }
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

async function createSourceRunWithItems(itemKeys: string[]) {
  const [run] = await db.insert(catalogSyncRunsTable).values({
    trigger: "manual",
    status: "failed",
    totalItems: itemKeys.length,
    failedItems: itemKeys.length,
  }).returning();
  createdRunIds.push(run.id);
  await db.insert(catalogSyncItemsTable).values(itemKeys.map((itemKey, index) => ({
    runId: run.id,
    itemKey,
    title: `Catalog refresh failed title ${index + 1}`,
    provider: "TVMaze",
    status: "failed" as const,
  })));
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
