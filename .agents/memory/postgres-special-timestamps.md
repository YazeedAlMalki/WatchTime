---
name: PostgreSQL special timestamps
description: Safely detect PostgreSQL infinity timestamps before driver conversion hides their source value.
---

When malformed or non-finite timestamp metadata must be identified, do not rely only on the decoded JavaScript `Date`. PostgreSQL permits `infinity` for timestamp columns, and the node-postgres/Drizzle timestamp path can turn the raw value into a misleading valid-looking date. Read `timestamp::text` alongside the normal value and classify the raw text; use the normal decoded date for formatting ordinary timestamps.

**Why:** A route-level test with an `infinity` value returned a year-2000 date and incorrectly appeared valid when only the mapped `Date` was inspected.

**How to apply:** For timestamp diagnostics, retain the raw SQL text until validation. Keep public response behavior resilient (for example, serialize unusable values as `null`) and expose diagnostics only in admin response shapes.