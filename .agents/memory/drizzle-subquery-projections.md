---
name: Drizzle subquery projections
description: How to reuse the schema-derived field selection of an aliased Drizzle subquery.
---

For a Drizzle subquery created from a schema-derived selection, use `subquery._.selectedFields` to project its selected columns under the alias. `getTableColumns()` is typed for `Table` instances and does not accept an aliased subquery.

**Why:** Calling `getTableColumns()` on a subquery fails TypeScript checks and is not supported by the helper's runtime contract.

**How to apply:** When selecting a nested object from an aliased subquery, prefer its existing selected-field map rather than recreating the source table's fields manually.
