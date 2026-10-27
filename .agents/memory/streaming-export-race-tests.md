---
name: Streaming export race tests
description: Deterministic concurrency testing for HTTP responses that stream database query batches.
---

For streamed exports, coordinate alias/data changes through a real HTTP client: pause response consumption after the first chunk, perform a concurrent write through a separate database connection, then resume and assert the snapshot contract.

**Why:** Attempts to intercept Drizzle transaction/select methods did not reliably hook the live route's query execution. HTTP backpressure gives the test a real synchronization point while the server is streaming.

**How to apply:** Use a local HTTP server and pause/resume the client stream in a route test when a later batch must observe a concurrent change. Keep the fixture large enough to exercise multiple batches and backpressure.

When the mutation must happen exactly after a particular batch, intercept the real response write for that batch's final known row, return `false` without forwarding it, then perform the concurrent database write before forwarding the held row and emitting `drain`. This blocks the route after its query completed and before it can request the next page. For insert tests, choose a sort key that would place the new row on a later page without snapshot isolation.

**Why:** Pausing on the first client chunk does not guarantee which page the server has reached; a write barrier on a known page boundary makes the concurrency ordering deterministic.

**How to apply:** Use this stricter barrier when the requirement names a specific batch boundary, while still running the request through a real local HTTP server and client.
