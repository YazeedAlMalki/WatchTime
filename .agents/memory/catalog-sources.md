---
name: Real catalog sources
description: Where WatchTime's real-title catalog data comes from and constraints on safety data.
---
- Catalog is seeded with real titles via `seed-real.ts`: TVMaze API (free, no key) for TV/anime/docuseries — one call per show with `?embed[]=episodes&embed[]=cast`; Wikipedia REST summary API for movie plots + posters.
- **Why:** user declined a TMDB key but demanded real titles; TVMaze + Wikipedia need no credentials. Do NOT re-ask for a TMDB key.
- iTunes Search API and api.imdbapi.dev are unreachable/empty from this container — don't retry them.
- TVMaze ids must be verified via `/singlesearch/shows?q=` before hardcoding — guessed ids were wrong for 5 of 10 shows.
- Safety records (Common Sense Media etc.) must be `provider_unavailable` with empty items for real titles — the BRD forbids fabricated safety data.
