import React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const api = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...api,
    useGetMe: () => ({ data: { isAdmin: true }, isLoading: false }),
    useGetAdminDashboard: () => ({ data: {} }),
    useListAdminIntegrations: () => ({ data: [], isLoading: false }),
    useListAdminWikidataIdentityConflicts: () => ({
      data: { items: [], total: 0, limit: 25, offset: 0 },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }),
    useListAdminContentAliases: () => ({
      data: { items: [], total: 0, limit: 50, offset: 0 },
      isLoading: false,
    }),
    useRefreshAdminContent: () => ({ isPending: false, mutate: vi.fn() }),
    useRefreshAdminContentBatch: () => ({ isPending: false, mutate: vi.fn() }),
    useUpdateAdminContentAlias: () => ({ isPending: false, mutate: vi.fn() }),
    useDeleteAdminContentAlias: () => ({ isPending: false, mutate: vi.fn() }),
  };
});

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: async () => null }),
}));

import AdminPage from "@/pages/admin";

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });

it("restores mapping filters, page, and matching titles with browser Back and Forward", async () => {
  const previousUrl = `${location.pathname}${location.search}`;
  const originalFetch = window.fetch;
  const requestUrls: URL[] = [];
  window.history.replaceState({}, "", "/admin?tab=content");
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
    if (url.pathname !== "/api/admin/content") {
      throw new Error(`Unexpected browser test request: ${url}`);
    }
    requestUrls.push(url);
    const provider = url.searchParams.get("mappingProvider") || "All providers";
    const status = url.searchParams.get("mappingStatus") || "all";
    const offset = Number(url.searchParams.get("offset") || 0);
    const title = `${provider} · ${status} · page ${offset / 50 + 1}`;
    const count = offset === 0 && provider === "TMDB" && status === "missing" ? 51 : 1;
    return json(Array.from({ length: count }, (_, index) => ({
      id: offset + index + 1,
      name: index === 0 ? title : `TMDB · missing · page 1 extra ${index}`,
      type: "movie",
      mappings: [],
    })));
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

  const navigateHistory = async (direction: "back" | "forward") => {
    const popped = new Promise<void>((resolve) => {
      window.addEventListener("popstate", () => resolve(), { once: true });
    });
    if (direction === "back") window.history.back();
    else window.history.forward();
    await popped;
  };

  try {
    root.render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);
    await expect.element(page.getByText("All providers · all · page 1")).toBeVisible();

    await userEvent.fill(page.getByLabelText("Mapping provider"), "TMDB");
    await expect.element(page.getByText("TMDB · all · page 1")).toBeVisible();
    await userEvent.click(page.getByRole("combobox", { name: "Mapping status" }));
    await userEvent.click(page.getByRole("option", { name: "Missing" }));
    await expect.element(page.getByText("TMDB · missing · page 1", { exact: true })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Next page" }));
    await expect.element(page.getByText("TMDB · missing · page 2")).toBeVisible();

    await navigateHistory("back");
    await expect.element(page.getByText("TMDB · missing · page 1", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Page 1", { exact: true })).toBeVisible();
    await navigateHistory("back");
    await expect.element(page.getByRole("combobox", { name: "Mapping status" })).toHaveTextContent("All statuses");
    await expect.element(page.getByText("TMDB · all · page 1", { exact: true })).toBeVisible();
    await navigateHistory("back");
    await expect.element(page.getByLabelText("Mapping provider")).toHaveValue("");
    await expect.element(page.getByText("All providers · all · page 1", { exact: true })).toBeVisible();

    await navigateHistory("forward");
    await expect.element(page.getByLabelText("Mapping provider")).toHaveValue("TMDB");
    await expect.element(page.getByText("TMDB · all · page 1", { exact: true })).toBeVisible();
    await navigateHistory("forward");
    await expect.element(page.getByRole("combobox", { name: "Mapping status" })).toHaveTextContent("Missing");
    await expect.element(page.getByText("TMDB · missing · page 1", { exact: true })).toBeVisible();
    await navigateHistory("forward");
    await expect.element(page.getByText("TMDB · missing · page 2", { exact: true })).toBeVisible();

    expect(requestUrls.some((url) =>
      url.searchParams.get("mappingProvider") === "TMDB" &&
      url.searchParams.get("mappingStatus") === "missing" &&
      url.searchParams.get("offset") === "50",
    )).toBe(true);
  } finally {
    root.unmount();
    container.remove();
    client.clear();
    window.fetch = originalFetch;
    window.history.replaceState({}, "", previousUrl);
  }
});
