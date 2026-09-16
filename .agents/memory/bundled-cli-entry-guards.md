---
name: Bundled CLI entry guards
description: Prevents imported command modules from executing destructive CLI cleanup inside the API bundle.
---

CLI modules imported by the API must gate their main routine using both direct-entry identity and the expected CLI entry filename. Do not rely only on `import.meta.url === pathToFileURL(process.argv[1]).href`.

**Why:** The server bundler inlines imported modules and gives them the bundle entry URL. A source CLI guard based only on `import.meta.url` therefore matched the API server entry, launched maintenance work at startup, and later closed the shared database pool.

**How to apply:** Keep process shutdown and `pool.end()` in filename-gated CLI-only branches or separate executable entry files. Add a regression using the built server entry filename whenever a CLI module is imported by runtime server code.