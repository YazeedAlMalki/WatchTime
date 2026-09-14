---
name: Import safety boundaries
description: Why import adapters must distinguish source files explicitly and avoid heuristic activity inference.
---

Keep imports additive and previewed; do not infer watched activity merely from a title, date, or rating.

**Why:** Letterboxd watched, ratings, and custom-list exports can share most columns. Early generic heuristics silently treated ratings as watched history. Source file identity and documented field contracts are necessary to distinguish intent. Unsupported exports should be rejected or shown as unsupported rather than guessed.

**How to apply:** When adding source shapes, fixture both the intended export and look-alike unsupported exports. For identity matching, reject conflicting provider IDs and incompatible media types. Never expand source support by weakening these checks.

Helpers called while holding database row locks must use the transaction's connection, not borrow from the global pool.

**Why:** Concurrent requests waiting on the same row can occupy every pool connection. If the lock holder then borrows another connection, neither the holder nor its waiters can progress.

**How to apply:** Pass the active transaction into query helpers. Test concurrency with most pool connections already leased; low-concurrency tests cannot expose this starvation pattern.