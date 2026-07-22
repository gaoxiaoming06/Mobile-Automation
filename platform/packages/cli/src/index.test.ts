import { describe, expect, it, vi } from "vitest";
import { buildRequest, formatResponse, parseCliArgs, runCli } from "./index.js";

describe("automation CLI", () => {
  it("parses server URL and builds a run request", () => {
    const parsed = parseCliArgs(["run", "--server", "http://server/", "--device", "serial-1", "--case", "case-1", "--repeat", "3"]);

    expect(parsed.serverUrl).toBe("http://server");
    expect(buildRequest(parsed)).toEqual({
      method: "POST",
      path: "/api/runs",
      body: {
        deviceSerial: "serial-1",
        caseId: "case-1",
        mode: undefined,
        repeatCount: 3,
        stepIntervalMs: undefined,
        startStrategy: undefined,
        startAppPackageName: undefined,
        startSetupScope: undefined
      }
    });
  });

  it("builds android app monitor config for run requests", () => {
    const parsed = parseCliArgs([
      "run",
      "--device",
      "serial-1",
      "--case",
      "case-1",
      "--package",
      "com.example.app",
      "--android-app-monitor",
      "--monitor-main-only",
      "--monitor-cpu-threshold",
      "80",
      "--monitor-memory-threshold",
      "512",
      "--monitor-heap-dump"
    ]);

    expect(buildRequest(parsed).body).toEqual(
      expect.objectContaining({
        androidAppMonitor: {
          enabled: true,
          packageName: "com.example.app",
          includeSubprocesses: false,
          enableHeapDump: true,
          thresholds: {
            cpuPercent: { enabled: true, value: 80, sustainMs: 5000, cooldownMs: 30000 },
            pssMb: { enabled: true, value: 512, sustainMs: 5000, cooldownMs: 30000 }
          }
        }
      })
    );
  });

  it("requires a package name when android app monitor is enabled", () => {
    const parsed = parseCliArgs(["run", "--device", "serial-1", "--case", "case-1", "--android-app-monitor"]);

    expect(() => buildRequest(parsed)).toThrow("--monitor-package or --package is required when --android-app-monitor is enabled");
  });

  it("ignores the pnpm script argument separator", () => {
    expect(parseCliArgs(["--", "devices"]).command).toBe("devices");
  });

  it("builds a graph target-node run request", () => {
    const parsed = parseCliArgs([
      "graph-run",
      "--device",
      "serial-1",
      "--graph",
      "graph-1",
      "--targetKey",
      "classin.teacher.lesson.create",
      "--startStrategy",
      "keep_current"
    ]);

    expect(buildRequest(parsed)).toEqual({
      method: "POST",
      path: "/api/graph-runs",
      body: {
        deviceSerial: "serial-1",
        graphVersionId: undefined,
        graphId: "graph-1",
        targetNodeId: undefined,
        target: {
          key: "classin.teacher.lesson.create",
          name: undefined
        },
        startNodeId: undefined,
        platform: undefined,
        strategy: undefined,
        startStrategy: "keep_current",
        overlay: undefined
      }
    });
  });

  it("builds android app monitor config for graph-run requests", () => {
    const parsed = parseCliArgs([
      "graph-run",
      "--device",
      "serial-1",
      "--graph",
      "graph-1",
      "--targetKey",
      "classin.teacher.lesson.create",
      "--android-app-monitor",
      "--monitor-package",
      "cn.eeo.classin"
    ]);

    expect(buildRequest(parsed).body).toEqual(
      expect.objectContaining({
        androidAppMonitor: {
          enabled: true,
          packageName: "cn.eeo.classin",
          includeSubprocesses: true
        }
      })
    );
  });

  it("passes runtime overlay JSON to graph-run requests", () => {
    const parsed = parseCliArgs([
      "graph-run",
      "--device",
      "serial-1",
      "--graph",
      "graph-1",
      "--targetKey",
      "target",
      "--overlayJson",
      '{"id":"overlay-1","nodeExpectationOverrides":[{"nodeId":"node-target","expectations":[{"id":"overlay-text","type":"text","enabled":true,"params":{"expected":"新版文案"},"createdAt":"2026-06-12T00:00:00.000Z"}]}]}'
    ]);

    expect(buildRequest(parsed).body).toEqual(
      expect.objectContaining({
        overlay: {
          id: "overlay-1",
          nodeExpectationOverrides: [
            {
              nodeId: "node-target",
              expectations: [
                {
                  id: "overlay-text",
                  type: "text",
                  enabled: true,
                  params: { expected: "新版文案" },
                  createdAt: "2026-06-12T00:00:00.000Z"
                }
              ]
            }
          ]
        }
      })
    );
  });

  it("formats report links from run payloads", () => {
    expect(formatResponse("report", { run: { id: "run-1", reportHtmlPath: "runs/run-1/reports/report.html" } }, "http://localhost:4010")).toBe(
      "http://localhost:4010/artifacts/runs/run-1/reports/report.html"
    );
  });

  it("formats graph run start results", () => {
    expect(
      formatResponse(
        "graph-run",
        {
          run: { id: "run-1", status: "running" },
          routePlanId: "route-1",
          executionPlanId: "execution-1",
          targetNodeId: "node-create-lesson",
          nodeTestResult: {
            runId: "run-1",
            status: "running",
            active: true,
            targetNodeId: "node-create-lesson",
            targetNodeName: "新建课堂页",
            route: [{ edgeKey: "home.target" }],
            reportUrl: "/artifacts/runs/run-1/reports/report.html"
          }
        },
        "http://localhost:4010"
      )
    ).toBe(
      [
        "Started graph run run-1 (running)",
        "target=新建课堂页",
        "routeSteps=1",
        "report=http://localhost:4010/artifacts/runs/run-1/reports/report.html",
        "routePlan=route-1",
        "executionPlan=execution-1"
      ].join("\n")
    );
  });

  it("builds and formats graph run status requests", () => {
    expect(buildRequest(parseCliArgs(["graph-status", "--run", "run-1"]))).toEqual({
      method: "GET",
      path: "/api/graph-runs/run-1"
    });
    expect(
      formatResponse(
        "graph-status",
        {
          graphRun: {
            id: "run-1",
            status: "failed",
            targetNodeName: "新建课堂页",
            failedAt: {
              phase: "expectation",
              code: "EXPECTATION_FAILED"
            },
            reportUrl: "/artifacts/runs/run-1/reports/report.html"
          },
          nodeTestResult: {
            runId: "run-1",
            status: "failed",
            active: false,
            targetNodeName: "新建课堂页",
            failedAt: {
              phase: "expectation",
              code: "EXPECTATION_FAILED"
            },
            reportUrl: "/artifacts/runs/run-1/reports/report.html",
            evidence: {
              screenshots: ["/artifacts/runs/run-1/screenshots/failed.png"],
              videos: [],
              logs: [],
              failureArtifacts: ["/artifacts/runs/run-1/screenshots/failed.png"]
            }
          }
        },
        "http://localhost:4010"
      )
    ).toBe(
      [
        "Graph run run-1",
        "status=failed",
        "target=新建课堂页",
        "failedAt=expectation:EXPECTATION_FAILED",
        "report=http://localhost:4010/artifacts/runs/run-1/reports/report.html",
        "failureEvidence=1"
      ].join("\n")
    );
  });

  it("builds graph node list and graph report requests", () => {
    expect(buildRequest(parseCliArgs(["graph-nodes", "--graph", "graph-1"]))).toEqual({
      method: "GET",
      path: "/api/graphs?graphId=graph-1"
    });
    expect(
      formatResponse(
        "graph-nodes",
        {
          graphs: [
            {
              id: "graph-1",
              activeVersion: {
                id: "version-1",
                nodes: [
                  {
                    id: "node-1",
                    key: "classin.teacher.lesson.create",
                    name: "新建课堂页",
                    nodeType: "page"
                  }
                ]
              }
            }
          ]
        },
        "http://localhost:4010"
      )
    ).toBe("graph-1\tversion-1\tnode-1\tclassin.teacher.lesson.create\t新建课堂页\tpage");

    expect(buildRequest(parseCliArgs(["graph-report", "--run", "run-1"]))).toEqual({
      method: "GET",
      path: "/api/graph-runs/run-1"
    });
    expect(formatResponse("graph-report", { graphRun: { reportUrl: "/artifacts/runs/run-1/reports/report.html" } }, "http://localhost:4010")).toBe(
      "http://localhost:4010/artifacts/runs/run-1/reports/report.html"
    );
  });

  it("builds and formats graph quality requests", () => {
    expect(buildRequest(parseCliArgs(["graph-quality", "--graphVersion", "version-1", "--limit", "50"]))).toEqual({
      method: "GET",
      path: "/api/graphs/version-1/quality?limit=50"
    });

    expect(
      formatResponse(
        "graph-quality",
        {
          quality: {
            graphVersionId: "version-1",
            analyzedRunCount: 2,
            nodes: [
              {
                nodeId: "node-1",
                nodeName: "新建课堂页",
                passRate: 0.5,
                runCount: 2,
                latestReportUrl: "/artifacts/runs/run-2/reports/report.html"
              }
            ],
            edges: [
              {
                edgeId: "edge-1",
                edgeKey: "home.target",
                fromNodeName: "首页",
                toNodeName: "目标页",
                passRate: 1,
                runCount: 1
              }
            ]
          }
        },
        "http://localhost:4010"
      )
    ).toBe(
      [
        "graphVersion=version-1",
        "analyzedRuns=2",
        "node\tnode-1\t新建课堂页\t50% pass\t2 runs\t/artifacts/runs/run-2/reports/report.html",
        "edge\thome.target\t首页 -> 目标页\t100% pass\t1 runs\t-"
      ].join("\n")
    );
  });

  it("runs list devices through fetch", async () => {
    const output: string[] = [];
    const fetchMock = vi.fn(async () => jsonResponse({ devices: [{ id: "serial-1", serial: "serial-1", platform: "android", status: "online", name: "Pixel" }] }));

    const code = await runCli(["devices"], {
      fetch: fetchMock as unknown as typeof fetch,
      write: (text) => output.push(text),
      env: { AUTOTEST_SERVER_URL: "http://test-server" }
    });

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith("http://test-server/api/devices", {
      method: "GET",
      headers: undefined,
      body: undefined
    });
    expect(output.join("\n")).toContain("serial-1\tandroid\tonline\tPixel");
  });

  it("returns non-zero and prints API errors", async () => {
    const output: string[] = [];
    const fetchMock = vi.fn(async () => jsonResponse({ error: "deviceSerial is required" }, 400));

    const code = await runCli(["devices"], {
      fetch: fetchMock as unknown as typeof fetch,
      write: (text) => output.push(text),
      env: {}
    });

    expect(code).toBe(1);
    expect(output[0]).toBe("HTTP 400: deviceSerial is required");
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  } as Response;
}
