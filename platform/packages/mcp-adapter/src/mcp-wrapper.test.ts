import { describe, expect, it } from "vitest";
import { assertNoSecretInMcpToolDefinitions, createMobileAutomationMcpToolHandlers, mobileAutomationMcpTools } from "./mcp-wrapper.js";

describe("mobile automation MCP tools", () => {
  it("exposes page identity and ScriptFlow tools only", () => {
    expect(mobileAutomationMcpTools.map((tool) => tool.name)).toEqual([
      "list_apps",
      "list_page_assets",
      "get_page_asset",
      "list_script_flows",
      "get_script_flow",
      "generate_script_flow",
      "run_script_flow",
      "get_run",
      "get_report"
    ]);
    expect(() => assertNoSecretInMcpToolDefinitions()).not.toThrow();
    expect(JSON.stringify(mobileAutomationMcpTools)).not.toContain("graph");
  });

  it("maps handlers to ScriptFlow REST endpoints", async () => {
    const requests: string[] = [];
    const handlers = createMobileAutomationMcpToolHandlers({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "POST /api/script-flow-drafts/generate": { draft: { status: "needs_clarification", clarification: "要打开哪个班级？" } },
        "POST /api/script-flows/flow-1/runs": { run: { id: "run-1", status: "running", sourceSnapshot: { kind: "script_flow" }, stepResults: [], artifacts: [] } }
      })
    });

    await expect(handlers.generate_script_flow({ prompt: "打开班级", appId: "cn.eeo.classin", platform: "android" })).resolves.toEqual(
      { status: "needs_clarification", clarification: "要打开哪个班级？" }
    );
    await expect(handlers.run_script_flow({ flowId: "flow-1", deviceSerial: "device-1", parameters: { className: "班级四十二号" } })).resolves.toEqual(
      expect.objectContaining({ runId: "run-1", status: "running" })
    );
    expect(requests).toEqual(["POST /api/script-flow-drafts/generate", "POST /api/script-flows/flow-1/runs"]);
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
