import { Router, type IRouter } from "express";
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
} from "@workspace/db";
import { and, eq, sql, desc, gte, lte, ilike, inArray } from "drizzle-orm";
import {
  UpdateAdminContributionBody,
  UpdateAdminReportBody,
  UpdateAdminFeedbackBody,
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
import { retryFailedCatalogTitles, startCatalogRefresh } from "../lib/catalog-refresh";

const router: IRouter = Router();

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
  const rows = await db
    .select({ c: contributionsTable, titleName: titlesTable.name })
    .from(contributionsTable)
    .innerJoin(titlesTable, eq(titlesTable.id, contributionsTable.titleId))
    .where(status ? eq(contributionsTable.status, status as never) : undefined)
    .orderBy(desc(contributionsTable.createdAt));
  return res.json(
    rows.map(({ c, titleName }) => ({
      id: c.id,
      titleId: c.titleId,
      titleName,
      category: c.category,
      severity: c.severity,
      seasonNumber: c.seasonNumber,
      episodeNumber: c.episodeNumber,
      description: c.description,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
    })),
  );
});

router.patch("/contributions/:contributionId", async (req, res) => {
  const id = parseInt(String(req.params.contributionId), 10);
  const parsed = UpdateAdminContributionBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  // Transition-aware, transactional moderation: merging into the public
  // community record happens only on the pending->approved transition, and
  // revoking an approval removes exactly the items that contribution added.
  const updated = await db.transaction(async (tx) => {
    const [prev] = await tx
      .select()
      .from(contributionsTable)
      .where(eq(contributionsTable.id, id))
      .for("update");
    if (!prev) return null;
    const [row] = await tx
      .update(contributionsTable)
      .set({ status: parsed.data.status })
      .where(eq(contributionsTable.id, id))
      .returning();

    // Audit every successful PATCH (including no-ops) inside the transaction
    // so the audit entry and any safety-record changes are always atomic.
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!,
      action: `${parsed.data.status}_contribution`,
      entityType: "contribution",
      entityId: row.id,
      details: { titleId: row.titleId, category: row.category },
    });

    if (prev.status === parsed.data.status) return row;

    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('watchtime:catalog-sync'))`);
    const recordScope = and(
      eq(safetyRecordsTable.titleId, row.titleId),
      eq(safetyRecordsTable.sourceName, "WatchTime Community"),
      row.seasonNumber != null
        ? eq(safetyRecordsTable.seasonNumber, row.seasonNumber)
        : sql`${safetyRecordsTable.seasonNumber} IS NULL`,
      row.episodeNumber != null
        ? eq(safetyRecordsTable.episodeNumber, row.episodeNumber)
        : sql`${safetyRecordsTable.episodeNumber} IS NULL`,
    );
    const [existing] = await tx
      .select()
      .from(safetyRecordsTable)
      .where(recordScope)
      .for("update");

    if (parsed.data.status === "approved") {
      const item = {
        category: row.category,
        label: row.category,
        score: null,
        maxScore: null,
        description: row.description,
        severity: row.severity as "none" | "mild" | "moderate" | "severe",
        contributionId: row.id,
      };
      if (existing) {
        const withoutSelf = existing.items.filter(
          (i) => (i as { contributionId?: number }).contributionId !== row.id,
        );
        await tx
          .update(safetyRecordsTable)
          .set({ items: [...withoutSelf, item], updatedAt: new Date() })
          .where(eq(safetyRecordsTable.id, existing.id));
      } else {
        await tx.insert(safetyRecordsTable).values({
          titleId: row.titleId,
          seasonNumber: row.seasonNumber,
          episodeNumber: row.episodeNumber,
          sourceName: "WatchTime Community",
          tier: 3,
          isCommunity: true,
          status: "available",
          items: [item],
        });
      }
    } else if (prev.status === "approved" && existing) {
      // Approval revoked: strip this contribution's items from the record.
      const remaining = existing.items.filter(
        (i) => (i as { contributionId?: number }).contributionId !== row.id,
      );
      if (remaining.length === 0) {
        await tx
          .delete(safetyRecordsTable)
          .where(eq(safetyRecordsTable.id, existing.id));
      } else {
        await tx
          .update(safetyRecordsTable)
          .set({ items: remaining, updatedAt: new Date() })
          .where(eq(safetyRecordsTable.id, existing.id));
      }
    }
    return row;
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

router.get("/reports", async (req, res) => {
  const status = req.query.status as string | undefined;
  const rows = await db
    .select({ r: reportsTable, titleName: titlesTable.name })
    .from(reportsTable)
    .innerJoin(titlesTable, eq(titlesTable.id, reportsTable.titleId))
    .where(status ? eq(reportsTable.status, status) : undefined)
    .orderBy(desc(reportsTable.createdAt));
  return res.json(
    rows.map(({ r, titleName }) => ({
      id: r.id,
      titleId: r.titleId,
      titleName,
      reason: r.reason,
      sourceName: r.sourceName,
      details: r.details,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

router.patch("/reports/:reportId", async (req, res) => {
  const id = parseInt(String(req.params.reportId), 10);
  const parsed = UpdateAdminReportBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(reportsTable)
      .set({ status: parsed.data.status })
      .where(eq(reportsTable.id, id))
      .returning();
    if (!row) return null;
    // Audit log is inside the transaction — the status change and its audit
    // entry are written atomically; a failure rolls back both.
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

router.get("/feedback", async (req, res) => {
  const { status, category } = req.query as Record<string, string>;
  const conds = [];
  if (status) conds.push(eq(feedbackTable.status, status));
  if (category) conds.push(eq(feedbackTable.category, category));
  const rows = await db
    .select({ f: feedbackTable, email: usersTable.email })
    .from(feedbackTable)
    .leftJoin(usersTable, eq(usersTable.id, feedbackTable.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(feedbackTable.createdAt));
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
  const id = parseInt(String(req.params.feedbackId), 10);
  const parsed = UpdateAdminFeedbackBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(feedbackTable)
      .set({ status: parsed.data.status })
      .where(eq(feedbackTable.id, id))
      .returning();
    if (!row) return null;
    // Audit log is inside the transaction — the status change and its audit
    // entry are written atomically; a failure rolls back both.
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!,
      action: `feedback_${parsed.data.status}`,
      entityType: "feedback",
      entityId: row.id,
      details: { category: row.category },
    });
    return row;
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
  const rows = await db.select().from(integrationHealthTable);
  const sustainedFailureThreshold = Date.now() - 3 * 24 * 60 * 60 * 1000;
  return res.json(
    rows.map((r) => ({
      provider: r.provider,
      status: r.status,
      lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
      lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
      lastError: r.lastError,
      successRatePercent: r.successRatePercent,
      mappedTitles: r.mappedTitles,
      missingMappings: r.missingMappings,
      sustainedFailureAlert:
        (r.provider === "TVMaze" || r.provider === "Wikipedia") &&
        r.status === "failing" &&
        (!r.lastSuccessAt || r.lastSuccessAt.getTime() < sustainedFailureThreshold),
    })),
  );
});

router.get("/catalog-refreshes", async (_req, res) => {
  const runs = await db.select().from(catalogSyncRunsTable)
    .orderBy(desc(catalogSyncRunsTable.createdAt)).limit(20);
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
  const runId = await startCatalogRefresh("manual");
  await db.insert(adminAuditLogTable).values({
    adminId: req.userId!,
    action: "start_catalog_refresh",
    entityType: "catalog_sync",
    entityId: runId,
  });
  return res.status(202).json({ runId });
});

router.post("/catalog-refreshes/:id/retry", async (req, res) => {
  const id = Number(req.params.id);
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
  const q = req.query.q as string | undefined;
  const titles = await db
    .select()
    .from(titlesTable)
    .where(q ? ilike(titlesTable.name, `%${q}%`) : undefined)
    .orderBy(desc(titlesTable.popularity))
    .limit(50);
  const ids = titles.map((t) => t.id);
  const mappings = ids.length
    ? await db
        .select()
        .from(providerMappingsTable)
        .where(inArray(providerMappingsTable.titleId, ids))
    : [];
  return res.json(
    titles.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      tmdbId: t.tmdbId,
      imdbId: t.imdbId,
      mappings: mappings
        .filter((m) => m.titleId === t.id)
        .map((m) => ({
          provider: m.provider,
          externalId: m.externalId,
          status: m.status,
          lastRefreshedAt: m.lastRefreshedAt?.toISOString() ?? null,
        })),
    })),
  );
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

router.get("/content-aliases", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const ownership = String(req.query.ownership ?? "").trim();
  if (ownership && ownership !== "provider" && ownership !== "editorial") {
    return res.status(400).json({ error: "Invalid alias ownership filter" });
  }
  const ownershipFilter =
    ownership === "provider"
      ? eq(titleAliasesTable.isEditorial, false)
      : ownership === "editorial"
        ? eq(titleAliasesTable.isEditorial, true)
        : undefined;
  const rows = await db.select({
    alias: titleAliasesTable,
    titleName: titlesTable.name,
    titleType: titlesTable.type,
    titleYear: titlesTable.year,
  }).from(titleAliasesTable)
    .innerJoin(titlesTable, eq(titlesTable.id, titleAliasesTable.titleId))
    .where(and(
      q ? ilike(titleAliasesTable.alias, `%${q}%`) : undefined,
      ownershipFilter,
    ))
    .orderBy(titleAliasesTable.normalizedAlias, titlesTable.name)
    .limit(200);
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
  return res.json(rows.map(({ alias, titleName, titleType, titleYear }) => ({
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
  })));
});

router.patch("/content-aliases/:id", async (req, res) => {
  const id = Number(req.params.id);
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
      return {
        error: "This alternate title changed while you were editing. Refresh the list and review the newer correction before saving.",
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
  if ("error" in updated) return res.status(409).json({ error: updated.error });
  return res.json(updated.row);
});

router.delete("/content-aliases/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid alias id" });
  const removed = await db.transaction(async (tx) => {
    const [current] = await tx.delete(titleAliasesTable).where(eq(titleAliasesTable.id, id)).returning();
    if (!current) return null;
    await refreshTitleAliasSearchList(tx, current.titleId);
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!,
      action: "delete_title_alias",
      entityType: "title_alias",
      entityId: id,
      details: { titleId: current.titleId, alias: current.alias },
    });
    return current;
  });
  if (!removed) return res.status(404).json({ error: "Not found" });
  return res.status(204).send();
});

router.post("/content/:id/refresh", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid title id" });
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
  return res.json(result);
});

router.post("/content/refresh-batch", async (req, res) => {
  const limit = Number.isFinite(Number(req.body?.limit)) ? Number(req.body.limit) : 10;
  const offset = Number.isFinite(Number(req.body?.offset)) ? Number(req.body.offset) : 0;
  const provider = String(req.body?.provider ?? req.query.provider ?? "does_the_dog_die");
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
  const result = provider === "wikidata"
    ? await refreshWikidataBatch({ limit, offset })
    : await refreshDoesTheDogDieBatch({ limit, offset });
  return res.json({ ok: true, ...result });
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

  const baseJoin = () =>
    db
      .select({ log: adminAuditLogTable, adminEmail: usersTable.email })
      .from(adminAuditLogTable)
      .leftJoin(usersTable, eq(usersTable.id, adminAuditLogTable.adminId));

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(adminAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, adminAuditLogTable.adminId))
    .where(where);

  const rows = await baseJoin()
    .where(where)
    .orderBy(desc(adminAuditLogTable.createdAt))
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
