---
name: Account-scoped mobile query caches
description: Keep cached personal API data isolated when the active account changes without a screen remount.
---

Personal API query cache keys must distinguish the authenticated account, even when the endpoint URL is identical. The cache identity must match the session source used for the request; development demo tokens take precedence over Clerk tokens when enabled.

**Why:** Generated personal endpoints use stable URL-based query keys while the bearer token selects the user on the server. Without an account dimension, a mounted observer can reuse the previous account's data before a refetch completes.

**How to apply:** When a mobile screen can stay mounted across account changes, append the active auth identity to its personal query keys (or synchronously remove those cache entries). Test that the previous feed disappears as soon as identity changes, then verify each new query uses the current session token.