---
name: React Query retry test timers
description: Prevent lingering garbage-collection timers in mobile screen tests that retry a failed mutation.
---

Use `gcTime: Infinity` for real React Query clients in screen tests that deliberately fail and retry mutations, and still unmount and clear the client afterward.

**Why:** Retrying replaces the observer's previous mutation and can schedule a garbage-collection timer for that failed mutation. Passing assertions and final client cleanup did not prevent Jest from staying alive; detecting open handles did not identify the timer. Infinite cache lifetimes removed the test-process hang without forcing exit.

**How to apply:** Set the test client's query and mutation cache lifetimes explicitly when using real React Query state transitions. Do not change production cache lifetimes to solve test teardown.
