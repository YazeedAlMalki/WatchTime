---
name: PostgreSQL pool query instrumentation
description: How to count Drizzle queries in integration benchmarks without blocking pool callers.
---

For route-level query counts, instrument the pool's query method rather than replacing its connect method with an async-only wrapper.

**Why:** node-postgres internally calls pool.connect with a callback for pool.query; an async-only connect mock silently drops that callback and hangs requests. This was exposed by a large-library benchmark timing out despite an inexpensive query plan.

**How to apply:** Wrap pool.query, preserve its promise result, and restore the spy after each measured request. If instrumenting connect is unavoidable, preserve both callback and promise overloads.