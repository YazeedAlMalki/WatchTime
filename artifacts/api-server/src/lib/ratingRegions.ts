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

export function resolvePreferredRating(records: RatingRecord[], region: RatingRegion) {
  const preferredSystem = RATING_REGIONS_BY_CODE[region];
  const matches = records
    .filter(
      (record) =>
        record.status === "available" &&
        !record.isCommunity &&
        record.sourceName === "Wikidata",
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
      // insertion/query order. The label and source URL are stable row content.
      const leftKey = `${left.item.label}\u0000${left.record.url ?? ""}`;
      const rightKey = `${right.item.label}\u0000${right.record.url ?? ""}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  const match = matches[0];

  return match ? {
    region,
    countryName: preferredSystem.countryName,
    system: preferredSystem.system,
    label: match.item.label,
    sourceName: match.record.sourceName,
    recordId: match.record.id ?? null,
    lastRefreshedAt: match.record.updatedAt instanceof Date
      ? match.record.updatedAt.toISOString()
      : match.record.updatedAt ?? null,
    sourceUrl: match.record.url ?? null,
  } : null;
}