import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  catalogSyncItemsTable,
  catalogSyncRunsTable,
  db,
  integrationHealthTable,
  pool,
} from "@workspace/db";
import { runCatalogSync, sourceItems, type SourceItem } from "../seed-real";
import { logger } from "./logger";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SUSTAINED_FAILURE_MS = 3 * 24 * 60 * 60 * 1000;
export const CATALOG_REFRESH_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const COMPLETED_RUN_STATUSES = ["succeeded", "partial", "failed", "skipped"];
let timer: NodeJS.Timeout | undefined;

type CatalogRefreshTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function startCatalogRefresh(
  trigger: "scheduled" | "manual" | "retry",
  items: SourceItem[] = sourceItems,
  beforeStart?: (tx: CatalogRefreshTransaction, runId: number) => Promise<void>,
) {
  const queueRun = async (connection: Pick<typeof db, "insert">) => {
    const [run] = await connection.insert(catalogSyncRunsTable).values({
      trigger,
      status: "queued",
      totalItems: items.length,
    }).returning();
    if (items.length) {
      await connection.insert(catalogSyncItemsTable).values(items.map((item) => ({
        runId: run.id,
        itemKey: item.key,
        title: item.name,
        provider: item.source === "tvmaze" ? "TVMaze" : "Wikipedia",
      })));
    }
    return run.id;
  };

  // Audited starts commit the queue and audit together before any detached work.
  // A failed audit rolls back both run and items; scheduled starts are unchanged.
  const runId = beforeStart
    ? await db.transaction(async (tx) => {
        const id = await queueRun(tx);
        await beforeStart(tx, id);
        return id;
      })
    : await queueRun(db);

  void executeRun(runId, items);
  return runId;
}

async function executeRun(runId: number, items: SourceItem[]) {
  try {
    await db.update(catalogSyncRunsTable).set({ status: "running", startedAt: new Date() })
      .where(eq(catalogSyncRunsTable.id, runId));
    const result = await runCatalogSync(
      { dryRun: false, allowPartial: true },
      items,
      async ({ item, status, attempted, succeeded, episodes, error }) => {
        await db.transaction(async (tx) => {
          await tx.update(catalogSyncItemsTable).set({
            status,
            error: error ?? null,
            startedAt: status === "running" ? new Date() : undefined,
            finishedAt: status !== "running" ? new Date() : undefined,
          }).where(and(eq(catalogSyncItemsTable.runId, runId), eq(catalogSyncItemsTable.itemKey, item.key)));
          await tx.update(catalogSyncRunsTable).set({
            processedItems: status === "running" ? Math.max(0, attempted - 1) : attempted,
            succeededItems: succeeded,
            failedItems: Math.max(0, (status === "running" ? attempted - 1 : attempted) - succeeded),
            episodesUpdated: episodes,
          }).where(eq(catalogSyncRunsTable.id, runId));
        });
      },
      false,
    );
    if (!result) {
      await db.update(catalogSyncRunsTable).set({
        status: "skipped", error: "Another catalog refresh is already running", finishedAt: new Date(),
      }).where(eq(catalogSyncRunsTable.id, runId));
      return;
    }
    await db.update(catalogSyncRunsTable).set({
      status: result.failures.length ? (result.succeeded ? "partial" : "failed") : "succeeded",
      processedItems: result.selected,
      succeededItems: result.succeeded,
      failedItems: result.failures.length,
      episodesUpdated: result.episodes,
      error: result.failures[0]?.error ?? null,
      finishedAt: new Date(),
    }).where(eq(catalogSyncRunsTable.id, runId));
    await logSustainedProviderFailures();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, runId }, "catalog refresh failed");
    try {
      await db.update(catalogSyncRunsTable).set({ status: "failed", error: message, finishedAt: new Date() })
        .where(eq(catalogSyncRunsTable.id, runId));
    } catch (recordError) {
      logger.error({ err: recordError, runId }, "unable to record catalog refresh failure");
    }
  } finally {
    void pruneCatalogRefreshHistory().catch((error) => {
      logger.warn({ err: error }, "unable to prune catalog refresh history");
    });
  }
}

export async function pruneCatalogRefreshHistory(
  cutoff = new Date(Date.now() - CATALOG_REFRESH_RETENTION_MS),
) {
  const deleted = await db.delete(catalogSyncRunsTable)
    .where(and(
      inArray(catalogSyncRunsTable.status, COMPLETED_RUN_STATUSES),
      lt(catalogSyncRunsTable.finishedAt, cutoff),
    ))
    .returning({ id: catalogSyncRunsTable.id });
  if (deleted.length) {
    logger.info(
      { deletedRuns: deleted.length, cutoff },
      "pruned catalog refresh history",
    );
  }
  return deleted.length;
}

async function logSustainedProviderFailures() {
  const threshold = new Date(Date.now() - SUSTAINED_FAILURE_MS);
  const unhealthy = await db.select().from(integrationHealthTable).where(and(
    inArray(integrationHealthTable.provider, ["TVMaze", "Wikipedia"]),
    eq(integrationHealthTable.status, "failing"),
    sql`${integrationHealthTable.lastSuccessAt} is null or ${integrationHealthTable.lastSuccessAt} < ${threshold}`,
  ));
  for (const provider of unhealthy) {
    logger.error({ provider: provider.provider, lastSuccessAt: provider.lastSuccessAt, lastError: provider.lastError },
      "catalog provider has sustained failures");
  }
}

export async function retryFailedCatalogTitles(runId: number) {
  const failed = await db.select({ itemKey: catalogSyncItemsTable.itemKey })
    .from(catalogSyncItemsTable)
    .where(and(eq(catalogSyncItemsTable.runId, runId), eq(catalogSyncItemsTable.status, "failed")));
  const keys = new Set(failed.map((item) => item.itemKey));
  if (!keys.size) return null;
  return startCatalogRefresh("retry", sourceItems.filter((item) => keys.has(item.key)));
}

export async function scheduleCatalogRefresh(delayOverride?: number) {
  let delay = delayOverride;
  if (delay === undefined) {
    await recoverInterruptedRuns();
    const [latest] = await db.select().from(catalogSyncRunsTable)
      // Failed and skipped runs are attempts too. Scheduling from only
      // successful runs made a restart immediately repeat an overdue failure.
      .where(inArray(catalogSyncRunsTable.status, COMPLETED_RUN_STATUSES))
      .orderBy(desc(catalogSyncRunsTable.createdAt)).limit(1);
    const dueAt = latest?.createdAt ? latest.createdAt.getTime() + WEEK_MS : Date.now();
    delay = Math.max(1_000, dueAt - Date.now());
  }
  // Keep the previous timer if scheduling fails, and cancel it only when
  // the replacement is ready (including when two initializations overlap).
  if (timer) clearTimeout(timer);
  const scheduledTimer = setTimeout(() => {
    startCatalogRefresh("scheduled")
      .catch((err) => logger.error({ err }, "unable to start scheduled catalog refresh"))
      .finally(() => {
        // A newer initialization owns the schedule if it replaced this timer
        // while the scheduled run was starting.
        if (timer !== scheduledTimer) return;
        void scheduleCatalogRefresh(WEEK_MS)
          .catch((err) => logger.error({ err }, "unable to reschedule catalog refresh"));
      });
  }, delay);
  timer = scheduledTimer;
  timer.unref();
  logger.info({ dueAt: new Date(Date.now() + delay) }, "catalog refresh scheduled");
}

async function recoverInterruptedRuns() {
  const client = await pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext('watchtime:catalog-sync')) as locked",
    );
    if (!lock.rows[0]?.locked) return;
    const interrupted = await db.update(catalogSyncRunsTable).set({
      status: "failed",
      error: "Catalog refresh was interrupted by a server restart",
      finishedAt: new Date(),
    }).where(eq(catalogSyncRunsTable.status, "running")).returning({ id: catalogSyncRunsTable.id });
    if (interrupted.length) {
      await db.update(catalogSyncItemsTable).set({
        status: "failed",
        error: "Catalog refresh was interrupted by a server restart",
        finishedAt: new Date(),
      }).where(and(
        inArray(catalogSyncItemsTable.runId, interrupted.map((run) => run.id)),
        inArray(catalogSyncItemsTable.status, ["queued", "running"]),
      ));
      logger.warn({ runIds: interrupted.map((run) => run.id) }, "recovered interrupted catalog refreshes");
    }
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('watchtime:catalog-sync'))").catch(() => {});
    client.release();
  }
}