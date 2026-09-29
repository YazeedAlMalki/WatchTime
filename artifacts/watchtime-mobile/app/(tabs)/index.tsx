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
import { useAppAuth } from '@/lib/app-auth';
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
        queryClient.invalidateQueries({ queryKey: getGetMyRecommendationsQueryKey() });
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
        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
          {show.title.name}
        </Text>
        {ep ? (
          <Text numberOfLines={1} style={{ color: c.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
            {show.watchedEpisodes}/{show.totalEpisodes} episodes
          </Text>
          {ep ? (
            <Pressable
              testID={`mark-watched-${ep.id}`}
              disabled={markWatched.isPending}
              onPress={() => {
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
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  opacity: markWatched.isPending ? 0.5 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather name="check" size={14} color={c.primaryForeground} />
              <Text style={{ color: c.primaryForeground, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
                Watched
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
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
      {shows.isError ? (
        <View testID="up-next-error">
          <ErrorState message="Couldn't load Up Next" onRetry={() => void shows.refetch()} />
        </View>
      ) : shows.isLoading ? (
        <Loading />
      ) : upNext.length === 0 ? (
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

      <SectionHeader title="Your Watchlist" />
      {watchlist.isError ? (
        <View testID="watchlist-error">
          <ErrorState message="Couldn't load your watchlist" onRetry={() => void watchlist.refetch()} />
        </View>
      ) : watchlist.isLoading ? (
        <Loading />
      ) : (watchlist.data ?? []).length === 0 ? (
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

      {recs.isError || recs.isLoading || (recs.data ?? []).length === 0 ? (
        <>
          <SectionHeader title="Recommendations" />
          {recs.isError ? (
            <View testID="recommendations-error">
              <ErrorState message="Couldn't load recommendations" onRetry={() => void recs.refetch()} />
            </View>
          ) : recs.isLoading ? (
            <Loading />
          ) : (
            <EmptyState icon="star" title="No recommendations yet" subtitle="Track shows to get suggestions." />
          )}
        </>
      ) : (
        recs.data?.map((group) => (
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
        ))
      )}
    </ScrollView>
  );
}

function SignedOutHome({ startupReady }: { startupReady: boolean }) {
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
          onPress={() => router.push('/(auth)/sign-in')}
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
      {trending.isLoading ? (
        <Loading />
      ) : trending.isError ? (
        <ErrorState
          message="Couldn't load trending titles"
          onRetry={retryTrending}
        />
      ) : (
        <FlatList
          horizontal
          data={trending.data ?? []}
          scrollEnabled={(trending.data ?? []).length > 0}
          keyExtractor={(t) => String(t.id)}
          renderItem={({ item }) => <PosterCard title={item} />}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          showsHorizontalScrollIndicator={false}
        />
      )}
    </ScrollView>
  );
}

export default function HomeScreen() {
  const { isLoaded, isSignedIn, userId } = useAppAuth();
  const [startupReady, setStartupReady] = useState(false);

  useEffect(() => {
    return startHomeStartup(setStartupReady);
  }, []);

  if (!isLoaded) return <Loading />;
  if (isSignedIn) {
    if (!userId) return <Loading />;
    return <SignedInHome startupReady={startupReady} userId={userId} />;
  }
  return <SignedOutHome startupReady={startupReady} />;
}

const styles = StyleSheet.create({
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
