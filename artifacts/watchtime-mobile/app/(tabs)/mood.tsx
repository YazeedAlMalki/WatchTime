import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { MOVIES, MOVIE_BY_ID, PRESETS } from '@/lib/discover-mood/data';
import { buildReasons, classify, countFailures } from '@/lib/discover-mood/engine';
import { getT } from '@/lib/discover-mood/i18n';
import { actions, useStore } from '@/lib/discover-mood/store';
import { useMoodDiscoverySync } from '@/lib/discover-mood/use-sync';
import {
  AGE_RANK,
  CONTENT_KEYS,
  CONTEXTS,
  MOOD_KEYS,
  PROVIDERS,
  REGIONS,
  type AccessType,
  type Movie,
  type MoodImportance,
  type ResultSort,
  type StoreState,
} from '@/lib/discover-mood/types';

const PAGE = 8;
type Stage = 'start' | 'tune' | 'results' | 'collection';
type Colors = ReturnType<typeof useColors>;
type T = (key: string, params?: Record<string, string | number>) => string;
const SORTS: ResultSort[] = ['match', 'shortest', 'newest', 'rated', 'surprise'];
const FEEDBACK = ['tooIntense', 'tooSlow', 'tooSad', 'wrongMood', 'hideSimilar'];
const OTHER_LANGUAGES = ['fr', 'es', 'hi', 'de'];
const AGES = ['G', 'PG', 'PG-13', 'R', '18', 'any'];
const LIMIT_LABEL = ['content.none', 'content.mild', 'content.moderate', 'content.strong', 'content.any'];
const tog = (a: string[], v: string) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]);
const tap = () => {
  if (Platform.OS !== 'web') void Haptics.selectionAsync();
};

/* ---------- primitives ---------- */
function Chip({ label, on, onPress, testID, a11y, disabled, c, rtl }: {
  label: string; on: boolean; onPress: () => void; testID: string; a11y?: string; disabled?: boolean; c: Colors; rtl: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ selected: on, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [s.chip, {
        backgroundColor: on ? c.primary : c.secondary,
        borderColor: on ? c.primary : c.border,
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
      }]}
    >
      <Text style={[s.chipText, { color: on ? c.primaryForeground : c.secondaryForeground, writingDirection: rtl ? 'rtl' : 'ltr' }]}>{label}</Text>
    </Pressable>
  );
}

function Btn({ label, onPress, testID, a11y, kind = 'primary', icon, c }: {
  label: string; onPress: () => void; testID: string; a11y?: string; kind?: 'primary' | 'outline' | 'ghost'; icon?: keyof typeof Feather.glyphMap; c: Colors;
}) {
  const fg = kind === 'primary' ? c.primaryForeground : c.foreground;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [s.btn, {
        backgroundColor: kind === 'primary' ? c.primary : 'transparent',
        borderColor: kind === 'outline' ? c.border : 'transparent',
        opacity: pressed ? 0.75 : 1,
      }]}
    >
      {icon ? <Feather name={icon} size={15} color={fg} /> : null}
      <Text style={[s.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

function Toggle({ label, value, onChange, testID, c, rtl }: {
  label: string; value: boolean; onChange: (v: boolean) => void; testID: string; c: Colors; rtl: boolean;
}) {
  return (
    <View style={[s.toggleRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
      <Text style={[s.body, { color: c.foreground, flex: 1, textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }]}>{label}</Text>
      <Switch
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onValueChange={(v) => { tap(); onChange(v); }}
        trackColor={{ true: c.primary, false: c.muted }}
        thumbColor={c.foreground}
      />
    </View>
  );
}

function Section({ title, hint, children, testID, initiallyOpen = false, c, rtl }: {
  title: string; hint?: string; children: React.ReactNode; testID: string; initiallyOpen?: boolean; c: Colors; rtl: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const ta: TextStyle = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' };
  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Pressable
        testID={`toggle-${testID}`}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10 }}
      >
        <View style={{ flex: 1 }}>
          <Text style={[s.h3, ta, { color: c.foreground }]}>{title}</Text>
          {hint ? <Text style={[s.small, ta, { color: c.mutedForeground, marginTop: 2 }]}>{hint}</Text> : null}
        </View>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.mutedForeground} />
      </Pressable>
      {open ? <View style={{ marginTop: 14 }}>{children}</View> : null}
    </View>
  );
}

function Wrap({ children, rtl }: { children: React.ReactNode; rtl: boolean }) {
  return <View style={[s.wrap, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>{children}</View>;
}

/* ---------- mood target track (no third-party slider) ---------- */
function TargetTrack({ value, active, onChange, label, c, rtl, testID }: {
  value: number; active: boolean; onChange: (v: number) => void; label: string; c: Colors; rtl: boolean; testID: string;
}) {
  const steps = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  return (
    <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
      <Pressable testID={`${testID}-dec`} accessibilityRole="button" accessibilityLabel={`${label} -5`} onPress={() => onChange(value - 5)} style={[s.stepBtn, { borderColor: c.border }]}>
        <Feather name="minus" size={14} color={c.foreground} />
      </Pressable>
      <View
        style={{ flex: 1, flexDirection: rtl ? 'row-reverse' : 'row', height: 28, alignItems: 'center', gap: 2 }}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(value + (e.nativeEvent.actionName === 'increment' ? 5 : -5))}
      >
        {steps.map((st) => (
          <Pressable
            key={st}
            testID={`${testID}-${st}`}
            accessibilityLabel={`${label} ${st}`}
            onPress={() => { tap(); onChange(st); }}
            style={{ flex: 1, height: 28, justifyContent: 'center' }}
          >
            <View style={{ height: st <= value ? 8 : 4, borderRadius: 4, backgroundColor: st <= value ? (active ? c.primary : c.mutedForeground) : c.muted }} />
          </Pressable>
        ))}
      </View>
      <Pressable testID={`${testID}-inc`} accessibilityRole="button" accessibilityLabel={`${label} +5`} onPress={() => onChange(value + 5)} style={[s.stepBtn, { borderColor: c.border }]}>
        <Feather name="plus" size={14} color={c.foreground} />
      </Pressable>
    </View>
  );
}

/* ---------- movie card ---------- */
function MovieCard({ movie, score, reasons, note, state, t, c, rtl, mode = 'result' }: {
  movie: Movie; score: number; reasons?: string[]; note?: string; state: StoreState; t: T; c: Colors; rtl: boolean; mode?: 'result' | 'dismissed' | 'saved';
}) {
  const [open, setOpen] = useState(false);
  const viewed = state.viewed[movie.id];
  const saved = state.saved.includes(movie.id);
  const fb = state.session.feedback[movie.id] ?? [];
  const ta: TextStyle = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' };
  const row: ViewStyle = { flexDirection: rtl ? 'row-reverse' : 'row' };
  const avail = movie.availability.find((a) => a.region === state.filters.region);
  const availText = avail
    ? t('results.provider', { region: t(`region.${state.filters.region}`), provider: avail.provider, kind: t(`kind.${avail.kind}`) })
    : `${t('d.avail.none')} (${t('demoShort')})`;
  return (
    <View testID={`card-movie-${movie.id}`} style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={[row, { gap: 12 }]}>
        <Image source={{ uri: movie.posterUrl }} style={[s.poster, { backgroundColor: c.muted }]} contentFit="cover" accessibilityLabel={movie.title} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.h3, ta, { color: c.foreground }]} numberOfLines={2}>{movie.title}</Text>
          <Text style={[s.small, ta, { color: c.mutedForeground, marginTop: 2 }]}>
            {movie.year} · {t('min', { n: movie.runtimeMinutes })} · {movie.genres.map((g) => t(`g.${g}`)).join(', ')}
          </Text>
          <View style={[row, { gap: 6, marginTop: 8, flexWrap: 'wrap' }]}>
            <View style={[s.badge, { backgroundColor: c.primary }]}>
              <Text style={[s.badgeText, { color: c.primaryForeground }]}>{t('match', { n: score })}</Text>
            </View>
            <View style={[s.badge, { borderColor: c.border, borderWidth: 1 }]} accessibilityLabel={`${t('results.age')}: ${movie.ageRating}`}>
              <Text style={[s.badgeText, { color: c.foreground }]}>{t('results.age')}: {t(`age.${movie.ageRating}`)}</Text>
            </View>
          </View>
        </View>
      </View>
       <Text style={[s.small, ta, { color: c.foreground, marginTop: 10 }]}>
         {state.lang === 'ar'
           ? t('movie.summaryAr', {
               genre: t(`g.${movie.genres[0] ?? 'drama'}`),
               mood: t(`mood.${movie.mood.feelGood >= 50 ? 'high.feelGood' : 'low.feelGood'}`),
             })
           : movie.summary}
       </Text>
      <View style={[row, { gap: 6, marginTop: 8, alignItems: 'flex-start' }]}>
        <Feather name="alert-triangle" size={12} color={c.severityMild} style={{ marginTop: 2 }} />
        <Text style={[s.tiny, ta, { color: c.mutedForeground, flex: 1 }]}>{availText}</Text>
      </View>
      {note ? <Text style={[s.small, ta, { color: c.severityModerate, marginTop: 8 }]}>{note}</Text> : null}
      {reasons && reasons.length ? (
        <View style={{ marginTop: 10, gap: 4 }} testID={`reasons-${movie.id}`}>
          <Text style={[s.label, ta, { color: c.primary }]}>{t('why')}</Text>
          {reasons.map((r, i) => (
            <View key={i} style={[row, { gap: 6 }]}>
              <Feather name="check" size={12} color={c.severityNone} style={{ marginTop: 3 }} />
              <Text style={[s.small, ta, { color: c.foreground, flex: 1 }]}>{r}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={[row, { gap: 8, marginTop: 12, flexWrap: 'wrap' }]}>
        {mode === 'dismissed' ? (
          <Chip c={c} rtl={rtl} testID={`button-restore-${movie.id}`} label={t('i.restore')} a11y={`${t('i.restore')} ${movie.title}`} on={false} onPress={() => actions.restore(movie.id)} />
        ) : (
          <>
            <Chip c={c} rtl={rtl} testID={`button-save-${movie.id}`} label={saved ? t('saved') : t('save')} a11y={`${saved ? t('saved') : t('save')} ${movie.title}`} on={saved} onPress={() => actions.toggleSaved(movie.id)} />
            <Chip c={c} rtl={rtl} testID={`button-dismiss-${movie.id}`} label={t('dismiss')} a11y={`${t('dismiss')} ${movie.title}`} on={false} onPress={() => actions.dismiss(movie.id)} />
          </>
        )}
        <Chip c={c} rtl={rtl} testID={`button-watched-${movie.id}`} label={viewed?.watched ? t('unwatch') : t('watched')} a11y={`${viewed?.watched ? t('unwatch') : t('watched')} ${movie.title}`} on={!!viewed?.watched} onPress={() => actions.setWatched(movie.id, !viewed?.watched)} />
        <Chip c={c} rtl={rtl} testID={`button-more-${movie.id}`} label={t('view')} a11y={`${t('view')} ${movie.title}`} on={open} onPress={() => { if (!open) actions.markViewed(movie.id); setOpen(!open); }} />
      </View>

      {open ? (
        <View style={{ marginTop: 12, gap: 10 }}>
          <Text style={[s.label, ta, { color: c.mutedForeground }]}>{t('d.rate')}</Text>
          <View style={[row, { gap: 4, alignItems: 'center' }]}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} testID={`button-rate-${movie.id}-${n}`} accessibilityRole="button" accessibilityLabel={`${movie.title}: ${t('fav', { n })}`} accessibilityState={{ selected: (viewed?.rating ?? 0) >= n }} onPress={() => { tap(); actions.setRating(movie.id, n); }} hitSlop={6} style={{ padding: 4 }}>
                <Feather name="star" size={22} color={(viewed?.rating ?? 0) >= n ? c.primary : c.mutedForeground} />
              </Pressable>
            ))}
            {viewed?.rating ? (
              <Pressable testID={`button-rate-clear-${movie.id}`} accessibilityRole="button" accessibilityLabel={t('d.rate.clear')} onPress={() => actions.setRating(movie.id, undefined)} style={{ paddingHorizontal: 8 }}>
                <Text style={[s.small, { color: c.mutedForeground }]}>{t('d.rate.clear')}</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={[s.label, ta, { color: c.mutedForeground }]}>{t('d.feedback')}</Text>
          <Wrap rtl={rtl}>
            {FEEDBACK.map((tag) => (
              <Chip key={tag} c={c} rtl={rtl} testID={`button-feedback-${movie.id}-${tag}`} label={t(`feedback.${tag}`)} a11y={`${t(`feedback.${tag}`)}, ${movie.title}`} on={fb.includes(tag)} onPress={() => actions.toggleFeedback(movie.id, tag)} />
            ))}
          </Wrap>
          <Text style={[s.tiny, ta, { color: c.mutedForeground }]}>{t('d.demoWarn')}</Text>
        </View>
      ) : null}
    </View>
  );
}

/* ---------- screen ---------- */
export default function MoodScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const state = useStore();
  useMoodDiscoverySync(state);
  const { t, dir } = getT(state.lang);
  const rtl = dir === 'rtl';
  const [stage, setStage] = useState<Stage | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const scrollRef = useRef<ScrollView>(null);
  const f = state.filters;
  const ta: TextStyle = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' };
  const row: ViewStyle = { flexDirection: rtl ? 'row-reverse' : 'row' };
  const bottomPad = (Platform.OS === 'web' ? 84 : insets.bottom + 56) + 24;

  const ranked = useMemo(() => classify(MOVIES, f, state), [f, state.viewed, state.dismissed, state.saved, state.session]); // eslint-disable-line react-hooks/exhaustive-deps
  const failures = useMemo(() => countFailures(MOVIES, f, state), [f, state.viewed, state.dismissed, state.session]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (next: Stage) => {
    setStage(next);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };
  const current: Stage = stage ?? (state.session.started ? 'results' : 'start');

  const Banner = (
    <View testID="banner-demo-warning" accessibilityRole="alert" style={[s.banner, row, { borderColor: c.severityMild, backgroundColor: c.muted }]}>
      <Feather name="alert-triangle" size={16} color={c.severityMild} style={{ marginTop: 1 }} />
      <Text style={[s.small, ta, { color: c.foreground, flex: 1 }]}>{t('demoBanner')}</Text>
    </View>
  );

  if (!state.hydrated) {
    return (
      <View style={[s.root, { backgroundColor: c.background, padding: 16 }]}>
        {Banner}
        <View style={{ alignItems: 'center', paddingVertical: 48 }} testID="mood-loading">
          <ActivityIndicator color={c.primary} />
        </View>
      </View>
    );
  }

  const moodKeys = MOOD_KEYS.filter((k) => f.active[k]);
  const selectedPreset = PRESETS.find((p) => p.id === f.preset);

  /* recovery: convenience filters only — never age/content */
  const suggestions: { id: string; label: string; run: () => void }[] = [];
  if (f.maxRuntime < 240) {
    const next = Math.min(240, f.maxRuntime + 30);
    suggestions.push({ id: 'runtime', label: next === 240 ? t('act.runtimeAny') : t('act.runtime', { n: next }), run: () => actions.patchFilters({ maxRuntime: next }) });
  }
  if (f.providers.length) suggestions.push({ id: 'providers', label: t('none.moreProviders'), run: () => actions.patchFilters({ providers: [] }) });
  if (f.accessTypes.length < 3) suggestions.push({ id: 'access-types', label: t('none.relaxAccess'), run: () => actions.patchFilters({ accessTypes: ['stream', 'rent', 'buy'] }) });
  if (f.languages.length || f.requireArabicSubtitles || f.requireArabicDubbing || f.originalAudioOnly) {
    suggestions.push({ id: 'language', label: t('act.languages'), run: () => actions.patchFilters({ languages: [], requireArabicSubtitles: false, requireArabicDubbing: false, originalAudioOnly: false }) });
  }
  if (f.hideWatched) suggestions.push({ id: 'watched', label: t('act.watched'), run: () => actions.patchFilters({ hideWatched: false, includeComfortRewatches: true }) });
  if (f.hideDismissed && state.dismissed.length) suggestions.push({ id: 'dismissed', label: t('hist.dismissed'), run: () => actions.patchFilters({ hideDismissed: false }) });
  if (f.avoidPoorMatches && Object.values(state.viewed).some((v) => (v.rating ?? 5) <= 2)) {
    suggestions.push({ id: 'poor-history', label: t('none.allowPoor'), run: () => actions.patchFilters({ avoidPoorMatches: false }) });
  }
  const hidden = Object.entries(state.session.feedback).filter(([, tags]) => tags.includes('hideSimilar')).map(([id]) => id);
  if (hidden.length) suggestions.push({ id: 'feedback-similar', label: t('none.showSimilar'), run: () => hidden.forEach((id) => actions.toggleFeedback(id, 'hideSimilar')) });
  const strict = MOOD_KEYS.filter((k) => f.active[k] && f.importance[k] === 3);
  if (strict.length) {
    suggestions.push({ id: 'must-match', label: `${t('importance.important')}: ${strict.map((k) => t(`mood.${k}`)).join(', ')}`, run: () => strict.forEach((k) => actions.setImportance(k, 2)) });
  }

  const restrictions = [
    { key: 'runtime', ids: ['runtime'] },
    { key: 'providers', ids: ['provider'] },
    { key: 'access', ids: ['access', 'region'] },
    { key: 'language', ids: ['language'] },
    { key: 'content', ids: CONTENT_KEYS.map((k) => `c:${k}`) },
    { key: 'age', ids: ['age'] },
    { key: 'history', ids: ['watched', 'dismissed', 'poorHistory', 'feedbackSimilar'] },
    { key: 'must', ids: MOOD_KEYS.map((k) => `must:${k}`) },
  ].map(({ key, ids }) => ({ key, count: failures.filter(([x]) => ids.includes(x)).reduce((a, [, n]) => a + n, 0) })).filter((x) => x.count > 0);

  const showResults = () => {
    actions.startSession();
    setLimit(PAGE);
    go('results');
  };
  const newSession = () => {
    actions.resetForNewSession();
    setLimit(PAGE);
    go('start');
  };

  const heading = current === 'start' ? t('header.start') : current === 'tune' ? t('header.tune') : current === 'collection' ? t('i.title') : t('title');
  const shown = ranked.results.slice(0, limit);
  const ageOptions = [...AGES].sort((a, b) => (a === 'any' ? 99 : AGE_RANK[a]) - (b === 'any' ? 99 : AGE_RANK[b]));

  return (
    <View style={[s.root, { backgroundColor: c.background }]}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 16, paddingBottom: bottomPad, gap: 14 }} testID="screen-mood" keyboardShouldPersistTaps="handled">
        {Banner}
        {state.storageError ? (
          <View testID="banner-storage-error" accessibilityRole="alert" style={[s.banner, row, { borderColor: c.destructive, backgroundColor: c.muted }]}>
            <Feather name="hard-drive" size={16} color={c.destructive} style={{ marginTop: 1 }} />
            <Text style={[s.small, ta, { color: c.foreground, flex: 1 }]}>{t('storage.unavailable')}</Text>
          </View>
        ) : null}

        <View style={[row, { alignItems: 'center', gap: 8 }]}>
          <Text style={[s.h1, ta, { color: c.foreground, flex: 1 }]} accessibilityRole="header">{heading}</Text>
          <Pressable testID="button-lang-toggle" accessibilityRole="button" accessibilityLabel={t('lang.toggle')} onPress={() => actions.setLang(state.lang === 'en' ? 'ar' : 'en')} style={[s.pill, { borderColor: c.border }]}>
            <Feather name="globe" size={13} color={c.foreground} />
            <Text style={[s.small, { color: c.foreground }]}>{t('lang.toggle')}</Text>
          </Pressable>
        </View>

        <View style={[row, { gap: 8, flexWrap: 'wrap' }]}>
          <Chip c={c} rtl={rtl} testID="nav-discover" label={t('nav.discover')} on={current !== 'collection'} onPress={() => go(state.session.started ? 'results' : 'start')} />
          <Chip c={c} rtl={rtl} testID="nav-collection" label={`${t('i.tab.saved')} (${state.saved.length}) · ${t('i.tab.dismissed')} (${state.dismissed.length})`} on={current === 'collection'} onPress={() => go('collection')} />
        </View>

        {current === 'start' ? (
          <View style={{ gap: 12 }} testID="screen-start">
            <Text style={[s.body, ta, { color: c.mutedForeground }]}>{t('subtitle')}</Text>
            <Text style={[s.h2, ta, { color: c.foreground }]}>{t('step.mood')}</Text>
            {PRESETS.map((p) => {
              const on = f.preset === p.id;
              return (
                <Pressable
                  key={p.id}
                  testID={`button-preset-${p.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${t(`p.${p.id}`)}. ${t(`p.${p.id}.d`)}`}
                  accessibilityState={{ selected: on }}
                  onPress={() => { tap(); actions.applyPreset(p.id); }}
                  style={({ pressed }) => [s.card, row, { gap: 12, alignItems: 'center', backgroundColor: c.card, borderColor: on ? c.primary : c.border, borderWidth: on ? 2 : 1, opacity: pressed ? 0.8 : 1 }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.h3, ta, { color: c.foreground }]}>{t(`p.${p.id}`)}</Text>
                    <Text style={[s.small, ta, { color: c.mutedForeground, marginTop: 2 }]}>{t(`p.${p.id}.d`)}</Text>
                  </View>
                  <Feather name={on ? 'check-circle' : 'circle'} size={20} color={on ? c.primary : c.border} />
                </Pressable>
              );
            })}
            {selectedPreset ? (
              <View testID="panel-preset-confirmation" style={[s.card, { borderColor: c.primary, backgroundColor: c.card, gap: 10 }]}>
                <Text style={[s.body, ta, { color: c.foreground }]} accessibilityLiveRegion="polite">{t('preset.confirm', { name: t(`p.${selectedPreset.id}`) })}</Text>
                <View style={[row, { gap: 8, flexWrap: 'wrap' }]}>
                  <Btn c={c} testID="button-find-my-movie" label={t('preset.find')} icon="arrow-right" onPress={showResults} />
                  <Btn c={c} testID="button-fine-tune" kind="outline" label={t('preset.tune')} icon="sliders" onPress={() => go('tune')} />
                </View>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <Text style={[s.small, ta, { color: c.mutedForeground }]}>{t('results.start')}</Text>
                <View style={row}><Btn c={c} testID="button-fine-tune" kind="outline" label={t('preset.tune')} icon="sliders" onPress={() => go('tune')} /></View>
              </View>
            )}
            <Text style={[s.tiny, ta, { color: c.mutedForeground }]}>{t('how.body')}</Text>
          </View>
        ) : null}

        {current === 'tune' ? (
          <View style={{ gap: 12 }} testID="screen-tune">
            <View style={row}><Btn c={c} testID="button-back-to-moods" kind="ghost" icon={rtl ? 'arrow-right' : 'arrow-left'} label={t('t.back')} onPress={() => go('start')} /></View>

            <Section c={c} rtl={rtl} testID="section-moods" title={t('sec.moods')} hint={t('sec.moods.d')} initiallyOpen>
              <View style={{ gap: 12 }}>
                {MOOD_KEYS.map((k) => {
                  const label = t(`mood.${k}`);
                  const active = f.active[k];
                  return (
                    <View key={k} testID={`control-mood-${k}`} style={[s.inner, { borderColor: c.border, backgroundColor: c.background }]}>
                      <View style={[row, { alignItems: 'center', gap: 8 }]}>
                        <Text style={[s.label, ta, { color: c.foreground, flex: 1 }]}>{label}</Text>
                        <Text style={[s.small, { color: active ? c.primary : c.mutedForeground }]}>{active ? t('slider.target', { n: f.targets[k] }) : t('slider.off')}</Text>
                        <Switch testID={`switch-mood-${k}`} accessibilityLabel={t('slider.use', { label })} value={active} onValueChange={(v) => actions.setActive(k, v)} trackColor={{ true: c.primary, false: c.muted }} thumbColor={c.foreground} />
                      </View>
                      <TargetTrack c={c} rtl={rtl} testID={`slider-mood-${k}`} label={`${label}: ${t(`mood.low.${k}`)} - ${t(`mood.high.${k}`)}`} value={f.targets[k]} active={active} onChange={(v) => actions.setTarget(k, v)} />
                      <View style={[row, { justifyContent: 'space-between', marginTop: 2 }]}>
                        <Text style={[s.tiny, { color: c.mutedForeground }]}>{t(`mood.low.${k}`)}</Text>
                        <Text style={[s.tiny, { color: c.mutedForeground }]}>{t(`mood.high.${k}`)}</Text>
                      </View>
                      <Text style={[s.tiny, ta, { color: c.mutedForeground, marginTop: 8 }]}>{t('importance.title')}</Text>
                      <Wrap rtl={rtl}>
                        {([1, 2, 3] as MoodImportance[]).map((imp) => {
                          const name = t(`importance.${imp === 1 ? 'nice' : imp === 2 ? 'important' : 'must'}`);
                          return <Chip key={imp} c={c} rtl={rtl} testID={`chip-importance-${k}-${imp}`} label={name} a11y={`${label}: ${name}`} on={active && f.importance[k] === imp} disabled={!active} onPress={() => actions.setImportance(k, imp)} />;
                        })}
                      </Wrap>
                    </View>
                  );
                })}
                <Text style={[s.tiny, ta, { color: c.mutedForeground }]}>{t('importance.help')}</Text>
                <View style={row}><Btn c={c} testID="button-reset-moods" kind="ghost" icon="x" label={t('reset.moods')} onPress={() => actions.resetMoods()} /></View>
              </View>
            </Section>

            <Section c={c} rtl={rtl} testID="section-runtime" title={t('sec.runtime')}>
              <Wrap rtl={rtl}>
                <Chip c={c} rtl={rtl} testID="chip-runtime-90" label={t('runtime.under90')} on={f.maxRuntime === 89} onPress={() => actions.patchFilters({ maxRuntime: 89 })} />
                <Chip c={c} rtl={rtl} testID="chip-runtime-120" label={t('runtime.under120')} on={f.maxRuntime === 119} onPress={() => actions.patchFilters({ maxRuntime: 119 })} />
                <Chip c={c} rtl={rtl} testID="chip-runtime-any" label={t('runtime.any')} on={f.maxRuntime === 240} onPress={() => actions.patchFilters({ maxRuntime: 240 })} />
              </Wrap>
              <View style={[row, { alignItems: 'center', gap: 10, marginTop: 12 }]}>
                <Pressable testID="button-runtime-dec" accessibilityRole="button" accessibilityLabel={`${t('runtime.custom')} -10`} onPress={() => actions.patchFilters({ maxRuntime: Math.max(60, (f.maxRuntime === 240 ? 130 : f.maxRuntime) - 10) })} style={[s.stepBtn, { borderColor: c.border }]}>
                  <Feather name="minus" size={14} color={c.foreground} />
                </Pressable>
                <Text testID="text-runtime-value" style={[s.label, { color: c.foreground, flex: 1, textAlign: 'center' }]}>{f.maxRuntime === 240 ? t('runtime.any') : t('runtime.custom.value', { n: f.maxRuntime })}</Text>
                <Pressable testID="button-runtime-inc" accessibilityRole="button" accessibilityLabel={`${t('runtime.custom')} +10`} onPress={() => actions.patchFilters({ maxRuntime: Math.min(240, f.maxRuntime + 10) })} style={[s.stepBtn, { borderColor: c.border }]}>
                  <Feather name="plus" size={14} color={c.foreground} />
                </Pressable>
              </View>
            </Section>

            <Section c={c} rtl={rtl} testID="section-context" title={t('sec.context')} hint={t('ctx.note')}>
              <Wrap rtl={rtl}>
                {CONTEXTS.map((x) => <Chip key={x} c={c} rtl={rtl} testID={`chip-context-${x}`} label={t(`ctx.${x}`)} on={f.context === x} onPress={() => actions.patchFilters({ context: x })} />)}
              </Wrap>
            </Section>

            <Section c={c} rtl={rtl} testID="section-language" title={t('sec.language')} hint={t('sec.language.d')}>
              <Text style={[s.tiny, ta, { color: c.mutedForeground, marginBottom: 6 }]}>{t('language.primary')}</Text>
              <Wrap rtl={rtl}>
                {['ar', 'en', 'ko', 'ja'].map((l) => <Chip key={l} c={c} rtl={rtl} testID={`chip-language-${l}`} label={t(`lang.${l}`)} on={f.languages.includes(l)} onPress={() => actions.patchFilters({ languages: tog(f.languages, l) })} />)}
                <Chip
                  c={c} rtl={rtl} testID="chip-language-other"
                  label={`${t('language.other')} (${OTHER_LANGUAGES.map((l) => t(`lang.${l}`)).join(', ')})`}
                  on={OTHER_LANGUAGES.every((l) => f.languages.includes(l))}
                  onPress={() => {
                    const has = OTHER_LANGUAGES.every((l) => f.languages.includes(l));
                    actions.patchFilters({ languages: has ? f.languages.filter((l) => !OTHER_LANGUAGES.includes(l)) : [...new Set([...f.languages, ...OTHER_LANGUAGES])] });
                  }}
                />
              </Wrap>
              <View style={{ marginTop: 8 }}>
                <Toggle c={c} rtl={rtl} testID="switch-accept-subs" label={t('accept.subs')} value={f.acceptSubs} onChange={(v) => actions.patchFilters({ acceptSubs: v })} />
                <Toggle c={c} rtl={rtl} testID="switch-accept-dub" label={t('accept.dub')} value={f.acceptDub} onChange={(v) => actions.patchFilters({ acceptDub: v })} />
                <Toggle c={c} rtl={rtl} testID="switch-arabic-subs" label={t('language.arSubs')} value={f.requireArabicSubtitles} onChange={(v) => actions.patchFilters({ requireArabicSubtitles: v })} />
                <Toggle c={c} rtl={rtl} testID="switch-arabic-dub" label={t('language.arDub')} value={f.requireArabicDubbing} onChange={(v) => actions.patchFilters({ requireArabicDubbing: v })} />
                <Toggle c={c} rtl={rtl} testID="switch-original-audio" label={t('language.original')} value={f.originalAudioOnly} onChange={(v) => actions.patchFilters({ originalAudioOnly: v })} />
              </View>
            </Section>

            <Section c={c} rtl={rtl} testID="section-region" title={t('sec.region')} hint={t('availability.region', { region: t(`region.${f.region}`) })}>
              <Wrap rtl={rtl}>
                {REGIONS.map((r) => <Chip key={r} c={c} rtl={rtl} testID={`chip-region-${r}`} label={t(`region.${r}`)} on={f.region === r} onPress={() => actions.patchFilters({ region: r })} />)}
              </Wrap>
            </Section>

            <Section c={c} rtl={rtl} testID="section-providers" title={t('sec.providers')} hint={t('prov.any')}>
              <Wrap rtl={rtl}>
                {PROVIDERS.map((p) => <Chip key={p} c={c} rtl={rtl} testID={`chip-provider-${p.replace(/\W/g, '')}`} label={p} on={f.providers.includes(p)} onPress={() => actions.patchFilters({ providers: tog(f.providers, p) })} />)}
              </Wrap>
              <Text style={[s.tiny, ta, { color: c.mutedForeground, marginTop: 12, marginBottom: 6 }]}>{t('availability.types')}</Text>
              <Wrap rtl={rtl}>
                {(['stream', 'rent', 'buy'] as AccessType[]).map((ty) => (
                  <Chip key={ty} c={c} rtl={rtl} testID={`chip-availability-${ty}`} label={t(`availability.${ty === 'stream' ? 'subscription' : ty}`)} on={f.accessTypes.includes(ty)} onPress={() => actions.patchFilters({ accessTypes: tog(f.accessTypes, ty) as AccessType[] })} />
                ))}
                <Chip c={c} rtl={rtl} testID="chip-availability-any" label={t('availability.any')} on={f.providers.length === 0 && f.accessTypes.length === 3} onPress={() => actions.patchFilters({ providers: [], accessTypes: ['stream', 'rent', 'buy'] })} />
              </Wrap>
            </Section>

            <Section c={c} rtl={rtl} testID="section-content" title={t('sec.content')} hint={t('content.note')}>
              <Text style={[s.tiny, ta, { color: c.mutedForeground, marginBottom: 10 }]}>{t('content.help')}</Text>
              <View style={{ gap: 12 }}>
                <View>
                  <Text style={[s.label, ta, { color: c.foreground, marginBottom: 6 }]}>{t('age.title')}</Text>
                  <Wrap rtl={rtl}>
                    {ageOptions.map((a) => <Chip key={a} c={c} rtl={rtl} testID={`chip-age-${a}`} label={t(`age.${a}`)} a11y={`${t('age.title')}: ${t(`age.${a}`)}`} on={f.maxAgeRating === a} onPress={() => actions.patchFilters({ maxAgeRating: a })} />)}
                  </Wrap>
                </View>
                {CONTENT_KEYS.map((k) => (
                  <View key={k}>
                    <Text style={[s.label, ta, { color: c.foreground, marginBottom: 6 }]}>{t(`content.${k}`)}</Text>
                    <Wrap rtl={rtl}>
                      {[0, 1, 2, 3, 4].map((lv) => <Chip key={lv} c={c} rtl={rtl} testID={`chip-limit-${k}-${lv}`} label={t(LIMIT_LABEL[lv])} a11y={`${t(`content.${k}`)}: ${t(LIMIT_LABEL[lv])}`} on={f.limits[k] === lv} onPress={() => actions.setLimit(k, lv)} />)}
                    </Wrap>
                  </View>
                ))}
              </View>
            </Section>

            <Section c={c} rtl={rtl} testID="section-history" title={t('sec.history')} hint={t('hist.note')}>
              <Toggle c={c} rtl={rtl} testID="switch-history-hideWatched" label={t('hideWatched')} value={f.hideWatched} onChange={(v) => actions.patchFilters({ hideWatched: v })} />
              <Toggle c={c} rtl={rtl} testID="switch-history-includeHighlyRated" label={t('hist.highly')} value={f.includeHighlyRated} onChange={(v) => actions.patchFilters({ includeHighlyRated: v })} />
              <Toggle c={c} rtl={rtl} testID="switch-history-includeComfortRewatches" label={t('hist.rewatches')} value={f.includeComfortRewatches} onChange={(v) => actions.patchFilters({ includeComfortRewatches: v })} />
              <Toggle c={c} rtl={rtl} testID="switch-history-hideDismissed" label={t('hist.dismissed')} value={f.hideDismissed} onChange={(v) => actions.patchFilters({ hideDismissed: v })} />
              <Toggle c={c} rtl={rtl} testID="switch-history-avoidPoorMatches" label={t('hist.poor')} value={f.avoidPoorMatches} onChange={(v) => actions.patchFilters({ avoidPoorMatches: v })} />
            </Section>

            <View style={row}><Btn c={c} testID="button-reset-all" kind="outline" icon="rotate-ccw" label={t('reset.all')} onPress={() => actions.resetAllFilters()} /></View>

            <View style={[s.card, row, { alignItems: 'center', gap: 10, backgroundColor: c.card, borderColor: c.primary }]}>
              <Text testID="text-live-match-count" accessibilityLiveRegion="polite" style={[s.label, ta, { color: c.foreground, flex: 1 }]}>{t('t.count', { n: ranked.results.length })}</Text>
              <Btn c={c} testID="button-show-matches" label={t('t.show')} icon={rtl ? 'arrow-left' : 'arrow-right'} onPress={showResults} />
            </View>
          </View>
        ) : null}

        {current === 'results' ? (
          <View style={{ gap: 12 }} testID="screen-results">
            <Text testID="text-results-count" accessibilityLiveRegion="polite" style={[s.h2, ta, { color: c.foreground }]}>{t('results.heading', { n: ranked.results.length })}</Text>
            <Text style={[s.small, ta, { color: c.mutedForeground }]}>
              {[selectedPreset ? t(`p.${selectedPreset.id}`) : '', ...moodKeys.slice(0, 3).map((k) => `${t(`mood.${k}`)} ${f.targets[k]}`)].filter(Boolean).join(' · ') || t('results.hardNote')}
            </Text>
            <Text style={[s.tiny, ta, { color: c.mutedForeground }]}>{t('sort.label')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[row, { gap: 0 }]}>
              {SORTS.map((so) => <Chip key={so} c={c} rtl={rtl} testID={`chip-sort-${so}`} label={t(`sort.${so}`)} a11y={`${t('sort.label')}: ${t(`sort.${so}`)}`} on={state.session.sort === so} onPress={() => { actions.setSort(so); setLimit(PAGE); }} />)}
            </ScrollView>
            <View style={[row, { gap: 8, flexWrap: 'wrap' }]}>
              <Btn c={c} testID="button-refine" kind="outline" icon="sliders" label={t('t.refine')} onPress={() => go('tune')} />
              <Btn c={c} testID="button-new-session" kind="ghost" icon="rotate-ccw" label={t('t.reset')} onPress={newSession} />
            </View>

            {ranked.results.length === 0 ? (
              <View testID="empty-no-results" style={[s.card, { borderColor: c.border, borderStyle: 'dashed', backgroundColor: c.card, gap: 10 }]}>
                <View style={{ alignItems: 'center' }}><Feather name="search" size={30} color={c.mutedForeground} /></View>
                <Text style={[s.h3, { color: c.foreground, textAlign: 'center', writingDirection: rtl ? 'rtl' : 'ltr' }]}>{t('none.headline')}</Text>
                <Text style={[s.small, { color: c.mutedForeground, textAlign: 'center', writingDirection: rtl ? 'rtl' : 'ltr' }]}>{t('none.body')}</Text>
                <Text testID="text-safety-unchanged" style={[s.small, { color: c.primary, textAlign: 'center', writingDirection: rtl ? 'rtl' : 'ltr' }]}>{t('none.safety')}</Text>
                {restrictions.length ? (
                  <View testID="list-result-restrictions" style={{ gap: 6 }}>
                    <Text style={[s.label, ta, { color: c.foreground }]}>{t('none.restrictions')}</Text>
                    {restrictions.map((r) => (
                      <Text key={r.key} style={[s.small, ta, s.restriction, { color: c.mutedForeground, backgroundColor: c.secondary }]}>{t(`none.${r.key}`, { n: r.count })}</Text>
                    ))}
                  </View>
                ) : null}
                <Text style={[s.label, ta, { color: c.foreground }]}>{t('none.actions')}</Text>
                <Wrap rtl={rtl}>
                  {suggestions.map((sg) => <Chip key={sg.id} c={c} rtl={rtl} testID={`button-action-${sg.id}`} label={sg.label} on={false} onPress={sg.run} />)}
                  <Chip c={c} rtl={rtl} testID="button-action-refine" label={t('t.refine')} on={false} onPress={() => go('tune')} />
                </Wrap>
                {suggestions.length === 0 ? <Text style={[s.small, ta, { color: c.mutedForeground }]}>{t('act.none')}</Text> : null}
              </View>
            ) : (
              <View style={{ gap: 12 }} testID="list-results">
                {shown.map((it) => (
                  <MovieCard key={it.movie.id} c={c} rtl={rtl} t={t} state={state} movie={it.movie} score={it.score} reasons={buildReasons(it.movie, f, state, t, MOVIES)} />
                ))}
                {ranked.results.length > PAGE ? (
                  <View style={[row, { justifyContent: 'center' }]}>
                    <Btn c={c} testID="button-show-more" kind="outline" icon={limit >= ranked.results.length ? 'chevron-up' : 'chevron-down'}
                      label={limit >= ranked.results.length ? t('results.showLess') : t('results.showMore')}
                      onPress={() => setLimit(limit >= ranked.results.length ? PAGE : limit + PAGE)} />
                  </View>
                ) : null}
              </View>
            )}

            {ranked.near.length ? (
              <View testID="section-near" style={{ gap: 10, marginTop: 8 }}>
                <Text style={[s.h2, ta, { color: c.foreground }]}>{t('near.title')}</Text>
                <Text style={[s.small, ta, { color: c.mutedForeground }]}>{t('near.d')}</Text>
                {ranked.near.slice(0, 4).map((it) => (
                  <MovieCard key={it.movie.id} c={c} rtl={rtl} t={t} state={state} movie={it.movie} score={it.score}
                    note={t('near.blocked', { list: [...new Set(it.fails)].map((x) => t(`fail.${x}`)).join(', ') })} />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {current === 'collection' ? (
          <View style={{ gap: 12 }} testID="screen-collection">
            <Text style={[s.small, ta, { color: c.mutedForeground }]}>{t('i.sub')}</Text>
            <Text style={[s.h2, ta, { color: c.foreground }]}>{t('i.tab.saved')}</Text>
            {state.saved.filter((id) => MOVIE_BY_ID[id]).length === 0 ? (
              <Text style={[s.small, ta, { color: c.mutedForeground }]}>{t('i.empty.saved')}</Text>
            ) : state.saved.filter((id) => MOVIE_BY_ID[id]).map((id) => {
              const ctx = state.savedContext[id];
              const date = ctx ? new Date(ctx.savedAt).toLocaleDateString(state.lang === 'ar' ? 'ar' : 'en') : '';
              const note = ctx ? (ctx.preset ? t('ideas.saved.context', { preset: t(`p.${ctx.preset}`), date }) : t('ideas.saved.custom', { date })) : undefined;
              const m = MOVIE_BY_ID[id];
              return <MovieCard key={id} c={c} rtl={rtl} t={t} state={state} movie={m} mode="saved" score={ranked.results.find((r) => r.movie.id === id)?.score ?? ranked.near.find((r) => r.movie.id === id)?.score ?? 0} reasons={buildReasons(m, f, state, t, MOVIES)} note={note} />;
            })}
            <Text style={[s.h2, ta, { color: c.foreground, marginTop: 8 }]}>{t('i.tab.dismissed')}</Text>
            {state.dismissed.filter((id) => MOVIE_BY_ID[id]).length === 0 ? (
              <Text style={[s.small, ta, { color: c.mutedForeground }]}>{t('i.empty.dismissed')}</Text>
            ) : state.dismissed.filter((id) => MOVIE_BY_ID[id]).map((id) => {
              const m = MOVIE_BY_ID[id];
              return <MovieCard key={id} c={c} rtl={rtl} t={t} state={state} movie={m} mode="dismissed" score={classify([m], { ...f, hideDismissed: false }, state).results[0]?.score ?? 0} />;
            })}
            <View style={row}><Btn c={c} testID="button-collection-to-discover" kind="outline" icon="compass" label={t('i.cta')} onPress={() => go(state.session.started ? 'results' : 'start')} /></View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  h1: { fontSize: 22, fontFamily: 'Inter_700Bold', lineHeight: 28 },
  h2: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  h3: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  body: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  small: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  tiny: { fontSize: 11, fontFamily: 'Inter_500Medium', lineHeight: 15 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14 },
  inner: { borderWidth: 1, borderRadius: 12, padding: 12 },
  banner: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8, alignItems: 'flex-start' },
  wrap: { flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, minHeight: 36, justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, minHeight: 42, borderRadius: 999, borderWidth: 1 },
  btnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  stepBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  poster: { width: 64, height: 96, borderRadius: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  toggleRow: { alignItems: 'center', gap: 10, paddingVertical: 6 },
  restriction: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, overflow: 'hidden' },
});
