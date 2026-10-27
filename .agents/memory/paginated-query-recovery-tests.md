---
name: Paginated query recovery tests
description: Reliable UI test synchronization for effect-driven pagination fallback after query invalidation.
---
When an invalidated paginated query returns an empty page and an effect steps back through multiple pages, poll with an event-loop yield and allow enough time for the query/effect chain to settle.

**Why:** A test that only polled the rendered state inside one React `act` block could time out on an intermediate empty page before the next query and fallback completed.

**How to apply:** In UI tests for mutation-driven pagination recovery, yield a macrotask on each polling attempt and use a longer timeout for the multi-page recovery assertion.
