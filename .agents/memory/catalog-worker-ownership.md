---
name: Catalog worker ownership
description: Why queued-refresh recovery needs separate startup ownership protection and short database leases.
---

Queued-refresh recovery must distinguish a live startup worker from an abandoned record, not just check the provider-work lock.

**Why:** The provider-work lock is acquired after the startup status write. A worker can still be alive while its record remains queued during a slow database write. Local worker tracking alone cannot protect workers in another API process.

**How to apply:** Preserve database-backed ownership protection around the queued-to-running transition and keep recovery from claiming that ownership. Prefer transaction-scoped leases on the connection performing the write; separate clients held throughout a refresh can exhaust the shared pool when concurrent workers each need another connection for updates.

When a Vitest test uses `vi.resetModules()` to model a second refresh module, pass the statically imported database module namespace into `vi.doMock`. A fresh dynamic import after an earlier reset can create a different database client object, so spies on the test module's client won't intercept the isolated module's transactions.

**Why:** A recovery race test passed alone but bypassed the transaction spy in the full test file because an earlier test had reset the module cache; the second client reached the same database but was not the same object.

**How to apply:** In cross-module refresh tests, preserve independent module-local ownership state while injecting the exact shared database module instance that the test harness uses.
