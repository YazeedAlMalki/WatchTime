import React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getListAdminContentAliasesQueryKey } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";

const { deleteAliasMutate } = vi.hoisted(() => ({
  deleteAliasMutate: vi.fn(),
}));

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
    useDeleteAdminContentAlias: () => ({ isPending: false, mutate: deleteAliasMutate }),
  };
});

vi.mock("@clerk/react", () => ({ useAuth: () => ({ getToken: async () => null }) }));

import AdminPage from "@/pages/admin";

afterEach(() => {
  deleteAliasMutate.mockReset();
});

it("distinguishes an alias-list failure from an empty result and retries the current filters", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState(
    {},
    "",
    "/admin?tab=content&region=US&q=Lighthouse&aliasPage=2&aliasCursor=00000000-0000-0000-0000-000000000001:50:0",
  );
  const requests: URL[] = [];
  const originalFetch = window.fetch;
  let resolveInitialResponse!: (response: Response) => void;
  let markInitialRequestStarted!: () => void;
  const initialResponse = new Promise<Response>((resolve) => {
    resolveInitialResponse = resolve;
  });
  const initialRequestStarted = new Promise<void>((resolve) => {
    markInitialRequestStarted = resolve;
  });
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content-aliases") {
      throw new Error(`Unexpected browser test request: ${url}`);
    }
    requests.push(url);
    if (url.searchParams.get("ownership") !== "provider") {
      markInitialRequestStarted();
      return initialResponse;
    }
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
    await initialRequestStarted;
    const loadingStatus = page.getByText("Loading alternate titles for page 2…");
    await expect.element(loadingStatus).toBeVisible();
    await expect.element(loadingStatus).toHaveAttribute("role", "status");
    resolveInitialResponse(new Response(JSON.stringify({
      items: [], total: 0, limit: 50, offset: 0,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect.element(page.getByText("No alternate titles found")).toBeVisible();
    await expect.element(loadingStatus).not.toBeInTheDocument();
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Lighthouse");

    const ownership = page.getByRole("combobox", { name: "Alias ownership" });
    await userEvent.click(ownership);
    await userEvent.click(page.getByRole("option", { name: "Provider-owned" }));
    await expect.element(page.getByRole("alert")).toHaveTextContent("Could not load alternate titles.");
    await expect.element(loadingStatus).not.toBeInTheDocument();
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

it("starts a fresh filtered alias page after deleting the last alias on a later page", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  const snapshotId = "123e4567-e89b-12d3-a456-426614174000";
  const pageCursor = `${snapshotId}:50:0`;
  window.history.replaceState(
    {},
    "",
    `/admin?tab=content&region=GB&q=Lighthouse&ownership=editorial&aliasPage=2&aliasCursor=${pageCursor}`,
  );
  const requests: URL[] = [];
  const originalFetch = window.fetch;
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
    providerCitations: [],
    isEditorial: true,
    collision: false,
    collisionTitleCount: 1,
    updatedAt: "2026-09-16T00:00:00.000Z",
  });
  const firstPageAliases = Array.from({ length: 50 }, (_, index) =>
    makeAlias(100 + index, `Lighthouse page one alias ${String(index + 1).padStart(2, "0")}`),
  );
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content-aliases") {
      throw new Error(`Unexpected browser test request: ${url}`);
    }
    requests.push(url);
    const isSecondPage = url.searchParams.get("cursor") === pageCursor;
    const body = isSecondPage
      ? {
          items: [makeAlias(151, "Lighthouse final page alias")],
          total: 51,
          limit: 50,
          offset: 50,
          nextCursor: null,
          previousCursor: `${snapshotId}:0`,
        }
      : {
          items: firstPageAliases,
          total: 50,
          limit: 50,
          offset: 0,
          nextCursor: null,
          previousCursor: null,
        };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  deleteAliasMutate.mockImplementation(
    (_variables: unknown, options: { onSuccess?: () => unknown }) => {
      void options.onSuccess?.();
    },
  );

  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByRole("status")).toHaveTextContent("Page 2 · 51 matching aliases");
    await expect.element(page.getByText("Lighthouse final page alias")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Previous aliases" })).toBeEnabled();

    await userEvent.click(page.getByRole("button", { name: "Remove" }));
    await expect.element(page.getByText("Lighthouse page one alias 01")).toBeVisible();
    await expect.element(page.getByText("50 aliases")).toBeVisible();
    await expect.element(page.getByText("Lighthouse final page alias")).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Previous aliases" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Next aliases" })).not.toBeInTheDocument();

    const refreshedRequest = requests.at(-1);
    expect(refreshedRequest?.searchParams.get("cursor")).toBeNull();
    expect(refreshedRequest?.searchParams.get("q")).toBe("Lighthouse");
    expect(refreshedRequest?.searchParams.get("ownership")).toBe("editorial");
    expect(new URLSearchParams(location.search).get("aliasPage")).toBeNull();
    expect(new URLSearchParams(location.search).get("aliasCursor")).toBeNull();
    expect(new URLSearchParams(location.search).get("q")).toBe("Lighthouse");
    expect(new URLSearchParams(location.search).get("ownership")).toBe("editorial");
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    confirmSpy.mockRestore();
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

it("restores the saved alias page and keeps its cursor with the saved filters", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState(
    {},
    "",
    "/admin?tab=content&region=GB&q=Lighthouse&ownership=editorial&aliasPage=2&aliasCursor=00000000-0000-0000-0000-000000000001:50:0",
  );
  const requests: URL[] = [];
  const originalFetch = window.fetch;
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content-aliases") throw new Error(`Unexpected request: ${url}`);
    requests.push(url);
    return new Response(JSON.stringify({
      items: [{
        id: 150,
        titleId: 101,
        titleName: "The Lighthouse",
        titleType: "movie",
        titleYear: 2019,
        alias: "Lighthouse resumed page alias",
        language: "fr",
        sourceName: "Editorial",
        sourceUrl: null,
        isEditorial: true,
        collision: false,
        collisionTitleCount: 1,
        updatedAt: "2026-09-16T00:00:00.000Z",
      }],
      total: 51,
      limit: 50,
      offset: 0,
      nextCursor: null,
      previousCursor: "00000000-0000-0000-0000-000000000001:0",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByText("Page 2 · 51 matching aliases")).toBeVisible();
    await expect.element(page.getByText("Lighthouse resumed page alias")).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("cursor")).toBe("00000000-0000-0000-0000-000000000001:50:0");
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Lighthouse");
    expect(requests.at(-1)?.searchParams.get("ownership")).toBe("editorial");
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    window.history.replaceState({}, "", previousUrl);
  }
});

it.each([
  {
    description: "malformed",
    // The page recognizes the cursor shape, but the API rejects its leading zero.
    cursor: "00000000-0000-0000-0000-000000000099:0150:100",
    error: "Invalid alias snapshot cursor",
    explanation: "The saved page link is invalid, so this review cannot resume.",
    status: 400,
  },
  {
    description: "created with different filters",
    cursor: "00000000-0000-0000-0000-000000000099:150:100",
    error: "Alias snapshot cursor does not match the active filters",
    explanation: "The saved page was created with different search or ownership filters.",
    status: 400,
  },
  {
    description: "expired",
    cursor: "00000000-0000-0000-0000-000000000099:150:100",
    error: "This alias review snapshot expired. Restart the search.",
    explanation: "The saved review has expired. Restart the search to load the current results.",
    status: 409,
  },
])("explains why a saved alias continuation cannot resume when it is $description", async ({
  cursor: savedCursor,
  error,
  explanation,
  status,
}) => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState(
    {},
    "",
    `/admin?tab=content&region=GB&q=Lighthouse&ownership=editorial&aliasPage=4&aliasCursor=${encodeURIComponent(savedCursor)}`,
  );
  const requests: URL[] = [];
  const originalFetch = window.fetch;
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content-aliases") throw new Error(`Unexpected request: ${url}`);
    requests.push(url);
    const cursor = url.searchParams.get("cursor");
    if (cursor) {
      return new Response(JSON.stringify({ error }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      nextCursor: null,
      previousCursor: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    const alert = page.getByRole("alert");
    await expect.element(alert).toHaveTextContent("Could not load alternate titles.");
    await expect.element(alert).toHaveTextContent(explanation);
    await expect.element(alert).not.toHaveTextContent(savedCursor);
    expect(requests.at(-1)?.searchParams.get("cursor")).toBe(savedCursor);
    await expect.element(page.getByRole("button", { name: "Restart alternate-title review" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Restart alternate-title review" }));
    await expect.element(page.getByText("No alternate titles found")).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("cursor")).toBeNull();
    expect(new URLSearchParams(location.search).get("aliasCursor")).toBeNull();
    expect(new URLSearchParams(location.search).get("aliasPage")).toBeNull();
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
  const snapshotId = "123e4567-e89b-12d3-a456-426614174000";
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
    providerCitations: [],
    isEditorial: true,
    collision: false,
    collisionTitleCount: 1,
    updatedAt: "2026-09-16T00:00:00.000Z",
  });
  const snapshotIds = Array.from({ length: 51 }, (_, index) => 100 + index);
  let liveAliases = new Map(snapshotIds.map((id, index) =>
    [id, makeAlias(id, `Lighthouse alias ${String(index + 1).padStart(3, "0")}`)],
  ));
  let changedDuringReview = false;
  const originalFetch = window.fetch;
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content-aliases") throw new Error(`Unexpected request: ${url}`);
    requests.push(url);
    const cursor = url.searchParams.get("cursor");
    const cursorParts = cursor?.split(":");
    const snapshotOffset = cursorParts ? Number(cursorParts[1]) : 0;
    if (snapshotOffset > 0 && !changedDuringReview) {
      changedDuringReview = true;
      liveAliases.delete(100);
      liveAliases.set(150, makeAlias(150, "Lighthouse alias renamed ahead of the current page"));
      liveAliases.set(50, makeAlias(50, "Lighthouse inserted before this cursor"));
      liveAliases.set(151, makeAlias(151, "Lighthouse inserted after this cursor"));
    }
    const items = snapshotIds
      .slice(snapshotOffset, snapshotOffset + 50)
      .flatMap((id) => liveAliases.has(id) ? [liveAliases.get(id)!] : [])
      .map((alias) => ({
        ...alias,
        isEditorial: url.searchParams.get("ownership") !== "provider",
      }));
    const nextOffset = snapshotOffset + 50;
    return new Response(JSON.stringify({
      items,
      total: liveAliases.size,
      limit: 50,
      offset: snapshotOffset,
      nextCursor: nextOffset < snapshotIds.length
        ? `${snapshotId}:${nextOffset}:${snapshotOffset}`
        : null,
      previousCursor: snapshotOffset > 0
        ? `${snapshotId}:${Math.max(0, snapshotOffset - 50)}`
        : null,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByText("Page 1 · 51 matching aliases")).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("cursor")).toBeNull();
    expect(requests.at(-1)?.searchParams.has("offset")).toBe(false);
    await userEvent.click(page.getByRole("button", { name: "Next aliases" }));
    await expect.element(page.getByText("Page 2 · 52 matching aliases")).toBeVisible();
    await expect.element(page.getByText("Lighthouse alias renamed ahead of the current page")).toBeVisible();
    await expect.element(page.getByText("Lighthouse inserted after this cursor")).not.toBeInTheDocument();
    await expect.element(page.getByText("Lighthouse inserted before this cursor")).not.toBeInTheDocument();
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Lighthouse");
    expect(requests.at(-1)?.searchParams.get("ownership")).toBe("editorial");
    expect(requests.at(-1)?.searchParams.get("limit")).toBe("50");
    expect(requests.at(-1)?.searchParams.get("cursor")).toBe(`${snapshotId}:50:0`);
    expect(requests.at(-1)?.searchParams.has("offset")).toBe(false);
    expect(new URLSearchParams(location.search).get("aliasCursor")).toBe(`${snapshotId}:50:0`);
    expect(new URLSearchParams(location.search).get("aliasPage")).toBe("2");

    await userEvent.click(page.getByRole("button", { name: "Previous aliases" }));
    await expect.element(page.getByText("Page 1 · 52 matching aliases")).toBeVisible();
    await expect.element(page.getByText("Lighthouse inserted before this cursor")).not.toBeInTheDocument();
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Lighthouse");
    expect(requests.at(-1)?.searchParams.get("ownership")).toBe("editorial");
    expect(requests.at(-1)?.searchParams.get("cursor")).toBe(`${snapshotId}:0`);
    expect(requests.at(-1)?.searchParams.has("offset")).toBe(false);

    await userEvent.click(page.getByRole("button", { name: "Next aliases" }));
    await expect.element(page.getByText("Page 2 · 52 matching aliases")).toBeVisible();
    const ownership = page.getByRole("combobox", { name: "Alias ownership" });
    await userEvent.click(ownership);
    await userEvent.click(page.getByRole("option", { name: "Provider-owned" }));
    await expect.element(ownership).toHaveTextContent("Provider-owned");
    await expect.element(page.getByText("Page 1 · 52 matching aliases")).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Lighthouse");
    expect(requests.at(-1)?.searchParams.get("ownership")).toBe("provider");
    expect(requests.at(-1)?.searchParams.get("cursor")).toBeNull();
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    window.history.replaceState({}, "", previousUrl);
  }
});

it("keeps the selected alias page when an older page response finishes late", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=content&region=US");
  const snapshotId = "123e4567-e89b-12d3-a456-426614174001";
  const nextPageCursor = `${snapshotId}:50:0`;
  const requests: URL[] = [];
  const originalFetch = window.fetch;
  let resolveOlderPage!: (response: Response) => void;
  let markOlderPageRequested!: () => void;
  let markOlderPageCompleted!: () => void;
  const olderPageResponse = new Promise<Response>((resolve) => {
    resolveOlderPage = resolve;
  });
  const olderPageRequested = new Promise<void>((resolve) => {
    markOlderPageRequested = resolve;
  });
  const olderPageCompleted = new Promise<void>((resolve) => {
    markOlderPageCompleted = resolve;
  });
  const makeAlias = (id: number, alias: string) => ({
    id,
    titleId: 101,
    titleName: "The Lighthouse",
    titleType: "movie" as const,
    titleYear: 2019,
    alias,
    language: "en",
    sourceName: "TVMaze",
    sourceUrl: null,
    isEditorial: false,
    collision: false,
    collisionTitleCount: 1,
    updatedAt: "2026-09-16T00:00:00.000Z",
  });
  const firstPage = {
    items: [makeAlias(401, "First page alias")],
    total: 2,
    limit: 50,
    offset: 0,
    nextCursor: nextPageCursor,
    previousCursor: null,
  };
  const responseFor = (body: typeof firstPage) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  window.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content-aliases") {
      throw new Error(`Unexpected browser test request: ${url}`);
    }
    requests.push(url);
    if (url.searchParams.get("cursor") === nextPageCursor) {
      return Promise.resolve(responseFor({
        ...firstPage,
        items: [makeAlias(402, "Second page alias")],
        offset: 50,
        nextCursor: null,
        previousCursor: `${snapshotId}:0`,
      }));
    }
    markOlderPageRequested();
    return olderPageResponse.then((response) => {
      markOlderPageCompleted();
      return response;
    });
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(getListAdminContentAliasesQueryKey({ limit: 50 }), firstPage);
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByText("First page alias")).toBeVisible();
    await olderPageRequested;

    await userEvent.click(page.getByRole("button", { name: "Next aliases" }));
    await expect.element(page.getByText("Page 2 · 2 matching aliases")).toBeVisible();
    await expect.element(page.getByText("Second page alias")).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("cursor")).toBe(nextPageCursor);

    resolveOlderPage(responseFor(firstPage));
    await olderPageCompleted;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    await expect.element(page.getByText("Page 2 · 2 matching aliases")).toBeVisible();
    await expect.element(page.getByText("Second page alias")).toBeVisible();
    await expect.element(page.getByText("First page alias")).not.toBeInTheDocument();
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
      providerCitations: [
        {
          provider: "tvmaze",
          sourceName: "TVMaze",
          sourceUrl: "https://example.test/provider",
        },
        {
          provider: "wikipedia",
          sourceName: "EN Wikipedia",
          sourceUrl: "https://example.test/wikipedia",
        },
      ],
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
      providerCitations: [],
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
    await expect.element(page.getByRole("link", { name: "TVMaze" })).toHaveAttribute(
      "href",
      "https://example.test/provider",
    );
    await expect.element(page.getByRole("link", { name: "EN Wikipedia" })).toHaveAttribute(
      "href",
      "https://example.test/wikipedia",
    );
    await expect.element(page.getByRole("link", { name: "Wikipedia", exact: true })).not.toBeInTheDocument();
    expect(requests.filter((request) =>
      request.searchParams.get("ownership") === "provider",
    )).toHaveLength(1);

    await userEvent.click(ownership);
    await userEvent.click(page.getByRole("option", { name: "Editorial" }));
    await expect.element(page.getByText("Le Phare Editorial")).toBeVisible();
    await expect.element(page.getByText("Wikipedia", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Wikipedia", exact: true })).toHaveAttribute(
      "href",
      "https://example.test/editorial",
    );
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

it("keeps alias search results matched to the latest term when an older request finishes late", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=content&region=US&q=Oldtown");
  const requests: URL[] = [];
  const originalFetch = window.fetch;
  let resolveOldResponse!: (response: Response) => void;
  let notifyOldRequest!: () => void;
  let notifyOldFetchReturned!: () => void;
  let notifyLatestRequest!: () => void;
  const oldResponse = new Promise<Response>((resolve) => {
    resolveOldResponse = resolve;
  });
  const oldRequestStarted = new Promise<void>((resolve) => {
    notifyOldRequest = resolve;
  });
  const oldFetchReturned = new Promise<void>((resolve) => {
    notifyOldFetchReturned = resolve;
  });
  const latestRequestStarted = new Promise<void>((resolve) => {
    notifyLatestRequest = resolve;
  });
  const aliases = {
    old: {
      id: 411,
      titleId: 101,
      titleName: "Oldtown Film",
      titleType: "movie",
      titleYear: 2019,
      alias: "Oldtown Regional Name",
      language: "en",
      sourceName: "Wikipedia",
      sourceUrl: "https://example.test/oldtown",
      isEditorial: true,
      collision: false,
      collisionTitleCount: 1,
      updatedAt: "2026-09-16T00:00:00.000Z",
    },
    latest: {
      id: 412,
      titleId: 102,
      titleName: "Moonrise Film",
      titleType: "movie",
      titleYear: 2021,
      alias: "Moonrise Regional Name",
      language: "fr",
      sourceName: "Wikipedia",
      sourceUrl: "https://example.test/moonrise",
      isEditorial: true,
      collision: false,
      collisionTitleCount: 1,
      updatedAt: "2026-09-16T00:00:00.000Z",
    },
  };
  const responseFor = (items: (typeof aliases)[keyof typeof aliases][]) =>
    new Response(JSON.stringify({ items, total: items.length, limit: 50, offset: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  window.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content-aliases") {
      throw new Error(`Unexpected browser test request: ${url}`);
    }
    requests.push(url);
    const query = url.searchParams.get("q");
    if (query === "Oldtown") {
      notifyOldRequest();
      return oldResponse.then((response) => {
        notifyOldFetchReturned();
        return response;
      });
    }
    if (query === "Moonrise") {
      notifyLatestRequest();
      return Promise.resolve(responseFor([aliases.latest]));
    }
    throw new Error(`Unexpected alias search term: ${query}`);
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await oldRequestStarted;
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Oldtown");

    const search = page.getByPlaceholder("Search titles…");
    await userEvent.fill(search, "Moonrise");
    await latestRequestStarted;
    await expect.element(page.getByText("Moonrise Regional Name")).toBeVisible();
    await expect.element(page.getByText("Oldtown Regional Name")).not.toBeInTheDocument();
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Moonrise");

    const oldQuery = client.getQueryCache().getAll().find((query) =>
      query.queryKey[0] === "/api/admin/content-aliases" &&
      (query.queryKey[1] as { q?: string } | undefined)?.q === "Oldtown",
    );
    expect(oldQuery).toBeDefined();
    resolveOldResponse(responseFor([aliases.old]));
    await oldFetchReturned;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    await expect.element(page.getByText("Moonrise Regional Name")).toBeVisible();
    await expect.element(page.getByText("Oldtown Regional Name")).not.toBeInTheDocument();
    expect(requests.filter((request) =>
      request.searchParams.get("q") === "Oldtown",
    )).toHaveLength(1);
    expect(requests.filter((request) =>
      request.searchParams.get("q") === "Moonrise",
    )).toHaveLength(1);
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