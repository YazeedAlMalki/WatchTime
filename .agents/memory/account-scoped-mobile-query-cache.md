---
name: Account-scoped mobile query caches
description: Keep cached personal API data isolated when the active account changes without a screen remount.
---

Personal API query cache keys must distinguish the authenticated account, even when the endpoint URL is identical. The cache identity must match the session source used for the request; development demo tokens take precedence over Clerk tokens when enabled.

Treat unresolved auth as a separate cache scope from a confirmed guest. Public title requests may begin while Clerk is loading, but watched and watchlist state stays hidden until auth resolves, and the account transition must select an account-specific query key.

Mutation success handlers must capture the starting account in mutation context and skip invalidation when that account is no longer active. Invalidate account-suffixed title and personal-data keys only.

**Why:** Generated personal endpoints use stable URL-based query keys while the bearer token selects the user on the server. Late requests or mutations can cross auth transitions unless pending, guest, and account state remain isolated.

**How to apply:** When a mobile screen can stay mounted across auth transitions, give pending auth, guest, and each signed-in identity distinct personal query scopes. Hide private status until auth is resolved. Capture the initiating identity in mutation context and compare it before invalidating. Test that old responses and mutations cannot expose or refresh another scope's data.