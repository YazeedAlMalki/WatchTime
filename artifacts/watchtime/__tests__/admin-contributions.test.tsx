import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import type { ListAdminContributionsParams, SafetyContribution } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  update: { isPending: false, mutate: vi.fn() },
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListAdminContributions: (params: ListAdminContributionsParams) => mocks.list(params),
  useUpdateAdminContribution: () => mocks.update,
  getListAdminContributionsQueryKey: () => ["/api/admin/contributions"],
  getGetAdminDashboardQueryKey: () => ["/api/admin/dashboard"],
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => mocks.queryClient }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

// Exercise the screen's filter wiring without depending on Radix portal geometry in jsdom.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: {
    value: string; onValueChange: (value: string) => void; children: React.ReactNode;
  }) => <select aria-label="Contribution status" value={value}
    onChange={(event) => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) =>
    <option value={value}>{children}</option>,
}));

import { ModerationTab } from "@/pages/admin";

function contribution(id: number, status: SafetyContribution["status"] = "pending"): SafetyContribution {
  return {
    id, titleId: id, titleName: `Contribution title ${id}`, userId: "review-test",
    category: "violence", severity: "mild", status, createdAt: "2026-10-22T00:00:00.000Z",
  };
}

describe("admin contribution pagination", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rows: SafetyContribution[];
  let isLoading: boolean;

  function button(label: string) {
    const found = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.trim() === label);
    if (!found) throw new Error(`Button not found: ${label}`);
    return found;
  }
  function render() {
    act(() => root.render(<ModerationTab />));
  }
  function filter(value: string) {
    act(() => {
      const select = container.querySelector("select")!;
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    rows = Array.from({ length: 51 }, (_, index) => contribution(index + 1));
    isLoading = false;
    mocks.list.mockImplementation(() => ({ data: isLoading ? undefined : rows, isLoading }));
    mocks.update.mutate.mockImplementation((_variables, options) => options?.onSuccess?.());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows only 50 rows and keeps the status when moving forward and backward", () => {
    render();
    expect(mocks.list).toHaveBeenLastCalledWith({ status: "pending", limit: 51, offset: 0 });
    expect(container.textContent).toContain("Contribution title 50");
    expect(container.textContent).not.toContain("Contribution title 51");
    expect(button("Previous").disabled).toBe(true);
    filter("flagged");
    act(() => button("Next").click());
    expect(mocks.list).toHaveBeenLastCalledWith({ status: "flagged", limit: 51, offset: 50 });
    expect(container.textContent).toContain("Page 2");
    act(() => button("Previous").click());
    expect(mocks.list).toHaveBeenLastCalledWith({ status: "flagged", limit: 51, offset: 0 });
  });

  it("resets to page one on status changes and omits status for All", () => {
    render();
    act(() => button("Next").click());
    filter("approved");
    expect(mocks.list).toHaveBeenLastCalledWith({ status: "approved", limit: 51, offset: 0 });
    act(() => button("Next").click());
    filter("all");
    expect(mocks.list).toHaveBeenLastCalledWith({ limit: 51, offset: 0 });
    act(() => button("Next").click());
    expect(mocks.list).toHaveBeenLastCalledWith({ limit: 51, offset: 50 });
  });

  it("disables Next on a final page and lets admins return from an empty page", () => {
    render();
    act(() => button("Next").click());
    rows = [contribution(52)];
    render();
    expect(button("Next").disabled).toBe(true);
    expect(button("Previous").disabled).toBe(false);
    rows = [];
    render();
    expect(container.textContent).toContain("No contributions");
    act(() => button("Previous").click());
    expect(mocks.list).toHaveBeenLastCalledWith({ status: "pending", limit: 51, offset: 0 });
  });

  it("does not offer another page for an exact page or a loading page", () => {
    rows = rows.slice(0, 50);
    render();
    expect(container.querySelector("nav")).toBeNull();
    rows.push(contribution(51));
    render();
    act(() => button("Next").click());
    isLoading = true;
    render();
    expect(button("Next").disabled).toBe(true);
    expect(button("Previous").disabled).toBe(true);
    expect(container.textContent).not.toContain("No contributions");
  });

  it("invalidates all contribution pages after moderation without losing filter or page", () => {
    render();
    filter("flagged");
    act(() => button("Next").click());
    act(() => button("Approve").click());
    expect(mocks.update.mutate).toHaveBeenCalledWith(
      { contributionId: 1, data: { status: "approved" } }, expect.any(Object),
    );
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/contributions"],
    });
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/dashboard"],
    });
    expect(mocks.list).toHaveBeenLastCalledWith({ status: "flagged", limit: 51, offset: 50 });
  });
});
