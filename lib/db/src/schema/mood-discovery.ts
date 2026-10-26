import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export type MoodDiscoveryState = {
  saved: string[];
  savedContext: Record<
    string,
    { preset: string | null; savedAt: number; filters: Record<string, unknown> }
  >;
  dismissed: string[];
  viewed: Record<
    string,
    {
      lastViewedAt: number;
      watched: boolean;
      rating?: number;
      feedback: string[];
    }
  >;
  feedback: Record<string, string[]>;
};

export const moodDiscoveryStateTable = pgTable("mood_discovery_state", {
  userId: text("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  state: jsonb("state").$type<MoodDiscoveryState>().notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
