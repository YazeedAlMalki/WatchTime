import { RATING_REGIONS, type RatingRegion } from "@workspace/rating-regions";

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
} {
  const params = new URLSearchParams(search);
  const rawRegion = params.get("region");
  const region =
    RATING_REGIONS.find(({ code }) => code === rawRegion)?.code ?? "US";
  const rawTab = params.get("tab");
  const tab = ADMIN_TABS.find((value) => value === rawTab)
    ?? (params.has("region") ? "content" : "dashboard");
  return { tab, region };
}

export function adminContentUrl(
  search: string,
  tab: AdminTab,
  region: RatingRegion,
): string {
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  if (tab === "content") params.set("region", region);
  return `/admin?${params.toString()}`;
}