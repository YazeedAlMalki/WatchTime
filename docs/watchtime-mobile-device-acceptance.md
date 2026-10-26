# WatchTime mobile device acceptance

Use this checklist to separate Replit's managed Expo sign-in from WatchTime app behavior.

## Before testing the app

- In the mobile workflow log, confirm the line says
  `[WatchTime preview] Replit-managed Expo CLI session: READY`.
- Open **Preview on your phone** and follow any managed sign-in steps it shows.
- When WatchTime opens in Expo Go, its development-only **Phone preview checks**
  panel should report both **Expo Go: Ready** and **Expo CLI: Ready**.

## Reproduce splash failures in Expo Go

The development-only **Phone preview checks** panel includes two one-shot
failure checks. From **Preview on your phone**, open WatchTime in Expo Go and
tap **Test setup failure** or **Test cleanup failure**. WatchTime saves that
choice locally and restarts; no source-code edits or workflow changes are
needed.

- **Setup failure:** startup metrics report `splash-prevent-error`, then the
  font-ready recovery path continues. The root navigation should still mount.
- **Cleanup failure:** startup metrics report `splash-hide-error` and the
  recovery error checkpoint. This reproduces a rejected splash hide; the
  navigation mount is covered by the startup contract test.
- Each choice is consumed once. Relaunch normally without selecting a test to
  return to an unforced startup. These controls are absent from production
  builds.
- The cleanup test can leave the native splash visible. Close Expo Go from the
  phone's app switcher, then reopen WatchTime from **Preview on your phone**;
  the one-shot choice has already been consumed, so startup is unforced.

## Check fallback fonts in development

For a fallback-font run, start Metro with `EXPO_PUBLIC_SKIP_INTER_LOADING=1`
in its environment, then cold-start WatchTime in Expo Go. Only the exact value
`1` opts in, and only in development builds. The root font loader skips the Inter
loading hook and exercises the existing font-error recovery path: startup metrics
report `font-error` with source `font-loader-throw`, the splash is released, and
root navigation remains available. No font assets or typography styles change.

Remove the opt-in, restart Metro, and cold-start the app to return to normal
Inter loading. A full app restart is important in both directions: fonts already
registered in a running app cannot be unloaded by this switch. Production builds
ignore the opt-in, even if it is set.

This switch is testing support, not evidence that fallback text fits. Record
layout results separately on physical iOS and Android devices.

## If sign-in blocks the preview

Treat an Expo Go sign-in prompt, a missing managed session, or an Expo CLI
session status other than **READY** as a **Replit platform blocker**. Do not
record it as a WatchTime app failure.

1. Refresh the Replit workspace so its managed Expo session can be renewed.
2. Restart the WatchTime mobile workflow.
3. Reopen **Preview on your phone** and follow its managed sign-in steps if
   they are shown.
4. If the steps are absent or the CLI status remains unavailable, record the
   device run as **Blocked: Replit managed Expo sign-in** and stop acceptance.

Never use a Replit password as an Expo password, sign in to an Expo account
manually, or run Expo/EAS login commands as a workaround.

## Classify the result

- **Pass:** WatchTime opens in Expo Go, both preview checks show ready, and the
  acceptance scenarios complete on the physical device.
- **Blocked — Replit platform:** Expo Go or the managed Expo CLI session cannot
  sign in before WatchTime opens. Capture the workflow status and stop; this is
  not evidence of an app defect.
- **WatchTime app failure:** Expo Go opened WatchTime and the app then shows a
  reproducible crash, broken screen, or failed app behavior. Record the device,
  route, and visible error separately from Expo sign-in status.