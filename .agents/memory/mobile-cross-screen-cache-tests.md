---
name: Mobile cross-screen cache tests
description: A reliable way to test inactive season cache invalidation when moving between mobile screens.
---

For cross-screen episode tracking specs, seed season queries as inactive with an infinite stale time, perform the real screen mutation, then mount consumers of those same season queries after navigation and inspect the returned watched flags.

**Why:** In the Expo Jest renderer, the title accordion press handler ran in an integration harness but its local expanded-state update did not commit. The cache-contract approach tests the important cross-screen failure mode without mistaking that renderer behavior for a cache regression. Infinite stale time makes a missing invalidation observable rather than relying on incidental refetches.

**How to apply:** Use a real QueryClient shared across the initiating screen and the detail query consumer, with seeded old title and multiple season responses. Confirm unaffected later episodes remain unwatched. When testing several destinations, mount their consumers together after the initiating screen rather than chaining multiple render/unmount cycles: in this renderer, a third sequential render returned an empty root. For inactive activity feeds, seed an empty query and assert the destination screen refetches the new entry after mutation invalidation. For active feeds, mount both screens together under one provider and await the History tab press; the earlier History-tab state issue is not a general limitation of this renderer.

Run distinct initiating-screen scenarios in separate Jest files when using the Expo renderer. In this workspace, My Shows mounted as null after an earlier Home scenario in the same test file, even with explicit unmount and cleanup; the same My Shows scenario passed in isolation and in its own file. **Why:** A renderer lifecycle failure can look like a missing query invalidation. **How to apply:** Keep one cross-screen journey per test file rather than depending on consecutive screen journeys within the same Jest module.