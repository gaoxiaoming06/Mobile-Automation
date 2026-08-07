---
name: android-device-driver
description: Use when implementing Android device discovery, ADB commands, scrcpy debug-window or browser stream support, input actions, screenshots, UIAutomator hierarchy, semantic actions, metrics, app monitor, crash/ANR/native-crash/process evidence, video recording, or Android driver tests in Mobile-Automation.
---

# Android Device Driver

Android driver scope:

- Discover devices through ADB.
- Read model, OS version, resolution, orientation, and authorization state.
- Support optional native scrcpy debug-window sessions and server/agent browser scrcpy stream startup.
- Fall back to ADB screenshot polling when realtime stream is unavailable.
- Execute tap, long press, swipe, back, home, recent apps, text input, screenshot, launch app, close app, and clear app data where supported.
- Dump UIAutomator hierarchy and execute Android semantic actions where the backend supports them.
- Launch apps through resolved launch activities, filtering debug/helper components and system resolver results before falling back.
- Collect basic CPU, memory, process state, app monitor incidents, process death, and realtime logcat crash/ANR/native-crash evidence.
- Provide testable shell execution through dependency injection; do not hide command behavior behind unmockable private methods.

## Boundaries

- Keep Android-specific code inside `platform/packages/android-driver`.
- Expose only the shared driver and Agent-local driver interfaces to server, runner, and device-agent.
- Do not let Dashboard call ADB or scrcpy directly.
- Every command returns structured success/failure with error code and raw diagnostic detail.

## Testing

- Use Mock Driver for runner, server, report, and dashboard integration tests.
- Unit-test command argument construction without a real device.
- Unit-test launch activity resolution, fallback launch, foreground verification, recent apps, and text input paths.
- Real-device tests are smoke tests and should write reports under `docs/test/reports/`.

## Fallbacks

- Preview: browser scrcpy stream primary, ADB screenshot polling fallback; native scrcpy window is debug-only.
- Text input: ASCII can use scrcpy direct injection; non-ASCII should go through backend Android driver / ADB Keyboard path when available.
- Semantic locator: Android UIAutomator dump is the first source for `tap_on_element` candidates, with OCR/visual fallback in server-side resolution.
