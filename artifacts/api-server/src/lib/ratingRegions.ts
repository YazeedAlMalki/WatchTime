import {
  RATING_REGIONS_BY_CODE,
  type RatingRegion,
} from "@workspace/rating-regions";

export type { RatingRegion } from "@workspace/rating-regions";

type RatingRecord = {
  id?: number | null;
  tier?: number | null;
  updatedAt?: Date | string | null;
  url?: string | null;
  sourceName: string;
  isCommunity: boolean;
  status: string;
  items: Array<{ category: string; label: string }>;
};

function timestampValue(value: Date | string | null | undefined): number {
  if (value == null) return Number.NEGATIVE_INFINITY;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function compareFreshness(left: Date | string | null | undefined, right: Date | string | null | undefined): number {
  const leftTimestamp = timestampValue(left);
  const rightTimestamp = timestampValue(right);
  if (leftTimestamp === rightTimestamp) return 0;
  if (rightTimestamp === Number.NEGATIVE_INFINITY) return -1;
  if (leftTimestamp === Number.NEGATIVE_INFINITY) return 1;
  return rightTimestamp - leftTimestamp;
}

function serializeTimestamp(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  return Number.isFinite(Date.parse(value)) ? value : null;
}

export function hasMalformedTimestamp(value: Date | string | null | undefined): boolean {
  return value != null && timestampValue(value) === Number.NEGATIVE_INFINITY;
}

export function hasLatestRatingLabelConflict(
  records: RatingRecord[],
  region: RatingRegion,
  provider = "Wikidata",
): boolean {
  const preferredSystem = RATING_REGIONS_BY_CODE[region];
  const candidates = records
    .filter(
      (record) =>
        record.status === "available" &&
        !record.isCommunity &&
        record.sourceName === provider,
    )
    .flatMap((record) => record.items.map((item) => ({
      record,
      timestamp: timestampValue(record.updatedAt),
      item,
    })))
    .filter(({ timestamp, item }) =>
      Number.isFinite(timestamp) && item.category === preferredSystem.system,
    );

  if (candidates.length < 2) return false;
  const newestTimestamp = Math.max(...candidates.map(({ timestamp }) => timestamp));
  const newestRecords = new Map<RatingRecord, Set<string>>();
  for (const { record, timestamp, item } of candidates) {
    if (timestamp !== newestTimestamp) continue;
    const labels = newestRecords.get(record) ?? new Set<string>();
    labels.add(item.label);
    newestRecords.set(record, labels);
  }
  if (newestRecords.size < 2) return false;
  const newestLabels = new Set([...newestRecords.values()].flatMap((labels) => [...labels]));
  return newestLabels.size > 1;
}

export function resolvePreferredRating(
  records: RatingRecord[],
  region: RatingRegion,
  provider = "Wikidata",
) {
  const preferredSystem = RATING_REGIONS_BY_CODE[region];
  const matches = records
    .filter(
      (record) =>
        record.status === "available" &&
        !record.isCommunity &&
        record.sourceName === provider,
    )
    .flatMap((record) => record.items.map((item) => ({ record, item })))
    .filter(({ item }) => item.category === preferredSystem.system)
    .sort((left, right) => {
      // Refreshes update this timestamp, so the newest official classification
      // wins instead of whichever row the database happens to return first.
      const freshness = compareFreshness(left.record.updatedAt, right.record.updatedAt);
      if (freshness !== 0) return freshness;

      // Lower tiers are higher-priority sources. This is normally equal for
      // Wikidata, but makes legacy duplicate rows resolve explicitly.
      const priority = (left.record.tier ?? Number.MAX_SAFE_INTEGER) -
        (right.record.tier ?? Number.MAX_SAFE_INTEGER);
      if (priority !== 0) return priority;

      // Equal timestamps and tiers still need an order that is independent of
      // insertion/query order. Stable row content comes first, then the record
      // ID distinguishes otherwise identical rows.
      const leftKey = `${left.item.label}\u0000${left.record.url ?? ""}`;
      const rightKey = `${right.item.label}\u0000${right.record.url ?? ""}`;
      if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
      const leftId = left.record.id ?? Number.MAX_SAFE_INTEGER;
      const rightId = right.record.id ?? Number.MAX_SAFE_INTEGER;
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
  const match = matches[0];

  return match ? {
    region,
    countryName: preferredSystem.countryName,
    system: preferredSystem.system,
    label: match.item.label,
    sourceName: match.record.sourceName,
    recordId: match.record.id ?? null,
    lastRefreshedAt: serializeTimestamp(match.record.updatedAt),
    sourceUrl: match.record.url ?? null,
  } : null;
}