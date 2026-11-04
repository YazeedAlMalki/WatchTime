import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import type {
  AdminContentAlias,
  AdminContentAliasRecord,
} from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({
  queryClient: {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    setQueriesData: vi.fn(),
  },
  lookupAdminContentAliasCollisions: vi.fn().mockResolvedValue([]),
  toast: vi.fn(),
  updateMutation: {
    isPending: false,
    mutate: vi.fn(),
  },
  deleteMutation: {
    isPending: false,
    mutate: vi.fn(),
  },
  listReports: vi.fn(),
  listFeedback: vi.fn(),
  updateReport: vi.fn(),
  updateFeedback: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("@workspace/api-client-react", () => ({
  useUpdateAdminContentAlias: () => mocks.updateMutation,
  useDeleteAdminContentAlias: () => mocks.deleteMutation,
  lookupAdminContentAliasCollisions: mocks.lookupAdminContentAliasCollisions,
  getListAdminContentAliasesQueryKey: () => ["/api/admin/content-aliases"],
  getSearchAdminContentQueryKey: () => ["/api/admin/content"],
  useListAdminReports: (params: unknown) =>
    useQuery({
      queryKey: ["/api/admin/reports", params],
      queryFn: () => mocks.listReports(params),
      retry: false,
    }),
  useListAdminFeedback: (params: unknown) =>
    useQuery({
      queryKey: ["/api/admin/feedback", params],
      queryFn: () => mocks.listFeedback(params),
      retry: false,
    }),
  useUpdateAdminReport: () => useMutation({ mutationFn: mocks.updateReport }),
  useUpdateAdminFeedback: () =>
    useMutation({ mutationFn: mocks.updateFeedback }),
  getListAdminReportsQueryKey: () => ["/api/admin/reports"],
  getListAdminFeedbackQueryKey: () => ["/api/admin/feedback"],
  getGetAdminDashboardQueryKey: () => ["/api/admin/dashboard"],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import { AliasReview, FeedbackTab, ReportsTab } from "@/pages/admin";

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

describe("admin moderation queue page recovery", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { gcTime: Infinity },
      },
    });
    mocks.queryClient.invalidateQueries.mockReset();
    mocks.queryClient.invalidateQueries.mockImplementation((filters) =>
      client.invalidateQueries(filters),
    );
    mocks.listReports.mockReset();
    mocks.listFeedback.mockReset();
    mocks.updateReport.mockReset();
    mocks.updateFeedback.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
  });

  async function settle(assertion: () => void, timeout = 1000) {
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assertion();
    }, { timeout });
  }

  async function selectValue(index: number, label: string) {
    act(() => {
      container
        .querySelectorAll<HTMLElement>('[role="combobox"]')
        [index].click();
    });
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((element) => element.textContent?.trim() === label);
    if (!option) throw new Error(`Option not found: ${label}`);
    act(() => option.click());
    await flushEffects();
  }

  it.each([
    { queue: "reports", middlePageEmpty: false },
    { queue: "feedback", middlePageEmpty: false },
    { queue: "reports", middlePageEmpty: true },
    { queue: "feedback", middlePageEmpty: true },
  ] as const)(
    "returns $queue to the nearest populated page after moderation (middle page empty: $middlePageEmpty)",
    async ({ queue, middlePageEmpty }) => {
      const isReports = queue === "reports";
      const list = isReports ? mocks.listReports : mocks.listFeedback;
      const update = isReports ? mocks.updateReport : mocks.updateFeedback;
      let moderated = false;
      let pageSize = 0;
      list.mockImplementation(({ offset, limit }) => {
        pageSize = limit - 1;
        // Two initially full pages followed by one final item. Concurrent
        // cleanup can also remove the middle page when the final item is saved.
        const count =
          offset === 0
            ? pageSize + 1
            : offset === pageSize
              ? moderated && middlePageEmpty
                ? 0
                : pageSize + 1
              : moderated
                ? 0
                : 1;
        return Array.from({ length: count }, (_, index) => ({
          id: offset + index + 1,
          titleName: `Report ${offset + index + 1}`,
          message: `Feedback ${offset + index + 1}`,
          status: isReports ? "open" : "reviewing",
          category: "bug",
          reason: "incorrect_info",
          createdAt: "2026-10-01T00:00:00Z",
        }));
      });
      update.mockImplementation(async () => {
        moderated = true;
      });
      act(() =>
        root.render(
          <QueryClientProvider client={client}>
            {isReports ? <ReportsTab /> : <FeedbackTab />}
          </QueryClientProvider>,
        ),
      );
      await settle(() =>
        expect(container.textContent).toContain(
          isReports ? "Report 1" : "Feedback 1",
        ),
      );
      if (!isReports) {
        await selectValue(0, "Bug");
        await selectValue(1, "Reviewing");
      }
      await settle(() =>
        expect(button(container, "Next").disabled).toBe(false),
      );
      act(() => button(container, "Next").click());
      await settle(() => expect(container.textContent).toContain("Page 2"));
      await settle(() =>
        expect(button(container, "Next").disabled).toBe(false),
      );
      act(() => button(container, "Next").click());
      await settle(() => {
        expect(container.textContent).toContain("Page 3");
        expect(container.textContent).toContain(
          `${isReports ? "Report" : "Feedback"} ${pageSize * 2 + 1}`,
        );
      });
      if (isReports) {
        await act(async () => {
          button(container, "Resolve").click();
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      } else {
        await selectValue(2, "Closed");
      }
      const expectedOffset = middlePageEmpty ? 0 : pageSize;
      await settle(() => {
        expect(container.textContent).toContain(
          middlePageEmpty ? "Page 1" : "Page 2",
        );
        expect(container.textContent).toContain(
          `${isReports ? "Report" : "Feedback"} ${expectedOffset + 1}`,
        );
      }, 5000);
      expect(update).toHaveBeenCalledWith(
        isReports
          ? { reportId: pageSize * 2 + 1, data: { status: "resolved" } }
          : { feedbackId: pageSize * 2 + 1, data: { status: "closed" } },
        expect.anything(),
      );
      const preservedFilters = isReports
        ? { status: "open" }
        : { status: "reviewing", category: "bug" };
      expect(list).toHaveBeenLastCalledWith({
        ...preservedFilters,
        offset: expectedOffset,
        limit: pageSize + 1,
      });
      const filters = Array.from(
        container.querySelectorAll('[role="combobox"]'),
      ).slice(0, isReports ? 1 : 2);
      expect(filters.map((filter) => filter.textContent)).toEqual(
        isReports ? ["Open"] : ["Bug", "Reviewing"],
      );
    },
  );
});

describe("admin alternate-title review", () => {
  let container: HTMLDivElement;
  let root: Root;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.queryClient.invalidateQueries.mockReset();
    mocks.queryClient.invalidateQueries.mockResolvedValue(undefined);
    mocks.queryClient.setQueriesData.mockReset();
    mocks.lookupAdminContentAliasCollisions.mockReset();
    mocks.lookupAdminContentAliasCollisions.mockResolvedValue([]);
    mocks.toast.mockClear();
    mocks.updateMutation.mutate.mockReset();
    mocks.deleteMutation.mutate.mockReset();
    mocks.updateMutation.mutate.mockImplementation(
      async (
        _variables: unknown,
        options?: { onSuccess?: () => Promise<void> },
      ) => {
        await options?.onSuccess?.();
      },
    );
    mocks.deleteMutation.mutate.mockImplementation(
      async (
        _variables: unknown,
        options?: { onSuccess?: () => Promise<void> },
      ) => {
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
          queryKey[0] === "/api/admin/content-aliases" ? "aliases" : "catalog";
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
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      act(() =>
        root.render(
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
        ),
      );
      expect(container.textContent).toContain("Shared Local Title");
      expect(container.textContent).toContain(
        "shown above the filtered results",
      );
      expect(
        container.querySelector("tr.bg-primary\\/10")?.textContent,
      ).toContain("Shared Local Title");
      act(() => button(container, "Copy link").click());
      await flushEffects();
      const copied = new URL(writeText.mock.calls[0][0]);
      expect(copied.searchParams.get("aliasId")).toBe("17");
      expect(copied.searchParams.get("q")).toBe("Other");
      expect(copied.searchParams.get("ownership")).toBe("provider");
      expect(mocks.toast).toHaveBeenCalledWith({
        title: "Alternate title link copied",
      });
    } finally {
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("explains when a saved alias page link includes legacy filters and offers a restart", () => {
    const onAliasPageChange = vi.fn();
    act(() =>
      root.render(
        <AliasReview
          aliases={undefined}
          isLoading={false}
          isError
          loadError={{
            data: {
              error: "Snapshot cursors cannot be combined with offset or id filters",
            },
          }}
          isFetching={false}
          onRetry={() => {}}
          ownership="provider"
          onOwnershipChange={() => {}}
          hasAliasCursor
          onAliasPageChange={onAliasPageChange}
        />,
      ),
    );

    expect(container.textContent).toContain(
      "This saved page link includes an offset or exact-ID filter. Saved review pages cannot be combined with those legacy filters. Restart the review to load page 1 with the current search and ownership filters.",
    );
    act(() => button(container, "Restart alternate-title review").click());
    expect(onAliasPageChange).toHaveBeenCalledWith(1, null);
  });

  it("saves alias text, language, and source link, then refreshes collision views", async () => {
    render();

    expect(container.textContent).toContain("2 titles");
    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Corrected Local Title",
      );
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
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith(
      {
        queryKey: ["/api/admin/content-aliases"],
      },
      { throwOnError: true },
    );
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith(
      {
        queryKey: ["/api/admin/content"],
      },
      { throwOnError: true },
    );

    render([uniqueAlias()]);
    expect(container.textContent).toContain("Corrected Local Title");
    expect(container.textContent).toContain("Unique");
    expect(container.textContent).not.toContain("2 titles");
  });

  it("identifies provider citations that do not have a source link", () => {
    const providerAlias: AdminContentAlias = {
      ...initialAlias,
      isEditorial: false,
      providerCitations: [
        {
          provider: "tvmaze",
          sourceName: "TVMaze",
          sourceUrl: "https://example.test/tvmaze",
        },
        {
          provider: "wikipedia",
          sourceName: "EN Wikipedia",
        },
      ],
    };
    render([providerAlias]);

    const sourceCell = Array.from(container.querySelectorAll("tbody tr"))
      .find((row) => row.textContent?.includes(providerAlias.alias))
      ?.querySelectorAll("td")[3];
    expect(sourceCell?.textContent).toContain("TVMaze");
    expect(sourceCell?.textContent).toContain("EN Wikipedia");
    expect(sourceCell?.textContent).toContain("No source link");
    expect(
      sourceCell?.querySelector('a[href="https://example.test/tvmaze"]')
        ?.textContent,
    ).toBe("TVMaze");
    expect(
      Array.from(sourceCell?.querySelectorAll("a") ?? []).map(
        (link) => link.textContent,
      ),
    ).toEqual(["TVMaze"]);
  });

  it("asks before discarding an unfinished edit when another alias is opened", () => {
    const secondAlias: AdminContentAlias = {
      ...initialAlias,
      id: 18,
      titleId: 102,
      titleName: "The Harbor",
      alias: "Second Local Title",
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    confirmSpy.mockReturnValueOnce(false).mockReturnValueOnce(true);
    render([initialAlias, secondAlias]);

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Unfinished correction",
      );
    });

    const secondRow = Array.from(container.querySelectorAll("tr")).find((row) =>
      row.textContent?.includes("The Harbor"),
    );
    const secondEditButton = Array.from(
      secondRow?.querySelectorAll("button") ?? [],
    ).find((candidate) => candidate.textContent?.trim() === "Edit");
    expect(secondEditButton).toBeTruthy();

    act(() => secondEditButton?.click());

    expect(confirmSpy).toHaveBeenCalledWith(
      "Discard your unsaved changes to “Shared Local Title” and edit “Second Local Title” instead?",
    );
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Alternate title for The Lighthouse"]',
      )?.value,
    ).toBe("Unfinished correction");
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Alternate title for The Harbor"]',
      ),
    ).toBeNull();

    act(() => secondEditButton?.click());

    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Alternate title for The Harbor"]',
      )?.value,
    ).toBe("Second Local Title");
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Alternate title for The Lighthouse"]',
      ),
    ).toBeNull();
  });

  it("warns that removing the edited alias discards its unsaved changes", async () => {
    confirmSpy.mockReturnValue(true);
    render();

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Unfinished correction",
      );
    });
    act(() => button(container, "Remove").click());
    await flushEffects();

    expect(confirmSpy).toHaveBeenCalledWith(
      "Remove “Shared Local Title” from The Lighthouse? This will also discard your unsaved changes. This cannot be undone.",
    );
    expect(mocks.deleteMutation.mutate).toHaveBeenCalledWith(
      {
        id: initialAlias.id,
        data: { expectedUpdatedAt: initialAlias.updatedAt },
      },
      expect.any(Object),
    );
  });

  it("keeps a saved correction pinned when canceled edits follow a successful refresh", async () => {
    let updateFilteredAliases!: () => void;
    const firstSavedRecord: AdminContentAliasRecord = {
      id: initialAlias.id,
      titleId: initialAlias.titleId,
      alias: "Updated Local Title",
      normalizedAlias: "updated local title",
      language: "fr",
      sourceName: initialAlias.sourceName,
      sourceUrl: "https://example.test/first-correction",
      isEditorial: true,
      createdAt: initialAlias.updatedAt,
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    const secondSavedRecord: AdminContentAliasRecord = {
      ...firstSavedRecord,
      alias: "Revised Local Title",
      normalizedAlias: "revised local title",
      updatedAt: "2026-09-18T00:00:00.000Z",
    };
    const savedRecords = [firstSavedRecord, secondSavedRecord];
    mocks.updateMutation.mutate.mockImplementation(
      async (
        _variables: unknown,
        options?: {
          onSuccess?: (savedRecord?: AdminContentAliasRecord) => Promise<void>;
        },
      ) => {
        await options?.onSuccess?.(savedRecords.shift());
      },
    );
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
      setInput(container, "Language for Shared Local Title", "fr");
      setInput(
        container,
        "Source link for Shared Local Title",
        "https://example.test/first-correction",
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

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Uncommitted Local Title",
      );
      setInput(container, "Language for Updated Local Title", "es");
      setInput(
        container,
        "Source link for Updated Local Title",
        "https://example.test/unsaved-correction",
      );
      button(container, "Cancel").click();
    });
    await flushEffects();

    expect(mocks.updateMutation.mutate).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("0 aliases");
    expect(container.textContent).toContain(
      "Saved correction: Updated Local Title is shown separately above the current page of filtered results. The result count and page navigation remain based on the filtered list.",
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    const canceledRow = container.querySelector("tbody tr");
    expect(canceledRow?.textContent).toContain("Updated Local Title");
    expect(canceledRow?.textContent).toContain("fr");
    expect(canceledRow?.textContent).not.toContain("Uncommitted Local Title");
    expect(
      canceledRow?.querySelector<HTMLAnchorElement>("a")?.getAttribute("href"),
    ).toBe("https://example.test/first-correction");

    act(() => button(container, "Edit").click());
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Alternate title for The Lighthouse"]',
      )?.value,
    ).toBe("Updated Local Title");
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Language for Updated Local Title"]',
      )?.value,
    ).toBe("fr");
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Source link for Updated Local Title"]',
      )?.value,
    ).toBe("https://example.test/first-correction");
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Revised Local Title",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(mocks.updateMutation.mutate).toHaveBeenNthCalledWith(
      2,
      {
        id: initialAlias.id,
        data: {
          alias: "Revised Local Title",
          language: "fr",
          sourceUrl: "https://example.test/first-correction",
          expectedUpdatedAt: firstSavedRecord.updatedAt,
        },
      },
      expect.any(Object),
    );
    expect(container.textContent).toContain("0 aliases");
    expect(container.textContent).toContain(
      "Saved correction: Revised Local Title is shown separately above the current page of filtered results. The result count and page navigation remain based on the filtered list.",
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(container.querySelector("tbody tr")?.textContent).toContain(
      "Revised Local Title",
    );
    expect(container.querySelector("tbody tr")?.textContent).not.toContain(
      "Updated Local Title",
    );

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

  it("keeps multiple saved corrections available without changing filtered totals", async () => {
    const secondAlias: AdminContentAlias = {
      ...initialAlias,
      id: 18,
      titleId: 102,
      titleName: "The Harbor",
      alias: "Harbor Local Title",
      updatedAt: "2026-09-16T01:00:00.000Z",
    };
    const remainingAlias: AdminContentAlias = {
      ...initialAlias,
      id: 19,
      titleId: 103,
      titleName: "The Garden",
      alias: "Garden Local Title",
      updatedAt: "2026-09-16T02:00:00.000Z",
    };
    const firstSavedRecord: AdminContentAliasRecord = {
      id: initialAlias.id,
      titleId: initialAlias.titleId,
      alias: "First Updated Title",
      normalizedAlias: "first updated title",
      language: "fr",
      sourceName: initialAlias.sourceName,
      sourceUrl: "https://example.test/first-updated",
      isEditorial: true,
      createdAt: initialAlias.updatedAt,
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    const secondSavedRecord: AdminContentAliasRecord = {
      ...firstSavedRecord,
      id: secondAlias.id,
      titleId: secondAlias.titleId,
      alias: "Second Updated Title",
      normalizedAlias: "second updated title",
      language: "es",
      sourceUrl: "https://example.test/second-updated",
      updatedAt: "2026-09-17T01:00:00.000Z",
    };
    const firstLatestRecord: AdminContentAliasRecord = {
      ...firstSavedRecord,
      alias: "First Latest Title",
      normalizedAlias: "first latest title",
      language: "it",
      sourceUrl: "https://example.test/first-latest",
      updatedAt: "2026-09-18T00:00:00.000Z",
    };
    const secondLatestRecord: AdminContentAliasRecord = {
      ...secondSavedRecord,
      alias: "Second Latest Title",
      normalizedAlias: "second latest title",
      language: "de",
      sourceUrl: "https://example.test/second-latest",
      updatedAt: "2026-09-18T01:00:00.000Z",
    };
    const savedRecords = [
      firstSavedRecord,
      secondSavedRecord,
      firstLatestRecord,
      secondLatestRecord,
    ];
    let savedAliasId: number | null = null;
    let removeFromFilteredResults!: (id: number) => void;
    let setRefreshedResults!: (next: AdminContentAlias[]) => void;
    const onAliasPageChange = vi.fn();
    mocks.updateMutation.mutate.mockImplementation(
      async (
        variables: { id: number },
        options?: {
          onSuccess?: (savedRecord?: AdminContentAliasRecord) => Promise<void>;
        },
      ) => {
        savedAliasId = variables.id;
        await options?.onSuccess?.(savedRecords.shift());
      },
    );
    mocks.queryClient.invalidateQueries.mockImplementation(
      ({ queryKey }: { queryKey: string[] }) => {
        if (
          queryKey[0] === "/api/admin/content-aliases" &&
          savedAliasId !== null
        ) {
          removeFromFilteredResults(savedAliasId);
        }
        return Promise.resolve();
      },
    );
    function FilteredAliasReview() {
      const [aliases, setAliases] = React.useState([
        initialAlias,
        secondAlias,
        remainingAlias,
      ]);
      const [total, setTotal] = React.useState(3);
      removeFromFilteredResults = (id) => {
        const wasInResults = aliases.some((alias) => alias.id === id);
        setAliases((current) => current.filter((alias) => alias.id !== id));
        if (wasInResults) setTotal((current) => Math.max(0, current - 1));
      };
      setRefreshedResults = (next) => {
        setAliases(next);
        setTotal(next.length);
      };
      return (
        <AliasReview
          aliases={aliases}
          q="Local Title"
          aliasTotal={total}
          aliasPage={1}
          nextAliasCursor="matching-results-next"
          onAliasPageChange={onAliasPageChange}
          isLoading={false}
          isError={false}
          isFetching={false}
          onRetry={() => {}}
          ownership="all"
          onOwnershipChange={() => {}}
        />
      );
    }
    act(() => root.render(<FilteredAliasReview />));

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "First Updated Title",
      );
      setInput(container, "Language for Shared Local Title", "fr");
      setInput(
        container,
        "Source link for Shared Local Title",
        "https://example.test/first-updated",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    const secondRow = Array.from(container.querySelectorAll("tbody tr")).find(
      (row) => row.textContent?.includes(secondAlias.alias),
    );
    const secondEditButton = Array.from(
      secondRow?.querySelectorAll("button") ?? [],
    ).find((candidate) => candidate.textContent?.trim() === "Edit");
    expect(secondEditButton).toBeTruthy();
    act(() => secondEditButton?.click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Harbor",
        "Second Updated Title",
      );
      setInput(container, "Language for Harbor Local Title", "es");
      setInput(
        container,
        "Source link for Harbor Local Title",
        "https://example.test/second-updated",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(container.textContent).toContain("1 aliases");
    expect(container.textContent).toContain("Page 1 · 1 matching aliases");
    expect(container.textContent).toContain(
      "2 saved corrections are shown separately above the current page of filtered results.",
    );
    act(() => button(container, "Next aliases").click());
    expect(onAliasPageChange).toHaveBeenCalledWith(2, "matching-results-next");

    act(() => button(container, "Edit").click());
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Alternate title for The Lighthouse"]',
      )?.value,
    ).toBe(firstSavedRecord.alias);
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Language for First Updated Title"]',
      )?.value,
    ).toBe(firstSavedRecord.language);
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Source link for First Updated Title"]',
      )?.value,
    ).toBe(firstSavedRecord.sourceUrl);
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "First Latest Title",
      );
      setInput(container, "Language for First Updated Title", "it");
      setInput(
        container,
        "Source link for First Updated Title",
        "https://example.test/first-latest",
      );
      button(container, "Save").click();
    });
    await flushEffects();
    expect(mocks.updateMutation.mutate).toHaveBeenNthCalledWith(
      3,
      {
        id: initialAlias.id,
        data: {
          alias: "First Latest Title",
          language: "it",
          sourceUrl: "https://example.test/first-latest",
          expectedUpdatedAt: firstSavedRecord.updatedAt,
        },
      },
      expect.any(Object),
    );

    const latestSecondRow = Array.from(
      container.querySelectorAll("tbody tr"),
    ).find((row) => row.textContent?.includes(secondSavedRecord.alias));
    const latestSecondEditButton = Array.from(
      latestSecondRow?.querySelectorAll("button") ?? [],
    ).find((candidate) => candidate.textContent?.trim() === "Edit");
    expect(latestSecondEditButton).toBeTruthy();
    act(() => latestSecondEditButton?.click());
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Alternate title for The Harbor"]',
      )?.value,
    ).toBe(secondSavedRecord.alias);
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Language for Second Updated Title"]',
      )?.value,
    ).toBe(secondSavedRecord.language);
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Source link for Second Updated Title"]',
      )?.value,
    ).toBe(secondSavedRecord.sourceUrl);
    act(() => {
      setInput(
        container,
        "Alternate title for The Harbor",
        "Second Latest Title",
      );
      setInput(container, "Language for Second Updated Title", "de");
      setInput(
        container,
        "Source link for Second Updated Title",
        "https://example.test/second-latest",
      );
      button(container, "Save").click();
    });
    await flushEffects();
    expect(mocks.updateMutation.mutate).toHaveBeenNthCalledWith(
      4,
      {
        id: secondAlias.id,
        data: {
          alias: "Second Latest Title",
          language: "de",
          sourceUrl: "https://example.test/second-latest",
          expectedUpdatedAt: secondSavedRecord.updatedAt,
        },
      },
      expect.any(Object),
    );
    expect(container.querySelector("tbody")?.textContent).toContain(
      firstLatestRecord.alias,
    );
    expect(container.querySelector("tbody")?.textContent).toContain(
      secondLatestRecord.alias,
    );

    const refreshedFirstAlias: AdminContentAlias = {
      ...initialAlias,
      alias: firstLatestRecord.alias,
      language: firstLatestRecord.language,
      sourceUrl: firstLatestRecord.sourceUrl,
      updatedAt: firstLatestRecord.updatedAt,
    };
    const refreshedSecondAlias: AdminContentAlias = {
      ...secondAlias,
      alias: secondLatestRecord.alias,
      language: secondLatestRecord.language,
      sourceUrl: secondLatestRecord.sourceUrl,
      updatedAt: secondLatestRecord.updatedAt,
    };
    act(() =>
      setRefreshedResults([
        refreshedFirstAlias,
        refreshedSecondAlias,
        remainingAlias,
      ]),
    );
    await flushEffects();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(container.textContent).not.toContain("Saved correction:");

    act(() => setRefreshedResults([remainingAlias]));
    await flushEffects();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(container.querySelector("tbody tr")?.textContent).toContain(
      remainingAlias.alias,
    );
    expect(container.querySelector("tbody tr")?.textContent).not.toContain(
      firstLatestRecord.alias,
    );
    expect(container.querySelector("tbody tr")?.textContent).not.toContain(
      secondLatestRecord.alias,
    );
  });

  it("does not subtract a saved correction twice after it stops matching search", async () => {
    const otherAlias: AdminContentAlias = {
      ...initialAlias,
      id: 18,
      titleId: 102,
      titleName: "The Harbor",
      alias: "Shared Local Title Alternate",
    };
    const savedAliasRecord: AdminContentAliasRecord = {
      id: initialAlias.id,
      titleId: initialAlias.titleId,
      alias: "Corrected Harbor Name",
      normalizedAlias: "corrected harbor name",
      language: initialAlias.language,
      sourceName: initialAlias.sourceName,
      sourceUrl: initialAlias.sourceUrl,
      isEditorial: true,
      createdAt: initialAlias.updatedAt,
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    let setFilteredResults!: (
      aliases: AdminContentAlias[],
      total: number,
    ) => void;
    let aliasRefreshes = 0;
    mocks.updateMutation.mutate.mockImplementation(
      async (
        _variables: unknown,
        options?: {
          onSuccess?: (savedRecord?: AdminContentAliasRecord) => Promise<void>;
        },
      ) => {
        await options?.onSuccess?.(savedAliasRecord);
      },
    );
    mocks.queryClient.invalidateQueries.mockImplementation(
      ({ queryKey }: { queryKey: string[] }) => {
        if (queryKey[0] === "/api/admin/content-aliases") {
          aliasRefreshes += 1;
          if (aliasRefreshes === 1) {
            // The filtered total already excludes the edited alias, but the
            // current page still has its stale pre-edit row.
            setFilteredResults([initialAlias, otherAlias], 1);
            return Promise.reject(new Error("Alias refresh unavailable"));
          }
          return Promise.reject(new Error("Alias refresh unavailable"));
        }
        return Promise.resolve();
      },
    );
    let updateCachedPage:
      | ((current: {
          items: AdminContentAlias[];
          total: number;
          limit: number;
          offset: number;
        }) => {
          items: AdminContentAlias[];
          total: number;
          limit: number;
          offset: number;
        } | undefined)
      | undefined;
    mocks.queryClient.setQueriesData.mockImplementation(
      (_filters: unknown, update: typeof updateCachedPage) => {
        updateCachedPage = update;
      },
    );
    function FilteredAliasReview() {
      const [aliases, setAliases] = React.useState([initialAlias]);
      const [total, setTotal] = React.useState(1);
      setFilteredResults = (nextAliases, nextTotal) => {
        setAliases(nextAliases);
        setTotal(nextTotal);
      };
      return (
        <AliasReview
          aliases={aliases}
          q="Shared Local Title"
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
    act(() => root.render(<FilteredAliasReview />));

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        savedAliasRecord.alias,
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(container.textContent).toContain("1 aliases");
    const correctedRow = Array.from(
      container.querySelectorAll("tbody tr"),
    ).find((row) => row.textContent?.includes(savedAliasRecord.alias));
    expect(correctedRow).toBeTruthy();
    expect(correctedRow?.textContent).toContain("Saved correction preview");
    expect(container.textContent).toContain(otherAlias.alias);

    confirmSpy.mockReturnValue(true);
    act(() => {
      const removeButton = Array.from(
        correctedRow?.querySelectorAll("button") ?? [],
      ).find((candidate) => candidate.textContent?.trim() === "Remove");
      removeButton?.click();
    });
    await flushEffects();

    expect(container.textContent).toContain("1 aliases");
    expect(container.textContent).toContain(otherAlias.alias);
    expect(
      Array.from(container.querySelectorAll("tbody tr")).some((row) =>
        row.textContent?.includes(savedAliasRecord.alias),
      ),
    ).toBe(false);
    expect(container.textContent).toContain(
      `Removed alternate title: ${savedAliasRecord.alias}. It is hidden until the list refresh succeeds.`,
    );
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Alternate title removed, but refresh failed",
      description:
        "The removal succeeded, but the review table may still be stale. Failed refresh request: alternate-title list (alias records). Retry the refresh below.",
      variant: "destructive",
    });
    expect(updateCachedPage).toEqual(expect.any(Function));
    expect(
      updateCachedPage?.({
        items: [initialAlias, otherAlias],
        total: 1,
        limit: 50,
        offset: 0,
      }),
    ).toEqual({
      items: [otherAlias],
      total: 1,
      limit: 50,
      offset: 0,
    });
  });

  it("identifies a saved correction preview after a failed active-search refresh and replaces it on retry", async () => {
    const refreshedAlias: AdminContentAlias = {
      ...initialAlias,
      alias: "Updated Local Title",
      language: "fr",
      sourceUrl: "https://example.test/updated",
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    let updateFilteredAliases!: () => void;
    let setAliasLoadError!: (hasError: boolean) => void;
    let failAliasRefresh = true;
    let holdRetryRefresh = false;
    let resolveRetryRefresh!: () => void;
    function FilteredAliasReview() {
      const [aliases, setAliases] = React.useState([initialAlias]);
      const [total, setTotal] = React.useState(1);
      const [hasAliasLoadError, setHasAliasLoadError] = React.useState(false);
      setAliasLoadError = setHasAliasLoadError;
      updateFilteredAliases = () => {
        setAliases([refreshedAlias]);
        setTotal(1);
        setHasAliasLoadError(false);
      };
      return (
        <AliasReview
          aliases={aliases}
          q="Local Title"
          aliasTotal={total}
          isLoading={false}
          isError={hasAliasLoadError}
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
          if (failAliasRefresh) {
            setAliasLoadError(true);
            return Promise.reject(new Error("alias refresh unavailable"));
          }
          if (holdRetryRefresh) {
            return new Promise<void>((resolve) => {
              resolveRetryRefresh = () => {
                updateFilteredAliases();
                resolve();
              };
            });
          }
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
        refreshedAlias.alias,
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(container.textContent).toContain("1 aliases");
    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(container.textContent).toContain(
      "The alternate-title list may be stale",
    );
    expect(container.textContent).toContain(
      "Your saved correction is shown in the table below, but its review details may be out of date.",
    );
    expect(container.textContent).toContain(
      "The filtered alternate-title results could not be refreshed.",
    );
    expect(button(container, "Retry results")).toBeTruthy();
    const previewRow = container.querySelector("tbody tr");
    expect(previewRow?.textContent).toContain("Updated Local Title");
    expect(previewRow?.textContent).toContain("Saved correction preview");
    expect(previewRow?.getAttribute("aria-label")).toBe(
      "Saved correction preview: Updated Local Title",
    );
    expect(previewRow?.textContent).not.toContain(initialAlias.alias);
    const refreshWarning = container.querySelector<HTMLElement>(
      '[data-testid="status-alias-refresh-warning"]',
    );
    expect(refreshWarning?.getAttribute("role")).toBe("alert");
    expect(refreshWarning?.textContent).toContain(
      "Your saved correction is shown in the table below, but its review details may be out of date.",
    );
    const originalWarningText = refreshWarning?.textContent;

    failAliasRefresh = false;
    holdRetryRefresh = true;
    act(() => button(container, "Retry refresh").click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="status-alias-refresh-warning"]')
        ?.textContent,
    ).toBe(originalWarningText);
    expect(
      container.querySelector('[data-testid="status-alias-refresh-warning"]')
        ?.getAttribute("role"),
    ).toBe("alert");
    expect(button(container, "Retry refresh").disabled).toBe(true);
    expect(
      container.querySelector('[data-testid="status-alias-refresh-progress"]')
        ?.textContent,
    ).toContain("Refreshing alternate-title views");

    await act(async () => {
      resolveRetryRefresh();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Alternate-title refresh failed");
    expect(container.textContent).toContain("1 aliases");
    const refreshedRow = container.querySelector("tbody tr");
    expect(refreshedRow?.textContent).toContain(refreshedAlias.alias);
    expect(refreshedRow?.textContent).not.toContain("Saved correction preview");
    expect(refreshedRow?.textContent).not.toContain(initialAlias.alias);
  });

  it("clears failed-refresh review state when a new alias search replaces it", async () => {
    const nextSearchAlias: AdminContentAlias = {
      ...initialAlias,
      id: 18,
      titleId: 102,
      titleName: "The Harbor",
      alias: "Different Search Result",
    };
    const savedRecord: AdminContentAliasRecord = {
      id: initialAlias.id,
      titleId: initialAlias.titleId,
      alias: "Updated Local Title",
      normalizedAlias: "updated local title",
      language: initialAlias.language,
      sourceName: initialAlias.sourceName,
      sourceUrl: initialAlias.sourceUrl,
      isEditorial: true,
      createdAt: initialAlias.updatedAt,
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    let replaceReview!: (
      search: string,
      aliases: AdminContentAlias[],
    ) => void;
    mocks.updateMutation.mutate.mockImplementation(
      async (
        _variables: unknown,
        options?: {
          onSuccess?: (record?: AdminContentAliasRecord) => Promise<void>;
        },
      ) => {
        await options?.onSuccess?.(savedRecord);
      },
    );
    setRefreshFailures(["aliases"]);

    function SearchableAliasReview() {
      const [search, setSearch] = React.useState("Local Title");
      const [aliases, setAliases] = React.useState([initialAlias]);
      replaceReview = (nextSearch, nextAliases) => {
        setSearch(nextSearch);
        setAliases(nextAliases);
      };
      return (
        <AliasReview
          aliases={aliases}
          q={search}
          aliasTotal={aliases.length}
          isLoading={false}
          isError={false}
          isFetching={false}
          onRetry={() => {}}
          ownership="all"
          onOwnershipChange={() => {}}
        />
      );
    }

    act(() => root.render(<SearchableAliasReview />));
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
    expect(container.textContent).toContain("Saved correction preview");
    expect(button(container, "Retry refresh")).toBeTruthy();

    act(() => replaceReview(nextSearchAlias.alias, [nextSearchAlias]));
    await flushEffects();

    expect(container.textContent).not.toContain("Alternate-title refresh failed");
    expect(container.textContent).not.toContain("Saved correction preview");
    expect(container.textContent).toContain("1 aliases");
    expect(container.querySelector("tbody tr")?.textContent).toContain(
      nextSearchAlias.alias,
    );
    expect(container.querySelector("tbody tr")?.textContent).not.toContain(
      savedRecord.alias,
    );
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (candidate) => candidate.textContent?.trim() === "Retry refresh",
      ),
    ).toBe(false);
  });

  it("keeps duplicate and canonical-title conflicts visible to the admin", () => {
    const errors = [
      "That alternate title already belongs to another catalog title.",
      "The alternate title must differ from the canonical title.",
    ];
    mocks.updateMutation.mutate.mockImplementation(
      (
        _variables: unknown,
        options?: { onError?: (error: unknown) => void },
      ) => {
        options?.onError?.({ data: { error: errors.shift() } });
      },
    );
    render();
    act(() => button(container, "Edit").click());

    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Duplicate title",
      );
      button(container, "Save").click();
    });
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "The Lighthouse",
      );
      button(container, "Save").click();
    });

    expect(mocks.toast).toHaveBeenNthCalledWith(1, {
      title: "Could not update alternate title",
      description:
        "That alternate title already belongs to another catalog title.",
      variant: "destructive",
    });
    expect(mocks.toast).toHaveBeenNthCalledWith(2, {
      title: "Could not update alternate title",
      description: "The alternate title must differ from the canonical title.",
      variant: "destructive",
    });
    expect(container.textContent).toContain("2 titles");
  });

  it("shows only the editorial citation when an editorial draft is stale", async () => {
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
            current: {
              ...initialAlias,
              alias: "Newer Admin Correction",
              language: "de",
              sourceName: "Admin editorial",
              sourceUrl: "https://example.test/newer-correction",
              isEditorial: true,
              providerCitations: [
                {
                  provider: "tvmaze",
                  sourceName: "Unrelated provider citation",
                  sourceUrl: "https://example.test/provider",
                },
              ],
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
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Stale correction",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith(
      {
        queryKey: ["/api/admin/content-aliases"],
      },
      { throwOnError: true },
    );
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith(
      {
        queryKey: ["/api/admin/content"],
      },
      { throwOnError: true },
    );
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not update alternate title",
      description:
        "Your draft was not saved. Review the newer correction below before trying again.",
      variant: "destructive",
    });
    expect(container.textContent).toContain(
      "A newer correction is already saved",
    );
    expect(container.textContent).toContain("Newer Admin Correction");
    expect(container.textContent).toContain("de");
    const sourceSection = Array.from(
      container.querySelectorAll('[role="alert"] dl > div'),
    )
      .find(
        (field) => field.querySelector("dt")?.textContent?.trim() === "Source",
      )
      ?.querySelector("dd");
    expect(sourceSection?.textContent).toContain("Admin editorial");
    expect(sourceSection?.textContent).not.toContain(
      "Unrelated provider citation",
    );
    expect(sourceSection?.querySelectorAll("a")).toHaveLength(1);
    expect(sourceSection?.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.test/newer-correction",
    );
    expect(container.textContent).toContain("Unique");
    expect(container.textContent).toContain("Current version");
    expect(container.textContent).not.toContain("Save");
  });

  it("replaces stale correction details after a second rejected save", async () => {
    const firstCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "First server correction",
      language: "de",
      sourceName: "First correction source",
      sourceUrl: "https://example.test/first-correction",
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    const latestCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "Latest server correction",
      language: "it",
      sourceName: "Latest correction source",
      sourceUrl: "https://example.test/latest-correction",
      updatedAt: "2026-09-19T12:30:00.000Z",
    };
    const corrections = [firstCorrection, latestCorrection];
    let correctionIndex = 0;
    let failAliasListRefresh = false;
    mocks.queryClient.invalidateQueries.mockImplementation(
      ({ queryKey }: { queryKey: string[] }) =>
        failAliasListRefresh && queryKey[0] === "/api/admin/content-aliases"
          ? Promise.reject(new Error("alias refresh unavailable"))
          : Promise.resolve(),
    );
    mocks.updateMutation.mutate.mockImplementation(
      (
        _variables: unknown,
        options?: { onError?: (error: unknown) => Promise<void> },
      ) => {
        const current = corrections[correctionIndex++];
        void options?.onError?.({
          data: {
            code: "stale_alias",
            error:
              "This alternate title changed while you were editing. Refresh the list and review the newer correction before saving.",
            current,
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
        "First stale draft",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(container.textContent).toContain(firstCorrection.alias);
    expect(container.textContent).toContain(firstCorrection.language);
    expect(container.textContent).toContain(firstCorrection.sourceName);
    expect(container.textContent).toContain(
      new Date(firstCorrection.updatedAt).toLocaleString(),
    );

    act(() => button(container, "Edit current correction").click());
    failAliasListRefresh = true;
    act(() => {
      setInput(
        container,
        "Alternate title for current correction",
        "Second stale draft",
      );
      setInput(container, "Language for current correction", "es");
      setInput(
        container,
        "Source link for current correction",
        "https://example.test/second-stale-draft",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(mocks.updateMutation.mutate).toHaveBeenNthCalledWith(
      2,
      {
        id: initialAlias.id,
        data: {
          alias: "Second stale draft",
          language: "es",
          sourceUrl: "https://example.test/second-stale-draft",
          expectedUpdatedAt: firstCorrection.updatedAt,
        },
      },
      expect.any(Object),
    );
    const alerts = Array.from(container.querySelectorAll('[role="alert"]'));
    const correctionWarning = alerts.find((alert) =>
      alert.textContent?.includes("A newer correction is already saved"),
    );
    const refreshWarning = alerts.find((alert) =>
      alert.textContent?.includes("Alternate-title refresh failed"),
    );
    expect(correctionWarning?.textContent).toContain(latestCorrection.alias);
    expect(correctionWarning?.textContent).toContain(latestCorrection.language);
    expect(correctionWarning?.textContent).toContain(
      latestCorrection.sourceName,
    );
    expect(correctionWarning?.textContent).toContain(
      new Date(latestCorrection.updatedAt).toLocaleString(),
    );
    expect(
      correctionWarning?.querySelector(
        `a[href="${latestCorrection.sourceUrl}"]`,
      )?.textContent,
    ).toBe(latestCorrection.sourceName);
    expect(correctionWarning?.textContent).toContain(
      "Your draft was not saved",
    );
    expect(correctionWarning?.textContent).not.toContain(firstCorrection.alias);
    expect(correctionWarning?.textContent).not.toContain(
      firstCorrection.language,
    );
    expect(correctionWarning?.textContent).not.toContain(
      firstCorrection.sourceName,
    );
    expect(correctionWarning?.textContent).not.toContain(
      new Date(firstCorrection.updatedAt).toLocaleString(),
    );
    expect(correctionWarning?.textContent).not.toContain("Second stale draft");
    expect(refreshWarning?.textContent).toContain(
      "The alternate-title list may be stale",
    );
    expect(refreshWarning?.textContent).toContain(
      "Failed refresh request: alternate-title list (alias records).",
    );
    expect(refreshWarning?.textContent).not.toContain(
      "Your saved correction is shown",
    );
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(4);
  });

  it("shows every provider citation link when a provider-owned draft is stale", async () => {
    const providerAlias: AdminContentAlias = {
      ...initialAlias,
      isEditorial: false,
      sourceName: "Withdrawn provider source",
      sourceUrl: "https://example.test/withdrawn-provider",
      providerCitations: [
        {
          provider: "tvmaze",
          sourceName: "TVMaze",
          sourceUrl: "https://example.test/tvmaze",
        },
        {
          provider: "wikipedia",
          sourceName: "EN Wikipedia",
          sourceUrl: "https://example.test/wikipedia",
        },
        {
          provider: "unlinked-source",
          sourceName: "Unlinked provider",
        },
      ],
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
            current: {
              ...providerAlias,
              alias: "Newer Provider Alias",
              updatedAt: "2026-09-17T00:00:00.000Z",
            },
          },
        });
      },
    );
    render([providerAlias]);
    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Stale provider draft",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    expect(container.textContent).toContain("Newer Provider Alias");
    const sourceSection = Array.from(
      container.querySelectorAll('[role="alert"] dl > div'),
    )
      .find(
        (field) => field.querySelector("dt")?.textContent?.trim() === "Source",
      )
      ?.querySelector("dd");
    expect(sourceSection?.textContent).toContain("TVMaze");
    expect(sourceSection?.textContent).toContain("EN Wikipedia");
    expect(sourceSection?.textContent).toContain("Unlinked provider");
    expect(sourceSection?.textContent).toContain("No source link");
    expect(
      Array.from(sourceSection?.querySelectorAll("a") ?? []).map((link) => [
        link.textContent,
        link.getAttribute("href"),
      ]),
    ).toEqual([
      ["TVMaze", "https://example.test/tvmaze"],
      ["EN Wikipedia", "https://example.test/wikipedia"],
    ]);
    expect(sourceSection?.querySelectorAll("a")).toHaveLength(2);
    expect(sourceSection?.textContent).not.toContain("Withdrawn provider source");
    expect(sourceSection?.querySelector(
      'a[href="https://example.test/withdrawn-provider"]',
    )).toBeNull();
  });

  it("does not show historical provider source fields when no active citations remain", async () => {
    const providerAlias: AdminContentAlias = {
      ...initialAlias,
      isEditorial: false,
      sourceName: "Withdrawn provider source",
      sourceUrl: "https://example.test/withdrawn-provider",
      providerCitations: [],
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
            current: {
              ...providerAlias,
              alias: "Newer Provider Alias",
              updatedAt: "2026-09-17T00:00:00.000Z",
            },
          },
        });
      },
    );
    render([providerAlias]);
    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Stale provider draft",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    const sourceSection = Array.from(
      container.querySelectorAll('[role="alert"] dl > div'),
    )
      .find(
        (field) => field.querySelector("dt")?.textContent?.trim() === "Source",
      )
      ?.querySelector("dd");
    expect(sourceSection?.textContent).toBe("No active provider citations");
    expect(sourceSection?.querySelector("a")).toBeNull();
    expect(sourceSection?.textContent).not.toContain("Withdrawn provider source");
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
    let resolveRetryRefresh!: () => void;
    const retryRefresh = new Promise<void>((resolve) => {
      resolveRetryRefresh = resolve;
    });
    let refreshCall = 0;
    mocks.queryClient.invalidateQueries.mockImplementation(() => {
      refreshCall += 1;
      return refreshCall === 1 ? firstRefresh : retryRefresh;
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
    expect(button(container, "Retry refresh").disabled).toBe(true);
    expect(container.textContent).toContain("Refreshing alternate-title views");
    expect(container.textContent).toContain(
      "A newer refresh is in progress. Earlier requests cannot replace its status.",
    );
    expect(container.textContent).not.toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(refreshCall).toBe(2);

    await act(async () => {
      rejectFirstRefresh(new Error("late refresh failure"));
      await firstRefresh.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(button(container, "Retry refresh").disabled).toBe(true);
    expect(container.textContent).toContain("Refreshing alternate-title views");
    expect(container.textContent).toContain(
      "A newer refresh is in progress. Earlier requests cannot replace its status.",
    );
    expect(container.textContent).not.toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).toContain("Alternate-title refresh failed");

    await act(async () => {
      resolveRetryRefresh();
      await retryRefresh;
    });
    expect(container.textContent).not.toContain(
      "Refreshing alternate-title views",
    );
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

  it("replaces the stale warning when the original timed-out refresh fails", async () => {
    await saveAliasToTriggerRefresh(["aliases"]);
    mocks.queryClient.invalidateQueries.mockClear();

    let rejectPendingRefresh!: (error: Error) => void;
    const pendingRefresh = new Promise<void>((_resolve, reject) => {
      rejectPendingRefresh = reject;
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent).toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).toContain(
      "Its results are not being treated as current",
    );

    await act(async () => {
      rejectPendingRefresh(new Error("refresh unavailable"));
      await pendingRefresh.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(container.textContent).toContain(
      "Failed refresh request: alternate-title list (alias records).",
    );
    expect(button(container, "Retry refresh").disabled).toBe(false);
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("reports only the rejected request after a timed-out partial refresh settles", async () => {
    let resolveAliasRefresh!: () => void;
    const aliasRefresh = new Promise<void>((resolve) => {
      resolveAliasRefresh = resolve;
    });
    let rejectCatalogRefresh!: (error: Error) => void;
    const catalogRefresh = new Promise<void>((_resolve, reject) => {
      rejectCatalogRefresh = reject;
    });
    mocks.queryClient.invalidateQueries.mockImplementation(
      ({ queryKey }: { queryKey: string[] }) =>
        queryKey[0] === "/api/admin/content-aliases"
          ? aliasRefresh
          : catalogRefresh,
    );

    vi.useFakeTimers();
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
    await act(async () => {
      for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
      }
    });

    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    const pendingSave = mocks.updateMutation.mutate.mock.results.at(-1)
      ?.value as Promise<void> | undefined;
    if (!pendingSave) throw new Error("The alternate-title save did not start");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent).toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).toContain(
      "Failed refresh requests: alternate-title list (alias records) and catalog search (collision results).",
    );

    await act(async () => {
      resolveAliasRefresh();
      rejectCatalogRefresh(new Error("catalog refresh unavailable"));
      await Promise.allSettled([aliasRefresh, catalogRefresh]);
      await pendingSave;
    });

    expect(container.textContent).not.toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(container.textContent).toContain(
      "Failed refresh request: catalog search (collision results).",
    );
    expect(container.textContent).not.toContain(
      "Failed refresh requests: alternate-title list (alias records) and catalog search (collision results).",
    );
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("reports only collision results as stale when their refresh times out", async () => {
    let resolveCollisionRefresh!: () => void;
    const collisionRefresh = new Promise<void>((resolve) => {
      resolveCollisionRefresh = resolve;
    });
    mocks.lookupAdminContentAliasCollisions.mockReturnValue(collisionRefresh);
    render();
    vi.useFakeTimers();

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Updated Local Title",
      );
      button(container, "Save").click();
    });
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });

    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(mocks.lookupAdminContentAliasCollisions).toHaveBeenCalledWith({
      aliases: ["Updated Local Title"],
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent).toContain(
      "Collision results may be stale; the alternate-title list refreshed successfully.",
    );
    expect(container.textContent).not.toContain(
      "The alternate-title list and collision results may be stale.",
    );

    const savePromise = mocks.updateMutation.mutate.mock.results.at(-1)
      ?.value as Promise<void> | undefined;
    if (!savePromise) throw new Error("The alternate-title save did not start");
    await act(async () => {
      resolveCollisionRefresh();
      await savePromise;
    });

    expect(container.textContent).not.toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).not.toContain(
      "Collision results may be stale; the alternate-title list refreshed successfully.",
    );
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
  });

  it("shows recovered collision counts before the remaining alias refresh finishes", async () => {
    let resolveAliasRefresh!: () => void;
    const aliasRefresh = new Promise<void>((resolve) => {
      resolveAliasRefresh = resolve;
    });
    let resolveCollisionRefresh!: (
      counts: {
        alias: string;
        collision: boolean;
        collisionTitleCount: number;
      }[],
    ) => void;
    const collisionRefresh = new Promise<
      {
        alias: string;
        collision: boolean;
        collisionTitleCount: number;
      }[]
    >((resolve) => {
      resolveCollisionRefresh = resolve;
    });
    const refreshedAlias: AdminContentAlias = {
      ...initialAlias,
      alias: "Updated Local Title",
      collision: true,
      collisionTitleCount: 4,
    };
    mocks.queryClient.invalidateQueries.mockImplementation(
      ({ queryKey }: { queryKey: string[] }) =>
        queryKey[0] === "/api/admin/content-aliases"
          ? aliasRefresh.then(() => render([refreshedAlias]))
          : Promise.resolve(),
    );
    mocks.lookupAdminContentAliasCollisions.mockReturnValue(collisionRefresh);
    render();
    vi.useFakeTimers();

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Updated Local Title",
      );
      button(container, "Save").click();
    });
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(
      container.querySelector('[aria-label^="Collision results may be stale"]'),
    ).not.toBeNull();

    await act(async () => {
      resolveCollisionRefresh([
        {
          alias: "Updated Local Title",
          collision: true,
          collisionTitleCount: 4,
        },
      ]);
      await collisionRefresh;
      await Promise.resolve();
    });
    expect(
      container.querySelector("tbody tr td:nth-child(5)")?.textContent,
    ).toContain("4 titles");
    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(container.textContent).toContain(
      "The alternate-title list may be stale; collision results refreshed successfully.",
    );
    expect(
      container.querySelector('[aria-label^="Collision results may be stale"]'),
    ).toBeNull();

    const savePromise = mocks.updateMutation.mutate.mock.results.at(-1)
      ?.value as Promise<void> | undefined;
    if (!savePromise) throw new Error("The alternate-title save did not start");
    await act(async () => {
      resolveAliasRefresh();
      await aliasRefresh;
      await savePromise;
    });

    expect(container.textContent).not.toContain("Alternate-title refresh failed");
    expect(
      container.querySelector('[aria-label^="Collision results may be stale"]'),
    ).toBeNull();
    expect(
      container.querySelector("tbody tr td:nth-child(5)")?.textContent,
    ).toContain("4 titles");
  });

  it("shows a settled collision lookup failure after its recovery timeout", async () => {
    let rejectCollisionRefresh!: (error: Error) => void;
    const collisionRefresh = new Promise<void>((_resolve, reject) => {
      rejectCollisionRefresh = reject;
    });
    mocks.lookupAdminContentAliasCollisions.mockReturnValue(collisionRefresh);
    render();
    vi.useFakeTimers();

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Updated Local Title",
      );
      button(container, "Save").click();
    });
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });

    expect(mocks.lookupAdminContentAliasCollisions).toHaveBeenCalledTimes(1);
    expect(mocks.lookupAdminContentAliasCollisions).toHaveBeenCalledWith({
      aliases: ["Updated Local Title"],
    });
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent).toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).toContain(
      "Collision results may be stale; the alternate-title list refreshed successfully.",
    );
    expect(
      container.querySelector('[aria-label^="Collision results may be stale"]'),
    ).not.toBeNull();
    expect(button(container, "Retry refresh").disabled).toBe(false);

    const savePromise = mocks.updateMutation.mutate.mock.results.at(-1)
      ?.value as Promise<void> | undefined;
    if (!savePromise) throw new Error("The alternate-title save did not start");
    await act(async () => {
      rejectCollisionRefresh(new Error("collision lookup unavailable"));
      await collisionRefresh.catch(() => undefined);
      await savePromise;
    });

    expect(container.textContent).not.toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(container.textContent).toContain(
      "Failed refresh request: alternate-title collision counts.",
    );
    expect(
      container.querySelector('[aria-label^="Collision results may be stale"]'),
    ).not.toBeNull();
    expect(button(container, "Retry refresh").disabled).toBe(false);
    expect(mocks.lookupAdminContentAliasCollisions).toHaveBeenCalledTimes(1);
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("keeps the newest collision counts when an older timed-out lookup resolves late", async () => {
    type CollisionCounts = Pick<
      AdminContentAlias,
      "alias" | "collision" | "collisionTitleCount"
    >[];
    let resolveOriginalLookup!: (counts: CollisionCounts) => void;
    const originalLookup = new Promise<CollisionCounts>((resolve) => {
      resolveOriginalLookup = resolve;
    });
    let resolveRetryLookup!: (counts: CollisionCounts) => void;
    const retryLookup = new Promise<CollisionCounts>((resolve) => {
      resolveRetryLookup = resolve;
    });
    mocks.lookupAdminContentAliasCollisions
      .mockReturnValueOnce(originalLookup)
      .mockReturnValueOnce(retryLookup);
    render();
    vi.useFakeTimers();

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Updated Local Title",
      );
      button(container, "Save").click();
    });
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });

    expect(mocks.lookupAdminContentAliasCollisions).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent).toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(
      container.querySelector('[aria-label^="Collision results may be stale"]')
        ?.textContent,
    ).toContain("2 titles · may be stale");

    act(() => button(container, "Retry refresh").click());
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });
    expect(mocks.lookupAdminContentAliasCollisions).toHaveBeenCalledTimes(2);
    expect(mocks.lookupAdminContentAliasCollisions).toHaveBeenLastCalledWith({
      aliases: ["Updated Local Title"],
    });

    await act(async () => {
      resolveRetryLookup([
        {
          alias: "Updated Local Title",
          collision: true,
          collisionTitleCount: 4,
        },
      ]);
      await retryLookup;
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
    expect(container.querySelector('[aria-label^="Collision results may be stale"]'))
      .toBeNull();
    expect(container.textContent).toContain("4 titles");

    const savePromise = mocks.updateMutation.mutate.mock.results.at(-1)
      ?.value as Promise<void> | undefined;
    if (!savePromise) throw new Error("The alternate-title save did not start");
    await act(async () => {
      resolveOriginalLookup([
        {
          alias: "Updated Local Title",
          collision: true,
          collisionTitleCount: 7,
        },
      ]);
      await originalLookup;
      await savePromise;
    });

    expect(container.textContent).toContain("4 titles");
    expect(container.textContent).not.toContain("7 titles");
    expect(container.querySelector('[aria-label^="Collision results may be stale"]'))
      .toBeNull();
    expect(container.textContent).not.toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
  });

  it("keeps collision badges current when a timed-out catalog request fails after retry", async () => {
    let rejectTimedOutCatalog!: (error: Error) => void;
    const timedOutCatalog = new Promise<void>((_resolve, reject) => {
      rejectTimedOutCatalog = reject;
    });
    let catalogRefreshCall = 0;
    mocks.queryClient.invalidateQueries.mockImplementation(
      ({ queryKey }: { queryKey: string[] }) => {
        if (queryKey[0] === "/api/admin/content-aliases") {
          return Promise.resolve();
        }
        catalogRefreshCall += 1;
        return catalogRefreshCall === 1
          ? timedOutCatalog
          : Promise.resolve();
      },
    );

    render();
    vi.useFakeTimers();
    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "Updated Local Title",
      );
      button(container, "Save").click();
    });
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });

    expect(catalogRefreshCall).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent).toContain(
      "Failed refresh request: catalog search (collision results).",
    );
    expect(
      container.querySelector('[aria-label^="Collision results may be stale"]'),
    ).not.toBeNull();

    act(() => button(container, "Retry refresh").click());
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });
    expect(catalogRefreshCall).toBe(2);
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
    expect(
      container.querySelector('[aria-label^="Collision results may be stale"]'),
    ).toBeNull();

    const savePromise = mocks.updateMutation.mutate.mock.results.at(-1)
      ?.value as Promise<void> | undefined;
    if (!savePromise) throw new Error("The alternate-title save did not start");
    await act(async () => {
      rejectTimedOutCatalog(new Error("late catalog refresh failure"));
      await timedOutCatalog.catch(() => undefined);
      await savePromise;
    });
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
    expect(
      container.querySelector('[aria-label^="Collision results may be stale"]'),
    ).toBeNull();
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
    expect(
      rows[0]?.querySelector('[aria-label*="Collision results may be stale"]'),
    ).not.toBeNull();

    setRefreshFailures([]);
    act(() => button(container, "Retry refresh").click());
    await flushEffects();

    rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(getReviewCell(rows[0])).toContain("2 titles");
    expect(getReviewCell(rows[0])).not.toContain("may be stale");
    expect(getReviewCell(rows[1])).toContain("Unique");
    expect(getReviewCell(rows[1])).not.toContain("may be stale");
    expect(
      rows[0]?.querySelector('[aria-label*="Collision results may be stale"]'),
    ).toBeNull();
  });

  it.each([
    {
      collision: true,
      collisionTitleCount: 3,
      collisionStatus: "3 titles share this alias",
    },
    {
      collision: false,
      collisionTitleCount: 1,
      collisionStatus: "Unique",
    },
  ])(
    "keeps conflict collision details stale across failed catalog refreshes and clears them after recovery ($collisionStatus)",
    async ({ collision, collisionTitleCount, collisionStatus }) => {
    const currentCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "Newer shared correction",
      collision,
      collisionTitleCount,
      updatedAt: "2026-09-18T12:30:00.000Z",
    };
    setRefreshFailures(["catalog"]);
    mocks.updateMutation.mutate.mockImplementation(
      async (
        _variables: unknown,
        options?: { onError?: (error: unknown) => Promise<void> },
      ) => {
        await options?.onError?.({
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
        "An unsaved draft",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    const findConflictNotice = () =>
      Array.from(container.querySelectorAll<HTMLElement>('[role="alert"]')).find(
        (alert) =>
          alert.textContent?.includes("A newer correction is already saved"),
      );
    expect(findConflictNotice()?.textContent).toContain(
      `${collisionStatus} · may be stale`,
    );
    expect(
      findConflictNotice()?.querySelector(
        '[data-testid="status-conflict-correction-stale"]',
      ),
    ).toBeNull();

    mocks.queryClient.invalidateQueries.mockClear();
    setRefreshFailures(["catalog"]);
    act(() => button(container, "Retry refresh").click());
    await flushEffects();

    expect(findConflictNotice()?.textContent).toContain(
      `${collisionStatus} · may be stale`,
    );

    mocks.queryClient.invalidateQueries.mockClear();
    setRefreshFailures([]);
    act(() => button(container, "Retry refresh").click());
    await flushEffects();

    expect(findConflictNotice()?.textContent).toContain(
      collisionStatus,
    );
    expect(findConflictNotice()?.textContent).not.toContain("may be stale");
    expect(
      findConflictNotice()?.querySelector(
        '[data-testid="status-conflict-correction-stale"]',
      ),
    ).toBeNull();
    },
  );

  it("keeps conflict collision details stale after a timed-out refresh and failed retry, then clears them after recovery", async () => {
    const currentCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "Newer shared correction",
      collision: true,
      collisionTitleCount: 3,
      updatedAt: "2026-09-18T12:30:00.000Z",
    };
    let resolveCatalogRefresh!: () => void;
    const catalogRefresh = new Promise<void>((resolve) => {
      resolveCatalogRefresh = resolve;
    });
    let catalogRefreshAttempts = 0;
    mocks.queryClient.invalidateQueries.mockImplementation(
      ({ queryKey }: { queryKey: string[] }) =>
        queryKey[0] === "/api/admin/content"
          ? ++catalogRefreshAttempts === 1
            ? catalogRefresh
            : catalogRefreshAttempts === 2
              ? Promise.reject(new Error("catalog refresh unavailable"))
              : Promise.resolve()
          : Promise.resolve(),
    );
    mocks.updateMutation.mutate.mockImplementation(
      async (
        _variables: unknown,
        options?: { onError?: (error: unknown) => Promise<void> },
      ) => {
        await options?.onError?.({
          data: {
            code: "stale_alias",
            error: "This alternate title changed while you were editing.",
            current: currentCorrection,
          },
        });
      },
    );
    render();
    vi.useFakeTimers();

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "An unsaved draft",
      );
      button(container, "Save").click();
    });
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });
    const pendingSave = mocks.updateMutation.mutate.mock.results.at(-1)
      ?.value as Promise<void> | undefined;
    if (!pendingSave) throw new Error("The stale-alias save did not start");

    const findConflictNotice = () =>
      Array.from(container.querySelectorAll<HTMLElement>('[role="alert"]')).find(
        (alert) =>
          alert.textContent?.includes("A newer correction is already saved"),
      );
    expect(findConflictNotice()?.textContent).toContain(
      "3 titles share this alias · may be stale",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(findConflictNotice()?.textContent).toContain(
      "3 titles share this alias · may be stale",
    );

    act(() => button(container, "Retry refresh").click());
    await act(async () => {
      for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
      }
    });
    expect(findConflictNotice()?.textContent).toContain(
      "3 titles share this alias · may be stale",
    );

    act(() => button(container, "Retry refresh").click());
    await act(async () => {
      for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
      }
    });
    expect(findConflictNotice()?.textContent).toContain(
      "3 titles share this alias",
    );
    expect(findConflictNotice()?.textContent).not.toContain("may be stale");

    await act(async () => {
      resolveCatalogRefresh();
      await pendingSave;
    });
    expect(findConflictNotice()?.textContent).toContain(
      "3 titles share this alias",
    );
    expect(findConflictNotice()?.textContent).not.toContain("may be stale");
  });

  it("marks conflict correction details stale when aliases fail and clears them after recovery", async () => {
    const currentCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "Newer correction",
      language: "de",
      sourceName: "Current editorial source",
      sourceUrl: "https://example.test/current-correction",
      collision: true,
      collisionTitleCount: 3,
      updatedAt: "2026-09-18T12:30:00.000Z",
    };
    setRefreshFailures(["aliases", "catalog"]);
    mocks.updateMutation.mutate.mockImplementation(
      async (
        _variables: unknown,
        options?: { onError?: (error: unknown) => Promise<void> },
      ) => {
        await options?.onError?.({
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
        "An unsaved draft",
      );
      button(container, "Save").click();
    });
    await flushEffects();

    const findConflictNotice = () =>
      Array.from(container.querySelectorAll<HTMLElement>('[role="alert"]')).find(
        (alert) =>
          alert.textContent?.includes("A newer correction is already saved"),
      );
    const staleDetails = findConflictNotice()?.querySelector<HTMLElement>(
      '[data-testid="status-conflict-correction-stale"]',
    );
    expect(staleDetails?.textContent).toContain(
      "alternate-title list refresh failed or timed out",
    );
    expect(staleDetails?.textContent).toContain(
      "alternate title, language, and source shown here",
    );
    expect(findConflictNotice()?.textContent).toContain(
      "3 titles share this alias · may be stale",
    );

    let resolveCatalogRefresh!: () => void;
    const catalogRefresh = new Promise<void>((resolve) => {
      resolveCatalogRefresh = resolve;
    });
    mocks.queryClient.invalidateQueries.mockClear();
    mocks.queryClient.invalidateQueries.mockImplementation(
      ({ queryKey }: { queryKey: string[] }) =>
        queryKey[0] === "/api/admin/content-aliases"
          ? Promise.resolve()
          : catalogRefresh,
    );
    act(() => button(container, "Retry refresh").click());
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });

    expectRefreshCalls(["aliases", "catalog"]);
    expect(
      findConflictNotice()?.querySelector(
        '[data-testid="status-conflict-correction-stale"]',
      ),
    ).toBeNull();
    expect(findConflictNotice()?.textContent).toContain(
      "3 titles share this alias · may be stale",
    );

    await act(async () => {
      resolveCatalogRefresh();
      await catalogRefresh;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(findConflictNotice()?.textContent).toContain(
      "3 titles share this alias",
    );
    expect(findConflictNotice()?.textContent).not.toContain("may be stale");
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
  });

  it("marks conflict collision details stale when catalog refresh times out and clears them when it succeeds", async () => {
    const currentCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "Newer shared correction",
      collision: true,
      collisionTitleCount: 3,
      updatedAt: "2026-09-18T12:30:00.000Z",
    };
    let resolveCatalogRefresh!: () => void;
    const catalogRefresh = new Promise<void>((resolve) => {
      resolveCatalogRefresh = resolve;
    });
    let catalogRefreshAttempts = 0;
    mocks.queryClient.invalidateQueries.mockImplementation(
      ({ queryKey }: { queryKey: string[] }) =>
        queryKey[0] === "/api/admin/content"
          ? ++catalogRefreshAttempts === 1
            ? catalogRefresh
            : catalogRefreshAttempts === 2
              ? Promise.reject(new Error("catalog refresh unavailable"))
              : Promise.resolve()
          : Promise.resolve(),
    );
    mocks.updateMutation.mutate.mockImplementation(
      async (
        _variables: unknown,
        options?: { onError?: (error: unknown) => Promise<void> },
      ) => {
        await options?.onError?.({
          data: {
            code: "stale_alias",
            error: "This alternate title changed while you were editing.",
            current: currentCorrection,
          },
        });
      },
    );
    render();
    vi.useFakeTimers();

    act(() => button(container, "Edit").click());
    act(() => {
      setInput(
        container,
        "Alternate title for The Lighthouse",
        "An unsaved draft",
      );
      button(container, "Save").click();
    });
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });
    const pendingSave = mocks.updateMutation.mutate.mock.results.at(-1)
      ?.value as Promise<void> | undefined;
    if (!pendingSave) throw new Error("The stale-alias save did not start");

    const findConflictNotice = () =>
      Array.from(container.querySelectorAll<HTMLElement>('[role="alert"]')).find(
        (alert) =>
          alert.textContent?.includes("A newer correction is already saved"),
      );
    expect(findConflictNotice()?.textContent).toContain(
      "3 titles share this alias · may be stale",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(findConflictNotice()?.textContent).toContain(
      "3 titles share this alias · may be stale",
    );

    act(() => button(container, "Retry refresh").click());
    await act(async () => {
      for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
      }
    });
    expect(findConflictNotice()?.textContent).toContain(
      "3 titles share this alias · may be stale",
    );

    act(() => button(container, "Retry refresh").click());
    await act(async () => {
      for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
      }
    });
    expect(findConflictNotice()?.textContent).toContain(
      "3 titles share this alias",
    );
    expect(findConflictNotice()?.textContent).not.toContain("may be stale");

    await act(async () => {
      resolveCatalogRefresh();
      await pendingSave;
    });
    expect(findConflictNotice()?.textContent).toContain(
      "3 titles share this alias",
    );
    expect(findConflictNotice()?.textContent).not.toContain("may be stale");
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

    expect(container.textContent).toContain(
      "A newer correction is already saved",
    );
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
    expect(
      savedRow?.querySelector<HTMLAnchorElement>(
        `a[href="${savedRecord.sourceUrl}"]`,
      )?.textContent,
    ).toBe(savedRecord.sourceName);
    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(container.textContent).toContain(
      "Your saved correction is shown in the table below",
    );
    expect(container.textContent).toContain("Retry refresh");
    expect(container.textContent).not.toContain(
      "A newer correction is already saved",
    );

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

    expect(container.textContent).toContain(
      "A newer correction is already saved",
    );
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
      providerCitations: [],
      isEditorial: true,
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    const newestCorrection: AdminContentAlias = {
      ...firstCorrection,
      alias: "Newest admin correction",
      language: "it",
      sourceName: "Provider sources",
      sourceUrl: null,
      providerCitations: [
        {
          provider: "tvmaze",
          sourceName: "TVMaze",
          sourceUrl: "https://example.test/newest-tvmaze",
        },
        {
          provider: "wikipedia",
          sourceName: "EN Wikipedia",
          sourceUrl: "https://example.test/newest-wikipedia",
        },
      ],
      isEditorial: false,
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
    const firstConflictNotice =
      container.querySelector<HTMLElement>('[role="alert"]');
    expect(firstConflictNotice?.textContent).toContain(
      firstCorrection.sourceName,
    );
    expect(
      firstConflictNotice?.querySelector(
        `a[href="${firstCorrection.sourceUrl}"]`,
      ),
    ).not.toBeNull();
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
    const conflictNotice =
      container.querySelector<HTMLElement>('[role="alert"]');
    expect(conflictNotice?.textContent).toContain(newestCorrection.alias);
    expect(conflictNotice?.textContent).toContain(newestCorrection.language);
    expect(conflictNotice?.textContent).toContain("TVMaze");
    expect(conflictNotice?.textContent).toContain("EN Wikipedia");
    expect(conflictNotice?.querySelector(
      'a[href="https://example.test/newest-tvmaze"]',
    )?.textContent).toBe("TVMaze");
    expect(conflictNotice?.querySelector(
      'a[href="https://example.test/newest-wikipedia"]',
    )?.textContent).toBe("EN Wikipedia");
    expect(conflictNotice?.textContent).not.toContain(
      firstCorrection.sourceName,
    );
    expect(
      conflictNotice?.querySelector(
        `a[href="${firstCorrection.sourceUrl}"]`,
      ),
    ).toBeNull();
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
    ).toBe(newestCorrection.sourceUrl ?? "");

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
    expect(container.textContent).toContain(
      "A newer correction is already saved",
    );
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
    if (!removeButton)
      throw new Error("Unrelated alias Remove button not found");
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

  it.each([
    { retryOutcome: "succeeds", failedRequests: [] as RefreshRequest[] },
    { retryOutcome: "fails", failedRequests: ["aliases"] as RefreshRequest[] },
  ])(
    "keeps a stale-edit warning after removal and an initial refresh fail when the retry $retryOutcome",
    async ({ retryOutcome, failedRequests }) => {
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
      mocks.queryClient.invalidateQueries.mockClear();

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
      expectRefreshCalls(["aliases", "catalog"]);

      mocks.queryClient.invalidateQueries.mockClear();
      setRefreshFailures(failedRequests);
      act(() => button(container, "Retry refresh").click());
      await flushEffects();

      expectRefreshCalls(["aliases"]);
      const warningAfterRetry = Array.from(
        container.querySelectorAll('[role="alert"]'),
      ).find((alert) =>
        alert.textContent?.includes("A newer correction is already saved"),
      );
      expect(warningAfterRetry?.textContent).toContain(currentCorrection.alias);
      expect(warningAfterRetry?.textContent).toContain(
        currentCorrection.titleName,
      );
      expect(warningAfterRetry?.textContent).toContain(
        currentCorrection.language,
      );
      expect(warningAfterRetry?.textContent).toContain(
        currentCorrection.sourceName,
      );
      expect(warningAfterRetry?.textContent).toContain("Current version");
      expect(warningAfterRetry?.querySelector("a")?.getAttribute("href")).toBe(
        currentCorrection.sourceUrl,
      );

      if (retryOutcome === "succeeds") {
        expect(container.textContent).not.toContain(
          "Alternate-title refresh failed",
        );
        expect(
          Array.from(container.querySelectorAll("button")).some(
            (candidate) => candidate.textContent?.trim() === "Retry refresh",
          ),
        ).toBe(false);
      } else {
        expect(container.textContent).toContain(
          "Alternate-title refresh failed",
        );
        expect(container.textContent).toContain(
          "Failed refresh request: alternate-title list (alias records).",
        );
        expect(button(container, "Retry refresh")).toBeTruthy();
      }
    },
  );

  it("keeps stale correction details without retrying after a network removal failure", async () => {
    const currentCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "Newer Admin Correction",
      language: "de",
      sourceName: "Updated editorial source",
      sourceUrl: "https://example.test/updated-correction",
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
        void options?.onError?.(new TypeError("Failed to fetch"));
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
    expect(container.textContent).toContain(
      "A newer correction is already saved",
    );

    render([currentCorrection]);
    setRefreshFailures(["aliases"]);
    confirmSpy.mockReturnValue(true);
    mocks.queryClient.invalidateQueries.mockClear();

    act(() => button(container, "Remove").click());
    await flushEffects();

    expect(mocks.queryClient.invalidateQueries).not.toHaveBeenCalled();
    const conflictNotice = Array.from(
      container.querySelectorAll('[role="alert"]'),
    ).find((alert) =>
      alert.textContent?.includes("A newer correction is already saved"),
    );
    expect(conflictNotice?.textContent).toContain(currentCorrection.alias);
    expect(conflictNotice?.textContent).toContain(currentCorrection.titleName);
    expect(conflictNotice?.textContent).toContain(currentCorrection.language);
    expect(conflictNotice?.textContent).toContain(currentCorrection.sourceName);
    expect(conflictNotice?.textContent).toContain("Current version");
    expect(conflictNotice?.querySelector("a")?.getAttribute("href")).toBe(
      currentCorrection.sourceUrl,
    );
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (candidate) => candidate.textContent?.trim() === "Retry refresh",
      ),
    ).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not remove alternate title",
      description: "Failed to fetch",
      variant: "destructive",
    });
  });
  it("keeps stale correction details and retry available when a refresh retry times out", async () => {
    const currentCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "Newer Admin Correction",
      language: "de",
      sourceName: "Current editorial source",
      sourceUrl: "https://example.test/newer-correction",
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

    expect(container.textContent).toContain("Alternate-title refresh failed");
    expect(container.textContent).toContain(currentCorrection.alias);
    expect(container.textContent).toContain(currentCorrection.titleName);
    expect(container.textContent).toContain(currentCorrection.language);
    expect(container.textContent).toContain(currentCorrection.sourceName);
    expect(button(container, "Retry refresh").disabled).toBe(false);
    const conflictNotice = Array.from(
      container.querySelectorAll('[role="alert"]'),
    ).find((alert) =>
      alert.textContent?.includes("A newer correction is already saved"),
    );
    expect(
      conflictNotice?.querySelector(
        '[data-testid="status-conflict-correction-stale"]',
      )?.textContent,
    ).toContain("may no longer match the latest saved correction");
    expect(conflictNotice?.textContent).toContain("2 titles share this alias");
    expect(conflictNotice?.textContent).not.toContain(
      "2 titles share this alias · may be stale",
    );

    let resolveRetryRefresh!: () => void;
    const retryRefresh = new Promise<void>((resolve) => {
      resolveRetryRefresh = resolve;
    });
    mocks.queryClient.invalidateQueries.mockClear();
    mocks.queryClient.invalidateQueries.mockReturnValue(retryRefresh);

    vi.useFakeTimers();
    act(() => button(container, "Retry refresh").click());
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(container.textContent).toContain(
      "Alternate-title refresh is taking longer than expected",
    );
    expect(container.textContent).toContain(
      "A previous refresh is still pending.",
    );
    expect(conflictNotice?.textContent).toContain(currentCorrection.alias);
    expect(conflictNotice?.textContent).toContain(currentCorrection.titleName);
    expect(conflictNotice?.textContent).toContain(currentCorrection.language);
    expect(conflictNotice?.textContent).toContain(currentCorrection.sourceName);
    expect(conflictNotice?.textContent).toContain("Current version");
    expect(
      conflictNotice?.querySelector(
        `a[href="${currentCorrection.sourceUrl}"]`,
      )?.textContent,
    ).toBe(currentCorrection.sourceName);
    expect(
      conflictNotice?.querySelector(
        '[data-testid="status-conflict-correction-stale"]',
      )?.textContent,
    ).toContain("may no longer match the latest saved correction");
    expect(conflictNotice?.textContent).toContain("2 titles share this alias");
    expect(conflictNotice?.textContent).not.toContain(
      "2 titles share this alias · may be stale",
    );
    expect(button(container, "Retry refresh").disabled).toBe(false);

    await act(async () => {
      resolveRetryRefresh();
      await retryRefresh;
      await Promise.resolve();
    });
    expect(
      conflictNotice?.querySelector(
        '[data-testid="status-conflict-correction-stale"]',
      ),
    ).toBeNull();
    expect(conflictNotice?.textContent).toContain("2 titles share this alias");
    expect(conflictNotice?.textContent).not.toContain("may be stale");
  });

  it("keeps a stale-edit warning when removal fails and only collision refresh fails", async () => {
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
        void options?.onError?.({
          data: {
            error:
              "This alternate title changed while you were reviewing it. Refresh the list and review the newer correction before removing it.",
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
    expect(container.textContent).toContain(
      "A newer correction is already saved",
    );
    expect(container.textContent).toContain(currentCorrection.alias);

    render([currentCorrection]);
    mocks.queryClient.invalidateQueries.mockClear();
    setRefreshFailures(["catalog"]);
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
    expectRefreshCalls(["aliases", "catalog"]);
    const alerts = Array.from(container.querySelectorAll('[role="alert"]'));
    const conflictNotice = alerts.find((alert) =>
      alert.textContent?.includes("A newer correction is already saved"),
    );
    expect(conflictNotice?.textContent).toContain(currentCorrection.alias);
    const refreshNotice = alerts.find((alert) =>
      alert.textContent?.includes("Alternate-title refresh failed"),
    );
    expect(refreshNotice?.textContent).toContain(
      "Collision results may be stale; the alternate-title list refreshed successfully.",
    );
    expect(refreshNotice?.textContent).toContain(
      "Failed refresh request: catalog search (collision results).",
    );
    expect(button(container, "Retry refresh")).toBeTruthy();

    mocks.queryClient.invalidateQueries.mockClear();
    setRefreshFailures([]);
    act(() => button(container, "Retry refresh").click());
    await flushEffects();

    expectRefreshCalls(["catalog"]);
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
    expect(container.textContent).toContain(
      "A newer correction is already saved",
    );
    expect(container.textContent).toContain(currentCorrection.alias);
  });

  it("keeps stale correction details after a server removal error", async () => {
    const currentCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "Newer Admin Correction",
      language: "de",
      sourceName: "Current editorial source",
      sourceUrl: "https://example.test/current-correction",
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
        void options?.onError?.({
          data: {
            error: "The server could not remove this correction.",
          },
        });
      },
    );
    setRefreshFailures([]);
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
    expect(container.textContent).toContain(
      "A newer correction is already saved",
    );

    render([currentCorrection]);
    mocks.queryClient.invalidateQueries.mockClear();
    confirmSpy.mockReturnValue(true);
    act(() => button(container, "Remove").click());
    await flushEffects();

    expect(mocks.queryClient.invalidateQueries).not.toHaveBeenCalled();
    const conflictNotice = Array.from(
      container.querySelectorAll('[role="alert"]'),
    ).find((alert) =>
      alert.textContent?.includes("A newer correction is already saved"),
    );
    expect(conflictNotice?.textContent).toContain(currentCorrection.alias);
    expect(conflictNotice?.textContent).toContain(currentCorrection.titleName);
    expect(conflictNotice?.textContent).toContain(currentCorrection.language);
    expect(conflictNotice?.textContent).toContain(currentCorrection.sourceName);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not remove alternate title",
      description: "The server could not remove this correction.",
      variant: "destructive",
    });
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (candidate) => candidate.textContent?.trim() === "Retry refresh",
      ),
    ).toBe(false);
  });

  it("keeps stale correction details visible while catalog results refresh after a failed removal", async () => {
    const currentCorrection: AdminContentAlias = {
      ...initialAlias,
      alias: "Newer Admin Correction",
      language: "de",
      sourceName: "Updated editorial source",
      sourceUrl: "https://example.test/updated-correction",
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
    expect(container.textContent).toContain(
      "A newer correction is already saved",
    );

    render([currentCorrection]);
    confirmSpy.mockReturnValue(true);
    let resolveCatalogRefresh!: () => void;
    let catalogRefreshPending = false;
    let aliasRefreshSucceeded = false;
    const catalogRefresh = new Promise<void>((resolve) => {
      resolveCatalogRefresh = resolve;
    });
    mocks.queryClient.invalidateQueries.mockClear();
    mocks.queryClient.invalidateQueries.mockImplementation(
      ({ queryKey }: { queryKey: string[] }) => {
        if (queryKey[0] === "/api/admin/content-aliases") {
          render([currentCorrection]);
          aliasRefreshSucceeded = true;
          return Promise.resolve();
        }
        catalogRefreshPending = true;
        return catalogRefresh;
      },
    );

    act(() => button(container, "Remove").click());
    await vi.waitFor(async () => {
      await flushEffects();
      expect(aliasRefreshSucceeded).toBe(true);
      expect(catalogRefreshPending).toBe(true);
    });
    expectRefreshCalls(["aliases", "catalog"]);

    const pendingConflictNotice = Array.from(
      container.querySelectorAll('[role="alert"]'),
    ).find((alert) =>
      alert.textContent?.includes("A newer correction is already saved"),
    );
    expect(pendingConflictNotice?.textContent).toContain(
      currentCorrection.alias,
    );
    expect(pendingConflictNotice?.textContent).toContain(
      currentCorrection.titleName,
    );
    expect(pendingConflictNotice?.textContent).toContain(
      currentCorrection.language,
    );
    expect(pendingConflictNotice?.textContent).toContain(
      currentCorrection.sourceName,
    );
    expect(pendingConflictNotice?.textContent).toContain("Current version");
    expect(
      pendingConflictNotice?.querySelector("a")?.getAttribute("href"),
    ).toBe(currentCorrection.sourceUrl);
    expect(container.textContent).not.toContain("Stale draft correction");

    await act(async () => {
      resolveCatalogRefresh();
      await catalogRefresh;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const settledConflictNotice = Array.from(
      container.querySelectorAll('[role="alert"]'),
    ).find((alert) =>
      alert.textContent?.includes("A newer correction is already saved"),
    );
    expect(settledConflictNotice?.textContent).toContain(
      currentCorrection.alias,
    );
    expect(settledConflictNotice?.textContent).toContain(
      currentCorrection.titleName,
    );
    expect(settledConflictNotice?.textContent).toContain(
      currentCorrection.language,
    );
    expect(settledConflictNotice?.textContent).toContain(
      currentCorrection.sourceName,
    );
    expect(
      settledConflictNotice?.querySelector("a")?.getAttribute("href"),
    ).toBe(currentCorrection.sourceUrl);
    expect(container.textContent).not.toContain(
      "Refreshing alternate-title views",
    );
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
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith(
      {
        queryKey: ["/api/admin/content-aliases"],
      },
      { throwOnError: true },
    );
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith(
      {
        queryKey: ["/api/admin/content"],
      },
      { throwOnError: true },
    );

    render([uniqueAlias()]);
    expect(container.textContent).toContain("Unique");
    expect(container.textContent).not.toContain("2 titles");
  });

  it("refreshes collision badges and explains a stale removal conflict", async () => {
    mocks.deleteMutation.mutate.mockImplementation(
      (
        _variables: unknown,
        options?: { onError?: (error: unknown) => Promise<void> },
      ) => {
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
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith(
      {
        queryKey: ["/api/admin/content-aliases"],
      },
      { throwOnError: true },
    );
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith(
      {
        queryKey: ["/api/admin/content"],
      },
      { throwOnError: true },
    );
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
      mocks.lookupAdminContentAliasCollisions.mockImplementation(
        async ({ aliases }: { aliases: string[] }) =>
          aliases.map((alias) => ({
            alias,
            collision: alias !== "Corrected Local Title",
            collisionTitleCount:
              alias === "Corrected Local Title" ? 1 : 2,
          })),
      );
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
      expect(mocks.lookupAdminContentAliasCollisions).toHaveBeenCalledWith({
        aliases: ["Corrected Local Title"],
      });
      const collisionCell = container.querySelector(
        "tbody tr td:nth-child(5)",
      );
      if (failedQueryKeys.includes("/api/admin/content-aliases")) {
        expect(
          container.querySelector("tbody tr td:first-child")?.textContent,
        ).toContain("Corrected Local Title");
        expect(collisionCell?.textContent).toContain("Unique");
      } else {
        expect(collisionCell?.textContent).toContain("2 titles");
      }
      const staleCollisionBadge = container.querySelector(
        '[aria-label^="Collision results may be stale:"]',
      );
      if (failedQueryKeys.includes("/api/admin/content")) {
        expect(staleCollisionBadge).not.toBeNull();
      } else {
        expect(staleCollisionBadge).toBeNull();
      }
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

  it.each([
    {
      failedRequest: "aliases",
      expectedWarning:
        "The alternate-title list may be stale; collision results refreshed successfully.",
      collisionMayBeStale: false,
    },
    {
      failedRequest: "catalog",
      expectedWarning:
        "Collision results may be stale; the alternate-title list refreshed successfully.",
      collisionMayBeStale: true,
    },
  ] as const)(
    "keeps post-removal collision badges accurate when only $failedRequest refresh fails",
    async ({ failedRequest, expectedWarning, collisionMayBeStale }) => {
      const otherAlias: AdminContentAlias = {
        ...initialAlias,
        id: 18,
        titleId: 102,
        titleName: "The Harbor",
      };
      const refreshCalls: RefreshRequest[] = [];
      mocks.queryClient.invalidateQueries.mockImplementation(
        ({ queryKey }: { queryKey: string[] }) => {
          const request: RefreshRequest =
            queryKey[0] === "/api/admin/content-aliases"
              ? "aliases"
              : "catalog";
          refreshCalls.push(request);
          return request === failedRequest &&
            refreshCalls.filter((called) => called === request).length === 1
            ? Promise.reject(new Error(`${request} refresh unavailable`))
            : Promise.resolve();
        },
      );
      mocks.lookupAdminContentAliasCollisions.mockImplementation(
        async ({ aliases }: { aliases: string[] }) =>
          aliases.map((alias) => ({
            alias,
            collision: false,
            collisionTitleCount: 1,
          })),
      );
      render([initialAlias, otherAlias]);
      confirmSpy.mockReturnValue(true);

      act(() => button(container, "Remove").click());
      await flushEffects();

      expect(mocks.deleteMutation.mutate).toHaveBeenCalledWith(
        {
          id: initialAlias.id,
          data: { expectedUpdatedAt: initialAlias.updatedAt },
        },
        expect.any(Object),
      );
      expect(refreshCalls).toEqual(["aliases", "catalog"]);
      expect(mocks.lookupAdminContentAliasCollisions).toHaveBeenCalledWith({
        aliases: [initialAlias.alias],
      });
      const remainingRow = Array.from(
        container.querySelectorAll("tbody tr"),
      ).find((row) => row.textContent?.includes("The Harbor"));
      const collisionCell = remainingRow?.querySelector("td:nth-child(5)");
      expect(collisionCell?.textContent).toContain(
        collisionMayBeStale ? "Unique · may be stale" : "Unique",
      );
      if (!collisionMayBeStale) {
        expect(collisionCell?.textContent).not.toContain("may be stale");
      }
      expect(container.textContent).toContain(expectedWarning);
      expect(button(container, "Retry refresh")).toBeTruthy();

      act(() => button(container, "Retry refresh").click());
      await flushEffects();

      expect(refreshCalls).toEqual(["aliases", "catalog", failedRequest]);
      expect(mocks.lookupAdminContentAliasCollisions).toHaveBeenCalledTimes(1);
      expect(container.textContent).not.toContain(
        "Alternate-title refresh failed",
      );
      expect(
        container.querySelector(
          '[aria-label^="Collision results may be stale:"]',
        ),
      ).toBeNull();
      const refreshedRow = Array.from(
        container.querySelectorAll("tbody tr"),
      ).find((row) => row.textContent?.includes("The Harbor"));
      const refreshedCollisionCell =
        refreshedRow?.querySelector("td:nth-child(5)");
      expect(refreshedCollisionCell?.textContent).toContain("Unique");
      expect(refreshedCollisionCell?.textContent).not.toContain(
        "may be stale",
      );
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
    for (const [filters, update] of mocks.queryClient.setQueriesData.mock
      .calls) {
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
    expect(container.textContent).not.toContain(
      "Alternate-title refresh failed",
    );
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
