---
name: Expo Home test remounts
description: React Native Home feed test behavior across cleanup and second renders
---

In the Home feed test harness, a second test rendering the screen after cleaning up the first rendered an empty fragment; startup animation frames were not scheduled. The same scenario passed in isolation.

**Why:** Split first-load and background-refresh cases failed only when run together; the second render had zero queued startup frames, despite the first passing. Combining transitions in one mounted screen gave stable coverage without bypassing the real startup gate.

**How to apply:** When testing Home feed transitions, notify the existing query mock subscribers while keeping the screen mounted. If splitting tests into separate mounts, first confirm the startup frame scheduling and renderer cleanup work across tests.