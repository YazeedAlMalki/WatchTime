---
name: Alternate-title query planning
description: PostgreSQL plan behavior for tracked-show searches using alternate-title substring matches.
---
For tracked-show search with `ILIKE '%term%'`, PostgreSQL may decorrelate a title-correlated alias `EXISTS` into a hash-style scan of the entire `title_aliases` table. A scalar alias lookup constrained by `title_id`, with `LIMIT 1`, used the existing title-ID index and bounded work to the aliases for the current page.

**Why:** A measured 400-show fixture with nine matching aliases per show examined about 3,800 alias rows through the `EXISTS` plan; the correlated lookup examined 360 rows for a 20-result page. No new index was needed.

**How to apply:** When changing alternate-title search predicates, run `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` against a large alias fixture. Check alias-table rows scanned and confirm per-title index access instead of relying on elapsed-time thresholds.
