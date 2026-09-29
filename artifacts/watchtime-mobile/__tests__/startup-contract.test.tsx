import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { InteractionManager, Pressable, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

const mockUseAuth = jest.fn();
const mockUseFonts = jest.fn();

let mockClerkProviderError: Error | null = null;
const mockStartupStateUpdates = jest.fn();
const mockRequestAnimationFrame = jest.fn();
const mockCancelAnimationFrame = jest.fn();

const mockCancelInteraction = jest.fn();
const mockMarkStartup = jest.fn();
const mockReportStartupFailure = jest.fn();
const mockSetBaseUrl = jest.fn();
const mockSetAuthTokenGetter = jest.fn();
const mockQueryEnabled = {
  shows: [] as boolean[],
  watchlist: [] as boolean[],
  recommendations: [] as boolean[],
  trending: [] as boolean[],
};

jest.mock('@/lib/home-startup', () => {
  const actual = jest.requireActual('@/lib/home-startup');
  return {
    ...actual,
    startHomeStartup: (setStartupReady: (ready: boolean) => void) =>
      actual.startHomeStartup((ready: boolean) => {
        mockStartupStateUpdates(ready);
        setStartupReady(ready);
      }),
  };
});
const mockTrendingQueryState: { current: Record<string, any> } = {
  current: {
    data: [],
    dataUpdatedAt: 0,
    isError: false,
    isLoading: false,
    isRefetching: false,
  },
};
const mockTrendingRefetch = jest.fn();

jest.mock('@clerk/expo', () => {
  const React = require('react');

  return {
    ClerkProvider: ({ children }: any) => {
      if (mockClerkProviderError) throw mockClerkProviderError;
      return children;
    },
    ClerkLoaded: () => null,
    useAuth: (...args: any[]) => mockUseAuth(...args),
  };
});


jest.mock('@clerk/expo/token-cache', () => ({
  tokenCache: {},
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    removeItem: jest.fn(() => Promise.resolve()),
    setItem: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('@/lib/app-auth', () => ({
  AppAuthProvider: ({ children }: any) => children,
  useAppAuth: () => {
    const auth = mockUseAuth();
    return {
      isLoaded: auth.isLoaded,
      isSignedIn: !!auth.isSignedIn,
      isDemoSignedIn: false,
      activateDemo: jest.fn(),
      clearDemo: jest.fn(),
    };
  },
}));

jest.mock('@expo-google-fonts/inter', () => ({
  Inter_400Regular: {},
  Inter_500Medium: {},
  Inter_600SemiBold: {},
  Inter_700Bold: {},
  useFonts: (...args: any[]) => mockUseFonts(...args),
}));

jest.mock('expo-splash-screen', () => ({
  hideAsync: jest.fn(() => Promise.resolve()),
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-router', () => {
  const React = require('react');

  const { View } = require('react-native');

  const Stack: any = ({ children }: any) => (
    <View testID="root-navigation">{children}</View>
  );
  Stack.Screen = () => null;

  return {
    Stack,
    useRouter: () => ({ push: jest.fn() }),
  };
});

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  return {
    GestureHandlerRootView: ({ children }: any) => children,
  };
});

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardProvider: ({ children }: any) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@tanstack/react-query', () => {
  const React = require('react');

  class QueryClient {}

  return {
    QueryClient,
    QueryClientProvider: ({ children }: any) => children,
    useQueryClient: () => ({}),
  };
});

jest.mock('@workspace/api-client-react', () => ({
  setBaseUrl: (...args: any[]) => mockSetBaseUrl(...args),
  setAuthTokenGetter: (...args: any[]) => mockSetAuthTokenGetter(...args),
  useGetMyShows: (_params: any, options: any) => {
    mockQueryEnabled.shows.push(options?.query?.enabled);
    return { data: [], dataUpdatedAt: 0, isError: false, isLoading: false, isRefetching: false, refetch: jest.fn() };
  },
  useGetMyWatchlist: (_params: any, options: any) => {
    mockQueryEnabled.watchlist.push(options?.query?.enabled);
    return { data: [], dataUpdatedAt: 0, isError: false, isLoading: false, isRefetching: false, refetch: jest.fn() };
  },
  useGetMyRecommendations: (options: any) => {
    mockQueryEnabled.recommendations.push(options?.query?.enabled);
    return { data: [], dataUpdatedAt: 0, isError: false, isLoading: false, isRefetching: false, refetch: jest.fn() };
  },
  useGetTrendingTitles: (_params: any, options: any) => {
    mockQueryEnabled.trending.push(options?.query?.enabled);
    return {
      ...mockTrendingQueryState.current,
      refetch: mockTrendingRefetch,
    };
  },
  useMarkEpisodeWatched: () => ({ isPending: false, mutate: jest.fn() }),
  getGetMyShowsQueryKey: () => ['/api/me/shows'],
  getGetMyRecommendationsQueryKey: () => ['/api/me/recommendations'],
  getGetTitleQueryKey: (id: number) => [`/api/titles/${id}`],
}));

jest.mock('@/components/ErrorBoundary', () =>
  jest.requireActual('@/components/ErrorBoundary'),
);

jest.mock('@/components/ui', () => {
  const React = require('react');

  const { Pressable, Text, View } = require('react-native');
  return {
    EmptyState: () => <View />,
    ErrorState: ({ message = "Couldn't load data", onRetry }: any) => (
      <View>
        <Text>{message}</Text>
        <Pressable testID="retry-button" onPress={onRetry}>
          <Text>Retry</Text>
        </Pressable>
      </View>
    ),
    Loading: () => <View testID="loading" />,
    PosterCard: ({ title }: any) => <Text>{title.name}</Text>,
    SectionHeader: ({ title }: any) => <Text>{title}</Text>,
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
  markStartup: (...args: any[]) => mockMarkStartup(...args),
  reportStartupFailure: (...args: any[]) => mockReportStartupFailure(...args),
}));

import RootLayout from '../app/_layout';
import HomeScreen from '../app/(tabs)/index';

describe('mobile startup contracts', () => {
  let pendingInteractions: Array<() => void> = [];
  let pendingFrames: Array<(time: number) => void> = [];

  beforeEach(() => {
    mockClerkProviderError = null;
    mockUseFonts.mockReset().mockReturnValue([true, null]);
    mockUseAuth.mockReset().mockReturnValue({
      getToken: jest.fn(),
      isLoaded: true,
      isSignedIn: true,
    });
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((task?: any) => {
      if (typeof task === 'function') {
        pendingInteractions.push(task);
      }
      return { cancel: mockCancelInteraction } as any;
    });
    mockRequestAnimationFrame.mockImplementation((callback: (time: number) => void) => {
      pendingFrames.push(callback);
      return 1;
    });

    Object.assign(globalThis, {
      requestAnimationFrame: mockRequestAnimationFrame,
      cancelAnimationFrame: mockCancelAnimationFrame,
    });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    pendingInteractions = [];
    pendingFrames = [];
    mockQueryEnabled.shows.length = 0;
    mockQueryEnabled.watchlist.length = 0;
    mockQueryEnabled.recommendations.length = 0;
    mockQueryEnabled.trending.length = 0;
    mockTrendingQueryState.current = {
      data: [],
      dataUpdatedAt: 0,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
    mockTrendingRefetch.mockReset();
    jest.clearAllMocks();
  });

  it('renders root navigation without waiting for ClerkLoaded', async () => {
    const { getByTestId } = await render(<RootLayout />);

    expect(getByTestId('root-navigation')).toBeTruthy();
  });

  it('shows a retryable recovery state when Clerk initialization fails', async () => {
    mockClerkProviderError = new Error('Clerk initialization failed');
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const { getByTestId, getByText, queryByTestId } = await render(
      <RootLayout />,
    );

    expect(getByTestId('auth-provider-failure')).toBeTruthy();
    expect(getByText('Sign-in unavailable')).toBeTruthy();
    expect(
      getByText(
        "WatchTime couldn't start its sign-in service. Check your connection and try again.",
      ),
    ).toBeTruthy();
    expect(queryByTestId('root-navigation')).toBeNull();
    expect(mockMarkStartup).toHaveBeenCalledWith('auth-provider-error', {
      error: 'Clerk initialization failed',
    });

    mockClerkProviderError = null;
    await act(async () => {
      fireEvent.press(getByTestId('retry-auth-provider'));
    });

    await waitFor(() => {
      expect(getByTestId('root-navigation')).toBeTruthy();
    });
  });

  it('hides the splash screen and renders root navigation when fonts fail to load', async () => {
    const fontError = new Error('font loading failed');
    mockUseFonts.mockReturnValue([false, fontError]);

    const { getByTestId } = await render(<RootLayout />);

    expect(getByTestId('root-navigation')).toBeTruthy();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(mockMarkStartup).toHaveBeenCalledWith('font-error');
    expect(mockReportStartupFailure).toHaveBeenCalledWith('font-error');
  });

  it('keeps root navigation mounted when splash screen cleanup fails', async () => {
    const splashError = new Error('splash cleanup failed');
    jest.mocked(SplashScreen.hideAsync).mockRejectedValueOnce(splashError);

    const { getByTestId } = await render(<RootLayout />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId('root-navigation')).toBeTruthy();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(mockMarkStartup).toHaveBeenCalledWith('splash-recovery-error', {
      error: 'splash cleanup failed',
    });
    expect(mockReportStartupFailure).toHaveBeenCalledWith('splash-hide-error');
  });

  it('keeps root navigation mounted when splash setup fails', async () => {
    jest.isolateModules(() => {
      jest.doMock('expo-splash-screen', () => ({
        hideAsync: jest.fn(() => Promise.resolve()),
        preventAutoHideAsync: jest.fn(() =>
          Promise.reject(new Error('splash setup failed')),
        ),
      }));
      require('../app/_layout');
    });

    await act(async () => {
      await Promise.resolve();
    });

    const { getByTestId } = await render(<RootLayout />);

    expect(getByTestId('root-navigation')).toBeTruthy();
  });

  it('reports synchronous splash cleanup throws and keeps root navigation mounted', async () => {
    const splashError = new Error('splash cleanup threw synchronously');
    jest.mocked(SplashScreen.hideAsync).mockImplementationOnce(() => {
      throw splashError;
    });

    const { getByTestId } = await render(<RootLayout />);

    expect(getByTestId('root-navigation')).toBeTruthy();
  });

  it('reports synchronous splash setup throws and keeps root navigation mounted', async () => {
    jest.doMock('react', () => mockReact);
    jest.doMock('expo-splash-screen', () => ({
      hideAsync: jest.fn(() => Promise.resolve()),
      preventAutoHideAsync: jest.fn(() => {
        throw new Error('splash setup threw synchronously');
      }),
    }));
    jest.resetModules();
    require('../app/_layout');

    expect(mockMarkStartup).toHaveBeenCalledWith('splash-setup-error', {
      error: 'splash setup threw synchronously',
    });
    expect(mockReportStartupFailure).toHaveBeenCalledWith('splash-prevent-error');

    const { getByTestId } = await render(<RootLayout />);
    expect(getByTestId('root-navigation')).toBeTruthy();
  });

  it('keeps home data quiet while Clerk auth is loading, then loads the ready branch', async () => {
    mockUseAuth.mockReturnValue({ getToken: jest.fn(), isLoaded: false, isSignedIn: undefined });

    const screen = await render(<HomeScreen />);

    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(mockQueryEnabled.shows).toEqual([]);
    expect(mockQueryEnabled.watchlist).toEqual([]);
    expect(mockQueryEnabled.recommendations).toEqual([]);
    expect(mockQueryEnabled.trending).toEqual([]);

    mockUseAuth.mockReturnValue({ getToken: jest.fn(), isLoaded: true, isSignedIn: true });

    await act(async () => {
      screen.rerender(<HomeScreen />);
    });

    expect(mockQueryEnabled.shows).toEqual([false]);
    expect(mockQueryEnabled.watchlist).toEqual([false]);
    expect(mockQueryEnabled.recommendations).toEqual([false]);
    expect(mockQueryEnabled.trending).toEqual([]);

    await act(async () => {
      pendingInteractions[0]?.();
    });
    await act(async () => {
      pendingFrames[0]?.(0);
    });

    await waitFor(() => {
      expect(mockQueryEnabled.shows.at(-1)).toBe(true);
      expect(mockQueryEnabled.watchlist.at(-1)).toBe(true);
      expect(mockQueryEnabled.recommendations.at(-1)).toBe(true);
    });
  });

  it('keeps signed-in home queries disabled until the post-first-frame gate opens', async () => {
    await render(<HomeScreen />);

    expect(InteractionManager.runAfterInteractions).toHaveBeenCalledTimes(1);
    expect(mockQueryEnabled.shows).toEqual([false]);
    expect(mockQueryEnabled.watchlist).toEqual([false]);
    expect(mockQueryEnabled.recommendations).toEqual([false]);

    await act(async () => {
      pendingInteractions[0]?.();
    });

    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(mockQueryEnabled.shows).toEqual([false]);
    expect(mockQueryEnabled.watchlist).toEqual([false]);
    expect(mockQueryEnabled.recommendations).toEqual([false]);

    await act(async () => {
      pendingFrames[0]?.(0);
    });

    await waitFor(() => {
      expect(mockQueryEnabled.shows.at(-1)).toBe(true);
      expect(mockQueryEnabled.watchlist.at(-1)).toBe(true);
      expect(mockQueryEnabled.recommendations.at(-1)).toBe(true);
    });
  });

  it('does not enable remounted signed-in home queries from a stale startup frame', async () => {
    mockUseAuth.mockReturnValue({ getToken: jest.fn(), isLoaded: true, isSignedIn: true });
    const firstHome = await render(<HomeScreen />);

    expect(mockQueryEnabled.shows).toEqual([false]);
    expect(mockQueryEnabled.watchlist).toEqual([false]);
    expect(mockQueryEnabled.recommendations).toEqual([false]);

    await act(async () => {
      pendingInteractions[0]?.();
    });

    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstHome.unmount();
    });
    const secondHome = await render(<HomeScreen />);

    expect(InteractionManager.runAfterInteractions).toHaveBeenCalledTimes(2);
    expect(mockQueryEnabled.shows).toEqual([false, false]);
    expect(mockQueryEnabled.watchlist).toEqual([false, false]);
    expect(mockQueryEnabled.recommendations).toEqual([false, false]);

    await act(async () => {
      pendingFrames[0]?.(0);
    });

    expect(mockQueryEnabled.shows).toEqual([false, false]);
    expect(mockQueryEnabled.watchlist).toEqual([false, false]);
    expect(mockQueryEnabled.recommendations).toEqual([false, false]);

    await act(async () => {
      pendingInteractions[1]?.();
    });

    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(mockQueryEnabled.shows).toEqual([false, false]);
    expect(mockQueryEnabled.watchlist).toEqual([false, false]);
    expect(mockQueryEnabled.recommendations).toEqual([false, false]);

    await act(async () => {
      pendingFrames[1]?.(0);
    });

    await waitFor(() => {
      expect(mockQueryEnabled.shows).toEqual([false, false, true]);
      expect(mockQueryEnabled.watchlist).toEqual([false, false, true]);
      expect(mockQueryEnabled.recommendations).toEqual([false, false, true]);
    });

    await act(async () => {
      secondHome.unmount();
    });
  });

  it('keeps signed-out trending disabled until the post-first-frame gate opens', async () => {
    mockUseAuth.mockReturnValue({ getToken: jest.fn(), isLoaded: true, isSignedIn: false });

    await render(<HomeScreen />);

    expect(InteractionManager.runAfterInteractions).toHaveBeenCalledTimes(1);
    expect(mockQueryEnabled.trending).toEqual([false]);

    await act(async () => {
      pendingInteractions[0]?.();
    });

    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(mockQueryEnabled.trending).toEqual([false]);

    await act(async () => {
      pendingFrames[0]?.(0);
    });

    await waitFor(() => {
      expect(mockQueryEnabled.trending.at(-1)).toBe(true);
    });
  });

  it('switches from signed-out trending to signed-in feeds when auth changes in place', async () => {
    mockUseAuth.mockReturnValue({ getToken: jest.fn(), isLoaded: true, isSignedIn: false });
    mockTrendingQueryState.current = {
      data: [{ id: 91, name: 'Public trending title' }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };

    const screen = await render(<HomeScreen />);

    expect(mockQueryEnabled.trending).toEqual([false]);
    expect(mockQueryEnabled.shows).toEqual([]);
    expect(mockQueryEnabled.watchlist).toEqual([]);
    expect(mockQueryEnabled.recommendations).toEqual([]);

    await act(async () => {
      pendingInteractions[0]?.();
    });
    await act(async () => {
      pendingFrames[0]?.(0);
    });

    await waitFor(() => {
      expect(screen.getByText('Public trending title')).toBeTruthy();
      expect(mockQueryEnabled.trending).toEqual([false, true]);
    });
    expect(screen.getByText('Trending Now')).toBeTruthy();

    mockUseAuth.mockReturnValue({ getToken: jest.fn(), isLoaded: true, isSignedIn: true });
    await act(async () => {
      screen.rerender(<HomeScreen />);
    });

    expect(screen.queryByText('Track your shows.')).toBeNull();
    expect(screen.queryByText('Trending Now')).toBeNull();
    expect(screen.queryByText('Public trending title')).toBeNull();
    expect(screen.getByText('Up Next')).toBeTruthy();
    expect(screen.getByText('Your Watchlist')).toBeTruthy();
    expect(mockQueryEnabled.shows).toEqual([true]);
    expect(mockQueryEnabled.watchlist).toEqual([true]);
    expect(mockQueryEnabled.recommendations).toEqual([true]);
    expect(mockQueryEnabled.trending).toEqual([false, true]);

    await act(async () => {
      screen.unmount();
    });
  });

  it('does not update startup state or enable feeds when callbacks fire after unmount', async () => {
    const home = await render(<HomeScreen />);

    expect(mockQueryEnabled.shows).toEqual([false]);
    expect(mockQueryEnabled.watchlist).toEqual([false]);
    expect(mockQueryEnabled.recommendations).toEqual([false]);

    await act(async () => {
      pendingInteractions[0]?.();
    });

    expect(pendingFrames).toHaveLength(1);
    const scheduledFrameCount = mockRequestAnimationFrame.mock.calls.length;
    await act(async () => {
      home.unmount();
    });

    expect(mockCancelInteraction).toHaveBeenCalled();
    mockStartupStateUpdates.mockClear();
    await act(async () => {
      pendingInteractions[0]?.();
    });
    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(scheduledFrameCount);
    expect(mockStartupStateUpdates).not.toHaveBeenCalled();

    await act(async () => {
      pendingFrames[0]?.(0);
    });

    expect(mockStartupStateUpdates).not.toHaveBeenCalled();
    expect(mockQueryEnabled.shows).toEqual([false]);
    expect(mockQueryEnabled.watchlist).toEqual([false]);
    expect(mockQueryEnabled.recommendations).toEqual([false]);
    expect(mockQueryEnabled.trending).toEqual([]);
  });

  it('keeps the signed-out home usable through a slow feed, failure, retry, and recovery', async () => {
    mockUseAuth.mockReturnValue({ getToken: jest.fn(), isLoaded: true, isSignedIn: false });
    mockTrendingQueryState.current = {
      data: undefined,
      dataUpdatedAt: 0,
      isError: false,
      isLoading: true,
      isRefetching: false,
    };

    const screen = await render(<HomeScreen />);

    await act(async () => {
      pendingInteractions[0]?.();
    });
    await act(async () => {
      pendingFrames[0]?.(0);
    });

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
    await act(async () => {
      screen.rerender(<HomeScreen />);
    });

    expect(screen.getByText("Couldn't load trending titles")).toBeTruthy();
    expect(screen.getByTestId('retry-button')).toBeTruthy();
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
    await act(async () => {
      screen.rerender(<HomeScreen />);
    });

    expect(screen.getByText('Track your shows.')).toBeTruthy();
    expect(screen.getByText('Recovered trending title')).toBeTruthy();
    expect(mockMarkStartup).toHaveBeenCalledWith('trending-loaded');

    await act(async () => {
      screen.unmount();
    });
  });

});

const mockReact = React;
