---
name: Admin browser test isolation
description: Keep unrelated admin queries from contaminating focused browser tests.
---

Browser tests that mount the full admin page can trigger identity-conflict queries even when testing another panel. If a test overrides `window.fetch` for a single endpoint, that unrelated query can fail and add a second alert or crash the page.

**Why:** The page renders multiple independently queried panels at once, so endpoint-specific fetch mocks affect more than the feature under test.

**How to apply:** For tests focused on another admin panel, mock the unrelated identity-conflict hook to return an empty result. Keep the real HTTP hook only when the test exercises that panel.
