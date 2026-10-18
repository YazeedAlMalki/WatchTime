---
name: API test database isolation
description: Prevent API test files from racing while they mutate shared database tables.
---

For API tests using the shared development database, keep file-level parallelism disabled; `singleFork` alone did not prevent table-resetting suites from racing with adapter persistence assertions.

**Why:** Seed tests delete and restore whole tables, which can overwrite health rows while another file is testing a provider refresh.

**How to apply:** Preserve serial file execution in the API server Vitest configuration, and avoid overlapping separate Vitest invocations against the same `DATABASE_URL`.

Tests that list shared catalog rows must not assume newly inserted fixtures appear on the first page. Scope the request with a fixture-specific search when validating unfiltered ownership behavior, and assert that the response includes each intended ownership type.

**Why:** The development database can already contain more aliases than one page, so a bare list request may omit test records even when the endpoint is correct.

**How to apply:** When testing list filters against a persistent catalog, omit only the filter being tested and use a unique query to keep fixture results deterministic.