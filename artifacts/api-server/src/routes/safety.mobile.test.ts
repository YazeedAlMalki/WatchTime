/**
 * Integration tests: safety reports and contributions submitted from the mobile
 * app flow reach the admin moderation queue.
 *
 * Strategy:
 *  - Mock requireAuth so tests run without Clerk tokens (mirrors what the mobile
 *    client does — it sends a Bearer token; here we short-circuit at the
 *    middleware boundary exactly as the audit-log tests do).
 *  - Use the real database so inserts and selects reflect actual behaviour.
 *  - Happy-path tests POST a report / contribution then confirm the record is
 *    visible in the admin GET /api/admin/reports and /api/admin/contributions
 *    queues respectively.
 *  - Rate-limit tests verify the endpoint returns 429 with an error body that
 *    the mobile SafetyReportModal / SafetyContributeModal can detect via
 *    `err?.response?.status === 429`.
 *  - Eligibility tests verify the 403 path for contributions (< 5 watched
 *    items) returns the error body the mobile UI inspects.
 *
 * Mobile Alert copy (confirmed against artifacts/watchtime-mobile/app/title/[id].tsx):
 *   Report 429  → "You've submitted too many reports recently. Please wait before trying again."
 *   Contribute 429 → "You've reached the daily contribution limit. Try again tomorrow."
 *   Contribute 403 → "You need to watch at least 5 titles or episodes before contributing."
 */

import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";

// ─── Stable test identities ──────────────────────────────────────────────────
const MOBILE_USER_ID = "test-mobile-safety-user-001";
const ADMIN_USER_ID = "test-mobile-safety-admin-001";

// ─── Mock auth so requireAuth / requireAdmin just stamp req.userId ────────────
vi.mock("../middlewares/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = MOBILE_USER_ID;
    next();
  },
  requireAdmin: (req: any, _res: any, next: any) => {
    req.userId = ADMIN_USER_ID;
    req.isAdmin = true;
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.userId = MOBILE_USER_ID;
    next();
  },
}));

// ─── Rate-limiter mocks — pass-through by default; individual tests can
//     override with mockImplementationOnce to simulate a 429 response. ────────
const mockReportRateLimit = vi.fn((_req: any, _res: any, next: any) => next());
const mockContributionRateLimit = vi.fn((_req: any, _res: any, next: any) => next());

vi.mock("../middlewares/rateLimiters", () => ({
  safetyReportRateLimit: (req: any, res: any, next: any) =>
    mockReportRateLimit(req, res, next),
  safetyContributionRateLimit: (req: any, res: any, next: any) =>
    mockContributionRateLimit(req, res, next),
  feedbackRateLimit: (_req: any, _res: any, next: any) => next(),
  publicStatsRateLimit: (_req: any, _res: any, next: any) => next(),
  importCreateRateLimit: (_req: any, _res: any, next: any) => next(),
  importConfirmRateLimit: (_req: any, _res: any, next: any) => next(),
}));

// ─── Silence pino logger ─────────────────────────────────────────────────────
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

vi.mock("pino-http", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: MOBILE_USER_ID }),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: "mobile@test.com" },
        firstName: "Mobile",
        lastName: "User",
      }),
    },
  },
}));

vi.mock("../middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

// ─── Import app + DB AFTER mocks ──────────────────────────────────────────────
import supertest from "supertest";
import app from "../app";
import {
  db,
  usersTable,
  titlesTable,
  reportsTable,
  contributionsTable,
  watchedEpisodesTable,
  watchedTitlesTable,
  safetyRecordsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

// ─── Global fixtures ──────────────────────────────────────────────────────────

let titleId: number;
/** Five extra titles used as distinct watched-title entries for the eligibility gate. */
const eligibilityTitleIds: number[] = [];

beforeAll(async () => {
  // Ensure both the mobile user and admin user rows exist.
  await db
    .insert(usersTable)
    .values([
      { id: MOBILE_USER_ID, email: "mobile@test.com", name: "Mobile User", isAdmin: false },
      { id: ADMIN_USER_ID, email: "admin-mobile-test@test.com", name: "Admin User", isAdmin: false },
    ])
    .onConflictDoNothing();

  // Insert the primary test title for reports/contributions.
  const [t] = await db
    .insert(titlesTable)
    .values({ name: "__mobile_safety_test_title__", type: "tv", popularity: 0 })
    .returning();
  titleId = t.id;

  // Insert 5 extra titles that the test user can "watch" to satisfy the
  // eligibility gate (watchedTitlesTable has a unique (userId, titleId) index,
  // so we need distinct titleIds).
  for (let i = 1; i <= 5; i++) {
    const [et] = await db
      .insert(titlesTable)
      .values({ name: `__mobile_safety_elig_title_${i}__`, type: "movie", popularity: 0 })
      .returning();
    eligibilityTitleIds.push(et.id);
  }
});

describe("shared rating-region preference", () => {
  afterEach(async () => {
    await db.delete(safetyRecordsTable).where(eq(safetyRecordsTable.titleId, titleId));
    await db.update(usersTable)
      .set({ preferredRatingRegion: "US" })
      .where(eq(usersTable.id, MOBILE_USER_ID));
  });

  it("persists new country choices across clients and returns sourced or missing ratings", async () => {
    await db.insert(safetyRecordsTable).values({
      titleId,
      sourceName: "Wikidata",
      tier: 2,
      isCommunity: false,
      status: "available",
      items: [
        { category: "MPAA", label: "PG-13", score: null, maxScore: null, description: "US rating" },
        { category: "BBFC", label: "12A", score: null, maxScore: null, description: "GB rating" },
        {
          category: "Australian Classification",
          label: "M",
          score: null,
          maxScore: null,
          description: "AU rating",
        },
      ],
    });
    await db.insert(safetyRecordsTable).values({
      titleId,
      sourceName: "WatchTime Community",
      tier: 1,
      isCommunity: true,
      status: "available",
      items: [{
        category: "BBFC",
        label: "Community guess",
        score: null,
        maxScore: null,
        description: "Untrusted collision",
      }],
    });
    await db.insert(safetyRecordsTable).values({
      titleId,
      seasonNumber: 1,
      sourceName: "Granular Test",
      tier: 1,
      isCommunity: false,
      status: "available",
      items: [{
        category: "Violence",
        label: "Moderate violence",
        score: null,
        maxScore: null,
        severity: "moderate",
        description: "Season-level warning",
      }],
    });

    // Simulate web: save one of the newly supported country choices.
    const update = await supertest(app)
      .patch("/api/me")
      .send({ preferredRatingRegion: "AU" });
    expect(update.status).toBe(200);
    expect(update.body.preferredRatingRegion).toBe("AU");

    // Simulate mobile: a later profile read sees the persisted choice.
    const profile = await supertest(app).get("/api/me");
    expect(profile.status).toBe(200);
    expect(profile.body.preferredRatingRegion).toBe("AU");

    const safety = await supertest(app).get(`/api/safety?titleId=${titleId}&seasonNumber=1`);
    expect(safety.status).toBe(200);
    expect(safety.body.level).toBe("season");
    expect(safety.body.preferredRating).toMatchObject({
      region: "AU",
      system: "Australian Classification",
      label: "M",
      sourceName: "Wikidata",
    });
    const ratingSource = safety.body.sources.find((source: any) => source.sourceName === "Wikidata");
    expect(ratingSource.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "MPAA", label: "PG-13" }),
      expect.objectContaining({ category: "BBFC", label: "12A" }),
      expect.objectContaining({ category: "Australian Classification", label: "M" }),
    ]));

    // Simulate web choosing Brazil, for which this title has no sourced rating.
    const missingUpdate = await supertest(app)
      .patch("/api/me")
      .send({ preferredRatingRegion: "BR" });
    expect(missingUpdate.status).toBe(200);
    expect(missingUpdate.body.preferredRatingRegion).toBe("BR");

    const missingProfile = await supertest(app).get("/api/me");
    expect(missingProfile.status).toBe(200);
    expect(missingProfile.body.preferredRatingRegion).toBe("BR");

    const missing = await supertest(app).get(`/api/safety?titleId=${titleId}`);
    expect(missing.status).toBe(200);
    expect(missing.body.preferredRatingRegion).toBe("BR");
    expect(missing.body.preferredRating).toBeNull();
  });

  it.each([
    ["US", "MPAA", "PG-13"],
    ["GB", "BBFC", "12A"],
    ["DE", "FSK", "12"],
    ["FR", "CNC", "Tous publics"],
    ["AU", "Australian Classification", "M"],
    ["BR", "ClassInd", "14"],
  ])(
    "returns only the mapped official classification for %s",
    async (preferredRatingRegion, expectedSystem, expectedLabel) => {
      const officialItems = [
        ["MPAA", "PG-13"],
        ["BBFC", "12A"],
        ["FSK", "12"],
        ["CNC", "Tous publics"],
        ["Australian Classification", "M"],
        ["ClassInd", "14"],
      ].map(([category, label]) => ({
        category,
        label,
        score: null,
        maxScore: null,
        description: `${category} official rating`,
      }));

      await db.insert(safetyRecordsTable).values([
        {
          titleId,
          sourceName: "Wikidata",
          tier: 2,
          isCommunity: false,
          status: "available",
          items: officialItems,
        },
        {
          titleId,
          sourceName: "WatchTime Community",
          tier: 1,
          isCommunity: true,
          status: "available",
          items: [{
            category: expectedSystem,
            label: "Community collision",
            score: null,
            maxScore: null,
            description: "Must not be selected",
          }],
        },
        {
          titleId,
          sourceName: "Other Ratings Provider",
          tier: 2,
          isCommunity: false,
          status: "available",
          items: [{
            category: expectedSystem,
            label: "Non-Wikidata collision",
            score: null,
            maxScore: null,
            description: "Must not be selected",
          }],
        },
      ]);

      const update = await supertest(app)
        .patch("/api/me")
        .send({ preferredRatingRegion });

      expect(update.status).toBe(200);
      expect(update.body.preferredRatingRegion).toBe(preferredRatingRegion);

      const safety = await supertest(app).get(`/api/safety?titleId=${titleId}`);
      expect(safety.status).toBe(200);
      expect(safety.body.preferredRatingRegion).toBe(preferredRatingRegion);
      expect(safety.body.preferredRating).toEqual({
        region: preferredRatingRegion,
        countryName: expect.any(String),
        system: expectedSystem,
        label: expectedLabel,
        sourceName: "Wikidata",
      });
    },
  );
});

afterAll(async () => {
  // Cascade deletes contributions, reports, and watched records via FK.
  await db.delete(titlesTable).where(eq(titlesTable.id, titleId));
  for (const etId of eligibilityTitleIds) {
    await db.delete(titlesTable).where(eq(titlesTable.id, etId));
  }
  await db.delete(usersTable).where(eq(usersTable.id, MOBILE_USER_ID));
  await db.delete(usersTable).where(eq(usersTable.id, ADMIN_USER_ID));
});

// ─── POST /api/titles/:id/safety/reports ─────────────────────────────────────

describe("POST /api/titles/:id/safety/reports (mobile flow)", () => {
  const createdReportIds: number[] = [];

  afterEach(async () => {
    for (const id of createdReportIds) {
      await db.delete(reportsTable).where(eq(reportsTable.id, id));
    }
    createdReportIds.length = 0;
  });

  it("creates a report and it appears in the admin queue with status 'open'", async () => {
    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/reports`)
      .send({
        reason: "incorrect_info",
        sourceName: "Common Sense Media",
        details: "The violence rating is too low for this episode.",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.titleId).toBe(titleId);
    expect(res.body.reason).toBe("incorrect_info");
    expect(res.body.sourceName).toBe("Common Sense Media");
    expect(res.body.status).toBe("open");
    createdReportIds.push(res.body.id);

    // Verify the record appears in the admin reports queue.
    const adminRes = await supertest(app).get("/api/admin/reports");
    expect(adminRes.status).toBe(200);

    const found = adminRes.body.find((r: any) => r.id === res.body.id);
    expect(found).toBeDefined();
    expect(found.titleId).toBe(titleId);
    expect(found.reason).toBe("incorrect_info");
    expect(found.sourceName).toBe("Common Sense Media");
    expect(found.status).toBe("open");
  });

  it("creates a report with only the required reason field", async () => {
    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/reports`)
      .send({ reason: "wrong_title" });

    expect(res.status).toBe(201);
    expect(res.body.reason).toBe("wrong_title");
    expect(res.body.sourceName).toBeNull();
    expect(res.body.details).toBeNull();
    expect(res.body.status).toBe("open");
    createdReportIds.push(res.body.id);

    // Confirm it surfaces in the admin queue filtered to open status.
    const adminRes = await supertest(app).get("/api/admin/reports?status=open");
    expect(adminRes.status).toBe(200);
    const found = adminRes.body.find((r: any) => r.id === res.body.id);
    expect(found).toBeDefined();
    expect(found.titleId).toBe(titleId);
  });

  it("returns 400 when reason is missing", async () => {
    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/reports`)
      .send({ details: "no reason provided" });

    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent title", async () => {
    const res = await supertest(app)
      .post("/api/titles/999999999/safety/reports")
      .send({ reason: "other" });

    expect(res.status).toBe(404);
  });

  it("returns 429 when the rate limit is exceeded — mobile shows correct Alert copy", async () => {
    // Simulate the rate limiter firing (mobile SafetyReportModal checks
    // err?.response?.status === 429 and shows:
    // "You've submitted too many reports recently. Please wait before trying again.")
    mockReportRateLimit.mockImplementationOnce((_req: any, res: any) => {
      res.status(429).json({
        error: "Too many safety reports. Please wait before submitting another.",
      });
    });

    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/reports`)
      .send({ reason: "outdated_info" });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many/i);
  });
});

// ─── POST /api/titles/:id/safety/contributions ────────────────────────────────

describe("POST /api/titles/:id/safety/contributions (mobile flow)", () => {
  const createdContributionIds: number[] = [];
  const watchedTitleRowIds: number[] = [];

  afterEach(async () => {
    for (const id of createdContributionIds) {
      await db.delete(contributionsTable).where(eq(contributionsTable.id, id));
    }
    createdContributionIds.length = 0;

    // Remove watched title rows added for eligibility.
    for (const id of watchedTitleRowIds) {
      await db.delete(watchedTitlesTable).where(eq(watchedTitlesTable.id, id));
    }
    watchedTitleRowIds.length = 0;
  });

  /** Insert one watched-title row per eligibility title so the mobile user
   *  passes the CONTRIBUTION_THRESHOLD (5) gate.  Each title is distinct so
   *  the unique (userId, titleId) index is never violated. */
  async function grantEligibility() {
    for (const etId of eligibilityTitleIds) {
      const [row] = await db
        .insert(watchedTitlesTable)
        .values({ userId: MOBILE_USER_ID, titleId: etId })
        .onConflictDoNothing()
        .returning();
      if (row) watchedTitleRowIds.push(row.id);
    }
  }

  it("creates a contribution and it appears in the admin queue with status 'pending'", async () => {
    await grantEligibility();

    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({
        category: "Violence",
        severity: "moderate",
        description: "Several intense action sequences in episodes 3–5.",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.titleId).toBe(titleId);
    expect(res.body.category).toBe("Violence");
    expect(res.body.severity).toBe("moderate");
    expect(res.body.description).toBe("Several intense action sequences in episodes 3–5.");
    expect(res.body.status).toBe("pending");
    createdContributionIds.push(res.body.id);

    // Verify the record appears in the admin contributions queue.
    const adminRes = await supertest(app).get("/api/admin/contributions");
    expect(adminRes.status).toBe(200);

    const found = adminRes.body.find((c: any) => c.id === res.body.id);
    expect(found).toBeDefined();
    expect(found.titleId).toBe(titleId);
    expect(found.category).toBe("Violence");
    expect(found.severity).toBe("moderate");
    expect(found.status).toBe("pending");
  });

  it("creates a contribution with optional season/episode fields preserved", async () => {
    await grantEligibility();

    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({
        category: "Language",
        severity: "mild",
        seasonNumber: 2,
        episodeNumber: 4,
        description: null,
      });

    expect(res.status).toBe(201);
    expect(res.body.seasonNumber).toBe(2);
    expect(res.body.episodeNumber).toBe(4);
    expect(res.body.description).toBeNull();
    createdContributionIds.push(res.body.id);

    // Confirm it surfaces in the admin queue filtered to pending status.
    const adminRes = await supertest(app).get("/api/admin/contributions?status=pending");
    expect(adminRes.status).toBe(200);
    const found = adminRes.body.find((c: any) => c.id === res.body.id);
    expect(found).toBeDefined();
    expect(found.seasonNumber).toBe(2);
    expect(found.episodeNumber).toBe(4);
  });

  it("returns 403 when the user has fewer than 5 watched items — mobile shows eligibility Alert", async () => {
    // No watched records inserted: user has 0 watched items, below threshold.
    // Mobile SafetyContributeModal checks status === 403 and shows:
    // "You need to watch at least 5 titles or episodes before contributing."
    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({ category: "Drugs", severity: "mild" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/5/); // threshold value present in message
  });

  it("returns 400 when required fields are missing", async () => {
    await grantEligibility();

    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({ category: "Violence" }); // severity missing

    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent title", async () => {
    await grantEligibility();

    const res = await supertest(app)
      .post("/api/titles/999999999/safety/contributions")
      .send({ category: "Violence", severity: "mild" });

    expect(res.status).toBe(404);
  });

  it("returns 429 when the daily contribution rate limit is exceeded — mobile shows correct Alert copy", async () => {
    // Simulate the rate limiter firing (mobile SafetyContributeModal checks
    // status === 429 and shows:
    // "You've reached the daily contribution limit. Try again tomorrow.")
    mockContributionRateLimit.mockImplementationOnce((_req: any, res: any) => {
      res.status(429).json({
        error: "Daily contribution limit reached. You can submit more contributions tomorrow.",
      });
    });

    await grantEligibility();

    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({ category: "Violence", severity: "moderate" });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/limit/i);
  });
});

// ─── PATCH /api/admin/contributions/:id (moderation queue filter) ─────────────

describe("PATCH /api/admin/contributions/:id — approved/rejected items drop out of pending filter", () => {
  const createdContributionIds: number[] = [];
  const watchedTitleRowIds: number[] = [];

  afterEach(async () => {
    for (const id of createdContributionIds) {
      await db.delete(contributionsTable).where(eq(contributionsTable.id, id));
    }
    createdContributionIds.length = 0;

    for (const id of watchedTitleRowIds) {
      await db.delete(watchedTitlesTable).where(eq(watchedTitlesTable.id, id));
    }
    watchedTitleRowIds.length = 0;
  });

  async function grantEligibility() {
    for (const etId of eligibilityTitleIds) {
      const [row] = await db
        .insert(watchedTitlesTable)
        .values({ userId: MOBILE_USER_ID, titleId: etId })
        .onConflictDoNothing()
        .returning();
      if (row) watchedTitleRowIds.push(row.id);
    }
  }

  it("an approved contribution no longer appears in GET /api/admin/contributions?status=pending", async () => {
    await grantEligibility();

    // Submit a contribution (lands as pending)
    const submitRes = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({ category: "Violence", severity: "moderate", description: "Intense scene." });

    expect(submitRes.status).toBe(201);
    const contributionId: number = submitRes.body.id;
    createdContributionIds.push(contributionId);

    // Confirm it is initially visible in the pending queue
    const beforeRes = await supertest(app).get("/api/admin/contributions?status=pending");
    expect(beforeRes.status).toBe(200);
    expect(beforeRes.body.find((c: any) => c.id === contributionId)).toBeDefined();

    // Approve it via PATCH
    const patchRes = await supertest(app)
      .patch(`/api/admin/contributions/${contributionId}`)
      .send({ status: "approved" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe("approved");

    // It must no longer appear in the pending filter
    const afterRes = await supertest(app).get("/api/admin/contributions?status=pending");
    expect(afterRes.status).toBe(200);
    expect(afterRes.body.find((c: any) => c.id === contributionId)).toBeUndefined();
  });

  it("a rejected contribution no longer appears in GET /api/admin/contributions?status=pending", async () => {
    await grantEligibility();

    // Submit a contribution (lands as pending)
    const submitRes = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({ category: "Language", severity: "mild", description: "Some strong language." });

    expect(submitRes.status).toBe(201);
    const contributionId: number = submitRes.body.id;
    createdContributionIds.push(contributionId);

    // Confirm it is initially visible in the pending queue
    const beforeRes = await supertest(app).get("/api/admin/contributions?status=pending");
    expect(beforeRes.status).toBe(200);
    expect(beforeRes.body.find((c: any) => c.id === contributionId)).toBeDefined();

    // Reject it via PATCH
    const patchRes = await supertest(app)
      .patch(`/api/admin/contributions/${contributionId}`)
      .send({ status: "rejected" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe("rejected");

    // It must no longer appear in the pending filter
    const afterRes = await supertest(app).get("/api/admin/contributions?status=pending");
    expect(afterRes.status).toBe(200);
    expect(afterRes.body.find((c: any) => c.id === contributionId)).toBeUndefined();
  });

  it("the approved contribution appears when filtering by status=approved", async () => {
    await grantEligibility();

    const submitRes = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({ category: "Drugs", severity: "severe", description: "Drug use depicted." });

    expect(submitRes.status).toBe(201);
    const contributionId: number = submitRes.body.id;
    createdContributionIds.push(contributionId);

    await supertest(app)
      .patch(`/api/admin/contributions/${contributionId}`)
      .send({ status: "approved" });

    // Must show up under the approved filter
    const approvedRes = await supertest(app).get("/api/admin/contributions?status=approved");
    expect(approvedRes.status).toBe(200);
    expect(approvedRes.body.find((c: any) => c.id === contributionId)).toBeDefined();
  });
});

// ─── Eligibility-insert race protection ───────────────────────────────────────
//
// The concurrency protocol: SELECT … FOR SHARE inside an explicit transaction.
//
// The race being closed:
//   Without locking, a concurrent DELETE of watch history can commit between
//   the eligibility COUNT and the contribution INSERT on two separate statements,
//   letting an ineligible contribution slip through silently.
//
//   READ COMMITTED (PostgreSQL default) gives each statement its own snapshot.
//   A plain db.transaction() wrapping does NOT close this window — the COUNT
//   and INSERT still have separate snapshots. FOR SHARE closes it:
//
//     1. SELECT … FOR SHARE acquires shared row locks on each watched item.
//     2. DELETE requires an exclusive row lock — it blocks while we hold FOR SHARE.
//     3. We COUNT (locked rows cannot be deleted), INSERT, then COMMIT.
//     4. Locks release on COMMIT; blocked DELETE runs — but contribution is already durable.
//
// Tests:
//   1. Exactly-at-threshold (5 items) → 201, row persisted.
//   2. One below threshold (4 items)  → 403, zero rows inserted.
//   3. Two-connection concurrent test: connection B's DELETE blocks while
//      connection A holds FOR SHARE, confirming the interleaving is prevented.

describe("eligibility-insert race protection", () => {
  const raceContributionIds: number[] = [];
  const raceWatchedTitleIds: number[] = [];

  afterEach(async () => {
    for (const id of raceContributionIds) {
      await db.delete(contributionsTable).where(eq(contributionsTable.id, id));
    }
    raceContributionIds.length = 0;

    for (const id of raceWatchedTitleIds) {
      await db.delete(watchedTitlesTable).where(eq(watchedTitlesTable.id, id));
    }
    raceWatchedTitleIds.length = 0;
  });

  async function setWatchedCount(n: number) {
    for (let i = 0; i < n && i < eligibilityTitleIds.length; i++) {
      const [row] = await db
        .insert(watchedTitlesTable)
        .values({ userId: MOBILE_USER_ID, titleId: eligibilityTitleIds[i] })
        .onConflictDoNothing()
        .returning();
      if (row) raceWatchedTitleIds.push(row.id);
    }
  }

  it("commits the contribution when user is exactly at the threshold (5 items)", async () => {
    await setWatchedCount(5);

    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({ category: "Violence", severity: "mild" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    raceContributionIds.push(res.body.id);

    const [row] = await db
      .select()
      .from(contributionsTable)
      .where(eq(contributionsTable.id, res.body.id));
    expect(row).toBeDefined();
    expect(row.status).toBe("pending");
  });

  it("returns 403 and inserts zero rows when user has 4 watched items (one below threshold)", async () => {
    await setWatchedCount(4);

    const [{ count: before }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contributionsTable)
      .where(eq(contributionsTable.userId, MOBILE_USER_ID));

    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({ category: "Violence", severity: "mild" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/5/);

    const [{ count: after }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contributionsTable)
      .where(eq(contributionsTable.userId, MOBILE_USER_ID));
    expect(after).toBe(before);
  });

  it("two-connection concurrent test: DELETE blocks while FOR SHARE is held, contribution commits before history is wiped", async () => {
    // This test exercises the exact interleaving the FOR SHARE protocol prevents.
    //
    // Timeline being tested:
    //   A: BEGIN + SELECT FOR SHARE on watched rows → acquires shared row locks
    //   B: DELETE watched rows                       → blocks (needs exclusive lock)
    //   A: COUNT (5 rows still locked), INSERT, COMMIT → releases locks
    //   B: DELETE finally runs (after A committed)
    //
    // The contribution commits with valid eligibility (5 items at lock time),
    // and B's delete only runs afterwards — no silent ineligible insert.
    //
    // Compare with the old two-statement approach (no locking):
    //   A: COUNT 5 items (passes gate)
    //   B: DELETE committed here — A's next statement will see 0 items
    //   A: INSERT runs with stale eligibility → silent ineligible contribution

    const { pool } = await import("@workspace/db");

    // Setup: user has exactly 5 watched items (at the threshold).
    await setWatchedCount(5);

    const clientA = await pool.connect();
    const clientB = await pool.connect();
    try {
      // A: begin transaction and lock all watched rows with FOR SHARE.
      // Any concurrent DELETE on these rows must wait for A to commit.
      await clientA.query("BEGIN");
      await clientA.query(
        "SELECT id FROM watched_titles WHERE user_id = $1 FOR SHARE",
        [MOBILE_USER_ID],
      );

      // B: attempt to delete the same rows in a background Promise.
      // DELETE needs an exclusive row lock — it must block while A holds FOR SHARE.
      let bDone = false;
      const bTask = clientB
        .query("DELETE FROM watched_titles WHERE user_id = $1", [MOBILE_USER_ID])
        .then(() => {
          bDone = true;
        });

      // Give B enough time to reach the lock wait (a delete on an unlocked table
      // completes in <1 ms; if it's still pending after 100 ms it is blocked).
      await new Promise((r) => setTimeout(r, 100));
      expect(bDone).toBe(false); // B is blocked by A's FOR SHARE lock

      // A: count within the same transaction — locked rows cannot be deleted yet.
      const {
        rows: [{ total }],
      } = await clientA.query<{ total: number }>(
        `SELECT (
           (SELECT COUNT(*)::int FROM watched_episodes WHERE user_id = $1) +
           (SELECT COUNT(*)::int FROM watched_titles     WHERE user_id = $1)
         ) AS total`,
        [MOBILE_USER_ID],
      );
      expect(total).toBeGreaterThanOrEqual(5); // CONTRIBUTION_THRESHOLD

      // A: insert the contribution while still holding the lock.
      const {
        rows: [contrib],
      } = await clientA.query<{ id: number; status: string }>(
        `INSERT INTO contributions (title_id, user_id, category, severity, status)
         VALUES ($1, $2, $3, $4, 'pending') RETURNING id, status`,
        [titleId, MOBILE_USER_ID, "Violence", "mild"],
      );
      raceContributionIds.push(contrib.id);

      // A: commit — releases FOR SHARE locks, letting B's DELETE proceed.
      await clientA.query("COMMIT");

      // B's DELETE can now acquire the exclusive lock and complete.
      await bTask;
      expect(bDone).toBe(true);
      raceWatchedTitleIds.length = 0; // B wiped the rows; prevent double-delete in afterEach

      // The contribution was committed before the delete ran — status is pending.
      expect(contrib.status).toBe("pending");

      // Confirm the row is durable in the DB.
      const {
        rows: [dbRow],
      } = await clientA.query<{ id: number; status: string }>(
        "SELECT id, status FROM contributions WHERE id = $1",
        [contrib.id],
      );
      expect(dbRow).toBeDefined();
      expect(dbRow.status).toBe("pending");
    } finally {
      // Safety rollback in case A never committed (e.g. test assertion failed).
      await clientA.query("ROLLBACK").catch(() => {});
      clientA.release();
      clientB.release();
    }
  });
});
