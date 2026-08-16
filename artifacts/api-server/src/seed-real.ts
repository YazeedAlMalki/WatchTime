/**
 * Seed the WatchTime catalog with REAL titles.
 * - TV / anime / documentary series: TVMaze API (free, no key) — real episodes, cast, artwork.
 * - Movies: Wikipedia REST API — real plot summaries and poster thumbnails.
 * Safety records are inserted as `provider_unavailable` for external sources
 * (we have no live integration, and WatchTime never fabricates safety data).
 *
 * DESTRUCTIVE: wipes the existing catalog (titles cascade to seasons, episodes,
 * cast, providers, safety records, mappings, and user watch data referencing them).
 *
 * Run: pnpm --filter @workspace/api-server exec tsx src/seed-real.ts
 */
import {
  db,
  pool,
  titlesTable,
  seasonsTable,
  episodesTable,
  castMembersTable,
  watchProvidersTable,
  safetyRecordsTable,
  providerMappingsTable,
  integrationHealthTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";

const UA = { "User-Agent": "WatchTime/1.0 (catalog seeder)" };

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ShowSpec = {
  tvmazeId: number;
  type: "tv" | "anime" | "documentary";
  altTitles?: string[];
  popularity: number;
};

// Curated real series (TVMaze ids are stable public ids).
const SHOWS: ShowSpec[] = [
  { tvmazeId: 169, type: "tv", popularity: 98 }, // Breaking Bad
  { tvmazeId: 2993, type: "tv", popularity: 97 }, // Stranger Things
  { tvmazeId: 526, type: "tv", popularity: 90 }, // The Office (US)
  { tvmazeId: 82, type: "tv", popularity: 95 }, // Game of Thrones
  { tvmazeId: 179, type: "tv", popularity: 88 }, // The Wire
  { tvmazeId: 919, type: "anime", altTitles: ["Shingeki no Kyojin", "進撃の巨人"], popularity: 94 }, // Attack on Titan
  { tvmazeId: 40, type: "anime", altTitles: ["デスノート"], popularity: 89 }, // Death Note
  { tvmazeId: 2071, type: "anime", altTitles: ["Hagane no Renkinjutsushi", "鋼の錬金術師"], popularity: 86 }, // FMA: Brotherhood
  { tvmazeId: 22036, type: "documentary", popularity: 85 }, // Planet Earth II
  { tvmazeId: 17868, type: "documentary", popularity: 80 }, // Our Planet
];

type MovieSpec = {
  wikiPage: string;
  name: string;
  type: "movie" | "documentary";
  year: number;
  genres: string[];
  altTitles?: string[];
  imdbId: string;
  imdbRating: number;
  rottenTomatoesScore: number;
  runtimeMinutes: number;
  popularity: number;
  providers: [string, "stream" | "rent" | "buy"][];
  cast: [string, string][];
};

// Curated real movies. Ratings are the public IMDb / Rotten Tomatoes figures.
const MOVIES: MovieSpec[] = [
  {
    wikiPage: "Inception", name: "Inception", type: "movie", year: 2010,
    genres: ["Sci-Fi", "Action", "Thriller"], imdbId: "tt1375666",
    imdbRating: 8.8, rottenTomatoesScore: 87, runtimeMinutes: 148, popularity: 96,
    providers: [["Netflix", "stream"], ["Apple TV", "rent"]],
    cast: [["Leonardo DiCaprio", "Dom Cobb"], ["Joseph Gordon-Levitt", "Arthur"], ["Elliot Page", "Ariadne"], ["Tom Hardy", "Eames"]],
  },
  {
    wikiPage: "The Dark Knight", name: "The Dark Knight", type: "movie", year: 2008,
    genres: ["Action", "Crime", "Drama"], imdbId: "tt0468569",
    imdbRating: 9.0, rottenTomatoesScore: 94, runtimeMinutes: 152, popularity: 97,
    providers: [["Max", "stream"], ["Amazon Video", "rent"]],
    cast: [["Christian Bale", "Bruce Wayne / Batman"], ["Heath Ledger", "Joker"], ["Aaron Eckhart", "Harvey Dent"], ["Gary Oldman", "James Gordon"]],
  },
  {
    wikiPage: "Interstellar (film)", name: "Interstellar", type: "movie", year: 2014,
    genres: ["Sci-Fi", "Drama", "Adventure"], imdbId: "tt0816692",
    imdbRating: 8.7, rottenTomatoesScore: 73, runtimeMinutes: 169, popularity: 93,
    providers: [["Paramount+", "stream"], ["Apple TV", "rent"]],
    cast: [["Matthew McConaughey", "Cooper"], ["Anne Hathaway", "Brand"], ["Jessica Chastain", "Murph"], ["Michael Caine", "Professor Brand"]],
  },
  {
    wikiPage: "Spirited Away", name: "Spirited Away", type: "movie", year: 2001,
    genres: ["Animation", "Fantasy", "Adventure"],
    altTitles: ["Sen to Chihiro no Kamikakushi", "千と千尋の神隠し"], imdbId: "tt0245429",
    imdbRating: 8.6, rottenTomatoesScore: 96, runtimeMinutes: 125, popularity: 92,
    providers: [["Max", "stream"], ["Apple TV", "buy"]],
    cast: [["Rumi Hiiragi", "Chihiro Ogino (voice)"], ["Miyu Irino", "Haku (voice)"], ["Mari Natsuki", "Yubaba (voice)"]],
  },
  {
    wikiPage: "The Shawshank Redemption", name: "The Shawshank Redemption", type: "movie", year: 1994,
    genres: ["Drama", "Crime"], imdbId: "tt0111161",
    imdbRating: 9.3, rottenTomatoesScore: 89, runtimeMinutes: 142, popularity: 95,
    providers: [["Amazon Video", "rent"], ["Apple TV", "buy"]],
    cast: [["Tim Robbins", "Andy Dufresne"], ["Morgan Freeman", "Ellis Boyd 'Red' Redding"], ["Bob Gunton", "Warden Norton"]],
  },
  {
    wikiPage: "Free Solo", name: "Free Solo", type: "documentary", year: 2018,
    genres: ["Documentary", "Sport", "Adventure"], imdbId: "tt7775622",
    imdbRating: 8.1, rottenTomatoesScore: 97, runtimeMinutes: 100, popularity: 78,
    providers: [["Disney+", "stream"], ["Apple TV", "rent"]],
    cast: [["Alex Honnold", "Self"], ["Tommy Caldwell", "Self"], ["Jimmy Chin", "Self"]],
  },
];

const SAFETY_SOURCES = [
  { sourceName: "Common Sense Media", tier: 1, url: "https://www.commonsensemedia.org" },
  { sourceName: "Kids-In-Mind", tier: 1, url: "https://kids-in-mind.com" },
  { sourceName: "Does the Dog Die?", tier: 2, url: "https://www.doesthedogdie.com" },
  { sourceName: "CringeMDb", tier: 2, url: "https://cringemdb.com" },
];

const stripTags = (s: string | null | undefined) =>
  (s ?? "").replace(/<[^>]+>/g, "").trim() || null;

async function insertCommon(titleId: number, imdbId: string | null, tvmazeId?: number) {
  // Honest safety state: no live safety integrations yet -> provider_unavailable.
  await db.insert(safetyRecordsTable).values(
    SAFETY_SOURCES.map((s) => ({
      titleId,
      sourceName: s.sourceName,
      tier: s.tier,
      url: s.url,
      status: "provider_unavailable" as const,
      isCommunity: false,
      items: [],
    })),
  );
  await db.insert(providerMappingsTable).values([
    { titleId, provider: "TMDB", externalId: null, status: "missing", lastRefreshedAt: new Date() },
    ...(tvmazeId
      ? [{ titleId, provider: "TVMaze", externalId: String(tvmazeId), status: "mapped" as const, lastRefreshedAt: new Date() }]
      : []),
    ...(imdbId
      ? [{ titleId, provider: "IMDb", externalId: imdbId, status: "mapped" as const, lastRefreshedAt: new Date() }]
      : []),
    ...SAFETY_SOURCES.map((s) => ({
      titleId,
      provider: s.sourceName,
      externalId: null,
      status: "missing" as const,
      lastRefreshedAt: new Date(),
    })),
  ]);
}

async function seedShow(spec: ShowSpec, show: any) {
  // Skip specials (null episode number) — they break episode-progression semantics.
  const episodes: any[] = (show._embedded?.episodes ?? []).filter(
    (e: any) => typeof e.number === "number" && e.number > 0,
  );
  const cast: any[] = (show._embedded?.cast ?? []).slice(0, 8);

  const [title] = await db
    .insert(titlesTable)
    .values({
      type: spec.type,
      name: show.name,
      overview: stripTags(show.summary),
      posterUrl: show.image?.original ?? show.image?.medium ?? null,
      backdropUrl: show.image?.original ?? null,
      year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
      genres: show.genres?.length ? show.genres : [spec.type === "documentary" ? "Documentary" : "Drama"],
      altTitles: spec.altTitles ?? [],
      imdbRating: show.rating?.average ?? null,
      rottenTomatoesScore: null,
      runtimeMinutes: show.averageRuntime ?? show.runtime ?? null,
      status: show.status === "Running" ? "Returning Series" : show.status ?? null,
      popularity: spec.popularity,
      imdbId: show.externals?.imdb ?? null,
    })
    .returning();

  if (cast.length) {
    await db.insert(castMembersTable).values(
      cast.map((c: any, i: number) => ({
        titleId: title.id,
        name: c.person?.name ?? "Unknown",
        character: c.character?.name ?? "Unknown",
        photoUrl: c.person?.image?.medium ?? null,
        ord: i,
      })),
    );
  }

  const network = show.network?.name ?? show.webChannel?.name;
  await db.insert(watchProvidersTable).values([
    ...(network ? [{ titleId: title.id, name: network, kind: "stream" }] : []),
    { titleId: title.id, name: "Apple TV", kind: "buy" },
  ]);

  const seasonNumbers = [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b);
  for (const sn of seasonNumbers) {
    await db.insert(seasonsTable).values({
      titleId: title.id,
      seasonNumber: sn,
      name: `Season ${sn}`,
    });
    const eps = episodes.filter((e) => e.season === sn);
    for (let i = 0; i < eps.length; i += 100) {
      await db.insert(episodesTable).values(
        eps.slice(i, i + 100).map((e) => ({
          titleId: title.id,
          seasonNumber: sn,
          episodeNumber: e.number,
          name: e.name ?? `Episode ${e.number}`,
          overview: stripTags(e.summary),
          runtimeMinutes: e.runtime ?? null,
          airDate: e.airdate || null,
          stillUrl: e.image?.medium ?? null,
        })),
      );
    }
  }

  await insertCommon(title.id, show.externals?.imdb ?? null, spec.tvmazeId);
  console.log(`✓ ${show.name} (${episodes.length} episodes)`);
}

async function fetchMovieData(spec: MovieSpec) {
  let overview: string | null = null;
  let posterUrl: string | null = null;
  try {
    const wiki = await getJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(spec.wikiPage)}`,
    );
    overview = wiki.extract ?? null;
    posterUrl = wiki.originalimage?.source ?? wiki.thumbnail?.source ?? null;
  } catch (e) {
    throw new Error(`Wikipedia fetch failed for ${spec.name}: ${e}`);
  }
  if (!overview || !posterUrl) {
    throw new Error(`Wikipedia payload incomplete for ${spec.name}`);
  }
  return { overview, posterUrl };
}

async function seedMovie(
  spec: MovieSpec,
  data: { overview: string | null; posterUrl: string | null },
) {
  const { overview, posterUrl } = data;
  const [title] = await db
    .insert(titlesTable)
    .values({
      type: spec.type,
      name: spec.name,
      overview,
      posterUrl,
      backdropUrl: null,
      year: spec.year,
      genres: spec.genres,
      altTitles: spec.altTitles ?? [],
      imdbRating: spec.imdbRating,
      rottenTomatoesScore: spec.rottenTomatoesScore,
      runtimeMinutes: spec.runtimeMinutes,
      status: "Released",
      popularity: spec.popularity,
      imdbId: spec.imdbId,
    })
    .returning();

  await db.insert(castMembersTable).values(
    spec.cast.map(([name, character], i) => ({ titleId: title.id, name, character, ord: i })),
  );
  await db.insert(watchProvidersTable).values(
    spec.providers.map(([name, kind]) => ({ titleId: title.id, name, kind })),
  );
  await insertCommon(title.id, spec.imdbId);
  console.log(`✓ ${spec.name}`);
}

async function main() {
  // Phase 1: fetch ALL remote data first, so a network failure never leaves
  // the database half-wiped or half-seeded.
  console.log("Fetching remote data (no DB changes yet)…");
  const showPayloads: any[] = [];
  for (const spec of SHOWS) {
    const show = await getJson(
      `https://api.tvmaze.com/shows/${spec.tvmazeId}?embed[]=episodes&embed[]=cast`,
    );
    if (!show?.name || !show._embedded?.episodes?.length) {
      throw new Error(`TVMaze payload incomplete for id ${spec.tvmazeId}`);
    }
    showPayloads.push(show);
    console.log(`  fetched ${show.name}`);
    await sleep(600); // TVMaze rate limit courtesy
  }
  const moviePayloads: { overview: string | null; posterUrl: string | null }[] = [];
  for (const spec of MOVIES) {
    moviePayloads.push(await fetchMovieData(spec));
    console.log(`  fetched ${spec.name}`);
    await sleep(300);
  }

  // Phase 2: destructive replace. WARNING: cascades to user watch data.
  console.log("Wiping existing catalog…");
  await db.execute(sql`TRUNCATE TABLE titles RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE integration_health RESTART IDENTITY CASCADE`);

  for (let i = 0; i < SHOWS.length; i++) {
    await seedShow(SHOWS[i], showPayloads[i]);
  }
  for (let i = 0; i < MOVIES.length; i++) {
    await seedMovie(MOVIES[i], moviePayloads[i]);
  }

  await db.insert(integrationHealthTable).values([
    { provider: "TVMaze", status: "healthy", successRatePercent: 100, mappedTitles: SHOWS.length, missingMappings: 0, lastSyncAt: new Date(), lastSuccessAt: new Date() },
    { provider: "TMDB", status: "provider_unavailable", lastError: "API key not configured", successRatePercent: 0, mappedTitles: 0, missingMappings: SHOWS.length + MOVIES.length, lastSyncAt: null, lastSuccessAt: null },
    { provider: "Common Sense Media", status: "provider_unavailable", lastError: "No integration configured", successRatePercent: 0, mappedTitles: 0, missingMappings: SHOWS.length + MOVIES.length, lastSyncAt: null, lastSuccessAt: null },
    { provider: "Kids-In-Mind", status: "provider_unavailable", lastError: "No integration configured", successRatePercent: 0, mappedTitles: 0, missingMappings: SHOWS.length + MOVIES.length, lastSyncAt: null, lastSuccessAt: null },
    { provider: "Does the Dog Die?", status: "provider_unavailable", lastError: "No integration configured", successRatePercent: 0, mappedTitles: 0, missingMappings: SHOWS.length + MOVIES.length, lastSyncAt: null, lastSuccessAt: null },
    { provider: "CringeMDb", status: "provider_unavailable", lastError: "No integration configured", successRatePercent: 0, mappedTitles: 0, missingMappings: SHOWS.length + MOVIES.length, lastSyncAt: null, lastSuccessAt: null },
  ]);

  console.log("Done.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
