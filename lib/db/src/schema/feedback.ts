import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { titlesTable } from "./catalog";

export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  userId: text("user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  category: text("category").notNull(), // bug | feature | general
  message: text("message").notNull(),
  page: text("page"),
  titleId: integer("title_id").references(() => titlesTable.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("new"), // new | reviewing | resolved | closed
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("feedback_status_created_idx").on(table.status, table.createdAt),
]);

export const analyticsEventsTable = pgTable("analytics_events", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(), // page_view | search | title_view | safety_view | visit | registration
  name: text("name"), // e.g. title name, search query, page path
  device: text("device"),
  country: text("country"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("analytics_events_type_created_idx").on(table.eventType, table.createdAt),
  index("analytics_events_type_name_idx").on(table.eventType, table.name),
]);
