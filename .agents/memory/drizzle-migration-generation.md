---
name: Drizzle migration generation
description: Avoid accidentally retaining full-schema migrations when generating after the repository's snapshot metadata is absent.
---

When `lib/db/drizzle/meta` has no baseline snapshots, `drizzle-kit generate` can treat the current schema as new and produce a migration that recreates the whole database instead of an additive change. Inspect generated SQL before keeping it; prefer the project's established additive migration format when there is no trustworthy snapshot baseline.

**Why:** A reviewer-attribution schema change generated a full database rebuild because the repository had only a migration journal and no prior snapshots.

**How to apply:** Before accepting generated migrations, check for prior snapshots and confirm the SQL only contains the intended schema delta.
