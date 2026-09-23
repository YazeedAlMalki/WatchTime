import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const auth = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    state: "loading" as "loading" | "signed-in" | "signed-out",
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify() {
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock("@clerk/react", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
    Show: ({ when, children }: { when: string; children: React.ReactNode }) => {
      const state = useSyncExternalStore(auth.subscribe, () => auth.state);
      return state === when ? children : null;
    },
    SignIn: () => null,
    SignUp: () => null,
    useClerk: () => ({ signOut: vi.fn() }),
    useUser: () => ({ user: { firstName: "Returning", fullName: "Returning User" } }),
  };
});
vi.mock("@clerk/react/internal", () => ({ publishableKeyFromHost: () => "test-key" }));
vi.mock("@clerk/themes", () => ({ shadcn: {} }));
vi.mock("@/pages/landing", () => ({
  default: () => <h1>Public landing</h1>,
}));
vi.mock("@/pages/home", () => ({
  default: () => <h1>Dashboard home</h1>,
}));

import App from "@/App";

function signedOutControls(node: ParentNode): Element[] {
  return [...node.querySelectorAll('a[href="/sign-in"], a[href="/sign-up"]')];
}

async function loadAuthenticatedRoute() {
  await act(async () => {
    await import("@/authenticated-app");
  });
}

describe("root route session resolution", () => {
  let container: HTMLDivElement;
  let root: Root;
  let observer: MutationObserver;
  let signedOutControlsSeen: Element[];

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState({}, "", "/");
    document.cookie = "__session=; Max-Age=0; path=/";
    document.cookie = "__client=; Max-Age=0; path=/";
    window.localStorage.removeItem("watchtime.devDemoActive");
    auth.state = "loading";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    signedOutControlsSeen = [];
    observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            if (node.matches('a[href="/sign-in"], a[href="/sign-up"]')) {
              signedOutControlsSeen.push(node);
            }
            signedOutControlsSeen.push(...signedOutControls(node));
          }
        }
      }
    });
    observer.observe(container, { childList: true, subtree: true });
  });

  afterEach(() => {
    act(() => root.unmount());
    observer.disconnect();
    container.remove();
  });

  it("redirects a returning session to /home without ever mounting signed-out navigation", async () => {
    document.cookie = "__session=valid-session-hint; path=/";

    act(() => root.render(<App />));
    expect(container.querySelector('[aria-label="Loading session"]')).not.toBeNull();
    expect(signedOutControls(container)).toHaveLength(0);

    await loadAuthenticatedRoute();
    expect(container.textContent).toContain("WatchTime");
    expect(signedOutControls(container)).toHaveLength(0);

    await act(async () => {
      auth.state = "signed-in";
      auth.notify();
      await import("@/pages/home");
    });
    expect(window.location.pathname).toBe("/home");
    expect(container.textContent).toContain("Dashboard home");
    expect(signedOutControls(container)).toHaveLength(0);
    expect(signedOutControlsSeen).toHaveLength(0);
  });

  it("also waits for Clerk sessions identified by the __client cookie", async () => {
    document.cookie = "__client=clerk-client-hint; path=/";
    act(() => root.render(<App />));
    expect(container.textContent).not.toContain("Public landing");
    expect(signedOutControls(container)).toHaveLength(0);

    await loadAuthenticatedRoute();
    expect(container.textContent).toContain("WatchTime");
    await act(async () => {
      auth.state = "signed-in";
      auth.notify();
      await import("@/pages/home");
    });
    expect(window.location.pathname).toBe("/home");

    expect(signedOutControlsSeen).toHaveLength(0);
  });

  it("keeps the landing page usable when a session hint is stale", async () => {
    document.cookie = "__session=stale-hint; path=/";
    act(() => root.render(<App />));
    expect(signedOutControls(container)).toHaveLength(0);
    await loadAuthenticatedRoute();
    expect(container.textContent).toContain("WatchTime");
    expect(signedOutControls(container)).toHaveLength(0);

    await act(async () => {
      auth.state = "signed-out";
      auth.notify();
    });
    expect(window.location.pathname).toBe("/");
    expect(container.textContent).toContain("Public landing");
    expect(signedOutControls(container).length).toBeGreaterThan(0);
  });

  it("shows the public landing page without a session hint", () => {
    act(() => root.render(<App />));
    expect(container.textContent).toContain("Public landing");
    expect(signedOutControls(container).length).toBeGreaterThan(0);
  });
});