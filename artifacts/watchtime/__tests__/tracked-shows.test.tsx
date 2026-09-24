import { describe, expect, it } from "vitest";
import { orderTrackedShows } from "@workspace/api-client-react";

type Row = { id: number; watchedEpisodes: number; nextEpisode: { id: number } | null };
const newShow = (id: number): Row => ({ id, watchedEpisodes: 0, nextEpisode: { id } });

describe("My Tracking display order across pages", () => {
  it("promotes partial progress from a later page without changing the API cursor or losing cards", () => {
    const firstPage = [newShow(40), newShow(30)];
    const beforeId = firstPage.at(-1)!.id;
    // Watched progress changes on both sides of the boundary before page two.
    const secondPage: Row[] = [
      { id: 20, watchedEpisodes: 1, nextEpisode: { id: 21 } },
      newShow(10),
    ];
    expect(beforeId).toBe(30);
    const visible = orderTrackedShows([...firstPage, ...secondPage]);
    expect(visible.map(show => show.id)).toEqual([20, 40, 30, 10]);
    expect(new Set(visible.map(show => show.id)).size).toBe(4);

    const refreshedFirst: Row[] = [
      { id: 40, watchedEpisodes: 1, nextEpisode: { id: 41 } },
      { id: 30, watchedEpisodes: 2, nextEpisode: null },
    ];
    expect(orderTrackedShows([...refreshedFirst, ...secondPage]).map(show => show.id))
      .toEqual([40, 20, 10, 30]);
    // A later page uses the original immutable ID boundary, not the display order.
    expect(secondPage.at(-1)!.id).toBe(10);
  });
});