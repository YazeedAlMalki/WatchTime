---
name: Orval/zod codegen quirks
description: Gotchas in the api-spec → api-zod/api-client-react codegen pipeline
---
- Orval emits zod v4 syntax (`zod.int()`), so the codegen script in `lib/api-spec/package.json` rewrites `from 'zod'` → `from 'zod/v4'` in the generated zod file. Keep that sed step if the script is touched.
- An operation with BOTH path and query params makes orval emit duplicate `*Params` exports (TS2308 collision). Design endpoints as path-only or query-only (e.g. safety lookup is `GET /safety?titleId=...`).
- Generated hooks: passing `{ query: { enabled } }` requires also supplying `queryKey` via the exported `getXxxQueryKey()` helper.
**How to apply:** whenever editing `lib/api-spec/openapi.yaml` or its codegen.
