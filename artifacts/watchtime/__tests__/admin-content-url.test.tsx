import { describe, expect, it } from "vitest";
import { RATING_REGIONS } from "@workspace/rating-regions";
import { adminContentUrl, readAdminContentUrl } from "../src/pages/admin-content-url";

describe("admin content URL", () => {
  it.each(RATING_REGIONS)("restores $code and opens content on a shared URL", ({ code }) => {
    const url = adminContentUrl("", "content", code);
    expect(url).toBe(`/admin?tab=content&region=${code}`);
    expect(readAdminContentUrl(new URL(url, "https://example.test").search)).toEqual({
      tab: "content",
      region: code,
      q: "",
      ownership: "all",
      aliasId: null,
    });
  });

  it("defaults missing and invalid regions to US", () => {
    expect(readAdminContentUrl("")).toMatchObject({ tab: "dashboard", region: "US", q: "", ownership: "all" });
    expect(readAdminContentUrl("?tab=content")).toMatchObject({ tab: "content", region: "US", q: "", ownership: "all" });
    expect(readAdminContentUrl("?tab=content&region=CA")).toMatchObject({ tab: "content", region: "US", q: "", ownership: "all" });
    expect(readAdminContentUrl("?region=gb")).toMatchObject({ tab: "content", region: "US", q: "", ownership: "all" });
  });

  it("opens content from a region-only link and keeps other URL values when changing tabs", () => {
    expect(readAdminContentUrl("?region=FR")).toMatchObject({ tab: "content", region: "FR", q: "", ownership: "all" });
    expect(adminContentUrl("?region=FR&review=42", "reports", "FR")).toBe(
      "/admin?region=FR&review=42&tab=reports",
    );
    expect(adminContentUrl("?region=FR&review=42&tab=reports", "content", "FR")).toBe(
      "/admin?region=FR&review=42&tab=content",
    );
  });

  it("restores a shared search, preserves it when changing region, and clears it without clearing region", () => {
    const shared = adminContentUrl("?review=42", "content", "GB", "Star Wars & Friends");
    expect(shared).toBe("/admin?review=42&tab=content&region=GB&q=Star+Wars+%26+Friends");
    expect(readAdminContentUrl(new URL(shared, "https://example.test").search)).toMatchObject({
      tab: "content", region: "GB", q: "Star Wars & Friends", ownership: "all",
    });
    const changedRegion = adminContentUrl(new URL(shared, "https://example.test").search, "content", "FR");
    expect(readAdminContentUrl(new URL(changedRegion, "https://example.test").search)).toMatchObject({
      tab: "content", region: "FR", q: "Star Wars & Friends", ownership: "all",
    });
    expect(adminContentUrl(new URL(changedRegion, "https://example.test").search, "content", "FR", ""))
      .toBe("/admin?review=42&tab=content&region=FR");
  });

  it("opens a search-only link in Content and does not carry its search to another tab", () => {
    expect(readAdminContentUrl("?q=Alien")).toMatchObject({ tab: "content", region: "US", q: "Alien", ownership: "all" });
    const otherTab = adminContentUrl("?tab=content&region=GB&q=Alien", "reports", "GB");
    expect(otherTab).toBe("/admin?tab=reports&region=GB");
    expect(readAdminContentUrl(new URL(otherTab, "https://example.test").search)).toMatchObject({
      tab: "reports", region: "GB", q: "", ownership: "all",
    });
    expect(readAdminContentUrl("?tab=reports&region=GB&q=Alien").q).toBe("");
  });

  it("shares ownership with search and region, preserves it across Content edits, and clears it independently", () => {
    const selected = adminContentUrl("?tab=content&region=GB&q=Alien&review=42", "content", "GB", undefined, "provider");
    expect(readAdminContentUrl(new URL(selected, "https://example.test").search)).toMatchObject({
      tab: "content", region: "GB", q: "Alien", ownership: "provider",
    });
    const changedSearch = adminContentUrl(new URL(selected, "https://example.test").search, "content", "GB", "Arrival");
    const changedRegion = adminContentUrl(new URL(changedSearch, "https://example.test").search, "content", "FR");
    expect(readAdminContentUrl(new URL(changedRegion, "https://example.test").search)).toMatchObject({
      tab: "content", region: "FR", q: "Arrival", ownership: "provider",
    });
    const cleared = adminContentUrl(new URL(changedRegion, "https://example.test").search, "content", "FR", undefined, "all");
    expect(cleared).toBe("/admin?tab=content&region=FR&q=Arrival&review=42");
    expect(readAdminContentUrl(new URL(cleared, "https://example.test").search).ownership).toBe("all");
  });

  it("opens ownership-only links in Content but ignores invalid ownership and removes it on other tabs", () => {
    expect(readAdminContentUrl("?ownership=editorial")).toMatchObject({
      tab: "content", region: "US", q: "", ownership: "editorial",
    });
    expect(readAdminContentUrl("?tab=content&ownership=unknown").ownership).toBe("all");
    expect(readAdminContentUrl("?tab=reports&ownership=provider").ownership).toBe("all");
    const reports = adminContentUrl("?tab=content&region=GB&q=Alien&ownership=editorial", "reports", "GB");
    expect(reports).toBe("/admin?tab=reports&region=GB");
    expect(adminContentUrl(new URL(reports, "https://example.test").search, "content", "GB"))
      .toBe("/admin?tab=content&region=GB");
  });

  it("links to one alias without carrying it into another tab or changed filters", () => {
    const link = adminContentUrl("?review=42", "content", "FR", "Alien", "editorial", 217);
    expect(readAdminContentUrl(new URL(link, "https://example.test").search)).toEqual({
      tab: "content", region: "FR", q: "Alien", ownership: "editorial", aliasId: 217,
    });
    expect(readAdminContentUrl("?aliasId=217").aliasId).toBe(217);
    expect(readAdminContentUrl("?aliasId=-1").aliasId).toBeNull();
    expect(readAdminContentUrl("?aliasId=1.5").aliasId).toBeNull();
    expect(readAdminContentUrl("?aliasId=99999999999999999999").aliasId).toBeNull();
    expect(adminContentUrl(new URL(link, "https://example.test").search, "content", "FR", "New"))
      .not.toContain("aliasId");
    expect(adminContentUrl(new URL(link, "https://example.test").search, "reports", "FR"))
      .not.toContain("aliasId");
  });
});