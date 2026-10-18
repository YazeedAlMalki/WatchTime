---
name: Superseded query race tests
description: How to reliably test delayed responses after a TanStack Query key changes
---

When a search changes the query key, do not require the now-unobserved old query to reach `success`; TanStack Query may cancel it while a mocked network response is still pending. Track the held fetch returning, then assert that the active view remains bound to the newest result.

**Why:** Query state is not a reliable signal that an obsolete request's delayed response has completed, so waiting for its success can deadlock a browser regression test.

**How to apply:** Add a completion signal to the mocked fetch promise, release the old response only after the new result is visible, await that signal and a render frame, then recheck the latest rows.
