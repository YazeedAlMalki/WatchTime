# Threat Model

## Project Overview

WatchTime is a TV Time-style tracking application for movies, TV shows, anime, and documentaries. Built with React + Vite (frontend), Express (API server), Drizzle ORM + PostgreSQL (data layer), and Clerk for authentication. Users can browse catalog, track watch history, contribute content-safety information, and submit reports. Deployed on Replit (not currently deployed; dev instance).

## Assets

- **User accounts and session tokens** — Clerk-managed authentication. Compromise allows impersonation and access to per-user watch history and personal profile data.
- **User watch history and preferences** — episode/movie tracking, watchlists, personal stats. Private per-user data.
- **Safety contributions** — user-submitted content-safety data pending admin review. Spam or manipulation here pollutes the public safety dataset.
- **Admin interface and capabilities** — contribution moderation, user analytics, integration health. Unauthorized admin access would expose all user emails, PII aggregates, and allow content manipulation.
- **Database connection string and Clerk secret key** — environment secrets granting full DB and auth-service access.

## Trust Boundaries

- **Browser → API (`/api/*`)** — all HTTP requests from unauthenticated or authenticated users. Clerk JWTs are validated server-side by `requireAuth`/`requireAdmin` middleware. Client is fully untrusted.
- **API → PostgreSQL** — Drizzle ORM with parameterized queries throughout. SQL injection surface is minimal.
- **API → Clerk Frontend API (proxy)** — `POST /api/__clerk` proxies Clerk Frontend API requests. The canonical hostname is derived from `x-forwarded-host`/`Host` headers, which are trusted without an allowlist.
- **Public boundary** — `/api/titles`, `/api/safety`, `/api/stats/public` are accessible without authentication. Tracking and contribution endpoints require auth.
- **User / Admin boundary** — `requireAdmin` middleware checks `isAdmin` field provisioned at first-user JIT creation. Admin routes live under `/api/admin`.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/routes/index.ts`, `artifacts/api-server/src/app.ts`
- **Highest-risk areas:** `artifacts/api-server/src/middlewares/auth.ts` (JIT provisioning, admin promotion), `artifacts/api-server/src/routes/admin.ts` (admin-only, `requireAdmin` guard), `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts` (host-header trust)
- **Public surfaces:** `GET /api/titles`, `GET /api/safety`, `GET /api/stats/public`, `POST /api/feedback` (unauthenticated write)
- **Authenticated surfaces:** `/api/tracking/*` (requireAuth), `/api/titles/:id/safety/contributions`, `/api/titles/:id/safety/reports`
- **Admin surfaces:** `/api/admin/*` (requireAdmin — checks isAdmin DB flag after Clerk token verification)
- **Dev-only:** `artifacts/mockup-sandbox` — Canvas/design artifact, not production-reachable

## Threat Categories

### Spoofing

Authentication uses Clerk JWTs validated by `@clerk/express`. The first registered user is JIT-promoted to admin via a database partial-unique-index guard. Concurrent first-signup races are handled. No token forgery concern beyond Clerk's security.

The Clerk proxy middleware (`/api/__clerk`) constructs a `Clerk-Proxy-Url` header from the incoming `x-forwarded-host` value without an allowlist, which could be spoofed if Replit's load balancer does not strip or normalize the header.

### Tampering

All database mutations use parameterized Drizzle ORM queries — SQL injection is not present. Input validation is performed with Zod schemas on body payloads. The `status` query parameter on admin list endpoints accepts unconstrained string values but is passed as a parameterized argument, so no injection is possible.

### Information Disclosure

The admin analytics endpoint returns aggregated user registration counts, device/country breakdowns, and per-user email addresses from feedback. Protected by `requireAdmin`. Search queries submitted by users are stored in `analyticsEventsTable.name` and returned by the admin analytics endpoint — this is by design but means raw user search strings appear in admin views.

The `/api/stats/public` endpoint exposes aggregate user, episode, and movie counts to unauthenticated callers — this is by design.

### Denial of Service

`POST /api/feedback` accepts unauthenticated submissions with no rate limiting. An attacker can flood the feedback table with arbitrary data. `GET /api/stats/public` runs multiple COUNT queries for unauthenticated callers with no rate limiting or caching.

No request body size limits are explicitly configured beyond Express's 100 KB JSON default.

### Elevation of Privilege

Admin promotion is limited to the first registered user via a partial unique index (`users_single_admin_idx`). Subsequent users cannot escalate to admin through the API. The `requireAdmin` middleware enforces this on all `/api/admin/*` routes server-side.

All per-user data mutations (watchlist, watched, episodes) scope DB writes to `req.userId` derived from the validated Clerk JWT — no cross-user write vector is present.
