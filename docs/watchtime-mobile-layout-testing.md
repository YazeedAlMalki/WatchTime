# Repeatable mobile layout checks (opt-in)

## Route selected

Use **local Appium with XCUITest (iOS) and UiAutomator2 (Android)** against the
existing WatchTime app in Expo Go or an already available development build.
The runner uses Node's built-in WebDriver HTTP client: no new app dependency,
cloud account, purchased minutes, upload, publishing or credential is needed.
It never installs an app, changes accounts, or presses watch-history actions.

Alternatives evaluated:

| Route | Evidence | Decision |
| --- | --- | --- |
| Expo web / browser screenshots | Browser only | Useful diagnostics, never native evidence |
| Local simulators / emulators | Virtual native devices | Optional diagnostics, never physical evidence |
| Local Appium + connected phones | Physical, with hardware verification | Selected opt-in route |
| Hosted device farms (e.g. BrowserStack / Sauce Labs) | Potentially physical | Not connected/configured: account, cost, app upload and device provenance need user approval first |

This infrastructure **does not complete or replace the outstanding one-off native
acceptance check**. No physical phone was available in the workspace when it was
configured. Unit tests use synthetic data, not device evidence.

## Operator prerequisites

Run the capture command on the computer connected to the phone, using a checkout
of this repository, Node 22+ and pnpm. Prepare Appium and its current
[XCUITest](https://appium.github.io/appium-xcuitest-driver/latest/preparation/real-device-config/)
or [UiAutomator2](https://github.com/appium/appium-uiautomator2-driver#requirements)
driver following the official prerequisites. Do not install or purchase a hosted
service as part of these steps.

- iOS requires a Mac, Xcode, a trusted/unlocked physical iPhone and a working
  WebDriverAgent. Any signing setup is performed by the device owner locally;
  do not paste Apple credentials into this repository or chat.
- Android requires platform-tools (`adb`), a trusted/unlocked USB-debugging phone
  and the UiAutomator2 driver. Keep the screen on. USB, rather than Wi-Fi-only,
  is required for the runner's physical-device verification.
- Start a **local-only** Appium server on `127.0.0.1:4723`. No `adb_shell`
  insecure feature is needed. Local adb verifies Android provenance separately.
- Open WatchTime in Expo Go using the existing managed phone-preview route.
  Complete platform access steps before running. See
  [device acceptance / sign-in blockers](watchtime-mobile-device-acceptance.md).
  A sign-in blocker is not a typography failure. No auth bypass is introduced.
- Use a test account if signed-in labels are needed. Never run against an
  account containing sensitive information: screenshots can show visible data.

## Enable and run

1. Set the **non-secret development variable** `EXPO_PUBLIC_LAYOUT_EVIDENCE=1`
   before starting the existing mobile workflow, then restart it once. This
   enables native metadata and text measurements only in `__DEV__`. Production
   ignores the flag. Remove it and restart when done. It is intentionally not
   enabled in the normal development command.
2. Copy `artifacts/watchtime-mobile/scripts/device-layout/ios.example.json` or
   `android.example.json` to a **local untracked file outside the repository**.
   Replace the UDID locally (do not commit it), use the current Metro URL from
   the phone preview, and choose a real **movie** ID with a long name from Browse.
   Movie detail is required so both Watchlist and Mark watched can be measured.
   Put that ID in both `titleUrl` and `expected.titleId`.
   Expo Go links use `exp://HOST/--/browse` and `exp://HOST/--/title/ID`;
   use `exps:` when the current Expo link requires TLS. Existing development
   builds can use `watchtime-mobile:///browse` and `watchtime-mobile:///title/ID`,
   with their already configured app identifier instead of Expo Go's identifier.
3. Record the expected logical width and actual OS text scale in the config.
   Width is the React Native viewport in **logical units**, not screenshot pixels.
   Android density / display-size settings can change it. The runner compares,
   rather than silently accepts, the requested width and font scale.
4. From the repository root:

   ```sh
   pnpm --filter @workspace/watchtime-mobile test:device-layout
   # Prints help only; no server/device is contacted.
   pnpm --filter @workspace/watchtime-mobile test:device-layout --run /absolute/path/to/local-config.json
   ```

   This creates its own WebDriver session and closes it in a finally block.
   It navigates to Browse, waits for loaded content and stable measurements,
   captures Browse, navigates to the specified movie, captures the top, scrolls
   to the action row without pressing it and captures title detail again.
   If a startup, scroll or capture step fails, the report is blocked/failing,
   not a successful typography check. Where possible it captures the error UI.
   If session cleanup fails, close that session on the local Appium server.

5. Repeat on both iOS and Android at normal and enlarged OS text sizes. Include
   a narrow phone (roughly 360–375 logical units) and your supported large text
   setting. Restore the phone's settings after testing. Each run must state
   its actual width and font scale; no browser viewport is a substitute.
6. `fontState: "loaded"` requires all four Inter weights to be loaded.
   `"fallback"` requires all four to be unloaded and not still loading.
   This runner **observes**, not forces, that state. Use the separately maintained
   fallback-font test mechanism when available; do not label loading or mixed
   font state as a fallback pass.

Use `--diagnostic` only to permit a nonphysical run's automated checks to return
exit code 0. It **cannot** change device classification or create physical proof.
Browser sessions are rejected and continue to use existing browser checks.

## Evidence and interpretation

Files are automatically written to:

```
generated-artifacts/mobile-layout/<physical|simulator|unverified-native|browser>/<ios|android>/<timestamp>/
  report.json
  browse.png
  title-top.png
  title.png
```

The directory is ignored by both Git and deployment packaging. Keep or transfer
it only using an approved private evidence store. The runner does not upload.
Reports exclude device serials, names assigned by owners, tokens, full driver
responses and account data. Screenshots still require privacy review.

`report.json` records model, OS, logical viewport, pixel ratio, OS font scale,
each Inter font's loading state, per-screen measured line bounds, screenshots
and named pass/fail observations. Model/OS must be identified for a passing run.
Requested device names alone never prove hardware:

- iOS: `mobile: deviceInfo` must return `isSimulator: 0` (or `false`).
- Android: the session's UDID must match a trusted `adb devices -l` USB device,
  must not be an emulator serial, and `ro.kernel.qemu` must not be `1`.
- Missing proof is **unverified-native**, never physical. A failed physical
  layout check still stays in the physical bucket; failure is useful evidence.

`status: pass` means **automated measurement checks only**. `visualReview`
remains `required`; `nativeAcceptance` remains `not-performed`.
Automatic checks catch measured line overflow/missing measurements for Browse's
All, TV Shows and Documentaries chips, the full title heading, Watchlist and
Mark watched labels. They also reject mismatched font state, width, font scale,
wrong title, unloaded catalog, and nonnative metadata.

Review the automatically captured screenshots for glyph clipping, parent/view
clipping, overlaps, tap-target visibility, ellipses on action labels and the
horizontal Browse filters. Native `onTextLayout` cannot prove absence of every
rendering defect. Poster names intentionally use two lines; that truncation is
not asserted as a bug. Store review observations alongside the report, for example:

```json
{
  "browse": { "status": "pass", "observation": "Filter labels readable; no clipped glyphs" },
  "title": { "status": "fail", "observation": "Mark watched overlaps lock icon at enlarged text" }
}
```

Do not report a screenshot's presence or a unit-test pass as a visual-review pass.
Do not copy browser or simulator captures into the physical evidence directory.

## Maintaining the route

```sh
pnpm --filter @workspace/watchtime-mobile test:device-layout:unit
pnpm --filter @workspace/watchtime-mobile exec jest --runInBand layout-evidence
```

When moving/changing tested labels, preserve their evidence identifiers or update
the required probe list with the layout change. Other screens are not covered.
No automatic CI device job is enabled: the route is intentionally opt-in and
requires externally available hardware.
