import { describe, expect, it } from "vitest";
import { MobileAutomationMcpAdapter } from "./index.js";

describe("ScriptFlow MCP REST adapter", () => {
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
      "POST /api/script-flows/flow-1/runs",
      "GET /api/runs/run-1"
    ]);
  });
});

function fakeFetch(requests: string[], responses: Record<string, unknown>): typeof fetch {
  return (async (url, init) => {
    const parsed = new URL(String(url));
    const method = init?.method ?? "GET";
    const key = `${method} ${parsed.pathname}`;
    requests.push(key);
    const payload = responses[key];
    return new Response(JSON.stringify(payload ?? { error: `No fake response for ${key}` }), { status: payload ? 200 : 404 });
  }) as typeof fetch;
}
