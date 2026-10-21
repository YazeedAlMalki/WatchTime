---
name: Expo screen test remounts
description: React Native screen test behavior across cleanup and subsequent renders
---

In the Home feed and My Shows test harnesses, a second test rendering the screen after cleaning up the first rendered an empty fragment. The same scenario passed in isolation. In Home, startup animation frames were not scheduled; My Shows reproduces the issue without that startup gate. Public title-detail coverage also rendered empty when an extra detail-screen mount followed the existing route scenario, while exercising the failure within the same route render remained stable.

**Why:** Separate screen scenarios can pass alone but fail when run together due to test-renderer remount behavior, rather than application behavior. Changing manual unmounts to awaited cleanup did not resolve the My Shows case. Combining related transitions in one mounted route gives stable coverage without replacing real query lifecycles.

**How to apply:** Prefer one mounted screen or route journey for related state transitions, driving real queries or notifying query-mock subscribers. If splitting tests into separate mounts, confirm the cases pass together, not just in isolation. Do not assume an empty subsequent render proves an application startup bug.