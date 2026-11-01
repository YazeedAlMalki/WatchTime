---
name: Expo dev preview hits API cross-origin
description: Expo artifacts run on a separate expo.* dev domain, so the API server needs CORS for it
---

The Expo dev preview is served from `https://$REPLIT_EXPO_DEV_DOMAIN/` (an `*.expo.*.replit.dev` origin), not the shared proxy. Use the Expo host root for mobile preview checks; the artifact's `/mobile/` path on the shared web host is not the Expo app. Browser fetches from the mobile app's web preview to the api-server are therefore cross-origin.

**Why:** First mobile build failed to load any data — all `/api/*` fetches blocked by CORS.

**How to apply:** api-server (`artifacts/api-server/src/app.ts`) has a `cors` allowlist built from `REPLIT_EXPO_DEV_DOMAIN`, `REPLIT_DEV_DOMAIN`, and `REPLIT_DOMAINS`. Requests with no Origin (native apps, curl) pass through. Keep this middleware ahead of routes; extend the allowlist rather than removing it.

Metro can report that it started while the Expo page still fails to load: a missing workspace package link makes the bundle endpoint return an import-resolution error. Check the bundle response on the Expo host before trusting a blank-page screenshot or an apparently healthy Metro workflow.

**Why:** The mobile preview returned HTTP 500 for its JavaScript bundle because `expo-network` was declared and locked but absent from the installed workspace links.

**How to apply:** When the bundle error names a declared package, restore the workspace install from the existing lockfile and restart the Expo workflow, then confirm the bundle responds successfully before browser verification.
