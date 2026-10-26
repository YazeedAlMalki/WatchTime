import React from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockWatched = false;
let mockTitleIsMovie = false;
let mockMovieWatched = false;
const mockActivityFetch = jest.fn();
const mockShowsFetch = jest.fn();
const mockInProgressFetch = jest.fn();
const mockMovieFetch = jest.fn();
const mockRecommendationsFetch = jest.fn();
const mockMarkRequest = jest.fn();
const mockUnmarkRequest = jest.fn();
const mockMarkTitleRequest = jest.fn();
const mockUnmarkTitleRequest = jest.fn();
const mockActivity = () => mockWatched ? [{
  titleId: 42, titleName: 'Example Show', posterUrl: null,
  kind: 'episode', episodeLabel: 'S1E1 — Pilot', watchedAt: '2026-10-18T00:00:00.000Z',
}] : mockMovieWatched ? [{
  titleId: 42, titleName: 'Example Movie', posterUrl: null,
  kind: 'movie', episodeLabel: null, watchedAt: '2026-10-18T00:00:00.000Z',
}] : [];
const mockMovie = {
  id: 42, name: 'Example Movie', type: 'movie', year: 2024,
  genres: [], altTitles: [], providers: [], watched: true,
  collectionCursor: '2026-10-18T00:00:00.000Z:42',
};
const mockSeason = { seasonNumber: 1, name: 'Season 1', episodeCount: 2 };
const mockShows = () => mockTitleIsMovie ? [] : [{
  title: { id: 42, name: 'Example Show' },
  totalEpisodes: 2, watchedEpisodes: Number(mockWatched),
  nextEpisode: {
    id: mockWatched ? 102 : 101, seasonNumber: 1,
    episodeNumber: mockWatched ? 2 : 1, name: mockWatched ? 'Second' : 'Pilot',
  },
}];
const mockInProgress = () => mockWatched ? mockShows() : [];
const mockRecommendations = () => mockMovieWatched
  ? [{ reason: 'Because you watched this movie', titles: [{ id: 51, name: 'Watched Recommendation' }] }]
  : [{ reason: 'Because you have not watched this movie', titles: [{ id: 52, name: 'Unwatched Recommendation' }] }];

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: '42' }),
}));
jest.mock('@/lib/app-auth', () => ({
  useAppAuth: () => ({
    isLoaded: true, isSignedIn: true, isAuthAvailable: true, userId: 'activity-user',
  }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: require('react-native').View,
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/lib/home-startup', () => ({
  startHomeStartup: (setStartupReady: (ready: boolean) => void) => {
    setStartupReady(true);
    return () => {};
  },
}));
jest.mock('@/lib/startup-metrics', () => ({ markStartup: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('@/components/ui', () => {
  const { Text } = require('react-native');
  return {
    SectionHeader: ({ title }: { title: string }) => <Text>{title}</Text>,
    EmptyState: ({ title }: { title: string }) => <Text>{title}</Text>,
    ErrorState: () => null, Loading: () => null, PosterCard: () => null,
  };
});
jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff', foreground: '#000', mutedForeground: '#777',
    primary: '#6633cc', primaryForeground: '#fff', card: '#eee',
    border: '#ccc', secondary: '#eee', muted: '#ddd',
  }),
}));
jest.mock('@/constants/colors', () => ({ __esModule: true, default: { radius: 8 } }));

// Keep React Query real: infinitely fresh account-scoped collection and activity
// queries need invalidation, whether My Shows is already mounted or opened later.
jest.mock('@workspace/api-client-react', () => {
  const { useQuery, useMutation } = require('@tanstack/react-query');
  const titleKey = (id: number) => [`/api/titles/${id}`];
  const seasonKey = (id: number, season: number) => [`/api/titles/${id}/seasons/${season}`];
  const idleMutation = () => ({ mutate: jest.fn(), isPending: false });
  return {
    getGetTitleQueryKey: titleKey,
    getGetSeasonQueryKey: seasonKey,
    getGetMyShowsQueryKey: () => ['/api/me/shows'],
    getGetMyInProgressShowsQueryKey: () => ['/api/me/in-progress'],
    getGetMyMoviesQueryKey: () => ['/api/me/movies'],
    getGetMyRecentActivityQueryKey: () => ['/api/me/activity'],
    getGetMyRecommendationsQueryKey: () => ['/api/me/recommendations'],
    getGetMyWatchlistQueryKey: () => ['/api/me/watchlist'],
    useGetTitle: (id: number) => useQuery({
      queryKey: titleKey(id),
      queryFn: () => ({
        id,
        name: mockTitleIsMovie ? 'Example Movie' : 'Example Show',
        type: mockTitleIsMovie ? 'movie' : 'series',
        genres: [], altTitles: [],
        providers: [],
        watched: mockMovieWatched,
        seasons: mockTitleIsMovie ? [] : [{ ...mockSeason, watchedCount: Number(mockWatched) }],
      }),
    }),
    useGetSeason: (id: number, season: number, options: { query: { enabled: boolean } }) =>
      useQuery({
        queryKey: seasonKey(id, season),
        queryFn: () => ({ episodes: [{
          id: 101, seasonNumber: 1, episodeNumber: 1, name: 'Pilot', watched: mockWatched,
        }] }),
        enabled: options.query.enabled,
      }),
    useGetSimilarTitles: () => ({ data: [] }),
    useGetTitleSafety: () => ({ data: null, isLoading: false }),
    useGetMyShows: (_params: unknown, options: { query: { enabled: boolean; queryKey: readonly unknown[] } }) =>
      useQuery({ ...options.query, queryFn: async () => [] }),
    useGetMyWatchlist: (_params: unknown, options: { query: { enabled: boolean; queryKey: readonly unknown[] } }) =>
      useQuery({ ...options.query, queryFn: async () => [] }),
    useGetMyRecommendations: (options: { query: { enabled: boolean; queryKey: readonly unknown[] } }) =>
      useQuery({
        ...options.query,
        queryFn: async () => {
          mockRecommendationsFetch();
          return mockRecommendations();
        },
      }),
    useMarkEpisodeWatched: (options: { mutation: { onSuccess: () => void } }) =>
      useMutation({
        mutationFn: async (request: unknown) => {
          await mockMarkRequest(request);
          mockWatched = true;
          return { ok: true };
        },
        onSuccess: options.mutation.onSuccess,
      }),
    useMarkTitleWatched: (options: { mutation: { onSuccess: () => void } }) =>
      useMutation({
        mutationFn: async () => {
          await mockMarkTitleRequest();
          mockMovieWatched = true;
          return { ok: true };
        },
        onSuccess: options.mutation.onSuccess,
      }),
    useUnmarkTitleWatched: (options: { mutation: { onSuccess: () => void } }) =>
      useMutation({
        mutationFn: async () => {
          await mockUnmarkTitleRequest();
          mockMovieWatched = false;
          return { ok: true };
        },
        onSuccess: options.mutation.onSuccess,
      }),
    useUnmarkEpisodeWatched: (options: { mutation: { onSuccess: () => void } }) =>
      useMutation({
        mutationFn: async (request: unknown) => {
          await mockUnmarkRequest(request);
          mockWatched = false;
          return { ok: true };
        },
        onSuccess: options.mutation.onSuccess,
      }),
    useAddToWatchlist: idleMutation, useRemoveFromWatchlist: idleMutation,
    getMyShows: async () => {
      mockShowsFetch();
      return mockShows();
    },
    getMyInProgressShows: async () => {
      mockInProgressFetch();
      return mockInProgress();
    },
    getMyMovies: async () => {
      mockMovieFetch();
      return mockMovieWatched ? [mockMovie] : [];
    },
    mergeTrackedShows: (shows: unknown[]) => shows,
    useGetMyRecentActivity: (options: {
      query: { enabled: boolean; queryKey: readonly unknown[] };
    }) => useQuery({
      ...options.query,
      queryFn: async () => {
        mockActivityFetch();
        return mockActivity();
      },
    }),
  };
});

import TitleDetailScreen from '../app/title/[id]';
import HomeScreen from '../app/(tabs)/index';
import MyShowsScreen from '../app/(tabs)/my-shows';
import {
  getGetMyShowsQueryKey,
  getGetMyInProgressShowsQueryKey,
  getGetMyRecentActivityQueryKey,
  getGetMyRecommendationsQueryKey,
} from '@workspace/api-client-react';

it('updates already-open History after marking and unmarking an episode in title detail', async () => {
  mockTitleIsMovie = false;
  mockMovieWatched = false;
  mockWatched = false;
  jest.clearAllMocks();

  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const activityKey = [...getGetMyRecentActivityQueryKey(), 'account', 'activity-user'];
  client.setQueryData(activityKey, []);

  // Both routes share the app's provider for the entire journey, just as a
  // mounted Expo tab does while the detail route is on top of it.
  const screens = await render(
    <QueryClientProvider client={client}>
      <View testID="mounted-my-shows"><MyShowsScreen /></View>
      <View testID="open-title-detail"><TitleDetailScreen /></View>
    </QueryClientProvider>,
  );
  try {
    const shows = within(screens.getByTestId('mounted-my-shows'));
    const detail = within(screens.getByTestId('open-title-detail'));
    await fireEvent.press(shows.getByTestId('tab-history'));
    await waitFor(() => expect(shows.getByText('No recent activity')).toBeTruthy());
    expect(shows.queryByTestId('history-item-42')).toBeNull();

    const activityQuery = client.getQueryCache().find({ queryKey: activityKey, exact: true });
    expect(activityQuery?.getObserversCount()).toBe(1);
    expect(activityQuery?.isStale()).toBe(false);
    expect(mockActivityFetch).not.toHaveBeenCalled();

    await fireEvent.press(detail.getByTestId('season-1'));
    await waitFor(() => expect(detail.getByTestId('episode-check-101')).toBeTruthy());
    await fireEvent.press(detail.getByTestId('episode-check-101'));
    await waitFor(() => {
      expect(mockMarkRequest).toHaveBeenCalledWith({ episodeId: 101, data: {} });
      expect(mockActivityFetch).toHaveBeenCalledTimes(1);
      expect(shows.getByTestId('history-item-42')).toBeTruthy();
      expect(shows.getByText('S1E1 — Pilot')).toBeTruthy();
      expect(shows.queryByText('No recent activity')).toBeNull();
    });
    expect(client.getQueryData(activityKey)).toEqual(mockActivity());
    // Wait for the detail's own episode query to receive its watched flag so
    // the next press uses the real unmark path, rather than marking twice.
    await waitFor(() => expect(
      client.getQueryData<{ episodes: { watched: boolean }[] }>(['/api/titles/42/seasons/1'])
        ?.episodes[0].watched,
    ).toBe(true));

    await fireEvent.press(detail.getByTestId('episode-check-101'));
    await waitFor(() => {
      expect(mockUnmarkRequest).toHaveBeenCalledWith({ episodeId: 101 });
      expect(mockActivityFetch).toHaveBeenCalledTimes(2);
      expect(shows.queryByTestId('history-item-42')).toBeNull();
      expect(shows.queryByText('S1E1 — Pilot')).toBeNull();
      expect(shows.getByText('No recent activity')).toBeTruthy();
    });
    expect(mockMarkRequest).toHaveBeenCalledTimes(1);
    expect(mockUnmarkRequest).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(activityKey)).toEqual([]);
    expect(client.getQueryCache().find({ queryKey: activityKey, exact: true })).toBe(activityQuery);
    expect(activityQuery?.getObserversCount()).toBe(1);
    expect(activityQuery?.isStale()).toBe(false);
    // History stays selected without another tab press or pull-to-refresh.
    expect(shows.queryByTestId('shows-search-input')).toBeNull();
  } finally {
    await act(async () => screens.unmount());
    client.clear();
  }
});

it.each([
  { action: 'mark', initiallyWatched: false },
  { action: 'unmark', initiallyWatched: true },
])('refreshes account-scoped My Shows progress and History after $action from title detail', async ({ initiallyWatched }) => {
  mockTitleIsMovie = false;
  mockMovieWatched = false;
  mockWatched = initiallyWatched;
  jest.clearAllMocks();
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const activityKey = [...getGetMyRecentActivityQueryKey(), 'account', 'activity-user'];
  const showsKey = [
    ...getGetMyShowsQueryKey(), 'account', 'activity-user', 'infinite',
    { q: undefined, status: undefined },
  ];
  const inProgressKey = [
    ...getGetMyInProgressShowsQueryKey(), 'account', 'activity-user', 'infinite',
  ];
  const infiniteData = (rows: unknown[]) => ({ pages: [rows], pageParams: [undefined] });
  client.setQueryData(activityKey, mockActivity());
  client.setQueryData(showsKey, infiniteData(mockShows()));
  client.setQueryData(inProgressKey, infiniteData(mockInProgress()));
  const oldActivity = client.getQueryData(activityKey);
  const oldShows = client.getQueryData(showsKey);
  const oldInProgress = client.getQueryData(inProgressKey);
  const detail = await render(
    <QueryClientProvider client={client}><TitleDetailScreen /></QueryClientProvider>,
  );
  await waitFor(() => expect(detail.getByTestId('season-1')).toBeTruthy());
  await fireEvent.press(detail.getByTestId('season-1'));
  await waitFor(() => expect(detail.getByTestId('episode-check-101')).toBeTruthy());
  await fireEvent.press(detail.getByTestId('episode-check-101'));
  await waitFor(() => {
    expect(mockWatched).toBe(!initiallyWatched);
    expect(client.getQueryState(activityKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(showsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(inProgressKey)?.isInvalidated).toBe(true);
  });
  expect(initiallyWatched ? mockUnmarkRequest : mockMarkRequest).toHaveBeenCalledWith(
    initiallyWatched ? { episodeId: 101 } : { episodeId: 101, data: {} },
  );
  expect(mockActivityFetch).not.toHaveBeenCalled();
  expect(mockShowsFetch).not.toHaveBeenCalled();
  expect(mockInProgressFetch).not.toHaveBeenCalled();
  expect(client.getQueryData(activityKey)).toEqual(oldActivity);
  expect(client.getQueryData(showsKey)).toEqual(oldShows);
  expect(client.getQueryData(inProgressKey)).toEqual(oldInProgress);
  await act(async () => detail.unmount());

  const shows = await render(
    <QueryClientProvider client={client}><MyShowsScreen /></QueryClientProvider>,
  );
  await waitFor(() => {
    expect(mockActivityFetch).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(activityKey)).toEqual(mockActivity());
    expect(mockShowsFetch).toHaveBeenCalledTimes(1);
    expect(mockInProgressFetch).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(showsKey)).toEqual(infiniteData(mockShows()));
    expect(client.getQueryData(inProgressKey)).toEqual(infiniteData(mockInProgress()));
  });
  await waitFor(() => {
    expect(shows.getByText(`${Number(mockWatched)} / 2 episodes`)).toBeTruthy();
    expect(shows.getByTestId(`mark-watched-${mockWatched ? 102 : 101}`)).toBeTruthy();
  });
  await fireEvent.press(shows.getByTestId('tab-history'));
  await waitFor(() => {
    if (initiallyWatched) {
      expect(shows.queryByTestId('history-item-42')).toBeNull();
      expect(shows.getByText('No recent activity')).toBeTruthy();
    } else {
      expect(shows.getByTestId('history-item-42')).toBeTruthy();
      expect(shows.getByText('S1E1 — Pilot')).toBeTruthy();
    }
  });
  await act(async () => shows.unmount());
  client.clear();
});

it.each([
  { action: 'mark', initiallyWatched: false },
  { action: 'unmark', initiallyWatched: true },
])('preserves cached account history after a failed $action and refreshes it after retry', async ({ initiallyWatched }) => {
  mockTitleIsMovie = false;
  mockMovieWatched = false;
  mockWatched = initiallyWatched;
  jest.clearAllMocks();
  const request = initiallyWatched ? mockUnmarkRequest : mockMarkRequest;
  const otherRequest = initiallyWatched ? mockMarkRequest : mockUnmarkRequest;
  request.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ok: true });

  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const activityKey = [...getGetMyRecentActivityQueryKey(), 'account', 'activity-user'];
  // A nonempty baseline also catches accidental clearing when marking an
  // unwatched episode fails, not just an optimistic insertion/removal.
  const cachedActivity = initiallyWatched ? mockActivity() : [{
    titleId: 99, titleName: 'Previously Watched Movie', posterUrl: null,
    kind: 'movie', episodeLabel: null, watchedAt: '2026-10-17T00:00:00.000Z',
  }];
  client.setQueryData(activityKey, cachedActivity);
  const oldActivity = client.getQueryData(activityKey);
  const oldActivityState = client.getQueryState(activityKey);
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const detail = await render(
    <QueryClientProvider client={client}><TitleDetailScreen /></QueryClientProvider>,
  );
  await waitFor(() => expect(detail.getByTestId('season-1')).toBeTruthy());
  await fireEvent.press(detail.getByTestId('season-1'));
  await waitFor(() => expect(detail.getByTestId('episode-check-101')).toBeEnabled());
  await fireEvent.press(detail.getByTestId('episode-check-101'));
  await waitFor(() => {
    expect(request).toHaveBeenCalledTimes(1);
    expect(client.getMutationCache().getAll()).toHaveLength(1);
    expect(client.getMutationCache().getAll()[0].state.status).toBe('error');
    expect(detail.getByTestId('episode-check-101')).toBeEnabled();
  });
  const expectedRequest = initiallyWatched ? { episodeId: 101 } : { episodeId: 101, data: {} };
  expect(request).toHaveBeenLastCalledWith(expectedRequest);
  expect(otherRequest).not.toHaveBeenCalled();
  expect(mockWatched).toBe(initiallyWatched);
  expect(client.getQueryData(activityKey)).toBe(oldActivity);
  expect(client.getQueryData(activityKey)).toEqual(cachedActivity);
  expect(client.getQueryState(activityKey)).toEqual(oldActivityState);
  expect(client.getQueryState(activityKey)?.isInvalidated).toBe(false);
  expect(invalidate).not.toHaveBeenCalled();
  expect(mockActivityFetch).not.toHaveBeenCalled();
  expect(detail.getByText(`${Number(initiallyWatched)}/2 watched`)).toBeTruthy();

  // Retry through the same episode control, with the real mutation lifecycle.
  await fireEvent.press(detail.getByTestId('episode-check-101'));
  await waitFor(() => {
    expect(request).toHaveBeenCalledTimes(2);
    expect(mockWatched).toBe(!initiallyWatched);
    expect(client.getQueryState(activityKey)?.isInvalidated).toBe(true);
    expect(detail.getByText(`${Number(!initiallyWatched)}/2 watched`)).toBeTruthy();
  });
  expect(request).toHaveBeenLastCalledWith(expectedRequest);
  expect(otherRequest).not.toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: getGetMyRecentActivityQueryKey() });
  expect(mockActivityFetch).not.toHaveBeenCalled();
  expect(client.getQueryData(activityKey)).toBe(oldActivity);
  await act(async () => detail.unmount());

  const shows = await render(
    <QueryClientProvider client={client}><MyShowsScreen /></QueryClientProvider>,
  );
  await waitFor(() => {
    expect(mockActivityFetch).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(activityKey)).toEqual(mockActivity());
    expect(client.getQueryState(activityKey)?.isInvalidated).toBe(false);
  });
  await fireEvent.press(shows.getByTestId('tab-history'));
  await waitFor(() => {
    if (initiallyWatched) {
      expect(shows.queryByTestId('history-item-42')).toBeNull();
      expect(shows.getByText('No recent activity')).toBeTruthy();
    } else {
      expect(shows.getByTestId('history-item-42')).toBeTruthy();
      expect(shows.getByText('S1E1 — Pilot')).toBeTruthy();
    }
  });
  await act(async () => shows.unmount());
  invalidate.mockRestore();
  client.clear();
});

it.each([
  { action: 'marking', initiallyWatched: false },
  { action: 'unmarking', initiallyWatched: true },
])('refreshes the account-scoped Movies and History caches after $action a movie', async ({ initiallyWatched }) => {
  mockTitleIsMovie = true;
  mockMovieWatched = initiallyWatched;
  mockWatched = false;
  jest.clearAllMocks();

  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const { getGetMyMoviesQueryKey, getGetMyRecentActivityQueryKey } =
    require('@workspace/api-client-react');
  const moviesKey = [...getGetMyMoviesQueryKey(), 'account', 'activity-user', 'infinite'];
  const activityKey = [...getGetMyRecentActivityQueryKey(), 'account', 'activity-user'];
  const cachedMovies = initiallyWatched ? [mockMovie] : [];
  const cachedActivity = initiallyWatched ? mockActivity() : [];
  client.setQueryData(moviesKey, { pages: [cachedMovies], pageParams: [undefined] });
  client.setQueryData(activityKey, cachedActivity);

  const detail = await render(
    <QueryClientProvider client={client}><TitleDetailScreen /></QueryClientProvider>,
  );
  await waitFor(() => expect(detail.getByTestId('watched-toggle')).toBeTruthy());
  await fireEvent.press(detail.getByTestId('watched-toggle'));
  await waitFor(() => {
    expect(mockMovieWatched).toBe(!initiallyWatched);
    expect(client.getQueryState(moviesKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(activityKey)?.isInvalidated).toBe(true);
  });
  if (initiallyWatched) {
    expect(mockUnmarkTitleRequest).toHaveBeenCalledTimes(1);
  } else {
    expect(mockMarkTitleRequest).toHaveBeenCalledTimes(1);
  }
  expect(mockMovieFetch).not.toHaveBeenCalled();
  expect(mockActivityFetch).not.toHaveBeenCalled();
  expect(client.getQueryData(moviesKey)).toEqual({ pages: [cachedMovies], pageParams: [undefined] });
  expect(client.getQueryData(activityKey)).toEqual(cachedActivity);
  await act(async () => detail.unmount());

  const shows = await render(
    <QueryClientProvider client={client}><MyShowsScreen /></QueryClientProvider>,
  );
  await waitFor(() => {
    expect(mockMovieFetch).toHaveBeenCalledTimes(1);
    expect(mockActivityFetch).toHaveBeenCalledTimes(1);
    if (initiallyWatched) {
      expect(client.getQueryData(moviesKey)).toEqual({ pages: [[]], pageParams: [undefined] });
      expect(client.getQueryData(activityKey)).toEqual([]);
    } else {
      expect(client.getQueryData(moviesKey)).toMatchObject({
        pages: [[expect.objectContaining({ id: 42, name: 'Example Movie' })]],
      });
      expect(client.getQueryData(activityKey)).toEqual([
        expect.objectContaining({ titleId: 42, kind: 'movie', titleName: 'Example Movie' }),
      ]);
    }
  });
  fireEvent.press(shows.getByTestId('tab-history'));
  await waitFor(() => {
    if (initiallyWatched) {
      expect(shows.queryByTestId('history-item-42')).toBeNull();
      expect(shows.getByText('No recent activity')).toBeTruthy();
    } else {
      expect(shows.getByTestId('history-item-42')).toBeTruthy();
      expect(shows.getByText('Example Movie')).toBeTruthy();
      expect(shows.getByText('movie')).toBeTruthy();
    }
  });
  await act(async () => shows.unmount());
  client.clear();
  mockTitleIsMovie = false;
});

it.each([
  { action: 'marking', initiallyWatched: false, expectedName: 'Watched Recommendation' },
  { action: 'unmarking', initiallyWatched: true, expectedName: 'Unwatched Recommendation' },
])('fetches updated recommendations after returning to Home from title detail after $action a movie', async ({
  initiallyWatched,
  expectedName,
}) => {
  mockTitleIsMovie = true;
  mockMovieWatched = initiallyWatched;
  mockWatched = false;
  jest.clearAllMocks();

  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const recommendationsKey = [
    ...getGetMyRecommendationsQueryKey(),
    'account',
    'activity-user',
  ];
  client.setQueryData(recommendationsKey, [
    { reason: 'Based on the previous watch history', titles: [{ id: 50, name: 'Old Recommendation' }] },
  ]);

  const detail = await render(
    <QueryClientProvider client={client}><TitleDetailScreen /></QueryClientProvider>,
  );
  await waitFor(() => expect(detail.getByTestId('watched-toggle')).toBeTruthy());
  await fireEvent.press(detail.getByTestId('watched-toggle'));
  await waitFor(() => {
    expect(mockMovieWatched).toBe(!initiallyWatched);
    expect(client.getQueryState(recommendationsKey)?.isInvalidated).toBe(true);
  });
  expect(mockRecommendationsFetch).not.toHaveBeenCalled();
  await act(async () => detail.unmount());

  const home = await render(
    <QueryClientProvider client={client}><HomeScreen /></QueryClientProvider>,
  );
  await waitFor(() => {
    expect(mockRecommendationsFetch).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(recommendationsKey)).toEqual([
      expect.objectContaining({
        titles: [expect.objectContaining({ name: expectedName })],
      }),
    ]);
  });

  await act(async () => home.unmount());
  client.clear();
  mockTitleIsMovie = false;
});

afterEach(cleanup);
