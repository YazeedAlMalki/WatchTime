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
- Catalog is a locally seeded set of 12 **fictional** titles (user declined a TMDB key); `tmdbId`/`imdbId` columns exist for a later real sync. Re-seed: `pnpm --filter @workspace/api-server exec tsx src/seed.ts` (idempotent — skips if titles exist).
- Poster/backdrop images live in `artifacts/watchtime/public/posters|backdrops`.

## User preferences
- Do not re-request a TMDB API key (declined).
