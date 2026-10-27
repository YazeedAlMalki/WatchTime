---
name: Alternate-title query planning
description: PostgreSQL plan behavior for tracked-show searches using alternate-title substring matches.
---
For tracked-show search with `ILIKE '%term%'`, PostgreSQL may decorrelate a title-correlated alias `EXISTS` into a hash-style scan of the entire `title_aliases` table. A scalar alias lookup constrained by `title_id`, with `LIMIT 1`, used the existing title-ID index and bounded work to the aliases for the current page.

Sparse matches still increase title-scoped row work: a measured 400-show fixture with 50 aliases per title, only two matching aliases on half the titles, and a 20-result page examined about 3,000 alias rows through the title-ID index. The broad-match fixture examined 360 rows on the same page. No global scan was needed, but rejected candidate titles also contribute work.

**Why:** A prior broad-match fixture with nine matching aliases per title showed about 3,800 rows through the `EXISTS` plan and 360 with the correlated lookup. Sparse-match data better reflects the extra title-local work needed to reject candidates.

**How to apply:** When changing alternate-title search predicates, run `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` against both broad and sparse alias fixtures. Budget sparse row work against candidate titles times aliases per title, confirm per-title index access, and avoid machine-specific latency thresholds.
