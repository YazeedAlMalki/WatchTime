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
    });
  });

  it("defaults missing and invalid regions to US", () => {
    expect(readAdminContentUrl("")).toEqual({ tab: "dashboard", region: "US" });
    expect(readAdminContentUrl("?tab=content")).toEqual({ tab: "content", region: "US" });
    expect(readAdminContentUrl("?tab=content&region=CA")).toEqual({ tab: "content", region: "US" });
    expect(readAdminContentUrl("?region=gb")).toEqual({ tab: "content", region: "US" });
  });

  it("opens content from a region-only link and keeps other URL values when changing tabs", () => {
    expect(readAdminContentUrl("?region=FR")).toEqual({ tab: "content", region: "FR" });
    expect(adminContentUrl("?region=FR&review=42", "reports", "FR")).toBe(
      "/admin?region=FR&review=42&tab=reports",
    );
    expect(adminContentUrl("?region=FR&review=42&tab=reports", "content", "FR")).toBe(
      "/admin?region=FR&review=42&tab=content",
    );
  });
});