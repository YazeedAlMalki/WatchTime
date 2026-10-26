const mockStorageValues = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorageValues.get(key) ?? null),
    removeItem: jest.fn(async (key: string) => {
      mockStorageValues.delete(key);
    }),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorageValues.set(key, value);
    }),
  },
}));

import { act, renderHook, waitFor } from "@testing-library/react-native";
import { actions, useStore } from "../lib/discover-mood/store";

const STORAGE_KEY = "watchtime.discoverMood.v1";

describe("WatchTime Mobile mood discovery storage", () => {
  it("persists saved, dismissed, watched, rated, and feedback state", async () => {
    const { result, unmount } = await renderHook(() => useStore());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    await act(async () => {
      actions.applyPreset("cheer");
      actions.startSession();
      actions.toggleSaved("summer-bakery");
      actions.setWatched("summer-bakery", true);
      actions.setRating("summer-bakery", 4);
      actions.toggleFeedback("summer-bakery", "tooSlow");
      actions.dismiss("moonlit-library");
    });

    await waitFor(() => expect(mockStorageValues.has(STORAGE_KEY)).toBe(true));
    const persisted = JSON.parse(mockStorageValues.get(STORAGE_KEY)!);

    expect(result.current.saved).toContain("summer-bakery");
    expect(result.current.dismissed).toContain("moonlit-library");
    expect(result.current.viewed["summer-bakery"]).toMatchObject({
      watched: true,
      rating: 4,
    });
    expect(result.current.session.feedback["summer-bakery"]).toContain("tooSlow");
    expect(persisted.saved).toContain("summer-bakery");
    expect(persisted.dismissed).toContain("moonlit-library");
    expect(persisted.viewed["summer-bakery"]).toMatchObject({
      watched: true,
      rating: 4,
    });
    expect(persisted.session.feedback["summer-bakery"]).toContain("tooSlow");

    unmount();
  });

  it("migrates old picks, reconciles stale edits including removals, and isolates guest state", async () => {
    mockStorageValues.clear();
    await actions.setAccountScope(null);
    actions.toggleSaved("legacy-pick");
    actions.setWatched("legacy-pick", true);
    actions.setRating("legacy-pick", 5);
    actions.toggleFeedback("legacy-pick", "tooSlow");

    await actions.setAccountScope("user-a");
    expect(actions.getPersonalState().saved).toContain("legacy-pick");
    expect(actions.getPersonalState().viewed["legacy-pick"]).toMatchObject({ watched: true, rating: 5 });

    const remote = {
      saved: ["server-pick"],
      savedContext: {
        "server-pick": { preset: null, savedAt: 1, filters: {} as any },
      },
      dismissed: ["server-dismissed"],
      viewed: { "server-pick": { lastViewedAt: 2, watched: false, rating: 4, feedback: [] } },
      feedback: { "server-pick": ["hideSimilar"] },
    };
    actions.mergePersonalState(remote, 1);
    const merged = actions.getPersonalState();
    expect(merged.saved).toEqual(expect.arrayContaining(["legacy-pick", "server-pick"]));
    expect(merged.dismissed).toContain("server-dismissed");
    expect(merged.viewed["legacy-pick"]).toMatchObject({ watched: true, rating: 5 });
    expect(merged.feedback["server-pick"]).toContain("hideSimilar");

    actions.markCloudSyncClean("user-a", actions.getPersonalSnapshot(), merged, 2);
    actions.mergePersonalState(remote, 3);

    actions.toggleSaved("server-pick");
    actions.toggleSaved("web-pick");
    actions.setRating("server-pick", 5);
    actions.toggleFeedback("server-pick", "hideSimilar");
    actions.restore("server-dismissed");
    const concurrentRemote = {
      ...remote,
      saved: ["server-pick", "mobile-pick"],
      savedContext: {
        ...remote.savedContext,
        "mobile-pick": { preset: null, savedAt: 3, filters: {} as any },
      },
      dismissed: ["server-dismissed", "mobile-dismissed"],
      viewed: {
        ...remote.viewed,
        "server-pick": { lastViewedAt: 4, watched: true, rating: 4, feedback: [] },
      },
      feedback: { "server-pick": ["hideSimilar", "remoteTag"] },
    };
    actions.mergePersonalState(concurrentRemote, 4);
    const reconciled = actions.getPersonalState();
    expect(reconciled.saved).toEqual(expect.arrayContaining(["web-pick", "mobile-pick"]));
    expect(reconciled.saved).not.toContain("server-pick");
    expect(reconciled.dismissed).toEqual(["mobile-dismissed"]);
    expect(reconciled.viewed["server-pick"]).toMatchObject({ watched: true, rating: 5 });
    expect(reconciled.feedback["server-pick"]).toEqual(["remoteTag"]);
    expect(actions.getSyncState().dirty).toBe(true);
    actions.markCloudSyncClean("user-a", actions.getPersonalSnapshot(), reconciled, 5);

    actions.mergePersonalState(remote, 6);
    expect(actions.getPersonalState().saved).toEqual(["server-pick"]);

    await actions.setAccountScope(null);
    expect(actions.getPersonalState().saved).toEqual([]);
    actions.toggleSaved("guest-pick");
    await actions.setAccountScope("user-b");
    expect(actions.getPersonalState().saved).toEqual([]);
    await actions.setAccountScope(null);
    expect(actions.getPersonalState().saved).toEqual(["guest-pick"]);
    await actions.setAccountScope("user-a");
    expect(actions.getPersonalState().saved).toEqual(["server-pick"]);
  });
});
