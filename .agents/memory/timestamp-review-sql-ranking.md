---
name: Timestamp-review SQL ranking
description: Keep database-side malformed-rating filtering equivalent to shared regional rating selection.
---

Database-side preselection must choose the same rating as the application-side resolver, including timestamp precision, malformed-value handling, collation, and deterministic tie-breaks.

**Why:** The filtered query decides whether a title belongs on a page before full content is loaded. A mismatch with the shared resolver can hide a malformed selected rating or include one that is not selected.

**How to apply:** Treat changes to either selection stage as changes to both; verify parity rather than optimizing either stage in isolation.
