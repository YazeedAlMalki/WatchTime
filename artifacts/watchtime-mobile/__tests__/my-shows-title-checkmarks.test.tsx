import React from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGetSeason } from '@workspace/api-client-react';

const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockWatched = new Set<number>();
let mockUserId = 'checkmarks-user';
const mockAccountWatched = new Map<string, Set<number>>([
  ['checkmarks-user', mockWatched],
]);
const mockWatchedForAccount = (userId = mockUserId) => {
  const watched = mockAccountWatched.get(userId);
  if (!watched) throw new Error(`Missing watched fixture for ${userId}`);
  return watched;
};
const mockActivityForAccount = (userId = mockUserId) => {
  const watched = mockWatchedForAccount(userId);
  return [
    ...(watched.has(201) ? [{
      titleId: 42, titleName: 'Example Show', posterUrl: null, kind: 'episode',
      episodeLabel: 'S2E1', watchedAt: '2026-10-05T00:00:00.000Z',
    }] : []),
    ...(watched.has(301) ? [{
      titleId: 44, titleName: 'Other Show', posterUrl: null, kind: 'episode',
      episodeLabel: 'S1E1', watchedAt: '2026-10-04T00:00:00.000Z',
    }] : []),
  ];
};
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
const mockOtherEpisodes = [
  { id: 301, seasonNumber: 1, episodeNumber: 1, name: 'Other Pilot' },
  { id: 302, seasonNumber: 1, episodeNumber: 2, name: 'Other Second' },
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
      (ep) => ep.seasonNumber === season.seasonNumber && mockWatchedForAccount().has(ep.id),
    ).length,
  })),
});
const mockSeasonData = (season: number) => ({
  episodes: mockEpisodes
    .filter((ep) => ep.seasonNumber === season)
    .map((ep) => ({ ...ep, watched: mockWatchedForAccount().has(ep.id) })),
});

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useIsFocused: () => true,
  useLocalSearchParams: () => ({ id: '42' }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/app-auth', () => ({
  useAppAuth: () => ({ isLoaded: true, isSignedIn: true, userId: mockUserId }),
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
    getMyShows: jest.fn(async (params?: { q?: string; status?: string }) => {
      const watched = mockWatchedForAccount();
      if (params?.q?.toLowerCase() === 'local title') {
        return [{
          title: { id: 43, name: 'Different Canonical Name' },
          matchedAlternateTitle: 'Local Title',
          nextEpisode: null,
          totalEpisodes: 1,
          watchedEpisodes: 1,
        }];
      }
      const nextEpisode = mockEpisodes.find((episode) => !watched.has(episode.id)) ?? null;
      const shows = [{
        title: { id: 42, name: 'Example Show' },
        matchedAlternateTitle: null,
        nextEpisode: nextEpisode ? { ...nextEpisode } : null,
        totalEpisodes: 4,
        watchedEpisodes: mockEpisodes.filter((ep) => watched.has(ep.id)).length,
      }, {
        title: { id: 44, name: 'Other Show' },
        matchedAlternateTitle: null,
        nextEpisode: mockOtherEpisodes.find((ep) => !watched.has(ep.id)) ?? null,
        totalEpisodes: mockOtherEpisodes.length,
        watchedEpisodes: mockOtherEpisodes.filter((ep) => watched.has(ep.id)).length,
      }];
      return shows.filter((show) => {
        if (params?.q && !show.title.name.toLowerCase().includes(params.q.toLowerCase())) return false;
        if (params?.status === 'up-next' && !show.nextEpisode) return false;
        if (params?.status === 'caught-up' && show.nextEpisode) return false;
        return true;
      });
    }),
    getMyInProgressShows: async () => [],
    getMyMovies: async () => [],
    mergeTrackedShows: (shows: any[], inProgress: any[]) => [...inProgress, ...shows],
    useGetMyRecentActivity: (options: {
      query?: { enabled?: boolean; queryKey?: readonly unknown[] };
    } = {}) => useQuery({
      queryKey: options.query?.queryKey ?? ['/api/me/activity'],
      queryFn: async () => {
        mockRecentActivityFetch(mockUserId);
        return mockActivityForAccount();
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
          // A request belongs to the account that sent it, not the identity
          // that happens to be active when its deferred response finishes.
          const watched = mockWatchedForAccount();
          await mockMarkRequest({ episodeId, data });
          if (data.includePrevious) {
            const episodes = mockEpisodes.some((ep) => ep.id === episodeId)
              ? mockEpisodes : mockOtherEpisodes;
            const target = episodes.find((ep) => ep.id === episodeId)!;
            episodes
              .filter((ep) => ep.seasonNumber < target.seasonNumber ||
                (ep.seasonNumber === target.seasonNumber && ep.episodeNumber <= target.episodeNumber))
              .forEach((ep) => watched.add(ep.id));
          } else {
            watched.add(episodeId);
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

it('shows the matching alternate title beneath the canonical show title', async () => {
  mockWatched.clear();
  mockRouter.push.mockClear();
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const api = require('@workspace/api-client-react');
  api.getMyShows.mockClear();
  const shows = await render(
    <QueryClientProvider client={client}><MyShowsScreen /></QueryClientProvider>,
  );

  await waitFor(() => expect(shows.getByTestId('show-row-42')).toBeTruthy());
  fireEvent.changeText(shows.getByTestId('shows-search-input'), 'Example');
  await waitFor(() => {
    expect(api.getMyShows).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'Example' }),
      expect.anything(),
    );
  });
  expect(shows.queryByText(/^Matched:/)).toBeNull();

  fireEvent.changeText(shows.getByTestId('shows-search-input'), 'Local Title');
  await waitFor(() => {
    expect(shows.getByText('Different Canonical Name')).toBeTruthy();
    expect(shows.getByText('Matched: Local Title')).toBeTruthy();
  });
  fireEvent.press(shows.getByTestId('show-row-43'));
  expect(mockRouter.push).toHaveBeenCalledWith('/title/43');
});

it('keeps episode marks and History isolated across shows, tabs, and accounts', async () => {
  mockWatched.clear();
  mockRouter.push.mockClear();
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
  try {
  await waitFor(() => expect(shows.getByTestId('mark-watched-201')).toBeTruthy());
  await expectEpisodeScopedFailures(shows, client);
  await checkPendingMarksAfterOpeningHistory(shows, client);
  await checkPendingMarksAfterLeavingScreen(shows, client);
  await checkPendingMarksAfterAccountSwitch(shows, client);
  // Restore this journey's baseline without remounting the Expo screen.
  mockWatched.clear();
  mockWatched.add(101);
  mockWatched.add(102);
  mockMarkRequest.mockClear();
  await act(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: getGetMyShowsQueryKey() }),
      client.invalidateQueries({ queryKey: getGetMyRecentActivityQueryKey() }),
    ]);
  });
  await waitFor(() => expect(shows.getByTestId('mark-watched-201')).toBeEnabled());
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

  fireEvent.changeText(shows.getByTestId('shows-search-input'), '  Local Title  ');
  await waitFor(() => {
    expect(api.getMyShows).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'Local Title' }),
      expect.anything(),
    );
    expect(shows.getByTestId('show-row-43')).toBeTruthy();
  });
  expect(shows.queryByTestId('show-row-42')).toBeNull();

  fireEvent.press(shows.getByTestId('shows-search-clear'));
  await waitFor(() => {
    expect(shows.getByTestId('shows-search-input').props.value).toBe('');
    expect(shows.getByTestId('show-row-42')).toBeTruthy();
    expect(shows.queryByTestId('show-row-43')).toBeNull();
  });

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
  let showsFetchesBeforeWatch = api.getMyShows.mock.calls.length;
  let historyFetchesBeforeWatch = mockRecentActivityFetch.mock.calls.length;

  const showsBaseKey = [
    ...getGetMyShowsQueryKey(),
    'account',
    'checkmarks-user',
    'infinite',
  ];
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

  const failedRow = () => within(shows.getByTestId('show-row-42'));
  const otherRow = () => within(shows.getByTestId('show-row-44'));
  const expectFailedRowUnchanged = () => {
    expect(failedRow().getByRole('alert').props.children).toBe(
      "Couldn't mark this episode as watched. Please try again.",
    );
    expect(failedRow().getByText('Retry')).toBeTruthy();
    expect(failedRow().getByTestId('mark-watched-201')).toBeEnabled();
    expect(failedRow().getByText('2 / 4 episodes')).toBeTruthy();
    expect(failedRow().getByText('S2 E1 · Third')).toBeTruthy();
    expect(failedRow().queryByTestId('mark-watched-202')).toBeNull();
    expect(mockEpisodes.filter((ep) => mockWatched.has(ep.id)).map((ep) => ep.id))
      .toEqual([101, 102]);
    expect(shows.getAllByRole('alert')).toHaveLength(1);
    expect(shows.getAllByText('Retry')).toHaveLength(1);
    expect(otherRow().queryByRole('alert')).toBeNull();
    expect(otherRow().queryByText('Retry')).toBeNull();
  };
  expectFailedRowUnchanged();
  expect(otherRow().getByTestId('mark-watched-301')).toBeEnabled();
  expect(otherRow().getByText('0 / 2 episodes')).toBeTruthy();
  expect(otherRow().getByText('S1 E1 · Other Pilot')).toBeTruthy();

  const otherShowMark = deferredMarkResponse();
  mockMarkRequest.mockImplementationOnce(() => otherShowMark.promise);
  await fireEvent.press(otherRow().getByTestId('mark-watched-301'));
  await waitFor(() => {
    expect(otherRow().getByTestId('mark-watched-301')).toBeDisabled();
    expect(mockMarkRequest).toHaveBeenCalledTimes(2);
  });
  expectFailedRowUnchanged();
  expect(otherRow().getByText('0 / 2 episodes')).toBeTruthy();
  await act(async () => otherShowMark.resolve({ ok: true }));
  await waitFor(() => {
    expect(api.getMyShows.mock.calls.length).toBeGreaterThan(showsFetchesBeforeWatch);
    expect(otherRow().getByText('1 / 2 episodes')).toBeTruthy();
    expect(otherRow().getByText('S1 E2 · Other Second')).toBeTruthy();
    expect(otherRow().getByTestId('mark-watched-302')).toBeEnabled();
    expect(otherRow().queryByTestId('mark-watched-301')).toBeNull();
    expectFailedRowUnchanged();
  });
  expect([...mockWatched].sort()).toEqual([101, 102, 301]);
  // Continue checking the failed show's retries against the refreshed baseline.
  showsFetchesBeforeWatch = api.getMyShows.mock.calls.length;
  historyFetchesBeforeWatch = mockRecentActivityFetch.mock.calls.length;
  invalidate.mockClear();

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
    expect([...mockWatched].sort()).toEqual([101, 102, 301]);
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
  await expectPendingRetry(3);
  await act(async () => failedRetry.reject(new Error('Still offline')));
  await waitFor(() => {
    expect(shows.getByTestId('mark-watched-201')).toBeEnabled();
    expect(shows.getByRole('alert').props.children).toBe(
      "Couldn't mark this episode as watched. Please try again.",
    );
    expect(shows.getByText('Retry')).toBeTruthy();
  });
  expect([...mockWatched].sort()).toEqual([101, 102, 301]);
  expect(invalidate).not.toHaveBeenCalled();

  const successfulRetry = deferredMarkResponse();

  const countShowsRequestsForStatus = (status: 'up-next' | 'caught-up') =>
    api.getMyShows.mock.calls.filter(
      (call: [{ q?: string; status?: string }]) => call[0].status === status,
    ).length;
  const caughtUpQueries = client.getQueryCache().findAll({
    queryKey: getGetMyShowsQueryKey(),
  }).filter((query) => {
    const params = query.queryKey.at(-1) as { q?: string; status?: string };
    return params?.status === 'caught-up';
  });
  expect(caughtUpQueries.length).toBeGreaterThan(0);
  const upNextFetchesBeforePartialSuccess = countShowsRequestsForStatus('up-next');

  mockMarkRequest.mockImplementationOnce(() => successfulRetry.promise);
  await fireEvent.press(shows.getByTestId('mark-watched-201'));
  await expectPendingRetry(4);
  await act(async () => successfulRetry.resolve({ ok: true }));
  await waitFor(() => {
    expect([...mockWatched].sort()).toEqual([101, 102, 201, 301]);
    expect(api.getMyShows.mock.calls.length).toBeGreaterThan(showsFetchesBeforeWatch);
    expect(countShowsRequestsForStatus('up-next')).toBeGreaterThan(upNextFetchesBeforePartialSuccess);
    expect(mockRecentActivityFetch.mock.calls.length).toBeGreaterThan(historyFetchesBeforeWatch);
    expect(shows.getByTestId('mark-watched-202')).toBeTruthy();
    expect(shows.getByText('3 / 4 episodes')).toBeTruthy();
    expect(shows.getByText('S2 E2 · Fourth')).toBeTruthy();
    expect(client.getQueryState(getGetTitleQueryKey(42))?.isInvalidated).toBe(true);
    expect(client.getQueryState(getGetSeasonQueryKey(42, 1))?.isInvalidated).toBe(true);
    expect(client.getQueryState(getGetSeasonQueryKey(42, 2))?.isInvalidated).toBe(true);
    caughtUpQueries.forEach((query) => {
      expect(query.queryKey.slice(0, showsBaseKey.length)).toEqual(showsBaseKey);
      expect(query.state.isInvalidated).toBe(true);
    });
  });
  expect(mockMarkRequest).toHaveBeenCalledTimes(4);
  expect(mockMarkRequest).toHaveBeenNthCalledWith(1, {
    episodeId: 201, data: { includePrevious: true },
  });
  expect(mockMarkRequest).toHaveBeenNthCalledWith(2, {
    episodeId: 301, data: { includePrevious: true },
  });
  expect(mockMarkRequest).toHaveBeenNthCalledWith(3, {
    episodeId: 201, data: { includePrevious: true },
  });
  expect(mockMarkRequest).toHaveBeenNthCalledWith(4, {
    episodeId: 201, data: { includePrevious: true },
  });
  expect(shows.getByTestId('mark-watched-202')).toBeEnabled();
  expect(shows.queryByRole('alert')).toBeNull();
  expect(shows.queryByText('Retry')).toBeNull();
  expect(client.getQueryState(getGetSeasonQueryKey(420, 1))?.isInvalidated).toBe(false);

  const upNextFetchesBeforeFinalEpisode = countShowsRequestsForStatus('up-next');
  await fireEvent.press(shows.getByTestId('mark-watched-202'));
  await waitFor(() => {
    expect(mockWatched.has(202)).toBe(true);
    expect(shows.queryByTestId('show-row-42')).toBeNull();
    expect(countShowsRequestsForStatus('up-next')).toBeGreaterThan(upNextFetchesBeforeFinalEpisode);
  });
  expect(caughtUpQueries.every((query) => query.state.isInvalidated)).toBe(true);

  const caughtUpFetchesBeforeFilterChange = countShowsRequestsForStatus('caught-up');
  fireEvent.press(shows.getByTestId('filter-chip-caught-up'));
  await waitFor(() => {
    expect(shows.getByTestId('show-row-42')).toBeTruthy();
    expect(shows.getByText('All caught up!')).toBeTruthy();
    expect(shows.getByText('4 / 4 episodes')).toBeTruthy();
    expect(countShowsRequestsForStatus('caught-up')).toBeGreaterThan(caughtUpFetchesBeforeFilterChange);
  });

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
    expect(detail.getAllByText('2/2 watched')).toHaveLength(2);
    expect(detail.getByTestId('episode-state-101').props.children).toEqual(['✓', ' ', 'Pilot']);
    expect(detail.getByTestId('episode-state-102').props.children).toEqual(['✓', ' ', 'Second']);
    expect(detail.getByTestId('episode-state-201').props.children).toEqual(['✓', ' ', 'Third']);
    expect(detail.getByTestId('episode-state-202').props.children).toEqual(['✓', ' ', 'Fourth']);
  });
  expect(mockTitleFetch).toHaveBeenCalled();
  expect(mockSeasonFetch).toHaveBeenCalledWith(1);
  expect(mockSeasonFetch).toHaveBeenCalledWith(2);
  await act(async () => detail.unmount());
  } finally {
    await cleanup();
    client.clear();
  }
});

async function checkPendingMarksAfterAccountSwitch(
  shows: Awaited<ReturnType<typeof render>>,
  client: QueryClient,
) {
  const api = require('@workspace/api-client-react');
  const originalUserId = mockUserId;
  const firstAccount = 'pending-mark-account';
  const secondAccount = 'unrelated-history-account';
  const activityKey = (userId: string) => [
    ...api.getGetMyRecentActivityQueryKey(), 'account', userId,
  ];
  const showsKey = (userId: string) => [
    ...api.getGetMyShowsQueryKey(), 'account', userId, 'infinite',
    { q: undefined, status: undefined },
  ];
  const switchAccount = async (userId: string) => {
    mockUserId = userId;
    await shows.rerender(
      <QueryClientProvider client={client}><MyShowsScreen /></QueryClientProvider>,
    );
  };
  const heldRequests: ReturnType<typeof deferredMarkResponse>[] = [];
  try {
    // Exercise both outcomes in one mounted screen and one real QueryClient.
    // The same title exists in both accounts with deliberately different progress.
    for (const outcome of ['error', 'success'] as const) {
      mockAccountWatched.set(firstAccount, new Set([101, 102]));
      mockAccountWatched.set(secondAccount, new Set([301]));
      for (const userId of [firstAccount, secondAccount]) {
        mockUserId = userId;
        client.setQueryData(showsKey(userId), {
          pages: [await api.getMyShows({})], pageParams: [undefined],
        });
        client.setQueryData(activityKey(userId), mockActivityForAccount(userId));
        client.setQueryData([
          ...api.getGetMyInProgressShowsQueryKey(), 'account', userId, 'infinite',
        ], { pages: [[]], pageParams: [undefined] });
        client.setQueryData([
          ...api.getGetMyMoviesQueryKey(), 'account', userId, 'infinite',
        ], { pages: [[]], pageParams: [undefined] });
      }
      await switchAccount(firstAccount);
      await fireEvent.press(shows.getByTestId('tab-shows'));
      await waitFor(() => {
        expect(shows.getByTestId('mark-watched-201')).toBeEnabled();
        expect(within(shows.getByTestId('show-row-42')).getByText('2 / 4 episodes')).toBeTruthy();
      });
      const secondShows = client.getQueryData(showsKey(secondAccount));
      const secondActivity = client.getQueryData(activityKey(secondAccount));
      for (const userId of [firstAccount, secondAccount]) {
        for (const key of [showsKey(userId), activityKey(userId)]) {
          const query = client.getQueryCache().find({ queryKey: key, exact: true })!;
          expect(query.options).toEqual(expect.objectContaining({ staleTime: Infinity }));
          expect(query.isStale()).toBe(false);
        }
      }

      const held = deferredMarkResponse();
      heldRequests.push(held);
      mockMarkRequest.mockImplementationOnce(() => held.promise);
      await fireEvent.press(shows.getByTestId('mark-watched-201'));
      await waitFor(() => expect(shows.getByTestId('mark-watched-201')).toBeDisabled());
      const pendingMutation = client.getMutationCache().getAll().find(
        (mutation) => mutation.state.status === 'pending',
      )!;
      expect(pendingMutation.state.variables).toEqual({
        episodeId: 201, data: { includePrevious: true },
      });

      await switchAccount(secondAccount);
      const expectSecondProgress = () => {
        const row = within(shows.getByTestId('show-row-42'));
        expect(row.getByText('0 / 4 episodes')).toBeTruthy();
        expect(row.getByText('S1 E1 · Pilot')).toBeTruthy();
        expect(row.queryByTestId('mark-watched-201')).toBeNull();
        expect(row.queryByTestId('mark-watched-202')).toBeNull();
        expect(within(shows.getByTestId('show-row-44')).getByText('1 / 2 episodes')).toBeTruthy();
        expect(shows.queryByRole('alert')).toBeNull();
        expect(shows.queryByText('Retry')).toBeNull();
      };
      await waitFor(expectSecondProgress);
      await fireEvent.press(shows.getByTestId('tab-history'));
      const expectSecondHistory = () => {
        expect(shows.getByTestId('history-item-44')).toBeTruthy();
        expect(within(shows.getByTestId('history-item-44')).getByText('S1E1')).toBeTruthy();
        expect(shows.queryByTestId('history-item-42')).toBeNull();
        expect(shows.queryByText('S2E1')).toBeNull();
      };
      await waitFor(expectSecondHistory);
      expect(pendingMutation.state.status).toBe('pending');
      expect(client.getQueryData(showsKey(secondAccount))).toEqual(secondShows);
      expect(client.getQueryData(activityKey(secondAccount))).toEqual(secondActivity);

      await act(async () => {
        if (outcome === 'success') held.resolve({ ok: true });
        else held.reject(new Error('Former account mark failed'));
      });
      await waitFor(() => {
        expect(pendingMutation.state.status).toBe(outcome);
        expect(client.isFetching()).toBe(0);
      });
      expectSecondHistory();
      expect(client.getQueryData(showsKey(secondAccount))).toEqual(secondShows);
      expect(client.getQueryData(activityKey(secondAccount))).toEqual(secondActivity);
      expect([...mockWatchedForAccount(secondAccount)]).toEqual([301]);
      expect([...mockWatchedForAccount(firstAccount)]).toEqual(
        outcome === 'success' ? [101, 102, 201] : [101, 102],
      );
      await fireEvent.press(shows.getByTestId('tab-shows'));
      await waitFor(expectSecondProgress);

      await switchAccount(firstAccount);
      await waitFor(() => {
        const row = within(shows.getByTestId('show-row-42'));
        expect(row.getByText(outcome === 'success' ? '3 / 4 episodes' : '2 / 4 episodes')).toBeTruthy();
        expect(row.getByTestId(outcome === 'success' ? 'mark-watched-202' : 'mark-watched-201'))
          .toBeEnabled();
        expect(row.getByText(outcome === 'success' ? 'S2 E2 · Fourth' : 'S2 E1 · Third')).toBeTruthy();
      });
      await fireEvent.press(shows.getByTestId('tab-history'));
      await waitFor(() => {
        expect(shows.queryByTestId('history-item-44')).toBeNull();
        if (outcome === 'success') {
          expect(within(shows.getByTestId('history-item-42')).getByText('S2E1')).toBeTruthy();
        } else {
          expect(shows.queryByTestId('history-item-42')).toBeNull();
        }
        expect(client.getQueryData(activityKey(firstAccount))).toEqual(mockActivityForAccount(firstAccount));
      });
    }
  } finally {
    // Release every deferred request even if an assertion failed mid-switch.
    await act(async () => {
      heldRequests.forEach((held) => held.resolve({ ok: true }));
    });
    await switchAccount(originalUserId);
    await fireEvent.press(shows.getByTestId('tab-shows'));
    mockAccountWatched.delete(firstAccount);
    mockAccountWatched.delete(secondAccount);
  }
}

async function checkPendingMarksAfterLeavingScreen(
  shows: Awaited<ReturnType<typeof render>>,
  client: QueryClient,
) {
  const api = require('@workspace/api-client-react');
  const activityKey = [
    ...api.getGetMyRecentActivityQueryKey(), 'account', 'checkmarks-user',
  ];
  // Reset the preceding journey while consumers are still mounted.
  mockWatched.clear();
  mockWatched.add(101);
  mockWatched.add(102);
  await act(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: api.getGetMyShowsQueryKey() }),
      client.invalidateQueries({ queryKey: activityKey }),
    ]);
  });
  await waitFor(() => {
    expect(shows.getByTestId('mark-watched-201')).toBeEnabled();
    expect(client.getQueryData(activityKey)).toEqual([]);
  });

  for (const succeeds of [false, true]) {
    const request = deferredMarkResponse();
    mockMarkRequest.mockImplementationOnce(() => request.promise);
    const showQueries = client.getQueryCache().findAll({
      queryKey: api.getGetMyShowsQueryKey(),
    });
    const activityQuery = client.getQueryCache().find({
      queryKey: activityKey, exact: true,
    })!;
    const queries = [...showQueries, activityQuery];
    expect(showQueries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query.queryKey).toEqual(expect.arrayContaining(['account', 'checkmarks-user']));
      expect(query.options).toEqual(expect.objectContaining({ staleTime: Infinity }));
      expect(query.state.isInvalidated).toBe(false);
    }
    const initialShowsFetches = api.getMyShows.mock.calls.length;
    const initialHistoryFetches = mockRecentActivityFetch.mock.calls.length;
    const savedShows = showQueries.map((query) => query.state.data);
    try {
      await fireEvent.press(shows.getByTestId('mark-watched-201'));
      await waitFor(() => expect(shows.getByTestId('mark-watched-201')).toBeDisabled());
      const mutation = client.getMutationCache().getAll().at(-1)!;
      expect(mutation.state.status).toBe('pending');
      expect(mutation.state.variables).toEqual({
        episodeId: 201, data: { includePrevious: true },
      });

      // Remove the whole route, not just ShowRow or the internal TV Shows tab.
      // Keeping only the provider preserves the real client and pending mutation.
      await shows.rerender(
        <QueryClientProvider client={client}>
          <Text testID="away-from-my-shows">Another screen</Text>
        </QueryClientProvider>,
      );
      expect(shows.getByTestId('away-from-my-shows')).toBeTruthy();
      expect(shows.queryByTestId('tab-shows')).toBeNull();
      expect(shows.queryByTestId('tab-history')).toBeNull();
      expect(shows.queryByTestId('show-row-42')).toBeNull();
      expect(queries.every((query) => query.getObserversCount() === 0)).toBe(true);
      expect(mutation.state.status).toBe('pending');

      await act(async () => {
        if (succeeds) request.resolve({ ok: true });
        else request.reject(new Error('Offline after leaving My Shows'));
      });
      await waitFor(() => {
        expect(mutation.state.status).toBe(succeeds ? 'success' : 'error');
      });
      // Nothing can refetch while the originating screen and all consumers are gone.
      expect(api.getMyShows).toHaveBeenCalledTimes(initialShowsFetches);
      expect(mockRecentActivityFetch).toHaveBeenCalledTimes(initialHistoryFetches);
      expect(client.getQueryData(activityKey)).toEqual([]);
      expect(showQueries.map((query) => query.state.data)).toEqual(savedShows);
      expect([...mockWatched]).toEqual(succeeds ? [101, 102, 201] : [101, 102]);
      for (const query of queries) {
        expect(query.state.isInvalidated).toBe(succeeds);
      }

      // Only now mount the destination consumers, with the same infinitely fresh cache.
      await shows.rerender(
        <QueryClientProvider client={client}><MyShowsScreen /></QueryClientProvider>,
      );
      await waitFor(() => {
        const row = within(shows.getByTestId('show-row-42'));
        expect(row.getByText(succeeds ? '3 / 4 episodes' : '2 / 4 episodes')).toBeTruthy();
        expect(row.getByText(succeeds ? 'S2 E2 · Fourth' : 'S2 E1 · Third')).toBeTruthy();
        expect(row.getByTestId(`mark-watched-${succeeds ? 202 : 201}`)).toBeEnabled();
        expect(row.queryByTestId(`mark-watched-${succeeds ? 201 : 202}`)).toBeNull();
      });
      await fireEvent.press(shows.getByTestId('tab-history'));
      if (succeeds) {
        await waitFor(() => {
          expect(within(shows.getByTestId('history-item-42')).getByText('S2E1')).toBeTruthy();
        });
        expect(client.getQueryData(activityKey)).toEqual([
          expect.objectContaining({ titleId: 42, kind: 'episode', episodeLabel: 'S2E1' }),
        ]);
        expect(api.getMyShows.mock.calls.length).toBeGreaterThan(initialShowsFetches);
        expect(mockRecentActivityFetch.mock.calls.length).toBeGreaterThan(initialHistoryFetches);
      } else {
        expect(shows.queryByTestId('history-item-42')).toBeNull();
        expect(client.getQueryData(activityKey)).toEqual([]);
        expect(api.getMyShows).toHaveBeenCalledTimes(initialShowsFetches);
        expect(mockRecentActivityFetch).toHaveBeenCalledTimes(initialHistoryFetches);
      }
      await fireEvent.press(shows.getByTestId('tab-shows'));
      await waitFor(() => {
        expect(shows.getByTestId(`mark-watched-${succeeds ? 202 : 201}`)).toBeEnabled();
      });
    } finally {
      // Release the request even when an assertion fails; the outer journey
      // unmounts all renders and clears the client.
      await act(async () => request.resolve({ ok: true }));
    }
  }
}

async function checkPendingMarksAfterOpeningHistory(
  shows: Awaited<ReturnType<typeof render>>,
  client: QueryClient,
) {
  mockMarkRequest.mockClear();
  const api = require('@workspace/api-client-react');
  const activityKey = [
    ...api.getGetMyRecentActivityQueryKey(), 'account', 'checkmarks-user',
  ];
  const failedMark = deferredMarkResponse();
  const successfulMark = deferredMarkResponse();
  const invalidate = jest.spyOn(client, 'invalidateQueries');

  try {
    await waitFor(() => {
      expect(shows.getByTestId('mark-watched-201')).toBeEnabled();
      expect(client.getQueryData(activityKey)).toEqual([]);
    });
    const activityQuery = client.getQueryCache().find({ queryKey: activityKey, exact: true })!;
    expect(activityQuery.options).toEqual(expect.objectContaining({ staleTime: Infinity }));
    expect(activityQuery.isStale()).toBe(false);
    const initialHistoryFetches = mockRecentActivityFetch.mock.calls.length;
    const initialShowsFetches = api.getMyShows.mock.calls.length;

    mockMarkRequest.mockImplementationOnce(() => failedMark.promise);
    await fireEvent.press(shows.getByTestId('mark-watched-201'));
    await waitFor(() => {
      expect(mockMarkRequest).toHaveBeenCalledTimes(1);
      expect(shows.getByTestId('mark-watched-201')).toBeDisabled();
    });
    await fireEvent.press(shows.getByTestId('tab-history'));
    // The screen stays mounted, but the ShowRow owning the mutation does not.
    expect(shows.queryByTestId('show-row-42')).toBeNull();
    expect(shows.queryByTestId('mark-watched-201')).toBeNull();
    expect(shows.queryByTestId('history-item-42')).toBeNull();
    expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe('pending');
    expect(mockRecentActivityFetch).toHaveBeenCalledTimes(initialHistoryFetches);

    await act(async () => failedMark.reject(new Error('Offline after opening History')));
    await waitFor(() => {
      expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe('error');
    });
    expect(shows.queryByTestId('history-item-42')).toBeNull();
    expect(client.getQueryData(activityKey)).toEqual([]);
    expect([...mockWatched]).toEqual([101, 102]);
    expect(invalidate).not.toHaveBeenCalled();
    expect(mockRecentActivityFetch).toHaveBeenCalledTimes(initialHistoryFetches);
    expect(api.getMyShows).toHaveBeenCalledTimes(initialShowsFetches);

    await fireEvent.press(shows.getByTestId('tab-shows'));
    await waitFor(() => expect(shows.getByTestId('mark-watched-201')).toBeEnabled());
    const row = () => within(shows.getByTestId('show-row-42'));
    expect(row().getByText('2 / 4 episodes')).toBeTruthy();
    expect(row().getByText('S2 E1 · Third')).toBeTruthy();
    expect(row().queryByTestId('mark-watched-202')).toBeNull();

    mockMarkRequest.mockImplementationOnce(() => successfulMark.promise);
    await fireEvent.press(row().getByTestId('mark-watched-201'));
    await waitFor(() => {
      expect(mockMarkRequest).toHaveBeenCalledTimes(2);
      expect(row().getByTestId('mark-watched-201')).toBeDisabled();
    });
    await fireEvent.press(shows.getByTestId('tab-history'));
    expect(shows.queryByTestId('show-row-42')).toBeNull();
    expect(shows.queryByTestId('mark-watched-201')).toBeNull();
    expect(shows.queryByTestId('history-item-42')).toBeNull();
    expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe('pending');
    expect(client.getQueryData(activityKey)).toEqual([]);
    expect([...mockWatched]).toEqual([101, 102]);
    expect(mockRecentActivityFetch).toHaveBeenCalledTimes(initialHistoryFetches);
    expect(api.getMyShows).toHaveBeenCalledTimes(initialShowsFetches);

    await act(async () => successfulMark.resolve({ ok: true }));
    await waitFor(() => {
      expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe('success');
      expect(shows.getByTestId('history-item-42')).toBeTruthy();
      expect(within(shows.getByTestId('history-item-42')).getByText('S2E1')).toBeTruthy();
      expect(mockRecentActivityFetch.mock.calls.length).toBeGreaterThan(initialHistoryFetches);
      expect(api.getMyShows.mock.calls.length).toBeGreaterThan(initialShowsFetches);
    });
    expect(client.getQueryData(activityKey)).toEqual([
      expect.objectContaining({ titleId: 42, kind: 'episode', episodeLabel: 'S2E1' }),
    ]);
    expect([...mockWatched]).toEqual([101, 102, 201]);

    await fireEvent.press(shows.getByTestId('tab-shows'));
    await waitFor(() => {
      expect(row().getByText('3 / 4 episodes')).toBeTruthy();
      expect(row().getByText('S2 E2 · Fourth')).toBeTruthy();
      expect(row().getByTestId('mark-watched-202')).toBeEnabled();
      expect(row().queryByTestId('mark-watched-201')).toBeNull();
    });
    expect(shows.queryByRole('alert')).toBeNull();
    expect(shows.queryByText('Retry')).toBeNull();
    expect(mockMarkRequest.mock.calls).toEqual([
      [{ episodeId: 201, data: { includePrevious: true } }],
      [{ episodeId: 201, data: { includePrevious: true } }],
    ]);
  } finally {
    // Also release held requests on assertion failure before tearing down.
    await act(async () => {
      failedMark.resolve({ ok: true });
      successfulMark.resolve({ ok: true });
    });
    invalidate.mockRestore();
  }
}

async function expectEpisodeScopedFailures(
  shows: Awaited<ReturnType<typeof render>>,
  client: QueryClient,
) {
  mockWatched.clear();
  mockMarkRequest.mockReset();
  mockMarkRequest.mockResolvedValue({ ok: true });
  const { getGetMyShowsQueryKey } = require('@workspace/api-client-react');
  await act(async () => {
    await client.invalidateQueries({ queryKey: getGetMyShowsQueryKey() });
  });
  await waitFor(() => expect(shows.getByTestId('mark-watched-101')).toBeTruthy());
  const row = shows.getByTestId('show-row-42');
  const currentRow = () => within(shows.getByTestId('show-row-42'));
  const expectCleanEpisode = (episodeId: number) => {
    // A changed episode must update the existing row, not clear errors by remounting it.
    expect(shows.getByTestId('show-row-42')).toBe(row);
    expect(currentRow().getByTestId(`mark-watched-${episodeId}`)).toBeTruthy();
    expect(currentRow().queryByRole('alert')).toBeNull();
    expect(currentRow().queryByText('Retry')).toBeNull();
    expect(currentRow().getByText('Watched')).toBeTruthy();
    expect(currentRow().getByTestId('icon-check')).toBeTruthy();
    expect(currentRow().queryByTestId('icon-refresh-cw')).toBeNull();
  };
  const advanceEpisode = async (watchedId: number, nextId: number) => {
    mockWatched.add(watchedId); // Simulate progress saved by another session.
    await act(async () => {
      await client.invalidateQueries({ queryKey: getGetMyShowsQueryKey() });
    });
    await waitFor(() => expect(currentRow().getByTestId(`mark-watched-${nextId}`)).toBeTruthy());
    expect(currentRow().queryByTestId(`mark-watched-${watchedId}`)).toBeNull();
  };

  mockMarkRequest.mockRejectedValueOnce(new Error('First episode failed'));
  await fireEvent.press(currentRow().getByTestId('mark-watched-101'));
  await waitFor(() => {
    expect(currentRow().getByRole('alert')).toBeTruthy();
    expect(currentRow().getByText('Retry')).toBeTruthy();
  });
  expect(mockMarkRequest).toHaveBeenLastCalledWith({
    episodeId: 101, data: { includePrevious: true },
  });
  await advanceEpisode(101, 102);
  expectCleanEpisode(102);

  const oldRequest = deferredMarkResponse();
  mockMarkRequest.mockImplementationOnce(() => oldRequest.promise);
  await fireEvent.press(currentRow().getByTestId('mark-watched-102'));
  await waitFor(() => {
    expect(currentRow().getByTestId('mark-watched-102')).toBeDisabled();
    expect(mockMarkRequest).toHaveBeenCalledTimes(2);
  });
  const pendingMutation = client.getMutationCache().getAll().find(
    (mutation) => mutation.state.status === 'pending',
  )!;
  expect(pendingMutation.state.variables).toEqual({
    episodeId: 102, data: { includePrevious: true },
  });
  await advanceEpisode(102, 201);
  expectCleanEpisode(201);
  await act(async () => oldRequest.reject(new Error('Old episode failed late')));
  await waitFor(() => {
    expect(pendingMutation.state.status).toBe('error');
    expect(currentRow().getByTestId('mark-watched-201')).toBeEnabled();
  });
  expectCleanEpisode(201);
  expect(currentRow().getByText('2 / 4 episodes')).toBeTruthy();
  expect(currentRow().getByText('S2 E1 · Third')).toBeTruthy();

  // Suppressing old failures must not suppress an actual failure for the new episode.
  mockMarkRequest.mockRejectedValueOnce(new Error('Current episode failed'));
  await fireEvent.press(currentRow().getByTestId('mark-watched-201'));
  await waitFor(() => {
    expect(currentRow().getByRole('alert').props.children).toBe(
      "Couldn't mark this episode as watched. Please try again.",
    );
    expect(currentRow().getByText('Retry')).toBeTruthy();
    expect(currentRow().getByTestId('icon-refresh-cw')).toBeTruthy();
  });
  expect(mockMarkRequest).toHaveBeenLastCalledWith({
    episodeId: 201, data: { includePrevious: true },
  });
  expect([...mockWatched]).toEqual([101, 102]);
  mockMarkRequest.mockClear();
}

afterEach(cleanup);
