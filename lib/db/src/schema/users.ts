import {
  pgTable,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const usersTable = pgTable(
  "users",
  {
    id: text("id").primaryKey(), // Clerk user id
    email: text("email").notNull(),
    name: text("name"),
    isAdmin: boolean("is_admin").notNull().default(false),
    preferredRatingRegion: text("preferred_rating_region").notNull().default("US"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Enforce the single-admin invariant at the database level.
    uniqueIndex("users_single_admin_idx").on(t.isAdmin).where(sql`is_admin`),
  ],
);

export type User = typeof usersTable.$inferSelect;
