import React from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const api = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...api,
    useGetMe: () => ({ data: { isAdmin: true }, isLoading: false }),
    useGetAdminDashboard: () => ({ data: undefined }),
    useListAdminIntegrations: () => ({ data: [], isLoading: false }),
    useListAdminWikidataIdentityConflicts: () => ({
      data: {
        items: [{
          id: 502,
          titleId: 101,
          titleName: "Reviewed fixture",
          titleType: "movie",
          imdbId: "tt1234567",
          conflictingEntityIds: ["Q42", "Q43"],
          verifiedWikidataId: "Q42",
          error: "Ambiguous match",
          detectedAt: "2026-10-01T00:00:00.000Z",
          reviewedAt: "2026-10-02T00:00:00.000Z",
          reviewedByAdminId: "admin-reviewer",
          reviewedByAdminEmail: "reviewer@example.test",
        }],
        hasMore: false,
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }),
    useSearchAdminContent: () => ({ data: [], isLoading: false, isError: false }),
    useGetAdminContentMappingCounts: () => ({ data: [], isLoading: false }),
    useListAdminContentAliases: () => ({
      data: { items: [], total: 0, limit: 50, offset: 0 },
      isLoading: false,
      isError: false,
      isFetching: false,
    }),
    useListAdminContentRefreshBatchHistory: () => ({
      data: [],
      isLoading: false,
      isError: false,
    }),
    useGetAdminContentRefreshBatch: () => ({ data: undefined }),
    useRefreshAdminContent: () => ({ isPending: false, mutate: vi.fn() }),
    useRefreshAdminContentBatch: () => ({ isPending: false, mutate: vi.fn() }),
    useReviewAdminWikidataIdentityConflict: () => ({ isPending: false, mutate: vi.fn() }),
    useCorrectAdminUnclassifiedRating: () => ({ isPending: false, mutate: vi.fn() }),
    useDismissAdminUnclassifiedRating: () => ({ isPending: false, mutate: vi.fn() }),
  };
});

vi.mock("@clerk/react", () => ({ useAuth: () => ({ getToken: async () => null }) }));

import AdminPage from "@/pages/admin";

it("shows the reviewing account on acknowledged Wikidata conflicts", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  window.history.replaceState({}, "", "/admin?tab=content&region=US");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await userEvent.click(page.getByRole("button", { name: "Include reviewed" }));
    await expect.element(page.getByText("Reviewed by reviewer@example.test")).toBeVisible();
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.history.replaceState({}, "", previousUrl);
  }
});
