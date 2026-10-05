---
name: Catalog worker ownership
description: Why queued-refresh recovery needs separate startup ownership protection and short database leases.
---

Queued-refresh recovery must distinguish a live startup worker from an abandoned record, not just check the provider-work lock.

**Why:** The provider-work lock is acquired after the startup status write. A worker can still be alive while its record remains queued during a slow database write. Local worker tracking alone cannot protect workers in another API process.

**How to apply:** Preserve database-backed ownership protection around the queued-to-running transition and keep recovery from claiming that ownership. Prefer transaction-scoped leases on the connection performing the write; separate clients held throughout a refresh can exhaust the shared pool when concurrent workers each need another connection for updates.
