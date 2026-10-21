import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import {
  getGetMyMoviesQueryKey,
  getGetMyShowsQueryKey,
  getGetMyInProgressShowsQueryKey,
  getGetMyRecentActivityQueryKey,
} from "@workspace/api-client-react";
import TitleDetailPage from "../src/pages/title-detail";
import MyShowsPage from "../src/pages/my-shows";

const server = vi.hoisted(() => ({
  watched: false,
  titleIsMovie: false,
  movieWatched: false,
  activityFetch: vi.fn(),
  movieFetch: vi.fn(),
  showsFetch: vi.fn(),
  inProgressFetch: vi.fn(),
  mark: vi.fn(),
  unmark: vi.fn(),
  markTitle: vi.fn(),
}));
const activity = () => server.watched ? [{
  titleId: 42, titleName: "Example Show", kind: "episode",
  episodeLabel: "S1E1 — Pilot", watchedAt: "2026-10-18T00:00:00.000Z",
}] : server.movieWatched ? [{
  titleId: 42, titleName: "Example Movie", kind: "movie",
  episodeLabel: null, watchedAt: "2026-10-18T00:00:00.000Z",
}] : [];
const movie = {
  id: 42, name: "Example Movie", type: "movie", year: 2024,
  genres: [], altTitles: [], providers: [], watched: true,
  collectionCursor: "2026-10-18T00:00:00.000Z:42",
};
const shows = () => server.titleIsMovie ? [] : [{
  title: { id: 42, name: "Example Show", genres: [] },
  watchedEpisodes: Number(server.watched),
  totalEpisodes: 2,
  nextEpisode: {
    id: server.watched ? 102 : 101, seasonNumber: 1,
    episodeNumber: server.watched ? 2 : 1, name: server.watched ? "Second" : "Pilot",
  },
}];
const inProgress = () => server.watched ? shows() : [];

vi.mock("wouter", () => ({
  useParams: () => ({ id: "42" }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@clerk/react", () => ({
  useUser: () => ({ isSignedIn: true }),
  Show: ({ when, children }: { when: string; children: React.ReactNode }) =>
    when === "signed-in" ? children : null,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const api = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...api,
    useGetTitle: () => ({
      data: {
          id: 42,
          name: server.titleIsMovie ? "Example Movie" : "Example Show",
          type: server.titleIsMovie ? "movie" : "series",
          genres: [], providers: [], altTitles: [],
          watched: server.movieWatched,
          seasons: server.titleIsMovie ? [] : [{ seasonNumber: 1, name: "Season 1", episodeCount: 2 }],
      },
      isLoading: false,
    }),
    useGetTitleSafety: () => ({ data: null, isLoading: false }),
    useGetSimilarTitles: () => ({ data: [] }),
    useGetSeason: (id: number, season: number, options: { query: { enabled: boolean } }) =>
      useQuery({
        queryKey: api.getGetSeasonQueryKey(id, season),
        enabled: options.query.enabled,
        queryFn: async () => ({ episodes: [{
          id: 101, episodeNumber: 1, name: "Pilot", watched: server.watched,
        }] }),
      }),
    useMarkEpisodeWatched: () => useMutation({
      mutationFn: async (request: unknown) => {
        server.mark(request);
        server.watched = true;
        return { ok: true };
      },
    }),
    useUnmarkEpisodeWatched: () => useMutation({
      mutationFn: async (request: unknown) => {
        server.unmark(request);
        server.watched = false;
        return { ok: true };
      },
    }),
    useMarkTitleWatched: () => useMutation({
      mutationFn: async (request: unknown) => {
        server.markTitle(request);
        server.movieWatched = true;
        return { ok: true };
      },
    }),
    useUnmarkTitleWatched: () => useMutation({
      mutationFn: async () => {
        server.movieWatched = false;
        return { ok: true };
      },
    }),
    getMyShows: async () => {
      server.showsFetch();
      return shows();
    },
    getMyInProgressShows: async () => {
      server.inProgressFetch();
      return inProgress();
    },
    getMyMovies: async () => {
      server.movieFetch();
      return server.movieWatched ? [movie] : [];
    },
    useGetMyRecentActivity: () => useQuery({
      queryKey: api.getGetMyRecentActivityQueryKey(),
      queryFn: async () => {
        server.activityFetch();
        return activity();
      },
    }),
  };
});

async function until(assertion: () => void) {
  for (let attempt = 0; attempt < 50; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    try { assertion(); return; } catch (error) {
      if (attempt === 49) throw error;
    }
  }
}

afterEach(() => {
  vi.clearAllMocks();
  server.watched = false;
  server.titleIsMovie = false;
  server.movieWatched = false;
});

it.each([false, true])("refreshes cached web show progress and History when initially watched is %s", async (initiallyWatched) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  server.watched = initiallyWatched;
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } },
  });
  const key = getGetMyRecentActivityQueryKey();
  const showsKey = [...getGetMyShowsQueryKey(), "infinite"];
  const inProgressKey = [...getGetMyInProgressShowsQueryKey(), "infinite"];
  const infiniteData = (rows: unknown[]) => ({ pages: [rows], pageParams: [undefined] });
  client.setQueryData(key, activity());
  client.setQueryData(showsKey, infiniteData(shows()));
  client.setQueryData(inProgressKey, infiniteData(inProgress()));
  const oldActivity = client.getQueryData(key);
  const oldShows = client.getQueryData(showsKey);
  const oldInProgress = client.getQueryData(inProgressKey);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <QueryClientProvider client={client}><TitleDetailPage /></QueryClientProvider>,
    ));
    const season = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find(button => button.textContent?.includes("Season 1"))!;
    expect(season).toBeTruthy();
    await act(async () => season.click());
    await until(() => expect(container.querySelector('[role="checkbox"]')).not.toBeNull());
    await act(async () => (container.querySelector('[role="checkbox"]') as HTMLButtonElement).click());
    await until(() => {
      expect(server.watched).toBe(!initiallyWatched);
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      expect(client.getQueryState(showsKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(inProgressKey)?.isInvalidated).toBe(true);
    });
    expect(initiallyWatched ? server.unmark : server.mark).toHaveBeenCalledWith(
      initiallyWatched ? { episodeId: 101 } : { episodeId: 101, data: { includePrevious: false } },
    );
    expect(server.activityFetch).not.toHaveBeenCalled();
    expect(server.showsFetch).not.toHaveBeenCalled();
    expect(server.inProgressFetch).not.toHaveBeenCalled();
    expect(client.getQueryData(key)).toEqual(oldActivity);
    expect(client.getQueryData(showsKey)).toEqual(oldShows);
    expect(client.getQueryData(inProgressKey)).toEqual(oldInProgress);

    await act(async () => root.render(
      <QueryClientProvider client={client}><MyShowsPage /></QueryClientProvider>,
    ));
    await until(() => {
      expect(server.activityFetch).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(key)).toEqual(activity());
      expect(server.showsFetch).toHaveBeenCalledTimes(1);
      expect(server.inProgressFetch).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(showsKey)).toEqual(infiniteData(shows()));
      expect(client.getQueryData(inProgressKey)).toEqual(infiniteData(inProgress()));
      expect(container.textContent).toContain(`${Number(server.watched)} / 2`);
      expect(container.textContent).toContain(server.watched ? "Second" : "Pilot");
    });
    const history = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find(tab => tab.textContent === "History")!;
    await act(async () => history.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    await until(() => {
      if (initiallyWatched) {
        expect(container.textContent).toContain("No recent activity.");
        expect(container.textContent).not.toContain("S1E1 — Pilot");
      } else {
        expect(container.textContent).toContain("S1E1 — Pilot");
        expect(container.textContent).not.toContain("No recent activity.");
      }
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  }
});

it("refreshes cached web Movies and History when a movie is marked watched", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  server.titleIsMovie = true;
  server.movieWatched = false;
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, retry: false },
      mutations: { retry: false },
    },
  });
  const moviesKey = [...getGetMyMoviesQueryKey(), "infinite"];
  const activityKey = getGetMyRecentActivityQueryKey();
  client.setQueryData(moviesKey, { pages: [[]], pageParams: [undefined] });
  client.setQueryData(activityKey, []);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <QueryClientProvider client={client}><TitleDetailPage /></QueryClientProvider>,
    ));
    const markWatched = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find(button => button.textContent?.includes("Mark Watched"))!;
    expect(markWatched).toBeTruthy();
    await act(async () => markWatched.click());
    await until(() => {
      expect(server.movieWatched).toBe(true);
      expect(client.getQueryState(moviesKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(activityKey)?.isInvalidated).toBe(true);
    });
    expect(server.movieFetch).not.toHaveBeenCalled();
    expect(server.activityFetch).not.toHaveBeenCalled();

    await act(async () => root.render(
      <QueryClientProvider client={client}><MyShowsPage /></QueryClientProvider>,
    ));
    await until(() => {
      expect(server.movieFetch).toHaveBeenCalledTimes(1);
      expect(server.activityFetch).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(moviesKey)).toMatchObject({
        pages: [[expect.objectContaining({ id: 42, name: "Example Movie" })]],
      });
      expect(client.getQueryData(activityKey)).toEqual([
        expect.objectContaining({ titleId: 42, kind: "movie", titleName: "Example Movie" }),
      ]);
    });

    const moviesTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find(tab => tab.textContent === "Movies")!;
    await act(async () => moviesTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    await until(() => expect(container.textContent).toContain("Example Movie"));

    const historyTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find(tab => tab.textContent === "History")!;
    await act(async () => historyTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    await until(() => {
      expect(container.textContent).toContain("Example Movie");
      expect(container.textContent).toContain("movie");
      expect(container.textContent).not.toContain("No recent activity.");
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  }
});
