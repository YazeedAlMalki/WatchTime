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
    setQueriesData: vi.fn(),
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
    mocks.queryClient.setQueriesData.mockReset();
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
    vi.useRealTimers();
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

  type RefreshRequest = "aliases" | "catalog";

  function setRefreshFailures(failedRequests: RefreshRequest[]) {
    mocks.queryClient.invalidateQueries.mockImplementation(
      ({ queryKey }: { queryKey: string[] }) => {
        const request =
          queryKey[0] === "/api/admin/content-aliases"
            ? "aliases"
            : "catalog";
        return failedRequests.includes(request)
          ? Promise.reject(new Error(`${request} refresh unavailable`))
          : Promise.resolve();
      },
    );
  }

  function expectRefreshCalls(requests: RefreshRequest[]) {
    expect(
      mocks.queryClient.invalidateQueries.mock.calls.map(
        ([filters]) => filters.queryKey[0],
      ),
    ).toEqual(
      requests.map((request) =>
        request === "aliases"
          ? "/api/admin/content-aliases"
          : "/api/admin/content",
      ),
    );
  }

  async function saveAliasToTriggerRefresh(failedRequests: RefreshRequest[]) {
    setRefreshFailures(failedRequests);
    render();
    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Updated Local Title",
      );
      button(container, "Save").click();
    });
    await flushEffects();
    expect(container.textContent).toContain("Alternate-title refresh failed");
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

  it("keeps a saved correction visible when a successful refresh removes it from the active search", async () => {
    let updateFilteredAliases!: () => void;
    function FilteredAliasReview() {
      const [aliases, setAliases] = React.useState([initialAlias]);
      const [total, setTotal] = React.useState(1);
      updateFilteredAliases = () => {
        setAliases([]);
        setTotal(0);
      };
      return (
        <AliasReview
          aliases={aliases}
          q={initialAlias.alias}
          aliasTotal={total}
          isLoading={false}
          isError={false}
          isFetching={false}
          onRetry={() => {}}
          ownership="all"
          onOwnershipChange={() => {}}
        />
      );
    }
    mocks.queryClient.invalidateQueries.mockImplementation(
      ({ queryKey }: { queryKey: string[] }) => {
        if (queryKey[0] === "/api/admin/content-aliases") {
          updateFilteredAliases();
        }
        return Promise.resolve();
      },
    );
    act(() => root.render(<FilteredAliasReview />));

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Updated Local Title",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expectRefreshCalls(["aliases", "catalog"]);
    expect(container.textContent).toContain("0 aliases");
    expect(container.textContent).toContain(
      "Saved correction: Updated Local Title is shown separately above the current page of filtered results. The result count and page navigation remain based on the filtered list.",
    );
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("Updated Local Title");
    expect(rows[0]?.textContent).not.toContain(initialAlias.alias);

    const nextSearchAlias: AdminContentAlias = {
      ...initialAlias,
      id: 18,
      titleId: 102,
      titleName: "Second Title",
      alias: "Different Search Result",
    };
    act(() =>
      root.render(
        <AliasReview
          aliases={[nextSearchAlias]}
          q={nextSearchAlias.alias}
          aliasTotal={1}
          isLoading={false}
          isError={false}
          isFetching={false}
          onRetry={() => {}}
          ownership="all"
          onOwnershipChange={() => {}}
        />,
      ),
    );
    await flushEffects();
    expect(container.textContent).not.toContain("Saved correction:");
    expect(container.textContent).toContain("1 aliases");
    expect(container.querySelector("tbody tr")?.textContent).toContain(
      nextSearchAlias.alias,
    );
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

  it("keeps stale correction details available while another alias is edited", async () => {
    const secondAlias: AdminContentAlias = {
      ...initialAlias,
      id: 18,
      titleId: 102,
      titleName: "The Harbor",
      alias: "Second Local Title",
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    let rejectFirstSave = true;
    mocks.updateMutation.mutate.mockImplementation(
      (
        _variables: unknown,
        options?: {
          onError?: (error: unknown) => Promise<void>;
          onSuccess?: () => Promise<void>;
        },
      ) => {
        if (rejectFirstSave) {
          rejectFirstSave = false;
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
                updatedAt: "2026-09-18T00:00:00.000Z",
              },
            },
          });
          return;
        }
        void options?.onSuccess?.();
      },
    );
    render([initialAlias, secondAlias]);
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

    expect(container.textContent).toContain(
      "A newer correction is already saved",
    );
    expect(container.textContent).toContain("Newer Admin Correction");
    expect(container.textContent).toContain("Admin editorial");

    const secondRow = Array.from(container.querySelectorAll("tr")).find((row) =>
      row.textContent?.includes("The Harbor"),
    );
    const secondEditButton = Array.from(
      secondRow?.querySelectorAll("button") ?? [],
    ).find((candidate) => candidate.textContent?.trim() === "Edit");
    expect(secondEditButton).toBeTruthy();
    act(() => secondEditButton?.click());

    expect(container.textContent).toContain("Newer Admin Correction");
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Alternate title for The Harbor"]',
      )?.value,
    ).toBe("Second Local Title");
    act(() => {
      setInput(
        container,
        "Alternate title for The Harbor",
        "Edited second title",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(mocks.updateMutation.mutate).toHaveBeenLastCalledWith(
      {
        id: secondAlias.id,
        data: {
          alias: "Edited second title",
          language: secondAlias.language,
          sourceUrl: secondAlias.sourceUrl,
          expectedUpdatedAt: secondAlias.updatedAt,
        },
      },
      expect.any(Object),
    );
    expect(container.textContent).toContain(
      "A newer correction is already saved",
    );
    expect(container.textContent).toContain("Newer Admin Correction");
    expect(container.textContent).toContain("The Harbor");
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
    expect(container.textContent).toContain(
      "The alternate-title list may be stale; collision results refreshed successfully.",
    );
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
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(3);
  });

  it("retries only the alias request and updates its failure state", async () => {
    await saveAliasToTriggerRefresh(["aliases"]);
    expectRefreshCalls(["aliases", "catalog"]);
    expect(container.textContent).toContain(
      "Failed refresh request: alternate-title list (alias records).",
    );

    mocks.queryClient.invalidateQueries.mockClear();
    setRefreshFailures(["aliases"]);
    act(() => button(container, "Retry refresh").click());
    await flushEffects();
    expectRefreshCalls(["aliases"]);
    expect(container.textContent).toContain(
      "Failed refresh request: alternate-title list (alias records).",
    );

    mocks.queryClient.invalidateQueries.mockClear();
    setRefreshFailures([]);
    act(() => button(container, "Retry refresh").click());
    await flushEffects();
    expectRefreshCalls(["aliases"]);
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
  });

  it("allows retry after a pending refresh times out and ignores its late result", async () => {
    await saveAliasToTriggerRefresh(["aliases"]);
    mocks.queryClient.invalidateQueries.mockClear();

    let rejectFirstRefresh!: (error: Error) => void;
    const firstRefresh = new Promise<void>((_resolve, reject) => {
      rejectFirstRefresh = reject;
    });
    let refreshCall = 0;
    mocks.queryClient.invalidateQueries.mockImplementation(() => {
      refreshCall += 1;
      return refreshCall === 1 ? firstRefresh : Promise.resolve();
    });

    vi.useFakeTimers();
    act(() => button(container, "Retry refresh").click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(refreshCall).toBe(1);
    expect(container.textContent).not.toContain(
      "Alternate-title refresh is taking longer than expected",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent).toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).toContain(
      "Its results are not being treated as current",
    );
    expect(button(container, "Retry refresh").disabled).toBe(false);

    act(() => button(container, "Retry refresh").click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
    expect(refreshCall).toBe(2);

    await act(async () => {
      rejectFirstRefresh(new Error("late refresh failure"));
      await firstRefresh.catch(() => undefined);
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
  });

  it("clears the stale warning when the original timed-out refresh eventually succeeds", async () => {
    await saveAliasToTriggerRefresh(["aliases"]);
    mocks.queryClient.invalidateQueries.mockClear();

    let resolvePendingRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      resolvePendingRefresh = resolve;
    });
    mocks.queryClient.invalidateQueries.mockReturnValue(pendingRefresh);

    vi.useFakeTimers();
    act(() => button(container, "Retry refresh").click());
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });

    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(
      container.textContent,
    ).not.toContain("Alternate-title refresh is taking longer than expected");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent).toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).toContain(
      "The alternate-title list may be stale; collision results refreshed successfully.",
    );

    await act(async () => {
      resolvePendingRefresh();
      await pendingRefresh;
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
    expect(container.textContent).not.toContain(
      "The alternate-title list may be stale; collision results refreshed successfully.",
    );
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("retries only the catalog request and updates its failure state", async () => {
    await saveAliasToTriggerRefresh(["catalog"]);
    expectRefreshCalls(["aliases", "catalog"]);
    expect(container.textContent).toContain(
      "Failed refresh request: catalog search (collision results).",
    );

    mocks.queryClient.invalidateQueries.mockClear();
    setRefreshFailures(["catalog"]);
    act(() => button(container, "Retry refresh").click());
    await flushEffects();
    expectRefreshCalls(["catalog"]);
    expect(container.textContent).toContain(
      "Failed refresh request: catalog search (collision results).",
    );

    mocks.queryClient.invalidateQueries.mockClear();
    setRefreshFailures([]);
    act(() => button(container, "Retry refresh").click());
    await flushEffects();
    expectRefreshCalls(["catalog"]);
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
  });

  it("shows the latest alias when only collision results fail to refresh", async () => {
    const latestServerAlias: AdminContentAlias = {
      ...initialAlias,
      alias: "Latest saved alias",
      language: "it",
      sourceName: "Latest editorial source",
      sourceUrl: "https://example.test/latest-source",
      updatedAt: "2026-09-20T12:00:00.000Z",
    };
    mocks.queryClient.invalidateQueries.mockImplementation(
      ({ queryKey }: { queryKey: string[] }) => {
        if (queryKey[0] === "/api/admin/content-aliases") {
          render([latestServerAlias]);
          return Promise.resolve();
        }
        return Promise.reject(new Error("Catalog refresh unavailable"));
      },
    );
    render();
    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        latestServerAlias.alias,
      );
      setInput(container, "Language for Shared Local Title", "it");
      setInput(
        container,
        "Source link for Shared Local Title",
        latestServerAlias.sourceUrl,
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expectRefreshCalls(["aliases", "catalog"]);
    const latestRow = container.querySelector("tbody tr");
    expect(latestRow?.textContent).toContain(latestServerAlias.alias);
    expect(latestRow?.textContent).toContain(latestServerAlias.language);
    expect(
      latestRow?.querySelector<HTMLAnchorElement>(
        `a[href="${latestServerAlias.sourceUrl}"]`,
      )?.textContent,
    ).toBe(latestServerAlias.sourceName);
    expect(latestRow?.textContent).not.toContain("Shared Local Title");
    expect(container.textContent).toContain(
      "Collision results may be stale; the alternate-title list refreshed successfully.",
    );
    expect(container.textContent).toContain(
      "Failed refresh request: catalog search (collision results).",
    );
    expect(container.textContent).not.toContain(
      "Your saved correction is shown in the table below",
    );

    mocks.queryClient.invalidateQueries.mockClear();
    mocks.queryClient.invalidateQueries.mockResolvedValue(undefined);
    act(() => button(container, "Retry refresh").click());
    await flushEffects();

    expectRefreshCalls(["catalog"]);
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
    expect(container.querySelector("tbody tr")?.textContent).toContain(
      latestServerAlias.alias,
    );
  });

  it("marks collision statuses stale after a failed catalog refresh and clears them after recovery", async () => {
    const currentUniqueAlias: AdminContentAlias = {
      ...uniqueAlias(),
      id: 18,
      titleName: "The Other Lighthouse",
      alias: "Unique Local Title",
    };
    setRefreshFailures(["catalog"]);
    render([initialAlias, currentUniqueAlias]);
    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Updated Local Title",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    const getReviewCell = (row: Element | undefined) =>
      row?.querySelectorAll("td")[4]?.textContent ?? "";
    let rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(getReviewCell(rows[0])).toContain("2 titles · may be stale");
    expect(getReviewCell(rows[1])).toContain("Unique · may be stale");
    expect(rows[0]?.querySelector('[aria-label*="Collision results may be stale"]'))
      .not.toBeNull();

    setRefreshFailures([]);
    act(() => button(container, "Retry refresh").click());
    await flushEffects();

    rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(getReviewCell(rows[0])).toContain("2 titles");
    expect(getReviewCell(rows[0])).not.toContain("may be stale");
    expect(getReviewCell(rows[1])).toContain("Unique");
    expect(getReviewCell(rows[1])).not.toContain("may be stale");
    expect(rows[0]?.querySelector('[aria-label*="Collision results may be stale"]'))
      .toBeNull();
  });

  it("narrows simultaneous failures to only the request still failing", async () => {
    await saveAliasToTriggerRefresh(["aliases", "catalog"]);
    expectRefreshCalls(["aliases", "catalog"]);
    expect(container.textContent).toContain(
      "Failed refresh requests: alternate-title list (alias records) and catalog search (collision results).",
    );

    mocks.queryClient.invalidateQueries.mockClear();
    setRefreshFailures(["catalog"]);
    act(() => button(container, "Retry refresh").click());
    await flushEffects();
    expectRefreshCalls(["aliases", "catalog"]);
    expect(container.textContent).toContain(
      "Failed refresh request: catalog search (collision results).",
    );

    mocks.queryClient.invalidateQueries.mockClear();
    setRefreshFailures([]);
    act(() => button(container, "Retry refresh").click());
    await flushEffects();
    expectRefreshCalls(["catalog"]);
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
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

  it("clears a removed stale-edit warning when the review refresh fails", async () => {
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
    expect(container.textContent).toContain("A newer correction is already saved");
    expect(container.textContent).toContain(currentCorrection.alias);

    render([currentCorrection]);
    setRefreshFailures(["aliases"]);
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
    expect(container.textContent).not.toContain(
      "A newer correction is already saved",
    );
    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(container.textContent).toContain(
      "Failed refresh request: alternate-title list (alias records).",
    );
    expect(button(container, "Retry refresh")).toBeTruthy();
  });

  it("keeps a stale-edit warning when a different alias is removed", async () => {
    const currentCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "Newer Admin Correction",
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    const unrelatedAlias: AdminContentAlias = {
      ...initialAlias,
      id: 18,
      titleId: 102,
      titleName: "The Other Lighthouse",
      alias: "Unrelated Alternate Title",
      language: "es",
      sourceName: "Unrelated source",
      sourceUrl: "https://example.test/unrelated-source",
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

    render([currentCorrection, unrelatedAlias]);
    confirmSpy.mockReturnValue(true);
    const unrelatedRow = Array.from(
      container.querySelectorAll<HTMLTableRowElement>("tbody tr"),
    ).find((row) => row.textContent?.includes(unrelatedAlias.alias));
    const removeButton = Array.from(
      unrelatedRow?.querySelectorAll("button") ?? [],
    ).find((candidate) => candidate.textContent?.trim() === "Remove");
    if (!removeButton) throw new Error("Unrelated alias Remove button not found");
    act(() => removeButton.click());
    await flushEffects();

    expect(mocks.deleteMutation.mutate).toHaveBeenCalledWith(
      {
        id: unrelatedAlias.id,
        data: { expectedUpdatedAt: unrelatedAlias.updatedAt },
      },
      expect.any(Object),
    );
    const conflictNotice = container.querySelector('[role="alert"]');
    expect(conflictNotice?.textContent).toContain(
      "A newer correction is already saved",
    );
    expect(conflictNotice?.textContent).toContain(currentCorrection.alias);
    expect(conflictNotice?.textContent).toContain(currentCorrection.titleName);
    expect(conflictNotice?.textContent).toContain(currentCorrection.language);
    expect(conflictNotice?.textContent).toContain(currentCorrection.sourceName);
    expect(conflictNotice?.textContent).toContain("Current version");
    expect(conflictNotice?.querySelector("a")?.getAttribute("href")).toBe(
      currentCorrection.sourceUrl,
    );
  });

  it("keeps a stale-edit warning when removing its correction and refreshing the list both fail", async () => {
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
        void options?.onError?.(
          new Error(
            "This alternate title changed while you were reviewing it. Refresh the list and review the newer correction before removing it.",
          ),
        );
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
    setRefreshFailures(["aliases"]);
    confirmSpy.mockReturnValue(true);

    act(() => button(container, "Remove").click());
    await flushEffects();

    const alerts = Array.from(container.querySelectorAll('[role="alert"]'));
    const conflictNotice = alerts.find((alert) =>
      alert.textContent?.includes("A newer correction is already saved"),
    );
    expect(conflictNotice?.textContent).toContain(
      "A newer correction is already saved",
    );
    expect(conflictNotice?.textContent).toContain(currentCorrection.alias);
    expect(conflictNotice?.textContent).toContain("Current version");
    const refreshNotice = alerts.find((alert) =>
      alert.textContent?.includes("Alternate-title refresh failed"),
    );
    expect(refreshNotice?.textContent).toContain(
      "Failed refresh request: alternate-title list (alias records).",
    );
    expect(button(container, "Retry refresh")).toBeTruthy();
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not remove alternate title",
      description:
        "This alternate title changed while you were reviewing it. Refresh the list and review the newer correction before removing it.",
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
        ...failedQueryKeys,
      ]);
    },
  );

  it("keeps multiple removed aliases hidden until a failed removal refresh is retried", async () => {
    const secondAlias: AdminContentAlias = {
      ...initialAlias,
      id: 19,
      alias: "Second Shared Local Title",
      sourceUrl: "https://example.test/source-two",
    };
    const initialAliases = [initialAlias, secondAlias];
    const latestServerAliases: AdminContentAlias[] = [
      {
        ...initialAlias,
        id: 18,
        alias: "Latest server alternate title",
        collision: false,
        collisionTitleCount: 1,
      },
    ];
    let updateServerAliases!: (aliases: AdminContentAlias[]) => void;
    function ReviewWithServerData() {
      const [aliases, setAliases] = React.useState(initialAliases);
      updateServerAliases = setAliases;
      return (
        <AliasReview
          aliases={aliases}
          isLoading={false}
          isError={false}
          isFetching={false}
          onRetry={() => {}}
          ownership="all"
          onOwnershipChange={() => {}}
        />
      );
    }
    let aliasRefreshCount = 0;
    mocks.queryClient.invalidateQueries.mockImplementation(
      ({ queryKey }: { queryKey: string[] }) => {
        if (queryKey[0] === "/api/admin/content-aliases") {
          aliasRefreshCount += 1;
          if (aliasRefreshCount <= 2) {
            return Promise.reject(new Error("Alias refresh unavailable"));
          }
          updateServerAliases(latestServerAliases);
        }
        return Promise.resolve();
      },
    );
    act(() => root.render(<ReviewWithServerData />));
    confirmSpy.mockReturnValue(true);

    const removeAliasButton = (aliasName: string) => {
      const row = Array.from(container.querySelectorAll("tbody tr")).find(
        (candidate) => candidate.textContent?.includes(aliasName),
      );
      const removeButton = row
        ? Array.from(row.querySelectorAll("button")).find(
            (candidate) => candidate.textContent?.trim() === "Remove",
          )
        : undefined;
      if (!removeButton) {
        throw new Error(`Remove button not found for ${aliasName}`);
      }
      return removeButton;
    };

    act(() => removeAliasButton(initialAlias.alias).click());
    await flushEffects();
    act(() => removeAliasButton(secondAlias.alias).click());
    await flushEffects();

    expect(mocks.queryClient.setQueriesData).toHaveBeenCalledTimes(2);
    for (const [filters, update] of mocks.queryClient.setQueriesData.mock.calls) {
      expect(filters).toEqual({ queryKey: ["/api/admin/content-aliases"] });
      expect(update).toEqual(expect.any(Function));
    }
    type AliasPageSnapshot = {
      items: AdminContentAlias[];
      total: number;
      limit: number;
      offset: number;
      nextCursor: string | null;
      previousCursor: string | null;
    };
    const stalePage: AliasPageSnapshot = {
      items: initialAliases,
      total: initialAliases.length,
      limit: 50,
      offset: 0,
      nextCursor: null,
      previousCursor: null,
    };
    const updateCachedPages = mocks.queryClient.setQueriesData.mock.calls.map(
      ([, update]) =>
        update as (
          current: AliasPageSnapshot | undefined,
        ) => AliasPageSnapshot | undefined,
    );
    const afterFirstRemoval = updateCachedPages[0](stalePage);
    expect(afterFirstRemoval).toEqual({
      ...stalePage,
      items: [secondAlias],
      total: 1,
    });
    expect(updateCachedPages[1](afterFirstRemoval)).toEqual({
      ...stalePage,
      items: [],
      total: 0,
    });

    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(container.textContent).toContain("Retry refresh");
    expect(container.textContent).toContain(
      "2 alternate titles were removed. They are hidden until the list refresh succeeds.",
    );
    expect(container.textContent).toContain("0 aliases");
    expect(container.textContent).not.toContain(initialAlias.alias);
    expect(container.textContent).not.toContain(secondAlias.alias);
    expect(container.querySelector("tbody tr")).toBeNull();
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Alternate title removed, but refresh failed",
      description:
        "The removal succeeded, but the review table may still be stale. Failed refresh request: alternate-title list (alias records). Retry the refresh below.",
      variant: "destructive",
    });

    act(() => button(container, "Retry refresh").click());
    await flushEffects();
    expect(aliasRefreshCount).toBe(3);
    expect(container.textContent).not.toContain("Alternate-title refresh failed");
    expect(container.textContent).not.toContain("Removed alternate title:");
    expect(container.textContent).not.toContain(
      "2 alternate titles were removed",
    );
    expect(container.textContent).toContain("Latest server alternate title");
    expect(container.textContent).not.toContain(initialAlias.alias);
    expect(container.textContent).not.toContain(secondAlias.alias);
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(5);
  });
});
