---
title: HarmonyOS screen stream companion
doc_type: guide
status: draft
created_at: 2026-08-07
updated_at: 2026-08-07
---

# HarmonyOS screen stream companion

HarmonyOS realtime preview is split into two channels:

- Video: a small HarmonyOS HAP captures the screen with AVScreenCapture, encodes H.264, and serves a TCP stream on the device.
- Control: the device-agent keeps using the existing HDC `uitest uiInput` action path for taps, swipes, text, Back, and Home.

The server and dashboard do not call HDC directly. The flow is:

1. Dashboard opens `/api/devices/:deviceKey/harmony-stream/ws`.
2. Server asks the owning device-agent to run `startHarmonyStream`.
3. Device-agent runs `hdc fport tcp:<localPort> tcp:<devicePort>`, launches the configured HAP ability, connects to `127.0.0.1:<localPort>`, and relays stream packets to `/api/agents/:agentId/harmony-streams/:streamId`.
4. Server fans out the single agent stream to every browser preview for that same device.
5. Dashboard decodes H.264 with the existing WebCodecs preview renderer.

## Agent Configuration

Defaults:

```bash
HARMONY_STREAM_BUNDLE_NAME=com.mobileautomation.screenstream
HARMONY_STREAM_ABILITY_NAME=EntryAbility
HARMONY_STREAM_DEVICE_PORT=28282
HARMONY_STREAM_MIN_API=23
HARMONY_STREAM_CONNECT_TIMEOUT_MS=8000
HARMONY_STREAM_AUTO_AUTHORIZE=1
```

For the local authorized FlutterProject signing path, install/start the
companion with:

```bash
pnpm harmony:streamer:install -- --signing classin-autoverify
pnpm harmony:streamer:start -- --signing classin-autoverify
```

That profile signs the HAP as `cn.eeo.hos.classin.mobile.autoverify`, so the
device-agent must be started with:

```bash
export HARMONY_STREAM_BUNDLE_NAME=cn.eeo.hos.classin.mobile.autoverify
```

The device-agent advertises `capabilities.harmonyScreenStream=true` for HarmonyOS devices at or above `HARMONY_STREAM_MIN_API`. If startup fails at runtime, the dashboard reports realtime preview unavailable and returns to screenshot preview.

## Companion TCP Protocol

The companion must send one UTF-8 JSON metadata line, terminated by `\n`, before any binary data:

```json
{"type":"metadata","codec":1748121140,"codecName":"h264","width":1080,"height":2400}
```

After metadata, every binary packet uses the same 18-byte envelope consumed by the Android WebCodecs path:

```text
byte 0      packet type: 1 = H.264 configuration, 2 = frame data
byte 1      keyframe flag: 1 = keyframe, 0 = not keyframe
bytes 2-9   signed big-endian int64 PTS, or -1 when unavailable
bytes 10-13 unsigned big-endian uint32 payload length
bytes 14-17 unsigned big-endian uint32 protocol version, currently 1
bytes 18..  H.264 payload bytes
```

Send SPS/PPS as packet type `1` whenever available, and send encoded frames as packet type `2`. Keyframes should set byte 1 to `1` so the dashboard can recover after packet drops.

## Capture Notes

OpenHarmony documents AVScreenCapture for screen recording, meeting sharing, and live streaming scenarios. The official basic workflow is create, configure audio/video, set callbacks, start capture, process buffers, stop, and release. For this MVP, configure video only, H.264, low bitrate, and no audio.

Phone and tablet picker behavior is supported from API 23 through AVScreenCapture capture strategy. The platform may still show privacy or capture authorization UI; this project does not bypass that prompt.

The first stream connection can show a system picker with `选择共享内容`. Select
`屏幕` and tap `开始共享`; the companion starts sending H.264 packets only after
that authorization completes.

The device-agent best-effort handles this picker by default through HDC
`uitest`: it detects the picker layout and taps `屏幕` / `开始共享`. Set
`HARMONY_STREAM_AUTO_AUTHORIZE=0` to require manual confirmation on the device.

References:

- [OpenHarmony: Using AVScreenCapture in Basic Scenarios](https://github.com/openharmony/docs/blob/master/en/application-dev/media/media/avscreencapture-c-basic-process.md)
- [Huawei HarmonyOS Surface encoder best practice](https://github.com/liasica/harmonyos-skills/blob/master/harmonyos/references/best-practices/bpta-surface-encoder.md)
- [OpenHarmony hdc guide](https://gitee.com/openharmony/docs/blob/master/en/device-dev/subsystems/subsys-toolchain-hdc-guide.md)
