import React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import "@/index.css";

import { FilterPanel } from "../src/pages/discover-mood/components/FilterPanel";

const container = document.createElement("div");
let root: ReturnType<typeof createRoot> | undefined;

afterEach(() => {
  root?.unmount();
  root = undefined;
  container.remove();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

it("exposes web mood values and clear content-choice labels", async () => {
  document.body.append(container);
  root = createRoot(container);
  root.render(<FilterPanel />);

  const mood = page.getByRole("slider", {
    name: "Feel-good: Heartbreaking to Feel-good",
  });
  await expect.element(mood).toHaveAttribute("aria-valuenow", "50");
  await expect.element(mood).toHaveAttribute("aria-valuetext", "Target 50");

  await userEvent.click(page.getByTestId("button-toggle-section-content"));
  const contentOption = page.getByRole("button", {
    name: "Sexual content limit: Any",
  });
  await expect.element(contentOption).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(page.getByTestId("chip-limit-sexualContent-0"));
  await expect.element(page.getByRole("button", {
    name: "Sexual content limit: Avoid",
  })).toHaveAttribute("aria-pressed", "true");

  await userEvent.click(page.getByTestId("button-toggle-section-runtime"));
  const runtime = page.getByRole("slider", { name: "Custom maximum runtime" });
  await expect.element(runtime).toHaveAttribute("aria-valuenow", "120");
  await expect.element(runtime).toHaveAttribute("aria-valuetext", "Any length");
});
