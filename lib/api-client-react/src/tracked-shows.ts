/**
 * Group only the pages already loaded. Keep the server's immutable-ID order
 * inside each group; sorting the API pages themselves by mutable progress
 * would move titles across pagination boundaries.
 */
export function orderTrackedShows<T extends { watchedEpisodes: number; nextEpisode?: object | null }>(shows: readonly T[]): T[] {
  return [
    ...shows.filter(show => show.watchedEpisodes > 0 && show.nextEpisode != null),
    ...shows.filter(show => show.watchedEpisodes === 0 && show.nextEpisode != null),
    ...shows.filter(show => show.nextEpisode == null),
  ];
}

/** Merge independent ID-paged feeds without changing either feed's cursor. */
export function mergeTrackedShows<T extends { title: { id: number }; watchedEpisodes: number; nextEpisode?: object | null }>(
  all: readonly T[],
  inProgress: readonly T[],
): T[] {
  const byId = new Map<number, T>();
  for (const show of inProgress) {
    if (show.watchedEpisodes > 0 && show.nextEpisode != null) byId.set(show.title.id, show);
  }
  // The full collection takes precedence when it has fresher progress.
  for (const show of all) byId.set(show.title.id, show);
  return orderTrackedShows([...byId.values()]);
}