# WatchTime

A TV Time-style tracking app for movies, TV, anime, and documentaries with a differentiating **Content Safety** section on title pages (source-attributed data from Common Sense Media, Kids-In-Mind, Does the Dog Die?, CringeMDb, and community contributions, with episode → season → series fallback and explicit `provider_unavailable` states — data is never fabricated).

## Structure
- `artifacts/watchtime` — React + Vite web app (preview path `/`), warm cinematic theme (crimson accent, Outfit/DM Sans).
- `artifacts/api-server` — Express API (`/api/*`), Clerk auth via proxy middleware, Drizzle + Postgres.
- `lib/api-spec` — OpenAPI source of truth; codegen produces `lib/api-zod` (server validation) and `lib/api-client-react` (TanStack Query hooks). Run `pnpm --filter @workspace/api-spec run codegen` after spec changes.
- `lib/db` — Drizzle schema (`pnpm --filter @workspace/db run push` to sync).

## Key behaviors
- **First registered user becomes the single admin** (JIT provisioning in `artifacts/api-server/src/middlewares/auth.ts`).
- Visitors can browse/search/view safety without signing in; tracking requires auth.
- Safety contributions require ≥5 watched episodes+movies (`CONTRIBUTION_THRESHOLD`); approved contributions merge into a "WatchTime Community" safety record.
- Catalog is synchronized additively from public TVMaze and Wikipedia sources. Run `pnpm --filter @workspace/api-server exec tsx src/seed-real.ts` for a resumable sync; it preserves catalog and user tracking data, supports `--dry-run`, `--limit`, `--type`, and reports failures (use `--allow-partial` for an explicitly partial run). Safety records are `provider_unavailable` (no live safety integrations; never fabricate). Legacy fictional seed remains in `src/seed.ts` and is not invoked by normal workflows.
- Does the Dog Die refreshes use the documented server-side API v3. Configure `DOES_THE_DOG_DIE_API_KEY` as a workspace secret, set `DOES_THE_DOG_DIE_API_TIER` to the licensed tier (`free`, `commercial`, or `enterprise`), and set `DOES_THE_DOG_DIE_COMMERCIAL_USE=true` only when the selected tier permits commercial use. The key is never sent to clients.
- Wikidata classification refreshes use the official no-key SPARQL endpoint and only exact, verified catalog IMDb IDs. Supported source-attributed labels are MPAA (P1657), FSK (P1981), BBFC (P2629), and CNC (P2758); labels never become fabricated numeric scores. Admin content refresh accepts `provider: "wikidata"` and remains bounded/resumable via the existing batch `limit`/`offset`.
- Poster/backdrop images live in `artifacts/watchtime/public/posters|backdrops`.

## Rate-limit cleanup operations
- Each API process logs one aggregate `rate_limit_cleanup` event per completed scheduled batch: duration, deleted rows, batch cap, and consecutive cap hits. Failures log duration and `outcome: failure`; deleted rows are unknown, not zero. Raw database errors and client keys are intentionally excluded.
- Three consecutive full batches trigger a possible-backlog warning, repeated at most every 15 minutes while saturation continues. A partial/empty batch or failure breaks the streak; a failure does not prove the backlog cleared. Measurements are process-local and reset on restart, not exact database-wide backlog totals.
- To adjust cleanup throughput, tune `RATE_LIMIT_CLEANUP_BATCH_SIZE` (currently 500) or `RATE_LIMIT_CLEANUP_INTERVAL_MS` (currently 60 seconds) in `artifacts/api-server/src/middlewares/rateLimitCleanup.ts` after checking duration and database load. Keep both `reset_time <= NOW()` predicates, the batch limit, and `FOR UPDATE SKIP LOCKED`; never delete active counters to clear a backlog. No full-table backlog count is performed.

## User preferences
- Do not re-request a TMDB API key (declined).
