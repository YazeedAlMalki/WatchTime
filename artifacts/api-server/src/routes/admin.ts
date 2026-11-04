import { Router, type IRouter } from "express";
import { createHash, randomUUID } from "node:crypto";
import {
  applySafetyClassificationCorrections,
  findSafetyClassificationCorrection,
} from "../lib/safety-classification-corrections";
import adminQueuesRouter from "./admin-queues";
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
  wikidataIdentityConflictsTable,
  analyticsEventsTable,
  watchedTitlesTable,
  adminAuditLogTable,
  catalogSyncRunsTable,
  catalogSyncItemsTable,
  titleAliasesTable,
  aliasReviewSnapshotsTable,
  safetySyncRunsTable,
  type SafetySyncRunResult,
} from "@workspace/db";
import {
  and,
  asc,
  eq,
  sql,
  desc,
  gte,
  gt,
  lt,
  lte,
  ilike,
  inArray,
  isNull,
  or,
  exists,
  getTableColumns,
} from "drizzle-orm";
import {
  DeleteAdminContentAliasBody,
  UpdateAdminContributionBody,
  UpdateAdminReportBody,
  UpdateAdminFeedbackBody,
  ListAdminReportsQueryParams,
  ListAdminFeedbackQueryParams,
  ListAdminContentAliasesQueryParams,
  ListAdminContentAliasesResponse,
  ExportAdminContentAliasesQueryParams,
  ListAdminContentRefreshBatchHistoryResponse,
  ListAdminWikidataIdentityConflictsQueryParams,
  ListAdminWikidataIdentityConflictsResponse,
  ReviewAdminWikidataIdentityConflictResponse,
  SearchAdminContentQueryParams,
  RetryCatalogRefreshBody,
  CorrectAdminUnclassifiedRatingParams,
  CorrectAdminUnclassifiedRatingBody,
  CorrectAdminUnclassifiedRatingResponse,
  DismissAdminUnclassifiedRatingParams,
  DismissAdminUnclassifiedRatingBody,
  DismissAdminUnclassifiedRatingResponse,
  LookupAdminContentAliasCollisionsBody,
  LookupAdminContentAliasCollisionsResponse,
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
  hasLatestRatingLabelConflict,
  hasMalformedTimestamp,
  resolvePreferredRating,
  type RatingRegion,
} from "../lib/ratingRegions";
import { RATING_REGIONS, RATING_REGIONS_BY_CODE } from "@workspace/rating-regions";
import {
  CatalogTitlesUnavailableForRetryError,
  retryFailedCatalogTitles,
  startCatalogRefresh,
  STALE_QUEUED_REFRESH_MS,
} from "../lib/catalog-refresh";

const router: IRouter = Router();

const LOW_ACCUMULATED_SUCCESS_RATE_THRESHOLD_PERCENT = 50;
const LOW_ACCUMULATED_SUCCESS_RATE_MIN_ATTEMPTS = 5;
// Include only providers whose refresh paths maintain reliable attempt and
// success counters; legacy or metadata-only health rows are not eligible.
const LOW_ACCUMULATED_SUCCESS_RATE_PROVIDERS = new Set([
  "Wikidata",
  "Does the Dog Die?",
  "TVMaze",
  "Wikipedia",
]);
const CONTENT_REVIEW_PAGE_SIZE = 50;
const JS_DATE_LIMIT_MS = 8_640_000_000_000_000;
const CONTENT_ALIAS_EXPORT_BATCH_SIZE = 500;
export const CONTENT_ALIAS_EXPORT_MAX_DURATION_MS = 30_000;
const AUDIT_LOG_EXPORT_BATCH_SIZE = 500;
const SUPPORTED_RATING_SYSTEMS: Set<string> =
  new Set(RATING_REGIONS.map(({ system }) => system));
const AUDIT_LOG_DEFAULT_LIMIT = 50;
const AUDIT_LOG_MAX_LIMIT = 200;
const AUDIT_LOG_MAX_OFFSET = 1_000_000;
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

router.use(adminQueuesRouter);
/*
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
  return res.json(rows.map(({ feedback, userEmail }) => ({
    ...feedback, userEmail,
    createdAt: feedback.createdAt.toISOString(),
  })));
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
  const [title] = await db.select().from(titlesTable).where(eq(titlesTable.id, updated.titleId));
  return res.json({ ...updated, titleName: title?.name ?? "", createdAt: updated.createdAt.toISOString() });
});

router.get("/feedback", async (req, res) => {
  const parsed = DeleteAdminContentAliasBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { status } = parsed.data;
  const rows = await db
    .select({ log: adminAuditLogTable, adminEmail: usersTable.email })
    .from(adminAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, adminAuditLogTable.adminId))
    .where(where)
    .orderBy(desc(adminAuditLogTable.createdAt));
  return res.json(rows.map(({ feedback, userEmail }) => ({
    ...feedback, userEmail,
    createdAt: feedback.createdAt.toISOString(),
  })));
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
  const [title] = await db.select().from(titlesTable).where(eq(titlesTable.id, updated.titleId));
  return res.json({ ...updated, titleName: title?.name ?? "", createdAt: updated.createdAt.toISOString() });
});

router.get("/feedback", async (req, res) => {
  const parsed = DeleteAdminContentAliasBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { status, category } = parsed.data;
  const rows = await db
    .select({ log: adminAuditLogTable, adminEmail: usersTable.email })
    .from(adminAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, adminAuditLogTable.adminId))
    .where(where)
    .orderBy(desc(adminAuditLogTable.createdAt));
  return res.json(rows.map(({ feedback, userEmail }) => ({
    ...feedback, userEmail,
    createdAt: feedback.createdAt.toISOString(),
  })));
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
*/

router.get("/integrations", async (_req, res) => {
  const supportedRatingSystems = sql.join(
    [...new Set(RATING_REGIONS.map(({ system }) => system))].map((system) => sql`${system}`),
    sql`, `,
  );
  const [rows, malformedTimestampCounts] = await Promise.all([
    db
      .select({
        ...getTableColumns(integrationHealthTable),
        lastSyncAtMalformed: sql<boolean>`
          ${integrationHealthTable.lastSyncAt} is not null
          and (
            not isfinite(${integrationHealthTable.lastSyncAt})
            or abs(extract(epoch from ${integrationHealthTable.lastSyncAt})) > 8640000000000
          )
        `,
        lastSuccessAtMalformed: sql<boolean>`
          ${integrationHealthTable.lastSuccessAt} is not null
          and (
            not isfinite(${integrationHealthTable.lastSuccessAt})
            or abs(extract(epoch from ${integrationHealthTable.lastSuccessAt})) > 8640000000000
          )
        `,
      })
      .from(integrationHealthTable),
    db
      .select({
        provider: safetyRecordsTable.sourceName,
        count: sql<number>`count(*)::int`,
        unclassifiedCount: sql<number>`count(*) filter (
          where not exists (
            select 1
            from jsonb_array_elements(${safetyRecordsTable.items}) as item(value)
            where item.value->>'category' in (${supportedRatingSystems})
          )
        )::int`,
      })
      .from(safetyRecordsTable)
      .where(sql`
        not isfinite(${safetyRecordsTable.updatedAt})
        or abs(extract(epoch from ${safetyRecordsTable.updatedAt})) > 8640000000000
      `)
      .groupBy(safetyRecordsTable.sourceName),
  ]);
  const malformedTimestampCountsByProvider = new Map(
    malformedTimestampCounts.map((row) => [row.provider, row]),
  );
  const sustainedFailureThreshold = Date.now() - 3 * 24 * 60 * 60 * 1000;
  return res.json(
    rows.map((r) => ({
      provider: r.provider,
      status: r.status,
      lastSyncAt:
        !r.lastSyncAtMalformed &&
        r.lastSyncAt &&
        Number.isFinite(r.lastSyncAt.getTime())
          ? r.lastSyncAt.toISOString()
          : null,
      lastSuccessAt:
        !r.lastSuccessAtMalformed &&
        r.lastSuccessAt &&
        Number.isFinite(r.lastSuccessAt.getTime())
          ? r.lastSuccessAt.toISOString()
          : null,
      lastSyncAtMalformed: r.lastSyncAtMalformed,
      lastSuccessAtMalformed: r.lastSuccessAtMalformed,
      lastError: r.lastError,
      successRatePercent: r.successRatePercent,
      refreshAttempts: r.refreshAttempts,
      successfulRefreshes: r.successfulRefreshes,
      mappedTitles: r.mappedTitles,
      missingMappings: r.missingMappings,
      malformedRefreshTimestampCount:
        malformedTimestampCountsByProvider.get(r.provider)?.count ?? 0,
      malformedRefreshTimestampUnclassifiedCount:
        malformedTimestampCountsByProvider.get(r.provider)?.unclassifiedCount ?? 0,
      sustainedFailureAlert:
        (r.provider === "TVMaze" || r.provider === "Wikipedia") &&
        r.status === "failing" &&
        (r.lastSuccessAtMalformed ||
          !r.lastSuccessAt ||
          !Number.isFinite(r.lastSuccessAt.getTime()) ||
          r.lastSuccessAt.getTime() < sustainedFailureThreshold),
      lowAccumulatedSuccessRateAlert:
        LOW_ACCUMULATED_SUCCESS_RATE_PROVIDERS.has(r.provider) &&
        r.refreshAttempts != null &&
        r.successfulRefreshes != null &&
        r.refreshAttempts >= LOW_ACCUMULATED_SUCCESS_RATE_MIN_ATTEMPTS &&
        r.successfulRefreshes >= 0 &&
        r.successfulRefreshes <= r.refreshAttempts &&
        (r.successfulRefreshes / r.refreshAttempts) * 100 <
          LOW_ACCUMULATED_SUCCESS_RATE_THRESHOLD_PERCENT,
    })),
  );
});

router.get("/catalog-refreshes", async (_req, res) => {
  const staleQueuedCutoff = new Date(Date.now() - STALE_QUEUED_REFRESH_MS);
  const runs = await db
    .select({
      run: catalogSyncRunsTable,
      queuedWorkerState: sql<"protected" | "abandoned" | null>`
        case
          when ${catalogSyncRunsTable.status} <> 'queued'
            or ${catalogSyncRunsTable.createdAt} >= ${staleQueuedCutoff}
          then null
          when exists (
            select 1
            from pg_locks
            where pg_locks.locktype = 'advisory'
              and pg_locks.classid = hashtext('watchtime:catalog-refresh-worker')::oid
              and pg_locks.objid = ${catalogSyncRunsTable.id}::oid
              and pg_locks.objsubid = 2
              and pg_locks.granted
          )
          then 'protected'
          else 'abandoned'
        end
      `,
      startedAtIsSupported: sql<boolean>`
        isfinite(${catalogSyncRunsTable.startedAt})
        and abs(extract(epoch from ${catalogSyncRunsTable.startedAt}) * 1000)
          <= ${JS_DATE_LIMIT_MS}
      `,
      finishedAtIsSupported: sql<boolean>`
        isfinite(${catalogSyncRunsTable.finishedAt})
        and abs(extract(epoch from ${catalogSyncRunsTable.finishedAt}) * 1000)
          <= ${JS_DATE_LIMIT_MS}
      `,
    })
    .from(catalogSyncRunsTable)
    .orderBy(desc(catalogSyncRunsTable.createdAt), desc(catalogSyncRunsTable.id))
    .limit(20);
  const runIds = runs.map(({ run }) => run.id);
  const items = runIds.length
    ? await db.select().from(catalogSyncItemsTable)
        .where(and(inArray(catalogSyncItemsTable.runId, runIds), eq(catalogSyncItemsTable.status, "failed")))
        .orderBy(asc(catalogSyncItemsTable.id))
    : [];
  return res.json(runs.map(({ run, queuedWorkerState, startedAtIsSupported, finishedAtIsSupported }) => ({
    ...run,
    queuedWorkerState,
    startedAt: serializeCatalogRunTimestamp(run.startedAt, startedAtIsSupported),
    finishedAt: serializeCatalogRunTimestamp(run.finishedAt, finishedAtIsSupported),
    createdAt: run.createdAt.toISOString(),
    failures: items.filter((item) => item.runId === run.id).map((item) => ({
      itemKey: item.itemKey,
      title: item.title,
      provider: item.provider,
      error: item.error,
    })),
  })));
});

function serializeCatalogRunTimestamp(
  value: Date | null,
  isSupported: boolean | null,
): string | null {
  if (
    !value ||
    !isSupported ||
    !Number.isFinite(value.getTime()) ||
    Math.abs(value.getTime()) > JS_DATE_LIMIT_MS
  ) {
    return null;
  }
  return value.toISOString();
}

router.post("/catalog-refreshes", async (req, res) => {
  const runId = await startCatalogRefresh("manual", undefined, async (tx, id) => {
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!, action: "start_catalog_refresh",
      entityType: "catalog_sync", entityId: id,
    });
  });
  return res.status(202).json({ runId });
});

router.post("/catalog-refreshes/:id/retry", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid run id" });
  const selection = RetryCatalogRefreshBody.safeParse(req.body);
  if (!selection.success) {
    return res.status(400).json({ error: "Select at least one failed title to retry" });
  }
  let retryRunId: number | null;
  try {
    retryRunId = await retryFailedCatalogTitles(id, selection.data.itemKeys, async (tx, retryRunId) => {
      await tx.insert(adminAuditLogTable).values({
        adminId: req.userId!,
        action: "retry_catalog_refresh",
        entityType: "catalog_sync",
        entityId: retryRunId,
        details: { sourceRunId: id },
      });
    });
  } catch (error) {
    if (!(error instanceof CatalogTitlesUnavailableForRetryError)) throw error;
    return res.status(409).json({
      error: error.message,
      unavailableItemKeys: error.itemKeys,
    });
  }
  if (!retryRunId) return res.status(409).json({ error: "No selected titles remain failed on this run" });
  return res.status(202).json({ runId: retryRunId });
});

router.get("/content/mapping-counts", async (req, res): Promise<void> => {
  if (req.query.q !== undefined && typeof req.query.q !== "string") {
    res.status(400).json({ error: "Invalid content search query" });
    return;
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const searchPattern = `%${escapeLikePattern(q)}%`;
  const counts = await db
    .select({
      provider: providerMappingsTable.provider,
      mapped: sql<number>`count(distinct ${providerMappingsTable.titleId}) filter (where ${providerMappingsTable.status} = 'mapped')::int`,
      missing: sql<number>`count(distinct ${providerMappingsTable.titleId}) filter (where ${providerMappingsTable.status} = 'missing')::int`,
      error: sql<number>`count(distinct ${providerMappingsTable.titleId}) filter (where ${providerMappingsTable.status} = 'error')::int`,
    })
    .from(providerMappingsTable)
    .innerJoin(titlesTable, eq(providerMappingsTable.titleId, titlesTable.id))
    .where(q ? ilike(titlesTable.name, searchPattern) : undefined)
    .groupBy(providerMappingsTable.provider)
    .orderBy(asc(providerMappingsTable.provider));
  res.json(counts);
});

router.get("/content", async (req, res) => {
  if (req.query.q !== undefined && typeof req.query.q !== "string") {
    return res.status(400).json({ error: "Invalid content search query" });
  }
  if (req.query.mappingProvider !== undefined && typeof req.query.mappingProvider !== "string") {
    return res.status(400).json({ error: "Invalid mapping provider filter" });
  }
  const regionParam = req.query.region;
  const malformedRefreshTimestampParam = req.query.malformedRefreshTimestamp;
  const malformedRefreshTimestampAllRegionsParam =
    req.query.malformedRefreshTimestampAllRegions;
  const malformedRegionalClassificationParam =
    req.query.malformedRegionalClassification;
  if (regionParam !== undefined &&
    (typeof regionParam !== "string" ||
      !Object.hasOwn(RATING_REGIONS_BY_CODE, regionParam))) {
    return res.status(400).json({ error: "Invalid rating region" });
  }
  for (const value of [
    malformedRefreshTimestampParam,
    malformedRefreshTimestampAllRegionsParam,
    malformedRegionalClassificationParam,
  ]) {
    if (value !== undefined && (typeof value !== "string" || !["true", "false"].includes(value))) {
      return res.status(400).json({ error: "Invalid malformed refresh timestamp filter" });
    }
  }
  const malformedRefreshTimestampProviderParam = req.query.malformedRefreshTimestampProvider;
  if (malformedRefreshTimestampProviderParam !== undefined &&
    typeof malformedRefreshTimestampProviderParam !== "string") {
    return res.status(400).json({ error: "Invalid timestamp review provider" });
  }
  const rawOffset = req.query.offset;
  if (rawOffset !== undefined &&
    (typeof rawOffset !== "string" || !/^(0|[1-9]\d*)$/.test(rawOffset) ||
      !Number.isSafeInteger(Number(rawOffset)))) {
    return res.status(400).json({ error: "Invalid content offset" });
  }
  const offset = rawOffset === undefined ? 0 : Number(rawOffset);
  const parsedParams = SearchAdminContentQueryParams.safeParse(req.query);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid content parameters" });
    return;
  }

  const q = parsedParams.data.q?.trim() ?? "";
  const searchPattern = `%${escapeLikePattern(q)}%`;

  const region = (typeof regionParam === "string" ? regionParam : "US") as RatingRegion;
  const malformedRefreshTimestamp = malformedRefreshTimestampParam === "true";
  const malformedRegionalClassification =
    malformedRegionalClassificationParam === "true";

  const malformedRefreshTimestampAllRegions =
    malformedRefreshTimestampAllRegionsParam === "true" && malformedRefreshTimestamp;
  const malformedRefreshTimestampProvider =
    typeof malformedRefreshTimestampProviderParam === "string"
      ? malformedRefreshTimestampProviderParam.trim()
      : "";
  const mappingProvider = parsedParams.data.mappingProvider?.trim() || undefined;
  const mappingStatus = parsedParams.data.mappingStatus;
  const hasMappingFilter = Boolean(mappingProvider || mappingStatus);
  if (malformedRefreshTimestampAllRegions && !malformedRefreshTimestampProvider) {
    return res.status(400).json({ error: "A provider is required for all-regions timestamp review" });
  }
  if (malformedRefreshTimestamp && malformedRegionalClassification) {
    return res.status(400).json({ error: "Choose one malformed rating review filter" });
  }
  const matchingProviderMapping = hasMappingFilter
    ? exists(db.select({ id: providerMappingsTable.id })
      .from(providerMappingsTable)
      .where(and(
        eq(providerMappingsTable.titleId, titlesTable.id),
        mappingProvider ? eq(providerMappingsTable.provider, mappingProvider) : undefined,
        mappingStatus ? eq(providerMappingsTable.status, mappingStatus) : undefined,
      )))
    : undefined;
  const makeTitleQuery = () => db
    .select()
    .from(titlesTable)
    .where(and(
      q ? ilike(titlesTable.name, searchPattern) : undefined,
      matchingProviderMapping,
    ))
    .orderBy(desc(titlesTable.popularity), asc(titlesTable.id));
  const buildContent = async (
    titles: (typeof titlesTable.$inferSelect)[],
    selectedRegions: RatingRegion[] = titles.map(() => region),
    selectedProvider = "Wikidata",
  ) => {
    const ids = titles.map((title) => title.id);
    const [mappings, safetyRecords] = ids.length
      ? await Promise.all([
          db
            .select()
            .from(providerMappingsTable)
            .where(inArray(providerMappingsTable.titleId, ids))
            .orderBy(asc(providerMappingsTable.provider), asc(providerMappingsTable.id)),
          db
            .select({
              id: safetyRecordsTable.id,
              titleId: safetyRecordsTable.titleId,
              tier: safetyRecordsTable.tier,
              isCommunity: safetyRecordsTable.isCommunity,
              status: safetyRecordsTable.status,
              items: safetyRecordsTable.items,
              providerItems: safetyRecordsTable.providerItems,
              classificationCorrections: safetyRecordsTable.classificationCorrections,
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
            )),
        ])
      : [[], []];

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

    return titles.map((title, index) => {
      const titleSafetyRecords = safetyRecordsByTitle.get(title.id) ?? [];
      const ratingRecords = titleSafetyRecords.map((record) => ({
        ...record,
        updatedAt: hasMalformedTimestamp(record.rawUpdatedAt)
          ? record.rawUpdatedAt
          : record.updatedAt,
      }));
      const selectedRegion = selectedRegions[index] ?? region;
      const selectedRating = resolvePreferredRating(
        ratingRecords,
        selectedRegion,
        selectedProvider,
      );
      const hasLatestRatingLabelConflictForRegion = hasLatestRatingLabelConflict(
        ratingRecords,
        selectedRegion,
        selectedProvider,
      );
      const selectedRecord = titleSafetyRecords.find((record) => record.id === selectedRating?.recordId);
      const classificationCorrection = selectedRating
        ? findSafetyClassificationCorrection(
            selectedRecord?.classificationCorrections,
            selectedRating.system,
            selectedRating.label,
          )
        : null;
      return {
        id: title.id,
        name: title.name,
        type: title.type,
        tmdbId: title.tmdbId,
        imdbId: title.imdbId,
        mappings: (mappingsByTitle.get(title.id) ?? []).map((mapping) => ({
          provider: mapping.provider,
          externalId: mapping.externalId,
          status: mapping.status,
          lastRefreshedAt: mapping.lastRefreshedAt?.toISOString() ?? null,
        })),
        selectedRating: selectedRating
          ? {
              ...selectedRating,
              ...(classificationCorrection
                ? {
                    classificationCorrection: {
                      providerCategory: classificationCorrection.sourceCategory,
                      correctedCategory: classificationCorrection.category,
                      adminId: classificationCorrection.adminId,
                      correctedAt: classificationCorrection.correctedAt,
                    },
                  }
                : {}),
              refreshTimestampMalformed: hasMalformedTimestamp(selectedRecord?.rawUpdatedAt),
              hasLatestRatingLabelConflict: hasLatestRatingLabelConflictForRegion,
            }
          : null,
      };
    });
  };

  if (!malformedRefreshTimestamp && !malformedRegionalClassification) {
    const titles = await makeTitleQuery()
      .limit(CONTENT_REVIEW_PAGE_SIZE + (hasMappingFilter ? 1 : 0))
      .offset(offset);
    return res.json(await buildContent(titles));
  }
  const mappingFilterSql = hasMappingFilter
    ? sql`AND EXISTS (
        SELECT 1 FROM provider_mappings AS mapping
        WHERE mapping.title_id = title.id
        ${mappingProvider ? sql`AND mapping.provider = ${mappingProvider}` : sql``}
        ${mappingStatus ? sql`AND mapping.status = ${mappingStatus}` : sql``}
      )`
    : sql``;
  const titleLevelSafetyRecordSql =
    sql`rating.season_number IS NULL AND rating.episode_number IS NULL`;
  if (malformedRegionalClassification) {
    const supportedSystems = sql.join(
      RATING_REGIONS.map(({ system }) => sql`${system}`),
      sql`, `,
    );
    const matchingRatings = await db.execute<{
      id: number;
      recordId: number;
      provider: string;
      classifications: {
        category: string | null;
        label: string | null;
        score: number | null;
        maxScore: number | null;
        description: string | null;
        severity: string | null;
      }[];
      rawUpdatedAt: string;
      sourceUrl: string | null;
    }>(sql`
      SELECT
        title.id,
        rating.id AS "recordId",
        rating.source_name AS provider,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'category', item.value->>'category',
                'label', item.value->>'label',
                'score', item.value->'score',
                'maxScore', item.value->'maxScore',
                'description', item.value->'description',
                'severity', item.value->'severity'
              )
              ORDER BY item.ordinality
            )
            FROM jsonb_array_elements(rating.items)
              WITH ORDINALITY AS item(value, ordinality)
          ),
          '[]'::jsonb
        ) AS classifications,
        rating.updated_at::text AS "rawUpdatedAt",
        rating.url AS "sourceUrl"
      FROM safety_records AS rating
      INNER JOIN titles AS title ON title.id = rating.title_id
      WHERE ${titleLevelSafetyRecordSql}
        AND rating.status = 'available'
        AND rating.is_community = false
        AND (
          NOT isfinite(rating.updated_at)
          OR abs(extract(epoch FROM (rating.updated_at AT TIME ZONE 'UTC')) * 1000)
            > ${JS_DATE_LIMIT_MS}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(rating.items) AS item(value)
          WHERE item.value->>'category' IN (${supportedSystems})
        )
        ${malformedRefreshTimestampProvider
          ? sql`AND rating.source_name = ${malformedRefreshTimestampProvider}`
          : sql``}
        AND (${q} = '' OR title.name ILIKE ${searchPattern})
        ${mappingFilterSql}
      ORDER BY title.popularity DESC, title.id ASC, rating.id ASC
      LIMIT ${CONTENT_REVIEW_PAGE_SIZE + 1}
      OFFSET ${offset}
    `);
    const entries = matchingRatings.rows;
    if (!entries.length) return res.json([]);
    const titles = await db.select().from(titlesTable)
      .where(inArray(titlesTable.id, entries.map(({ id }) => id)));
    const titlesById = new Map(titles.map((title) => [title.id, title]));
    const pageEntries = entries.flatMap((entry) => {
      const title = titlesById.get(entry.id);
      return title ? [{ entry, title }] : [];
    });
    const content = await buildContent(pageEntries.map(({ title }) => title));
    return res.json(content.map((item, index) => ({
      ...item,
      selectedRating: null,
      unclassifiedRating: {
        provider: pageEntries[index].entry.provider,
        recordId: pageEntries[index].entry.recordId,
        classifications: pageEntries[index].entry.classifications,
        rawUpdatedAt: pageEntries[index].entry.rawUpdatedAt,
        sourceUrl: pageEntries[index].entry.sourceUrl,
      },
    })));
  }
  const regions = malformedRefreshTimestampAllRegions
    ? RATING_REGIONS
    : [RATING_REGIONS_BY_CODE[region]];
  const regionValues = sql.join(
    regions.map(({ code, system }) => sql`(${code}, ${system})`),
    sql`, `,
  );
  const matchingRatings = await db.execute<{ id: number; region: RatingRegion }>(sql`
    WITH regions(region, system) AS (VALUES ${regionValues}),
    ranked_ratings AS (
      SELECT
        rating.title_id,
        regions.region,
        COALESCE(abs(refresh.timestamp_ms) > ${JS_DATE_LIMIT_MS}, true) AS timestamp_malformed,
        ROW_NUMBER() OVER (
          PARTITION BY rating.title_id, regions.region
          ORDER BY
            CASE
              WHEN abs(refresh.timestamp_ms) <= ${JS_DATE_LIMIT_MS} THEN refresh.timestamp_ms
              ELSE NULL
            END DESC NULLS LAST,
            rating.tier ASC,
            item.value->>'label' COLLATE "C" ASC,
            COALESCE(rating.url, '') COLLATE "C" ASC,
            rating.id ASC
        ) AS rating_rank
      FROM safety_records AS rating
      INNER JOIN titles AS title ON title.id = rating.title_id
      CROSS JOIN regions
      CROSS JOIN LATERAL jsonb_array_elements(rating.items) AS item(value)
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN isfinite(rating.updated_at)
          THEN floor(extract(epoch FROM (rating.updated_at AT TIME ZONE 'UTC')) * 1000)
          ELSE NULL
        END AS timestamp_ms
      ) AS refresh
      WHERE ${titleLevelSafetyRecordSql}
        AND rating.status = 'available'
        AND rating.is_community = false
        AND rating.source_name = ${malformedRefreshTimestampProvider || "Wikidata"}
        AND item.value->>'category' = regions.system
        AND (${q} = '' OR title.name ILIKE ${searchPattern})
        ${mappingFilterSql}
    )
    SELECT title.id, selected.region
    FROM titles AS title
    INNER JOIN ranked_ratings AS selected
      ON selected.title_id = title.id
      AND selected.rating_rank = 1
      AND selected.timestamp_malformed
    ORDER BY title.popularity DESC, title.id ASC, selected.region ASC
    LIMIT ${CONTENT_REVIEW_PAGE_SIZE + 1}
    OFFSET ${offset}
  `);
  const matchingIds = matchingRatings.rows.map(({ id }) => id);
  if (!matchingIds.length) return res.json([]);

  const titles = await db.select().from(titlesTable).where(inArray(titlesTable.id, matchingIds));
  const titlesById = new Map(titles.map((title) => [title.id, title]));
  const pageEntries = matchingRatings.rows
      .map(({ id, region: selectedRegion }) => ({
        title: titlesById.get(id),
        region: selectedRegion,
      }))
      .filter((entry): entry is { title: (typeof titles)[number]; region: RatingRegion } =>
        entry.title !== undefined,
      );
  return res.json(await buildContent(
    pageEntries.map(({ title }) => title),
    pageEntries.map(({ region: selectedRegion }) => selectedRegion),
    malformedRefreshTimestampProvider || "Wikidata",
  ));
});

type UnclassifiedRatingResolution =
  | {
      action: "correct";
      classificationIndex: number;
      category: string;
    }
  | {
      action: "dismiss";
      reason: string;
    };

async function resolveUnclassifiedRating(
  adminId: string,
  recordId: number,
  expectedUpdatedAt: string,
  resolution: UnclassifiedRatingResolution,
) {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({
        id: safetyRecordsTable.id,
        titleId: safetyRecordsTable.titleId,
        seasonNumber: safetyRecordsTable.seasonNumber,
        episodeNumber: safetyRecordsTable.episodeNumber,
        sourceName: safetyRecordsTable.sourceName,
        isCommunity: safetyRecordsTable.isCommunity,
        status: safetyRecordsTable.status,
        items: safetyRecordsTable.items,
        providerItems: safetyRecordsTable.providerItems,
        classificationCorrections: safetyRecordsTable.classificationCorrections,
        rawUpdatedAt: sql<string>`${safetyRecordsTable.updatedAt}::text`,
      })
      .from(safetyRecordsTable)
      .where(eq(safetyRecordsTable.id, recordId))
      .for("update");
    if (!record) return { kind: "not_found" } as const;

    const items = record.providerItems ?? record.items;
    const hasSupportedClassification =
      Array.isArray(record.items) &&
      record.items.some((item) =>
        item !== null &&
        typeof item === "object" &&
        typeof item.category === "string" &&
        SUPPORTED_RATING_SYSTEMS.has(item.category),
      );
    if (
      record.rawUpdatedAt !== expectedUpdatedAt ||
      record.status !== "available" ||
      record.isCommunity ||
      record.seasonNumber !== null ||
      record.episodeNumber !== null ||
      !hasMalformedTimestamp(record.rawUpdatedAt) ||
      !Array.isArray(items) ||
      hasSupportedClassification
    ) {
      return { kind: "conflict" } as const;
    }

    let nextStatus = record.status;
    let previousCategory: unknown = null;
    if (resolution.action === "correct") {
      const target = items[resolution.classificationIndex];
      if (
        !target ||
        typeof target !== "object" ||
        resolution.classificationIndex < 0 ||
        resolution.classificationIndex >= items.length
      ) {
        return { kind: "invalid_item" } as const;
      }
      previousCategory = target.category ?? null;
      const sourceOccurrence = items
        .slice(0, resolution.classificationIndex)
        .filter((item) => item.category === target.category && item.label === target.label)
        .length;
      const correction = {
        sourceIndex: resolution.classificationIndex,
        sourceCategory: target.category ?? null,
        sourceLabel: target.label ?? null,
        sourceOccurrence,
        category: resolution.category,
        adminId,
        correctedAt: new Date().toISOString(),
      };
      const corrections = [...(record.classificationCorrections ?? []), correction];
      const correctedItems = applySafetyClassificationCorrections(items, corrections);
      await tx
        .update(safetyRecordsTable)
        .set({
          providerItems: items,
          classificationCorrections: corrections,
          items: correctedItems,
        })
        .where(eq(safetyRecordsTable.id, record.id));
      await tx.insert(adminAuditLogTable).values({
        adminId,
        action: "correct_safety_classification",
        entityType: "content",
        entityId: record.id,
        details: {
          titleId: record.titleId,
          provider: record.sourceName,
          classificationIndex: resolution.classificationIndex,
          previousCategory,
          sourceLabel: target.label ?? null,
          sourceOccurrence,
          category: resolution.category,
          expectedUpdatedAt,
        },
      });
      return { kind: "resolved", recordId: record.id, action: "corrected", status: nextStatus } as const;
    }

    nextStatus = "dismissed";
    await tx
      .update(safetyRecordsTable)
      .set({ status: nextStatus })
      .where(eq(safetyRecordsTable.id, record.id));
    await tx.insert(adminAuditLogTable).values({
      adminId,
      action: "dismiss_safety_classification",
      entityType: "content",
      entityId: record.id,
      details: {
        titleId: record.titleId,
        provider: record.sourceName,
        reason: resolution.reason,
        expectedUpdatedAt,
      },
    });
    return { kind: "resolved", recordId: record.id, action: "dismissed", status: nextStatus } as const;
  });
}

router.post("/unclassified-ratings/:id/correct", async (req, res): Promise<void> => {
  const params = CorrectAdminUnclassifiedRatingParams.safeParse(req.params);
  const body = CorrectAdminUnclassifiedRatingBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid unclassified rating correction" });
    return;
  }
  const result = await resolveUnclassifiedRating(
    req.userId!,
    params.data.id,
    body.data.expectedUpdatedAt,
    {
      action: "correct",
      classificationIndex: body.data.classificationIndex,
      category: body.data.category,
    },
  );
  if (result.kind === "not_found") {
    res.status(404).json({ error: "Safety record not found" });
    return;
  }
  if (result.kind === "invalid_item") {
    res.status(400).json({ error: "Classification item does not exist" });
    return;
  }
  if (result.kind === "conflict") {
    res.status(409).json({ error: "Safety record changed or is no longer eligible for review" });
    return;
  }
  res.json(CorrectAdminUnclassifiedRatingResponse.parse({
    recordId: result.recordId,
    action: result.action,
    status: result.status,
  }));
});

router.post("/unclassified-ratings/:id/dismiss", async (req, res): Promise<void> => {
  const params = DismissAdminUnclassifiedRatingParams.safeParse(req.params);
  const body = DismissAdminUnclassifiedRatingBody.safeParse(req.body);
  if (!params.success || !body.success || body.data.reason.trim().length < 3) {
    res.status(400).json({ error: "Invalid unclassified rating dismissal" });
    return;
  }
  const result = await resolveUnclassifiedRating(
    req.userId!,
    params.data.id,
    body.data.expectedUpdatedAt,
    { action: "dismiss", reason: body.data.reason.trim() },
  );
  if (result.kind === "not_found") {
    res.status(404).json({ error: "Safety record not found" });
    return;
  }
  if (result.kind === "conflict") {
    res.status(409).json({ error: "Safety record changed or is no longer eligible for review" });
    return;
  }
  res.json(DismissAdminUnclassifiedRatingResponse.parse({
    recordId: result.recordId,
    action: result.action,
    status: result.status,
  }));
});

const normalizeAlias = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const escapeLikePattern = (value: string) => value.replace(/[\\%_]/gu, "\\$&");

function buildContentAliasWhere(
  q: string,
  ownership?: "provider" | "editorial",
  requestedId?: number,
) {
  if (requestedId !== undefined) return eq(titleAliasesTable.id, requestedId);

  const normalizedQ = normalizeAlias(q);
  const hasLikeWildcard = /[%_\\]/u.test(q);
  const searchPattern = `%${escapeLikePattern(q)}%`;
  const searchFilter = q
    ? or(
        ilike(titleAliasesTable.alias, searchPattern),
        !hasLikeWildcard && normalizedQ
          ? ilike(titleAliasesTable.normalizedAlias, `%${normalizedQ}%`)
          : undefined,
        ilike(titlesTable.name, searchPattern),
      )
    : undefined;
  const ownershipFilter =
    ownership === "provider"
      ? eq(titleAliasesTable.isEditorial, false)
      : ownership === "editorial"
        ? eq(titleAliasesTable.isEditorial, true)
        : undefined;
  return and(searchFilter, ownershipFilter);
}

async function getAliasCollisionCounts(normalizedAliases: string[], queryDb: any = db) {
  const collisionRows = [];
  const batchSize = 500;
  for (let index = 0; index < normalizedAliases.length; index += batchSize) {
    const batch = normalizedAliases.slice(index, index + batchSize);
    collisionRows.push(...await queryDb.select({
      normalizedAlias: titleAliasesTable.normalizedAlias,
      titleCount: sql<number>`count(distinct ${titleAliasesTable.titleId})::int`,
    }).from(titleAliasesTable)
      .where(inArray(titleAliasesTable.normalizedAlias, batch))
      .groupBy(titleAliasesTable.normalizedAlias));
  }
  return new Map(collisionRows.map((row) => [row.normalizedAlias, row.titleCount]));
}

router.post("/content-alias-collisions", async (req, res): Promise<void> => {
  const parsed = LookupAdminContentAliasCollisionsBody.safeParse(req.body);
  if (!parsed.success || parsed.data.aliases.some((alias) => !normalizeAlias(alias))) {
    res.status(400).json({ error: "Invalid alternate-title collision lookup" });
    return;
  }

  const collisionCounts = await getAliasCollisionCounts([
    ...new Set(parsed.data.aliases.map(normalizeAlias)),
  ]);
  res.json(
    LookupAdminContentAliasCollisionsResponse.parse(
      parsed.data.aliases.map((alias) => {
        const collisionTitleCount = collisionCounts.get(normalizeAlias(alias)) ?? 1;
        return {
          alias,
          collision: collisionTitleCount > 1,
          collisionTitleCount,
        };
      }),
    ),
  );
});

const ALIAS_REVIEW_SNAPSHOT_TTL_MS = 15 * 60 * 1000;
const ALIAS_REVIEW_SNAPSHOT_LIMIT = 20;
type AliasReviewSnapshot = {
  filterKey: string;
  total: number;
  expiresAt: Date;
};

function createAliasReviewSnapshotCursor(
  snapshotId: string,
  offset: number,
  previousOffset?: number,
) {
  return previousOffset === undefined
    ? `${snapshotId}:${offset}`
    : `${snapshotId}:${offset}:${previousOffset}`;
}

async function pruneAliasReviewSnapshots(now = new Date(), executor: any = db) {
  await executor.delete(aliasReviewSnapshotsTable)
    .where(lte(aliasReviewSnapshotsTable.expiresAt, now));
}

async function makeRoomForAliasReviewSnapshot(now = new Date(), executor: any = db) {
  const activeSnapshots = await executor.select({ id: aliasReviewSnapshotsTable.id })
    .from(aliasReviewSnapshotsTable)
    .where(gt(aliasReviewSnapshotsTable.expiresAt, now))
    .orderBy(asc(aliasReviewSnapshotsTable.expiresAt));
  const excess = activeSnapshots.length - ALIAS_REVIEW_SNAPSHOT_LIMIT + 1;
  if (excess > 0) {
    await executor.delete(aliasReviewSnapshotsTable)
      .where(inArray(
        aliasReviewSnapshotsTable.id,
        activeSnapshots.slice(0, excess).map(({ id }: { id: string }) => id),
      ));
  }
}

async function refreshTitleAliasSearchList(tx: any, titleId: number) {
  const aliases = await tx.select({ alias: titleAliasesTable.alias }).from(titleAliasesTable)
    .where(eq(titleAliasesTable.titleId, titleId))
    .orderBy(titleAliasesTable.id);
  await tx.update(titlesTable).set({ altTitles: aliases.map((row: any) => row.alias) })
    .where(eq(titlesTable.id, titleId));
}

/*
router.get("/content-aliases", async (req, res): Promise<void> => {
  const parsedParams = ListAdminContentAliasesQueryParams.safeParse(req.query);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid alias review parameters" });
    return;
  }
  const { ownership, id: requestedId, afterId, cursor } = parsedParams.data;
  const q = parsedParams.data.q?.trim() ?? "";
  const limit = requestedId === undefined ? parsedParams.data.limit : 1;
  let offset = requestedId === undefined ? parsedParams.data.offset : 0;
  const baseWhere = buildContentAliasWhere(q, ownership, requestedId);
  const filterKey = JSON.stringify([q, ownership ?? null]);
  const selectAliases = () => db.select({
      alias: titleAliasesTable,
      titleName: titlesTable.name,
      titleType: titlesTable.type,
      titleYear: titlesTable.year,
    })
      .from(titleAliasesTable)
      .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId));
  const startsSnapshot = requestedId === undefined &&
    cursor === undefined && afterId === undefined && req.query.offset === undefined;
  const usesSnapshotCursor = requestedId === undefined && cursor !== undefined;
  let pageRows: Awaited<ReturnType<typeof selectAliases>>;
  let total: number;
  let nextAfterId: number | null = null;
  let nextCursor: string | null = null;
  let previousCursor: string | null = null;

  if (startsSnapshot || usesSnapshotCursor) {
    pruneAliasReviewSnapshots();
    let snapshotId: string;
    let snapshotOffset = 0;
    let previousOffset: number | undefined;
    let snapshot: { filterKey: string; aliasIds: number[]; createdAt: number };
    if (cursor !== undefined) {
      const parsedCursor = /^([0-9a-f-]{36}):(\d+)(?::(\d+))?$/i.exec(cursor);
      const foundSnapshot = parsedCursor ? aliasReviewSnapshots.get(parsedCursor[1]) : undefined;
      snapshotOffset = parsedCursor ? Number(parsedCursor[2]) : -1;
      previousOffset = parsedCursor?.[3] === undefined ? undefined : Number(parsedCursor[3]);
      if (!parsedCursor || !foundSnapshot || foundSnapshot.filterKey !== filterKey ||
        !Number.isSafeInteger(snapshotOffset) || snapshotOffset < 0 ||
        snapshotOffset > foundSnapshot.aliasIds.length ||
        (previousOffset !== undefined &&
          (!Number.isSafeInteger(previousOffset) || previousOffset < 0 || previousOffset >= snapshotOffset))) {
        res.status(400).json({ error: "Invalid or expired alias review cursor" });
        return;
      }
      snapshotId = parsedCursor[1];
      snapshot = foundSnapshot;
      if (previousOffset === undefined && snapshotOffset > 0) {
        previousOffset = Math.max(0, snapshotOffset - limit);
      }
    } else {
      const orderedAliases = await db.select({ id: titleAliasesTable.id })
        .from(titleAliasesTable)
        .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId))
        .where(baseWhere)
        .orderBy(asc(titleAliasesTable.normalizedAlias), asc(titlesTable.name), asc(titleAliasesTable.id));
      makeRoomForAliasReviewSnapshot();
      snapshotId = randomUUID();
      snapshot = { filterKey, aliasIds: orderedAliases.map(({ id }) => id), createdAt: Date.now() };
      aliasReviewSnapshots.set(snapshotId, snapshot);
    }
    const nextOffset = Math.min(snapshotOffset + limit, snapshot.aliasIds.length);
    const windowIds = snapshot.aliasIds.slice(snapshotOffset, nextOffset);
    const liveRows = windowIds.length
      ? await selectAliases().where(and(baseWhere, inArray(titleAliasesTable.id, windowIds)))
      : [];
    const rowsById = new Map(liveRows.map((row) => [row.alias.id, row]));
    pageRows = windowIds.flatMap((id) => {
      const row = rowsById.get(id);
      return row ? [row] : [];
    });
    total = snapshot.aliasIds.length;
    offset = snapshotOffset;
    nextCursor = nextOffset < snapshot.aliasIds.length
      ? createAliasReviewSnapshotCursor(snapshotId, nextOffset, snapshotOffset)
      : null;
    previousCursor = previousOffset === undefined
      ? null
      : createAliasReviewSnapshotCursor(snapshotId, previousOffset);
  } else {
    const usesIdCursor = requestedId === undefined && afterId !== undefined;
    const [[count], rows] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(titleAliasesTable)
        .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId)).where(baseWhere),
      selectAliases()
        .where(usesIdCursor ? and(baseWhere, gt(titleAliasesTable.id, afterId!)) : baseWhere)
        .orderBy(...(usesIdCursor
          ? [asc(titleAliasesTable.id)]
          : [asc(titleAliasesTable.normalizedAlias), asc(titlesTable.name), asc(titleAliasesTable.id)]))
        .limit(limit + 1).offset(usesIdCursor ? 0 : offset),
    ]);
    total = count.total;
    pageRows = rows.slice(0, limit);
    nextAfterId = usesIdCursor && rows.length > limit && pageRows.length
      ? pageRows[pageRows.length - 1].alias.id
      : null;
  }
  const collisionCount = await getAliasCollisionCounts([
    ...new Set(pageRows.map((row) => row.alias.normalizedAlias)),
  ]);
  res.json(ListAdminContentAliasesResponse.parse({
    items: pageRows.map(({ alias, titleName, titleType, titleYear }) => {
      const isEditorial = Boolean(alias.isEditorial);
      const providerCitations = isEditorial
        ? []
        : (alias.providerSources ?? []).flatMap((provider) => {
            const citation = alias.providerCitations?.[provider];
            return citation
              ? [{ provider, sourceName: citation.sourceName, sourceUrl: citation.sourceUrl }]
              : [];
          });
      return {
        id: alias.id,
        titleId: alias.titleId,
        titleName,
        titleType,
        titleYear,
        alias: alias.alias,
        language: alias.language,
        sourceName: alias.sourceName,
        sourceUrl: alias.sourceUrl,
        providerCitations,
        isEditorial,
        collision: (collisionCount.get(alias.normalizedAlias) ?? 0) > 1,
        collisionTitleCount: collisionCount.get(alias.normalizedAlias) ?? 1,
        updatedAt: alias.updatedAt.toISOString(),
      };
    }),
    total,
    limit,
    offset,
    nextAfterId,
    nextCursor,
    previousCursor,
  }));
});

router.get("/content-aliases/export", async (req, res): Promise<void> => {
  const parsedParams = ExportAdminContentAliasesQueryParams.safeParse(req.query);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid alias export parameters" });
    return;
  }
  const q = parsedParams.data.q?.trim() ?? "";
  const where = buildContentAliasWhere(q, parsedParams.data.ownership);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(titleAliasesTable)
    .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId))
    .where(where);

  const header = [
    "ID", "Title ID", "Title", "Type", "Year", "Alternate title", "Language",
    "Source", "Source URL", "Ownership", "Editorial", "Collision", "Collision title count", "Last updated",
  ];
  const escapeCsv = (value: unknown) => {
    const text = String(value ?? "");
    const safeText = /^[\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  };
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="alternate-title-review.csv"');
  res.setHeader("X-Export-Count", String(total));
  res.write(header.map(escapeCsv).join(","));

  let afterId = 0;
  while (!res.destroyed) {
    const rows = await db.select({
      alias: titleAliasesTable,
      titleName: titlesTable.name,
      titleType: titlesTable.type,
      titleYear: titlesTable.year,
    }).from(titleAliasesTable)
      .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId))
      .where(and(where, gt(titleAliasesTable.id, afterId)))
      .orderBy(asc(titleAliasesTable.id))
      .limit(CONTENT_ALIAS_EXPORT_BATCH_SIZE);
    if (!rows.length) break;

    const collisionCount = await getAliasCollisionCounts([
      ...new Set(rows.map((row) => row.alias.normalizedAlias)),
    ]);

    for (const { alias, titleName, titleType, titleYear } of rows) {
      const titleCount = collisionCount.get(alias.normalizedAlias) ?? 1;
      const csvRow = [
        alias.id,
        alias.titleId,
        titleName,
        titleType,
        titleYear,
        alias.alias,
        alias.language,
        alias.sourceName,
        alias.sourceUrl,
        alias.isEditorial ? "Editorial" : "Provider-owned",
        alias.isEditorial ? "Yes" : "No",
        titleCount > 1 ? "Yes" : "No",
        titleCount,
        alias.updatedAt.toISOString(),
      ].map(escapeCsv).join(",");
      if (!res.write(`\r\n${csvRow}`)) {
        await new Promise<void>((resolve) => {
          const cleanup = () => {
            res.off("drain", onDrain);
            res.off("close", onClose);
          };
          const onDrain = () => {
            cleanup();
            resolve();
          };
          const onClose = () => {
            cleanup();
            resolve();
          };
          res.once("drain", onDrain);
          res.once("close", onClose);
        });
        if (res.destroyed) return;
      }
    }
    afterId = rows[rows.length - 1].alias.id;
  }

  if (!res.destroyed) {
    res.end();
  }
});

*/

router.get("/content-aliases", async (req, res): Promise<void> => {
  const parsed = ListAdminContentAliasesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid alias review parameters" });
    return;
  }
  const { q: rawQ, ownership, id: requestedId, limit, cursor, afterId, offset } = parsed.data;
  const responseLimit = requestedId === undefined ? limit : 1;
  const q = rawQ?.trim() ?? "";
  const filterKey = JSON.stringify([q, ownership ?? null]);
  const baseWhere = buildContentAliasWhere(q, ownership, requestedId);
  const snapshotWhere = baseWhere ?? sql`true`;
  const snapshotMode =
    requestedId === undefined && afterId === undefined && req.query.offset === undefined;
  let pageRows: any[] = [];
  let total = 0;
  let effectiveOffset = offset;
  let nextAfterId: number | null = null;
  let nextCursor: string | null = null;
  let previousCursor: string | null = null;

  if (cursor !== undefined) {
    if (!snapshotMode) {
      res.status(400).json({ error: "Snapshot cursors cannot be combined with offset or id filters" });
      return;
    }
    const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(0|[1-9]\d*)(?::(0|[1-9]\d*))?$/i.exec(cursor);
    if (!match) {
      res.status(400).json({ error: "Invalid alias snapshot cursor" });
      return;
    }
    const now = new Date();
    await pruneAliasReviewSnapshots(now);
    const snapshotId = match[1];
    const [snapshotRow] = await db.select({
      filterKey: aliasReviewSnapshotsTable.filterKey,
      total: sql<number>`cardinality(${aliasReviewSnapshotsTable.aliasIds})`,
      expiresAt: aliasReviewSnapshotsTable.expiresAt,
    }).from(aliasReviewSnapshotsTable)
      .where(and(
        eq(aliasReviewSnapshotsTable.id, snapshotId),
        gt(aliasReviewSnapshotsTable.expiresAt, now),
      ))
      .limit(1);
    const snapshot: AliasReviewSnapshot | undefined = snapshotRow;
    if (!snapshot) {
      res.status(409).json({ error: "This alias review snapshot expired. Restart the search." });
      return;
    }
    if (snapshot.filterKey !== filterKey) {
      res.status(400).json({ error: "Alias snapshot cursor does not match the active filters" });
      return;
    }
    const snapshotOffset = Number(match[2]);
    if (!Number.isSafeInteger(snapshotOffset) || snapshotOffset > snapshot.total) {
      res.status(400).json({ error: "Invalid alias snapshot offset" });
      return;
    }
    const nextOffset = Math.min(snapshotOffset + limit, snapshot.total);
    const [snapshotIds] = await db.select({
      aliasIds: sql<number[]>`
        coalesce(
          ${aliasReviewSnapshotsTable.aliasIds}[${snapshotOffset + 1}:${nextOffset}],
          '{}'::integer[]
        )
      `,
    }).from(aliasReviewSnapshotsTable)
      .where(and(
        eq(aliasReviewSnapshotsTable.id, snapshotId),
        gt(aliasReviewSnapshotsTable.expiresAt, now),
      ))
      .limit(1);
    if (!snapshotIds) {
      res.status(409).json({ error: "This alias review snapshot expired. Restart the search." });
      return;
    }
    const windowIds = snapshotIds.aliasIds;
    const liveRows = windowIds.length
      ? await db.select({
          alias: titleAliasesTable,
          titleName: titlesTable.name,
          titleType: titlesTable.type,
          titleYear: titlesTable.year,
        }).from(titleAliasesTable)
          .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId))
          .where(and(baseWhere, inArray(titleAliasesTable.id, windowIds)))
      : [];
    const rowsById = new Map(liveRows.map((row) => [row.alias.id, row]));
    pageRows = windowIds.flatMap((id) => {
      const row = rowsById.get(id);
      return row ? [row] : [];
    });
    total = snapshot.total;
    effectiveOffset = snapshotOffset;
    nextCursor = nextOffset < snapshot.total
      ? createAliasReviewSnapshotCursor(snapshotId, nextOffset, snapshotOffset)
      : null;
    previousCursor = snapshotOffset > 0
      ? createAliasReviewSnapshotCursor(
          snapshotId,
          match[3] === undefined
            ? Math.max(0, snapshotOffset - limit)
            : Number(match[3]),
        )
      : null;
  } else if (snapshotMode) {
    const snapshotId = randomUUID();
    const now = new Date();
    const snapshot = {
      filterKey,
      expiresAt: new Date(now.getTime() + ALIAS_REVIEW_SNAPSHOT_TTL_MS),
    };
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        select pg_advisory_xact_lock(hashtext('alias_review_snapshots')::bigint)
      `);
      await pruneAliasReviewSnapshots(now, tx);
      await makeRoomForAliasReviewSnapshot(now, tx);
      await tx.insert(aliasReviewSnapshotsTable).values({
        id: snapshotId,
        filterKey: snapshot.filterKey,
        aliasIds: sql`
          (
            select coalesce(
              array_agg(
                ${titleAliasesTable.id}
                order by
                  ${titleAliasesTable.normalizedAlias},
                  ${titlesTable.name},
                  ${titleAliasesTable.id}
              ),
              '{}'::integer[]
            )
            from ${titleAliasesTable}
            inner join ${titlesTable}
              on ${titlesTable.id} = ${titleAliasesTable.titleId}
            where ${snapshotWhere}
          )
        `,
        expiresAt: snapshot.expiresAt,
      });
    });
    const [snapshotPage] = await db.select({
      total: sql<number>`cardinality(${aliasReviewSnapshotsTable.aliasIds})`,
      aliasIds: sql<number[]>`
        coalesce(
          ${aliasReviewSnapshotsTable.aliasIds}[1:${limit}],
          '{}'::integer[]
        )
      `,
    }).from(aliasReviewSnapshotsTable)
      .where(eq(aliasReviewSnapshotsTable.id, snapshotId))
      .limit(1);
    total = snapshotPage?.total ?? 0;
    const nextOffset = Math.min(limit, total);
    const windowIds = snapshotPage?.aliasIds ?? [];
    const liveRows = windowIds.length
      ? await db.select({
          alias: titleAliasesTable,
          titleName: titlesTable.name,
          titleType: titlesTable.type,
          titleYear: titlesTable.year,
        }).from(titleAliasesTable)
          .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId))
          .where(and(baseWhere, inArray(titleAliasesTable.id, windowIds)))
      : [];
    const rowsById = new Map(liveRows.map((row) => [row.alias.id, row]));
    pageRows = windowIds.flatMap((id) => {
      const row = rowsById.get(id);
      return row ? [row] : [];
    });
    nextCursor = nextOffset < total
      ? createAliasReviewSnapshotCursor(snapshotId, nextOffset, 0)
      : null;
  } else {
    const [countRow] = await db.select({
      total: sql<number>`count(*)::int`,
    }).from(titleAliasesTable)
      .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId))
      .where(baseWhere);
    total = countRow?.total ?? 0;
    const queryWhere = afterId === undefined
      ? baseWhere
      : and(baseWhere, gt(titleAliasesTable.id, afterId));
    const rows = await db.select({
      alias: titleAliasesTable,
      titleName: titlesTable.name,
      titleType: titlesTable.type,
      titleYear: titlesTable.year,
    }).from(titleAliasesTable)
      .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId))
      .where(queryWhere)
      .orderBy(
        ...(afterId !== undefined
          ? [asc(titleAliasesTable.id)]
          : [asc(titleAliasesTable.normalizedAlias), asc(titlesTable.name), asc(titleAliasesTable.id)]),
      )
      .limit(limit + 1)
      .offset(afterId === undefined ? offset : 0);
    pageRows = rows.slice(0, limit);
    effectiveOffset = afterId === undefined ? offset : 0;
    nextAfterId = rows.length > limit && pageRows.length > 0
      ? pageRows[pageRows.length - 1].alias.id
      : null;
  }

  const collisionCount = await getAliasCollisionCounts([
    ...new Set(pageRows.map((row) => row.alias.normalizedAlias)),
  ]);
  res.json(ListAdminContentAliasesResponse.parse({
    items: pageRows.map(({ alias, titleName, titleType, titleYear }) => {
      const isEditorial = Boolean(alias.isEditorial);
      const providerCitations = isEditorial
        ? []
        : (alias.providerSources ?? []).flatMap((provider: string) => {
            const citation = alias.providerCitations?.[provider];
            return citation
              ? [{ provider, sourceName: citation.sourceName, sourceUrl: citation.sourceUrl }]
              : [];
          });
      return {
        id: alias.id,
        titleId: alias.titleId,
        titleName,
        titleType,
        titleYear,
        alias: alias.alias,
        language: alias.language,
        sourceName: alias.sourceName,
        sourceUrl: alias.sourceUrl,
        providerCitations,
        isEditorial,
        collision: (collisionCount.get(alias.normalizedAlias) ?? 0) > 1,
        collisionTitleCount: collisionCount.get(alias.normalizedAlias) ?? 1,
        updatedAt: alias.updatedAt.toISOString(),
      };
    }),
    total,
    limit: responseLimit,
    offset: requestedId === undefined ? effectiveOffset : 0,
    nextAfterId,
    nextCursor,
    previousCursor,
  }));
});

router.get("/content-aliases/export", async (req, res): Promise<void> => {
  const parsed = ExportAdminContentAliasesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid alias export parameters" });
    return;
  }
  const q = parsed.data.q?.trim() ?? "";
  const ownership = parsed.data.ownership;
  const where = buildContentAliasWhere(q, ownership);
  const [countRow] = await db.select({
    total: sql<number>`count(*)::int`,
  }).from(titleAliasesTable)
    .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId))
    .where(where);
  const total = countRow?.total ?? 0;
  const header = [
    "ID", "Title ID", "Title", "Type", "Year", "Alternate title",
    "Language", "Source", "Source URL", "Ownership", "Editorial",
    "Collision", "Collision title count", "Last updated", "Provider citations",
  ];
  const escapeCsv = (value: unknown) => {
    const text = String(value ?? "");
    const safeText = /^[\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  };
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="alternate-title-review.csv"');
  let afterId = 0;
  const exportTimeout = setTimeout(() => {
    // Closing the response makes a partial CSV unmistakably incomplete to the
    // client and releases the snapshot once the current database query returns.
    if (!res.destroyed) res.destroy();
  }, CONTENT_ALIAS_EXPORT_MAX_DURATION_MS);
  const waitForDrainOrClose = (): Promise<boolean> => new Promise((resolve) => {
    if (res.destroyed) {
      resolve(false);
      return;
    }
    const cleanup = () => {
      res.off("drain", onDrain);
      res.off("close", onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve(!res.destroyed);
    };
    const onClose = () => {
      cleanup();
      resolve(false);
    };
    res.once("drain", onDrain);
    res.once("close", onClose);
    // A client can close after the first check but before these listeners are
    // installed. Resolve directly in that case rather than waiting forever.
    if (res.destroyed) onClose();
  });
  let completed = false;
  try {
    completed = await db.transaction(async (tx) => {
      const [countRow] = await tx.select({
        total: sql<number>`count(*)::int`,
      }).from(titleAliasesTable)
        .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId))
        .where(where);
      const total = countRow?.total ?? 0;

      if (res.destroyed) return false;
      res.setHeader("X-Export-Count", String(total));
      res.write(header.map(escapeCsv).join(","));
      while (!res.destroyed) {
        const rows = await tx.select({
          alias: titleAliasesTable,
          titleName: titlesTable.name,
          titleType: titlesTable.type,
          titleYear: titlesTable.year,
        }).from(titleAliasesTable)
          .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId))
          .where(and(where, gt(titleAliasesTable.id, afterId)))
          .orderBy(asc(titleAliasesTable.id))
          .limit(CONTENT_ALIAS_EXPORT_BATCH_SIZE);
        if (res.destroyed) return false;
        if (!rows.length) break;
        const collisions = await getAliasCollisionCounts(
          [...new Set(rows.map((row) => row.alias.normalizedAlias))],
          tx,
        );
        if (res.destroyed) return false;
        for (const { alias, titleName, titleType, titleYear } of rows) {
          if (res.destroyed) return false;
          const collisionCount = collisions.get(alias.normalizedAlias) ?? 1;
          const providerCitations = alias.isEditorial
            ? []
            : (alias.providerSources ?? []).flatMap((provider: string) => {
                const citation = alias.providerCitations?.[provider];
                return citation
                  ? [{ provider, sourceName: citation.sourceName, sourceUrl: citation.sourceUrl }]
                  : [];
              });
          const csvRow = [
            alias.id,
            alias.titleId,
            titleName,
            titleType,
            titleYear,
            alias.alias,
            alias.language,
            alias.sourceName,
            alias.sourceUrl,
            alias.isEditorial ? "Editorial" : "Provider-owned",
            alias.isEditorial ? "Yes" : "No",
            collisionCount > 1 ? "Yes" : "No",
            collisionCount,
            alias.updatedAt.toISOString(),
            JSON.stringify(providerCitations),
          ].map(escapeCsv).join(",");
          if (!res.write(`\r\n${csvRow}`)) {
            if (!await waitForDrainOrClose()) return false;
          }
        }
        afterId = rows[rows.length - 1].alias.id;
      }
      return !res.destroyed;
    }, { isolationLevel: "repeatable read", accessMode: "read only" }).catch((error) => {
      if (res.headersSent) {
        // The CSV cannot be replaced with an error response after streaming begins.
        // Destroying the response makes the incomplete download terminate promptly.
        res.destroy();
        return false;
      }
      throw error;
    });
  } finally {
    clearTimeout(exportTimeout);
  }
  if (completed && !res.destroyed) res.end();
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
      const providerCitations = current.isEditorial
        ? []
        : (current.providerSources ?? []).flatMap((provider) => {
            const citation = current.providerCitations?.[provider];
            return citation
              ? [{ provider, sourceName: citation.sourceName, sourceUrl: citation.sourceUrl }]
              : [];
          });
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
          providerCitations,
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
    ? await refreshWikidataTitle(id)
    : await refreshDoesTheDogDieTitle(id);
  await db.insert(adminAuditLogTable).values({
    adminId: req.userId!, action: "refresh_content",
    entityType: "title", entityId: id, details: { provider },
  });
  return res.json(result);
});

router.get("/wikidata-identity-conflicts", async (req, res): Promise<void> => {
  const parsed = ListAdminWikidataIdentityConflictsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid Wikidata conflict review parameters" });
    return;
  }
  const { status = "pending", limit = 25, offset = 0 } = parsed.data;
  const reviewedFilter = status === "pending"
    ? isNull(wikidataIdentityConflictsTable.reviewedAt)
    : status === "reviewed"
      ? sql`${wikidataIdentityConflictsTable.reviewedAt} IS NOT NULL`
      : undefined;
  const rows = await db.select({
    id: wikidataIdentityConflictsTable.id,
    titleId: titlesTable.id,
    titleName: titlesTable.name,
    titleType: titlesTable.type,
    imdbId: wikidataIdentityConflictsTable.imdbId,
    conflictingEntityIds: wikidataIdentityConflictsTable.conflictingEntityIds,
    error: wikidataIdentityConflictsTable.error,
    detectedAt: wikidataIdentityConflictsTable.detectedAt,
    reviewedAt: wikidataIdentityConflictsTable.reviewedAt,
    reviewedByAdminId: wikidataIdentityConflictsTable.reviewedByAdminId,
    reviewedByAdminEmail: usersTable.email,
  })
    .from(wikidataIdentityConflictsTable)
    .innerJoin(titlesTable, eq(titlesTable.id, wikidataIdentityConflictsTable.titleId))
    .leftJoin(usersTable, eq(usersTable.id, wikidataIdentityConflictsTable.reviewedByAdminId))
    .where(reviewedFilter)
    .orderBy(desc(wikidataIdentityConflictsTable.detectedAt), asc(wikidataIdentityConflictsTable.id))
    .limit(limit + 1)
    .offset(offset);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const mappings = pageRows.length
    ? await db.select({
        titleId: providerMappingsTable.titleId,
        externalId: providerMappingsTable.externalId,
        status: providerMappingsTable.status,
      })
        .from(providerMappingsTable)
        .where(and(
          inArray(providerMappingsTable.titleId, pageRows.map(({ titleId }) => titleId)),
          eq(providerMappingsTable.provider, "Wikidata"),
        ))
        .orderBy(asc(providerMappingsTable.id))
    : [];
  const verifiedMappings = new Map<number, string>();
  for (const mapping of mappings) {
    if (mapping.status === "mapped" && mapping.externalId && !verifiedMappings.has(mapping.titleId)) {
      verifiedMappings.set(mapping.titleId, mapping.externalId);
    }
  }
  const response = ListAdminWikidataIdentityConflictsResponse.parse({
    items: pageRows.map((row) => ({
      ...row,
      conflictingEntityIds: row.conflictingEntityIds as string[],
      verifiedWikidataId: verifiedMappings.get(row.titleId) ?? null,
      detectedAt: row.detectedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewedByAdminId: row.reviewedByAdminId,
      reviewedByAdminEmail: row.reviewedByAdminEmail,
    })),
    hasMore,
  });
  res.json(response);
});

router.post("/wikidata-identity-conflicts/:titleId/review", async (req, res): Promise<void> => {
  const rawTitleId = Array.isArray(req.params.titleId) ? req.params.titleId[0] : req.params.titleId;
  const titleId = Number(rawTitleId);
  if (!Number.isSafeInteger(titleId) || titleId <= 0) {
    res.status(400).json({ error: "Invalid title ID" });
    return;
  }
  await db.update(wikidataIdentityConflictsTable)
    .set({ reviewedAt: new Date(), reviewedByAdminId: req.userId! })
    .where(and(
      eq(wikidataIdentityConflictsTable.titleId, titleId),
      isNull(wikidataIdentityConflictsTable.reviewedAt),
    ));
  const [current] = await db
    .select({
      titleId: wikidataIdentityConflictsTable.titleId,
      reviewedAt: wikidataIdentityConflictsTable.reviewedAt,
      reviewedByAdminId: wikidataIdentityConflictsTable.reviewedByAdminId,
      reviewedByAdminEmail: usersTable.email,
    })
    .from(wikidataIdentityConflictsTable)
    .leftJoin(usersTable, eq(usersTable.id, wikidataIdentityConflictsTable.reviewedByAdminId))
    .where(eq(wikidataIdentityConflictsTable.titleId, titleId))
    .limit(1);
  if (!current?.reviewedAt) {
    res.status(404).json({ error: "Wikidata identity conflict not found" });
    return;
  }
  res.json(ReviewAdminWikidataIdentityConflictResponse.parse({
    titleId: current.titleId,
    reviewedAt: current.reviewedAt.toISOString(),
    reviewedByAdminId: current.reviewedByAdminId,
    reviewedByAdminEmail: current.reviewedByAdminEmail,
  }));
});

function serializeSafetySyncRun(run: typeof safetySyncRunsTable.$inferSelect) {
  const superseded = run.results.filter(
    (result) => result.ok && result.dataStatus === "superseded",
  ).length;
  return {
    id: run.id,
    provider: run.provider,
    status: run.status,
    limit: run.limit,
    offset: run.offset,
    processed: run.processed,
    mapped: run.mapped,
    superseded,
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
  const rawLimit = req.body?.limit ?? req.query.limit ?? 10;
  const rawOffset = req.body?.offset ?? req.query.offset ?? 0;
  const limit = Number(rawLimit);
  const offset = Number(rawOffset);
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
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
    return res.status(400).json({ ok: false, error: "limit must be an integer from 1 to 25" });
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
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
    const mapped = result.results.filter(
      (item) =>
        item.ok &&
        (!("dataStatus" in item) || item.dataStatus !== "superseded"),
    ).length;
    const superseded = result.results.filter(
      (item) =>
        item.ok &&
        "dataStatus" in item &&
        item.dataStatus === "superseded",
    ).length;
    const missing = result.results.filter(
      (item) => !item.ok && item.status === "missing",
    ).length;
    const errors = result.results.length - mapped - superseded - missing;
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
      results: safetySyncRunsTable.results,
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
    superseded: run.results.filter(
      (result) => result.ok && result.dataStatus === "superseded",
    ).length,
    errors: run.errors,
    nextOffset: run.offset + run.processed,
    completedAt: run.completedAt?.toISOString() ?? null,
    error: run.error,
    results: run.results,
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

function hasValidIsoAuditCalendarDate(value: string): boolean {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})(?:$|[Tt ])/i.exec(value);
  if (!dateParts) return true;

  const year = Number(dateParts[1]);
  const month = Number(dateParts[2]);
  const day = Number(dateParts[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDay =
    [
      31,
      leapYear ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ][month - 1] ?? 0;

  return month >= 1 && month <= 12 && day >= 1 && day <= maxDay;
}

function parseAuditLogDateFilters(query: Record<string, unknown>): {
  dateFrom?: Date;
  dateTo?: Date;
  error?: string;
} {
  const dates: { dateFrom?: Date; dateTo?: Date } = {};

  for (const parameter of ["dateFrom", "dateTo"] as const) {
    const value = query[parameter];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.trim() === "") {
      return { error: `${parameter} must be a valid date` };
    }

    const normalizedValue = value.trim();
    const date = new Date(normalizedValue);
    if (
      !Number.isFinite(date.getTime()) ||
      !hasValidIsoAuditCalendarDate(normalizedValue)
    ) {
      return { error: `${parameter} must be a valid date` };
    }
    dates[parameter] = date;
  }

  return dates;
}

/** Shared helper: build WHERE conditions from audit-log filter query params. */
function buildAuditLogWhere(
  query: Record<string, string>,
  dates: { dateFrom?: Date; dateTo?: Date },
) {
  const { action, entityType, adminEmail } = query;
  const conds = [];
  if (action) conds.push(ilike(adminAuditLogTable.action, `%${action}%`));
  if (entityType) conds.push(eq(adminAuditLogTable.entityType, entityType));
  if (dates.dateFrom) conds.push(gte(adminAuditLogTable.createdAt, dates.dateFrom));
  if (dates.dateTo) conds.push(lte(adminAuditLogTable.createdAt, dates.dateTo));
  const emailCond = adminEmail ? ilike(usersTable.email, `%${adminEmail}%`) : undefined;
  const allConds = emailCond ? [...conds, emailCond] : conds;
  return allConds.length ? and(...allConds) : undefined;
}

function parseAuditLogPageValue(
  value: unknown,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined) return defaultValue;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

router.get("/audit-log", async (req, res) => {
  const limit = parseAuditLogPageValue(
    req.query.limit,
    AUDIT_LOG_DEFAULT_LIMIT,
    1,
    AUDIT_LOG_MAX_LIMIT,
  );
  if (limit === null) {
    return res.status(400).json({
      error: `limit must be an integer from 1 to ${AUDIT_LOG_MAX_LIMIT}`,
    });
  }
  const offset = parseAuditLogPageValue(
    req.query.offset,
    0,
    0,
    AUDIT_LOG_MAX_OFFSET,
  );
  if (offset === null) {
    return res.status(400).json({
      error: `offset must be an integer from 0 to ${AUDIT_LOG_MAX_OFFSET}`,
    });
  }
  const dateFilters = parseAuditLogDateFilters(req.query);
  if (dateFilters.error) {
    res.status(400).json({ error: dateFilters.error });
    return;
  }
  const where = buildAuditLogWhere(
    req.query as Record<string, string>,
    dateFilters,
  );
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
    .orderBy(desc(adminAuditLogTable.createdAt), desc(adminAuditLogTable.id))
    .limit(limit)
    .offset(offset);

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
  const dateFilters = parseAuditLogDateFilters(req.query);
  if (dateFilters.error) {
    res.status(400).json({ error: dateFilters.error });
    return;
  }
  const where = buildAuditLogWhere(
    req.query as Record<string, string>,
    dateFilters,
  );

  const header = ["ID", "Timestamp", "Admin", "Action", "Entity Type", "Entity ID", "Details"];
  const escapeCsvValue = (value: unknown) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;
  const formatCsvRow = (row: (string | number)[]) =>
    row.map(escapeCsvValue).join(",");

  const dateStr = new Date().toISOString().slice(0, 10);
  const emailPart = (req.query.adminEmail as string | undefined)?.trim();
  const filename = emailPart
    ? `audit-log-${emailPart}-${dateStr}.csv`
    : `audit-log-${dateStr}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const writeChunk = async (chunk: string): Promise<boolean> => {
    if (res.destroyed) return false;
    if (res.write(chunk)) return true;

    return new Promise<boolean>((resolve) => {
      const cleanup = () => {
        res.off("drain", onDrain);
        res.off("close", onClose);
      };
      const onDrain = () => {
        cleanup();
        resolve(!res.destroyed);
      };
      const onClose = () => {
        cleanup();
        resolve(false);
      };
      res.once("drain", onDrain);
      res.once("close", onClose);
      if (res.destroyed) onClose();
    });
  };

  const completed = await db.transaction(async (tx) => {
    let cursor: { createdAt: string; id: number } | undefined;
    let headerWritten = false;

    while (!res.destroyed) {
      // Keep the raw database timestamp text so keyset comparisons preserve
      // PostgreSQL's full timestamp precision instead of JavaScript's millis.
      const cursorCondition = cursor
        ? sql`(${adminAuditLogTable.createdAt}, ${adminAuditLogTable.id}) < (${cursor.createdAt}::timestamp, ${cursor.id})`
        : undefined;
      const rows = await tx
        .select({
          log: adminAuditLogTable,
          adminEmail: usersTable.email,
          cursorCreatedAt: sql<string>`${adminAuditLogTable.createdAt}::text`,
        })
        .from(adminAuditLogTable)
        .leftJoin(usersTable, eq(usersTable.id, adminAuditLogTable.adminId))
        .where(cursorCondition ? and(where, cursorCondition) : where)
        .orderBy(desc(adminAuditLogTable.createdAt), desc(adminAuditLogTable.id))
        .limit(AUDIT_LOG_EXPORT_BATCH_SIZE);

      if (!headerWritten) {
        if (!(await writeChunk(`${formatCsvRow(header)}\n`))) return false;
        headerWritten = true;
      }
      if (rows.length === 0) return true;

      for (const { log, adminEmail, cursorCreatedAt } of rows) {
        const csvRow = [
          log.id,
          log.createdAt.toISOString(),
          adminEmail ?? "",
          log.action,
          log.entityType ?? "",
          log.entityId ?? "",
          log.details ? JSON.stringify(log.details) : "",
        ];
        if (!(await writeChunk(`${formatCsvRow(csvRow)}\n`))) return false;
      }

      const lastRow = rows[rows.length - 1];
      cursor = { createdAt: lastRow.cursorCreatedAt, id: lastRow.log.id };
      if (rows.length < AUDIT_LOG_EXPORT_BATCH_SIZE) return true;
    }
    return false;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });

  if (completed && !res.destroyed) res.end();
});

export default router;
