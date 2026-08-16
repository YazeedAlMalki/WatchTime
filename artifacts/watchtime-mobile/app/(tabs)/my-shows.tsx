import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useGetMyShows,
  useGetMyMovies,
  useGetMyRecentActivity,
  useMarkEpisodeWatched,
  getGetMyShowsQueryKey,
  getGetMyMoviesQueryKey,
  getGetMyRecentActivityQueryKey,
  getGetMyRecommendationsQueryKey,
  type TrackedShow,
  type RecentActivityItem,
} from '@workspace/api-client-react';
import { EmptyState, ErrorState, Loading, PosterCard } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';

// ─── Tab bar ──────────────────────────────────────────────────────────────────

type Tab = 'shows' | 'movies' | 'history';

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const c = useColors();
  const tabs: { key: Tab; label: string }[] = [
    { key: 'shows', label: 'TV Shows' },
    { key: 'movies', label: 'Movies' },
    { key: 'history', label: 'History' },
  ];
  return (
    <View
      style={{
        flexDirection: 'row',
        marginHorizontal: 16,
        marginTop: 16,
        marginBottom: 4,
        backgroundColor: c.secondary,
        borderRadius: colors.radius,
        padding: 4,
      }}
    >
      {tabs.map(({ key, label }) => (
        <Pressable
          key={key}
          testID={`tab-${key}`}
          onPress={() => {
            Haptics.selectionAsync();
            onChange(key);
          }}
          style={[
            styles.tabPill,
            active === key && { backgroundColor: c.background, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
          ]}
        >
          <Text
            style={{
              fontFamily: active === key ? 'Inter_600SemiBold' : 'Inter_400Regular',
              fontSize: 14,
              color: active === key ? c.foreground : c.mutedForeground,
            }}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ─── Show row ─────────────────────────────────────────────────────────────────

function ShowRow({ show }: { show: TrackedShow }) {
  const c = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const markWatched = useMarkEpisodeWatched({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyShowsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyRecommendationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyRecentActivityQueryKey() });
      },
    },
  });
  const ep = show.nextEpisode;
  const progress = show.totalEpisodes > 0 ? show.watchedEpisodes / show.totalEpisodes : 0;
  const progressPct = Math.round(progress * 100);

  return (
    <Pressable
      testID={`show-row-${show.title.id}`}
      onPress={() => router.push(`/title/${show.title.id}`)}
      style={({ pressed }) => [
        styles.showRow,
        { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.88 : 1 },
      ]}
    >
      {/* Poster */}
      {show.title.posterUrl ? (
        <Image
          source={{ uri: show.title.posterUrl }}
          style={[styles.poster, { backgroundColor: c.muted }]}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View style={[styles.poster, { backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }]}>
          <Feather name="tv" size={24} color={c.mutedForeground} />
        </View>
      )}

      {/* Content */}
      <View style={{ flex: 1, padding: 12, gap: 8 }}>
        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
          {show.title.name}
        </Text>

        {/* Progress bar */}
        <View>
          <View style={[styles.progressTrack, { backgroundColor: c.muted }]}>
            <View style={[styles.progressFill, { backgroundColor: c.primary, width: `${progressPct}%` }]} />
          </View>
          <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4 }}>
            {show.watchedEpisodes} / {show.totalEpisodes} episodes
          </Text>
        </View>

        {/* Next episode */}
        {ep ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              backgroundColor: c.secondary,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.mutedForeground, fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 }}>
                Up Next
              </Text>
              <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>
                S{ep.seasonNumber} E{ep.episodeNumber} · {ep.name}
              </Text>
            </View>
            <Pressable
              testID={`mark-watched-${ep.id}`}
              disabled={markWatched.isPending}
              onPress={(e) => {
                e.stopPropagation?.();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                markWatched.mutate({ episodeId: ep.id, data: { includePrevious: true } });
              }}
              style={({ pressed }) => [
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  backgroundColor: c.primary,
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  opacity: markWatched.isPending ? 0.5 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather name="check" size={13} color={c.primaryForeground} />
              <Text style={{ color: c.primaryForeground, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
                Watched
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="check-circle" size={14} color="#3FB68B" />
            <Text style={{ color: '#3FB68B', fontSize: 13, fontFamily: 'Inter_500Medium' }}>
              All caught up!
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

// ─── History item ─────────────────────────────────────────────────────────────

function HistoryRow({ item }: { item: RecentActivityItem }) {
  const c = useColors();
  const router = useRouter();
  const watchedDate = new Date(item.watchedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <Pressable
      testID={`history-item-${item.titleId}`}
      onPress={() => router.push(`/title/${item.titleId}`)}
      style={({ pressed }) => [
        styles.historyRow,
        { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.88 : 1 },
      ]}
    >
      {item.posterUrl ? (
        <Image
          source={{ uri: item.posterUrl }}
          style={[styles.historyPoster, { backgroundColor: c.muted }]}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View style={[styles.historyPoster, { backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }]}>
          <Feather name="film" size={20} color={c.mutedForeground} />
        </View>
      )}
      <View style={{ flex: 1, paddingVertical: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 }}>
          <Feather name="clock" size={11} color={c.mutedForeground} />
          <Text style={{ color: c.mutedForeground, fontSize: 11, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {watchedDate}
          </Text>
        </View>
        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>
          {item.titleName}
        </Text>
        {item.kind === 'episode' && item.episodeLabel ? (
          <Text numberOfLines={1} style={{ color: c.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
            {item.episodeLabel}
          </Text>
        ) : null}
        <View
          style={{
            alignSelf: 'flex-start',
            marginTop: 6,
            backgroundColor: c.secondary,
            borderRadius: 6,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <Text style={{ color: c.mutedForeground, fontSize: 11, fontFamily: 'Inter_500Medium', textTransform: 'capitalize' }}>
            {item.kind}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function MyShowsScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('shows');

  const shows = useGetMyShows({ query: { enabled: !!isSignedIn } as any });
  const movies = useGetMyMovies({ query: { enabled: !!isSignedIn } as any });
  const history = useGetMyRecentActivity({ query: { enabled: !!isSignedIn } as any });

  const bottomPad = (Platform.OS === 'web' ? 34 : insets.bottom) + 90;

  const isLoading = activeTab === 'shows' ? shows.isLoading
    : activeTab === 'movies' ? movies.isLoading
    : history.isLoading;

  const isError = activeTab === 'shows' ? shows.isError
    : activeTab === 'movies' ? movies.isError
    : history.isError;

  const onRetry = activeTab === 'shows' ? () => shows.refetch()
    : activeTab === 'movies' ? () => movies.refetch()
    : () => history.refetch();

  const refreshing =
    (activeTab === 'shows' && shows.isRefetching) ||
    (activeTab === 'movies' && movies.isRefetching) ||
    (activeTab === 'history' && history.isRefetching);

  const onRefresh = () => {
    shows.refetch();
    movies.refetch();
    history.refetch();
  };

  // ── Signed-out gate ──
  if (!isSignedIn) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <EmptyState
          icon="play-circle"
          title="Sign in to see My Shows"
          subtitle="Track what you've watched and pick up where you left off."
        />
        <Pressable
          testID="my-shows-sign-in"
          onPress={() => router.push('/(auth)/sign-in')}
          style={({ pressed }) => [
            {
              marginHorizontal: 32,
              backgroundColor: c.primary,
              borderRadius: colors.radius,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={{ color: c.primaryForeground, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
            Sign in
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <TabBar active={activeTab} onChange={setActiveTab} />

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState onRetry={onRetry} />
      ) : activeTab === 'shows' ? (
        <FlatList
          data={shows.data ?? []}
          keyExtractor={(s) => String(s.title.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: bottomPad, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="tv"
              title="No shows tracked yet"
              subtitle="Browse titles and start tracking shows you're watching."
            />
          }
          renderItem={({ item }) => <ShowRow show={item} />}
        />
      ) : activeTab === 'movies' ? (
        <FlatList
          data={movies.data ?? []}
          keyExtractor={(m) => String(m.id)}
          numColumns={3}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: bottomPad, gap: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="film"
              title="No movies watched yet"
              subtitle="Mark movies as watched and they'll appear here."
            />
          }
          renderItem={({ item }) => (
            <View style={{ width: 104 }}>
              <PosterCard title={item} width={104} />
            </View>
          )}
        />
      ) : (
        /* History */
        <FlatList
          data={history.data ?? []}
          keyExtractor={(item, idx) => `${item.titleId}-${idx}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: bottomPad, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="clock"
              title="No recent activity"
              subtitle="Your watch history will appear here."
            />
          }
          renderItem={({ item }) => <HistoryRow item={item} />}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  tabPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: colors.radius - 2,
  },
  showRow: {
    flexDirection: 'row',
    borderRadius: colors.radius,
    borderWidth: 1,
    overflow: 'hidden',
  },
  poster: {
    width: 80,
    aspectRatio: 2 / 3,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  historyRow: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: colors.radius,
    borderWidth: 1,
    padding: 12,
    alignItems: 'flex-start',
  },
  historyPoster: {
    width: 56,
    height: 84,
    borderRadius: 8,
    flexShrink: 0,
  },
});
