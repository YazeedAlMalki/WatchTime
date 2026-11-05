import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockAuth = {
  current: { isSignedIn: true, isAuthAvailable: true, userId: 'account-a' as string | null },
};
const mockWatchlists: Record<string, Array<{ id: number; name: string }>> = {
  'account-a': [{ id: 1, name: 'Account A title' }],
  'account-b': [{ id: 2, name: 'Account B title' }],
};
const mockWatchlistRequests: string[] = [];
const mockRemoveResolvers: Array<() => void> = [];
let mockRemoveOptions: { mutation?: Record<string, (...args: any[]) => unknown> } | undefined;
let mockQueryClient: QueryClient;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/lib/app-auth', () => ({
  useAppAuth: () => mockAuth.current,
  showSignInUnavailableMessage: jest.fn(),
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
  useQueryClient: () => mockQueryClient,
}));
jest.mock('@workspace/api-client-react', () => ({
  getGetMyWatchlistQueryKey: () => ['/api/me/watchlist'],
  getMyWatchlist: async () => {
    const accountId = mockAuth.current.userId ?? '';
    mockWatchlistRequests.push(accountId);
    return mockWatchlists[accountId] ?? [];
  },
  useRemoveFromWatchlist: (options: typeof mockRemoveOptions) => {
    mockRemoveOptions = options;
    const { useMutation: mockUseMutation } = jest.requireActual('@tanstack/react-query');
    return mockUseMutation({
      ...options?.mutation,
      mutationFn: () =>
        new Promise<void>((resolve) => {
          mockRemoveResolvers.push(resolve);
        }),
    });
  },
}));
jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    EmptyState: ({ title }: { title: string }) => <Text>{title}</Text>,
    ErrorState: () => <View />,
    Loading: () => <View testID="loading" />,
    PosterCard: ({ title }: { title: { name: string } }) => <Text>{title.name}</Text>,
  };
});
jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#ffffff',
    border: '#dddddd',
    card: '#f5f5f5',
    mutedForeground: '#777777',
    primary: '#6633cc',
    primaryForeground: '#ffffff',
  }),
}));
jest.mock('@/constants/colors', () => ({
  __esModule: true,
  default: { radius: 8 },
}));

import WatchlistScreen from '../app/(tabs)/watchlist';

describe('watchlist mutations during an account switch', () => {
  beforeEach(() => {
    mockAuth.current = { isSignedIn: true, isAuthAvailable: true, userId: 'account-a' };
    mockWatchlists['account-a'] = [{ id: 1, name: 'Account A title' }];
    mockWatchlists['account-b'] = [{ id: 2, name: 'Account B title' }];
    mockWatchlistRequests.length = 0;
    mockRemoveResolvers.length = 0;
    mockRemoveOptions = undefined;
    mockQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
  });

  afterEach(() => {
    cleanup();
    mockQueryClient.clear();
  });

  it('does not refresh account B for account A removal, and scopes B refreshes to B', async () => {
    const invalidate = jest.spyOn(mockQueryClient, 'invalidateQueries');
    const screen = await render(
      <QueryClientProvider client={mockQueryClient}>
        <WatchlistScreen />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('Account A title')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('remove-watchlist-1'));
    await waitFor(() => expect(mockRemoveResolvers).toHaveLength(1));

    mockAuth.current = { isSignedIn: true, isAuthAvailable: true, userId: 'account-b' };
    screen.rerender(
      <QueryClientProvider client={mockQueryClient}>
        <WatchlistScreen />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('Account B title')).toBeTruthy();
    });
    const requestsAfterSwitch = [...mockWatchlistRequests];
    expect(requestsAfterSwitch).toEqual(['account-a', 'account-b']);

    await act(async () => mockRemoveResolvers[0]());
    await waitFor(() => expect(screen.getByText('Account B title')).toBeTruthy());
    expect(screen.queryByText('Account A title')).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
    expect(mockWatchlistRequests).toEqual(requestsAfterSwitch);

    fireEvent.press(screen.getByTestId('remove-watchlist-2'));
    await waitFor(() => expect(mockRemoveResolvers).toHaveLength(2));
    mockWatchlists['account-b'] = [];
    await act(async () => mockRemoveResolvers[1]());

    await waitFor(() => {
      expect(screen.getByText('Watchlist is empty')).toBeTruthy();
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['/api/me/watchlist', 'account', 'account-b', 'infinite'],
    });
    expect(mockWatchlistRequests).toEqual(['account-a', 'account-b', 'account-b']);
  });
});
