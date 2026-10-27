import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { GetMyShowsParams } from "@workspace/api-client-react";
import MyShowsPage from "../src/pages/my-shows";

const api = vi.hoisted(() => ({
  getMyShows: vi.fn(),
  getMyInProgressShows: vi.fn(),
}));

const unfinishedShow = {
  title: { id: 1, name: "Unfinished Show", genres: [] },
  watchedEpisodes: 1,
  totalEpisodes: 2,
  nextEpisode: { id: 11, seasonNumber: 1, episodeNumber: 2, name: "Next Episode" },
};
const caughtUpShow = {
  title: { id: 2, name: "Caught Up Show", genres: [] },
  watchedEpisodes: 2,
  totalEpisodes: 2,
  nextEpisode: null,
};
const trackedShow = (id: number, name: string, inProgress = true) => ({
  title: { id, name, genres: [] },
  watchedEpisodes: inProgress ? 1 : 2,
  totalEpisodes: 2,
  nextEpisode: inProgress
    ? { id: id * 10, seasonNumber: 1, episodeNumber: 2, name: "Next Episode" }
    : null,
});
vi.mock("wouter", async (importOriginal) => {
  const original = await importOriginal<typeof import("wouter")>();
  return {
    ...original,
    Link: ({ children, href }: { children: React.ReactNode; href: string }) =>
      <a href={href}>{children}</a>,
  };
});
vi.mock("@clerk/react", () => ({ useUser: () => ({ isSignedIn: true }) }));
vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...original,
    getMyShows: api.getMyShows,
    getMyInProgressShows: api.getMyInProgressShows,
    getMyMovies: async () => [],
    useGetMyRecentActivity: () => ({ data: [], isLoading: false }),
    useMarkEpisodeWatched: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

async function until(assertion: () => void) {
  for (let attempt = 0; attempt < 70; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 69) throw error;
    }
  }
}

afterEach(() => {
  vi.clearAllMocks();
});

it("filters by server status and combines the selected status with search", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  api.getMyShows.mockImplementation(async (params: GetMyShowsParams = {}) => {
    if (params.q) return [];
    if (params.status === "up-next") return [unfinishedShow];
    if (params.status === "caught-up") return [caughtUpShow];
    return [unfinishedShow, caughtUpShow];
  });
  api.getMyInProgressShows.mockResolvedValue([unfinishedShow]);
  const location = memoryLocation({ path: "/my-shows", record: true });

  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => root.render(
      <Router hook={location.hook}>
        <QueryClientProvider client={client}>
          <Switch>
            <Route path="/my-shows"><MyShowsPage /></Route>
            <Route path="/title/:id"><p>Title detail</p></Route>
          </Switch>
        </QueryClientProvider>
      </Router>,
    ));
    await until(() => expect(container.textContent).toContain("Unfinished Show"));

    await act(async () => {
      (container.querySelector('[data-testid="filter-shows-up-next"]') as HTMLButtonElement).click();
    });
    await until(() => {
      expect(api.getMyShows).toHaveBeenCalledWith(
        expect.objectContaining({ status: "up-next", q: undefined }),
        expect.anything(),
      );
      expect(container.textContent).toContain("Unfinished Show");
      expect(container.textContent).not.toContain("Caught Up Show");
    });

    await act(async () => {
      (container.querySelector('[data-testid="filter-shows-caught-up"]') as HTMLButtonElement).click();
    });
    await until(() => {
      expect(api.getMyShows).toHaveBeenCalledWith(
        expect.objectContaining({ status: "caught-up", q: undefined }),
        expect.anything(),
      );
      expect(container.textContent).toContain("Caught Up Show");
      expect(container.textContent).not.toContain("Unfinished Show");
      expect(location.history?.at(-1)).toBe("/my-shows?status=caught-up");
    });

    const previousMyShowsUrl = location.history?.at(-1);
    await act(async () => {
      location.navigate("/title/2");
    });
    expect(container.textContent).toContain("Title detail");
    await act(async () => {
      location.navigate(previousMyShowsUrl!);
    });
    await until(() => {
      expect(container.querySelector<HTMLButtonElement>('[data-testid="filter-shows-caught-up"]')?.getAttribute("aria-pressed")).toBe("true");
    });

    const searchInput = container.querySelector<HTMLInputElement>('[data-testid="input-search-shows"]')!;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(searchInput, "Completion");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await until(() => {
      expect(api.getMyShows).toHaveBeenCalledWith(
        expect.objectContaining({ status: "caught-up", q: "Completion" }),
        expect.anything(),
      );
      expect(container.textContent).toContain("No shows match your search and filters.");
      expect(location.history?.at(-1)).toBe("/my-shows?status=caught-up&q=Completion");
    });

    await act(async () => {
      (container.querySelector('[data-testid="button-clear-show-filters"]') as HTMLButtonElement).click();
    });
    await until(() => {
      expect(container.querySelector<HTMLInputElement>('[data-testid="input-search-shows"]')?.value).toBe("");
      expect(container.querySelector<HTMLButtonElement>('[data-testid="filter-shows-all"]')?.getAttribute("aria-pressed")).toBe("true");
      expect(location.history?.at(-1)).toBe("/my-shows");
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  }
});

it("keeps filtered search criteria across pages and resets results when criteria change", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const firstPage = Array.from({ length: 24 }, (_, index) =>
    trackedShow(124 - index, `Completion ${124 - index}`),
  );
  const secondPage = [trackedShow(100, "Completion 100"), trackedShow(99, "Completion 99")];
  api.getMyShows.mockImplementation(async (params: GetMyShowsParams = {}) => {
    if (params.q === "Completion" && params.status === "up-next") {
      if (params.beforeId === undefined) return firstPage;
      if (params.beforeId === 101) return secondPage;
    }
    if (params.q === "Completion" && params.status === "caught-up") {
      return [trackedShow(50, "Completion Caught Up", false)];
    }
    if (params.q === "Another" && params.status === "caught-up") {
      return [trackedShow(40, "Another Caught Up", false)];
    }
    return [];
  });
  api.getMyInProgressShows.mockResolvedValue([]);

  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const location = memoryLocation({ path: "/my-shows", record: true });
  const getShowNames = () =>
    Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="/title/"]'))
      .map((link) => link.textContent?.trim())
      .filter((name): name is string => !!name);

  try {
    await act(async () => root.render(
      <Router hook={location.hook}>
        <QueryClientProvider client={client}><MyShowsPage /></QueryClientProvider>
      </Router>,
    ));

    await act(async () => {
      (container.querySelector('[data-testid="filter-shows-up-next"]') as HTMLButtonElement).click();
    });
    const searchInput = container.querySelector<HTMLInputElement>('[data-testid="input-search-shows"]')!;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(searchInput, "Completion");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await until(() => {
      expect(api.getMyShows).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 24,
          beforeId: undefined,
          status: "up-next",
          q: "Completion",
        }),
        expect.anything(),
      );
      expect(container.textContent).toContain("Completion 101");
    });

    await act(async () => {
      (Array.from(container.querySelectorAll("button")).find(button =>
        button.textContent?.includes("Load more up-next shows"),
      ) as HTMLButtonElement).click();
    });
    await until(() => expect(container.textContent).toContain("Completion 99"));
    expect(api.getMyShows).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 24,
        beforeId: 101,
        status: "up-next",
        q: "Completion",
      }),
      expect.anything(),
    );
    expect(getShowNames()).toEqual(
      Array.from({ length: 24 }, (_, index) => `Completion ${124 - index}`)
        .concat("Completion 100", "Completion 99"),
    );

    await act(async () => {
      (container.querySelector('[data-testid="filter-shows-caught-up"]') as HTMLButtonElement).click();
    });
    await until(() => {
      expect(container.textContent).toContain("Completion Caught Up");
      expect(container.textContent).not.toContain("Completion 124");
    });
    expect(api.getMyShows).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 24,
        beforeId: undefined,
        status: "caught-up",
        q: "Completion",
      }),
      expect.anything(),
    );

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(searchInput, "Another");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("Completion Caught Up");
    await until(() => {
      expect(container.textContent).toContain("Another Caught Up");
      expect(container.textContent).not.toContain("Completion Caught Up");
    });
    expect(api.getMyShows).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 24,
        beforeId: undefined,
        status: "caught-up",
        q: "Another",
      }),
      expect.anything(),
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  }
});

it("loads the search and progress filter from a direct My Shows link", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  api.getMyShows.mockResolvedValue([unfinishedShow]);
  api.getMyInProgressShows.mockResolvedValue([unfinishedShow]);
  const location = memoryLocation({
    path: "/my-shows?q=unfinished&status=up-next",
    record: true,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => root.render(
      <Router hook={location.hook}>
        <QueryClientProvider client={client}>
          <Switch>
            <Route path="/my-shows"><MyShowsPage /></Route>
            <Route path="/title/:id"><p>Title detail</p></Route>
          </Switch>
        </QueryClientProvider>
      </Router>,
    ));
    await until(() => {
      expect(container.querySelector<HTMLInputElement>('[data-testid="input-search-shows"]')?.value).toBe("unfinished");
      expect(container.querySelector<HTMLButtonElement>('[data-testid="filter-shows-up-next"]')?.getAttribute("aria-pressed")).toBe("true");
      expect(api.getMyShows).toHaveBeenCalledWith(
        expect.objectContaining({ q: "unfinished", status: "up-next" }),
        expect.anything(),
      );
      expect(container.textContent).toContain("Unfinished Show");
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  }
});

it("shows the matched alternate title beneath the canonical title without merging in-progress shows", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const alternateMatch = {
    title: { id: 43, name: "Canonical Show Name", genres: [] },
    matchedAlternateTitle: "Local Show Name",
    watchedEpisodes: 2,
    totalEpisodes: 2,
    nextEpisode: null,
  };
  const canonicalMatch = {
    title: { id: 42, name: "Regular Canonical Show", genres: [] },
    matchedAlternateTitle: null,
    watchedEpisodes: 1,
    totalEpisodes: 2,
    nextEpisode: { id: 42, seasonNumber: 1, episodeNumber: 2, name: "Next Episode" },
  };
  const inProgressOnlyShow = {
    title: { id: 44, name: "In-Progress Feed Only", genres: [] },
    matchedAlternateTitle: null,
    watchedEpisodes: 1,
    totalEpisodes: 2,
    nextEpisode: { id: 44, seasonNumber: 1, episodeNumber: 2, name: "Next Episode" },
  };
  api.getMyShows.mockImplementation(async (params: GetMyShowsParams = {}) => (
    params.q ? [alternateMatch] : [canonicalMatch]
  ));
  api.getMyInProgressShows.mockResolvedValue([inProgressOnlyShow]);

  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => root.render(
      <QueryClientProvider client={client}><MyShowsPage /></QueryClientProvider>,
    ));
    await until(() => {
      expect(container.textContent).toContain("Regular Canonical Show");
      expect(container.textContent).toContain("In-Progress Feed Only");
    });
    expect(container.textContent).not.toContain("Matched:");

    const searchInput = container.querySelector<HTMLInputElement>('[data-testid="input-search-shows"]')!;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(searchInput, "Local Show Name");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await until(() => {
      expect(api.getMyShows).toHaveBeenCalledWith(
        expect.objectContaining({ q: "Local Show Name" }),
        expect.anything(),
      );
      expect(container.textContent).toContain("Canonical Show Name");
      expect(container.textContent).toContain("Matched: Local Show Name");
      expect(container.querySelector('[data-testid="text-matched-alternate-title-43"]')).not.toBeNull();
      expect(Array.from(container.querySelectorAll('a[href="/title/43"]'))
        .some((link) => link.textContent === "Canonical Show Name")).toBe(true);
      expect(container.textContent).not.toContain("In-Progress Feed Only");
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  }
});
