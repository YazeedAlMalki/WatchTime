---
name: Provider refresh-rate warnings
description: Eligibility and interpretation rules for accumulated provider refresh success warnings.
---

Only include providers with refresh paths that reliably maintain both attempt and success counters. Require a complete, internally valid counter pair and a minimum sample before signaling a low accumulated rate. Do not couple this warning to the provider's latest status.

**Why:** Legacy and metadata-only health rows can have incomplete or misleading rate fields, while a provider's latest successful refresh does not erase a repeatedly poor history.

**How to apply:** When adding another provider, verify its refresh writer updates both counters before adding it to the eligibility set; derive the warning from those counters and cover a recovered latest status in the API and admin UI tests.
