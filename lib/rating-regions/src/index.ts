export const RATING_REGIONS = [
  { code: "US", countryName: "United States", system: "MPAA" },
  { code: "GB", countryName: "United Kingdom", system: "BBFC" },
  { code: "DE", countryName: "Germany", system: "FSK" },
  { code: "FR", countryName: "France", system: "CNC" },
  { code: "AU", countryName: "Australia", system: "Australian Classification" },
  { code: "BR", countryName: "Brazil", system: "ClassInd" },
] as const;

export type RatingRegion = (typeof RATING_REGIONS)[number]["code"];

export const RATING_REGIONS_BY_CODE: Record<
  RatingRegion,
  (typeof RATING_REGIONS)[number]
> = Object.fromEntries(
  RATING_REGIONS.map((region) => [region.code, region]),
) as Record<RatingRegion, (typeof RATING_REGIONS)[number]>;