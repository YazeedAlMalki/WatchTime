import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";

export const contentTypeEnum = pgEnum("content_type", [
  "movie",
  "tv",
  "anime",
  "documentary",
]);

export const titlesTable = pgTable("titles", {
  id: serial("id").primaryKey(),
  type: contentTypeEnum("type").notNull(),
  name: text("name").notNull(),
  overview: text("overview"),
  posterUrl: text("poster_url"),
  backdropUrl: text("backdrop_url"),
  year: integer("year"),
  genres: text("genres").array().notNull().default([]),
  altTitles: text("alt_titles").array().notNull().default([]),
  imdbRating: real("imdb_rating"),
  rottenTomatoesScore: integer("rotten_tomatoes_score"),
  runtimeMinutes: integer("runtime_minutes"),
  status: text("status"),
  popularity: integer("popularity").notNull().default(0),
  tmdbId: integer("tmdb_id"),
  imdbId: text("imdb_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("titles_name_search_idx").on(table.name),
  index("titles_type_popularity_idx").on(table.type, table.popularity),
]);

export const titleAliasesTable = pgTable("title_aliases", {
  id: serial("id").primaryKey(),
  titleId: integer("title_id")
    .notNull()
    .references(() => titlesTable.id, { onDelete: "cascade" }),
  alias: text("alias").notNull(),
  normalizedAlias: text("normalized_alias").notNull(),
  language: text("language"),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url"),
  isEditorial: boolean("is_editorial").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("title_aliases_title_normalized_idx").on(table.titleId, table.normalizedAlias),
  index("title_aliases_normalized_idx").on(table.normalizedAlias),
  index("title_aliases_title_idx").on(table.titleId),
]);

export const seasonsTable = pgTable("seasons", {
  id: serial("id").primaryKey(),
  titleId: integer("title_id")
    .notNull()
    .references(() => titlesTable.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull(),
  name: text("name").notNull(),
  overview: text("overview"),
}, (table) => [index("seasons_title_order_idx").on(table.titleId, table.seasonNumber)]);

export const episodesTable = pgTable("episodes", {
  id: serial("id").primaryKey(),
  titleId: integer("title_id")
    .notNull()
    .references(() => titlesTable.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull(),
  episodeNumber: integer("episode_number").notNull(),
  name: text("name").notNull(),
  overview: text("overview"),
  airDate: text("air_date"),
  runtimeMinutes: integer("runtime_minutes"),
  stillUrl: text("still_url"),
}, (table) => [
  index("episodes_title_order_idx").on(table.titleId, table.seasonNumber, table.episodeNumber),
]);

export const castMembersTable = pgTable("cast_members", {
  id: serial("id").primaryKey(),
  titleId: integer("title_id")
    .notNull()
    .references(() => titlesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  character: text("character").notNull(),
  photoUrl: text("photo_url"),
  ord: integer("ord").notNull().default(0),
}, (table) => [index("cast_title_order_idx").on(table.titleId, table.ord)]);

export const watchProvidersTable = pgTable("watch_providers", {
  id: serial("id").primaryKey(),
  titleId: integer("title_id")
    .notNull()
    .references(() => titlesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // stream | rent | buy
  logoUrl: text("logo_url"),
}, (table) => [index("watch_providers_title_name_idx").on(table.titleId, table.name)]);

export type Title = typeof titlesTable.$inferSelect;
export type TitleAlias = typeof titleAliasesTable.$inferSelect;
export type Season = typeof seasonsTable.$inferSelect;
export type Episode = typeof episodesTable.$inferSelect;
