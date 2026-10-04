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

const sharedEvents = [
  { action: "approve_contribution", entityType: "contribution", entityId: 71001 },
  { action: "resolve_report", entityType: "report", entityId: 72001 },
  { action: "dismiss_report", entityType: "report", entityId: 72002 },
] as const;
let adminARowIds: number[] = [];
let adminBRowIds: number[] = [];

beforeAll(async () => {
  // Clear leftovers from an interrupted prior run for these test-only identities.
  await db.delete(adminAuditLogTable).where(inArray(adminAuditLogTable.adminId, [ADMIN_A_ID, ADMIN_B_ID]));
  await db.delete(usersTable).where(inArray(usersTable.id, [ADMIN_A_ID, ADMIN_B_ID]));

  // This app enforces one current admin at the DB level. The mocked auth
  // middleware authorizes the request while these distinct actor rows exercise
  // the real adminId -> users.email join used by historical audit entries.
  await db.insert(usersTable).values([
    { id: ADMIN_A_ID, email: ADMIN_A_EMAIL, name: "Alpha Admin", isAdmin: false },
    { id: ADMIN_B_ID, email: ADMIN_B_EMAIL, name: "Beta Admin", isAdmin: false },
  ]);

  // Both admins perform the same actions on the same entities. The email
  // filter must distinguish the rows even when entity/action fields cannot.
  const [adminA, adminB] = await Promise.all([
    db.insert(adminAuditLogTable).values(sharedEvents.map((event) => ({
      ...event,
      adminId: ADMIN_A_ID,
      details: { testMarker: "admin-a" },
    }))).returning({ id: adminAuditLogTable.id }),
    db.insert(adminAuditLogTable).values(sharedEvents.map((event) => ({
      ...event,
      adminId: ADMIN_B_ID,
      details: { testMarker: "admin-b" },
    }))).returning({ id: adminAuditLogTable.id }),
  ]);
  adminARowIds = adminA.map((row) => row.id);
  adminBRowIds = adminB.map((row) => row.id);
});

afterAll(async () => {
  await db.delete(adminAuditLogTable).where(inArray(adminAuditLogTable.adminId, [ADMIN_A_ID, ADMIN_B_ID]));
  await db.delete(usersTable).where(inArray(usersTable.id, [ADMIN_A_ID, ADMIN_B_ID]));
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/admin/audit-log?adminEmail — email filter isolation", () => {
  it("exact email match isolates admin A when both admins acted on the same entities", async () => {
    const res = await supertest(app)
      .get(`/api/admin/audit-log?adminEmail=${encodeURIComponent(ADMIN_A_EMAIL)}&limit=50`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(adminARowIds.length);
    expect(res.body.entries).toHaveLength(adminARowIds.length);
    expect(res.body.entries.every((entry: any) => entry.adminEmail === ADMIN_A_EMAIL)).toBe(true);
    expect(res.body.entries.map((entry: any) => entry.id).sort((a: number, b: number) => a - b))
      .toEqual([...adminARowIds].sort((a, b) => a - b));
    expect(res.body.entries.map((entry: any) => entry.id).some((id: number) => adminBRowIds.includes(id))).toBe(false);
  });

  it("case-insensitive partial/domain match returns only the matching admins' rows", async () => {
    // Uppercase substring verifies both ILIKE case-insensitivity and partial matching.
    const res = await supertest(app)
      .get("/api/admin/audit-log?adminEmail=WATCHTIME-TEST.EXAMPLE&limit=50");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(adminARowIds.length + adminBRowIds.length);
    expect(res.body.entries).toHaveLength(adminARowIds.length + adminBRowIds.length);
    expect(res.body.entries.every((entry: any) => entry.adminEmail.toLowerCase().includes("watchtime-test.example"))).toBe(true);
    expect(res.body.entries.map((entry: any) => entry.id).sort((a: number, b: number) => a - b))
      .toEqual([...adminARowIds, ...adminBRowIds].sort((a, b) => a - b));
    for (const entityId of new Set(sharedEvents.map((event) => event.entityId))) {
      const adminsForEntity = res.body.entries
        .filter((entry: any) => entry.entityId === entityId)
        .map((entry: any) => entry.adminEmail)
        .sort();
      expect(adminsForEntity).toEqual([ADMIN_A_EMAIL, ADMIN_B_EMAIL].sort());
    }
  });

  it("non-existent email returns an empty result set", async () => {
    const res = await supertest(app)
      .get("/api/admin/audit-log?adminEmail=absent-audit-admin%40nowhere.invalid&limit=50");

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
