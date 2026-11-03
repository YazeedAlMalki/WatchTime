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
const mockRecommendations = () => mockTitleIsMovie
  ? mockMovieWatched
    ? [{ reason: 'Because you watched this movie', titles: [{ id: 51, name: 'Watched Recommendation' }] }]
    : [{ reason: 'Because you have not watched this movie', titles: [{ id: 52, name: 'Unwatched Recommendation' }] }]
  : mockWatched
    ? [{ reason: 'Because you watched this episode', titles: [{ id: 53, name: 'Watched Episode Recommendation' }] }]
    : [{ reason: 'Because you have not watched this episode', titles: [{ id: 54, name: 'Unwatched Episode Recommendation' }] }];

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useIsFocused: () => true,
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
jest.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text testID={`icon-${name}`} />;
  },
}));
jest.mock('@/components/ui', () => {
  const { Text, Pressable } = require('react-native');
  return {
    SectionHeader: ({ title }: { title: string }) => <Text>{title}</Text>,
    EmptyState: ({ title }: { title: string }) => <Text>{title}</Text>,
    ErrorState: ({ onRetry }: { onRetry: () => void }) => (
      <Pressable accessibilityRole="button" accessibilityLabel="Retry" onPress={onRetry}>
        <Text>Retry</Text>
      </Pressable>
    ),
    Loading: () => null,
    PosterCard: ({ title }: { title: { id: number; name: string } }) => (
      <Text testID={`poster-${title.id}`}>{title.name}</Text>
    ),
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
    useGetTitle: (id: number, options?: { query?: { queryKey?: readonly unknown[] } }) => useQuery({
      queryKey: options?.query?.queryKey ?? titleKey(id),
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
        }, {
          id: 102, seasonNumber: 1, episodeNumber: 2, name: 'Second', watched: false,
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
    useMarkEpisodeWatched: (options: { mutation: { onMutate: () => unknown; onSuccess: () => void; onError: () => void } }) =>
      useMutation({
        mutationFn: async (request: unknown) => {
          await mockMarkRequest(request);
          mockWatched = true;
          return { ok: true };
        },
        onMutate: options.mutation.onMutate,
        onSuccess: options.mutation.onSuccess,
        onError: options.mutation.onError,
      }),
    useMarkTitleWatched: (options: { mutation: { onMutate: () => unknown; onSuccess: () => void } }) =>
      useMutation({
        mutationFn: async (request: unknown) => {
          await mockMarkTitleRequest(request);
          mockMovieWatched = true;
          return { ok: true };
        },
        onMutate: options.mutation.onMutate,
        onSuccess: options.mutation.onSuccess,
      }),
    useUnmarkTitleWatched: (options: { mutation: { onMutate: () => unknown; onSuccess: () => void } }) =>
      useMutation({
        mutationFn: async (request: unknown) => {
          await mockUnmarkTitleRequest(request);
          mockMovieWatched = false;
          return { ok: true };
        },
        onMutate: options.mutation.onMutate,
        onSuccess: options.mutation.onSuccess,
      }),
    useUnmarkEpisodeWatched: (options: { mutation: { onMutate: () => unknown; onSuccess: () => void; onError: () => void } }) =>
      useMutation({
        mutationFn: async (request: unknown) => {
          await mockUnmarkRequest(request);
          mockWatched = false;
          return { ok: true };
        },
        onMutate: options.mutation.onMutate,
        onSuccess: options.mutation.onSuccess,
        onError: options.mutation.onError,
      }),
    useAddToWatchlist: idleMutation, useRemoveFromWatchlist: idleMutation,
    getMyShows: async (params: unknown) => {
      return mockShowsFetch(params) ?? mockShows();
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
        await mockActivityFetch();
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

it('recovers open History after an activity reload fails without repeating the saved episode change', async () => {
  mockTitleIsMovie = false;
  mockMovieWatched = false;
  mockWatched = false;
  jest.clearAllMocks();
  const failure = new Error('Activity is temporarily unavailable');
  mockActivityFetch.mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);

  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const activityKey = [...getGetMyRecentActivityQueryKey(), 'account', 'activity-user'];
  client.setQueryData(activityKey, []);
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
    const activityQuery = client.getQueryCache().find({ queryKey: activityKey, exact: true });
    expect(activityQuery?.getObserversCount()).toBe(1);
    expect(mockActivityFetch).not.toHaveBeenCalled();

    await fireEvent.press(detail.getByTestId('season-1'));
    await waitFor(() => expect(detail.getByTestId('episode-check-101')).toBeEnabled());
    await fireEvent.press(detail.getByTestId('episode-check-101'));
    await waitFor(() => {
      expect(client.getQueryState(activityKey)?.status).toBe('error');
      expect(client.getQueryState(activityKey)?.fetchStatus).toBe('idle');
      expect(shows.getByRole('button', { name: 'Retry' })).toBeTruthy();
      expect(detail.getByTestId('episode-check-101')).toBeEnabled();
      expect(within(detail.getByTestId('episode-check-101')).getByTestId('icon-check')).toBeTruthy();
      expect(detail.getByText('1/2 watched')).toBeTruthy();
    });
    expect(mockWatched).toBe(true);
    expect(mockMarkRequest).toHaveBeenCalledTimes(1);
    expect(mockMarkRequest).toHaveBeenCalledWith({ episodeId: 101, data: {} });
    expect(mockUnmarkRequest).not.toHaveBeenCalled();
    expect(mockActivityFetch).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(activityKey)?.error).toBe(failure);
    expect(client.getQueryData(activityKey)).toEqual([]);
    expect(shows.queryByTestId('history-item-42')).toBeNull();
    const mutations = client.getMutationCache().getAll();
    expect(mutations).toHaveLength(1);
    expect(mutations[0].state.status).toBe('success');

    // Retry only the failed read through the still-mounted History screen.
    await fireEvent.press(shows.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(mockActivityFetch).toHaveBeenCalledTimes(2);
      expect(client.getQueryState(activityKey)?.status).toBe('success');
      expect(client.getQueryState(activityKey)?.fetchStatus).toBe('idle');
      expect(shows.getByTestId('history-item-42')).toBeTruthy();
      expect(shows.getByText('S1E1 — Pilot')).toBeTruthy();
    });
    expect(client.getQueryCache().find({ queryKey: activityKey, exact: true })).toBe(activityQuery);
    expect(activityQuery?.getObserversCount()).toBe(1);
    expect(client.getQueryData(activityKey)).toEqual(mockActivity());
    expect(client.getQueryState(activityKey)?.error).toBeNull();
    expect(shows.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(shows.queryByText('No recent activity')).toBeNull();
    expect(detail.getByText('1/2 watched')).toBeTruthy();
    expect(within(detail.getByTestId('episode-check-101')).getByTestId('icon-check')).toBeTruthy();
    expect(mockMarkRequest).toHaveBeenCalledTimes(1);
    expect(mockUnmarkRequest).not.toHaveBeenCalled();
    expect(client.getMutationCache().getAll()).toEqual(mutations);
    expect(mutations[0].state.status).toBe('success');
  } finally {
    await act(async () => screens.unmount());
    mockActivityFetch.mockReset();
    client.clear();
  }
});

it('updates already-open History after marking and unmarking a movie in title detail', async () => {
  mockTitleIsMovie = true;
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
    await waitFor(() => {
      expect(shows.getByText('No recent activity')).toBeTruthy();
      expect(detail.getByText('Mark watched')).toBeTruthy();
      expect(detail.getByTestId('watched-toggle')).toBeEnabled();
    });
    expect(shows.queryByTestId('history-item-42')).toBeNull();
    const activityQuery = client.getQueryCache().find({ queryKey: activityKey, exact: true });
    expect(activityQuery?.getObserversCount()).toBe(1);
    expect(activityQuery?.isStale()).toBe(false);
    expect(mockActivityFetch).not.toHaveBeenCalled();

    await fireEvent.press(detail.getByTestId('watched-toggle'));
    await waitFor(() => {
      expect(mockMarkTitleRequest).toHaveBeenCalledTimes(1);
      expect(mockActivityFetch).toHaveBeenCalledTimes(1);
      const row = within(shows.getByTestId('history-item-42'));
      expect(row.getByText('Example Movie')).toBeTruthy();
      expect(row.getByText('movie')).toBeTruthy();
      expect(shows.queryByText('No recent activity')).toBeNull();
      // Wait for the refreshed detail flag before pressing the same toggle.
      expect(detail.getByText('Watched')).toBeTruthy();
      expect(detail.getByTestId('watched-toggle')).toBeEnabled();
    });
    expect(mockUnmarkTitleRequest).not.toHaveBeenCalled();
    expect(client.getQueryData(activityKey)).toEqual(mockActivity());

    await fireEvent.press(detail.getByTestId('watched-toggle'));
    await waitFor(() => {
      expect(mockUnmarkTitleRequest).toHaveBeenCalledTimes(1);
      expect(mockActivityFetch).toHaveBeenCalledTimes(2);
      expect(shows.queryByTestId('history-item-42')).toBeNull();
      expect(shows.queryByText('Example Movie')).toBeNull();
      expect(shows.getByText('No recent activity')).toBeTruthy();
      expect(detail.getByText('Mark watched')).toBeTruthy();
    });
    expect(mockMarkTitleRequest).toHaveBeenCalledTimes(1);
    expect(mockMarkRequest).not.toHaveBeenCalled();
    expect(mockUnmarkRequest).not.toHaveBeenCalled();
    expect(client.getQueryData(activityKey)).toEqual([]);
    expect(client.getQueryCache().find({ queryKey: activityKey, exact: true })).toBe(activityQuery);
    expect(activityQuery?.getObserversCount()).toBe(1);
    expect(activityQuery?.isStale()).toBe(false);
    // No remount, tab change, or refresh after History was first opened.
    expect(shows.queryByTestId('shows-search-input')).toBeNull();
  } finally {
    await act(async () => screens.unmount());
    client.clear();
    mockTitleIsMovie = false;
    mockMovieWatched = false;
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

it('keeps the watched checkmark, account progress, in-progress feed and History unchanged after a rejected unmark', async () => {
  mockTitleIsMovie = false;
  mockMovieWatched = false;
  mockWatched = true;
  jest.clearAllMocks();
  const failure = new Error('Offline');
  mockUnmarkRequest.mockRejectedValueOnce(failure);

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
  client.setQueryData(activityKey, mockActivity());
  client.setQueryData(showsKey, { pages: [mockShows()], pageParams: [undefined] });
  client.setQueryData(inProgressKey, { pages: [mockInProgress()], pageParams: [undefined] });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const screens = await render(
    <QueryClientProvider client={client}>
      <View testID="mounted-my-shows"><MyShowsScreen /></View>
      <View testID="open-title-detail"><TitleDetailScreen /></View>
    </QueryClientProvider>,
  );
  try {
    const shows = within(screens.getByTestId('mounted-my-shows'));
    const detail = within(screens.getByTestId('open-title-detail'));
    await waitFor(() => expect(shows.getByText('1 / 2 episodes')).toBeTruthy());
    expect(shows.getByTestId('mark-watched-102')).toBeTruthy();
    await waitFor(() => expect(detail.getByTestId('season-1')).toBeTruthy());
    await fireEvent.press(detail.getByTestId('season-1'));
    await waitFor(() => expect(detail.getByTestId('episode-check-101')).toBeEnabled());
    expect(within(detail.getByTestId('episode-check-101')).getByTestId('icon-check')).toBeTruthy();
    expect(detail.getByText('1/2 watched')).toBeTruthy();

    const snapshots = [activityKey, showsKey, inProgressKey].map((key) => ({
      key, data: client.getQueryData(key), state: client.getQueryState(key),
    }));
    await fireEvent.press(detail.getByTestId('episode-check-101'));
    await waitFor(() => {
      expect(mockUnmarkRequest).toHaveBeenCalledTimes(1);
      expect(client.getMutationCache().getAll()).toHaveLength(1);
      expect(client.getMutationCache().getAll()[0].state.status).toBe('error');
      expect(detail.getByTestId('episode-check-101')).toBeEnabled();
    });
    expect(client.getMutationCache().getAll()[0].state.error).toBe(failure);
    expect(mockUnmarkRequest).toHaveBeenCalledWith({ episodeId: 101 });
    expect(mockMarkRequest).not.toHaveBeenCalled();
    expect(mockWatched).toBe(true);
    expect(within(detail.getByTestId('episode-check-101')).getByTestId('icon-check')).toBeTruthy();
    expect(detail.getByText('1/2 watched')).toBeTruthy();
    expect(shows.getByText('1 / 2 episodes')).toBeTruthy();
    expect(shows.getByTestId('mark-watched-102')).toBeTruthy();
    expect(shows.queryByTestId('mark-watched-101')).toBeNull();

    await fireEvent.press(shows.getByTestId('tab-history'));
    await waitFor(() => expect(shows.getByTestId('history-item-42')).toBeTruthy());
    expect(shows.getByText('S1E1 — Pilot')).toBeTruthy();
    expect(shows.queryByText('No recent activity')).toBeNull();
    for (const { key, data, state } of snapshots) {
      expect(client.getQueryData(key)).toBe(data);
      expect(client.getQueryState(key)).toEqual(state);
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    }
    expect(invalidate).not.toHaveBeenCalled();
    expect(mockShowsFetch).not.toHaveBeenCalled();
    expect(mockInProgressFetch).not.toHaveBeenCalled();
    expect(mockActivityFetch).not.toHaveBeenCalled();
  } finally {
    await act(async () => screens.unmount());
    invalidate.mockRestore();
    client.clear();
  }
});

it('switches between TV Shows and Movies without reusing the list layout', async () => {
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
  const screen = await render(
    <QueryClientProvider client={client}><MyShowsScreen /></QueryClientProvider>,
  );

  try {
    await waitFor(() => expect(screen.getByTestId('show-row-42')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tab-movies'));
    await waitFor(() => expect(screen.getByText('No movies watched yet')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tab-shows'));
    await waitFor(() => expect(screen.getByTestId('show-row-42')).toBeTruthy());
  } finally {
    await act(async () => screen.unmount());
    client.clear();
  }
});

it('keeps a pending TV Shows page intact when switching to Movies and back', async () => {
  mockTitleIsMovie = false;
  mockMovieWatched = false;
  mockWatched = false;
  jest.clearAllMocks();
  mockShowsFetch.mockReset();

  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const firstPage = Array.from({ length: 24 }, (_, index) => ({
    title: { id: 1000 + index, name: `Paged Show ${index + 1}` },
    totalEpisodes: 2,
    watchedEpisodes: 0,
    nextEpisode: {
      id: 2000 + index, seasonNumber: 1, episodeNumber: 1, name: 'Pilot',
    },
  }));
  const secondPage = [24, 25].map(index => ({
    title: { id: 1000 + index, name: `Paged Show ${index + 1}` },
    totalEpisodes: 2,
    watchedEpisodes: 0,
    nextEpisode: {
      id: 2000 + index, seasonNumber: 1, episodeNumber: 1, name: 'Pilot',
    },
  }));
  let resolvePendingPage: ((page: typeof firstPage) => void) | undefined;
  const pendingPage = new Promise<typeof firstPage>(resolve => {
    resolvePendingPage = resolve;
  });
  mockShowsFetch.mockImplementation(({ beforeId }: { beforeId?: number }) => (
    beforeId === undefined ? firstPage : pendingPage
  ));

  const screen = await render(
    <QueryClientProvider client={client}><MyShowsScreen /></QueryClientProvider>,
  );
  try {
    const showsKey = [
      ...getGetMyShowsQueryKey(), 'account', 'activity-user', 'infinite',
      { q: undefined, status: undefined },
    ];
    await waitFor(() => {
      expect(screen.getByTestId('show-row-1000')).toBeTruthy();
      expect(mockShowsFetch).toHaveBeenCalledTimes(1);
    });

    await fireEvent(screen.getByTestId('shows-list'), 'onEndReached');
    await waitFor(() => {
      expect(mockShowsFetch).toHaveBeenCalledTimes(2);
      expect(client.getQueryState(showsKey)?.fetchStatus).toBe('fetching');
    });

    await fireEvent.press(screen.getByTestId('tab-movies'));
    await waitFor(() => expect(screen.getByText('No movies watched yet')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tab-shows'));
    await waitFor(() => expect(screen.getByTestId('show-row-1000')).toBeTruthy());

    await act(async () => {
      resolvePendingPage?.(secondPage);
    });
    await waitFor(() => {
      const pages = client.getQueryData<{ pages: typeof firstPage[] }>(showsKey)?.pages;
      expect(pages).toHaveLength(2);
      expect(pages?.[1]).toEqual(secondPage);
      expect(client.getQueryState(showsKey)?.status).toBe('success');
      expect(client.getQueryState(showsKey)?.fetchStatus).toBe('idle');
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });

    const loadedShows = client.getQueryData<{ pages: typeof firstPage[] }>(showsKey)?.pages.flat() ?? [];
    const loadedShowIds = loadedShows.map(show => show.title.id);
    expect(loadedShowIds).toHaveLength(firstPage.length + secondPage.length);
    expect(new Set(loadedShowIds).size).toBe(loadedShowIds.length);
    expect(mockShowsFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('show-row-1000')).toBeTruthy();
    expect(screen.queryByText('No shows tracked yet')).toBeNull();
  } finally {
    await act(async () => screen.unmount());
    mockShowsFetch.mockReset();
    client.clear();
  }
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
  request.mockRejectedValueOnce(new Error('Offline'))
    .mockRejectedValueOnce(new Error('Still offline'))
    .mockResolvedValueOnce({ ok: true });

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
  const errorMessage = "Couldn't save the watched status for S1E1 — Pilot. Tap the checkbox to retry.";
  expect(detail.getByRole('alert')).toHaveTextContent(errorMessage);
  expect(detail.getByRole('alert')).toHaveProp('accessibilityLiveRegion', 'assertive');
  expect(detail.getByTestId('episode-save-error-101')).toHaveTextContent(errorMessage);
  expect(detail.queryByTestId('episode-save-error-102')).toBeNull();
  expect(detail.getByRole('checkbox', { name: 'S1E1 — Pilot', checked: initiallyWatched }))
    .toHaveProp('accessibilityHint', "Couldn't save this change. Activate to retry.");

  // Repeated failures keep the saved state and the episode-specific error.
  await fireEvent.press(detail.getByTestId('episode-check-101'));
  await waitFor(() => {
    expect(request).toHaveBeenCalledTimes(2);
    expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe('error');
    expect(detail.getByTestId('episode-check-101')).toBeEnabled();
  });
  expect(detail.getByRole('alert')).toHaveTextContent(errorMessage);
  expect(mockWatched).toBe(initiallyWatched);
  expect(client.getQueryData(activityKey)).toBe(oldActivity);
  expect(client.getQueryState(activityKey)).toEqual(oldActivityState);
  expect(invalidate).not.toHaveBeenCalled();

  // A successful retry clears the error and refreshes dependent queries.
  await fireEvent.press(detail.getByTestId('episode-check-101'));
  await waitFor(() => {
    expect(request).toHaveBeenCalledTimes(3);
    expect(mockWatched).toBe(!initiallyWatched);
    expect(client.getQueryState(activityKey)?.isInvalidated).toBe(true);
    expect(detail.getByText(`${Number(!initiallyWatched)}/2 watched`)).toBeTruthy();
    expect(detail.queryByRole('alert')).toBeNull();
    expect(detail.getByRole('checkbox', { name: 'S1E1 — Pilot', checked: !initiallyWatched }))
      .toBeEnabled();
  });
  expect(request).toHaveBeenLastCalledWith(expectedRequest);
  expect(otherRequest).not.toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: [...getGetMyRecentActivityQueryKey(), 'account', 'activity-user'],
  });
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
  { action: 'mark', initiallyWatched: false },
  { action: 'unmark', initiallyWatched: true },
])('preserves movie, History, and recommendation caches after a failed $action and refreshes them after retry', async ({
  initiallyWatched,
}) => {
  mockTitleIsMovie = true;
  mockMovieWatched = initiallyWatched;
  mockWatched = false;
  jest.clearAllMocks();
  const failure = new Error('Offline');
  const request = initiallyWatched ? mockUnmarkTitleRequest : mockMarkTitleRequest;
  const otherRequest = initiallyWatched ? mockMarkTitleRequest : mockUnmarkTitleRequest;
  let rejectRequest!: (error: Error) => void;
  request.mockImplementationOnce(() => new Promise((_resolve, reject) => {
    rejectRequest = reject;
  })).mockResolvedValueOnce({ ok: true });

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
  const recommendationsKey = [...getGetMyRecommendationsQueryKey(), 'account', 'activity-user'];
  // Nonempty baselines catch accidental clearing as well as optimistic changes.
  const cachedMovies = {
    pages: [[initiallyWatched ? mockMovie : { ...mockMovie, id: 99, name: 'Previously Watched Movie' }]],
    pageParams: [undefined],
  };
  const cachedActivity = initiallyWatched ? mockActivity() : [{
    titleId: 99, titleName: 'Previously Watched Movie', posterUrl: null,
    kind: 'movie', episodeLabel: null, watchedAt: '2026-10-17T00:00:00.000Z',
  }];
  const cachedRecommendations = mockRecommendations();
  client.setQueryData(moviesKey, cachedMovies);
  client.setQueryData(activityKey, cachedActivity);
  client.setQueryData(recommendationsKey, cachedRecommendations);
  const invalidate = jest.spyOn(client, 'invalidateQueries');

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
    const historyId = initiallyWatched ? 42 : 99;
    await waitFor(() => expect(shows.getByTestId(`history-item-${historyId}`)).toBeTruthy());
    await waitFor(() => expect(detail.getByTestId('watched-toggle')).toBeEnabled());
    const snapshots = [moviesKey, activityKey, recommendationsKey].map((key) => ({
      key,
      data: client.getQueryData(key),
      state: client.getQueryState(key),
    }));

    await fireEvent.press(detail.getByTestId('watched-toggle'));
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
      expect(client.getMutationCache().getAll()).toHaveLength(1);
      expect(client.getMutationCache().getAll()[0].state.status).toBe('pending');
      expect(detail.getByTestId('watched-toggle')).toBeDisabled();
    });
    expect(mockMovieWatched).toBe(initiallyWatched);
    expect(detail.getByText(initiallyWatched ? 'Watched' : 'Mark watched')).toBeTruthy();
    expect(shows.getByTestId(`history-item-${historyId}`)).toBeTruthy();
    for (const { key, data, state } of snapshots) {
      expect(client.getQueryData(key)).toBe(data);
      expect(client.getQueryState(key)).toEqual(state);
    }
    expect(invalidate).not.toHaveBeenCalled();

    await act(async () => rejectRequest(failure));
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
      expect(client.getMutationCache().getAll()).toHaveLength(1);
      expect(client.getMutationCache().getAll()[0].state.status).toBe('error');
      expect(detail.getByTestId('watched-toggle')).toBeEnabled();
    });
    expect(client.getMutationCache().getAll()[0].state.error).toBe(failure);
    expect(request).toHaveBeenLastCalledWith({ id: 42 });
    expect(otherRequest).not.toHaveBeenCalled();
    expect(mockMovieWatched).toBe(initiallyWatched);
    expect(shows.getByTestId(`history-item-${historyId}`)).toBeTruthy();
    for (const { key, data, state } of snapshots) {
      expect(client.getQueryData(key)).toBe(data);
      expect(client.getQueryState(key)).toEqual(state);
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    }
    expect(invalidate).not.toHaveBeenCalled();
    expect(mockMovieFetch).not.toHaveBeenCalled();
    expect(mockActivityFetch).not.toHaveBeenCalled();
    expect(mockRecommendationsFetch).not.toHaveBeenCalled();
    expect(detail.getByText(initiallyWatched ? 'Watched' : 'Mark watched')).toBeTruthy();
    expect(detail.getByTestId('watched-toggle')).toBeEnabled();

    // The same watched control remains available to retry after the rejection.
    await fireEvent.press(detail.getByTestId('watched-toggle'));
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(2);
      expect(mockMovieWatched).toBe(!initiallyWatched);
      expect(mockMovieFetch).toHaveBeenCalledTimes(1);
      expect(mockActivityFetch).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(moviesKey)).toEqual({
        pages: [initiallyWatched ? [] : [mockMovie]], pageParams: [undefined],
      });
      expect(client.getQueryData(activityKey)).toEqual(mockActivity());
      expect(detail.getByText(initiallyWatched ? 'Mark watched' : 'Watched')).toBeTruthy();
      if (initiallyWatched) {
        expect(shows.queryByTestId('history-item-42')).toBeNull();
        expect(shows.getByText('No recent activity')).toBeTruthy();
      } else {
        expect(shows.getByTestId('history-item-42')).toBeTruthy();
        expect(shows.queryByTestId('history-item-99')).toBeNull();
      }
    });
    expect(request).toHaveBeenLastCalledWith({ id: 42 });
    expect(otherRequest).not.toHaveBeenCalled();
    for (const key of [moviesKey, activityKey, recommendationsKey]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key === moviesKey ? key.slice(0, -1) : key });
    }
    expect(client.getQueryState(recommendationsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryData(recommendationsKey)).toBe(cachedRecommendations);
    expect(mockRecommendationsFetch).not.toHaveBeenCalled();

    // Navigate to the dependent screens using the same account query client.
    await screens.rerender(
      <QueryClientProvider client={client}>
        <View testID="mounted-my-shows"><MyShowsScreen /></View>
        <View testID="returned-home"><HomeScreen /></View>
      </QueryClientProvider>,
    );
    const home = within(screens.getByTestId('returned-home'));
    const expectedRecommendation = initiallyWatched ? 'Unwatched Recommendation' : 'Watched Recommendation';
    await waitFor(() => {
      expect(mockRecommendationsFetch).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(recommendationsKey)).toEqual(mockRecommendations());
      expect(home.getByText(expectedRecommendation)).toBeTruthy();
    });
    await fireEvent.press(shows.getByTestId('tab-movies'));
    await waitFor(() => {
      if (initiallyWatched) {
        expect(shows.getByText('No movies watched yet')).toBeTruthy();
      } else {
        expect(shows.getByText('Example Movie')).toBeTruthy();
        expect(shows.queryByText('Previously Watched Movie')).toBeNull();
      }
    });
    for (const key of [moviesKey, activityKey, recommendationsKey]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
      expect(client.getQueryState(key)?.status).toBe('success');
    }
  } finally {
    await act(async () => screens.unmount());
    invalidate.mockRestore();
    client.clear();
    mockTitleIsMovie = false;
    mockMovieWatched = false;
  }
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

it.each([
  {
    action: 'marking',
    initiallyWatched: false,
    expectedName: 'Watched Episode Recommendation',
  },
  {
    action: 'unmarking',
    initiallyWatched: true,
    expectedName: 'Unwatched Episode Recommendation',
  },
])('fetches and displays updated recommendations after returning to Home after $action an episode', async ({
  initiallyWatched,
  expectedName,
}) => {
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
  const recommendationsKey = [
    ...getGetMyRecommendationsQueryKey(),
    'account',
    'activity-user',
  ];
  client.setQueryData(recommendationsKey, [
    { reason: 'Based on the previous episode history', titles: [{ id: 50, name: 'Old Recommendation' }] },
  ]);

  const detail = await render(
    <QueryClientProvider client={client}><TitleDetailScreen /></QueryClientProvider>,
  );
  await waitFor(() => expect(detail.getByTestId('season-1')).toBeTruthy());
  await fireEvent.press(detail.getByTestId('season-1'));
  await waitFor(() => expect(detail.getByTestId('episode-check-101')).toBeTruthy());
  await fireEvent.press(detail.getByTestId('episode-check-101'));
  await waitFor(() => {
    expect(mockWatched).toBe(!initiallyWatched);
    expect(client.getQueryState(recommendationsKey)?.isInvalidated).toBe(true);
  });
  expect(initiallyWatched ? mockUnmarkRequest : mockMarkRequest).toHaveBeenCalledWith(
    initiallyWatched ? { episodeId: 101 } : { episodeId: 101, data: {} },
  );
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
    expect(home.getByText(expectedName)).toBeTruthy();
  });
  expect(home.queryByText('Old Recommendation')).toBeNull();

  await act(async () => home.unmount());
  client.clear();
});

afterEach(cleanup);
