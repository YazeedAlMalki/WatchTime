import type {
  AdminContentRefreshBatchHistoryEntry,
  AdminContentRefreshResult,
} from "@workspace/api-client-react";

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  const safeText = /^[\u0000-\u0020]*[=+\-@]/.test(text)
    ? `'${text}`
    : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

function resultOutcome(result: AdminContentRefreshResult): string {
  if (result.ok) {
    return result.dataStatus === "superseded"
      ? "Superseded (newer data retained)"
      : "Mapped";
  }
  if (result.status === "missing") return "Missing";
  if (result.status === "provider_unavailable") return "Provider unavailable";
  return "Error";
}

export function buildSafetySyncReportCsv(
  run: AdminContentRefreshBatchHistoryEntry,
): string {
  const rows: unknown[][] = [
    ["Refresh Run Summary"],
    ["Run ID", run.id],
    ["Provider", run.provider === "wikidata" ? "Wikidata" : "Does the Dog Die"],
    ["Overall outcome", run.status],
    ["Completed at", run.completedAt ?? "Unavailable"],
    ["Batch limit", run.limit],
    ["Starting offset", run.offset],
    ["Titles processed", run.processed],
    ["Mapped", run.mapped],
    ["Superseded", run.superseded],
    ["Missing", run.missing],
    ["Errors", run.errors],
    ["Next resume offset", run.nextOffset],
    ["Run-level error", run.error ?? ""],
    [],
    ["Title Results"],
    [
      "Title ID",
      "Title",
      "External ID",
      "Outcome",
      "Provider status",
      "Data status",
      "Items",
      "Classifications",
      "Provider error",
    ],
    ...run.results.map((result) => [
      result.titleId,
      result.titleName,
      result.externalId ?? "",
      resultOutcome(result),
      result.status ?? "",
      result.dataStatus ?? "",
      result.items ?? "",
      result.classifications ?? "",
      result.error ?? "",
    ]),
  ];
  return `\uFEFF${rows.map(csvRow).join("\r\n")}\r\n`;
}
