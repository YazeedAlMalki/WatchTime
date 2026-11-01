---
name: Inspectable Expo release bundles
description: Inspect production environment inlining and optimized native JavaScript in Expo static exports.
---

For Expo static-export checks that need to inspect native bundle code, use `NODE_ENV=production`, set the target `EXPO_PUBLIC_*` variables before starting the export, and keep Expo's default minification. Pass `--no-bytecode` to inspect the optimized JavaScript instead of the default Hermes bytecode output. Write exports to a temporary directory and remove them after the check.

**Why:** Default native exports emit Hermes bytecode that is not suitable for simple source assertions; disabling minification would miss production optimizer and dead-code behavior.

**How to apply:** Use this for regression checks on release-time environment inlining or code elimination. Inspect the bundle paths from export metadata for each native platform and keep the application code and font assets unchanged.
