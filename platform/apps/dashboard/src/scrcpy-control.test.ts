import { describe, expect, it } from "vitest";
import { buildScrcpyControlMessage } from "./scrcpy-control.js";

describe("buildScrcpyControlMessage", () => {
  it("builds direct scrcpy payload for Android realtime preview", () => {
    const message = buildScrcpyControlMessage({
      action: { type: "tap", x: 120, y: 240 },
      platform: "android",
      previewMode: "scrcpy",
      socketOpen: true,
      videoSize: { width: 367.8, height: 800.2 }
    });

    expect(message).toEqual({
      type: "control",
      action: { type: "tap", x: 120, y: 240 },
      videoWidth: 368,
      videoHeight: 800
    });
  });

  it("keeps toolbar actions on the scrcpy control channel", () => {
    const message = buildScrcpyControlMessage({
      action: { type: "back" },
      platform: "android",
      previewMode: "scrcpy",
      socketOpen: true,
      videoSize: { width: 1080, height: 2340 }
    });

    expect(message).toEqual({
      type: "control",
      action: { type: "back" },
      videoWidth: 1080,
      videoHeight: 2340
    });
  });

  it("sends Android recent apps through the scrcpy control channel", () => {
    const message = buildScrcpyControlMessage({
      action: { type: "recent_apps" },
      platform: "android",
      previewMode: "scrcpy",
      socketOpen: true,
      videoSize: { width: 1080, height: 2340 }
    });

    expect(message).toEqual({
      type: "control",
      action: { type: "recent_apps" },
      videoWidth: 1080,
      videoHeight: 2340
    });
  });

  it("sends ASCII Android text input through the scrcpy control channel", () => {
    const message = buildScrcpyControlMessage({
      action: { type: "input_text", text: "hello world" },
      platform: "android",
      previewMode: "scrcpy",
      socketOpen: true,
      videoSize: { width: 1080, height: 2340 }
    });

    expect(message).toEqual({
      type: "control",
      action: { type: "input_text", text: "hello world" },
      videoWidth: 1080,
      videoHeight: 2340
    });
  });

  it("keeps non-ASCII text input on the backend driver path", () => {
    expect(
      buildScrcpyControlMessage({
        action: { type: "input_text", text: "你好啊" },
        platform: "android",
        previewMode: "scrcpy",
        socketOpen: true,
        videoSize: { width: 1080, height: 2340 }
      })
    ).toBeNull();
  });

  it("does not send unsupported or non-realtime actions through scrcpy", () => {
    expect(
      buildScrcpyControlMessage({
        action: { type: "wait", durationMs: 1000 },
        platform: "android",
        previewMode: "scrcpy",
        socketOpen: true,
        videoSize: { width: 1080, height: 2340 }
      })
    ).toBeNull();

    expect(
      buildScrcpyControlMessage({
        action: { type: "tap", x: 10, y: 20 },
        platform: "ios",
        previewMode: "scrcpy",
        socketOpen: true,
        videoSize: { width: 1080, height: 2340 }
      })
    ).toBeNull();

    expect(
      buildScrcpyControlMessage({
        action: { type: "tap", x: 10, y: 20 },
        platform: "android",
        previewMode: "screenshot",
        socketOpen: true,
        videoSize: { width: 1080, height: 2340 }
      })
    ).toBeNull();

    expect(
      buildScrcpyControlMessage({
        action: { type: "tap", x: 10, y: 20 },
        platform: "android",
        previewMode: "scrcpy",
        socketOpen: false,
        videoSize: { width: 1080, height: 2340 }
      })
    ).toBeNull();
  });
});
