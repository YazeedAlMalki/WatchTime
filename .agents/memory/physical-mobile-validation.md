---
name: Physical mobile validation
description: Environment constraint for recording native iOS and Android startup evidence.
---

Native phone acceptance cannot be completed from the standard workspace container alone; use a connected/current physical phone or an externally provided native device run. The container may expose the Expo web preview and Metro QR output, but it does not provide iOS tooling or Android device tooling by default.

**Why:** Native startup timings and splash transitions can differ from the web preview, especially around font loading, Clerk initialization, and platform splash handling.

**How to apply:** Treat Expo web timing logs as useful diagnostics only. Do not label them as iOS or Android results; record each native platform separately when a physical-device run is available.