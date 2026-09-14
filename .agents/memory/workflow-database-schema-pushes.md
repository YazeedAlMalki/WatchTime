---
name: Workflow database schema pushes
description: Covers database endpoint differences between shell checks and managed artifact workflows.
---

Database schema changes must be verified against both the shell/test database and the database endpoint injected into the managed workflow.

**Why:** A schema push from the workspace shell succeeded and integration tests passed, while the running API still failed queries because its managed workflow used a different database endpoint that had not received the schema update.

**How to apply:** After changing Drizzle schema, push normally for shell checks, then confirm the running workflow's database has the same schema without exposing its connection value. Restart the API workflow once and verify a database-backed endpoint through the shared proxy.