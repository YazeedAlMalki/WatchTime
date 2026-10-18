import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

const mockUseAuth = jest.fn();
const mockUseFonts = jest.fn();

let mockClerkProviderError: Error | null = null;
const mockStartupStateUpdates = jest.fn();
const mockRequestAnimationFrame = jest.fn();
const mockCancelAnimationFrame = jest.fn();

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
const mockSignedInHomeQueryState = {
  shows: { current: { data: [] as any[], dataUpdatedAt: 0, isError: false, isLoading: false, isRefetching: false } },
  watchlist: { current: { data: [] as any[], dataUpdatedAt: 0, isError: false, isLoading: false, isRefetching: false } },
  recommendations: { current: { data: [] as any[], dataUpdatedAt: 0, isError: false, isLoading: false, isRefetching: false } },
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

jest.mock('@/lib/dev-demo-session', () => ({
  getDevDemoToken: jest.fn(() => Promise.resolve(null)),
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
  AppAuthUnavailableProvider: ({ children }: any) => children,
  AppAuthProvider: ({ children }: any) => children,
  useAppAuth: () => {
    const auth = mockUseAuth();
    return {
      isLoaded: auth.isLoaded,
      isSignedIn: !!auth.isSignedIn,
      isAuthAvailable: auth.isAuthAvailable ?? true,
      userId: auth.userId ?? (auth.isSignedIn ? 'startup-contract-user' : null),
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
  hide: jest.fn(),
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
    return { ...mockSignedInHomeQueryState.shows.current, refetch: jest.fn() };
  },
  useGetMyWatchlist: (_params: any, options: any) => {
    mockQueryEnabled.watchlist.push(options?.query?.enabled);
    return { ...mockSignedInHomeQueryState.watchlist.current, refetch: jest.fn() };
  },
  useGetMyRecommendations: (options: any) => {
    mockQueryEnabled.recommendations.push(options?.query?.enabled);
    return { ...mockSignedInHomeQueryState.recommendations.current, refetch: jest.fn() };
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
  getGetMyWatchlistQueryKey: () => ['/api/me/watchlist'],
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
  let pendingFrames: Array<(time: number) => void> = [];

  beforeEach(() => {
    mockClerkProviderError = null;
    mockUseFonts.mockReset().mockReturnValue([true, null]);
    mockUseAuth.mockReset().mockReturnValue({
      getToken: jest.fn(),
      isLoaded: true,
      isSignedIn: true,
      userId: 'startup-contract-user',
    });
    mockRequestAnimationFrame.mockImplementation((callback: (time: number) => void) => {
      pendingFrames.push(callback);
      return pendingFrames.length;
    });

    Object.assign(globalThis, {
      requestAnimationFrame: mockRequestAnimationFrame,
      cancelAnimationFrame: mockCancelAnimationFrame,
    });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    jest.useRealTimers();
    pendingFrames = [];
    mockQueryEnabled.shows.length = 0;
    mockQueryEnabled.watchlist.length = 0;
    mockQueryEnabled.recommendations.length = 0;
    mockQueryEnabled.trending.length = 0;
    mockSignedInHomeQueryState.shows.current = {
      data: [],
      dataUpdatedAt: 0,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
    mockSignedInHomeQueryState.watchlist.current = {
      data: [],
      dataUpdatedAt: 0,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
    mockSignedInHomeQueryState.recommendations.current = {
      data: [],
      dataUpdatedAt: 0,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
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

  it('keeps generated API requests connected to the current Clerk session token', async () => {
    const activeSession = { token: 'clerk-session-account-a' };
    const getToken = jest.fn(async () => activeSession.token);
    mockUseAuth.mockReturnValue({
      getToken,
      isLoaded: true,
      isSignedIn: true,
      userId: 'account-a',
    });

    await render(<RootLayout />);

    await waitFor(() => {
      expect(mockSetAuthTokenGetter).toHaveBeenCalledWith(expect.any(Function));
    });
    const tokenGetter = mockSetAuthTokenGetter.mock.calls
      .map(([getter]) => getter)
      .filter((getter) => typeof getter === 'function')
      .at(-1);

    await expect(tokenGetter()).resolves.toBe('clerk-session-account-a');

    activeSession.token = 'clerk-session-account-b';
    await expect(tokenGetter()).resolves.toBe('clerk-session-account-b');
    expect(getToken).toHaveBeenCalledTimes(2);
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
        "WatchTime couldn't start its sign-in service. You can still browse public shows. Check your connection and retry sign-in setup.",
      ),
    ).toBeTruthy();
    expect(queryByTestId('root-navigation')).toBeTruthy();
    expect(mockMarkStartup).toHaveBeenCalledWith('auth-provider-error', {
      error: 'Clerk initialization failed',
    });
    expect(mockReportStartupFailure.mock.calls).toEqual([['auth-provider-error']]);

    mockClerkProviderError = null;
    await act(async () => {
      fireEvent.press(getByTestId('retry-auth-provider'));
    });

    await waitFor(() => {
      expect(getByTestId('root-navigation')).toBeTruthy();
      expect(queryByTestId('auth-provider-failure')).toBeNull();
    });
  });

  it('keeps the splash gate while fonts are loading and opens navigation when ready', async () => {
    mockUseFonts.mockReturnValue([false, null]);

    const screen = await render(<RootLayout />);

    expect(screen.queryByTestId('root-navigation')).toBeNull();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();

    mockUseFonts.mockReturnValue([true, null]);
    await act(async () => {
      screen.rerender(<RootLayout />);
    });

    expect(screen.getByTestId('root-navigation')).toBeTruthy();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(mockMarkStartup).toHaveBeenCalledWith('fonts-ready');
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

  it('reports a synchronous font-loader throw and keeps root navigation available', async () => {
    const fontError = new Error('font loader threw synchronously');
    mockUseFonts.mockImplementation(() => {
      throw fontError;
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const { getByTestId } = await render(<RootLayout />);

    expect(getByTestId('root-navigation')).toBeTruthy();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(mockMarkStartup).toHaveBeenCalledWith('font-error', {
      error: 'font loader threw synchronously',
      source: 'font-loader-throw',
    });
    expect(mockReportStartupFailure).toHaveBeenCalledWith('font-error');
  });

  it('keeps root navigation mounted when splash cleanup fails', async () => {
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

  it('falls back to synchronous splash hiding when hideAsync never settles', async () => {
    jest.useFakeTimers();
    jest.mocked(SplashScreen.hideAsync).mockImplementationOnce(
      () => new Promise<void>(() => {}),
    );

    try {
      const { getByTestId } = await render(<RootLayout />);

      expect(getByTestId('root-navigation')).toBeTruthy();
      expect(SplashScreen.hide).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(5_000);
      });

      expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
      expect(mockMarkStartup).toHaveBeenCalledWith('splash-hide-timeout', {
        timeoutMs: 5_000,
      });
      expect(mockReportStartupFailure).toHaveBeenCalledWith('splash-hide-timeout');
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps root navigation mounted when splash setup fails', async () => {
    jest.doMock('react', () => mockReact);
    jest.doMock('expo-splash-screen', () => ({
      hide: jest.fn(),
      hideAsync: jest.fn(() => Promise.resolve()),
      preventAutoHideAsync: jest.fn(() =>
        Promise.reject(new Error('splash setup failed')),
      ),
    }));
    jest.resetModules();
    require('../app/_layout');

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
    expect(mockMarkStartup).toHaveBeenCalledWith('splash-recovery-error', {
      error: 'splash cleanup threw synchronously',
    });
    expect(mockReportStartupFailure).toHaveBeenCalledWith('splash-hide-error');
  });

  it('reports synchronous splash setup throws and keeps root navigation mounted', async () => {
    jest.doMock('react', () => mockReact);
    jest.doMock('expo-splash-screen', () => ({
      hide: jest.fn(),
      hideAsync: jest.fn(() => Promise.resolve()),
      preventAutoHideAsync: () => {
        throw new Error('splash setup threw synchronously');
      },
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

    await act(async () => {
      pendingFrames[0]?.(0);
    });
    await act(async () => {
      pendingFrames[1]?.(0);
    });

    await waitFor(() => {
      expect(mockQueryEnabled.shows.at(-1)).toBe(true);
      expect(mockQueryEnabled.watchlist.at(-1)).toBe(true);
      expect(mockQueryEnabled.recommendations.at(-1)).toBe(true);
    });
  });

  it('keeps signed-in home queries disabled until the post-first-frame gate opens', async () => {
    await render(<HomeScreen />);

    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(mockQueryEnabled.shows).toEqual([false]);
    expect(mockQueryEnabled.watchlist).toEqual([false]);
    expect(mockQueryEnabled.recommendations).toEqual([false]);

    await act(async () => {
      pendingFrames[0]?.(0);
    });

    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(mockQueryEnabled.shows).toEqual([false]);
    expect(mockQueryEnabled.watchlist).toEqual([false]);
    expect(mockQueryEnabled.recommendations).toEqual([false]);

    await act(async () => {
      pendingFrames[1]?.(0);
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

    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(1);
    await act(async () => {
      pendingFrames[0]?.(0);
    });
    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(2);

    await act(async () => {
      firstHome.unmount();
    });
    const secondHome = await render(<HomeScreen />);

    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(3);
    expect(mockQueryEnabled.shows).toEqual([false, false]);
    expect(mockQueryEnabled.watchlist).toEqual([false, false]);
    expect(mockQueryEnabled.recommendations).toEqual([false, false]);

    await act(async () => {
      pendingFrames[1]?.(0);
    });

    expect(mockQueryEnabled.shows).toEqual([false, false]);
    expect(mockQueryEnabled.watchlist).toEqual([false, false]);
    expect(mockQueryEnabled.recommendations).toEqual([false, false]);

    await act(async () => {
      pendingFrames[2]?.(0);
    });

    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(4);
    expect(mockQueryEnabled.shows).toEqual([false, false]);
    expect(mockQueryEnabled.watchlist).toEqual([false, false]);
    expect(mockQueryEnabled.recommendations).toEqual([false, false]);

    await act(async () => {
      pendingFrames[3]?.(0);
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

    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(mockQueryEnabled.trending).toEqual([false]);

    await act(async () => {
      pendingFrames[0]?.(0);
    });

    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(mockQueryEnabled.trending).toEqual([false]);

    await act(async () => {
      pendingFrames[1]?.(0);
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

    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(mockQueryEnabled.trending).toEqual([false]);
    expect(mockQueryEnabled.shows).toEqual([]);
    expect(mockQueryEnabled.watchlist).toEqual([]);
    expect(mockQueryEnabled.recommendations).toEqual([]);

    await act(async () => {
      pendingFrames[0]?.(0);
    });

    await act(async () => {
      pendingFrames[1]?.(0);
    });

    await waitFor(() => {
      expect(mockQueryEnabled.trending).toEqual([false, true]);
      expect(screen.getByText('Public trending title')).toBeTruthy();
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

  it('hides signed-in home content while Clerk rechecks auth, then restores it in place', async () => {
    mockUseAuth.mockReturnValue({
      getToken: jest.fn(),
      isLoaded: true,
      isSignedIn: true,
      userId: 'reload-contract-user',
    });
    mockSignedInHomeQueryState.shows.current = {
      data: [{
        title: { id: 911, name: 'Reload tracked show' },
        nextEpisode: {
          id: 9111,
          seasonNumber: 2,
          episodeNumber: 3,
          name: 'Reload next episode',
        },
        watchedEpisodes: 2,
        totalEpisodes: 10,
      }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
    mockSignedInHomeQueryState.watchlist.current = {
      data: [{ id: 912, name: 'Reload watchlist title' }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
    mockSignedInHomeQueryState.recommendations.current = {
      data: [{
        reason: 'Because you watched Reload tracked show',
        titles: [{ id: 913, name: 'Reload recommendation' }],
      }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };

    const screen = await render(<HomeScreen />);

    await act(async () => {
      pendingFrames[0]?.(0);
    });
    await act(async () => {
      pendingFrames[1]?.(0);
    });

    expect(screen.getByText('Reload tracked show')).toBeTruthy();
    expect(screen.getByText(/Reload next episode/)).toBeTruthy();
    expect(screen.getByText('Reload watchlist title')).toBeTruthy();
    expect(screen.getByText('Reload recommendation')).toBeTruthy();
    expect(screen.getByText('Up Next')).toBeTruthy();
    expect(screen.getByText('Your Watchlist')).toBeTruthy();

    mockUseAuth.mockReturnValue({
      getToken: jest.fn(),
      isLoaded: false,
      isSignedIn: true,
      userId: 'reload-contract-user',
    });
    await act(async () => {
      screen.rerender(<HomeScreen />);
    });

    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(screen.queryByText('Reload tracked show')).toBeNull();
    expect(screen.queryByText(/Reload next episode/)).toBeNull();
    expect(screen.queryByText('Reload watchlist title')).toBeNull();
    expect(screen.queryByText('Reload recommendation')).toBeNull();
    expect(screen.queryByText('Up Next')).toBeNull();
    expect(screen.queryByText('Your Watchlist')).toBeNull();
    expect(screen.queryByText('Track your shows.')).toBeNull();
    expect(mockQueryEnabled.trending).toEqual([]);

    mockUseAuth.mockReturnValue({
      getToken: jest.fn(),
      isLoaded: true,
      isSignedIn: true,
      userId: 'reload-contract-user',
    });
    await act(async () => {
      screen.rerender(<HomeScreen />);
    });

    expect(screen.getByText('Reload tracked show')).toBeTruthy();
    expect(screen.getByText(/Reload next episode/)).toBeTruthy();
    expect(screen.getByText('Reload watchlist title')).toBeTruthy();
    expect(screen.getByText('Reload recommendation')).toBeTruthy();
    expect(screen.getByText('Up Next')).toBeTruthy();
    expect(screen.getByText('Your Watchlist')).toBeTruthy();
    expect(mockQueryEnabled.shows.at(-1)).toBe(true);
    expect(mockQueryEnabled.watchlist.at(-1)).toBe(true);
    expect(mockQueryEnabled.recommendations.at(-1)).toBe(true);
    expect(mockQueryEnabled.trending).toEqual([]);

    await act(async () => {
      screen.unmount();
    });
  });

  it('keeps personal home content hidden when Clerk rechecks auth and resolves signed out', async () => {
    mockUseAuth.mockReturnValue({
      getToken: jest.fn(),
      isLoaded: true,
      isSignedIn: true,
      userId: 'signed-out-recheck-user',
    });
    mockSignedInHomeQueryState.shows.current = {
      data: [{
        title: { id: 921, name: 'Recheck tracked show' },
        nextEpisode: {
          id: 9211,
          seasonNumber: 3,
          episodeNumber: 4,
          name: 'Recheck next episode',
        },
        watchedEpisodes: 3,
        totalEpisodes: 12,
      }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
    mockSignedInHomeQueryState.watchlist.current = {
      data: [{ id: 922, name: 'Recheck watchlist title' }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
    mockSignedInHomeQueryState.recommendations.current = {
      data: [{
        reason: 'Because you watched Recheck tracked show',
        titles: [{ id: 923, name: 'Recheck recommendation' }],
      }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };

    const screen = await render(<HomeScreen />);
    await act(async () => {
      pendingFrames[0]?.(0);
    });
    await act(async () => {
      pendingFrames[1]?.(0);
    });

    expect(screen.getByText('Recheck tracked show')).toBeTruthy();
    expect(screen.getByText(/Recheck next episode/)).toBeTruthy();
    expect(screen.getByText('Recheck watchlist title')).toBeTruthy();
    expect(screen.getByText('Recheck recommendation')).toBeTruthy();

    mockUseAuth.mockReturnValue({
      getToken: jest.fn(),
      isLoaded: false,
      isSignedIn: true,
      userId: 'signed-out-recheck-user',
    });
    await act(async () => {
      screen.rerender(<HomeScreen />);
    });

    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(screen.queryByText('Recheck tracked show')).toBeNull();
    expect(screen.queryByText(/Recheck next episode/)).toBeNull();
    expect(screen.queryByText('Recheck watchlist title')).toBeNull();
    expect(screen.queryByText('Recheck recommendation')).toBeNull();
    expect(mockQueryEnabled.trending).toEqual([]);

    mockTrendingQueryState.current = {
      data: [{ id: 924, name: 'Public browse after recheck' }],
      dataUpdatedAt: 456,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
    mockUseAuth.mockReturnValue({
      getToken: jest.fn(),
      isLoaded: true,
      isSignedIn: false,
    });
    await act(async () => {
      screen.rerender(<HomeScreen />);
    });

    expect(screen.queryByText('Recheck tracked show')).toBeNull();
    expect(screen.queryByText(/Recheck next episode/)).toBeNull();
    expect(screen.queryByText('Recheck watchlist title')).toBeNull();
    expect(screen.queryByText('Recheck recommendation')).toBeNull();
    expect(screen.getByText('Track your shows.')).toBeTruthy();
    expect(screen.getByText('Trending Now')).toBeTruthy();
    expect(screen.getByText('Public browse after recheck')).toBeTruthy();
    expect(mockQueryEnabled.shows).toEqual([false, true]);
    expect(mockQueryEnabled.watchlist).toEqual([false, true]);
    expect(mockQueryEnabled.recommendations).toEqual([false, true]);
    expect(mockQueryEnabled.trending).toEqual([true]);

    await act(async () => {
      screen.unmount();
    });
  });

  it('hides personal home content immediately when Clerk signs out in place', async () => {
    mockUseAuth.mockReturnValue({ getToken: jest.fn(), isLoaded: true, isSignedIn: true });
    mockSignedInHomeQueryState.shows.current = {
      data: [{
        title: { id: 901, name: 'Personal tracked show' },
        nextEpisode: {
          id: 9001,
          seasonNumber: 1,
          episodeNumber: 2,
          name: 'Personal next episode',
        },
        watchedEpisodes: 1,
        totalEpisodes: 10,
      }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
    mockSignedInHomeQueryState.watchlist.current = {
      data: [{ id: 902, name: 'Personal watchlist title' }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
    mockSignedInHomeQueryState.recommendations.current = {
      data: [{
        reason: 'Because you watched Personal tracked show',
        titles: [{ id: 904, name: 'Personal recommendation' }],
      }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };

    const screen = await render(<HomeScreen />);

    expect(mockQueryEnabled.shows).toEqual([false]);
    expect(mockQueryEnabled.watchlist).toEqual([false]);
    expect(mockQueryEnabled.recommendations).toEqual([false]);
    expect(mockQueryEnabled.trending).toEqual([]);

    mockUseAuth.mockReturnValue({ getToken: jest.fn(), isLoaded: true, isSignedIn: false });
    await act(async () => {
      screen.rerender(<HomeScreen />);
    });

    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(mockQueryEnabled.trending).toEqual([false]);

    await act(async () => {
      pendingFrames[0]?.(0);
    });
    expect(mockQueryEnabled.trending).toEqual([false]);

    await act(async () => {
      pendingFrames[1]?.(0);
    });

    await waitFor(() => {
      expect(mockQueryEnabled.trending).toEqual([false, true]);
      expect(screen.getByText('Track your shows.')).toBeTruthy();
      expect(screen.getByText('Trending Now')).toBeTruthy();
    });

    await act(async () => {
      screen.unmount();
    });
  });

  it('hides personal home content immediately when Clerk signs out in place', async () => {
    mockUseAuth.mockReturnValue({ getToken: jest.fn(), isLoaded: true, isSignedIn: true });
    mockSignedInHomeQueryState.shows.current = {
      data: [{
        title: { id: 901, name: 'Personal tracked show' },
        nextEpisode: {
          id: 9001,
          seasonNumber: 1,
          episodeNumber: 2,
          name: 'Personal next episode',
        },
        watchedEpisodes: 1,
        totalEpisodes: 10,
      }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
    mockSignedInHomeQueryState.watchlist.current = {
      data: [{ id: 902, name: 'Personal watchlist title' }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
    mockSignedInHomeQueryState.recommendations.current = {
      data: [{
        reason: 'Because you watched Personal tracked show',
        titles: [{ id: 904, name: 'Personal recommendation' }],
      }],
      dataUpdatedAt: 123,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };

    const screen = await render(<HomeScreen />);

    await act(async () => {
      pendingFrames[0]?.(0);
    });
    await act(async () => {
      pendingFrames[1]?.(0);
    });

    expect(screen.getByText('Personal tracked show')).toBeTruthy();
    expect(screen.getByText(/Personal next episode/)).toBeTruthy();
    expect(screen.getByText('Personal watchlist title')).toBeTruthy();
    expect(screen.getByText('Personal recommendation')).toBeTruthy();
    expect(screen.getByText('Up Next')).toBeTruthy();
    expect(screen.getByText('Your Watchlist')).toBeTruthy();
    expect(screen.getByText('Because you watched Personal tracked show')).toBeTruthy();

    mockTrendingQueryState.current = {
      data: [{ id: 903, name: 'Public trending after sign out' }],
      dataUpdatedAt: 456,
      isError: false,
      isLoading: false,
      isRefetching: false,
    };
    mockUseAuth.mockReturnValue({ getToken: jest.fn(), isLoaded: true, isSignedIn: false });

    await act(async () => {
      screen.rerender(<HomeScreen />);
    });

    expect(screen.queryByText('Personal tracked show')).toBeNull();
    expect(screen.queryByText(/Personal next episode/)).toBeNull();
    expect(screen.queryByText('Personal watchlist title')).toBeNull();
    expect(screen.queryByText('Personal recommendation')).toBeNull();
    expect(screen.queryByText('Up Next')).toBeNull();
    expect(screen.queryByText('Your Watchlist')).toBeNull();
    expect(screen.queryByText('Because you watched Personal tracked show')).toBeNull();
    expect(screen.getByText('Track your shows.')).toBeTruthy();
    expect(screen.getByText('Trending Now')).toBeTruthy();
    expect(screen.getByText('Public trending after sign out')).toBeTruthy();
    expect(mockQueryEnabled.trending).toEqual([true]);

    await act(async () => {
      screen.unmount();
    });
  });

  it('does not update startup state or enable feeds when callbacks fire after unmount', async () => {
    const home = await render(<HomeScreen />);

    expect(mockQueryEnabled.shows).toEqual([false]);
    expect(mockQueryEnabled.watchlist).toEqual([false]);
    expect(mockQueryEnabled.recommendations).toEqual([false]);

    expect(pendingFrames).toHaveLength(1);
    const scheduledFrameCount = mockRequestAnimationFrame.mock.calls.length;
    await act(async () => {
      home.unmount();
    });

    expect(mockCancelAnimationFrame).toHaveBeenCalledWith(1);
    mockStartupStateUpdates.mockClear();
    await act(async () => {
      pendingFrames[0]?.(0);
    });
    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(scheduledFrameCount);
    expect(mockStartupStateUpdates).not.toHaveBeenCalled();

    expect(mockQueryEnabled.shows).toEqual([false]);
    expect(mockQueryEnabled.watchlist).toEqual([false]);
    expect(mockQueryEnabled.recommendations).toEqual([false]);
    expect(mockQueryEnabled.trending).toEqual([]);
  });

  it('cancels the second frame and ignores its callback after unmount', async () => {
    const home = await render(<HomeScreen />);
    await act(async () => {
      pendingFrames[0]?.(0);
    });

    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(2);
    await act(async () => {
      home.unmount();
    });
    expect(mockCancelAnimationFrame).toHaveBeenCalledWith(2);

    mockStartupStateUpdates.mockClear();
    await act(async () => {
      pendingFrames[1]?.(0);
    });
    expect(mockStartupStateUpdates).not.toHaveBeenCalled();
    expect(mockQueryEnabled.shows).toEqual([false]);
    expect(mockQueryEnabled.watchlist).toEqual([false]);
    expect(mockQueryEnabled.recommendations).toEqual([false]);
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
      pendingFrames[0]?.(0);
    });
    await act(async () => {
      pendingFrames[1]?.(0);
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
