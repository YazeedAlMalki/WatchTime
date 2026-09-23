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
    });
  });

  it("defaults missing and invalid regions to US", () => {
    expect(readAdminContentUrl("")).toEqual({ tab: "dashboard", region: "US", q: "" });
    expect(readAdminContentUrl("?tab=content")).toEqual({ tab: "content", region: "US", q: "" });
    expect(readAdminContentUrl("?tab=content&region=CA")).toEqual({ tab: "content", region: "US", q: "" });
    expect(readAdminContentUrl("?region=gb")).toEqual({ tab: "content", region: "US", q: "" });
  });

  it("opens content from a region-only link and keeps other URL values when changing tabs", () => {
    expect(readAdminContentUrl("?region=FR")).toEqual({ tab: "content", region: "FR", q: "" });
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
    expect(readAdminContentUrl(new URL(shared, "https://example.test").search)).toEqual({
      tab: "content", region: "GB", q: "Star Wars & Friends",
    });
    const changedRegion = adminContentUrl(new URL(shared, "https://example.test").search, "content", "FR");
    expect(readAdminContentUrl(new URL(changedRegion, "https://example.test").search)).toEqual({
      tab: "content", region: "FR", q: "Star Wars & Friends",
    });
    expect(adminContentUrl(new URL(changedRegion, "https://example.test").search, "content", "FR", ""))
      .toBe("/admin?review=42&tab=content&region=FR");
  });

  it("opens a search-only link in Content and does not carry its search to another tab", () => {
    expect(readAdminContentUrl("?q=Alien")).toEqual({ tab: "content", region: "US", q: "Alien" });
    const otherTab = adminContentUrl("?tab=content&region=GB&q=Alien", "reports", "GB");
    expect(otherTab).toBe("/admin?tab=reports&region=GB");
    expect(readAdminContentUrl(new URL(otherTab, "https://example.test").search)).toEqual({
      tab: "reports", region: "GB", q: "",
    });
    expect(readAdminContentUrl("?tab=reports&region=GB&q=Alien").q).toBe("");
  });
});