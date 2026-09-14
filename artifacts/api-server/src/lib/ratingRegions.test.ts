import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RATING_REGIONS } from "@workspace/rating-regions";
import { resolvePreferredRating } from "./ratingRegions";

const records = [{
  sourceName: "Wikidata",
  isCommunity: false,
  status: "available",
  items: [
    { category: "MPAA", label: "PG-13" },
    { category: "BBFC", label: "12A" },
  ],
}];

describe("resolvePreferredRating", () => {
  it("covers every rating region accepted by the API contract", () => {
    const specPath = fileURLToPath(
      new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url),
    );
    const spec = readFileSync(specPath, "utf8");
    const updateSchema = spec.match(
      /UserPreferencesUpdate:[\s\S]*?preferredRatingRegion:\s*\n\s*type: string\s*\n\s*enum: \[([^\]]+)\]/,
    );

    expect(updateSchema, "UserPreferencesUpdate rating-region enum").not.toBeNull();
    const apiRegions = updateSchema![1].split(",").map((region) => region.trim());
    expect(RATING_REGIONS.map((region) => region.code)).toEqual(apiRegions);
  });

  it("returns only the selected country's sourced classification", () => {
    expect(resolvePreferredRating(records, "GB")).toEqual({
      region: "GB",
      countryName: "United Kingdom",
      system: "BBFC",
      label: "12A",
      sourceName: "Wikidata",
    });
  });

  it("does not infer a missing regional rating from another country", () => {
    expect(resolvePreferredRating(records, "DE")).toBeNull();
  });

  it("selects newly supported official systems without inferring missing data", () => {
    const expandedRecords = [{
      sourceName: "Wikidata",
      isCommunity: false,
      status: "available",
      items: [
        { category: "Australian Classification", label: "M" },
        { category: "ClassInd", label: "14" },
      ],
    }];

    expect(resolvePreferredRating(expandedRecords, "AU")).toMatchObject({
      region: "AU",
      countryName: "Australia",
      system: "Australian Classification",
      label: "M",
    });
    expect(resolvePreferredRating(expandedRecords, "BR")).toMatchObject({
      region: "BR",
      countryName: "Brazil",
      system: "ClassInd",
      label: "14",
    });
    expect(resolvePreferredRating([], "AU")).toBeNull();
  });

  it("ignores a colliding free-form community category", () => {
    const communityCollision = {
      sourceName: "WatchTime Community",
      isCommunity: true,
      status: "available",
      items: [{ category: "BBFC", label: "Community guess" }],
    };
    expect(resolvePreferredRating([communityCollision, ...records], "GB")?.label).toBe("12A");
    expect(resolvePreferredRating([communityCollision], "GB")).toBeNull();
  });
});