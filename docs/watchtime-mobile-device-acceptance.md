# WatchTime mobile device acceptance

Use this checklist to separate Replit's managed Expo sign-in from WatchTime app behavior.

## Before testing the app

- In the mobile workflow log, confirm the line says
  `[WatchTime preview] Replit-managed Expo CLI session: READY`.
- Open **Preview on your phone** and follow any managed sign-in steps it shows.
- When WatchTime opens in Expo Go, its development-only **Phone preview checks**
  panel should report both **Expo Go: Ready** and **Expo CLI: Ready**.

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