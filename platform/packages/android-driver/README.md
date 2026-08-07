# Android Driver

Android-specific implementation behind the shared driver and Device Agent contracts.

Current scope:

- ADB discovery.
- Native scrcpy debug-window control when the optional host `scrcpy` CLI is installed.
- ADB screenshot fallback.
- tap, long press, swipe, back, home, input, screenshot, launch app, close app.
- UIAutomator hierarchy dump and Android semantic action candidates.
- Basic metrics, process/app monitor sampling, logcat crash/ANR/native-crash/process-death evidence, and video recording through Android `screenrecord` or host `scrcpy` fallback.

Browser-embedded realtime preview/control is brokered by the server and Device Agent using the pinned scrcpy server file under `platform/tools`; it is separate from the optional native `scrcpy` debug window.

Notes:

- `launch_app` must use `am start` with a resolved launcher activity or package fallback. Do not use `monkey`; it can inject extra events.
- `input_text` prefers ADB Keyboard (`com.android.adbkeyboard/.AdbIME`) when installed, restores the previous IME after input, then falls back to clipboard paste and finally `adb shell input text`.
