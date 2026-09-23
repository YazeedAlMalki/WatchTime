import { Router, type IRouter, type Response } from "express";
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
  or,
  isNotNull,
} from "drizzle-orm";
import { MarkEpisodeWatchedBody, UpdateMeBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { toTitleJson, toEpisodeJson } from "../lib/serialize";

const router: IRouter = Router();

const CONTRIBUTION_THRESHOLD = 5;
const DEFAULT_COLLECTION_LIMIT = 24;
const MAX_COLLECTION_LIMIT = 50;

function getCollectionPage(query: Record<string, unknown>) {
  const limit = Number(query.limit ?? DEFAULT_COLLECTION_LIMIT);
  const offset = Number(query.offset ?? 0);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_COLLECTION_LIMIT ||
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    return null;
  }
  return { limit, offset };
}

function setPrivateCollectionCache(res: Response) {
  res.set("Cache-Control", "private, no-cache");
  res.set("Vary", "Authorization, Cookie");
}

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
    preferredRatingRegion: user.preferredRatingRegion,
  });
});

router.patch("/me", requireAuth, async (req, res) => {
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid rating region" });
  const [user] = await db
    .update(usersTable)
    .set({ preferredRatingRegion: parsed.data.preferredRatingRegion })
    .where(eq(usersTable.id, req.userId!))
    .returning({ preferredRatingRegion: usersTable.preferredRatingRegion });
  return res.json(user);
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
  const page = getCollectionPage(req.query);
  if (!page) return res.status(400).json({ error: "Invalid pagination" });
  setPrivateCollectionCache(res);

  const watchedCounts = db
    .select({
      titleId: watchedEpisodesTable.titleId,
      watchedEpisodes: sql<number>`count(*)::int`.as("watched_episodes"),
    })
    .from(watchedEpisodesTable)
    .where(eq(watchedEpisodesTable.userId, userId))
    .groupBy(watchedEpisodesTable.titleId)
    .as("watched_counts");
  const followed = db
    .select({ titleId: watchedTitlesTable.titleId })
    .from(watchedTitlesTable)
    .where(eq(watchedTitlesTable.userId, userId))
    .as("followed_titles");
  const totalEpisodes = sql<number>`(
    select count(*)::int from ${episodesTable} episode_count
    where episode_count.title_id = ${titlesTable.id}
  )`;
  const progress = sql<number>`coalesce(${watchedCounts.watchedEpisodes}, 0)::float / greatest(${totalEpisodes}, 1)`;
  const rows = await db
    .select({
      title: titlesTable,
      watchedEpisodes: sql<number>`coalesce(${watchedCounts.watchedEpisodes}, 0)::int`,
      totalEpisodes,
      nextEpisodeId: sql<number | null>`(
        select e.id from ${episodesTable} e
        where e.title_id = ${titlesTable.id}
          and not exists (
            select 1 from ${watchedEpisodesTable} we
            where we.user_id = ${userId} and we.episode_id = e.id
          )
        order by e.season_number asc, e.episode_number asc, e.id asc
        limit 1
      )`,
    })
    .from(titlesTable)
    .leftJoin(watchedCounts, eq(watchedCounts.titleId, titlesTable.id))
    .leftJoin(followed, eq(followed.titleId, titlesTable.id))
    .where(and(ne(titlesTable.type, "movie"), or(isNotNull(watchedCounts.titleId), isNotNull(followed.titleId))))
    .orderBy(desc(progress), asc(titlesTable.id))
    .limit(page.limit)
    .offset(page.offset);
  const nextIds = rows.flatMap((row) => row.nextEpisodeId == null ? [] : [row.nextEpisodeId]);
  const nextEpisodes = nextIds.length
    ? await db.select().from(episodesTable).where(inArray(episodesTable.id, nextIds))
    : [];
  const nextById = new Map(nextEpisodes.map((episode) => [episode.id, episode]));
  const result = rows.map((row) => ({
    title: toTitleJson(row.title, { inWatchlist: undefined, watched: true }),
    watchedEpisodes: row.watchedEpisodes,
    totalEpisodes: row.totalEpisodes,
    nextEpisode: row.nextEpisodeId == null
      ? null
      : toEpisodeJson(nextById.get(row.nextEpisodeId)!, false),
  }));
  return res.json(result);
});

router.get("/me/movies", requireAuth, async (req, res) => {
  const page = getCollectionPage(req.query);
  if (!page) return res.status(400).json({ error: "Invalid pagination" });
  setPrivateCollectionCache(res);
  const rows = await db
    .select({ title: titlesTable })
    .from(watchedTitlesTable)
    .innerJoin(titlesTable, eq(titlesTable.id, watchedTitlesTable.titleId))
    .where(and(eq(watchedTitlesTable.userId, req.userId!), eq(titlesTable.type, "movie")))
    .orderBy(desc(watchedTitlesTable.watchedAt), desc(watchedTitlesTable.id))
    .limit(page.limit)
    .offset(page.offset);
  return res.json(rows.map((r) => toTitleJson(r.title, { watched: true })));
});

router.get("/me/watchlist", requireAuth, async (req, res) => {
  const page = getCollectionPage(req.query);
  if (!page) return res.status(400).json({ error: "Invalid pagination" });
  setPrivateCollectionCache(res);
  const rows = await db
    .select({ title: titlesTable })
    .from(watchlistTable)
    .innerJoin(titlesTable, eq(titlesTable.id, watchlistTable.titleId))
    .where(eq(watchlistTable.userId, req.userId!))
    .orderBy(desc(watchlistTable.createdAt), desc(watchlistTable.id))
    .limit(page.limit)
    .offset(page.offset);
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
  const allGenres = [...new Set(watched.flatMap((w) => w.title.genres))];
  const candidates = watched.length > 0
    ? await db
      .select()
      .from(titlesTable)
      .where(
        and(
          watchedIds.length ? notInArray(titlesTable.id, watchedIds) : undefined,
          allGenres.length > 0
            ? arrayOverlaps(titlesTable.genres, allGenres)
            : undefined,
        ),
      )
      .orderBy(desc(titlesTable.popularity))
      .limit(60)
    : [];
  for (const w of watched) {
    const watchedGenres = new Set(w.title.genres);
    const similar = candidates
      .filter((candidate) => candidate.genres.some((genre) => watchedGenres.has(genre)))
      .slice(0, 6);
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
