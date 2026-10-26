import { describe, expect, it } from "vitest";
import { actions } from "../src/pages/discover-mood/store";
import type { MoodPersonalState } from "../src/pages/discover-mood/store";

describe("Discover by Mood account storage", () => {
  it("migrates old picks, reconciles stale edits including removals, and isolates guest state", () => {
    window.localStorage.clear();
    actions.setAccountScope(null);
    actions.toggleSaved("legacy-pick");
    actions.setWatched("legacy-pick", true);
    actions.setRating("legacy-pick", 5);
    actions.toggleFeedback("legacy-pick", "tooSlow");

    actions.setAccountScope("user-a");
    expect(actions.getPersonalState().saved).toContain("legacy-pick");
    expect(actions.getPersonalState().viewed["legacy-pick"]).toMatchObject({ watched: true, rating: 5 });

    const remote: MoodPersonalState = {
      saved: ["server-pick"],
      savedContext: {
        "server-pick": { preset: null, savedAt: 1, filters: {} as ReturnType<typeof actions.getPersonalState>["savedContext"][string]["filters"] },
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
    const concurrentRemote: MoodPersonalState = {
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

    actions.mergePersonalState({ ...remote, saved: ["server-pick"] }, 6);
    expect(actions.getPersonalState().saved).toEqual(["server-pick"]);

    actions.setAccountScope(null);
    expect(actions.getPersonalState().saved).toEqual([]);
    actions.toggleSaved("guest-pick");
    actions.setAccountScope("user-b");
    expect(actions.getPersonalState().saved).toEqual([]);
    actions.setAccountScope(null);
    expect(actions.getPersonalState().saved).toEqual(["guest-pick"]);
    actions.setAccountScope("user-a");
    expect(actions.getPersonalState().saved).toEqual(["server-pick"]);
  });
});
