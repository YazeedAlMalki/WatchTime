---
name: Expo startup contract mocks
description: Jest-specific guidance for testing module-level Expo splash setup failures.
---

To test a module-level Expo splash failure after the layout has already been imported, configure a fresh `jest.doMock` for `expo-splash-screen`, map `react` back to the test's existing React singleton, call `jest.resetModules()`, then require the layout again.

**Why:** `jest.isolateModules()` did not reliably replace the already-evaluated top-level splash mock in this test suite. Resetting modules re-runs the module-level splash call; preserving the React singleton avoids a duplicate-React hook failure when the existing renderer is used.

**How to apply:** Use this reset only around module-load failure contracts. Keep the normal splash mock's methods explicitly promise-returning, and render the previously imported root layout to assert navigation remains available.

Keep stateful Home feed failure/recovery scenarios in a focused test file rather than extending the shared startup-contract mock state.

**Why:** Mutable query mocks used for loading → error → recovery can leak the signed-out branch into later remount tests even when cleanup runs, creating order-dependent failures.

**How to apply:** Give outage/retry lifecycle tests their own module mocks; keep startup-contract tests focused on auth, splash, and first-frame gating.