import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import {
  db,
  usersTable,
  titlesTable,
  safetyRecordsTable,
  contributionsTable,
  reportsTable,
  feedbackTable,
  providerMappingsTable,
  integrationHealthTable,
  analyticsEventsTable,
  watchedTitlesTable,
  adminAuditLogTable,
  catalogSyncRunsTable,
  catalogSyncItemsTable,
  titleAliasesTable,
  safetySyncRunsTable,
  type SafetySyncRunResult,
} from "@workspace/db";
import { and, asc, eq, sql, desc, gte, lte, ilike, inArray, isNull } from "drizzle-orm";
import {
  UpdateAdminContributionBody,
  UpdateAdminReportBody,
  UpdateAdminFeedbackBody,
  DeleteAdminContentAliasBody,
  ListAdminContentAliasesQueryParams,
  ListAdminContentAliasesResponse,
  ListAdminContentRefreshBatchHistoryResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/auth";
import {
  refreshDoesTheDogDieBatch,
  refreshDoesTheDogDieTitle,
} from "../lib/does-the-dog-die";
import {
  refreshWikidataBatch,
  refreshWikidataTitle,
} from "../lib/wikidata";
import {
  hasMalformedTimestamp,
  resolvePreferredRating,
  type RatingRegion,
} from "../lib/ratingRegions";
import { RATING_REGIONS_BY_CODE } from "@workspace/rating-regions";
import { retryFailedCatalogTitles, startCatalogRefresh } from "../lib/catalog-refresh";

const router: IRouter = Router();

const WIKIDATA_LOW_SUCCESS_RATE_THRESHOLD_PERCENT = 50;
const activeSafetySyncRunIds = new Set<number>();
const activeSafetySyncUniqueIndex =
  "safety_sync_runs_active_provider_offset_unique_idx";

function isActiveSafetySyncUniqueViolation(caught: unknown): boolean {
  if (!caught || typeof caught !== "object") return false;
  const error = caught as {
    code?: unknown;
    constraint?: unknown;
    cause?: unknown;
  };
  if (
    error.code === "23505" &&
    error.constraint === activeSafetySyncUniqueIndex
  ) {
    return true;
  }
  return isActiveSafetySyncUniqueViolation(error.cause);
}

router.use(requireAdmin);

router.get("/dashboard", async (_req, res) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [[users], [newUsers], [titles], [pending], [openReports], [newFeedback], [failing]] =
    await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(usersTable),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(gte(usersTable.createdAt, sevenDaysAgo)),
      db.select({ count: sql<number>`count(*)::int` }).from(titlesTable),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(contributionsTable)
        .where(eq(contributionsTable.status, "pending")),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(reportsTable)
        .where(eq(reportsTable.status, "open")),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(feedbackTable)
        .where(eq(feedbackTable.status, "new")),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(integrationHealthTable)
        .where(eq(integrationHealthTable.status, "failing")),
    ]);
  const [active] = await db
    .select({
      count: sql<number>`count(distinct ${watchedTitlesTable.userId})::int`,
    })
    .from(watchedTitlesTable)
    .where(gte(watchedTitlesTable.watchedAt, sevenDaysAgo));
  const [covered] = await db
    .select({
      count: sql<number>`count(distinct ${safetyRecordsTable.titleId})::int`,
    })
    .from(safetyRecordsTable)
    .where(eq(safetyRecordsTable.status, "available"));

  return res.json({
    totalUsers: users.count,
    newRegistrations7d: newUsers.count,
    activeUsers7d: active.count,
    titlesInCatalog: titles.count,
    safetyCoveragePercent:
      titles.count === 0 ? 0 : Math.round((covered.count / titles.count) * 1000) / 10,
    pendingContributions: pending.count,
    openReports: openReports.count,
    newFeedback: newFeedback.count,
    failedSyncs: failing.count,
  });
});

router.get("/contributions", async (req, res) => {
  const status = req.query.status as string | undefined;
  if (status && !["pending", "approved", "rejected", "flagged"].includes(status)) {
    return res.status(400).json({ error: "Invalid contribution status" });
  }
  const rows = await db
    .select({ log: adminAuditLogTable, adminEmail: usersTable.email })
    .from(adminAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, adminAuditLogTable.adminId))
    .where(where)
    .orderBy(desc(adminAuditLogTable.createdAt));
  return res.json(
    rows.map(({ f, email }) => ({
      id: f.id,
      category: f.category,
      message: f.message,
      page: f.page,
      titleId: f.titleId,
      userEmail: email,
      status: f.status,
      createdAt: f.createdAt.toISOString(),
    })),
  );
});

router.patch("/feedback/:feedbackId", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const parsed = DeleteAdminContentAliasBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.id, id)).for("update");
    if (!current) return null;
    if (current.updatedAt.getTime() !== expectedUpdatedAtDate.getTime()) {
      const [title] = await tx.select({
        name: titlesTable.name,
        type: titlesTable.type,
        year: titlesTable.year,
      }).from(titlesTable).where(eq(titlesTable.id, current.titleId));
      if (!title) throw new Error("Alias references a missing catalog title");
      const [collision] = await tx.select({
        titleCount: sql<number>`count(distinct ${titleAliasesTable.titleId})::int`,
      }).from(titleAliasesTable).where(
        eq(titleAliasesTable.normalizedAlias, current.normalizedAlias),
      );
      return {
        code: "stale_alias",
        error: "This alternate title changed while you were editing. Refresh the list and review the newer correction before saving.",
        current: {
          id: current.id,
          titleId: current.titleId,
          titleName: title.name,
          titleType: title.type,
          titleYear: title.year,
          alias: current.alias,
          language: current.language,
          sourceName: current.sourceName,
          sourceUrl: current.sourceUrl,
          isEditorial: Boolean(current.isEditorial),
          collision: (collision?.titleCount ?? 1) > 1,
          collisionTitleCount: collision?.titleCount ?? 1,
          updatedAt: current.updatedAt.toISOString(),
        },
      } as const;
    }
    const [title] = await tx.select({ name: titlesTable.name }).from(titlesTable)
      .where(eq(titlesTable.id, current.titleId));
    const normalizedAlias = normalizeAlias(alias);
    if (!normalizedAlias || normalizedAlias === normalizeAlias(title.name)) {
      return { error: "Alias must differ from the canonical title" } as const;
    }
    const [duplicate] = await tx.select({ id: titleAliasesTable.id }).from(titleAliasesTable).where(and(
      eq(titleAliasesTable.titleId, current.titleId),
      eq(titleAliasesTable.normalizedAlias, normalizedAlias),
    )).limit(1);
    if (duplicate && duplicate.id !== id) return { error: "This title already has that alias" } as const;
    const [row] = await tx.update(titleAliasesTable).set({
      alias,
      normalizedAlias,
      language,
      sourceUrl,
      isEditorial: true,
      sourceName: "Admin editorial",
      updatedAt: new Date(),
    }).where(eq(titleAliasesTable.id, id)).returning();
    await refreshTitleAliasSearchList(tx, current.titleId);
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!,
      action: "update_title_alias",
      entityType: "title_alias",
      entityId: id,
      details: { titleId: current.titleId, previousAlias: current.alias, alias },
    });
    return { row } as const;
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  const [title] = await db.select().from(titlesTable)
    .where(eq(titlesTable.id, updated.titleId));
  return res.json({
    id: updated.id,
    titleId: updated.titleId,
    titleName: title?.name ?? "",
    category: updated.category,
    severity: updated.severity,
    seasonNumber: updated.seasonNumber,
    episodeNumber: updated.episodeNumber,
    description: updated.description,
    status: updated.status,
    createdAt: updated.createdAt.toISOString(),
  });
});

/*
router.patch("/reports/:reportId", async (req, res) => {
  const id = parseInt(String(req.params.reportId), 10);
  const parsed = UpdateAdminReportBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(reportsTable)
      .set({ status: parsed.data.status })
      .where(eq(reportsTable.id, id))
      .returning();
    if (!row) return null;
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!,
      action: `${parsed.data.status}_report`,
      entityType: "report",
      entityId: row.id,
      details: { titleId: row.titleId, reason: row.reason },
    });
    return row;
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  const [title] = await db.select().from(titlesTable)
    .where(eq(titlesTable.id, updated.titleId));
  return res.json({
    id: updated.id,
    titleId: updated.titleId,
    titleName: title?.name ?? "",
    reason: updated.reason,
    sourceName: updated.sourceName,
    details: updated.details,
    status: updated.status,
    createdAt: updated.createdAt.toISOString(),
  });
});

router.patch("/reports/:reportId", async (req, res) => {
  const id = parseInt(String(req.params.reportId), 10);
  const parsed = UpdateAdminReportBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(reportsTable)
      .set({ status: parsed.data.status })
      .where(eq(reportsTable.id, id))
      .returning();
    if (!row) return null;
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!,
      action: `${parsed.data.status}_report`,
      entityType: "report",
      entityId: row.id,
      details: { titleId: row.titleId, reason: row.reason },
    });
    return row;
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  const [title] = await db.select().from(titlesTable)
    .where(eq(titlesTable.id, updated.titleId));
  return res.json({
    id: updated.id,
    titleId: updated.titleId,
    titleName: title?.name ?? "",
    reason: updated.reason,
    sourceName: updated.sourceName,
    details: updated.details,
    status: updated.status,
    createdAt: updated.createdAt.toISOString(),
  });
});

router.patch("/feedback/:feedbackId", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const parsed = DeleteAdminContentAliasBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.id, id)).for("update");
    if (!current) return null;
    if (current.updatedAt.getTime() !== expectedUpdatedAtDate.getTime()) {
      const [title] = await tx.select({
        name: titlesTable.name,
        type: titlesTable.type,
        year: titlesTable.year,
      }).from(titlesTable).where(eq(titlesTable.id, current.titleId));
      if (!title) throw new Error("Alias references a missing catalog title");
      const [collision] = await tx.select({
        titleCount: sql<number>`count(distinct ${titleAliasesTable.titleId})::int`,
      }).from(titleAliasesTable).where(
        eq(titleAliasesTable.normalizedAlias, current.normalizedAlias),
      );
      return {
        code: "stale_alias",
        error: "This alternate title changed while you were editing. Refresh the list and review the newer correction before saving.",
        current: {
          id: current.id,
          titleId: current.titleId,
          titleName: title.name,
          titleType: title.type,
          titleYear: title.year,
          alias: current.alias,
          language: current.language,
          sourceName: current.sourceName,
          sourceUrl: current.sourceUrl,
          isEditorial: Boolean(current.isEditorial),
          collision: (collision?.titleCount ?? 1) > 1,
          collisionTitleCount: collision?.titleCount ?? 1,
          updatedAt: current.updatedAt.toISOString(),
        },
      } as const;
    }
    const [title] = await tx.select({ name: titlesTable.name }).from(titlesTable)
      .where(eq(titlesTable.id, current.titleId));
    const normalizedAlias = normalizeAlias(alias);
    if (!normalizedAlias || normalizedAlias === normalizeAlias(title.name)) {
      return { error: "Alias must differ from the canonical title" } as const;
    }
    const [duplicate] = await tx.select({ id: titleAliasesTable.id }).from(titleAliasesTable).where(and(
      eq(titleAliasesTable.titleId, current.titleId),
      eq(titleAliasesTable.normalizedAlias, normalizedAlias),
    )).limit(1);
    if (duplicate && duplicate.id !== id) return { error: "This title already has that alias" } as const;
    const [row] = await tx.update(titleAliasesTable).set({
      alias,
      normalizedAlias,
      language,
      sourceUrl,
      isEditorial: true,
      sourceName: "Admin editorial",
      updatedAt: new Date(),
    }).where(eq(titleAliasesTable.id, id)).returning();
    await refreshTitleAliasSearchList(tx, current.titleId);
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!,
      action: "update_title_alias",
      entityType: "title_alias",
      entityId: id,
      details: { titleId: current.titleId, previousAlias: current.alias, alias },
    });
    return { row } as const;
  });
  if (!updated) return res.status(404).json({ error: "Not found" });

  const [title] = await db
    .select()
    .from(titlesTable)
    .where(eq(titlesTable.id, updated.titleId));
  return res.json({
    id: updated.id,
    titleId: updated.titleId,
    titleName: title?.name ?? "",
    category: updated.category,
    severity: updated.severity,
    seasonNumber: updated.seasonNumber,
    episodeNumber: updated.episodeNumber,
    description: updated.description,
    status: updated.status,
    createdAt: updated.createdAt.toISOString(),
  });
});
*/

router.get("/reports", async (req, res) => {
  const status = req.query.status as string | undefined;
  const rows = await db
    .select({ log: adminAuditLogTable, adminEmail: usersTable.email })
    .from(adminAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, adminAuditLogTable.adminId))
    .where(where)
    .orderBy(desc(adminAuditLogTable.createdAt));
  return res.json(
    rows.map(({ f, email }) => ({
      id: f.id,
      category: f.category,
      message: f.message,
      page: f.page,
      titleId: f.titleId,
      userEmail: email,
      status: f.status,
      createdAt: f.createdAt.toISOString(),
    })),
  );
});

router.patch("/feedback/:feedbackId", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const parsed = DeleteAdminContentAliasBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.id, id)).for("update");
    if (!current) return null;
    if (current.updatedAt.getTime() !== expectedUpdatedAtDate.getTime()) {
      const [title] = await tx.select({
        name: titlesTable.name,
        type: titlesTable.type,
        year: titlesTable.year,
      }).from(titlesTable).where(eq(titlesTable.id, current.titleId));
      if (!title) throw new Error("Alias references a missing catalog title");
      const [collision] = await tx.select({
        titleCount: sql<number>`count(distinct ${titleAliasesTable.titleId})::int`,
      }).from(titleAliasesTable).where(
        eq(titleAliasesTable.normalizedAlias, current.normalizedAlias),
      );
      return {
        code: "stale_alias",
        error: "This alternate title changed while you were editing. Refresh the list and review the newer correction before saving.",
        current: {
          id: current.id,
          titleId: current.titleId,
          titleName: title.name,
          titleType: title.type,
          titleYear: title.year,
          alias: current.alias,
          language: current.language,
          sourceName: current.sourceName,
          sourceUrl: current.sourceUrl,
          isEditorial: Boolean(current.isEditorial),
          collision: (collision?.titleCount ?? 1) > 1,
          collisionTitleCount: collision?.titleCount ?? 1,
          updatedAt: current.updatedAt.toISOString(),
        },
      } as const;
    }
    const [title] = await tx.select({ name: titlesTable.name }).from(titlesTable)
      .where(eq(titlesTable.id, current.titleId));
    const normalizedAlias = normalizeAlias(alias);
    if (!normalizedAlias || normalizedAlias === normalizeAlias(title.name)) {
      return { error: "Alias must differ from the canonical title" } as const;
    }
    const [duplicate] = await tx.select({ id: titleAliasesTable.id }).from(titleAliasesTable).where(and(
      eq(titleAliasesTable.titleId, current.titleId),
      eq(titleAliasesTable.normalizedAlias, normalizedAlias),
    )).limit(1);
    if (duplicate && duplicate.id !== id) return { error: "This title already has that alias" } as const;
    const [row] = await tx.update(titleAliasesTable).set({
      alias,
      normalizedAlias,
      language,
      sourceUrl,
      isEditorial: true,
      sourceName: "Admin editorial",
      updatedAt: new Date(),
    }).where(eq(titleAliasesTable.id, id)).returning();
    await refreshTitleAliasSearchList(tx, current.titleId);
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!,
      action: "update_title_alias",
      entityType: "title_alias",
      entityId: id,
      details: { titleId: current.titleId, previousAlias: current.alias, alias },
    });
    return { row } as const;
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  const [title] = await db.select().from(titlesTable)
    .where(eq(titlesTable.id, updated.titleId));
  return res.json({
    id: updated.id,
    titleId: updated.titleId,
    titleName: title?.name ?? "",
    reason: updated.reason,
    sourceName: updated.sourceName,
    details: updated.details,
    status: updated.status,
    createdAt: updated.createdAt.toISOString(),
  });
});

/*
router.patch("/feedback/:feedbackId", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const parsed = DeleteAdminContentAliasBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.id, id)).for("update");
    if (!current) return null;
    if (current.updatedAt.getTime() !== expectedUpdatedAtDate.getTime()) {
      const [title] = await tx.select({
        name: titlesTable.name,
        type: titlesTable.type,
        year: titlesTable.year,
      }).from(titlesTable).where(eq(titlesTable.id, current.titleId));
      if (!title) throw new Error("Alias references a missing catalog title");
      const [collision] = await tx.select({
        titleCount: sql<number>`count(distinct ${titleAliasesTable.titleId})::int`,
      }).from(titleAliasesTable).where(
        eq(titleAliasesTable.normalizedAlias, current.normalizedAlias),
      );
      return {
        code: "stale_alias",
        error: "This alternate title changed while you were editing. Refresh the list and review the newer correction before saving.",
        current: {
          id: current.id,
          titleId: current.titleId,
          titleName: title.name,
          titleType: title.type,
          titleYear: title.year,
          alias: current.alias,
          language: current.language,
          sourceName: current.sourceName,
          sourceUrl: current.sourceUrl,
          isEditorial: Boolean(current.isEditorial),
          collision: (collision?.titleCount ?? 1) > 1,
          collisionTitleCount: collision?.titleCount ?? 1,
          updatedAt: current.updatedAt.toISOString(),
        },
      } as const;
    }
    const [title] = await tx.select({ name: titlesTable.name }).from(titlesTable)
      .where(eq(titlesTable.id, current.titleId));
    const normalizedAlias = normalizeAlias(alias);
    if (!normalizedAlias || normalizedAlias === normalizeAlias(title.name)) {
      return { error: "Alias must differ from the canonical title" } as const;
    }
    const [duplicate] = await tx.select({ id: titleAliasesTable.id }).from(titleAliasesTable).where(and(
      eq(titleAliasesTable.titleId, current.titleId),
      eq(titleAliasesTable.normalizedAlias, normalizedAlias),
    )).limit(1);
    if (duplicate && duplicate.id !== id) return { error: "This title already has that alias" } as const;
    const [row] = await tx.update(titleAliasesTable).set({
      alias,
      normalizedAlias,
      language,
      sourceUrl,
      isEditorial: true,
      sourceName: "Admin editorial",
      updatedAt: new Date(),
    }).where(eq(titleAliasesTable.id, id)).returning();
    await refreshTitleAliasSearchList(tx, current.titleId);
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!,
      action: "update_title_alias",
      entityType: "title_alias",
      entityId: id,
      details: { titleId: current.titleId, previousAlias: current.alias, alias },
    });
    return { row } as const;
  });
  if (!updated) return res.status(404).json({ error: "Not found" });

  const [title] = await db
    .select()
    .from(titlesTable)
    .where(eq(titlesTable.id, updated.titleId));
  return res.json({
    id: updated.id,
    titleId: updated.titleId,
    titleName: title?.name ?? "",
    reason: updated.reason,
    sourceName: updated.sourceName,
    details: updated.details,
    status: updated.status,
    createdAt: updated.createdAt.toISOString(),
  });
});
*/

router.get("/feedback", async (req, res) => {
  const { status, category } = req.query as Record<string, string>;
  const conds = [];
  if (status) conds.push(eq(feedbackTable.status, status));
  if (category) conds.push(eq(feedbackTable.category, category));
  const rows = await db
    .select({ log: adminAuditLogTable, adminEmail: usersTable.email })
    .from(adminAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, adminAuditLogTable.adminId))
    .where(where)
    .orderBy(desc(adminAuditLogTable.createdAt));
  return res.json(
    rows.map(({ f, email }) => ({
      id: f.id,
      category: f.category,
      message: f.message,
      page: f.page,
      titleId: f.titleId,
      userEmail: email,
      status: f.status,
      createdAt: f.createdAt.toISOString(),
    })),
  );
});

router.patch("/feedback/:feedbackId", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const parsed = DeleteAdminContentAliasBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.id, id)).for("update");
    if (!current) return null;
    if (current.updatedAt.getTime() !== expectedUpdatedAtDate.getTime()) {
      const [title] = await tx.select({
        name: titlesTable.name,
        type: titlesTable.type,
        year: titlesTable.year,
      }).from(titlesTable).where(eq(titlesTable.id, current.titleId));
      if (!title) throw new Error("Alias references a missing catalog title");
      const [collision] = await tx.select({
        titleCount: sql<number>`count(distinct ${titleAliasesTable.titleId})::int`,
      }).from(titleAliasesTable).where(
        eq(titleAliasesTable.normalizedAlias, current.normalizedAlias),
      );
      return {
        code: "stale_alias",
        error: "This alternate title changed while you were editing. Refresh the list and review the newer correction before saving.",
        current: {
          id: current.id,
          titleId: current.titleId,
          titleName: title.name,
          titleType: title.type,
          titleYear: title.year,
          alias: current.alias,
          language: current.language,
          sourceName: current.sourceName,
          sourceUrl: current.sourceUrl,
          isEditorial: Boolean(current.isEditorial),
          collision: (collision?.titleCount ?? 1) > 1,
          collisionTitleCount: collision?.titleCount ?? 1,
          updatedAt: current.updatedAt.toISOString(),
        },
      } as const;
    }
    const [title] = await tx.select({ name: titlesTable.name }).from(titlesTable)
      .where(eq(titlesTable.id, current.titleId));
    const normalizedAlias = normalizeAlias(alias);
    if (!normalizedAlias || normalizedAlias === normalizeAlias(title.name)) {
      return { error: "Alias must differ from the canonical title" } as const;
    }
    const [duplicate] = await tx.select({ id: titleAliasesTable.id }).from(titleAliasesTable).where(and(
      eq(titleAliasesTable.titleId, current.titleId),
      eq(titleAliasesTable.normalizedAlias, normalizedAlias),
    )).limit(1);
    if (duplicate && duplicate.id !== id) return { error: "This title already has that alias" } as const;
    const [row] = await tx.update(titleAliasesTable).set({
      alias,
      normalizedAlias,
      language,
      sourceUrl,
      isEditorial: true,
      sourceName: "Admin editorial",
      updatedAt: new Date(),
    }).where(eq(titleAliasesTable.id, id)).returning();
    await refreshTitleAliasSearchList(tx, current.titleId);
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!,
      action: "update_title_alias",
      entityType: "title_alias",
      entityId: id,
      details: { titleId: current.titleId, previousAlias: current.alias, alias },
    });
    return { row } as const;
  });
  if (!updated) return res.status(404).json({ error: "Not found" });

  return res.json({
    id: updated.id,
    category: updated.category,
    message: updated.message,
    page: updated.page,
    titleId: updated.titleId,
    userEmail: null,
    status: updated.status,
    createdAt: updated.createdAt.toISOString(),
  });
});

router.get("/integrations", async (_req, res) => {
  const [rows, malformedTimestampCounts] = await Promise.all([
    db.select().from(integrationHealthTable),
    db
      .select({
        provider: safetyRecordsTable.sourceName,
        count: sql<number>`count(*)::int`,
      })
      .from(safetyRecordsTable)
      .where(sql`
        not isfinite(${safetyRecordsTable.updatedAt})
        or abs(extract(epoch from ${safetyRecordsTable.updatedAt})) > 8640000000000
      `)
      .groupBy(safetyRecordsTable.sourceName),
  ]);
  const malformedTimestampCountByProvider = new Map(
    malformedTimestampCounts.map((row) => [row.provider, row.count]),
  );
  const sustainedFailureThreshold = Date.now() - 3 * 24 * 60 * 60 * 1000;
  return res.json(
    rows.map((r) => ({
      provider: r.provider,
      status: r.status,
      lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
      lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
      lastError: r.lastError,
      successRatePercent: r.successRatePercent,
      refreshAttempts: r.refreshAttempts,
      successfulRefreshes: r.successfulRefreshes,
      mappedTitles: r.mappedTitles,
      missingMappings: r.missingMappings,
      malformedRefreshTimestampCount:
        malformedTimestampCountByProvider.get(r.provider) ?? 0,
      sustainedFailureAlert:
        (r.provider === "TVMaze" || r.provider === "Wikipedia") &&
        r.status === "failing" &&
        (!r.lastSuccessAt || r.lastSuccessAt.getTime() < sustainedFailureThreshold),
      lowAccumulatedSuccessRateAlert:
        r.provider === "Wikidata" &&
        (r.refreshAttempts ?? 0) >= WIKIDATA_LOW_SUCCESS_RATE_MIN_ATTEMPTS &&
        r.successRatePercent < WIKIDATA_LOW_SUCCESS_RATE_THRESHOLD_PERCENT,
    })),
  );
});

router.get("/catalog-refreshes", async (_req, res) => {
  const runs = await db
    .select({
      id: safetySyncRunsTable.id,
      provider: safetySyncRunsTable.provider,
      status: safetySyncRunsTable.status,
      limit: safetySyncRunsTable.limit,
      offset: safetySyncRunsTable.offset,
      processed: safetySyncRunsTable.processed,
      mapped: safetySyncRunsTable.mapped,
      missing: safetySyncRunsTable.missing,
      errors: safetySyncRunsTable.errors,
      completedAt: safetySyncRunsTable.completedAt,
      error: safetySyncRunsTable.error,
    })
    .from(safetySyncRunsTable)
    .where(inArray(safetySyncRunsTable.status, ["completed", "failed"]))
    .orderBy(
      desc(sql`coalesce(${safetySyncRunsTable.completedAt}, ${safetySyncRunsTable.createdAt})`),
      desc(safetySyncRunsTable.id),
    )
    .limit(rawLimit);
  const runIds = runs.map((run) => run.id);
  const items = runIds.length
    ? await db.select().from(catalogSyncItemsTable)
        .where(and(inArray(catalogSyncItemsTable.runId, runIds), eq(catalogSyncItemsTable.status, "failed")))
    : [];
  return res.json(runs.map((run) => ({
    ...run,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    failures: items.filter((item) => item.runId === run.id).map((item) => ({
      title: item.title,
      provider: item.provider,
      error: item.error,
    })),
  })));
});

router.post("/catalog-refreshes", async (req, res) => {
  const runId = await retryFailedCatalogTitles(id);
  await db.insert(adminAuditLogTable).values({
    adminId: req.userId!,
    action: "start_catalog_refresh",
    entityType: "catalog_sync",
    entityId: runId,
  });
  return res.status(202).json({ runId });
});

router.post("/catalog-refreshes/:id/retry", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid run id" });
  const runId = await retryFailedCatalogTitles(id);
  if (!runId) return res.status(409).json({ error: "This run has no failed titles to retry" });
  await db.insert(adminAuditLogTable).values({
    adminId: req.userId!,
    action: "retry_catalog_refresh",
    entityType: "catalog_sync",
    entityId: runId,
    details: { sourceRunId: id },
  });
  return res.status(202).json({ runId });
});

router.get("/content", async (req, res) => {
  const q = rawQ?.trim() ?? "";
  const regionParam = req.query.region;
  const malformedRefreshTimestampParam = req.query.malformedRefreshTimestamp;
  if (
    regionParam !== undefined &&
    (typeof regionParam !== "string" ||
      !RATING_REGIONS_BY_CODE[regionParam as RatingRegion])
  ) {
    return res.status(400).json({ error: "Invalid rating region" });
  }
  if (
    malformedRefreshTimestampParam !== undefined &&
    (typeof malformedRefreshTimestampParam !== "string" ||
      !["true", "false"].includes(malformedRefreshTimestampParam))
  ) {
    return res.status(400).json({ error: "Invalid malformed refresh timestamp filter" });
  }
  const region = (regionParam as RatingRegion | undefined) ?? "US";
  const malformedRefreshTimestamp = malformedRefreshTimestampParam === "true";
  const titleQuery = db
    .select()
    .from(titlesTable)
    .where(q ? ilike(titlesTable.name, `%${q}%`) : undefined)
    .orderBy(desc(titlesTable.popularity));
  const titles = malformedRefreshTimestamp
    ? await titleQuery
    : await titleQuery.limit(50);
  const ids = titles.map((t) => t.id);
  const mappings = ids.length
    ? await db
        .select()
        .from(providerMappingsTable)
        .where(inArray(providerMappingsTable.titleId, ids))
    : [];
  const safetyRecords = ids.length
    ? await db
        .select({
          id: safetyRecordsTable.id,
          titleId: safetyRecordsTable.titleId,
          tier: safetyRecordsTable.tier,
          isCommunity: safetyRecordsTable.isCommunity,
          status: safetyRecordsTable.status,
          items: safetyRecordsTable.items,
          updatedAt: safetyRecordsTable.updatedAt,
          rawUpdatedAt: sql<string>`${safetyRecordsTable.updatedAt}::text`,
          url: safetyRecordsTable.url,
          sourceName: safetyRecordsTable.sourceName,
        })
        .from(safetyRecordsTable)
        .where(and(
          inArray(safetyRecordsTable.titleId, ids),
          isNull(safetyRecordsTable.seasonNumber),
          isNull(safetyRecordsTable.episodeNumber),
        ))
    : [];

  const mappingsByTitle = new Map<number, (typeof mappings)[number][]>();
  for (const mapping of mappings) {
    const titleMappings = mappingsByTitle.get(mapping.titleId);
    if (titleMappings) titleMappings.push(mapping);
    else mappingsByTitle.set(mapping.titleId, [mapping]);
  }
  const safetyRecordsByTitle = new Map<number, (typeof safetyRecords)[number][]>();
  for (const record of safetyRecords) {
    const titleRecords = safetyRecordsByTitle.get(record.titleId);
    if (titleRecords) titleRecords.push(record);
    else safetyRecordsByTitle.set(record.titleId, [record]);
  }

  const content = titles.map((t) => {
    const titleSafetyRecords = safetyRecordsByTitle.get(t.id) ?? [];
    const ratingRecords = titleSafetyRecords.map((record) => ({
      ...record,
      updatedAt: hasMalformedTimestamp(record.rawUpdatedAt)
        ? record.rawUpdatedAt
        : record.updatedAt,
    }));
    const selectedRating = resolvePreferredRating(ratingRecords, region);
    const selectedRecord = titleSafetyRecords.find((record) => record.id === selectedRating?.recordId);
    return {
      id: t.id,
      name: t.name,
      type: t.type,
      tmdbId: t.tmdbId,
      imdbId: t.imdbId,
      mappings: (mappingsByTitle.get(t.id) ?? []).map((m) => ({
        provider: m.provider,
        externalId: m.externalId,
        status: m.status,
        lastRefreshedAt: m.lastRefreshedAt?.toISOString() ?? null,
      })),
      selectedRating: selectedRating
        ? { ...selectedRating, refreshTimestampMalformed: hasMalformedTimestamp(selectedRecord?.rawUpdatedAt) }
        : null,
    };
  });
  return res.json(malformedRefreshTimestamp
    ? content.filter((item) => item.selectedRating?.refreshTimestampMalformed).slice(0, 50)
    : content);
});

const normalizeAlias = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

async function refreshTitleAliasSearchList(tx: any, titleId: number) {
  const aliases = await tx.select({ alias: titleAliasesTable.alias }).from(titleAliasesTable)
    .where(eq(titleAliasesTable.titleId, titleId))
    .orderBy(titleAliasesTable.id);
  await tx.update(titlesTable).set({ altTitles: aliases.map((row: any) => row.alias) })
    .where(eq(titlesTable.id, titleId));
}

router.get("/content-aliases", async (req, res): Promise<void> => {
  const parsedParams = ListAdminContentAliasesQueryParams.safeParse(req.query);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid alias list parameters" });
    return;
  }
  const { q: rawQ, ownership, id: requestedId } = parsedParams.data;
  const q = rawQ?.trim() ?? "";
  const requestedLimit = parsedParams.data.limit ?? 50;
  const requestedOffset = parsedParams.data.offset ?? 0;
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
  const ownershipFilter =
    ownership === "provider"
      ? eq(titleAliasesTable.isEditorial, false)
      : ownership === "editorial"
        ? eq(titleAliasesTable.isEditorial, true)
        : undefined;
  const where = buildAuditLogWhere(req.query as Record<string, string>);
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` })
      .from(titleAliasesTable)
      .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId))
      .where(where),
    db
      .select({
        alias: titleAliasesTable,
        titleName: titlesTable.name,
        titleType: titlesTable.type,
        titleYear: titlesTable.year,
      })
      .from(titleAliasesTable)
      .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId))
      .where(where)
      .orderBy(titleAliasesTable.normalizedAlias, titlesTable.name, titleAliasesTable.id)
      .limit(limit)
      .offset(offset),
  ]);
  const normalized = [...new Set(rows.map((row) => row.alias.normalizedAlias))];
  const collisions = normalized.length
    ? await db.select({
        normalizedAlias: titleAliasesTable.normalizedAlias,
        titleCount: sql<number>`count(distinct ${titleAliasesTable.titleId})::int`,
      }).from(titleAliasesTable)
        .where(inArray(titleAliasesTable.normalizedAlias, normalized))
        .groupBy(titleAliasesTable.normalizedAlias)
    : [];
  const collisionCount = new Map(collisions.map((row) => [row.normalizedAlias, row.titleCount]));
  res.json(ListAdminContentAliasesResponse.parse({
    items: rows.map(({ alias, titleName, titleType, titleYear }) => ({
      id: alias.id,
      titleId: alias.titleId,
      titleName,
      titleType,
      titleYear,
      alias: alias.alias,
      language: alias.language,
      sourceName: alias.sourceName,
      sourceUrl: alias.sourceUrl,
      isEditorial: Boolean(alias.isEditorial),
      collision: (collisionCount.get(alias.normalizedAlias) ?? 0) > 1,
      collisionTitleCount: collisionCount.get(alias.normalizedAlias) ?? 1,
      updatedAt: alias.updatedAt.toISOString(),
    })),
    total,
    limit,
    offset,
  }));
});

router.patch("/content-aliases/:id", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const alias = typeof req.body?.alias === "string" ? req.body.alias.trim() : "";
  const language = typeof req.body?.language === "string" ? req.body.language.trim() || null : null;
  const sourceUrl = typeof req.body?.sourceUrl === "string" ? req.body.sourceUrl.trim() || null : null;
  const expectedUpdatedAt = typeof req.body?.expectedUpdatedAt === "string"
    ? req.body.expectedUpdatedAt.trim()
    : "";
  const expectedUpdatedAtDate = expectedUpdatedAt ? new Date(expectedUpdatedAt) : null;
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid alias id" });
  if (!alias || alias.length > 300) return res.status(400).json({ error: "Alias must be 1 to 300 characters" });
  if (
    !expectedUpdatedAtDate ||
    Number.isNaN(expectedUpdatedAtDate.getTime())
  ) {
    return res.status(400).json({ error: "The alias timestamp is required to save this correction" });
  }
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
      return res.status(400).json({ error: "Source URL must be an HTTP or HTTPS URL" });
    }
  }
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.id, id)).for("update");
    if (!current) return null;
    if (current.updatedAt.getTime() !== expectedUpdatedAtDate.getTime()) {
      const [title] = await tx.select({
        name: titlesTable.name,
        type: titlesTable.type,
        year: titlesTable.year,
      }).from(titlesTable).where(eq(titlesTable.id, current.titleId));
      if (!title) throw new Error("Alias references a missing catalog title");
      const [collision] = await tx.select({
        titleCount: sql<number>`count(distinct ${titleAliasesTable.titleId})::int`,
      }).from(titleAliasesTable).where(
        eq(titleAliasesTable.normalizedAlias, current.normalizedAlias),
      );
      return {
        code: "stale_alias",
        error: "This alternate title changed while you were editing. Refresh the list and review the newer correction before saving.",
        current: {
          id: current.id,
          titleId: current.titleId,
          titleName: title.name,
          titleType: title.type,
          titleYear: title.year,
          alias: current.alias,
          language: current.language,
          sourceName: current.sourceName,
          sourceUrl: current.sourceUrl,
          isEditorial: Boolean(current.isEditorial),
          collision: (collision?.titleCount ?? 1) > 1,
          collisionTitleCount: collision?.titleCount ?? 1,
          updatedAt: current.updatedAt.toISOString(),
        },
      } as const;
    }
    const [title] = await tx.select({ name: titlesTable.name }).from(titlesTable)
      .where(eq(titlesTable.id, current.titleId));
    const normalizedAlias = normalizeAlias(alias);
    if (!normalizedAlias || normalizedAlias === normalizeAlias(title.name)) {
      return { error: "Alias must differ from the canonical title" } as const;
    }
    const [duplicate] = await tx.select({ id: titleAliasesTable.id }).from(titleAliasesTable).where(and(
      eq(titleAliasesTable.titleId, current.titleId),
      eq(titleAliasesTable.normalizedAlias, normalizedAlias),
    )).limit(1);
    if (duplicate && duplicate.id !== id) return { error: "This title already has that alias" } as const;
    const [row] = await tx.update(titleAliasesTable).set({
      alias,
      normalizedAlias,
      language,
      sourceUrl,
      isEditorial: true,
      sourceName: "Admin editorial",
      updatedAt: new Date(),
    }).where(eq(titleAliasesTable.id, id)).returning();
    await refreshTitleAliasSearchList(tx, current.titleId);
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!,
      action: "update_title_alias",
      entityType: "title_alias",
      entityId: id,
      details: { titleId: current.titleId, previousAlias: current.alias, alias },
    });
    return { row } as const;
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  if ("code" in updated) return res.status(409).json(updated);
  if ("error" in updated) return res.status(409).json({ error: updated.error });
  return res.json(updated.row);
});

router.delete("/content-aliases/:id", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid alias id" });
  const parsed = DeleteAdminContentAliasBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "The alias timestamp is required to remove this alternate title" });
  const removed = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.id, id)).for("update");
    if (!current) return null;
    if (current.updatedAt.getTime() !== parsed.data.expectedUpdatedAt.getTime()) {
      return {
        error: "This alternate title changed while you were reviewing it. Refresh the list and review the newer correction before removing it.",
      } as const;
    }
    const [deleted] = await tx.delete(titleAliasesTable).where(eq(titleAliasesTable.id, id)).returning();
    if (!deleted) return null;
    await refreshTitleAliasSearchList(tx, current.titleId);
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!,
      action: "delete_title_alias",
      entityType: "title_alias",
      entityId: id,
      details: { titleId: current.titleId, alias: current.alias },
    });
    return deleted;
  });
  if (!removed) return res.status(404).json({ error: "Not found" });
  if ("error" in removed) return res.status(409).json({ error: removed.error });
  return res.status(204).send();
});

router.post("/content/:id/refresh", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid title id" });
  }
  const provider = String(req.body?.provider ?? req.query.provider ?? "does_the_dog_die");
  if (provider !== "does_the_dog_die" && provider !== "wikidata") {
    return res.status(400).json({
      ok: false,
      error: "provider must be does_the_dog_die or wikidata",
    });
  }
    const result = provider === "wikidata"
      ? await refreshWikidataBatch({ limit, offset, titleSelection })
      : await refreshDoesTheDogDieBatch({ limit, offset, titleSelection });
  return res.json(result);
});

function serializeSafetySyncRun(run: typeof safetySyncRunsTable.$inferSelect) {
  return {
    id: run.id,
    provider: run.provider,
    status: run.status,
    limit: run.limit,
    offset: run.offset,
    processed: run.processed,
    mapped: run.mapped,
    missing: run.missing,
    errors: run.errors,
    nextOffset: run.offset + run.processed,
    catalogFingerprint: run.catalogFingerprint,
    results: run.results,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    error: run.error,
  };
}

router.get("/content/refresh-batch", async (_req, res) => {
  const persistedRunning = await db
    .select()
    .from(safetySyncRunsTable)
    .where(eq(safetySyncRunsTable.status, "running"))
    .orderBy(desc(safetySyncRunsTable.createdAt));
  const abandonedRuns = persistedRunning.filter(
    (run) => !activeSafetySyncRunIds.has(run.id),
  );

  if (abandonedRuns.length > 0) {
    await Promise.all(
      abandonedRuns.map((run) =>
        db
          .update(safetySyncRunsTable)
          .set({
            status: "interrupted",
            completedAt: null,
            error: "Run interrupted before the batch finished.",
          })
          .where(
            and(
              eq(safetySyncRunsTable.id, run.id),
              eq(safetySyncRunsTable.status, "running"),
            ),
          ),
      ),
    );
  }

  const [lastCompleted, running, interrupted] = await Promise.all([
    db
      .select()
      .from(safetySyncRunsTable)
      .where(inArray(safetySyncRunsTable.status, ["completed", "failed"]))
      .orderBy(desc(safetySyncRunsTable.createdAt))
      .limit(1),
    db
      .select()
      .from(safetySyncRunsTable)
      .where(eq(safetySyncRunsTable.status, "running"))
      .orderBy(desc(safetySyncRunsTable.createdAt))
      .then((runs) => runs.find((run) => activeSafetySyncRunIds.has(run.id))),
    db
      .select()
      .from(safetySyncRunsTable)
      .where(eq(safetySyncRunsTable.status, "interrupted"))
      .orderBy(desc(safetySyncRunsTable.createdAt))
      .limit(1),
  ]);

  return res.json({
    lastCompleted: lastCompleted[0] ? serializeSafetySyncRun(lastCompleted[0]) : null,
    running: running ? serializeSafetySyncRun(running) : null,
    interrupted: interrupted[0] ? serializeSafetySyncRun(interrupted[0]) : null,
  });
});

router.post("/content/refresh-batch", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
  const provider = String(req.body?.provider ?? req.query.provider ?? "does_the_dog_die");
  const suppliedFingerprint =
    typeof req.body?.catalogFingerprint === "string"
      ? req.body.catalogFingerprint
      : null;
  if (provider !== "does_the_dog_die" && provider !== "wikidata") {
    return res.status(400).json({
      ok: false,
      error: "provider must be does_the_dog_die or wikidata",
    });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    return res.status(400).json({ ok: false, error: "limit must be an integer from 1 to 25" });
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return res.status(400).json({ ok: false, error: "offset must be a non-negative integer" });
  }

  const catalog = await db
    .select({ id: titlesTable.id, name: titlesTable.name })
    .from(titlesTable)
    .orderBy(titlesTable.id);
  const catalogFingerprint = createHash("sha256")
    .update(JSON.stringify(catalog.map(({ id }) => id)))
    .digest("hex");
  if (offset > 0 && suppliedFingerprint !== catalogFingerprint) {
    return res.status(409).json({
      code: "catalog_changed",
      error: "The catalog changed since this safety sync started. Restart the safety sync from offset 0.",
    });
  }
  const titleSelection = catalog.slice(offset, offset + limit);

  const [existingRun] = await db
    .select()
    .from(safetySyncRunsTable)
    .where(
      and(
        eq(safetySyncRunsTable.provider, provider),
        eq(safetySyncRunsTable.offset, offset),
        eq(safetySyncRunsTable.status, "running"),
      ),
    )
    .limit(1);
  if (existingRun) {
    return res.status(409).json({
      code: "active_batch",
      error: `A ${provider} safety batch is already running from offset ${offset}. Wait for it to finish before starting another batch at this position.`,
      activeBatch: serializeSafetySyncRun(existingRun),
    });
  }

  let run: typeof safetySyncRunsTable.$inferSelect;
  try {
    [run] = await db
      .insert(safetySyncRunsTable)
      .values({ provider, limit, offset, catalogFingerprint })
      .returning();
  } catch (caught) {
    if (!isActiveSafetySyncUniqueViolation(caught)) throw caught;
    const [activeRun] = await db
      .select()
      .from(safetySyncRunsTable)
      .where(
        and(
          eq(safetySyncRunsTable.provider, provider),
          eq(safetySyncRunsTable.offset, offset),
          eq(safetySyncRunsTable.status, "running"),
        ),
      )
      .limit(1);
    if (!activeRun) throw caught;
    return res.status(409).json({
      code: "active_batch",
      error: `A ${provider} safety batch is already running from offset ${offset}. Wait for it to finish before starting another batch at this position.`,
      activeBatch: serializeSafetySyncRun(activeRun),
    });
  }
  activeSafetySyncRunIds.add(run.id);

  try {
    const result = provider === "wikidata"
      ? await refreshWikidataBatch({ limit, offset, titleSelection })
      : await refreshDoesTheDogDieBatch({ limit, offset, titleSelection });
    const mapped = result.results.filter((item) => item.ok).length;
    const missing = result.results.filter(
      (item) => !item.ok && item.status === "missing",
    ).length;
    const errors = result.results.length - mapped - missing;
    await db
      .update(safetySyncRunsTable)
      .set({
        status: "completed",
        processed: result.processed,
        mapped,
        missing,
        errors,
        results: result.results as SafetySyncRunResult[],
        completedAt: new Date(),
      })
      .where(eq(safetySyncRunsTable.id, run.id));
    return res.json({
      ok: true,
      batchId: run.id,
      ...result,
      nextOffset: result.offset + result.processed,
      catalogFingerprint,
    });
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : "Safety batch refresh failed";
    await db
      .update(safetySyncRunsTable)
      .set({
        status: "failed",
        error,
        completedAt: new Date(),
      })
      .where(eq(safetySyncRunsTable.id, run.id));
    return res.status(500).json({ ok: false, error });
  } finally {
    activeSafetySyncRunIds.delete(run.id);
  }
});

router.get("/content/refresh-batch/history", async (req, res) => {
  const rawLimit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
    return res.status(400).json({ error: "limit must be an integer from 1 to 50" });
  }

  const runs = await db
    .select({
      id: safetySyncRunsTable.id,
      provider: safetySyncRunsTable.provider,
      status: safetySyncRunsTable.status,
      limit: safetySyncRunsTable.limit,
      offset: safetySyncRunsTable.offset,
      processed: safetySyncRunsTable.processed,
      mapped: safetySyncRunsTable.mapped,
      missing: safetySyncRunsTable.missing,
      errors: safetySyncRunsTable.errors,
      completedAt: safetySyncRunsTable.completedAt,
      error: safetySyncRunsTable.error,
    })
    .from(safetySyncRunsTable)
    .where(inArray(safetySyncRunsTable.status, ["completed", "failed"]))
    .orderBy(
      desc(sql`coalesce(${safetySyncRunsTable.completedAt}, ${safetySyncRunsTable.createdAt})`),
      desc(safetySyncRunsTable.id),
    )
    .limit(rawLimit);

  return res.json(ListAdminContentRefreshBatchHistoryResponse.parse(runs.map((run) => ({
    id: run.id,
    provider: run.provider,
    status: run.status,
    limit: run.limit,
    offset: run.offset,
    processed: run.processed,
    mapped: run.mapped,
    missing: run.missing,
    errors: run.errors,
    nextOffset: run.offset + run.processed,
    completedAt: run.completedAt?.toISOString() ?? null,
    error: run.error,
  }))));
});

router.get("/analytics", async (_req, res) => {
  const days = 14;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const dailyOf = async (eventType: string) => {
    const rows = await db
      .select({
        date: sql<string>`to_char(${analyticsEventsTable.createdAt}, 'YYYY-MM-DD')`,
        value: sql<number>`count(*)::int`,
      })
      .from(analyticsEventsTable)
      .where(
        and(
          eq(analyticsEventsTable.eventType, eventType),
          gte(analyticsEventsTable.createdAt, since),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    return rows;
  };

  const topOf = async (eventType: string, limit = 8) => {
    const rows = await db
      .select({
        name: sql<string>`coalesce(${analyticsEventsTable.name}, 'unknown')`,
        count: sql<number>`count(*)::int`,
      })
      .from(analyticsEventsTable)
      .where(eq(analyticsEventsTable.eventType, eventType))
      .groupBy(sql`1`)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);
    return rows;
  };

  const registrations = await db
    .select({
      date: sql<string>`to_char(${usersTable.createdAt}, 'YYYY-MM-DD')`,
      value: sql<number>`count(*)::int`,
    })
    .from(usersTable)
    .where(gte(usersTable.createdAt, since))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const mostTracked = await db
    .select({
      name: titlesTable.name,
      count: sql<number>`count(*)::int`,
    })
    .from(watchedTitlesTable)
    .innerJoin(titlesTable, eq(titlesTable.id, watchedTitlesTable.titleId))
    .groupBy(titlesTable.name)
    .orderBy(desc(sql`count(*)`))
    .limit(8);

  const deviceRows = await db
    .select({
      name: sql<string>`coalesce(${analyticsEventsTable.device}, 'unknown')`,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEventsTable)
    .where(eq(analyticsEventsTable.eventType, "visit"))
    .groupBy(sql`1`)
    .orderBy(desc(sql`count(*)`));
  const countryRows = await db
    .select({
      name: sql<string>`coalesce(${analyticsEventsTable.country}, 'unknown')`,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEventsTable)
    .where(eq(analyticsEventsTable.eventType, "visit"))
    .groupBy(sql`1`)
    .orderBy(desc(sql`count(*)`));

  const visitors = await dailyOf("visit");
  const totalVisits = visitors.reduce((a, r) => a + r.value, 0);
  const totalRegs = registrations.reduce((a, r) => a + r.value, 0);

  return res.json({
    dailyVisitors: visitors,
    registrations,
    conversionRatePercent:
      totalVisits === 0 ? 0 : Math.round((totalRegs / totalVisits) * 1000) / 10,
    mostViewedTitles: await topOf("title_view"),
    mostSearchedQueries: await topOf("search"),
    mostViewedSafetyPages: await topOf("safety_view"),
    mostTrackedTitles: mostTracked,
    deviceBreakdown: deviceRows,
    countryBreakdown: countryRows,
  });
});

/** Shared helper: build WHERE conditions from audit-log filter query params. */
function buildAuditLogWhere(query: Record<string, string>) {
  const { action, entityType, adminEmail, dateFrom, dateTo } = query;
  const conds = [];
  if (action) conds.push(ilike(adminAuditLogTable.action, `%${action}%`));
  if (entityType) conds.push(eq(adminAuditLogTable.entityType, entityType));
  if (dateFrom) conds.push(gte(adminAuditLogTable.createdAt, new Date(dateFrom)));
  if (dateTo) conds.push(lte(adminAuditLogTable.createdAt, new Date(dateTo)));
  const emailCond = adminEmail ? ilike(usersTable.email, `%${adminEmail}%`) : undefined;
  const allConds = emailCond ? [...conds, emailCond] : conds;
  return allConds.length ? and(...allConds) : undefined;
}

router.get("/audit-log", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
  const where = buildAuditLogWhere(req.query as Record<string, string>);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(adminAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, adminAuditLogTable.adminId))
    .where(where);

  const rows = await db
    .select({ log: adminAuditLogTable, adminEmail: usersTable.email })
    .from(adminAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, adminAuditLogTable.adminId))
    .where(where)
    .orderBy(desc(adminAuditLogTable.createdAt));

  return res.json({
    total,
    entries: rows.map(({ log, adminEmail }) => ({
      id: log.id,
      adminEmail: adminEmail ?? null,
      action: log.action,
      entityType: log.entityType ?? null,
      entityId: log.entityId ?? null,
      details: log.details ?? null,
      createdAt: log.createdAt.toISOString(),
    })),
  });
});

/** GET /admin/audit-log/export — server-side CSV download applying all active filters. */
router.get("/audit-log/export", async (req, res) => {
  const where = buildAuditLogWhere(req.query as Record<string, string>);

  const rows = await db
    .select({ log: adminAuditLogTable, adminEmail: usersTable.email })
    .from(adminAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, adminAuditLogTable.adminId))
    .where(where)
    .orderBy(desc(adminAuditLogTable.createdAt));

  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const header = ["ID", "Timestamp", "Admin", "Action", "Entity Type", "Entity ID", "Details"];
  const dataRows = rows.map(({ log, adminEmail }) => [
    log.id,
    log.createdAt.toISOString(),
    adminEmail ?? "",
    log.action,
    log.entityType ?? "",
    log.entityId ?? "",
    log.details ? JSON.stringify(log.details) : "",
  ]);

  const csv = [header, ...dataRows]
    .map(row => row.map(escape).join(","))
    .join("\n");

  const dateStr = new Date().toISOString().slice(0, 10);
  const emailPart = (req.query.adminEmail as string | undefined)?.trim();
  const filename = emailPart
    ? `audit-log-${emailPart}-${dateStr}.csv`
    : `audit-log-${dateStr}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(csv);
});

export default router;

const WIKIDATA_LOW_SUCCESS_RATE_MIN_ATTEMPTS = 5;
