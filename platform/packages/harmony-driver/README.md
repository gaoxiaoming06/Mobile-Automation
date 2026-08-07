# Harmony Driver

HarmonyOS implementation behind the shared driver and Device Agent contracts.

Current scope:

- Device discovery through `hdc list targets`.
- Device metadata from `param get` and screenshot-derived resolution.
- Screenshots through `uitest screenCap`.
- UI hierarchy through `uitest dumpLayout`, normalized into the shared XML hierarchy shape.
- Tap, long press, swipe, back, home, text input, clear text, launch app, close app, screenshot, and clear app data through HDC/uitest/bm/aa commands.
- Foreground bundle detection, installed app version lookup, hilog collection, and unsupported performance/video placeholders.

Dashboard preview currently uses screenshots for HarmonyOS. The Device Agent has an opt-in experimental Harmony screen-stream companion bridge, but it is not the default dashboard path.
