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
} {
  const params = new URLSearchParams(search);
  const rawRegion = params.get("region");
  const region =
    RATING_REGIONS.find(({ code }) => code === rawRegion)?.code ?? "US";
  const rawTab = params.get("tab");
  const tab = ADMIN_TABS.find((value) => value === rawTab)
    ?? (params.has("region") || params.has("q") || params.has("ownership") ? "content" : "dashboard");
  const rawOwnership = params.get("ownership");
  const ownership = tab === "content" && (rawOwnership === "provider" || rawOwnership === "editorial")
    ? rawOwnership
    : "all";
  return { tab, region, q: tab === "content" ? (params.get("q") ?? "") : "", ownership };
}

export function adminContentUrl(
  search: string,
  tab: AdminTab,
  region: RatingRegion,
  q?: string,
  ownership?: AliasOwnershipFilter,
): string {
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  if (tab === "content") {
    params.set("region", region);
    const term = q ?? params.get("q") ?? "";
    if (term) params.set("q", term);
    else params.delete("q");
    const selectedOwnership = ownership ?? readAdminContentUrl(search).ownership;
    if (selectedOwnership !== "all") params.set("ownership", selectedOwnership);
    else params.delete("ownership");
  } else {
    params.delete("q");
    params.delete("ownership");
  }
  return `/admin?${params.toString()}`;
}