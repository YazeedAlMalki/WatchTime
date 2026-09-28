---
name: API test database isolation
description: Prevent API test files from racing while they mutate shared database tables.
---

For API tests using the shared development database, keep file-level parallelism disabled; `singleFork` alone did not prevent table-resetting suites from racing with adapter persistence assertions.

**Why:** Seed tests delete and restore whole tables, which can overwrite health rows while another file is testing a provider refresh.

**How to apply:** Preserve serial file execution in the API server Vitest configuration, and avoid overlapping separate Vitest invocations against the same `DATABASE_URL`.