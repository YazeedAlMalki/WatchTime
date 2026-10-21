import { describe, expect, it } from "vitest";
import { RATING_REGIONS } from "@workspace/rating-regions";
import { adminContentUrl, readAdminContentUrl } from "../src/pages/admin-content-url";

describe("admin content URL", () => {
  it.each(RATING_REGIONS)("restores $code and opens content on a shared URL", ({ code }) => {
    const url = adminContentUrl("", "content", code);
    expect(url).toBe(`/admin?tab=content&region=${code}`);
    expect(readAdminContentUrl(new URL(url, "https://example.test").search)).toMatchObject({
      tab: "content",
      region: code,
      q: "",
      ownership: "all",
      malformedRefreshTimestamp: false,
      malformedRefreshTimestampProvider: "",
      contentOffset: 0,
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
    const changedRegion = adminContentUrl(
      new URL(shared, "https://example.test").search,
      "content",
      "FR",
    );
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
    const changedSearch = adminContentUrl(
      new URL(selected, "https://example.test").search,
      "content",
      "FR",
      "Arrival",
    );
    const changedRegion = adminContentUrl(
      new URL(changedSearch, "https://example.test").search,
      "content",
      "FR",
    );
    expect(readAdminContentUrl(new URL(changedRegion, "https://example.test").search)).toMatchObject({
      tab: "content", region: "FR", q: "Arrival", ownership: "provider",
    });
    const cleared = adminContentUrl(new URL(changedRegion, "https://example.test").search, "content", "FR", undefined, "all");
    expect(cleared).toBe("/admin?tab=content&region=FR&q=Arrival&review=42");
    expect(readAdminContentUrl(new URL(cleared, "https://example.test").search).ownership).toBe("all");
  });

  it("shares the malformed timestamp filter with the selected region and search", () => {
    const filtered = adminContentUrl(
      "?tab=content&region=GB&q=Alien&ownership=provider",
      "content",
      "GB",
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(filtered).toBe(
      "/admin?tab=content&region=GB&q=Alien&ownership=provider&malformedRefreshTimestamp=true",
    );
    expect(readAdminContentUrl(new URL(filtered, "https://example.test").search)).toMatchObject({
      tab: "content",
      region: "GB",
      q: "Alien",
      ownership: "provider",
      malformedRefreshTimestamp: true,
    });

    const providerFiltered = adminContentUrl(
      new URL(filtered, "https://example.test").search,
      "content",
      "GB",
      "",
      "all",
      undefined,
      true,
      0,
      "Wikidata",
    );
    expect(
      new URL(providerFiltered, "https://example.test").searchParams.get(
        "malformedRefreshTimestampProvider",
      ),
    ).toBe("Wikidata");
    expect(readAdminContentUrl(new URL(providerFiltered, "https://example.test").search))
      .toMatchObject({ malformedRefreshTimestampProvider: "Wikidata" });

    const allRegionsLink = adminContentUrl(
      new URL(providerFiltered, "https://example.test").search,
      "content",
      "GB",
      "",
      "all",
      undefined,
      true,
      0,
      "Fixture Provider",
      undefined,
      undefined,
      true,
    );
    expect(readAdminContentUrl(new URL(allRegionsLink, "https://example.test").search))
      .toMatchObject({
        tab: "content",
        malformedRefreshTimestamp: true,
        malformedRefreshTimestampProvider: "Fixture Provider",
        malformedRefreshTimestampAllRegions: true,
        contentOffset: 0,
      });

    const changedRegion = adminContentUrl(
      new URL(filtered, "https://example.test").search,
      "content",
      "FR",
    );
    expect(readAdminContentUrl(new URL(changedRegion, "https://example.test").search)).toMatchObject({
      region: "FR",
      malformedRefreshTimestamp: true,
    });
    expect(adminContentUrl(new URL(filtered, "https://example.test").search, "reports", "GB"))
      .not.toContain("malformedRefreshTimestamp");
    expect(adminContentUrl(new URL(filtered, "https://example.test").search, "content", "GB", undefined, undefined, undefined, false))
      .not.toContain("malformedRefreshTimestamp");
    expect(adminContentUrl(new URL(providerFiltered, "https://example.test").search, "reports", "GB"))
      .not.toContain("malformedRefreshTimestampProvider");
    expect(adminContentUrl(new URL(allRegionsLink, "https://example.test").search, "reports", "GB"))
      .not.toContain("malformedRefreshTimestampAllRegions");
  });

  it("shares the current malformed-timestamp page and resets it when filters change", () => {
    const pageTwo = adminContentUrl(
      "?tab=content&region=GB&q=Alien&malformedRefreshTimestamp=true",
      "content",
      "GB",
      undefined,
      undefined,
      undefined,
      undefined,
      50,
    );
    expect(pageTwo).toBe(
      "/admin?tab=content&region=GB&q=Alien&malformedRefreshTimestamp=true&offset=50",
    );
    expect(readAdminContentUrl(new URL(pageTwo, "https://example.test").search)).toMatchObject({
      region: "GB",
      q: "Alien",
      malformedRefreshTimestamp: true,
      contentOffset: 50,
    });
    expect(readAdminContentUrl("?tab=content&region=GB&malformedRefreshTimestamp=true&offset=-1").contentOffset).toBe(0);
    expect(readAdminContentUrl("?tab=content&region=GB&malformedRefreshTimestamp=true&offset=1.5").contentOffset).toBe(0);

    // Match the Content search handler, which explicitly resets pagination.
    const changedSearch = adminContentUrl(
      new URL(pageTwo, "https://example.test").search,
      "content",
      "FR",
      "Arrival",
      undefined,
      undefined,
      undefined,
      0,
    );
    expect(changedSearch).not.toContain("offset");
    expect(readAdminContentUrl(new URL(changedSearch, "https://example.test").search)).toMatchObject({
      q: "Arrival",
      malformedRefreshTimestamp: true,
      contentOffset: 0,
    });
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
    expect(readAdminContentUrl(new URL(link, "https://example.test").search)).toMatchObject({
      tab: "content",
      region: "FR",
      q: "Alien",
      ownership: "editorial",
      malformedRefreshTimestamp: false,
      malformedRefreshTimestampProvider: "",
      contentOffset: 0,
      aliasId: 217,
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

  it("restores the alternate-title cursor and clears it when search or ownership changes", () => {
    const current = adminContentUrl(
      "?tab=content&region=FR&q=Alien&ownership=editorial",
      "content",
      "FR",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      3,
      "01234567-89ab-4def-8123-456789abcdef:100:50",
    );
    const restored = readAdminContentUrl(new URL(current, "https://example.test").search);
    expect(restored).toMatchObject({
      q: "Alien",
      ownership: "editorial",
      aliasPage: 3,
      aliasCursor: "01234567-89ab-4def-8123-456789abcdef:100:50",
    });

    const changedSearch = adminContentUrl(
      new URL(current, "https://example.test").search,
      "content",
      "FR",
      "Arrival",
    );
    expect(readAdminContentUrl(new URL(changedSearch, "https://example.test").search))
      .toMatchObject({ q: "Arrival", aliasPage: 1, aliasCursor: null });

    const changedOwnership = adminContentUrl(
      new URL(current, "https://example.test").search,
      "content",
      "FR",
      undefined,
      "provider",
    );
    expect(readAdminContentUrl(new URL(changedOwnership, "https://example.test").search))
      .toMatchObject({ ownership: "provider", aliasPage: 1, aliasCursor: null });
  });

  it("resets invalid alternate-title page numbers and oversized cursors", () => {
    const firstSnapshotPage = "12345678-1234-1234-1234-123456789abc:0";
    expect(readAdminContentUrl(`?tab=content&aliasPage=1&aliasCursor=${firstSnapshotPage}`))
      .toMatchObject({ aliasPage: 1, aliasCursor: firstSnapshotPage });
    for (const invalidPage of ["0", "-1", "1.5", "invalid", "9007199254740992"]) {
      expect(readAdminContentUrl(`?tab=content&aliasPage=${invalidPage}&aliasCursor=${firstSnapshotPage}`))
        .toMatchObject({ aliasPage: 1, aliasCursor: null });
    }
    const firstPageLink = adminContentUrl(
      "?tab=content&region=FR&aliasPage=2&aliasCursor=previous",
      "content", "FR", undefined, undefined, undefined, undefined, undefined,
      undefined, 1, firstSnapshotPage,
    );
    expect(readAdminContentUrl(new URL(firstPageLink, "https://example.test").search))
      .toMatchObject({ aliasPage: 1, aliasCursor: firstSnapshotPage });
    expect(readAdminContentUrl("?tab=content&aliasPage=1&aliasCursor=bad"))
      .toMatchObject({ aliasPage: 1, aliasCursor: null });
    expect(readAdminContentUrl(`?tab=content&aliasPage=3&aliasCursor=${"x".repeat(4097)}`))
      .toMatchObject({ aliasPage: 1, aliasCursor: null });
    for (const cursor of [
      "01234567-89ab-4def-8123-456789abcdef:9007199254740992",
      "01234567-89ab-4def-8123-456789abcdef:50:50",
    ]) {
      expect(readAdminContentUrl(`?tab=content&aliasPage=2&aliasCursor=${cursor}`))
        .toMatchObject({ aliasPage: 1, aliasCursor: null });
    }
  });
});
