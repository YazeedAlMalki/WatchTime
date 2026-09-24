---
name: Concurrent admin merges
description: How to distinguish task regressions from preexisting integration damage after parallel admin feature merges.
---

During conflict resolution, inspect each side's behavior, not just whether the combined file parses. A coherent version may need independent features ported from the other side, while the other side may contain semantically broken route or test code.

**Why:** An overlapping admin merge contained route and test code with undefined values and broken control flow; choosing the coherent side alone also dropped an independent alias-correction edit.

**How to apply:** Compare both conflict stages and their tests, retain the coherent implementation, port independent behavior from the other side, and run focused route, UI, type, and contract checks before continuing the merge.