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
const LEGACY_MIGRATED_KEY = `${STORAGE_KEY}.legacy-migrated`;

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

let state = defaults();
const listeners = new Set<() => void>();
let persistenceQueue: Promise<void> = Promise.resolve();
let activeAccountId: string | null = null;
let scopeChangeSequence = 0;

function emit() {
  listeners.forEach((listener) => listener());
}

function keyForScope(userId: string | null) {
  return userId ? `${STORAGE_KEY}.account.${encodeURIComponent(userId)}` : STORAGE_KEY;
}

function persist(next: StoreState, key = keyForScope(activeAccountId)) {
  const serialized = JSON.stringify({ ...next, hydrated: true, storageError: false });
  persistenceQueue = persistenceQueue
    .then(() => AsyncStorage.setItem(key, serialized))
    .catch(() => {
      if (state.storageError) return;
      state = { ...state, storageError: true };
      emit();
    });
}

function set(next: StoreState, personalChanged = false) {
  state = {
    ...next,
    storageError: false,
    ...(personalChanged && activeAccountId
      ? { cloudSyncDirty: true }
      : {}),
  };
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
    viewed: normalizeViewed(saved.viewed),
    cloudInitialized: saved.cloudInitialized ?? false,
    cloudSyncDirty: saved.cloudSyncDirty ?? false,
    cloudRevision: Number.isSafeInteger(saved.cloudRevision) && (saved.cloudRevision ?? -1) >= 0 ? saved.cloudRevision! : 0,
    cloudBaseSnapshot: typeof saved.cloudBaseSnapshot === "string" ? saved.cloudBaseSnapshot : null,
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

const hydration = hydrate();

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

function serializePersonalStateValue(value: unknown): string | undefined {
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
  async setAccountScope(userId: string | null) {
    const sequence = ++scopeChangeSequence;
    await hydration;
    await persistenceQueue;
    if (sequence !== scopeChangeSequence || userId === activeAccountId) return;

    let next: StoreState;
    if (userId === null) {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      next = stored ? mergeStoredState(stored) : { ...defaults(), hydrated: true };
    } else {
      const scopedKey = keyForScope(userId);
      const scopedStored = await AsyncStorage.getItem(scopedKey);
      if (scopedStored) {
        next = mergeStoredState(scopedStored);
      } else {
        const legacyAlreadyMigrated = (await AsyncStorage.getItem(LEGACY_MIGRATED_KEY)) === "true";
        if (!legacyAlreadyMigrated && activeAccountId === null) {
          next = state;
          await AsyncStorage.setItem(
            scopedKey,
            JSON.stringify({ ...next, hydrated: true, storageError: false }),
          );
          await AsyncStorage.setItem(LEGACY_MIGRATED_KEY, "true");
          if (sequence !== scopeChangeSequence) return;
          activeAccountId = userId;
          state = next;
          persist({ ...defaults(), hydrated: true }, STORAGE_KEY);
          emit();
          return;
        }
        next = { ...defaults(), hydrated: true };
      }
    }
    if (sequence !== scopeChangeSequence) return;
    activeAccountId = userId;
    state = { ...next, hydrated: true, storageError: false };
    persist(state);
    emit();
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
    persist(state);
    emit();
  },
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
    }, true);
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
    }, true);
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
    set({
      ...state,
      dismissed: [...state.dismissed, id],
      saved: state.saved.filter((value) => value !== id),
      savedContext,
    }, true);
  },
  restore(id: string) {
    set({ ...state, dismissed: state.dismissed.filter((value) => value !== id) }, true);
  },
  markViewed(id: string) {
    const current = state.viewed[id];
    set({
      ...state,
      viewed: {
        ...state.viewed,
        [id]: { ...blank(current), lastViewedAt: Date.now() },
      },
    }, true);
  },
  setWatched(id: string, watched: boolean) {
    const current = state.viewed[id];
    set({
      ...state,
      viewed: {
        ...state.viewed,
        [id]: { ...blank(current), watched, lastViewedAt: Date.now() },
      },
    }, true);
  },
  setRating(id: string, rating: number | undefined) {
    const current = state.viewed[id];
    set({
      ...state,
      viewed: {
        ...state.viewed,
        [id]: { ...blank(current), rating, lastViewedAt: Date.now() },
      },
    }, true);
  },
  toggleFeedback(id: string, tag: string) {
    const feedback = state.session.feedback[id] ?? [];
    set({
      ...state,
      session: {
        ...state.session,
        feedback: { ...state.session.feedback, [id]: toggle(feedback, tag) },
      },
    }, true);
  },
  clearAll() {
    set({
      ...defaults(),
      hydrated: true,
      cloudInitialized: true,
      cloudRevision: state.cloudRevision,
      cloudBaseSnapshot: state.cloudBaseSnapshot ?? serializePersonalState(personalState(state)),
    }, true);
  },
  clearPersonalData() {
    const lang = state.lang;
    set({
      ...defaults(),
      hydrated: true,
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
