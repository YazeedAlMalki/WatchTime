---
name: Physical mobile validation
description: Environment constraint for recording physical iOS and Android startup and typography evidence.
---

Native phone acceptance cannot be completed from the standard workspace container alone; use a connected/current physical phone or an externally provided native device run. The container may expose the Expo web preview and Metro QR output, but it does not provide iOS tooling or Android device tooling by default.

**Why:** Native startup timings, splash transitions, and fallback-font metrics can differ from the web preview, especially around font loading, Clerk initialization, and platform splash handling.

**How to apply:** Treat Expo web timing logs and React Native component-prop tests as useful diagnostics only. Do not label them as physical iOS or Android results; record each native platform separately when a physical-device run is available. Restoring browser-testing tools or native-app creation permissions does not itself provide physical-device access.

Recurring device-layout automation and the outstanding one-off native acceptance check are separate deliverables. Adding the infrastructure does not close the acceptance gate.

**Why:** The user explicitly requested ongoing testing infrastructure, not a substitute for the outstanding native acceptance check.

**How to apply:** Preserve this distinction when reporting completion or reviewing evidence. Synthetic driver tests establish runner behavior, not hardware acceptance; a measurement pass still needs screenshot review for clipping that native line metrics cannot detect.