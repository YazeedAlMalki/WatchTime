---
name: Streaming export race tests
description: Deterministic concurrency testing for HTTP responses that stream database query batches.
---

For streamed exports, coordinate alias/data changes through a real HTTP client: pause response consumption after the first chunk, perform a concurrent write through a separate database connection, then resume and assert the snapshot contract.

**Why:** Attempts to intercept Drizzle transaction/select methods did not reliably hook the live route's query execution. HTTP backpressure gives the test a real synchronization point while the server is streaming.

**How to apply:** Use a local HTTP server and pause/resume the client stream in a route test when a later batch must observe a concurrent change. Keep the fixture large enough to exercise multiple batches and backpressure.
