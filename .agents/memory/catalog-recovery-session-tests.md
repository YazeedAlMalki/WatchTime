---
name: PostgreSQL recovery session tests
description: How to simulate a checked-out advisory-lock session disconnect without noisy node-postgres errors.
---

In tests that need to prove a session-level advisory lock is released on disconnect, close the lock-owning checked-out client with `client.end()` rather than terminating it with `pg_terminate_backend`.

**Why:** Terminating an active checked-out node-postgres client can emit an asynchronous connection error outside the awaited query, even when the failed query is caught. Closing the client directly cleanly disconnects the session and lets PostgreSQL release the lock without an unhandled test error.

**How to apply:** Hold recovery after it acquires the catalog lock, end the owning client, then run recovery in a fresh module context against the same database and an independent pool.
