import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };
const mockRoute = { current: { id: '456' } };
const mockAuth = {
  current: { isSignedIn: false, isAuthAvailable: true, userId: null as string | null },
};
const mockUseQueryForTitle = { current: false };
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
const mockAdd = jest.fn();
const mockRemove = jest.fn();
const mockMark = jest.fn();
const mockUnmark = jest.fn();
const mockCreateReport = jest.fn();
const mockCreateContribution = jest.fn();
const mockTitleFetch = jest.fn();
const mockSignInUnavailable = jest.fn();
const mockSafetyInfo: { current: any } = { current: null };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockRoute.current,
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
  useGetSimilarTitles: () => ({ data: [] }),
  useGetTitleSafety: () => ({ data: mockSafetyInfo.current, isLoading: false }),
  useAddToWatchlist: () => ({ mutate: mockAdd, isPending: false }),
  useRemoveFromWatchlist: () => ({ mutate: mockRemove, isPending: false }),
  useMarkTitleWatched: () => ({ mutate: mockMark, isPending: false }),
  useUnmarkTitleWatched: () => ({ mutate: mockUnmark, isPending: false }),
  useCreateSafetyReport: () => ({ mutate: mockCreateReport, isPending: false }),
  useCreateSafetyContribution: () => ({
    mutate: mockCreateContribution,
    isPending: false,
  }),
}));
jest.mock('@/components/ui', () => ({
  SectionHeader: () => null,
  ErrorState: () => null,
  Loading: () => null,
  PosterCard: () => null,
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
    mockAuth.current = { isSignedIn: false, isAuthAvailable: true, userId: null };
    mockUseQueryForTitle.current = false;
    mockSession.token = 'session-account-a';
    mockTitleRequests.length = 0;
    mockFetchTitle.mockReset();
    Object.keys(mockResolveTitleByToken).forEach((token) => delete mockResolveTitleByToken[token]);
    mockRoute.current = { id: '456' };
    mockTitle.inWatchlist = false;
    mockTitle.watched = false;
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
    mockAuth.current = { isSignedIn: true, isAuthAvailable: true, userId: 'account-a' };
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
      mockAuth.current = { isSignedIn: true, isAuthAvailable: true, userId };
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

  it('clears account watch status immediately on sign-out while guest title data loads', async () => {
    mockUseQueryForTitle.current = true;
    mockAuth.current = { isSignedIn: true, isAuthAvailable: true, userId: 'account-a' };
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
    mockAuth.current = { isSignedIn: false, isAuthAvailable: true, userId: null };
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
    mockAuth.current = { ...mockAuth.current, isSignedIn: true };
    const returned = await render(<TitleDetailScreen />);
    expect(mockTitleFetch).toHaveBeenLastCalledWith(456);
    expect(returned.getByText('The selected movie')).toBeTruthy();
    expect(returned.getByText(initialLabel)).toBeTruthy();
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockMark).not.toHaveBeenCalled();

    fireEvent.press(returned.getByTestId(action));
    expect(mutation).toHaveBeenCalledWith({ id: 456 });
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
});