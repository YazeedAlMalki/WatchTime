import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  useCreateSafetyReport,
  useCreateSafetyContribution,
  getGetTitleQueryKey,
  getGetSeasonQueryKey,
  getGetMyWatchlistQueryKey,
  getGetMyShowsQueryKey,
  getGetTitleSafetyQueryKey,
  type SafetySource,
  type SafetyCategorySummary,
  type SeasonSummary,
} from '@workspace/api-client-react';
import { ErrorState, Loading, PosterCard, SectionHeader } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';

const SEVERITY_OPTIONS = ['none', 'mild', 'moderate', 'severe'] as const;
const REPORT_REASONS = [
  { value: 'wrong_title', label: 'Wrong title / mismatch' },
  { value: 'incorrect_info', label: 'Incorrect information' },
  { value: 'outdated_info', label: 'Outdated information' },
  { value: 'broken_source', label: 'Broken source link' },
  { value: 'incorrect_episode', label: 'Wrong episode level' },
  { value: 'other', label: 'Other' },
] as const;

function ModalSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={[
            styles.modalSheet,
            { backgroundColor: c.background, paddingBottom: insets.bottom + 24 },
          ]}
        >
          <View style={styles.modalHandle} />
          <Text style={[styles.modalTitle, { color: c.foreground }]}>{title}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function FieldLabel({ label, required, c }: { label: string; required?: boolean; c: ReturnType<typeof useColors> }) {
  return (
    <Text style={{ color: c.foreground, fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 4 }}>
      {label}
      {required ? <Text style={{ color: '#ef4444' }}> *</Text> : null}
    </Text>
  );
}

function OptionPicker<T extends string>({
  options,
  value,
  onChange,
  c,
}: {
  options: readonly { value: T; label: string }[];
  value: T | '';
  onChange: (v: T) => void;
  c: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              {
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: selected ? c.primary : c.border,
                backgroundColor: selected ? c.primary : c.card,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text
              style={{
                fontSize: 13,
                fontFamily: selected ? 'Inter_600SemiBold' : 'Inter_400Regular',
                color: selected ? c.primaryForeground : c.foreground,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SafetyReportModal({
  visible,
  onClose,
  titleId,
}: {
  visible: boolean;
  onClose: () => void;
  titleId: number;
}) {
  const c = useColors();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]['value'] | ''>('');
  const [source, setSource] = useState('');
  const [details, setDetails] = useState('');

  const createReport = useCreateSafetyReport();

  const reset = () => {
    setReason('');
    setSource('');
    setDetails('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    if (!reason) return;
    createReport.mutate(
      { id: titleId, data: { reason: reason as any, sourceName: source || null, details: details || null } },
      {
        onSuccess: () => {
          handleClose();
          queryClient.invalidateQueries({ queryKey: getGetTitleSafetyQueryKey({ titleId }) });
          Alert.alert('Report submitted', 'The admin team will review your report shortly.');
        },
        onError: (err: any) => {
          const is429 = err?.response?.status === 429;
          Alert.alert(
            is429 ? 'Too many requests' : 'Could not submit report',
            is429
              ? "You've submitted too many reports recently. Please wait before trying again."
              : 'Please try again.',
          );
        },
      },
    );
  };

  return (
    <ModalSheet visible={visible} onClose={handleClose} title="Report Safety Data Issue">
      <View style={{ gap: 16 }}>
        <View>
          <FieldLabel label="Reason" required c={c} />
          <OptionPicker
            options={REPORT_REASONS}
            value={reason}
            onChange={setReason}
            c={c}
          />
        </View>
        <View>
          <FieldLabel label="Source (optional)" c={c} />
          <TextInput
            placeholder="e.g. Common Sense Media"
            placeholderTextColor={c.mutedForeground}
            value={source}
            onChangeText={setSource}
            style={[styles.textInput, { color: c.foreground, borderColor: c.border, backgroundColor: c.card }]}
          />
        </View>
        <View>
          <FieldLabel label="Details (optional)" c={c} />
          <TextInput
            placeholder="Describe the issue…"
            placeholderTextColor={c.mutedForeground}
            value={details}
            onChangeText={setDetails}
            multiline
            numberOfLines={3}
            style={[styles.textInput, styles.textArea, { color: c.foreground, borderColor: c.border, backgroundColor: c.card }]}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <Pressable
            onPress={handleClose}
            style={({ pressed }) => [
              styles.modalBtn,
              { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSubmit}
            disabled={!reason || createReport.isPending}
            style={({ pressed }) => [
              styles.modalBtn,
              { flex: 1, backgroundColor: c.primary, opacity: !reason || createReport.isPending ? 0.5 : pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={{ color: c.primaryForeground, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>
              {createReport.isPending ? 'Submitting…' : 'Submit report'}
            </Text>
          </Pressable>
        </View>
      </View>
    </ModalSheet>
  );
}

function SafetyContributeModal({
  visible,
  onClose,
  titleId,
  isMovie,
}: {
  visible: boolean;
  onClose: () => void;
  titleId: number;
  isMovie: boolean;
}) {
  const c = useColors();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState<(typeof SEVERITY_OPTIONS)[number] | ''>('');
  const [description, setDescription] = useState('');
  const [season, setSeason] = useState('');
  const [episode, setEpisode] = useState('');

  const createContribution = useCreateSafetyContribution();

  const reset = () => {
    setCategory('');
    setSeverity('');
    setDescription('');
    setSeason('');
    setEpisode('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    if (!category || !severity) return;
    createContribution.mutate(
      {
        id: titleId,
        data: {
          category,
          severity: severity as any,
          description: description || null,
          seasonNumber: season ? parseInt(season, 10) : null,
          episodeNumber: episode ? parseInt(episode, 10) : null,
        },
      },
      {
        onSuccess: () => {
          handleClose();
          queryClient.invalidateQueries({ queryKey: getGetTitleSafetyQueryKey({ titleId }) });
          Alert.alert('Contribution submitted', 'Your safety note is pending admin review. Thank you!');
        },
        onError: (err: any) => {
          const status = err?.response?.status;
          const msg =
            status === 429
              ? "You've reached the daily contribution limit. Try again tomorrow."
              : status === 403
              ? 'You need to watch at least 5 titles or episodes before contributing.'
              : 'Failed to submit. Please try again.';
          Alert.alert(status === 429 ? 'Too many requests' : 'Could not submit', msg);
        },
      },
    );
  };

  return (
    <ModalSheet visible={visible} onClose={handleClose} title="Contribute Safety Info">
      <View style={{ gap: 16 }}>
        <View>
          <FieldLabel label="Category" required c={c} />
          <TextInput
            placeholder="e.g. Violence, Language, Sex, Drugs…"
            placeholderTextColor={c.mutedForeground}
            value={category}
            onChangeText={setCategory}
            style={[styles.textInput, { color: c.foreground, borderColor: c.border, backgroundColor: c.card }]}
          />
        </View>
        <View>
          <FieldLabel label="Severity" required c={c} />
          <OptionPicker
            options={SEVERITY_OPTIONS.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
            value={severity}
            onChange={setSeverity}
            c={c}
          />
        </View>
        <View>
          <FieldLabel label="Description (optional)" c={c} />
          <TextInput
            placeholder="Brief description of the content…"
            placeholderTextColor={c.mutedForeground}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            style={[styles.textInput, styles.textArea, { color: c.foreground, borderColor: c.border, backgroundColor: c.card }]}
          />
        </View>
        {!isMovie ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <FieldLabel label="Season (optional)" c={c} />
              <TextInput
                placeholder="e.g. 2"
                placeholderTextColor={c.mutedForeground}
                value={season}
                onChangeText={setSeason}
                keyboardType="number-pad"
                style={[styles.textInput, { color: c.foreground, borderColor: c.border, backgroundColor: c.card }]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel label="Episode (optional)" c={c} />
              <TextInput
                placeholder="e.g. 5"
                placeholderTextColor={c.mutedForeground}
                value={episode}
                onChangeText={setEpisode}
                keyboardType="number-pad"
                style={[styles.textInput, { color: c.foreground, borderColor: c.border, backgroundColor: c.card }]}
              />
            </View>
          </View>
        ) : null}
        <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
          You must have watched ≥5 titles or episodes to contribute. Your identity is never attached to published contributions.
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            onPress={handleClose}
            style={({ pressed }) => [
              styles.modalBtn,
              { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSubmit}
            disabled={!category || !severity || createContribution.isPending}
            style={({ pressed }) => [
              styles.modalBtn,
              {
                flex: 1,
                backgroundColor: c.primary,
                opacity: !category || !severity || createContribution.isPending ? 0.5 : pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text style={{ color: c.primaryForeground, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>
              {createContribution.isPending ? 'Submitting…' : 'Submit for review'}
            </Text>
          </Pressable>
        </View>
      </View>
    </ModalSheet>
  );
}

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

function SafetySection({
  titleId,
  isSignedIn,
  isMovie,
}: {
  titleId: number;
  isSignedIn: boolean;
  isMovie: boolean;
}) {
  const c = useColors();
  const safety = useGetTitleSafety({ titleId });
  const [showReport, setShowReport] = useState(false);
  const [showContribute, setShowContribute] = useState(false);

  if (safety.isLoading) return <Loading />;
  if (safety.isError) {
    return <ErrorState onRetry={() => safety.refetch()} message="Couldn't load safety info" />;
  }

  const info = safety.data;
  if (!info) return null;

  return (
    <View style={{ paddingHorizontal: 16 }}>
      {/* Action buttons for signed-in users */}
      {isSignedIn ? (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <Pressable
            testID="report-safety-btn"
            onPress={() => setShowReport(true)}
            style={({ pressed }) => [
              styles.safetyActionBtn,
              { borderColor: c.border, backgroundColor: c.card, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="flag" size={13} color={c.mutedForeground} />
            <Text style={{ color: c.foreground, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
              Report issue
            </Text>
          </Pressable>
          <Pressable
            testID="contribute-safety-btn"
            onPress={() => setShowContribute(true)}
            style={({ pressed }) => [
              styles.safetyActionBtn,
              { borderColor: c.primary, backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Feather name="plus" size={13} color={c.primaryForeground} />
            <Text style={{ color: c.primaryForeground, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
              Contribute
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Summary chips */}
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

      <SafetyReportModal
        visible={showReport}
        onClose={() => setShowReport(false)}
        titleId={titleId}
      />
      <SafetyContributeModal
        visible={showContribute}
        onClose={() => setShowContribute(false)}
        titleId={titleId}
        isMovie={isMovie}
      />
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
      <SafetySection titleId={titleId} isSignedIn={!!isSignedIn} isMovie={t.type === 'movie'} />

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
  safetyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 0,
    maxHeight: '90%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#94a3b8',
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    marginBottom: 20,
  },
  modalBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: colors.radius,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: colors.radius,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
});
