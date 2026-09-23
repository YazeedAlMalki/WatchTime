---
name: Clerk browser-test cookies
description: Limits of synthetic Clerk browser sign-ins when verifying root-route session hints
---

Programmatic Clerk sign-in in the browser tester can produce a usable authenticated session without a `__session` cookie. Do not interpret a redirect observed with that login as proof that the `__session` hint path was exercised.

**Why:** A browser pass reached the authenticated dashboard, but its test context reported Clerk client/testing cookies and no `__session`. A signed-in result alone did not establish which hint the initial document could read.

**How to apply:** When changing the public-root optimization, separately test the hint-present loading phase and stale-hint fallback in a focused regression test; use the browser tester for the authenticated user journey and disclose the synthetic-cookie limitation.