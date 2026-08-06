import { describe, expect, it } from "vitest";
import { MobileAutomationMcpAdapter } from "./index.js";

const sourceYaml = `
version: 1
kind: case
purpose: business
name: 打开班级
app: { id: classin }
steps:
  - id: open-class
    role: business
    tap:
      target: { text: 班级四十二号, match: exact }
`.trim();

describe("ScriptFlow MCP REST adapter", () => {
  it("uses IPv4 loopback as the default REST endpoint", async () => {
    let requestedUrl = "";
    const adapter = new MobileAutomationMcpAdapter({
      fetch: (async (url) => {
        requestedUrl = String(url);
        return new Response(JSON.stringify({ devices: [] }));
      }) as typeof fetch
    });

    await expect(adapter.listDevices()).resolves.toEqual([]);
    expect(requestedUrl).toBe("http://127.0.0.1:4010/api/devices");
  });

  it("reports the REST endpoint when a backend fetch fails", async () => {
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://127.0.0.1:4010",
      fetch: (async () => {
        const error = new TypeError("fetch failed");
        Object.defineProperty(error, "cause", {
          value: new Error("connect ECONNREFUSED 127.0.0.1:4010")
        });
        throw error;
      }) as typeof fetch
    });

    await expect(adapter.listDevices()).rejects.toThrow(
      "Failed to reach Mobile Automation REST at http://127.0.0.1:4010/api/devices: fetch failed; connect ECONNREFUSED 127.0.0.1:4010"
    );
  });

  it("queries page identities without graph edges", async () => {
    const requests: string[] = [];
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "GET /api/page-assets": {
          libraries: [{ appId: "cn.eeo.classin", name: "ClassIn", platformScope: "android", activeVersion: { id: "version-1" } }]
        },
        "GET /api/page-assets/version-1/assets": {
          assets: {
            pageAssets: [{ id: "page-home", key: "home", name: "主页", identityTexts: ["主页", "全部班级"], elementCount: 2 }]
          }
        }
      })
    });

    await expect(adapter.listApps()).resolves.toEqual([
      { appId: "cn.eeo.classin", name: "ClassIn", platformScope: "android", activeVersionId: "version-1" }
    ]);
    await expect(adapter.getPageAsset({ appId: "cn.eeo.classin", page: "home", platform: "android" })).resolves.toEqual(
      expect.objectContaining({ id: "page-home", name: "主页", identityTexts: ["主页", "全部班级"] })
    );
    expect(requests).toEqual([
      "GET /api/page-assets",
      "GET /api/page-assets",
      "GET /api/page-assets/version-1/assets"
    ]);
  });

  it("generates and runs ScriptFlow through the new endpoints", async () => {
    const requests: string[] = [];
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "POST /api/script-flow-drafts/generate": { draft: { status: "ready", sourceYaml: "version: 1" } },
        "GET /api/script-flows/flow-1": { flow: { id: "flow-1", version: 3 } },
        "POST /api/script-flows/flow-1/preview": { planDigest: "a".repeat(64), plan: { steps: [] }, dependencies: [] },
        "GET /api/devices": { devices: [device("device-1", "android", "online")] },
        "POST /api/script-flows/flow-1/runs": {
          run: {
            id: "run-1",
            status: "running",
            sourceSnapshot: { kind: "script_flow" },
            stepResults: [],
            artifacts: []
          }
        },
        "GET /api/runs/run-1": {
          run: {
            id: "run-1",
            status: "failed",
            sourceSnapshot: { kind: "script_flow" },
            reportHtmlPath: "runs/run-1/report.html",
            stepResults: [{ stepId: "step-2", status: "failed", errorMessage: "页面未识别" }],
            artifacts: [{ id: "shot-1", type: "screenshot", name: "failed.png", path: "failed.png", url: "/failed.png", createdAt: "" }]
          }
        }
      })
    });

    await expect(adapter.generateScriptFlow({ prompt: "打开主页", appId: "cn.eeo.classin", platform: "android" })).resolves.toEqual(
      { status: "ready", sourceYaml: "version: 1" }
    );
    await expect(adapter.previewScriptFlow({ flowId: "flow-1", expectedVersion: 3 })).resolves.toEqual(
      expect.objectContaining({ planDigest: "a".repeat(64) })
    );
    await expect(adapter.runScriptFlow({ flowId: "flow-1", expectedVersion: 3, planDigest: "a".repeat(64), deviceSerial: "device-1" })).resolves.toEqual(
      expect.objectContaining({ runId: "run-1", status: "running" })
    );
    await expect(adapter.getRun({ runId: "run-1" })).resolves.toEqual(
      expect.objectContaining({
        status: "failed",
        reportUrl: "http://server.test/api/reports/run-1/html",
        failedSteps: [{ stepId: "step-2", message: "页面未识别" }]
      })
    );
    expect(requests).toEqual([
      "POST /api/script-flow-drafts/generate",
      "POST /api/script-flows/flow-1/preview",
      "GET /api/devices",
      "POST /api/script-flows/flow-1/runs",
      "GET /api/runs/run-1"
    ]);
  });

  it("exposes a ScriptFlow authoring contract with separate script and device platforms", () => {
    const adapter = new MobileAutomationMcpAdapter();

    expect(adapter.getScriptFlowAuthoringContract({ scriptPlatform: "harmony" })).toMatchObject({
      version: 1,
      scriptPlatforms: ["android", "ios", "harmony", "flutter", "mobile"],
      devicePlatforms: ["android", "ios", "harmony"],
      targetTypes: ["text", "icon", "visual", "control"],
      unsupportedTargets: expect.arrayContaining(["semantic", "coordinate", "resourceId"])
    });
  });

  it("validates connected devices before execution", async () => {
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch([], {
        "GET /api/devices": {
          devices: [
            device("android-1", "android", "online"),
            device("harmony-1", "harmony", "online"),
            device("ios-1", "ios", "offline")
          ]
        }
      })
    });

    await expect(adapter.validateDevice({ devicePlatform: "harmony" })).resolves.toMatchObject({
      ok: true,
      selectedDevice: { serial: "harmony-1", platform: "harmony" }
    });
    await expect(adapter.validateDevice({ devicePlatform: "ios" })).resolves.toMatchObject({
      ok: false,
      error: { code: "DEVICE_NOT_CONNECTED", devicePlatform: "ios" }
    });
    await expect(adapter.validateDevice({ devicePlatform: "harmony", deviceSerial: "android-1" })).resolves.toMatchObject({
      ok: false,
      error: { code: "DEVICE_PLATFORM_MISMATCH", devicePlatform: "harmony", requestedDeviceSerial: "android-1" }
    });
    await expect(adapter.validateDevice({ devicePlatform: "android", deviceSerial: "ios-1" })).resolves.toMatchObject({
      ok: false,
      error: { code: "DEVICE_PLATFORM_MISMATCH" }
    });
    await expect(adapter.validateDevice({ devicePlatform: "flutter" as never })).resolves.toMatchObject({
      ok: false,
      error: { code: "PLATFORM_NOT_SUPPORTED_BY_RUNTIME" }
    });
  });

  it("requires a device selector when multiple compatible devices are online", async () => {
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch([], {
        "GET /api/devices": {
          devices: [
            device("android-1", "android", "online"),
            device("android-2", "android", "online")
          ]
        }
      })
    });

    await expect(adapter.validateDevice({ devicePlatform: "android" })).resolves.toMatchObject({
      ok: false,
      error: { code: "DEVICE_SELECTION_REQUIRED", availableDevices: [{ serial: "android-1" }, { serial: "android-2" }] }
    });
  });

  it("preflights screen assist generation by device serial", async () => {
    const requests: string[] = [];
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "GET /api/devices": { devices: [device("ios-1", "ios", "offline")] }
      })
    });

    await expect(adapter.generateScriptFlowDraft({
      prompt: "根据当前页面填写搜索框",
      appId: "classin",
      scriptPlatform: "ios",
      screenAssist: { mode: "current", deviceSerial: "ios-1" }
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "DEVICE_OFFLINE", requestedDeviceSerial: "ios-1" }
    });
    expect(requests).toEqual(["GET /api/devices"]);
  });

  it("validates, previews, and trial-runs an imported ScriptFlow draft", async () => {
    const requests: string[] = [];
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "POST /api/script-flows/validate": { valid: true, document: { version: 1, app: { id: "classin" }, steps: [] } },
        "POST /api/script-flow-drafts/preview": { planDigest: "a".repeat(64), plan: { steps: [] }, dependencies: [] },
        "GET /api/devices": { devices: [device("device-1", "android", "online")] },
        "POST /api/script-flow-drafts/trial-runs": {
          run: {
            id: "run-1",
            status: "running",
            sourceSnapshot: { kind: "script_flow" },
            stepResults: [],
            artifacts: []
          }
        }
      })
    });

    await expect(adapter.validateScriptFlow({ sourceYaml })).resolves.toEqual(expect.objectContaining({ valid: true }));
    await expect(adapter.previewScriptFlowDraft({ sourceYaml })).resolves.toEqual(expect.objectContaining({ planDigest: "a".repeat(64) }));
    await expect(adapter.runScriptFlowDraft({ sourceYaml, planDigest: "a".repeat(64), appId: "classin", devicePlatform: "android", deviceSerial: "device-1" }))
      .resolves.toEqual(expect.objectContaining({ runId: "run-1", status: "running" }));
    expect(requests).toEqual([
      "POST /api/script-flows/validate",
      "POST /api/script-flow-drafts/preview",
      "GET /api/devices",
      "POST /api/script-flow-drafts/trial-runs"
    ]);
  });

  it("can run a draft using only a unique device serial", async () => {
    const requests: string[] = [];
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "GET /api/devices": { devices: [device("device-1", "android", "online")] },
        "POST /api/script-flow-drafts/trial-runs": {
          run: {
            id: "run-serial",
            status: "running",
            sourceSnapshot: { kind: "script_flow" },
            stepResults: [],
            artifacts: []
          }
        }
      })
    });

    await expect(adapter.runScriptFlowDraft({ sourceYaml, planDigest: "a".repeat(64), deviceSerial: "device-1" }))
      .resolves.toEqual(expect.objectContaining({ runId: "run-serial", status: "running" }));
    expect(requests).toEqual([
      "GET /api/devices",
      "POST /api/script-flow-drafts/trial-runs"
    ]);
  });

  it("waits for a run and returns report summary with learning review state", async () => {
    const requests: string[] = [];
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "GET /api/runs/run-1": [
          { run: { id: "run-1", status: "running", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [] } },
          {
            run: {
              id: "run-1",
              status: "passed",
              sourceSnapshot: { kind: "script_flow" },
              reportHtmlPath: "runs/run-1/report.html",
              stepResults: [],
              artifacts: [{ id: "shot-1", type: "screenshot", name: "after.png", path: "after.png", url: "/artifacts/after.png", createdAt: "" }],
              events: []
            }
          }
        ],
        "GET /api/script-flow-runs/run-1": {
          run: {
            id: "run-1",
            status: "passed",
            sourceSnapshot: { kind: "script_flow" },
            reportHtmlPath: "runs/run-1/report.html",
            stepResults: [],
            artifacts: [{ id: "shot-1", type: "screenshot", name: "after.png", path: "after.png", url: "/artifacts/after.png", createdAt: "" }],
            events: []
          },
          failure: undefined
        },
        "GET /api/trial-runs/run-1/learning-summary": { session: { status: "needs_outcome_review" } }
      })
    });

    await expect(adapter.waitForRun({ runId: "run-1", pollIntervalMs: 0 })).resolves.toEqual(expect.objectContaining({ status: "passed" }));
    await expect(adapter.getRunReport({ runId: "run-1" })).resolves.toMatchObject({
      runId: "run-1",
      status: "passed",
      reportUrl: "http://server.test/api/reports/run-1/html",
      artifactUrls: ["/artifacts/after.png"],
      outcomeReviewRequired: true,
      nextAction: "caller_review_required"
    });
    expect(requests).toEqual([
      "GET /api/runs/run-1",
      "GET /api/runs/run-1",
      "GET /api/script-flow-runs/run-1",
      "GET /api/trial-runs/run-1/learning-summary"
    ]);
  });

  it("can return a compact report with only the terminal state and final screenshot", async () => {
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch([], {
        "GET /api/script-flow-runs/run-compact": {
          run: {
            id: "run-compact",
            status: "failed",
            sourceSnapshot: { kind: "script_flow" },
            reportHtmlPath: "runs/run-compact/report.html",
            stepResults: [{ stepId: "step-2", status: "failed", errorMessage: "未找到目标" }],
            artifacts: [
              { id: "shot-1", type: "screenshot", name: "before.png", path: "before.png", url: "/artifacts/before.png", createdAt: "" },
              { id: "shot-2", type: "screenshot", name: "after.png", path: "after.png", url: "/artifacts/after.png", createdAt: "" }
            ],
            events: [{
              id: "event-1",
              runId: "run-compact",
              deviceSerial: "device-1",
              type: "runner_error",
              severity: "error",
              occurredAt: "",
              summary: "执行失败",
              artifactIds: ["shot-2"]
            }]
          },
          failure: { kind: "step_failed", message: "未找到目标" }
        },
        "GET /api/trial-runs/run-compact/learning-summary": { session: { status: "completed" } }
      })
    });

    const report = await adapter.getRunReport({ runId: "run-compact", responseMode: "compact" });

    expect(report).toEqual({
      runId: "run-compact",
      status: "failed",
      reportUrl: "http://server.test/api/reports/run-compact/html",
      failedSteps: [{ stepId: "step-2", message: "未找到目标" }],
      finalScreenshotUrl: "/artifacts/after.png",
      outcomeReviewRequired: false,
      responseMode: "compact"
    });
    expect("artifactUrls" in report).toBe(false);
    expect("events" in report).toBe(false);
    expect("failure" in report).toBe(false);
    expect("failureEvidence" in report).toBe(false);
  });

  it("returns key evidence by default and all report details in full mode", async () => {
    const errorEvent = {
      id: "event-1",
      runId: "run-evidence",
      deviceSerial: "device-1",
      type: "process_death",
      severity: "error",
      occurredAt: "",
      summary: "目标 App 在执行过程中退出",
      artifactIds: ["log-1"]
    };
    const run = {
      id: "run-evidence",
      status: "failed",
      sourceSnapshot: { kind: "script_flow" },
      reportHtmlPath: "runs/run-evidence/report.html",
      stepResults: [{
        stepId: "step-2",
        status: "failed",
        errorMessage: "未找到加号入口",
        artifacts: [{ id: "failed-shot", type: "screenshot", name: "failed.png", path: "failed.png", url: "/artifacts/failed.png", createdAt: "" }]
      }],
      artifacts: [
        { id: "start-shot", type: "screenshot", name: "start.png", path: "start.png", url: "/artifacts/start.png", createdAt: "" },
        { id: "failed-shot", type: "screenshot", name: "failed.png", path: "failed.png", url: "/artifacts/failed.png", createdAt: "" },
        { id: "log-1", type: "log", name: "logcat.txt", path: "logcat.txt", url: "/artifacts/logcat.txt", createdAt: "" },
        { id: "final-shot", type: "screenshot", name: "final.png", path: "final.png", url: "/artifacts/final.png", createdAt: "" }
      ],
      events: [errorEvent]
    };
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch([], {
        "GET /api/script-flow-runs/run-evidence": [
          { run, failure: { kind: "step_failed", message: "未找到加号入口" } },
          { run, failure: { kind: "step_failed", message: "未找到加号入口" } }
        ],
        "GET /api/trial-runs/run-evidence/learning-summary": [
          { session: { status: "completed" } },
          { session: { status: "completed" } }
        ]
      })
    });

    await expect(adapter.getRunReport({ runId: "run-evidence" })).resolves.toMatchObject({
      runId: "run-evidence",
      responseMode: "evidence",
      finalScreenshotUrl: "/artifacts/final.png",
      artifactUrls: ["/artifacts/failed.png", "/artifacts/logcat.txt", "/artifacts/final.png"],
      events: [errorEvent],
      failure: { kind: "step_failed" }
    });
    await expect(adapter.getRunReport({ runId: "run-evidence", responseMode: "full" })).resolves.toMatchObject({
      runId: "run-evidence",
      responseMode: "full",
      artifactUrls: ["/artifacts/start.png", "/artifacts/failed.png", "/artifacts/logcat.txt", "/artifacts/final.png"],
      failureEvidence: [
        expect.objectContaining({ id: "start-shot" }),
        expect.objectContaining({ id: "failed-shot" }),
        expect.objectContaining({ id: "final-shot" })
      ],
      events: [errorEvent],
      failure: { kind: "step_failed" }
    });
  });

  it("generates, previews, runs, waits, and summarizes a trial in one call", async () => {
    const requests: string[] = [];
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "GET /api/devices": { devices: [device("device-1", "harmony", "online")] },
        "POST /api/script-flow-drafts/generate": { draft: { status: "ready", sourceYaml } },
        "POST /api/script-flow-drafts/preview": { planDigest: "b".repeat(64), plan: { steps: [] }, dependencies: [] },
        "POST /api/script-flow-drafts/trial-runs": {
          run: { id: "run-2", status: "running", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [] }
        },
        "GET /api/runs/run-2": {
          run: { id: "run-2", status: "failed", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [], events: [] }
        },
        "GET /api/script-flow-runs/run-2": {
          run: { id: "run-2", status: "failed", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [], events: [] },
          failure: { kind: "step_failed", message: "未找到目标" }
        }
      })
    });

    await expect(adapter.generateAndRunScriptFlow({
      goal: "打开 Harmony 搜索页",
      appId: "classin",
      scriptPlatform: "harmony",
      devicePlatform: "harmony",
      deviceSerial: "device-1",
      timeoutMs: 1000,
      pollIntervalMs: 0
    })).resolves.toMatchObject({
      runId: "run-2",
      status: "failed",
      failure: { kind: "step_failed" }
    });
    expect(requests).toEqual([
      "GET /api/devices",
      "POST /api/script-flow-drafts/generate",
      "POST /api/script-flow-drafts/preview",
      "POST /api/script-flow-drafts/trial-runs",
      "GET /api/runs/run-2",
      "GET /api/script-flow-runs/run-2",
      "GET /api/trial-runs/run-2/learning-summary"
    ]);
  });

  it("repairs and reruns a generated draft until it passes", async () => {
    const requests: string[] = [];
    const repairedYaml = sourceYaml.replace("班级四十二号", "班级四十二号 ");
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "GET /api/devices": { devices: [device("device-1", "android", "online")] },
        "POST /api/script-flow-drafts/generate": { draft: { status: "ready", sourceYaml } },
        "POST /api/script-flow-drafts/preview": [
          { planDigest: "a".repeat(64), plan: { steps: [] }, dependencies: [] },
          { planDigest: "b".repeat(64), plan: { steps: [] }, dependencies: [] }
        ],
        "POST /api/script-flow-drafts/trial-runs": [
          { run: { id: "run-failed", status: "running", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [] } },
          { run: { id: "run-passed", status: "running", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [] } }
        ],
        "GET /api/runs/run-failed": {
          run: {
            id: "run-failed",
            status: "failed",
            sourceSnapshot: { kind: "script_flow" },
            stepResults: [{ stepId: "open-class", status: "failed", errorMessage: "未找到目标" }],
            artifacts: [],
            events: []
          }
        },
        "GET /api/script-flow-runs/run-failed": {
          run: {
            id: "run-failed",
            status: "failed",
            sourceSnapshot: { kind: "script_flow" },
            stepResults: [{ stepId: "open-class", status: "failed", errorMessage: "未找到目标" }],
            artifacts: [],
            events: []
          },
          failure: { kind: "target_not_found", message: "未找到目标" }
        },
        "POST /api/script-flow-drafts/repair": {
          draft: { status: "trial_ready", sourceYaml: repairedYaml, summary: "补充更准确的班级文字" },
          repair: { runId: "run-failed", failure: { kind: "target_not_found", message: "未找到目标" } }
        },
        "GET /api/runs/run-passed": {
          run: {
            id: "run-passed",
            status: "passed",
            sourceSnapshot: { kind: "script_flow" },
            stepResults: [],
            artifacts: [{ id: "shot-final", type: "screenshot", name: "final.png", path: "final.png", url: "/artifacts/final.png", createdAt: "" }],
            events: []
          }
        },
        "GET /api/script-flow-runs/run-passed": {
          run: {
            id: "run-passed",
            status: "passed",
            sourceSnapshot: { kind: "script_flow" },
            stepResults: [],
            artifacts: [{ id: "shot-final", type: "screenshot", name: "final.png", path: "final.png", url: "/artifacts/final.png", createdAt: "" }],
            events: []
          }
        },
        "GET /api/trial-runs/run-failed/learning-summary": { session: { status: "completed" } },
        "GET /api/trial-runs/run-passed/learning-summary": { session: { status: "completed" } }
      })
    });

    await expect(adapter.generateRepairAndRunScriptFlow({
      goal: "打开班级四十二号",
      appId: "classin",
      scriptPlatform: "android",
      devicePlatform: "android",
      deviceSerial: "device-1",
      repairPolicy: { maxAttempts: 2 },
      responseMode: "compact",
      pollIntervalMs: 0
    })).resolves.toMatchObject({
      status: "passed",
      runId: "run-passed",
      attempts: 2,
      finalSourceYaml: repairedYaml,
      repairHistory: [{
        attempt: 1,
        failedRunId: "run-failed",
        failureKind: "target_not_found",
        nextSourceYaml: repairedYaml,
        summary: "补充更准确的班级文字"
      }]
    });
    expect(requests).toEqual([
      "GET /api/devices",
      "POST /api/script-flow-drafts/generate",
      "POST /api/script-flow-drafts/preview",
      "POST /api/script-flow-drafts/trial-runs",
      "GET /api/runs/run-failed",
      "GET /api/script-flow-runs/run-failed",
      "GET /api/trial-runs/run-failed/learning-summary",
      "POST /api/script-flow-drafts/repair",
      "POST /api/script-flow-drafts/preview",
      "POST /api/script-flow-drafts/trial-runs",
      "GET /api/runs/run-passed",
      "GET /api/script-flow-runs/run-passed",
      "GET /api/trial-runs/run-passed/learning-summary"
    ]);
  });

  it("stops repair loops for app failures", async () => {
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch([], {
        "GET /api/devices": { devices: [device("device-1", "android", "online")] },
        "POST /api/script-flow-drafts/generate": { draft: { status: "ready", sourceYaml } },
        "POST /api/script-flow-drafts/preview": { planDigest: "a".repeat(64), plan: { steps: [] }, dependencies: [] },
        "POST /api/script-flow-drafts/trial-runs": {
          run: { id: "run-crash", status: "running", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [] }
        },
        "GET /api/runs/run-crash": {
          run: {
            id: "run-crash",
            status: "failed",
            sourceSnapshot: { kind: "script_flow" },
            stepResults: [],
            artifacts: [],
            events: [{ id: "event-1", runId: "run-crash", deviceSerial: "device-1", type: "crash", severity: "error", occurredAt: "", summary: "crash" }]
          }
        },
        "GET /api/script-flow-runs/run-crash": {
          run: {
            id: "run-crash",
            status: "failed",
            sourceSnapshot: { kind: "script_flow" },
            stepResults: [],
            artifacts: [],
            events: [{ id: "event-1", runId: "run-crash", deviceSerial: "device-1", type: "crash", severity: "error", occurredAt: "", summary: "crash" }]
          },
          failure: { kind: "app_failure", message: "目标 App 崩溃" }
        },
        "GET /api/trial-runs/run-crash/learning-summary": { session: { status: "completed" } }
      })
    });

    await expect(adapter.generateRepairAndRunScriptFlow({
      goal: "打开班级",
      appId: "classin",
      scriptPlatform: "android",
      devicePlatform: "android",
      deviceSerial: "device-1",
      repairPolicy: { maxAttempts: 2 },
      pollIntervalMs: 0
    })).resolves.toMatchObject({
      status: "failed",
      runId: "run-crash",
      repairStoppedReason: "non_repairable_failure",
      repairHistory: []
    });
  });

  it("passes compact response mode through one-call execution", async () => {
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch([], {
        "GET /api/devices": { devices: [device("device-1", "android", "online")] },
        "POST /api/script-flow-drafts/generate": { draft: { status: "ready", sourceYaml } },
        "POST /api/script-flow-drafts/preview": { planDigest: "c".repeat(64), plan: { steps: [] }, dependencies: [] },
        "POST /api/script-flow-drafts/trial-runs": {
          run: { id: "run-compact", status: "running", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [] }
        },
        "GET /api/runs/run-compact": {
          run: { id: "run-compact", status: "passed", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [], events: [] }
        },
        "GET /api/script-flow-runs/run-compact": {
          run: {
            id: "run-compact",
            status: "passed",
            sourceSnapshot: { kind: "script_flow" },
            stepResults: [],
            artifacts: [{ id: "shot-1", type: "screenshot", name: "final.png", path: "final.png", url: "/artifacts/final.png", createdAt: "" }],
            events: []
          }
        },
        "GET /api/trial-runs/run-compact/learning-summary": { session: { status: "completed" } }
      })
    });

    const result = await adapter.generateAndRunScriptFlow({
      goal: "打开 Android 页面",
      appId: "classin",
      scriptPlatform: "android",
      devicePlatform: "android",
      deviceSerial: "device-1",
      responseMode: "compact",
      pollIntervalMs: 0
    });

    expect(result).toMatchObject({
      runId: "run-compact",
      status: "passed",
      responseMode: "compact",
      finalScreenshotUrl: "/artifacts/final.png"
    });
    expect("artifactUrls" in (result as Record<string, unknown>)).toBe(false);
  });

  it("does not run when generate-and-run needs clarification", async () => {
    const requests: string[] = [];
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "GET /api/devices": { devices: [device("device-1", "android", "online")] },
        "POST /api/script-flow-drafts/generate": { draft: { status: "needs_clarification", clarification: "要进入哪个页面？" } }
      })
    });

    await expect(adapter.generateAndRunScriptFlow({
      goal: "进入目标页",
      appId: "classin",
      scriptPlatform: "android",
      devicePlatform: "android",
      deviceSerial: "device-1"
    })).resolves.toMatchObject({
      status: "needs_clarification",
      clarification: "要进入哪个页面？"
    });
    expect(requests).toEqual(["GET /api/devices", "POST /api/script-flow-drafts/generate"]);
  });

  it("reuses source YAML from a previous run on another device without regenerating", async () => {
    const requests: string[] = [];
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "GET /api/runs/run-android": {
          run: {
            id: "run-android",
            status: "passed",
            sourceSnapshot: {
              kind: "script_flow",
              planDigest: "a".repeat(64),
              sourceYaml,
              parsed: { app: { id: "classin" } },
              dependencies: []
            },
            stepResults: [],
            artifacts: [],
            events: []
          }
        },
        "POST /api/script-flow-drafts/preview": { planDigest: "b".repeat(64), plan: { steps: [] }, dependencies: [] },
        "GET /api/devices": { devices: [device("harmony-1", "harmony", "online")] },
        "POST /api/script-flow-drafts/trial-runs": {
          run: { id: "run-harmony", status: "running", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [] }
        },
        "GET /api/runs/run-harmony": {
          run: { id: "run-harmony", status: "passed", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [], events: [] }
        },
        "GET /api/script-flow-runs/run-harmony": {
          run: {
            id: "run-harmony",
            status: "passed",
            sourceSnapshot: { kind: "script_flow" },
            reportHtmlPath: "runs/run-harmony/report.html",
            stepResults: [],
            artifacts: [{ id: "shot-final", type: "screenshot", name: "final.png", path: "final.png", url: "/artifacts/final.png", createdAt: "" }],
            events: []
          }
        },
        "GET /api/trial-runs/run-harmony/learning-summary": { session: { status: "completed" } }
      })
    });

    await expect(adapter.runPreviousScriptFlow({
      sourceRunId: "run-android",
      devicePlatform: "harmony",
      deviceSerial: "harmony-1",
      responseMode: "compact",
      pollIntervalMs: 0
    })).resolves.toMatchObject({
      sourceRunId: "run-android",
      sourcePlanDigest: "a".repeat(64),
      planDigest: "b".repeat(64),
      runId: "run-harmony",
      status: "passed",
      responseMode: "compact",
      finalScreenshotUrl: "/artifacts/final.png"
    });
    expect(requests).toEqual([
      "GET /api/runs/run-android",
      "POST /api/script-flow-drafts/preview",
      "GET /api/devices",
      "POST /api/script-flow-drafts/trial-runs",
      "GET /api/runs/run-harmony",
      "GET /api/script-flow-runs/run-harmony",
      "GET /api/trial-runs/run-harmony/learning-summary"
    ]);
  });

  it("rejects previous run reuse when the source run has no YAML snapshot", async () => {
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch([], {
        "GET /api/runs/run-no-yaml": {
          run: {
            id: "run-no-yaml",
            status: "passed",
            sourceSnapshot: { kind: "script_flow", planDigest: "a".repeat(64), parsed: {}, dependencies: [] },
            stepResults: [],
            artifacts: [],
            events: []
          }
        }
      })
    });

    await expect(adapter.runPreviousScriptFlow({ sourceRunId: "run-no-yaml", deviceSerial: "device-1" }))
      .rejects.toThrow("Run run-no-yaml does not include reusable sourceYaml");
  });

  it("reviews a trial outcome only when the caller gives a decision", async () => {
    const requests: string[] = [];
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "POST /api/trial-runs/run-1/outcome-review": { status: "accepted" }
      })
    });

    await expect(adapter.reviewTrialOutcome({ runId: "run-1", decision: "confirmed" })).resolves.toEqual({ status: "accepted" });
    expect(requests).toEqual(["POST /api/trial-runs/run-1/outcome-review"]);
  });
});

function device(serial: string, platform: "android" | "ios" | "harmony", status: "online" | "offline") {
  return {
    id: serial,
    serial,
    platform,
    status,
    capabilities: {
      screenshot: status === "online",
      tap: status === "online",
      launchApp: status === "online"
    }
  };
}

function fakeFetch(requests: string[], responses: Record<string, unknown | unknown[]>): typeof fetch {
  return (async (url, init) => {
    const parsed = new URL(String(url));
    const method = init?.method ?? "GET";
    const key = `${method} ${parsed.pathname}`;
    requests.push(key);
    const response = responses[key];
    const payload = Array.isArray(response) ? response.shift() : response;
    return new Response(JSON.stringify(payload ?? { error: `No fake response for ${key}` }), { status: payload ? 200 : 404 });
  }) as typeof fetch;
}
