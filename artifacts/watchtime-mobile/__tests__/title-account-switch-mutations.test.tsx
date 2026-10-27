import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockAuth = {
  current: { isSignedIn: true, isAuthAvailable: true, userId: 'account-a' as string | null },
};
const mockSession = { token: 'session-account-a' };
const mockTitleRequests: Array<{ id: number; token: string }> = [];
const mockFetchTitle = jest.fn();
const mockResolveTitleByToken: Record<string, (title: typeof mockTitle) => void> = {};
const mockTitle = {
  id: 456,
  name: 'The selected movie',
  type: 'movie',
  year: 2024,
  genres: [],
  altTitles: [],
  providers: [],
  seasons: [],
  inWatchlist: false,
  watched: false,
};
const mockTitleMutationOptions: {
  add?: { onMutate?: () => unknown; onSuccess?: (...args: any[]) => unknown };
  remove?: { onMutate?: () => unknown; onSuccess?: (...args: any[]) => unknown };
  mark?: { onMutate?: () => unknown; onSuccess?: (...args: any[]) => unknown };
  unmark?: { onMutate?: () => unknown; onSuccess?: (...args: any[]) => unknown };
} = {};
const mockAdd = jest.fn();
const mockRemove = jest.fn();
const mockMark = jest.fn();
const mockUnmark = jest.fn();
let mockQueryClient: QueryClient;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false }),
  useLocalSearchParams: () => ({ id: '456' }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/app-auth', () => ({
  useAppAuth: () => mockAuth.current,
  showSignInUnavailableMessage: jest.fn(),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => mockQueryClient,
}));
jest.mock('@workspace/api-client-react', () => ({
  getGetTitleQueryKey: (id: number) => [`/api/titles/${id}`],
  getGetMyWatchlistQueryKey: () => ['/api/me/watchlist'],
  getGetMyShowsQueryKey: () => ['/api/me/shows'],
  getGetMyInProgressShowsQueryKey: () => ['/api/me/in-progress-shows'],
  getGetMyMoviesQueryKey: () => ['/api/me/movies'],
  getGetMyRecentActivityQueryKey: () => ['/api/me/recent'],
  getGetMyRecommendationsQueryKey: () => ['/api/me/recommendations'],
  useGetTitle: (id: number, options?: { query?: { queryKey?: unknown[] } }) => {
    const { useQuery } = require('@tanstack/react-query');
    return useQuery({
      queryKey: options?.query?.queryKey ?? [`/api/titles/${id}`],
      queryFn: async () => {
        const token = mockSession.token;
        mockTitleRequests.push({ id, token });
        return mockFetchTitle(id, token);
      },
    });
  },
  useGetSimilarTitles: () => ({ data: [] }),
  useGetTitleSafety: () => ({ data: null, isLoading: false }),
  useAddToWatchlist: (options?: { mutation?: typeof mockTitleMutationOptions.add }) => {
    mockTitleMutationOptions.add = options?.mutation;
    return { mutate: mockAdd, isPending: false };
  },
  useRemoveFromWatchlist: (options?: { mutation?: typeof mockTitleMutationOptions.remove }) => {
    mockTitleMutationOptions.remove = options?.mutation;
    return { mutate: mockRemove, isPending: false };
  },
  useMarkTitleWatched: (options?: { mutation?: typeof mockTitleMutationOptions.mark }) => {
    mockTitleMutationOptions.mark = options?.mutation;
    return { mutate: mockMark, isPending: false };
  },
  useUnmarkTitleWatched: (options?: { mutation?: typeof mockTitleMutationOptions.unmark }) => {
    mockTitleMutationOptions.unmark = options?.mutation;
    return { mutate: mockUnmark, isPending: false };
  },
  useCreateSafetyReport: () => ({ mutate: jest.fn(), isPending: false }),
  useCreateSafetyContribution: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/components/ui', () => ({
  SectionHeader: () => null,
  ErrorState: () => null,
  Loading: () => null,
  PosterCard: () => null,
}));
jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff',
    foreground: '#000',
    mutedForeground: '#777',
    primary: '#6633cc',
    primaryForeground: '#fff',
    card: '#eee',
    border: '#ccc',
    secondary: '#eee',
    muted: '#ddd',
    destructive: '#c00',
  }),
}));
jest.mock('@/constants/colors', () => ({ __esModule: true, default: { radius: 8 } }));

import TitleDetailScreen from '../app/title/[id]';

describe('title actions during an account switch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.current = { isSignedIn: true, isAuthAvailable: true, userId: 'account-a' };
    mockSession.token = 'session-account-a';
    mockTitleRequests.length = 0;
    mockFetchTitle.mockReset();
    Object.keys(mockTitleMutationOptions).forEach((key) => {
      delete mockTitleMutationOptions[key as keyof typeof mockTitleMutationOptions];
    });
    Object.keys(mockResolveTitleByToken).forEach((token) => delete mockResolveTitleByToken[token]);
    mockQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
  });

  afterEach(async () => {
    cleanup();
    mockQueryClient.clear();
  });

  it('ignores old watch mutations and refetches only the active account', async () => {
    mockFetchTitle.mockImplementation((_id: number, token: string) => {
      return new Promise((resolve) => {
        mockResolveTitleByToken[token] = resolve;
      });
    });
    const screen = await render(
      <QueryClientProvider client={mockQueryClient}>
        <TitleDetailScreen />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(mockResolveTitleByToken['session-account-a']).toEqual(expect.any(Function));
    });
    await act(async () => {
      mockResolveTitleByToken['session-account-a']?.({
        ...mockTitle,
        inWatchlist: false,
        watched: false,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('Watchlist')).toBeTruthy();
      expect(screen.getByText('Mark watched')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('watchlist-toggle'));
    fireEvent.press(screen.getByTestId('watched-toggle'));
    const watchlistContext = await mockTitleMutationOptions.add?.onMutate?.();
    const watchedContext = await mockTitleMutationOptions.mark?.onMutate?.();

    mockSession.token = 'session-account-b';
    mockAuth.current = { isSignedIn: true, isAuthAvailable: true, userId: 'account-b' };
    await act(async () => {
      screen.rerender(
        <QueryClientProvider client={mockQueryClient}>
          <TitleDetailScreen />
        </QueryClientProvider>,
      );
    });
    await waitFor(() => {
      expect(mockResolveTitleByToken['session-account-b']).toEqual(expect.any(Function));
    });
    await act(async () => {
      mockResolveTitleByToken['session-account-b']?.({
        ...mockTitle,
        inWatchlist: true,
        watched: true,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('In Watchlist')).toBeTruthy();
      expect(screen.getByText('Watched')).toBeTruthy();
    });

    await act(async () => {
      await mockTitleMutationOptions.add?.onSuccess?.(undefined, { id: 456 }, watchlistContext);
      await mockTitleMutationOptions.mark?.onSuccess?.(undefined, { id: 456 }, watchedContext);
    });
    expect(mockTitleRequests).toEqual([
      { id: 456, token: 'session-account-a' },
      { id: 456, token: 'session-account-b' },
    ]);
    expect(screen.getByText('In Watchlist')).toBeTruthy();
    expect(screen.getByText('Watched')).toBeTruthy();

    fireEvent.press(screen.getByTestId('watchlist-toggle'));
    const activeAccountContext = await mockTitleMutationOptions.remove?.onMutate?.();
    await mockTitleMutationOptions.remove?.onSuccess?.(
      undefined,
      { id: 456 },
      activeAccountContext,
    );
    await waitFor(() => {
      expect(mockTitleRequests).toHaveLength(3);
    });
    expect(mockTitleRequests[2]).toEqual({ id: 456, token: 'session-account-b' });
    await act(async () => {
      mockResolveTitleByToken['session-account-b']?.({
        ...mockTitle,
        inWatchlist: false,
        watched: true,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('Watchlist')).toBeTruthy();
      expect(screen.getByText('Watched')).toBeTruthy();
    });

    await screen.unmount();
  });
});
