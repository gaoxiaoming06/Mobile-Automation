# Android Driver

Android-specific implementation hidden behind the shared driver contract.

MVP:

- ADB discovery.
- scrcpy preview.
- ADB screenshot fallback.
- tap, long press, swipe, back, home, input, screenshot, launch app, close app.
- Basic metrics and logcat evidence.

Notes:

- `launch_app` must use `am start` with a resolved launcher activity or package fallback. Do not use `monkey`; it can inject extra events.
- `input_text` prefers ADB Keyboard (`com.android.adbkeyboard/.AdbIME`) when installed, restores the previous IME after input, then falls back to clipboard paste and finally `adb shell input text`.
