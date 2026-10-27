import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { getSearchAdminContentQueryKey } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({
  refreshMutate: vi.fn(),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const api = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...api,
    useGetMe: () => ({ data: { isAdmin: true }, isLoading: false }),
    useGetAdminDashboard: () => ({ data: undefined }),
    useListAdminIntegrations: () => ({ data: [], isLoading: false }),
    useListAdminWikidataIdentityConflicts: () => ({
      data: { items: [], total: 0, limit: 25, offset: 0 },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }),
    useSearchAdminContent: (params: Parameters<typeof api.useSearchAdminContent>[0]) =>
      useQuery({
        queryKey: api.getSearchAdminContentQueryKey(params),
        queryFn: async () => params?.malformedRegionalClassification
          ? [{
              id: 901,
              name: "Unsupported rating fixture",
              type: "movie" as const,
              mappings: [],
              selectedRating: null,
              unclassifiedRating: {
                provider: "Fixture Provider",
                recordId: 902,
                classifications: [{
                  category: "UNSUPPORTED_SYSTEM",
                  label: "12",
                  score: null,
                  maxScore: null,
                  description: null,
                  severity: null,
                }],
                rawUpdatedAt: "infinity",
                sourceUrl: "https://provider.example/ratings/902",
              },
            }]
          : [],
        enabled: false,
      }),
    useListAdminContentAliases: () => ({
      data: { items: [], total: 0, limit: 50, offset: 0 },
      isLoading: false,
      isError: false,
      isFetching: false,
    }),
    useUpdateAdminContentAlias: () => ({ isPending: false, mutate: vi.fn() }),
    useDeleteAdminContentAlias: () => ({ isPending: false, mutate: vi.fn() }),
    useRefreshAdminContent: () => ({
      isPending: false,
      mutate: mocks.refreshMutate,
    }),
    useRefreshAdminContentBatch: () => ({ isPending: false, mutate: vi.fn() }),
    useGetAdminContentRefreshBatch: () => ({ data: undefined }),
    useListAdminContentRefreshBatchHistory: () => ({ data: [], isLoading: false }),
  };
});

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: async () => null }),
}));

import AdminPage from "@/pages/admin";

it("shows raw provider and classification details for an unclassified malformed record", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState(
    {},
    "",
    "/admin?tab=content&malformedRegionalClassification=true&malformedRefreshTimestampProvider=Fixture+Provider",
  );
  const params = {
    malformedRegionalClassification: true,
    malformedRefreshTimestampProvider: "Fixture Provider",
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    getSearchAdminContentQueryKey(params),
    [{
      id: 901,
      name: "Unsupported rating fixture",
      type: "movie" as const,
      mappings: [],
      selectedRating: null,
      unclassifiedRating: {
        provider: "Fixture Provider",
        recordId: 902,
        classifications: [{
          category: "UNSUPPORTED_SYSTEM",
          label: "12",
          score: null,
          maxScore: null,
          description: null,
          severity: null,
        }],
        rawUpdatedAt: "infinity",
        sourceUrl: "https://provider.example/ratings/902",
      },
    }],
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByText("Unsupported rating fixture", { exact: true })).toBeVisible();
    await expect.element(page.getByText(/Unclassified Fixture Provider rating/)).toBeVisible();
    await expect.element(page.getByText(/UNSUPPORTED_SYSTEM: 12/)).toBeVisible();
    await expect.element(page.getByText(/raw timestamp: infinity/)).toBeVisible();
    await expect.element(page.getByRole("link", { name: "View provider record" }))
      .toHaveAttribute("href", "https://provider.example/ratings/902");
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.history.replaceState({}, "", previousUrl);
  }
});
function malformedRating(id: number, name: string) {
  return {
    id,
    name,
    type: "movie" as const,
    mappings: [],
    selectedRating: {
      region: "US",
      countryName: "United States",
      system: "MPAA",
      label: "PG-13",
      sourceName: "Wikidata",
      recordId: id,
      lastRefreshedAt: null,
      sourceUrl: null,
      refreshTimestampMalformed: true,
    },
  };
}

it("removes a repaired last result immediately and returns to the previous review page", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState(
    {},
    "",
    "/admin?tab=content&region=US&malformedRefreshTimestamp=true&offset=50",
  );
  mocks.refreshMutate.mockImplementation(
    (_variables: unknown, options: { onSuccess?: (result: unknown) => void }) => {
      options.onSuccess?.({ ok: true, titleId: 999 });
    },
  );

  const params = {
    region: "US" as const,
    malformedRefreshTimestamp: true,
    offset: 50,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    getSearchAdminContentQueryKey(params),
    [malformedRating(999, "Last malformed title")],
  );
  client.setQueryData(
    getSearchAdminContentQueryKey({ ...params, offset: 0 }),
    Array.from({ length: 50 }, (_, index) =>
      malformedRating(index + 1, `Earlier malformed title ${index + 1}`),
    ),
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByText("Last malformed title", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Page 2", { exact: true })).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Wikidata", exact: true }));

    await expect.element(page.getByText("Last malformed title", { exact: true }))
      .not.toBeInTheDocument();
    await expect.element(page.getByText("Page 1", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Earlier malformed title 1", { exact: true }))
      .toBeVisible();
    expect(client.getQueryData(getSearchAdminContentQueryKey(params))).toEqual([]);
    expect(mocks.refreshMutate).toHaveBeenCalledWith(
      { id: 999, data: { provider: "wikidata" } },
      expect.any(Object),
    );
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    mocks.refreshMutate.mockReset();
    window.history.replaceState({}, "", previousUrl);
  }
});

it("keeps a failed Wikidata refresh visible with its region and allows another attempt", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState(
    {},
    "",
    "/admin?tab=content&region=US&malformedRefreshTimestamp=true&offset=0",
  );
  mocks.refreshMutate
    .mockImplementationOnce(
      (_variables: unknown, options: { onSuccess?: (result: unknown) => void }) => {
        options.onSuccess?.({
          ok: false,
          titleId: 1001,
          status: "provider_unavailable",
          error: "Wikidata is unavailable.",
        });
      },
    )
    .mockImplementationOnce(
      (_variables: unknown, options: { onSuccess?: (result: unknown) => void }) => {
        options.onSuccess?.({ ok: true, titleId: 1001 });
      },
    );

  const params = {
    region: "US" as const,
    malformedRefreshTimestamp: true,
    offset: 0,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    getSearchAdminContentQueryKey(params),
    [malformedRating(1001, "Unavailable provider title")],
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByText("Unavailable provider title", { exact: true })).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Wikidata", exact: true }));

    await expect.element(
      page.getByTestId("status-rating-refresh-failure-1001-US"),
    ).toHaveTextContent("Refresh failed for US: Wikidata is unavailable.");
    await expect.element(page.getByText("Unavailable provider title", { exact: true })).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Wikidata", exact: true }));

    await expect.element(page.getByText("Unavailable provider title", { exact: true }))
      .not.toBeInTheDocument();
    expect(mocks.refreshMutate).toHaveBeenCalledTimes(2);
    expect(mocks.refreshMutate).toHaveBeenNthCalledWith(
      1,
      { id: 1001, data: { provider: "wikidata" } },
      expect.any(Object),
    );
    expect(mocks.refreshMutate).toHaveBeenNthCalledWith(
      2,
      { id: 1001, data: { provider: "wikidata" } },
      expect.any(Object),
    );
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    mocks.refreshMutate.mockReset();
    window.history.replaceState({}, "", previousUrl);
  }
});
