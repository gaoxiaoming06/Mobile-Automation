import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const toolRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(toolRoot, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

describe("Harmony screen streamer scaffold", () => {
  it("declares the companion bundle and entry ability expected by the agent", () => {
    expect(read("platform/tools/harmony-screen-streamer/AppScope/app.json5")).toContain(
      '"bundleName": "com.mobileautomation.screenstream"'
    );

    const moduleJson = read("platform/tools/harmony-screen-streamer/entry/src/main/module.json5");
    expect(moduleJson).toContain('"mainElement": "EntryAbility"');
    expect(moduleJson).toContain('"name": "EntryAbility"');
    expect(moduleJson).toContain('"ohos.permission.INTERNET"');

    const ability = read("platform/tools/harmony-screen-streamer/entry/src/main/ets/entryability/EntryAbility.ets");
    expect(ability).toContain("import screenStreamer from 'libscreenstreamer.so'");
    expect(ability).toContain("screenStreamer.start");
    expect(ability).toContain("screenStreamer.stop");
    expect(ability).toContain("onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam)");
    expect(ability).toContain("ensureStreamerStarted('new want')");
  });

  it("links the native AVScreenCapture and encoder pipeline", () => {
    const cmake = read("platform/tools/harmony-screen-streamer/entry/src/main/cpp/CMakeLists.txt");
    expect(cmake).toContain("add_library(screenstreamer SHARED");
    expect(cmake).toContain("libnative_avscreen_capture.so");
    expect(cmake).toContain("libnative_media_venc.so");
    expect(cmake).toContain("libnative_media_core.so");
    expect(cmake).toContain("libace_napi.z.so");
    expect(cmake).toContain("libhilog_ndk.z.so");

    const nativeSource = read("platform/tools/harmony-screen-streamer/entry/src/main/cpp/screen_streamer.cpp");
    expect(nativeSource).toContain("OH_AVScreenCapture_StartScreenCaptureWithSurface");
    expect(nativeSource).toContain("OH_VideoEncoder_GetSurface");
    expect(nativeSource).toContain("#define LOG_DOMAIN 0x4153");
    expect(nativeSource).toContain("OH_MD_KEY_VIDEO_ENCODE_BITRATE_MODE");
    expect(nativeSource).toContain("BITRATE_MODE_CBR");
    expect(nativeSource).toContain("kProtocolVersion");
    expect(nativeSource).toContain("kPacketHeaderSize");
    expect(nativeSource).not.toContain("SetNonBlocking(clientFd)");
    expect(nativeSource).toContain("client send failed; closing client only");
    expect(nativeSource).toContain("SendCachedDecoderState");
    expect(nativeSource).toContain("lastConfigPacket_");
    expect(nativeSource).toContain("lastKeyframePacket_");

    const configureIndex = nativeSource.indexOf("OH_VideoEncoder_Configure");
    const getSurfaceIndex = nativeSource.indexOf("OH_VideoEncoder_GetSurface");
    const registerCallbackIndex = nativeSource.indexOf("OH_VideoEncoder_RegisterCallback");
    const prepareIndex = nativeSource.indexOf("OH_VideoEncoder_Prepare");
    expect(configureIndex).toBeGreaterThan(-1);
    expect(getSurfaceIndex).toBeGreaterThan(configureIndex);
    expect(registerCallbackIndex).toBeGreaterThan(getSurfaceIndex);
    expect(prepareIndex).toBeGreaterThan(registerCallbackIndex);

    const sendAllIndex = nativeSource.indexOf("bool ScreenStreamer::SendAll");
    const closeClientLogIndex = nativeSource.indexOf("client send failed; closing client only");
    const nextMethodIndex = nativeSource.indexOf("void ScreenStreamer::CloseServerSocket");
    expect(sendAllIndex).toBeGreaterThan(-1);
    expect(closeClientLogIndex).toBeGreaterThan(sendAllIndex);
    expect(closeClientLogIndex).toBeLessThan(nextMethodIndex);
    expect(nativeSource.slice(sendAllIndex, nextMethodIndex)).not.toContain("running_.store(false)");

    const runServerIndex = nativeSource.indexOf("void ScreenStreamer::RunServer");
    const startMediaIndex = nativeSource.indexOf("StartMediaPipeline()", runServerIndex);
    const closeClientIndex = nativeSource.indexOf("CloseClientSocket();", startMediaIndex);
    const runServerEndIndex = nativeSource.indexOf("bool ScreenStreamer::StartMediaPipeline", runServerIndex);
    expect(startMediaIndex).toBeGreaterThan(runServerIndex);
    expect(closeClientIndex).toBeGreaterThan(startMediaIndex);
    expect(nativeSource.slice(closeClientIndex - 120, closeClientIndex + 80)).not.toContain("TeardownMediaPipeline");
    expect(nativeSource.slice(runServerIndex, runServerEndIndex)).toContain("kept alive after client disconnect");
  });

  it("exposes build, install, and start commands from the repo root", () => {
    expect(existsSync(resolve(repoRoot, "scripts/harmony-screen-streamer.mjs"))).toBe(true);

    const packageJson = read("package.json");
    expect(packageJson).toContain('"harmony:streamer:build"');
    expect(packageJson).toContain('"harmony:streamer:install"');
    expect(packageJson).toContain('"harmony:streamer:start"');

    const script = read("scripts/harmony-screen-streamer.mjs");
    expect(script).toContain("com.mobileautomation.screenstream");
    expect(script).toContain("EntryAbility");
    expect(script).toContain("assembleHap");
    expect(script).toContain("sign-profile");
    expect(script).toContain("sign-app");
    expect(script).toContain("detectHdcInstallFailure");
    expect(script).toContain("failed to install bundle");
    expect(script).toContain("classin-autoverify");
    expect(script).toContain("withTemporaryClassInAutoVerifySigning");
    expect(script).toContain("cn.eeo.hos.classin.mobile.autoverify");
    expect(script).toContain("Start the device-agent with HARMONY_STREAM_BUNDLE_NAME");
    expect(script).toContain("hdc");
  });
});
