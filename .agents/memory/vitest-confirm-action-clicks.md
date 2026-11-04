---
name: Vitest confirm-action clicks
description: Reliable click triggering for browser-test actions guarded by a mocked native confirmation.
---

When testing an action guarded by a mocked `window.confirm`, standard `userEvent.click` and locator clicks did not invoke the handler in the browser-test environment, while calling `.click()` on the rendered DOM button did. Assert that both the confirmation and mutation were invoked so the test proves the action ran.

**Why:** The test otherwise appeared to proceed after the click while no confirmation, mutation, or refreshed request occurred.

**How to apply:** For Vitest browser tests that mock native confirmation, use a direct DOM click if the standard click helpers fail to trigger the handler; keep the assertions focused on the resulting user-visible state.
