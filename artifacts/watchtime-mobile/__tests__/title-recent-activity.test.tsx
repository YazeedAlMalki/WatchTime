import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockWatched = false;
let mockTitleIsMovie = false;
let mockMovieWatched = false;
const mockActivityFetch = jest.fn();
const mockShowsFetch = jest.fn();
const mockInProgressFetch = jest.fn();
const mockMovieFetch = jest.fn();
const mockMarkRequest = jest.fn();
const mockUnmarkRequest = jest.fn();
const mockMarkTitleRequest = jest.fn();
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

// Keep React Query real: infinitely fresh, inactive account-scoped collection
// and activity queries must be invalidated before My Shows can fetch new data.
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
import MyShowsScreen from '../app/(tabs)/my-shows';
import {
  getGetMyShowsQueryKey,
  getGetMyInProgressShowsQueryKey,
  getGetMyRecentActivityQueryKey,
} from '@workspace/api-client-react';

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

it('refreshes the account-scoped Movies and History caches after marking a movie watched', async () => {
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
  const { getGetMyMoviesQueryKey, getGetMyRecentActivityQueryKey } =
    require('@workspace/api-client-react');
  const moviesKey = [...getGetMyMoviesQueryKey(), 'account', 'activity-user', 'infinite'];
  const activityKey = [...getGetMyRecentActivityQueryKey(), 'account', 'activity-user'];
  client.setQueryData(moviesKey, { pages: [[]], pageParams: [undefined] });
  client.setQueryData(activityKey, []);

  const detail = await render(
    <QueryClientProvider client={client}><TitleDetailScreen /></QueryClientProvider>,
  );
  await waitFor(() => expect(detail.getByTestId('watched-toggle')).toBeTruthy());
  await fireEvent.press(detail.getByTestId('watched-toggle'));
  await waitFor(() => {
    expect(mockMovieWatched).toBe(true);
    expect(client.getQueryState(moviesKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(activityKey)?.isInvalidated).toBe(true);
  });
  expect(mockMovieFetch).not.toHaveBeenCalled();
  expect(mockActivityFetch).not.toHaveBeenCalled();
  await act(async () => detail.unmount());

  const shows = await render(
    <QueryClientProvider client={client}><MyShowsScreen /></QueryClientProvider>,
  );
  await waitFor(() => {
    expect(mockMovieFetch).toHaveBeenCalledTimes(1);
    expect(mockActivityFetch).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(moviesKey)).toMatchObject({
      pages: [[expect.objectContaining({ id: 42, name: 'Example Movie' })]],
    });
    expect(client.getQueryData(activityKey)).toEqual([
      expect.objectContaining({ titleId: 42, kind: 'movie', titleName: 'Example Movie' }),
    ]);
  });
  fireEvent.press(shows.getByTestId('tab-history'));
  await waitFor(() => {
    expect(shows.getByTestId('history-item-42')).toBeTruthy();
    expect(shows.getByText('Example Movie')).toBeTruthy();
    expect(shows.getByText('movie')).toBeTruthy();
  });
  await act(async () => shows.unmount());
  client.clear();
  mockTitleIsMovie = false;
});

afterEach(cleanup);
