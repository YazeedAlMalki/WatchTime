import React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import "@/index.css";

vi.mock("@/pages/landing", () => ({
  default: () => <h1>Public landing</h1>,
}));

import App from "@/App";
import { PublicNavbar } from "@/components/layout/PublicNavbar";

const container = document.createElement("div");
let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  root?.unmount();
  root = undefined;
  container.remove();
  window.history.replaceState({}, "", "/");
  await page.viewport(390, 844);
});

it.each([640, 900])("names the public search shortcut at a %ipx viewport", async (width) => {
  await page.viewport(width, 844);
  document.body.append(container);
  root = createRoot(container);
  root.render(<PublicNavbar />);

  const search = page.getByRole("link", { name: "Browse titles", exact: true });
  await expect.element(search).toBeVisible();
  await expect.element(search).toHaveAccessibleName("Browse titles");
  await expect.element(search).toHaveAttribute("href", "/browse");
});

it("keeps the public mobile menu keyboard accessible without loading authenticated scripts", async () => {
  window.history.replaceState({}, "", "/");
  document.cookie = "__session=; Max-Age=0; path=/";
  document.cookie = "__client=; Max-Age=0; path=/";
  window.localStorage.removeItem("watchtime.devDemoActive");
  document.body.append(container);
  root = createRoot(container);
  root.render(<App />);

  const trigger = page.getByRole("button", { name: "Open navigation" });
  const dialog = page.getByRole("dialog", { name: "Navigation" });
  const close = page.getByRole("button", { name: "Close navigation" });
  await expect.element(trigger).toBeVisible();
  expect(container.querySelector("dialog")?.open).toBe(false);

  // A public menu interaction must not request the lazy authenticated route.
  const authenticatedScripts = () => performance.getEntriesByType("resource")
    .filter((entry) => /\/authenticated-app(?:\.tsx)?(?:\?|$)/.test(entry.name));
  const initialAuthenticatedScripts = authenticatedScripts().length;

  // Focus the trigger with the keyboard (rather than clicking it).
  for (let attempt = 0; attempt < 12 && document.activeElement !== container.querySelector('[aria-label="Open navigation"]'); attempt++) {
    await userEvent.tab();
  }
  await expect.element(trigger).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(dialog).toBeVisible();
  await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
  await expect.element(close).toHaveFocus();
  expect(authenticatedScripts()).toHaveLength(initialAuthenticatedScripts);

  await userEvent.keyboard("{Escape}");
  expect(container.querySelector("dialog")?.open).toBe(false);
  await expect.element(trigger).toHaveFocus();
  await expect.element(trigger).toHaveAttribute("aria-expanded", "false");

  await userEvent.keyboard("{Enter}");
  await expect.element(close).toHaveFocus();
  await userEvent.click(close);
  expect(container.querySelector("dialog")?.open).toBe(false);
  await expect.element(trigger).toHaveFocus();

  await userEvent.keyboard("{Enter}");
  await expect.element(dialog).toBeVisible();
  expect(authenticatedScripts()).toHaveLength(initialAuthenticatedScripts);
  await userEvent.click(page.getByTestId("link-public-browse"));
  expect(window.location.pathname).toBe("/browse");
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.poll(() => authenticatedScripts().length).toBeGreaterThan(initialAuthenticatedScripts);
});