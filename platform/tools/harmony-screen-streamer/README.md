# Harmony Screen Streamer

This is the HarmonyOS companion HAP used by the desktop device agent to provide
low-latency preview frames. It captures the device screen with AVScreenCapture,
encodes H.264 through the native video encoder surface path, and serves the
stream on a device-local TCP port that the agent forwards with `hdc fport`.

Defaults:

- Bundle: `com.mobileautomation.screenstream`
- Ability: `EntryAbility`
- Device port: `28282`
- Video: H.264, 720x1280, 15 fps, 1.2 Mbps

Build and install from the repo root:

```sh
pnpm harmony:streamer:install
pnpm harmony:streamer:start
```

On this workstation, `--signing auto` detects the authorized FlutterProject
`autoverifyDebug` signing config at
`/Users/eeo/FlutterProject/flutter_classin/apps/classin/ohos/build-profile.json5`.
That build installs as `cn.eeo.hos.classin.mobile.autoverify`:

```sh
pnpm harmony:streamer:install -- --signing classin-autoverify
pnpm harmony:streamer:start -- --signing classin-autoverify
```

When using that signed bundle through the device-agent/dashboard, either rely on
the agent fallback bundle list or set:

```sh
export HARMONY_STREAM_BUNDLE_NAME=cn.eeo.hos.classin.mobile.autoverify
```

Pass `-- --serial <device-serial>` when more than one Harmony device is
connected.

The first stream connection shows a system screen sharing picker on the device.
Select `屏幕` and tap `开始共享`; after that the companion sends metadata plus
H.264 packets on the device-local TCP port.

By default, the device-agent tries to confirm this picker with HDC `uitest`.
Set `HARMONY_STREAM_AUTO_AUTHORIZE=0` if you want to confirm it manually.
