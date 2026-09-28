import React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readAdminContentUrl } from "@/pages/admin-content-url";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

// Leave the generated content query and HTTP client intact: the test checks
// that selecting a region really changes the requested URL, not just a mock hook.
vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const api = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...api,
    useGetMe: () => ({ data: { isAdmin: true }, isLoading: false }),
    useGetAdminDashboard: () => ({ data: undefined }),
    useListAdminContentAliases: (params?: { id?: number }) => ({
      data: params?.id === 217 ? [{
        id: 217, titleId: 101, titleName: "The Lighthouse", titleType: "movie",
        titleYear: 2019, alias: "Le Phare", language: "fr", sourceName: "Editorial",
        sourceUrl: null, isEditorial: true, collision: false, collisionTitleCount: 1,
        updatedAt: "2026-09-16T00:00:00.000Z",
      }] : [],
      isLoading: false,
    }),
    useRefreshAdminContent: () => ({ isPending: false, mutate: vi.fn() }),
    useRefreshAdminContentBatch: () => ({ isPending: false, mutate: vi.fn() }),
    useUpdateAdminContentAlias: () => ({ isPending: false, mutate: vi.fn() }),
    useDeleteAdminContentAlias: () => ({ isPending: false, mutate: vi.fn() }),
  };
});

vi.mock("@clerk/react", () => ({ useAuth: () => ({ getToken: async () => null }) }));

import AdminPage from "@/pages/admin";

const regions = ["US", "GB", "DE", "FR", "AU", "BR"] as const;
const ratings = {
  US: { label: "PG-13", system: "MPAA", countryName: "United States" },
  GB: { label: "12A", system: "BBFC", countryName: "United Kingdom" },
  DE: { label: "FSK 12", system: "FSK", countryName: "Germany" },
  FR: { label: "Tous publics", system: "CNC", countryName: "France" },
  AU: { label: "M", system: "ACB", countryName: "Australia" },
  BR: { label: "14", system: "ClassInd", countryName: "Brazil" },
} as const;

it("copies a link with the current Content filters and reports clipboard failures", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const originalFetch = window.fetch;
  const writeText = vi.fn().mockResolvedValue(undefined);
  window.history.replaceState({}, "", "/admin?tab=content&region=FR&q=Star+Wars+%26+Friends&ownership=editorial");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  window.fetch = vi.fn(async () =>
    new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  toast.mockClear();
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByPlaceholder("Search titles…")).toHaveValue("Star Wars & Friends");
    await expect.element(page.getByRole("combobox", { name: "Review Wikidata region" })).toHaveTextContent(/FR ·/);
    await expect.element(page.getByRole("combobox", { name: "Alias ownership" })).toHaveTextContent("Editorial");

    await userEvent.click(page.getByRole("button", { name: "Copy review link" }));
    expect(writeText).toHaveBeenCalledOnce();
    const copied = new URL(writeText.mock.calls[0][0]);
    expect(copied.origin).toBe(location.origin);
    expect(readAdminContentUrl(copied.search)).toMatchObject({
      tab: "content", region: "FR", q: "Star Wars & Friends", ownership: "editorial",
    });
    expect(toast).toHaveBeenCalledWith({ title: "Review link copied" });

    writeText.mockRejectedValueOnce(new Error("Permission denied"));
    await userEvent.click(page.getByRole("button", { name: "Copy review link" }));
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Could not copy review link", variant: "destructive",
    })));
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    window.history.replaceState({}, "", previousUrl);
    if (previousClipboard) Object.defineProperty(navigator, "clipboard", previousClipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

it("opens a direct alias link with saved filters and highlights the linked row outside the results", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  const originalFetch = window.fetch;
  window.history.replaceState({}, "", "/admin?tab=content&region=FR&q=Other&ownership=provider&aliasId=217");
  window.fetch = vi.fn(async () =>
    new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByPlaceholder("Search titles…")).toHaveValue("Other");
    await expect.element(page.getByRole("combobox", { name: "Review Wikidata region" })).toHaveTextContent(/FR ·/);
    await expect.element(page.getByRole("combobox", { name: "Alias ownership" })).toHaveTextContent("Provider");
    await expect.element(page.getByRole("status")).toHaveTextContent("Le Phare");
    expect(container.querySelector("tr.bg-primary\\/10")?.textContent).toContain("Le Phare");
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    window.history.replaceState({}, "", previousUrl);
  }
});

it("requests and displays each review region with the selected record's provenance", async () => {
  const requests: string[] = [];
  const pending = new Map<string, () => void>();
  const originalFetch = window.fetch;
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content") {
      throw new Error(`Unexpected browser test request: ${url}`);
    }
    const region = url.searchParams.get("region");
    if (!region || !(region in ratings)) throw new Error(`Unexpected region: ${region}`);
    requests.push(url.toString());
    await new Promise<void>((resolve) => pending.set(region, resolve));
    const rating = ratings[region as keyof typeof ratings];
    return new Response(JSON.stringify([{
      id: 101,
      name: "Regional Rating Fixture",
      type: "movie",
      mappings: [],
      selectedRating: {
        region,
        ...rating,
        sourceName: "Wikidata",
        recordId: 123,
        lastRefreshedAt: `2026-0${regions.indexOf(region as typeof regions[number]) + 1}-01T12:00:00.000Z`,
        refreshTimestampMalformed: region === "US",
        sourceUrl: `https://www.wikidata.org/wiki/Q${regions.indexOf(region as typeof regions[number]) + 1}`,
      },
    }]), { headers: { "Content-Type": "application/json" } });
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await userEvent.click(page.getByRole("tab", { name: "Content" }));
    const selector = page.getByRole("combobox", { name: "Review Wikidata region" });

    for (const region of regions) {
      if (region !== "US") {
        await userEvent.click(selector);
        await userEvent.click(page.getByRole("option", { name: new RegExp(`^${region} ·`) }));
      }
      await vi.waitFor(() => expect(requests.some((request) =>
        new URL(request).searchParams.get("region") === region,
      )).toBe(true));
      expect(requests.filter((request) =>
        new URL(request).searchParams.get("region") === region,
      )).toHaveLength(1);
      await expect.element(selector).toHaveTextContent(new RegExp(`${region} ·`));
      // A new region must not show the old region's record while its request is pending.
      await expect.element(page.getByText(`Selected ${region} Wikidata rating:`)).not.toBeInTheDocument();
      pending.get(region)?.();
      await expect.element(page.getByText(`Selected ${region} Wikidata rating:`)).toBeVisible();
      await expect.element(page.getByText(ratings[region].label, { exact: true })).toBeVisible();
      const malformedTimestampWarning = page.getByTestId("status-rating-refresh-warning-101");
      if (region === "US") {
        await expect.element(malformedTimestampWarning)
          .toHaveTextContent("Refresh timestamp is malformed; check this provider record.");
      } else {
        await expect.element(malformedTimestampWarning).not.toBeInTheDocument();
      }

      if (region === "US" || region === "GB") {
        const record = page.getByText(`Selected ${region} Wikidata rating:`).locator("..");
        await expect.element(record).toHaveTextContent(ratings[region].countryName);
        await expect.element(record).toHaveTextContent(ratings[region].system);
        await expect.element(record).toHaveTextContent(
          new Date(`2026-0${regions.indexOf(region) + 1}-01T12:00:00.000Z`).toLocaleString(),
        );
        await expect.element(record.getByRole("link", { name: "View Wikidata record" }))
          .toHaveAttribute("href", `https://www.wikidata.org/wiki/Q${regions.indexOf(region) + 1}`);
      }
    }
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
  }
});

it("shows a regional request failure instead of an empty result and retries the selected region", async () => {
  // The preceding browser test leaves the location on its last selected region.
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=content&region=US");
  const requests: string[] = [];
  const originalFetch = window.fetch;
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content") {
      throw new Error(`Unexpected browser test request: ${url}`);
    }
    const region = url.searchParams.get("region");
    requests.push(url.toString());
    if (region === "GB" && requests.filter((request) =>
      new URL(request).searchParams.get("region") === "GB",
    ).length === 1) {
      return new Response(JSON.stringify({ error: "Unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (region === "FR") {
      return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify([{
      id: 101,
      name: `${region} title`,
      type: "movie",
      mappings: [],
      selectedRating: null,
    }]), { headers: { "Content-Type": "application/json" } });
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await userEvent.click(page.getByRole("tab", { name: "Content" }));
    const selector = page.getByRole("combobox", { name: "Review Wikidata region" });
    await expect.element(page.getByText("US title")).toBeVisible();

    await userEvent.click(selector);
    await userEvent.click(page.getByRole("option", { name: /^GB ·/ }));
    await expect.element(page.getByRole("alert")).toHaveTextContent("Could not load titles for GB.");
    await expect.element(page.getByText("No titles found")).not.toBeInTheDocument();
    await expect.element(page.getByText("US title")).not.toBeInTheDocument();
    await expect.element(selector).toHaveTextContent(/GB ·/);

    await userEvent.click(page.getByRole("button", { name: "Retry GB titles" }));
    await expect.element(page.getByText("GB title")).toBeVisible();
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    await expect.element(selector).toHaveTextContent(/GB ·/);
    expect(requests.filter((request) =>
      new URL(request).searchParams.get("region") === "GB",
    )).toHaveLength(2);

    await userEvent.click(selector);
    await userEvent.click(page.getByRole("option", { name: /^FR ·/ }));
    await expect.element(page.getByText("No titles found")).toBeVisible();
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    window.history.replaceState({}, "", previousUrl);
  }
});