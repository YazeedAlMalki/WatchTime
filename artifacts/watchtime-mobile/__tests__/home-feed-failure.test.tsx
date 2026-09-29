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
  getGetMyShowsQueryKey: jest.fn(),
  getGetMyRecommendationsQueryKey: jest.fn(),
  getGetTitleQueryKey: jest.fn(),
  });
});

jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    EmptyState: ({ title }: { title: string }) => <Text>{title}</Text>,
    ErrorState: ({ message, onRetry }: { message: string; onRetry: () => void }) => (
      <View>
        <Text>{message}</Text>
        <Pressable testID="retry-button" onPress={onRetry}>
          <Text>Retry</Text>
        </Pressable>
      </View>
    ),
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

  it('keeps successful sections visible and retries only each failed feed', async () => {
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
    expect(mockMarkStartup).toHaveBeenCalledWith('trending-error');
    fireEvent.press(screen.getByTestId('retry-button'));
    expect(mockTrendingRefetch).toHaveBeenCalledTimes(1);
    expect(mockMarkStartup).toHaveBeenCalledWith('trending-retry');

    mockTrendingQueryState.current = ready([{ id: 1, name: 'Recovered trending title' }]);
    await notify();
    expect(screen.getByText('Recovered trending title')).toBeTruthy();
    expect(mockMarkStartup).toHaveBeenCalledWith('trending-loaded');

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
    await notify();
    expect(screen.getByText("Couldn't load Up Next")).toBeTruthy();
    expect(screen.getByText("Couldn't load your watchlist")).toBeTruthy();
    expect(screen.getByText('Suggested Show')).toBeTruthy();
    fireEvent.press(within(screen.getByTestId('watchlist-error')).getByTestId('retry-button'));
    expect(mockWatchlistRefetch).toHaveBeenCalledTimes(1);
    expect(mockShowsRefetch).not.toHaveBeenCalled();
    expect(mockRecommendationsRefetch).not.toHaveBeenCalled();
  });
});