import { RATING_REGIONS, type RatingRegion } from "@workspace/rating-regions";
import type { ListAdminContentAliasesOwnership } from "@workspace/api-client-react";

export type AliasOwnershipFilter = ListAdminContentAliasesOwnership | "all";

export const ADMIN_TABS = [
  "dashboard",
  "moderation",
  "reports",
  "feedback",
  "analytics",
  "content",
  "integrations",
  "audit-log",
] as const;

export type AdminTab = (typeof ADMIN_TABS)[number];

export function readAdminContentUrl(search: string): {
  tab: AdminTab;
  region: RatingRegion;
  q: string;
  ownership: AliasOwnershipFilter;
  malformedRefreshTimestamp: boolean;
  malformedRefreshTimestampProvider: string;
  contentOffset: number;
  aliasId: number | null;
  aliasPage: number;
  aliasCursor: string | null;
} {
  const params = new URLSearchParams(search);
  const rawRegion = params.get("region");
  const region =
    RATING_REGIONS.find(({ code }) => code === rawRegion)?.code ?? "US";
  const rawTab = params.get("tab");
  const tab = ADMIN_TABS.find((value) => value === rawTab)
    ?? (params.has("region") || params.has("q") || params.has("ownership") || params.has("malformedRefreshTimestamp") || params.has("offset") || params.has("aliasId") ? "content" : "dashboard");
  const rawOwnership = params.get("ownership");
  const ownership = tab === "content" && (rawOwnership === "provider" || rawOwnership === "editorial")
    ? rawOwnership
    : "all";
  const rawAliasId = params.get("aliasId");
  const aliasId = rawAliasId !== null && /^[1-9]\d*$/.test(rawAliasId) && Number.isSafeInteger(Number(rawAliasId))
    ? Number(rawAliasId)
    : null;
  const rawAliasCursor = params.get("aliasCursor");
  const rawAliasPage = params.get("aliasPage");
  const parsedAliasPage = rawAliasPage === null
    ? 1
    : /^\d+$/.test(rawAliasPage) &&
        Number.isSafeInteger(Number(rawAliasPage)) &&
        Number(rawAliasPage) >= 1
      ? Number(rawAliasPage)
      : null;
  const aliasCursor = rawAliasCursor &&
      rawAliasCursor.length <= 4096 &&
      parsedAliasPage !== null
    ? rawAliasCursor
    : null;
  const malformedRefreshTimestamp = tab === "content" && params.get("malformedRefreshTimestamp") === "true";
  const malformedRefreshTimestampProvider =
    malformedRefreshTimestamp
      ? params.get("malformedRefreshTimestampProvider")?.trim() ?? ""
      : "";
  const rawOffset = params.get("offset");
  const parsedOffset = rawOffset !== null && /^(0|[1-9]\d*)$/.test(rawOffset) &&
      Number.isSafeInteger(Number(rawOffset))
    ? Number(rawOffset)
    : 0;
  return {
    tab,
    region,
    q: tab === "content" ? (params.get("q") ?? "") : "",
    ownership,
    malformedRefreshTimestamp,
    malformedRefreshTimestampProvider,
    contentOffset: malformedRefreshTimestamp ? parsedOffset : 0,
    aliasId: tab === "content" ? aliasId : null,
    aliasPage: tab === "content" && aliasCursor && parsedAliasPage !== null
      ? parsedAliasPage
      : 1,
    aliasCursor: tab === "content" ? aliasCursor : null,
  };
}

export function adminContentUrl(
  search: string,
  tab: AdminTab,
  region: RatingRegion,
  q?: string,
  ownership?: AliasOwnershipFilter,
  aliasId?: number,
  malformedRefreshTimestamp?: boolean,
  contentOffset?: number,
  malformedRefreshTimestampProvider?: string,
  aliasPage?: number,
  aliasCursor?: string | null,
): string {
  const params = new URLSearchParams(search);
  const current = readAdminContentUrl(search);
  params.set("tab", tab);
  params.delete("aliasId");
  if (tab === "content") {
    params.set("region", region);
    const term = q ?? params.get("q") ?? "";
    if (term) params.set("q", term);
    else params.delete("q");
    const selectedOwnership = ownership ?? readAdminContentUrl(search).ownership;
    if (selectedOwnership !== "all") params.set("ownership", selectedOwnership);
    else params.delete("ownership");
    if (term !== current.q || selectedOwnership !== current.ownership) {
      params.delete("aliasCursor");
      params.delete("aliasPage");
    }
    if (aliasCursor !== undefined) {
      if (aliasCursor && aliasPage != null && aliasPage >= 1) {
        params.set("aliasCursor", aliasCursor);
        if (aliasPage > 1) params.set("aliasPage", String(aliasPage));
        else params.delete("aliasPage");
      } else {
        params.delete("aliasCursor");
        params.delete("aliasPage");
      }
    }
    if (aliasId !== undefined) params.set("aliasId", String(aliasId));
    const selectedMalformedRefreshTimestamp =
      malformedRefreshTimestamp ?? readAdminContentUrl(search).malformedRefreshTimestamp;
    if (selectedMalformedRefreshTimestamp) params.set("malformedRefreshTimestamp", "true");
    else params.delete("malformedRefreshTimestamp");
    const selectedContentOffset = contentOffset ?? readAdminContentUrl(search).contentOffset;
    if (selectedMalformedRefreshTimestamp && selectedContentOffset > 0) {
      params.set("offset", String(selectedContentOffset));
    } else {
      params.delete("offset");
    }
    const selectedMalformedProvider = selectedMalformedRefreshTimestamp
      ? malformedRefreshTimestampProvider ??
        readAdminContentUrl(search).malformedRefreshTimestampProvider
      : "";
    if (selectedMalformedProvider) {
      params.set("malformedRefreshTimestampProvider", selectedMalformedProvider);
    } else {
      params.delete("malformedRefreshTimestampProvider");
    }
  } else {
    params.delete("q");
    params.delete("ownership");
    params.delete("malformedRefreshTimestamp");
    params.delete("malformedRefreshTimestampProvider");
    params.delete("offset");
    params.delete("aliasCursor");
    params.delete("aliasPage");
  }
  return `/admin?${params.toString()}`;
}