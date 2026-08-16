/**
 * Integration tests: moderation audit log entries are always recorded
 * atomically with the status change they describe.
 *
 * Strategy:
 *  - Mock requireAdmin so tests run without Clerk tokens.
 *  - Use the real database so inserts and selects reflect actual behaviour.
 *  - Happy-path tests assert that a matching audit row exists after each
 *    PATCH action.
 *  - DB-error-path tests simulate a transient audit-log INSERT failure inside
 *    the transaction. Because the audit insert is now inside the same
 *    transaction as the status change, both are rolled back atomically: the
 *    endpoint returns 500 and the entity's status is unchanged — no silent
 *    audit loss is possible.
 */

import { vi, describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";

// ─── Mock auth so requireAdmin just stamps req.userId ───────────────────────
const ADMIN_ID = "test-audit-admin-001";

vi.mock("../middlewares/auth", () => ({
  requireAdmin: (req: any, _res: any, next: any) => {
    req.userId = ADMIN_ID;
    req.isAdmin = true;
    next();
  },
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = ADMIN_ID;
    req.isAdmin = true;
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

// ─── Silence pino logger in tests ────────────────────────────────────────────
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    }),
  },
}));

// ─── Suppress pino-http which reads process.stdout ───────────────────────────
vi.mock("pino-http", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

// ─── Suppress clerkMiddleware / clerkProxyMiddleware ─────────────────────────
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: ADMIN_ID }),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: "admin@test.com" },
        firstName: "Test",
        lastName: "Admin",
      }),
    },
  },
}));

vi.mock("../middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

// ─── Import app + DB AFTER mocks are in place ────────────────────────────────
import supertest from "supertest";
import app from "../app";
import {
  db,
  usersTable,
  titlesTable,
  contributionsTable,
  reportsTable,
  feedbackTable,
  adminAuditLogTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let titleId: number;

/** Find the most-recent audit log row for a given entityId + entityType. */
async function latestAuditRow(entityType: string, entityId: number) {
  const [row] = await db
    .select()
    .from(adminAuditLogTable)
    .where(
      and(
        eq(adminAuditLogTable.entityType, entityType),
        eq(adminAuditLogTable.entityId, entityId),
      ),
    )
    .orderBy(desc(adminAuditLogTable.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Wrap db.transaction so that any tx.insert(adminAuditLogTable) call inside
 * the handler rejects with a simulated transient DB error. Because the audit
 * insert is now inside the same transaction as the status change, both roll
 * back atomically, proving no silent audit loss is possible.
 */
function spyTransactionWithFailingAuditInsert() {
  const realTransaction = db.transaction.bind(db);
  return vi.spyOn(db, "transaction").mockImplementationOnce(
    (fn: Parameters<typeof db.transaction>[0]) =>
      realTransaction((tx) => {
        const wrappedTx = new Proxy(tx, {
          get(target: any, prop: string) {
            if (prop === "insert") {
              return (table: any) => {
                if (table === adminAuditLogTable) {
                  return {
                    values: () =>
                      Promise.reject(new Error("simulated DB overload")),
                  };
                }
                return target.insert(table);
              };
            }
            return typeof target[prop] === "function"
              ? target[prop].bind(target)
              : target[prop];
          },
        });
        return fn(wrappedTx as typeof tx);
      }) as ReturnType<typeof db.transaction>,
  );
}

/** Delete audit rows written during a test (by entity). */
async function cleanAuditRows(entityType: string, entityId: number) {
  await db
    .delete(adminAuditLogTable)
    .where(
      and(
        eq(adminAuditLogTable.entityType, entityType),
        eq(adminAuditLogTable.entityId, entityId),
      ),
    );
}

// ─── Global setup / teardown ─────────────────────────────────────────────────

// Reset all vi.fn() call counts between tests so logger.error assertions
// in error-path tests are not polluted by calls from earlier tests.
beforeEach(() => {
  vi.clearAllMocks();
});

beforeAll(async () => {
  // Ensure the admin user row exists (FK constraint on adminAuditLogTable.adminId).
  // isAdmin: false avoids the partial unique index that allows only one admin row;
  // the middleware mock grants admin access regardless of what the DB says.
  await db
    .insert(usersTable)
    .values({
      id: ADMIN_ID,
      email: "admin@test.com",
      name: "Test Admin",
      isAdmin: false,
    })
    .onConflictDoNothing();

  // Insert a title that contributions/reports can reference.
  const [t] = await db
    .insert(titlesTable)
    .values({
      name: "__audit_test_title__",
      type: "movie",
      popularity: 0,
    })
    .returning();
  titleId = t.id;
});

afterAll(async () => {
  // Clean up the test title (cascades to contributions, reports, safety records).
  await db.delete(titlesTable).where(eq(titlesTable.id, titleId));
  // Clean up the test admin user.
  await db.delete(usersTable).where(eq(usersTable.id, ADMIN_ID));
});

// ─── PATCH /admin/contributions/:id ──────────────────────────────────────────

describe("PATCH /api/admin/contributions/:id — audit log", () => {
  let contributionId: number;

  afterEach(async () => {
    if (contributionId) {
      await cleanAuditRows("contribution", contributionId);
      await db
        .delete(contributionsTable)
        .where(eq(contributionsTable.id, contributionId));
      contributionId = 0;
    }
  });

  it("records an audit row when a contribution is approved", async () => {
    const [c] = await db
      .insert(contributionsTable)
      .values({
        titleId,
        userId: ADMIN_ID,
        category: "violence",
        severity: "mild",
        status: "pending",
      })
      .returning();
    contributionId = c.id;

    const res = await supertest(app)
      .patch(`/api/admin/contributions/${contributionId}`)
      .send({ status: "approved" });

    expect(res.status).toBe(200);

    const audit = await latestAuditRow("contribution", contributionId);
    expect(audit).not.toBeNull();
    expect(audit!.adminId).toBe(ADMIN_ID);
    expect(audit!.action).toBe("approved_contribution");
    expect(audit!.entityType).toBe("contribution");
    expect(audit!.entityId).toBe(contributionId);
  });

  it("records an audit row when a contribution is rejected", async () => {
    const [c] = await db
      .insert(contributionsTable)
      .values({
        titleId,
        userId: ADMIN_ID,
        category: "language",
        severity: "none",
        status: "pending",
      })
      .returning();
    contributionId = c.id;

    const res = await supertest(app)
      .patch(`/api/admin/contributions/${contributionId}`)
      .send({ status: "rejected" });

    expect(res.status).toBe(200);

    const audit = await latestAuditRow("contribution", contributionId);
    expect(audit).not.toBeNull();
    expect(audit!.action).toBe("rejected_contribution");
  });

  it("records an audit row even when the requested status is already set (no-op PATCH)", async () => {
    const [c] = await db
      .insert(contributionsTable)
      .values({
        titleId,
        userId: ADMIN_ID,
        category: "nudity",
        severity: "mild",
        status: "rejected", // already rejected
      })
      .returning();
    contributionId = c.id;

    // PATCH to the same status — a no-op on the safety record side but still
    // a deliberate admin action that must be audited.
    const res = await supertest(app)
      .patch(`/api/admin/contributions/${contributionId}`)
      .send({ status: "rejected" });

    expect(res.status).toBe(200);

    const audit = await latestAuditRow("contribution", contributionId);
    expect(audit).not.toBeNull();
    expect(audit!.action).toBe("rejected_contribution");
    expect(audit!.entityId).toBe(contributionId);
  });

  it("rolls back the status change when the audit-log insert fails (atomicity guarantee)", async () => {
    const [c] = await db
      .insert(contributionsTable)
      .values({
        titleId,
        userId: ADMIN_ID,
        category: "substance_use",
        severity: "moderate",
        status: "pending",
      })
      .returning();
    contributionId = c.id;

    const spy = spyTransactionWithFailingAuditInsert();
    const res = await supertest(app)
      .patch(`/api/admin/contributions/${contributionId}`)
      .send({ status: "flagged" });
    spy.mockRestore();

    // The audit insert is inside the transaction, so a failure rolls back
    // both the audit write and the status change — the endpoint returns 500.
    expect(res.status).toBe(500);

    // The global error handler must have logged the error via pino so the
    // failure is visible in server logs (not silently dropped).
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "unhandled request error",
    );

    // The status must still be "pending" — the rollback preserved consistency.
    const [reloaded] = await db
      .select()
      .from(contributionsTable)
      .where(eq(contributionsTable.id, contributionId));
    expect(reloaded.status).toBe("pending");

    // No orphaned audit row exists.
    const audit = await latestAuditRow("contribution", contributionId);
    expect(audit).toBeNull();
  });
});

// ─── PATCH /admin/reports/:id ─────────────────────────────────────────────────

describe("PATCH /api/admin/reports/:id — audit log", () => {
  let reportId: number;

  afterEach(async () => {
    if (reportId) {
      await cleanAuditRows("report", reportId);
      await db.delete(reportsTable).where(eq(reportsTable.id, reportId));
      reportId = 0;
    }
  });

  it("records an audit row when a report is resolved", async () => {
    const [r] = await db
      .insert(reportsTable)
      .values({
        titleId,
        userId: ADMIN_ID,
        reason: "inaccurate safety data",
        status: "open",
      })
      .returning();
    reportId = r.id;

    const res = await supertest(app)
      .patch(`/api/admin/reports/${reportId}`)
      .send({ status: "resolved" });

    expect(res.status).toBe(200);

    const audit = await latestAuditRow("report", reportId);
    expect(audit).not.toBeNull();
    expect(audit!.adminId).toBe(ADMIN_ID);
    expect(audit!.action).toBe("resolved_report");
    expect(audit!.entityType).toBe("report");
    expect(audit!.entityId).toBe(reportId);
  });

  it("records an audit row when a report is dismissed", async () => {
    const [r] = await db
      .insert(reportsTable)
      .values({
        titleId,
        userId: ADMIN_ID,
        reason: "spam",
        status: "open",
      })
      .returning();
    reportId = r.id;

    const res = await supertest(app)
      .patch(`/api/admin/reports/${reportId}`)
      .send({ status: "dismissed" });

    expect(res.status).toBe(200);

    const audit = await latestAuditRow("report", reportId);
    expect(audit).not.toBeNull();
    expect(audit!.action).toBe("dismissed_report");
  });

  it("rolls back the status change when the audit-log insert fails (atomicity guarantee)", async () => {
    const [r] = await db
      .insert(reportsTable)
      .values({
        titleId,
        userId: ADMIN_ID,
        reason: "wrong rating",
        status: "open",
      })
      .returning();
    reportId = r.id;

    const spy = spyTransactionWithFailingAuditInsert();
    const res = await supertest(app)
      .patch(`/api/admin/reports/${reportId}`)
      .send({ status: "resolved" });
    spy.mockRestore();

    expect(res.status).toBe(500);

    // The global error handler must have logged the error via pino.
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "unhandled request error",
    );

    const [reloaded] = await db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.id, reportId));
    expect(reloaded.status).toBe("open");

    const audit = await latestAuditRow("report", reportId);
    expect(audit).toBeNull();
  });
});

// ─── PATCH /admin/feedback/:id ───────────────────────────────────────────────

describe("PATCH /api/admin/feedback/:id — audit log", () => {
  let feedbackId: number;

  afterEach(async () => {
    if (feedbackId) {
      await cleanAuditRows("feedback", feedbackId);
      await db.delete(feedbackTable).where(eq(feedbackTable.id, feedbackId));
      feedbackId = 0;
    }
  });

  it("records an audit row when feedback is resolved", async () => {
    const [f] = await db
      .insert(feedbackTable)
      .values({
        userId: ADMIN_ID,
        category: "bug",
        message: "Something is broken",
        status: "new",
      })
      .returning();
    feedbackId = f.id;

    const res = await supertest(app)
      .patch(`/api/admin/feedback/${feedbackId}`)
      .send({ status: "resolved" });

    expect(res.status).toBe(200);

    const audit = await latestAuditRow("feedback", feedbackId);
    expect(audit).not.toBeNull();
    expect(audit!.adminId).toBe(ADMIN_ID);
    expect(audit!.action).toBe("feedback_resolved");
    expect(audit!.entityType).toBe("feedback");
    expect(audit!.entityId).toBe(feedbackId);
  });

  it("records an audit row when feedback is closed", async () => {
    const [f] = await db
      .insert(feedbackTable)
      .values({
        userId: ADMIN_ID,
        category: "feature",
        message: "Please add dark mode",
        status: "new",
      })
      .returning();
    feedbackId = f.id;

    const res = await supertest(app)
      .patch(`/api/admin/feedback/${feedbackId}`)
      .send({ status: "closed" });

    expect(res.status).toBe(200);

    const audit = await latestAuditRow("feedback", feedbackId);
    expect(audit).not.toBeNull();
    expect(audit!.action).toBe("feedback_closed");
  });

  it("rolls back the status change when the audit-log insert fails (atomicity guarantee)", async () => {
    const [f] = await db
      .insert(feedbackTable)
      .values({
        userId: ADMIN_ID,
        category: "general",
        message: "General comment",
        status: "new",
      })
      .returning();
    feedbackId = f.id;

    const spy = spyTransactionWithFailingAuditInsert();
    const res = await supertest(app)
      .patch(`/api/admin/feedback/${feedbackId}`)
      .send({ status: "resolved" });
    spy.mockRestore();

    expect(res.status).toBe(500);

    // The global error handler must have logged the error via pino.
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "unhandled request error",
    );

    const [reloaded] = await db
      .select()
      .from(feedbackTable)
      .where(eq(feedbackTable.id, feedbackId));
    expect(reloaded.status).toBe("new");

    const audit = await latestAuditRow("feedback", feedbackId);
    expect(audit).toBeNull();
  });
});
