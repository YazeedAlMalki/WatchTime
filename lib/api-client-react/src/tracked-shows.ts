import type { TrackedShow } from "./generated/api.schemas";

/**
 * Group only the pages already loaded. Keep the server's immutable-ID order
 * inside each group; sorting the API pages themselves by mutable progress
 * would move titles across pagination boundaries.
 */
export function orderTrackedShows<T extends Pick<TrackedShow, "watchedEpisodes" | "nextEpisode">>(shows: readonly T[]): T[] {
  return [
    ...shows.filter(show => show.watchedEpisodes > 0 && show.nextEpisode !== null),
    ...shows.filter(show => show.watchedEpisodes === 0 && show.nextEpisode !== null),
    ...shows.filter(show => show.nextEpisode === null),
  ];
}