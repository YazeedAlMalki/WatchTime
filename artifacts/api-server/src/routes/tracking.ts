import { Router, type IRouter } from "express";
import {
  db,
  usersTable,
  titlesTable,
  episodesTable,
  watchlistTable,
  watchedTitlesTable,
  watchedEpisodesTable,
} from "@workspace/db";
import {
  and,
  eq,
  desc,
  asc,
  sql,
  inArray,
  ne,
  notInArray,
  arrayOverlaps,
} from "drizzle-orm";
import { MarkEpisodeWatchedBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { toTitleJson, toEpisodeJson } from "../lib/serialize";

const router: IRouter = Router();

const CONTRIBUTION_THRESHOLD = 5;

router.get("/me", requireAuth, async (req, res) => {
  const userId = req.userId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const [[shows], [eps], [movies], [time]] = await Promise.all([
    db
      .select({ count: sql<number>`count(distinct ${watchedEpisodesTable.titleId})::int` })
      .from(watchedEpisodesTable)
      .where(eq(watchedEpisodesTable.userId, userId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(watchedEpisodesTable)
      .where(eq(watchedEpisodesTable.userId, userId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(watchedTitlesTable)
      .innerJoin(titlesTable, eq(titlesTable.id, watchedTitlesTable.titleId))
      .where(and(eq(watchedTitlesTable.userId, userId), eq(titlesTable.type, "movie"))),
    db
      .select({
        minutes: sql<number>`coalesce(sum(coalesce(${episodesTable.runtimeMinutes}, 0)), 0)::int`,
      })
      .from(watchedEpisodesTable)
      .innerJoin(episodesTable, eq(episodesTable.id, watchedEpisodesTable.episodeId))
      .where(eq(watchedEpisodesTable.userId, userId)),
  ]);
  const [movieTime] = await db
    .select({
      minutes: sql<number>`coalesce(sum(coalesce(${titlesTable.runtimeMinutes}, 0)), 0)::int`,
    })
    .from(watchedTitlesTable)
    .innerJoin(titlesTable, eq(titlesTable.id, watchedTitlesTable.titleId))
    .where(and(eq(watchedTitlesTable.userId, userId), eq(titlesTable.type, "movie")));

  return res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
    canContribute: eps.count + movies.count >= CONTRIBUTION_THRESHOLD,
    showsTracked: shows.count,
    episodesWatched: eps.count,
    moviesWatched: movies.count,
    timeWatchedMinutes: time.minutes + movieTime.minutes,
  });
});

router.post("/titles/:id/watchlist", requireAuth, async (req, res) => {
  const titleId = parseInt(String(req.params.id), 10);
  await db
    .insert(watchlistTable)
    .values({ userId: req.userId!, titleId })
    .onConflictDoNothing();
  return res.json({ ok: true });
});

router.delete("/titles/:id/watchlist", requireAuth, async (req, res) => {
  const titleId = parseInt(String(req.params.id), 10);
  await db
    .delete(watchlistTable)
    .where(and(eq(watchlistTable.userId, req.userId!), eq(watchlistTable.titleId, titleId)));
  return res.json({ ok: true });
});

router.post("/titles/:id/watched", requireAuth, async (req, res) => {
  const titleId = parseInt(String(req.params.id), 10);
  await db
    .insert(watchedTitlesTable)
    .values({ userId: req.userId!, titleId })
    .onConflictDoNothing();
  return res.json({ ok: true });
});

router.delete("/titles/:id/watched", requireAuth, async (req, res) => {
  const titleId = parseInt(String(req.params.id), 10);
  await db
    .delete(watchedTitlesTable)
    .where(
      and(eq(watchedTitlesTable.userId, req.userId!), eq(watchedTitlesTable.titleId, titleId)),
    );
  return res.json({ ok: true });
});

router.post("/episodes/:episodeId/watched", requireAuth, async (req, res) => {
  const episodeId = parseInt(String(req.params.episodeId), 10);
  const parsed = MarkEpisodeWatchedBody.safeParse(req.body ?? {});
  const includePrevious = parsed.success ? (parsed.data.includePrevious ?? false) : false;

  const [episode] = await db.select().from(episodesTable).where(eq(episodesTable.id, episodeId));
  if (!episode) return res.status(404).json({ error: "Not found" });

  let targets = [episode];
  if (includePrevious) {
    targets = await db
      .select()
      .from(episodesTable)
      .where(
        and(
          eq(episodesTable.titleId, episode.titleId),
          sql`(${episodesTable.seasonNumber}, ${episodesTable.episodeNumber}) <= (${episode.seasonNumber}, ${episode.episodeNumber})`,
        ),
      );
  }
  await db
    .insert(watchedEpisodesTable)
    .values(
      targets.map((e) => ({
        userId: req.userId!,
        titleId: e.titleId,
        episodeId: e.id,
      })),
    )
    .onConflictDoNothing();
  // Following a show implicitly when tracking episodes
  await db
    .insert(watchedTitlesTable)
    .values({ userId: req.userId!, titleId: episode.titleId })
    .onConflictDoNothing();
  return res.json({ ok: true });
});

router.delete("/episodes/:episodeId/watched", requireAuth, async (req, res) => {
  const episodeId = parseInt(String(req.params.episodeId), 10);
  await db
    .delete(watchedEpisodesTable)
    .where(
      and(
        eq(watchedEpisodesTable.userId, req.userId!),
        eq(watchedEpisodesTable.episodeId, episodeId),
      ),
    );
  return res.json({ ok: true });
});

router.get("/me/shows", requireAuth, async (req, res) => {
  const userId = req.userId!;
  const tracked = await db
    .selectDistinct({ titleId: watchedEpisodesTable.titleId })
    .from(watchedEpisodesTable)
    .where(eq(watchedEpisodesTable.userId, userId));
  const followed = await db
    .select({ titleId: watchedTitlesTable.titleId })
    .from(watchedTitlesTable)
    .innerJoin(titlesTable, eq(titlesTable.id, watchedTitlesTable.titleId))
    .where(and(eq(watchedTitlesTable.userId, userId), ne(titlesTable.type, "movie")));
  const ids = [...new Set([...tracked.map((r) => r.titleId), ...followed.map((r) => r.titleId)])];
  if (ids.length === 0) return res.json([]);

  const titles = await db.select().from(titlesTable).where(inArray(titlesTable.id, ids));
  const episodes = await db
    .select()
    .from(episodesTable)
    .where(inArray(episodesTable.titleId, ids))
    .orderBy(asc(episodesTable.seasonNumber), asc(episodesTable.episodeNumber));
  const watchedRows = await db
    .select({ episodeId: watchedEpisodesTable.episodeId, titleId: watchedEpisodesTable.titleId })
    .from(watchedEpisodesTable)
    .where(and(eq(watchedEpisodesTable.userId, userId), inArray(watchedEpisodesTable.titleId, ids)));
  const watchedByTitle = new Map<number, Set<number>>();
  for (const r of watchedRows) {
    if (!watchedByTitle.has(r.titleId)) watchedByTitle.set(r.titleId, new Set());
    watchedByTitle.get(r.titleId)!.add(r.episodeId);
  }
  const epsByTitle = new Map<number, typeof episodes>();
  for (const e of episodes) {
    if (!epsByTitle.has(e.titleId)) epsByTitle.set(e.titleId, []);
    epsByTitle.get(e.titleId)!.push(e);
  }
  const result = titles
    .filter((t) => t.type !== "movie")
    .map((t) => {
      const eps = epsByTitle.get(t.id) ?? [];
      const watched = watchedByTitle.get(t.id) ?? new Set<number>();
      const next = eps.find((e) => !watched.has(e.id));
      return {
        title: toTitleJson(t, { inWatchlist: undefined, watched: true }),
        watchedEpisodes: watched.size,
        totalEpisodes: eps.length,
        nextEpisode: next ? toEpisodeJson(next, false) : null,
      };
    })
    .sort((a, b) => (b.watchedEpisodes / Math.max(b.totalEpisodes, 1)) - (a.watchedEpisodes / Math.max(a.totalEpisodes, 1)));
  return res.json(result);
});

router.get("/me/movies", requireAuth, async (req, res) => {
  const rows = await db
    .select({ title: titlesTable })
    .from(watchedTitlesTable)
    .innerJoin(titlesTable, eq(titlesTable.id, watchedTitlesTable.titleId))
    .where(and(eq(watchedTitlesTable.userId, req.userId!), eq(titlesTable.type, "movie")))
    .orderBy(desc(watchedTitlesTable.watchedAt));
  return res.json(rows.map((r) => toTitleJson(r.title, { watched: true })));
});

router.get("/me/watchlist", requireAuth, async (req, res) => {
  const rows = await db
    .select({ title: titlesTable })
    .from(watchlistTable)
    .innerJoin(titlesTable, eq(titlesTable.id, watchlistTable.titleId))
    .where(eq(watchlistTable.userId, req.userId!))
    .orderBy(desc(watchlistTable.createdAt));
  return res.json(rows.map((r) => toTitleJson(r.title, { inWatchlist: true })));
});

router.get("/me/recent", requireAuth, async (req, res) => {
  const userId = req.userId!;
  const epRows = await db
    .select({
      titleId: episodesTable.titleId,
      titleName: titlesTable.name,
      posterUrl: titlesTable.posterUrl,
      seasonNumber: episodesTable.seasonNumber,
      episodeNumber: episodesTable.episodeNumber,
      watchedAt: watchedEpisodesTable.watchedAt,
    })
    .from(watchedEpisodesTable)
    .innerJoin(episodesTable, eq(episodesTable.id, watchedEpisodesTable.episodeId))
    .innerJoin(titlesTable, eq(titlesTable.id, episodesTable.titleId))
    .where(eq(watchedEpisodesTable.userId, userId))
    .orderBy(desc(watchedEpisodesTable.watchedAt))
    .limit(20);
  const movieRows = await db
    .select({
      titleId: titlesTable.id,
      titleName: titlesTable.name,
      posterUrl: titlesTable.posterUrl,
      watchedAt: watchedTitlesTable.watchedAt,
    })
    .from(watchedTitlesTable)
    .innerJoin(titlesTable, eq(titlesTable.id, watchedTitlesTable.titleId))
    .where(and(eq(watchedTitlesTable.userId, userId), eq(titlesTable.type, "movie")))
    .orderBy(desc(watchedTitlesTable.watchedAt))
    .limit(20);

  const items = [
    ...epRows.map((r) => ({
      titleId: r.titleId,
      titleName: r.titleName,
      posterUrl: r.posterUrl,
      kind: "episode" as const,
      episodeLabel: `S${r.seasonNumber}E${r.episodeNumber}`,
      watchedAt: r.watchedAt.toISOString(),
    })),
    ...movieRows.map((r) => ({
      titleId: r.titleId,
      titleName: r.titleName,
      posterUrl: r.posterUrl,
      kind: "movie" as const,
      episodeLabel: null,
      watchedAt: r.watchedAt.toISOString(),
    })),
  ]
    .sort((a, b) => b.watchedAt.localeCompare(a.watchedAt))
    .slice(0, 20);
  return res.json(items);
});

router.get("/me/recommendations", requireAuth, async (req, res) => {
  const userId = req.userId!;
  const watched = await db
    .select({ title: titlesTable })
    .from(watchedTitlesTable)
    .innerJoin(titlesTable, eq(titlesTable.id, watchedTitlesTable.titleId))
    .where(eq(watchedTitlesTable.userId, userId))
    .orderBy(desc(watchedTitlesTable.watchedAt))
    .limit(3);
  const watchedIds = watched.map((w) => w.title.id);
  const groups = [];
  for (const w of watched) {
    const similar = await db
      .select()
      .from(titlesTable)
      .where(
        and(
          watchedIds.length ? notInArray(titlesTable.id, watchedIds) : undefined,
          w.title.genres.length > 0
            ? arrayOverlaps(titlesTable.genres, w.title.genres)
            : undefined,
        ),
      )
      .orderBy(desc(titlesTable.popularity))
      .limit(6);
    if (similar.length > 0) {
      groups.push({
        reason: `Because you watched ${w.title.name}`,
        titles: similar.map((t) => toTitleJson(t)),
      });
    }
  }
  if (groups.length === 0) {
    const popular = await db
      .select()
      .from(titlesTable)
      .orderBy(desc(titlesTable.popularity))
      .limit(8);
    groups.push({
      reason: "Popular on WatchTime",
      titles: popular.map((t) => toTitleJson(t)),
    });
  }
  return res.json(groups);
});

export default router;
