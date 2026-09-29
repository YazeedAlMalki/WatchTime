---
name: Proxied rate-limit checks
description: Caveat about client IP identity when manually checking rate limits through Replit's preview proxy.
---

Manually setting `X-Forwarded-For` on a request through the shared preview proxy does not guarantee an isolated rate-limit identity. The API may receive the proxy's local address instead.

**Why:** A live feedback-limit check with a test IP header still incremented the shared loopback address's counter. The test counter was removed afterward.

**How to apply:** For isolated per-IP checks, use direct in-process HTTP tests that set the trusted proxy header, or verify the exact stored key before sending several proxied requests. Clean up only a key known to be created by the check.