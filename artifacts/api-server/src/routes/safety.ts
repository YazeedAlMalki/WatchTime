import { Router, type IRouter } from "express";
import {
  db,
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

router.post("/titles/:id/safety/contributions", requireAuth, async (req, res) => {
  const titleId = parseInt(String(req.params.id), 10);
  const parsed = CreateSafetyContributionBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  const [title] = await db.select().from(titlesTable).where(eq(titlesTable.id, titleId));
  if (!title) return res.status(404).json({ error: "Not found" });

  const [[eps], [movies]] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(watchedEpisodesTable)
      .where(eq(watchedEpisodesTable.userId, req.userId!)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(watchedTitlesTable)
      .where(eq(watchedTitlesTable.userId, req.userId!)),
  ]);
  if (eps.count + movies.count < CONTRIBUTION_THRESHOLD) {
    return res.status(403).json({
      error: `Track at least ${CONTRIBUTION_THRESHOLD} episodes or movies before contributing safety information.`,
    });
  }

  const [created] = await db
    .insert(contributionsTable)
    .values({
      titleId,
      userId: req.userId!,
      category: parsed.data.category,
      severity: parsed.data.severity,
      seasonNumber: parsed.data.seasonNumber ?? null,
      episodeNumber: parsed.data.episodeNumber ?? null,
      description: parsed.data.description ?? null,
    })
    .returning();
  return res.status(201).json({
    id: created.id,
    titleId,
    titleName: title.name,
    category: created.category,
    severity: created.severity,
    seasonNumber: created.seasonNumber,
    episodeNumber: created.episodeNumber,
    description: created.description,
    status: created.status,
    createdAt: created.createdAt.toISOString(),
  });
});

router.post("/titles/:id/safety/reports", requireAuth, async (req, res) => {
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
