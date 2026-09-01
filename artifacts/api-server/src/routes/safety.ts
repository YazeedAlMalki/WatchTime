import { Router, type IRouter } from "express";
import {
  db,
  pool,
  titlesTable,
  safetyRecordsTable,
  contributionsTable,
  reportsTable,
  watchedEpisodesTable,
  watchedTitlesTable,
  analyticsEventsTable,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  CreateSafetyContributionBody,
  CreateSafetyReportBody,
} from "@workspace/api-zod";
import { requireAuth, optionalAuth } from "../middlewares/auth";
import { safetyReportRateLimit, safetyContributionRateLimit } from "../middlewares/rateLimiters";

const router: IRouter = Router();

const SEVERITY_ORDER = { none: 0, mild: 1, moderate: 2, severe: 3 } as const;
type Severity = keyof typeof SEVERITY_ORDER;

function severityFromScore(score: number | null, maxScore: number | null): Severity {
  if (score == null || maxScore == null || maxScore === 0) return "mild";
  const ratio = score / maxScore;
  if (ratio === 0) return "none";
  if (ratio <= 0.34) return "mild";
  if (ratio <= 0.67) return "moderate";
  return "severe";
}

router.get("/safety", optionalAuth, async (req, res) => {
  const titleId = parseInt(String(req.query.titleId), 10);
  const seasonNumber = req.query.seasonNumber
    ? parseInt(String(req.query.seasonNumber), 10)
    : null;
  const episodeNumber = req.query.episodeNumber
    ? parseInt(String(req.query.episodeNumber), 10)
    : null;
  if (!Number.isFinite(titleId)) {
    return res.status(400).json({ error: "titleId required" });
  }
  const [title] = await db.select().from(titlesTable).where(eq(titlesTable.id, titleId));
  if (!title) return res.status(404).json({ error: "Not found" });

  // Fallback chain: episode -> season -> series (movie is series-level).
  const levels: Array<{
    level: "episode" | "season" | "series" | "movie";
    cond: ReturnType<typeof and>;
  }> = [];
  if (seasonNumber != null && episodeNumber != null) {
    levels.push({
      level: "episode",
      cond: and(
        eq(safetyRecordsTable.titleId, titleId),
        eq(safetyRecordsTable.seasonNumber, seasonNumber),
        eq(safetyRecordsTable.episodeNumber, episodeNumber),
      ),
    });
  }
  if (seasonNumber != null) {
    levels.push({
      level: "season",
      cond: and(
        eq(safetyRecordsTable.titleId, titleId),
        eq(safetyRecordsTable.seasonNumber, seasonNumber),
        isNull(safetyRecordsTable.episodeNumber),
      ),
    });
  }
  levels.push({
    level: title.type === "movie" ? "movie" : "series",
    cond: and(
      eq(safetyRecordsTable.titleId, titleId),
      isNull(safetyRecordsTable.seasonNumber),
      isNull(safetyRecordsTable.episodeNumber),
    ),
  });

  let level: string = title.type === "movie" ? "movie" : "series";
  let records: (typeof safetyRecordsTable.$inferSelect)[] = [];
  for (const l of levels) {
    const rows = await db.select().from(safetyRecordsTable).where(l.cond);
    if (rows.some((r) => r.status === "available" && r.items.length > 0)) {
      level = l.level;
      records = rows;
      break;
    }
    if (rows.length > 0 && records.length === 0) {
      level = l.level;
      records = rows;
    }
  }

  // Summary: worst severity per category across available sources.
  const summaryMap = new Map<string, Severity>();
  for (const r of records) {
    if (r.status !== "available") continue;
    for (const item of r.items) {
      const sev = item.severity ?? severityFromScore(item.score, item.maxScore);
      const prev = summaryMap.get(item.category);
      if (!prev || SEVERITY_ORDER[sev] > SEVERITY_ORDER[prev]) {
        summaryMap.set(item.category, sev);
      }
    }
  }

  db.insert(analyticsEventsTable)
    .values({ eventType: "safety_view", name: title.name })
    .catch(() => {});

  return res.json({
    level,
    summary: [...summaryMap.entries()].map(([category, severity]) => ({
      category,
      severity,
    })),
    sources: records
      .sort((a, b) => a.tier - b.tier)
      .map((r) => ({
        sourceName: r.sourceName,
        tier: r.tier,
        isCommunity: r.isCommunity,
        ageRecommendation: r.ageRecommendation,
        url: r.url,
        status: r.status,
        items: r.items.map((i) => ({
          category: i.category,
          label: i.label,
          score: i.score ?? null,
          maxScore: i.maxScore ?? null,
          description: i.description ?? null,
        })),
      })),
  });
});

const CONTRIBUTION_THRESHOLD = 5;

router.post("/titles/:id/safety/contributions", requireAuth, safetyContributionRateLimit, async (req, res) => {
  const titleId = parseInt(String(req.params.id), 10);
  const parsed = CreateSafetyContributionBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  const [title] = await db.select().from(titlesTable).where(eq(titlesTable.id, titleId));
  if (!title) return res.status(404).json({ error: "Not found" });

  // Concurrency protocol: SELECT … FOR SHARE + explicit transaction.
  //
  // The race being closed: without locking, a concurrent DELETE of watch history
  // can commit between the eligibility COUNT and the contribution INSERT, letting
  // an ineligible contribution slip through.
  //
  // How FOR SHARE stops it:
  //   1. We lock every watched row for this user with FOR SHARE.
  //   2. FOR SHARE conflicts with the exclusive lock DELETE must acquire on each
  //      row, so any concurrent DELETE on those rows blocks until we COMMIT.
  //   3. We then COUNT (same transaction, same rows still locked) and INSERT.
  //   4. On COMMIT the locks release, and any waiting DELETE can proceed —
  //      but the contribution is already durably committed with valid eligibility.
  //
  // Why a plain transaction (without FOR SHARE) is not enough:
  //   READ COMMITTED gives each statement its own snapshot. Two separate
  //   statements (COUNT then INSERT) still have a window: a DELETE could commit
  //   between them. FOR SHARE removes that window by holding the lock across all
  //   three statements.
  //
  // Edge case: if the user has zero watched items, FOR SHARE locks nothing, and
  // the COUNT correctly sees zero — the 403 path fires before any INSERT.

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Acquire shared row locks on every watched item for this user.
    // Any concurrent DELETE on these rows must wait for COMMIT.
    await Promise.all([
      client.query(
        "SELECT id FROM watched_episodes WHERE user_id = $1 FOR SHARE",
        [req.userId],
      ),
      client.query(
        "SELECT id FROM watched_titles WHERE user_id = $1 FOR SHARE",
        [req.userId],
      ),
    ]);

    // Count within the same transaction — locked rows cannot be deleted yet.
    const {
      rows: [{ total }],
    } = await client.query<{ total: number }>(
      `SELECT (
         (SELECT COUNT(*)::int FROM watched_episodes WHERE user_id = $1) +
         (SELECT COUNT(*)::int FROM watched_titles     WHERE user_id = $1)
       ) AS total`,
      [req.userId],
    );

    if (total < CONTRIBUTION_THRESHOLD) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: `Track at least ${CONTRIBUTION_THRESHOLD} episodes or movies before contributing safety information.`,
      });
    }

    type ContributionRow = {
      id: number;
      category: string;
      severity: string;
      season_number: number | null;
      episode_number: number | null;
      description: string | null;
      status: string;
      created_at: Date;
    };

    const {
      rows: [created],
    } = await client.query<ContributionRow>(
      `INSERT INTO contributions
         (title_id, user_id, category, severity, season_number, episode_number, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, category, severity, season_number, episode_number, description, status, created_at`,
      [
        titleId,
        req.userId,
        parsed.data.category,
        parsed.data.severity,
        parsed.data.seasonNumber ?? null,
        parsed.data.episodeNumber ?? null,
        parsed.data.description ?? null,
      ],
    );

    await client.query("COMMIT");

    return res.status(201).json({
      id: created.id,
      titleId,
      titleName: title.name,
      category: created.category,
      severity: created.severity,
      seasonNumber: created.season_number,
      episodeNumber: created.episode_number,
      description: created.description,
      status: created.status,
      createdAt: created.created_at.toISOString(),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

router.post("/titles/:id/safety/reports", requireAuth, safetyReportRateLimit, async (req, res) => {
  const titleId = parseInt(String(req.params.id), 10);
  const parsed = CreateSafetyReportBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  const [title] = await db.select().from(titlesTable).where(eq(titlesTable.id, titleId));
  if (!title) return res.status(404).json({ error: "Not found" });

  const [created] = await db
    .insert(reportsTable)
    .values({
      titleId,
      userId: req.userId!,
      reason: parsed.data.reason,
      sourceName: parsed.data.sourceName ?? null,
      details: parsed.data.details ?? null,
    })
    .returning();
  return res.status(201).json({
    id: created.id,
    titleId,
    titleName: title.name,
    reason: created.reason,
    sourceName: created.sourceName,
    details: created.details,
    status: created.status,
    createdAt: created.createdAt.toISOString(),
  });
});

export default router;
