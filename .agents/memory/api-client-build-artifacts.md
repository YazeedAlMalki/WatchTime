---
name: API client build artifacts
description: Workspace consumers with TypeScript project references can read stale generated declaration output after an API contract change.
---

When an API contract change appears missing only from a consumer package, regenerate the OpenAPI outputs and rebuild the referenced client/zod libraries before changing application code.

**Why:** TypeScript project references may resolve `dist` declarations instead of the current generated source, so a correct schema and generated source can still produce missing-hook or missing-field errors.

**How to apply:** Run the API spec codegen pipeline (which also rebuilds library declarations) before diagnosing mobile or web API-client drift; then run the affected package typecheck.