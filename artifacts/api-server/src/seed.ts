/**
 * Seed the WatchTime catalog. Idempotent: skips if titles already exist.
 * Run: pnpm --filter @workspace/api-server exec tsx src/seed.ts
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
  analyticsEventsTable,
  type SafetyItem,
} from "@workspace/db";
import { sql } from "drizzle-orm";

type SeedSeason = { name: string; episodes: [string, string | null, number][] };
type SeedTitle = {
  slug: string;
  type: "movie" | "tv" | "anime" | "documentary";
  name: string;
  overview: string;
  year: number;
  genres: string[];
  altTitles?: string[];
  imdbRating: number;
  rottenTomatoesScore: number;
  runtimeMinutes?: number;
  status?: string;
  popularity: number;
  hasBackdrop?: boolean;
  cast: [string, string][];
  providers: [string, "stream" | "rent" | "buy"][];
  seasons?: SeedSeason[];
  safety?: {
    seasonNumber?: number;
    episodeNumber?: number;
    sourceName: string;
    tier: number;
    isCommunity?: boolean;
    ageRecommendation?: string;
    url?: string;
    status?: "available" | "provider_unavailable";
    items: SafetyItem[];
  }[];
};

const it = (
  category: string,
  label: string,
  score: number | null,
  maxScore: number | null,
  description: string | null,
  severity?: SafetyItem["severity"],
): SafetyItem => ({ category, label, score, maxScore, description, severity });

const eps = (n: number, prefix: string, runtime = 44): [string, null, number][] =>
  Array.from({ length: n }, (_, i) => [`${prefix} ${i + 1}`, null, runtime]);

const TITLES: SeedTitle[] = [
  {
    slug: "ashfall-directive",
    type: "tv",
    name: "Ashfall Directive",
    overview:
      "When a dormant supervolcano wakes beneath a remote research town, a disgraced volcanologist must expose the government directive that buried the warnings.",
    year: 2024,
    genres: ["Sci-Fi", "Thriller", "Drama"],
    altTitles: ["Directive: Ashfall", "Proyecto Ceniza"],
    imdbRating: 8.4,
    rottenTomatoesScore: 92,
    status: "Returning Series",
    popularity: 98,
    hasBackdrop: true,
    cast: [
      ["Mara Ellison", "Dr. Ivy Chen"],
      ["Tomas Reyes", "Marshal Cole"],
      ["Priya Nandi", "Director Vance"],
      ["Owen Halloran", "Gil Mercer"],
    ],
    providers: [
      ["Streamline", "stream"],
      ["PrimeView", "rent"],
    ],
    seasons: [
      { name: "Season 1", episodes: eps(8, "Tremor") },
      { name: "Season 2", episodes: eps(8, "Fallout") },
    ],
    safety: [
      {
        sourceName: "Common Sense Media",
        tier: 1,
        ageRecommendation: "14+",
        url: "https://www.commonsensemedia.org",
        items: [
          it("Violence", "Violence & Scariness", 3, 5, "Disaster peril, injuries shown, some blood."),
          it("Language", "Language", 2, 5, "Occasional strong language."),
          it("Sex", "Sex, Romance & Nudity", 1, 5, "Brief kissing."),
          it("Drinking", "Drinking, Drugs & Smoking", 2, 5, "Adults drink socially."),
        ],
      },
      {
        sourceName: "Kids-In-Mind",
        tier: 1,
        url: "https://kids-in-mind.com",
        items: [
          it("Sex", "Sex/Nudity", 2, 10, null),
          it("Violence", "Violence/Gore", 5, 10, null),
          it("Language", "Language", 4, 10, null),
        ],
      },
      {
        sourceName: "Does the Dog Die?",
        tier: 2,
        url: "https://www.doesthedogdie.com",
        items: [
          it("Animals", "Does a pet die?", null, null, "A search-and-rescue dog is injured but survives.", "mild"),
          it("Triggers", "Natural disaster imagery", null, null, "Extended volcanic eruption sequences.", "moderate"),
        ],
      },
      {
        seasonNumber: 2,
        episodeNumber: 3,
        sourceName: "WatchTime Community",
        tier: 3,
        isCommunity: true,
        items: [
          it("Triggers", "Medical trauma", null, null, "A prolonged field-surgery scene in the second act.", "moderate"),
        ],
      },
      { sourceName: "CringeMDb", tier: 2, status: "provider_unavailable", items: [] },
    ],
  },
  {
    slug: "harbor-lane",
    type: "tv",
    name: "Harbor Lane",
    overview:
      "Three generations of the Calloway family run a struggling seaside inn, mending old wounds one summer guest at a time.",
    year: 2022,
    genres: ["Drama", "Family"],
    imdbRating: 7.9,
    rottenTomatoesScore: 88,
    status: "Ended",
    popularity: 82,
    cast: [
      ["June Albright", "Nora Calloway"],
      ["Desmond Cole", "Frank Calloway"],
      ["Lily Marsh", "Piper Calloway"],
    ],
    providers: [["Streamline", "stream"], ["Hoopla", "stream"]],
    seasons: [
      { name: "Season 1", episodes: eps(10, "Chapter", 42) },
      { name: "Season 2", episodes: eps(10, "Chapter", 42) },
      { name: "Season 3", episodes: eps(8, "Chapter", 42) },
    ],
    safety: [
      {
        sourceName: "Common Sense Media",
        tier: 1,
        ageRecommendation: "10+",
        url: "https://www.commonsensemedia.org",
        items: [
          it("Violence", "Violence & Scariness", 1, 5, "Mild arguments; a storm sequence."),
          it("Language", "Language", 1, 5, "Rare mild language."),
          it("Positive", "Positive Messages", 4, 5, "Strong themes of family and forgiveness."),
        ],
      },
      { sourceName: "Kids-In-Mind", tier: 1, status: "provider_unavailable", items: [] },
      {
        sourceName: "Does the Dog Die?",
        tier: 2,
        url: "https://www.doesthedogdie.com",
        items: [it("Animals", "Does a pet die?", null, null, "An elderly cat passes away peacefully in season 3.", "mild")],
      },
    ],
  },
  {
    slug: "quantum-alley",
    type: "tv",
    name: "Quantum Alley",
    overview:
      "Two broke physicists open a repair shop for impossible gadgets in a back alley where the laws of physics take lunch breaks.",
    year: 2023,
    genres: ["Comedy", "Sci-Fi"],
    imdbRating: 8.1,
    rottenTomatoesScore: 90,
    status: "Returning Series",
    popularity: 76,
    cast: [
      ["Ravi Menon", "Dev"],
      ["Sasha Bloom", "Wren"],
    ],
    providers: [["NebulaTV", "stream"]],
    seasons: [{ name: "Season 1", episodes: eps(12, "Experiment", 24) }],
    safety: [
      {
        sourceName: "Common Sense Media",
        tier: 1,
        ageRecommendation: "11+",
        url: "https://www.commonsensemedia.org",
        items: [
          it("Language", "Language", 2, 5, "Some crude humor."),
          it("Violence", "Violence & Scariness", 1, 5, "Cartoonish mishaps."),
        ],
      },
      { sourceName: "Kids-In-Mind", tier: 1, status: "provider_unavailable", items: [] },
      { sourceName: "Does the Dog Die?", tier: 2, status: "provider_unavailable", items: [] },
    ],
  },
  {
    slug: "signal-lost",
    type: "tv",
    name: "Signal Lost",
    overview:
      "An arctic radio operator intercepts a distress call from a station that burned down thirty years ago.",
    year: 2025,
    genres: ["Mystery", "Thriller", "Horror"],
    imdbRating: 8.7,
    rottenTomatoesScore: 95,
    status: "Returning Series",
    popularity: 94,
    cast: [
      ["Ingrid Solheim", "Astrid Berg"],
      ["Callum Frost", "Dr. Emil Hart"],
    ],
    providers: [["Streamline", "stream"], ["PrimeView", "buy"]],
    seasons: [{ name: "Season 1", episodes: eps(6, "Transmission", 52) }],
    safety: [
      {
        sourceName: "Common Sense Media",
        tier: 1,
        ageRecommendation: "16+",
        url: "https://www.commonsensemedia.org",
        items: [
          it("Violence", "Violence & Scariness", 4, 5, "Intense psychological horror, frozen bodies, jump scares."),
          it("Language", "Language", 3, 5, "Frequent strong language."),
        ],
      },
      {
        sourceName: "Kids-In-Mind",
        tier: 1,
        url: "https://kids-in-mind.com",
        items: [
          it("Sex", "Sex/Nudity", 1, 10, null),
          it("Violence", "Violence/Gore", 7, 10, null),
          it("Language", "Language", 6, 10, null),
        ],
      },
      {
        seasonNumber: 1,
        sourceName: "Does the Dog Die?",
        tier: 2,
        url: "https://www.doesthedogdie.com",
        items: [
          it("Animals", "Does a dog die?", null, null, "A sled dog goes missing in episode 4; its fate is left ambiguous.", "moderate"),
          it("Triggers", "Claustrophobia", null, null, "Extended scenes inside a collapsed ice tunnel.", "severe"),
        ],
      },
    ],
  },
  {
    slug: "cherry-blossom-detectives",
    type: "anime",
    name: "Cherry Blossom Detectives",
    overview:
      "Two high schoolers solve gentle neighborhood mysteries in a Tokyo suburb where every case blooms into something bigger.",
    year: 2023,
    genres: ["Mystery", "Slice of Life", "Animation"],
    altTitles: ["Sakura Tantei-bu", "桜探偵部"],
    imdbRating: 8.2,
    rottenTomatoesScore: 91,
    status: "Returning Series",
    popularity: 88,
    hasBackdrop: true,
    cast: [
      ["Aoi Natsume (VA)", "Hana Sakamoto"],
      ["Kenta Mori (VA)", "Riku Tanabe"],
    ],
    providers: [["AniStream", "stream"]],
    seasons: [
      { name: "Season 1", episodes: eps(12, "Case", 23) },
      { name: "Season 2", episodes: eps(12, "Case", 23) },
    ],
    safety: [
      {
        sourceName: "Common Sense Media",
        tier: 1,
        ageRecommendation: "9+",
        url: "https://www.commonsensemedia.org",
        items: [
          it("Violence", "Violence & Scariness", 1, 5, "Very mild peril."),
          it("Positive", "Positive Messages", 5, 5, "Friendship, curiosity, and community."),
        ],
      },
      { sourceName: "Kids-In-Mind", tier: 1, status: "provider_unavailable", items: [] },
      { sourceName: "Does the Dog Die?", tier: 2, status: "provider_unavailable", items: [] },
    ],
  },
  {
    slug: "starforge-chronicle",
    type: "anime",
    name: "Starforge Chronicle",
    overview:
      "A cadet inherits a dying mech powered by a captive star and must decide whether to save her fleet or free the star itself.",
    year: 2024,
    genres: ["Action", "Sci-Fi", "Animation"],
    altTitles: ["Hoshi no Rensei", "星の錬成"],
    imdbRating: 8.9,
    rottenTomatoesScore: 96,
    status: "Returning Series",
    popularity: 96,
    cast: [
      ["Yuki Amane (VA)", "Sora Ishikawa"],
      ["Daichi Kobe (VA)", "Commander Rhee"],
    ],
    providers: [["AniStream", "stream"], ["NebulaTV", "stream"]],
    seasons: [{ name: "Season 1", episodes: eps(13, "Phase", 24) }],
    safety: [
      {
        sourceName: "Common Sense Media",
        tier: 1,
        ageRecommendation: "13+",
        url: "https://www.commonsensemedia.org",
        items: [
          it("Violence", "Violence & Scariness", 3, 5, "Stylized mech battles, character deaths off-screen."),
          it("Language", "Language", 1, 5, "Mild insults."),
        ],
      },
      {
        seasonNumber: 1,
        episodeNumber: 9,
        sourceName: "WatchTime Community",
        tier: 3,
        isCommunity: true,
        items: [
          it("Triggers", "Flashing lights", null, null, "Rapid strobing during the reactor breach sequence.", "severe"),
        ],
      },
      { sourceName: "Kids-In-Mind", tier: 1, status: "provider_unavailable", items: [] },
    ],
  },
  {
    slug: "the-deep-below",
    type: "documentary",
    name: "The Deep Below",
    overview:
      "A landmark natural history series descending through the ocean's midnight zones with cameras that see by starlight.",
    year: 2024,
    genres: ["Documentary", "Nature"],
    imdbRating: 9.1,
    rottenTomatoesScore: 98,
    status: "Ended",
    popularity: 90,
    hasBackdrop: true,
    cast: [["Adaeze Okafor", "Narrator"]],
    providers: [["Streamline", "stream"], ["PrimeView", "buy"]],
    seasons: [{ name: "Season 1", episodes: eps(5, "Descent", 50) }],
    safety: [
      {
        sourceName: "Common Sense Media",
        tier: 1,
        ageRecommendation: "7+",
        url: "https://www.commonsensemedia.org",
        items: [
          it("Violence", "Violence & Scariness", 2, 5, "Natural predation shown; some tense sequences."),
          it("Positive", "Educational Value", 5, 5, "Outstanding marine science content."),
        ],
      },
      {
        sourceName: "Does the Dog Die?",
        tier: 2,
        url: "https://www.doesthedogdie.com",
        items: [it("Animals", "Do animals die?", null, null, "Natural predation is shown in several episodes.", "moderate")],
      },
    ],
  },
  {
    slug: "concrete-giants",
    type: "documentary",
    name: "Concrete Giants",
    overview:
      "The rise, fall, and unlikely second lives of the world's most controversial brutalist buildings.",
    year: 2023,
    genres: ["Documentary", "History"],
    imdbRating: 7.8,
    rottenTomatoesScore: 85,
    status: "Ended",
    popularity: 64,
    cast: [["Marcus Webb", "Narrator"]],
    providers: [["NebulaTV", "stream"]],
    seasons: [{ name: "Season 1", episodes: eps(4, "Monument", 48) }],
    safety: [
      {
        sourceName: "Common Sense Media",
        tier: 1,
        ageRecommendation: "8+",
        url: "https://www.commonsensemedia.org",
        items: [it("Positive", "Educational Value", 4, 5, "Architecture and social history.")],
      },
      { sourceName: "Kids-In-Mind", tier: 1, status: "provider_unavailable", items: [] },
    ],
  },
  {
    slug: "midnight-cartographer",
    type: "movie",
    name: "Midnight Cartographer",
    overview:
      "A mapmaker discovers that the streets she draws at night rearrange the waking city, and someone is paying to redraw it.",
    year: 2025,
    genres: ["Fantasy", "Mystery"],
    imdbRating: 8.0,
    rottenTomatoesScore: 89,
    runtimeMinutes: 118,
    popularity: 86,
    cast: [
      ["Elena Voss", "Margo Lin"],
      ["Theo Anand", "The Broker"],
    ],
    providers: [["PrimeView", "rent"], ["PrimeView", "buy"]],
    safety: [
      {
        sourceName: "Common Sense Media",
        tier: 1,
        ageRecommendation: "12+",
        url: "https://www.commonsensemedia.org",
        items: [
          it("Violence", "Violence & Scariness", 2, 5, "A rooftop chase; brief dream-logic peril."),
          it("Language", "Language", 2, 5, "Some strong language."),
        ],
      },
      {
        sourceName: "Kids-In-Mind",
        tier: 1,
        url: "https://kids-in-mind.com",
        items: [
          it("Sex", "Sex/Nudity", 2, 10, null),
          it("Violence", "Violence/Gore", 3, 10, null),
          it("Language", "Language", 4, 10, null),
        ],
      },
      {
        sourceName: "CringeMDb",
        tier: 2,
        url: "https://cringemdb.com",
        items: [it("Family", "Safe to watch with parents?", null, null, "No explicit scenes; one brief kiss.", "none")],
      },
    ],
  },
  {
    slug: "the-last-lighthouse",
    type: "movie",
    name: "The Last Lighthouse",
    overview:
      "As an automated network replaces the coast's beacons, the final keeper refuses to let her light go dark during the storm of the century.",
    year: 2024,
    genres: ["Drama", "Adventure"],
    imdbRating: 8.5,
    rottenTomatoesScore: 93,
    runtimeMinutes: 127,
    popularity: 92,
    hasBackdrop: true,
    cast: [
      ["Siobhan McKenna", "Keeper Aila Brody"],
      ["Rowan Pierce", "Inspector Dunn"],
    ],
    providers: [["Streamline", "stream"], ["PrimeView", "rent"]],
    safety: [
      {
        sourceName: "Common Sense Media",
        tier: 1,
        ageRecommendation: "10+",
        url: "https://www.commonsensemedia.org",
        items: [
          it("Violence", "Violence & Scariness", 2, 5, "Storm peril, a near-drowning."),
          it("Positive", "Positive Role Models", 4, 5, "Perseverance and duty."),
        ],
      },
      {
        sourceName: "Does the Dog Die?",
        tier: 2,
        url: "https://www.doesthedogdie.com",
        items: [it("Animals", "Does a pet die?", null, null, "The keeper's parrot survives the storm.", "none")],
      },
    ],
  },
  {
    slug: "paper-comets",
    type: "movie",
    name: "Paper Comets",
    overview:
      "Two estranged best friends reunite for one last summer project: launching a thousand paper airplanes with messages to strangers.",
    year: 2023,
    genres: ["Comedy", "Drama"],
    imdbRating: 7.6,
    rottenTomatoesScore: 84,
    runtimeMinutes: 102,
    popularity: 70,
    cast: [
      ["Milo Park", "Ezra"],
      ["Dana Whitfield", "Coop"],
    ],
    providers: [["Hoopla", "stream"]],
    safety: [
      {
        sourceName: "Common Sense Media",
        tier: 1,
        ageRecommendation: "11+",
        url: "https://www.commonsensemedia.org",
        items: [
          it("Language", "Language", 2, 5, "Teen banter, some crude jokes."),
          it("Drinking", "Drinking, Drugs & Smoking", 1, 5, "A party scene with beer in background."),
        ],
      },
      { sourceName: "Kids-In-Mind", tier: 1, status: "provider_unavailable", items: [] },
      { sourceName: "CringeMDb", tier: 2, status: "provider_unavailable", items: [] },
    ],
  },
  {
    slug: "iron-orchard",
    type: "movie",
    name: "Iron Orchard",
    overview:
      "Decades after the war, a mechanic tends an orchard grown through the wrecks of siege engines until scavengers come for the metal beneath the roots.",
    year: 2025,
    genres: ["Action", "Sci-Fi"],
    imdbRating: 7.9,
    rottenTomatoesScore: 87,
    runtimeMinutes: 121,
    popularity: 84,
    cast: [
      ["Katya Molnar", "Vera"],
      ["Jules Ambrose", "Halloway"],
    ],
    providers: [["Streamline", "stream"], ["PrimeView", "buy"]],
    safety: [
      {
        sourceName: "Common Sense Media",
        tier: 1,
        ageRecommendation: "14+",
        url: "https://www.commonsensemedia.org",
        items: [
          it("Violence", "Violence & Scariness", 4, 5, "Sustained action violence, some blood."),
          it("Language", "Language", 3, 5, "Frequent strong language."),
        ],
      },
      {
        sourceName: "Kids-In-Mind",
        tier: 1,
        url: "https://kids-in-mind.com",
        items: [
          it("Sex", "Sex/Nudity", 1, 10, null),
          it("Violence", "Violence/Gore", 6, 10, null),
          it("Language", "Language", 5, 10, null),
        ],
      },
    ],
  },
];

async function main() {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(titlesTable);
  if (count > 0) {
    console.log(`Catalog already seeded (${count} titles); skipping.`);
    return;
  }

  for (const t of TITLES) {
    const [title] = await db
      .insert(titlesTable)
      .values({
        type: t.type,
        name: t.name,
        overview: t.overview,
        posterUrl: `/posters/${t.slug}.jpg`,
        backdropUrl: t.hasBackdrop ? `/backdrops/${t.slug}.jpg` : null,
        year: t.year,
        genres: t.genres,
        altTitles: t.altTitles ?? [],
        imdbRating: t.imdbRating,
        rottenTomatoesScore: t.rottenTomatoesScore,
        runtimeMinutes: t.runtimeMinutes ?? null,
        status: t.status ?? (t.type === "movie" ? "Released" : null),
        popularity: t.popularity,
      })
      .returning();

    await db.insert(castMembersTable).values(
      t.cast.map(([name, character], i) => ({
        titleId: title.id,
        name,
        character,
        ord: i,
      })),
    );
    await db.insert(watchProvidersTable).values(
      t.providers.map(([name, kind]) => ({ titleId: title.id, name, kind })),
    );

    if (t.seasons) {
      for (let s = 0; s < t.seasons.length; s++) {
        const season = t.seasons[s];
        await db.insert(seasonsTable).values({
          titleId: title.id,
          seasonNumber: s + 1,
          name: season.name,
        });
        await db.insert(episodesTable).values(
          season.episodes.map(([name, overview, runtime], i) => ({
            titleId: title.id,
            seasonNumber: s + 1,
            episodeNumber: i + 1,
            name,
            overview,
            runtimeMinutes: runtime,
            airDate: `${t.year + s}-${String((i % 12) + 1).padStart(2, "0")}-07`,
          })),
        );
      }
    }

    if (t.safety) {
      await db.insert(safetyRecordsTable).values(
        t.safety.map((s) => ({
          titleId: title.id,
          seasonNumber: s.seasonNumber ?? null,
          episodeNumber: s.episodeNumber ?? null,
          sourceName: s.sourceName,
          tier: s.tier,
          isCommunity: s.isCommunity ?? false,
          ageRecommendation: s.ageRecommendation ?? null,
          url: s.url ?? null,
          status: s.status ?? "available",
          items: s.items,
        })),
      );
    }

    const hasTmdb = Math.random() > 0.15;
    await db.insert(providerMappingsTable).values([
      {
        titleId: title.id,
        provider: "TMDB",
        externalId: hasTmdb ? String(100000 + title.id * 37) : null,
        status: hasTmdb ? "mapped" : "missing",
        lastRefreshedAt: new Date(),
      },
      {
        titleId: title.id,
        provider: "Common Sense Media",
        externalId: t.safety?.some((s) => s.sourceName === "Common Sense Media" && s.status !== "provider_unavailable")
          ? t.slug
          : null,
        status: t.safety?.some((s) => s.sourceName === "Common Sense Media" && s.status !== "provider_unavailable")
          ? "mapped"
          : "missing",
        lastRefreshedAt: new Date(),
      },
      {
        titleId: title.id,
        provider: "Does the Dog Die?",
        externalId: t.safety?.some((s) => s.sourceName === "Does the Dog Die?" && s.status !== "provider_unavailable")
          ? t.slug
          : null,
        status: t.safety?.some((s) => s.sourceName === "Does the Dog Die?" && s.status !== "provider_unavailable")
          ? "mapped"
          : "missing",
        lastRefreshedAt: new Date(),
      },
    ]);
  }

  const now = Date.now();
  await db.insert(integrationHealthTable).values([
    { provider: "TMDB", status: "provider_unavailable", lastError: "API key not configured", successRatePercent: 0, mappedTitles: 10, missingMappings: 2, lastSyncAt: null, lastSuccessAt: null },
    { provider: "Common Sense Media", status: "healthy", successRatePercent: 98.5, mappedTitles: 12, missingMappings: 0, lastSyncAt: new Date(now - 3600e3), lastSuccessAt: new Date(now - 3600e3) },
    { provider: "Kids-In-Mind", status: "degraded", lastError: "Rate limited on 2 of 12 lookups", successRatePercent: 83.3, mappedTitles: 8, missingMappings: 4, lastSyncAt: new Date(now - 7200e3), lastSuccessAt: new Date(now - 7200e3) },
    { provider: "Does the Dog Die?", status: "healthy", successRatePercent: 100, mappedTitles: 9, missingMappings: 3, lastSyncAt: new Date(now - 1800e3), lastSuccessAt: new Date(now - 1800e3) },
    { provider: "CringeMDb", status: "failing", lastError: "Connection timeout", successRatePercent: 41.7, mappedTitles: 3, missingMappings: 9, lastSyncAt: new Date(now - 900e3), lastSuccessAt: new Date(now - 86400e3) },
  ]);

  // Sample analytics events over the past 14 days so admin charts have shape.
  const events: (typeof analyticsEventsTable.$inferInsert)[] = [];
  const devices = ["desktop", "mobile", "tablet"];
  const countries = ["US", "SA", "GB", "DE", "JP", "BR"];
  const titleNames = TITLES.map((t) => t.name);
  const queries = ["ashfall", "sakura", "lighthouse", "deep sea", "anime", "signal"];
  for (let d = 13; d >= 0; d--) {
    const day = new Date(now - d * 86400e3);
    const visits = 20 + Math.floor(Math.random() * 40);
    for (let i = 0; i < visits; i++) {
      events.push({
        eventType: "visit",
        name: null,
        device: devices[Math.floor(Math.random() * devices.length)],
        country: countries[Math.floor(Math.random() * countries.length)],
        createdAt: new Date(day.getTime() + Math.random() * 86400e3),
      });
    }
    for (let i = 0; i < 8; i++) {
      events.push({
        eventType: "title_view",
        name: titleNames[Math.floor(Math.random() * titleNames.length)],
        createdAt: new Date(day.getTime() + Math.random() * 86400e3),
      });
      events.push({
        eventType: "safety_view",
        name: titleNames[Math.floor(Math.random() * titleNames.length)],
        createdAt: new Date(day.getTime() + Math.random() * 86400e3),
      });
    }
    for (let i = 0; i < 4; i++) {
      events.push({
        eventType: "search",
        name: queries[Math.floor(Math.random() * queries.length)],
        createdAt: new Date(day.getTime() + Math.random() * 86400e3),
      });
    }
  }
  await db.insert(analyticsEventsTable).values(events);

  console.log(`Seeded ${TITLES.length} titles.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
