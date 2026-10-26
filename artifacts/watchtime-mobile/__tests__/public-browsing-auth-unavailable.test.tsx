import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(),
};
const mockRoute: { current: { id: string } } = { current: { id: '771' } };
const mockTrendingEnabled: boolean[] = [];
const mockPrivateQueryCalls: string[] = [];
const mockTitleFetch = jest.fn();
const mockTitleRefetch = jest.fn();
const mockTitleSafetyFetch = jest.fn();
const mockTitleSafetyRefetch = jest.fn();
const mockPublicTitle = {
  id: 771,
  name: 'Public show while sign-in is down',
  type: 'movie',
  year: 2025,
  genres: ['Drama'],
  altTitles: [],
  providers: [],
  seasons: [],
  inWatchlist: false,
  watched: false,
  overview: 'A public synopsis remains available while sign-in is down.',
};
const mockTitleQueryState: {
  current: { data: typeof mockPublicTitle | null; isLoading: boolean; isError: boolean };
} = {
  current: { data: mockPublicTitle, isLoading: false, isError: false },
};
const mockSimilarQueryState: {
  current: { data: { id: number; name: string }[] | undefined; isError: boolean };
} = {
  current: { data: [], isError: false },
};
const mockTitleSafetyQueryState: {
  current: { data: unknown; isLoading: boolean; isError: boolean };
} = {
  current: { data: null, isLoading: false, isError: false },
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockRoute.current,
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
  useGetTitle: (id: number) => {
    mockTitleFetch(id);
    return { ...mockTitleQueryState.current, refetch: mockTitleRefetch };
  },
  getGetTitleQueryKey: (id: number) => [`/api/titles/${id}`],
  useGetSimilarTitles: () => mockSimilarQueryState.current,
  useGetTitleSafety: (params: unknown) => {
    mockTitleSafetyFetch(params);
    return {
      ...mockTitleSafetyQueryState.current,
      refetch: mockTitleSafetyRefetch,
    };
  },
  useAddToWatchlist: () => ({ mutate: jest.fn(), isPending: false }),
  useRemoveFromWatchlist: () => ({ mutate: jest.fn(), isPending: false }),
  useMarkTitleWatched: () => ({ mutate: jest.fn(), isPending: false }),
  useUnmarkTitleWatched: () => ({ mutate: jest.fn(), isPending: false }),
  useMarkEpisodeWatched: () => ({ mutate: jest.fn(), isPending: false }),
  useUnmarkEpisodeWatched: () => ({ mutate: jest.fn(), isPending: false }),
  useCreateSafetyReport: () => ({ mutate: jest.fn(), isPending: false }),
  useCreateSafetyContribution: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Pressable, Text: NativeText, View } = require('react-native');
  const actualUi = jest.requireActual('@/components/ui');

  return {
    EmptyState: () => <View />,
    ErrorState: ({
      message,
      onRetry,
      retryAccessibilityLabel = 'Retry',
    }: {
      message: string;
      onRetry: () => void;
      retryAccessibilityLabel?: string;
    }) => (
      <View>
        <NativeText>{message}</NativeText>
        <Pressable
          testID="retry-button"
          accessibilityRole="button"
          accessibilityLabel={retryAccessibilityLabel}
          onPress={onRetry}
        >
          <NativeText>Retry</NativeText>
        </Pressable>
      </View>
    ),
    Loading: () => <View testID="loading" />,
    PosterCard: actualUi.PosterCard,
    SectionHeader: ({ title }: { title: string }) => <NativeText>{title}</NativeText>,
  };
});

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#ffffff',
    card: '#f5f5f5',
    foreground: '#111111',
    mutedForeground: '#777777',
    primary: '#6633cc',
    primaryForeground: '#ffffff',
    border: '#dddddd',
    secondary: '#eeeeee',
    muted: '#eeeeee',
  }),
}));

jest.mock('@/constants/colors', () => ({ __esModule: true, default: { radius: 8 } }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import HomeScreen from '../app/(tabs)/index';
import TitleDetailScreen from '../app/title/[id]';
import { AppAuthUnavailableProvider } from '../lib/app-auth';

describe('public browsing while authentication is unavailable', () => {
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockTrendingEnabled.length = 0;
    mockPrivateQueryCalls.length = 0;
    mockTitleFetch.mockClear();
    mockTitleRefetch.mockClear();
    mockTitleSafetyFetch.mockClear();
    mockTitleSafetyRefetch.mockClear();
    mockTitleQueryState.current = {
      data: mockPublicTitle,
      isLoading: false,
      isError: false,
    };
    mockTitleSafetyQueryState.current = {
      data: null,
      isLoading: false,
      isError: false,
    };
    mockSimilarQueryState.current = { data: [], isError: false };
    mockRoute.current = { id: '771' };
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

  it('opens a shared title URL directly while sign-in is unavailable', async () => {
    mockRoute.current = { id: '771' };
    mockTitleQueryState.current = { data: null, isLoading: false, isError: true };

    const detail = await render(
      <AppAuthUnavailableProvider>
        <TitleDetailScreen />
      </AppAuthUnavailableProvider>,
    );

    expect(detail.getByText("Couldn't load this title")).toBeTruthy();
    expect(detail.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(mockTitleFetch).toHaveBeenCalledWith(771);

    mockTitleRefetch.mockImplementationOnce(async () => {
      mockTitleQueryState.current = {
        data: mockPublicTitle,
        isLoading: false,
        isError: false,
      };
      return { data: mockPublicTitle };
    });
    await fireEvent.press(detail.getByRole('button', { name: 'Retry' }));

    expect(mockTitleRefetch).toHaveBeenCalledTimes(1);
    await detail.rerender(
      <AppAuthUnavailableProvider>
        <TitleDetailScreen />
      </AppAuthUnavailableProvider>,
    );

    await waitFor(() => {
      expect(detail.getByText('Public show while sign-in is down')).toBeTruthy();
      expect(
        detail.getByText('A public synopsis remains available while sign-in is down.'),
      ).toBeTruthy();
    });
    expect(mockTitleFetch).toHaveBeenCalledWith(771);
    expect(mockPrivateQueryCalls).toEqual([]);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('keeps title retry available after another public request fails while sign-in is unavailable', async () => {
    mockRoute.current = { id: '771' };
    mockTitleQueryState.current = { data: null, isLoading: false, isError: true };

    const detail = await render(
      <AppAuthUnavailableProvider>
        <TitleDetailScreen />
      </AppAuthUnavailableProvider>,
    );

    expect(detail.getByText("Couldn't load this title")).toBeTruthy();
    expect(detail.getByRole('button', { name: 'Retry' })).toBeTruthy();

    mockTitleRefetch.mockImplementationOnce(async () => {
      mockTitleQueryState.current = { data: null, isLoading: false, isError: true };
    });
    await fireEvent.press(detail.getByRole('button', { name: 'Retry' }));
    await detail.rerender(
      <AppAuthUnavailableProvider>
        <TitleDetailScreen />
      </AppAuthUnavailableProvider>,
    );

    expect(detail.getByText("Couldn't load this title")).toBeTruthy();
    expect(detail.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(mockTitleFetch).toHaveBeenCalledWith(771);
    expect(mockTitleRefetch).toHaveBeenCalledTimes(1);
    expect(mockPrivateQueryCalls).toEqual([]);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('keeps public title details visible when safety information fails', async () => {
    mockTitleQueryState.current = {
      data: mockPublicTitle,
      isLoading: false,
      isError: false,
    };
    mockTitleSafetyQueryState.current = {
      data: null,
      isLoading: false,
      isError: true,
    };

    const detail = await render(
      <AppAuthUnavailableProvider>
        <TitleDetailScreen />
      </AppAuthUnavailableProvider>,
    );

    await waitFor(() => {
      expect(detail.getByText('Public show while sign-in is down')).toBeTruthy();
      expect(
        detail.getByText('A public synopsis remains available while sign-in is down.'),
      ).toBeTruthy();
      expect(detail.getByText("Couldn't load safety info")).toBeTruthy();
      expect(detail.getByRole('button', { name: 'Retry' })).toBeTruthy();
    });

    expect(mockTitleFetch).toHaveBeenCalledWith(771);
    expect(mockTitleSafetyFetch).toHaveBeenCalledWith({ titleId: 771 });
    expect(mockPrivateQueryCalls).toEqual([]);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('keeps shared title details visible when similar-title lookup fails', async () => {
    mockTitleQueryState.current = {
      data: mockPublicTitle,
      isLoading: false,
      isError: false,
    };
    mockSimilarQueryState.current = { data: undefined, isError: true };

    const detail = await render(
      <AppAuthUnavailableProvider>
        <TitleDetailScreen />
      </AppAuthUnavailableProvider>,
    );

    expect(detail.getByText('Public show while sign-in is down')).toBeTruthy();
    expect(
      detail.getByText('A public synopsis remains available while sign-in is down.'),
    ).toBeTruthy();
    expect(detail.queryByText("Couldn't load this title")).toBeNull();
    expect(mockTitleFetch).toHaveBeenCalledWith(771);
    expect(mockTitleRefetch).not.toHaveBeenCalled();
    expect(mockPrivateQueryCalls).toEqual([]);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('opens a trending title publicly without sign-in or personal-data requests', async () => {
    const home = await render(
      <AppAuthUnavailableProvider>
        <HomeScreen />
      </AppAuthUnavailableProvider>,
    );

    await waitFor(() => {
      expect(home.getByText('Public show while sign-in is down')).toBeTruthy();
    });

    fireEvent.press(home.getByTestId('poster-771'));
    expect(mockRouter.push).toHaveBeenCalledWith('/title/771');
    expect(mockRouter.push).not.toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/(auth)/sign-in' }),
    );
    expect(mockPrivateQueryCalls).toEqual([]);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
