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
      recordId: null,
      lastRefreshedAt: null,
      sourceUrl: null,
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

  it("prefers the newest official classification regardless of record order", () => {
    const older = {
      ...records[0],
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      items: [{ category: "MPAA", label: "PG" }],
    };
    const newer = {
      ...records[0],
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      items: [{ category: "MPAA", label: "PG-13" }],
    };

    expect(resolvePreferredRating([older, newer], "US")?.label).toBe("PG-13");
    expect(resolvePreferredRating([newer, older], "US")?.label).toBe("PG-13");
  });

  it("uses stable content when duplicate official records have equal freshness", () => {
    const timestamp = new Date("2026-02-01T00:00:00.000Z");
    const first = {
      ...records[0],
      updatedAt: timestamp,
      items: [{ category: "MPAA", label: "PG" }],
    };
    const second = {
      ...records[0],
      updatedAt: timestamp,
      items: [{ category: "MPAA", label: "PG-13" }],
    };

    expect(resolvePreferredRating([first, second], "US")?.label).toBe("PG");
    expect(resolvePreferredRating([second, first], "US")?.label).toBe("PG");
  });

  it("uses stable content when refresh timestamps are missing", () => {
    const candidates = [
      {
        ...records[0],
        id: 1,
        tier: 1,
        updatedAt: null,
        url: "https://example.test/z",
        items: [{ category: "MPAA", label: "PG-13" }],
      },
      {
        ...records[0],
        id: 2,
        tier: 1,
        updatedAt: undefined,
        url: "https://example.test/a",
        items: [{ category: "MPAA", label: "PG" }],
      },
    ];

    expect(resolvePreferredRating(candidates, "US")?.label).toBe("PG");
    expect(resolvePreferredRating([...candidates].reverse(), "US")?.label).toBe("PG");
  });

  it("uses stable content when refresh timestamps are invalid", () => {
    const candidates = [
      {
        ...records[0],
        id: 1,
        tier: 1,
        updatedAt: "not-a-date",
        url: "https://example.test/z",
        items: [{ category: "MPAA", label: "PG-13" }],
      },
      {
        ...records[0],
        id: 2,
        tier: 1,
        updatedAt: "2026-not-a-date",
        url: "https://example.test/a",
        items: [{ category: "MPAA", label: "PG" }],
      },
    ];

    expect(resolvePreferredRating(candidates, "US")?.label).toBe("PG");
    expect(resolvePreferredRating([...candidates].reverse(), "US")?.label).toBe("PG");
  });

  it("uses a stable empty value when source URLs are missing", () => {
    const timestamp = new Date("2026-02-01T00:00:00.000Z");
    const candidates = [
      {
        ...records[0],
        id: 1,
        tier: 1,
        updatedAt: timestamp,
        items: [{ category: "MPAA", label: "PG" }],
      },
      {
        ...records[0],
        id: 2,
        tier: 1,
        updatedAt: timestamp,
        url: "https://example.test/source",
        items: [{ category: "MPAA", label: "PG" }],
      },
    ];

    expect(resolvePreferredRating(candidates, "US")).toMatchObject({
      label: "PG",
      recordId: 1,
      sourceUrl: null,
    });
    expect(resolvePreferredRating([...candidates].reverse(), "US")).toMatchObject({
      label: "PG",
      recordId: 1,
      sourceUrl: null,
    });
  });

  it("uses tier, label, and source URL as stable tie-breakers", () => {
    const timestamp = new Date("2026-02-01T00:00:00.000Z");
    const candidates = [
      {
        ...records[0],
        id: 1,
        tier: 2,
        updatedAt: timestamp,
        url: "https://example.test/a",
        items: [{ category: "MPAA", label: "AAA" }],
      },
      {
        ...records[0],
        id: 2,
        tier: 1,
        updatedAt: timestamp,
        url: "https://example.test/z",
        items: [{ category: "MPAA", label: "PG-13" }],
      },
      {
        ...records[0],
        id: 3,
        tier: 1,
        updatedAt: timestamp,
        url: "https://example.test/z",
        items: [{ category: "MPAA", label: "PG" }],
      },
      {
        ...records[0],
        id: 4,
        tier: 1,
        updatedAt: timestamp,
        url: "https://example.test/a",
        items: [{ category: "MPAA", label: "PG" }],
      },
    ];

    const expected = {
      region: "US",
      countryName: "United States",
      system: "MPAA",
      label: "PG",
      sourceName: "Wikidata",
      recordId: 4,
      lastRefreshedAt: timestamp.toISOString(),
      sourceUrl: "https://example.test/a",
    };
    expect(resolvePreferredRating(candidates, "US")).toEqual(expected);
    expect(resolvePreferredRating([...candidates].reverse(), "US")).toEqual(expected);
  });
});