---
name: Superseded query race tests
description: How to reliably test delayed responses after a TanStack Query key changes
---

When a search changes the query key, do not require the now-unobserved old query to reach `success`; TanStack Query may cancel it while a mocked network response is still pending. Track the held fetch returning, then assert that the active view remains bound to the newest result.

**Why:** Query state is not a reliable signal that an obsolete request's delayed response has completed, so waiting for its success can deadlock a browser regression test.

**How to apply:** Add a completion signal to the mocked fetch promise, release the old response only after the new result is visible, await that signal and a render frame, then recheck the latest rows.

For screens with multiple independently keyed resources, exercise both deferred requests on the same mounted screen and query client. Resolve the currently selected key first, then resolve the prior key and verify the visible data stays current. Avoid test-only toggles that conditionally add a hook across separate test cases; they can make the suite order-dependent.

**Why:** Splitting a multi-resource route race into separate mounts can leave query and hook state interacting with neighboring tests, while a single mounted flow directly verifies the selection boundary.

**How to apply:** When title, safety, recommendations, or similar resources can finish independently, extend the mounted-route race fixture to hold and resolve each resource by its own query key.
