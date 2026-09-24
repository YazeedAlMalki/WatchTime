import { mergeTrackedShows } from '../../../lib/api-client-react/src/tracked-shows';

const show = (id: number, watchedEpisodes: number, hasNext = true) => ({
  title: { id },
  watchedEpisodes,
  nextEpisode: hasNext ? { id: id * 10 } : null,
});

describe('merging the independently paged show feeds', () => {
  it('shows an older in-progress title without loading its full-library page', () => {
    const fullPage = Array.from({ length: 24 }, (_, i) => show(70 - i, 0));
    const progressPage = [show(2, 1), show(1, 1)];
    expect(mergeTrackedShows(fullPage, progressPage).map(s => s.title.id).slice(0, 2)).toEqual([2, 1]);
  });

  it('does not duplicate a title when the full feed eventually reaches it', () => {
    const fullPages = [show(70, 0), show(2, 1), show(1, 1)];
    const progressPage = [show(2, 1), show(1, 1)];
    expect(mergeTrackedShows(fullPages, progressPage).map(s => s.title.id)).toEqual([2, 1, 70]);
    const changedFullPage = [show(2, 2, false), show(1, 1)];
    expect(mergeTrackedShows(changedFullPage, progressPage).map(s => s.title.id)).toEqual([1, 2]);
  });
});