import React from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react-native';

const mockMarkStartup = jest.fn();
const mockTrendingRefetch = jest.fn();
const mockTrendingQueryState: { current: Record<string, unknown> } = {
  current: {},
};
let mockSignedIn = false;
const mockAuthListeners = new Set<() => void>();
const mockSubscribeAuth = (listener: () => void) => {
  mockAuthListeners.add(listener);
  return () => { mockAuthListeners.delete(listener); };
};
const mockShowsRefetch = jest.fn();
const mockWatchlistRefetch = jest.fn();
const mockRecommendationsRefetch = jest.fn();
const mockShowsState: { current: Record<string, unknown> } = { current: {} };
const mockWatchlistState: { current: Record<string, unknown> } = { current: {} };
const mockRecommendationsState: { current: Record<string, unknown> } = { current: {} };
const mockFeedListeners = new Set<() => void>();
const mockSubscribeFeeds = (listener: () => void) => {
  mockFeedListeners.add(listener);
  return () => { mockFeedListeners.delete(listener); };
};
const mockNotifyFeeds = () => mockFeedListeners.forEach((listener) => listener());

jest.mock('@/lib/app-auth', () => {
  const { useSyncExternalStore } = require('react');
  return {
    useAppAuth: () => ({
      isLoaded: true,
      isSignedIn: useSyncExternalStore(mockSubscribeAuth, () => mockSignedIn),
      userId: mockSignedIn ? 'home-test-user' : null,
    }),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Image: () => <View /> };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock('@workspace/api-client-react', () => {
  const { useSyncExternalStore } = require('react');
  return ({
  useGetTrendingTitles: () => ({
    ...useSyncExternalStore(mockSubscribeFeeds, () => mockTrendingQueryState.current),
    refetch: mockTrendingRefetch,
  }),
  useGetMyShows: () => ({
    ...useSyncExternalStore(mockSubscribeFeeds, () => mockShowsState.current),
    refetch: mockShowsRefetch,
  }),
  useGetMyWatchlist: () => ({
    ...useSyncExternalStore(mockSubscribeFeeds, () => mockWatchlistState.current),
    refetch: mockWatchlistRefetch,
  }),
  useGetMyRecommendations: () => ({
    ...useSyncExternalStore(mockSubscribeFeeds, () => mockRecommendationsState.current),
    refetch: mockRecommendationsRefetch,
  }),
  useMarkEpisodeWatched: () => ({ isPending: false, mutate: jest.fn() }),
  getGetMyShowsQueryKey: () => ['/api/me/shows'],
  getGetMyWatchlistQueryKey: () => ['/api/me/watchlist'],
  getGetMyRecommendationsQueryKey: () => ['/api/me/recommendations'],
  getGetTitleQueryKey: jest.fn(),
  });
});

jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    EmptyState: ({ title }: { title: string }) => <Text>{title}</Text>,
    ErrorState: jest.requireActual('@/components/ui').ErrorState,
    Loading: () => <View testID="loading" />,
    PosterCard: ({ title }: { title: { name: string } }) => <Text>{title.name}</Text>,
    SectionHeader: ({ title }: { title: string }) => <Text>{title}</Text>,
  };
});

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#ffffff',
    foreground: '#111111',
    mutedForeground: '#777777',
    primary: '#6633cc',
    primaryForeground: '#ffffff',
  }),
}));

jest.mock('@/constants/colors', () => ({
  __esModule: true,
  default: { radius: 8 },
}));

jest.mock('@/lib/startup-metrics', () => ({
  markStartup: (...args: unknown[]) => mockMarkStartup(...args),
}));

import HomeScreen from '../app/(tabs)/index';

const ready = (data: unknown) => ({
  data,
  dataUpdatedAt: 123,
  isError: false,
  isLoading: false,
  isRefetching: false,
});
const failed = {
  data: undefined,
  dataUpdatedAt: 0,
  isError: true,
  isLoading: false,
  isRefetching: false,
};
const trackedShow = {
  title: { id: 7, name: 'Up Next Show', posterUrl: null, backdropUrl: null },
  nextEpisode: { id: 71, name: 'Pilot', seasonNumber: 1, episodeNumber: 1, stillUrl: null },
  totalEpisodes: 10,
  watchedEpisodes: 0,
};

describe('mobile signed-in Home partial feed failures', () => {
  let pendingFrames: FrameRequestCallback[] = [];

  beforeEach(() => {
    mockSignedIn = true;
    mockTrendingRefetch.mockReset();
    mockMarkStartup.mockReset();
    mockShowsRefetch.mockReset();
    mockWatchlistRefetch.mockReset();
    mockRecommendationsRefetch.mockReset();
    mockShowsState.current = ready([trackedShow]);
    mockWatchlistState.current = ready([{ id: 8, name: 'Saved Show' }]);
    mockRecommendationsState.current = ready([
      { reason: 'Because you watch drama', titles: [{ id: 9, name: 'Suggested Show' }] },
    ]);
    globalThis.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      pendingFrames.push(callback);
      return pendingFrames.length;
    });
  });

  afterEach(async () => {
    await act(async () => cleanup());
    pendingFrames = [];
  });

  async function renderReadyHome() {
    const screen = await render(<HomeScreen />);
    await act(async () => pendingFrames[0]?.(0));
    await act(async () => pendingFrames[1]?.(0));
    return screen;
  }

  it('shows full errors on first load while leaving other sections available', async () => {
    mockSignedIn = false;
    mockTrendingQueryState.current = {
      data: undefined, dataUpdatedAt: 0, isError: false, isLoading: true, isRefetching: false,
    };
    const screen = await renderReadyHome();
    const notify = async () => {
      await act(async () => mockNotifyFeeds());
    };
    expect(screen.getByText('Track your shows.')).toBeTruthy();
    expect(screen.getByText('Sign in to get started')).toBeTruthy();
    expect(screen.getByText('Trending Now')).toBeTruthy();
    expect(screen.getByTestId('loading')).toBeTruthy();

    mockTrendingQueryState.current = failed;
    await notify();
    expect(screen.getByText("Couldn't load trending titles")).toBeTruthy();
    expect(screen.queryByTestId('trending-refresh-warning')).toBeNull();
    expect(mockMarkStartup).toHaveBeenCalledWith('trending-error');
    const trendingRetry = screen.getByRole('button', { name: 'Retry Trending Now' });
    expect(within(trendingRetry).getByText('Retry')).toBeTruthy();
    await fireEvent.press(trendingRetry);
    expect(mockTrendingRefetch).toHaveBeenCalledTimes(1);
    expect(mockMarkStartup).toHaveBeenCalledWith('trending-retry');

    mockTrendingQueryState.current = ready([{ id: 1, name: 'Recovered trending title' }]);
    await notify();
    expect(screen.getByText('Recovered trending title')).toBeTruthy();
    expect(mockMarkStartup).toHaveBeenCalledWith('trending-loaded');

    // A background refresh failure must not replace already loaded guest cards.
    mockTrendingRefetch.mockClear();
    mockMarkStartup.mockClear();
    mockTrendingQueryState.current = {
      ...ready([{ id: 1, name: 'Recovered trending title' }]),
      isError: true,
    };
    await notify();
    expect(screen.getByText('Recovered trending title')).toBeTruthy();
    expect(screen.queryByText("Couldn't load trending titles")).toBeNull();
    expect(screen.queryByTestId('loading')).toBeNull();
    const trendingWarning = screen.getByTestId('trending-refresh-warning');
    expect(within(trendingWarning).getByText(
      "Couldn't refresh Trending Now. Results may be out of date.",
    )).toBeTruthy();
    await fireEvent.press(within(trendingWarning).getByRole('button', { name: 'Retry Trending Now' }));
    expect(mockTrendingRefetch).toHaveBeenCalledTimes(1);
    expect(mockMarkStartup).toHaveBeenCalledWith('trending-retry');
    expect(mockShowsRefetch).not.toHaveBeenCalled();
    expect(mockWatchlistRefetch).not.toHaveBeenCalled();
    expect(mockRecommendationsRefetch).not.toHaveBeenCalled();

    mockTrendingQueryState.current = ready([{ id: 2, name: 'Fresh trending title' }]);
    await notify();
    expect(screen.queryByTestId('trending-refresh-warning')).toBeNull();
    expect(screen.getByText('Fresh trending title')).toBeTruthy();
    expect(screen.queryByText('Recovered trending title')).toBeNull();

    // A successful empty response is cached data too, not a first-load failure.
    mockTrendingQueryState.current = ready([]);
    await notify();
    mockTrendingQueryState.current = { ...ready([]), isError: true };
    await notify();
    expect(screen.getByTestId('trending-refresh-warning')).toBeTruthy();
    expect(screen.queryByText("Couldn't load trending titles")).toBeNull();
    mockTrendingQueryState.current = ready([]);
    await notify();
    expect(screen.queryByTestId('trending-refresh-warning')).toBeNull();

    mockSignedIn = true;
    await act(async () => mockAuthListeners.forEach((listener) => listener()));
    for (const [sectionId, message, state, retry] of [
      ['up-next-error', "Couldn't load Up Next", mockShowsState, mockShowsRefetch],
      ['watchlist-error', "Couldn't load your watchlist", mockWatchlistState, mockWatchlistRefetch],
      ['recommendations-error', "Couldn't load recommendations", mockRecommendationsState, mockRecommendationsRefetch],
    ] as const) {
      state.current = failed;
      await notify();
      expect(screen.getByText(message)).toBeTruthy();
      expect(screen.getByTestId(sectionId)).toBeTruthy();
      expect(screen.queryByTestId(sectionId.replace('-error', '-refresh-warning'))).toBeNull();
      if (sectionId === 'up-next-error') expect(screen.queryByText('Up Next Show')).toBeNull();
      if (sectionId === 'watchlist-error') expect(screen.queryByText('Saved Show')).toBeNull();
      if (sectionId === 'recommendations-error') expect(screen.queryByText('Suggested Show')).toBeNull();
      if (sectionId !== 'up-next-error') expect(screen.getByText('Up Next Show')).toBeTruthy();
      if (sectionId !== 'watchlist-error') expect(screen.getByText('Saved Show')).toBeTruthy();
      if (sectionId !== 'recommendations-error') expect(screen.getByText('Suggested Show')).toBeTruthy();
      expect(screen.queryByText('Nothing to watch yet')).toBeNull();
      expect(screen.queryByText('Watchlist is empty')).toBeNull();
      expect(screen.queryByText('No recommendations yet')).toBeNull();

      fireEvent.press(within(screen.getByTestId(sectionId)).getByTestId('retry-button'));
      expect(retry).toHaveBeenCalledTimes(1);
      for (const other of [mockShowsRefetch, mockWatchlistRefetch, mockRecommendationsRefetch]) {
        if (other !== retry) expect(other).not.toHaveBeenCalled();
      }

      state.current = sectionId === 'up-next-error'
        ? ready([trackedShow])
        : sectionId === 'watchlist-error'
          ? ready([{ id: 8, name: 'Saved Show' }])
          : ready([{ reason: 'Because you watch drama', titles: [{ id: 9, name: 'Suggested Show' }] }]);
      await notify();
      expect(screen.queryByText(message)).toBeNull();
      expect(screen.getByText('Up Next Show')).toBeTruthy();
      expect(screen.getByText('Saved Show')).toBeTruthy();
      expect(screen.getByText('Suggested Show')).toBeTruthy();
      retry.mockClear();
    }
    mockShowsState.current = failed;
    mockWatchlistState.current = failed;
    mockRecommendationsState.current = failed;
    mockTrendingRefetch.mockClear();
    await notify();
    expect(screen.getByText("Couldn't load Up Next")).toBeTruthy();
    expect(screen.getByText("Couldn't load your watchlist")).toBeTruthy();
    const retryActions = [
      ['Retry Up Next', mockShowsRefetch],
      ['Retry your watchlist', mockWatchlistRefetch],
      ['Retry recommendations', mockRecommendationsRefetch],
    ] as const;
    expect(screen.getAllByText('Retry')).toHaveLength(3);
    for (const [name, retry] of retryActions) {
      const button = screen.getByRole('button', { name });
      expect(within(button).getByText('Retry')).toBeTruthy();
      fireEvent.press(button);
      expect(retry).toHaveBeenCalledTimes(1);
      for (const [, other] of retryActions) {
        if (other !== retry) expect(other).not.toHaveBeenCalled();
      }
      retry.mockClear();
    }
    mockShowsState.current = ready([trackedShow]);
    mockWatchlistState.current = ready([{ id: 8, name: 'Saved Show' }]);
    mockRecommendationsState.current = ready([
      { reason: 'Because you watch drama', titles: [{ id: 9, name: 'Suggested Show' }] },
    ]);
    mockTrendingQueryState.current = ready([{ id: 1, name: 'Recovered trending title' }]);
    await notify();
    mockShowsRefetch.mockClear();
    mockWatchlistRefetch.mockClear();
    mockRecommendationsRefetch.mockClear();

    // Unlike the first-load failures above, these errors retain React Query data.
    const feeds = [
      {
        state: mockShowsState, data: [trackedShow], card: 'Up Next Show',
        warning: 'up-next-refresh-warning', section: 'Up Next', retry: mockShowsRefetch,
        fullError: 'up-next-error',
      },
      {
        state: mockWatchlistState, data: [{ id: 8, name: 'Saved Show' }], card: 'Saved Show',
        warning: 'watchlist-refresh-warning', section: 'your watchlist', retry: mockWatchlistRefetch,
        fullError: 'watchlist-error',
      },
      {
        state: mockRecommendationsState,
        data: [{ reason: 'Because you watch drama', titles: [{ id: 9, name: 'Suggested Show' }] }],
        card: 'Suggested Show', warning: 'recommendations-refresh-warning',
        section: 'recommendations', retry: mockRecommendationsRefetch,
        fullError: 'recommendations-error',
      },
    ];

    for (const feed of feeds) {
      feed.state.current = { ...ready(feed.data), isError: true };
      await act(async () => mockNotifyFeeds());
      expect(screen.getByText(feed.card)).toBeTruthy();
      expect(screen.queryByTestId(feed.fullError)).toBeNull();
      const warning = screen.getByTestId(feed.warning);
      expect(within(warning).getByText(`Couldn't refresh ${feed.section}. Results may be out of date.`)).toBeTruthy();
      fireEvent.press(within(warning).getByTestId('retry-button'));
      expect(feed.retry).toHaveBeenCalledTimes(1);
      for (const other of feeds) {
        if (other !== feed) expect(other.retry).not.toHaveBeenCalled();
      }
      feed.state.current = ready(feed.data);
      await act(async () => mockNotifyFeeds());
      expect(screen.queryByTestId(feed.warning)).toBeNull();
      expect(screen.getByText(feed.card)).toBeTruthy();
      feed.retry.mockClear();
    }

    mockWatchlistState.current = { ...ready([]), isError: true };
    mockRecommendationsState.current = { ...ready([]), isError: true };
    await act(async () => mockNotifyFeeds());
    expect(screen.getByTestId('watchlist-refresh-warning')).toBeTruthy();
    expect(screen.getByText('Watchlist is empty')).toBeTruthy();
    expect(screen.getByTestId('recommendations-refresh-warning')).toBeTruthy();
    expect(screen.getByText('No recommendations yet')).toBeTruthy();
    expect(screen.getByText('Up Next Show')).toBeTruthy();
    mockShowsState.current = { ...ready([trackedShow]), isError: true };
    await notify();
    expect(screen.getAllByText('Retry')).toHaveLength(3);
    for (const [name, retry] of retryActions) {
      const button = screen.getByRole('button', { name });
      expect(within(button).getByText('Retry')).toBeTruthy();
      fireEvent.press(button);
      expect(retry).toHaveBeenCalledTimes(1);
      for (const [, other] of retryActions) {
        if (other !== retry) expect(other).not.toHaveBeenCalled();
      }
      retry.mockClear();
    }
  });
});