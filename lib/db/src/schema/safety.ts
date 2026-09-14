import {
  pgTable,
  serial,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { titlesTable } from "./catalog";
import { usersTable } from "./users";

export type SafetyItem = {
  category: string;
  label: string;
  score: number | null;
  maxScore: number | null;
  description: string | null;
  severity?: "none" | "mild" | "moderate" | "severe";
};

// Source-attributed safety records at series/season/episode granularity.
export const safetyRecordsTable = pgTable("safety_records", {
  id: serial("id").primaryKey(),
  titleId: integer("title_id")
    .notNull()
    .references(() => titlesTable.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number"), // null => series/movie level
  episodeNumber: integer("episode_number"), // null => season or series level
  sourceName: text("source_name").notNull(),
  tier: integer("tier").notNull().default(2),
  isCommunity: boolean("is_community").notNull().default(false),
  ageRecommendation: text("age_recommendation"),
  url: text("url"),
  status: text("status").notNull().default("available"), // available | provider_unavailable
  items: jsonb("items").$type<SafetyItem[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const contributionStatusEnum = pgEnum("contribution_status", [
  "pending",
  "approved",
  "rejected",
  "flagged",
]);

export const contributionsTable = pgTable("contributions", {
  id: serial("id").primaryKey(),
  titleId: integer("title_id")
    .notNull()
    .references(() => titlesTable.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  severity: text("severity").notNull(), // none | mild | moderate | severe
  seasonNumber: integer("season_number"),
  episodeNumber: integer("episode_number"),
  description: text("description"),
  status: contributionStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  titleId: integer("title_id")
    .notNull()
    .references(() => titlesTable.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  reason: text("reason").notNull(),
  sourceName: text("source_name"),
  details: text("details"),
  status: text("status").notNull().default("open"), // open | resolved | dismissed
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const providerMappingsTable = pgTable("provider_mappings", {
  id: serial("id").primaryKey(),
  titleId: integer("title_id")
    .notNull()
    .references(() => titlesTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalId: text("external_id"),
  status: text("status").notNull().default("mapped"), // mapped | missing | error
  lastRefreshedAt: timestamp("last_refreshed_at"),
}, (table) => [
  index("provider_mappings_title_provider_idx").on(table.titleId, table.provider),
  index("provider_mappings_provider_external_idx").on(table.provider, table.externalId),
]);

export const adminAuditLogTable = pgTable("admin_audit_log", {
  id: serial("id").primaryKey(),
  adminId: text("admin_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // approve_contribution | reject_contribution | resolve_report | dismiss_report | update_feedback | refresh_content
  entityType: text("entity_type"), // contribution | report | feedback | content
  entityId: integer("entity_id"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const integrationHealthTable = pgTable("integration_health", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  status: text("status").notNull().default("healthy"), // healthy | degraded | failing | provider_unavailable
  lastSyncAt: timestamp("last_sync_at"),
  lastSuccessAt: timestamp("last_success_at"),
  lastError: text("last_error"),
  successRatePercent: real("success_rate_percent").notNull().default(100),
  mappedTitles: integer("mapped_titles").notNull().default(0),
  missingMappings: integer("missing_mappings").notNull().default(0),
}, (table) => [index("integration_health_provider_idx").on(table.provider)]);
