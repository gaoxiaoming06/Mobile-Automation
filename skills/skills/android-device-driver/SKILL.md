---
name: android-device-driver
description: Use when implementing Android device discovery, ADB commands, scrcpy preview, input actions, screenshots, metrics, crash/ANR log collection, or Android driver tests in Mobile-Automation.
---

# Android Device Driver

Android MVP driver scope:

- Discover devices through ADB.
- Read model, OS version, resolution, orientation, and authorization state.
- Start preview with scrcpy first.
- Fall back to ADB screenshot polling when scrcpy is unavailable.
- Execute tap, long press, swipe, back, home, recent apps, text input, screenshot, launch app, close app, and clear app data where supported.
- Launch apps through resolved launch activities, filtering debug/helper components and system resolver results before falling back.
- Collect basic CPU, memory, process state, and realtime logcat crash/ANR evidence.
- Provide testable shell execution through dependency injection; do not hide command behavior behind unmockable private methods.

## Boundaries

- Keep Android-specific code inside `platform/packages/android-driver`.
- Expose only the shared driver interface to server and runner.
- Do not let Dashboard call ADB or scrcpy directly.
- Every command returns structured success/failure with error code and raw diagnostic detail.

## Testing

- Use Mock Driver for recorder and runner tests.
- Unit-test command argument construction without a real device.
- Unit-test launch activity resolution, fallback launch, foreground verification, recent apps, and text input paths.
- Real-device tests are smoke tests and should write reports under `docs/test/reports/`.

## Fallbacks

- Preview: scrcpy primary, ADB screenshot polling fallback.
- Text input: ASCII can use scrcpy direct injection; non-ASCII should go through backend Android driver / ADB Keyboard path when available.
- Semantic locator future: Android UIAutomator dump is the first source for `tap_on_element` candidates.
