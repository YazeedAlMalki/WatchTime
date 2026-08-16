import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { titlesTable, episodesTable } from "./catalog";
import { usersTable } from "./users";

export const watchlistTable = pgTable(
  "watchlist",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    titleId: integer("title_id")
      .notNull()
      .references(() => titlesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("watchlist_user_title_idx").on(t.userId, t.titleId)],
);

export const watchedTitlesTable = pgTable(
  "watched_titles",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    titleId: integer("title_id")
      .notNull()
      .references(() => titlesTable.id, { onDelete: "cascade" }),
    watchedAt: timestamp("watched_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("watched_titles_user_title_idx").on(t.userId, t.titleId)],
);

export const watchedEpisodesTable = pgTable(
  "watched_episodes",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    titleId: integer("title_id")
      .notNull()
      .references(() => titlesTable.id, { onDelete: "cascade" }),
    episodeId: integer("episode_id")
      .notNull()
      .references(() => episodesTable.id, { onDelete: "cascade" }),
    watchedAt: timestamp("watched_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("watched_episodes_user_episode_idx").on(t.userId, t.episodeId),
  ],
);
