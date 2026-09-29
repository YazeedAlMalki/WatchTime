---
name: Targeted API Vitest runs
description: How to run one API server test file without triggering the full suite.
---

Run an individual API server test file with `pnpm --filter @workspace/api-server exec vitest run <path>`. Appending `-- <path>` to the package's `test` script may still run the entire suite instead of selecting that file.

**Why:** The script argument separator was interpreted by Vitest in a way that did not filter the requested file, leading to unrelated test failures and long-running integration cases.

**How to apply:** Use direct `vitest run <path>` execution when verifying a focused API change; use the package test script for the full suite.