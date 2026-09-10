---
name: Jest Expo tab-layout tests
description: Reliable pattern for testing repeated Expo Router tab configuration under the React 19 Jest Expo renderer.
---

Use awaited React Native Testing Library renders and capture route metadata in lightweight component mocks when testing repeated, configuration-only tab entries.

**Why:** In this project's Jest Expo and React 19 combination, render is asynchronous, aggregate test-ID queries were unavailable at runtime despite type declarations, and the exposed test instance does not provide standard tree traversal helpers.

**How to apply:** For Expo Router layout contract tests, mock the navigator components, record each rendered route and label, and compare the ordered capture arrays. Keep normal single-element queries for confirming which branch rendered.