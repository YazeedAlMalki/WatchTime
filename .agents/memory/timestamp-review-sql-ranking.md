---
name: Timestamp-review SQL ranking
description: Keep database-side malformed-rating filtering equivalent to shared regional rating selection.
---

When an admin timestamp-review query ranks candidate ratings in SQL instead of resolving every title in application code, its ordering must stay aligned with `resolvePreferredRating`: compare freshness at JavaScript `Date` millisecond precision, place malformed infinities after valid timestamps, then apply tier, label, URL, and record-ID tie-breaks. Use deterministic binary text ordering for label and URL comparisons so database collation does not change which rating is selected.

**Why:** The filtered query decides whether a title belongs on a page before full content is loaded. A mismatch with the shared resolver can hide a malformed selected rating or include one that is not selected.

**How to apply:** Whenever rating-selection rules or timestamp parsing change, update the SQL ranking in the admin timestamp-review route and its route tests alongside the shared resolver.
