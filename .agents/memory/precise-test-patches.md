---
name: Precise test patches
description: Avoid applying broad patches to repeated or similarly named tests.
---

When editing test files with repeated or similarly named blocks, anchor changes with enough surrounding lines to identify the intended occurrence. Review adjacent test names and the complete diff immediately afterward.

**Why:** A patch anchored only to a test name can match the wrong block and silently move, duplicate, or remove unrelated coverage.

**How to apply:** Prefer small, uniquely scoped hunks; after patching repeated tests, inspect the full diff before running validations.