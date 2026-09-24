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
    return new Response(JSON.stringify(failed ? { error: "Unavailable" } : []), {
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
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
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