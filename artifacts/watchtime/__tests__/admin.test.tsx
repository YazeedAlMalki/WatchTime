import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import type { AdminContentAlias } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({
  queryClient: {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  },
  toast: vi.fn(),
  updateMutation: {
    isPending: false,
    mutate: vi.fn(),
  },
  deleteMutation: {
    isPending: false,
    mutate: vi.fn(),
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("@workspace/api-client-react", () => ({
  useUpdateAdminContentAlias: () => mocks.updateMutation,
  useDeleteAdminContentAlias: () => mocks.deleteMutation,
  getListAdminContentAliasesQueryKey: () => ["/api/admin/content-aliases"],
  getSearchAdminContentQueryKey: () => ["/api/admin/content"],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import { AliasReview } from "@/pages/admin";

const initialAlias: AdminContentAlias = {
  id: 17,
  titleId: 101,
  titleName: "The Lighthouse",
  titleType: "movie",
  titleYear: 2019,
  alias: "Shared Local Title",
  language: "en",
  sourceName: "Editorial test",
  sourceUrl: "https://example.test/source-one",
  isEditorial: true,
  collision: true,
  collisionTitleCount: 2,
  updatedAt: "2026-09-16T00:00:00.000Z",
};

function uniqueAlias(): AdminContentAlias {
  return {
    ...initialAlias,
    alias: "Corrected Local Title",
    language: "fr",
    sourceUrl: "https://example.test/corrected",
    collision: false,
    collisionTitleCount: 1,
  };
}

function setInput(container: HTMLElement, ariaLabel: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(
    `input[aria-label="${ariaLabel}"]`,
  );
  if (!input) throw new Error(`Input not found: ${ariaLabel}`);

  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!valueSetter) throw new Error("Input value setter is unavailable");

  valueSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(container: HTMLElement, label: string) {
  const result = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("admin alternate-title review", () => {
  let container: HTMLDivElement;
  let root: Root;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.queryClient.invalidateQueries.mockClear();
    mocks.toast.mockClear();
    mocks.updateMutation.mutate.mockReset();
    mocks.deleteMutation.mutate.mockReset();
    mocks.updateMutation.mutate.mockImplementation(
      async (_variables: unknown, options?: { onSuccess?: () => Promise<void> }) => {
        await options?.onSuccess?.();
      },
    );
    mocks.deleteMutation.mutate.mockImplementation(
      async (_variables: unknown, options?: { onSuccess?: () => Promise<void> }) => {
        await options?.onSuccess?.();
      },
    );
    confirmSpy = vi.spyOn(window, "confirm");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    confirmSpy.mockRestore();
  });

  function render(aliases: AdminContentAlias[] = [initialAlias]) {
    act(() => {
      root.render(<AliasReview aliases={aliases} isLoading={false} />);
    });
  }

  it("saves alias text, language, and source link, then refreshes collision views", async () => {
    render();

    expect(container.textContent).toContain("2 titles");
    act(() => button(container, "Edit").click());
    act(() => {
      setInput(container, "Alternate title for The Lighthouse", "Corrected Local Title");
      setInput(container, "Language for Shared Local Title", "fr");
      setInput(
        container,
        "Source link for Shared Local Title",
        "https://example.test/corrected",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(mocks.updateMutation.mutate).toHaveBeenCalledWith(
      {
        id: 17,
        data: {
          alias: "Corrected Local Title",
          language: "fr",
          sourceUrl: "https://example.test/corrected",
        },
      },
      expect.any(Object),
    );
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/content-aliases"],
    });
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/content"],
    });

    render([uniqueAlias()]);
    expect(container.textContent).toContain("Corrected Local Title");
    expect(container.textContent).toContain("Unique");
    expect(container.textContent).not.toContain("2 titles");
  });

  it("keeps duplicate and canonical-title conflicts visible to the admin", () => {
    const errors = [
      "That alternate title already belongs to another catalog title.",
      "The alternate title must differ from the canonical title.",
    ];
    mocks.updateMutation.mutate.mockImplementation(
      (_variables: unknown, options?: { onError?: (error: unknown) => void }) => {
        options?.onError?.({ data: { error: errors.shift() } });
      },
    );
    render();
    act(() => button(container, "Edit").click());

    act(() => {
      setInput(container, "Alternate title for The Lighthouse", "Duplicate title");
      button(container, "Save").click();
    });
    act(() => {
      setInput(container, "Alternate title for The Lighthouse", "The Lighthouse");
      button(container, "Save").click();
    });

    expect(mocks.toast).toHaveBeenNthCalledWith(1, {
      title: "Could not update alternate title",
      description: "That alternate title already belongs to another catalog title.",
      variant: "destructive",
    });
    expect(mocks.toast).toHaveBeenNthCalledWith(2, {
      title: "Could not update alternate title",
      description: "The alternate title must differ from the canonical title.",
      variant: "destructive",
    });
    expect(container.textContent).toContain("2 titles");
  });

  it("requires removal confirmation and refreshes collision badges after removal", async () => {
    render();
    confirmSpy.mockReturnValueOnce(false);
    act(() => button(container, "Remove").click());

    expect(confirmSpy).toHaveBeenCalledWith(
      "Remove “Shared Local Title” from The Lighthouse? This cannot be undone.",
    );
    expect(mocks.deleteMutation.mutate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("2 titles");

    confirmSpy.mockReturnValueOnce(true);
    act(() => button(container, "Remove").click());
    await flushEffects();

    expect(mocks.deleteMutation.mutate).toHaveBeenCalledWith(
      { id: 17 },
      expect.any(Object),
    );
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/content-aliases"],
    });
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/content"],
    });

    render([uniqueAlias()]);
    expect(container.textContent).toContain("Unique");
    expect(container.textContent).not.toContain("2 titles");
  });
});