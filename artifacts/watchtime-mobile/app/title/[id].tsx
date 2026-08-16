import React, { useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useGetTitle,
  useGetSeason,
  useGetSimilarTitles,
  useGetTitleSafety,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useMarkTitleWatched,
  useUnmarkTitleWatched,
  useMarkEpisodeWatched,
  useUnmarkEpisodeWatched,
  getGetTitleQueryKey,
  getGetSeasonQueryKey,
  getGetMyWatchlistQueryKey,
  getGetMyShowsQueryKey,
  type SafetySource,
  type SafetyCategorySummary,
  type SeasonSummary,
} from '@workspace/api-client-react';
import { ErrorState, Loading, PosterCard, SectionHeader } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';

function severityColor(
  severity: SafetyCategorySummary['severity'],
  c: ReturnType<typeof useColors>,
) {
  switch (severity) {
    case 'none':
      return c.severityNone;
    case 'mild':
      return c.severityMild;
    case 'moderate':
      return c.severityModerate;
    case 'severe':
      return c.severitySevere;
    default:
      return c.mutedForeground;
  }
}

function SafetySourceCard({ source }: { source: SafetySource }) {
  const c = useColors();

  if (source.status === 'provider_unavailable') {
    return (
      <View style={[styles.sourceCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="cloud-off" size={16} color={c.mutedForeground} />
          <Text style={{ color: c.foreground, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>
            {source.sourceName}
          </Text>
        </View>
        <Text style={{ color: c.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 6 }}>
          No integration configured for this provider. Data will appear here once it's connected.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.sourceCard, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          <Feather
            name={source.isCommunity ? 'users' : 'shield'}
            size={16}
            color={c.primary}
          />
          <Text
            numberOfLines={1}
            style={{ color: c.foreground, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}
          >
            {source.sourceName}
          </Text>
        </View>
        {source.ageRecommendation ? (
          <View style={{ backgroundColor: c.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
            <Text style={{ color: c.accentForeground, fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>
              {source.ageRecommendation}
            </Text>
          </View>
        ) : null}
      </View>
      {source.items.map((item, i) => (
        <View key={`${item.category}-${i}`} style={{ marginTop: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: c.foreground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>
              {item.label}
            </Text>
            {item.score != null && item.maxScore != null ? (
              <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
                {item.score}/{item.maxScore}
              </Text>
            ) : null}
          </View>
          {item.description ? (
            <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
              {item.description}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function SafetySection({ titleId }: { titleId: number }) {
  const c = useColors();
  const safety = useGetTitleSafety({ titleId });

  if (safety.isLoading) return <Loading />;
  if (safety.isError) {
    return <ErrorState onRetry={() => safety.refetch()} message="Couldn't load safety info" />;
  }

  const info = safety.data;
  if (!info) return null;

  return (
    <View style={{ paddingHorizontal: 16 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {info.summary.map((s) => (
          <View
            key={s.category}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: c.card,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: severityColor(s.severity, c),
              }}
            />
            <Text style={{ color: c.foreground, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
              {s.category}
            </Text>
            <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
              {s.severity}
            </Text>
          </View>
        ))}
      </View>
      {info.sources.map((source) => (
        <SafetySourceCard key={source.sourceName} source={source} />
      ))}
    </View>
  );
}

function SeasonAccordion({
  titleId,
  season,
  isSignedIn,
}: {
  titleId: number;
  season: SeasonSummary;
  isSignedIn: boolean;
}) {
  const c = useColors();
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const detail = useGetSeason(titleId, season.seasonNumber, {
    query: { enabled: expanded } as any,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: getGetSeasonQueryKey(titleId, season.seasonNumber),
    });
    queryClient.invalidateQueries({ queryKey: getGetTitleQueryKey(titleId) });
    queryClient.invalidateQueries({ queryKey: getGetMyShowsQueryKey() });
  };
  const mark = useMarkEpisodeWatched({ mutation: { onSuccess: invalidate } });
  const unmark = useUnmarkEpisodeWatched({ mutation: { onSuccess: invalidate } });

  return (
    <View style={[styles.seasonCard, { backgroundColor: c.card, borderColor: c.border }]}>
      <Pressable
        testID={`season-${season.seasonNumber}`}
        onPress={() => setExpanded((e) => !e)}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 14,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <View>
          <Text style={{ color: c.foreground, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
            {season.name}
          </Text>
          <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
            {season.watchedCount != null
              ? `${season.watchedCount}/${season.episodeCount} watched`
              : `${season.episodeCount} episodes`}
          </Text>
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={c.mutedForeground} />
      </Pressable>

      {expanded ? (
        detail.isLoading ? (
          <Loading />
        ) : detail.isError ? (
          <ErrorState onRetry={() => detail.refetch()} message="Couldn't load episodes" />
        ) : (
          <View style={{ borderTopWidth: 1, borderTopColor: c.border }}>
            {(detail.data?.episodes ?? []).map((ep) => {
              const busy = mark.isPending || unmark.isPending;
              return (
                <View
                  key={ep.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    gap: 12,
                  }}
                >
                  {isSignedIn ? (
                    <Pressable
                      testID={`episode-check-${ep.id}`}
                      disabled={busy}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        if (ep.watched) unmark.mutate({ episodeId: ep.id });
                        else mark.mutate({ episodeId: ep.id, data: {} });
                      }}
                      style={({ pressed }) => [
                        {
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          borderWidth: 2,
                          borderColor: ep.watched ? c.primary : c.border,
                          backgroundColor: ep.watched ? c.primary : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: busy ? 0.5 : pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      {ep.watched ? (
                        <Feather name="check" size={14} color={c.primaryForeground} />
                      ) : null}
                    </Pressable>
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: c.foreground, fontSize: 14, fontFamily: 'Inter_500Medium' }}
                    >
                      {ep.episodeNumber}. {ep.name}
                    </Text>
                    <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 }}>
                      {[ep.airDate, ep.runtimeMinutes ? `${ep.runtimeMinutes} min` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )
      ) : null}
    </View>
  );
}

export default function TitleDetailScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const titleId = Number(id);
  const { isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  const title = useGetTitle(titleId);
  const similar = useGetSimilarTitles(titleId);

  const invalidateTitle = () => {
    queryClient.invalidateQueries({ queryKey: getGetTitleQueryKey(titleId) });
    queryClient.invalidateQueries({ queryKey: getGetMyWatchlistQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMyShowsQueryKey() });
  };
  const addWatchlist = useAddToWatchlist({ mutation: { onSuccess: invalidateTitle } });
  const removeWatchlist = useRemoveFromWatchlist({ mutation: { onSuccess: invalidateTitle } });
  const markWatched = useMarkTitleWatched({ mutation: { onSuccess: invalidateTitle } });
  const unmarkWatched = useUnmarkTitleWatched({ mutation: { onSuccess: invalidateTitle } });

  if (!Number.isFinite(titleId)) return <ErrorState onRetry={() => router.back()} message="Invalid title" />;
  if (title.isLoading) return <Loading />;
  if (title.isError || !title.data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <ErrorState onRetry={() => title.refetch()} message="Couldn't load this title" />
      </View>
    );
  }

  const t = title.data;
  const watchlistBusy = addWatchlist.isPending || removeWatchlist.isPending;
  const watchedBusy = markWatched.isPending || unmarkWatched.isPending;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{
        paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 40,
      }}
    >
      {/* Hero */}
      <View>
        <Image
          source={{ uri: t.backdropUrl ?? t.posterUrl ?? undefined }}
          style={{ width: '100%', height: 220, backgroundColor: c.muted }}
          contentFit="cover"
        />
        <View
          style={{
            position: 'absolute',
            top: (Platform.OS === 'web' ? 67 : insets.top) + 4,
            left: 12,
          }}
        >
          <Pressable
            testID="back-button"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            style={({ pressed }) => [
              {
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: 'rgba(18,23,36,0.7)',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="arrow-left" size={20} color={c.foreground} />
          </Pressable>
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
        <Text style={{ color: c.foreground, fontSize: 24, fontFamily: 'Inter_700Bold' }}>
          {t.name}
        </Text>
        <Text style={{ color: c.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 4 }}>
          {[
            t.type.toUpperCase(),
            t.year,
            t.runtimeMinutes ? `${t.runtimeMinutes} min` : null,
            t.imdbRating ? `IMDb ${t.imdbRating}` : null,
            t.rottenTomatoesScore ? `RT ${t.rottenTomatoesScore}%` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {t.genres.length > 0 ? (
          <Text style={{ color: c.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
            {t.genres.join(' · ')}
          </Text>
        ) : null}
        {t.altTitles.length > 0 ? (
          <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4 }}>
            Also known as: {t.altTitles.join(', ')}
          </Text>
        ) : null}

        {/* Actions */}
        {isSignedIn ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Pressable
              testID="watchlist-toggle"
              disabled={watchlistBusy}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (t.inWatchlist) removeWatchlist.mutate({ id: titleId });
                else addWatchlist.mutate({ id: titleId });
              }}
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: t.inWatchlist ? c.card : c.primary,
                  borderWidth: t.inWatchlist ? 1 : 0,
                  borderColor: c.border,
                  opacity: watchlistBusy ? 0.5 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather
                name="bookmark"
                size={16}
                color={t.inWatchlist ? c.foreground : c.primaryForeground}
              />
              <Text
                style={{
                  color: t.inWatchlist ? c.foreground : c.primaryForeground,
                  fontSize: 14,
                  fontFamily: 'Inter_600SemiBold',
                }}
              >
                {t.inWatchlist ? 'In Watchlist' : 'Watchlist'}
              </Text>
            </Pressable>
            {t.type === 'movie' ? (
              <Pressable
                testID="watched-toggle"
                disabled={watchedBusy}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  if (t.watched) unmarkWatched.mutate({ id: titleId });
                  else markWatched.mutate({ id: titleId });
                }}
                style={({ pressed }) => [
                  styles.actionButton,
                  {
                    backgroundColor: t.watched ? c.card : c.secondary,
                    borderWidth: 1,
                    borderColor: t.watched ? c.primary : c.border,
                    opacity: watchedBusy ? 0.5 : pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Feather name="check-circle" size={16} color={t.watched ? c.primary : c.foreground} />
                <Text
                  style={{
                    color: t.watched ? c.primary : c.foreground,
                    fontSize: 14,
                    fontFamily: 'Inter_600SemiBold',
                  }}
                >
                  {t.watched ? 'Watched' : 'Mark watched'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {t.overview ? (
          <Text style={{ color: c.foreground, fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21, marginTop: 16 }}>
            {t.overview}
          </Text>
        ) : null}

        {/* Providers */}
        {t.providers.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {t.providers.map((p, i) => (
              <View
                key={`${p.name}-${i}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: c.card,
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                }}
              >
                <Feather name="play-circle" size={13} color={c.mutedForeground} />
                <Text style={{ color: c.foreground, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
                  {p.name}
                </Text>
                <Text style={{ color: c.mutedForeground, fontSize: 11, fontFamily: 'Inter_400Regular' }}>
                  {p.kind}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {/* Episodes */}
      {t.seasons.length > 0 ? (
        <>
          <SectionHeader title="Episodes" />
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            {t.seasons.map((s) => (
              <SeasonAccordion
                key={s.seasonNumber}
                titleId={titleId}
                season={s}
                isSignedIn={!!isSignedIn}
              />
            ))}
          </View>
        </>
      ) : null}

      {/* Content Safety */}
      <SectionHeader title="Content Safety" />
      <SafetySection titleId={titleId} />

      {/* Similar */}
      {(similar.data ?? []).length > 0 ? (
        <>
          <SectionHeader title="More Like This" />
          <FlatList
            horizontal
            data={similar.data ?? []}
            scrollEnabled={(similar.data ?? []).length > 0}
            keyExtractor={(s) => String(s.id)}
            renderItem={({ item }) => <PosterCard title={item} />}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            showsHorizontalScrollIndicator={false}
          />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: colors.radius,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sourceCard: {
    borderWidth: 1,
    borderRadius: colors.radius,
    padding: 14,
    marginTop: 12,
  },
  seasonCard: {
    borderWidth: 1,
    borderRadius: colors.radius,
    overflow: 'hidden',
  },
});
