import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import {
  showSignInUnavailableMessage,
  useAppAuth,
} from '@/lib/app-auth';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getMyShows,
  getMyInProgressShows,
  mergeTrackedShows,
  getMyMovies,
  useGetMyRecentActivity,
  useMarkEpisodeWatched,
  getGetMyShowsQueryKey,
  getGetMyInProgressShowsQueryKey,
  getGetMyMoviesQueryKey,
  getGetMyRecentActivityQueryKey,
  getGetMyRecommendationsQueryKey,
  getGetTitleQueryKey,
  type TrackedShow,
  type RecentActivityItem,
} from '@workspace/api-client-react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, Loading, PosterCard } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';

// ─── Tab bar ──────────────────────────────────────────────────────────────────

type Tab = 'shows' | 'movies' | 'history';
const PAGE_SIZE = 24;

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
            active === key && {
              backgroundColor: c.background,
              ...Platform.select({
                web: { boxShadow: '0 1px 4px rgba(0, 0, 0, 0.12)' },
                default: {
                  shadowColor: '#000',
                  shadowOpacity: 0.12,
                  shadowRadius: 4,
                  shadowOffset: { width: 0, height: 1 },
                  elevation: 2,
                },
              }),
            },
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
        queryClient.invalidateQueries({ queryKey: getGetMyInProgressShowsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyRecommendationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyRecentActivityQueryKey() });
        const titleKey = getGetTitleQueryKey(show.title.id);
        queryClient.invalidateQueries({ queryKey: titleKey });
        queryClient.invalidateQueries({
          predicate: (query) =>
            typeof query.queryKey[0] === 'string' &&
            query.queryKey[0].startsWith(`${titleKey[0]}/seasons/`),
        });
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
              <Feather name={markWatched.isError ? 'refresh-cw' : 'check'} size={13} color={c.primaryForeground} />
              <Text style={{ color: c.primaryForeground, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
                {markWatched.isError ? 'Retry' : 'Watched'}
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
        {ep && markWatched.isError ? (
          <Text
            accessibilityRole="alert"
            style={{ color: c.destructive, fontSize: 13, fontFamily: 'Inter_400Regular' }}
          >
            Couldn't mark this episode as watched. Please try again.
          </Text>
        ) : null}
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

type ShowFilter = 'all' | 'up-next' | 'caught-up';

export default function MyShowsScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isSignedIn, isAuthAvailable, userId } = useAppAuth();
  const [activeTab, setActiveTab] = useState<Tab>('shows');
  const [showSearch, setShowSearch] = useState('');
  const [debouncedShowSearch, setDebouncedShowSearch] = useState('');
  const [showFilter, setShowFilter] = useState<ShowFilter>('all');

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedShowSearch(showSearch.trim()), 350);
    return () => clearTimeout(timeout);
  }, [showSearch]);

  const showQueryParams = {
    q: debouncedShowSearch || undefined,
    status: showFilter === 'all' ? undefined : showFilter,
  };
  const shows = useInfiniteQuery({
    queryKey: [...getGetMyShowsQueryKey(), 'account', userId, 'infinite', showQueryParams],
    initialPageParam: undefined as number | undefined,
    enabled: !!isSignedIn && !!userId,
    queryFn: ({ pageParam, signal }) =>
      getMyShows({ limit: PAGE_SIZE, beforeId: pageParam, ...showQueryParams }, { signal }),
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE ? lastPage.at(-1)?.title.id : undefined,
  });
  const inProgress = useInfiniteQuery({
    queryKey: [...getGetMyInProgressShowsQueryKey(), 'account', userId, 'infinite'],
    initialPageParam: undefined as number | undefined,
    enabled: !!isSignedIn && !!userId && showFilter !== 'caught-up',
    queryFn: ({ pageParam, signal }) =>
      getMyInProgressShows({ limit: PAGE_SIZE, beforeId: pageParam }, { signal }),
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE ? lastPage.at(-1)?.title.id : undefined,
  });
  const movies = useInfiniteQuery({
    queryKey: [...getGetMyMoviesQueryKey(), 'account', userId, 'infinite'],
    initialPageParam: undefined as string | undefined,
    enabled: !!isSignedIn && !!userId,
    queryFn: ({ pageParam, signal }) =>
      getMyMovies({ limit: PAGE_SIZE, before: pageParam }, { signal }),
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE ? lastPage.at(-1)?.collectionCursor : undefined,
  });
  const history = useGetMyRecentActivity({
    query: {
      enabled: !!isSignedIn && !!userId,
      queryKey: [...getGetMyRecentActivityQueryKey(), 'account', userId],
    } as any,
  });

  // Client-side filter for the TV Shows tab
  const allShows = mergeTrackedShows(shows.data?.pages.flat() ?? [], inProgress.data?.pages.flat() ?? []);
  const allMovies = movies.data?.pages.flat() ?? [];
  const normalizedShowSearch = debouncedShowSearch.toLowerCase();
  const filteredShows = allShows.filter(show => {
    const matchesSearch = !normalizedShowSearch ||
      show.title.name.toLowerCase().includes(normalizedShowSearch);
    const matchesFilter =
      showFilter === 'all' ||
      (showFilter === 'up-next' && show.nextEpisode !== null) ||
      (showFilter === 'caught-up' && show.nextEpisode === null);
    return matchesSearch && matchesFilter;
  });

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
    (activeTab === 'shows' && (shows.isRefetching || inProgress.isRefetching)) ||
    (activeTab === 'movies' && movies.isRefetching) ||
    (activeTab === 'history' && history.isRefetching);

  const onRefresh = () => {
    shows.refetch();
    if (showFilter !== 'caught-up') inProgress.refetch();
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
          onPress={() => {
            if (isAuthAvailable === false) {
              showSignInUnavailableMessage();
              return;
            }
            router.push('/(auth)/sign-in');
          }}
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

  if (!userId) return <Loading />;

  const SHOW_FILTER_CHIPS: { key: ShowFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'up-next', label: 'Up Next' },
    { key: 'caught-up', label: 'Caught Up' },
  ];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <View style={{ flex: 1, backgroundColor: c.background }}>
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* Search bar + filter chips — TV Shows tab only */}
      {activeTab === 'shows' && (
        <>
          <View style={[styles.searchBox, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="search" size={16} color={c.mutedForeground} style={{ marginLeft: 12 }} />
            <TextInput
              testID="shows-search-input"
              style={{ flex: 1, color: c.foreground, paddingHorizontal: 10, paddingVertical: 11, fontSize: 14, fontFamily: 'Inter_400Regular' }}
              placeholder="Search my shows…"
              placeholderTextColor={c.mutedForeground}
              accessibilityLabel="Search tracked shows"
              accessibilityHint="Filters your tracked shows by title."
              value={showSearch}
              onChangeText={setShowSearch}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={100}
            />
            {showSearch.length > 0 && (
              <Pressable
                testID="shows-search-clear"
                accessibilityRole="button"
                accessibilityLabel="Clear show search"
                hitSlop={8}
                onPress={() => setShowSearch('')}
                style={{ paddingHorizontal: 12, paddingVertical: 10 }}
              >
                <Feather name="x" size={16} color={c.mutedForeground} />
              </Pressable>
            )}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}
          >
            {SHOW_FILTER_CHIPS.map(chip => {
              const active = showFilter === chip.key;
              return (
                <Pressable
                  key={chip.key}
                  testID={`filter-chip-${chip.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => { Haptics.selectionAsync(); setShowFilter(chip.key); }}
                  style={[
                    styles.filterChip,
                    { backgroundColor: active ? c.primary : c.secondary, borderColor: active ? c.primary : c.border },
                  ]}
                >
                  <Text style={{ color: active ? c.primaryForeground : c.foreground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>
                    {chip.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      )}

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState onRetry={onRetry} />
      ) : activeTab === 'shows' ? (
        <FlatList
          data={filteredShows}
          keyExtractor={(s) => String(s.title.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: bottomPad, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
          onEndReached={() => {
             if (shows.hasNextPage && !shows.isFetchingNextPage) shows.fetchNextPage();
             if (showFilter !== 'caught-up' && inProgress.hasNextPage && !inProgress.isFetchingNextPage) {
               inProgress.fetchNextPage();
             }
          }}
          onEndReachedThreshold={0.4}
           ListHeaderComponent={showFilter !== 'caught-up' && (filteredShows.length || inProgress.isError) ? (
             <View>
            <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 4 }}>
               In-progress shows first, even beyond loaded pages
            </Text>
             {inProgress.isError && (
               <Pressable testID="retry-in-progress" onPress={() => inProgress.refetch()}>
                 <Text style={{ color: c.destructive, fontSize: 12 }}>Could not load all in-progress shows. Tap to retry.</Text>
               </Pressable>
             )}
             </View>
          ) : null}
           ListFooterComponent={shows.isFetchingNextPage || inProgress.isFetchingNextPage ? <ActivityIndicator color={c.primary} /> : null}
          ListEmptyComponent={
            <EmptyState
              icon="tv"
              title={showSearch || showFilter !== 'all' ? 'No shows match' : 'No shows tracked yet'}
              subtitle={showSearch || showFilter !== 'all' ? 'Try a different search or filter.' : 'Browse titles and start tracking shows you\'re watching.'}
            />
          }
          renderItem={({ item }) => <ShowRow show={item} />}
        />
      ) : activeTab === 'movies' ? (
        <FlatList
          data={allMovies}
          keyExtractor={(m) => String(m.id)}
          numColumns={3}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: bottomPad, gap: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
          onEndReached={() => {
            if (movies.hasNextPage && !movies.isFetchingNextPage) movies.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={movies.isFetchingNextPage ? <ActivityIndicator color={c.primary} /> : null}
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
    </KeyboardAvoidingView>
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
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: colors.radius,
    overflow: 'hidden',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
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
