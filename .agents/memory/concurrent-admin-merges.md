---
name: Concurrent admin merges
description: How to distinguish task regressions from preexisting integration damage after parallel admin feature merges.
---

During conflict resolution, inspect each side's behavior, not just whether the combined file parses. A coherent version may need independent features ported from the other side, while the other side may contain semantically broken route or test code.

**Why:** An overlapping admin merge contained route and test code with undefined values and broken control flow; choosing the coherent side alone also dropped an independent alias-correction edit.

**How to apply:** Compare both conflict stages and their tests, retain the coherent implementation, port independent behavior from the other side, and run focused route, UI, type, and contract checks before continuing the merge.

After concurrent task changes land, inspect the complete edited test block even if Git reports a clean merge. A context-based patch can leave displaced assertions or duplicate declarations that only the project-wide typecheck catches.

**Why:** A startup-test merge preserved each task's apparent intent but duplicated declarations and moved existing assertions; Jest and API-contract validation exposed different parts of the damage.

**How to apply:** Re-read the whole affected test section after a concurrent merge and run the same typecheck used by task validation before marking the work complete.