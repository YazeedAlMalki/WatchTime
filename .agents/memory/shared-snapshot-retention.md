---
name: Shared snapshot retention
description: Why retention caps shared by API workers require database-level serialization.
---

When several API workers enforce a cap on shared database rows, serialize cleanup, capacity checks, eviction, and insertion with a database-level lock inside the same transaction. A transaction alone at the default isolation level does not prevent two workers from observing the same available capacity.

**Why:** Concurrent alternate-title review requests could each see room below the shared cap and collectively insert more than the permitted number of snapshots.

**How to apply:** For similar shared retention limits, use a stable advisory transaction lock key and keep all state changes that decide capacity within its transaction.
