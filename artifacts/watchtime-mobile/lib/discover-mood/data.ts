import {
  CONTENT_KEYS,
  MOOD_KEYS,
  REGIONS,
  PROVIDERS,
  type Availability,
  type ContentKey,
  type Context,
  type MoodKey,
  type Movie,
  type ResultSort,
} from "./types";

// DEMO DATA: every film, rating, content level and availability entry below is invented
// and unverified. None of it is a factual safety or streaming claim.

type Row = [
  title: string,
  year: number,
  runtime: number,
  director: string,
  genres: string[],
  langs: string[],
  subs: string[],
  age: string,
  mood: number[],
  content: number[],
  tags: string[],
  summary: string,
];

const ROWS: Row[] = [
  ["The Lantern Keepers", 2019, 98, "Mara Ellison", ["fantasy", "family"], ["en"], ["ar", "fr", "es"], "PG", [88, 35, 55, 15, 5, 40, 20, 90, 55, 90], [0, 1, 0, 0, 0, 0], ["family", "rainy"], "Two siblings inherit a seaside job lighting lamps for lost travellers."],
  ["Salt Road Summer", 2021, 104, "Idris Haddad", ["drama", "romance"], ["ar", "fr"], ["en"], "PG-13", [82, 30, 40, 5, 5, 35, 35, 80, 40, 70], [1, 0, 0, 1, 0, 0], ["partner", "solo"], "A translator and a van mechanic share one coastal drive and too many detours."],
  ["Midnight at Gantry Pier", 2018, 117, "Corin Vale", ["thriller", "crime"], ["en"], ["ar", "fr", "es"], "R", [20, 85, 5, 70, 55, 85, 60, 25, 80, 25], [1, 3, 2, 3, 1, 2], ["late", "friends"], "A night-shift dockworker sees something he was never meant to see."],
  ["Paper Moons", 2022, 92, "Yuki Arai", ["animation", "family"], ["ja"], ["en", "ar"], "G", [92, 20, 60, 0, 0, 30, 15, 95, 50, 95], [0, 0, 0, 0, 0, 0], ["family"], "A paper-cut village prepares for the one night the moon comes down to visit."],
  ["Nine Bad Decisions", 2020, 101, "Ruth Okafor", ["comedy"], ["en"], ["es", "ar"], "R", [75, 45, 92, 15, 5, 60, 10, 60, 85, 55], [2, 1, 0, 4, 0, 0], ["friends"], "One wedding weekend, nine escalating choices, zero adults in charge."],
  ["The Quiet Archive", 2017, 128, "Anselm Reuter", ["drama", "mystery"], ["de"], ["en", "ar", "fr"], "PG-13", [35, 40, 5, 10, 30, 60, 85, 45, 25, 20], [0, 1, 0, 1, 0, 2], ["solo", "focus"], "A records clerk pieces together a missing decade from misfiled letters."],
  ["Orbit of Small Hours", 2023, 109, "Priya Natarajan", ["scifi", "drama"], ["en", "hi"], ["ar"], "PG-13", [55, 50, 15, 10, 10, 70, 70, 65, 45, 80], [0, 1, 0, 1, 0, 1], ["solo", "late"], "A night-station technician keeps hearing her own voice on the radio."],
  ["Kettle & Crow", 2016, 88, "Beatrix Lund", ["comedy", "family"], ["en"], ["fr", "ar"], "PG", [85, 20, 80, 5, 0, 35, 10, 85, 70, 70], [0, 1, 0, 0, 0, 0], ["family", "rainy"], "A grumpy tea-seller and a talkative crow start a very small feud."],
  ["Ashfall Protocol", 2022, 124, "Dmitri Sokol", ["thriller", "scifi"], ["en"], ["ar", "es"], "R", [15, 95, 5, 85, 50, 80, 45, 20, 95, 50], [0, 4, 3, 3, 1, 2], ["friends", "late"], "A relief convoy crosses a volcanic exclusion zone against a closing deadline."],
  ["A Garden for Rania", 2020, 96, "Leila Mansour", ["drama"], ["ar"], ["en", "fr"], "PG-13", [60, 25, 10, 5, 25, 25, 50, 70, 25, 25], [0, 0, 0, 0, 1, 2], ["solo", "partner"], "A widow rebuilds her late daughter's rooftop garden, one pot at a time."],
  ["Velvet Static", 2019, 112, "Joon Seo", ["romance", "drama"], ["ko"], ["en", "ar"], "PG-13", [70, 35, 25, 5, 10, 45, 35, 75, 40, 60], [2, 0, 0, 1, 0, 0], ["partner"], "Two late-night radio hosts fall for each other without ever meeting."],
  ["The Third Lighthouse", 2021, 105, "Gideon Marsh", ["horror", "mystery"], ["en"], ["fr", "es"], "R", [5, 90, 0, 60, 90, 80, 40, 10, 55, 35], [1, 3, 3, 2, 2, 4], ["late"], "A relief keeper counts three lighthouses on a coast that has only two."],
  ["Brass Band Heist", 2018, 111, "Tomas Ferreira", ["comedy", "crime"], ["es"], ["en", "ar"], "PG-13", [78, 60, 75, 35, 5, 70, 25, 60, 90, 75], [0, 2, 0, 2, 0, 0], ["friends"], "A failing marching band robs a bank using only sheet music."],
  ["Where the Tide Forgets", 2023, 134, "Noor Al-Amin", ["drama"], ["ar", "en"], ["fr"], "R", [20, 60, 0, 45, 70, 45, 90, 35, 20, 10], [1, 3, 1, 2, 1, 4], ["solo", "focus"], "Three generations of a fishing family argue over what the sea took."],
  ["Sunday Pancake Club", 2015, 90, "Hana Whitcombe", ["comedy", "family"], ["en"], ["ar"], "G", [94, 10, 70, 0, 0, 20, 5, 95, 45, 70], [0, 0, 0, 0, 0, 0], ["family", "rainy"], "Neighbours start a weekly breakfast and accidentally fix a street."],
  ["Glass Harbor", 2020, 118, "Mireille Dufour", ["thriller", "drama"], ["fr"], ["en", "ar"], "R", [25, 75, 5, 55, 55, 75, 70, 30, 60, 25], [2, 3, 1, 2, 0, 3], ["solo", "late"], "A harbour inspector uncovers a quiet fraud with loud consequences."],
  ["The Mapmaker's Daughter", 2017, 121, "Kenji Morita", ["adventure", "fantasy"], ["ja", "en"], ["ar", "fr"], "PG", [80, 55, 25, 25, 5, 55, 30, 85, 75, 95], [0, 2, 0, 0, 0, 0], ["family", "friends"], "A girl redraws her father's unfinished maps and the lands answer back."],
  ["Rooftop Rehearsal", 2022, 99, "Samir Khalil", ["comedy", "drama"], ["ar"], ["en"], "PG-13", [82, 25, 70, 5, 5, 30, 20, 85, 55, 55], [0, 0, 0, 1, 0, 0], ["partner", "friends"], "A neighbourhood theatre troupe rehearses on a roof before the landlord returns."],
  ["Deep Field Silence", 2024, 142, "Ingrid Solberg", ["scifi"], ["en"], ["ar", "fr", "es"], "PG-13", [30, 55, 5, 20, 40, 60, 95, 50, 15, 70], [0, 1, 0, 0, 0, 2], ["solo", "focus"], "A single telescope operator receives a signal that repeats her own pauses."],
  ["Dog Days of Lisbon", 2019, 97, "Carla Nunes", ["comedy", "drama"], ["es", "en"], ["ar"], "PG", [86, 15, 65, 0, 0, 25, 10, 90, 50, 60], [0, 0, 0, 1, 0, 0], ["family", "partner"], "A dog walker accidentally becomes matchmaker to an entire hillside."],
  ["Knife Weather", 2016, 108, "Rafe Calloway", ["crime", "thriller"], ["en"], ["es"], "R", [10, 92, 5, 90, 60, 75, 35, 15, 90, 30], [1, 4, 4, 4, 2, 3], ["late"], "A debt collector has one cold week to settle three accounts."],
  ["The Last Picnic on Mars", 2023, 103, "Ola Adeyemi", ["scifi", "comedy"], ["en"], ["ar", "fr"], "PG", [80, 35, 85, 10, 5, 55, 20, 75, 75, 90], [0, 1, 0, 1, 0, 0], ["friends", "family"], "The final colonists insist on one properly ridiculous picnic."],
  ["Letters to Zahra", 2018, 115, "Hadiya Rahman", ["drama", "romance"], ["ar", "hi"], ["en"], "PG-13", [55, 30, 5, 5, 20, 35, 45, 75, 30, 35], [0, 0, 0, 0, 0, 1], ["partner", "solo"], "A postal worker answers undeliverable letters in an old friend's handwriting."],
  ["Hollow Orchard", 2021, 100, "Edda Falk", ["horror"], ["en"], ["de", "ar"], "18", [5, 88, 0, 80, 85, 70, 45, 8, 60, 30], [3, 4, 4, 3, 3, 4], ["late"], "A family inherits an orchard where nothing ripens but something grows."],
  ["Pocket Universe", 2020, 94, "Mei Lin Zhao", ["animation", "adventure"], ["en"], ["ar", "es", "fr"], "PG", [90, 30, 60, 5, 0, 45, 20, 90, 70, 100], [0, 1, 0, 0, 0, 0], ["family", "rainy"], "A kid discovers a universe in her coat pocket and a lost astronaut inside."],
  ["Courtroom of Clocks", 2017, 131, "Alistair Penn", ["mystery", "drama"], ["en"], ["fr", "ar"], "PG-13", [35, 50, 10, 15, 25, 85, 80, 50, 45, 20], [0, 1, 0, 1, 0, 1], ["solo", "focus"], "A clockmaker is the only witness in a trial that keeps changing its timeline."],
  ["Bread and Thunder", 2022, 106, "Valentina Cruz", ["comedy", "romance"], ["es"], ["en", "ar"], "PG-13", [88, 25, 78, 5, 0, 35, 10, 85, 65, 60], [1, 0, 0, 1, 0, 0], ["partner", "friends"], "Rival bakers share a wall, a storm and eventually a recipe."],
  ["The Long Way to Qamar", 2019, 123, "Karim Oueslati", ["adventure", "drama"], ["ar", "fr"], ["en"], "PG-13", [65, 60, 20, 35, 25, 60, 40, 75, 60, 85], [0, 2, 1, 1, 1, 1], ["friends", "solo"], "A courier crosses three deserts to deliver a lamp to a moon festival."],
  ["Neon Orchard Rules", 2023, 109, "Tae-yang Kim", ["thriller", "comedy"], ["ko"], ["en", "ar"], "R", [30, 80, 45, 65, 30, 90, 35, 35, 95, 50], [1, 3, 2, 3, 0, 1], ["friends", "late"], "Four rivals share a farm, a ledger and a very bad alibi."],
  ["Fieldnotes from a Fox", 2021, 82, "Sigrid Berg", ["documentary"], ["en"], ["ar", "fr", "de"], "G", [75, 10, 15, 0, 10, 25, 40, 70, 20, 70], [0, 0, 0, 0, 1, 0], ["family", "solo", "rainy"], "A year of patient observation in one suburban fox territory."],
  ["The Baker's Silence", 2016, 119, "Omar Fahmy", ["drama"], ["ar"], ["en", "fr"], "R", [15, 55, 0, 30, 75, 40, 85, 30, 20, 5], [1, 2, 1, 2, 0, 4], ["solo", "focus"], "A village baker refuses to speak after a harvest-night accident."],
  ["Cartwheel Summer", 2018, 93, "Joy Mbeki", ["family", "comedy"], ["en"], ["ar", "fr"], "PG", [90, 15, 72, 0, 0, 25, 10, 92, 60, 75], [0, 0, 0, 0, 0, 0], ["family"], "A gymnastics camp with one broken bus and eleven determined kids."],
  ["Parallel Tuesdays", 2024, 116, "Felix Arndt", ["scifi", "mystery"], ["de", "en"], ["ar"], "PG-13", [40, 65, 15, 20, 20, 95, 75, 55, 65, 70], [0, 2, 0, 1, 0, 1], ["solo", "friends"], "Every Tuesday a commuter wakes in a slightly different city."],
  ["Moth Season", 2020, 107, "Lucia Ferrari", ["drama", "horror"], ["en"], ["fr", "ar"], "R", [10, 70, 0, 45, 80, 65, 65, 15, 35, 15], [2, 3, 2, 2, 2, 4], ["late", "solo"], "A night nurse notices her patients all dream of the same lit window."],
  ["Tea at the End of Rain", 2022, 101, "Aiko Tanabe", ["drama", "romance"], ["ja"], ["en", "ar"], "PG", [78, 15, 15, 0, 5, 20, 30, 85, 20, 50], [0, 0, 0, 0, 0, 0], ["partner", "rainy"], "Two strangers keep meeting at the same tea stall whenever it rains."],
  ["Grandmaster Gambit", 2019, 110, "Boris Lebedev", ["drama"], ["en"], ["ar", "es"], "PG", [60, 50, 15, 5, 5, 65, 65, 70, 55, 30], [0, 0, 0, 0, 0, 0], ["solo"], "A retired teacher coaches a school chess team through one improbable bracket."],
  ["Fireworks Over Fez", 2021, 99, "Yasmin Benali", ["comedy", "adventure"], ["ar", "fr"], ["en"], "PG", [86, 35, 80, 15, 0, 50, 15, 85, 85, 80], [0, 1, 0, 1, 0, 0], ["friends", "family"], "A lost crate of fireworks, a festival night and three cousins on bicycles."],
  ["The Silent Interval", 2015, 138, "Matthias Vogel", ["war", "drama"], ["de", "en"], ["ar", "fr"], "R", [5, 85, 0, 90, 60, 50, 85, 25, 40, 5], [1, 4, 3, 3, 2, 4], ["solo", "focus"], "A field medic keeps a diary during one long pause in the fighting."],
  ["Sunroom Sessions", 2023, 95, "Dana Ibarra", ["documentary", "comedy"], ["en", "es"], ["ar"], "PG-13", [80, 10, 60, 0, 0, 20, 15, 80, 60, 40], [0, 0, 0, 2, 0, 0], ["friends", "rainy"], "Amateur musicians rehearse in one sunroom over a very loud winter."],
  ["Cinder & Compass", 2017, 126, "Naveen Rao", ["fantasy", "adventure"], ["hi", "en"], ["ar", "fr"], "PG-13", [68, 65, 35, 45, 20, 60, 40, 75, 70, 100], [0, 3, 1, 1, 1, 1], ["friends"], "A compass that points to what you miss leads a crew across a burnt kingdom."],
  ["Slow Boat to Marrakesh", 2020, 113, "Selma Idrissi", ["romance", "drama"], ["fr", "ar"], ["en"], "PG-13", [72, 20, 25, 0, 5, 30, 40, 70, 30, 65], [1, 0, 0, 1, 0, 0], ["partner"], "A broken ferry schedule gives two strangers a week they did not plan."],
  ["Heist at Half Speed", 2022, 98, "Gus Hallman", ["comedy", "crime"], ["en"], ["ar", "es"], "PG-13", [80, 45, 88, 20, 0, 65, 15, 65, 80, 70], [0, 1, 0, 2, 0, 0], ["friends"], "Retired safecrackers attempt one last job with very sore knees."],
  ["Lowtide Letters", 2018, 101, "Pia Svensson", ["drama"], ["en"], ["ar", "fr"], "PG", [58, 20, 10, 0, 10, 25, 45, 78, 25, 30], [0, 0, 0, 0, 0, 1], ["solo", "partner", "rainy"], "A ferry operator and her estranged brother trade letters across a strait."],
];

const CAST = ["Amira Soliman", "Theo Brandt", "Lina Castellanos", "Kofi Mensah", "Haru Sato", "Dalia Nasser", "Mateo Rossi", "Ines Moreau", "Rohan Das", "Selin Aydin", "Jonas Keller", "Noa Levi"];
const YEARS = [
  1986, 1993, 2001, 1989, 1998, 2004, 1991, 2007, 2012, 1995, 2003, 1988,
  2010, 1999, 1984, 2006, 2015, 1990, 2018, 2002, 1987, 2014, 1996, 2009,
  2017, 1992, 2005, 1985, 2019, 1997, 2011, 1982, 2020, 2000, 2013, 1983,
  2021, 2008, 1994, 2016, 2022, 2023, 2024, 1981,
];
const COUNTRIES = [
  "Lebanon", "Morocco", "United States", "Japan", "Nigeria", "Germany",
  "India", "South Korea", "United Kingdom", "France", "Jordan", "Spain",
  "Tunisia", "Canada", "Sweden", "Italy", "Egypt", "Australia",
  "New Zealand", "Portugal", "Mexico", "Turkey", "China", "Brazil",
  "Norway", "Ireland", "Kenya", "Argentina", "Indonesia", "Greece",
  "South Africa", "Iceland", "Saudi Arabia", "Chile", "Finland", "Singapore",
  "Denmark", "Pakistan", "Netherlands", "United Arab Emirates", "Thailand",
  "Poland", "Taiwan", "Malaysia",
];

function posterSvg(title: string, hue: number, wide: boolean): string {
  const w = wide ? 640 : 400;
  const h = wide ? 360 : 600;
  const words = title.split(" ").slice(0, 3);
  const text = words
    .map((word, i) => `<text x='${w / 2}' y='${h * 0.55 + i * (wide ? 34 : 44)}' text-anchor='middle' font-family='sans-serif' font-size='${wide ? 30 : 38}' font-weight='700' fill='hsl(${hue} 40% 92%)'>${word.replace(/[&<>']/g, "")}</text>`)
    .join("");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue} 45% 22%)'/><stop offset='1' stop-color='hsl(${(hue + 50) % 360} 35% 9%)'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><circle cx='${w * 0.78}' cy='${h * 0.2}' r='${wide ? 26 : 34}' fill='hsl(47 92% 53%)' opacity='.75'/>${text}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function availabilityFor(i: number): Availability[] {
  const out: Availability[] = [];
  REGIONS.forEach((region, j) => {
    if ((i * 7 + j * 3) % 5 === 0) return;
    const dubs = (i + j) % 4 === 0 ? ["ar"] : i % 5 === 0 ? ["fr"] : [];
    out.push({
      region,
      provider: PROVIDERS[(i + j) % PROVIDERS.length],
      kind: (i + j) % 7 === 0 ? "buy" : (i + j) % 3 === 0 ? "rent" : "stream",
      dubs,
    });
    if ((i + j) % 6 === 0) {
      out.push({ region, provider: PROVIDERS[(i + j + 2) % PROVIDERS.length], kind: "rent", dubs: ["en"] });
    }
  });
  return out;
}

export const MOVIES: Movie[] = ROWS.map((r, i) => {
  const [title, _year, runtime, director, genres, langs, subs, age, mood, content, tags, summary] = r;
  const moodObj = {} as Record<MoodKey, number>;
  MOOD_KEYS.forEach((k, idx) => (moodObj[k] = mood[idx]));
  const contentObj = {} as Record<ContentKey, number>;
  CONTENT_KEYS.forEach((k, idx) => (contentObj[k] = content[idx]));
  const hue = (i * 47 + 200) % 360;
  return {
    id: `m${String(i + 1).padStart(2, "0")}`,
    title,
    year: YEARS[i] ?? _year,
    country: COUNTRIES[i] ?? "International",
    posterUrl: posterSvg(title, hue, false),
    backdropUrl: posterSvg(title, hue, true),
    runtimeMinutes: runtime,
    director,
    cast: [CAST[(i * 3) % CAST.length], CAST[(i * 5 + 1) % CAST.length], CAST[(i * 7 + 2) % CAST.length]],
    genres,
    languages: langs,
    subtitleLanguages: subs,
    ageRating: age,
    mood: moodObj,
    content: contentObj,
    availability: availabilityFor(i),
    summary,
    bestFor: tags,
    cautions: CONTENT_KEYS.filter((k) => contentObj[k] >= 2),
  };
});

export const MOVIE_BY_ID: Record<string, Movie> = Object.fromEntries(MOVIES.map((m) => [m.id, m]));

export interface Preset {
  id: string;
  targets: Partial<Record<MoodKey, number>>;
  importance?: Partial<Record<MoodKey, 1 | 2 | 3>>;
  context?: Context;
  maxRuntime?: number;
  maxAgeRating?: string | "any";
  limits?: Partial<Record<ContentKey, number>>;
  sort?: ResultSort;
}

export const PRESETS: Preset[] = [
  { id: "cheer", targets: { feelGood: 85, hopefulness: 85, intensity: 20, pace: 45 }, context: "solo" },
  { id: "cozy", targets: { feelGood: 80, intensity: 15, violence: 5, disturbing: 5, hopefulness: 80 }, context: "solo" },
  { id: "date", targets: { feelGood: 70, intensity: 35, humour: 55, hopefulness: 65, pace: 45 }, context: "date", maxRuntime: 120 },
  { id: "think", targets: { demanding: 85, unpredictability: 70, pace: 35, humour: 20 }, context: "solo" },
  {
    id: "family",
    targets: { feelGood: 85, violence: 5, disturbing: 5, humour: 65, hopefulness: 85 },
    context: "family",
    maxAgeRating: "PG",
    limits: { sexualContent: 0, violence: 1, gore: 0, animalHarm: 0, disturbingThemes: 1 },
  },
  { id: "dark", targets: { feelGood: 20, intensity: 85, demanding: 65, hopefulness: 20, violence: 65 }, context: "solo" },
  { id: "scared", targets: { intensity: 90, disturbing: 90, unpredictability: 90, violence: 65 }, context: "solo" },
  { id: "short", targets: { pace: 70 }, maxRuntime: 89, context: "solo" },
  { id: "surprise", targets: {}, sort: "surprise", context: "solo" },
];
