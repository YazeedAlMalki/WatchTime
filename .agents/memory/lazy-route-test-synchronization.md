---
name: Lazy-route test synchronization
description: Why lazy-route regression tests must not depend on arbitrary short polling
---

For cold-process tests of React lazy routes, assert the immediate loading state first, then explicitly await the lazy module import inside React's `act` before checking the resolved UI. A short timer-based wait can pass locally when transforms are warm yet fail consistently in cold validation.

**Why:** A session-loading regression test passed locally but review's cold runs exhausted its polling window before the authenticated bundle mounted.

**How to apply:** Use a deterministic import boundary for tests that need to observe both Suspense fallback and the post-load route; do not use a small fixed polling duration as a proxy for module readiness.