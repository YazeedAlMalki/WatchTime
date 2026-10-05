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
  integrationListeners: new Set<() => void>(),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const api = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...api,
    useGetMe: () => ({ data: { isAdmin: true }, isLoading: false }),
    useGetAdminDashboard: () => ({ data: undefined }),
    useListAdminIntegrations: () => ({
      data: React.useSyncExternalStore(
        (listener) => {
          mocks.integrationListeners.add(listener);
          return () => mocks.integrationListeners.delete(listener);
        },
        () => mocks.integrations,
      ),
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

function publishIntegrations(integrations: unknown[]) {
  mocks.integrations = integrations;
  for (const listener of mocks.integrationListeners) listener();
}

it("uses the returned batch offset and processed count for the next resume offset", async () => {
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
      malformedRefreshTimestampCount: 4,
      sustainedFailureAlert: false,
      lowAccumulatedSuccessRateAlert: false,
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
      malformedRefreshTimestampCount: 0,
      sustainedFailureAlert: false,
      lowAccumulatedSuccessRateAlert: false,
    },
    {
      provider: "Wikidata",
      status: "healthy",
      lastSyncAt: "2026-09-24T09:00:00.000Z",
      lastSuccessAt: "2026-09-24T09:00:00.000Z",
      lastError: null,
      successRatePercent: 40,
      refreshAttempts: 5,
      successfulRefreshes: 2,
      mappedTitles: 0,
      missingMappings: 0,
      malformedRefreshTimestampCount: 0,
      sustainedFailureAlert: false,
      lowAccumulatedSuccessRateAlert: true,
    },
    {
      provider: "Attempts-only provider",
      status: "degraded",
      lastSyncAt: null,
      lastSuccessAt: null,
      lastError: null,
      successRatePercent: 66.7,
      refreshAttempts: 9,
      successfulRefreshes: null,
      mappedTitles: 0,
      missingMappings: 0,
      malformedRefreshTimestampCount: 0,
      sustainedFailureAlert: false,
    },
    {
      provider: "Successes-only provider",
      status: "healthy",
      lastSyncAt: null,
      lastSuccessAt: null,
      lastError: null,
      successRatePercent: 50,
      refreshAttempts: null,
      successfulRefreshes: 4,
      mappedTitles: 0,
      missingMappings: 0,
      malformedRefreshTimestampCount: 0,
      sustainedFailureAlert: false,
    },
  ];

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

it("hides the Wikidata warning after an updated health response clears it", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=integrations");
  publishIntegrations([
    {
      provider: "Wikidata",
      status: "healthy",
      lastSyncAt: "2026-09-24T09:00:00.000Z",
      lastSuccessAt: "2026-09-24T09:00:00.000Z",
      lastError: null,
      successRatePercent: 40,
      refreshAttempts: 5,
      successfulRefreshes: 2,
      mappedTitles: 0,
      missingMappings: 0,
      malformedRefreshTimestampCount: 0,
      sustainedFailureAlert: false,
      lowAccumulatedSuccessRateAlert: true,
    },
  ]);

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    const warning = page.getByText("Persistently low accumulated success rate");
    await expect.element(warning).toBeVisible();

    publishIntegrations([
      {
        provider: "Wikidata",
        status: "healthy",
        lastSyncAt: "2026-09-24T09:00:00.000Z",
        lastSuccessAt: "2026-09-24T09:00:00.000Z",
        lastError: null,
        successRatePercent: 50,
        refreshAttempts: 6,
        successfulRefreshes: 3,
        mappedTitles: 0,
        missingMappings: 0,
        malformedRefreshTimestampCount: 0,
        sustainedFailureAlert: false,
        lowAccumulatedSuccessRateAlert: false,
      },
    ]);

    await expect.element(warning).not.toBeInTheDocument();
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    mocks.integrations = [];
    window.history.replaceState({}, "", previousUrl);
  }
});

it("shows the active provider and offset and prevents starting another batch", async () => {
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
      malformedRefreshTimestampCount: 4,
      sustainedFailureAlert: false,
      lowAccumulatedSuccessRateAlert: false,
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
      malformedRefreshTimestampCount: 0,
      sustainedFailureAlert: false,
      lowAccumulatedSuccessRateAlert: false,
    },
    {
      provider: "Wikidata",
      status: "healthy",
      lastSyncAt: "2026-09-24T09:00:00.000Z",
      lastSuccessAt: "2026-09-24T09:00:00.000Z",
      lastError: null,
      successRatePercent: 40,
      refreshAttempts: 5,
      successfulRefreshes: 2,
      mappedTitles: 0,
      missingMappings: 0,
      malformedRefreshTimestampCount: 0,
      sustainedFailureAlert: false,
      lowAccumulatedSuccessRateAlert: true,
    },
    {
      provider: "Attempts-only provider",
      status: "degraded",
      lastSyncAt: null,
      lastSuccessAt: null,
      lastError: null,
      successRatePercent: 66.7,
      refreshAttempts: 9,
      successfulRefreshes: null,
      mappedTitles: 0,
      missingMappings: 0,
      malformedRefreshTimestampCount: 0,
      sustainedFailureAlert: false,
    },
    {
      provider: "Successes-only provider",
      status: "healthy",
      lastSyncAt: null,
      lastSuccessAt: null,
      lastError: null,
      successRatePercent: 50,
      refreshAttempts: null,
      successfulRefreshes: 4,
      mappedTitles: 0,
      missingMappings: 0,
      malformedRefreshTimestampCount: 0,
      sustainedFailureAlert: false,
    },
  ];

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

it("shows refresh counts only when both are available and keeps partial health percentage-only", async () => {
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
      malformedRefreshTimestampCount: 4,
      sustainedFailureAlert: false,
      lowAccumulatedSuccessRateAlert: false,
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
      malformedRefreshTimestampCount: 0,
      sustainedFailureAlert: false,
      lowAccumulatedSuccessRateAlert: false,
    },
    {
      provider: "Wikidata",
      status: "healthy",
      lastSyncAt: "2026-09-24T09:00:00.000Z",
      lastSuccessAt: "2026-09-24T09:00:00.000Z",
      lastError: null,
      successRatePercent: 40,
      refreshAttempts: 5,
      successfulRefreshes: 2,
      mappedTitles: 0,
      missingMappings: 0,
      malformedRefreshTimestampCount: 0,
      sustainedFailureAlert: false,
      lowAccumulatedSuccessRateAlert: true,
    },
    {
      provider: "Attempts-only provider",
      status: "degraded",
      lastSyncAt: null,
      lastSuccessAt: null,
      lastError: null,
      successRatePercent: 66.7,
      refreshAttempts: 9,
      successfulRefreshes: null,
      mappedTitles: 0,
      missingMappings: 0,
      malformedRefreshTimestampCount: 0,
      sustainedFailureAlert: false,
    },
    {
      provider: "Successes-only provider",
      status: "healthy",
      lastSyncAt: null,
      lastSuccessAt: null,
      lastError: null,
      successRatePercent: 50,
      refreshAttempts: null,
      successfulRefreshes: 4,
      mappedTitles: 0,
      missingMappings: 0,
      malformedRefreshTimestampCount: 0,
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

    const wikidataCard = Array.from(
      container.querySelectorAll<HTMLElement>("h3"),
    ).find((heading) => heading.textContent === "Wikidata")?.closest("div.bg-card");
    const attemptsOnlyCard = Array.from(
      container.querySelectorAll<HTMLElement>("h3"),
    ).find((heading) => heading.textContent === "Attempts-only provider")?.closest("div.bg-card");
    const successesOnlyCard = Array.from(
      container.querySelectorAll<HTMLElement>("h3"),
    ).find((heading) => heading.textContent === "Successes-only provider")?.closest("div.bg-card");
    expect(wikidataCard?.textContent).toContain("healthy");
    expect(wikidataCard?.textContent).toContain(
      "Persistently low accumulated success rate",
    );
    expect(wikidataCard?.textContent).toContain(
      "A recent successful refresh does not clear this warning.",
    );
    expect(attemptsOnlyCard?.textContent).toContain("66.7%");
    expect(attemptsOnlyCard?.textContent).not.toContain("refreshes");
    expect(successesOnlyCard?.textContent).toContain("50%");
    expect(successesOnlyCard?.textContent).not.toContain("refreshes");

    const malformedAlert = countedCard?.querySelector('[role="alert"]');
    expect(malformedAlert?.textContent).toContain(
      "Malformed rating timestamps detected",
    );
    expect(malformedAlert?.textContent).toContain(
      "This data quality warning does not change provider health status.",
    );
    expect(legacyCard?.querySelector('[role="alert"]')).toBeNull();

    await userEvent.click(
      page.getByRole("link", { name: "Review affected ratings" }),
    );
    await expect
      .element(
        page.getByRole("checkbox", {
          name: "Only ratings with malformed refresh timestamps",
        }),
      )
      .toBeChecked();
    const reviewUrl = new URL(location.href);
    expect(reviewUrl.searchParams.get("tab")).toBe("content");
    expect(reviewUrl.searchParams.get("malformedRefreshTimestamp")).toBe(
      "true",
    );
    expect(
      reviewUrl.searchParams.get("malformedRefreshTimestampProvider"),
    ).toBe("Counted provider");
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    mocks.integrations = [];
    window.history.replaceState({}, "", previousUrl);
  }
});
