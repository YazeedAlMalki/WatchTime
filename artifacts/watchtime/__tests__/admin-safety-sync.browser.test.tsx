import React from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const batchResponse = {
  ok: true as const,
  offset: 7,
  limit: 2,
  processed: 2,
  results: [
    {
      ok: false as const,
      titleId: 701,
      titleName: "First safety sync title",
      status: "missing" as const,
      error: "No provider match",
    },
    {
      ok: false as const,
      titleId: 702,
      titleName: "Second safety sync title",
      status: "missing" as const,
      error: "No provider match",
    },
  ],
};

const mocks = vi.hoisted(() => ({
  batchMutate: vi.fn(),
  batchStatus: undefined as unknown,
  batchStatusListeners: new Set<() => void>(),
  integrations: [] as unknown[],
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const api = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...api,
    useGetMe: () => ({ data: { isAdmin: true }, isLoading: false }),
    useGetAdminDashboard: () => ({ data: undefined }),
    useListAdminIntegrations: () => ({
      data: mocks.integrations,
      isLoading: false,
    }),
    useListCatalogRefreshes: () => ({ data: [] }),
    useStartCatalogRefresh: () => ({ isPending: false, mutate: vi.fn() }),
    useRetryCatalogRefresh: () => ({ isPending: false, mutate: vi.fn() }),
    useGetAdminContentRefreshBatch: () => ({
      data: React.useSyncExternalStore(
        (listener) => {
          mocks.batchStatusListeners.add(listener);
          return () => mocks.batchStatusListeners.delete(listener);
        },
        () => mocks.batchStatus,
      ),
    }),
    useSearchAdminContent: () => ({
      data: [],
      isLoading: false,
      isError: false,
      isFetching: false,
    }),
    useListAdminContentAliases: () => ({
      data: { items: [], total: 0, limit: 50, offset: 0 },
      isLoading: false,
      isError: false,
      isFetching: false,
    }),
    useRefreshAdminContent: () => ({ isPending: false, mutate: vi.fn() }),
    useRefreshAdminContentBatch: () => ({
      isPending: false,
      mutate: mocks.batchMutate,
    }),
  };
});
vi.mock("@clerk/react", () => ({ useAuth: () => ({ getToken: async () => null }) }));

import AdminPage from "@/pages/admin";

it("uses the returned batch offset and processed count for the next resume offset", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=content&region=US");
  mocks.batchStatus = {
    lastCompleted: {
      id: 90,
      provider: "does_the_dog_die",
      status: "completed",
      limit: 2,
      offset: 1,
      processed: 2,
      nextOffset: 3,
      catalogFingerprint: "saved-catalog",
      results: [],
      startedAt: "2026-09-24T09:00:00.000Z",
      completedAt: "2026-09-24T09:01:00.000Z",
      mapped: 0,
      missing: 0,
      errors: 0,
      error: null,
    },
    running: null,
    interrupted: null,
  };
  mocks.batchMutate.mockImplementation((_variables: unknown, options?: {
    onSuccess?: (result: typeof batchResponse) => void;
  }) => {
    options?.onSuccess?.(batchResponse);
    mocks.batchStatus = {
      lastCompleted: {
        id: 92,
        provider: "does_the_dog_die",
        status: "completed",
        limit: batchResponse.limit,
        offset: batchResponse.offset,
        processed: batchResponse.processed,
        nextOffset: batchResponse.offset + batchResponse.processed,
        catalogFingerprint: "saved-catalog",
        results: batchResponse.results,
        startedAt: "2026-09-24T09:02:00.000Z",
        completedAt: "2026-09-24T09:03:00.000Z",
        mapped: 0,
        missing: 2,
        errors: 0,
        error: null,
      },
      running: null,
      interrupted: null,
    };
    for (const listener of mocks.batchStatusListeners) listener();
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByText("Initial safety sync")).toBeVisible();

    await userEvent.fill(page.getByLabelText("Titles per batch"), "2");
    await userEvent.fill(page.getByLabelText("Resume offset"), "3");
    await userEvent.click(page.getByRole("button", { name: "Run batch refresh" }));

    expect(mocks.batchMutate).toHaveBeenCalledWith(
      {
        data: {
          provider: "does_the_dog_die",
          limit: 2,
          offset: 3,
          catalogFingerprint: "saved-catalog",
        },
      },
      expect.any(Object),
    );
    await expect.element(page.getByText("Next resume offset:")).toHaveTextContent("9");
    await userEvent.click(page.getByRole("button", { name: "Use next offset" }));
    await expect.element(page.getByLabelText("Resume offset")).toHaveValue(9);
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    mocks.batchMutate.mockReset();
    mocks.batchStatus = undefined;
    mocks.batchStatusListeners.clear();
    window.history.replaceState({}, "", previousUrl);
  }
});

it("shows the active provider and offset and prevents starting another batch", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=content&region=US");
  mocks.batchStatus = {
    running: {
      id: 91,
      provider: "wikidata",
      status: "running",
      limit: 3,
      offset: 5,
      processed: 0,
      mapped: 0,
      missing: 0,
      errors: 0,
      nextOffset: 5,
      catalogFingerprint: null,
      results: [],
      startedAt: "2026-09-24T10:00:00.000Z",
      completedAt: null,
      error: null,
    },
    lastCompleted: null,
    interrupted: null,
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByText("Batch request in progress")).toBeVisible();
    const activeStatus = page
      .getByRole("status")
      .filter({ hasText: "Batch request in progress" });
    await expect.element(activeStatus.getByText(/Wikidata/)).toBeVisible();
    await expect.element(page.getByText(/from offset 5/)).toBeVisible();
    await expect.element(
      page.getByRole("button", { name: "Batch refresh running…" }),
    ).toBeDisabled();
    expect(mocks.batchMutate).not.toHaveBeenCalled();
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    mocks.batchMutate.mockReset();
    mocks.batchStatus = undefined;
    mocks.batchStatusListeners.clear();
    window.history.replaceState({}, "", previousUrl);
  }
});

it("shows refresh counts when available and keeps legacy health percentage-only", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=integrations");
  mocks.integrations = [
    {
      provider: "Counted provider",
      status: "degraded",
      lastSyncAt: null,
      lastSuccessAt: null,
      lastError: null,
      successRatePercent: (3 / 7) * 100,
      refreshAttempts: 7,
      successfulRefreshes: 3,
      mappedTitles: 0,
      missingMappings: 0,
      sustainedFailureAlert: false,
    },
    {
      provider: "Legacy provider",
      status: "healthy",
      lastSyncAt: null,
      lastSuccessAt: null,
      lastError: null,
      successRatePercent: 83.3,
      refreshAttempts: null,
      successfulRefreshes: null,
      mappedTitles: 0,
      missingMappings: 0,
      sustainedFailureAlert: false,
    },
  ];

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByText("Integration Health")).toBeVisible();

    const countedCard = Array.from(
      container.querySelectorAll<HTMLElement>("h3"),
    ).find((heading) => heading.textContent === "Counted provider")?.closest("div.bg-card");
    const legacyCard = Array.from(
      container.querySelectorAll<HTMLElement>("h3"),
    ).find((heading) => heading.textContent === "Legacy provider")?.closest("div.bg-card");

    expect(countedCard?.textContent).toContain("42.9% (3/7 refreshes)");
    expect(legacyCard?.textContent).toContain("83.3%");
    expect(legacyCard?.textContent).not.toContain("refreshes");
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    mocks.integrations = [];
    window.history.replaceState({}, "", previousUrl);
  }
});