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
});
