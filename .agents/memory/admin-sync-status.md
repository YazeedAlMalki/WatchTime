---
name: Admin sync status
description: Durable status patterns for resumable administrator-triggered syncs.
---

Resumable admin syncs should expose the last completed run separately from any currently running run, including the saved offset and per-item outcomes.

**Why:** Reloading or leaving the admin page must not erase the operator’s recovery point, while an active request must not be mistaken for a completed result.

**How to apply:** Persist the run lifecycle server-side and let the admin UI hydrate from that status rather than treating mutation-local state as the source of truth.