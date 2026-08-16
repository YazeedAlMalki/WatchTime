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
} from "@workspace/db";
import { and, eq, sql, desc, gte, lte, ilike, inArray } from "drizzle-orm";
import {
  UpdateAdminContributionBody,
  UpdateAdminReportBody,
  UpdateAdminFeedbackBody,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/auth";

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

    if (prev.status === parsed.data.status) return row;

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

  // Audit log
  await db.insert(adminAuditLogTable).values({
    adminId: req.userId!,
    action: `${parsed.data.status}_contribution`,
    entityType: "contribution",
    entityId: updated.id,
    details: { titleId: updated.titleId, category: updated.category },
  }).catch(() => {}); // non-critical

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
  const [updated] = await db
    .update(reportsTable)
    .set({ status: parsed.data.status })
    .where(eq(reportsTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Not found" });

  // Audit log
  await db.insert(adminAuditLogTable).values({
    adminId: req.userId!,
    action: `${parsed.data.status}_report`,
    entityType: "report",
    entityId: updated.id,
    details: { titleId: updated.titleId, reason: updated.reason },
  }).catch(() => {});

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
  const [updated] = await db
    .update(feedbackTable)
    .set({ status: parsed.data.status })
    .where(eq(feedbackTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Not found" });

  // Audit log
  await db.insert(adminAuditLogTable).values({
    adminId: req.userId!,
    action: `feedback_${parsed.data.status}`,
    entityType: "feedback",
    entityId: updated.id,
    details: { category: updated.category },
  }).catch(() => {});

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
    })),
  );
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

router.post("/content/:id/refresh", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  await db
    .update(providerMappingsTable)
    .set({ lastRefreshedAt: new Date() })
    .where(eq(providerMappingsTable.titleId, id));
  return res.json({ ok: true });
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

router.get("/audit-log", async (req, res) => {
  const { action, entityType, dateFrom, dateTo } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;

  const conds = [];
  if (action) conds.push(ilike(adminAuditLogTable.action, `%${action}%`));
  if (entityType) conds.push(eq(adminAuditLogTable.entityType, entityType));
  if (dateFrom) conds.push(gte(adminAuditLogTable.createdAt, new Date(dateFrom)));
  if (dateTo) conds.push(lte(adminAuditLogTable.createdAt, new Date(dateTo)));

  const where = conds.length ? and(...conds) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(adminAuditLogTable)
    .where(where);

  const rows = await db
    .select({
      log: adminAuditLogTable,
      adminEmail: usersTable.email,
    })
    .from(adminAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, adminAuditLogTable.adminId))
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

export default router;
