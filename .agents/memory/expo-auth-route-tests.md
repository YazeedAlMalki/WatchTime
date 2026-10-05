---
name: Expo auth route tests
description: Testing navigation across title and development auth screens in the mobile test environment.
---

For mobile auth navigation, verify the source screen's destination, the auth screen's successful return, and the destination screen's state with separately rendered tests. Keep the same title identifier across those contracts.

**Why:** Reusing a React Native Testing Library render instance to swap from a title screen to an auth screen left the controlled auth inputs unchanged after events in this test environment; unmounting and starting a second render in the same test returned an empty tree. Isolated tests remained reliable.

**How to apply:** When checking a cross-screen Expo Router journey without a running navigation host, keep screen-specific tests independent and assert the complete handoff (route and parameters) at each boundary. Do not claim this replaces a physical-device navigation test.

React Native Testing Library 14's async `fireEvent.press` waits for the handler's returned promise; do not await it before resolving a deliberately deferred request in a test.

**Why:** A recovery test that awaited the press before resolving its mocked activation request timed out even though the screen was behaving correctly. Host nodes returned by test-ID queries also do not necessarily expose the composite Pressable's `onPress`.

**How to apply:** Use immediately settling mocks for outcome tests. For pending-state tests, arrange event dispatch and deferred completion together rather than awaiting dispatch first.