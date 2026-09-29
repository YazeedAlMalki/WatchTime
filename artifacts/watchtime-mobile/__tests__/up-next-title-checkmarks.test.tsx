import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
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
  return {
    getGetTitleQueryKey: titleKey,
    getGetSeasonQueryKey: seasonKey,
    getGetMyShowsQueryKey: showsKey,
    getGetMyRecommendationsQueryKey: recsKey,
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
      queryFn: () => [{
        title: { id: 42, name: 'Example Show' },
        nextEpisode: { ...mockEpisodes[2] },
        totalEpisodes: 4,
        watchedEpisodes: mockWatched.size,
      }],
    }),
    useGetMyWatchlist: () => useQuery({ queryKey: ['/api/me/watchlist'], queryFn: () => [] }),
    useGetMyRecommendations: () => useQuery({ queryKey: recsKey(), queryFn: () => [] }),
    useGetSimilarTitles: () => ({ data: [] }),
    useGetTitleSafety: () => ({ data: null, isLoading: false }),
    useMarkEpisodeWatched: (options: { mutation: { onSuccess: () => void } }) =>
      useMutation({
        mutationFn: async ({ episodeId, data }: { episodeId: number; data: { includePrevious?: boolean } }) => {
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
import TitleDetailScreen from '../app/title/[id]';

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

it('refreshes cached seasons and title when opening a show after marking with includePrevious', async () => {
  mockWatched.clear();
  mockSeasonFetch.mockClear();
  mockTitleFetch.mockClear();
  mockRouter.push.mockClear();
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } },
  });
  const { getGetSeasonQueryKey, getGetTitleQueryKey } = require('@workspace/api-client-react');

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
  fireEvent.press(home.getByTestId('mark-watched-201'));
  await waitFor(() => {
    expect([...mockWatched].sort()).toEqual([101, 102, 201]);
    expect(client.getQueryState(getGetSeasonQueryKey(42, 1))?.isInvalidated).toBe(true);
    expect(client.getQueryState(getGetSeasonQueryKey(42, 2))?.isInvalidated).toBe(true);
    expect(client.getQueryState(getGetTitleQueryKey(42))?.isInvalidated).toBe(true);
  });

  fireEvent.press(home.getByTestId('upnext-42'));
  expect(mockRouter.push).toHaveBeenCalledWith('/title/42');
  await act(async () => home.unmount());

  const detail = await render(
    <QueryClientProvider client={client}>
      <TitleDetailScreen />
      <SeasonRows season={1} />
      <SeasonRows season={2} />
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
  await act(async () => detail.unmount());
  client.clear();
});

afterEach(cleanup);