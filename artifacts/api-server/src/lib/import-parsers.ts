import type { ImportKind, NormalizedImportRecord } from "@workspace/db";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5_000;
export const MAX_IMPORT_JSON_BYTES = 13 * 1024 * 1024;

export type ImportSource = "tvtime" | "trakt" | "letterboxd" | "generic";
export type ParsedImportRow =
  | { rowNumber: number; record: NormalizedImportRecord }
  | { rowNumber: number; errorCode: "invalid_row" | "invalid_date" | "unsupported_row" };

type ObjectRow = Record<string, unknown>;
const SOURCES = new Set<ImportSource>(["tvtime", "trakt", "letterboxd", "generic"]);
const KINDS = new Set<ImportKind>(["watched_movie", "watched_episode", "tracked_show", "watchlist"]);
const TYPES = new Set(["movie", "tv"]);

function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function objectValue(row: ObjectRow, ...names: string[]): unknown {
  const keyed = new Map(Object.entries(row).map(([name, val]) => [key(name), val]));
  for (const name of names) {
    const found = keyed.get(key(name));
    if (found !== undefined && found !== null && found !== "") return found;
  }
  return undefined;
}

function rawValue(row: ObjectRow, ...names: string[]): unknown {
  const keyed = new Map(Object.entries(row).map(([name, val]) => [key(name), val]));
  for (const name of names) {
    if (keyed.has(key(name))) return keyed.get(key(name));
  }
  return undefined;
}

function text(row: ObjectRow, ...names: string[]): string | null {
  const found = objectValue(row, ...names);
  return typeof found === "string" && found.trim() ? found.trim() : null;
}

function supplied(row: ObjectRow, ...names: string[]): boolean {
  return names.some((name) => Object.keys(row).some((rowKey) => key(rowKey) === key(name)));
}

function positiveInteger(row: ObjectRow, ...names: string[]): number | null | "invalid" {
  const found = rawValue(row, ...names);
  if (found === undefined || found === null || (typeof found === "string" && found.trim() === "")) return null;
  if (typeof found === "number") return Number.isSafeInteger(found) && found > 0 ? found : "invalid";
  if (typeof found !== "string" || !/^[1-9]\d*$/.test(found.trim())) return "invalid";
  const result = Number(found);
  return Number.isSafeInteger(result) ? result : "invalid";
}

function nonNegativeInteger(row: ObjectRow, ...names: string[]): number | null | "invalid" {
  const found = rawValue(row, ...names);
  if (found === undefined || found === null || (typeof found === "string" && found.trim() === "")) return null;
  if (typeof found === "number") return Number.isSafeInteger(found) && found >= 0 ? found : "invalid";
  if (typeof found !== "string" || !/^\d+$/.test(found.trim())) return "invalid";
  const result = Number(found);
  return Number.isSafeInteger(result) ? result : "invalid";
}

function year(row: ObjectRow): number | null | "invalid" {
  if (!supplied(row, "year", "release year")) return null;
  const result = positiveInteger(row, "year", "release year");
  if (result === null) return null;
  return typeof result === "number" && result >= 1888 && result <= 3000 ? result : "invalid";
}

function ids(row: ObjectRow): { imdbId: string | null; tmdbId: number | null } | "invalid" {
  const imdbId = text(row, "imdbId", "imdb id", "imdb");
  const suppliedImdb = rawValue(row, "imdbId", "imdb id", "imdb");
  if (suppliedImdb !== undefined && suppliedImdb !== null && String(suppliedImdb).trim() !== "" && (!imdbId || !/^tt\d{7,10}$/i.test(imdbId))) return "invalid";
  const tmdbId = positiveInteger(row, "tmdbId", "tmdb id", "tmdb");
  if (tmdbId === "invalid") return "invalid";
  return { imdbId: imdbId?.toLowerCase() ?? null, tmdbId };
}

function watchedAt(row: ObjectRow, names = ["watchedAt", "watched date", "watched_at"]): string | null | "invalid" {
  if (!supplied(row, ...names)) return null;
  const date = text(row, ...names);
  if (!date) return null;
  const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/;
  const match = calendar.exec(date);
  if (!match) return "invalid";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return "invalid";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "invalid" : parsed.toISOString();
}

function makeRecord(
  row: ObjectRow,
  kind: ImportKind,
  expectedType: "movie" | "tv",
  dateNames?: string[],
): NormalizedImportRecord | "invalid_row" | "invalid_date" {
  const title = text(row, "title", "name");
  if (!title || title.length > 500) return "invalid_row";
  const suppliedType = text(row, "type", "media type");
  const rawType = rawValue(row, "type", "media type");
  if (rawType !== undefined && rawType !== null && String(rawType).trim() !== "" && (!suppliedType || !TYPES.has(suppliedType.toLowerCase()) || suppliedType.toLowerCase() !== expectedType)) {
    return "invalid_row";
  }
  const recordYear = year(row);
  const identifiers = ids(row);
  const date = watchedAt(row, dateNames);
  const season = nonNegativeInteger(row, "season", "season number");
  const episode = positiveInteger(row, "episode", "episode number");
  if (recordYear === "invalid" || identifiers === "invalid" || season === "invalid" || episode === "invalid") return "invalid_row";
  if (date === "invalid") return "invalid_date";
  if (kind === "watched_episode" && (season === null || episode === null)) return "invalid_row";
  return {
    kind,
    title,
    type: expectedType,
    year: recordYear,
    imdbId: identifiers.imdbId,
    tmdbId: identifiers.tmdbId,
    season,
    episode,
    watchedAt: date,
  };
}

/** RFC-4180 CSV parser; content is bounded before this is called. */
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else field += character;
    } else if (afterQuote) {
      if (character === ",") {
        row.push(field);
        field = "";
        afterQuote = false;
      } else if (character === "\n") {
        row.push(field);
        if (row.some((entry) => entry.trim())) rows.push(row);
        row = [];
        field = "";
        afterQuote = false;
      } else if (character === "\r" && content[index + 1] === "\n") {
        // CRLF line ending; the following newline finalises the record.
      } else {
        throw new Error("Malformed CSV quoting");
      }
    } else if (character === '"') {
      if (field.length > 0) throw new Error("Malformed CSV quoting");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((entry) => entry.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("Malformed CSV quoting");
  row.push(field.replace(/\r$/, ""));
  if (row.some((entry) => entry.trim())) rows.push(row);
  return rows;
}

function csvRows(content: string, requiredHeaders: string[]): ObjectRow[] {
  const parsed = parseCsv(content);
  if (parsed.length < 2) throw new Error("Import must include a header and at least one row");
  const headers = parsed[0].map((header) => header.trim());
  if (!headers.every(Boolean) || new Set(headers.map(key)).size !== headers.length) throw new Error("CSV headers must be unique and non-empty");
  const headerKeys = new Set(headers.map(key));
  if (!requiredHeaders.every((header) => headerKeys.has(key(header)))) throw new Error(`CSV must include ${requiredHeaders.join(", ")} headers`);
  return parsed.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function jsonRows(content: string, allowBareArray: boolean): ObjectRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Malformed JSON import");
  }
  const entries = Array.isArray(parsed) && allowBareArray
    ? parsed
    : parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as ObjectRow).items)
      ? (parsed as ObjectRow).items as unknown[]
      : null;
  if (!entries || entries.length === 0) throw new Error("JSON import must contain at least one item");
  if (entries.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) throw new Error("JSON import items must all be objects");
  return entries as ObjectRow[];
}

function formatRows(rows: ObjectRow[], convert: (row: ObjectRow, index: number) => NormalizedImportRecord | "invalid_row" | "invalid_date" | "unsupported_row"): ParsedImportRow[] {
  if (rows.length > MAX_IMPORT_ROWS) throw new Error("Import contains more than 5,000 rows");
  return rows.map((row, index) => {
    const result = convert(row, index);
    return typeof result === "string" ? { rowNumber: index + 1, errorCode: result } : { rowNumber: index + 1, record: result };
  });
}

function genericRows(fileName: string, content: string): ParsedImportRow[] {
  const isJson = fileName.toLowerCase().endsWith(".json");
  const rows = isJson ? jsonRows(content, true) : csvRows(content, ["kind", "title"]);
  return formatRows(rows, (row) => {
    const itemKind = text(row, "kind")?.toLowerCase();
    if (!itemKind || !KINDS.has(itemKind as ImportKind)) return "unsupported_row";
    const suppliedType = text(row, "type")?.toLowerCase();
    const expectedType = itemKind === "watched_movie"
      ? "movie"
      : itemKind === "watchlist"
        ? suppliedType === "movie" ? "movie" : suppliedType === "tv" ? "tv" : null
        : "tv";
    if (!expectedType) return "invalid_row";
    return makeRecord(row, itemKind as ImportKind, expectedType);
  });
}

function tvTimeRows(fileName: string, content: string): ParsedImportRow[] {
  const isJson = fileName.toLowerCase().endsWith(".json");
  const rows = isJson ? jsonRows(content, false) : csvRows(content, ["title", "type"]);
  return formatRows(rows, (row) => {
    const type = text(row, "type")?.toLowerCase();
    if (type === "movie") return makeRecord(row, "watched_movie", "movie");
    if (type === "episode") return makeRecord({ ...row, type: "tv" }, "watched_episode", "tv");
    if (type === "show" || type === "tv") return makeRecord({ ...row, type: "tv" }, "tracked_show", "tv");
    if (type === "watchlist_movie") return makeRecord({ ...row, type: "movie" }, "watchlist", "movie");
    if (type === "watchlist_show") return makeRecord({ ...row, type: "tv" }, "watchlist", "tv");
    return "unsupported_row";
  });
}

function traktRows(fileName: string, content: string): ParsedImportRow[] {
  if (!fileName.toLowerCase().endsWith(".json")) throw new Error("Trakt imports must be JSON exports");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Malformed JSON import");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Trakt import must be an export object");
  const exportObject = parsed as ObjectRow;
  const allowed = ["movies", "shows", "episodes", "watchlist"] as const;
  const present = allowed.filter((name) => Array.isArray(exportObject[name]));
  if (present.length === 0 || Object.keys(exportObject).some((name) => !allowed.includes(name as typeof allowed[number]))) {
    throw new Error("Trakt export must contain supported collection arrays");
  }
  const rows: Array<{ row: ObjectRow; kind: ImportKind; type: "movie" | "tv"; dateNames?: string[] }> = [];
  for (const collection of present) {
    const entries = exportObject[collection] as unknown[];
    if (entries.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) throw new Error("Trakt collection items must be objects");
    for (const entry of entries as ObjectRow[]) {
      const media = collection === "episodes" || collection === "shows"
        ? entry.show
        : collection === "movies"
          ? entry.movie
          : entry.movie ?? entry.show;
      if (!media || typeof media !== "object" || Array.isArray(media)) {
        rows.push({ row: {}, kind: "watched_movie", type: "movie" });
        continue;
      }
      const mediaObject = media as ObjectRow;
      const identifiers = mediaObject.ids && typeof mediaObject.ids === "object" ? mediaObject.ids as ObjectRow : {};
      const episode = entry.episode && typeof entry.episode === "object" ? entry.episode as ObjectRow : {};
      rows.push({
        kind: collection === "episodes" ? "watched_episode" : collection === "shows" ? "tracked_show" : collection === "watchlist" ? "watchlist" : "watched_movie",
        type: collection === "movies" || (collection === "watchlist" && Boolean(entry.movie)) ? "movie" : "tv",
        dateNames: ["watched_at", "collected_at", "listed_at"],
        row: {
          title: mediaObject.title,
          year: mediaObject.year,
          imdbId: identifiers.imdb,
          tmdbId: identifiers.tmdb,
          season: episode.season,
          episode: episode.number,
          watchedAt: entry.watched_at ?? entry.collected_at ?? entry.listed_at,
        },
      });
    }
  }
  if (rows.length === 0) throw new Error("Trakt export must contain at least one item");
  return formatRows(rows.map((entry) => entry.row), (row, index) => makeRecord(row, rows[index].kind, rows[index].type, rows[index].dateNames));
}

function letterboxdRows(fileName: string, content: string): ParsedImportRow[] {
  if (fileName.toLowerCase().endsWith(".json")) throw new Error("Letterboxd imports must be CSV exports");
  const rows = csvRows(content, ["name", "year"]);
  const headers = new Set(Object.keys(rows[0] ?? {}).map(key));
  const explicitlyWatched = headers.has("watcheddate");
  const legacyDiary = headers.has("date") && headers.has("letterboxduri") && fileName.toLowerCase().includes("diary");
  const standardWatched = headers.has("date") && headers.has("letterboxduri") && fileName.toLowerCase() === "watched.csv";
  const watchlist = fileName.toLowerCase().includes("watchlist") && headers.has("letterboxduri");
  if (!explicitlyWatched && !legacyDiary && !standardWatched && !watchlist) {
    return formatRows(rows, () => "unsupported_row");
  }
  return formatRows(rows, (row) => {
    if (watchlist) return makeRecord(row, "watchlist", "movie", ["listed date"]);
    if (explicitlyWatched) {
      if (!text(row, "watched date")) return "unsupported_row";
      return makeRecord(row, "watched_movie", "movie", ["watched date"]);
    }
    // Letterboxd Diary's Date + Letterboxd URI is the documented legacy diary shape.
    if (!text(row, "date")) return "unsupported_row";
    return makeRecord({ ...row, watchedAt: objectValue(row, "date") }, "watched_movie", "movie", ["watchedAt"]);
  });
}

export function parseImportContent(source: string, fileName: string, content: string): ParsedImportRow[] {
  if (!SOURCES.has(source as ImportSource)) throw new Error("Unsupported import source");
  if (!fileName.trim() || fileName.length > 255) throw new Error("A valid file name is required");
  if (Buffer.byteLength(content, "utf8") > MAX_IMPORT_BYTES) throw new Error("Import content exceeds 2 MiB");
  switch (source as ImportSource) {
    case "generic": return genericRows(fileName, content);
    case "tvtime": return tvTimeRows(fileName, content);
    case "trakt": return traktRows(fileName, content);
    case "letterboxd": return letterboxdRows(fileName, content);
  }
}