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
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const api = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...api,
    useGetMe: () => ({ data: { isAdmin: true }, isLoading: false }),
    useGetAdminDashboard: () => ({ data: undefined }),
    useSearchAdminContent: () => ({
      data: [],
      isLoading: false,
      isError: false,
      isFetching: false,
    }),
    useListAdminContentAliases: () => ({
      data: [],
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
  mocks.batchMutate.mockImplementation((_variables: unknown, options?: {
    onSuccess?: (result: typeof batchResponse) => void;
  }) => {
    options?.onSuccess?.(batchResponse);
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
      { data: { provider: "does_the_dog_die", limit: 2, offset: 3 } },
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
    window.history.replaceState({}, "", previousUrl);
  }
});