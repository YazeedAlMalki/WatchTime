---
name: Orval referenced query defaults
description: Preserving parameter-local defaults when an OpenAPI query schema references a shared enum
---

Use an `allOf` wrapper containing the shared schema reference when a query parameter needs its own `default`. Place the default beside `allOf`, not beside a direct `$ref`.

**Why:** Orval generates the enum correctly from a direct `$ref`, but silently drops the parameter's default from the generated Zod query validator. The `allOf` wrapper preserves both the shared enum and the parameter-local default.

**How to apply:** When consolidating inline query enums into shared OpenAPI schemas, compare generated validator defaults before and after codegen. Prefer the wrapper only where a parameter-specific default must survive.