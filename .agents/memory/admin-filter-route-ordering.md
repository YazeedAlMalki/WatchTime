---
name: Admin filter route ordering
description: Keep specialized admin list modes reachable when they share an endpoint with an unfiltered fallback.
---

When adding a filtered review mode to a shared admin list route, ensure it bypasses any generic early-return path before building the ordinary response. Tests should assert mode-specific response fields, not only title names, because a fallthrough can produce plausible titles with incomplete review details.

**Why:** A newly added query mode can be validated and silently ignored if a pre-existing unfiltered branch returns before it.

**How to apply:** For admin content and similar multi-mode list endpoints, check the full branch order and make tests assert the returned mode-specific data.
