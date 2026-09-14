---
name: Real catalog sources
description: Where WatchTime's real-title catalog data comes from and constraints on safety data.
---
- Use TVMaze's public API (no credentials) for verified TV/anime/documentary-series identities, episodes, cast, and artwork; use Wikipedia REST summaries for curated film summaries and images.
- **Why:** user declined a TMDB key but demanded real titles; TVMaze + Wikipedia need no credentials. Do NOT re-ask for a TMDB key.
- iTunes Search API and api.imdbapi.dev are unreachable/empty from this container — don't retry them.
- Pin curated TVMaze IDs and validate returned title/type/year/IMDb identity; never accept a search result as an identity without validation.
- Safety records (Common Sense Media etc.) must be `provider_unavailable` with empty items for real titles — the BRD forbids fabricated safety data.
