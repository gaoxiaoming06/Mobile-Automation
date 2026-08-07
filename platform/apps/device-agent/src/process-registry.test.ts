import { describe, expect, it } from "vitest";
import { ProcessRegistry } from "./process-registry.js";

const now = "2026-08-07T10:00:00.000Z";

describe("ProcessRegistry", () => {
  it("stops and removes resources for one device without touching other devices", async () => {
    const stopped: string[] = [];
    const registry = new ProcessRegistry({ now: () => now });
    registry.register({ id: "scrcpy-a", deviceKey: "agent-a:android:a", kind: "screen_stream", stop: async () => { stopped.push("scrcpy-a"); } });
    registry.register({ id: "hilog-a", deviceKey: "agent-a:android:a", kind: "log_stream", stop: async () => { stopped.push("hilog-a"); } });
    registry.register({ id: "scrcpy-b", deviceKey: "agent-a:android:b", kind: "screen_stream", stop: async () => { stopped.push("scrcpy-b"); } });

    await registry.stopForDevice("agent-a:android:a");

    expect(stopped).toEqual(["scrcpy-a", "hilog-a"]);
    expect(registry.list()).toEqual([
      {
        id: "scrcpy-b",
        deviceKey: "agent-a:android:b",
        kind: "screen_stream",
        startedAt: now
      }
    ]);
  });

  it("stops every registered resource exactly once", async () => {
    const stopped: string[] = [];
    const registry = new ProcessRegistry({ now: () => now });
    registry.register({ id: "wda-1", deviceKey: "agent-a:ios:1", kind: "wda", stop: async () => { stopped.push("wda-1"); } });
    registry.register({ id: "recorder-1", deviceKey: "agent-a:android:1", kind: "recording", stop: async () => { stopped.push("recorder-1"); } });

    await registry.stopAll();
    await registry.stopAll();

    expect(stopped).toEqual(["wda-1", "recorder-1"]);
    expect(registry.list()).toEqual([]);
  });

  it("stops the previous resource when registering the same id again", async () => {
    const stopped: string[] = [];
    const registry = new ProcessRegistry({ now: () => now });
    registry.register({ id: "stream-1", deviceKey: "agent-a:android:1", kind: "screen_stream", stop: async () => { stopped.push("old"); } });

    await registry.register({ id: "stream-1", deviceKey: "agent-a:android:1", kind: "screen_stream", stop: async () => { stopped.push("new"); } });
    await registry.stopAll();

    expect(stopped).toEqual(["old", "new"]);
  });
});
