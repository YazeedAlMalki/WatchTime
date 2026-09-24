import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { InteractionManager } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

const mockUseAuth = jest.fn();
const mockUseFonts = jest.fn();
const mockRequestAnimationFrame = jest.fn();
const mockCancelAnimationFrame = jest.fn();
const mockMarkStartup = jest.fn();
const mockSetBaseUrl = jest.fn();
const mockSetAuthTokenGetter = jest.fn();
const mockQueryEnabled = {
  shows: [] as boolean[],
  watchlist: [] as boolean[],
  recommendations: [] as boolean[],
  trending: [] as boolean[],
};

jest.mock('@clerk/expo', () => {
  const React = require('react');

  return {
    ClerkProvider: ({ children }: any) => children,
    ClerkLoaded: () => null,
    useAuth: (...args: any[]) => mockUseAuth(...args),
  };
});


jest.mock('@clerk/expo/token-cache', () => ({
  tokenCache: {},
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
      data: [],
      dataUpdatedAt: 0,
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
  },
  useMarkEpisodeWatched: () => ({ isPending: false, mutate: jest.fn() }),
  getGetMyShowsQueryKey: () => ['/api/me/shows'],
  getGetMyRecommendationsQueryKey: () => ['/api/me/recommendations'],
  getGetTitleQueryKey: (id: number) => [`/api/titles/${id}`],
}));

jest.mock('@/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: any) => children,
}));

jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Text, View } = require('react-native');

  return {
    EmptyState: () => <View />,
    ErrorState: () => <View />,
    Loading: () => <View testID="loading" />,
    PosterCard: () => <View />,
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
}));

import RootLayout from '../app/_layout';
import HomeScreen from '../app/(tabs)/index';

describe('mobile startup contracts', () => {
  let pendingInteractions: Array<() => void> = [];
  let pendingFrames: Array<(time: number) => void> = [];

  beforeEach(() => {
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
      return { cancel: jest.fn() } as any;
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
    jest.clearAllMocks();
  });

  it('renders root navigation without waiting for ClerkLoaded', async () => {
    const { getByTestId } = await render(<RootLayout />);

    expect(getByTestId('root-navigation')).toBeTruthy();
  });

  it('hides the splash screen and renders root navigation when fonts fail to load', async () => {
    const fontError = new Error('font loading failed');
    mockUseFonts.mockReturnValue([false, fontError]);

    const { getByTestId } = await render(<RootLayout />);

    expect(getByTestId('root-navigation')).toBeTruthy();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(mockMarkStartup).toHaveBeenCalledWith('font-error');
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
  });

  it('keeps root navigation mounted when splash setup fails', async () => {
    jest.isolateModules(() => {
      jest.doMock('expo-splash-screen', () => ({
        hideAsync: jest.fn(() => Promise.resolve()),
        preventAutoHideAsync: jest.fn(() => Promise.reject(new Error('splash setup failed'))),
      }));
      require('../app/_layout');
    });

    await act(async () => {
      await Promise.resolve();
    });

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

  it('does not enable remounted signed-in home queries from a stale startup frame', async () => {
    const firstHome = await render(<HomeScreen />);

    expect(mockQueryEnabled.shows).toEqual([false]);
    expect(mockQueryEnabled.watchlist).toEqual([false]);
    expect(mockQueryEnabled.recommendations).toEqual([false]);

    await act(async () => {
      pendingInteractions[0]?.();
    });

    expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(1);

    firstHome.unmount();
    await render(<HomeScreen />);

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
  });
});