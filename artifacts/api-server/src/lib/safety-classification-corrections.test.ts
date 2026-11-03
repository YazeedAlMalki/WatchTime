import { describe, expect, it } from "vitest";
import {
  applySafetyClassificationCorrections,
  recoverLegacySafetyClassificationCorrection,
} from "./safety-classification-corrections";

describe("safety classification corrections", () => {
  it("recovers a prior admin decision from its audit entry for the next provider refresh", () => {
    const savedItems = [{
      category: "BBFC",
      label: "12A",
      score: null,
      maxScore: null,
      description: "Source rating",
    }];
    const recovered = recoverLegacySafetyClassificationCorrection(savedItems, [{
      adminId: "legacy-admin",
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      details: {
        classificationIndex: 0,
        previousCategory: "UNSUPPORTED_SYSTEM",
        category: "BBFC",
      },
    }]);

    expect(recovered?.classificationCorrections).toEqual([{
      sourceIndex: 0,
      sourceCategory: "UNSUPPORTED_SYSTEM",
      sourceLabel: "12A",
      sourceOccurrence: 0,
      category: "BBFC",
      adminId: "legacy-admin",
      correctedAt: "2026-10-01T00:00:00.000Z",
    }]);
    expect(applySafetyClassificationCorrections([{
      ...savedItems[0],
      category: "UNSUPPORTED_SYSTEM",
      description: "Updated provider details",
    }], recovered?.classificationCorrections)).toEqual([{
      ...savedItems[0],
      category: "BBFC",
      description: "Updated provider details",
    }]);
  });

  it("does not restore an audit correction when the saved item no longer matches it", () => {
    expect(recoverLegacySafetyClassificationCorrection([{
      category: "UNSUPPORTED_SYSTEM",
      label: "12A",
      score: null,
      maxScore: null,
      description: "Provider changed the value",
    }], [{
      adminId: "legacy-admin",
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      details: {
        classificationIndex: 0,
        previousCategory: "UNSUPPORTED_SYSTEM",
        category: "BBFC",
      },
    }, {
      adminId: "older-admin",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      details: {
        classificationIndex: 0,
        previousCategory: "UNSUPPORTED_SYSTEM",
        category: "BBFC",
      },
    }])).toBeNull();
  });

  it("recovers every active correction in a provider record", () => {
    const recovered = recoverLegacySafetyClassificationCorrection([
      { category: "BBFC", label: "12A", score: null, maxScore: null, description: null },
      { category: "FSK", label: "16", score: null, maxScore: null, description: null },
    ], [
      {
        adminId: "admin-two",
        createdAt: new Date("2026-10-02T00:00:00.000Z"),
        details: {
          classificationIndex: 1,
          previousCategory: "UNKNOWN_FSK",
          category: "FSK",
        },
      },
      {
        adminId: "admin-one",
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        details: {
          classificationIndex: 0,
          previousCategory: "UNKNOWN_UK",
          category: "BBFC",
        },
      },
    ]);

    expect(recovered?.classificationCorrections.map((correction) => correction.adminId)).toEqual([
      "admin-one",
      "admin-two",
    ]);
    expect(recovered?.classificationCorrections.map((correction) => correction.sourceCategory)).toEqual([
      "UNKNOWN_UK",
      "UNKNOWN_FSK",
    ]);
  });
});
