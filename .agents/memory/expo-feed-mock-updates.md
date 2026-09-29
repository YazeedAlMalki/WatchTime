---
name: Expo feed mock updates
description: Why mocked mobile query updates need subscription notifications in render tests
---

When testing changing query responses in the Expo Home screen, use a reactive mock (or the real query client) that notifies subscribers when response state changes, instead of only mutating a module-level variable and rerendering the parent.

**Why:** React Compiler and the React Native test renderer can preserve or skip child renders after a parent rerender. A test can keep showing the old success state despite the mock variable now containing an error; repeated remounts also introduce startup scheduling into an otherwise unrelated assertion.

**How to apply:** Model query changes with a subscription and notify inside `act`, or drive the generated hook through a real React Query client. Keep mocked snapshots referentially stable between notifications.