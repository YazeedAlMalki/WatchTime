import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { PRESETS } from "./data";
import {
  CONTENT_KEYS,
  MOOD_KEYS,
  type AccessType,
  type ContentKey,
  type Filters,
  type MoodKey,
  type StoreState,
  type Viewed,
} from "./types";

const STORAGE_KEY = "watchtime.discoverMood.v1";

export function defaultFilters(): Filters {
  const targets = {} as Record<MoodKey, number>;
  const active = {} as Record<MoodKey, boolean>;
  const importance = {} as Filters["importance"];
  MOOD_KEYS.forEach((key) => {
    targets[key] = 50;
    active[key] = false;
    importance[key] = 2;
  });

  const limits = {} as Record<ContentKey, number>;
  CONTENT_KEYS.forEach((key) => {
    limits[key] = 4;
  });

  return {
    preset: null,
    targets,
    active,
    importance,
    maxRuntime: 240,
    maxAgeRating: "any",
    context: "solo",
    languages: [],
    acceptSubs: true,
    acceptDub: true,
    requireArabicSubtitles: false,
    requireArabicDubbing: false,
    originalAudioOnly: false,
    region: "SA",
    providers: [],
    accessTypes: ["stream"],
    limits,
    hideWatched: true,
    includeHighlyRated: true,
    includeComfortRewatches: false,
    hideDismissed: true,
    avoidPoorMatches: true,
  };
}

function defaults(): StoreState {
  return {
    filters: defaultFilters(),
    session: { started: false, ranAt: null, seed: 0, sort: "match", feedback: {} },
    saved: [],
    savedContext: {},
    dismissed: [],
    viewed: {},
    lang: "en",
    storageError: false,
    hydrated: false,
  };
}

let state = defaults();
const listeners = new Set<() => void>();
let persistenceQueue: Promise<void> = Promise.resolve();

function emit() {
  listeners.forEach((listener) => listener());
}

function persist(next: StoreState) {
  const serialized = JSON.stringify({ ...next, hydrated: true, storageError: false });
  persistenceQueue = persistenceQueue
    .then(() => AsyncStorage.setItem(STORAGE_KEY, serialized))
    .catch(() => {
      if (state.storageError) return;
      state = { ...state, storageError: true };
      emit();
    });
}

function set(next: StoreState) {
  state = { ...next, storageError: false };
  emit();
  persist(state);
}

function mergeStoredState(raw: string): StoreState {
  const base = defaults();
  const saved = JSON.parse(raw) as Partial<StoreState>;
  const oldFilters = saved.filters as (Partial<Filters> & { allowRentBuy?: boolean }) | undefined;
  const accessTypes: Filters["accessTypes"] = Array.isArray(saved.filters?.accessTypes)
    ? saved.filters.accessTypes.filter(
        (type): type is AccessType => type === "stream" || type === "rent" || type === "buy",
      )
    : oldFilters?.allowRentBuy
      ? ["stream", "rent", "buy"]
      : [...base.filters.accessTypes];

  return {
    ...base,
    ...saved,
    lang: saved.lang === "ar" ? "ar" : "en",
    filters: {
      ...base.filters,
      ...(saved.filters ?? {}),
      accessTypes,
      targets: { ...base.filters.targets, ...(saved.filters?.targets ?? {}) },
      active: { ...base.filters.active, ...(saved.filters?.active ?? {}) },
      importance: { ...base.filters.importance, ...(saved.filters?.importance ?? {}) },
      limits: { ...base.filters.limits, ...(saved.filters?.limits ?? {}) },
    },
    session: {
      ...base.session,
      ...(saved.session ?? {}),
      feedback: { ...base.session.feedback, ...(saved.session?.feedback ?? {}) },
    },
    saved: Array.isArray(saved.saved) ? saved.saved : [],
    savedContext: saved.savedContext ?? {},
    dismissed: Array.isArray(saved.dismissed) ? saved.dismissed : [],
    viewed: saved.viewed ?? {},
    storageError: false,
    hydrated: true,
  };
}

async function hydrate() {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    state = stored ? mergeStoredState(stored) : { ...defaults(), hydrated: true };
  } catch {
    state = { ...defaults(), hydrated: true, storageError: true };
  }
  emit();
}

void hydrate();

export function useStore(): StoreState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

const blank = (current?: Viewed): Viewed => ({
  lastViewedAt: Date.now(),
  watched: false,
  feedback: [],
  ...(current ?? {}),
});

const toggle = (items: string[], item: string) =>
  items.includes(item) ? items.filter((value) => value !== item) : [...items, item];

export const actions = {
  patchFilters(patch: Partial<Filters>) {
    set({ ...state, filters: { ...state.filters, ...patch } });
  },
  setTarget(key: MoodKey, value: number) {
    const filters = state.filters;
    set({
      ...state,
      filters: {
        ...filters,
        preset: null,
        targets: { ...filters.targets, [key]: Math.max(0, Math.min(100, value)) },
        active: { ...filters.active, [key]: true },
      },
    });
  },
  setImportance(key: MoodKey, value: Filters["importance"][MoodKey]) {
    const filters = state.filters;
    set({
      ...state,
      filters: { ...filters, preset: null, importance: { ...filters.importance, [key]: value } },
    });
  },
  setActive(key: MoodKey, active: boolean) {
    const filters = state.filters;
    set({
      ...state,
      filters: { ...filters, preset: null, active: { ...filters.active, [key]: active } },
    });
  },
  setLimit(key: ContentKey, value: number) {
    const filters = state.filters;
    set({
      ...state,
      filters: {
        ...filters,
        limits: { ...filters.limits, [key]: Math.max(0, Math.min(4, value)) },
      },
    });
  },
  applyPreset(id: string) {
    const preset = PRESETS.find((item) => item.id === id);
    if (!preset) return;

    const filters = state.filters;
    const targets = { ...filters.targets };
    const active = {} as Record<MoodKey, boolean>;
    const importance = { ...filters.importance };
    MOOD_KEYS.forEach((key) => {
      const target = preset.targets[key];
      active[key] = target !== undefined;
      targets[key] = target ?? 50;
      importance[key] = preset.importance?.[key] ?? 2;
    });

    const surprise = preset.sort === "surprise";
    set({
      ...state,
      filters: {
        ...filters,
        ...("maxRuntime" in preset ? { maxRuntime: preset.maxRuntime! } : {}),
        ...("maxAgeRating" in preset ? { maxAgeRating: preset.maxAgeRating! } : {}),
        ...(preset.limits ? { limits: { ...filters.limits, ...preset.limits } } : {}),
        ...(surprise
          ? { maxRuntime: 240, languages: [], providers: [], accessTypes: ["stream", "rent", "buy"] }
          : {}),
        preset: id,
        targets,
        active,
        importance,
        context: preset.context ?? filters.context,
      },
      session: { ...state.session, sort: preset.sort ?? "match" },
    });
  },
  startSession() {
    const now = Date.now();
    set({
      ...state,
      session: {
        ...state.session,
        started: true,
        ranAt: now,
        seed: state.session.seed || now,
      },
    });
  },
  startNewSession() {
    const now = Date.now();
    set({
      ...state,
      session: { started: true, ranAt: now, seed: now, sort: "match", feedback: {} },
    });
  },
  setSort(sort: StoreState["session"]["sort"]) {
    set({ ...state, session: { ...state.session, sort } });
  },
  resetMoods() {
    const fresh = defaultFilters();
    set({
      ...state,
      filters: {
        ...state.filters,
        preset: null,
        targets: fresh.targets,
        active: fresh.active,
        importance: fresh.importance,
      },
    });
  },
  resetAllFilters() {
    set({
      ...state,
      filters: defaultFilters(),
      session: { ...state.session, feedback: {}, sort: "match" },
    });
  },
  resetForNewSession() {
    set({
      ...state,
      filters: defaultFilters(),
      session: { started: false, ranAt: null, seed: 0, sort: "match", feedback: {} },
    });
  },
  toggleSaved(id: string) {
    const saved = toggle(state.saved, id);
    const savedContext = { ...state.savedContext };
    if (saved.includes(id)) {
      savedContext[id] = { preset: state.filters.preset, savedAt: Date.now(), filters: state.filters };
    } else {
      delete savedContext[id];
    }
    set({ ...state, saved, savedContext });
  },
  dismiss(id: string) {
    if (state.dismissed.includes(id)) return;
    const savedContext = { ...state.savedContext };
    delete savedContext[id];
    set({
      ...state,
      dismissed: [...state.dismissed, id],
      saved: state.saved.filter((value) => value !== id),
      savedContext,
    });
  },
  restore(id: string) {
    set({ ...state, dismissed: state.dismissed.filter((value) => value !== id) });
  },
  markViewed(id: string) {
    const current = state.viewed[id];
    set({
      ...state,
      viewed: {
        ...state.viewed,
        [id]: { ...blank(current), lastViewedAt: Date.now() },
      },
    });
  },
  setWatched(id: string, watched: boolean) {
    const current = state.viewed[id];
    set({
      ...state,
      viewed: {
        ...state.viewed,
        [id]: { ...blank(current), watched, lastViewedAt: Date.now() },
      },
    });
  },
  setRating(id: string, rating: number | undefined) {
    const current = state.viewed[id];
    set({
      ...state,
      viewed: {
        ...state.viewed,
        [id]: { ...blank(current), rating, lastViewedAt: current?.lastViewedAt ?? Date.now() },
      },
    });
  },
  toggleFeedback(id: string, tag: string) {
    const feedback = state.session.feedback[id] ?? [];
    set({
      ...state,
      session: {
        ...state.session,
        feedback: { ...state.session.feedback, [id]: toggle(feedback, tag) },
      },
    });
  },
  clearAll() {
    set({ ...defaults(), hydrated: true });
  },
  clearPersonalData() {
    const lang = state.lang;
    set({ ...defaults(), hydrated: true, lang });
  },
  setLang(lang: "en" | "ar") {
    set({ ...state, lang });
  },
};
