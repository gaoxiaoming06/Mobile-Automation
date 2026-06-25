import { describe, expect, it } from "vitest";
import { MobileAutomationMcpAdapter } from "./index.js";

describe("MobileAutomationMcpAdapter", () => {
  it("lists graph apps and nodes through REST API", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "GET /api/graphs": {
          graphs: [graphPayload()]
        }
      })
    });

    await expect(adapter.listApps()).resolves.toEqual([
      {
        appId: "classin",
        graphId: "graph-1",
        name: "ClassIn 教师端",
        platformScope: "android",
        activeVersionId: "version-1"
      }
    ]);
    await expect(adapter.listGraphNodes({ graphId: "graph-1" })).resolves.toEqual([
      {
        id: "node-1",
        key: "home",
        name: "首页",
        nodeType: "page",
        status: "active",
        platformScope: "android",
        tags: ["smoke"]
      }
    ]);
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual(["GET /api/graphs", "GET /api/graphs"]);
  });

  it("gets node detail with incoming and outgoing edges", async () => {
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch([], {
        "GET /api/graphs": {
          graphs: [
            {
              ...graphPayload(),
              activeVersion: {
                ...graphPayload().activeVersion,
                edges: [
                  { id: "edge-in", fromNodeId: "root", toNodeId: "node-1", key: "root.home" },
                  { id: "edge-out", fromNodeId: "node-1", toNodeId: "node-2", key: "home.target" }
                ]
              }
            }
          ]
        }
      })
    });

    await expect(adapter.getNodeDetail({ graphId: "graph-1", key: "home" })).resolves.toEqual(
      expect.objectContaining({
        graphVersionId: "version-1",
        node: expect.objectContaining({ id: "node-1", key: "home" }),
        incomingEdges: [expect.objectContaining({ id: "edge-in" })],
        outgoingEdges: [expect.objectContaining({ id: "edge-out" })]
      })
    );
  });

  it("triggers target node tests and reads graph run status, report, and failure evidence", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "POST /api/graph-runs": {
          run: { id: "run-1", status: "running" },
          active: true,
          targetNodeId: "node-1",
          targetResolution: {
            targetNode: { id: "node-1", name: "新建课堂" }
          },
          nodeTestResult: {
            runId: "run-1",
            status: "running",
            active: true,
            targetNodeId: "node-1",
            targetNodeName: "新建课堂",
            reportUrl: "/artifacts/runs/run-1/reports/report.html",
            route: [{ edgeKey: "home.target" }]
          }
        },
        "GET /api/graph-runs/run-1": {
          graphRun: {
            id: "run-1",
            status: "failed",
            active: false,
            targetNodeId: "node-1",
            targetNodeName: "新建课堂",
            failedAt: { phase: "expectation", message: "missing text" },
            reportUrl: "/artifacts/runs/run-1/reports/report.html",
            failureEvidence: [
              {
                id: "artifact-1",
                type: "screenshot",
                name: "failed.png",
                path: "runs/run-1/screenshots/failed.png",
                url: "/artifacts/runs/run-1/screenshots/failed.png",
                createdAt: "2026-06-12T00:00:00.000Z"
              }
            ]
          },
          nodeTestResult: {
            runId: "run-1",
            status: "failed",
            active: false,
            targetNodeId: "node-1",
            targetNodeName: "新建课堂",
            failedAt: { phase: "expectation", message: "missing text" },
            reportUrl: "/artifacts/runs/run-1/reports/report.html",
            evidence: {
              screenshots: ["/artifacts/runs/run-1/screenshots/failed.png"],
              videos: [],
              logs: [],
              failureArtifacts: ["/artifacts/runs/run-1/screenshots/failed.png"]
            }
          }
        }
      })
    });

    await expect(
      adapter.triggerNodeTest({
        deviceSerial: "device-1",
        graphId: "graph-1",
        target: { key: "lesson.create" },
        overlay: {
          nodeExpectationOverrides: []
        }
      })
    ).resolves.toEqual({
      runId: "run-1",
      status: "running",
      active: true,
      targetNodeId: "node-1",
      targetNodeName: "新建课堂",
      reportUrl: "http://server.test/artifacts/runs/run-1/reports/report.html",
      route: [{ edgeKey: "home.target" }]
    });

    await expect(adapter.getRunStatus({ runId: "run-1" })).resolves.toEqual(
      expect.objectContaining({
        runId: "run-1",
        status: "failed",
        reportUrl: "http://server.test/artifacts/runs/run-1/reports/report.html",
        failedAt: { phase: "expectation", message: "missing text" }
      })
    );
    await expect(adapter.getReport({ runId: "run-1" })).resolves.toEqual({
      runId: "run-1",
      reportUrl: "http://server.test/artifacts/runs/run-1/reports/report.html",
      ready: true
    });
    await expect(adapter.getFailureEvidence({ runId: "run-1" })).resolves.toEqual({
      runId: "run-1",
      failedAt: { phase: "expectation", message: "missing text" },
      artifacts: [expect.objectContaining({ id: "artifact-1", type: "screenshot" })]
    });
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "POST /api/graph-runs",
      "GET /api/graph-runs/run-1",
      "GET /api/graph-runs/run-1",
      "GET /api/graph-runs/run-1"
    ]);
  });

  it("reads graph quality through REST API", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const adapter = new MobileAutomationMcpAdapter({
      serverUrl: "http://server.test",
      fetch: fakeFetch(requests, {
        "GET /api/graphs/version-1/quality": {
          quality: {
            graphVersionId: "version-1",
            analyzedRunCount: 2,
            nodes: [
              {
                nodeId: "node-1",
                nodeName: "新建课堂",
                passRate: 0.5,
                runCount: 2
              }
            ],
            edges: [
              {
                edgeId: "edge-1",
                edgeKey: "home.target",
                passRate: 1,
                runCount: 1
              }
            ]
          }
        }
      })
    });

    await expect(adapter.getGraphQuality({ graphVersionId: "version-1", limit: 50 })).resolves.toEqual({
      graphVersionId: "version-1",
      analyzedRunCount: 2,
      nodes: [expect.objectContaining({ nodeId: "node-1", passRate: 0.5 })],
      edges: [expect.objectContaining({ edgeId: "edge-1", edgeKey: "home.target" })]
    });
    expect(requests[0]?.url).toBe("http://server.test/api/graphs/version-1/quality?limit=50");
  });
});

function graphPayload() {
  return {
    id: "graph-1",
    appId: "classin",
    name: "ClassIn 教师端",
    platformScope: "android",
    activeVersionId: "version-1",
    activeVersion: {
      id: "version-1",
      nodes: [
        {
          id: "node-1",
          key: "home",
          name: "首页",
          nodeType: "page",
          status: "active",
          platformScope: "android",
          tags: ["smoke"]
        }
      ],
      edges: []
    }
  };
}

function fakeFetch(
  requests: Array<{ url: string; method: string; body?: string }>,
  responses: Record<string, unknown>
): typeof fetch {
  return (async (url, init) => {
    const method = init?.method ?? "GET";
    requests.push({
      url: String(url),
      method,
      body: typeof init?.body === "string" ? init.body : undefined
    });
    const key = `${method} ${new URL(String(url)).pathname}`;
    const payload = responses[key];
    if (!payload) {
      return new Response(JSON.stringify({ error: `No fake response for ${key}` }), { status: 404 });
    }
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}
