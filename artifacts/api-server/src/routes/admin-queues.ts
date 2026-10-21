import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db, contributionsTable, reportsTable, feedbackTable, titlesTable, usersTable, adminAuditLogTable,
} from "@workspace/db";
import {
  ListAdminReportsQueryParams, ListAdminFeedbackQueryParams,
  UpdateAdminContributionBody, UpdateAdminReportBody, UpdateAdminFeedbackBody,
} from "@workspace/api-zod";

// Mounted behind the parent admin router's authorization middleware.
const router: IRouter = Router();

router.get("/contributions", async (req, res) => {
  const status = req.query.status;
  if (status !== undefined &&
    (typeof status !== "string" || !["pending", "approved", "rejected", "flagged"].includes(status))) {
    return res.status(400).json({ error: "Invalid contribution status" });
  }
  const rows = await db.select({ contribution: contributionsTable, titleName: titlesTable.name })
    .from(contributionsTable).innerJoin(titlesTable, eq(titlesTable.id, contributionsTable.titleId))
    .where(status ? eq(contributionsTable.status, status as typeof contributionsTable.$inferSelect.status) : undefined)
    .orderBy(desc(contributionsTable.createdAt));
  return res.json(rows.map(({ contribution, titleName }) => ({
    ...contribution, titleName, createdAt: contribution.createdAt.toISOString(),
  })));
});

router.patch("/contributions/:contributionId", async (req, res) => {
  const id = Number(req.params.contributionId);
  const parsed = UpdateAdminContributionBody.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
    return res.status(400).json({ error: "Invalid contribution update" });
  }
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(contributionsTable).set({ status: parsed.data.status })
      .where(eq(contributionsTable.id, id)).returning();
    if (!row) return null;
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!, action: `${parsed.data.status}_contribution`,
      entityType: "contribution", entityId: id,
      details: { titleId: row.titleId, category: row.category, severity: row.severity },
    });
    return row;
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  const [title] = await db.select({ name: titlesTable.name }).from(titlesTable)
    .where(eq(titlesTable.id, updated.titleId));
  return res.json({ ...updated, titleName: title?.name ?? "", createdAt: updated.createdAt.toISOString() });
});

router.get("/reports", async (req, res) => {
  const parsed = ListAdminReportsQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid report filters" });
  const rows = await db.select({ report: reportsTable, titleName: titlesTable.name })
    .from(reportsTable).innerJoin(titlesTable, eq(titlesTable.id, reportsTable.titleId))
    .where(parsed.data.status ? eq(reportsTable.status, parsed.data.status) : undefined)
    .orderBy(desc(reportsTable.createdAt));
  return res.json(rows.map(({ report, titleName }) => ({
    ...report, titleName, createdAt: report.createdAt.toISOString(),
  })));
});

router.patch("/reports/:reportId", async (req, res) => {
  const id = Number(req.params.reportId);
  const parsed = UpdateAdminReportBody.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
    return res.status(400).json({ error: "Invalid report update" });
  }
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(reportsTable).set({ status: parsed.data.status })
      .where(eq(reportsTable.id, id)).returning();
    if (!row) return null;
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!, action: `${parsed.data.status}_report`,
      entityType: "report", entityId: id, details: { titleId: row.titleId, reason: row.reason },
    });
    return row;
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  const [title] = await db.select({ name: titlesTable.name }).from(titlesTable)
    .where(eq(titlesTable.id, updated.titleId));
  return res.json({ ...updated, titleName: title?.name ?? "", createdAt: updated.createdAt.toISOString() });
});

router.get("/feedback", async (req, res) => {
  const parsed = ListAdminFeedbackQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid feedback filters" });
  const { status, category } = parsed.data;
  const rows = await db.select({ feedback: feedbackTable, userEmail: usersTable.email })
    .from(feedbackTable).leftJoin(usersTable, eq(usersTable.id, feedbackTable.userId))
    .where(and(
      status ? eq(feedbackTable.status, status) : undefined,
      category ? eq(feedbackTable.category, category) : undefined,
    )).orderBy(desc(feedbackTable.createdAt));
  return res.json(rows.map(({ feedback, userEmail }) => ({
    ...feedback, userEmail, createdAt: feedback.createdAt.toISOString(),
  })));
});

router.patch("/feedback/:feedbackId", async (req, res) => {
  const id = Number(req.params.feedbackId);
  const parsed = UpdateAdminFeedbackBody.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
    return res.status(400).json({ error: "Invalid feedback update" });
  }
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(feedbackTable).set({ status: parsed.data.status })
      .where(eq(feedbackTable.id, id)).returning();
    if (!row) return null;
    await tx.insert(adminAuditLogTable).values({
      adminId: req.userId!, action: `feedback_${parsed.data.status}`,
      entityType: "feedback", entityId: id, details: { category: row.category },
    });
    return row;
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  return res.json({ ...updated, userEmail: null, createdAt: updated.createdAt.toISOString() });
});

export default router;
