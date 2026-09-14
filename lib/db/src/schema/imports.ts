import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { titlesTable, episodesTable } from "./catalog";
import { usersTable } from "./users";

export type ImportKind =
  | "watched_movie"
  | "watched_episode"
  | "tracked_show"
  | "watchlist";

export type NormalizedImportRecord = {
  kind: ImportKind;
  title: string;
  type: "movie" | "tv" | null;
  year: number | null;
  imdbId: string | null;
  tmdbId: number | null;
  season: number | null;
  episode: number | null;
  watchedAt: string | null;
};

export type ImportCandidate = {
  titleId: number;
  name: string;
  type: string;
  year: number | null;
};

export const importsTable = pgTable(
  "imports",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    fileName: text("file_name").notNull(),
    fingerprint: text("fingerprint").notNull(),
    status: text("status").notNull().default("ready"),
    rowCount: integer("row_count").notNull(),
    summary: jsonb("summary").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => [
    uniqueIndex("imports_user_source_fingerprint_idx").on(t.userId, t.source, t.fingerprint),
    index("imports_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const importItemsTable = pgTable(
  "import_items",
  {
    id: serial("id").primaryKey(),
    importId: integer("import_id")
      .notNull()
      .references(() => importsTable.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    kind: text("kind").notNull(),
    classification: text("classification").notNull(),
    selected: boolean("selected").notNull().default(false),
    errorCode: text("error_code"),
    normalized: jsonb("normalized").$type<NormalizedImportRecord>().notNull(),
    candidates: jsonb("candidates").$type<ImportCandidate[]>().notNull().default([]),
    titleId: integer("title_id").references(() => titlesTable.id, { onDelete: "set null" }),
    episodeId: integer("episode_id").references(() => episodesTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("import_items_import_row_idx").on(t.importId, t.rowNumber),
    index("import_items_import_classification_idx").on(t.importId, t.classification),
  ],
);