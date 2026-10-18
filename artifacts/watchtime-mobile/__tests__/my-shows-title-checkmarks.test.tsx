import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGetSeason } from '@workspace/api-client-react';

const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockWatched = new Set<number>();
const mockSeasons = [
  { seasonNumber: 1, name: 'Season 1', episodeCount: 2 },
  { seasonNumber: 2, name: 'Season 2', episodeCount: 2 },
];
const mockEpisodes = [
  { id: 101, seasonNumber: 1, episodeNumber: 1, name: 'Pilot' },
  { id: 102, seasonNumber: 1, episodeNumber: 2, name: 'Second' },
  { id: 201, seasonNumber: 2, episodeNumber: 1, name: 'Third' },
  { id: 202, seasonNumber: 2, episodeNumber: 2, name: 'Fourth' },
];
const mockTitleFetch = jest.fn();
const mockSeasonFetch = jest.fn();
const mockRecentActivityFetch = jest.fn();
const mockMarkRequest = jest.fn(async (_request: unknown) => ({ ok: true }));
const mockTitleData = () => ({
  id: 42, name: 'Example Show', type: 'series', year: 2024,
  genres: [], altTitles: [], providers: [], inWatchlist: false,
  seasons: mockSeasons.map((season) => ({
    ...season,
    watchedCount: mockEpisodes.filter(
      (ep) => ep.seasonNumber === season.seasonNumber && mockWatched.has(ep.id),
    ).length,
  })),
});
const mockSeasonData = (season: number) => ({
  episodes: mockEpisodes
    .filter((ep) => ep.seasonNumber === season)
    .map((ep) => ({ ...ep, watched: mockWatched.has(ep.id) })),
});

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: '42' }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/app-auth', () => ({
  useAppAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'checkmarks-user' }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('react-native-keyboard-controller', () => {
  const { View } = require('react-native');
  return {
    KeyboardAvoidingView: ({ children, ...props }: { children: React.ReactNode }) =>
      <View {...props}>{children}</View>,
  };
});
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Feather: ({ name }: { name: string }) => <Text testID={`icon-${name}`} /> };
});
jest.mock('@/components/ui', () => {
  const { Text, View } = require('react-native');
  return {
    SectionHeader: ({ title }: { title: string }) => <Text>{title}</Text>,
    EmptyState: () => null, ErrorState: () => null,
    Loading: () => <View testID="loading" />, PosterCard: () => null,
  };
});
jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff', foreground: '#000', mutedForeground: '#777',
    primary: '#6633cc', primaryForeground: '#fff', card: '#eee',
    border: '#ccc', secondary: '#eee', muted: '#ddd', destructive: '#c00',
  }),
}));
jest.mock('@/constants/colors', () => ({ __esModule: true, default: { radius: 8 } }));

// React Query stays real so mutations exercise the generated-key invalidation
// paths for collection data, history, and title details.
jest.mock('@workspace/api-client-react', () => {
  const { useMutation, useQuery } = require('@tanstack/react-query');
  const titleKey = (id: number) => [`/api/titles/${id}`];
  const seasonKey = (id: number, season: number) => [`/api/titles/${id}/seasons/${season}`];
  return {
    getGetTitleQueryKey: titleKey,
    getGetSeasonQueryKey: seasonKey,
    getGetMyShowsQueryKey: () => ['/api/me/shows'],
    getGetMyInProgressShowsQueryKey: () => ['/api/me/in-progress'],
    getGetMyMoviesQueryKey: () => ['/api/me/movies'],
    getGetMyRecentActivityQueryKey: () => ['/api/me/activity'],
    getGetMyRecommendationsQueryKey: () => ['/api/me/recommendations'],
    getGetMyWatchlistQueryKey: () => ['/api/me/watchlist'],
    getGetTitleSafetyQueryKey: () => ['/api/safety'],
    getMyShows: jest.fn(async () => {
      const nextEpisode = mockEpisodes.find((episode) => !mockWatched.has(episode.id)) ?? null;
      return [{
        title: { id: 42, name: 'Example Show' },
        nextEpisode: nextEpisode ? { ...nextEpisode } : null,
        totalEpisodes: 4,
        watchedEpisodes: mockWatched.size,
      }];
    }),
    getMyInProgressShows: async () => [],
    getMyMovies: async () => [],
    mergeTrackedShows: (shows: any[], inProgress: any[]) => [...inProgress, ...shows],
    useGetMyRecentActivity: (options: {
      query?: { enabled?: boolean; queryKey?: readonly unknown[] };
    } = {}) => useQuery({
      queryKey: options.query?.queryKey ?? ['/api/me/activity'],
      queryFn: async () => {
        mockRecentActivityFetch();
        return mockWatched.has(201) ? [{
          titleId: 42,
          titleName: 'Example Show',
          posterUrl: null,
          kind: 'episode',
          episodeLabel: 'S2E1',
          watchedAt: '2026-10-05T00:00:00.000Z',
        }] : [];
      },
      enabled: options.query?.enabled ?? true,
    }),
    useGetTitle: (id: number) => useQuery({
      queryKey: titleKey(id),
      queryFn: () => { mockTitleFetch(); return mockTitleData(); },
    }),
    useGetSeason: (id: number, season: number, options: { query: { enabled: boolean } }) =>
      useQuery({
        queryKey: seasonKey(id, season),
        queryFn: () => { mockSeasonFetch(season); return mockSeasonData(season); },
        enabled: options.query.enabled,
      }),
    useGetSimilarTitles: () => ({ data: [] }),
    useGetTitleSafety: () => ({ data: null, isLoading: false }),
    useMarkEpisodeWatched: (options: { mutation: { onSuccess: () => void } }) =>
      useMutation({
        mutationFn: async ({ episodeId, data }: { episodeId: number; data: { includePrevious?: boolean } }) => {
          await mockMarkRequest({ episodeId, data });
          if (data.includePrevious) {
            const target = mockEpisodes.find((ep) => ep.id === episodeId)!;
            mockEpisodes
              .filter((ep) => ep.seasonNumber < target.seasonNumber ||
                (ep.seasonNumber === target.seasonNumber && ep.episodeNumber <= target.episodeNumber))
              .forEach((ep) => mockWatched.add(ep.id));
          } else {
            mockWatched.add(episodeId);
          }
          return { ok: true };
        },
        onSuccess: options.mutation.onSuccess,
      }),
    useUnmarkEpisodeWatched: () => ({ mutate: jest.fn(), isPending: false }),
    useAddToWatchlist: () => ({ mutate: jest.fn(), isPending: false }),
    useRemoveFromWatchlist: () => ({ mutate: jest.fn(), isPending: false }),
    useMarkTitleWatched: () => ({ mutate: jest.fn(), isPending: false }),
    useUnmarkTitleWatched: () => ({ mutate: jest.fn(), isPending: false }),
  };
});

import MyShowsScreen from '../app/(tabs)/my-shows';
import TitleDetailScreen from '../app/title/[id]';

function SeasonRows({ season }: { season: number }) {
  const detail = useGetSeason(42, season, { query: { enabled: true } as any });
  return (
    <View>
      {detail.data?.episodes.map((ep) => (
        <Text key={ep.id} testID={`episode-state-${ep.id}`}>
          {ep.watched ? '✓' : '○'} {ep.name}
        </Text>
      ))}
    </View>
  );
}

function deferredMarkResponse() {
  let resolve!: (response: { ok: boolean }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ ok: boolean }>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

it('keeps Up Next unchanged on failure and refreshes collection, history, and title caches after retry', async () => {
  mockWatched.clear();
  mockWatched.add(101);
  mockWatched.add(102);
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const {
    getGetSeasonQueryKey,
    getGetTitleQueryKey,
    getGetMyShowsQueryKey,
    getGetMyRecentActivityQueryKey,
  } = require('@workspace/api-client-react');
  client.setQueryData(getGetTitleQueryKey(42), mockTitleData());
  for (const season of mockSeasons) {
    client.setQueryData(getGetSeasonQueryKey(42, season.seasonNumber), mockSeasonData(season.seasonNumber));
  }
  client.setQueryData(getGetSeasonQueryKey(420, 1), { episodes: [] });

  const shows = await render(
    <QueryClientProvider client={client}><MyShowsScreen /></QueryClientProvider>,
  );
  await waitFor(() => expect(shows.getByTestId('mark-watched-201')).toBeTruthy());
  const api = require('@workspace/api-client-react');
  api.getMyShows.mockClear();

  fireEvent.changeText(shows.getByTestId('shows-search-input'), '  Example ');
  await waitFor(() => {
    expect(api.getMyShows).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'Example' }),
      expect.anything(),
    );
  });
  expect(shows.getByTestId('show-row-42')).toBeTruthy();

  fireEvent.press(shows.getByTestId('shows-search-clear'));
  await waitFor(() => expect(shows.getByTestId('shows-search-input').props.value).toBe(''));

  fireEvent.press(shows.getByTestId('filter-chip-caught-up'));
  await waitFor(() => {
    expect(api.getMyShows).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'caught-up' }),
      expect.anything(),
    );
  });
  expect(shows.queryByTestId('show-row-42')).toBeNull();

  fireEvent.press(shows.getByTestId('filter-chip-up-next'));
  await waitFor(() => {
    expect(api.getMyShows).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'up-next' }),
      expect.anything(),
    );
  });
  await waitFor(() => expect(shows.getByTestId('mark-watched-201')).toBeTruthy());

  const showQuery = client.getQueryCache().findAll({ queryKey: getGetMyShowsQueryKey() })[0];
  const recentActivityQuery = client.getQueryCache().findAll({
    queryKey: getGetMyRecentActivityQueryKey(),
  })[0];
  expect(showQuery?.queryKey[1]).toBe('account');
  expect(recentActivityQuery?.queryKey).toEqual([
    ...getGetMyRecentActivityQueryKey(),
    'account',
    'checkmarks-user',
  ]);
  const showsFetchesBeforeWatch = api.getMyShows.mock.calls.length;
  const historyFetchesBeforeWatch = mockRecentActivityFetch.mock.calls.length;
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  mockMarkRequest.mockRejectedValueOnce(new Error('Network unavailable'));
  const stopPropagation = jest.fn();
  await fireEvent.press(shows.getByTestId('mark-watched-201'), { stopPropagation });
  await waitFor(() => {
    expect(shows.getByRole('alert').props.children).toBe(
      "Couldn't mark this episode as watched. Please try again.",
    );
    expect(shows.getByText('Retry')).toBeTruthy();
  });
  expect(stopPropagation).toHaveBeenCalled();
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect([...mockWatched].sort()).toEqual([101, 102]);
  expect(shows.getByText('2 / 4 episodes')).toBeTruthy();
  expect(shows.getByText('S2 E1 · Third')).toBeTruthy();
  expect(shows.queryByTestId('mark-watched-202')).toBeNull();
  expect(api.getMyShows.mock.calls.length).toBe(showsFetchesBeforeWatch);
  expect(mockRecentActivityFetch.mock.calls.length).toBe(historyFetchesBeforeWatch);
  expect(invalidate).not.toHaveBeenCalled();
  expect(mockMarkRequest).toHaveBeenCalledTimes(1);

  const expectPendingRetry = async (requestCount: number) => {
    await waitFor(() => {
      expect(shows.getByTestId('mark-watched-201')).toBeDisabled();
      expect(shows.queryByRole('alert')).toBeNull();
      expect(shows.queryByText('Retry')).toBeNull();
      expect(mockMarkRequest).toHaveBeenCalledTimes(requestCount);
    });
    await fireEvent.press(shows.getByTestId('mark-watched-201'));
    await fireEvent.press(shows.getByTestId('mark-watched-201'));
    expect(mockMarkRequest).toHaveBeenCalledTimes(requestCount);
    expect([...mockWatched].sort()).toEqual([101, 102]);
    expect(shows.getByText('2 / 4 episodes')).toBeTruthy();
    expect(shows.getByText('S2 E1 · Third')).toBeTruthy();
    expect(shows.queryByTestId('mark-watched-202')).toBeNull();
    expect(api.getMyShows.mock.calls.length).toBe(showsFetchesBeforeWatch);
    expect(mockRecentActivityFetch.mock.calls.length).toBe(historyFetchesBeforeWatch);
    expect(invalidate).not.toHaveBeenCalled();
  };

  const failedRetry = deferredMarkResponse();
  mockMarkRequest.mockImplementationOnce(() => failedRetry.promise);
  await fireEvent.press(shows.getByTestId('mark-watched-201'));
  await expectPendingRetry(2);
  await act(async () => failedRetry.reject(new Error('Still offline')));
  await waitFor(() => {
    expect(shows.getByTestId('mark-watched-201')).toBeEnabled();
    expect(shows.getByRole('alert').props.children).toBe(
      "Couldn't mark this episode as watched. Please try again.",
    );
    expect(shows.getByText('Retry')).toBeTruthy();
  });
  expect([...mockWatched].sort()).toEqual([101, 102]);
  expect(invalidate).not.toHaveBeenCalled();

  const successfulRetry = deferredMarkResponse();
  mockMarkRequest.mockImplementationOnce(() => successfulRetry.promise);
  await fireEvent.press(shows.getByTestId('mark-watched-201'));
  await expectPendingRetry(3);
  await act(async () => successfulRetry.resolve({ ok: true }));
  await waitFor(() => {
    expect([...mockWatched].sort()).toEqual([101, 102, 201]);
    expect(api.getMyShows.mock.calls.length).toBeGreaterThan(showsFetchesBeforeWatch);
    expect(mockRecentActivityFetch.mock.calls.length).toBeGreaterThan(historyFetchesBeforeWatch);
    expect(shows.getByTestId('mark-watched-202')).toBeTruthy();
    expect(shows.getByText('3 / 4 episodes')).toBeTruthy();
    expect(client.getQueryState(getGetTitleQueryKey(42))?.isInvalidated).toBe(true);
    expect(client.getQueryState(getGetSeasonQueryKey(42, 1))?.isInvalidated).toBe(true);
    expect(client.getQueryState(getGetSeasonQueryKey(42, 2))?.isInvalidated).toBe(true);
  });
  expect(mockMarkRequest).toHaveBeenCalledTimes(3);
  expect(mockMarkRequest).toHaveBeenNthCalledWith(1, {
    episodeId: 201, data: { includePrevious: true },
  });
  expect(mockMarkRequest).toHaveBeenNthCalledWith(2, {
    episodeId: 201, data: { includePrevious: true },
  });
  expect(mockMarkRequest).toHaveBeenNthCalledWith(3, {
    episodeId: 201, data: { includePrevious: true },
  });
  expect(shows.getByTestId('mark-watched-202')).toBeEnabled();
  expect(shows.queryByRole('alert')).toBeNull();
  expect(shows.queryByText('Retry')).toBeNull();
  expect(client.getQueryState(getGetSeasonQueryKey(420, 1))?.isInvalidated).toBe(false);

  fireEvent.press(shows.getByTestId('tab-history'));
  await waitFor(() => {
    expect(shows.getByTestId('history-item-42')).toBeTruthy();
    expect(shows.getByText('S2E1')).toBeTruthy();
  });
  fireEvent.press(shows.getByTestId('history-item-42'));
  expect(mockRouter.push).toHaveBeenCalledWith('/title/42');
  await act(async () => shows.unmount());

  const detail = await render(
    <QueryClientProvider client={client}>
      <TitleDetailScreen />
      <SeasonRows season={1} />
      <SeasonRows season={2} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(detail.getByText('2/2 watched')).toBeTruthy();
    expect(detail.getByText('1/2 watched')).toBeTruthy();
    expect(detail.getByTestId('episode-state-101').props.children).toEqual(['✓', ' ', 'Pilot']);
    expect(detail.getByTestId('episode-state-102').props.children).toEqual(['✓', ' ', 'Second']);
    expect(detail.getByTestId('episode-state-201').props.children).toEqual(['✓', ' ', 'Third']);
    expect(detail.getByTestId('episode-state-202').props.children).toEqual(['○', ' ', 'Fourth']);
  });
  expect(mockTitleFetch).toHaveBeenCalled();
  expect(mockSeasonFetch).toHaveBeenCalledWith(1);
  expect(mockSeasonFetch).toHaveBeenCalledWith(2);
  await act(async () => detail.unmount());
  client.clear();
});

afterEach(cleanup);