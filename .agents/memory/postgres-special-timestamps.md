---
name: PostgreSQL special timestamps
description: Safely detect PostgreSQL infinity timestamps before driver conversion hides their source value.
---

When malformed or non-finite timestamp metadata must be identified, do not rely only on the decoded JavaScript `Date`. PostgreSQL permits `infinity` for timestamp columns, and the node-postgres/Drizzle timestamp path can turn the raw value into a misleading valid-looking date. Read `timestamp::text` alongside the normal value and classify the raw text; use the normal decoded date for formatting ordinary timestamps.

**Why:** A route-level test with an `infinity` value returned a year-2000 date and incorrectly appeared valid when only the mapped `Date` was inspected.

PostgreSQL finite timestamps can exceed JavaScript's upper `Date` limit, but PostgreSQL's lower finite limit (4713 BC) is well inside JavaScript's supported range. A finite database timestamp below JavaScript's lower limit cannot be constructed in PostgreSQL.

**Why:** Boundary tests must reflect the database type's actual range; attempting to store an earlier-than-JavaScript finite timestamp fails in PostgreSQL before route behavior can be exercised.

**How to apply:** For timestamp diagnostics, retain the raw SQL value until validation. Test PostgreSQL's representable upper overflow and valid lower finite range; do not claim a finite lower JavaScript overflow can be tested through a PostgreSQL timestamp column. Keep public response behavior resilient (for example, serialize unusable values as `null`) and expose diagnostics only in admin response shapes.