import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

type ClerkAccountState = {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  getToken: () => Promise<string>;
};

const mockActiveSession = { token: 'clerk-session-account-a' };
const mockGetSessionToken = jest.fn(async () => mockActiveSession.token);
const mockClerkAuthState: { current: ClerkAccountState } = {
  current: {
    isLoaded: true,
    isSignedIn: true,
    userId: 'account-a',
    getToken: mockGetSessionToken,
  },
};
const mockFeedResponses: Record<string, Record<string, unknown>> = {};
const mockFetchFeed = jest.fn();
const mockFeedRequests: Array<{ feed: string; token: string }> = [];

jest.mock('@clerk/expo', () => ({
  useAuth: () => mockClerkAuthState.current,
}));

jest.mock('@workspace/dev-auth', () => ({
  isDevelopmentAuthEnabled: () => false,
}));

jest.mock('@/lib/dev-demo-session', () => ({
  getDevDemoToken: jest.fn(() => Promise.resolve(null)),
  clearDevDemoSession: jest.fn(() => Promise.resolve()),
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

jest.mock('@workspace/api-client-react', () => {
  const { useQuery } = require('@tanstack/react-query');

  const feedQuery = (feed: string, options: any) =>
    useQuery({
      ...options?.query,
      queryFn: async () => {
        const token = await mockGetSessionToken();
        mockFeedRequests.push({ feed, token });
        return mockFetchFeed(feed, token);
      },
    });

  return {
    getGetMyShowsQueryKey: () => ['/api/me/shows'],
    getGetMyWatchlistQueryKey: () => ['/api/me/watchlist'],
    getGetMyRecommendationsQueryKey: () => ['/api/me/recommendations'],
    getGetTitleQueryKey: (id: number) => [`/api/titles/${id}`],
    useGetMyShows: (_params: unknown, options: any) => feedQuery('shows', options),
    useGetMyWatchlist: (_params: unknown, options: any) => feedQuery('watchlist', options),
    useGetMyRecommendations: (options: any) => feedQuery('recommendations', options),
    useGetTrendingTitles: () => ({
      data: [],
      dataUpdatedAt: 0,
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch: jest.fn(),
    }),
    useMarkEpisodeWatched: () => ({ isPending: false, mutate: jest.fn() }),
  };
});

jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    EmptyState: () => <View />,
    ErrorState: () => <View />,
    Loading: () => <View testID="loading" />,
    PosterCard: ({ title }: { title: { name: string } }) => <Text>{title.name}</Text>,
    SectionHeader: ({ title }: { title: string }) => <Text>{title}</Text>,
  };
});

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#ffffff',
    border: '#dddddd',
    card: '#f5f5f5',
    foreground: '#111111',
    muted: '#eeeeee',
    mutedForeground: '#777777',
    primary: '#6633cc',
    primaryForeground: '#ffffff',
  }),
}));

jest.mock('@/constants/colors', () => ({
  __esModule: true,
  default: { dark: { background: '#000000' }, radius: 8 },
}));

jest.mock('@/lib/startup-metrics', () => ({
  markStartup: jest.fn(),
}));

import HomeScreen from '../app/(tabs)/index';
import { AppAuthProvider } from '../lib/app-auth';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('Home feed account switching', () => {
  let releaseFrame: ((time: number) => void) | undefined;
  let queryClient: QueryClient;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    mockClerkAuthState.current = {
      isLoaded: true,
      isSignedIn: true,
      userId: 'account-a',
      getToken: mockGetSessionToken,
    };
    mockActiveSession.token = 'clerk-session-account-a';
    mockFeedResponses['clerk-session-account-a'] = {
      shows: [],
      watchlist: [{ id: 1, name: 'Account A private watchlist title' }],
      recommendations: [],
    };
    mockFeedResponses['clerk-session-account-b'] = {};
    mockFeedRequests.length = 0;
    mockGetSessionToken.mockClear();
    mockFetchFeed.mockReset().mockImplementation(async (feed: string, token: string) => {
      return mockFeedResponses[token]?.[feed];
    });
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
      },
    });

    globalThis.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      releaseFrame = callback;
      return 1;
    });
    globalThis.cancelAnimationFrame = jest.fn();
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    jest.restoreAllMocks();
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    releaseFrame = undefined;
  });

  it('shows only the active account feed and fetches it through the current session', async () => {
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <AppAuthProvider>
          <HomeScreen />
        </AppAuthProvider>
      </QueryClientProvider>,
    );

    expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(mockFeedRequests).toEqual([]);

    await act(async () => releaseFrame?.(0));
    expect(mockFeedRequests).toEqual([]);
    expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(2);

    await act(async () => releaseFrame?.(0));
    await waitFor(() => {
      expect(screen.getByText('Account A private watchlist title')).toBeTruthy();
    });
    expect(mockFeedRequests).toEqual(
      expect.arrayContaining([
        { feed: 'shows', token: 'clerk-session-account-a' },
        { feed: 'watchlist', token: 'clerk-session-account-a' },
        { feed: 'recommendations', token: 'clerk-session-account-a' },
      ]),
    );

    const accountBResponse = deferred<Record<string, unknown>>();
    mockFeedResponses['clerk-session-account-b'] = {
      shows: accountBResponse.promise.then((response) => response.shows),
      watchlist: accountBResponse.promise.then((response) => response.watchlist),
      recommendations: accountBResponse.promise.then((response) => response.recommendations),
    };
    mockActiveSession.token = 'clerk-session-account-b';
    mockClerkAuthState.current = {
      isLoaded: true,
      isSignedIn: true,
      userId: 'account-b',
      getToken: mockGetSessionToken,
    };

    await act(async () => {
      screen.rerender(
        <QueryClientProvider client={queryClient}>
          <AppAuthProvider>
            <HomeScreen />
          </AppAuthProvider>
        </QueryClientProvider>,
      );
    });

    expect(screen.queryByText('Account A private watchlist title')).toBeNull();
    expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(mockFeedRequests).toEqual(
        expect.arrayContaining([
          { feed: 'shows', token: 'clerk-session-account-b' },
          { feed: 'watchlist', token: 'clerk-session-account-b' },
          { feed: 'recommendations', token: 'clerk-session-account-b' },
        ]),
      );
    });

    accountBResponse.resolve({
      shows: [],
      watchlist: [{ id: 2, name: 'Account B private watchlist title' }],
      recommendations: [],
    });

    await waitFor(() => {
      expect(screen.getByText('Account B private watchlist title')).toBeTruthy();
    });
    expect(screen.queryByText('Account A private watchlist title')).toBeNull();
  });
});