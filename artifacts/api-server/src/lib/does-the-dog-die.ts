import {
  db,
  integrationHealthTable,
  providerMappingsTable,
  safetyRecordsTable,
  titlesTable,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";

export const DOES_THE_DOG_DIE_PROVIDER = "Does the Dog Die?";
export const DOES_THE_DOG_DIE_SOURCE_URL = "https://www.doesthedogdie.com";
const DEFAULT_BASE_URL = "https://www.doesthedogdie.com/api/v3";
const REQUEST_TIMEOUT_MS = 10_000;
const COMMERCIAL_TIERS = new Set(["commercial", "enterprise"]);

type FetchLike = typeof fetch;

export type DoesTheDogDieItem = {
  id: number;
  name: string;
  releaseYear: number | null;
  imdbId: string | null;
  itemTypeName: string | null;
  topicItemStats?: DoesTheDogDieTopicStat[];
};

export type DoesTheDogDieTopicStat = {
  topicItemId: number | null;
  yesSum: number;
  noSum: number;
  numComments: number;
  topicId: number | null;
  topicName: string;
  itemId: number | null;
};

export type DoesTheDogDieRefreshResult = {
  ok: true;
  titleId: number;
  titleName: string;
  externalId: string;
  items: number;
} | {
  ok: false;
  titleId: number;
  titleName: string;
  status: "provider_unavailable" | "missing" | "error";
  error: string;
};

export class DoesTheDogDieError extends Error {
  constructor(
    message: string,
    readonly code:
      | "missing_credentials"
      | "commercial_restriction"
      | "authentication"
      | "rate_limited"
      | "unavailable"
      | "malformed"
      | "missing_mapping"
      | "ambiguous_mapping",
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "DoesTheDogDieError";
  }
}

export type DoesTheDogDieClientOptions = {
  apiKey?: string;
  apiTier?: string;
  commercialUse?: boolean;
  baseUrl?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerOrNull(value: unknown): number | null {
  const number = numberOrNull(value);
  return number != null && Number.isInteger(number) ? number : null;
}

function requiredInteger(value: unknown, field: string): number {
  const number = integerOrNull(value);
  if (number == null) throw new DoesTheDogDieError(`Malformed Does the Dog Die response: ${field}`, "malformed");
  return number;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DoesTheDogDieError(`Malformed Does the Dog Die response: ${field}`, "malformed");
  }
  return value.trim();
}

function parseItem(value: unknown): DoesTheDogDieItem {
  if (!value || typeof value !== "object") {
    throw new DoesTheDogDieError("Malformed Does the Dog Die item", "malformed");
  }
  const item = value as Record<string, unknown>;
  return {
    id: requiredInteger(item.id, "item.id"),
    name: requiredString(item.name, "item.name"),
    releaseYear: integerOrNull(item.releaseYear),
    imdbId: typeof item.imdbId === "string" && item.imdbId.trim() ? item.imdbId.trim() : null,
    itemTypeName: typeof item.itemTypeName === "string" ? item.itemTypeName : null,
    topicItemStats: Array.isArray(item.topicItemStats)
      ? item.topicItemStats.map(parseTopicStat)
      : undefined,
  };
}

function parseTopicStat(value: unknown): DoesTheDogDieTopicStat {
  if (!value || typeof value !== "object") {
    throw new DoesTheDogDieError("Malformed Does the Dog Die topic statistic", "malformed");
  }
  const stat = value as Record<string, unknown>;
  const yesSum = integerOrNull(stat.yesSum);
  const noSum = integerOrNull(stat.noSum);
  const numComments = integerOrNull(stat.numComments);
  if (yesSum == null || yesSum < 0 || noSum == null || noSum < 0 || numComments == null || numComments < 0) {
    throw new DoesTheDogDieError("Malformed Does the Dog Die topic statistic counts", "malformed");
  }
  return {
    topicItemId: integerOrNull(stat.topicItemId),
    yesSum,
    noSum,
    numComments,
    topicId: integerOrNull(stat.topicId),
    topicName: requiredString(stat.topicName, "topicItemStats.topicName"),
    itemId: integerOrNull(stat.itemId),
  };
}

export function normalizeDoesTheDogDieTopicStats(stats: unknown): DoesTheDogDieTopicStat[] {
  if (!Array.isArray(stats)) {
    throw new DoesTheDogDieError("Malformed Does the Dog Die response: topicItemStats", "malformed");
  }
  return stats.map(parseTopicStat);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function createDoesTheDogDieClient(options: DoesTheDogDieClientOptions = {}) {
  const apiKey = options.apiKey ?? process.env.DOES_THE_DOG_DIE_API_KEY;
  const apiTier = (options.apiTier ?? process.env.DOES_THE_DOG_DIE_API_TIER ?? "free").toLowerCase();
  const commercialUse =
    options.commercialUse ?? process.env.DOES_THE_DOG_DIE_COMMERCIAL_USE === "true";
  const fetchFn = options.fetchFn ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.DOES_THE_DOG_DIE_API_BASE_URL ?? DEFAULT_BASE_URL);
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  function validateConfiguration() {
    if (!apiKey?.trim()) {
      throw new DoesTheDogDieError(
        "Does the Dog Die API key is not configured",
        "missing_credentials",
      );
    }
    if (commercialUse && !COMMERCIAL_TIERS.has(apiTier)) {
      throw new DoesTheDogDieError(
        "The configured Does the Dog Die API tier does not permit commercial use",
        "commercial_restriction",
      );
    }
  }

  async function request(path: string): Promise<unknown> {
    validateConfiguration();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchFn(`${baseUrl}${path}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-API-KEY": apiKey!,
          },
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof DoesTheDogDieError) throw error;
        throw new DoesTheDogDieError(
          error instanceof Error && error.name === "AbortError"
            ? "Does the Dog Die API request timed out"
            : "Does the Dog Die API is unavailable",
          "unavailable",
        );
      }
      if (response.status === 401) {
        throw new DoesTheDogDieError(
          "Does the Dog Die API key was rejected",
          "authentication",
          response.status,
        );
      }
      if (response.status === 403) {
        throw new DoesTheDogDieError(
          "Does the Dog Die API tier does not permit this request",
          "commercial_restriction",
          response.status,
        );
      }
      if (response.status === 429) {
        throw new DoesTheDogDieError(
          "Does the Dog Die API rate limit was exceeded",
          "rate_limited",
          response.status,
        );
      }
      if (!response.ok) {
        throw new DoesTheDogDieError(
          `Does the Dog Die API returned HTTP ${response.status}`,
          "unavailable",
          response.status,
        );
      }
      try {
        return await response.json();
      } catch {
        throw new DoesTheDogDieError(
          "Does the Dog Die API returned invalid JSON",
          "malformed",
          response.status,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async searchItems(query: string): Promise<DoesTheDogDieItem[]> {
      const payload = await request(`/items?q=${encodeURIComponent(query)}`);
      if (!Array.isArray(payload)) {
        throw new DoesTheDogDieError("Malformed Does the Dog Die search response", "malformed");
      }
      return payload.map(parseItem);
    },
    async getItem(id: number): Promise<DoesTheDogDieItem> {
      const payload = await request(`/items/${id}`);
      const item = parseItem(payload);
      item.topicItemStats = normalizeDoesTheDogDieTopicStats(
        (payload as Record<string, unknown>).topicItemStats,
      );
      return item;
    },
  };
}

function normalizeTitle(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sameImdbId(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left && right && left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase());
}

export type CatalogTitleForDoesTheDogDie = Pick<
  typeof titlesTable.$inferSelect,
  "id" | "type" | "name" | "altTitles" | "year" | "imdbId"
>;

function isCompatibleItemType(
  title: CatalogTitleForDoesTheDogDie,
  item: DoesTheDogDieItem,
): boolean {
  if (!item.itemTypeName) return true;
  const providerType = item.itemTypeName.toLocaleLowerCase();
  if (title.type === "movie") return providerType.includes("movie");
  return providerType.includes("tv") || providerType.includes("anime");
}

export function resolveDoesTheDogDieMatch(
  title: CatalogTitleForDoesTheDogDie,
  searchResults: DoesTheDogDieItem[],
): DoesTheDogDieItem {
  const compatibleResults = searchResults.filter((item) => isCompatibleItemType(title, item));
  if (title.imdbId) {
    const imdbMatches = compatibleResults.filter((item) => sameImdbId(item.imdbId, title.imdbId));
    if (imdbMatches.length === 1) return imdbMatches[0];
    if (imdbMatches.length > 1) {
      throw new DoesTheDogDieError(
        `Ambiguous Does the Dog Die IMDb match for "${title.name}"`,
        "ambiguous_mapping",
      );
    }
  }

  const acceptedNames = new Set([title.name, ...(title.altTitles ?? [])].map(normalizeTitle));
  const nameMatches = compatibleResults.filter((item) => acceptedNames.has(normalizeTitle(item.name)));
  const yearMatches = title.year == null
    ? nameMatches
    : nameMatches.filter((item) => item.releaseYear === title.year);
  if (yearMatches.length === 1) return yearMatches[0];
  if (yearMatches.length > 1) {
    throw new DoesTheDogDieError(
      `Ambiguous Does the Dog Die title/year match for "${title.name}"`,
      "ambiguous_mapping",
    );
  }
  throw new DoesTheDogDieError(
    `No Does the Dog Die match found for "${title.name}"`,
    "missing_mapping",
  );
}

export function normalizeDoesTheDogDieSafetyItems(
  stats: DoesTheDogDieTopicStat[],
) {
  return stats.map((stat) => {
    const totalVotes = stat.yesSum + stat.noSum;
    return {
      category: stat.topicName,
      label: stat.topicName,
      score: stat.yesSum,
      maxScore: totalVotes,
      description: `${stat.yesSum} yes / ${stat.noSum} no votes; ${stat.numComments} comments`,
    };
  });
}

function errorStatus(error: DoesTheDogDieError): "provider_unavailable" | "missing" | "error" {
  if (error.code === "missing_mapping") return "missing";
  if (error.code === "missing_credentials" || error.code === "commercial_restriction") {
    return "provider_unavailable";
  }
  return "error";
}

function errorHealthStatus(error: DoesTheDogDieError) {
  if (error.code === "missing_credentials" || error.code === "commercial_restriction") {
    return "provider_unavailable" as const;
  }
  if (error.code === "rate_limited") return "degraded" as const;
  return "failing" as const;
}

async function updateIntegrationHealth(values: {
  status: "healthy" | "degraded" | "failing" | "provider_unavailable";
  lastSyncAt: Date;
  lastSuccessAt?: Date;
  lastError: string | null;
}) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('watchtime:catalog-sync'))`);
    const mappedCounts = await tx
      .select({
        mapped: sql<number>`count(*) filter (where ${providerMappingsTable.status} = 'mapped')::int`,
        missing: sql<number>`count(*) filter (where ${providerMappingsTable.status} = 'missing')::int`,
      })
      .from(providerMappingsTable)
      .where(eq(providerMappingsTable.provider, DOES_THE_DOG_DIE_PROVIDER));
    const counts = mappedCounts[0] ?? { mapped: 0, missing: 0 };
    const [existing] = await tx
      .select()
      .from(integrationHealthTable)
      .where(eq(integrationHealthTable.provider, DOES_THE_DOG_DIE_PROVIDER));
    const healthValues = {
      status: values.status,
      lastSyncAt: values.lastSyncAt,
      ...(values.lastSuccessAt ? { lastSuccessAt: values.lastSuccessAt } : {}),
      lastError: values.lastError,
      successRatePercent: values.status === "healthy" ? 100 : 0,
      mappedTitles: counts.mapped,
      missingMappings: counts.missing,
    };
    if (existing) await tx.update(integrationHealthTable).set(healthValues).where(eq(integrationHealthTable.id, existing.id));
    else await tx.insert(integrationHealthTable).values({ provider: DOES_THE_DOG_DIE_PROVIDER, ...healthValues });
  });
}

async function updateMappingStatus(
  titleId: number,
  currentMapping: typeof providerMappingsTable.$inferSelect | undefined,
  status: "missing" | "error",
) {
  if (!currentMapping) {
    await db.insert(providerMappingsTable).values({
      titleId,
      provider: DOES_THE_DOG_DIE_PROVIDER,
      externalId: null,
      status,
      lastRefreshedAt: null,
    });
    return;
  }
  // A known-good mapping is never replaced by a failed provider lookup.
  if (currentMapping.status === "mapped" && currentMapping.externalId) return;
  await db
    .update(providerMappingsTable)
    .set({ status })
    .where(eq(providerMappingsTable.id, currentMapping.id));
}

export async function refreshDoesTheDogDieTitle(
  titleId: number,
  client = createDoesTheDogDieClient(),
): Promise<DoesTheDogDieRefreshResult> {
  const [title] = await db
    .select({
      id: titlesTable.id,
      type: titlesTable.type,
      name: titlesTable.name,
      altTitles: titlesTable.altTitles,
      year: titlesTable.year,
      imdbId: titlesTable.imdbId,
    })
    .from(titlesTable)
    .where(eq(titlesTable.id, titleId));
  if (!title) {
    return { ok: false, titleId, titleName: "", status: "missing", error: "Title not found" };
  }

  const [currentMapping] = await db
    .select()
    .from(providerMappingsTable)
    .where(
      and(
        eq(providerMappingsTable.titleId, titleId),
        eq(providerMappingsTable.provider, DOES_THE_DOG_DIE_PROVIDER),
      ),
    );
  const now = new Date();

  try {
    const searchResults = await client.searchItems(title.name);
    const match = resolveDoesTheDogDieMatch(title, searchResults);
    const details = await client.getItem(match.id);
    const stats = normalizeDoesTheDogDieTopicStats(details.topicItemStats);
    const items = normalizeDoesTheDogDieSafetyItems(stats);
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('watchtime:catalog-sync'))`);
      const [lockedMapping] = await tx
        .select()
        .from(providerMappingsTable)
        .where(
          and(
            eq(providerMappingsTable.titleId, titleId),
            eq(providerMappingsTable.provider, DOES_THE_DOG_DIE_PROVIDER),
          ),
        )
        .limit(1);
      if (lockedMapping) {
        await tx
          .update(providerMappingsTable)
          .set({
            externalId: String(match.id),
            status: "mapped",
            lastRefreshedAt: now,
          })
          .where(eq(providerMappingsTable.id, lockedMapping.id));
      } else {
        await tx.insert(providerMappingsTable).values({
          titleId,
          provider: DOES_THE_DOG_DIE_PROVIDER,
          externalId: String(match.id),
          status: "mapped",
          lastRefreshedAt: now,
        });
      }
      const [existingRecord] = await tx
        .select()
        .from(safetyRecordsTable)
        .where(
          and(
            eq(safetyRecordsTable.titleId, titleId),
            eq(safetyRecordsTable.sourceName, DOES_THE_DOG_DIE_PROVIDER),
            isNull(safetyRecordsTable.seasonNumber),
            isNull(safetyRecordsTable.episodeNumber),
          ),
        );
      const values = {
        titleId,
        sourceName: DOES_THE_DOG_DIE_PROVIDER,
        tier: 2,
        isCommunity: false,
        url: `${DOES_THE_DOG_DIE_SOURCE_URL}/media/${match.id}`,
        status: "available" as const,
        items,
        updatedAt: now,
      };
      if (existingRecord) {
        await tx.update(safetyRecordsTable).set(values).where(eq(safetyRecordsTable.id, existingRecord.id));
      } else {
        await tx.insert(safetyRecordsTable).values(values);
      }
    });
    await updateIntegrationHealth({
      status: "healthy",
      lastSyncAt: now,
      lastSuccessAt: now,
      lastError: null,
    });
    return {
      ok: true,
      titleId,
      titleName: title.name,
      externalId: String(match.id),
      items: items.length,
    };
  } catch (caught) {
    const error = caught instanceof DoesTheDogDieError
      ? caught
      : new DoesTheDogDieError("Unexpected Does the Dog Die refresh failure", "unavailable");
    if (error.code === "missing_mapping" || error.code === "ambiguous_mapping") {
      await updateMappingStatus(titleId, currentMapping, error.code === "missing_mapping" ? "missing" : "error");
    }
    await updateIntegrationHealth({
      status: errorHealthStatus(error),
      lastSyncAt: now,
      lastError: error.message,
    });
    return {
      ok: false,
      titleId,
      titleName: title.name,
      status: errorStatus(error),
      error: error.message,
    };
  }
}

export async function refreshDoesTheDogDieBatch(options: {
  limit: number;
  offset: number;
  titleSelection?: { id: number; name: string }[];
  client?: ReturnType<typeof createDoesTheDogDieClient>;
  delayMs?: number;
  refreshTitle?: (titleId: number) => Promise<DoesTheDogDieRefreshResult>;
}) {
  const limit = Math.min(Math.max(Math.trunc(options.limit), 1), 25);
  const offset = Math.max(Math.trunc(options.offset), 0);
  const titles = options.titleSelection
    ? options.titleSelection.slice(0, limit)
    : await db
        .select({ id: titlesTable.id, name: titlesTable.name })
        .from(titlesTable)
        .orderBy(titlesTable.id)
        .limit(limit)
        .offset(offset);
  const results: DoesTheDogDieRefreshResult[] = [];
  const refreshTitle = options.refreshTitle ??
    ((titleId: number) => refreshDoesTheDogDieTitle(titleId, options.client));
  for (const [index, title] of titles.entries()) {
    if (index > 0 && options.delayMs !== 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 250));
    }
    results.push(await refreshTitle(title.id));
  }
  return { offset, limit, processed: results.length, results };
}