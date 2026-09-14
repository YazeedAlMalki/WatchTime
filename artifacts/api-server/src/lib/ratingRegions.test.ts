import { describe, expect, it } from "vitest";
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