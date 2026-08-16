/**
 * Integration tests: GET /api/admin/audit-log?adminEmail=
 *
 * Strategy:
 *  - Two distinct admin users: A and B.
 *  - Insert audit log rows attributed to each directly via the DB.
 *  - Call the GET endpoint and assert the email filter correctly isolates results.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

const ADMIN_A_ID = "test-email-filter-admin-a";
const ADMIN_B_ID = "test-email-filter-admin-b";
const ADMIN_A_EMAIL = "alpha-admin@watchtime-test.example";
const ADMIN_B_EMAIL = "beta-admin@watchtime-test.example";

// ─── Mock auth (requireAdmin admits any request) ─────────────────────────────
vi.mock("../middlewares/auth", () => ({
  requireAdmin: (req: any, _res: any, next: any) => {
    req.userId = ADMIN_A_ID;
    req.isAdmin = true;
    next();
  },
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = ADMIN_A_ID;
    req.isAdmin = true;
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), error: vi.fn(), warn: vi.fn(),
    debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
    child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() }),
  },
}));

vi.mock("pino-http", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: ADMIN_A_ID }),
  clerkClient: {
    users: { getUser: async () => ({ primaryEmailAddress: { emailAddress: ADMIN_A_EMAIL }, firstName: "Alpha", lastName: "Admin" }) },
  },
}));

vi.mock("../middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import supertest from "supertest";
import app from "../app";
import { db, usersTable, adminAuditLogTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ─── Setup / teardown ────────────────────────────────────────────────────────

let auditRowIds: number[] = [];

beforeAll(async () => {
  // Ensure both admin user rows exist.
  await db.insert(usersTable).values([
    { id: ADMIN_A_ID, email: ADMIN_A_EMAIL, name: "Alpha Admin", isAdmin: false },
    { id: ADMIN_B_ID, email: ADMIN_B_EMAIL, name: "Beta Admin", isAdmin: false },
  ]).onConflictDoNothing();

  // Seed 3 rows for admin A and 2 rows for admin B.
  const inserted = await db.insert(adminAuditLogTable).values([
    { adminId: ADMIN_A_ID, action: "approved_contribution", entityType: "contribution", entityId: 1001 },
    { adminId: ADMIN_A_ID, action: "resolved_report",       entityType: "report",       entityId: 1002 },
    { adminId: ADMIN_A_ID, action: "feedback_closed",       entityType: "feedback",     entityId: 1003 },
    { adminId: ADMIN_B_ID, action: "rejected_contribution", entityType: "contribution", entityId: 2001 },
    { adminId: ADMIN_B_ID, action: "dismissed_report",      entityType: "report",       entityId: 2002 },
  ]).returning({ id: adminAuditLogTable.id });

  auditRowIds = inserted.map(r => r.id);
});

afterAll(async () => {
  if (auditRowIds.length) {
    await db.delete(adminAuditLogTable).where(inArray(adminAuditLogTable.id, auditRowIds));
  }
  await db.delete(usersTable).where(inArray(usersTable.id, [ADMIN_A_ID, ADMIN_B_ID]));
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/admin/audit-log?adminEmail — email filter isolation", () => {
  it("exact email match returns only that admin's rows", async () => {
    const res = await supertest(app)
      .get(`/api/admin/audit-log?adminEmail=${encodeURIComponent(ADMIN_A_EMAIL)}&limit=50`);

    expect(res.status).toBe(200);

    const adminEmails = res.body.entries.map((e: any) => e.adminEmail);
    // Every returned row must belong to admin A.
    expect(adminEmails.every((email: string) => email === ADMIN_A_EMAIL)).toBe(true);
    // Admin B's email must not appear.
    expect(adminEmails).not.toContain(ADMIN_B_EMAIL);
    // All 3 of admin A's seeded rows must be present (there may be more from other tests).
    const adminARows = res.body.entries.filter((e: any) => e.adminEmail === ADMIN_A_EMAIL);
    expect(adminARows.length).toBeGreaterThanOrEqual(3);
  });

  it("partial/domain email match returns only rows whose admin email contains the substring", async () => {
    // Both admins share the domain "watchtime-test.example".
    const res = await supertest(app)
      .get("/api/admin/audit-log?adminEmail=watchtime-test.example&limit=50");

    expect(res.status).toBe(200);

    const adminEmails: string[] = res.body.entries.map((e: any) => e.adminEmail);
    // Every returned email must contain the domain substring.
    expect(adminEmails.every(email => email.includes("watchtime-test.example"))).toBe(true);
    // Both admin A and admin B rows should be present.
    expect(adminEmails).toContain(ADMIN_A_EMAIL);
    expect(adminEmails).toContain(ADMIN_B_EMAIL);
  });

  it("non-existent email returns an empty result set", async () => {
    const res = await supertest(app)
      .get("/api/admin/audit-log?adminEmail=nobody%40nowhere.invalid&limit=50");

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });
});

describe("GET /api/admin/audit-log/export — filtered CSV download", () => {
  it("returns CSV with correct headers and only admin A rows when filtered by exact email", async () => {
    const res = await supertest(app)
      .get(`/api/admin/audit-log/export?adminEmail=${encodeURIComponent(ADMIN_A_EMAIL)}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toContain(ADMIN_A_EMAIL);

    const lines = res.text.trim().split("\n");
    // First line is the header.
    expect(lines[0]).toContain("Admin");
    expect(lines[0]).toContain("Action");
    // Remaining lines must all reference admin A's email.
    const dataLines = lines.slice(1);
    expect(dataLines.length).toBeGreaterThanOrEqual(3);
    expect(dataLines.every(line => line.includes(ADMIN_A_EMAIL))).toBe(true);
    expect(dataLines.some(line => line.includes(ADMIN_B_EMAIL))).toBe(false);
  });

  it("returns all rows when no email filter is active", async () => {
    const res = await supertest(app)
      .get("/api/admin/audit-log/export");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    // Filename should not contain an email part.
    expect(res.headers["content-disposition"]).toMatch(/audit-log-\d{4}-\d{2}-\d{2}\.csv/);
  });
});
