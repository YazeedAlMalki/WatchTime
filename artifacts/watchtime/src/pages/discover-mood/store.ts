import { useSyncExternalStore } from "react";
import { PRESETS } from "./data";
import {
  CONTENT_KEYS,
  MOOD_KEYS,
  type ContentKey,
  type Filters,
  type MoodKey,
  type StoreState,
  type Viewed,
} from "./types";

const KEY = "watchtime.discoverMood.v1";

export function defaultFilters(): Filters {
  const targets = {} as Record<MoodKey, number>;
  const active = {} as Record<MoodKey, boolean>;
  const importance = {} as Filters["importance"];
  MOOD_KEYS.forEach((k) => {
    targets[k] = 50;
    active[k] = false;
    importance[k] = 2;
  });
  const limits = {} as Record<ContentKey, number>;
  CONTENT_KEYS.forEach((k) => (limits[k] = 4));
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
  };
}

function load(): StoreState {
  const base = defaults();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<StoreState>;
    const legacyFilters = p.filters as (Partial<Filters> & { allowRentBuy?: boolean }) | undefined;
    return {
      ...base,
      ...p,
      filters: {
        ...base.filters,
        ...(p.filters ?? {}),
        ...(p.filters?.accessTypes ? { accessTypes: p.filters.accessTypes } : legacyFilters?.allowRentBuy ? { accessTypes: ["stream", "rent", "buy"] } : {}),
        targets: { ...base.filters.targets, ...(p.filters?.targets ?? {}) },
        active: { ...base.filters.active, ...(p.filters?.active ?? {}) },
        limits: { ...base.filters.limits, ...(p.filters?.limits ?? {}) },
      },
       session: {
         ...base.session,
         ...(p.session ?? {}),
         feedback: { ...base.session.feedback, ...(p.session?.feedback ?? {}) },
       },
       savedContext: p.savedContext ?? {},
    };
  } catch {
    return { ...base, storageError: true };
  }
}

let state: StoreState = load();
const listeners = new Set<() => void>();

function set(next: StoreState) {
  state = { ...next, storageError: false };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    state = { ...state, storageError: true };
  }
  listeners.forEach((l) => l());
}

export function useStore(): StoreState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

const blank = (v?: Viewed): Viewed => ({ lastViewedAt: Date.now(), watched: false, feedback: [], ...(v ?? {}) });
const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

export const actions = {
  patchFilters(patch: Partial<Filters>) {
    set({ ...state, filters: { ...state.filters, ...patch } });
  },
  setTarget(key: MoodKey, value: number) {
    const f = state.filters;
    set({
      ...state,
      filters: { ...f, preset: null, targets: { ...f.targets, [key]: value }, active: { ...f.active, [key]: true } },
    });
  },
  setImportance(key: MoodKey, value: Filters["importance"][MoodKey]) {
    const f = state.filters;
    set({ ...state, filters: { ...f, preset: null, importance: { ...f.importance, [key]: value } } });
  },
  setActive(key: MoodKey, on: boolean) {
    const f = state.filters;
    set({ ...state, filters: { ...f, preset: null, active: { ...f.active, [key]: on } } });
  },
  setLimit(key: ContentKey, value: number) {
    const f = state.filters;
    set({ ...state, filters: { ...f, limits: { ...f.limits, [key]: value } } });
  },
  applyPreset(id: string) {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const f = state.filters;
    const targets = { ...f.targets };
    const active = {} as Record<MoodKey, boolean>;
    const importance = { ...f.importance };
    MOOD_KEYS.forEach((k) => {
      const v = preset.targets[k];
      active[k] = v !== undefined;
      targets[k] = v ?? 50;
      importance[k] = preset.importance?.[k] ?? 2;
    });
    const surprise = preset.sort === "surprise";
    set({
      ...state,
      filters: {
        ...f,
        ...("maxRuntime" in preset ? { maxRuntime: preset.maxRuntime! } : {}),
        ...("maxAgeRating" in preset ? { maxAgeRating: preset.maxAgeRating! } : {}),
        ...(preset.limits ? { limits: { ...f.limits, ...preset.limits } } : {}),
        ...(surprise ? { maxRuntime: 240, languages: [], providers: [], accessTypes: ["stream", "rent", "buy"] } : {}),
        preset: id,
        targets,
        active,
        importance,
        context: preset.context ?? f.context,
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
    set({ ...state, session: { started: true, ranAt: now, seed: now, sort: "match", feedback: {} } });
  },
  setSort(sort: StoreState["session"]["sort"]) {
    set({ ...state, session: { ...state.session, sort } });
  },
  resetMoods() {
    const d = defaultFilters();
    set({ ...state, filters: { ...state.filters, preset: null, targets: d.targets, active: d.active, importance: d.importance } });
  },
  resetAllFilters() {
    set({ ...state, filters: defaultFilters(), session: { ...state.session, feedback: {}, sort: "match" } });
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
    set({ ...state, dismissed: [...state.dismissed, id], saved: state.saved.filter((x) => x !== id), savedContext });
  },
  restore(id: string) {
    set({ ...state, dismissed: state.dismissed.filter((x) => x !== id) });
  },
  markViewed(id: string) {
    const cur = state.viewed[id];
    set({
      ...state,
      viewed: { ...state.viewed, [id]: { ...blank(cur), lastViewedAt: Date.now() } },
    });
  },
  setWatched(id: string, watched: boolean) {
    const cur = state.viewed[id];
    set({
      ...state,
      viewed: { ...state.viewed, [id]: { ...blank(cur), watched, lastViewedAt: Date.now() } },
    });
  },
  setRating(id: string, rating: number | undefined) {
    const cur = state.viewed[id];
    set({
      ...state,
      viewed: { ...state.viewed, [id]: { ...blank(cur), rating, lastViewedAt: cur?.lastViewedAt ?? Date.now() } },
    });
  },
  toggleFeedback(id: string, tag: string) {
    const current = state.session.feedback[id] ?? [];
    set({
      ...state,
      session: {
        ...state.session,
        feedback: {
          ...state.session.feedback,
          [id]: toggle(current, tag),
        },
      },
    });
  },
  clearAll() {
    set(defaults());
  },
  clearPersonalData() {
    const lang = state.lang;
    set({ ...defaults(), lang });
  },
  setLang(lang: "en" | "ar") {
    set({ ...state, lang });
  },
};
