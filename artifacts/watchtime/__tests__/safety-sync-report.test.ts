import { describe, expect, it } from "vitest";
import type { AdminContentRefreshBatchHistoryEntry } from "@workspace/api-client-react";
import { buildSafetySyncReportCsv } from "../src/lib/safety-sync-report";

const run: AdminContentRefreshBatchHistoryEntry = {
  id: 42,
  provider: "wikidata",
  status: "failed",
  limit: 10,
  offset: 5,
  processed: 2,
  mapped: 1,
  superseded: 0,
  missing: 0,
  errors: 1,
  nextOffset: 7,
  completedAt: "2026-10-20T12:34:56.000Z",
  error: "One title failed",
  results: [
    {
      ok: true,
      titleId: 11,
      titleName: "Mapped title",
      externalId: "Q11",
      dataStatus: "saved",
      items: 4,
      classifications: 3,
    },
    {
      ok: false,
      titleId: 12,
      titleName: 'A "quoted" title',
      status: "error",
      error: '=HYPERLINK("https://example.invalid","provider error")',
    },
  ],
};

describe("buildSafetySyncReportCsv", () => {
  it("includes labeled run summary and all title outcomes and errors", () => {
    const csv = buildSafetySyncReportCsv(run);

    expect(csv).toContain('"Refresh Run Summary"');
    expect(csv).toContain('"Run ID","42"');
    expect(csv).toContain('"Provider","Wikidata"');
    expect(csv).toContain('"Overall outcome","failed"');
    expect(csv).toContain('"Next resume offset","7"');
    expect(csv).toContain('"11","Mapped title","Q11","Mapped"');
    expect(csv).toContain('"A ""quoted"" title"');
    expect(csv).toContain('"Error","error"');
  });

  it("quotes CSV values and neutralizes spreadsheet formulas", () => {
    const csv = buildSafetySyncReportCsv({
      ...run,
      error: '=HYPERLINK("https://example.invalid","run error")',
      results: [{
        ok: false,
        titleId: 13,
        titleName: "  =1+1",
        status: "error",
        error: "+SUM(1,2)",
      }],
    });

    expect(csv).toContain(`'=HYPERLINK(""https://example.invalid"",""run error"")`);
    expect(csv).toContain(`"'  =1+1"`);
    expect(csv).toContain(`"'+SUM(1,2)"`);
  });
});
