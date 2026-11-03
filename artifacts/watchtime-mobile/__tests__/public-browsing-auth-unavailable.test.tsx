import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
const mockUseActualSimilarQuery: { current: boolean } = { current: false };
const mockSimilarRequests: number[] = [];
const mockSimilarFetch = jest.fn();
const mockResolveSimilarById: Record<
  number,
  (suggestions: { id: number; name: string }[]) => void
> = {};
const mockSeasonFetch = jest.fn();
const mockSeasonRefetch = jest.fn();
const mockSimilarRefetch = jest.fn();
const mockSeasonData = {
  episodes: [
    {
      id: 2301,
      seasonNumber: 1,
      episodeNumber: 1,
      name: 'Pilot',
      watched: false,
    },
  ],
};
const mockSeasonQueryState: {
  current: { data: typeof mockSeasonData | null; isLoading: boolean; isError: boolean };
} = {
  current: { data: null, isLoading: false, isError: true },
};
const mockPublicTitle: {
  id: number;
  name: string;
  type: 'movie' | 'tv';
  year: number;
  genres: string[];
  altTitles: string[];
  providers: { name: string; kind: string }[];
  seasons: {
    seasonNumber: number;
    name: string;
    episodeCount: number;
    watchedCount: number | null;
  }[];
  inWatchlist: boolean;
  watched: boolean;
  overview: string;
} = {
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
  current: {
    data: { id: number; name: string }[] | undefined;
    isError: boolean;
    isFetching?: boolean;
    refetch: typeof mockSimilarRefetch;
  };
} = {
  current: { data: [], isError: false, refetch: mockSimilarRefetch },
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
  useGetSeason: (id: number, seasonNumber: number, options: any) => {
    mockSeasonFetch(id, seasonNumber, options?.query?.enabled);
    return { ...mockSeasonQueryState.current, refetch: mockSeasonRefetch };
  },
  useGetSimilarTitles: (id: number) => {
    if (!mockUseActualSimilarQuery.current) return mockSimilarQueryState.current;
    const { useQuery } = require('@tanstack/react-query');
    return useQuery({
      queryKey: [`/api/titles/${id}/similar`],
      queryFn: () => {
        mockSimilarRequests.push(id);
        return mockSimilarFetch(id);
      },
    });
  },
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
    ErrorState: actualUi.ErrorState,
    Loading: () => <View testID="loading" />,
    PosterCard: actualUi.PosterCard,
    SectionHeader: ({ title }: { title: string }) => <NativeText>{title}</NativeText>,
  };
});

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
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
    mockUseActualSimilarQuery.current = false;
    mockSimilarRequests.length = 0;
    mockSimilarFetch.mockReset();
    Object.keys(mockResolveSimilarById).forEach((id) => {
      delete mockResolveSimilarById[Number(id)];
    });
    mockSeasonFetch.mockClear();
    mockSeasonRefetch.mockClear();
    mockSimilarRefetch.mockClear();
    mockSeasonQueryState.current = { data: null, isLoading: false, isError: true };
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
    mockSimilarQueryState.current = { data: [], isError: false, refetch: mockSimilarRefetch };
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

  it('keeps recovered public title details visible after an older request fails late', async () => {
    mockRoute.current = { id: '771' };
    mockTitleQueryState.current = { data: null, isLoading: false, isError: true };

    const detail = await render(
      <AppAuthUnavailableProvider>
        <TitleDetailScreen />
      </AppAuthUnavailableProvider>,
    );

    expect(detail.getByText("Couldn't load this title")).toBeTruthy();

    mockTitleRefetch.mockImplementationOnce(async () => ({
      data: mockPublicTitle,
    }));
    await fireEvent.press(detail.getByRole('button', { name: 'Retry' }));

    mockTitleQueryState.current = {
      data: mockPublicTitle,
      isLoading: false,
      isError: false,
    };
    await detail.rerender(
      <AppAuthUnavailableProvider>
        <TitleDetailScreen />
      </AppAuthUnavailableProvider>,
    );
    expect(detail.getByText('Public show while sign-in is down')).toBeTruthy();

    // An older request can report an error after the retry has recovered data.
    mockTitleQueryState.current = {
      data: mockPublicTitle,
      isLoading: false,
      isError: true,
    };
    await detail.rerender(
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
    expect(mockTitleRefetch).toHaveBeenCalledTimes(1);
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

  it('shows a pending title retry, ignores repeat taps, and restores retry after failure', async () => {
    mockRoute.current = { id: '771' };
    mockTitleQueryState.current = { data: null, isLoading: false, isError: true };

    const detail = await render(
      <AppAuthUnavailableProvider>
        <TitleDetailScreen />
      </AppAuthUnavailableProvider>,
    );

    let rejectRetry!: (error: Error) => void;
    mockTitleRefetch.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRetry = reject;
        }),
    );

    await fireEvent.press(detail.getByRole('button', { name: 'Retry' }));
    const retryingButton = detail.getByRole('button', { name: 'Retrying' });
    expect(detail.getByText('Retrying…')).toBeTruthy();
    expect(retryingButton.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });

    await fireEvent.press(retryingButton);
    expect(mockTitleRefetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectRetry(new Error('Title request failed'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(detail.getByRole('button', { name: 'Retry' })).toBeTruthy();
    });
    expect(detail.getByText("Couldn't load this title")).toBeTruthy();
    expect(mockTitleRefetch).toHaveBeenCalledTimes(1);
  });

  it('keeps public title details visible when safety information fails', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
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
      expect(detail.getByTestId('report-safety-btn')).toBeTruthy();
    });

    fireEvent.press(detail.getByTestId('report-safety-btn'));

    expect(alert).toHaveBeenCalledWith(
      'Sign-in unavailable',
      "WatchTime couldn't start its sign-in service. Check your connection and try again.",
    );
    expect(mockTitleFetch).toHaveBeenCalledWith(771);
    expect(mockTitleSafetyFetch).toHaveBeenCalledWith({ titleId: 771 });
    expect(mockPrivateQueryCalls).toEqual([]);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    const recoveredSafety = {
      preferredRating: null,
      summary: [{ category: 'Violence', severity: 'Mild' }],
      sources: [],
    };
    mockTitleSafetyRefetch.mockImplementationOnce(async () => {
      mockTitleSafetyQueryState.current = {
        data: recoveredSafety,
        isLoading: false,
        isError: false,
      };
      return { data: recoveredSafety };
    });
    await fireEvent.press(detail.getByRole('button', { name: 'Retry' }));

    expect(detail.getByText('Public show while sign-in is down')).toBeTruthy();
    expect(
      detail.getByText('A public synopsis remains available while sign-in is down.'),
    ).toBeTruthy();
    expect(mockTitleRefetch).not.toHaveBeenCalled();

    await detail.rerender(
      <AppAuthUnavailableProvider>
        <TitleDetailScreen />
      </AppAuthUnavailableProvider>,
    );

    expect(detail.getByText('Violence')).toBeTruthy();
    expect(detail.queryByText("Couldn't load safety info")).toBeNull();
    expect(detail.getByText('Public show while sign-in is down')).toBeTruthy();
    expect(
      detail.getByText('A public synopsis remains available while sign-in is down.'),
    ).toBeTruthy();
    expect(mockTitleSafetyRefetch).toHaveBeenCalledTimes(1);
    expect(mockTitleRefetch).not.toHaveBeenCalled();
    expect(mockPrivateQueryCalls).toEqual([]);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('keeps shared title details visible when episode loading fails', async () => {
    const publicShow = {
      ...mockPublicTitle,
      type: 'tv' as const,
      seasons: [
        {
          seasonNumber: 1,
          name: 'Season 1',
          episodeCount: 8,
          watchedCount: null,
        },
      ],
    };
    mockTitleQueryState.current = {
      data: publicShow,
      isLoading: false,
      isError: false,
    };

    const detail = await render(
      <AppAuthUnavailableProvider>
        <TitleDetailScreen />
      </AppAuthUnavailableProvider>,
    );

    expect(detail.getByText('Public show while sign-in is down')).toBeTruthy();
    expect(
      detail.getByText('A public synopsis remains available while sign-in is down.'),
    ).toBeTruthy();
    expect(detail.getByText('Season 1')).toBeTruthy();
    expect(detail.queryByText("Couldn't load this title")).toBeNull();

    fireEvent.press(detail.getByTestId('season-1'));

    await waitFor(() => {
      expect(detail.getByText("Couldn't load episodes")).toBeTruthy();
      expect(detail.getByRole('button', { name: 'Retry' })).toBeTruthy();
    });
    expect(mockSeasonFetch).toHaveBeenCalledWith(771, 1, true);
    expect(detail.getByText('Public show while sign-in is down')).toBeTruthy();
    expect(
      detail.getByText('A public synopsis remains available while sign-in is down.'),
    ).toBeTruthy();
    expect(mockPrivateQueryCalls).toEqual([]);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    mockSeasonRefetch.mockImplementationOnce(async () => {
      mockSeasonQueryState.current = {
        data: mockSeasonData,
        isLoading: false,
        isError: false,
      };
      return { data: mockSeasonData };
    });
    await fireEvent.press(detail.getByRole('button', { name: 'Retry' }));
    await detail.rerender(
      <AppAuthUnavailableProvider>
        <TitleDetailScreen />
      </AppAuthUnavailableProvider>,
    );

    expect(mockSeasonRefetch).toHaveBeenCalledTimes(1);
    expect(detail.getByText('1. Pilot')).toBeTruthy();
    expect(detail.getByText('Public show while sign-in is down')).toBeTruthy();
    expect(detail.queryByTestId('episode-check-2301')).toBeNull();
    expect(mockPrivateQueryCalls).toEqual([]);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('retries a failed similar-title lookup without reloading the shared title or personal data', async () => {
    mockTitleQueryState.current = {
      data: mockPublicTitle,
      isLoading: false,
      isError: false,
    };
    mockSimilarQueryState.current = {
      data: undefined,
      isError: true,
      refetch: mockSimilarRefetch,
    };

    const detail = await render(
      <AppAuthUnavailableProvider>
        <TitleDetailScreen />
      </AppAuthUnavailableProvider>,
    );

    expect(detail.getByText('Public show while sign-in is down')).toBeTruthy();
    expect(detail.getByText('More Like This')).toBeTruthy();
    expect(detail.getByText("Couldn't load similar titles.")).toBeTruthy();
    expect(detail.getByRole('button', { name: 'Retry suggestions' })).toBeTruthy();
    expect(
      detail.getByText('A public synopsis remains available while sign-in is down.'),
    ).toBeTruthy();
    expect(detail.queryByText("Couldn't load this title")).toBeNull();
    expect(mockTitleFetch).toHaveBeenCalledWith(771);
    expect(mockTitleRefetch).not.toHaveBeenCalled();
    expect(mockPrivateQueryCalls).toEqual([]);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    mockSimilarRefetch.mockImplementationOnce(async () => {
      mockSimilarQueryState.current = {
        data: [{ id: 772, name: 'Similar public title' }],
        isError: false,
        refetch: mockSimilarRefetch,
      };
      return { data: mockSimilarQueryState.current.data };
    });
    await fireEvent.press(detail.getByRole('button', { name: 'Retry suggestions' }));
    await detail.rerender(
      <AppAuthUnavailableProvider>
        <TitleDetailScreen />
      </AppAuthUnavailableProvider>,
    );

    expect(mockSimilarRefetch).toHaveBeenCalledTimes(1);
    expect(detail.getByText('Similar public title')).toBeTruthy();
    expect(detail.getByText('Public show while sign-in is down')).toBeTruthy();
    expect(detail.getByText('A public synopsis remains available while sign-in is down.')).toBeTruthy();
    expect(detail.queryByText("Couldn't load similar titles.")).toBeNull();
    expect(mockTitleRefetch).not.toHaveBeenCalled();
    expect(mockPrivateQueryCalls).toEqual([]);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('keeps similar-title suggestions matched to the newly opened shared title', async () => {
    mockUseActualSimilarQuery.current = true;
    mockTitleQueryState.current = {
      data: mockPublicTitle,
      isLoading: false,
      isError: false,
    };
    mockSimilarFetch.mockImplementation(
      (id: number) =>
        new Promise((resolve) => {
          mockResolveSimilarById[id] = resolve;
        }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <AppAuthUnavailableProvider>
          <TitleDetailScreen />
        </AppAuthUnavailableProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mockSimilarRequests).toContain(771);
      expect(mockResolveSimilarById[771]).toEqual(expect.any(Function));
    });

    const currentTitle = {
      ...mockPublicTitle,
      id: 772,
      name: 'The newly opened shared title',
      overview: 'Details for the newly opened shared title.',
    };
    mockRoute.current = { id: '772' };
    mockTitleQueryState.current = { data: currentTitle, isLoading: false, isError: false };
    await act(async () => {
      screen.rerender(
        <QueryClientProvider client={queryClient}>
          <AppAuthUnavailableProvider>
            <TitleDetailScreen />
          </AppAuthUnavailableProvider>
        </QueryClientProvider>,
      );
    });

    await waitFor(() => {
      expect(mockTitleFetch).toHaveBeenLastCalledWith(772);
      expect(mockSimilarRequests).toContain(772);
      expect(mockResolveSimilarById[772]).toEqual(expect.any(Function));
      expect(screen.getByText('The newly opened shared title')).toBeTruthy();
      expect(screen.getByText('Details for the newly opened shared title.')).toBeTruthy();
    });

    await act(async () => {
      mockResolveSimilarById[772]([{ id: 902, name: 'A suggestion for title 772' }]);
    });
    await waitFor(() => {
      expect(screen.getByText('A suggestion for title 772')).toBeTruthy();
      expect(screen.queryByText('A delayed suggestion for title 771')).toBeNull();
    });

    const olderRequest = mockSimilarFetch.mock.results[
      mockSimilarRequests.indexOf(771)
    ].value as Promise<{ id: number; name: string }[]>;
    await act(async () => {
      mockResolveSimilarById[771]([{ id: 901, name: 'A delayed suggestion for title 771' }]);
      await olderRequest;
    });

    expect(screen.getByText('The newly opened shared title')).toBeTruthy();
    expect(screen.getByText('Details for the newly opened shared title.')).toBeTruthy();
    expect(screen.getByText('A suggestion for title 772')).toBeTruthy();
    expect(screen.queryByText('A delayed suggestion for title 771')).toBeNull();

    await screen.unmount();
    queryClient.clear();
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
