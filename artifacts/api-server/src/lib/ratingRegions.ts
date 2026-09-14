import {
  RATING_REGIONS_BY_CODE,
  type RatingRegion,
} from "@workspace/rating-regions";

export type { RatingRegion } from "@workspace/rating-regions";

type RatingRecord = {
  sourceName: string;
  isCommunity: boolean;
  status: string;
  items: Array<{ category: string; label: string }>;
};

export function resolvePreferredRating(records: RatingRecord[], region: RatingRegion) {
  const preferredSystem = RATING_REGIONS_BY_CODE[region];
  const match = records
    .filter(
      (record) =>
        record.status === "available" &&
        !record.isCommunity &&
        record.sourceName === "Wikidata",
    )
    .flatMap((record) => record.items.map((item) => ({ record, item })))
    .find(({ item }) => item.category === preferredSystem.system);

  return match ? {
    region,
    countryName: preferredSystem.countryName,
    system: preferredSystem.system,
    label: match.item.label,
    sourceName: match.record.sourceName,
  } : null;
}