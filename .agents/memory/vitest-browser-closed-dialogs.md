---
name: Vitest browser closed dialogs
description: How to assert native dialog closed state in Vitest browser mode
---

Closed native `<dialog>` elements are excluded from accessible-role queries in Vitest browser mode; a negative `toBeVisible()` assertion against a role locator can fail because the locator cannot find the element at all. Vitest's browser `page` also does not expose Playwright's general `locator()` method.

**Why:** Attempts to locate a closed dialog with either a role query or `page.locator()` failed even though the element remained in the DOM.

**How to apply:** Use role and accessible-name locators while a dialog is open, and inspect the DOM element's `open` property when verifying it closed; after navigation unmounts it, verify absence from the document.