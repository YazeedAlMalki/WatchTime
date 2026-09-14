/**
 * Additive, resumable real-catalog synchronizer.
 *
 * Sources are deliberately limited to public, credential-free APIs:
 * - TVMaze for series, episodes and credited cast.
 * - Wikipedia REST summaries for the curated film list.
 *
 * This command never truncates catalog or tracking tables. Every source item is
 * isolated in its own transaction, so a bad response can be retried without
 * losing the rest of a run.
 *
 * Examples:
 *   pnpm --filter @workspace/api-server exec tsx src/seed-real.ts
 *   ... seed-real.ts --type movie,tv --limit 10 --dry-run
 *   ... seed-real.ts --allow-partial
 */
import {
  and,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import {
  db,
  pool,
  titlesTable,
  titleAliasesTable,
  seasonsTable,
  episodesTable,
  castMembersTable,
  safetyRecordsTable,
  providerMappingsTable,
  integrationHealthTable,
} from "@workspace/db";
import { pathToFileURL } from "node:url";

export type CatalogType = "movie" | "tv" | "anime" | "documentary";
export type AliasSource = {
  alias: string;
  language: string;
  sourceName: string;
  sourceUrl: string;
};
type TvManifestEntry = {
  name: string;
  id: number;
  type: "tv" | "anime" | "documentary";
  expectedTitle: string;
  year: number;
  imdbId: string | null;
  canonicalName?: string;
  sourceYear?: number;
  aliases?: readonly AliasSource[];
};
export type SourceItem = {
  key: string;
  type: CatalogType;
  source: "tvmaze" | "wikipedia";
  name: string;
  imdbId?: string;
  tvmazeId?: number;
  expectedTitle?: string;
  expectedYear?: number;
  expectedImdbId?: string | null;
  sourceYear?: number;
  aliases?: readonly AliasSource[];
  popularity: number;
  wikiPage?: string;
};

const UA = "WatchTime/1.0 (real catalog synchronizer; https://watchtime.example)";
const RETRIES = 3;
const CONCURRENCY = 3;
const SAFETY_SOURCES = [
  ["Common Sense Media", 1, "https://www.commonsensemedia.org"],
  ["Kids-In-Mind", 1, "https://kids-in-mind.com"],
  ["Does the Dog Die?", 2, "https://www.doesthedogdie.com"],
  ["CringeMDb", 2, "https://cringemdb.com"],
] as const;

const wikipediaAlias = (language: string, alias: string, page: string): AliasSource => ({
  alias,
  language,
  sourceName: `${language.toUpperCase()} Wikipedia`,
  sourceUrl: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.replace(/ /g, "_"))}`,
});
const tvMazeAlias = (language: string, alias: string, showId: number): AliasSource => ({
  alias,
  language,
  sourceName: "TVMaze",
  sourceUrl: `https://www.tvmaze.com/shows/${showId}`,
});

/*
 * Checked-in TVMaze manifest. IDs are never discovered at sync time. The
 * expected fields are checked before any database transaction starts. The
 * four exceptional entries document TVMaze's known title collisions:
 * - One Piece is the 1999 anime, not the 2023 live-action series.
 * - Life is the 2009 BBC documentary.
 * - The Staircase is the 2004 documentary (French TVMaze title Soupçons).
 * - TVMaze's Cosmos record carries the 2014 IMDb id but a bad 1980 premiere;
 *   its catalog year is therefore explicitly pinned to 2014.
 */
export const TVMAZE_MANIFEST: TvManifestEntry[] = [
  // Localized names below are verified against the corresponding Arabic
  // Wikipedia article; original-language names use the work's Wikipedia page.
  { name: "Breaking Bad", id: 169, type: "tv", expectedTitle: "Breaking Bad", year: 2008, imdbId: "tt0903747", aliases: [wikipediaAlias("ar", "اختلال ضال", "اختلال ضال")] },
  { name: "Stranger Things", id: 2993, type: "tv", expectedTitle: "Stranger Things", year: 2016, imdbId: "tt4574334", aliases: [wikipediaAlias("ar", "أشياء غريبة", "أشياء غريبة")] },
  { name: "The Office", id: 526, type: "tv", expectedTitle: "The Office", year: 2005, imdbId: "tt0386676" },
  { name: "Game of Thrones", id: 82, type: "tv", expectedTitle: "Game of Thrones", year: 2011, imdbId: "tt0944947", aliases: [wikipediaAlias("ar", "صراع العروش", "صراع العروش")] },
  { name: "The Wire", id: 179, type: "tv", expectedTitle: "The Wire", year: 2002, imdbId: "tt0306414" },
  { name: "Succession", id: 23470, type: "tv", expectedTitle: "Succession", year: 2018, imdbId: "tt7660850" },
  { name: "The Sopranos", id: 527, type: "tv", expectedTitle: "The Sopranos", year: 1999, imdbId: "tt0141842" },
  { name: "Mad Men", id: 385, type: "tv", expectedTitle: "Mad Men", year: 2007, imdbId: "tt0804503" },
  { name: "Better Call Saul", id: 618, type: "tv", expectedTitle: "Better Call Saul", year: 2015, imdbId: "tt3032476" },
  { name: "The Crown", id: 3594, type: "tv", expectedTitle: "The Crown", year: 2016, imdbId: "tt4786824" },
  { name: "The Mandalorian", id: 38963, type: "tv", expectedTitle: "The Mandalorian", year: 2019, imdbId: "tt8111088" },
  { name: "The Last of Us", id: 46562, type: "tv", expectedTitle: "The Last of Us", year: 2023, imdbId: "tt3581920" },
  { name: "Severance", id: 44933, type: "tv", expectedTitle: "Severance", year: 2022, imdbId: "tt11280740" },
  { name: "The Bear", id: 54198, type: "tv", expectedTitle: "The Bear", year: 2022, imdbId: "tt14452776" },
  { name: "Wednesday", id: 53647, type: "tv", expectedTitle: "Wednesday", year: 2022, imdbId: "tt13443470" },
  { name: "The Boys", id: 15299, type: "tv", expectedTitle: "The Boys", year: 2019, imdbId: "tt1190634" },
  { name: "Ozark", id: 13417, type: "tv", expectedTitle: "Ozark", year: 2017, imdbId: "tt5071412" },
  { name: "The Walking Dead", id: 73, type: "tv", expectedTitle: "The Walking Dead", year: 2010, imdbId: "tt1520211", aliases: [wikipediaAlias("ar", "الموتى السائرون", "الموتى السائرون")] },
  { name: "Lost", id: 123, type: "tv", expectedTitle: "Lost", year: 2004, imdbId: "tt0411008" },
  { name: "Friends", id: 431, type: "tv", expectedTitle: "Friends", year: 1994, imdbId: "tt0108778", aliases: [wikipediaAlias("ar", "فريندز", "فريندز")] },
  { name: "Seinfeld", id: 530, type: "tv", expectedTitle: "Seinfeld", year: 1989, imdbId: "tt0098904" },
  { name: "Parks and Recreation", id: 174, type: "tv", expectedTitle: "Parks and Recreation", year: 2009, imdbId: "tt1266020" },
  { name: "Brooklyn Nine-Nine", id: 49, type: "tv", expectedTitle: "Brooklyn Nine-Nine", year: 2013, imdbId: "tt2467372" },
  { name: "Schitt's Creek", id: 1775, type: "tv", expectedTitle: "Schitt's Creek", year: 2015, imdbId: "tt3526078" },
  { name: "Chernobyl", id: 30770, type: "tv", expectedTitle: "Chernobyl", year: 2019, imdbId: "tt7366338" },
  { name: "The Queen's Gambit", id: 41428, type: "tv", expectedTitle: "The Queen's Gambit", year: 2020, imdbId: "tt10048342" },
  { name: "Fleabag", id: 16149, type: "tv", expectedTitle: "Fleabag", year: 2016, imdbId: "tt5687612" },
  { name: "Sherlock", id: 335, type: "tv", expectedTitle: "Sherlock", year: 2010, imdbId: "tt1475582" },
  { name: "Peaky Blinders", id: 269, type: "tv", expectedTitle: "Peaky Blinders", year: 2013, imdbId: "tt2442560" },
  { name: "Dark", id: 17861, type: "tv", expectedTitle: "Dark", year: 2017, imdbId: "tt5753856" },
  { name: "The Good Place", id: 2790, type: "tv", expectedTitle: "The Good Place", year: 2016, imdbId: "tt4955642" },
  { name: "Black Mirror", id: 305, type: "tv", expectedTitle: "Black Mirror", year: 2011, imdbId: "tt2085059" },
  { name: "Westworld", id: 1371, type: "tv", expectedTitle: "Westworld", year: 2016, imdbId: "tt0475784" },
  { name: "House", id: 118, type: "tv", expectedTitle: "House", year: 2004, imdbId: "tt0412142" },
  { name: "Dexter", id: 161, type: "tv", expectedTitle: "Dexter", year: 2006, imdbId: "tt0773262" },
  { name: "Yellowstone", id: 27848, type: "tv", expectedTitle: "Yellowstone", year: 2018, imdbId: "tt4236770" },
  { name: "Bridgerton", id: 42966, type: "tv", expectedTitle: "Bridgerton", year: 2020, imdbId: "tt8740790" },
  { name: "The Handmaid's Tale", id: 16579, type: "tv", expectedTitle: "The Handmaid's Tale", year: 2017, imdbId: "tt5834204" },
  { name: "Ted Lasso", id: 44458, type: "tv", expectedTitle: "Ted Lasso", year: 2020, imdbId: "tt10986410" },
  { name: "Only Murders in the Building", id: 48830, type: "tv", expectedTitle: "Only Murders in the Building", year: 2021, imdbId: "tt11691774" },
  { name: "The X-Files", id: 430, type: "tv", expectedTitle: "The X-Files", year: 1993, imdbId: "tt0106179" },
  { name: "Friday Night Lights", id: 781, type: "tv", expectedTitle: "Friday Night Lights", year: 2006, imdbId: "tt0758745" },
  { name: "Arrested Development", id: 321, type: "tv", expectedTitle: "Arrested Development", year: 2003, imdbId: "tt0367279" },
  { name: "Community", id: 318, type: "tv", expectedTitle: "Community", year: 2009, imdbId: "tt1439629" },
  { name: "The Americans", id: 157, type: "tv", expectedTitle: "The Americans", year: 2013, imdbId: "tt2149175" },
  { name: "Boardwalk Empire", id: 102, type: "tv", expectedTitle: "Boardwalk Empire", year: 2010, imdbId: "tt0979432" },
  { name: "Friday Night Dinner", id: 1789, type: "tv", expectedTitle: "Friday Night Dinner", year: 2011, imdbId: "tt1844923" },
  { name: "Mr. Robot", id: 1871, type: "tv", expectedTitle: "Mr. Robot", year: 2015, imdbId: "tt4158110" },

  { name: "Attack on Titan", id: 919, type: "anime", expectedTitle: "Attack on Titan", year: 2013, imdbId: "tt2560140", aliases: [wikipediaAlias("en", "Shingeki no Kyojin", "Attack on Titan"), wikipediaAlias("ja", "進撃の巨人", "進撃の巨人"), wikipediaAlias("ar", "هجوم العمالقة", "هجوم العمالقة")] },
  { name: "Death Note", id: 40, type: "anime", expectedTitle: "Death Note", year: 2006, imdbId: "tt0877057", aliases: [wikipediaAlias("ja", "デスノート", "DEATH NOTE"), wikipediaAlias("ar", "مذكرة الموت", "مذكرة الموت")] },
  { name: "Fullmetal Alchemist: Brotherhood", id: 2071, type: "anime", expectedTitle: "Fullmetal Alchemist: Brotherhood", year: 2009, imdbId: "tt1355642", aliases: [wikipediaAlias("en", "Hagane no Renkinjutsushi", "Fullmetal Alchemist"), wikipediaAlias("ja", "鋼の錬金術師", "鋼の錬金術師")] },
  { name: "One Piece", id: 1505, type: "anime", expectedTitle: "One Piece", year: 1999, imdbId: "tt0388629", aliases: [wikipediaAlias("ja", "ワンピース", "ONE PIECE"), wikipediaAlias("ar", "ون بيس", "ون بيس")] },
  { name: "Naruto", id: 495, type: "anime", expectedTitle: "Naruto", year: 2002, imdbId: "tt0409591", aliases: [wikipediaAlias("ja", "ナルト", "NARUTO_-ナルト-"), wikipediaAlias("ar", "ناروتو", "ناروتو")] },
  { name: "Naruto: Shippuden", id: 488, type: "anime", expectedTitle: "Naruto: Shippūden", year: 2007, imdbId: "tt0988824", aliases: [wikipediaAlias("en", "Naruto Shippūden", "Naruto: Shippuden"), wikipediaAlias("ja", "ナルト 疾風伝", "NARUTO_-ナルト-_疾風伝"), wikipediaAlias("ar", "ناروتو شيبودن", "ناروتو شيبودن")] },
  { name: "Dragon Ball Z", id: 2103, type: "anime", expectedTitle: "Dragon Ball Z", year: 1989, imdbId: "tt0121220", aliases: [wikipediaAlias("ja", "ドラゴンボールZ", "ドラゴンボールZ"), wikipediaAlias("ar", "دراغون بول زد", "دراغون بول زد")] },
  { name: "Demon Slayer", id: 41469, type: "anime", expectedTitle: "Demon Slayer", year: 2019, imdbId: "tt9335498", aliases: [wikipediaAlias("en", "Demon Slayer: Kimetsu no Yaiba", "Demon Slayer: Kimetsu no Yaiba"), wikipediaAlias("en", "Kimetsu no Yaiba", "Demon Slayer: Kimetsu no Yaiba"), wikipediaAlias("ja", "鬼滅の刃", "鬼滅の刃"), wikipediaAlias("ar", "قاتل الشياطين", "قاتل الشياطين")] },
  { name: "Jujutsu Kaisen", id: 48450, type: "anime", expectedTitle: "Jujutsu Kaisen", year: 2020, imdbId: "tt12343534", aliases: [wikipediaAlias("ja", "呪術廻戦", "呪術廻戦"), wikipediaAlias("ar", "جوجوتسو كايسن", "جوجوتسو كايسن")] },
  { name: "My Hero Academia", id: 13615, type: "anime", expectedTitle: "My Hero Academia", year: 2016, imdbId: "tt5626028", aliases: [wikipediaAlias("en", "Boku no Hero Academia", "My Hero Academia"), wikipediaAlias("ja", "僕のヒーローアカデミア", "僕のヒーローアカデミア"), wikipediaAlias("ar", "أكاديمية بطلي", "أكاديمية بطلي")] },
  // Original Japanese titles below are the native titles in each work's
  // Japanese Wikipedia article (ja.wikipedia.org/wiki/<encoded alias>).
  { name: "Cowboy Bebop", id: 1121, type: "anime", expectedTitle: "Cowboy Bebop", year: 1998, imdbId: "tt0213338", aliases: [wikipediaAlias("ja", "カウボーイビバップ", "カウボーイビバップ")] },
  { name: "Neon Genesis Evangelion", id: 1925, type: "anime", expectedTitle: "Neon Genesis Evangelion", year: 1995, imdbId: "tt0112159", aliases: [wikipediaAlias("ja", "新世紀エヴァンゲリオン", "新世紀エヴァンゲリオン")] },
  { name: "Sailor Moon", id: 5476, type: "anime", expectedTitle: "Bishoujo Senshi Sailor Moon", year: 1992, imdbId: "tt0103369", aliases: [wikipediaAlias("en", "Bishōjo Senshi Sailor Moon", "Sailor Moon"), wikipediaAlias("ja", "美少女戦士セーラームーン", "美少女戦士セーラームーン")] },
  { name: "Pokémon", id: 590, type: "anime", expectedTitle: "Pokémon", year: 1997, imdbId: "tt0168366", aliases: [wikipediaAlias("en", "Pocket Monsters", "Pokémon (TV series)"), wikipediaAlias("ja", "ポケットモンスター", "ポケットモンスター")] },
  { name: "Bleach", id: 1905, type: "anime", expectedTitle: "Bleach", year: 2004, imdbId: "tt0434665", aliases: [wikipediaAlias("ja", "ブリーチ", "BLEACH")] },
  { name: "Hunter x Hunter", id: 1536, type: "anime", expectedTitle: "Hunter x Hunter", year: 2011, imdbId: "tt2098220" },
  { name: "One-Punch Man", id: 4201, type: "anime", expectedTitle: "One-Punch Man", year: 2015, imdbId: "tt4508902", aliases: [wikipediaAlias("ja", "ワンパンマン", "ワンパンマン")] },
  { name: "Spy x Family", id: 59698, type: "anime", expectedTitle: "Spy×Family", year: 2022, imdbId: "tt13706018", aliases: [wikipediaAlias("ja", "SPY×FAMILY", "SPY×FAMILY")] },
  { name: "JoJo's Bizarre Adventure", id: 8287, type: "anime", expectedTitle: "JoJo's Bizarre Adventure", year: 2012, imdbId: "tt2359704", aliases: [wikipediaAlias("ja", "ジョジョの奇妙な冒険", "ジョジョの奇妙な冒険")] },
  { name: "Haikyu!!", id: 5193, type: "anime", expectedTitle: "Haikyuu!!", year: 2014, imdbId: "tt3398540", aliases: [wikipediaAlias("ja", "ハイキュー!!", "ハイキュー!!")] },
  { name: "Fairy Tail", id: 2069, type: "anime", expectedTitle: "Fairy Tail", year: 2009, imdbId: "tt1528406", aliases: [wikipediaAlias("ja", "フェアリーテイル", "FAIRY TAIL")] },
  { name: "Mob Psycho 100", id: 18260, type: "anime", expectedTitle: "Mob Psycho 100", year: 2016, imdbId: "tt5897304", aliases: [wikipediaAlias("ja", "モブサイコ100", "モブサイコ100")] },
  { name: "Vinland Saga", id: 42155, type: "anime", expectedTitle: "Vinland Saga", year: 2019, imdbId: "tt10233448", aliases: [wikipediaAlias("ja", "ヴィンランド・サガ", "ヴィンランド・サガ")] },
  { name: "Steins;Gate", id: 2051, type: "anime", expectedTitle: "Steins;Gate", year: 2011, imdbId: "tt1910272", aliases: [wikipediaAlias("ja", "シュタインズ・ゲート", "STEINS;GATE")] },
  { name: "Code Geass", id: 5276, type: "anime", expectedTitle: "Code Geass: Hangyaku no Lelouch", year: 2006, imdbId: "tt0994314", aliases: [wikipediaAlias("en", "Code Geass: Hangyaku no Lelouch", "Code Geass"), wikipediaAlias("ja", "コードギアス 反逆のルルーシュ", "コードギアス 反逆のルルーシュ")] },

  { name: "Planet Earth", id: 768, type: "documentary", expectedTitle: "Planet Earth", year: 2006, imdbId: "tt0795176" },
  { name: "Planet Earth II", id: 22036, type: "documentary", expectedTitle: "Planet Earth II", year: 2016, imdbId: "tt5491994" },
  { name: "Blue Planet", id: 7103, type: "documentary", expectedTitle: "The Blue Planet", year: 2001, imdbId: "tt0296310" },
  { name: "Blue Planet II", id: 25504, type: "documentary", expectedTitle: "Blue Planet II", year: 2017, imdbId: "tt6769208" },
  { name: "Our Planet", id: 17868, type: "documentary", expectedTitle: "Our Planet", year: 2019, imdbId: "tt9253866" },
  { name: "Cosmos: A Spacetime Odyssey", id: 1128, type: "documentary", expectedTitle: "Cosmos", year: 2014, sourceYear: 1980, imdbId: "tt2395695", canonicalName: "Cosmos: A Spacetime Odyssey" },
  { name: "The Vietnam War", id: 23451, type: "documentary", expectedTitle: "The Vietnam War", year: 2017, imdbId: "tt1877514" },
  { name: "The Last Dance", id: 40358, type: "documentary", expectedTitle: "The Last Dance", year: 2020, imdbId: "tt8420184" },
  { name: "Making a Murderer", id: 7989, type: "documentary", expectedTitle: "Making a Murderer", year: 2015, imdbId: "tt5189670" },
  { name: "The Jinx", id: 1542, type: "documentary", expectedTitle: "The Jinx: The Life and Deaths of Robert Durst", year: 2015, imdbId: "tt4299972" },
  { name: "Wild Isles", id: 63544, type: "documentary", expectedTitle: "Wild Isles", year: 2023, imdbId: "tt23844450" },
  { name: "Frozen Planet", id: 4000, type: "documentary", expectedTitle: "Frozen Planet", year: 2011, imdbId: "tt2092588" },
  { name: "Life", id: 1280, type: "documentary", expectedTitle: "Life", year: 2009, imdbId: "tt1533395" },
  { name: "The World at War", id: 3291, type: "documentary", expectedTitle: "The World at War", year: 1973, imdbId: "tt0071075" },
  { name: "The Civil War", id: 8246, type: "documentary", expectedTitle: "The Civil War", year: 1990, imdbId: "tt0098769" },
  { name: "The Staircase", id: 13645, type: "documentary", expectedTitle: "Soupçons", year: 2004, imdbId: "tt0388644", canonicalName: "The Staircase", aliases: [tvMazeAlias("fr", "Soupçons", 13645)] },
  { name: "The Keepers", id: 27435, type: "documentary", expectedTitle: "The Keepers", year: 2017, imdbId: "tt6792200" },
  { name: "Chef's Table", id: 3252, type: "documentary", expectedTitle: "Chef's Table", year: 2015, imdbId: "tt4295140" },
  { name: "Abstract: The Art of Design", id: 24260, type: "documentary", expectedTitle: "Abstract: The Art of Design", year: 2017, imdbId: "tt6333098" },
  { name: "The Beatles: Get Back", id: 55965, type: "documentary", expectedTitle: "The Beatles: Get Back", year: 2021, imdbId: "tt9735318" },
];

/*
 * These are editorially curated works, not claimed ratings or availability.
 * IMDb ids are stable identifiers only. All synopsis/artwork comes from the
 * Wikipedia page at sync time; volatile scores and providers are intentionally
 * left empty.
 */
const MOVIES: Array<[string, string, string, AliasSource[]?]> = [
  // Arabic titles: ar.wikipedia article titles. Original-language titles:
  // each film's en.wikipedia article and its cited native title.
  ["Inception", "Inception", "tt1375666", [wikipediaAlias("ar", "استهلال", "استهلال (فيلم)")]], ["The Dark Knight", "The Dark Knight", "tt0468569", [wikipediaAlias("ar", "فارس الظلام", "فارس الظلام (فيلم)")]],
  ["Interstellar", "Interstellar (film)", "tt0816692", [wikipediaAlias("ar", "بين النجوم", "بين النجوم (فيلم)")]], ["Spirited Away", "Spirited Away", "tt0245429", [wikipediaAlias("en", "Sen to Chihiro no Kamikakushi", "Spirited Away"), wikipediaAlias("ja", "千と千尋の神隠し", "千と千尋の神隠し"), wikipediaAlias("ar", "المخطوفة", "المخطوفة")]],
  ["The Shawshank Redemption", "The Shawshank Redemption", "tt0111161"],
  ["The Godfather", "The Godfather", "tt0068646"], ["Pulp Fiction", "Pulp Fiction", "tt0110912"],
  ["The Lord of the Rings: The Fellowship of the Ring", "The Lord of the Rings: The Fellowship of the Ring", "tt0120737"],
  ["The Lord of the Rings: The Two Towers", "The Lord of the Rings: The Two Towers", "tt0167261"],
  ["The Lord of the Rings: The Return of the King", "The Lord of the Rings: The Return of the King", "tt0167260"],
  ["The Matrix", "The Matrix", "tt0133093", [wikipediaAlias("ar", "المصفوفة", "المصفوفة (فيلم)")]], ["Parasite", "Parasite (2019 film)", "tt6751668", [wikipediaAlias("en", "Gisaengchung", "Parasite (2019 film)"), wikipediaAlias("ko", "기생충", "기생충 (영화)"), wikipediaAlias("ar", "طفيلي", "طفيلي (فيلم)")]],
  ["Everything Everywhere All at Once", "Everything Everywhere All at Once", "tt6710474"],
  ["Get Out", "Get Out", "tt5052448"], ["Mad Max: Fury Road", "Mad Max: Fury Road", "tt1392190"],
  ["The Grand Budapest Hotel", "The Grand Budapest Hotel", "tt2278388"],
  ["Moonlight", "Moonlight (2016 film)", "tt4975722"], ["The Social Network", "The Social Network", "tt1285016"],
  ["Whiplash", "Whiplash (2014 film)", "tt2582802"], ["Arrival", "Arrival (film)", "tt2543164"],
  ["WALL-E", "WALL-E", "tt0910970"], ["Toy Story", "Toy Story", "tt0114709"],
  ["The Lion King", "The Lion King", "tt0110357"], ["The Silence of the Lambs", "The Silence of the Lambs", "tt0102926"],
  ["Seven", "Seven (1995 film)", "tt0114369"], ["Eternal Sunshine of the Spotless Mind", "Eternal Sunshine of the Spotless Mind", "tt0338013"],
  ["Free Solo", "Free Solo", "tt7775622"], ["Apollo 11", "Apollo 11 (2019 film)", "tt8760684"],
  ["13th", "13th (film)", "tt5830136"], ["Icarus", "Icarus (2017 film)", "tt6333060"],
  ["Won't You Be My Neighbor?", "Won't You Be My Neighbor?", "tt7681902"],
  ["My Octopus Teacher", "My Octopus Teacher", "tt12888462"], ["Navalny", "Navalny (film)", "tt17050612"],
] ;

// IDs written by the former unvalidated synchronizer. These are repaired by
// moving the existing mapping, never by deleting the title or its tracking
// rows. A conflict is left untouched and is reported by the normal identity
// checks rather than guessing.
const LEGACY_ID_REPAIRS: Array<[number, number]> = [
  [46065, 1505], // One Piece live action -> anime
  [1035, 1280], // Life scripted crime -> BBC documentary
  [54439, 13645], // The Staircase scripted drama -> documentary
];

export const sourceItems: SourceItem[] = [
  // Neither public source supplies a comparable popularity score. Zero means
  // "unknown" in this schema; ranking is never fabricated from list order.
  ...TVMAZE_MANIFEST.map((entry) => ({
    key: `${entry.type}:${entry.name}`,
    type: entry.type,
    source: "tvmaze" as const,
    name: entry.canonicalName ?? entry.name,
    tvmazeId: entry.id,
    aliases: entry.aliases,
    expectedTitle: entry.expectedTitle,
    expectedYear: entry.year,
    expectedImdbId: entry.imdbId,
    sourceYear: entry.sourceYear,
    popularity: 0,
  })),
  ...MOVIES.map((x) => ({ key: `movie:${x[0]}`, type: "movie" as const, source: "wikipedia" as const, name: x[0], wikiPage: x[1], imdbId: x[2], aliases: x[3], popularity: 0 })),
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const stripTags = (value: unknown): string | null =>
  typeof value === "string" && value.replace(/<[^>]+>/g, "").trim()
    ? value.replace(/<[^>]+>/g, "").trim()
    : null;
const normalizeTitle = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

const aliasLanguage = (alias: string) => {
  if (/\p{Script=Arabic}/u.test(alias)) return "ar";
  if (/\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u.test(alias)) return "ja";
  if (/\p{Script=Hangul}/u.test(alias)) return "ko";
  return "en";
};
export function validateTvMazeResponse(item: SourceItem, show: any) {
  if (!item.tvmazeId || show.id !== item.tvmazeId) {
    throw new Error(`TVMaze identity mismatch for ${item.name}: expected id ${item.tvmazeId}, received ${show?.id}`);
  }
  if (!item.expectedTitle || normalizeTitle(show.name ?? "") !== normalizeTitle(item.expectedTitle)) {
    throw new Error(`TVMaze title mismatch for ${item.name}: expected ${item.expectedTitle}, received ${show?.name}`);
  }
  const sourceYear = item.sourceYear ?? item.expectedYear;
  const premieredYear = show.premiered ? Number(String(show.premiered).slice(0, 4)) : null;
  if (sourceYear && premieredYear !== sourceYear) {
    throw new Error(`TVMaze year mismatch for ${item.name}: expected ${sourceYear}, received ${premieredYear}`);
  }
  const actualImdb = show.externals?.imdb ?? null;
  if (item.expectedImdbId && actualImdb !== item.expectedImdbId) {
    throw new Error(`TVMaze IMDb mismatch for ${item.name}: expected ${item.expectedImdbId}, received ${actualImdb}`);
  }
  if (item.type === "documentary" && show.type !== "Documentary") {
    throw new Error(`TVMaze type mismatch for ${item.name}: expected documentary, received ${show.type}`);
  }
  if (item.type === "anime" && (show.type !== "Animation" || !show.genres?.includes("Anime"))) {
    throw new Error(`TVMaze type mismatch for ${item.name}: expected anime, received ${show.type}/${show.genres?.join(",")}`);
  }
  if (item.type === "tv" && (show.type === "Animation" || show.type === "Documentary")) {
    throw new Error(`TVMaze type mismatch for ${item.name}: expected scripted TV, received ${show.type}`);
  }
}

async function getJson(url: string): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": UA },
      });
      if (response.ok) return await response.json();
      const retryAfter = Number(response.headers.get("retry-after") ?? 0);
      if (response.status < 500 && response.status !== 429) {
        throw new Error(`${response.status} ${url}`);
      }
      lastError = new Error(`${response.status} ${url}`);
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 350 * 2 ** attempt);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < RETRIES) await sleep(350 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchSource(item: SourceItem) {
  if (item.source === "wikipedia") {
    const wiki = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(item.wikiPage!)}`);
    if (!wiki?.extract) throw new Error(`Wikipedia summary missing for ${item.name}`);
    return { wiki };
  }
  if (!item.tvmazeId) throw new Error(`TVMaze manifest id missing for ${item.name}`);
  const show = await getJson(`https://api.tvmaze.com/shows/${item.tvmazeId}?embed[]=episodes&embed[]=cast`);
  if (!show?.id || !show?.name) throw new Error(`TVMaze show missing for ${item.name}`);
  validateTvMazeResponse(item, show);
  return { show };
}

async function findTitle(tx: any, item: SourceItem, tvmazeId: string | null, imdbId: string | null) {
  if (tvmazeId) {
    const [mapping] = await tx.select({ titleId: providerMappingsTable.titleId })
      .from(providerMappingsTable)
      .where(and(eq(providerMappingsTable.provider, "TVMaze"), eq(providerMappingsTable.externalId, tvmazeId)))
      .limit(1);
    if (mapping) return mapping.titleId;
  }
  if (imdbId) {
    const [mapping] = await tx.select({ titleId: providerMappingsTable.titleId })
      .from(providerMappingsTable)
      .where(and(eq(providerMappingsTable.provider, "IMDb"), eq(providerMappingsTable.externalId, imdbId)))
      .limit(1);
    if (mapping) return mapping.titleId;
    const [title] = await tx.select({ id: titlesTable.id }).from(titlesTable).where(eq(titlesTable.imdbId, imdbId)).limit(1);
    if (title) return title.id;
  }
  const [byName] = await tx.select({ id: titlesTable.id }).from(titlesTable)
    .where(and(
      eq(titlesTable.type, item.type),
      eq(titlesTable.name, item.name),
      eq(titlesTable.year, item.expectedYear ?? 0),
    )).limit(1);
  return byName?.id;
}

async function repairLegacyMappings() {
  await db.transaction(async (tx) => {
    for (const [oldId, newId] of LEGACY_ID_REPAIRS) {
      const [oldMapping] = await tx.select().from(providerMappingsTable).where(and(
        eq(providerMappingsTable.provider, "TVMaze"),
        eq(providerMappingsTable.externalId, String(oldId)),
      )).limit(1);
      if (!oldMapping) continue;
      const [newMapping] = await tx.select().from(providerMappingsTable).where(and(
        eq(providerMappingsTable.provider, "TVMaze"),
        eq(providerMappingsTable.externalId, String(newId)),
      )).limit(1);
      if (!newMapping || newMapping.titleId === oldMapping.titleId) {
        await tx.update(providerMappingsTable).set({
          externalId: String(newId),
          status: "mapped",
          lastRefreshedAt: new Date(),
        }).where(eq(providerMappingsTable.id, oldMapping.id));
      }
    }
  });
}

async function preflightDedupe() {
  await db.transaction(async (tx) => {
    const safetyRows = await tx.select().from(safetyRecordsTable);
    const safetyGroups = new Map<string, any[]>();
    for (const row of safetyRows) {
      const sourceName = row.sourceName === "Does the Dog Die" ? "Does the Dog Die?" : row.sourceName;
      const key = `${row.titleId}:${row.seasonNumber ?? -1}:${row.episodeNumber ?? -1}:${sourceName}`;
      const group = safetyGroups.get(key) ?? [];
      group.push(row);
      safetyGroups.set(key, group);
    }
    const safetyQuality = (row: any) =>
      (row.status === "available" ? 1_000_000 : 0) +
      (row.isCommunity ? 100_000 : 0) +
      (Array.isArray(row.items) ? row.items.length : 0);
    const stableJson = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
      if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
          .join(",")}}`;
      }
      return JSON.stringify(value);
    };
    for (const rows of safetyGroups.values()) {
      rows.sort((left, right) => safetyQuality(right) - safetyQuality(left) || Number(left.id) - Number(right.id));
      const winner = rows[0];
      const itemKeys = new Set<string>();
      const mergedItems: unknown[] = [];
      for (const row of rows) {
        for (const item of Array.isArray(row.items) ? row.items : []) {
          const contributionId =
            item && typeof item === "object" && "contributionId" in item
              ? (item as Record<string, unknown>).contributionId
              : undefined;
          const key = contributionId !== undefined
            ? `contribution:${String(contributionId)}`
            : `item:${stableJson(item)}`;
          if (itemKeys.has(key)) continue;
          itemKeys.add(key);
          mergedItems.push(item);
        }
      }
      const canonicalSource = winner.sourceName === "Does the Dog Die"
        ? "Does the Dog Die?"
        : winner.sourceName;
      const bestUrl = rows.find((row) => row.url)?.url ?? null;
      const bestAgeRecommendation = rows.find((row) => row.ageRecommendation)?.ageRecommendation ?? null;
      await tx.update(safetyRecordsTable).set({
        sourceName: canonicalSource,
        url: winner.url ?? bestUrl,
        tier: winner.tier ?? rows.find((row) => row.tier)?.tier ?? 3,
        status: rows.some((row) => row.status === "available") ? "available" : winner.status,
        isCommunity: rows.some((row) => row.isCommunity),
        ageRecommendation: winner.ageRecommendation ?? bestAgeRecommendation,
        items: mergedItems as any,
      }).where(eq(safetyRecordsTable.id, winner.id));
      const duplicateIds = rows.slice(1).map((row) => row.id);
      if (duplicateIds.length) {
        await tx.delete(safetyRecordsTable).where(inArray(safetyRecordsTable.id, duplicateIds));
      }
    }

    // Catalog sync owns only TVMaze/Wikipedia health. Leave live safety
    // integration health rows untouched.
    const duplicateHealth = await tx.execute(sql`
      select min(id) as keep_id, array_agg(id order by id) as ids
      from integration_health
      group by provider
      having count(*) > 1 and provider in ('TVMaze', 'Wikipedia')
    `);
    for (const row of duplicateHealth.rows as Array<{ keep_id: number; ids: number[] }>) {
      await tx.delete(integrationHealthTable).where(inArray(integrationHealthTable.id, row.ids.filter((id) => Number(id) !== Number(row.keep_id))));
    }
  });
}

async function upsertMapping(tx: any, titleId: number, provider: string, externalId: string | null, status: "mapped" | "missing" | "error" = externalId ? "mapped" : "missing") {
  const values = { titleId, provider, externalId, status, lastRefreshedAt: new Date() };
  const [existing] = await tx.select().from(providerMappingsTable).where(and(
    eq(providerMappingsTable.titleId, titleId),
    eq(providerMappingsTable.provider, provider),
  )).limit(1);
  if (existing) {
    await tx.update(providerMappingsTable).set(values).where(eq(providerMappingsTable.id, existing.id));
    return;
  }
  if (externalId) {
    const [sameExternal] = await tx.select().from(providerMappingsTable).where(and(
      eq(providerMappingsTable.provider, provider),
      eq(providerMappingsTable.externalId, externalId),
    )).limit(1);
    if (sameExternal) {
      await tx.update(providerMappingsTable).set(values).where(eq(providerMappingsTable.id, sameExternal.id));
      return;
    }
  }
  await tx.insert(providerMappingsTable).values(values);
}

async function upsertSafety(tx: any, titleId: number) {
  const existing = await tx.select().from(safetyRecordsTable).where(and(
    eq(safetyRecordsTable.titleId, titleId),
    sql`${safetyRecordsTable.seasonNumber} is null`,
    sql`${safetyRecordsTable.episodeNumber} is null`,
  ));
  const bySource = new Map<string, any[]>();
  for (const row of existing) {
    const canonical = row.sourceName === "Does the Dog Die" ? "Does the Dog Die?" : row.sourceName;
    const rows = bySource.get(canonical) ?? [];
    rows.push(row);
    bySource.set(canonical, rows);
  }
  const inserts: any[] = [];
  for (const [sourceName, tier, url] of SAFETY_SOURCES) {
    const rows = bySource.get(sourceName) ?? [];
    const quality = (row: any) =>
      (row.status === "available" ? 1_000_000 : 0) +
      (row.isCommunity ? 100_000 : 0) +
      (Array.isArray(row.items) ? row.items.length : 0);
    rows.sort((left, right) => quality(right) - quality(left) || Number(left.id) - Number(right.id));
    const canonical = rows[0];
    if (canonical && rows.length > 1) {
      await tx.delete(safetyRecordsTable).where(inArray(safetyRecordsTable.id, rows.slice(1).map((row) => row.id)));
    }
    if (canonical) {
      if (canonical.sourceName !== sourceName) {
        await tx.update(safetyRecordsTable).set({ sourceName }).where(eq(safetyRecordsTable.id, canonical.id));
      }
    } else {
      inserts.push({ titleId, sourceName, tier, url, status: "provider_unavailable", isCommunity: false, items: [] });
    }
  }
  if (inserts.length) await tx.insert(safetyRecordsTable).values(inserts);
}

const chunks = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

function mergeTitle(existing: any | undefined, incoming: any) {
  if (!existing) return incoming;
  const canonical = normalizeTitle(incoming.name);
  const aliasesByNormalizedTitle = new Map<string, string>();
  for (const title of [
    ...(Array.isArray(incoming.altTitles) ? incoming.altTitles : []),
    ...(Array.isArray(existing.altTitles) ? existing.altTitles : []),
  ]) {
    if (typeof title !== "string" || !title.trim()) continue;
    const trimmed = title.trim();
    const normalized = normalizeTitle(trimmed);
    if (normalized !== canonical && !aliasesByNormalizedTitle.has(normalized)) {
      aliasesByNormalizedTitle.set(normalized, trimmed);
    }
  }
  const altTitles = [...aliasesByNormalizedTitle.values()];
  return {
    ...incoming,
    overview: incoming.overview ?? existing.overview,
    posterUrl: incoming.posterUrl ?? existing.posterUrl,
    backdropUrl: incoming.backdropUrl ?? existing.backdropUrl,
    year: incoming.year ?? existing.year,
    genres: incoming.genres?.length ? incoming.genres : existing.genres,
    altTitles,
    imdbRating: incoming.imdbRating ?? existing.imdbRating,
    rottenTomatoesScore: incoming.rottenTomatoesScore ?? existing.rottenTomatoesScore,
    runtimeMinutes: incoming.runtimeMinutes ?? existing.runtimeMinutes,
    status: incoming.status ?? existing.status,
    popularity: incoming.popularity > 0 ? incoming.popularity : existing.popularity,
    imdbId: incoming.imdbId ?? existing.imdbId,
  };
}

async function ingestShow(item: SourceItem, show: any) {
  const episodes = (show._embedded?.episodes ?? []).filter((e: any) => Number.isInteger(e.number) && e.number > 0);
  const cast = (show._embedded?.cast ?? []).slice(0, 12);
  const externalId = String(show.id);
  await db.transaction(async (tx) => {
    const titleId = await findTitle(tx, item, externalId, item.expectedImdbId ?? show.externals?.imdb ?? null);
    const values = {
      type: item.type,
      name: item.name,
      overview: stripTags(show.summary),
      posterUrl: show.image?.original ?? show.image?.medium ?? null,
      backdropUrl: show.image?.original ?? null,
      year: item.expectedYear ?? (show.premiered ? Number(String(show.premiered).slice(0, 4)) || null : null),
      genres: Array.isArray(show.genres) ? show.genres : [],
      altTitles: item.aliases?.map((alias) => alias.alias) ?? [],
      imdbRating: null,
      rottenTomatoesScore: null,
      runtimeMinutes: show.averageRuntime ?? show.runtime ?? null,
      status: show.status ?? null,
      popularity: item.popularity,
      imdbId: item.expectedImdbId ?? show.externals?.imdb ?? null,
    };
    const [existing] = titleId
      ? await tx.select().from(titlesTable).where(eq(titlesTable.id, titleId))
      : [];
    const merged = mergeTitle(existing, values);
    let id = titleId;
    if (id) await tx.update(titlesTable).set(merged).where(eq(titlesTable.id, id));
    else {
      const [inserted] = await tx.insert(titlesTable).values(merged).returning({ id: titlesTable.id });
      id = inserted.id;
    }
    await syncAliases(tx, id, item.name, item, existing?.altTitles ?? []);
    await upsertMapping(tx, id, "TVMaze", externalId);
    await upsertMapping(tx, id, "IMDb", item.expectedImdbId ?? show.externals?.imdb ?? null);
    await upsertSafety(tx, id);
    const existingCast = await tx.select().from(castMembersTable).where(eq(castMembersTable.titleId, id));
    const existingSeasons = await tx.select().from(seasonsTable).where(eq(seasonsTable.titleId, id));
    const existingEpisodes = await tx.select().from(episodesTable).where(eq(episodesTable.titleId, id));
    const castByKey = new Map(existingCast.map((row: any) => [`${row.name}\u0000${row.character}\u0000${row.ord}`, row]));
    const seasonByNumber = new Map(existingSeasons.map((row: any) => [row.seasonNumber, row]));
    const episodeByKey = new Map(existingEpisodes.map((row: any) => [`${row.seasonNumber}:${row.episodeNumber}`, row]));
    const castValues: Array<typeof castMembersTable.$inferInsert> = cast.flatMap((person: any, ord: number) => {
      const name = person.person?.name;
      if (!name) return [];
      const character = person.character?.name ?? "";
      return [{ titleId: id, name, character, photoUrl: person.person?.image?.medium ?? null, ord }];
    });
    const castInserts: Array<typeof castMembersTable.$inferInsert> = [];
    const castUpdates: Array<{ id: number; photoUrl: string }> = [];
    for (const value of castValues) {
      const existingCastRow = castByKey.get(`${value.name}\u0000${value.character}\u0000${value.ord ?? 0}`);
      if (existingCastRow) {
        if (value.photoUrl && value.photoUrl !== existingCastRow.photoUrl) castUpdates.push({ id: existingCastRow.id, photoUrl: value.photoUrl });
      } else castInserts.push(value);
    }
    for (const batch of chunks(castInserts, 100)) await tx.insert(castMembersTable).values(batch);
    for (const batch of chunks(castUpdates, 100)) {
      if (!batch.length) continue;
      const ids = sql.join(batch.map((value) => sql`${value.id}`), sql`,`);
      const photos = sql.join(batch.map((value) => sql`when ${value.id} then ${value.photoUrl}`), sql` `);
      await tx.execute(sql`update cast_members set photo_url = case id ${photos} end where id in (${ids})`);
    }
    const seasons = new Set<number>(episodes.map((e: any) => e.season).filter((n: any) => Number.isInteger(n) && n > 0));
    const seasonValues = [...seasons].map((seasonNumber) => ({ titleId: id!, seasonNumber, name: `Season ${seasonNumber}` }));
    const seasonInserts = seasonValues.filter((value) => !seasonByNumber.has(value.seasonNumber));
    const seasonUpdates = seasonValues.filter((value) => seasonByNumber.has(value.seasonNumber))
      .map((value) => ({ id: seasonByNumber.get(value.seasonNumber)!.id, name: value.name }));
    for (const batch of chunks(seasonInserts, 100)) await tx.insert(seasonsTable).values(batch);
    for (const batch of chunks(seasonUpdates, 100)) {
      if (!batch.length) continue;
      const ids = sql.join(batch.map((value) => sql`${value.id}`), sql`,`);
      const names = sql.join(batch.map((value) => sql`when ${value.id} then ${value.name}`), sql` `);
      await tx.execute(sql`update seasons set name = case id ${names} end where id in (${ids})`);
    }
    const episodeValues: Array<typeof episodesTable.$inferInsert> = episodes.map((episode: any) => ({
        titleId: id, seasonNumber: episode.season, episodeNumber: episode.number,
        name: episode.name ?? `Episode ${episode.number}`, overview: stripTags(episode.summary),
        runtimeMinutes: episode.runtime ?? null, airDate: episode.airdate || null,
        stillUrl: episode.image?.medium ?? null,
      }));
    const episodeInserts: Array<typeof episodesTable.$inferInsert> = [];
    const episodeUpdates: Array<typeof episodesTable.$inferInsert & { id: number }> = [];
    for (const value of episodeValues) {
      const existingEpisode = episodeByKey.get(`${value.seasonNumber}:${value.episodeNumber}`);
      if (!existingEpisode) episodeInserts.push(value);
      else episodeUpdates.push({ ...value, id: existingEpisode.id });
    }
    for (const batch of chunks(episodeInserts, 100)) await tx.insert(episodesTable).values(batch);
    for (const batch of chunks(episodeUpdates, 100)) {
      if (!batch.length) continue;
      const ids = sql.join(batch.map((value) => sql`${value.id}`), sql`,`);
      const names = sql.join(batch.map((value) => sql`when ${value.id} then ${value.name}`), sql` `);
      const overviews = sql.join(batch.filter((value) => value.overview != null)
        .map((value) => sql`when ${value.id} then ${value.overview}`), sql` `);
      const runtimes = sql.join(batch.filter((value) => value.runtimeMinutes != null)
        .map((value) => sql`when ${value.id} then ${value.runtimeMinutes}::int`), sql` `);
      const airDates = sql.join(batch.filter((value) => value.airDate != null)
        .map((value) => sql`when ${value.id} then ${value.airDate}`), sql` `);
      const stills = sql.join(batch.filter((value) => value.stillUrl != null)
        .map((value) => sql`when ${value.id} then ${value.stillUrl}`), sql` `);
      const overviewCase = batch.some((value) => value.overview != null) ? sql`case target.id ${overviews} end` : sql`target.overview`;
      const runtimeCase = batch.some((value) => value.runtimeMinutes != null) ? sql`case target.id ${runtimes} end` : sql`target.runtime_minutes`;
      const airDateCase = batch.some((value) => value.airDate != null) ? sql`case target.id ${airDates} end` : sql`target.air_date`;
      const stillCase = batch.some((value) => value.stillUrl != null) ? sql`case target.id ${stills} end` : sql`target.still_url`;
      await tx.execute(sql`update episodes as target set
        name = case target.id ${names} end,
        overview = coalesce(${overviewCase}, target.overview),
        runtime_minutes = coalesce(${runtimeCase}, target.runtime_minutes),
        air_date = coalesce(${airDateCase}, target.air_date),
        still_url = coalesce(${stillCase}, target.still_url)
        where target.id in (${ids})`);
    }
  });
  return { episodes: episodes.length };
}

async function ingestMovie(item: SourceItem, wiki: any) {
  const overview = wiki.extract ?? null;
  const posterUrl = wiki.originalimage?.source ?? wiki.thumbnail?.source ?? null;
  await db.transaction(async (tx) => {
    const titleId = await findTitle(tx, item, null, item.imdbId!);
    const values = {
      type: item.type, name: item.name, overview, posterUrl, backdropUrl: null,
      year: null, genres: [], altTitles: item.aliases?.map((alias) => alias.alias) ?? [], imdbRating: null,
      rottenTomatoesScore: null, runtimeMinutes: null, status: null,
      popularity: item.popularity, imdbId: item.imdbId!,
    };
    let id = titleId;
    const [existing] = titleId
      ? await tx.select().from(titlesTable).where(eq(titlesTable.id, titleId))
      : [];
    const merged = mergeTitle(existing, values);
    if (id) await tx.update(titlesTable).set(merged).where(eq(titlesTable.id, id));
    else {
      const [inserted] = await tx.insert(titlesTable).values(merged).returning({ id: titlesTable.id });
      id = inserted.id;
    }
    await syncAliases(tx, id, item.name, item, existing?.altTitles ?? []);
    await upsertMapping(tx, id, "IMDb", item.imdbId!);
    await upsertSafety(tx, id);
  });
  return { episodes: 0 };
}

export function parseArgs() {
  const args = process.argv.slice(2);
  const valueFlags = new Set(["--type", "--limit"]);
  const bareFlags = new Set(["--dry-run", "--allow-partial"]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (bareFlags.has(arg)) continue;
    const equalsFlag = arg.split("=")[0];
    if (valueFlags.has(equalsFlag)) {
      if (arg === equalsFlag && (!args[index + 1] || args[index + 1].startsWith("--"))) {
        throw new Error(`${equalsFlag} requires a value`);
      }
      if (arg === equalsFlag) index++;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  const typeArg = args.find((arg) => arg.startsWith("--type="))?.slice(7) ??
    (args.includes("--type") ? args[args.indexOf("--type") + 1] : undefined);
  const validTypes = ["movie", "tv", "anime", "documentary"];
  const requestedTypes = typeArg?.split(",") ?? [];
  if (requestedTypes.some((value) => !validTypes.includes(value))) {
    throw new Error(`Invalid --type. Expected a comma-separated list of: ${validTypes.join(", ")}`);
  }
  const types = requestedTypes.length ? requestedTypes as CatalogType[] : undefined;
  const limitValue = args.find((arg) => arg.startsWith("--limit="))?.slice(8) ??
    (args.includes("--limit") ? args[args.indexOf("--limit") + 1] : undefined);
  const limit = limitValue ? Number(limitValue) : undefined;
  if (limitValue !== undefined && (!/^(0|[1-9]\d*)$/.test(limitValue) || !Number.isFinite(limit) || !Number.isInteger(limit) || (limit ?? 0) < 0)) {
    throw new Error("--limit must be a non-negative integer");
  }
  return { dryRun: args.includes("--dry-run"), allowPartial: args.includes("--allow-partial"), types, limit };
}

async function updateHealth(provider: string, attempted: number, succeeded: number, lastError: string | null) {
  const status = attempted === 0 ? "provider_unavailable" : succeeded === attempted ? "healthy" : succeeded === 0 ? "failing" : "degraded";
  const [previous] = await db.select({ lastSuccessAt: integrationHealthTable.lastSuccessAt })
    .from(integrationHealthTable).where(eq(integrationHealthTable.provider, provider)).limit(1);
  const expectedItems = sourceItems.filter((item) => item.source === (provider === "TVMaze" ? "tvmaze" : "wikipedia"));
  const mappedTitles = provider === "TVMaze"
    ? Number((await db.select({ count: sql<number>`count(distinct ${providerMappingsTable.titleId})::int` })
      .from(providerMappingsTable)
      .where(and(eq(providerMappingsTable.provider, "TVMaze"), eq(providerMappingsTable.status, "mapped"))))[0]?.count ?? 0)
    : Number((await db.select({ count: sql<number>`count(*)::int` }).from(titlesTable)
      .where(inArray(titlesTable.imdbId, expectedItems.map((item) => item.imdbId!).filter(Boolean))))[0]?.count ?? 0);
  const values = {
    provider, status, lastSyncAt: new Date(), lastSuccessAt: succeeded ? new Date() : null,
    lastError, successRatePercent: attempted ? (succeeded / attempted) * 100 : 0,
    mappedTitles, missingMappings: Math.max(0, expectedItems.length - mappedTitles),
  };
  if (!succeeded && previous?.lastSuccessAt) values.lastSuccessAt = previous.lastSuccessAt;
  const [existing] = await db.select({ id: integrationHealthTable.id })
    .from(integrationHealthTable).where(eq(integrationHealthTable.provider, provider)).limit(1);
  if (existing) await db.update(integrationHealthTable).set(values).where(eq(integrationHealthTable.id, existing.id));
  else await db.insert(integrationHealthTable).values(values);
}

export type SyncOptions = {
  dryRun: boolean;
  allowPartial: boolean;
  types?: CatalogType[];
  limit?: number;
};

export type SyncProgress = {
  item: SourceItem;
  status: "running" | "succeeded" | "failed";
  attempted: number;
  succeeded: number;
  episodes: number;
  error?: string;
};
async function runCatalogSyncUnlocked(
  options: SyncOptions,
  items: SourceItem[],
  onProgress?: (progress: SyncProgress) => void | Promise<void>,
): Promise<SyncResult> {
  if (!options.dryRun) {
    await preflightDedupe();
    await repairLegacyMappings();
  }
  const selected = items.filter((item) => !options.types?.length || options.types.includes(item.type)).slice(0, options.limit);
  const counts = { attempted: 0, succeeded: 0, episodes: 0 };
  const failures: SyncResult["failures"] = [];
  const health = new Map<string, { attempted: number; succeeded: number; error: string | null }>();
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const item = selected[cursor++];
      if (!item) return;
      counts.attempted++;
      const provider = item.source === "tvmaze" ? "TVMaze" : "Wikipedia";
      await onProgress?.({ item, status: "running", ...counts });
      const h = health.get(provider) ?? { attempted: 0, succeeded: 0, error: null };
      h.attempted++;
      health.set(provider, h);
      try {
        const payload = await fetchSource(item);
        if (!options.dryRun) {
          const result = item.source === "tvmaze" ? await ingestShow(item, payload.show) : await ingestMovie(item, payload.wiki);
          counts.episodes += result.episodes;
        }
        counts.succeeded++;
        h.succeeded++;
        await onProgress?.({ item, status: "succeeded", ...counts });
        process.stdout.write(`[${counts.attempted}/${selected.length}] ✓ ${item.name}\n`);
      } catch (error) {
        h.error = error instanceof Error ? error.message : String(error);
        failures.push({ key: item.key, title: item.name, provider, error: h.error });
        await onProgress?.({ item, status: "failed", ...counts, error: h.error });
        process.stdout.write(`[${counts.attempted}/${selected.length}] ✗ ${item.name}: ${h.error}\n`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, selected.length || 1) }, worker));
  if (!options.dryRun) {
    for (const [provider, value] of health) await updateHealth(provider, value.attempted, value.succeeded, value.error);
  }
  const byType = Object.fromEntries(["movie", "tv", "anime", "documentary"].map((type) => [type, selected.filter((item) => item.type === type).length]));
  process.stdout.write(JSON.stringify({ dryRun: options.dryRun, selected: selected.length, selectedByType: byType, succeeded: counts.succeeded, failures: failures.length, episodes: counts.episodes }) + "\n");
  if (failures.length && !options.allowPartial) process.exitCode = 1;
  return { selected: selected.length, succeeded: counts.succeeded, episodes: counts.episodes, failures };
}

async function withCatalogLock<T>(work: () => Promise<T>, waitForLock = true): Promise<T | null> {
  const client = await pool.connect();
  try {
    if (waitForLock) {
      await client.query("select pg_advisory_lock(hashtext('watchtime:catalog-sync'))");
    } else {
      const result = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext('watchtime:catalog-sync')) as locked");
      if (!result.rows[0]?.locked) return null;
    }
    return await work();
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('watchtime:catalog-sync'))").catch(() => {});
    client.release();
  }
}

export function runCatalogSync(
  options: SyncOptions = parseArgs(),
  items: SourceItem[] = sourceItems,
  onProgress?: (progress: SyncProgress) => void | Promise<void>,
  waitForLock = true,
) {
  return withCatalogLock(() => runCatalogSyncUnlocked(options, items, onProgress), waitForLock);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCatalogSync().catch((error) => {
    process.stderr.write(`Catalog sync failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }).finally(() => pool.end());
}

export type SyncResult = {
  selected: number;
  succeeded: number;
  episodes: number;
  failures: Array<{ key: string; title: string; provider: "TVMaze" | "Wikipedia"; error: string }>;
};

async function syncAliases(tx: any, titleId: number, canonicalName: string, item: SourceItem, legacyAliases: unknown) {
  const existing = await tx.select().from(titleAliasesTable)
    .where(eq(titleAliasesTable.titleId, titleId));
  const existingNormalized = new Set(existing.map((row: any) => row.normalizedAlias));
  const canonical = normalizeTitle(canonicalName);

  // Aliases that predate structured provenance are treated as editorial so a
  // provider refresh can never erase them.
  for (const alias of Array.isArray(legacyAliases) ? legacyAliases : []) {
    const trimmed = typeof alias === "string" ? alias.trim() : "";
    const normalizedAlias = normalizeTitle(trimmed);
    if (!trimmed || normalizedAlias === canonical || existingNormalized.has(normalizedAlias)) continue;
    await tx.insert(titleAliasesTable).values({
      titleId,
      alias: trimmed,
      normalizedAlias,
      language: aliasLanguage(trimmed),
      sourceName: "Existing catalog metadata",
      sourceUrl: null,
      isEditorial: true,
    });
    existingNormalized.add(normalizedAlias);
  }

  const sourceAliases = new Map<string, AliasSource>();
  for (const source of item.aliases ?? []) {
    const trimmed = source.alias.trim();
    const normalizedAlias = normalizeTitle(trimmed);
    if (!trimmed || normalizedAlias === canonical || sourceAliases.has(normalizedAlias)) continue;
    sourceAliases.set(normalizedAlias, { ...source, alias: trimmed });
  }
  for (const [normalizedAlias, source] of sourceAliases) {
    const values = {
      alias: source.alias,
      language: source.language,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      isEditorial: true,
      updatedAt: new Date(),
    };
    const [current] = await tx.select().from(titleAliasesTable).where(and(
      eq(titleAliasesTable.titleId, titleId),
      eq(titleAliasesTable.normalizedAlias, normalizedAlias),
    )).limit(1);
    if (current) {
      await tx.update(titleAliasesTable).set(values).where(eq(titleAliasesTable.id, current.id));
    } else {
      await tx.insert(titleAliasesTable).values({ titleId, normalizedAlias, ...values });
    }
  }

  const aliases = await tx.select({ alias: titleAliasesTable.alias }).from(titleAliasesTable)
    .where(eq(titleAliasesTable.titleId, titleId))
    .orderBy(titleAliasesTable.id);
  await tx.update(titlesTable).set({ altTitles: aliases.map((row: any) => row.alias) })
    .where(eq(titlesTable.id, titleId));
}
