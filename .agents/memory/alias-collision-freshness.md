---
name: Alias collision freshness
description: Keep alternate-title collision badges independent from alias-list refresh failures.
---

Alternate-title collision counts must have an authoritative refresh path independent from the paged alias list. A failed alias-list refresh should not hide current counts, while failures of the collision or catalog refresh must keep badges marked stale.

**Why:** Collision counts are calculated from current alias records, but the paged review rows can remain cached after a successful edit. Reusing those row fields as the only badge source can show a wrong count as current.

**How to apply:** When changing alternate-title review refreshes, preserve the separate collision-count lookup and make tests simulate a changed count while the list refresh fails.
