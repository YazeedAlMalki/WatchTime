---
name: Expo dev preview hits API cross-origin
description: Expo artifacts run on a separate expo.* dev domain, so the API server needs CORS for it
---

The Expo dev preview is served from `https://$REPLIT_EXPO_DEV_DOMAIN` (an `*.expo.*.replit.dev` origin), not the shared proxy. Browser fetches from the mobile app's web preview to the api-server are therefore cross-origin.

**Why:** First mobile build failed to load any data — all `/api/*` fetches blocked by CORS.

**How to apply:** api-server (`artifacts/api-server/src/app.ts`) has a `cors` allowlist built from `REPLIT_EXPO_DEV_DOMAIN`, `REPLIT_DEV_DOMAIN`, and `REPLIT_DOMAINS`. Requests with no Origin (native apps, curl) pass through. Keep this middleware ahead of routes; extend the allowlist rather than removing it.
