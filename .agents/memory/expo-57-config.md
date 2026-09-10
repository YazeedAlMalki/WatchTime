---
name: Expo 57 config compatibility
description: Non-obvious static configuration constraints introduced by Expo SDK 57.
---

For Expo SDK 57 managed apps, configure splash behavior through the `expo-splash-screen` plugin and omit the legacy top-level `expo.splash` object.

**Why:** Expo Doctor validates SDK 57 against a schema that rejects the top-level `splash` property, even when the equivalent plugin configuration is valid and native exports succeed.

**How to apply:** Preserve the existing image, background color, width, and resize mode in the plugin entry when upgrading; remove only the duplicate top-level object.