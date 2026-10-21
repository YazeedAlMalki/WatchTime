import React from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  getGetMyRecommendationsQueryKey,
  getGetMyShowsQueryKey,
  getGetMyWatchlistQueryKey,
} from '@workspace/api-client-react';

// Bypass the default empty API-client Jest stub: exercise the production
// generated hooks and customFetch, replacing only the network boundary.
jest.mock('@workspace/api-client-react', () =>
  jest.requireActual('../../../lib/api-client-react/src/index'),
);
jest.mock('@/lib/app-auth', () => ({
  useAppAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'home-network-user' }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/lib/home-startup', () => ({
  startHomeStartup: (ready: (value: boolean) => void) => {
    ready(true);
    return () => {};
  },
}));
jest.mock('@/lib/startup-metrics', () => ({ markStartup: jest.fn() }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/components/ui', () => {
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
    background: '#fff', foreground: '#111', mutedForeground: '#777',
    primary: '#6633cc', primaryForeground: '#fff', muted: '#eee',
  }),
}));
jest.mock('@/constants/colors', () => ({ __esModule: true, default: { radius: 8 } }));

import HomeScreen from '../app/(tabs)/index';

const trackedShow = {
  title: { id: 7, name: 'Up Next Show', posterUrl: null, backdropUrl: null },
  nextEpisode: { id: 71, name: 'Pilot', seasonNumber: 1, episodeNumber: 1, stillUrl: null },
  totalEpisodes: 10,
  watchedEpisodes: 0,
};
const accountKey = (key: readonly unknown[]) => [...key, 'account', 'home-network-user'];
const feedCases = [
  {
    key: accountKey(getGetMyShowsQueryKey()),
    path: '/api/me/shows',
    data: [trackedShow],
    recoveredData: [{ ...trackedShow, title: { ...trackedShow.title, name: 'Updated Up Next Show' } }],
    card: 'Up Next Show',
    recoveredCard: 'Updated Up Next Show',
    empty: 'Nothing to watch yet',
    warning: 'up-next-refresh-warning',
    fullError: 'up-next-error',
    section: 'Up Next',
  },
  {
    key: accountKey(getGetMyWatchlistQueryKey()),
    path: '/api/me/watchlist',
    data: [{ id: 8, name: 'Saved Show' }],
    recoveredData: [{ id: 8, name: 'Updated Saved Show' }],
    card: 'Saved Show',
    recoveredCard: 'Updated Saved Show',
    empty: 'Watchlist is empty',
    warning: 'watchlist-refresh-warning',
    fullError: 'watchlist-error',
    section: 'your watchlist',
  },
  {
    key: accountKey(getGetMyRecommendationsQueryKey()),
    path: '/api/me/recommendations',
    data: [{ reason: 'Because you watch drama', titles: [{ id: 9, name: 'Suggested Show' }] }],
    recoveredData: [{ reason: 'Because you watch drama', titles: [{ id: 9, name: 'Updated Suggested Show' }] }],
    card: 'Suggested Show',
    recoveredCard: 'Updated Suggested Show',
    empty: 'No recommendations yet',
    warning: 'recommendations-refresh-warning',
    fullError: 'recommendations-error',
    section: 'recommendations',
  },
];

describe('Home network refetch failures with a real query client', () => {
  let client: QueryClient;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
  });

  afterEach(async () => {
    await cleanup();
    client.clear();
    fetchSpy.mockRestore();
  });

  it.each(['cards', 'empty sections'] as const)(
    'keeps cached %s after pull-to-refresh fails and clears only the successfully retried warning',
    async (cachedContent) => {
    const empty = cachedContent === 'empty sections';
    const feeds = feedCases.map((feed) => ({
      ...feed,
      data: empty ? [] : feed.data,
      recoveredData: empty ? [] : feed.recoveredData,
      card: empty ? feed.empty : feed.card,
      recoveredCard: empty ? feed.empty : feed.recoveredCard,
    }));
    for (const feed of feeds) {
      client.setQueryData(feed.key, feed.data);
      expect(client.getQueryState(feed.key)?.status).toBe('success');
      expect(client.getQueryState(feed.key)?.dataUpdatedAt).toBeGreaterThan(0);
    }
    const screen = await render(
      <QueryClientProvider client={client}><HomeScreen /></QueryClientProvider>,
    );
    for (const feed of feeds) {
      expect(screen.getByText(feed.card)).toBeTruthy();
      expect(screen.queryByTestId(feed.warning)).toBeNull();
      expect(screen.queryByTestId(feed.fullError)).toBeNull();
    }
    // Seeded data is fresh: every network call below must come from an
    // actual refresh or section retry, rather than an incidental mount.
    expect(fetchSpy).not.toHaveBeenCalled();

    // The native ScrollView mock retains refreshControl as a prop rather
    // than mounting it as a host child in the test renderer.
    const scrollView = screen.root!.queryAll(
      (node) => node.props.refreshControl != null,
      { includeSelf: true },
    )[0];
    expect(scrollView).toBeTruthy();
    await act(async () => scrollView.props.refreshControl.props.onRefresh());
    await waitFor(() => {
      for (const feed of feeds) {
        expect(screen.getByTestId(feed.warning)).toBeTruthy();
        expect(client.getQueryState(feed.key)?.status).toBe('error');
        expect(client.getQueryState(feed.key)?.fetchStatus).toBe('idle');
      }
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    for (const feed of feeds) {
      expect(client.getQueryData(feed.key)).toEqual(feed.data);
      expect(screen.getByText(feed.card)).toBeTruthy();
      expect(screen.queryByTestId(feed.fullError)).toBeNull();
      expect(within(screen.getByTestId(feed.warning)).getByText(
        `Couldn't refresh ${feed.section}. Results may be out of date.`,
      )).toBeTruthy();
    }
    for (const feed of feedCases) {
      if (empty) expect(screen.queryByText(feed.card)).toBeNull();
      else expect(screen.queryByText(feed.empty)).toBeNull();
    }

    for (const [index, feed] of feeds.entries()) {
      let resolveResponse!: (response: Response) => void;
      fetchSpy.mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }));
      await fireEvent.press(within(screen.getByTestId(feed.warning)).getByRole('button', {
        name: `Retry ${feed.section}`,
      }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(4 + index));
      expect(fetchSpy.mock.calls[3 + index][0]).toBe(feed.path);
      expect(client.getQueryState(feed.key)?.fetchStatus).toBe('fetching');
      expect(screen.getByText(feed.card)).toBeTruthy();
      expect(screen.getByTestId(feed.warning)).toBeTruthy();
      expect(screen.queryByTestId(feed.fullError)).toBeNull();

      await act(async () => {
        resolveResponse(new Response(JSON.stringify(feed.recoveredData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      });
      await waitFor(() => {
        expect(screen.queryByTestId(feed.warning)).toBeNull();
        expect(screen.getByText(feed.recoveredCard)).toBeTruthy();
        expect(client.getQueryState(feed.key)?.status).toBe('success');
      });
      if (!empty) expect(screen.queryByText(feed.card)).toBeNull();
      expect(client.getQueryData(feed.key)).toEqual(feed.recoveredData);
      // Other sections must not refetch or lose their independent warning.
      for (const [otherIndex, other] of feeds.entries()) {
        expect(screen.getByText(otherIndex <= index ? other.recoveredCard : other.card)).toBeTruthy();
        expect(screen.queryByTestId(other.fullError)).toBeNull();
        if (otherIndex > index) expect(screen.getByTestId(other.warning)).toBeTruthy();
        else expect(screen.queryByTestId(other.warning)).toBeNull();
      }
      expect(fetchSpy).toHaveBeenCalledTimes(4 + index);
    }
  });
});
