export const MOOD_KEYS = [
  "feelGood",
  "intensity",
  "humour",
  "violence",
  "disturbing",
  "unpredictability",
  "demanding",
  "hopefulness",
  "pace",
  "escapism",
] as const;
export type MoodKey = (typeof MOOD_KEYS)[number];

export const CONTENT_KEYS = [
  "sexualContent",
  "violence",
  "gore",
  "profanity",
  "animalHarm",
  "disturbingThemes",
] as const;
export type ContentKey = (typeof CONTENT_KEYS)[number];

export type Region = "SA" | "US" | "GB" | "AE" | "DE" | "FR";
export const REGIONS: Region[] = ["SA", "US", "GB", "AE", "DE", "FR"];
export const PROVIDERS = ["Netflix", "Shahid", "Prime Video", "Apple TV+", "Disney+"] as const;
export const LANGS = ["en", "ar", "fr", "es", "ja", "ko", "hi", "de"] as const;
export type Context = "solo" | "date" | "family" | "children" | "friends";
export const CONTEXTS: Context[] = ["solo", "date", "family", "children", "friends"];
export const AGE_RANK: Record<string, number> = { G: 0, PG: 1, "PG-13": 2, R: 3, "18": 4 };
export type MoodImportance = 1 | 2 | 3;
export type ResultSort = "match" | "shortest" | "newest" | "rated" | "surprise";
export type AccessType = "stream" | "rent" | "buy";

export interface Availability {
  region: Region;
  provider: string;
  kind: "stream" | "rent" | "buy";
  dubs: string[];
}

export interface Movie {
  id: string;
  title: string;
  originalTitle?: string;
  year: number;
  country: string;
  posterUrl: string;
  backdropUrl: string;
  runtimeMinutes: number;
  director: string;
  cast: string[];
  genres: string[];
  languages: string[];
  subtitleLanguages: string[];
  ageRating: string;
  mood: Record<MoodKey, number>;
  content: Record<ContentKey, number>;
  availability: Availability[];
  summary: string;
  bestFor: string[];
  cautions: ContentKey[];
}

export interface Filters {
  preset: string | null;
  targets: Record<MoodKey, number>;
  active: Record<MoodKey, boolean>;
  importance: Record<MoodKey, MoodImportance>;
  maxRuntime: number;
  maxAgeRating: string | "any";
  context: Context;
  languages: string[];
  acceptSubs: boolean;
  acceptDub: boolean;
  requireArabicSubtitles: boolean;
  requireArabicDubbing: boolean;
  originalAudioOnly: boolean;
  region: Region;
  providers: string[];
  accessTypes: AccessType[];
  limits: Record<ContentKey, number>;
  hideWatched: boolean;
  includeHighlyRated: boolean;
  includeComfortRewatches: boolean;
  hideDismissed: boolean;
  avoidPoorMatches: boolean;
}

export interface Viewed {
  lastViewedAt: number;
  watched: boolean;
  rating?: number;
  feedback: string[];
}

export interface Session {
  started: boolean;
  ranAt: number | null;
  seed: number;
  sort: ResultSort;
  feedback: Record<string, string[]>;
}

export interface StoreState {
  filters: Filters;
  session: Session;
  saved: string[];
  savedContext: Record<string, { preset: string | null; savedAt: number; filters: Filters }>;
  dismissed: string[];
  viewed: Record<string, Viewed>;
  lang: "en" | "ar";
  storageError: boolean;
  cloudInitialized: boolean;
  cloudSyncDirty: boolean;
  cloudRevision: number;
  cloudBaseSnapshot: string | null;
}
