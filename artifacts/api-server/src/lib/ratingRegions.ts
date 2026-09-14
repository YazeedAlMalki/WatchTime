export const RATING_REGIONS = {
  US: { countryName: "United States", system: "MPAA" },
  GB: { countryName: "United Kingdom", system: "BBFC" },
  DE: { countryName: "Germany", system: "FSK" },
  FR: { countryName: "France", system: "CNC" },
} as const;

export type RatingRegion = keyof typeof RATING_REGIONS;

type RatingRecord = {
  sourceName: string;
  isCommunity: boolean;
  status: string;
  items: Array<{ category: string; label: string }>;
};

export function resolvePreferredRating(records: RatingRecord[], region: RatingRegion) {
  const preferredSystem = RATING_REGIONS[region];
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