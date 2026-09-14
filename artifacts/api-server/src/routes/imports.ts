import { createHash } from "node:crypto";
import express, { Router, type IRouter } from "express";
import {
  db,
  episodesTable,
  importItemsTable,
  importsTable,
  titlesTable,
  watchedEpisodesTable,
  watchedTitlesTable,
  watchlistTable,
  type ImportCandidate,
  type NormalizedImportRecord,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { importConfirmRateLimit, importCreateRateLimit } from "../middlewares/rateLimiters";
import { MAX_IMPORT_JSON_BYTES, parseImportContent, type ParsedImportRow } from "../lib/import-parsers";

const router: IRouter = Router();
type Classification = "matched" | "duplicate" | "unmatched" | "ambiguous" | "invalid" | "unsupported";

function normaliseTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const QUERY_CHUNK_SIZE = 750;

function chunks<T>(values: T[], size = QUERY_CHUNK_SIZE): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

function safeSummary(items: Array<{ classification: string }>) {
  return items.reduce<Record<string, number>>(
    (summary, item) => ({ ...summary, [item.classification]: (summary[item.classification] ?? 0) + 1 }),
    { matched: 0, duplicate: 0, unmatched: 0, ambiguous: 0, invalid: 0, unsupported: 0 },
  );
}

function asCandidates(titles: Array<typeof titlesTable.$inferSelect>): ImportCandidate[] {
  return titles.map((title) => ({
    titleId: title.id,
    name: title.name,
    type: title.type,
    year: title.year,
  }));
}

type DuplicateQueryExecutor = Pick<typeof db, "select">;

async function existingDuplicate(executor: DuplicateQueryExecutor, userId: string, record: NormalizedImportRecord, titleId: number, episodeId: number | null) {
  if (record.kind === "watched_episode" && episodeId) {
    const existing = await executor
      .select({ id: watchedEpisodesTable.id })
      .from(watchedEpisodesTable)
      .where(and(eq(watchedEpisodesTable.userId, userId), eq(watchedEpisodesTable.episodeId, episodeId)))
      .limit(1);
    return existing.length > 0;
  }
  const table = record.kind === "watchlist" ? watchlistTable : watchedTitlesTable;
  const existing = await executor
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.userId, userId), eq(table.titleId, titleId)))
    .limit(1);
  return existing.length > 0;
}

type ItemPreview = {
  classification: Classification;
  candidates: ImportCandidate[];
  titleId: number | null;
  episodeId: number | null;
  errorCode: string | null;
};

/**
 * Import previews can contain 5,000 records. Build one shared catalog
 * projection, then use indexed maps for every row instead of scanning the
 * catalog and tracking tables per row.
 */
async function classifyImportRows(userId: string, records: NormalizedImportRecord[]): Promise<ItemPreview[]> {
  const catalog = await db.select().from(titlesTable);
  const byImdb = new Map<string, typeof catalog>();
  const byTmdb = new Map<number, typeof catalog>();
  const byNameAndType = new Map<string, typeof catalog>();
  const add = <K>(map: Map<K, typeof catalog>, key: K, title: typeof catalog[number]) => {
    const entries = map.get(key);
    if (entries) entries.push(title);
    else map.set(key, [title]);
  };
  for (const title of catalog) {
    if (title.imdbId) add(byImdb, title.imdbId.toLowerCase(), title);
    if (title.tmdbId !== null) add(byTmdb, title.tmdbId, title);
    const names = new Set([title.name, ...title.altTitles].map(normaliseTitle).filter(Boolean));
    for (const name of names) add(byNameAndType, `${title.type}:${name}`, title);
  }
  const compatible = (record: NormalizedImportRecord, title: typeof catalog[number]) =>
    record.type === "movie" ? title.type === "movie" : title.type !== "movie";
  const candidatesFor = (record: NormalizedImportRecord) => {
    if (record.imdbId || record.tmdbId !== null) {
      const external = record.imdbId && record.tmdbId !== null
        ? (byImdb.get(record.imdbId.toLowerCase()) ?? []).filter((title) => title.tmdbId === record.tmdbId)
        : record.imdbId
          ? byImdb.get(record.imdbId.toLowerCase()) ?? []
          : byTmdb.get(record.tmdbId!) ?? [];
      return external.filter((title) => compatible(record, title));
    }
    const normalizedTitle = normaliseTitle(record.title);
    if (!normalizedTitle) return [];
    const compatibleTypes = record.type === "movie" ? ["movie"] : ["tv", "anime", "documentary"];
    const found = compatibleTypes.flatMap((type) => byNameAndType.get(`${type}:${normalizedTitle}`) ?? []);
    return [...new Map(found.map((title) => [title.id, title])).values()]
      .filter((title) => !record.year || title.year === record.year);
  };

  const candidateRows = records.map((record) => candidatesFor(record));
  const resolvedTitleIds = [...new Set(candidateRows.flatMap((titles, index) =>
    records[index].kind === "watched_episode" && titles.length === 1 ? [titles[0].id] : [],
  ))];
  const episodes = (await Promise.all(chunks(resolvedTitleIds).map((titleIds) =>
    db.select().from(episodesTable).where(inArray(episodesTable.titleId, titleIds)),
  ))).flat();
  const episodeByKey = new Map(episodes.map((episode) => [`${episode.titleId}:${episode.seasonNumber}:${episode.episodeNumber}`, episode]));

  const duplicateTitleIds = [...new Set(candidateRows.flatMap((titles, index) =>
    records[index].kind !== "watched_episode" && titles.length === 1 ? [titles[0].id] : [],
  ))];
  const resolvedEpisodeIds = [...new Set(records.flatMap((record, index) => {
    if (record.kind !== "watched_episode" || candidateRows[index].length !== 1) return [];
    const episode = episodeByKey.get(`${candidateRows[index][0].id}:${record.season}:${record.episode}`);
    return episode ? [episode.id] : [];
  }))];
  const [watchedTitles, watchlist, watchedEpisodes] = await Promise.all([
    Promise.all(chunks(duplicateTitleIds).map((titleIds) => db.select({ titleId: watchedTitlesTable.titleId }).from(watchedTitlesTable).where(and(eq(watchedTitlesTable.userId, userId), inArray(watchedTitlesTable.titleId, titleIds))))).then((rows) => rows.flat()),
    Promise.all(chunks(duplicateTitleIds).map((titleIds) => db.select({ titleId: watchlistTable.titleId }).from(watchlistTable).where(and(eq(watchlistTable.userId, userId), inArray(watchlistTable.titleId, titleIds))))).then((rows) => rows.flat()),
    Promise.all(chunks(resolvedEpisodeIds).map((episodeIds) => db.select({ episodeId: watchedEpisodesTable.episodeId }).from(watchedEpisodesTable).where(and(eq(watchedEpisodesTable.userId, userId), inArray(watchedEpisodesTable.episodeId, episodeIds))))).then((rows) => rows.flat()),
  ]);
  const watchedTitleIds = new Set(watchedTitles.map((row) => row.titleId));
  const watchlistTitleIds = new Set(watchlist.map((row) => row.titleId));
  const watchedEpisodeIds = new Set(watchedEpisodes.map((row) => row.episodeId));
  const seen = new Set<string>();

  return records.map((record, index) => {
    const titles = candidateRows[index];
    const candidates = asCandidates(titles);
    if (titles.length === 0) return { classification: "unmatched", candidates, titleId: null, episodeId: null, errorCode: "title_not_found" };
    if (titles.length > 1) return { classification: "ambiguous", candidates, titleId: null, episodeId: null, errorCode: "multiple_titles" };
    const title = titles[0];
    let episodeId: number | null = null;
    if (record.kind === "watched_episode") {
      const episode = episodeByKey.get(`${title.id}:${record.season}:${record.episode}`);
      if (!episode) return { classification: "unmatched", candidates, titleId: null, episodeId: null, errorCode: "episode_not_found" };
      episodeId = episode.id;
    }
    const key = episodeId ? `episode:${episodeId}` : `${record.kind === "watchlist" ? "watchlist" : "watched-title"}:${title.id}`;
    const duplicate = seen.has(key) ||
      (episodeId ? watchedEpisodeIds.has(episodeId) : record.kind === "watchlist" ? watchlistTitleIds.has(title.id) : watchedTitleIds.has(title.id));
    seen.add(key);
    return {
      classification: duplicate ? "duplicate" : "matched",
      candidates,
      titleId: title.id,
      episodeId,
      errorCode: duplicate ? "already_exists" : null,
    };
  });
}

function serialiseJob(job: typeof importsTable.$inferSelect, items: Array<typeof importItemsTable.$inferSelect>) {
  return {
    id: job.id,
    source: job.source,
    fileName: job.fileName,
    status: job.status,
    rowCount: job.rowCount,
    summary: job.summary,
    createdAt: job.createdAt.toISOString(),
    confirmedAt: job.confirmedAt?.toISOString() ?? null,
    items: items.map((item) => ({
      id: item.id,
      rowNumber: item.rowNumber,
      kind: item.kind,
      classification: item.classification,
      selected: item.selected,
      errorCode: item.errorCode,
      normalized: item.normalized,
      candidates: item.candidates,
      titleId: item.titleId,
      episodeId: item.episodeId,
    })),
  };
}

async function ownedJob(id: number, userId: string) {
  const [job] = await db
    .select()
    .from(importsTable)
    .where(and(eq(importsTable.id, id), eq(importsTable.userId, userId)));
  return job;
}

function idParam(value: string | string[]): number | null {
  if (Array.isArray(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

router.post("/imports", requireAuth, importCreateRateLimit, express.json({ limit: MAX_IMPORT_JSON_BYTES }), async (req, res) => {
  const { source, fileName, content } = req.body ?? {};
  if (typeof source !== "string" || typeof fileName !== "string" || typeof content !== "string") {
    return res.status(400).json({ error: "source, fileName, and content are required" });
  }
  let parsedRows: ParsedImportRow[];
  try {
    parsedRows = parseImportContent(source, fileName, content);
  } catch (error) {
    // Do not log the source document or include parser internals in responses.
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid import file" });
  }
  const fingerprint = createHash("sha256").update(content, "utf8").digest("hex");
  const userId = req.userId!;
  const [existing] = await db
    .select()
    .from(importsTable)
    .where(and(eq(importsTable.userId, userId), eq(importsTable.source, source), eq(importsTable.fingerprint, fingerprint)));
  if (existing) {
    const items = await db.select().from(importItemsTable).where(eq(importItemsTable.importId, existing.id));
    return res.json(serialiseJob(existing, items));
  }

  const validRecords = parsedRows.flatMap((parsed) => "record" in parsed ? [parsed.record] : []);
  const previews = await classifyImportRows(userId, validRecords);
  let previewIndex = 0;
  const itemValues: Omit<typeof importItemsTable.$inferInsert, "importId">[] = [];
  for (const parsed of parsedRows) {
    if ("errorCode" in parsed) {
      itemValues.push({
        rowNumber: parsed.rowNumber,
        kind: "unsupported",
        classification: parsed.errorCode === "unsupported_row" ? "unsupported" : "invalid",
        selected: false,
        errorCode: parsed.errorCode,
        normalized: { kind: "watched_movie", title: "", type: null, year: null, imdbId: null, tmdbId: null, season: null, episode: null, watchedAt: null } satisfies NormalizedImportRecord,
        candidates: [] as ImportCandidate[],
        titleId: null,
        episodeId: null,
      });
      continue;
    }
    const match = previews[previewIndex++];
    itemValues.push({
      rowNumber: parsed.rowNumber,
      kind: parsed.record.kind,
      classification: match.classification,
      selected: match.classification === "matched",
      errorCode: match.errorCode,
      normalized: parsed.record,
      candidates: match.candidates,
      titleId: match.titleId,
      episodeId: match.episodeId,
    });
  }
  const summary = safeSummary(itemValues);
  try {
    const response = await db.transaction(async (tx) => {
      const [job] = await tx
        .insert(importsTable)
        .values({ userId, source, fileName: fileName.trim(), fingerprint, rowCount: parsedRows.length, summary })
        .onConflictDoNothing()
        .returning();
      if (!job) {
        const [concurrent] = await tx.select().from(importsTable).where(and(eq(importsTable.userId, userId), eq(importsTable.source, source), eq(importsTable.fingerprint, fingerprint)));
        if (!concurrent) throw new Error("Unable to create import");
        const items = await tx.select().from(importItemsTable).where(eq(importItemsTable.importId, concurrent.id));
        return { job: concurrent, items, created: false };
      }
      const items = itemValues.length
        ? await tx.insert(importItemsTable).values(itemValues.map((item) => ({ ...item, importId: job.id }))).returning()
        : [];
      return { job, items, created: true };
    });
    return res.status(response.created ? 201 : 200).json(serialiseJob(response.job, response.items));
  } catch {
    return res.status(500).json({ error: "Unable to create import" });
  }
});

router.get("/imports/:id", requireAuth, async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(404).json({ error: "Import not found" });
  const job = await ownedJob(id, req.userId!);
  if (!job) return res.status(404).json({ error: "Import not found" });
  const items = await db.select().from(importItemsTable).where(eq(importItemsTable.importId, id));
  return res.json(serialiseJob(job, items));
});

router.patch("/imports/:id/items/:itemId", requireAuth, async (req, res) => {
  const id = idParam(req.params.id);
  const itemId = idParam(req.params.itemId);
  if (!id || !itemId) return res.status(404).json({ error: "Import item not found" });
  const outcome = await db.transaction(async (tx) => {
    // This conditional write locks the same job row that confirm claims. A
    // resolver either completes before confirmation claims it, or sees it as
    // non-ready; it can never update items during confirmation.
    const [job] = await tx.update(importsTable)
      .set({ status: "ready" })
      .where(and(eq(importsTable.id, id), eq(importsTable.userId, req.userId!), eq(importsTable.status, "ready")))
      .returning();
    if (!job) {
      const [existing] = await tx.select().from(importsTable).where(and(eq(importsTable.id, id), eq(importsTable.userId, req.userId!)));
      return existing ? { kind: "closed" as const } : { kind: "missing" as const };
    }
    const [item] = await tx.select().from(importItemsTable).where(and(eq(importItemsTable.id, itemId), eq(importItemsTable.importId, id)));
    if (!item) return { kind: "item_missing" as const };
    let updated: typeof importItemsTable.$inferSelect;
    if (req.body?.skip === true && Object.keys(req.body).length === 1) {
      [updated] = await tx.update(importItemsTable).set({ selected: false }).where(eq(importItemsTable.id, itemId)).returning();
    } else {
      const titleId = req.body?.titleId;
      if (!Number.isSafeInteger(titleId) || Object.keys(req.body ?? {}).length !== 1) return { kind: "invalid" as const, error: "Provide exactly one candidate titleId or skip" };
      if (!item.candidates.some((candidate) => candidate.titleId === titleId)) return { kind: "invalid" as const, error: "titleId is not an offered candidate" };
      let episodeId: number | null = null;
      if (item.normalized.kind === "watched_episode") {
        const [episode] = await tx.select().from(episodesTable).where(and(eq(episodesTable.titleId, titleId), eq(episodesTable.seasonNumber, item.normalized.season!), eq(episodesTable.episodeNumber, item.normalized.episode!)));
        if (!episode) return { kind: "invalid" as const, error: "Candidate does not contain the exact episode" };
        episodeId = episode.id;
      }
      const duplicate = await existingDuplicate(tx, req.userId!, item.normalized, titleId, episodeId);
      [updated] = await tx.update(importItemsTable)
        .set({ titleId, episodeId, classification: duplicate ? "duplicate" : "matched", errorCode: duplicate ? "already_exists" : null, selected: !duplicate })
        .where(eq(importItemsTable.id, itemId))
        .returning();
    }
    const allItems = await tx.select({ classification: importItemsTable.classification }).from(importItemsTable).where(eq(importItemsTable.importId, id));
    await tx.update(importsTable).set({ summary: safeSummary(allItems) }).where(eq(importsTable.id, id));
    return { kind: "updated" as const, job, item: updated };
  });
  if (outcome.kind === "missing" || outcome.kind === "item_missing") return res.status(404).json({ error: outcome.kind === "missing" ? "Import not found" : "Import item not found" });
  if (outcome.kind === "closed") return res.status(400).json({ error: "Completed imports cannot be changed" });
  if (outcome.kind === "invalid") return res.status(400).json({ error: outcome.error });
  return res.json(serialiseJob(outcome.job, [outcome.item]).items[0]);
});

router.post("/imports/:id/confirm", requireAuth, importConfirmRateLimit, async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(404).json({ error: "Import not found" });
  try {
    const result = await db.transaction(async (tx) => {
      const [claimed] = await tx.update(importsTable)
        .set({ status: "confirming" })
        .where(and(eq(importsTable.id, id), eq(importsTable.userId, req.userId!), eq(importsTable.status, "ready")))
        .returning();
      if (!claimed) {
        const [existing] = await tx.select().from(importsTable).where(and(eq(importsTable.id, id), eq(importsTable.userId, req.userId!)));
        if (!existing) return null;
        const existingItems = await tx.select().from(importItemsTable).where(eq(importItemsTable.importId, id));
        return { job: existing, items: existingItems };
      }
      const items = await tx.select().from(importItemsTable).where(and(eq(importItemsTable.importId, id), eq(importItemsTable.classification, "matched"), eq(importItemsTable.selected, true)));
      const selectedByTarget = new Map<string, typeof items[number]>();
      const duplicateItemIds: number[] = [];
      for (const item of items) {
        const target = item.kind === "watched_episode"
          ? `episode:${item.episodeId}`
          : `${item.kind === "watchlist" ? "watchlist" : "watched-title"}:${item.titleId}`;
        if (selectedByTarget.has(target)) duplicateItemIds.push(item.id);
        else selectedByTarget.set(target, item);
      }
      const writeItems = [...selectedByTarget.values()];
      let applied = 0;
      const addConflicts = (source: typeof writeItems, insertedIds: Set<number>, value: (item: typeof items[number]) => number) => {
        for (const item of source) {
          if (insertedIds.has(value(item))) applied += 1;
          else duplicateItemIds.push(item.id);
        }
      };
      const watchlistItems = writeItems.filter((item) => item.kind === "watchlist");
      for (const batch of chunks(watchlistItems)) {
        const inserted = await tx.insert(watchlistTable)
          .values(batch.map((item) => ({ userId: req.userId!, titleId: item.titleId! })))
          .onConflictDoNothing()
          .returning({ titleId: watchlistTable.titleId });
        addConflicts(batch, new Set(inserted.map((row) => row.titleId)), (item) => item.titleId!);
      }
      const episodeItems = writeItems.filter((item) => item.kind === "watched_episode");
      for (const batch of chunks(episodeItems)) {
        const inserted = await tx.insert(watchedEpisodesTable)
          .values(batch.map((item) => ({
            userId: req.userId!,
            titleId: item.titleId!,
            episodeId: item.episodeId!,
            ...(item.normalized.watchedAt ? { watchedAt: new Date(item.normalized.watchedAt) } : {}),
          })))
          .onConflictDoNothing()
          .returning({ episodeId: watchedEpisodesTable.episodeId });
        addConflicts(batch, new Set(inserted.map((row) => row.episodeId)), (item) => item.episodeId!);
      }
      // Episode watches also follow their parent title, but that supporting
      // insert does not determine whether the episode import was applied.
      for (const batch of chunks(episodeItems)) {
        await tx.insert(watchedTitlesTable)
          .values(batch.map((item) => ({
            userId: req.userId!,
            titleId: item.titleId!,
            ...(item.normalized.watchedAt ? { watchedAt: new Date(item.normalized.watchedAt) } : {}),
          })))
          .onConflictDoNothing();
      }
      const watchedTitleItems = writeItems.filter((item) => item.kind !== "watchlist" && item.kind !== "watched_episode");
      for (const batch of chunks(watchedTitleItems)) {
        const inserted = await tx.insert(watchedTitlesTable)
          .values(batch.map((item) => ({
            userId: req.userId!,
            titleId: item.titleId!,
            ...(item.normalized.watchedAt ? { watchedAt: new Date(item.normalized.watchedAt) } : {}),
          })))
          .onConflictDoNothing()
          .returning({ titleId: watchedTitlesTable.titleId });
        addConflicts(batch, new Set(inserted.map((row) => row.titleId)), (item) => item.titleId!);
      }
      for (const batch of chunks(duplicateItemIds)) {
        await tx.update(importItemsTable)
          .set({ classification: "duplicate", selected: false, errorCode: "already_exists" })
          .where(inArray(importItemsTable.id, batch));
      }
      const summary = {
        ...(claimed.summary as Record<string, number>),
        selected: items.length,
        applied,
        duplicates: Number((claimed.summary as Record<string, number>).duplicate ?? 0) + duplicateItemIds.length,
        skipped: claimed.rowCount - items.length,
      };
      const [completed] = await tx.update(importsTable).set({ status: "confirmed", confirmedAt: new Date(), summary }).where(eq(importsTable.id, id)).returning();
      const allItems = await tx.select().from(importItemsTable).where(eq(importItemsTable.importId, id));
      return { job: completed, items: allItems };
    });
    if (!result) return res.status(404).json({ error: "Import not found" });
    return res.json(serialiseJob(result.job, result.items));
  } catch {
    return res.status(500).json({ error: "Unable to confirm import; no records were changed" });
  }
});

router.get("/imports/:id/report", requireAuth, async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(404).json({ error: "Import not found" });
  const job = await ownedJob(id, req.userId!);
  if (!job) return res.status(404).json({ error: "Import not found" });
  const items = await db.select().from(importItemsTable).where(eq(importItemsTable.importId, id));
  const rows = items.filter((item) => item.classification !== "matched" || !item.selected);
  const escape = (value: string | number | null) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const body = ["rowNumber,kind,classification,errorCode,title", ...rows.map((item) => [item.rowNumber, item.kind, item.classification, item.errorCode, item.normalized.title].map(escape).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="watchtime-import-${id}-report.csv"`);
  return res.send(body);
});

export default router;