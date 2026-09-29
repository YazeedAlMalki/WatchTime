import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockRouter = { push: jest.fn() };
const mockTrendingEnabled: boolean[] = [];
const mockPrivateQueryCalls: string[] = [];

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}));

jest.mock('@clerk/expo', () => ({
  useAuth: () => {
    throw new Error('The Clerk provider is unavailable in this test.');
  },
}));

jest.mock('@/lib/home-startup', () => ({
  startHomeStartup: (setStartupReady: (ready: boolean) => void) => {
    setStartupReady(true);
    return jest.fn();
  },
}));

jest.mock('@/lib/startup-metrics', () => ({
  markStartup: jest.fn(),
}));

jest.mock('@workspace/api-client-react', () => ({
  useGetTrendingTitles: (_params: unknown, options: any) => {
    mockTrendingEnabled.push(options?.query?.enabled);
    return {
      data: [{ id: 771, name: 'Public show while sign-in is down' }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
  },
  useGetMyShows: () => {
    mockPrivateQueryCalls.push('shows');
    return {};
  },
  useGetMyWatchlist: () => {
    mockPrivateQueryCalls.push('watchlist');
    return {};
  },
  useGetMyRecommendations: () => {
    mockPrivateQueryCalls.push('recommendations');
    return {};
  },
}));

jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Pressable, Text: NativeText, View } = require('react-native');

  return {
    EmptyState: () => <View />,
    ErrorState: ({ message }: { message: string }) => <NativeText>{message}</NativeText>,
    Loading: () => <View testID="loading" />,
    PosterCard: ({ title }: { title: { name: string } }) => <NativeText>{title.name}</NativeText>,
    SectionHeader: ({ title }: { title: string }) => <NativeText>{title}</NativeText>,
  };
});

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#ffffff',
    card: '#f5f5f5',
    foreground: '#111111',
    mutedForeground: '#777777',
    primary: '#6633cc',
    primaryForeground: '#ffffff',
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import HomeScreen from '../app/(tabs)/index';
import { AppAuthUnavailableProvider } from '../lib/app-auth';

describe('public browsing while authentication is unavailable', () => {
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockTrendingEnabled.length = 0;
    mockPrivateQueryCalls.length = 0;
  });

  it('loads public trending titles and keeps personal requests off in the unavailable auth context', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const screen = await render(
      <AppAuthUnavailableProvider>
        <HomeScreen />
      </AppAuthUnavailableProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Public show while sign-in is down')).toBeTruthy();
      expect(screen.getByText('Trending Now')).toBeTruthy();
    });

    expect(mockTrendingEnabled).toContain(true);
    expect(mockPrivateQueryCalls).toEqual([]);

    fireEvent.press(screen.getByTestId('landing-sign-in'));
    expect(alert).toHaveBeenCalledWith(
      'Sign-in unavailable',
      "WatchTime couldn't start its sign-in service. Check your connection and try again.",
    );
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});