---
name: Radix slider accessible labels
description: Accessible naming and current-value metadata for Radix slider controls.
---

For `@radix-ui/react-slider`, the screen-reader control is the thumb with `role="slider"`. Accessible names and value text placed only on the root do not reliably reach that thumb; forward those props to `SliderPrimitive.Thumb`.

**Why:** Assistive technology focuses the thumb, so root-level labels can leave the actual control unnamed or without a human-readable current value.

**How to apply:** When wrapping Radix sliders, expose typed thumb props and verify the rendered slider role's accessible name and value text in a browser accessibility test.
