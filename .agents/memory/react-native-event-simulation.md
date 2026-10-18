---
name: React Native event simulation
description: Async event calls and disabled nested Pressable simulation differences in React Native Testing Library 14.
---

Await React Native Testing Library 14 fireEvent calls when subsequent assertions depend on their effects. Do not assume fireEvent.press and userEvent.press are interchangeable for disabled nested Pressables.

**Why:** In this environment, fireEvent skipped a disabled mark control and found the enclosing row's navigation handler. userEvent used a direct host press handler and invoked the mark despite the disabled assertion passing. Changing simulators therefore changed which action the test exercised.

**How to apply:** Assert the disabled state independently of request counts. Use awaited fireEvent calls for existing mutation regression harnesses. If testing disabled-control navigation itself, inspect the simulator's handler traversal before treating its result as native-device behavior.
