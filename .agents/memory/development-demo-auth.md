---
name: Development demo auth boundary
description: Security boundary for WatchTime's shared demo credentials and development-only sessions.
---

Shared demo credentials may create a short-lived, server-signed development session for trying protected product flows. The demo identity must always be non-admin, and production must reject both the login route and demo tokens.

**Why:** Navigation-only demo forms looked like successful login but left every protected action unauthenticated. Accepting public demo credentials directly on protected routes would weaken authentication.

**How to apply:** Keep Clerk as the only production authentication system. In development, validate credentials at the login endpoint, issue a short-lived signed token, use a cookie for web and bearer storage for mobile, and map it to a fixed non-admin identity server-side.