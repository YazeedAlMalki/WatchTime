import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };
const mockRoute = { current: { id: '456' }, listeners: new Set<() => void>() };
const mockSetRoute = (route: { id: string }) => {
  mockRoute.current = route;
  mockRoute.listeners.forEach((listener) => listener());
};
const mockAuth = {
  current: { isLoaded: true, isSignedIn: false, isAuthAvailable: true, userId: null as string | null },
};
const mockUseQueryForTitle = { current: false };
const mockUseQueryForSafety = { current: false };
const mockUseQueryForSimilar = { current: false };
const mockSession = { token: 'session-account-a' };
const mockTitleRequests: Array<{ id: number; token: string }> = [];
const mockSafetyRequests: number[] = [];
const mockFetchTitle = jest.fn();
const mockSimilarTitleRequests: number[] = [];
const mockFetchSimilarTitles = jest.fn();
const mockResolveSimilarTitlesById: Record<number, (titles: typeof mockSimilarTitle[]) => void> = {};
const mockResolveTitleByToken: Record<string, (title: typeof mockTitle) => void> = {};
const mockRejectTitleByToken: Record<string, (error: Error) => void> = {};
const mockResolveTitleById: Record<number, (title: typeof mockTitle) => void> = {};
const mockResolveSafetyById: Record<number, (info: any) => void> = {};
const mockSeasonRequests: Array<{ titleId: number; seasonNumber: number; token: string }> = [];
const mockResolveSeasonByToken: Record<string, (season: { episodes: any[] }) => void> = {};
const mockTitle = {
  id: 456,
  name: 'The selected movie',
  type: 'movie',
  year: 2024,
  genres: [],
  altTitles: [],
  providers: [],
  seasons: [] as Array<{
    seasonNumber: number;
    name: string;
    episodeCount: number;
    watchedCount: number | null;
  }>,
  inWatchlist: false,
  watched: false,
};
const mockSimilarTitle = { id: 1001, name: 'A related title' };
const mockAdd = jest.fn();
const mockRemove = jest.fn();
const mockMark = jest.fn();
const mockUnmark = jest.fn();
let mockMutationSettled = 0;
const mockMutationHook = (operation: jest.Mock) => (options?: { mutation?: any }) => ({
  mutate: (variables: unknown) => {
    const context = options?.mutation?.onMutate?.(variables);
    let result: unknown;
    try {
      result = operation(variables);
    } catch (error) {
      result = Promise.reject(error);
    }
    Promise.resolve()
      .then(() => result)
      .then(
        (data) => options?.mutation?.onSuccess?.(data, variables, context),
        (error) => options?.mutation?.onError?.(error, variables, context),
      )
      .finally(() => {
        mockMutationSettled += 1;
      });
  },
  isPending: false,
});
const mockCreateReport = jest.fn();
const mockCreateContribution = jest.fn();
const mockTitleFetch = jest.fn();
const mockSignInUnavailable = jest.fn();
const mockSafetyInfo: { current: any } = { current: null };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => {
    const React = require('react');
    return React.useSyncExternalStore(
      (listener: () => void) => {
        mockRoute.listeners.add(listener);
        return () => mockRoute.listeners.delete(listener);
      },
      () => mockRoute.current,
    );
  },
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/app-auth', () => ({
  useAppAuth: () => mockAuth.current,
  showSignInUnavailableMessage: () => mockSignInUnavailable(),
}));
jest.mock('expo-image', () => ({
  Image: () => null,
}));
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
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('@workspace/api-client-react', () => ({
  getGetTitleQueryKey: (id: number) => [`/api/titles/${id}`],
  getGetMyWatchlistQueryKey: () => ['/api/me/watchlist'],
  getGetMyShowsQueryKey: () => ['/api/me/shows'],
  getGetMyInProgressShowsQueryKey: () => ['/api/me/shows/in-progress'],
  getGetMyMoviesQueryKey: () => ['/api/me/movies'],
  getGetMyRecentActivityQueryKey: () => ['/api/me/recent-activity'],
  getGetMyRecommendationsQueryKey: () => ['/api/me/recommendations'],
  getGetTitleSafetyQueryKey: ({ titleId }: { titleId: number }) => [`/api/titles/${titleId}/safety`],
  useGetTitle: (id: number, options?: { query?: { queryKey?: unknown[] } }) => {
    mockTitleFetch(id);
    if (mockUseQueryForTitle.current) {
      const { useQuery } = require('@tanstack/react-query');
      return useQuery({
        queryKey: options?.query?.queryKey ?? [`/api/titles/${id}`],
        queryFn: async () => {
          const token = mockSession.token;
          mockTitleRequests.push({ id, token });
          return mockFetchTitle(id, token);
        },
      });
    }
    return { data: { ...mockTitle }, isLoading: false, isError: false };
  },
  getGetSeasonQueryKey: (titleId: number, seasonNumber: number) => [
    `/api/titles/${titleId}/seasons/${seasonNumber}`,
  ],
  useGetSeason: (
    titleId: number,
    seasonNumber: number,
    options?: { query?: { queryKey?: unknown[]; enabled?: boolean } },
  ) => {
    if (mockUseQueryForTitle.current) {
      const { useQuery } = require('@tanstack/react-query');
      return useQuery({
        queryKey: options?.query?.queryKey ?? [`/api/titles/${titleId}/seasons/${seasonNumber}`],
        enabled: options?.query?.enabled,
        queryFn: async () => {
          const token = mockSession.token;
          mockSeasonRequests.push({ titleId, seasonNumber, token });
          return new Promise((resolve) => {
            mockResolveSeasonByToken[token] = resolve;
          });
        },
      });
    }
    return { data: { episodes: [] }, isLoading: false, isError: false };
  },
  useGetSimilarTitles: (id: number) => {
    if (mockUseQueryForSimilar.current) {
      const { useQuery } = require('@tanstack/react-query');
      return useQuery({
        queryKey: [`/api/titles/${id}/similar`],
        queryFn: async () => {
          mockSimilarTitleRequests.push(id);
          return mockFetchSimilarTitles(id);
        },
      });
    }
    return { data: [] };
  },
  useGetTitleSafety: ({ titleId }: { titleId: number }) => {
    if (!mockUseQueryForSafety.current) {
      return { data: mockSafetyInfo.current, isLoading: false };
    }
    const { useQuery } = require('@tanstack/react-query');
    return useQuery({
      queryKey: [`/api/titles/${titleId}/safety`],
      queryFn: async () => {
        mockSafetyRequests.push(titleId);
        return new Promise((resolve) => {
          mockResolveSafetyById[titleId] = resolve;
        });
      },
    });
  },
  useAddToWatchlist: (options: any) => mockMutationHook(mockAdd)(options),
  useRemoveFromWatchlist: (options: any) => mockMutationHook(mockRemove)(options),
  useMarkTitleWatched: (options: any) => mockMutationHook(mockMark)(options),
  useUnmarkTitleWatched: (options: any) => mockMutationHook(mockUnmark)(options),
  useMarkEpisodeWatched: (options: any) => mockMutationHook(mockMark)(options),
  useUnmarkEpisodeWatched: (options: any) => mockMutationHook(mockUnmark)(options),
  useCreateSafetyReport: () => ({ mutate: mockCreateReport, isPending: false }),
  useCreateSafetyContribution: () => ({
    mutate: mockCreateContribution,
    isPending: false,
  }),
}));
jest.mock('@/components/ui', () => ({
  SectionHeader: () => null,
  ErrorState: ({ message }: { message?: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return message ? React.createElement(Text, null, message) : null;
  },
  Loading: () => null,
  PosterCard: ({ title }: { title: { name: string } }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, null, title.name);
  },
}));
jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff', foreground: '#000', mutedForeground: '#777',
    primary: '#6633cc', primaryForeground: '#fff', card: '#eee',
    border: '#ccc', secondary: '#eee', muted: '#ddd', destructive: '#c00',
  }),
}));
jest.mock('@/constants/colors', () => ({ __esModule: true, default: { radius: 8 } }));

import TitleDetailScreen from '../app/title/[id]';

describe('title action sign-in return', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTitle.name = 'The selected movie';
    mockAuth.current = { isLoaded: true, isSignedIn: false, isAuthAvailable: true, userId: null };
    mockUseQueryForTitle.current = false;
    mockUseQueryForSafety.current = false;
    mockUseQueryForSimilar.current = false;
    mockSession.token = 'session-account-a';
    mockTitle.type = 'movie';
    mockTitle.seasons = [];
    mockTitleRequests.length = 0;
    mockSafetyRequests.length = 0;
    mockSeasonRequests.length = 0;
    mockSimilarTitleRequests.length = 0;
    mockFetchTitle.mockReset();
    mockFetchSimilarTitles.mockReset();
    Object.keys(mockResolveTitleByToken).forEach((token) => delete mockResolveTitleByToken[token]);
    Object.keys(mockRejectTitleByToken).forEach((token) => delete mockRejectTitleByToken[token]);
    Object.keys(mockResolveTitleById).forEach((id) => delete mockResolveTitleById[Number(id)]);
    Object.keys(mockResolveSafetyById).forEach((id) => delete mockResolveSafetyById[Number(id)]);
    Object.keys(mockResolveSeasonByToken).forEach((token) => delete mockResolveSeasonByToken[token]);
    Object.keys(mockResolveSimilarTitlesById).forEach((id) => delete mockResolveSimilarTitlesById[Number(id)]);
    mockRoute.current = { id: '456' };
    mockTitle.inWatchlist = false;
    mockTitle.watched = false;
    mockMutationSettled = 0;
    mockSafetyInfo.current = null;
    mockRouter.canGoBack.mockReturnValue(false);
  });

  afterEach(cleanup);

  it.each([
    ['watchlist-toggle', 'Watchlist'],
    ['watched-toggle', 'Mark watched'],
  ])('sends signed-out %s to sign-in for this movie without changing its state', async (action, initialLabel) => {
    const detail = await render(<TitleDetailScreen />);
    expect(detail.getByText('The selected movie')).toBeTruthy();
    expect(detail.getByText(initialLabel)).toBeTruthy();
    fireEvent.press(detail.getByTestId(action));

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/(auth)/sign-in',
      params: { returnTo: '/title/456' },
    });
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('keeps title watch status scoped to the active account when rapid switches resolve out of order', async () => {
    mockUseQueryForTitle.current = true;
    mockAuth.current = { isLoaded: true, isSignedIn: true, isAuthAvailable: true, userId: 'account-a' };
    mockFetchTitle.mockImplementation((_id: number, token: string) => {
      return new Promise((resolve) => {
        mockResolveTitleByToken[token] = resolve;
      });
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const screen = await render(
      <QueryClientProvider client={client}>
        <TitleDetailScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mockTitleRequests).toContainEqual({ id: 456, token: 'session-account-a' });
      expect(mockResolveTitleByToken['session-account-a']).toEqual(expect.any(Function));
    });

    const switchAccount = async (userId: string, token: string) => {
      mockSession.token = token;
      mockAuth.current = { isLoaded: true, isSignedIn: true, isAuthAvailable: true, userId };
      await act(async () => {
        screen.rerender(
          <QueryClientProvider client={client}>
            <TitleDetailScreen />
          </QueryClientProvider>,
        );
      });
      await waitFor(() => {
        expect(mockTitleRequests).toContainEqual({ id: 456, token });
        expect(mockResolveTitleByToken[token]).toEqual(expect.any(Function));
      });
      expect(screen.queryByText('In Watchlist')).toBeNull();
      expect(screen.queryByText('Watched')).toBeNull();
    };

    await switchAccount('account-b', 'session-account-b');
    await switchAccount('account-c', 'session-account-c');

    expect(mockTitleRequests).toEqual([
      { id: 456, token: 'session-account-a' },
      { id: 456, token: 'session-account-b' },
      { id: 456, token: 'session-account-c' },
    ]);

    await act(async () => {
      mockResolveTitleByToken['session-account-c']?.({
        ...mockTitle,
        inWatchlist: false,
        watched: true,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('Watchlist')).toBeTruthy();
      expect(screen.getByText('Watched')).toBeTruthy();
    });

    await act(async () => {
      mockResolveTitleByToken['session-account-b']?.({
        ...mockTitle,
        inWatchlist: true,
        watched: false,
      });
    });
    await act(async () => {
      mockResolveTitleByToken['session-account-a']?.({
        ...mockTitle,
        inWatchlist: true,
        watched: true,
      });
    });

    expect(screen.getByText('Watchlist')).toBeTruthy();
    expect(screen.getByText('Watched')).toBeTruthy();
    expect(screen.queryByText('In Watchlist')).toBeNull();
    expect(screen.queryByText('Mark watched')).toBeNull();

    await screen.unmount();
    client.clear();
  });

  it.each(['guest-first', 'account-first'] as const)(
    'keeps guest title history private when the %s response resolves first',
    async (firstResponse) => {
      mockUseQueryForTitle.current = true;
      mockSession.token = 'guest-during-auth-load';
      mockAuth.current = {
        isLoaded: false,
        isSignedIn: false,
        isAuthAvailable: true,
        userId: null,
      };
      mockFetchTitle.mockImplementation((_id: number, token: string) => {
        return new Promise((resolve) => {
          mockResolveTitleByToken[token] = resolve;
        });
      });
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
      });
      const screen = await render(
        <QueryClientProvider client={client}>
          <TitleDetailScreen />
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(mockTitleRequests).toContainEqual({ id: 456, token: 'guest-during-auth-load' });
        expect(mockResolveTitleByToken['guest-during-auth-load']).toEqual(expect.any(Function));
      });
      expect(screen.queryByText('In Watchlist')).toBeNull();
      expect(screen.queryByText('Watched')).toBeNull();

      mockSession.token = 'session-account-a';
      mockAuth.current = {
        isLoaded: true,
        isSignedIn: true,
        isAuthAvailable: true,
        userId: 'account-a',
      };
      await act(async () => {
        screen.rerender(
          <QueryClientProvider client={client}>
            <TitleDetailScreen />
          </QueryClientProvider>,
        );
      });
      await waitFor(() => {
        expect(mockTitleRequests).toContainEqual({ id: 456, token: 'session-account-a' });
        expect(mockResolveTitleByToken['session-account-a']).toEqual(expect.any(Function));
      });
      expect(screen.queryByText('In Watchlist')).toBeNull();
      expect(screen.queryByText('Watched')).toBeNull();

      const resolveGuest = async () => {
        await act(async () => {
          mockResolveTitleByToken['guest-during-auth-load']?.({
            ...mockTitle,
            inWatchlist: true,
            watched: false,
          });
        });
      };
      const resolveAccount = async () => {
        await act(async () => {
          mockResolveTitleByToken['session-account-a']?.({
            ...mockTitle,
            inWatchlist: false,
            watched: true,
          });
        });
      };

      if (firstResponse === 'guest-first') {
        await resolveGuest();
        expect(screen.queryByText('In Watchlist')).toBeNull();
        expect(screen.queryByText('Watched')).toBeNull();
        await resolveAccount();
      } else {
        await resolveAccount();
        await waitFor(() => {
          expect(screen.getByText('Watchlist')).toBeTruthy();
          expect(screen.getByText('Watched')).toBeTruthy();
        });
        await resolveGuest();
      }

      await waitFor(() => {
        expect(screen.getByText('The selected movie')).toBeTruthy();
        expect(screen.getByText('Watchlist')).toBeTruthy();
        expect(screen.getByText('Watched')).toBeTruthy();
      });
      expect(screen.queryByText('In Watchlist')).toBeNull();
      expect(screen.queryByText('Mark watched')).toBeNull();

      await screen.unmount();
      client.clear();
    },
  );

  it('does not show a completed guest title status while auth is still loading', async () => {
    mockUseQueryForTitle.current = true;
    mockSession.token = 'guest-during-auth-load';
    mockAuth.current = {
      isLoaded: false,
      isSignedIn: false,
      isAuthAvailable: true,
      userId: null,
    };
    mockFetchTitle.mockImplementation((_id: number, token: string) => {
      return new Promise((resolve) => {
        mockResolveTitleByToken[token] = resolve;
      });
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const screen = await render(
      <QueryClientProvider client={client}>
        <TitleDetailScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mockResolveTitleByToken['guest-during-auth-load']).toEqual(expect.any(Function));
    });
    await act(async () => {
      mockResolveTitleByToken['guest-during-auth-load']?.({
        ...mockTitle,
        inWatchlist: true,
        watched: true,
      });
    });
    await waitFor(() => expect(screen.getByText('The selected movie')).toBeTruthy());
    expect(screen.getByText('Watchlist')).toBeTruthy();
    expect(screen.getByText('Mark watched')).toBeTruthy();
    expect(screen.queryByText('In Watchlist')).toBeNull();
    expect(screen.queryByText('Watched')).toBeNull();

    mockSession.token = 'session-account-a';
    mockAuth.current = {
      isLoaded: true,
      isSignedIn: true,
      isAuthAvailable: true,
      userId: 'account-a',
    };
    await act(async () => {
      screen.rerender(
        <QueryClientProvider client={client}>
          <TitleDetailScreen />
        </QueryClientProvider>,
      );
    });
    await waitFor(() => {
      expect(mockTitleRequests).toContainEqual({ id: 456, token: 'session-account-a' });
      expect(mockResolveTitleByToken['session-account-a']).toEqual(expect.any(Function));
    });
    expect(screen.queryByText('In Watchlist')).toBeNull();
    expect(screen.queryByText('Watched')).toBeNull();

    await act(async () => {
      mockResolveTitleByToken['session-account-a']?.({
        ...mockTitle,
        inWatchlist: false,
        watched: true,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('Watchlist')).toBeTruthy();
      expect(screen.getByText('Watched')).toBeTruthy();
    });
    expect(screen.queryByText('In Watchlist')).toBeNull();
    expect(screen.queryByText('Mark watched')).toBeNull();

    await screen.unmount();
    client.clear();
  });

  it('clears account watch status immediately on sign-out while guest title data loads', async () => {
    mockUseQueryForTitle.current = true;
    mockAuth.current = { isLoaded: true, isSignedIn: true, isAuthAvailable: true, userId: 'account-a' };
    mockFetchTitle.mockImplementation((_id: number, token: string) => {
      return new Promise((resolve) => {
        mockResolveTitleByToken[token] = resolve;
      });
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const screen = await render(
      <QueryClientProvider client={client}>
        <TitleDetailScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mockResolveTitleByToken['session-account-a']).toEqual(expect.any(Function));
    });
    await act(async () => {
      mockResolveTitleByToken['session-account-a']?.({
        ...mockTitle,
        inWatchlist: true,
        watched: true,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('In Watchlist')).toBeTruthy();
      expect(screen.getByText('Watched')).toBeTruthy();
    });

    mockSession.token = 'guest';
    mockAuth.current = { isLoaded: true, isSignedIn: false, isAuthAvailable: true, userId: null };
    await act(async () => {
      screen.rerender(
        <QueryClientProvider client={client}>
          <TitleDetailScreen />
        </QueryClientProvider>,
      );
    });

    await waitFor(() => {
      expect(mockTitleRequests).toContainEqual({ id: 456, token: 'guest' });
      expect(mockResolveTitleByToken.guest).toEqual(expect.any(Function));
    });
    expect(screen.queryByText('In Watchlist')).toBeNull();
    expect(screen.queryByText('Watched')).toBeNull();

    await act(async () => {
      mockResolveTitleByToken.guest?.({
        ...mockTitle,
        inWatchlist: false,
        watched: false,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('The selected movie')).toBeTruthy();
      expect(screen.getByText('Watchlist')).toBeTruthy();
      expect(screen.getByText('Mark watched')).toBeTruthy();
    });

    await screen.unmount();
    client.clear();
  });

  it('keeps the signed-in title status when sign-in returns before guest loading finishes', async () => {
    mockUseQueryForTitle.current = true;
    mockAuth.current = { isLoaded: true, isSignedIn: true, isAuthAvailable: true, userId: 'account-a' };
    mockFetchTitle.mockImplementation((_id: number, token: string) => {
      return new Promise((resolve) => {
        mockResolveTitleByToken[token] = resolve;
      });
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const screen = await render(
      <QueryClientProvider client={client}>
        <TitleDetailScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mockResolveTitleByToken['session-account-a']).toEqual(expect.any(Function));
    });
    await act(async () => {
      mockResolveTitleByToken['session-account-a']?.({
        ...mockTitle,
        inWatchlist: true,
        watched: true,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('In Watchlist')).toBeTruthy();
      expect(screen.getByText('Watched')).toBeTruthy();
    });

    mockSession.token = 'guest';
    mockAuth.current = { isLoaded: true, isSignedIn: false, isAuthAvailable: true, userId: null };
    await act(async () => {
      screen.rerender(
        <QueryClientProvider client={client}>
          <TitleDetailScreen />
        </QueryClientProvider>,
      );
    });
    await waitFor(() => {
      expect(mockResolveTitleByToken.guest).toEqual(expect.any(Function));
    });
    expect(screen.queryByText('In Watchlist')).toBeNull();
    expect(screen.queryByText('Watched')).toBeNull();

    mockSession.token = 'session-account-a';
    mockAuth.current = { isLoaded: true, isSignedIn: true, isAuthAvailable: true, userId: 'account-a' };
    await act(async () => {
      screen.rerender(
        <QueryClientProvider client={client}>
          <TitleDetailScreen />
        </QueryClientProvider>,
      );
    });
    await waitFor(() => {
      expect(mockTitleRequests.filter(({ token }) => token === 'session-account-a')).toHaveLength(2);
      expect(mockResolveTitleByToken['session-account-a']).toEqual(expect.any(Function));
      expect(screen.getByText('In Watchlist')).toBeTruthy();
      expect(screen.getByText('Watched')).toBeTruthy();
    });
    await act(async () => {
      mockResolveTitleByToken['session-account-a']?.({
        ...mockTitle,
        inWatchlist: true,
        watched: true,
      });
    });

    await act(async () => {
      mockResolveTitleByToken.guest?.({
        ...mockTitle,
        inWatchlist: false,
        watched: false,
      });
    });

    expect(screen.getByText('In Watchlist')).toBeTruthy();
    expect(screen.getByText('Watched')).toBeTruthy();
    expect(screen.queryByText('Watchlist')).toBeNull();
    expect(screen.queryByText('Mark watched')).toBeNull();

    await screen.unmount();
    client.clear();
  });

  it('does not restore private title status when an authenticated response finishes after sign-out', async () => {
    mockUseQueryForTitle.current = true;
    mockAuth.current = { isLoaded: true, isSignedIn: true, isAuthAvailable: true, userId: 'account-a' };
    mockFetchTitle.mockImplementation((_id: number, token: string) => {
      return new Promise((resolve) => {
        mockResolveTitleByToken[token] = resolve;
      });
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const screen = await render(
      <QueryClientProvider client={client}>
        <TitleDetailScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mockTitleRequests).toContainEqual({ id: 456, token: 'session-account-a' });
      expect(mockResolveTitleByToken['session-account-a']).toEqual(expect.any(Function));
    });

    mockSession.token = 'guest';
    mockAuth.current = { isLoaded: true, isSignedIn: false, isAuthAvailable: true, userId: null };
    await act(async () => {
      screen.rerender(
        <QueryClientProvider client={client}>
          <TitleDetailScreen />
        </QueryClientProvider>,
      );
    });
    await waitFor(() => {
      expect(mockTitleRequests).toContainEqual({ id: 456, token: 'guest' });
      expect(mockResolveTitleByToken.guest).toEqual(expect.any(Function));
    });
    expect(screen.queryByText('In Watchlist')).toBeNull();
    expect(screen.queryByText('Watched')).toBeNull();

    await act(async () => {
      mockResolveTitleByToken['session-account-a']?.({
        ...mockTitle,
        inWatchlist: true,
        watched: true,
      });
    });
    expect(screen.queryByText('In Watchlist')).toBeNull();
    expect(screen.queryByText('Watched')).toBeNull();

    await act(async () => {
      mockResolveTitleByToken.guest?.({
        ...mockTitle,
        inWatchlist: false,
        watched: false,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('The selected movie')).toBeTruthy();
      expect(screen.getByText('Watchlist')).toBeTruthy();
      expect(screen.getByText('Mark watched')).toBeTruthy();
      expect(screen.queryByText('In Watchlist')).toBeNull();
      expect(screen.queryByText('Watched')).toBeNull();
    });

    await screen.unmount();
    client.clear();
  });

  it('keeps the guest title view clear when an old authenticated request fails after sign-out', async () => {
    mockUseQueryForTitle.current = true;
    mockAuth.current = { isLoaded: true, isSignedIn: true, isAuthAvailable: true, userId: 'account-a' };
    mockFetchTitle.mockImplementation((_id: number, token: string) => {
      return new Promise((resolve, reject) => {
        mockResolveTitleByToken[token] = resolve;
        mockRejectTitleByToken[token] = reject;
      });
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const screen = await render(
      <QueryClientProvider client={client}>
        <TitleDetailScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mockTitleRequests).toContainEqual({ id: 456, token: 'session-account-a' });
      expect(mockRejectTitleByToken['session-account-a']).toEqual(expect.any(Function));
    });

    mockSession.token = 'guest';
    mockAuth.current = { isLoaded: true, isSignedIn: false, isAuthAvailable: true, userId: null };
    await act(async () => {
      screen.rerender(
        <QueryClientProvider client={client}>
          <TitleDetailScreen />
        </QueryClientProvider>,
      );
    });
    await waitFor(() => {
      expect(mockTitleRequests).toContainEqual({ id: 456, token: 'guest' });
      expect(mockResolveTitleByToken.guest).toEqual(expect.any(Function));
    });

    await act(async () => {
      mockRejectTitleByToken['session-account-a']?.(
        new Error('Private account title request failed'),
      );
    });
    expect(screen.queryByText("Couldn't load this title. Check your connection and try again.")).toBeNull();
    expect(screen.queryByText('Private account title request failed')).toBeNull();
    expect(screen.queryByText('In Watchlist')).toBeNull();
    expect(screen.queryByText('Watched')).toBeNull();

    await act(async () => {
      mockResolveTitleByToken.guest?.({
        ...mockTitle,
        inWatchlist: false,
        watched: false,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('The selected movie')).toBeTruthy();
      expect(screen.getByText('Watchlist')).toBeTruthy();
      expect(screen.getByText('Mark watched')).toBeTruthy();
      expect(screen.queryByText("Couldn't load this title. Check your connection and try again.")).toBeNull();
      expect(screen.queryByText('In Watchlist')).toBeNull();
      expect(screen.queryByText('Watched')).toBeNull();
    });
    await screen.unmount();
    client.clear();
  });

  it('keeps watched episode progress private while guest title and season data reload after sign-out', async () => {
    mockUseQueryForTitle.current = true;
    mockTitle.type = 'show';
    mockTitle.seasons = [{ seasonNumber: 1, name: 'Season 1', episodeCount: 2, watchedCount: 1 }];
    mockAuth.current = { isLoaded: true, isSignedIn: true, isAuthAvailable: true, userId: 'account-a' };
    mockFetchTitle.mockImplementation((_id: number, token: string) => (
      new Promise((resolve) => { mockResolveTitleByToken[token] = resolve; })
    ));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const screen = await render(
      <QueryClientProvider client={client}>
        <TitleDetailScreen />
      </QueryClientProvider>,
    );
    const accountTitle = {
      ...mockTitle,
      seasons: [{ seasonNumber: 1, name: 'Season 1', episodeCount: 2, watchedCount: 1 }],
    };
    const accountEpisode = {
      id: 9001,
      seasonNumber: 1,
      episodeNumber: 1,
      name: 'Private episode',
      watched: true,
      airDate: null,
      runtimeMinutes: null,
    };

    await waitFor(() => {
      expect(mockResolveTitleByToken['session-account-a']).toEqual(expect.any(Function));
    });
    await act(async () => {
      mockResolveTitleByToken['session-account-a']?.(accountTitle);
    });
    await waitFor(() => expect(screen.getByTestId('season-1')).toBeTruthy());
    expect(screen.getByText('1/2 watched')).toBeTruthy();
    fireEvent.press(screen.getByTestId('season-1'));
    await waitFor(() => {
      expect(mockSeasonRequests).toContainEqual({
        titleId: 456,
        seasonNumber: 1,
        token: 'session-account-a',
      });
    });
    await act(async () => {
      mockResolveSeasonByToken['session-account-a']?.({ episodes: [accountEpisode] });
    });
    await waitFor(() => {
      expect(screen.getByTestId('episode-check-9001').props.accessibilityState.checked).toBe(true);
    });

    mockSession.token = 'guest';
    mockAuth.current = { isLoaded: true, isSignedIn: false, isAuthAvailable: true, userId: null };
    await act(async () => {
      screen.rerender(
        <QueryClientProvider client={client}>
          <TitleDetailScreen />
        </QueryClientProvider>,
      );
    });
    await waitFor(() => {
      expect(mockResolveTitleByToken.guest).toEqual(expect.any(Function));
    });
    expect(screen.queryByTestId('episode-check-9001')).toBeNull();
    expect(screen.queryByText('1/2 watched')).toBeNull();

    await act(async () => {
      mockResolveTitleByToken.guest?.({
        ...mockTitle,
        inWatchlist: false,
        watched: false,
        seasons: [{ seasonNumber: 1, name: 'Season 1', episodeCount: 2, watchedCount: null }],
      });
    });
    await waitFor(() => expect(screen.getByText('2 episodes')).toBeTruthy());
    fireEvent.press(screen.getByTestId('season-1'));
    await waitFor(() => {
      expect(mockSeasonRequests).toContainEqual({
        titleId: 456,
        seasonNumber: 1,
        token: 'guest',
      });
    });
    expect(screen.queryByTestId('episode-check-9001')).toBeNull();

    await act(async () => {
      mockResolveSeasonByToken.guest?.({
        episodes: [{ ...accountEpisode, id: 9002, name: 'Guest episode', watched: false }],
      });
    });
    await waitFor(() => expect(screen.getByText('1. Guest episode')).toBeTruthy());
    expect(screen.queryByText('1/2 watched')).toBeNull();
    expect(screen.queryByTestId('episode-check-9002')).toBeNull();

    await screen.unmount();
    client.clear();
  });

  it('keeps title details available and explains sign-in outage instead of opening auth', async () => {
    mockAuth.current = { ...mockAuth.current, isAuthAvailable: false };
    const detail = await render(<TitleDetailScreen />);

    expect(detail.getByText('The selected movie')).toBeTruthy();
    expect(mockTitleFetch).toHaveBeenCalledWith(456);
    fireEvent.press(detail.getByTestId('watchlist-toggle'));

    expect(mockSignInUnavailable).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('wraps title actions instead of forcing them into one row', async () => {
    mockTitle.name = 'A deliberately long title that needs room to wrap';
    const detail = await render(<TitleDetailScreen />);

    expect(detail.getByText(mockTitle.name)).toBeTruthy();
    expect(detail.getByTestId('title-primary-actions').props.style).toEqual(
      expect.objectContaining({ flexWrap: 'wrap' }),
    );
    for (const testID of ['watchlist-toggle', 'watched-toggle']) {
      const action = detail.getByTestId(testID);
      expect(action.props.accessibilityRole).toBe('button');
      expect(action.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ minHeight: 44 }),
          expect.objectContaining({ flexShrink: 1, maxWidth: '100%' }),
        ]),
      );
    }
    expect(detail.getByText('Watchlist').props.allowFontScaling).not.toBe(false);
    expect(detail.getByText('Mark watched').props.allowFontScaling).not.toBe(false);
  });

  it.each([
    ['watchlist-toggle', 'Watchlist', mockAdd],
    ['watched-toggle', 'Mark watched', mockMark],
  ])('shows the unchanged %s state after returning authenticated, until the user taps it', async (action, initialLabel, mutation) => {
    mockAuth.current = { ...mockAuth.current, isLoaded: true, isSignedIn: true, userId: 'account-a' };
    const returned = await render(<TitleDetailScreen />);
    expect(mockTitleFetch).toHaveBeenLastCalledWith(456);
    expect(returned.getByText('The selected movie')).toBeTruthy();
    expect(returned.getByText(initialLabel)).toBeTruthy();
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockMark).not.toHaveBeenCalled();

    fireEvent.press(returned.getByTestId(action));
    expect(mutation).toHaveBeenCalledWith({ id: 456 });
  });

  it.each([
    {
      action: 'watchlist-toggle',
      saved: false,
      label: 'Watchlist',
      mutation: mockAdd,
    },
    {
      action: 'watchlist-toggle',
      saved: true,
      label: 'In Watchlist',
      mutation: mockRemove,
    },
    {
      action: 'watched-toggle',
      saved: false,
      label: 'Mark watched',
      mutation: mockMark,
    },
    {
      action: 'watched-toggle',
      saved: true,
      label: 'Watched',
      mutation: mockUnmark,
    },
  ])('keeps the saved $label state and allows retry after a failed $action', async ({
    action,
    saved,
    label,
    mutation,
  }) => {
    mockAuth.current = { ...mockAuth.current, isLoaded: true, isSignedIn: true, userId: 'account-a' };
    if (action === 'watchlist-toggle') mockTitle.inWatchlist = saved;
    else mockTitle.watched = saved;
    mutation.mockRejectedValueOnce(new Error('temporary network failure')).mockResolvedValueOnce(undefined);
    const detail = await render(<TitleDetailScreen />);

    fireEvent.press(detail.getByTestId(action));
    await waitFor(() => expect(mockMutationSettled).toBe(1));
    expect(detail.getByText(label)).toBeTruthy();
    expect(mutation).toHaveBeenCalledTimes(1);

    fireEvent.press(detail.getByTestId(action));
    await waitFor(() => expect(mockMutationSettled).toBe(2));
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation).toHaveBeenNthCalledWith(2, { id: 456 });
    expect(detail.getByText(label)).toBeTruthy();
  });

  it('explains the outage for safety actions without sending protected mutations', async () => {
    mockAuth.current = { ...mockAuth.current, isAuthAvailable: false };
    mockSafetyInfo.current = {
      preferredRating: null,
      summary: [],
      sources: [],
    };
    const detail = await render(<TitleDetailScreen />);

    fireEvent.press(detail.getByTestId('report-safety-btn'));
    fireEvent.press(detail.getByTestId('contribute-safety-btn'));

    expect(mockSignInUnavailable).toHaveBeenCalledTimes(2);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockCreateReport).not.toHaveBeenCalled();
    expect(mockCreateContribution).not.toHaveBeenCalled();
  });

  it('keeps title status and safety info matched when older requests resolve later', async () => {
    mockUseQueryForTitle.current = true;
    mockUseQueryForSafety.current = true;
    mockUseQueryForSimilar.current = true;
    mockAuth.current = { isLoaded: true, isSignedIn: true, isAuthAvailable: true, userId: 'account-a' };
    mockFetchTitle.mockImplementation((id: number) => new Promise((resolve) => {
      mockResolveTitleById[id] = resolve;
    }));
    mockFetchSimilarTitles.mockImplementation((id: number) => new Promise((resolve) => {
      mockResolveSimilarTitlesById[id] = resolve;
    }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const screen = await render(
      <QueryClientProvider client={client}>
        <TitleDetailScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mockTitleRequests).toContainEqual({ id: 456, token: 'session-account-a' });
      expect(mockResolveTitleById[456]).toEqual(expect.any(Function));
      expect(mockSimilarTitleRequests).toContain(456);
      expect(mockResolveSimilarTitlesById[456]).toEqual(expect.any(Function));
    });

    await act(async () => {
      mockSetRoute({ id: '789' });
    });

    expect(mockTitleFetch).toHaveBeenLastCalledWith(789);
    await waitFor(() => {
      expect(mockTitleRequests).toContainEqual({ id: 789, token: 'session-account-a' });
      expect(mockResolveTitleById[789]).toEqual(expect.any(Function));
      expect(mockSimilarTitleRequests).toContain(789);
      expect(mockResolveSimilarTitlesById[789]).toEqual(expect.any(Function));
    });

    await act(async () => {
      mockResolveSimilarTitlesById[789]?.([{ id: 2002, name: 'Suggestions for the newly selected title' }]);
    });
    await act(async () => {
      mockResolveTitleById[789]?.({
        ...mockTitle,
        id: 789,
        name: 'The newly selected title',
        inWatchlist: true,
        watched: false,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('The newly selected title')).toBeTruthy();
      expect(screen.getByText('Suggestions for the newly selected title')).toBeTruthy();
      expect(screen.getByText('In Watchlist')).toBeTruthy();
      expect(screen.getByText('Mark watched')).toBeTruthy();
      expect(mockSafetyRequests).toContain(789);
      expect(mockResolveSafetyById[789]).toEqual(expect.any(Function));
    });

    await act(async () => {
      mockResolveSimilarTitlesById[456]?.([{ ...mockSimilarTitle, name: 'Suggestions for the previously selected title' }]);
    });

    await waitFor(() => {
      expect(screen.getByText('Suggestions for the newly selected title')).toBeTruthy();
    });
    expect(screen.queryByText('Suggestions for the previously selected title')).toBeNull();

    await act(async () => {
      mockResolveTitleById[456]?.({
        ...mockTitle,
        id: 456,
        name: 'The previously selected title',
        inWatchlist: false,
        watched: true,
      });
    });

    await waitFor(() => expect(screen.getByText('The newly selected title')).toBeTruthy());
    expect(screen.queryByText('The previously selected title')).toBeNull();
    expect(screen.getByText('In Watchlist')).toBeTruthy();
    expect(screen.getByText('Mark watched')).toBeTruthy();
    fireEvent.press(screen.getByTestId('watchlist-toggle'));
    expect(mockRemove).toHaveBeenCalledWith({ id: 789 });
    expect(mockUnmark).not.toHaveBeenCalled();

    await act(async () => {
      mockSetRoute({ id: '456' });
    });
    await waitFor(() => {
      expect(mockSafetyRequests).toContain(456);
      expect(mockResolveSafetyById[456]).toEqual(expect.any(Function));
    });

    await act(async () => {
      mockResolveSafetyById[456]?.({
        preferredRating: null,
        summary: [{ category: 'Selected title caution', severity: 'moderate' }],
        sources: [],
      });
    });
    await waitFor(() => {
      expect(screen.getByText('Selected title caution')).toBeTruthy();
    });

    await act(async () => {
      mockResolveSafetyById[789]?.({
        preferredRating: null,
        summary: [{ category: 'Previous title caution', severity: 'severe' }],
        sources: [],
      });
    });

    expect(screen.getByText('Selected title caution')).toBeTruthy();
    expect(screen.queryByText('Previous title caution')).toBeNull();

    await screen.unmount();
    client.clear();
  });
});
