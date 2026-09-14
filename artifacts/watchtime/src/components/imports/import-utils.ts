import type { ImportCreateInput, ImportItem } from "@workspace/api-client-react";
import { FileJson2, FileSpreadsheet, FileUp, type LucideIcon } from "lucide-react";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5_000;

export type ImportSource = ImportCreateInput["source"];
export type PreviewFilter = "attention" | "all" | "selected" | "skipped";

export const sources: Array<{
  id: ImportSource;
  name: string;
  description: string;
  guidance: string;
  acceptedShape: string;
  excluded: string;
  accept: string;
  icon: LucideIcon;
}> = [
  {
    id: "tvtime",
    name: "TV Time",
    description: "Activity, followed shows, and watchlist rows",
    guidance: "Choose an individual CSV or JSON activity export after downloading or requesting your account data.",
    acceptedShape: "CSV requires title + type. JSON must be { items: [...] }. Types are movie, episode, show/tv, watchlist_movie, or watchlist_show.",
    excluded: "ZIP files, unstructured archives, and rows without one of those types are not imported.",
    accept: ".csv,.json,text/csv,application/json",
    icon: FileSpreadsheet,
  },
  {
    id: "trakt",
    name: "Trakt",
    description: "History, show progress, and watchlist exports",
    guidance: "Request a Trakt data export, then extract and choose one JSON export object locally.",
    acceptedShape: "JSON only, with supported collection arrays named movies, shows, episodes, and/or watchlist. Entries need a movie/show and ids object; episodes also need episode.season + episode.number.",
    excluded: "ZIP files, CSV files, custom collections, ratings, comments, and reviews are not imported.",
    accept: ".json,application/json",
    icon: FileJson2,
  },
  {
    id: "letterboxd",
    name: "Letterboxd",
    description: "Watched films from a compatible CSV export",
    guidance: "Download your Letterboxd data, extract a CSV, and select a watched, diary, or watchlist file.",
    acceptedShape: "CSV only: Name + Year plus Watched Date; or a diary-named file with Date + Letterboxd URI; or a watchlist-named file with Letterboxd URI.",
    excluded: "Do not upload ratings.csv: ratings alone are not watch history. Reviews, tags, and other list CSVs are not imported.",
    accept: ".csv,text/csv",
    icon: FileSpreadsheet,
  },
  {
    id: "generic",
    name: "Generic CSV / JSON",
    description: "Use our documented, portable template",
    guidance: "Map another export to our template, then upload one CSV or JSON file.",
    acceptedShape: "CSV requires kind + title. JSON is an array of items or { items: [...] }; use the optional fields in the templates below.",
    excluded: "Ratings, reviews, comments, social data, and custom lists are not imported.",
    accept: ".csv,.json,text/csv,application/json",
    icon: FileUp,
  },
];

export const genericCsvTemplate = `kind,title,type,year,imdbId,tmdbId,season,episode,watchedAt
watched_movie,Arrival,movie,2016,tt2543164,,,,
watched_episode,Example Series,tv,2024,,,1,1,2024-01-15T20:00:00Z
tracked_show,Example Series,tv,2024,,,,,
watchlist,Example Film,movie,2024,,,,,`;

export const genericJsonTemplate = JSON.stringify(
  {
    items: [
      {
        kind: "watched_movie",
        title: "Arrival",
        type: "movie",
        year: 2016,
        imdbId: "tt2543164",
        watchedAt: "2024-01-15T20:00:00Z",
      },
      {
        kind: "watched_episode",
        title: "Example Series",
        type: "tv",
        year: 2024,
        season: 1,
        episode: 1,
      },
    ],
  },
  null,
  2,
);

export const classifications = ["matched", "duplicate", "unmatched", "ambiguous", "invalid", "unsupported"] as const;

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function downloadText(content: string, fileName: string, mimeType = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function importIdFromSearch(search: string) {
  const rawId = new URLSearchParams(search).get("import");
  if (!rawId) return null;
  const id = Number(rawId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function currentSummary(items: ImportItem[]) {
  return items.reduce<Record<string, number>>(
    (summary, item) => ({ ...summary, [item.classification]: (summary[item.classification] ?? 0) + 1 }),
    Object.fromEntries(classifications.map((classification) => [classification, 0])),
  );
}

export function classificationLabel(classification: ImportItem["classification"]) {
  return classification.replace(/_/g, " ");
}

export function classificationClass(classification: ImportItem["classification"]) {
  switch (classification) {
    case "matched":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
    case "duplicate":
      return "border-sky-500/25 bg-sky-500/10 text-sky-300";
    case "ambiguous":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case "unmatched":
      return "border-orange-500/25 bg-orange-500/10 text-orange-300";
    default:
      return "border-destructive/30 bg-destructive/10 text-red-300";
  }
}

export function kindLabel(item: ImportItem) {
  const labels: Record<ImportItem["kind"], string> = {
    watched_movie: "Watched movie",
    watched_episode: "Watched episode",
    tracked_show: "Tracked show",
    watchlist: "Watchlist",
    unsupported: "Unsupported",
  };
  return labels[item.kind];
}

export function importedTitle(item: ImportItem) {
  const title = item.normalized.title || "No usable title";
  return item.kind === "watched_episode"
    ? `${title} · S${item.normalized.season} E${item.normalized.episode}`
    : title;
}

export function matchName(item: ImportItem) {
  const selectedCandidate = item.candidates.find((candidate) => candidate.titleId === item.titleId);
  return selectedCandidate
    ? `${selectedCandidate.name}${selectedCandidate.year ? ` (${selectedCandidate.year})` : ""}`
    : null;
}