import { and, desc, eq, inArray, lt, notInArray, or, sql } from "drizzle-orm";
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
const SCHEDULED_START_RETRY_MS = 5 * 60 * 1000;
const SUSTAINED_FAILURE_MS = 3 * 24 * 60 * 60 * 1000;
export const STALE_QUEUED_REFRESH_MS = 5 * 60 * 1000;
export const CATALOG_REFRESH_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const COMPLETED_RUN_STATUSES = ["succeeded", "partial", "failed", "skipped"];
let timer: NodeJS.Timeout | undefined;
const activeRunIds = new Set<number>();

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
  activeRunIds.add(runId);
  try {
    // A transaction-scoped lease protects the queued startup write across API
    // processes without reserving an extra pool connection for the whole sync.
    const started = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('watchtime:catalog-refresh-worker'), ${runId})`);
      const runs = await tx.update(catalogSyncRunsTable).set({ status: "running", startedAt: new Date() })
        .where(and(eq(catalogSyncRunsTable.id, runId), eq(catalogSyncRunsTable.status, "queued")))
        .returning({ id: catalogSyncRunsTable.id });
      return runs.length > 0;
    });
    if (!started) return;
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
      // Keep the run and its retryable titles consistent if recording the
      // failure also encounters an outage. Completed title results stay intact.
      await db.transaction(async (tx) => {
        const finishedAt = new Date();
        await tx.update(catalogSyncRunsTable).set({ status: "failed", error: message, finishedAt })
          .where(eq(catalogSyncRunsTable.id, runId));
        await tx.update(catalogSyncItemsTable).set({ status: "failed", error: message, finishedAt })
          .where(and(
            eq(catalogSyncItemsTable.runId, runId),
            inArray(catalogSyncItemsTable.status, ["queued", "running"]),
          ));
      });
    } catch (recordError) {
      logger.error({ err: recordError, runId }, "unable to record catalog refresh failure");
    }
  } finally {
    activeRunIds.delete(runId);
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

export async function retryFailedCatalogTitles(
  runId: number,
  beforeStart?: (tx: CatalogRefreshTransaction, runId: number) => Promise<void>,
) {
  const failed = await db.select({ itemKey: catalogSyncItemsTable.itemKey })
    .from(catalogSyncItemsTable)
    .where(and(eq(catalogSyncItemsTable.runId, runId), eq(catalogSyncItemsTable.status, "failed")));
  const keys = new Set(failed.map((item) => item.itemKey));
  if (!keys.size) return null;
  return startCatalogRefresh("retry", sourceItems.filter((item) => keys.has(item.key)), beforeStart);
}

export async function scheduleCatalogRefresh(delayOverride?: number) {
  if (delayOverride === undefined) {
    await recoverInterruptedRuns();
  } else {
    // Recovery must not prevent the next scheduled attempt during an outage.
    await recoverInterruptedRuns().catch((err) => {
      logger.warn({ err }, "unable to recover interrupted catalog refreshes");
    });
  }
  let delay = delayOverride;
  if (delay === undefined) {
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
    let nextDelay = WEEK_MS;
    startCatalogRefresh("scheduled")
      .catch((err) => {
        nextDelay = SCHEDULED_START_RETRY_MS;
        logger.error({ err }, "unable to start scheduled catalog refresh");
      })
      .finally(() => {
        // A newer initialization owns the schedule if it replaced this timer
        // while the scheduled run was starting.
        if (timer !== scheduledTimer) return;
        void scheduleCatalogRefresh(nextDelay)
          .catch((err) => logger.error({ err }, "unable to reschedule catalog refresh"));
      });
  }, delay);
  timer = scheduledTimer;
  timer.unref();
  logger.info({ dueAt: new Date(Date.now() + delay) }, "catalog refresh scheduled");
}

export async function recoverInterruptedRuns(
  queuedCutoff = new Date(Date.now() - STALE_QUEUED_REFRESH_MS),
) {
  const client = await pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext('watchtime:catalog-sync')) as locked",
    );
    if (!lock.rows[0]?.locked) return;
    // The catalog lock excludes provider work; run leases also protect workers
    // awaiting their startup write in another process. Local workers are
    // protected even while acquiring their lease. Leave newly queued work alone.
    const queuedExplanation = "Catalog refresh worker stopped before starting (server restart or database outage); retry the failed titles";
    const runningExplanation = "Catalog refresh was interrupted by a server restart";
    const interrupted = await db.transaction(async (tx) => {
      const runs = await tx.update(catalogSyncRunsTable).set({
        status: "failed",
        error: sql`case when ${catalogSyncRunsTable.status} = 'queued' then ${queuedExplanation} else ${runningExplanation} end`,
        finishedAt: new Date(),
      }).where(and(
        or(
          eq(catalogSyncRunsTable.status, "running"),
          and(
            eq(catalogSyncRunsTable.status, "queued"),
            lt(catalogSyncRunsTable.createdAt, queuedCutoff),
          ),
        ),
        activeRunIds.size ? notInArray(catalogSyncRunsTable.id, [...activeRunIds]) : undefined,
        sql`pg_try_advisory_xact_lock(hashtext('watchtime:catalog-refresh-worker'), ${catalogSyncRunsTable.id})`,
      )).returning({ id: catalogSyncRunsTable.id, error: catalogSyncRunsTable.error });
      for (const explanation of [queuedExplanation, runningExplanation]) {
        const runIds = runs.filter((run) => run.error === explanation).map((run) => run.id);
        if (!runIds.length) continue;
        await tx.update(catalogSyncItemsTable).set({
          status: "failed",
          error: explanation,
          finishedAt: new Date(),
        }).where(and(
          inArray(catalogSyncItemsTable.runId, runIds),
          inArray(catalogSyncItemsTable.status, ["queued", "running"]),
        ));
      }
      return runs;
    });
    if (interrupted.length) {
      logger.warn({ runIds: interrupted.map((run) => run.id) }, "recovered interrupted catalog refreshes");
    }
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('watchtime:catalog-sync'))").catch(() => {});
    client.release();
  }
}