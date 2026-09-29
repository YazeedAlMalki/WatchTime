import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockMarkStartup = jest.fn();
const mockTrendingRefetch = jest.fn();
const mockTrendingQueryState: { current: Record<string, unknown> } = {
  current: {},
};

jest.mock('@/lib/app-auth', () => ({
  useAppAuth: () => ({ isLoaded: true, isSignedIn: false }),
}));

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

jest.mock('@workspace/api-client-react', () => ({
  useGetTrendingTitles: () => ({
    ...mockTrendingQueryState.current,
    refetch: mockTrendingRefetch,
  }),
  useGetMyShows: jest.fn(),
  useGetMyWatchlist: jest.fn(),
  useGetMyRecommendations: jest.fn(),
  useMarkEpisodeWatched: jest.fn(),
  getGetMyShowsQueryKey: jest.fn(),
  getGetMyRecommendationsQueryKey: jest.fn(),
  getGetTitleQueryKey: jest.fn(),
}));

jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    EmptyState: () => <View />,
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

describe('mobile signed-out Home feed failure', () => {
  let pendingFrames: FrameRequestCallback[] = [];

  beforeEach(() => {
    mockTrendingRefetch.mockReset();
    mockMarkStartup.mockReset();
    mockTrendingQueryState.current = {
      data: undefined,
      dataUpdatedAt: 0,
      isError: false,
      isLoading: true,
      isRefetching: false,
    };
    globalThis.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      pendingFrames.push(callback);
      return pendingFrames.length;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    pendingFrames = [];
  });

  it('keeps its shell visible and recovers after retrying the unavailable feed', async () => {
    const screen = await render(<HomeScreen />);

    await act(async () => pendingFrames[0]?.(0));
    await act(async () => pendingFrames[1]?.(0));

    expect(screen.getByText('Track your shows.')).toBeTruthy();
    expect(screen.getByText('Sign in to get started')).toBeTruthy();
    expect(screen.getByText('Trending Now')).toBeTruthy();
    expect(screen.getByTestId('loading')).toBeTruthy();

    mockTrendingQueryState.current = {
      data: undefined,
      dataUpdatedAt: 0,
      isError: true,
      isLoading: false,
      isRefetching: false,
    };
    await screen.rerender(<HomeScreen />);

    expect(screen.getByText("Couldn't load trending titles")).toBeTruthy();
    expect(mockMarkStartup).toHaveBeenCalledWith('trending-error');

    fireEvent.press(screen.getByTestId('retry-button'));
    expect(mockTrendingRefetch).toHaveBeenCalledTimes(1);
    expect(mockMarkStartup).toHaveBeenCalledWith('trending-retry');

    mockTrendingQueryState.current = {
      data: [{ id: 1, name: 'Recovered trending title' }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
    await screen.rerender(<HomeScreen />);

    expect(screen.getByText('Recovered trending title')).toBeTruthy();
    expect(mockMarkStartup).toHaveBeenCalledWith('trending-loaded');
  });
});