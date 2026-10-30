---
name: Rating conflict freshness
description: Semantics for determining when official rating records warrant an admin conflict warning.
---

Conflict warnings compare all eligible official records tied at the newest valid refresh timestamp. Source-tier priority may choose the displayed rating, but it does not remove equally fresh classifications from conflict detection.

**Why:** Selection and conflict detection answer different questions: the selector chooses one preferred value, while the warning identifies disagreement among current classifications.

**How to apply:** When changing rating resolution or admin review tests, preserve this distinction and exclude stale, malformed, unavailable, community, and non-selected-region records from the warning.
