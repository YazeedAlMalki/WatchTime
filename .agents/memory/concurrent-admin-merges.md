---
name: Concurrent admin merges
description: How to distinguish task regressions from preexisting integration damage after parallel admin feature merges.
---

During conflict resolution, inspect each side's behavior, not just whether the combined file parses. A coherent version may need independent features ported from the other side, while the other side may contain semantically broken route or test code.

**Why:** An overlapping admin merge contained route and test code with undefined values and broken control flow; choosing the coherent side alone also dropped an independent alias-correction edit.

**How to apply:** Compare both conflict stages and their tests, retain the coherent implementation, port independent behavior from the other side, and run focused route, UI, type, and contract checks before continuing the merge. Confirm routes are actively registered at the expected method/path and use matching parameter and body schemas; commented duplicate blocks can leave source valid while requests fail with 404/400. Also run the full shared-router suites and API-app import: an isolated router test can pass while another route prevents app startup.

Do not choose a historical recovery point using a parser check alone. A parse-clean revision can already contain handlers copied into unrelated routes.

**Why:** Several successive historical admin revisions parsed successfully while still containing unrelated database queries and undefined runtime values.

**How to apply:** Check handler semantics and types against the route's contract and tests before reusing historical code.

After concurrent task changes land, inspect the complete edited test block even if Git reports a clean merge. A context-based patch can leave displaced assertions or duplicate declarations that only the project-wide typecheck catches.

**Why:** A startup-test merge preserved each task's apparent intent but duplicated declarations and moved existing assertions; Jest and API-contract validation exposed different parts of the damage.

**How to apply:** Re-read the whole affected test section after a concurrent merge and run the same typecheck used by task validation before marking the work complete.

Completion can reconcile newer main changes before running validation.

**Why:** A passing local test run can precede a changed test tree with displaced assertions or out-of-scope variables.

**How to apply:** If submission reports different test counts or failures than the local run, compare the resulting current files with main and repair the reconciled test scopes rather than treating the failure as flaky.
