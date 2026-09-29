import React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Keep the generated alias-list hook and HTTP client intact so retry and
// ownership/search parameters are checked against real browser requests.
vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const api = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...api,
    useGetMe: () => ({ data: { isAdmin: true }, isLoading: false }),
    useGetAdminDashboard: () => ({ data: undefined }),
    useSearchAdminContent: () => ({ data: [], isLoading: false, isError: false }),
    useRefreshAdminContent: () => ({ isPending: false, mutate: vi.fn() }),
    useRefreshAdminContentBatch: () => ({ isPending: false, mutate: vi.fn() }),
    useUpdateAdminContentAlias: () => ({ isPending: false, mutate: vi.fn() }),
    useDeleteAdminContentAlias: () => ({ isPending: false, mutate: vi.fn() }),
  };
});

vi.mock("@clerk/react", () => ({ useAuth: () => ({ getToken: async () => null }) }));

import AdminPage from "@/pages/admin";

it("distinguishes an alias-list failure from an empty result and retries the current filters", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=content&region=US&q=Lighthouse");
  const requests: URL[] = [];
  const originalFetch = window.fetch;
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content-aliases") {
      throw new Error(`Unexpected browser test request: ${url}`);
    }
    requests.push(url);
    const failed = url.searchParams.get("ownership") === "provider"
      && requests.filter((request) => request.search === url.search).length === 1;
    return new Response(JSON.stringify(failed
      ? { error: "Unavailable" }
      : { items: [], total: 0, limit: 50, offset: Number(url.searchParams.get("offset") ?? 0) }), {
      status: failed ? 503 : 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByText("No alternate titles found")).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Lighthouse");

    const ownership = page.getByRole("combobox", { name: "Alias ownership" });
    await userEvent.click(ownership);
    await userEvent.click(page.getByRole("option", { name: "Provider-owned" }));
    await expect.element(page.getByRole("alert")).toHaveTextContent("Could not load alternate titles.");
    await expect.element(page.getByText("No alternate titles found")).not.toBeInTheDocument();
    await expect.element(ownership).toHaveTextContent("Provider-owned");
    await expect.element(page.getByPlaceholder("Search titles…")).toHaveValue("Lighthouse");
    expect(new URLSearchParams(location.search).get("ownership")).toBe("provider");
    expect(new URLSearchParams(location.search).get("region")).toBe("US");
    expect(new URLSearchParams(location.search).get("q")).toBe("Lighthouse");

    await userEvent.click(page.getByRole("button", { name: "Retry alternate titles" }));
    await expect.element(page.getByText("No alternate titles found")).toBeVisible();
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    expect(requests.filter((request) =>
      request.searchParams.get("ownership") === "provider"
      && request.searchParams.get("q") === "Lighthouse",
    )).toHaveLength(2);
    await expect.element(ownership).toHaveTextContent("Provider-owned");
    await expect.element(page.getByPlaceholder("Search titles…")).toHaveValue("Lighthouse");
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    window.history.replaceState({}, "", previousUrl);
  }
});

it("restores a shared alias ownership filter and clears it without losing search or region", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=content&region=FR&q=Lighthouse&ownership=editorial");
  const originalFetch = window.fetch;
  const requests: URL[] = [];
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content-aliases") throw new Error(`Unexpected request: ${url}`);
    requests.push(url);
    return new Response(JSON.stringify({
      items: [], total: 0, limit: 50, offset: Number(url.searchParams.get("offset") ?? 0),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    const ownership = page.getByRole("combobox", { name: "Alias ownership" });
    await expect.element(ownership).toHaveTextContent("Editorial");
    await expect.element(page.getByText("No alternate titles found")).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("ownership")).toBe("editorial");
    await userEvent.click(ownership);
    await userEvent.click(page.getByRole("option", { name: "All ownership" }));
    await expect.element(ownership).toHaveTextContent("All ownership");
    expect(new URLSearchParams(location.search).get("ownership")).toBeNull();
    expect(new URLSearchParams(location.search).get("region")).toBe("FR");
    expect(new URLSearchParams(location.search).get("q")).toBe("Lighthouse");
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    window.history.replaceState({}, "", previousUrl);
  }
});

it("pages through a filtered alias review without dropping its search or ownership filter", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=content&region=GB&q=Lighthouse&ownership=editorial");
  const requests: URL[] = [];
  const originalFetch = window.fetch;
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content-aliases") throw new Error(`Unexpected request: ${url}`);
    requests.push(url);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return new Response(JSON.stringify({
      items: [{
        id: offset + 1,
        titleId: 101,
        titleName: "The Lighthouse",
        titleType: "movie",
        titleYear: 2019,
        alias: `Lighthouse alias ${offset + 1}`,
        language: "fr",
        sourceName: "Editorial",
        sourceUrl: null,
        isEditorial: true,
        collision: false,
        collisionTitleCount: 1,
        updatedAt: "2026-09-16T00:00:00.000Z",
      }],
      total: 120,
      limit: 50,
      offset,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByRole("status")).toHaveTextContent("Showing 1–50 of 120 aliases");
    await userEvent.click(page.getByRole("button", { name: "Next aliases" }));
    await expect.element(page.getByRole("status")).toHaveTextContent("Showing 51–100 of 120 aliases");
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Lighthouse");
    expect(requests.at(-1)?.searchParams.get("ownership")).toBe("editorial");
    expect(requests.at(-1)?.searchParams.get("limit")).toBe("50");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("50");

    await userEvent.click(page.getByRole("button", { name: "Previous aliases" }));
    await expect.element(page.getByRole("status")).toHaveTextContent("Showing 1–50 of 120 aliases");
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Lighthouse");
    expect(requests.at(-1)?.searchParams.get("ownership")).toBe("editorial");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    window.history.replaceState({}, "", previousUrl);
  }
});

it("requests provider-owned and editorial aliases and keeps each source label visible", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=content&region=US");
  const requests: URL[] = [];
  const originalFetch = window.fetch;
  const aliases = {
    provider: [{
      id: 301,
      titleId: 101,
      titleName: "The Lighthouse",
      titleType: "movie",
      titleYear: 2019,
      alias: "Lighthouse Provider Alias",
      language: "en",
      sourceName: "TVMaze",
      sourceUrl: "https://example.test/provider",
      isEditorial: false,
      collision: false,
      collisionTitleCount: 1,
      updatedAt: "2026-09-16T00:00:00.000Z",
    }],
    editorial: [{
      id: 302,
      titleId: 101,
      titleName: "The Lighthouse",
      titleType: "movie",
      titleYear: 2019,
      alias: "Le Phare Editorial",
      language: "fr",
      sourceName: "Wikipedia",
      sourceUrl: "https://example.test/editorial",
      isEditorial: true,
      collision: false,
      collisionTitleCount: 1,
      updatedAt: "2026-09-16T00:00:00.000Z",
    }],
  };
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content-aliases") {
      throw new Error(`Unexpected browser test request: ${url}`);
    }
    requests.push(url);
    const ownership = url.searchParams.get("ownership");
    const items = ownership ? aliases[ownership as keyof typeof aliases] : [];
    return new Response(JSON.stringify({
      items,
      total: items.length,
      limit: Number(url.searchParams.get("limit") ?? 50),
      offset: Number(url.searchParams.get("offset") ?? 0),
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    const ownership = page.getByRole("combobox", { name: "Alias ownership" });
    await expect.element(page.getByText("No alternate titles found")).toBeVisible();

    await userEvent.click(ownership);
    await userEvent.click(page.getByRole("option", { name: "Provider-owned" }));
    await expect.element(page.getByText("Lighthouse Provider Alias")).toBeVisible();
    await expect.element(page.getByText("TVMaze", { exact: true })).toBeVisible();
    expect(requests.filter((request) =>
      request.searchParams.get("ownership") === "provider",
    )).toHaveLength(1);

    await userEvent.click(ownership);
    await userEvent.click(page.getByRole("option", { name: "Editorial" }));
    await expect.element(page.getByText("Le Phare Editorial")).toBeVisible();
    await expect.element(page.getByText("Wikipedia", { exact: true })).toBeVisible();
    expect(requests.filter((request) =>
      request.searchParams.get("ownership") === "editorial",
    )).toHaveLength(1);
    await expect.element(page.getByText("Lighthouse Provider Alias")).not.toBeInTheDocument();
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    window.history.replaceState({}, "", previousUrl);
  }
});