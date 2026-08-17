import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  AGENT_PROTOCOL_VERSION,
  type AndroidAppMonitorConfig,
  type AndroidAppMonitorIncident,
  type AndroidAppMonitorSummary,
  defaultAndroidCapabilities,
  defaultHarmonyCapabilities,
  type AgentCommandEnvelope,
  type DeviceActionRequest,
  type DeviceActionResult,
  type DeviceInfo,
  type MetricSample,
  type SemanticDeviceActionRequest,
  type ToolStatus
} from "@mobile-automation/shared";
import { DeviceAgentRuntime, parseDeviceAgentArgs, parseHarmonyStreamEnabled, type AgentLocalDeviceDriver } from "./device-agent.js";

const now = "2026-08-07T09:00:00.000Z";

describe("DeviceAgentRuntime", () => {
  it("registers local devices with the server and sends heartbeat snapshots", async () => {
    const server = new FakeAgentServer();
    const driver = new FakeAgentDriver();
    const runtime = new DeviceAgentRuntime({
      serverUrl: "http://server/",
      agentId: "agent-a",
      version: "0.1.0",
      shared: true,
      maxConcurrentRuns: 2
    }, driver, { fetch: server.fetch });

    await runtime.registerOnce();
    await runtime.heartbeatOnce();

    expect(server.posts).toEqual([
      {
        path: "/api/agents/register",
        body: {
          agentId: "agent-a",
          version: "0.1.0",
          shared: true,
          maxConcurrentRuns: 2,
          currentRunCount: 0,
          toolStatus: [{ name: "adb", available: true, version: "1.0.41" }],
          devices: [expect.objectContaining({ serial: "pixel-1", platform: "android", name: "Pixel 8" })]
        }
      },
      {
        path: "/api/agents/agent-a/heartbeat",
        body: {
          version: "0.1.0",
          shared: true,
          maxConcurrentRuns: 2,
          currentRunCount: 0,
          toolStatus: [{ name: "adb", available: true, version: "1.0.41" }],
          devices: [expect.objectContaining({ serial: "pixel-1", platform: "android", name: "Pixel 8" })]
        }
      }
    ]);
  });

  it("does not advertise Android crash or ANR events until app monitor commands are supported", async () => {
    const server = new FakeAgentServer();
    const driver = new FakeAgentDriver();
    const runtime = new DeviceAgentRuntime({
      serverUrl: "http://server/",
      agentId: "agent-a",
      shared: true
    }, driver, { fetch: server.fetch });

    await runtime.registerOnce();

    expect(server.posts[0]?.body).toEqual(expect.objectContaining({
      devices: [
        expect.objectContaining({
          serial: "pixel-1",
          capabilities: expect.objectContaining({
            events: {
              crash: false,
              anr: false,
              logs: true
            }
          })
        })
      ]
    }));
  });

  it("polls server commands, executes them on the local driver, and posts command results", async () => {
    const server = new FakeAgentServer();
    const driver = new FakeAgentDriver();
    const runtime = new DeviceAgentRuntime({
      serverUrl: "http://server",
      agentId: "agent-a",
      shared: true
    }, driver, { fetch: server.fetch });
    server.commands.push(command("request-info", "getDeviceInfo"));
    server.commands.push(command("request-screen", "screenshot"));
    server.commands.push(command("request-hierarchy", "dumpUiHierarchy"));
    server.commands.push(command("request-action", "performAction", { action: { type: "tap", x: 10, y: 20 } }));
    server.commands.push(command("request-semantic", "performSemanticAction", { action: { type: "tap_on_element", locator: { text: "登录" } } }));
    server.commands.push(command("request-logs", "collectLogs", { lines: 20 }));
    server.commands.push(command("request-metric", "samplePerformance", { runId: "run-1", stepResultId: "step-result-1" }));

    await expect(runtime.pollOnce()).resolves.toBe(7);
    await runtime.drainBackgroundCommands();

    expect(driver.actions).toEqual([{ type: "tap", x: 10, y: 20 }]);
    expect(driver.semanticActions).toEqual([{ type: "tap_on_element", locator: { text: "登录" } }]);
    expect(Object.fromEntries(server.results.map((result) => [result.requestId, result.body]))).toEqual({
      "request-info": { ok: true, result: { device: expect.objectContaining({ serial: "pixel-1", platform: "android" }) } },
      "request-screen": { ok: true, dataBase64: Buffer.from("png").toString("base64"), contentType: "image/png" },
      "request-hierarchy": { ok: true, result: { uiHierarchyXml: "<hierarchy />" } },
      "request-action": { ok: true, result: { driverChannel: "mock" } },
      "request-semantic": { ok: true, result: { driverChannel: "mock" } },
      "request-logs": { ok: true, result: { logs: "log tail" } },
      "request-metric": {
        ok: true,
        result: {
          metric: {
            id: "metric-1",
            runId: "run-1",
            stepResultId: "step-result-1",
            deviceSerial: "pixel-1",
            sampledAt: now
          }
        }
      }
    });
  });

  it("starts, stops, summarizes, and reports incidents for agent app monitor sessions", async () => {
    const server = new FakeAgentServer();
    const driver = new MonitorAgentDriver();
    const runtime = new DeviceAgentRuntime({
      serverUrl: "http://server",
      agentId: "agent-a",
      shared: true
    }, driver, { fetch: server.fetch });
    const config: AndroidAppMonitorConfig = {
      enabled: true,
      packageName: "cn.eeo.classin",
      cpuIntervalMs: 1000
    };
    server.commands.push(command("start-monitor", "startAppMonitor", {
      monitorId: "monitor-1",
      runId: "run-1",
      config
    }));

    await expect(runtime.pollOnce()).resolves.toBe(1);

    expect(driver.monitorStarts).toEqual([{
      serial: "pixel-1",
      runId: "run-1",
      config
    }]);
    expect(server.results).toEqual([{
      requestId: "start-monitor",
      body: {
        ok: true,
        result: {
          monitorId: "monitor-1",
          runId: "run-1",
          summary: expect.objectContaining({
            packageName: "cn.eeo.classin",
            sampleCounts: { cpu: 0, memory: 0, lifecycle: 0 }
          })
        }
      }
    }]);

    await driver.session.emitIncident({
      id: "incident-1",
      type: "java_crash",
      severity: "error",
      occurredAt: now,
      processName: "cn.eeo.classin",
      pid: 1234,
      summary: "FATAL EXCEPTION",
      detail: "java.lang.IllegalStateException",
      artifactIds: []
    });

    expect(server.incidents).toEqual([
      expect.objectContaining({
        type: "appMonitorIncident",
        protocolVersion: AGENT_PROTOCOL_VERSION,
        agentId: "agent-a",
        deviceKey: "agent-a:android:pixel-1",
        monitorId: "monitor-1",
        runId: "run-1",
        incident: expect.objectContaining({ id: "incident-1", type: "java_crash" })
      })
    ]);

    server.commands.push(command("summary-monitor", "getAppMonitorSummary", { monitorId: "monitor-1" }));
    await expect(runtime.pollOnce()).resolves.toBe(1);
    expect(server.results.at(-1)).toEqual({
      requestId: "summary-monitor",
      body: expect.objectContaining({
        ok: true,
        result: expect.objectContaining({
          monitorId: "monitor-1",
          summary: expect.objectContaining({ incidents: [expect.objectContaining({ id: "incident-1" })] })
        })
      })
    });

    server.commands.push(command("stop-monitor", "stopAppMonitor", { monitorId: "monitor-1" }));
    await expect(runtime.pollOnce()).resolves.toBe(1);

    expect(driver.session.stopCount).toBe(1);
    expect(server.results.at(-1)).toEqual({
      requestId: "stop-monitor",
      body: expect.objectContaining({
        ok: true,
        result: expect.objectContaining({
          monitorId: "monitor-1",
          summary: expect.objectContaining({
            endedAt: now,
            incidents: [expect.objectContaining({ id: "incident-1" })]
          })
        })
      })
    });
  });

  it("starts an agent-side scrcpy stream for Android stream commands", async () => {
    const server = new FakeAgentServer();
    const driver = new FakeAgentDriver();
    const scrcpy = new FakeScrcpyStreamer();
    const runtime = new DeviceAgentRuntime({
      serverUrl: "http://server",
      agentId: "agent-a",
      shared: true
    }, driver, { fetch: server.fetch, scrcpy });
    server.commands.push(command("request-stream", "startScrcpyStream", { streamId: "stream-1" }));

    await expect(runtime.pollOnce()).resolves.toBe(1);

    expect(scrcpy.connects).toEqual([{
      serial: "pixel-1",
      url: "ws://server/api/agents/agent-a/scrcpy-streams/stream-1"
    }]);
    expect(server.results).toEqual([{
      requestId: "request-stream",
      body: { ok: true, result: { streamId: "stream-1" } }
    }]);
  });

  it("registers HarmonyOS screen stream capability when the stream bridge supports the device", async () => {
    const server = new FakeAgentServer();
    const driver = new FakeHarmonyAgentDriver();
    const harmonyStream = new FakeHarmonyStreamer();
    const runtime = new DeviceAgentRuntime({
      serverUrl: "http://server",
      agentId: "agent-a",
      shared: true
    }, driver, { fetch: server.fetch, harmonyStream });

    await runtime.registerOnce();

    expect(server.posts[0]?.body).toEqual(expect.objectContaining({
      devices: [
        expect.objectContaining({
          serial: "harmony-1",
          platform: "harmony",
          capabilities: expect.objectContaining({ harmonyScreenStream: true })
        })
      ]
    }));
  });

  it("starts an agent-side HarmonyOS screen stream for Harmony stream commands", async () => {
    const server = new FakeAgentServer();
    const driver = new FakeHarmonyAgentDriver();
    const harmonyStream = new FakeHarmonyStreamer();
    const runtime = new DeviceAgentRuntime({
      serverUrl: "http://server",
      agentId: "agent-a",
      shared: true
    }, driver, { fetch: server.fetch, harmonyStream });
    server.commands.push(command("request-harmony-stream", "startHarmonyStream", {
      streamId: "harmony-stream-1"
    }, {
      deviceKey: "agent-a:harmony:harmony-1",
      platform: "harmony"
    }));

    await expect(runtime.pollOnce()).resolves.toBe(1);

    expect(harmonyStream.connects).toEqual([{
      serial: "harmony-1",
      url: "ws://server/api/agents/agent-a/harmony-streams/harmony-stream-1"
    }]);
    expect(server.results).toEqual([{
      requestId: "request-harmony-stream",
      body: { ok: true, result: { streamId: "harmony-stream-1" } }
    }]);
  });

  it("executes commands pushed over the low-latency command channel", async () => {
    const server = new FakeAgentServer();
    const driver = new FakeAgentDriver();
    const sockets: FakeCommandSocket[] = [];
    const runtime = new DeviceAgentRuntime({
      serverUrl: "http://server",
      agentId: "agent-a",
      shared: true
    }, driver, {
      fetch: server.fetch,
      commandSocketFactory: (url) => {
        const socket = new FakeCommandSocket(url);
        sockets.push(socket);
        return socket;
      }
    });

    runtime.connectCommandChannelOnce();
    sockets[0]?.push(JSON.stringify({
      type: "commands",
      commands: [
        command("pushed-action", "performAction", { action: { type: "tap", x: 10, y: 20 } })
      ]
    }));

    await waitFor(() => server.results.length === 1);

    expect(sockets[0]?.url).toBe("ws://server/api/agents/agent-a/commands/ws");
    expect(driver.actions).toEqual([{ type: "tap", x: 10, y: 20 }]);
    expect(server.results).toEqual([{
      requestId: "pushed-action",
      body: { ok: true, result: { driverChannel: "mock" } }
    }]);
  });

  it("prioritizes control actions over queued screenshots", async () => {
    const server = new FakeAgentServer();
    const driver = new FakeAgentDriver();
    const runtime = new DeviceAgentRuntime({ serverUrl: "http://server", agentId: "agent-a" }, driver, { fetch: server.fetch });
    server.commands.push(command("request-screen", "screenshot"));
    server.commands.push(command("request-action", "performAction", { action: { type: "tap", x: 10, y: 20 } }));

    await expect(runtime.pollOnce()).resolves.toBe(2);
    await runtime.drainBackgroundCommands();

    expect(server.results.map((result) => result.requestId)).toEqual(["request-action", "request-screen"]);
  });

  it("keeps polling control actions while a screenshot is still running", async () => {
    const server = new FakeAgentServer();
    const driver = new SlowScreenshotAgentDriver();
    const runtime = new DeviceAgentRuntime({ serverUrl: "http://server", agentId: "agent-a" }, driver, { fetch: server.fetch });
    server.commands.push(command("request-screen", "screenshot"));

    await expect(Promise.race([runtime.pollOnce(), resolveAfter(20, "blocked")])).resolves.toBe(1);
    expect(server.results).toEqual([]);

    server.commands.push(command("request-action", "performAction", { action: { type: "tap", x: 10, y: 20 } }));

    await expect(runtime.pollOnce()).resolves.toBe(1);

    expect(server.results.map((result) => result.requestId)).toEqual(["request-action"]);

    driver.resolveScreenshot(Buffer.from("png"));
    await runtime.drainBackgroundCommands();

    expect(server.results.map((result) => result.requestId)).toEqual(["request-action", "request-screen"]);
  });

  it("executes control commands for different devices concurrently", async () => {
    const server = new FakeAgentServer();
    const driver = new TwoDeviceSlowActionDriver();
    const runtime = new DeviceAgentRuntime({ serverUrl: "http://server", agentId: "agent-a" }, driver, { fetch: server.fetch });
    server.commands.push(command("slow-action", "performAction", { action: { type: "tap", x: 1, y: 2 } }, {
      deviceKey: "agent-a:android:slow-device",
      platform: "android"
    }));
    server.commands.push(command("fast-action", "performAction", { action: { type: "tap", x: 3, y: 4 } }, {
      deviceKey: "agent-a:android:fast-device",
      platform: "android"
    }));

    const poll = runtime.pollOnce();
    await resolveAfter(20, undefined);

    expect(server.results.map((result) => result.requestId)).toEqual(["fast-action"]);

    driver.resolveSlowAction();
    await expect(poll).resolves.toBe(2);

    expect(server.results.map((result) => result.requestId)).toEqual(["fast-action", "slow-action"]);
  });

  it("posts failed command results without stopping the polling loop", async () => {
    const server = new FakeAgentServer();
    const driver = new FakeAgentDriver();
    const runtime = new DeviceAgentRuntime({ serverUrl: "http://server", agentId: "agent-a" }, driver, { fetch: server.fetch });
    server.commands.push(command("bad-action", "performAction", { action: { type: "tap" } }));
    server.commands.push(command("good-info", "getDeviceInfo"));

    await expect(runtime.pollOnce()).resolves.toBe(2);

    expect(server.results).toEqual([
      {
        requestId: "bad-action",
        body: { ok: false, error: "performAction payload.action is invalid" }
      },
      {
        requestId: "good-info",
        body: { ok: true, result: { device: expect.objectContaining({ serial: "pixel-1" }) } }
      }
    ]);
  });

  it("accepts unlock actions from server commands", async () => {
    const server = new FakeAgentServer();
    const driver = new FakeAgentDriver();
    const runtime = new DeviceAgentRuntime({ serverUrl: "http://server", agentId: "agent-a" }, driver, { fetch: server.fetch });
    server.commands.push(command("unlock-device", "performAction", { action: { type: "unlock" } }));

    await expect(runtime.pollOnce()).resolves.toBe(1);

    expect(driver.actions).toEqual([{ type: "unlock" }]);
    expect(server.results).toEqual([{
      requestId: "unlock-device",
      body: { ok: true, result: { driverChannel: "mock" } }
    }]);
  });

  it("re-registers when heartbeat reports that the server lost the agent session", async () => {
    const server = new FakeAgentServer();
    const driver = new FakeAgentDriver();
    const messages: string[] = [];
    const runtime = new DeviceAgentRuntime({
      serverUrl: "http://server",
      agentId: "agent-a",
      shared: true
    }, driver, { fetch: server.fetch, write: (message) => messages.push(message) });
    server.failNextHeartbeatWithMissingAgent = true;

    await runtime.heartbeatOnce();

    expect(messages).toEqual(["agent session missing; re-registering"]);
    expect(server.posts).toEqual([
      {
        path: "/api/agents/register",
        body: {
          agentId: "agent-a",
          shared: true,
          maxConcurrentRuns: 1,
          currentRunCount: 0,
          toolStatus: [{ name: "adb", available: true, version: "1.0.41" }],
          devices: [expect.objectContaining({ serial: "pixel-1", platform: "android", name: "Pixel 8" })]
        }
      }
    ]);
  });

  it("keeps retrying when the server is temporarily unreachable after startup", async () => {
    const server = new FakeAgentServer();
    const driver = new FakeAgentDriver();
    const messages: string[] = [];
    const controller = new AbortController();
    const runtime = new DeviceAgentRuntime({
      serverUrl: "http://server",
      agentId: "agent-a",
      shared: true,
      pollIntervalMs: 1,
      heartbeatIntervalMs: 1
    }, driver, {
      fetch: server.fetch,
      write: (message) => messages.push(message),
      sleep: async () => controller.abort()
    });
    server.failNextHeartbeatWithNetworkError = true;

    await runtime.start(controller.signal);

    expect(messages).toEqual(["agent registered", "agent sync failed: fetch failed"]);
  });

  it("stops active app monitor sessions when the runtime exits", async () => {
    const server = new FakeAgentServer();
    const driver = new MonitorAgentDriver();
    const controller = new AbortController();
    const runtime = new DeviceAgentRuntime({
      serverUrl: "http://server",
      agentId: "agent-a",
      shared: true,
      pollIntervalMs: 1,
      heartbeatIntervalMs: 1000
    }, driver, {
      fetch: server.fetch,
      commandSocketFactory: () => {
        const socket = new FakeCommandSocket("ws://server/api/agents/agent-a/commands/ws");
        socket.readyState = WebSocket.CLOSED;
        return socket;
      },
      sleep: async () => {
        controller.abort();
      }
    });
    server.commands.push(command("start-monitor", "startAppMonitor", {
      monitorId: "monitor-1",
      runId: "run-1",
      config: { enabled: true, packageName: "cn.eeo.classin" }
    }));

    await runtime.start(controller.signal);

    expect(driver.session.stopCount).toBe(1);
  });
});

describe("parseHarmonyStreamEnabled", () => {
  it("keeps the experimental Harmony stream disabled unless explicitly enabled", () => {
    expect(parseHarmonyStreamEnabled(undefined)).toBe(false);
    expect(parseHarmonyStreamEnabled("")).toBe(false);
    expect(parseHarmonyStreamEnabled("0")).toBe(false);
    expect(parseHarmonyStreamEnabled("false")).toBe(false);
    expect(parseHarmonyStreamEnabled("1")).toBe(true);
    expect(parseHarmonyStreamEnabled("true")).toBe(true);
    expect(parseHarmonyStreamEnabled("yes")).toBe(true);
    expect(parseHarmonyStreamEnabled("on")).toBe(true);
  });
});

describe("parseDeviceAgentArgs", () => {
  it("reads server, sharing, pairing, and loop options from CLI args and env", () => {
    expect(parseDeviceAgentArgs([
      "--server", "http://server/",
      "--agent-id", "agent-cli",
      "--shared",
      "--pairing-code", "123456",
      "--poll-interval-ms", "250",
      "--heartbeat-interval-ms", "1000"
    ], { DEVICE_AGENT_VERSION: "test-version" })).toEqual({
      serverUrl: "http://server",
      agentId: "agent-cli",
      version: "test-version",
      shared: true,
      pairingCode: "123456",
      pollIntervalMs: 250,
      heartbeatIntervalMs: 1000,
      maxConcurrentRuns: 1
    });
  });
});

class FakeAgentServer {
  readonly posts: Array<{ path: string; body: unknown }> = [];
  readonly commands: AgentCommandEnvelope[] = [];
  readonly results: Array<{ requestId: string; body: unknown }> = [];
  readonly incidents: unknown[] = [];
  failNextHeartbeatWithMissingAgent = false;
  failNextHeartbeatWithNetworkError = false;

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const parsed = new URL(input instanceof Request ? input.url : String(input));
    const path = parsed.pathname;
    if (init.method === "POST" && path.endsWith("/heartbeat") && this.failNextHeartbeatWithNetworkError) {
      this.failNextHeartbeatWithNetworkError = false;
      throw new TypeError("fetch failed");
    }
    if (init.method === "POST" && path.endsWith("/heartbeat") && this.failNextHeartbeatWithMissingAgent) {
      this.failNextHeartbeatWithMissingAgent = false;
      return jsonResponse({ error: "Agent not found: agent-a" }, 404);
    }
    if (init.method === "POST" && path.endsWith("/result")) {
      const requestId = path.split("/").at(-2) ?? "";
      const body = JSON.parse(String(init.body ?? "{}"));
      this.results.push({ requestId, body });
      return jsonResponse({ accepted: true });
    }
    if (init.method === "POST" && path.endsWith("/app-monitor-incidents")) {
      this.incidents.push(JSON.parse(String(init.body ?? "{}")));
      return jsonResponse({ accepted: true });
    }
    if (init.method === "POST") {
      this.posts.push({ path, body: JSON.parse(String(init.body ?? "{}")) });
      return jsonResponse({});
    }
    if (init.method === "GET" && path.endsWith("/commands")) {
      return jsonResponse({ commands: this.commands.splice(0) });
    }
    return jsonResponse({ error: `Unhandled ${init.method ?? "GET"} ${path}` }, 404);
  };
}

class FakeAgentDriver implements AgentLocalDeviceDriver {
  readonly actions: DeviceActionRequest[] = [];
  readonly semanticActions: SemanticDeviceActionRequest[] = [];
  private readonly device: DeviceInfo = {
    id: "pixel-1",
    serial: "pixel-1",
    platform: "android",
    name: "Pixel 8",
    status: "online",
    capabilities: defaultAndroidCapabilities(),
    lastSeenAt: now
  };

  async getToolStatus(): Promise<ToolStatus[]> {
    return [{ name: "adb", available: true, version: "1.0.41" }];
  }

  async listDevices(): Promise<DeviceInfo[]> {
    return [this.device];
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    return this.device;
  }

  async screenshot(): Promise<Buffer> {
    return Buffer.from("png");
  }

  async getForegroundApp(): Promise<{ packageName?: string }> {
    return { packageName: "cn.eeo.classin" };
  }

  async dumpUiHierarchy(): Promise<string> {
    return "<hierarchy />";
  }

  async performAction(_serial: string, action: DeviceActionRequest): Promise<DeviceActionResult> {
    this.actions.push(action);
    return { driverChannel: "mock" };
  }

  async performSemanticAction(_serial: string, action: SemanticDeviceActionRequest): Promise<DeviceActionResult> {
    this.semanticActions.push(action);
    return { driverChannel: "mock" };
  }

  async collectLogs(): Promise<string> {
    return "log tail";
  }

  async samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample> {
    return { id: "metric-1", runId, stepResultId, deviceSerial: serial, sampledAt: now };
  }
}

class MonitorAgentDriver extends FakeAgentDriver {
  readonly monitorStarts: Array<{ serial: string; runId: string; config: AndroidAppMonitorConfig }> = [];
  readonly session = new FakeAgentMonitorSession("cn.eeo.classin");

  async startAppMonitor(
    serial: string,
    runId: string,
    config: AndroidAppMonitorConfig,
    callbacks?: { onIncident?: (incident: AndroidAppMonitorIncident) => void | Promise<void> }
  ): Promise<FakeAgentMonitorSession> {
    this.monitorStarts.push({ serial, runId, config });
    this.session.callbacks = callbacks;
    return this.session;
  }
}

class FakeAgentMonitorSession {
  callbacks?: { onIncident?: (incident: AndroidAppMonitorIncident) => void | Promise<void> };
  readonly incidents: AndroidAppMonitorIncident[] = [];
  stopCount = 0;

  constructor(private readonly packageName: string) {}

  async start(): Promise<void> {
    return undefined;
  }

  async stop(): Promise<AndroidAppMonitorSummary> {
    this.stopCount += 1;
    return {
      ...this.getSummary(),
      endedAt: now
    };
  }

  getSummary(): AndroidAppMonitorSummary {
    return {
      packageName: this.packageName,
      startedAt: now,
      processes: [],
      sampleCounts: { cpu: 0, memory: 0, lifecycle: 0 },
      incidents: [...this.incidents],
      artifacts: {}
    };
  }

  async emitIncident(incident: AndroidAppMonitorIncident): Promise<void> {
    this.incidents.push(incident);
    await this.callbacks?.onIncident?.(incident);
  }
}

class SlowScreenshotAgentDriver extends FakeAgentDriver {
  private readonly screenshotResult = deferred<Buffer>();

  override async screenshot(): Promise<Buffer> {
    return this.screenshotResult.promise;
  }

  resolveScreenshot(buffer: Buffer): void {
    this.screenshotResult.resolve(buffer);
  }
}

class TwoDeviceSlowActionDriver extends FakeAgentDriver {
  private readonly slowAction = deferred<void>();

  override async listDevices(): Promise<DeviceInfo[]> {
    return [
      {
        id: "slow-device",
        serial: "slow-device",
        platform: "android",
        name: "Slow Device",
        status: "online",
        capabilities: defaultAndroidCapabilities(),
        lastSeenAt: now
      },
      {
        id: "fast-device",
        serial: "fast-device",
        platform: "android",
        name: "Fast Device",
        status: "online",
        capabilities: defaultAndroidCapabilities(),
        lastSeenAt: now
      }
    ];
  }

  override async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult> {
    if (serial === "slow-device") {
      await this.slowAction.promise;
    }
    return super.performAction(serial, action);
  }

  resolveSlowAction(): void {
    this.slowAction.resolve();
  }
}

class FakeScrcpyStreamer {
  readonly connects: Array<{ serial: string; url: string }> = [];

  async connect(input: { serial: string; url: string }): Promise<void> {
    this.connects.push(input);
  }
}

class FakeHarmonyStreamer {
  readonly connects: Array<{ serial: string; url: string }> = [];

  canStream(device: DeviceInfo): boolean {
    return device.platform === "harmony";
  }

  async connect(input: { serial: string; url: string }): Promise<void> {
    this.connects.push(input);
  }
}

class FakeCommandSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;

  constructor(readonly url: string) {
    super();
  }

  override on(event: "open" | "close" | "error" | "message", listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }

  push(message: string): void {
    this.emit("message", message);
  }
}

class FakeHarmonyAgentDriver extends FakeAgentDriver {
  private readonly harmonyDevice: DeviceInfo = {
    id: "harmony-1",
    serial: "harmony-1",
    platform: "harmony",
    name: "Harmony Phone",
    osVersion: "24",
    status: "online",
    capabilities: defaultHarmonyCapabilities(),
    lastSeenAt: now
  };

  override async listDevices(): Promise<DeviceInfo[]> {
    return [this.harmonyDevice];
  }

  override async getDeviceInfo(): Promise<DeviceInfo> {
    return this.harmonyDevice;
  }
}

function command(
  requestId: string,
  commandName: AgentCommandEnvelope["command"],
  payload?: Record<string, unknown>,
  overrides: Partial<Pick<AgentCommandEnvelope, "deviceKey" | "platform">> = {}
): AgentCommandEnvelope {
  return {
    type: "command",
    protocolVersion: AGENT_PROTOCOL_VERSION,
    requestId,
    agentId: "agent-a",
    deviceKey: overrides.deviceKey ?? "agent-a:android:pixel-1",
    platform: overrides.platform ?? "android",
    timestamp: now,
    command: commandName,
    ...(payload ? { payload } : {})
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload
  } as Response;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) {
      return;
    }
    await resolveAfter(0, undefined);
  }
  throw new Error("Timed out waiting for condition");
}

function resolveAfter<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
