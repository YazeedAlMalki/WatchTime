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
    useSearchAdminContent: (params: Parameters<typeof api.useSearchAdminContent>[0]) =>
      useQuery({
        queryKey: api.getSearchAdminContentQueryKey(params),
        queryFn: async () => [],
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
