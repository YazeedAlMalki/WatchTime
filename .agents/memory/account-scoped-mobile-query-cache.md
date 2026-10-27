---
name: Account-scoped mobile query caches
description: Keep cached personal API data isolated when the active account changes without a screen remount.
---

Personal API query cache keys must distinguish the authenticated account, even when the endpoint URL is identical. The cache identity must match the session source used for the request; development demo tokens take precedence over Clerk tokens when enabled.

Mutation success handlers must capture the starting account in mutation context and skip invalidation when that account is no longer active. Invalidate account-suffixed title and personal-data keys only.

**Why:** Generated personal endpoints use stable URL-based query keys while the bearer token selects the user on the server. A late mutation can run a refreshed success callback after an account switch, otherwise refetching the current account for an earlier account's write.

**How to apply:** When a mobile screen can stay mounted across account changes, append the active auth identity to personal query keys (or synchronously remove those cache entries). Capture the initiating identity in mutation context and compare it before invalidating. Test that old mutation completions do not refresh the new account, while current-account mutations refetch only that account.