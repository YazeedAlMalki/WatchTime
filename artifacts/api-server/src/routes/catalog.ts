import { Router, type IRouter } from "express";
import {
  db,
  titlesTable,
  seasonsTable,
  episodesTable,
  castMembersTable,
  watchProvidersTable,
  watchlistTable,
  watchedTitlesTable,
  watchedEpisodesTable,
  analyticsEventsTable,
} from "@workspace/db";
import {
  and,
  eq,
  ilike,
  or,
  sql,
  desc,
  asc,
  ne,
  inArray,
  arrayOverlaps,
} from "drizzle-orm";
import { optionalAuth } from "../middlewares/auth";
import { toTitleJson, toEpisodeJson } from "../lib/serialize";

const router: IRouter = Router();

async function userStates(userId: string | undefined, titleIds: number[]) {
  const inWatchlist = new Set<number>();
  const watched = new Set<number>();
  if (!userId || titleIds.length === 0) return { inWatchlist, watched };
  const [wl, wt] = await Promise.all([
    db
      .select({ titleId: watchlistTable.titleId })
      .from(watchlistTable)
      .where(
        and(
          eq(watchlistTable.userId, userId),
          inArray(watchlistTable.titleId, titleIds),
        ),
      ),
    db
      .select({ titleId: watchedTitlesTable.titleId })
      .from(watchedTitlesTable)
      .where(
        and(
          eq(watchedTitlesTable.userId, userId),
          inArray(watchedTitlesTable.titleId, titleIds),
        ),
      ),
  ]);
  wl.forEach((r) => inWatchlist.add(r.titleId));
  wt.forEach((r) => watched.add(r.titleId));
  return { inWatchlist, watched };
}

router.get("/titles", optionalAuth, async (req, res) => {
  const { q, type, genre, sort } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(String(req.query.limit ?? "60"), 10) || 60, 100);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;

  const conds = [];
  if (q) {
    const pattern = `%${q}%`;
    conds.push(
      or(
        ilike(titlesTable.name, pattern),
        sql`EXISTS (SELECT 1 FROM unnest(${titlesTable.altTitles}) alt WHERE alt ILIKE ${pattern})`,
      ),
    );
  }
  if (type) conds.push(eq(titlesTable.type, type as never));
  if (genre)
    conds.push(sql`${genre} = ANY(${titlesTable.genres})`);

  const orderBy =
    sort === "newest"
      ? [desc(titlesTable.year)]
      : sort === "name"
        ? [asc(titlesTable.name)]
        : [desc(titlesTable.popularity)];

  const rows = await db
    .select()
    .from(titlesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);

  if (q) {
    db.insert(analyticsEventsTable)
      .values({ eventType: "search", name: q })
      .catch(() => {});
  }

  const states = await userStates(req.userId, rows.map((r) => r.id));
  return res.json(
    rows.map((r) =>
      toTitleJson(r, {
        inWatchlist: req.userId ? states.inWatchlist.has(r.id) : undefined,
        watched: req.userId ? states.watched.has(r.id) : undefined,
      }),
    ),
  );
});

router.get("/titles/trending", optionalAuth, async (req, res) => {
  const { type } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(String(req.query.limit ?? "12"), 10) || 12, 50);
  const rows = await db
    .select()
    .from(titlesTable)
    .where(type ? eq(titlesTable.type, type as never) : undefined)
    .orderBy(desc(titlesTable.popularity))
    .limit(limit);
  const states = await userStates(req.userId, rows.map((r) => r.id));
  return res.json(
    rows.map((r) =>
      toTitleJson(r, {
        inWatchlist: req.userId ? states.inWatchlist.has(r.id) : undefined,
        watched: req.userId ? states.watched.has(r.id) : undefined,
      }),
    ),
  );
});

router.get("/titles/:id", optionalAuth, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return res.status(404).json({ error: "Not found" });
  const [title] = await db.select().from(titlesTable).where(eq(titlesTable.id, id));
  if (!title) return res.status(404).json({ error: "Not found" });

  const [seasons, cast, providers, episodeCounts] = await Promise.all([
    db
      .select()
      .from(seasonsTable)
      .where(eq(seasonsTable.titleId, id))
      .orderBy(asc(seasonsTable.seasonNumber)),
    db
      .select()
      .from(castMembersTable)
      .where(eq(castMembersTable.titleId, id))
      .orderBy(asc(castMembersTable.ord)),
    db
      .select()
      .from(watchProvidersTable)
      .where(eq(watchProvidersTable.titleId, id)),
    db
      .select({
        seasonNumber: episodesTable.seasonNumber,
        count: sql<number>`count(*)::int`,
      })
      .from(episodesTable)
      .where(eq(episodesTable.titleId, id))
      .groupBy(episodesTable.seasonNumber),
  ]);

  const states = await userStates(req.userId, [id]);

  let watchedBySeason = new Map<number, number>();
  let watchedEpisodeIds = new Set<number>();
  if (req.userId) {
    const watchedRows = await db
      .select({
        episodeId: watchedEpisodesTable.episodeId,
        seasonNumber: episodesTable.seasonNumber,
      })
      .from(watchedEpisodesTable)
      .innerJoin(episodesTable, eq(episodesTable.id, watchedEpisodesTable.episodeId))
      .where(
        and(
          eq(watchedEpisodesTable.userId, req.userId),
          eq(watchedEpisodesTable.titleId, id),
        ),
      );
    for (const r of watchedRows) {
      watchedEpisodeIds.add(r.episodeId);
      watchedBySeason.set(r.seasonNumber, (watchedBySeason.get(r.seasonNumber) ?? 0) + 1);
    }
  }

  const countBySeason = new Map(episodeCounts.map((r) => [r.seasonNumber, r.count]));
  const totalEpisodes = episodeCounts.reduce((a, r) => a + r.count, 0);
  const watchedEpisodes = watchedEpisodeIds.size;

  let nextEpisode = null;
  if (req.userId && totalEpisodes > 0) {
    const allEps = await db
      .select()
      .from(episodesTable)
      .where(eq(episodesTable.titleId, id))
      .orderBy(asc(episodesTable.seasonNumber), asc(episodesTable.episodeNumber));
    const next = allEps.find((e) => !watchedEpisodeIds.has(e.id));
    if (next) nextEpisode = toEpisodeJson(next, false);
  }

  db.insert(analyticsEventsTable)
    .values({ eventType: "title_view", name: title.name })
    .catch(() => {});

  return res.json({
    ...toTitleJson(title, {
      inWatchlist: req.userId ? states.inWatchlist.has(id) : undefined,
      watched: req.userId ? states.watched.has(id) : undefined,
    }),
    altTitles: title.altTitles ?? [],
    cast: cast.map((c) => ({
      name: c.name,
      character: c.character,
      photoUrl: c.photoUrl,
    })),
    providers: providers.map((p) => ({
      name: p.name,
      kind: p.kind,
      logoUrl: p.logoUrl,
    })),
    seasons: seasons.map((s) => ({
      seasonNumber: s.seasonNumber,
      name: s.name,
      episodeCount: countBySeason.get(s.seasonNumber) ?? 0,
      watchedCount: req.userId ? (watchedBySeason.get(s.seasonNumber) ?? 0) : null,
    })),
    totalEpisodes: totalEpisodes || null,
    watchedEpisodes: req.userId ? watchedEpisodes : null,
    nextEpisode,
  });
});

router.get("/titles/:id/seasons/:seasonNumber", optionalAuth, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const seasonNumber = parseInt(String(req.params.seasonNumber), 10);
  const [season] = await db
    .select()
    .from(seasonsTable)
    .where(and(eq(seasonsTable.titleId, id), eq(seasonsTable.seasonNumber, seasonNumber)));
  if (!season) return res.status(404).json({ error: "Not found" });

  const episodes = await db
    .select()
    .from(episodesTable)
    .where(and(eq(episodesTable.titleId, id), eq(episodesTable.seasonNumber, seasonNumber)))
    .orderBy(asc(episodesTable.episodeNumber));

  let watchedIds = new Set<number>();
  if (req.userId) {
    const rows = await db
      .select({ episodeId: watchedEpisodesTable.episodeId })
      .from(watchedEpisodesTable)
      .where(
        and(
          eq(watchedEpisodesTable.userId, req.userId),
          eq(watchedEpisodesTable.titleId, id),
        ),
      );
    rows.forEach((r) => watchedIds.add(r.episodeId));
  }

  return res.json({
    seasonNumber: season.seasonNumber,
    name: season.name,
    overview: season.overview,
    episodes: episodes.map((e) =>
      toEpisodeJson(e, req.userId ? watchedIds.has(e.id) : null),
    ),
  });
});

router.get("/titles/:id/similar", optionalAuth, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const [title] = await db.select().from(titlesTable).where(eq(titlesTable.id, id));
  if (!title) return res.status(404).json({ error: "Not found" });
  const rows = await db
    .select()
    .from(titlesTable)
    .where(
      and(
        ne(titlesTable.id, id),
        or(
          eq(titlesTable.type, title.type),
          title.genres.length > 0
            ? arrayOverlaps(titlesTable.genres, title.genres)
            : undefined,
        ),
      ),
    )
    .orderBy(desc(titlesTable.popularity))
    .limit(10);
  const states = await userStates(req.userId, rows.map((r) => r.id));
  return res.json(
    rows.map((r) =>
      toTitleJson(r, {
        inWatchlist: req.userId ? states.inWatchlist.has(r.id) : undefined,
        watched: req.userId ? states.watched.has(r.id) : undefined,
      }),
    ),
  );
});

export default router;
