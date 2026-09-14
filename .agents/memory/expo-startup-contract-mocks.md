---
name: Expo startup contract mocks
description: Jest-specific guidance for testing module-level Expo splash setup failures.
---

When testing a module-level Expo splash promise rejection, import the layout in `jest.isolateModules` with a local `jest.doMock` that returns the rejected promise. Keep the normal top-level splash mock's methods explicitly promise-returning.

**Why:** The Expo Jest preset and static imports can replace or evaluate splash mocks before a test-configured function is initialized, producing a misleading “method is not a function” failure instead of exercising the rejection path.

**How to apply:** Use the isolated import only for the failure contract; render the already-imported root layout separately to assert navigation remains available.