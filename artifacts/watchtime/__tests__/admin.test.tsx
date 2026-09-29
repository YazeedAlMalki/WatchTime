import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import type {
  AdminContentAlias,
  AdminContentAliasRecord,
} from "@workspace/api-client-react";

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
    mocks.queryClient.invalidateQueries.mockReset();
    mocks.queryClient.invalidateQueries.mockResolvedValue(undefined);
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

  it("pins and highlights a linked alias outside the current result set and copies its record link", async () => {
    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      act(() => root.render(
        <AliasReview
          aliases={[]}
          isLoading={false}
          isError={false}
          isFetching={false}
          onRetry={() => {}}
          ownership="provider"
          onOwnershipChange={() => {}}
          reviewUrl="/admin?tab=content&region=FR&q=Other&ownership=provider"
          linkedAliasId={17}
          linkedAlias={initialAlias}
        />,
      ));
      expect(container.textContent).toContain("Shared Local Title");
      expect(container.textContent).toContain("shown above the filtered results");
      expect(container.querySelector("tr.bg-primary\\/10")?.textContent).toContain("Shared Local Title");
      act(() => button(container, "Copy link").click());
      await flushEffects();
      const copied = new URL(writeText.mock.calls[0][0]);
      expect(copied.searchParams.get("aliasId")).toBe("17");
      expect(copied.searchParams.get("q")).toBe("Other");
      expect(copied.searchParams.get("ownership")).toBe("provider");
      expect(mocks.toast).toHaveBeenCalledWith({ title: "Alternate title link copied" });
    } finally {
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

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

  it("shows newer values after stale-save refresh failure", async () => {
    const currentVersion = "2026-09-18T12:30:00.000Z";
    const currentAlias: AdminContentAlias = {
      ...initialAlias,
      alias: "Newest Admin Correction",
      language: "it",
      sourceName: "Current editorial source",
      sourceUrl: "https://example.test/current-correction",
      collision: true,
      collisionTitleCount: 3,
      updatedAt: currentVersion,
    };
    mocks.queryClient.invalidateQueries.mockRejectedValueOnce(
      new Error("Alias refresh unavailable"),
    );
    mocks.updateMutation.mutate.mockImplementation(
      (
        _variables: unknown,
        options?: { onError?: (error: unknown) => Promise<void> },
      ) => {
        void options?.onError?.({
          data: {
            code: "stale_alias",
            error:
              "This alternate title changed while you were editing. Refresh the list and review the newer correction before saving.",
            current: currentAlias,
          },
        });
      },
    );
    render();
    act(() => button(container, "Edit").click());

    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Stale draft correction",
      );
      setInput(container, "Language for Shared Local Title", "es");
      setInput(
        container,
        "Source link for Shared Local Title",
        "https://example.test/stale-draft",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(mocks.updateMutation.mutate).toHaveBeenCalledWith(
      {
        id: initialAlias.id,
        data: {
          alias: "Stale draft correction",
          language: "es",
          sourceUrl: "https://example.test/stale-draft",
          expectedUpdatedAt: initialAlias.updatedAt,
        },
      },
      expect.any(Object),
    );
    expect(container.textContent).toContain(
      "A newer correction is already saved",
    );
    expect(container.textContent).toContain(currentAlias.alias);
    expect(container.textContent).toContain(currentAlias.titleName);
    expect(container.textContent).toContain(currentAlias.language);
    expect(container.textContent).toContain(currentAlias.sourceName);
    expect(container.textContent).toContain("3 titles share this alias");
    expect(container.textContent).toContain("Current version");
    expect(container.textContent).toContain(
      new Date(currentVersion).toLocaleString(),
    );
    expect(
      container.querySelector<HTMLAnchorElement>(
        `a[href="${currentAlias.sourceUrl}"]`,
      )?.textContent,
    ).toBe(currentAlias.sourceName);
    expect(container.textContent).not.toContain("Stale draft correction");
    expect(container.textContent).toContain("Shared Local Title");
    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(container.textContent).toContain("Retry refresh");
    expect(container.textContent).toContain("The review data may be stale.");
    expect(container.textContent).not.toContain("Your change was saved");
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not update alternate title",
      description:
        "Your draft was not saved. Review the newer correction below before trying again.",
      variant: "destructive",
    });

    act(() => button(container, "Retry refresh").click());
    await flushEffects();

    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
    expect(container.textContent).toContain(currentAlias.alias);
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(4);
  });

  it("keeps a saved conflict correction visible when the alias refresh fails", async () => {
    const currentAlias: AdminContentAlias = {
      ...initialAlias,
      alias: "Newer Admin Correction",
      language: "de",
      sourceName: "Admin editorial",
      sourceUrl: "https://example.test/newer-correction",
      collision: true,
      collisionTitleCount: 3,
      updatedAt: "2026-09-18T12:30:00.000Z",
    };
    const savedRecord: AdminContentAliasRecord = {
      id: currentAlias.id,
      titleId: currentAlias.titleId,
      alias: "Accepted Admin Correction",
      normalizedAlias: "accepted admin correction",
      language: "fr",
      sourceName: currentAlias.sourceName,
      sourceUrl: "https://example.test/accepted-correction",
      isEditorial: currentAlias.isEditorial,
      createdAt: initialAlias.updatedAt,
      updatedAt: "2026-09-19T12:30:00.000Z",
    };
    let mutationCount = 0;
    mocks.updateMutation.mutate.mockImplementation(
      (
        _variables: unknown,
        options?: {
          onSuccess?: (record: AdminContentAliasRecord) => Promise<void>;
          onError?: (error: unknown) => Promise<void>;
        },
      ) => {
        mutationCount += 1;
        if (mutationCount === 1) {
          void options?.onError?.({
            data: {
              code: "stale_alias",
              error: "This alternate title changed while you were editing.",
              current: currentAlias,
            },
          });
        } else {
          void options?.onSuccess?.(savedRecord);
        }
      },
    );
    render();

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Stale draft correction",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(container.textContent).toContain("A newer correction is already saved");
    mocks.queryClient.invalidateQueries.mockRejectedValueOnce(
      new Error("Alias refresh unavailable"),
    );
    act(() => button(container, "Edit current correction").click());
    act(() => {
      setInput(
        container,
        "Alternate title for current correction",
        savedRecord.alias,
      );
      setInput(
        container,
        "Language for current correction",
        savedRecord.language ?? "",
      );
      setInput(
        container,
        "Source link for current correction",
        savedRecord.sourceUrl ?? "",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    const savedRow = container.querySelector("tbody tr");
    expect(savedRow?.textContent).toContain(savedRecord.alias);
    expect(savedRow?.textContent).toContain(savedRecord.language);
    expect(savedRow?.querySelector<HTMLAnchorElement>(
      `a[href="${savedRecord.sourceUrl}"]`,
    )?.textContent).toBe(savedRecord.sourceName);
    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(container.textContent).toContain(
      "Your saved correction is shown in the table below",
    );
    expect(container.textContent).toContain("Retry refresh");
    expect(container.textContent).not.toContain("A newer correction is already saved");

    const latestServerAlias: AdminContentAlias = {
      ...currentAlias,
      alias: "Latest server correction",
      language: "it",
      sourceUrl: "https://example.test/latest-server-correction",
    };
    act(() => button(container, "Retry refresh").click());
    await flushEffects();
    render([latestServerAlias]);

    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
    expect(container.querySelector("tbody tr")?.textContent).toContain(
      latestServerAlias.alias,
    );
    expect(container.querySelector("tbody tr")?.textContent).not.toContain(
      savedRecord.alias,
    );
  });

  it("edits the authoritative conflict correction while list refresh is pending and failed", async () => {
    let rejectRefresh!: (reason?: unknown) => void;
    const pendingRefresh = new Promise<void>((_resolve, reject) => {
      rejectRefresh = reject;
    });
    mocks.queryClient.invalidateQueries.mockImplementation(
      () => pendingRefresh,
    );
    const currentCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "Newer Admin Correction",
      language: "de",
      sourceName: "Admin editorial",
      sourceUrl: "https://example.test/newer-correction",
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    let mutationCount = 0;
    mocks.updateMutation.mutate.mockImplementation(
      (
        _variables: unknown,
        options?: {
          onSuccess?: () => Promise<void>;
          onError?: (error: unknown) => Promise<void>;
        },
      ) => {
        mutationCount += 1;
        if (mutationCount === 1) {
          void options?.onError?.({
            data: {
              code: "stale_alias",
              error: "This alternate title changed while you were editing.",
              current: currentCorrection,
            },
          });
        } else {
          void options?.onSuccess?.();
        }
      },
    );
    render();

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Stale correction",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(container.textContent).toContain("A newer correction is already saved");
    render([]);
    act(() => button(container, "Edit current correction").click());
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Alternate title for current correction"]',
      )?.value,
    ).toBe("Newer Admin Correction");
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Language for current correction"]',
      )?.value,
    ).toBe("de");
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Source link for current correction"]',
      )?.value,
    ).toBe("https://example.test/newer-correction");

    act(() => {
      setInput(
        container,
        "Alternate title for current correction",
        "Follow-up correction",
      );
      button(container, "Save").click();
    });

    expect(mocks.updateMutation.mutate).toHaveBeenNthCalledWith(
      2,
      {
        id: currentCorrection.id,
        data: {
          alias: "Follow-up correction",
          language: "de",
          sourceUrl: "https://example.test/newer-correction",
          expectedUpdatedAt: currentCorrection.updatedAt,
        },
      },
      expect.any(Object),
    );

    await act(async () => {
      rejectRefresh(new Error("Alias refresh unavailable"));
      await Promise.resolve();
    });
    await flushEffects();
    expect(container.textContent).toContain("Alternate-title refresh failed");
  });

  it("shows and saves the newest correction after a second stale edit conflict", async () => {
    const firstCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "First admin correction",
      language: "de",
      sourceName: "First editorial source",
      sourceUrl: "https://example.test/first-correction",
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    const newestCorrection: AdminContentAlias = {
      ...firstCorrection,
      alias: "Newest admin correction",
      language: "it",
      sourceName: "Newest editorial source",
      sourceUrl: "https://example.test/newest-correction",
      collision: true,
      collisionTitleCount: 4,
      updatedAt: "2026-09-18T12:30:00.000Z",
    };
    let mutationCount = 0;
    mocks.updateMutation.mutate.mockImplementation(
      async (
        _variables: unknown,
        options?: {
          onSuccess?: () => Promise<void>;
          onError?: (error: unknown) => Promise<void>;
        },
      ) => {
        mutationCount += 1;
        if (mutationCount === 1 || mutationCount === 2) {
          const current =
            mutationCount === 1 ? firstCorrection : newestCorrection;
          await options?.onError?.({
            data: {
              code: "stale_alias",
              error: "This alternate title changed while you were editing.",
              current,
            },
          });
        } else {
          await options?.onSuccess?.();
        }
      },
    );
    render();

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "First stale draft",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(container.textContent).toContain(firstCorrection.alias);
    expect(container.textContent).toContain(
      new Date(firstCorrection.updatedAt).toLocaleString(),
    );
    act(() => button(container, "Edit current correction").click());
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Alternate title for current correction"]',
      )?.value,
    ).toBe(firstCorrection.alias);

    act(() => {
      setInput(
        container,
        "Alternate title for current correction",
        "Second stale draft",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(mocks.updateMutation.mutate).toHaveBeenNthCalledWith(
      2,
      {
        id: firstCorrection.id,
        data: {
          alias: "Second stale draft",
          language: firstCorrection.language,
          sourceUrl: firstCorrection.sourceUrl,
          expectedUpdatedAt: firstCorrection.updatedAt,
        },
      },
      expect.any(Object),
    );
    const conflictNotice = container.querySelector<HTMLElement>(
      '[role="alert"]',
    );
    expect(conflictNotice?.textContent).toContain(newestCorrection.alias);
    expect(conflictNotice?.textContent).toContain(newestCorrection.language);
    expect(conflictNotice?.textContent).toContain(newestCorrection.sourceName);
    expect(conflictNotice?.textContent).toContain("4 titles share this alias");
    expect(conflictNotice?.textContent).toContain("Current version");
    expect(conflictNotice?.textContent).toContain(
      new Date(newestCorrection.updatedAt).toLocaleString(),
    );
    expect(conflictNotice?.textContent).not.toContain(firstCorrection.alias);
    expect(conflictNotice?.textContent).not.toContain("Second stale draft");
    expect(
      container.querySelector(
        'input[aria-label="Alternate title for current correction"]',
      ),
    ).toBeNull();

    act(() => button(container, "Edit current correction").click());
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Alternate title for current correction"]',
      )?.value,
    ).toBe(newestCorrection.alias);
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Language for current correction"]',
      )?.value,
    ).toBe(newestCorrection.language);
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Source link for current correction"]',
      )?.value,
    ).toBe(newestCorrection.sourceUrl);

    act(() => {
      setInput(
        container,
        "Alternate title for current correction",
        "Saved after newest conflict",
      );
      button(container, "Save").click();
    });

    expect(mocks.updateMutation.mutate).toHaveBeenNthCalledWith(
      3,
      {
        id: newestCorrection.id,
        data: {
          alias: "Saved after newest conflict",
          language: newestCorrection.language,
          sourceUrl: newestCorrection.sourceUrl,
          expectedUpdatedAt: newestCorrection.updatedAt,
        },
      },
      expect.any(Object),
    );
    await flushEffects();
    expect(container.textContent).not.toContain(
      "A newer correction is already saved",
    );
    expect(container.textContent).not.toContain("Current version");
  });

  it("clears a stale-edit warning only after its correction is removed", async () => {
    const currentCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "Newer Admin Correction",
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    mocks.updateMutation.mutate.mockImplementation(
      (
        _variables: unknown,
        options?: { onError?: (error: unknown) => Promise<void> },
      ) => {
        void options?.onError?.({
          data: {
            code: "stale_alias",
            error: "This alternate title changed while you were editing.",
            current: currentCorrection,
          },
        });
      },
    );
    render();
    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Stale draft correction",
      );
      button(container, "Save").click();
    });
    await flushEffects();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      currentCorrection.alias,
    );

    render([currentCorrection]);
    confirmSpy.mockReturnValue(true);
    act(() => button(container, "Remove").click());
    await flushEffects();

    expect(mocks.deleteMutation.mutate).toHaveBeenCalledWith(
      {
        id: currentCorrection.id,
        data: { expectedUpdatedAt: currentCorrection.updatedAt },
      },
      expect.any(Object),
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps a stale-edit warning when removing its correction fails", async () => {
    const currentCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "Newer Admin Correction",
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    mocks.updateMutation.mutate.mockImplementation(
      (
        _variables: unknown,
        options?: { onError?: (error: unknown) => Promise<void> },
      ) => {
        void options?.onError?.({
          data: {
            code: "stale_alias",
            error: "This alternate title changed while you were editing.",
            current: currentCorrection,
          },
        });
      },
    );
    mocks.deleteMutation.mutate.mockImplementation(
      (
        _variables: unknown,
        options?: { onError?: (error: unknown) => Promise<void> },
      ) => {
        void options?.onError?.(new Error("Removal unavailable"));
      },
    );
    render();
    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Stale draft correction",
      );
      button(container, "Save").click();
    });
    await flushEffects();
    render([currentCorrection]);
    confirmSpy.mockReturnValue(true);

    act(() => button(container, "Remove").click());
    await flushEffects();

    const conflictNotice = container.querySelector('[role="alert"]');
    expect(conflictNotice?.textContent).toContain(
      "A newer correction is already saved",
    );
    expect(conflictNotice?.textContent).toContain(currentCorrection.alias);
    expect(conflictNotice?.textContent).toContain("Current version");
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not remove alternate title",
      description: "Removal unavailable",
      variant: "destructive",
    });
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

  it.each([
    {
      scenario: "alias-only",
      failedQueryKeys: ["/api/admin/content-aliases"],
      expectedFailure: "alternate-title list (alias records)",
      unaffectedData: "catalog search (collision results)",
    },
    {
      scenario: "catalog-only",
      failedQueryKeys: ["/api/admin/content"],
      expectedFailure: "catalog search (collision results)",
      unaffectedData: "alternate-title list (alias records)",
    },
    {
      scenario: "simultaneous",
      failedQueryKeys: ["/api/admin/content-aliases", "/api/admin/content"],
      expectedFailure:
        "alternate-title list (alias records) and catalog search (collision results)",
      unaffectedData: null,
    },
  ])(
    "identifies $scenario refresh failures and retries the current review",
    async ({ failedQueryKeys, expectedFailure, unaffectedData }) => {
      const failedQueries = new Set(failedQueryKeys);
      const rejectedQueries = new Set<string>();
      mocks.queryClient.invalidateQueries.mockImplementation(
        ({ queryKey }: { queryKey: string[] }) => {
          const requestKey = queryKey[0];
          if (
            failedQueries.has(requestKey) &&
            !rejectedQueries.has(requestKey)
          ) {
            rejectedQueries.add(requestKey);
            return Promise.reject(new Error("Review data unavailable"));
          }
          return Promise.resolve();
        },
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
      expect(container.textContent).toContain(expectedFailure);
      if (unaffectedData) {
        expect(container.textContent).not.toContain(unaffectedData);
      }
      expect(container.textContent).toContain("2 titles");
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Alternate title updated, but refresh failed",
          description: expect.stringContaining(expectedFailure),
          variant: "destructive",
        }),
      );

      const currentPath = window.location.pathname;
      act(() => button(container, "Retry refresh").click());
      await flushEffects();
      expect(container.textContent).not.toContain(
        "Alternate-title refresh failed",
      );
      expect(window.location.pathname).toBe(currentPath);
      expect(
        mocks.queryClient.invalidateQueries.mock.calls.map(
          ([filter]: [{ queryKey: string[] }]) => filter.queryKey[0],
        ),
      ).toEqual([
        "/api/admin/content-aliases",
        "/api/admin/content",
        "/api/admin/content-aliases",
        "/api/admin/content",
      ]);
    },
  );

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
        "The removal succeeded, but the review table may still be stale. Failed refresh request: alternate-title list (alias records). Retry the refresh below.",
      variant: "destructive",
    });

    act(() => button(container, "Retry refresh").click());
    await flushEffects();
    expect(container.textContent).not.toContain("Alternate-title refresh failed");
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(4);
  });
});
