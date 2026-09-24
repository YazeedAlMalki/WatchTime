---
name: Orval/zod codegen quirks
description: Gotchas in the api-spec → api-zod/api-client-react codegen pipeline
---
- Orval emits zod v4 syntax (`zod.int()`), so the codegen script in `lib/api-spec/package.json` rewrites `from 'zod'` → `from 'zod/v4'` in the generated zod file. Keep that sed step if the script is touched.
- An operation with BOTH path and query params makes orval emit duplicate `*Params` exports (TS2308 collision). Design endpoints as path-only or query-only (e.g. safety lookup is `GET /safety?titleId=...`).
- Generated hooks: passing `{ query: { enabled } }` requires also supplying `queryKey` via the exported `getXxxQueryKey()` helper.
- Orval appends a wildcard export for generated request types to `api-zod/src/index.ts`; inline operation bodies can then collide with same-named Zod validators. Keep types namespaced and preserve the codegen cleanup step.
- Preserve generated output exactly, including trailing blank lines; the generated-file check treats whitespace-only differences as API contract drift.

**Why:** The codegen check compares generated files against fresh Orval output, so manually trimming generated whitespace makes contract validation fail even when the types are unchanged.

**How to apply:** Whenever editing `lib/api-spec/openapi.yaml` or its codegen, rerun the project codegen command and leave generated files as emitted.
