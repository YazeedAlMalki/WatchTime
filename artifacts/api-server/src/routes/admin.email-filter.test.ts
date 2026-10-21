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
const STREAM_ADMIN_ID = "test-audit-stream-admin";
const ADMIN_A_EMAIL = "alpha-admin@watchtime-test.example";
const ADMIN_B_EMAIL = "beta-admin@watchtime-test.example";
const STREAM_ADMIN_EMAIL = "large-export@audit-test.invalid";

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
const EXPORT_ACTION = "audit_export_batch";
const STREAM_EXPORT_ACTION = "audit_export_stream_batch";
const EXPORT_DAY = "2026-08-16";
const EXPORT_DAY_START = new Date(`${EXPORT_DAY}T00:00:00.000Z`);
const EXPORT_DAY_END = new Date(`${EXPORT_DAY}T23:59:59.999Z`);
const EXPORT_MATCH_ENTITY_BASE = 81000;
const EXPORT_MATCH_COUNT = 31;
const STREAM_EXPORT_COUNT = 501;
let adminARowIds: number[] = [];
let adminBRowIds: number[] = [];
let exportMatchRowIds: number[] = [];
let streamExportRowIds: number[] = [];

beforeAll(async () => {
  // Clear leftovers from an interrupted prior run for these test-only identities.
  await db.delete(adminAuditLogTable).where(inArray(adminAuditLogTable.adminId, [ADMIN_A_ID, ADMIN_B_ID, STREAM_ADMIN_ID]));
  await db.delete(usersTable).where(inArray(usersTable.id, [ADMIN_A_ID, ADMIN_B_ID, STREAM_ADMIN_ID]));

  // This app enforces one current admin at the DB level. The mocked auth
  // middleware authorizes the request while these distinct actor rows exercise
  // the real adminId -> users.email join used by historical audit entries.
  await db.insert(usersTable).values([
    { id: ADMIN_A_ID, email: ADMIN_A_EMAIL, name: "Alpha Admin", isAdmin: false },
    { id: ADMIN_B_ID, email: ADMIN_B_EMAIL, name: "Beta Admin", isAdmin: false },
    { id: STREAM_ADMIN_ID, email: STREAM_ADMIN_EMAIL, name: "Large Export Admin", isAdmin: false },
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

  const matchingExportRows = Array.from({ length: EXPORT_MATCH_COUNT }, (_, index) => ({
    adminId: ADMIN_A_ID,
    action: EXPORT_ACTION,
    entityType: "content",
    entityId: EXPORT_MATCH_ENTITY_BASE + index,
    details: { testBatch: "matching", index },
    createdAt: new Date(`${EXPORT_DAY}T12:00:00.000Z`),
  }));
  const streamingExportRows = Array.from({ length: STREAM_EXPORT_COUNT }, (_, index) => ({
    adminId: STREAM_ADMIN_ID,
    action: STREAM_EXPORT_ACTION,
    entityType: "content",
    entityId: 83000 + index,
    details: { testBatch: "streaming", index },
    createdAt: new Date(`${EXPORT_DAY}T12:00:00.000Z`),
  }));
  const exportDecoys = [
    {
      adminId: ADMIN_B_ID,
      action: EXPORT_ACTION,
      entityType: "content",
      entityId: 82001,
      details: { testBatch: "different-admin" },
      createdAt: new Date(`${EXPORT_DAY}T12:00:00.000Z`),
    },
    {
      adminId: ADMIN_A_ID,
      action: "different_audit_action",
      entityType: "content",
      entityId: 82002,
      details: { testBatch: "different-action" },
      createdAt: new Date(`${EXPORT_DAY}T12:00:00.000Z`),
    },
    {
      adminId: ADMIN_A_ID,
      action: EXPORT_ACTION,
      entityType: "report",
      entityId: 82003,
      details: { testBatch: "different-entity-type" },
      createdAt: new Date(`${EXPORT_DAY}T12:00:00.000Z`),
    },
    {
      adminId: ADMIN_A_ID,
      action: EXPORT_ACTION,
      entityType: "content",
      entityId: 82004,
      details: { testBatch: "before-date-range" },
      createdAt: new Date(EXPORT_DAY_START.getTime() - 1),
    },
    {
      adminId: ADMIN_A_ID,
      action: EXPORT_ACTION,
      entityType: "content",
      entityId: 82005,
      details: { testBatch: "after-date-range" },
      createdAt: new Date(EXPORT_DAY_END.getTime() + 1),
    },
  ];
  const additionalRows = await db.insert(adminAuditLogTable)
    .values([...matchingExportRows, ...streamingExportRows, ...exportDecoys])
    .returning({
      id: adminAuditLogTable.id,
      adminId: adminAuditLogTable.adminId,
      entityId: adminAuditLogTable.entityId,
      action: adminAuditLogTable.action,
    });
  const exportMatchEntityIds = new Set(
    matchingExportRows.map((row) => row.entityId),
  );
  exportMatchRowIds = additionalRows
    .filter((row) => row.entityId !== null && exportMatchEntityIds.has(row.entityId))
    .map((row) => row.id);
  streamExportRowIds = additionalRows
    .filter((row) => row.action === STREAM_EXPORT_ACTION)
    .map((row) => row.id);
  adminARowIds = [
    ...adminA.map((row) => row.id),
    ...additionalRows.filter((row) => row.adminId === ADMIN_A_ID).map((row) => row.id),
  ];
  adminBRowIds = [
    ...adminB.map((row) => row.id),
    ...additionalRows.filter((row) => row.adminId === ADMIN_B_ID).map((row) => row.id),
  ];
});

afterAll(async () => {
  await db.delete(adminAuditLogTable).where(inArray(adminAuditLogTable.adminId, [ADMIN_A_ID, ADMIN_B_ID, STREAM_ADMIN_ID]));
  await db.delete(usersTable).where(inArray(usersTable.id, [ADMIN_A_ID, ADMIN_B_ID, STREAM_ADMIN_ID]));
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

describe("GET /api/admin/audit-log — pagination", () => {
  it("returns filtered pages without repeating rows and keeps the full matching total", async () => {
    const filters = new URLSearchParams({
      action: EXPORT_ACTION,
      adminEmail: ADMIN_A_EMAIL,
      entityType: "content",
      dateFrom: EXPORT_DAY_START.toISOString(),
      dateTo: EXPORT_DAY_END.toISOString(),
      limit: "10",
    });
    const pages = await Promise.all([0, 10, 20, 30].map(async (offset) => {
      const res = await supertest(app)
        .get(`/api/admin/audit-log?${filters.toString()}&offset=${offset}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(EXPORT_MATCH_COUNT);
      return res.body.entries as Array<{ id: number }>;
    }));

    expect(pages.map((entries) => entries.length)).toEqual([10, 10, 10, 1]);
    const pagedIds = pages.flatMap((entries) => entries.map((entry) => entry.id));
    expect(new Set(pagedIds).size).toBe(EXPORT_MATCH_COUNT);
    expect([...pagedIds].sort((a, b) => a - b)).toEqual(
      [...exportMatchRowIds].sort((a, b) => a - b),
    );
    expect(pagedIds).toEqual([...pagedIds].sort((a, b) => b - a));
  });

  it.each([
    ["limit", "-1"],
    ["limit", "not-a-number"],
    ["limit", "201"],
    ["limit", "9007199254740992"],
    ["offset", "-1"],
    ["offset", "not-a-number"],
    ["offset", "1000001"],
    ["offset", "9007199254740992"],
  ])("rejects invalid %s value %s with a clear client error", async (parameter, value) => {
    const res = await supertest(app)
      .get(`/api/admin/audit-log?${parameter}=${encodeURIComponent(value)}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(new RegExp(`^${parameter} must be an integer`));
  });

  it("preserves defaults and accepts the maximum page size", async () => {
    const [defaultPage, maximumPage] = await Promise.all([
      supertest(app).get("/api/admin/audit-log"),
      supertest(app).get("/api/admin/audit-log?limit=200&offset=0"),
    ]);

    expect(defaultPage.status).toBe(200);
    expect(defaultPage.body.entries).toHaveLength(
      Math.min(defaultPage.body.total, 50),
    );
    expect(maximumPage.status).toBe(200);
    expect(maximumPage.body.entries).toHaveLength(
      Math.min(maximumPage.body.total, 200),
    );
    expect(maximumPage.body.total).toBe(defaultPage.body.total);
  });
});

describe("GET /api/admin/audit-log/export — filtered CSV download", () => {
  it("returns CSV with correct headers and only admin A rows when filtered by exact email", async () => {
    const res = await supertest(app)
      .get(`/api/admin/audit-log/export?adminEmail=${encodeURIComponent(ADMIN_A_EMAIL)}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toContain(
      `audit-log-${ADMIN_A_EMAIL}-${new Date().toISOString().slice(0, 10)}.csv`,
    );

    const lines = res.text.trim().split("\n");
    // First line is the header.
    expect(lines[0]).toContain("Admin");
    expect(lines[0]).toContain("Action");
    // Remaining lines must all reference admin A's email.
    const dataLines = lines.slice(1);
    expect(dataLines).toHaveLength(adminARowIds.length);
    expect(dataLines.every(line => line.includes(ADMIN_A_EMAIL))).toBe(true);
    expect(dataLines.some(line => line.includes(ADMIN_B_EMAIL))).toBe(false);
  });

  it("exports every row matching all active filters, beyond the 25-row screen page", async () => {
    const filters = new URLSearchParams({
      action: EXPORT_ACTION,
      adminEmail: ADMIN_A_EMAIL,
      entityType: "content",
      dateFrom: EXPORT_DAY_START.toISOString(),
      dateTo: EXPORT_DAY_END.toISOString(),
    });
    const res = await supertest(app)
      .get(`/api/admin/audit-log/export?${filters.toString()}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toContain(
      `audit-log-${ADMIN_A_EMAIL}-${new Date().toISOString().slice(0, 10)}.csv`,
    );

    const lines = res.text.trimEnd().split(/\r?\n/);
    const dataLines = lines.slice(1);
    expect(dataLines).toHaveLength(EXPORT_MATCH_COUNT);
    expect(dataLines.every((line) => line.includes(ADMIN_A_EMAIL))).toBe(true);
    expect(dataLines.some((line) => line.includes(ADMIN_B_EMAIL))).toBe(false);
    const exportedIds = dataLines.map((line) => {
      const id = line.match(/^"(\d+)"/)?.[1];
      expect(id).toBeDefined();
      return Number(id);
    });
    expect(exportedIds.sort((a, b) => a - b))
      .toEqual([...exportMatchRowIds].sort((a, b) => a - b));
  });

  it("streams every matching row across multiple batches in stable newest-first order", async () => {
    const filters = new URLSearchParams({
      action: STREAM_EXPORT_ACTION,
      adminEmail: STREAM_ADMIN_EMAIL,
      entityType: "content",
      dateFrom: EXPORT_DAY_START.toISOString(),
      dateTo: EXPORT_DAY_END.toISOString(),
    });
    const res = await supertest(app)
      .get(`/api/admin/audit-log/export?${filters.toString()}`);

    expect(res.status).toBe(200);
    const lines = res.text.trimEnd().split(/\r?\n/);
    expect(lines[0]).toContain("Details");
    const dataLines = lines.slice(1);
    expect(dataLines).toHaveLength(STREAM_EXPORT_COUNT);
    expect(dataLines.every((line) => line.includes(STREAM_ADMIN_EMAIL))).toBe(true);
    const exportedIds = dataLines.map((line) => {
      const id = line.match(/^"(\d+)"/)?.[1];
      expect(id).toBeDefined();
      return Number(id);
    });
    expect(exportedIds).toEqual([...streamExportRowIds].sort((a, b) => b - a));
  });

  it("returns all rows when no email filter is active", async () => {
    const res = await supertest(app)
      .get("/api/admin/audit-log/export");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const contentDisposition = res.headers["content-disposition"];
    expect(contentDisposition).toContain(
      `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    expect(contentDisposition).not.toContain(ADMIN_A_EMAIL);
  });
});
