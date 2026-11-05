---
name: Account-scoped mobile query caches
description: Keep cached personal API data isolated when the active account changes without a screen remount.
---

Personal API query cache keys must distinguish the authenticated account, even when the endpoint URL is identical. The cache identity must match the session source used for the request; development demo tokens take precedence over Clerk tokens when enabled.

Treat unresolved auth as a separate cache scope from a confirmed guest. Public title requests may begin while Clerk is loading, but watched and watchlist state stays hidden until auth resolves, and the account transition must select an account-specific query key.

Mutation success handlers must capture the starting account in mutation context and skip invalidation when that account is no longer active. Invalidate account-suffixed title and personal-data keys only.

**Why:** Generated personal endpoints use stable URL-based query keys while the bearer token selects the user on the server. Late requests or mutations can cross auth transitions unless pending, guest, and account state remain isolated.

**How to apply:** When a screen can stay mounted across auth transitions, give pending auth, guest, and each signed-in identity distinct personal query scopes. Hide private status until auth resolves. Capture the initiating identity in mutation context and compare it before invalidating. Invalidate only the matching account-scoped title and personal-data keys. Test that old responses and mutations cannot expose or refresh another scope, while current-account mutations refresh their own data.

For React Native account-switch regressions, prefer testing the full A → B lifecycle in one mounted screen test. Capture the initiating mutation callback and context before switching, then invoke that completion after the new account has loaded.

**Why:** A split test using module-scoped auth/session mocks and a shared hook harness passed alone but failed in the full suite before its initial query ran. Keeping the switch and late completion in one lifecycle made the regression deterministic and verified the actual cross-account cache boundary.

**How to apply:** Exercise the starting account, switch identity and session, load the new account's query, then settle the old mutation. Assert the new account's query keys and request counts remain unchanged, and that a current-account mutation invalidates/refetches only its scoped keys.
