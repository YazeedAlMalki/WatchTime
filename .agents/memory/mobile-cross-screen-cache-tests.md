---
name: Mobile cross-screen cache tests
description: A reliable way to test inactive season cache invalidation when moving between mobile screens.
---

For cross-screen episode tracking specs, seed season queries as inactive with an infinite stale time, perform the real screen mutation, then mount consumers of those same season queries after navigation and inspect the returned watched flags.

**Why:** In the Expo Jest renderer, the title accordion press handler ran in an integration harness but its local expanded-state update did not commit. The cache-contract approach tests the important cross-screen failure mode without mistaking that renderer behavior for a cache regression. Infinite stale time makes a missing invalidation observable rather than relying on incidental refetches.

**How to apply:** Use a real QueryClient shared across the initiating screen and the detail query consumer, with seeded old title and multiple season responses. Confirm unaffected later episodes remain unwatched. When testing several destinations, mount their consumers together after the initiating screen rather than chaining multiple render/unmount cycles: in this renderer, a third sequential render returned an empty root. For activity feeds, seed an empty inactive query and assert the destination screen refetches the new entry after mutation invalidation; pressing the History tab did not commit local state in this harness.