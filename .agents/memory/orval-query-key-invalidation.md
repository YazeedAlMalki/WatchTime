---
name: Orval query key invalidation pitfall
description: Manually constructed React Query keys don't match Orval-generated keys; always use the generated getGet*QueryKey helpers for invalidation.
---

# Orval query key invalidation pitfall

Orval generates query keys as a single-string array: `["/api/titles/${id}/seasons/${seasonNumber}"]`.

Manually constructed keys like `["/api/titles", id, "seasons", seasonNumber]` are structurally different and will never match, so `queryClient.invalidateQueries({ queryKey: [...] })` silently no-ops — the data never refetches and UI stays stale.

**Why:** React Query key matching uses deep equality; segment-split arrays don't equal a single concatenated string.

**How to apply:** Whenever you need to invalidate an Orval-managed query, import and call the corresponding `getGet<Resource>QueryKey(...)` helper (e.g. `getGetSeasonQueryKey(titleId, seasonNumber)`) and pass its return value as `queryKey`. Never construct the key by hand.
