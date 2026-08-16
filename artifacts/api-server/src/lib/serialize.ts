import type { Title, Episode } from "@workspace/db";

export type TitleJson = {
  id: number;
  type: string;
  name: string;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  year: number | null;
  genres: string[];
  imdbRating: number | null;
  rottenTomatoesScore: number | null;
  runtimeMinutes: number | null;
  status: string | null;
  inWatchlist: boolean | null;
  watched: boolean | null;
};

export function toTitleJson(
  t: Title,
  userState?: { inWatchlist?: boolean; watched?: boolean },
): TitleJson {
  return {
    id: t.id,
    type: t.type,
    name: t.name,
    overview: t.overview,
    posterUrl: t.posterUrl,
    backdropUrl: t.backdropUrl,
    year: t.year,
    genres: t.genres ?? [],
    imdbRating: t.imdbRating,
    rottenTomatoesScore: t.rottenTomatoesScore,
    runtimeMinutes: t.runtimeMinutes,
    status: t.status,
    inWatchlist: userState?.inWatchlist ?? null,
    watched: userState?.watched ?? null,
  };
}

export function toEpisodeJson(e: Episode, watched: boolean | null = null) {
  return {
    id: e.id,
    seasonNumber: e.seasonNumber,
    episodeNumber: e.episodeNumber,
    name: e.name,
    overview: e.overview,
    airDate: e.airDate,
    runtimeMinutes: e.runtimeMinutes,
    stillUrl: e.stillUrl,
    watched,
  };
}
