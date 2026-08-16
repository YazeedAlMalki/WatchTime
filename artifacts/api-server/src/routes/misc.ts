import { Router, type IRouter } from "express";
import {
  db,
  usersTable,
  titlesTable,
  watchedTitlesTable,
  watchedEpisodesTable,
  feedbackTable,
  analyticsEventsTable,
} from "@workspace/db";
import { eq, sql, desc, inArray } from "drizzle-orm";
import { CreateFeedbackBody } from "@workspace/api-zod";
import { optionalAuth } from "../middlewares/auth";
import { feedbackRateLimit } from "../middlewares/rateLimiters";
import { toTitleJson } from "../lib/serialize";

const router: IRouter = Router();

router.get("/stats/public", async (_req, res) => {
  const [[users], [tracked], [eps], [movies]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(usersTable),
    db
      .select({ count: sql<number>`count(distinct ${watchedTitlesTable.titleId})::int` })
      .from(watchedTitlesTable),
    db.select({ count: sql<number>`count(*)::int` }).from(watchedEpisodesTable),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(watchedTitlesTable)
      .innerJoin(titlesTable, eq(titlesTable.id, watchedTitlesTable.titleId))
      .where(eq(titlesTable.type, "movie")),
  ]);

  const byType = async (type: "tv" | "movie" | "anime" | "documentary") =>
    (
      await db
        .select()
        .from(titlesTable)
        .where(eq(titlesTable.type, type))
        .orderBy(desc(titlesTable.popularity))
        .limit(6)
    ).map((t) => toTitleJson(t));

  const safetyChecked = await db
    .select({
      name: analyticsEventsTable.name,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEventsTable)
    .where(eq(analyticsEventsTable.eventType, "safety_view"))
    .groupBy(analyticsEventsTable.name)
    .orderBy(desc(sql`count(*)`))
    .limit(6);
  const safetyNames = safetyChecked.map((r) => r.name).filter(Boolean) as string[];
  const safetyTitles = safetyNames.length
    ? await db
        .select()
        .from(titlesTable)
        .where(inArray(titlesTable.name, safetyNames))
    : [];
  const orderedSafety = safetyNames
    .map((n) => safetyTitles.find((t) => t.name === n))
    .filter(Boolean)
    .map((t) => toTitleJson(t!));

  return res.json({
    registeredUsers: users.count,
    titlesTracked: tracked.count,
    episodesWatched: eps.count,
    moviesWatched: movies.count,
    trendingTv: await byType("tv"),
    trendingMovies: await byType("movie"),
    trendingAnime: await byType("anime"),
    trendingDocumentaries: await byType("documentary"),
    mostSafetyChecked: orderedSafety,
  });
});

router.post("/feedback", feedbackRateLimit, optionalAuth, async (req, res) => {
  const parsed = CreateFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  await db.insert(feedbackTable).values({
    userId: req.userId ?? null,
    category: parsed.data.category,
    message: parsed.data.message,
    page: parsed.data.page ?? null,
    titleId: parsed.data.titleId ?? null,
  });
  return res.status(201).json({ ok: true });
});

export default router;
