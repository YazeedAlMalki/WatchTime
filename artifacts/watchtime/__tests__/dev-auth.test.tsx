import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DEV_DEMO_EMAIL,
  DEV_DEMO_PASSWORD,
} from "@workspace/dev-auth";

const mockSetLocation = vi.fn();

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href as string} {...props}>
      {children}
    </a>
  ),
  useLocation: () => [window.location.pathname, mockSetLocation],
}));

import { DevAuthPage } from "@/components/auth/DevAuthPage";

async function fillAndSubmit(container: HTMLElement, email: string, password: string) {
  const emailInput = container.querySelector<HTMLInputElement>('input[name="email"]');
  const passwordInput = container.querySelector<HTMLInputElement>('input[name="password"]');
  const form = container.querySelector<HTMLFormElement>("form");

  if (!emailInput || !passwordInput || !form) {
    throw new Error("Demo auth form did not render");
  }

  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!valueSetter) {
    throw new Error("Input value setter is unavailable");
  }

  act(() => {
    valueSetter.call(emailInput, email);
    emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    valueSetter.call(passwordInput, password);
    passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe.each([
  ["sign-in", "Welcome back"],
  ["sign-up", "Try the demo"],
] as const)("development demo %s route", (mode, heading) => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchSpy = vi.fn();

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState({}, "", `/${mode}`);
    mockSetLocation.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root.render(<DevAuthPage mode={mode} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows validation and stays put for invalid credentials without a request", async () => {
    await fillAndSubmit(container, "wrong@example.com", "wrong-password");

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "incorrect",
    );
    expect(mockSetLocation).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.querySelector("h1")?.textContent).toBe(heading);
  });
});

describe("valid development demo submissions", () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchSpy = vi.fn();

  function render(mode: "sign-in" | "sign-up", url: string) {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState({}, "", url);
    mockSetLocation.mockReset();
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    window.localStorage.clear();

    act(() => {
      root.render(<DevAuthPage mode={mode} />);
    });
  }

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("creates a cookie-backed demo session and preserves a local returnTo path", async () => {
    render("sign-in", "/sign-in?returnTo=%2Ftitle%2F456");

    await fillAndSubmit(container, DEV_DEMO_EMAIL, DEV_DEMO_PASSWORD);

    expect(mockSetLocation).toHaveBeenCalledWith("/title/456");
    expect(fetchSpy).toHaveBeenCalledWith("/api/dev-auth/login", expect.objectContaining({
      method: "POST",
      credentials: "include",
    }));
    expect(window.localStorage.getItem("watchtime.devDemoActive")).toBe("1");
  });

  it("falls back to home when returnTo is absent", async () => {
    render("sign-up", "/sign-up");

    await fillAndSubmit(container, DEV_DEMO_EMAIL, DEV_DEMO_PASSWORD);

    expect(mockSetLocation).toHaveBeenCalledWith("/");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});