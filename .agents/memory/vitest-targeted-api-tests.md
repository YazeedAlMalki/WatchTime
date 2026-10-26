---
name: Targeted API Vitest runs
description: How to run one API server test file without triggering the full suite.
---

Run an individual API server test file with `pnpm --filter @workspace/api-server exec vitest run <path>`. Appending `-- <path>` to the package's `test` script may still run the entire suite instead of selecting that file.

**Why:** The script argument separator was interpreted by Vitest in a way that did not filter the requested file, leading to unrelated test failures and long-running integration cases.

**How to apply:** Use direct `vitest run <path>` execution when verifying a focused API change; use the package test script for the full suite. With Vitest v4, spell the silent option as `--silent=true` before the paths; bare `--silent` can consume the first test path as its value.

DB-backed test rows can persist between separate Vitest runs, so fixed fake-clock race tests must reset relevant row timestamps to a deterministic older baseline before each scenario.

**Why:** Re-running a targeted test against rows left by the previous run caused the fixed “newer” test timestamp to tie or precede persisted data, invalidating the scenario.

**How to apply:** For database-backed ordering tests, seed or reset the stored data and timestamps explicitly before enabling fake time; do not rely only on `beforeAll` inserts.