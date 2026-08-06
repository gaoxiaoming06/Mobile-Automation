import { describe, expect, it } from "vitest";
import { assertNoSecretInMcpToolDefinitions, createMobileAutomationMcpToolHandlers, mobileAutomationMcpTools } from "./mcp-wrapper.js";

describe("mobile automation MCP tools", () => {
  it("exposes page identity and ScriptFlow tools only", () => {
    expect(mobileAutomationMcpTools.map((tool) => tool.name)).toEqual([
      "get_script_flow_authoring_contract",
      "list_devices",
      "validate_device",
      "list_apps",
      "list_page_assets",
      "get_page_asset",
      "list_script_flows",
      "get_script_flow",
      "generate_script_flow",
      "generate_script_flow_draft",
      "repair_script_flow_draft",
      "validate_script_flow",
      "preview_script_flow_draft",
      "run_script_flow_draft",
      "preview_script_flow",
      "run_script_flow",
      "wait_for_run",
      "get_run",
      "get_run_report",
      "get_report",
      "generate_and_run_script_flow",
      "generate_repair_and_run_script_flow",
      "run_previous_script_flow",
      "review_trial_outcome"
    ]);
    expect(() => assertNoSecretInMcpToolDefinitions()).not.toThrow();
    expect(JSON.stringify(mobileAutomationMcpTools)).not.toContain("graph");
    expect(JSON.stringify(mobileAutomationMcpTools)).not.toContain("confirmedRiskSteps");
    expect(JSON.stringify(mobileAutomationMcpTools)).toContain("planDigest");
    expect(JSON.stringify(mobileAutomationMcpTools.find((tool) => tool.name === "get_run_report")?.inputSchema)).toContain("responseMode");
    expect(JSON.stringify(mobileAutomationMcpTools.find((tool) => tool.name === "generate_and_run_script_flow")?.inputSchema)).toContain("responseMode");
    expect(JSON.stringify(mobileAutomationMcpTools.find((tool) => tool.name === "generate_repair_and_run_script_flow")?.inputSchema)).toContain("repairPolicy");
    expect(JSON.stringify(mobileAutomationMcpTools)).not.toContain("confirmedRisks");
  });

  it("maps repair handlers to ScriptFlow repair endpoints", async () => {
    const requests: string[] = [];
    const handlers = createMobileAutomationMcpToolHandlers({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "POST /api/script-flow-drafts/repair": {
          draft: { status: "trial_ready", sourceYaml: "version: 1\nkind: case\nname: demo\napp: { id: classin }\nsteps: []" },
          repair: { runId: "run-failed", failure: { kind: "target_not_found" } }
        }
      })
    });

    await expect(handlers.repair_script_flow_draft({
      sourceYaml: "version: 1\nkind: case\nname: demo\napp: { id: classin }\nsteps: []",
      runId: "run-failed",
      instruction: "修复失败步骤",
      scriptPlatform: "android"
    })).resolves.toMatchObject({
      repair: { runId: "run-failed", failure: { kind: "target_not_found" } }
    });
    expect(requests).toEqual(["POST /api/script-flow-drafts/repair"]);
  });

  it("maps handlers to ScriptFlow REST endpoints", async () => {
    const requests: string[] = [];
    const handlers = createMobileAutomationMcpToolHandlers({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "POST /api/script-flow-drafts/generate": { draft: { status: "needs_clarification", clarification: "要打开哪个班级？" } },
        "GET /api/devices": { devices: [device("device-1", "android", "online")] },
        "GET /api/script-flows/flow-1": { flow: { id: "flow-1", version: 2 } },
        "POST /api/script-flows/flow-1/preview": { planDigest: "a".repeat(64), plan: { steps: [] }, dependencies: [] },
        "POST /api/script-flows/flow-1/runs": { run: { id: "run-1", status: "running", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [] } },
        "POST /api/script-flows/validate": { valid: true },
        "POST /api/script-flow-drafts/preview": { planDigest: "b".repeat(64), plan: { steps: [] }, dependencies: [] },
        "POST /api/script-flow-drafts/trial-runs": [
          { run: { id: "run-2", status: "running", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [] } },
          { run: { id: "run-3", status: "running", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [] } }
        ],
        "GET /api/runs/run-2": { run: { id: "run-2", status: "passed", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [], events: [] } },
        "GET /api/script-flow-runs/run-2": {
          run: {
            id: "run-2",
            status: "passed",
            sourceSnapshot: { kind: "script_flow" },
            stepResults: [],
            artifacts: [{ id: "shot-1", type: "screenshot", name: "final.png", path: "final.png", url: "/artifacts/final.png", createdAt: "" }],
            events: []
          }
        },
        "GET /api/runs/run-source": {
          run: {
            id: "run-source",
            status: "passed",
            sourceSnapshot: {
              kind: "script_flow",
              planDigest: "c".repeat(64),
              sourceYaml: "version: 1\nkind: case\nname: demo\napp: { id: classin }\nsteps: []",
              parsed: { app: { id: "classin" } },
              dependencies: []
            },
            stepResults: [],
            artifacts: [],
            events: []
          }
        },
        "GET /api/runs/run-3": {
          run: { id: "run-3", status: "passed", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [], events: [] }
        },
        "GET /api/script-flow-runs/run-3": {
          run: {
            id: "run-3",
            status: "passed",
            sourceSnapshot: { kind: "script_flow" },
            stepResults: [],
            artifacts: [{ id: "shot-3", type: "screenshot", name: "final.png", path: "final.png", url: "/artifacts/final3.png", createdAt: "" }],
            events: []
          }
        }
      })
    });

    await expect(handlers.get_script_flow_authoring_contract({ scriptPlatform: "harmony" })).resolves.toMatchObject({
      scriptPlatforms: ["android", "ios", "harmony", "flutter", "mobile"],
      devicePlatforms: ["android", "ios", "harmony"]
    });
    await expect(handlers.validate_device({ devicePlatform: "android", deviceSerial: "device-1" })).resolves.toMatchObject({
      ok: true,
      selectedDevice: { serial: "device-1" }
    });
    await expect(handlers.generate_script_flow({ prompt: "打开班级", appId: "cn.eeo.classin", platform: "android" })).resolves.toEqual(
      { status: "needs_clarification", clarification: "要打开哪个班级？" }
    );
    await expect(handlers.validate_script_flow({ sourceYaml: "version: 1\nkind: case\nname: demo\napp: { id: classin }\nsteps: []" })).resolves.toEqual({ valid: true });
    await expect(handlers.preview_script_flow_draft({ sourceYaml: "version: 1\nkind: case\nname: demo\napp: { id: classin }\nsteps: []" })).resolves.toEqual(
      expect.objectContaining({ planDigest: "b".repeat(64) })
    );
    await expect(handlers.run_script_flow_draft({
      sourceYaml: "version: 1\nkind: case\nname: demo\napp: { id: classin }\nsteps: []",
      planDigest: "b".repeat(64),
      devicePlatform: "android",
      deviceSerial: "device-1"
    })).resolves.toEqual(expect.objectContaining({ runId: "run-2" }));
    await expect(handlers.preview_script_flow({ flowId: "flow-1", expectedVersion: 2, parameters: { className: "班级四十二号" } })).resolves.toEqual(
      expect.objectContaining({ planDigest: "a".repeat(64) })
    );
    await expect(handlers.run_script_flow({ flowId: "flow-1", expectedVersion: 2, planDigest: "a".repeat(64), deviceSerial: "device-1", parameters: { className: "班级四十二号" } })).resolves.toEqual(
      expect.objectContaining({ runId: "run-1", status: "running" })
    );
    await expect(handlers.wait_for_run({ runId: "run-2", pollIntervalMs: 0 })).resolves.toEqual(expect.objectContaining({ status: "passed" }));
    const compactReport = await handlers.get_run_report({ runId: "run-2", responseMode: "compact" }) as Record<string, unknown>;
    expect(compactReport).toMatchObject({
      status: "passed",
      responseMode: "compact",
      finalScreenshotUrl: "/artifacts/final.png"
    });
    expect("artifactUrls" in compactReport).toBe(false);
    await expect(handlers.run_previous_script_flow({
      sourceRunId: "run-source",
      devicePlatform: "android",
      deviceSerial: "device-1",
      responseMode: "compact",
      pollIntervalMs: 0
    })).resolves.toMatchObject({
      sourceRunId: "run-source",
      runId: "run-3",
      status: "passed",
      finalScreenshotUrl: "/artifacts/final3.png"
    });
    expect(requests).toEqual([
      "GET /api/devices",
      "POST /api/script-flow-drafts/generate",
      "POST /api/script-flows/validate",
      "POST /api/script-flow-drafts/preview",
      "GET /api/devices",
      "POST /api/script-flow-drafts/trial-runs",
      "POST /api/script-flows/flow-1/preview",
      "GET /api/devices",
      "POST /api/script-flows/flow-1/runs",
      "GET /api/runs/run-2",
      "GET /api/script-flow-runs/run-2",
      "GET /api/trial-runs/run-2/learning-summary",
      "GET /api/runs/run-source",
      "POST /api/script-flow-drafts/preview",
      "GET /api/devices",
      "POST /api/script-flow-drafts/trial-runs",
      "GET /api/runs/run-3",
      "GET /api/script-flow-runs/run-3",
      "GET /api/trial-runs/run-3/learning-summary"
    ]);
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
