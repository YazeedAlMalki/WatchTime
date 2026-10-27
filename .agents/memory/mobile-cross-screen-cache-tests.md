---
name: Mobile cross-screen cache tests
description: A reliable way to test inactive season cache invalidation when moving between mobile screens.
---

For cross-screen episode tracking specs, seed season queries as inactive with an infinite stale time, perform the real screen mutation, then mount consumers of those same season queries after navigation and inspect the returned watched flags.

**Why:** In the Expo Jest renderer, the title accordion press handler ran in an integration harness but its local expanded-state update did not commit. The cache-contract approach tests the important cross-screen failure mode without mistaking that renderer behavior for a cache regression. Infinite stale time makes a missing invalidation observable rather than relying on incidental refetches.

**How to apply:** Use a real QueryClient shared across the initiating screen and the detail query consumer, with seeded old title and multiple season responses. Confirm unaffected later episodes remain unwatched. When testing several destinations, mount their consumers together after the initiating screen rather than chaining multiple render/unmount cycles: in this renderer, a third sequential render returned an empty root. For inactive activity feeds, seed an empty query and assert the destination screen refetches the new entry after mutation invalidation. For active feeds, mount both screens together under one provider and await the History tab press; the earlier History-tab state issue is not a general limitation of this renderer.

When mocks wrap account-scoped mutation hooks, forward both `onMutate` and `onSuccess`; the mutation context from `onMutate` is the account identity the success handler uses to decide whether it may invalidate personal queries. Likewise, mocked query hooks must honor a supplied account-scoped query key.

**Why:** Omitting those lifecycle details makes correct account-safe invalidation appear broken in tests, while ignoring caller-supplied keys leaves title data stale after a successful mutation.

**How to apply:** In screen tests that use real React Query mutations, pass the `onMutate` callback result through to the success callback and use the screen's query key override.

Run distinct initiating-screen scenarios in separate Jest files when using the Expo renderer. In this workspace, My Shows mounted as null after an earlier Home scenario in the same test file, even with explicit unmount and cleanup; the same My Shows scenario passed in isolation and in its own file. **Why:** A renderer lifecycle failure can look like a missing query invalidation. **How to apply:** Keep one cross-screen journey per test file rather than depending on consecutive screen journeys within the same Jest module.

For a Home → title → Home journey, rerender distinct route subtrees under the same QueryClientProvider instead of creating three independent render roots. This still unmounts each departing screen while retaining the pending mutation and shared cache. Keep a combined My Shows scenario after other Home journeys if they must share a file.

**Why:** A new render root after the combined My Shows scenario can be empty in the full suite even when the same test passes alone; switching route subtrees avoids the separate-root problem within a journey.

**How to apply:** Assert the departing screen is absent, keep requests deferred until the destination is mounted, and run the whole file to detect order-dependent renderer failures.