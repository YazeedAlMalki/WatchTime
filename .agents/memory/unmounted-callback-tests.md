---
name: Unmounted callback tests
description: Deterministically testing delayed React Native callbacks after component unmount.
---

When a React Native test manually invokes callbacks captured before unmount, wrap `unmount()` in `act` and await it before invoking them. Otherwise effect cleanup may not yet have run, making the test exercise a still-active closure.

**Why:** A retained startup interaction callback scheduled another frame until the test flushed effect cleanup during unmount.

**How to apply:** Use this for regression tests that retain `InteractionManager`, animation-frame, timer, or other effect-owned callbacks and invoke them after unmount.