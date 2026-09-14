# Watch history import API

All endpoints require the current signed-in user and are scoped to that user. The API
accepts file text inside JSON rather than multipart uploads so the web client never
needs an upload-storage URL.

## `POST /api/imports`

Creates (or returns) a parsed preview. Request:

```json
{
  "source": "trakt",
  "fileName": "history.json",
  "content": "[{\"kind\":\"watched_movie\",\"title\":\"Arrival\",\"year\":2016}]"
}
```

`source` is one of `tvtime`, `trakt`, `letterboxd`, or `generic`. `content` must be
UTF-8 CSV or JSON text, at most 2 MiB and 5,000 source rows. The raw text is parsed
in memory only and is never stored or logged. Re-submitting identical source/content
for the same user returns the existing job (`200`); a new job returns `201`.

The response is an `ImportJob`, including preview `items`. Each item has a
classification (`matched`, `duplicate`, `unmatched`, `ambiguous`, `invalid`, or
`unsupported`), a proposed match, and candidates where a user may resolve ambiguity.
Only `matched` rows begin selected.

## Strict source formats

A title-like column alone is never assumed to be watched history. Exports require
at least one object/CSV row; JSON arrays containing primitives are rejected.

* **Generic:** CSV requires `kind,title`; JSON is an array or `{ "items": [...] }`.
  Optional fields are `type,year,imdbId,tmdbId,season,episode,watchedAt`. Kinds are
  `watched_movie`, `watched_episode`, `tracked_show`, and `watchlist`.
* **TV Time:** CSV requires `Title,Type`; JSON requires `{ "items": [...] }`.
  Type is `movie`, `episode`, `show`/`tv`, `watchlist_movie`, or `watchlist_show`.
  Episodes require `Season,Episode`.
* **Trakt:** JSON export object only, containing one or more supported `movies`,
  `shows`, `episodes`, or `watchlist` arrays with Trakt `movie`/`show` and `ids`
  objects. Episode entries require `episode.season` and `episode.number`.
* **Letterboxd:** CSV only. A diary needs `Name,Year,Watched Date`, or the legacy
  Diary shape `Date,Name,Year,Letterboxd URI` in a file named `diary`. The standard
  `watched.csv` export with exactly `Date,Name,Year,Letterboxd URI` is also watched
  history. A watchlist
  requires `Name,Year,Letterboxd URI` and `watchlist` in its filename. Ratings or
  reviews-only files are unsupported even when they include a `Date` and `Rating`.

Years must be integer 1888–3000; TMDB IDs are positive integers; IMDb IDs are
`tt` followed by 7–10 digits. Types must agree with their kind. Supplied IMDb and
TMDB IDs must both map to the same compatible catalog title.

Episode season `0` is valid for specials; episode numbers remain positive. Dates
must be calendar-valid ISO `YYYY-MM-DD` or ISO timestamps.

## Preview and resolution

* `GET /api/imports/:id` returns the same private `ImportJob`.
* `PATCH /api/imports/:id/items/:itemId` accepts exactly one of
  `{ "titleId": 123 }` or `{ "skip": true }`. A title may only be selected from
  the candidates supplied by the preview. Resolving a valid row selects it; skipping
  deselects it. Completed imports cannot be changed.
* `POST /api/imports/:id/confirm` applies all selected matched rows atomically and
  returns the completed job. It is safe to retry: a concurrent/repeated confirmation
  returns the completed job and existing tracking records are never duplicated or
  overwritten. The completed `summary` adds `selected`, `applied`, `duplicates`,
  and `skipped`; the latter counts reflect actual conflict-safe inserts.

## Report

`GET /api/imports/:id/report` downloads `text/csv` with only skipped/error rows
(unmatched, ambiguous, invalid, unsupported, or unselected). It contains no source
file content. `404` is returned for a job belonging to another user, as for all
job/item routes.

Expected errors are `{ "error": "..." }`: `400` for unsupported/malformed/bounded
input or invalid state, `413` when the HTTP JSON request itself exceeds its parser
limit, `404` for unknown/private resources, and `429` for excessive create/confirm
requests.