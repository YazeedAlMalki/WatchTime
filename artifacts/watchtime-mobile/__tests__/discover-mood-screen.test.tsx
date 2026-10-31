import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

jest.mock(
  "@react-native-async-storage/async-storage",
  () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("../lib/discover-mood/use-sync", () => ({
  useMoodDiscoverySync: jest.fn(() => ({ status: null, retry: jest.fn() })),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#0C0C12",
    card: "#16161D",
    foreground: "#F5F5F5",
    mutedForeground: "#818898",
    primary: "#F5C619",
    primaryForeground: "#0A0A0F",
    border: "#23232F",
    secondary: "#23232F",
    secondaryForeground: "#F5F5F5",
    muted: "#1E1E29",
    destructive: "#EF4444",
    severityNone: "#3FB68B",
    severityMild: "#D8B24A",
    severityModerate: "#E08A3C",
  }),
}));

import MoodScreen from "../app/(tabs)/mood";
import { getT } from "../lib/discover-mood/i18n";
import { actions } from "../lib/discover-mood/store";
import { CONTENT_KEYS } from "../lib/discover-mood/types";
import { useMoodDiscoverySync } from "../lib/discover-mood/use-sync";

describe("WatchTime Mobile mood-discovery screen", () => {
  afterEach(() => {
    cleanup();
    jest.mocked(useMoodDiscoverySync).mockReturnValue({ status: null, retry: jest.fn() });
  });

  it("shows a retry action when mood changes are waiting to sync", async () => {
    const retry = jest.fn();
    jest.mocked(useMoodDiscoverySync).mockReturnValue({ status: "waiting", retry });

    const view = await render(<MoodScreen />);
    await waitFor(() => expect(view.queryByTestId("mood-loading")).toBeNull());

    expect(view.getByText(getT("en").t("sync.waiting"))).toBeTruthy();
    await fireEvent.press(view.getByTestId("button-retry-mood-sync"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("does not show sync status for local-only guest data", async () => {
    const view = await render(<MoodScreen />);
    await waitFor(() => expect(view.queryByTestId("mood-loading")).toBeNull());

    expect(view.queryByTestId("mood-sync-status")).toBeNull();
  });

  it("renders Arabic RTL no-results and preserves age/content limits after runtime recovery", async () => {
    const view = await render(<MoodScreen />);
    await waitFor(() => expect(view.queryByTestId("mood-loading")).toBeNull());

    await act(async () => {
      actions.resetForNewSession();
      actions.setLang("en");
      actions.patchFilters({
        maxRuntime: 89,
        maxAgeRating: "G",
        limits: {
          sexualContent: 0,
          violence: 0,
          gore: 0,
          profanity: 0,
          animalHarm: 0,
          disturbingThemes: 0,
        },
      });
      actions.setLang("ar");
      actions.startSession();
    });

    const { t } = getT("ar");
    await waitFor(() => expect(view.getByTestId("empty-no-results")).toBeTruthy());
    expect(view.getByText(t("none.headline"))).toBeTruthy();
    expect(view.getByText(t("none.safety"))).toBeTruthy();
    expect(StyleSheet.flatten(view.getByText(t("none.headline")).props.style)).toMatchObject({
      textAlign: "center",
      writingDirection: "rtl",
    });

    await fireEvent.press(view.getByTestId("button-action-runtime"));
    await waitFor(() => expect(view.getByTestId("empty-no-results")).toBeTruthy());
    await fireEvent.press(view.getByTestId("button-refine"));
    await fireEvent.press(view.getByTestId("toggle-section-content"));

    expect(view.getByTestId("chip-age-G").props.accessibilityState?.selected).toBe(true);
    for (const key of CONTENT_KEYS) {
      expect(view.getByTestId(`chip-limit-${key}-0`).props.accessibilityState?.selected).toBe(true);
    }

    await fireEvent.press(view.getByTestId("toggle-section-runtime"));
    expect(view.getByTestId("text-runtime-value").props.children).toBe(
      t("runtime.custom.value", { n: 119 }),
    );
  });

  it("announces every content limit by category and level in English and Arabic", async () => {
    const view = await render(<MoodScreen />);
    await waitFor(() => expect(view.queryByTestId("mood-loading")).toBeNull());

    const limits = {
      sexualContent: 0,
      violence: 1,
      gore: 2,
      profanity: 3,
      animalHarm: 4,
      disturbingThemes: 2,
    };
    const levelKeys = ["content.none", "content.mild", "content.moderate", "content.strong", "content.any"];
    await act(async () => {
      actions.resetForNewSession();
      actions.setLang("en");
      actions.patchFilters({ limits });
    });

    await fireEvent.press(view.getByTestId("button-fine-tune"));
    await fireEvent.press(view.getByTestId("toggle-section-content"));

    for (const lang of ["en", "ar"] as const) {
      await act(async () => actions.setLang(lang));
      const { t } = getT(lang);

      for (const category of CONTENT_KEYS) {
        for (const level of [0, 1, 2, 3, 4]) {
          const option = view.getByTestId(`chip-limit-${category}-${level}`);
          expect(option.props.accessibilityRole).toBe("button");
          expect(option.props.accessibilityLabel).toBe(t("content.limit.accessibility", {
            category: t(`content.${category}`),
            level: t(levelKeys[level]),
          }));
          expect(option.props.accessibilityState?.selected).toBe(limits[category] === level);
        }
      }
    }

    await fireEvent.press(view.getByTestId("chip-limit-sexualContent-3"));
    expect(view.getByTestId("chip-limit-sexualContent-0").props.accessibilityState?.selected).toBe(false);
    expect(view.getByTestId("chip-limit-sexualContent-3").props.accessibilityState?.selected).toBe(true);
  });
});
