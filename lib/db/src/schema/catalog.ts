import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
  pgEnum,
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
});

export const seasonsTable = pgTable("seasons", {
  id: serial("id").primaryKey(),
  titleId: integer("title_id")
    .notNull()
    .references(() => titlesTable.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull(),
  name: text("name").notNull(),
  overview: text("overview"),
});

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
});

export const castMembersTable = pgTable("cast_members", {
  id: serial("id").primaryKey(),
  titleId: integer("title_id")
    .notNull()
    .references(() => titlesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  character: text("character").notNull(),
  photoUrl: text("photo_url"),
  ord: integer("ord").notNull().default(0),
});

export const watchProvidersTable = pgTable("watch_providers", {
  id: serial("id").primaryKey(),
  titleId: integer("title_id")
    .notNull()
    .references(() => titlesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // stream | rent | buy
  logoUrl: text("logo_url"),
});

export type Title = typeof titlesTable.$inferSelect;
export type Season = typeof seasonsTable.$inferSelect;
export type Episode = typeof episodesTable.$inferSelect;
