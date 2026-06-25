import { describe, expect, it } from "vitest";
import { assertNoSecretInMcpToolDefinitions, createMobileAutomationMcpToolHandlers, mobileAutomationMcpTools } from "./mcp-wrapper.js";

describe("mobile automation MCP wrapper", () => {
  it("exposes stable tool definitions without secret-like schema fields", () => {
    expect(mobileAutomationMcpTools.map((tool) => tool.name)).toEqual([
      "list_apps",
      "list_graph_nodes",
      "get_node_detail",
      "trigger_node_test",
      "get_run_status",
      "get_report",
      "get_failure_evidence",
      "get_graph_quality"
    ]);
    expect(() => assertNoSecretInMcpToolDefinitions()).not.toThrow();
  });

  it("maps MCP tool handlers to the REST-only adapter", async () => {
    const requests: Array<{ method: string; path: string; body?: string }> = [];
    const handlers = createMobileAutomationMcpToolHandlers({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "POST /api/graph-runs": {
          nodeTestResult: {
            runId: "run-1",
            status: "running",
            active: true,
            targetNodeId: "node-target",
            targetNodeName: "目标页"
          }
        },
        "GET /api/graph-runs/run-1": {
          nodeTestResult: {
            runId: "run-1",
            status: "failed",
            active: false,
            failedAt: { phase: "expectation", message: "missing text" },
            reportUrl: "/artifacts/runs/run-1/reports/report.html"
          }
        },
        "GET /api/graphs/version-1/quality": {
          quality: {
            graphVersionId: "version-1",
            analyzedRunCount: 0,
            nodes: [],
            edges: []
          }
        }
      })
    });

    await expect(
      handlers.trigger_node_test({
        deviceSerial: "device-1",
        graphId: "graph-1",
        target: { key: "target" }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        runId: "run-1",
        status: "running",
        targetNodeName: "目标页"
      })
    );
    await expect(handlers.get_run_status({ runId: "run-1" })).resolves.toEqual(
      expect.objectContaining({
        status: "failed",
        reportUrl: "http://server.test/artifacts/runs/run-1/reports/report.html"
      })
    );
    await expect(handlers.get_graph_quality({ graphVersionId: "version-1" })).resolves.toEqual(
      expect.objectContaining({
        graphVersionId: "version-1",
        analyzedRunCount: 0
      })
    );

    expect(requests).toEqual([
      expect.objectContaining({ method: "POST", path: "/api/graph-runs" }),
      expect.objectContaining({ method: "GET", path: "/api/graph-runs/run-1" }),
      expect.objectContaining({ method: "GET", path: "/api/graphs/version-1/quality" })
    ]);
  });
});

function fakeFetch(
  requests: Array<{ method: string; path: string; body?: string }>,
  responses: Record<string, unknown>
): typeof fetch {
  return (async (url, init) => {
    const parsed = new URL(String(url));
    const method = init?.method ?? "GET";
    requests.push({
      method,
      path: parsed.pathname,
      body: typeof init?.body === "string" ? init.body : undefined
    });
    const key = `${method} ${parsed.pathname}`;
    const payload = responses[key];
    if (!payload) {
      return new Response(JSON.stringify({ error: `No fake response for ${key}` }), { status: 404 });
    }
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}
