import React from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  showSignInUnavailableMessage,
  useAppAuth,
} from '@/lib/app-auth';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useGetMyRecommendations,
  useGetMyShows,
  useGetMyWatchlist,
  useGetTrendingTitles,
  useMarkEpisodeWatched,
  getGetMyShowsQueryKey,
  getGetMyInProgressShowsQueryKey,
  getGetMyRecentActivityQueryKey,
  getGetMyWatchlistQueryKey,
  getGetMyRecommendationsQueryKey,
  getGetTitleQueryKey,
  type TrackedShow,
} from '@workspace/api-client-react';
import { EmptyState, ErrorState, Loading, PosterCard, SectionHeader } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';
import { markStartup } from '@/lib/startup-metrics';
import { startHomeStartup } from '@/lib/home-startup';

function UpNextCard({ show }: { show: TrackedShow }) {
  const c = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const markWatched = useMarkEpisodeWatched({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyShowsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyInProgressShowsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyRecommendationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyRecentActivityQueryKey() });
        // Invalidate the title detail so the title page reflects the new watched state.
        queryClient.invalidateQueries({ queryKey: getGetTitleQueryKey(show.title.id) });
        // includePrevious can touch episodes across multiple seasons; clear every
        // season cache for this title so the accordion shows correct checkmarks.
        queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey[0];
            return (
              typeof key === 'string' &&
              key.startsWith(`/api/titles/${show.title.id}/seasons/`)
            );
          },
        });
      },
    },
  });
  const ep = show.nextEpisode;
  // A progress refresh can replace the episode without remounting this card.
  // Only the episode submitted by the failed request should offer a retry.
  const hasEpisodeError = markWatched.isError && markWatched.variables?.episodeId === ep?.id;
  const progress =
    show.totalEpisodes > 0 ? show.watchedEpisodes / show.totalEpisodes : 0;

  return (
    <Pressable
      testID={`upnext-${show.title.id}`}
      onPress={() => router.push(`/title/${show.title.id}`)}
      style={({ pressed }) => [
        styles.upNextCard,
        { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Image
        source={{ uri: ep?.stillUrl ?? show.title.backdropUrl ?? show.title.posterUrl ?? undefined }}
        style={{ width: '100%', height: 130, backgroundColor: c.muted }}
        contentFit="cover"
        transition={150}
      />
      <View style={{ padding: 12 }}>
        <Text numberOfLines={2} style={{ color: c.foreground, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
          {show.title.name}
        </Text>
        {ep ? (
          <Text style={{ color: c.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
            S{ep.seasonNumber} · E{ep.episodeNumber} — {ep.name}
          </Text>
        ) : (
          <Text style={{ color: c.mutedForeground, fontSize: 13, marginTop: 2 }}>All caught up</Text>
        )}
        <View style={[styles.progressTrack, { backgroundColor: c.muted }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: c.primary, width: `${Math.round(progress * 100)}%` },
            ]}
          />
        </View>
        <View
          testID={`upnext-actions-${show.title.id}`}
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginTop: 8,
          }}
        >
          <Text style={{ flexShrink: 1, color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
            {show.watchedEpisodes}/{show.totalEpisodes} episodes
          </Text>
          {ep ? (
            <Pressable
              testID={`mark-watched-${ep.id}`}
              accessibilityRole="button"
              accessibilityLabel={hasEpisodeError ? 'Retry marking episode as watched' : 'Mark episode as watched'}
              disabled={markWatched.isPending}
              onPress={(event) => {
                event.stopPropagation?.();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                markWatched.mutate({ episodeId: ep.id, data: { includePrevious: true } });
              }}
              style={({ pressed }) => [
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: c.primary,
                  borderRadius: 999,
                  minHeight: 44,
                  maxWidth: '100%',
                  flexShrink: 1,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  opacity: markWatched.isPending ? 0.5 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather name={hasEpisodeError ? 'refresh-cw' : 'check'} size={14} color={c.primaryForeground} />
              <Text style={{ color: c.primaryForeground, fontSize: 12, fontFamily: 'Inter_600SemiBold', flexShrink: 1 }}>
                {markWatched.isPending ? 'Saving…' : hasEpisodeError ? 'Retry' : 'Watched'}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {ep && hasEpisodeError ? (
          <Text
            accessibilityRole="alert"
            style={{ color: c.destructive, fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 8 }}
          >
            Couldn't mark this episode as watched. Please try again.
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function RefreshWarning({
  section,
  testID,
  onRetry,
}: {
  section: string;
  testID: string;
  onRetry: () => void;
}) {
  const c = useColors();
  return (
    <View testID={testID} style={[styles.refreshWarning, { backgroundColor: c.muted }]}>
      <Feather name="alert-circle" size={16} color={c.mutedForeground} />
      <Text style={[styles.refreshWarningText, { color: c.mutedForeground }]}>
        Couldn't refresh {section}. Results may be out of date.
      </Text>
      <Pressable
        testID="retry-button"
        accessibilityRole="button"
        accessibilityLabel={`Retry ${section}`}
        onPress={onRetry}
        hitSlop={8}
      >
        <Text style={[styles.refreshRetry, { color: c.primary }]}>Retry</Text>
      </Pressable>
    </View>
  );
}

function SignedInHome({ startupReady, userId }: { startupReady: boolean; userId: string }) {
  const c = useColors();
  const shows = useGetMyShows(undefined, {
    query: {
      enabled: startupReady,
      queryKey: [...getGetMyShowsQueryKey(), 'account', userId],
    } as any,
  });
  const watchlist = useGetMyWatchlist(undefined, {
    query: {
      enabled: startupReady,
      queryKey: [...getGetMyWatchlistQueryKey(), 'account', userId],
    } as any,
  });
  const recs = useGetMyRecommendations({
    query: {
      enabled: startupReady,
      queryKey: [...getGetMyRecommendationsQueryKey(), 'account', userId],
    } as any,
  });
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (startupReady) {
      markStartup('signed-in-feed-start');
    }
  }, [startupReady]);

  useEffect(() => {
    if (shows.dataUpdatedAt) {
      markStartup('my-shows-loaded');
    }
  }, [shows.dataUpdatedAt]);

  useEffect(() => {
    if (watchlist.dataUpdatedAt) {
      markStartup('watchlist-loaded');
    }
  }, [watchlist.dataUpdatedAt]);

  useEffect(() => {
    if (recs.dataUpdatedAt) {
      markStartup('recommendations-loaded');
    }
  }, [recs.dataUpdatedAt]);

  const refreshing = shows.isRefetching || watchlist.isRefetching || recs.isRefetching;
  const onRefresh = () => {
    shows.refetch();
    watchlist.refetch();
    recs.refetch();
  };

  if (!startupReady) return <Loading />;

  const upNext = (shows.data ?? []).filter((s) => s.nextEpisode);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{
        paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90,
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
    >
      <SectionHeader title="Up Next" />
      {shows.isError && shows.data === undefined ? (
        <View testID="up-next-error">
          <ErrorState message="Couldn't load Up Next" retryAccessibilityLabel="Retry Up Next" onRetry={() => void shows.refetch()} />
        </View>
      ) : shows.isLoading && shows.data === undefined ? (
        <Loading />
      ) : (
        <>
          {shows.isError && (
            <RefreshWarning section="Up Next" testID="up-next-refresh-warning" onRetry={() => void shows.refetch()} />
          )}
          {upNext.length === 0 ? (
            <EmptyState
              icon="tv"
              title="Nothing to watch yet"
              subtitle="Track a show from Browse and your next episodes will appear here."
            />
          ) : (
            <FlatList
              horizontal
              data={upNext}
              scrollEnabled={upNext.length > 0}
              keyExtractor={(s) => String(s.title.id)}
              renderItem={({ item }) => <UpNextCard show={item} />}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
              showsHorizontalScrollIndicator={false}
            />
          )}
        </>
      )}

      <SectionHeader title="Your Watchlist" />
      {watchlist.isError && watchlist.data === undefined ? (
        <View testID="watchlist-error">
          <ErrorState message="Couldn't load your watchlist" retryAccessibilityLabel="Retry your watchlist" onRetry={() => void watchlist.refetch()} />
        </View>
      ) : watchlist.isLoading && watchlist.data === undefined ? (
        <Loading />
      ) : (
        <>
          {watchlist.isError && (
            <RefreshWarning section="your watchlist" testID="watchlist-refresh-warning" onRetry={() => void watchlist.refetch()} />
          )}
          {(watchlist.data ?? []).length === 0 ? (
            <EmptyState icon="bookmark" title="Watchlist is empty" subtitle="Save titles you want to watch later." />
          ) : (
            <FlatList
              horizontal
              data={watchlist.data ?? []}
              scrollEnabled={(watchlist.data ?? []).length > 0}
              keyExtractor={(t) => String(t.id)}
              renderItem={({ item }) => <PosterCard title={item} />}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
              showsHorizontalScrollIndicator={false}
            />
          )}
        </>
      )}

      {((recs.isError || recs.isLoading) && recs.data === undefined) || (recs.data ?? []).length === 0 ? (
        <>
          <SectionHeader title="Recommendations" />
          {recs.isError && recs.data === undefined ? (
            <View testID="recommendations-error">
              <ErrorState message="Couldn't load recommendations" retryAccessibilityLabel="Retry recommendations" onRetry={() => void recs.refetch()} />
            </View>
          ) : recs.isLoading && recs.data === undefined ? (
            <Loading />
          ) : (
            <>
              {recs.isError && (
                <RefreshWarning section="recommendations" testID="recommendations-refresh-warning" onRetry={() => void recs.refetch()} />
              )}
              <EmptyState icon="star" title="No recommendations yet" subtitle="Track shows to get suggestions." />
            </>
          )}
        </>
      ) : (
        <>
          {recs.isError && (
            <RefreshWarning section="recommendations" testID="recommendations-refresh-warning" onRetry={() => void recs.refetch()} />
          )}
          {recs.data?.map((group) => (
            <View key={group.reason}>
              <SectionHeader title={group.reason} />
              <FlatList
                horizontal
                data={group.titles}
                scrollEnabled={group.titles.length > 0}
                keyExtractor={(t) => String(t.id)}
                renderItem={({ item }) => <PosterCard title={item} />}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
                showsHorizontalScrollIndicator={false}
              />
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function SignedOutHome({
  startupReady,
  authAvailable,
}: {
  startupReady: boolean;
  authAvailable: boolean;
}) {
  const c = useColors();
  const router = useRouter();
  const trending = useGetTrendingTitles(
    { limit: 12 },
    { query: { enabled: startupReady } as any },
  );
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (startupReady) {
      markStartup('signed-out-feed-start');
    }
  }, [startupReady]);

  useEffect(() => {
    if (trending.dataUpdatedAt) {
      markStartup('trending-loaded');
    }
  }, [trending.dataUpdatedAt]);

  useEffect(() => {
    if (trending.isError) {
      markStartup('trending-error');
    }
  }, [trending.isError]);

  const retryTrending = () => {
    markStartup('trending-retry');
    void trending.refetch();
  };

  if (!startupReady) return <Loading />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{
        paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90,
      }}
    >
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <Text style={{ color: c.foreground, fontSize: 26, fontFamily: 'Inter_700Bold' }}>
          Track your shows.
        </Text>
        <Text style={{ color: c.mutedForeground, fontSize: 15, fontFamily: 'Inter_400Regular', marginTop: 6 }}>
          Episode-level tracking, watchlists and content safety info — sign in to sync with your WatchTime account.
        </Text>
        <Pressable
          testID="landing-sign-in"
          onPress={() => {
            if (authAvailable === false) {
              showSignInUnavailableMessage();
              return;
            }
            router.push('/(auth)/sign-in');
          }}
          style={({ pressed }) => [
            {
              marginTop: 16,
              backgroundColor: c.primary,
              borderRadius: colors.radius,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={{ color: c.primaryForeground, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
            Sign in to get started
          </Text>
        </Pressable>
      </View>

      <SectionHeader title="Trending Now" />
      {trending.isLoading && trending.data === undefined ? (
        <Loading />
      ) : trending.isError && trending.data === undefined ? (
        <ErrorState
          message="Couldn't load trending titles"
          retryAccessibilityLabel="Retry Trending Now"
          onRetry={retryTrending}
        />
      ) : (
        <>
          {trending.isError && (
            <RefreshWarning section="Trending Now" testID="trending-refresh-warning" onRetry={retryTrending} />
          )}
          <FlatList
            horizontal
            data={trending.data ?? []}
            scrollEnabled={(trending.data ?? []).length > 0}
            keyExtractor={(t) => String(t.id)}
            renderItem={({ item }) => <PosterCard title={item} />}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            showsHorizontalScrollIndicator={false}
          />
        </>
      )}
    </ScrollView>
  );
}

export default function HomeScreen() {
  const { isLoaded, isSignedIn, userId, isAuthAvailable } = useAppAuth();
  const [startupReady, setStartupReady] = useState(false);

  useEffect(() => {
    return startHomeStartup(setStartupReady);
  }, []);

  if (!isLoaded) return <Loading />;
  if (isSignedIn) {
    if (!userId) return <Loading />;
    return <SignedInHome startupReady={startupReady} userId={userId} />;
  }
  return (
    <SignedOutHome
      startupReady={startupReady}
      authAvailable={isAuthAvailable}
    />
  );
}

const styles = StyleSheet.create({
  refreshWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: colors.radius,
  },
  refreshWarningText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  refreshRetry: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  upNextCard: {
    width: 280,
    borderRadius: colors.radius,
    borderWidth: 1,
    overflow: 'hidden',
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
});
