---
name: Admin sync UI tests
description: Keeping browser tests accurate for mutation-driven sync status.
---

When an admin sync UI renders from a status query, browser tests that mock that query must publish the updated status after simulating a successful mutation.

**Why:** Invalidating a mocked query does not fetch fresh data, so a static mock can leave the UI showing the old run even when the mutation callback succeeded.

**How to apply:** For run-status flows, use a test server with real query behavior or a reactive status fixture that emits the updated completed/running state after the mocked mutation.