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

function enlargeNavigationText(scale = 2) {
  document.documentElement.style.fontSize = `${16 * scale}px`;
}

function expectNavbarFitsViewport() {
  const navbar = container.querySelector("nav");
  if (!navbar) throw new Error("Public navigation did not render");

  const row = navbar.firstElementChild;
  if (!row) throw new Error("Public navigation row did not render");
  const [brandAndLinks, actions] = Array.from(row.children) as HTMLElement[];
  const first = brandAndLinks.getBoundingClientRect();
  const second = actions.getBoundingClientRect();
  const metrics = {
    viewport: window.innerWidth,
    navbar: { width: navbar.clientWidth, scrollWidth: navbar.scrollWidth },
    documentScrollWidth: document.documentElement.scrollWidth,
    row: { width: row.clientWidth, scrollWidth: row.scrollWidth },
    brand: { left: first.left, right: first.right, width: first.width },
    actions: { left: second.left, right: second.right, width: second.width },
    brandLabelDisplay: getComputedStyle(container.querySelector(".public-navbar-brand-label")!).display,
  };
  expect(navbar.scrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(navbar.clientWidth);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  expect(first.right).toBeLessThanOrEqual(second.left);
}

afterEach(async () => {
  root?.unmount();
  root = undefined;
  container.remove();
  window.history.replaceState({}, "", "/");
  document.documentElement.style.removeProperty("font-size");
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

it.each([320, 768, 1024])(
  "keeps Browse, sign-in, and the menu reachable with enlarged text at %ipx",
  async (width) => {
    await page.viewport(width, 844);
    document.body.append(container);
    root = createRoot(container);
    root.render(<PublicNavbar />);

    const trigger = page.getByRole("button", { name: "Open navigation" });
    await expect.element(trigger).toBeVisible();
    enlargeNavigationText();
    expectNavbarFitsViewport();
    await userEvent.click(trigger);

    const browse = page.getByTestId("link-public-browse");
    const signIn = page.getByTestId("link-public-sign-in");
    await expect.element(browse).toBeVisible();
    await expect.element(signIn).toBeVisible();
    expectNavbarFitsViewport();

    for (const testId of ["link-public-browse", "link-public-sign-in"]) {
      const link = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      if (!link) throw new Error(`${testId} did not render`);
      const bounds = link.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
    }
  },
);

it("keeps the public menu usable on a short screen with enlarged text", async () => {
  await page.viewport(320, 320);
  document.body.append(container);
  root = createRoot(container);
  root.render(<PublicNavbar />);

  const trigger = page.getByRole("button", { name: "Open navigation" });
  await expect.element(trigger).toBeVisible();
  enlargeNavigationText();
  await userEvent.click(trigger);

  const dialog = container.querySelector("dialog");
  if (!dialog) throw new Error("Public navigation dialog did not render");

  const close = container.querySelector<HTMLElement>('[aria-label="Close navigation"]');
  const browse = container.querySelector<HTMLElement>('[data-testid="link-public-browse"]');
  const signIn = container.querySelector<HTMLElement>('[data-testid="link-public-sign-in"]');
  if (!close || !browse || !signIn) throw new Error("Public navigation controls did not render");

  const expectWithinDialogViewport = (element: HTMLElement) => {
    const dialogBounds = dialog.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    expect(bounds.top).toBeGreaterThanOrEqual(dialogBounds.top);
    expect(bounds.bottom).toBeLessThanOrEqual(dialogBounds.bottom);
    expect(bounds.left).toBeGreaterThanOrEqual(dialogBounds.left);
    expect(bounds.right).toBeLessThanOrEqual(dialogBounds.right);
  };

  await expect.element(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Close navigation" })).toBeVisible();
  await expect.element(page.getByTestId("link-public-browse")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Close navigation" })).toHaveFocus();
  expectWithinDialogViewport(close);
  expectWithinDialogViewport(browse);
  expect(dialog.scrollHeight).toBeGreaterThan(dialog.clientHeight);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

  await userEvent.tab();
  await expect.element(page.getByTestId("link-public-browse")).toHaveFocus();
  await userEvent.tab();
  await expect.element(page.getByTestId("link-public-stats")).toHaveFocus();
  await userEvent.tab();
  await expect.element(page.getByTestId("link-public-sign-in")).toHaveFocus();
  expect(dialog.scrollTop).toBeGreaterThan(0);
  expectWithinDialogViewport(signIn);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

  await userEvent.tab({ shift: true });
  await expect.element(page.getByTestId("link-public-stats")).toHaveFocus();
  await userEvent.tab({ shift: true });
  await expect.element(page.getByTestId("link-public-browse")).toHaveFocus();
  await userEvent.tab({ shift: true });
  await expect.element(page.getByRole("button", { name: "Close navigation" })).toHaveFocus();
  expectWithinDialogViewport(close);
  expect(dialog.scrollTop).toBeLessThanOrEqual(2);
  await userEvent.keyboard("{Enter}");
  expect(dialog.open).toBe(false);
});

it("keeps the full public navigation readable and separated at an enlarged text size", async () => {
  await page.viewport(1280, 844);
  document.body.append(container);
  root = createRoot(container);
  root.render(<PublicNavbar />);

  const browse = page.getByRole("link", { name: "Browse", exact: true });
  const signIn = page.getByRole("link", { name: "Sign In", exact: true });
  await expect.element(browse).toBeVisible();
  await expect.element(signIn).toBeVisible();
  enlargeNavigationText();
  expectNavbarFitsViewport();
});

it.each([320, 1280])(
  "keeps the public navigation reachable without horizontal overflow at 400%% text size and %ipx",
  async (width) => {
    await page.viewport(width, 844);
    document.body.append(container);
    root = createRoot(container);
    root.render(<PublicNavbar />);
    enlargeNavigationText(4);

    const trigger = page.getByRole("button", { name: "Open navigation" });
    await expect.element(trigger).toBeVisible();
    await expect.element(page.getByRole("link", { name: "WatchTime", exact: true })).toBeVisible();
    expectNavbarFitsViewport();
    await userEvent.click(trigger);

    const dialog = container.querySelector("dialog");
    const browse = container.querySelector<HTMLElement>('[data-testid="link-public-browse"]');
    const signIn = container.querySelector<HTMLElement>('[data-testid="link-public-sign-in"]');
    if (!dialog || !browse || !signIn) throw new Error("Public navigation controls did not render");

    await expect.element(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
    await expect.element(page.getByTestId("link-public-browse")).toBeVisible();
    await expect.element(page.getByTestId("link-public-sign-in")).toBeVisible();
    expectNavbarFitsViewport();
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    await userEvent.tab();
    await expect.element(page.getByTestId("link-public-browse")).toHaveFocus();
    await userEvent.tab();
    await expect.element(page.getByTestId("link-public-stats")).toHaveFocus();
    await userEvent.tab();
    await expect.element(page.getByTestId("link-public-sign-in")).toHaveFocus();

    const dialogBounds = dialog.getBoundingClientRect();
    const signInBounds = signIn.getBoundingClientRect();
    expect(signInBounds.top).toBeGreaterThanOrEqual(dialogBounds.top);
    expect(signInBounds.bottom).toBeLessThanOrEqual(dialogBounds.bottom);
    expect(signInBounds.left).toBeGreaterThanOrEqual(dialogBounds.left);
    expect(signInBounds.right).toBeLessThanOrEqual(dialogBounds.right);
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    await userEvent.keyboard("{Escape}");
    await expect.element(trigger).toHaveFocus();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
);

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