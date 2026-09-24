---
name: Concurrent admin merges
description: How to distinguish task regressions from preexisting integration damage after parallel admin feature merges.
---

When unrelated admin changes land close together, verify the parent commit's route and generated-contract integrity before attributing a failing check to the current task. A clean task diff can sit on top of an already incomplete merged admin route or generated client.

**Why:** Parallel admin changes were merged with interleaved route bodies, a truncated test, and stale generated API output. The focused web check passed while the routine API contract check failed for unrelated baseline changes.

**How to apply:** Compare failing files with the task's parent commit and inspect affected route behavior, then regenerate API output from the current contract and run the relevant typecheck and route tests before declaring the integration sound.