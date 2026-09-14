---
name: Workspace link and schema recovery
description: Recovery steps when a merged workspace package is absent at runtime and the development database lacks its new tables.
---

After a merge that adds a workspace package or Drizzle table, verify both the package symlink and development schema before debugging application data requests. Reinstall with the frozen lockfile and apply the normal development schema push when needed.

**Why:** The lockfile and source can be correct while stale node_modules links or an unapplied development schema make every data request fail.

**How to apply:** Check package links in each affected artifact, check the live database table list, then restart affected workflows and verify the exact API endpoints used by the client.