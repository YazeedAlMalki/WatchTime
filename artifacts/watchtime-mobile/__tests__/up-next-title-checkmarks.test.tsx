import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useGetSeason } from '@workspace/api-client-react';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };
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
const mockSeasonFetch = jest.fn();
const mockTitleFetch = jest.fn();
const mockActivityFetch = jest.fn();
const mockMarkRequest = jest.fn();

const mockTitleData = () => ({
  id: 42,
  name: 'Example Show',
  type: 'series',
  year: 2024,
  genres: [],
  altTitles: [],
  providers: [],
  inWatchlist: false,
  seasons: mockSeasons.map((season) => ({
    ...season,
    watchedCount: mockEpisodes.filter(
      (ep) => ep.seasonNumber === season.seasonNumber && mockWatched.has(ep.id),
    ).length,
  })),
});
const mockSeasonData = (seasonNumber: number) => ({
  episodes: mockEpisodes
    .filter((ep) => ep.seasonNumber === seasonNumber)
    .map((ep) => ({ ...ep, watched: mockWatched.has(ep.id) })),
});
const mockTrackedShow = () => {
  const nextEpisode = mockEpisodes.find((episode) => !mockWatched.has(episode.id)) ?? null;
  return {
    title: { id: 42, name: 'Example Show' },
    nextEpisode,
    totalEpisodes: mockEpisodes.length,
    watchedEpisodes: mockWatched.size,
  };
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: '42' }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/app-auth', () => ({
  useAppAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'checkmarks-user' }),
}));
jest.mock('@/lib/home-startup', () => ({
  startHomeStartup: (ready: (value: boolean) => void) => {
    ready(true);
    return () => {};
  },
}));
jest.mock('@/lib/startup-metrics', () => ({ markStartup: jest.fn() }));
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
    EmptyState: () => null,
    ErrorState: () => null,
    Loading: () => <View testID="loading" />,
    PosterCard: () => null,
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

// Keep React Query real: these hooks represent server responses, while the
// actual screens own their query invalidation and render the resulting rows.
jest.mock('@workspace/api-client-react', () => {
  const { useMutation, useQuery } = require('@tanstack/react-query');
  const titleKey = (id: number) => [`/api/titles/${id}`];
  const seasonKey = (id: number, season: number) => [`/api/titles/${id}/seasons/${season}`];
  const showsKey = () => ['/api/me/shows'];
  const recsKey = () => ['/api/me/recommendations'];
  const activityKey = () => ['/api/me/recent-activity'];
  return {
    getGetTitleQueryKey: titleKey,
    getGetSeasonQueryKey: seasonKey,
    getGetMyShowsQueryKey: showsKey,
    getGetMyRecommendationsQueryKey: recsKey,
    getGetMyRecentActivityQueryKey: activityKey,
    getGetMyInProgressShowsQueryKey: () => ['/api/me/shows/in-progress'],
    getGetMyMoviesQueryKey: () => ['/api/me/movies'],
    getMyShows: async (params?: { status?: string }) => {
      const show = mockTrackedShow();
      if (params?.status === 'up-next' && !show.nextEpisode) return [];
      if (params?.status === 'caught-up' && show.nextEpisode) return [];
      return [show];
    },
    getMyInProgressShows: async () => {
      const show = mockTrackedShow();
      return show.watchedEpisodes > 0 && show.nextEpisode ? [show] : [];
    },
    getMyMovies: async () => [],
    mergeTrackedShows: (shows: any[], inProgress: any[]) => {
      const byId = new Map<number, any>();
      for (const show of inProgress) {
        if (show.watchedEpisodes > 0 && show.nextEpisode != null) byId.set(show.title.id, show);
      }
      for (const show of shows) byId.set(show.title.id, show);
      return [...byId.values()];
    },
    useGetMyRecentActivity: (options: { query: { enabled: boolean } }) => useQuery({
      queryKey: activityKey(),
      queryFn: () => {
        mockActivityFetch();
        return mockWatched.has(201) ? [{
          titleId: 42, titleName: 'Example Show', kind: 'episode',
          episodeLabel: 'S2 E1 — Third', watchedAt: '2026-09-29T12:00:00Z',
        }] : [];
      },
      enabled: options.query.enabled,
    }),
    getGetMyWatchlistQueryKey: () => ['/api/me/watchlist'],
    getGetTitleSafetyQueryKey: () => ['/api/safety'],
    useGetTitle: (id: number) => useQuery({
      queryKey: titleKey(id),
      queryFn: () => { mockTitleFetch(); return mockTitleData(); },
    }),
    useGetSeason: (id: number, season: number, options: { query: { enabled: boolean } }) => {
      return useQuery({
        queryKey: seasonKey(id, season),
        queryFn: () => { mockSeasonFetch(season); return mockSeasonData(season); },
        enabled: options.query.enabled,
      });
    },
    useGetMyShows: () => useQuery({
      queryKey: showsKey(),
      queryFn: () => {
        const show = mockTrackedShow();
        return [mockWatched.size === 0 ? { ...show, nextEpisode: mockEpisodes[2] } : show];
      },
    }),
    useGetMyWatchlist: () => useQuery({ queryKey: ['/api/me/watchlist'], queryFn: () => [] }),
    useGetMyRecommendations: () => useQuery({ queryKey: recsKey(), queryFn: () => [] }),
    useGetSimilarTitles: () => ({ data: [] }),
    useGetTitleSafety: () => ({ data: null, isLoading: false }),
    useMarkEpisodeWatched: (options: { mutation: { onSuccess: () => void } }) =>
      useMutation({
        mutationFn: async ({ episodeId, data }: { episodeId: number; data: { includePrevious?: boolean } }) => {
          await mockMarkRequest({ episodeId, data });
          if (data.includePrevious) {
            const target = mockEpisodes.find((ep) => ep.id === episodeId)!;
            mockEpisodes
              .filter((ep) =>
                ep.seasonNumber < target.seasonNumber ||
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

import HomeScreen from '../app/(tabs)/index';
import MyShowsScreen from '../app/(tabs)/my-shows';
import TitleDetailScreen from '../app/title/[id]';

const mockApi = require('@workspace/api-client-react');

function FilteredShowsObserver({ status }: { status: 'up-next' | 'caught-up' }) {
  const showParams = { q: undefined, status };
  const shows = useQuery({
    queryKey: [
      ...mockApi.getGetMyShowsQueryKey(),
      'account',
      'checkmarks-user',
      'infinite',
      showParams,
    ],
    queryFn: () => mockApi.getMyShows(showParams),
  });
  const inProgress = useQuery({
    queryKey: [
      ...mockApi.getGetMyInProgressShowsQueryKey(),
      'account',
      'checkmarks-user',
      'infinite',
    ],
    queryFn: () => mockApi.getMyInProgressShows(),
    enabled: status !== 'caught-up',
  });
  const rows = mockApi
    .mergeTrackedShows(shows.data ?? [], inProgress.data ?? [])
    .filter((show: ReturnType<typeof mockTrackedShow>) =>
      status === 'up-next' ? show.nextEpisode != null : show.nextEpisode == null,
    );
  return <Text testID={`filtered-shows-${status}`}>{rows.map((show: any) => show.title.id).join(',')}</Text>;
}

function SeasonRows({ season }: { season: number }) {
  // An opened accordion enables this same season query. Render its episode
  // watched flags so stale cached rows cannot pass the cross-screen test.
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

it.each([1, 2, 4])('leaves the full episode summary free to wrap in a narrow card at %sx text', async (fontScale) => {
  const originalWindow = Dimensions.get('window');
  const originalScreen = Dimensions.get('screen');
  Dimensions.set({
    window: { width: 320, height: 640, scale: 1, fontScale },
    screen: { width: 320, height: 640, scale: 1, fontScale },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
  const episodeName = 'The One Where Everyone Finally Finds Their Way Home';
  const { getGetMyShowsQueryKey } = require('@workspace/api-client-react');
  client.setQueryData(getGetMyShowsQueryKey(), [{
    title: { id: 42, name: 'Example Show' },
    nextEpisode: { id: 201, seasonNumber: 12, episodeNumber: 24, name: episodeName },
    totalEpisodes: 24,
    watchedEpisodes: 0,
  }]);
  try {
    const home = await render(
      <QueryClientProvider client={client}><HomeScreen /></QueryClientProvider>,
    );
    // Native test rendering does not measure glyphs. Guard the layout contract:
    // no line cap or scaling limit, and auto-height content before the actions.
    const summary = await home.findByText(`S12 · E24 — ${episodeName}`);
    expect(summary.props.numberOfLines).toBeUndefined();
    expect(summary.props.allowFontScaling).not.toBe(false);
    expect(summary.props.maxFontSizeMultiplier).toBeUndefined();
    expect(StyleSheet.flatten(summary.props.style)).not.toHaveProperty('height');
    const content = summary.parent!;
    expect(StyleSheet.flatten(content.props.style)).not.toHaveProperty('height');
    expect(StyleSheet.flatten(content.props.style)).not.toHaveProperty('position', 'absolute');
    const actions = home.getByTestId('upnext-actions-42');
    expect(actions.parent).toBe(content);
    expect(content.children.indexOf(summary)).toBeLessThan(content.children.indexOf(actions));
    expect(StyleSheet.flatten(actions.props.style)).toEqual(
      expect.objectContaining({ flexWrap: 'wrap' }),
    );
    expect(home.getByTestId('mark-watched-201')).toBeEnabled();
    await act(async () => home.unmount());
  } finally {
    await cleanup();
    client.clear();
    Dimensions.set({ window: originalWindow, screen: originalScreen });
  }
});

it('moves the last watched show out of Up Next and into Caught Up after a Home mark', async () => {
  mockWatched.clear();
  [101, 102, 201].forEach((episodeId) => mockWatched.add(episodeId));
  mockMarkRequest.mockReset();
  mockMarkRequest.mockResolvedValue({ ok: true });

  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const screen = await render(
    <QueryClientProvider client={client}>
      <HomeScreen />
      <FilteredShowsObserver status="up-next" />
      <FilteredShowsObserver status="caught-up" />
    </QueryClientProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId('mark-watched-202')).toBeEnabled();
    expect(screen.getByTestId('filtered-shows-up-next').props.children).toBe('42');
    expect(screen.getByTestId('filtered-shows-caught-up').props.children).toBe('');
  });

  await fireEvent.press(screen.getByTestId('mark-watched-202'));
  await waitFor(() => {
    expect(mockWatched.has(202)).toBe(true);
    expect(screen.getByTestId('filtered-shows-up-next').props.children).toBe('');
    expect(screen.getByTestId('filtered-shows-caught-up').props.children).toBe('42');
  });

  await act(async () => screen.unmount());
  client.clear();
});

it('moves the last watched show out of Up Next and into Caught Up after a title-detail mark', async () => {
  mockWatched.clear();
  [101, 102, 201].forEach((episodeId) => mockWatched.add(episodeId));
  mockMarkRequest.mockReset();
  mockMarkRequest.mockResolvedValue({ ok: true });

  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const screen = await render(
    <QueryClientProvider client={client}>
      <TitleDetailScreen />
      <FilteredShowsObserver status="up-next" />
      <FilteredShowsObserver status="caught-up" />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getByTestId('season-2')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('season-2'));
  await waitFor(() => expect(screen.getByTestId('episode-check-202')).toBeEnabled());

  await fireEvent.press(screen.getByTestId('episode-check-202'));
  await waitFor(() => {
    expect(mockWatched.has(202)).toBe(true);
    expect(screen.getByTestId('filtered-shows-up-next').props.children).toBe('');
    expect(screen.getByTestId('filtered-shows-caught-up').props.children).toBe('42');
  });

  await act(async () => screen.unmount());
  client.clear();
});

it('keeps settled and late Home mark errors tied to the failed episode as the same card updates', async () => {
  mockWatched.clear();
  mockMarkRequest.mockReset();
  mockMarkRequest.mockRejectedValueOnce(new Error('Network unavailable'));
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const home = await render(
    <QueryClientProvider client={client}><HomeScreen /></QueryClientProvider>,
  );
  const card = await home.findByTestId('upnext-42');
  const replaceEpisode = async (episodeIndex: number) => {
    await act(async () => {
      client.setQueryData(mockApi.getGetMyShowsQueryKey(), [{
        ...mockTrackedShow(),
        nextEpisode: mockEpisodes[episodeIndex],
      }]);
    });
    await waitFor(() => {
      expect(home.getByTestId(`mark-watched-${mockEpisodes[episodeIndex].id}`)).toBeTruthy();
      expect(home.getByTestId('upnext-42')).toBe(card);
    });
  };
  const expectNormalMark = () => {
    expect(home.queryByRole('alert')).toBeNull();
    expect(home.queryByRole('button', { name: 'Retry marking episode as watched' })).toBeNull();
    expect(home.queryByText('Retry')).toBeNull();
    expect(home.queryByTestId('icon-refresh-cw')).toBeNull();
    expect(home.getByRole('button', { name: 'Mark episode as watched' })).toBeEnabled();
    expect(home.getByText('Watched')).toBeTruthy();
    expect(home.getByTestId('icon-check')).toBeTruthy();
  };

  try {
    await fireEvent.press(home.getByTestId('mark-watched-201'), { stopPropagation: jest.fn() });
    await waitFor(() => {
      expect(home.getByRole('alert')).toBeTruthy();
      expect(home.getByRole('button', { name: 'Retry marking episode as watched' })).toBeEnabled();
    });

    // Another screen/device advances the same show's next episode, without
    // remounting its card or clearing its mutation observer.
    await replaceEpisode(3);
    expectNormalMark();

    let failOldRequest!: (error: Error) => void;
    mockMarkRequest.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      failOldRequest = reject;
    }));
    await fireEvent.press(home.getByTestId('mark-watched-202'), { stopPropagation: jest.fn() });
    await waitFor(() => {
      expect(mockMarkRequest).toHaveBeenCalledTimes(2);
      expect(home.getByText('Saving…')).toBeTruthy();
    });
    expect(mockMarkRequest).toHaveBeenLastCalledWith({
      episodeId: 202, data: { includePrevious: true },
    });
    await replaceEpisode(0);
    await act(async () => failOldRequest(new Error('Late network failure')));
    await waitFor(expectNormalMark);
    expect(home.getByText('S1 · E1 — Pilot')).toBeTruthy();
    expect(mockWatched.size).toBe(0);

    // The replacement can still report its own failure normally.
    mockMarkRequest.mockRejectedValueOnce(new Error('Replacement failed'));
    await fireEvent.press(home.getByTestId('mark-watched-101'), { stopPropagation: jest.fn() });
    await waitFor(() => {
      expect(home.getByRole('alert')).toBeTruthy();
      expect(home.getByRole('button', { name: 'Retry marking episode as watched' })).toBeEnabled();
    });
    expect(mockMarkRequest).toHaveBeenLastCalledWith({
      episodeId: 101, data: { includePrevious: true },
    });
  } finally {
    await act(async () => home.unmount());
    client.clear();
  }
});

it('shows a failed Home mark and refreshes title, seasons, and activity after a successful retry', async () => {
  mockWatched.clear();
  mockMarkRequest.mockReset();
  mockMarkRequest.mockRejectedValueOnce(new Error('Network unavailable'));
  mockSeasonFetch.mockClear();
  mockTitleFetch.mockClear();
  mockRouter.push.mockClear();
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const { getGetSeasonQueryKey, getGetTitleQueryKey, getGetMyRecentActivityQueryKey } = require('@workspace/api-client-react');
  const activityKey = getGetMyRecentActivityQueryKey();
  mockActivityFetch.mockClear();
  client.setQueryData(activityKey, []);

  // Simulate a previous visit: both season accordions and title are cached as
  // unwatched, and would remain that way indefinitely without invalidation.
  client.setQueryData(getGetTitleQueryKey(42), mockTitleData());
  for (const season of mockSeasons) {
    client.setQueryData(getGetSeasonQueryKey(42, season.seasonNumber), mockSeasonData(season.seasonNumber));
  }

  const home = await render(
    <QueryClientProvider client={client}><HomeScreen /></QueryClientProvider>,
  );
  await waitFor(() => expect(home.getByTestId('mark-watched-201')).toBeTruthy());
  expect(home.getByTestId('upnext-actions-42').props.style).toEqual(
    expect.objectContaining({ flexWrap: 'wrap' }),
  );
  const markButton = home.getByTestId('mark-watched-201');
  expect(markButton.props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ minHeight: 44, maxWidth: '100%', flexShrink: 1 }),
    ]),
  );
  expect(home.getByText('Watched').props.style).toEqual(
    expect.objectContaining({ flexShrink: 1 }),
  );
  expect(home.getByText('Watched').props.allowFontScaling).not.toBe(false);
  const stopPropagation = jest.fn();
  fireEvent.press(home.getByTestId('mark-watched-201'), { stopPropagation });
  await waitFor(() => {
    expect(home.getByRole('alert').props.children).toBe(
      "Couldn't mark this episode as watched. Please try again.",
    );
    expect(home.getByRole('button', { name: 'Retry marking episode as watched' })).toBeTruthy();
  });
  expect(stopPropagation).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(mockMarkRequest).toHaveBeenCalledTimes(1);
  expect(mockMarkRequest).toHaveBeenLastCalledWith({
    episodeId: 201, data: { includePrevious: true },
  });
  expect(mockWatched.size).toBe(0);
  expect(home.getByText('0/4 episodes')).toBeTruthy();
  expect(home.getByText('S2 · E1 — Third')).toBeTruthy();
  expect(home.queryByText('Watched')).toBeNull();
  expect(client.getQueryState(getGetTitleQueryKey(42))?.isInvalidated).toBe(false);
  expect(client.getQueryState(activityKey)?.isInvalidated).toBe(false);
  for (const season of mockSeasons) {
    expect(client.getQueryState(getGetSeasonQueryKey(42, season.seasonNumber))?.isInvalidated).toBe(false);
  }

  let finishRetry!: () => void;
  mockMarkRequest.mockImplementationOnce(() => new Promise<void>((resolve) => { finishRetry = resolve; }));
  fireEvent.press(home.getByRole('button', { name: 'Retry marking episode as watched' }), { stopPropagation });
  await waitFor(() => {
    expect(mockMarkRequest).toHaveBeenCalledTimes(2);
    expect(home.getByText('Saving…')).toBeTruthy();
    expect(home.getByTestId('mark-watched-201')).toBeDisabled();
  });
  expect(home.queryByRole('alert')).toBeNull();
  expect(mockWatched.size).toBe(0);
  await act(async () => finishRetry());
  await waitFor(() => {
    expect([...mockWatched].sort()).toEqual([101, 102, 201]);
    expect(client.getQueryState(getGetSeasonQueryKey(42, 1))?.isInvalidated).toBe(true);
    expect(client.getQueryState(getGetSeasonQueryKey(42, 2))?.isInvalidated).toBe(true);
    expect(client.getQueryState(getGetTitleQueryKey(42))?.isInvalidated).toBe(true);
    expect(client.getQueryState(activityKey)?.isInvalidated).toBe(true);
    expect(home.queryByRole('alert')).toBeNull();
    expect(home.getByText('3/4 episodes')).toBeTruthy();
  });
  expect(mockMarkRequest).toHaveBeenLastCalledWith({
    episodeId: 201, data: { includePrevious: true },
  });

  fireEvent.press(home.getByTestId('upnext-42'));
  expect(mockRouter.push).toHaveBeenCalledWith('/title/42');
  await act(async () => home.unmount());

  const detail = await render(
    <QueryClientProvider client={client}>
      <TitleDetailScreen />
      <SeasonRows season={1} />
      <SeasonRows season={2} />
      <MyShowsScreen />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(detail.getByText('2/2 watched')).toBeTruthy());
  expect(detail.getByText('1/2 watched')).toBeTruthy();
  await waitFor(() => {
    expect(mockSeasonFetch).toHaveBeenCalledWith(1);
    expect(mockSeasonFetch).toHaveBeenCalledWith(2);
    expect(detail.getByTestId('episode-state-101').props.children).toEqual(['✓', ' ', 'Pilot']);
    expect(detail.getByTestId('episode-state-102').props.children).toEqual(['✓', ' ', 'Second']);
    expect(detail.getByTestId('episode-state-201').props.children).toEqual(['✓', ' ', 'Third']);
    expect(detail.getByTestId('episode-state-202').props.children).toEqual(['○', ' ', 'Fourth']);
  });
  expect(mockTitleFetch).toHaveBeenCalled();
  await waitFor(() => {
    expect(detail.getByTestId('tab-history')).toBeTruthy();
    expect(client.getQueryData(activityKey)).toEqual([expect.objectContaining({
      titleId: 42, episodeLabel: 'S2 E1 — Third',
    })]);
  });
  expect(mockActivityFetch).toHaveBeenCalledTimes(1);
  await act(async () => detail.unmount());
  client.clear();
});

afterEach(cleanup);