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
const LEGACY_MIGRATED_KEY = `${KEY}.legacy-migrated`;

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
    cloudInitialized: false,
    cloudSyncDirty: false,
    cloudRevision: 0,
    cloudBaseSnapshot: null,
  };
}

function normalizeViewed(viewed: StoreState["viewed"] | undefined): StoreState["viewed"] {
  return Object.fromEntries(
    Object.entries(viewed ?? {}).map(([id, item]) => [
      id,
      {
        lastViewedAt:
          Number.isFinite(item.lastViewedAt) && item.lastViewedAt >= 0
            ? Math.trunc(item.lastViewedAt)
            : Date.now(),
        watched: item.watched === true,
        ...(typeof item.rating === "number" ? { rating: item.rating } : {}),
        feedback: Array.isArray(item.feedback)
          ? item.feedback.filter((tag): tag is string => typeof tag === "string")
          : [],
      },
    ]),
  );
}

function mergeStoredState(raw: string): StoreState {
  const base = defaults();
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
      importance: { ...base.filters.importance, ...(p.filters?.importance ?? {}) },
      limits: { ...base.filters.limits, ...(p.filters?.limits ?? {}) },
    },
    session: {
      ...base.session,
      ...(p.session ?? {}),
      feedback: { ...base.session.feedback, ...(p.session?.feedback ?? {}) },
    },
    saved: Array.isArray(p.saved) ? p.saved : [],
    savedContext: p.savedContext ?? {},
    dismissed: Array.isArray(p.dismissed) ? p.dismissed : [],
    viewed: normalizeViewed(p.viewed),
    cloudInitialized: p.cloudInitialized ?? false,
    cloudSyncDirty: p.cloudSyncDirty ?? false,
    cloudRevision: Number.isSafeInteger(p.cloudRevision) && (p.cloudRevision ?? -1) >= 0 ? p.cloudRevision! : 0,
    cloudBaseSnapshot: typeof p.cloudBaseSnapshot === "string" ? p.cloudBaseSnapshot : null,
  };
}

function load(key = KEY): StoreState {
  const base = defaults();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return base;
    return mergeStoredState(raw);
  } catch {
    return { ...base, storageError: true };
  }
}

let state: StoreState = load();
const listeners = new Set<() => void>();
let activeAccountId: string | null = null;

function accountStorageKey(userId: string) {
  return `${KEY}.account.${encodeURIComponent(userId)}`;
}

function writeToStorage(key: string, value: StoreState) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function set(next: StoreState, personalChanged = false) {
  state = {
    ...next,
    storageError: false,
    ...(personalChanged && activeAccountId
      ? { cloudSyncDirty: true }
      : {}),
  };
  try {
    writeToStorage(activeAccountId ? accountStorageKey(activeAccountId) : KEY, state);
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

export type MoodPersonalState = Pick<StoreState, "saved" | "savedContext" | "dismissed" | "viewed"> & {
  feedback: Record<string, string[]>;
};

function personalState(current: StoreState): MoodPersonalState {
  return {
    saved: current.saved,
    savedContext: current.savedContext,
    dismissed: current.dismissed,
    viewed: current.viewed,
    feedback: current.session.feedback,
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function serializePersonalState(value: MoodPersonalState): string {
  return JSON.stringify(stableValue(value));
}

function mergeSetChanges(base: string[], local: string[], remote: string[]): string[] {
  const merged = new Set(remote);
  const baseSet = new Set(base);
  const localSet = new Set(local);
  for (const id of new Set([...base, ...local])) {
    if (baseSet.has(id) === localSet.has(id)) continue;
    if (localSet.has(id)) merged.add(id);
    else merged.delete(id);
  }
  return [...merged];
}

function mergeFeedbackChanges(
  base: Record<string, string[]>,
  local: Record<string, string[]>,
  remote: Record<string, string[]>,
): Record<string, string[]> {
  const merged = { ...remote };
  for (const id of new Set([...Object.keys(base), ...Object.keys(local)])) {
    const tags = mergeSetChanges(base[id] ?? [], local[id] ?? [], remote[id] ?? []);
    if (tags.length) merged[id] = tags;
    else delete merged[id];
  }
  return merged;
}

function mergeLocalChanges(
  base: MoodPersonalState,
  local: MoodPersonalState,
  remote: MoodPersonalState,
): MoodPersonalState {
  const saved = mergeSetChanges(base.saved, local.saved, remote.saved);
  const savedContext = { ...remote.savedContext };
  for (const id of new Set([...Object.keys(base.savedContext), ...Object.keys(local.savedContext)])) {
    if (serializePersonalStateValue(base.savedContext[id]) === serializePersonalStateValue(local.savedContext[id])) continue;
    if (local.savedContext[id] === undefined) delete savedContext[id];
    else {
      savedContext[id] = local.savedContext[id];
      if (local.saved.includes(id) && !saved.includes(id)) saved.push(id);
    }
  }

  const viewed = Object.fromEntries(
    Object.entries(remote.viewed).map(([id, item]) => [id, { ...item, feedback: [...item.feedback] }]),
  );
  for (const id of new Set([...Object.keys(base.viewed), ...Object.keys(local.viewed)])) {
    const before = base.viewed[id];
    const changed = local.viewed[id];
    const latest = viewed[id];
    if (!changed) {
      if (before) delete viewed[id];
      continue;
    }
    if (before && serializePersonalStateValue(before) === serializePersonalStateValue(changed)) continue;

    const merged = latest
      ? { ...latest, feedback: [...latest.feedback] }
      : before
        ? { lastViewedAt: changed.lastViewedAt, watched: false, feedback: [] }
        : { ...changed, feedback: [...changed.feedback] };
    if (before) {
      if (changed.watched !== before.watched) merged.watched = changed.watched;
      if (changed.rating !== before.rating) {
        if (changed.rating === undefined) delete merged.rating;
        else merged.rating = changed.rating;
      }
      merged.feedback = mergeSetChanges(before.feedback ?? [], changed.feedback ?? [], latest?.feedback ?? []);
    } else if (latest) {
      if (changed.watched) merged.watched = true;
      if (changed.rating !== undefined) merged.rating = changed.rating;
      merged.feedback = mergeSetChanges([], changed.feedback ?? [], latest.feedback ?? []);
    }
    merged.lastViewedAt = Math.max(latest?.lastViewedAt ?? 0, changed.lastViewedAt);
    viewed[id] = merged;
  }

  return {
    saved,
    savedContext,
    dismissed: mergeSetChanges(base.dismissed, local.dismissed, remote.dismissed),
    viewed,
    feedback: mergeFeedbackChanges(base.feedback, local.feedback, remote.feedback),
  };
}

function serializePersonalStateValue(value: unknown): string | undefined {
  return JSON.stringify(stableValue(value));
}

function mergeInitialState(remote: MoodPersonalState, local: MoodPersonalState): MoodPersonalState {
  const saved = [...new Set([...remote.saved, ...local.saved])];
  const savedContext = { ...remote.savedContext };
  for (const [id, context] of Object.entries(local.savedContext)) {
    if (!savedContext[id] || context.savedAt >= savedContext[id].savedAt) savedContext[id] = context;
  }
  const viewed = { ...remote.viewed };
  for (const [id, item] of Object.entries(local.viewed)) {
    if (!viewed[id] || item.lastViewedAt >= viewed[id].lastViewedAt) viewed[id] = item;
  }
  const feedback: Record<string, string[]> = { ...remote.feedback };
  for (const [id, tags] of Object.entries(local.feedback)) {
    feedback[id] = [...new Set([...(feedback[id] ?? []), ...tags])];
  }
  return {
    saved,
    savedContext,
    dismissed: [...new Set([...remote.dismissed, ...local.dismissed])],
    viewed,
    feedback,
  };
}

export const actions = {
  setAccountScope(userId: string | null) {
    if (userId === activeAccountId) return;
    try {
      if (userId === null) {
        activeAccountId = null;
        state = load(KEY);
      } else {
        const targetKey = accountStorageKey(userId);
        const scopedState = window.localStorage.getItem(targetKey);
        if (scopedState) {
          activeAccountId = userId;
          state = mergeStoredState(scopedState);
        } else {
          const legacyAlreadyMigrated = window.localStorage.getItem(LEGACY_MIGRATED_KEY) === "true";
          if (!legacyAlreadyMigrated && activeAccountId === null) {
            const legacyState = state;
            writeToStorage(targetKey, legacyState);
            window.localStorage.setItem(LEGACY_MIGRATED_KEY, "true");
            activeAccountId = userId;
            state = legacyState;
            writeToStorage(KEY, defaults());
          } else {
            activeAccountId = userId;
            state = defaults();
            writeToStorage(targetKey, state);
          }
        }
      }
    } catch {
      state = { ...state, storageError: true };
    }
    listeners.forEach((listener) => listener());
  },
  getPersonalState() {
    return personalState(state);
  },
  getPersonalSnapshot() {
    return serializePersonalState(personalState(state));
  },
  getSyncState() {
    return { revision: state.cloudRevision, dirty: state.cloudSyncDirty };
  },
  mergePersonalState(remote: MoodPersonalState, revision: number) {
    if (state.cloudInitialized && revision < state.cloudRevision) return;
    const current = personalState(state);
    let personal: MoodPersonalState;
    if (!state.cloudInitialized) {
      personal = mergeInitialState(remote, current);
    } else if (state.cloudSyncDirty) {
      let base = remote;
      if (state.cloudBaseSnapshot) {
        try {
          base = JSON.parse(state.cloudBaseSnapshot) as MoodPersonalState;
        } catch {
          base = remote;
        }
        personal = mergeLocalChanges(base, current, remote);
      } else {
        personal = mergeInitialState(remote, current);
      }
    } else {
      personal = remote;
    }
    const dirty = serializePersonalState(personal) !== serializePersonalState(remote);
    set({
      ...state,
      ...personal,
      session: { ...state.session, feedback: personal.feedback },
      cloudInitialized: true,
      cloudSyncDirty: dirty,
      cloudRevision: revision,
      cloudBaseSnapshot: serializePersonalState(remote),
    });
  },
  markCloudSyncClean(userId: string, snapshot: string, accepted: MoodPersonalState, revision: number) {
    if (activeAccountId !== userId || revision < state.cloudRevision) return;
    const currentSnapshot = serializePersonalState(personalState(state));
    state = {
      ...state,
      cloudInitialized: true,
      cloudSyncDirty:
        currentSnapshot !== snapshot || currentSnapshot !== serializePersonalState(accepted),
      cloudRevision: revision,
      cloudBaseSnapshot: serializePersonalState(accepted),
    };
    try {
      writeToStorage(activeAccountId ? accountStorageKey(activeAccountId) : KEY, state);
    } catch {
      state = { ...state, storageError: true };
    }
    listeners.forEach((listener) => listener());
  },
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
    set({ ...state, session: { started: true, ranAt: now, seed: now, sort: "match", feedback: {} } }, true);
  },
  setSort(sort: StoreState["session"]["sort"]) {
    set({ ...state, session: { ...state.session, sort } });
  },
  resetMoods() {
    const d = defaultFilters();
    set({ ...state, filters: { ...state.filters, preset: null, targets: d.targets, active: d.active, importance: d.importance } });
  },
  resetAllFilters() {
    set({ ...state, filters: defaultFilters(), session: { ...state.session, feedback: {}, sort: "match" } }, true);
  },
  resetForNewSession() {
    set({
      ...state,
      filters: defaultFilters(),
      session: { started: false, ranAt: null, seed: 0, sort: "match", feedback: {} },
    }, true);
  },
  toggleSaved(id: string) {
    const saved = toggle(state.saved, id);
    const savedContext = { ...state.savedContext };
    if (saved.includes(id)) {
      savedContext[id] = { preset: state.filters.preset, savedAt: Date.now(), filters: state.filters };
    } else {
      delete savedContext[id];
    }
    set({ ...state, saved, savedContext }, true);
  },
  dismiss(id: string) {
    if (state.dismissed.includes(id)) return;
    const savedContext = { ...state.savedContext };
    delete savedContext[id];
    set({ ...state, dismissed: [...state.dismissed, id], saved: state.saved.filter((x) => x !== id), savedContext }, true);
  },
  restore(id: string) {
    set({ ...state, dismissed: state.dismissed.filter((x) => x !== id) }, true);
  },
  markViewed(id: string) {
    const cur = state.viewed[id];
    set({
      ...state,
      viewed: { ...state.viewed, [id]: { ...blank(cur), lastViewedAt: Date.now() } },
    }, true);
  },
  setWatched(id: string, watched: boolean) {
    const cur = state.viewed[id];
    set({
      ...state,
      viewed: { ...state.viewed, [id]: { ...blank(cur), watched, lastViewedAt: Date.now() } },
    }, true);
  },
  setRating(id: string, rating: number | undefined) {
    const cur = state.viewed[id];
    set({
      ...state,
      viewed: { ...state.viewed, [id]: { ...blank(cur), rating, lastViewedAt: Date.now() } },
    }, true);
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
    }, true);
  },
  clearAll() {
    set({
      ...defaults(),
      cloudInitialized: true,
      cloudRevision: state.cloudRevision,
      cloudBaseSnapshot: state.cloudBaseSnapshot ?? serializePersonalState(personalState(state)),
    }, true);
  },
  clearPersonalData() {
    const lang = state.lang;
    set({
      ...defaults(),
      lang,
      cloudInitialized: true,
      cloudRevision: state.cloudRevision,
      cloudBaseSnapshot: state.cloudBaseSnapshot ?? serializePersonalState(personalState(state)),
    }, true);
  },
  setLang(lang: "en" | "ar") {
    set({ ...state, lang });
  },
};
