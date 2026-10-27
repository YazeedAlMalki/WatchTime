---
name: Mood store persistence test scopes
description: Test isolation for the mood-discovery store's persistent guest and account scopes.
---

Mood-discovery persistence tests share a store singleton and mutable account scope across cases. Establish the intended guest or account scope before asserting which AsyncStorage key receives a change.

**Why:** A test that assumed guest storage ran after another test had selected an account, so it wrote to the account-scoped key and appeared not to persist the language preference.

**How to apply:** Before exercising persistence or hydration, clear the mock storage as needed and explicitly enter the scope whose key the test intends to verify.
