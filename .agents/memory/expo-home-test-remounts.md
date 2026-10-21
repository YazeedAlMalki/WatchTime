---
name: Expo screen test remounts
description: React Native screen test behavior across cleanup and subsequent renders
---

In the Home feed and My Shows test harnesses, a second test rendering the screen after cleaning up the first rendered an empty fragment. The same scenario passed in isolation. In Home, startup animation frames were not scheduled; My Shows reproduces the issue without that startup gate. In title-detail tests, a later mount could contain expected text in `toJSON()` while Testing Library queries failed.

**Why:** Separate screen scenarios can pass alone but fail when run together due to test-renderer remount behavior, rather than application behavior. Changing manual unmounts to awaited cleanup did not resolve the My Shows case. Combining related checks in one mounted screen gives stable coverage without replacing real query lifecycles.

**How to apply:** Prefer one mounted screen for related state transitions, driving real queries or notifying query-mock subscribers. If splitting tests into separate mounts, confirm the cases pass together, not just in isolation. Do not assume an empty subsequent render or failed queries against populated JSON prove an application bug.
