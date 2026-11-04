---
name: Admin pagination status locators
description: Browser-test locator guidance for paginated AdminPage screens that also render independent status warnings.
---

When a browser test mounts `AdminPage` with a narrow `window.fetch` mock, unrelated provider-count requests may fail and render another element with `role="status"`. Pagination assertions should target the exact visible page-count text instead of using a page-wide status role locator.

**Why:** Multiple live status messages made generic role locators strict-mode ambiguous even when pagination behavior was correct.

**How to apply:** In admin browser tests, use exact text locators for page number and matching-total assertions; keep role-based locators only when the status region itself is uniquely identified.
