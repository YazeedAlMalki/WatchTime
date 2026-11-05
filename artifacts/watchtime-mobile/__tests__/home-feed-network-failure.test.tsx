import React from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '../../../lib/api-client-react/src/custom-fetch';
import {
  getGetMyRecommendationsQueryKey,
  getGetMyShowsQueryKey,
  getGetMyWatchlistQueryKey,
} from '@workspace/api-client-react';

// Bypass the default empty API-client Jest stub: exercise the production
// generated hooks and customFetch, replacing only the network boundary.
jest.mock('@workspace/api-client-react', () =>
  jest.requireActual('../../../lib/api-client-react/src/index'),
);
jest.mock('@/lib/app-auth', () => ({
  useAppAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'home-network-user' }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/lib/home-startup', () => ({
  startHomeStartup: (ready: (value: boolean) => void) => {
    ready(true);
    return () => {};
  },
}));
jest.mock('@/lib/startup-metrics', () => ({ markStartup: jest.fn() }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/components/ui', () => {
  const { Text, View } = require('react-native');
  return {
    EmptyState: ({ title }: { title: string }) => <Text>{title}</Text>,
    ErrorState: jest.requireActual('@/components/ui').ErrorState,
    Loading: () => <View testID="loading" />,
    PosterCard: ({ title }: { title: { name: string } }) => <Text>{title.name}</Text>,
    SectionHeader: ({ title }: { title: string }) => <Text>{title}</Text>,
  };
});
jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff', foreground: '#111', mutedForeground: '#777',
    primary: '#6633cc', primaryForeground: '#fff', muted: '#eee',
  }),
}));
jest.mock('@/constants/colors', () => ({ __esModule: true, default: { radius: 8 } }));

import HomeScreen from '../app/(tabs)/index';

const trackedShow = {
  title: { id: 7, name: 'Up Next Show', posterUrl: null, backdropUrl: null },
  nextEpisode: { id: 71, name: 'Pilot', seasonNumber: 1, episodeNumber: 1, stillUrl: null },
  totalEpisodes: 10,
  watchedEpisodes: 0,
};
const accountKey = (key: readonly unknown[]) => [...key, 'account', 'home-network-user'];
const unavailableBody = { error: 'Feed temporarily unavailable' };
const unavailableResponse = () => new Response(JSON.stringify(unavailableBody), {
  status: 503,
  statusText: 'Service Unavailable',
  headers: { 'Content-Type': 'application/json' },
});
const proxyOutages = [
  {
    name: 'HTML proxy error',
    body: '<!doctype html><html><body><h1>503 Service Unavailable</h1></body></html>',
    contentType: 'text/html; charset=utf-8',
  },
  {
    name: 'plain-text proxy error',
    body: 'Service temporarily unavailable. Please try again later.',
    contentType: 'text/plain; charset=utf-8',
  },
];
const feedCases = [
  {
    key: accountKey(getGetMyShowsQueryKey()),
    path: '/api/me/shows',
    data: [trackedShow],
    recoveredData: [{ ...trackedShow, title: { ...trackedShow.title, name: 'Updated Up Next Show' } }],
    card: 'Up Next Show',
    recoveredCard: 'Updated Up Next Show',
    empty: 'Nothing to watch yet',
    warning: 'up-next-refresh-warning',
    fullError: 'up-next-error',
    section: 'Up Next',
  },
  {
    key: accountKey(getGetMyWatchlistQueryKey()),
    path: '/api/me/watchlist',
    data: [{ id: 8, name: 'Saved Show' }],
    recoveredData: [{ id: 8, name: 'Updated Saved Show' }],
    card: 'Saved Show',
    recoveredCard: 'Updated Saved Show',
    empty: 'Watchlist is empty',
    warning: 'watchlist-refresh-warning',
    fullError: 'watchlist-error',
    section: 'your watchlist',
  },
  {
    key: accountKey(getGetMyRecommendationsQueryKey()),
    path: '/api/me/recommendations',
    data: [{ reason: 'Because you watch drama', titles: [{ id: 9, name: 'Suggested Show' }] }],
    recoveredData: [{ reason: 'Because you watch drama', titles: [{ id: 9, name: 'Updated Suggested Show' }] }],
    card: 'Suggested Show',
    recoveredCard: 'Updated Suggested Show',
    empty: 'No recommendations yet',
    warning: 'recommendations-refresh-warning',
    fullError: 'recommendations-error',
    section: 'recommendations',
  },
];

describe('Home HTTP 503 refetch failures with a real query client', () => {
  let client: QueryClient;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });
    // Each request needs its own body: customFetch consumes the real response.
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => unavailableResponse());
  });

  afterEach(async () => {
    await cleanup();
    client.clear();
    fetchSpy.mockRestore();
  });

  it.each(feedCases.flatMap((focused, index) =>
    (['older first', 'older last'] as const).flatMap((order) =>
      [true, false].map((refreshSucceeds) => ({
        focused,
        otherSuccess: feedCases[(index + 1) % feedCases.length],
        otherFailure: feedCases[(index + 2) % feedCases.length],
        order,
        refreshSucceeds,
      })),
    ),
  ))(
    'keeps pull-to-refresh authoritative over a pending $focused.section retry ($order, refresh success: $refreshSucceeds)',
    async ({ focused, otherSuccess, otherFailure, order, refreshSucceeds }) => {
      for (const feed of feedCases) client.setQueryData(feed.key, feed.data);
      const screen = await render(
        <QueryClientProvider client={client}><HomeScreen /></QueryClientProvider>,
      );
      const refreshControl = () => screen.root!.queryAll(
        (node) => node.props.refreshControl != null,
        { includeSelf: true },
      )[0].props.refreshControl.props;
      const requestCount = (path: string) =>
        fetchSpy.mock.calls.filter(([url]) => url === path).length;
      const expectCachedWarning = (feed: typeof feedCases[number]) => {
        expect(client.getQueryData(feed.key)).toEqual(feed.data);
        expect(screen.getByText(feed.card)).toBeTruthy();
        expect(screen.queryByText(feed.recoveredCard)).toBeNull();
        expect(within(screen.getByTestId(feed.warning)).getByText(
          `Couldn't refresh ${feed.section}. Results may be out of date.`,
        )).toBeTruthy();
        expect(screen.queryByTestId(feed.fullError)).toBeNull();
        expect(screen.queryByText(feed.empty)).toBeNull();
      };
      expect(fetchSpy).not.toHaveBeenCalled();
      await act(async () => refreshControl().onRefresh());
      await waitFor(() => {
        for (const feed of feedCases) {
          expect(client.getQueryState(feed.key)?.status).toBe('error');
          expect(client.getQueryState(feed.key)?.fetchStatus).toBe('idle');
          expectCachedWarning(feed);
          expect(requestCount(feed.path)).toBe(1);
        }
        expect(refreshControl().refreshing).toBe(false);
      });

      const deferred = () => {
        let resolve!: (response: Response) => void;
        const promise = new Promise<Response>((settle) => { resolve = settle; });
        return { promise, resolve };
      };
      const older = deferred();
      const refreshed = feedCases.map(() => deferred());
      let olderSignal: AbortSignal | undefined;
      fetchSpy.mockImplementationOnce((_url, init) => {
        olderSignal = init.signal;
        // Intentionally ignore abort: a transport may finish after cancellation.
        // The real query lifecycle must still discard this response.
        return older.promise;
      });
      await fireEvent.press(within(screen.getByTestId(focused.warning)).getByRole('button', {
        name: `Retry ${focused.section}`,
      }));
      await waitFor(() => {
        expect(requestCount(focused.path)).toBe(2);
        expect(client.getQueryState(focused.key)?.fetchStatus).toBe('fetching');
        expect(refreshControl().refreshing).toBe(true);
      });
      expect(olderSignal).toBeDefined();
      expect(olderSignal!.aborted).toBe(false);
      for (const feed of feedCases) {
        expectCachedWarning(feed);
        if (feed !== focused) {
          expect(requestCount(feed.path)).toBe(1);
          expect(client.getQueryState(feed.key)?.fetchStatus).toBe('idle');
        }
      }

      const refreshSignals: AbortSignal[] = [];
      fetchSpy.mockImplementation((url, init) => {
        const index = feedCases.findIndex((feed) => feed.path === url);
        if (index === -1) return Promise.reject(new Error(`Unexpected request: ${url}`));
        refreshSignals.push(init.signal);
        return refreshed[index].promise;
      });
      await act(async () => refreshControl().onRefresh());
      await waitFor(() => {
        // refetch's default cancelRefetch cancels/replaces the focused retry
        // rather than allowing two live requests to write the same query.
        expect(olderSignal!.aborted).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(7);
        expect(refreshSignals).toHaveLength(3);
        for (const feed of feedCases) {
          expect(requestCount(feed.path)).toBe(feed === focused ? 3 : 2);
          expect(client.getQueryState(feed.key)?.fetchStatus).toBe('fetching');
          expectCachedWarning(feed);
        }
      });
      for (const signal of refreshSignals) {
        expect(signal).not.toBe(olderSignal);
        expect(signal.aborted).toBe(false);
      }
      const latestCard = `Latest ${focused.recoveredCard}`;
      const latestData = JSON.parse(
        JSON.stringify(focused.recoveredData).replace(focused.recoveredCard, latestCard),
      );
      const successResponse = (data: unknown) => new Response(JSON.stringify(data), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
      const latestFailure = unavailableResponse();
      const settleOlder = async () => {
        // Use the opposite outcome so stale successes cannot clear a current
        // warning, and stale failures cannot replace a successful refresh.
        const response = refreshSucceeds
          ? unavailableResponse()
          : successResponse(focused.recoveredData);
        const readText = response.text.bind(response);
        let bodyRead!: () => void;
        const consumed = new Promise<void>((resolve) => { bodyRead = resolve; });
        jest.spyOn(response, 'text').mockImplementation(async () => {
          const text = await readText();
          bodyRead();
          return text;
        });
        await act(async () => {
          older.resolve(response);
          // Do not infer completion from the cancelled query's status.
          await consumed;
        });
      };
      if (order === 'older first') {
        await settleOlder();
        for (const feed of feedCases) {
          expectCachedWarning(feed);
          expect(client.getQueryState(feed.key)?.fetchStatus).toBe('fetching');
        }
        expect(refreshControl().refreshing).toBe(true);
      }

      await act(async () => {
        refreshed[feedCases.indexOf(otherSuccess)].resolve(successResponse(otherSuccess.recoveredData));
        refreshed[feedCases.indexOf(otherFailure)].resolve(unavailableResponse());
      });
      await waitFor(() => {
        expect(screen.getByText(otherSuccess.recoveredCard)).toBeTruthy();
        expect(screen.queryByTestId(otherSuccess.warning)).toBeNull();
        expect(client.getQueryState(otherSuccess.key)?.status).toBe('success');
        expect(client.getQueryState(otherSuccess.key)?.fetchStatus).toBe('idle');
        expectCachedWarning(otherFailure);
        expect(client.getQueryState(otherFailure.key)?.status).toBe('error');
        expect(client.getQueryState(otherFailure.key)?.fetchStatus).toBe('idle');
      });
      expectCachedWarning(focused);
      expect(client.getQueryState(focused.key)?.fetchStatus).toBe('fetching');
      expect(refreshControl().refreshing).toBe(true);

      await act(async () => {
        refreshed[feedCases.indexOf(focused)].resolve(
          refreshSucceeds ? successResponse(latestData) : latestFailure,
        );
      });
      await waitFor(() => {
        expect(client.getQueryState(focused.key)?.fetchStatus).toBe('idle');
        expect(refreshControl().refreshing).toBe(false);
        if (refreshSucceeds) {
          expect(screen.getByText(latestCard)).toBeTruthy();
          expect(screen.queryByTestId(focused.warning)).toBeNull();
        } else {
          expectCachedWarning(focused);
          expect(client.getQueryState(focused.key)?.error).toMatchObject({
            response: latestFailure,
          });
        }
      });
      const finalStates = feedCases.map((feed) => client.getQueryState(feed.key));
      if (order === 'older last') await settleOlder();
      for (const [index, feed] of feedCases.entries()) {
        expect(client.getQueryState(feed.key)).toBe(finalStates[index]);
        expect(client.getQueryState(feed.key)?.fetchStatus).toBe('idle');
        expect(screen.queryByTestId(feed.fullError)).toBeNull();
        expect(screen.queryByText(feed.empty)).toBeNull();
      }
      expect(client.getQueryData(otherSuccess.key)).toEqual(otherSuccess.recoveredData);
      expect(screen.getByText(otherSuccess.recoveredCard)).toBeTruthy();
      expect(screen.queryByText(otherSuccess.card)).toBeNull();
      expect(screen.queryByTestId(otherSuccess.warning)).toBeNull();
      expectCachedWarning(otherFailure);
      expect(client.getQueryState(otherFailure.key)?.error).toBeInstanceOf(ApiError);
      if (refreshSucceeds) {
        expect(client.getQueryData(focused.key)).toEqual(latestData);
        expect(client.getQueryState(focused.key)?.status).toBe('success');
        expect(client.getQueryState(focused.key)?.error).toBeNull();
        expect(screen.getByText(latestCard)).toBeTruthy();
        expect(screen.queryByText(focused.card)).toBeNull();
        expect(screen.queryByTestId(focused.warning)).toBeNull();
      } else {
        expectCachedWarning(focused);
        expect(client.getQueryState(focused.key)?.status).toBe('error');
        expect(client.getQueryState(focused.key)?.error).toBeInstanceOf(ApiError);
        expect(client.getQueryState(focused.key)?.error).toMatchObject({ response: latestFailure });
        expect(screen.queryByText(latestCard)).toBeNull();
      }
      expect(screen.queryByText(focused.recoveredCard)).toBeNull();
      expect(refreshControl().refreshing).toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(7);
    },
  );

  it.each(feedCases.flatMap((successful, index) =>
    (['success first', 'failure first'] as const).map((order) => ({
      successful,
      failed: feedCases[(index + 1) % feedCases.length],
      untouched: feedCases[(index + 2) % feedCases.length],
      order,
    })),
  ))('isolates overlapping retries for $successful.section and $failed.section ($order)',
    async ({ successful, failed, untouched, order }) => {
      for (const feed of feedCases) client.setQueryData(feed.key, feed.data);
      const screen = await render(
        <QueryClientProvider client={client}><HomeScreen /></QueryClientProvider>,
      );
      expect(fetchSpy).not.toHaveBeenCalled();

      const scrollView = screen.root!.queryAll(
        (node) => node.props.refreshControl != null,
        { includeSelf: true },
      )[0];
      await act(async () => scrollView.props.refreshControl.props.onRefresh());
      await waitFor(() => {
        for (const feed of feedCases) {
          expect(screen.getByTestId(feed.warning)).toBeTruthy();
          expect(client.getQueryState(feed.key)?.status).toBe('error');
          expect(client.getQueryState(feed.key)?.fetchStatus).toBe('idle');
        }
      });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      const untouchedState = client.getQueryState(untouched.key);
      const requestCount = (path: string) =>
        fetchSpy.mock.calls.filter(([url]) => url === path).length;
      for (const feed of feedCases) expect(requestCount(feed.path)).toBe(1);

      let resolveResponse!: (response: Response) => void;
      let rejectResponse!: (error: Error) => void;
      const successResponse = new Promise<Response>((resolve) => { resolveResponse = resolve; });
      const failureResponse = new Promise<Response>((_resolve, reject) => { rejectResponse = reject; });
      fetchSpy.mockImplementation((url) => {
        if (url === successful.path) return successResponse;
        if (url === failed.path) return failureResponse;
        return Promise.reject(new Error(`Unexpected section request: ${url}`));
      });

      // Neither response is settled until both focused retries have started.
      for (const feed of [successful, failed]) {
        await fireEvent.press(within(screen.getByTestId(feed.warning)).getByRole('button', {
          name: `Retry ${feed.section}`,
        }));
      }
      await waitFor(() => {
        expect(requestCount(successful.path)).toBe(2);
        expect(requestCount(failed.path)).toBe(2);
        expect(client.getQueryState(successful.key)?.fetchStatus).toBe('fetching');
        expect(client.getQueryState(failed.key)?.fetchStatus).toBe('fetching');
      });

      const expectCachedSection = (feed: typeof feedCases[number]) => {
        expect(client.getQueryData(feed.key)).toEqual(feed.data);
        expect(screen.getByText(feed.card)).toBeTruthy();
        expect(screen.queryByText(feed.recoveredCard)).toBeNull();
        expect(within(screen.getByTestId(feed.warning)).getByText(
          `Couldn't refresh ${feed.section}. Results may be out of date.`,
        )).toBeTruthy();
        expect(screen.queryByTestId(feed.fullError)).toBeNull();
        expect(screen.queryByText(feed.empty)).toBeNull();
      };
      const expectUntouchedSection = () => {
        expectCachedSection(untouched);
        expect(client.getQueryState(untouched.key)).toBe(untouchedState);
        expect(requestCount(untouched.path)).toBe(1);
        expect(fetchSpy).toHaveBeenCalledTimes(5);
      };
      for (const feed of feedCases) expectCachedSection(feed);
      expectUntouchedSection();

      const retryError = new TypeError('Concurrent focused retry failed');
      const settleSuccess = async () => {
        await act(async () => resolveResponse(new Response(JSON.stringify(successful.recoveredData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })));
        await waitFor(() => {
          expect(client.getQueryState(successful.key)?.status).toBe('success');
          expect(client.getQueryState(successful.key)?.fetchStatus).toBe('idle');
          expect(screen.getByText(successful.recoveredCard)).toBeTruthy();
          expect(screen.queryByTestId(successful.warning)).toBeNull();
        });
      };
      const settleFailure = async () => {
        await act(async () => rejectResponse(retryError));
        await waitFor(() => {
          expect(client.getQueryState(failed.key)?.status).toBe('error');
          expect(client.getQueryState(failed.key)?.fetchStatus).toBe('idle');
          expect(client.getQueryState(failed.key)?.error).toBe(retryError);
        });
      };

      if (order === 'success first') {
        await settleSuccess();
        // The completed section must not settle or replace the other retry.
        expect(client.getQueryState(failed.key)?.fetchStatus).toBe('fetching');
        expectCachedSection(failed);
        expectUntouchedSection();
        await settleFailure();
      } else {
        await settleFailure();
        expect(client.getQueryState(successful.key)?.fetchStatus).toBe('fetching');
        expectCachedSection(successful);
        expectCachedSection(failed);
        expectUntouchedSection();
        await settleSuccess();
      }

      expect(client.getQueryData(successful.key)).toEqual(successful.recoveredData);
      expect(screen.getByText(successful.recoveredCard)).toBeTruthy();
      expect(screen.queryByText(successful.card)).toBeNull();
      expect(screen.queryByText(successful.empty)).toBeNull();
      expect(screen.queryByTestId(successful.warning)).toBeNull();
      expect(screen.queryByTestId(successful.fullError)).toBeNull();
      expectCachedSection(failed);
      expectUntouchedSection();
      expect(requestCount(successful.path)).toBe(2);
      expect(requestCount(failed.path)).toBe(2);
    },
  );

  it.each([
    ...(['cards', 'empty sections', 'empty sections recovering to cards'] as const).map(
      (cachedContent) => ({
        cachedContent,
        outage: 'JSON API error',
        errorBody: unavailableBody as unknown,
        contentType: 'application/json',
        response: unavailableResponse,
      }),
    ),
    ...proxyOutages.map(({ name, body, contentType }) => ({
      cachedContent: 'cards' as const,
      outage: name,
      errorBody: body as unknown,
      contentType,
      response: () => new Response(body, {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': contentType },
      }),
    })),
  ])(
    'keeps cached $cachedContent through $outage retries and clears only the successfully retried warning',
    async ({ cachedContent, errorBody, contentType, response }) => {
    // Use fresh real Responses for both pull-to-refresh and focused retry.
    // In particular, proxy HTML/text must be rejected as an ApiError, not
    // treated as successful feed data or replaced with a fabricated JSON error.
    fetchSpy.mockImplementation(async () => response());
    const empty = cachedContent !== 'cards';
    const recoversToCards = cachedContent !== 'empty sections';
    const feeds = feedCases.map((feed) => ({
      ...feed,
      data: empty ? [] : feed.data,
      recoveredData: recoversToCards ? feed.recoveredData : [],
      card: empty ? feed.empty : feed.card,
      recoveredCard: recoversToCards ? feed.recoveredCard : feed.empty,
    }));
    for (const feed of feeds) {
      client.setQueryData(feed.key, feed.data);
      expect(client.getQueryState(feed.key)?.status).toBe('success');
      expect(client.getQueryState(feed.key)?.dataUpdatedAt).toBeGreaterThan(0);
    }
    const screen = await render(
      <QueryClientProvider client={client}><HomeScreen /></QueryClientProvider>,
    );
    for (const feed of feeds) {
      expect(screen.getByText(feed.card)).toBeTruthy();
      expect(screen.queryByTestId(feed.warning)).toBeNull();
      expect(screen.queryByTestId(feed.fullError)).toBeNull();
    }
    // Seeded data is fresh: every network call below must come from an
    // actual refresh or section retry, rather than an incidental mount.
    expect(fetchSpy).not.toHaveBeenCalled();
    const successfulCache = feeds.map((feed) => ({
      data: client.getQueryData(feed.key),
      dataUpdatedAt: client.getQueryState(feed.key)!.dataUpdatedAt,
    }));
    const expectSuccessfulCacheRetained = (index: number) => {
      const feed = feeds[index];
      expect(client.getQueryData(feed.key)).toBe(successfulCache[index].data);
      expect(client.getQueryState(feed.key)?.dataUpdatedAt).toBe(successfulCache[index].dataUpdatedAt);
      if (empty) {
        expect(client.getQueryData(feed.key)).toEqual([]);
        expect(screen.getByText(feed.empty)).toBeTruthy();
        expect(screen.queryByText(feedCases[index].card)).toBeNull();
        expect(screen.queryByText(feedCases[index].recoveredCard)).toBeNull();
      }
      expect(screen.queryByTestId(feed.fullError)).toBeNull();
    };

    // The native ScrollView mock retains refreshControl as a prop rather
    // than mounting it as a host child in the test renderer.
    const scrollView = screen.root!.queryAll(
      (node) => node.props.refreshControl != null,
      { includeSelf: true },
    )[0];
    expect(scrollView).toBeTruthy();
    await act(async () => scrollView.props.refreshControl.props.onRefresh());
    await waitFor(() => {
      for (const feed of feeds) {
        expect(screen.getByTestId(feed.warning)).toBeTruthy();
        expect(client.getQueryState(feed.key)?.status).toBe('error');
        expect(client.getQueryState(feed.key)?.fetchStatus).toBe('idle');
        expect(client.getQueryState(feed.key)?.error).toBeInstanceOf(ApiError);
        expect(client.getQueryState(feed.key)?.error).toMatchObject({
          status: 503, statusText: 'Service Unavailable',
          data: errorBody, method: 'GET', url: feed.path,
        });
        const error = client.getQueryState(feed.key)!.error as ApiError;
        expect(error.response).toBeInstanceOf(Response);
        expect(error.headers.get('content-type')).toBe(contentType);
      }
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls.map(([path]) => path).sort()).toEqual(
      feeds.map((feed) => feed.path).sort(),
    );
    for (const [index, feed] of feeds.entries()) {
      expectSuccessfulCacheRetained(index);
      expect(client.getQueryData(feed.key)).toEqual(feed.data);
      expect(screen.getByText(feed.card)).toBeTruthy();
      expect(screen.queryByTestId(feed.fullError)).toBeNull();
      expect(within(screen.getByTestId(feed.warning)).getByText(
        `Couldn't refresh ${feed.section}. Results may be out of date.`,
      )).toBeTruthy();
    }
    for (const feed of feedCases) {
      if (empty) expect(screen.queryByText(feed.card)).toBeNull();
      else expect(screen.queryByText(feed.empty)).toBeNull();
    }

    for (const [index, feed] of feeds.entries()) {
      const callsBeforeRetry = 3 + index * 2;
      const unrelatedStates = feeds.map((other) => client.getQueryState(other.key));
      const expectUnrelatedSectionsUnchanged = () => {
        for (const [otherIndex, other] of feeds.entries()) {
          if (otherIndex === index) continue;
          expect(client.getQueryState(other.key)).toBe(unrelatedStates[otherIndex]);
          expect(screen.getByText(otherIndex < index ? other.recoveredCard : other.card)).toBeTruthy();
          expect(screen.queryByTestId(other.fullError)).toBeNull();
          if (otherIndex > index) {
            expect(within(screen.getByTestId(other.warning)).getByText(
              `Couldn't refresh ${other.section}. Results may be out of date.`,
            )).toBeTruthy();
            expectSuccessfulCacheRetained(otherIndex);
          } else {
            expect(screen.queryByTestId(other.warning)).toBeNull();
          }
        }
      };

      // Fail the focused retry too: cached content and each section's own
      // warning must survive until that section actually recovers.
      let resolveFailedResponse!: (response: Response) => void;
      fetchSpy.mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveFailedResponse = resolve;
      }));
      await fireEvent.press(within(screen.getByTestId(feed.warning)).getByRole('button', {
        name: `Retry ${feed.section}`,
      }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(callsBeforeRetry + 1));
      expect(fetchSpy.mock.calls[callsBeforeRetry][0]).toBe(feed.path);
      expect(client.getQueryState(feed.key)?.fetchStatus).toBe('fetching');
      expectSuccessfulCacheRetained(index);
      expect(client.getQueryData(feed.key)).toEqual(feed.data);
      expect(screen.getByText(feed.card)).toBeTruthy();
      expect(screen.getByTestId(feed.warning)).toBeTruthy();
      expect(screen.queryByTestId(feed.fullError)).toBeNull();
      expectUnrelatedSectionsUnchanged();

      const retryResponse = response();
      await act(async () => resolveFailedResponse(retryResponse));
      await waitFor(() => {
        expect(client.getQueryState(feed.key)?.fetchStatus).toBe('idle');
        expect(client.getQueryState(feed.key)?.status).toBe('error');
        expect(client.getQueryState(feed.key)?.error).toBeInstanceOf(ApiError);
        expect(client.getQueryState(feed.key)?.error).toMatchObject({
          status: 503, data: errorBody, response: retryResponse,
          method: 'GET', url: feed.path,
        });
        expect(within(screen.getByTestId(feed.warning)).getByText(
          `Couldn't refresh ${feed.section}. Results may be out of date.`,
        )).toBeTruthy();
      });
      expectSuccessfulCacheRetained(index);
      expect(client.getQueryData(feed.key)).toEqual(feed.data);
      expect(screen.getByText(feed.card)).toBeTruthy();
      expect(screen.queryByTestId(feed.fullError)).toBeNull();
      if (!empty) expect(screen.queryByText(feed.empty)).toBeNull();
      expectUnrelatedSectionsUnchanged();
      expect(fetchSpy).toHaveBeenCalledTimes(callsBeforeRetry + 1);

      let resolveResponse!: (response: Response) => void;
      fetchSpy.mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }));
      await fireEvent.press(within(screen.getByTestId(feed.warning)).getByRole('button', {
        name: `Retry ${feed.section}`,
      }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(callsBeforeRetry + 2));
      expect(fetchSpy.mock.calls[callsBeforeRetry + 1][0]).toBe(feed.path);
      expect(client.getQueryState(feed.key)?.fetchStatus).toBe('fetching');
      expectSuccessfulCacheRetained(index);
      expect(screen.getByText(feed.card)).toBeTruthy();
      expect(screen.getByTestId(feed.warning)).toBeTruthy();
      expect(screen.queryByTestId(feed.fullError)).toBeNull();
      expectUnrelatedSectionsUnchanged();

      await act(async () => {
        resolveResponse(new Response(JSON.stringify(feed.recoveredData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      });
      await waitFor(() => {
        expect(screen.queryByTestId(feed.warning)).toBeNull();
        expect(screen.getByText(feed.recoveredCard)).toBeTruthy();
        expect(client.getQueryState(feed.key)?.status).toBe('success');
        expect(client.getQueryState(feed.key)?.fetchStatus).toBe('idle');
        expect(client.getQueryState(feed.key)?.error).toBeNull();
      });
      if (recoversToCards) {
        expect(screen.queryByText(feed.card)).toBeNull();
        expect(screen.queryByText(feed.empty)).toBeNull();
      }
      expect(client.getQueryData(feed.key)).toEqual(feed.recoveredData);
      expectUnrelatedSectionsUnchanged();
      // Other sections must not refetch or lose their independent warning.
      for (const [otherIndex, other] of feeds.entries()) {
        expect(screen.getByText(otherIndex <= index ? other.recoveredCard : other.card)).toBeTruthy();
        expect(screen.queryByTestId(other.fullError)).toBeNull();
        if (otherIndex > index) expect(screen.getByTestId(other.warning)).toBeTruthy();
        else expect(screen.queryByTestId(other.warning)).toBeNull();
      }
      expect(fetchSpy).toHaveBeenCalledTimes(callsBeforeRetry + 2);
    }
  });
});
