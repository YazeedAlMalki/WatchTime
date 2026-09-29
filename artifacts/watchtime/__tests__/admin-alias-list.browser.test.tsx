import React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";

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

it("keeps filtered alias continuation stable when matching records change between pages", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=content&region=GB&q=Lighthouse&ownership=editorial");
  const requests: URL[] = [];
  const makeAlias = (id: number, alias: string) => ({
    id,
    titleId: 101,
    titleName: "The Lighthouse",
    titleType: "movie" as const,
    titleYear: 2019,
    alias,
    language: "fr",
    sourceName: "Editorial",
    sourceUrl: null,
    isEditorial: true,
    collision: false,
    collisionTitleCount: 1,
    updatedAt: "2026-09-16T00:00:00.000Z",
  });
  let liveAliases = Array.from({ length: 51 }, (_, index) =>
    makeAlias(100 + index, `Lighthouse alias ${index + 1}`),
  );
  let changedDuringReview = false;
  const originalFetch = window.fetch;
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content-aliases") throw new Error(`Unexpected request: ${url}`);
    requests.push(url);
    if (url.searchParams.get("afterId") === "149" && !changedDuringReview) {
      changedDuringReview = true;
      liveAliases = [
        makeAlias(50, "Lighthouse inserted before this cursor"),
        ...liveAliases.filter((alias) => alias.id !== 100 && alias.id !== 150),
        makeAlias(150, "Lighthouse alias renamed ahead of the current page"),
        makeAlias(151, "Lighthouse inserted after this cursor"),
      ];
    }
    const afterId = Number(url.searchParams.get("afterId") ?? 0);
    const matching = liveAliases.filter((alias) => alias.id > afterId);
    const items = matching.slice(0, 50).map((alias) => ({
      ...alias,
      isEditorial: url.searchParams.get("ownership") !== "provider",
    }));
    return new Response(JSON.stringify({
      items,
      total: liveAliases.length,
      limit: 50,
      offset: 0,
      nextAfterId: matching.length > items.length ? items.at(-1)?.id ?? null : null,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByRole("status")).toHaveTextContent("Page 1 · 51 matching aliases");
    expect(requests.at(-1)?.searchParams.get("afterId")).toBeNull();
    expect(requests.at(-1)?.searchParams.has("offset")).toBe(false);
    await userEvent.click(page.getByRole("button", { name: "Next aliases" }));
    await expect.element(page.getByRole("status")).toHaveTextContent("Page 2 · 52 matching aliases");
    await expect.element(page.getByText("Lighthouse alias renamed ahead of the current page")).toBeVisible();
    await expect.element(page.getByText("Lighthouse inserted after this cursor")).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Lighthouse");
    expect(requests.at(-1)?.searchParams.get("ownership")).toBe("editorial");
    expect(requests.at(-1)?.searchParams.get("limit")).toBe("50");
    expect(requests.at(-1)?.searchParams.get("afterId")).toBe("149");
    expect(requests.at(-1)?.searchParams.has("offset")).toBe(false);

    await userEvent.click(page.getByRole("button", { name: "Previous aliases" }));
    await expect.element(page.getByRole("status")).toHaveTextContent("Page 1 · 52 matching aliases");
    await expect.element(page.getByText("Lighthouse inserted before this cursor")).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Lighthouse");
    expect(requests.at(-1)?.searchParams.get("ownership")).toBe("editorial");
    expect(requests.at(-1)?.searchParams.get("afterId")).toBeNull();
    expect(requests.at(-1)?.searchParams.has("offset")).toBe(false);

    await userEvent.click(page.getByRole("button", { name: "Next aliases" }));
    await expect.element(page.getByRole("status")).toHaveTextContent("Page 2 · 52 matching aliases");
    const ownership = page.getByRole("combobox", { name: "Alias ownership" });
    await userEvent.click(ownership);
    await userEvent.click(page.getByRole("option", { name: "Provider-owned" }));
    await expect.element(ownership).toHaveTextContent("Provider-owned");
    await expect.element(page.getByRole("status")).toHaveTextContent("Page 1 · 52 matching aliases");
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Lighthouse");
    expect(requests.at(-1)?.searchParams.get("ownership")).toBe("provider");
    expect(requests.at(-1)?.searchParams.get("afterId")).toBeNull();
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    window.history.replaceState({}, "", previousUrl);
  }
});

it("shows both alias sources for All ownership and keeps filtered source labels visible", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=content&region=US&ownership=provider");
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
    const items = ownership
      ? aliases[ownership as keyof typeof aliases]
      : [...aliases.provider, ...aliases.editorial];
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

    await userEvent.click(ownership);
    await userEvent.click(page.getByRole("option", { name: "All ownership" }));
    await expect.element(ownership).toHaveTextContent("All ownership");
    await expect.element(page.getByText("Lighthouse Provider Alias")).toBeVisible();
    await expect.element(page.getByText("TVMaze", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Le Phare Editorial")).toBeVisible();
    await expect.element(page.getByText("Wikipedia", { exact: true })).toBeVisible();
    expect(requests.at(-1)?.searchParams.has("ownership")).toBe(false);
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    window.history.replaceState({}, "", previousUrl);
  }
});

it("keeps editorial aliases selected when an older provider request finishes late", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=content&region=US");
  const requests: URL[] = [];
  const originalFetch = window.fetch;
  let resolveProviderResponse!: (response: Response) => void;
  let providerFetchReturned!: () => void;
  const providerResponse = new Promise<Response>((resolve) => {
    resolveProviderResponse = resolve;
  });
  const providerFetchCompleted = new Promise<void>((resolve) => {
    providerFetchReturned = resolve;
  });
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
  const responseFor = (items: typeof aliases.provider) => new Response(JSON.stringify({
    items,
    total: items.length,
    limit: 50,
    offset: 0,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  window.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content-aliases") {
      throw new Error(`Unexpected browser test request: ${url}`);
    }
    requests.push(url);
    const ownership = url.searchParams.get("ownership");
    const items = ownership ? aliases[ownership as keyof typeof aliases] : [];
    if (ownership === "provider") {
      return providerResponse.then((response) => {
        providerFetchReturned();
        return response;
      });
    }
    return Promise.resolve(responseFor(items ?? []));
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
    expect(requests.filter((request) =>
      request.searchParams.get("ownership") === "provider",
    )).toHaveLength(1);

    await userEvent.click(ownership);
    await userEvent.click(page.getByRole("option", { name: "Editorial" }));
    await expect.element(ownership).toHaveTextContent("Editorial");
    await expect.element(page.getByText("Le Phare Editorial")).toBeVisible();
    await expect.element(page.getByText("Wikipedia", { exact: true })).toBeVisible();
    expect(requests.filter((request) =>
      request.searchParams.get("ownership") === "editorial",
    )).toHaveLength(1);
    await expect.element(page.getByText("Lighthouse Provider Alias")).not.toBeInTheDocument();

    resolveProviderResponse(responseFor(aliases.provider));
    await providerFetchCompleted;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    await expect.element(ownership).toHaveTextContent("Editorial");
    await expect.element(page.getByText("Le Phare Editorial")).toBeVisible();
    await expect.element(page.getByText("Wikipedia", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Lighthouse Provider Alias")).not.toBeInTheDocument();
    await expect.element(page.getByText("TVMaze", { exact: true })).not.toBeInTheDocument();
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    window.history.replaceState({}, "", previousUrl);
  }
});

it("exports all matching aliases and explains empty or failed downloads", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=content&region=GB&q=Lighthouse&ownership=editorial");
  const requests: URL[] = [];
  const originalFetch = window.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  const downloads: string[] = [];
  let exportMode: "success" | "empty" | "failure" = "success";
  URL.createObjectURL = vi.fn(() => "blob:alias-export");
  HTMLAnchorElement.prototype.click = function () {
    downloads.push(this.download);
  };
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    requests.push(url);
    if (url.pathname === "/api/admin/content-aliases/export") {
      if (exportMode === "failure") {
        return new Response(JSON.stringify({ error: "Export service unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(exportMode === "empty" ? '"Alias"\r\n' : '"Alias"\r\n"Le Phare"', {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="alternate-title-review.csv"',
          "X-Export-Count": exportMode === "empty" ? "0" : "121",
        },
      });
    }
    if (url.pathname !== "/api/admin/content-aliases") {
      throw new Error(`Unexpected browser test request: ${url}`);
    }
    return new Response(JSON.stringify({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(
      <QueryClientProvider client={client}>
        <AdminPage />
        <Toaster />
      </QueryClientProvider>,
    );
    await expect.element(page.getByText("No alternate titles found")).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Export all CSV" }));
    await expect.element(page.getByText("121 aliases downloaded.")).toBeVisible();
    expect(downloads).toEqual(["alternate-title-review.csv"]);
    const exportRequest = requests.find((url) => url.pathname === "/api/admin/content-aliases/export");
    expect(exportRequest?.searchParams.get("q")).toBe("Lighthouse");
    expect(exportRequest?.searchParams.get("ownership")).toBe("editorial");
    expect(exportRequest?.searchParams.has("offset")).toBe(false);
    expect(exportRequest?.searchParams.has("limit")).toBe(false);

    exportMode = "empty";
    await userEvent.click(page.getByRole("button", { name: "Export all CSV" }));
    await expect.element(page.getByText("No alternate titles to export")).toBeVisible();
    expect(downloads).toEqual(["alternate-title-review.csv"]);

    exportMode = "failure";
    await userEvent.click(page.getByRole("button", { name: "Export all CSV" }));
    await expect.element(page.getByText("Export service unavailable")).toBeVisible();
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    window.history.replaceState({}, "", previousUrl);
  }
});