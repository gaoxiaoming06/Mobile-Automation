import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import type { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import {
  AgentHarmonyStreamClient,
  buildHarmonyStreamLaunchPlan,
  findHarmonyScreenShareTapTargets,
  HarmonyH264StreamParser,
  harmonyH264CodecId
} from "./agent-harmony-stream.js";

describe("buildHarmonyStreamLaunchPlan", () => {
  it("prepares hdc forward and app launch commands for the capture companion", () => {
    expect(buildHarmonyStreamLaunchPlan({
      serial: "harmony-1",
      localPort: 42001,
      devicePort: 28282,
      bundleName: "com.mobileautomation.screenstream",
      abilityName: "EntryAbility"
    })).toEqual({
      forwardArgs: ["-t", "harmony-1", "fport", "tcp:42001", "tcp:28282"],
      removeForwardArgs: ["-t", "harmony-1", "fport", "rm", "tcp:42001", "tcp:28282"],
      launchArgs: ["-t", "harmony-1", "shell", "aa", "start", "-b", "com.mobileautomation.screenstream", "-a", "EntryAbility"]
    });
  });
});

describe("AgentHarmonyStreamClient", () => {
  it("removes stale Harmony stream forwards before opening a new stream", async () => {
    const hdcCalls: string[][] = [];
    const socket = new FakeWebSocket();
    const metadata = Buffer.from(JSON.stringify({
      type: "metadata",
      codec: harmonyH264CodecId
    }) + "\n");
    const client = new AgentHarmonyStreamClient({
      autoAuthorizeScreenShare: false,
      bundleName: "cn.eeo.hos.classin.mobile.autoverify",
      connectTimeoutMs: 100
    }, {
      getFreePort: async () => 42001,
      runHdc: async (args) => {
        hdcCalls.push(args);
        if (args.join(" ") === "-t harmony-1 fport ls") {
          return [
            "harmony-1    tcp:41000 tcp:28282    [Forward]",
            "harmony-1    tcp:41001 tcp:12345    [Forward]"
          ].join("\n");
        }
        return "";
      },
      connectTcp: () => {
        const tcp = new EventEmitter() as Socket;
        Object.assign(tcp, { destroy: () => undefined });
        setTimeout(() => tcp.emit("connect"), 0);
        setTimeout(() => tcp.emit("data", metadata), 1);
        setTimeout(() => tcp.emit("close"), 5);
        return tcp;
      }
    });

    await client.attach("harmony-1", socket as unknown as WebSocket);

    expect(hdcCalls).toContainEqual(["-t", "harmony-1", "fport", "ls"]);
    expect(hdcCalls).toContainEqual(["-t", "harmony-1", "fport", "rm", "tcp:41000", "tcp:28282"]);
    expect(hdcCalls).not.toContainEqual(["-t", "harmony-1", "fport", "rm", "tcp:41001", "tcp:12345"]);
  });

  it("uses an already-running companion stream before relaunching the ability", async () => {
    const hdcCalls: string[][] = [];
    const socket = new FakeWebSocket();
    const metadata = Buffer.from(JSON.stringify({
      type: "metadata",
      codec: harmonyH264CodecId,
      width: 720,
      height: 1280
    }) + "\n");
    const client = new AgentHarmonyStreamClient({
      autoAuthorizeScreenShare: false,
      bundleName: "cn.eeo.hos.classin.mobile.autoverify",
      connectTimeoutMs: 100
    }, {
      getFreePort: async () => 42001,
      runHdc: async (args) => {
        hdcCalls.push(args);
        return "";
      },
      connectTcp: () => {
        const tcp = new EventEmitter() as Socket;
        Object.assign(tcp, { destroy: () => undefined });
        setTimeout(() => tcp.emit("connect"), 0);
        setTimeout(() => tcp.emit("data", metadata), 1);
        setTimeout(() => tcp.emit("close"), 5);
        return tcp;
      }
    });

    await client.attach("harmony-1", socket as unknown as WebSocket);

    expect(hdcCalls).not.toContainEqual([
      "-t",
      "harmony-1",
      "shell",
      "aa",
      "start",
      "-b",
      "cn.eeo.hos.classin.mobile.autoverify",
      "-a",
      "EntryAbility"
    ]);
    expect(socket.sentMessages).toContain(JSON.stringify({
      type: "metadata",
      protocolVersion: 1,
      serial: "harmony-1",
      codec: harmonyH264CodecId,
      codecName: "h264",
      width: 720,
      height: 1280
    }));
  });

  it("falls back to the local authorized FlutterProject bundle when the default companion bundle is unavailable", async () => {
    const hdcCalls: string[][] = [];
    const socket = new FakeWebSocket();
    const client = new AgentHarmonyStreamClient({
      connectTimeoutMs: 100
    }, {
      getFreePort: async () => 42001,
      runHdc: async (args) => {
        hdcCalls.push(args);
        if (args.includes("aa") && args.includes("com.mobileautomation.screenstream")) {
          throw new Error("The specified bundle is not found.");
        }
        return "";
      },
      connectTcp: () => {
        const tcp = new EventEmitter() as Socket;
        Object.assign(tcp, { destroy: () => undefined });
        setTimeout(() => tcp.emit("connect"), 0);
        setTimeout(() => tcp.emit("close"), 5);
        return tcp;
      }
    });

    await client.attach("harmony-1", socket as unknown as WebSocket);

    expect(hdcCalls).toContainEqual([
      "-t",
      "harmony-1",
      "shell",
      "aa",
      "start",
      "-b",
      "com.mobileautomation.screenstream",
      "-a",
      "EntryAbility"
    ]);
    expect(hdcCalls).toContainEqual([
      "-t",
      "harmony-1",
      "shell",
      "aa",
      "start",
      "-b",
      "cn.eeo.hos.classin.mobile.autoverify",
      "-a",
      "EntryAbility"
    ]);
    expect(socket.sentMessages).toEqual([]);
  });
});

describe("findHarmonyScreenShareTapTargets", () => {
  it("finds the screen choice and start button in the HarmonyOS screen sharing picker layout", () => {
    const layout = JSON.stringify([{
      attributes: { type: "root", bounds: "[0,0][1256,2760]", text: "" },
      children: [{
        attributes: { type: "Text", text: "选择共享内容", bounds: "[54,229][460,308]", clickable: "false" },
        children: []
      }, {
        attributes: { type: "Column", text: "屏幕, 1", bounds: "[27,411][628,1812]", clickable: "true", id: "album_detail_0" },
        children: []
      }, {
        attributes: { type: "Button", text: "开始共享", bounds: "[54,2571][1202,2706]", clickable: "true" },
        children: []
      }]
    }]);

    expect(findHarmonyScreenShareTapTargets(layout)).toEqual([
      { x: 327, y: 1111 },
      { x: 628, y: 2638 }
    ]);
  });
});

describe("HarmonyH264StreamParser", () => {
  it("parses metadata and length-prefixed packets from the companion TCP stream", () => {
    const parser = new HarmonyH264StreamParser("harmony-1");
    const metadata = Buffer.from(JSON.stringify({
      type: "metadata",
      codec: harmonyH264CodecId,
      width: 1080,
      height: 2400
    }) + "\n");
    const packet = Buffer.alloc(18 + 3);
    packet.writeUInt8(2, 0);
    packet.writeUInt8(1, 1);
    packet.writeBigInt64BE(123n, 2);
    packet.writeUInt32BE(3, 10);
    packet.writeUInt32BE(1, 14);
    packet.set([7, 8, 9], 18);

    const messages = parser.push(Buffer.concat([metadata, packet]));

    expect(messages).toEqual([
      {
        kind: "text",
        data: JSON.stringify({
          type: "metadata",
          protocolVersion: 1,
          serial: "harmony-1",
          codec: harmonyH264CodecId,
          codecName: "h264",
          width: 1080,
          height: 2400
        })
      },
      {
        kind: "binary",
        data: packet
      }
    ]);
  });
});

class FakeWebSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  readonly sentMessages: unknown[] = [];

  send(data: unknown): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }
}
