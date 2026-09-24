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
      root.render(
        <AliasReview
          aliases={aliases}
          isLoading={false}
          isError={false}
          isFetching={false}
          onRetry={() => {}}
          ownership="all"
          onOwnershipChange={() => {}}
        />,
      );
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
          expectedUpdatedAt: initialAlias.updatedAt,
        },
      },
      expect.any(Object),
    );
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/content-aliases"],
    }, { throwOnError: true });
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/content"],
    }, { throwOnError: true });

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

  it("refreshes collision badges when a stale draft is rejected", async () => {
    mocks.updateMutation.mutate.mockImplementation(
      (_variables: unknown, options?: { onError?: (error: unknown) => Promise<void> }) => {
        void options?.onError?.({
          data: {
            code: "stale_alias",
            error:
              "This alternate title changed while you were editing. Refresh the list and review the newer correction before saving.",
            current: {
              ...initialAlias,
              alias: "Newer Admin Correction",
              language: "de",
              sourceName: "Admin editorial",
              sourceUrl: "https://example.test/newer-correction",
              collision: false,
              collisionTitleCount: 1,
              updatedAt: "2026-09-17T00:00:00.000Z",
            },
          },
        });
      },
    );
    render();
    act(() => button(container, "Edit").click());

    act(() => {
      setInput(container, "Alternate title for The Lighthouse", "Stale correction");
      button(container, "Save").click();
    });
    await flushEffects();

    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/content-aliases"],
    }, { throwOnError: true });
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/content"],
    }, { throwOnError: true });
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not update alternate title",
      description:
        "Your draft was not saved. Review the newer correction below before trying again.",
      variant: "destructive",
    });
    expect(container.textContent).toContain("A newer correction is already saved");
    expect(container.textContent).toContain("Newer Admin Correction");
    expect(container.textContent).toContain("de");
    expect(container.textContent).toContain("Admin editorial");
    expect(container.textContent).toContain("Unique");
    expect(container.textContent).toContain("Current version");
    expect(container.textContent).not.toContain("Save");
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
      {
        id: 17,
        data: { expectedUpdatedAt: initialAlias.updatedAt },
      },
      expect.any(Object),
    );
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/content-aliases"],
    }, { throwOnError: true });
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/content"],
    }, { throwOnError: true });

    render([uniqueAlias()]);
    expect(container.textContent).toContain("Unique");
    expect(container.textContent).not.toContain("2 titles");
  });

  it("refreshes collision badges and explains a stale removal conflict", async () => {
    mocks.deleteMutation.mutate.mockImplementation(
      (_variables: unknown, options?: { onError?: (error: unknown) => Promise<void> }) => {
        void options?.onError?.({
          data: {
            error:
              "This alternate title changed while you were reviewing it. Refresh the list and review the newer correction before removing it.",
          },
        });
      },
    );
    render();
    confirmSpy.mockReturnValue(true);

    act(() => button(container, "Remove").click());
    await flushEffects();

    expect(mocks.deleteMutation.mutate).toHaveBeenCalledWith(
      {
        id: 17,
        data: { expectedUpdatedAt: initialAlias.updatedAt },
      },
      expect.any(Object),
    );
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/content-aliases"],
    }, { throwOnError: true });
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/content"],
    }, { throwOnError: true });
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not remove alternate title",
      description:
        "This alternate title changed while you were reviewing it. Refresh the list and review the newer correction before removing it.",
      variant: "destructive",
    });
    expect(container.textContent).toContain("2 titles");
  });

  it("keeps the edited alias visible and offers a retry when refresh fails", async () => {
    mocks.queryClient.invalidateQueries.mockRejectedValueOnce(
      new Error("Alias refresh unavailable"),
    );
    render();

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Corrected Local Title",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(container.textContent).toContain("Retry refresh");
    expect(container.textContent).toContain("2 titles");
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Alternate title updated, but refresh failed",
      description:
        "The saved change may not be reflected in the review table yet. Retry the refresh below.",
      variant: "destructive",
    });

    act(() => button(container, "Retry refresh").click());
    await flushEffects();
    expect(container.textContent).not.toContain("Alternate-title refresh failed");
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(4);
  });

  it("keeps the removed alias visible and offers a retry when refresh fails", async () => {
    mocks.queryClient.invalidateQueries.mockRejectedValueOnce(
      new Error("Alias refresh unavailable"),
    );
    render();
    confirmSpy.mockReturnValue(true);

    act(() => button(container, "Remove").click());
    await flushEffects();

    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(container.textContent).toContain("Retry refresh");
    expect(container.textContent).toContain("2 titles");
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Alternate title removed, but refresh failed",
      description:
        "The removal succeeded, but the review table may still be stale. Retry the refresh below.",
      variant: "destructive",
    });

    act(() => button(container, "Retry refresh").click());
    await flushEffects();
    expect(container.textContent).not.toContain("Alternate-title refresh failed");
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(4);
  });
});
