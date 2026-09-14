import {
  db,
  integrationHealthTable,
  providerMappingsTable,
  safetyRecordsTable,
  titlesTable,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";

/**
 * Wikidata's public SPARQL endpoint is deliberately used without credentials.
 * Keep this provider name stable: it is persisted in provider_mappings and is
 * also the value shown by the admin integration health endpoint.
 */
export const WIKIDATA_PROVIDER = "Wikidata";
export const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
export const WIKIDATA_SOURCE_URL = "https://www.wikidata.org";

const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
const MAX_BATCH_SIZE = 25;
const IMDB_ID_PATTERN = /^tt\d{7,10}$/i;

/**
 * These are the Wikidata properties that contain classification labels, not
 * numeric safety scores. Their property meanings are intentionally kept next
 * to the query so a future property change cannot silently alter semantics.
 */
export const WIKIDATA_CLASSIFICATION_PROPERTIES = {
  P1657: "MPAA",
  P1981: "FSK",
  P2629: "BBFC",
  P2758: "CNC",
  P3156: "Australian Classification",
  P3216: "ClassInd",
} as const;

export const WIKIDATA_CLASSIFICATION_REGIONS = {
  P1657: "US",
  P1981: "DE",
  P2629: "GB",
  P2758: "FR",
  P3156: "AU",
  P3216: "BR",
} as const;

type ClassificationProperty = keyof typeof WIKIDATA_CLASSIFICATION_PROPERTIES;

type FetchLike = typeof fetch;

export class WikidataError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_imdb_id"
      | "authentication"
      | "rate_limited"
      | "unavailable"
      | "malformed"
      | "missing_mapping"
      | "ambiguous_mapping",
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "WikidataError";
  }
}

export type WikidataClientOptions = {
  endpoint?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
};

export type WikidataClassification = {
  property: ClassificationProperty;
  propertyName: (typeof WIKIDATA_CLASSIFICATION_PROPERTIES)[ClassificationProperty];
  label: string;
  valueId: string | null;
};

export type WikidataItem = {
  itemId: string;
  itemUrl: string;
  imdbId: string;
  classifications: WikidataClassification[];
};

type SparqlBinding = {
  type?: unknown;
  value?: unknown;
};

type SparqlResponse = {
  head?: { vars?: unknown };
  results?: { bindings?: unknown };
};

function normalizeImdbId(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function assertImdbId(value: string): string {
  const imdbId = normalizeImdbId(value);
  if (!IMDB_ID_PATTERN.test(imdbId)) {
    throw new WikidataError(`Invalid IMDb ID: ${value}`, "invalid_imdb_id");
  }
  return imdbId;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function bindingValue(value: unknown): string | null {
  if (!isRecord(value) || typeof value.value !== "string" || !value.value.trim()) return null;
  return value.value.trim();
}

function propertyValue(
  binding: Record<string, unknown>,
  property: ClassificationProperty,
): { label: string; valueId: string | null } | null {
  const label = bindingValue(binding[`${property}Label`]);
  if (!label) return null;
  const rawValueId = bindingValue(binding[property]);
  const entityMatch = rawValueId?.match(/\/entity\/(Q\d+)$/i);
  return {
    label,
    valueId: entityMatch?.[1].toUpperCase() ?? rawValueId,
  };
}

function parseSparqlResponse(payload: unknown, expectedImdbId: string): WikidataItem {
  if (!isRecord(payload)) {
    throw new WikidataError("Wikidata returned a malformed SPARQL response", "malformed");
  }
  const response = payload as SparqlResponse;
  if (!isRecord(response.results) || !Array.isArray(response.results.bindings)) {
    throw new WikidataError("Wikidata returned no SPARQL bindings", "malformed");
  }

  const items = new Map<string, WikidataItem>();
  for (const rawBinding of response.results.bindings) {
    if (!isRecord(rawBinding)) {
      throw new WikidataError("Wikidata returned a malformed SPARQL binding", "malformed");
    }
    const itemUrl = bindingValue(rawBinding.item);
    const imdbId = bindingValue(rawBinding.imdbId);
    if (!itemUrl || !imdbId) continue;

    // Never accept a title merely because its name looks right. The only
    // identity proof for this adapter is an exact IMDb ID returned by Wikidata.
    if (normalizeImdbId(imdbId) !== expectedImdbId) continue;
    const match = /^https?:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/i.exec(itemUrl)
      ?? /^https?:\/\/www\.wikidata\.org\/wiki\/(Q\d+)$/i.exec(itemUrl);
    if (!match) {
      throw new WikidataError("Wikidata returned an invalid entity URL", "malformed");
    }

    const itemId = match[1].toUpperCase();
    const item = items.get(itemId) ?? {
      itemId,
      itemUrl: `${WIKIDATA_SOURCE_URL}/wiki/${itemId}`,
      imdbId,
      classifications: [],
    };
    for (const property of Object.keys(WIKIDATA_CLASSIFICATION_PROPERTIES) as ClassificationProperty[]) {
      const value = propertyValue(rawBinding, property);
      if (!value) continue;
      if (!item.classifications.some(
        (existing) =>
          existing.property === property &&
          existing.label === value.label &&
          existing.valueId === value.valueId,
      )) {
        item.classifications.push({
          property,
          propertyName: WIKIDATA_CLASSIFICATION_PROPERTIES[property],
          label: value.label,
          valueId: value.valueId,
        });
      }
    }
    items.set(itemId, item);
  }

  if (items.size === 0) {
    throw new WikidataError(`No Wikidata item matched IMDb ID ${expectedImdbId}`, "missing_mapping");
  }
  if (items.size > 1) {
    throw new WikidataError(
      `Ambiguous Wikidata entity match for IMDb ID ${expectedImdbId}`,
      "ambiguous_mapping",
    );
  }
  return [...items.values()][0];
}

function buildQuery(imdbId: string): string {
  // imdbId has already been validated to the strict tt + digits form, so it
  // cannot inject SPARQL syntax. Querying by VALUES also prevents a fuzzy
  // title/name match from entering this integration.
  return `
    SELECT ?item ?imdbId
      ?P1657 ?P1657Label
      ?P1981 ?P1981Label
      ?P2629 ?P2629Label
      ?P2758 ?P2758Label
      ?P3156 ?P3156Label
      ?P3216 ?P3216Label
    WHERE {
      VALUES ?imdbId { "${imdbId}" }
      ?item wdt:P345 ?imdbId .
      OPTIONAL { ?item wdt:P1657 ?P1657 . }
      OPTIONAL { ?item wdt:P1981 ?P1981 . }
      OPTIONAL { ?item wdt:P2629 ?P2629 . }
      OPTIONAL { ?item wdt:P2758 ?P2758 . }
      OPTIONAL { ?item wdt:P3156 ?P3156 . }
      OPTIONAL { ?item wdt:P3216 ?P3216 . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
  `;
}

function shouldRetry(error: WikidataError): boolean {
  return error.code === "rate_limited" ||
    (error.httpStatus != null && error.httpStatus >= 500);
}

export function createWikidataClient(options: WikidataClientOptions = {}) {
  const endpoint = normalizeEndpoint(options.endpoint ?? process.env.WIKIDATA_SPARQL_ENDPOINT ?? WIKIDATA_ENDPOINT);
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = Math.max(1, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const retries = Math.min(Math.max(Math.trunc(options.retries ?? DEFAULT_RETRIES), 0), 3);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);

  async function request(imdbId: string): Promise<WikidataItem> {
    const normalizedImdbId = assertImdbId(imdbId);
    const url = `${endpoint}?query=${encodeURIComponent(buildQuery(normalizedImdbId))}&format=json`;
    let lastError: WikidataError | undefined;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetchFn(url, {
            method: "GET",
            headers: {
              Accept: "application/sparql-results+json, application/json",
              "User-Agent": "WatchTime Wikidata sync",
            },
            signal: controller.signal,
          });
        } catch (error) {
          throw new WikidataError(
            error instanceof Error && error.name === "AbortError"
              ? "Wikidata SPARQL request timed out"
              : "Wikidata SPARQL endpoint is unavailable",
            "unavailable",
          );
        }
        if (response.status === 429) {
          throw new WikidataError("Wikidata SPARQL rate limit was exceeded", "rate_limited", response.status);
        }
        if (response.status === 401 || response.status === 403) {
          throw new WikidataError("Wikidata SPARQL request was not authorized", "authentication", response.status);
        }
        if (!response.ok) {
          throw new WikidataError(
            `Wikidata SPARQL returned HTTP ${response.status}`,
            "unavailable",
            response.status,
          );
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new WikidataError("Wikidata SPARQL returned invalid JSON", "malformed", response.status);
        }
        return parseSparqlResponse(payload, normalizedImdbId);
      } catch (caught) {
        const error = caught instanceof WikidataError
          ? caught
          : new WikidataError("Unexpected Wikidata SPARQL failure", "unavailable");
        lastError = error;
        if (attempt >= retries || !shouldRetry(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new WikidataError("Wikidata SPARQL request failed", "unavailable");
  }

  return { queryByImdbId: request };
}

export type CatalogTitleForWikidata = Pick<
  typeof titlesTable.$inferSelect,
  "id" | "name" | "imdbId"
>;

export type WikidataRefreshResult = {
  ok: true;
  titleId: number;
  titleName: string;
  externalId: string;
  classifications: number;
} | {
  ok: false;
  titleId: number;
  titleName: string;
  status: "provider_unavailable" | "missing" | "error";
  error: string;
};

function errorStatus(error: WikidataError): "provider_unavailable" | "missing" | "error" {
  if (error.code === "missing_mapping") return "missing";
  if (error.code === "authentication") return "provider_unavailable";
  return "error";
}

function errorHealthStatus(error: WikidataError) {
  if (error.code === "authentication") return "provider_unavailable" as const;
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
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('watchtime:wikidata-sync'))`);
    const [counts] = await tx
      .select({
        mapped: sql<number>`count(*) filter (where ${providerMappingsTable.status} = 'mapped')::int`,
        missing: sql<number>`count(*) filter (where ${providerMappingsTable.status} = 'missing')::int`,
      })
      .from(providerMappingsTable)
      .where(eq(providerMappingsTable.provider, WIKIDATA_PROVIDER));
    const [existing] = await tx
      .select()
      .from(integrationHealthTable)
      .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
    const healthValues = {
      status: values.status,
      lastSyncAt: values.lastSyncAt,
      ...(values.lastSuccessAt ? { lastSuccessAt: values.lastSuccessAt } : {}),
      lastError: values.lastError,
      // This is the outcome of this provider operation, not a fabricated
      // historical average. A later batch result updates it again.
      successRatePercent: values.status === "healthy" ? 100 : 0,
      mappedTitles: counts?.mapped ?? 0,
      missingMappings: counts?.missing ?? 0,
    };
    if (existing) {
      await tx.update(integrationHealthTable).set(healthValues).where(eq(integrationHealthTable.id, existing.id));
    } else {
      await tx.insert(integrationHealthTable).values({
        provider: WIKIDATA_PROVIDER,
        ...healthValues,
      });
    }
  });
}

async function updateMappingStatus(
  titleId: number,
  status: "missing" | "error",
) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('watchtime:wikidata-sync'))`);
    const [currentMapping] = await tx
      .select()
      .from(providerMappingsTable)
      .where(and(
        eq(providerMappingsTable.titleId, titleId),
        eq(providerMappingsTable.provider, WIKIDATA_PROVIDER),
      ))
      .limit(1);
    if (!currentMapping) {
      await tx.insert(providerMappingsTable).values({
        titleId,
        provider: WIKIDATA_PROVIDER,
        externalId: null,
        status,
        lastRefreshedAt: null,
      });
      return;
    }
    // A provider outage or an ambiguous response must never destroy a verified
    // mapping that can still be used by the rest of the application.
    if (currentMapping.status === "mapped" && currentMapping.externalId) return;
    await tx.update(providerMappingsTable)
      .set({ status })
      .where(eq(providerMappingsTable.id, currentMapping.id));
  });
}

function toSafetyItems(item: WikidataItem) {
  return item.classifications.map((classification) => ({
    category: classification.propertyName,
    label: classification.label,
    // Wikidata classifications are labels, not vote/score measurements.
    score: null,
    maxScore: null,
    description: `${WIKIDATA_CLASSIFICATION_REGIONS[classification.property]} rating · Wikidata property ${classification.property}`,
  }));
}

export async function refreshWikidataTitle(
  titleId: number,
  client = createWikidataClient(),
): Promise<WikidataRefreshResult> {
  const [title] = await db
    .select({ id: titlesTable.id, name: titlesTable.name, imdbId: titlesTable.imdbId })
    .from(titlesTable)
    .where(eq(titlesTable.id, titleId));
  if (!title) return { ok: false, titleId, titleName: "", status: "missing", error: "Title not found" };

  const now = new Date();

  if (!title.imdbId || !IMDB_ID_PATTERN.test(normalizeImdbId(title.imdbId))) {
    const error = new WikidataError("Title has no valid IMDb ID for Wikidata matching", "missing_mapping");
    await updateMappingStatus(titleId, "missing");
    await updateIntegrationHealth({
      status: "degraded",
      lastSyncAt: now,
      lastError: error.message,
    });
    return { ok: false, titleId, titleName: title.name, status: "missing", error: error.message };
  }

  try {
    const item = await client.queryByImdbId(title.imdbId);
    const items = toSafetyItems(item);
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('watchtime:wikidata-sync'))`);
      const [lockedMapping] = await tx
        .select()
        .from(providerMappingsTable)
        .where(and(
          eq(providerMappingsTable.titleId, titleId),
          eq(providerMappingsTable.provider, WIKIDATA_PROVIDER),
        ))
        .limit(1);
      if (lockedMapping) {
        await tx.update(providerMappingsTable)
          .set({ externalId: item.itemId, status: "mapped", lastRefreshedAt: now })
          .where(eq(providerMappingsTable.id, lockedMapping.id));
      } else {
        await tx.insert(providerMappingsTable).values({
          titleId,
          provider: WIKIDATA_PROVIDER,
          externalId: item.itemId,
          status: "mapped",
          lastRefreshedAt: now,
        });
      }

      // A title can have multiple independent safety sources. Only replace
      // Wikidata's own row, and retain it when the provider currently exposes
      // no classification labels. Community and richer provider rows are
      // never touched.
      if (items.length > 0) {
        const [existingRecord] = await tx.select()
          .from(safetyRecordsTable)
          .where(and(
            eq(safetyRecordsTable.titleId, titleId),
            eq(safetyRecordsTable.sourceName, WIKIDATA_PROVIDER),
            isNull(safetyRecordsTable.seasonNumber),
            isNull(safetyRecordsTable.episodeNumber),
          ))
          .limit(1);
        const values = {
          titleId,
          sourceName: WIKIDATA_PROVIDER,
          tier: 2,
          isCommunity: false,
          url: item.itemUrl,
          status: "available" as const,
          items,
          updatedAt: now,
        };
        if (existingRecord) {
          await tx.update(safetyRecordsTable).set(values).where(eq(safetyRecordsTable.id, existingRecord.id));
        } else {
          await tx.insert(safetyRecordsTable).values(values);
        }
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
      externalId: item.itemId,
      classifications: items.length,
    };
  } catch (caught) {
    const error = caught instanceof WikidataError
      ? caught
      : new WikidataError("Unexpected Wikidata refresh failure", "unavailable");
    if (error.code === "missing_mapping" || error.code === "ambiguous_mapping") {
      await updateMappingStatus(titleId, error.code === "missing_mapping" ? "missing" : "error");
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

export async function refreshWikidataBatch(options: {
  limit: number;
  offset: number;
  client?: ReturnType<typeof createWikidataClient>;
  delayMs?: number;
}) {
  const limit = Math.min(Math.max(Math.trunc(options.limit), 1), MAX_BATCH_SIZE);
  const offset = Math.max(Math.trunc(options.offset), 0);
  const titles = await db.select({
    id: titlesTable.id,
    name: titlesTable.name,
  })
    .from(titlesTable)
    .orderBy(titlesTable.id)
    .limit(limit)
    .offset(offset);
  const results: WikidataRefreshResult[] = [];
  for (const [index, title] of titles.entries()) {
    if (index > 0 && options.delayMs !== 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 250));
    }
    results.push(await refreshWikidataTitle(title.id, options.client));
  }
  return { offset, limit, processed: results.length, results };
}