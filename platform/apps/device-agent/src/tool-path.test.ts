import { describe, expect, it } from "vitest";
import { ensureMobileToolPath } from "./tool-path.js";

describe("mobile tool PATH bootstrap", () => {
  it("preserves the existing PATH and appends common macOS mobile tool locations", () => {
    const env = {
      PATH: "/usr/bin:/bin",
      ANDROID_HOME: "/opt/android-sdk"
    };

    ensureMobileToolPath(env, { homeDir: "/Users/alice", platform: "darwin" });

    expect(env.PATH.split(":")).toEqual([
      "/usr/bin",
      "/bin",
      "/opt/android-sdk/platform-tools",
      "/Users/alice/Library/Android/sdk/platform-tools",
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/usr/sbin",
      "/sbin",
      "/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains"
    ]);
  });

  it("does not duplicate existing PATH entries", () => {
    const env = {
      PATH: "/usr/bin:/Users/alice/Library/Android/sdk/platform-tools"
    };

    ensureMobileToolPath(env, { homeDir: "/Users/alice", platform: "darwin" });

    expect(env.PATH.split(":").filter((entry) => entry === "/Users/alice/Library/Android/sdk/platform-tools")).toHaveLength(1);
  });
});
