---
name: Drizzle array params
description: Postgres array parameters break when interpolated into raw sql tags
---
Interpolating a JS array into a drizzle raw sql`` tag expands it into a tuple `($1,$2,...)`, which is invalid for `= ANY(...)`, `&&` overlaps, or `::text[]` casts and fails at runtime (typecheck passes).
**Why:** hit this on stats and similar-titles queries.
**How to apply:** use `inArray(col, arr)` and `arrayOverlaps(col, arr)` from drizzle-orm instead; guard with `arr.length > 0`.
