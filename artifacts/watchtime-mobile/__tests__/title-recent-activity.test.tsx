import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockWatched = false;
const mockActivityFetch = jest.fn();
const mockMarkRequest = jest.fn();
const mockUnmarkRequest = jest.fn();
const mockActivity = () => mockWatched ? [{
  titleId: 42, titleName: 'Example Show', posterUrl: null,
  kind: 'episode', episodeLabel: 'S1E1 — Pilot', watchedAt: '2026-10-18T00:00:00.000Z',
}] : [];
const mockSeason = { seasonNumber: 1, name: 'Season 1', episodeCount: 1 };

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

// Keep React Query real: infinitely fresh, inactive account-scoped activity must
// be invalidated by the title screen before My Shows can fetch the changed feed.
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
        id, name: 'Example Show', type: 'series', genres: [], altTitles: [],
        providers: [], seasons: [{ ...mockSeason, watchedCount: Number(mockWatched) }],
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
    useMarkTitleWatched: idleMutation, useUnmarkTitleWatched: idleMutation,
    getMyShows: async () => [], getMyInProgressShows: async () => [],
    getMyMovies: async () => [],
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
import { getGetMyRecentActivityQueryKey } from '@workspace/api-client-react';

it.each([
  { action: 'mark', initiallyWatched: false },
  { action: 'unmark', initiallyWatched: true },
])('refreshes cached My Shows History after $action from title detail', async ({ initiallyWatched }) => {
  mockWatched = initiallyWatched;
  jest.clearAllMocks();
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const activityKey = [...getGetMyRecentActivityQueryKey(), 'account', 'activity-user'];
  client.setQueryData(activityKey, mockActivity());
  const oldActivity = client.getQueryData(activityKey);
  const detail = await render(
    <QueryClientProvider client={client}><TitleDetailScreen /></QueryClientProvider>,
  );
  await waitFor(() => expect(detail.getByTestId('season-1')).toBeTruthy());
  fireEvent.press(detail.getByTestId('season-1'));
  await waitFor(() => expect(detail.getByTestId('episode-check-101')).toBeTruthy());
  fireEvent.press(detail.getByTestId('episode-check-101'));
  await waitFor(() => {
    expect(mockWatched).toBe(!initiallyWatched);
    expect(client.getQueryState(activityKey)?.isInvalidated).toBe(true);
  });
  expect(initiallyWatched ? mockUnmarkRequest : mockMarkRequest).toHaveBeenCalledWith(
    initiallyWatched ? { episodeId: 101 } : { episodeId: 101, data: {} },
  );
  expect(mockActivityFetch).not.toHaveBeenCalled();
  expect(client.getQueryData(activityKey)).toEqual(oldActivity);
  await act(async () => detail.unmount());

  const shows = await render(
    <QueryClientProvider client={client}><MyShowsScreen /></QueryClientProvider>,
  );
  await waitFor(() => {
    expect(mockActivityFetch).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(activityKey)).toEqual(mockActivity());
  });
  fireEvent.press(shows.getByTestId('tab-history'));
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

afterEach(cleanup);
