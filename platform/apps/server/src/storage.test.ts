import { access, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildExecutionPlan, planRoute, type ActionPolicy, type StateMatcher } from "@mobile-automation/graph-core";
import type { ActionStep, ArtifactRef, RunConfig, StepExpectation, StepExpectationResult, StepResult, StructuredFlow } from "@mobile-automation/shared";
import type { RuntimeInterceptorRule } from "./runtime-interceptor.js";

type StorageContext = {
  storage: {
    close(): void;
    createCase(input: { name: string; description?: string; steps: ActionStep[] }): unknown;
    listCases(): unknown[];
    findCaseByName(name: string): unknown;
    getCase(id: string): unknown;
    updateCase(id: string, input: { name: string; description?: string; steps: ActionStep[] }): unknown;
    deleteCase(id: string): boolean;
    createStructuredFlow(input: {
      name: string;
      description?: string;
      appId?: string;
      appName: string;
      platform: "android" | "ios";
      targetApp: StructuredFlow["targetApp"];
      appVersion: StructuredFlow["appVersion"];
      startState: StructuredFlow["startState"];
      endState: StructuredFlow["endState"];
      role?: string;
      startStrategy?: StructuredFlow["startStrategy"];
      tags?: string[];
      status?: StructuredFlow["status"];
      steps: StructuredFlow["steps"];
    }): StructuredFlow;
    listStructuredFlows(): StructuredFlow[];
    getStructuredFlow(id: string): StructuredFlow | undefined;
    updateStructuredFlow(
      id: string,
      input: {
        name: string;
        description?: string;
        appId?: string;
        appName: string;
        platform: "android" | "ios";
        targetApp: StructuredFlow["targetApp"];
        appVersion: StructuredFlow["appVersion"];
        startState: StructuredFlow["startState"];
        endState: StructuredFlow["endState"];
        role?: string;
        startStrategy?: StructuredFlow["startStrategy"];
        tags?: string[];
        status?: StructuredFlow["status"];
        steps: StructuredFlow["steps"];
      }
    ): StructuredFlow;
    deleteStructuredFlow(id: string): boolean;
    createRuntimeInterceptorRule(input: Omit<RuntimeInterceptorRule, "id" | "createdAt" | "updatedAt"> & { id?: string }): RuntimeInterceptorRule;
    listRuntimeInterceptorRules(filter?: { enabledOnly?: boolean; platform?: "android" | "ios"; appPackageName?: string; flowId?: string }): RuntimeInterceptorRule[];
    updateRuntimeInterceptorRule(id: string, patch: Partial<Omit<RuntimeInterceptorRule, "id" | "createdAt" | "updatedAt">>): RuntimeInterceptorRule | undefined;
    deleteRuntimeInterceptorRule(id: string): boolean;
    createRun(input: { caseId?: string; caseName: string; deviceSerial: string; configJson: string; caseSnapshotJson: string; steps: ActionStep[] }): { id: string };
    updateRunStatus(runId: string, status: string, endedAt?: string): void;
    updateRunReport(runId: string, relativePath: string): void;
    addStepResult(result: StepResult): void;
    addArtifact(artifact: ArtifactRef): void;
    getArtifact(id: string): ArtifactRef | undefined;
    addMetricSample(sample: {
      id: string;
      runId: string;
      stepResultId?: string;
      deviceSerial: string;
      sampledAt: string;
      cpuPercent?: number;
      memoryUsedKb?: number;
      memoryTotalKb?: number;
      batteryLevel?: number;
      batteryTemperatureC?: number;
      raw?: Record<string, unknown>;
    }): void;
    addDeviceEvent(event: {
      id: string;
      runId: string;
      stepResultId?: string;
      deviceSerial: string;
      type: "crash" | "anr" | "command_failed" | "device_lost" | "preview_lost" | "runner_error" | "video_unavailable" | "start_state_failed";
      severity: "info" | "warning" | "error";
      occurredAt: string;
      summary: string;
      detail?: string;
      artifactIds: string[];
    }): void;
    getRun(id: string): unknown;
    listRuns(limit?: number, offset?: number): unknown[];
    listRunIdsByStatus(status: string): string[];
    listRunsForCleanup(): Array<{ id: string; status: string; createdAt: string; endedAt?: string }>;
    writeArtifact(relativePath: string, bytes: Buffer | string): Promise<{ absolutePath: string; sizeBytes: number }>;
    deleteRun(runId: string): Promise<boolean>;
    createBusinessGraph(input: {
      appId: string;
      targetApp?: {
        androidPackageName?: string;
        iosBundleId?: string;
      };
      platformScope: "android" | "ios" | "mobile-both";
      name: string;
      status?: "draft" | "active" | "deprecated";
    }): {
      id: string;
    };
    listBusinessGraphs(): unknown[];
    findBusinessGraphByAppId(appId: string): unknown;
    updateBusinessGraphProfile(
      id: string,
      input: {
        appId?: string;
        targetApp?: {
          androidPackageName?: string;
          iosBundleId?: string;
        };
        platformScope?: "android" | "ios" | "mobile-both";
        name?: string;
        status?: "draft" | "active" | "deprecated";
      }
    ): unknown;
    createBusinessGraphVersion(input: { graphId: string; sourceSummary?: string[]; status?: "draft" | "active" | "archived" }): {
      id: string;
    };
    setActiveBusinessGraphVersion(graphId: string, versionId: string): unknown;
    createBusinessNode(input: {
      id?: string;
      graphVersionId: string;
      key: string;
      name: string;
      nodeType: "root" | "page" | "business_state" | "terminal";
      tags?: string[];
      status?: "draft" | "active" | "deprecated" | "rejected";
      matchers?: StateMatcher[];
      defaultExpectations?: StepExpectation[];
      platformScope?: "android" | "ios" | "mobile-both";
      metadata?: Record<string, unknown>;
    }): unknown;
    updateBusinessNodeStatus(nodeId: string, status: "draft" | "active" | "deprecated" | "rejected"): unknown;
    updateBusinessNodeDetails(
      nodeId: string,
      input: {
        key?: string;
        name?: string;
        nodeType?: "root" | "page" | "business_state" | "terminal";
        tags?: string[];
        metadata?: Record<string, unknown>;
        status?: "draft" | "active" | "deprecated" | "rejected";
        matchers?: StateMatcher[];
        platformScope?: "android" | "ios" | "mobile-both";
      }
    ): unknown;
    createOperationEdge(input: {
      id?: string;
      graphVersionId: string;
      fromNodeId: string;
      toNodeId: string;
      key: string;
      name: string;
      intent: string;
      status?: "draft" | "active" | "deprecated" | "rejected";
      source: "source_scan" | "exploration" | "manual_recording" | "manual_edit" | "imported" | "ai_draft";
      preconditions?: StepExpectation[];
      actionPolicies?: ActionPolicy[];
      expectations?: StepExpectation[];
      platformScope?: "android" | "ios" | "mobile-both";
      reliabilityScore?: number;
    }): unknown;
    updateOperationEdgeStatus(edgeId: string, status: "draft" | "active" | "deprecated" | "rejected"): unknown;
    getBusinessGraphVersion(id: string): unknown;
    getActiveBusinessGraphVersion(graphId: string): unknown;
    importSourceScanGraph(input: {
      graphId?: string;
      appId: string;
      targetApp?: {
        androidPackageName?: string;
        iosBundleId?: string;
      };
      name?: string;
      scanResult: {
        appId: string;
        targetApp?: {
          androidPackageName?: string;
          iosBundleId?: string;
        };
        platform: "android";
        repoPath: string;
        scannedAt: string;
        summary: {
          scannedFiles: number;
          manifestFiles: number;
          navigationFiles: number;
          layoutFiles: number;
          stringFiles: number;
          sourceFiles: number;
        };
        nodes: Array<{
          id: string;
          key: string;
          name: string;
          nodeType: "root" | "page" | "business_state" | "terminal";
          status: "draft";
          platformScope: "android";
          matchers: StateMatcher[];
          source: { sourceType: "source_scan"; filePath?: string; line?: number; confidence?: number };
          confidence: number;
          metadata: Record<string, unknown>;
        }>;
        edges: Array<{
          id: string;
          key: string;
          name: string;
          intent: string;
          fromNodeKey?: string;
          toNodeKey?: string;
          status: "draft";
          platformScope: "android";
          source: { sourceType: "source_scan"; filePath?: string; line?: number; confidence?: number };
          confidence: number;
          actionPolicies: ActionPolicy[];
          metadata: Record<string, unknown>;
        }>;
        warnings: Array<{ code: "UNSUPPORTED_PLATFORM" | "REPO_NOT_FOUND" | "FILE_LIMIT_REACHED" | "PARSE_WARNING"; message: string; filePath?: string; line?: number }>;
      };
    }): { graph: { id: string }; version: { id: string; nodes: unknown[]; edges: unknown[] }; importedNodeCount: number; importedEdgeCount: number; skippedEdgeCount: number };
    saveRoutePlan(plan: ReturnType<typeof planRoute>): void;
    getRoutePlan(id: string): ReturnType<typeof planRoute> | undefined;
  };
  tempRoot: string;
  artifactRoot: string;
  runArtifactPath(runId: string, kind: "screenshots" | "logs" | "reports" | "videos", fileName: string): string;
};

let context: StorageContext | undefined;

afterEach(async () => {
  context?.storage.close();
  const tempRoot = context?.tempRoot;
  context = undefined;
  delete process.env.DATA_DIR;
  vi.resetModules();
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("Storage", () => {
  it("creates, updates, lists, fetches, and deletes cases with ordered steps and expectations", async () => {
    context = await createStorageContext();
    const { storage } = context;
    const first = {
      ...tapStep("step-first", 9, 10, [textExpectation("expect-title", "首页")]),
      preconditions: [textExpectation("precondition-title", "登录页")]
    };
    const second = waitStep("step-second", 2_000);

    const created = storage.createCase({ name: "Login Flow", description: "smoke", steps: [first, second] }) as {
      id: string;
      name: string;
      version: number;
      steps: ActionStep[];
    };

    expect(created.name).toBe("Login Flow");
    expect(created.version).toBe(1);
    expect(created.steps.map((step) => step.order)).toEqual([1, 2]);
    expect(storage.listCases()).toHaveLength(1);
    expect((storage.listCases()[0] as { steps: ActionStep[] }).steps).toHaveLength(2);
    expect((storage.findCaseByName("Login Flow") as { id: string }).id).toBe(created.id);

    const fetched = storage.getCase(created.id) as { description?: string; steps: ActionStep[] };
    expect(fetched.description).toBe("smoke");
    expect(fetched.steps[0]?.preconditions?.[0]).toEqual(expect.objectContaining({ id: "precondition-title", type: "text" }));
    expect(fetched.steps[0]?.expectations?.[0]).toEqual(expect.objectContaining({ id: "expect-title", type: "text" }));

    const updated = storage.updateCase(created.id, { name: "Updated Flow", steps: [second] }) as {
      name: string;
      version: number;
      steps: ActionStep[];
    };
    expect(updated.name).toBe("Updated Flow");
    expect(updated.version).toBe(2);
    expect(updated.steps).toHaveLength(1);
    expect((storage.getCase(created.id) as { steps: ActionStep[] }).steps[0]?.type).toBe("wait");

    expect(storage.deleteCase(created.id)).toBe(true);
    expect(storage.getCase(created.id)).toBeUndefined();
  });

  it("creates, updates, lists, fetches, and deletes structured flows with state anchors and ordered steps", async () => {
    context = await createStorageContext();
    const { storage } = context;
    const legacyCase = storage.createCase({ name: "Legacy Still Works", steps: [tapStep("legacy-step", 12, 24)] }) as { id: string };
    const firstStep = structuredFlowStep("flow-step-open-class", 9, "首页", "班级详情");
    const secondStep = structuredFlowStep("flow-step-create-lesson", 99, "班级详情", "新建课堂");

    const created = storage.createStructuredFlow({
      name: "ClassIn Android v5.0.8 首页到新建课堂",
      description: "teacher smoke",
      appId: "classin-android",
      appName: "ClassIn",
      platform: "android",
      targetApp: {
        androidPackageName: "cn.eeo.classin"
      },
      appVersion: {
        displayVersion: "5.0.8",
        buildNumber: "99856",
        versionCode: "500899856",
        compatibleRange: ">=5.0.8 <5.1.0"
      },
      startState: flowState("state-home", "首页", "MainActivity", "我是教师"),
      endState: flowState("state-create-lesson", "新建课堂", "CreateLessonActivity", "新建课堂"),
      role: "teacher",
      startStrategy: "restart_app",
      tags: ["smoke", "teacher"],
      status: "active",
      steps: [firstStep, secondStep]
    });

    expect(created.version).toBe(1);
    expect(created.steps.map((step) => step.order)).toEqual([1, 2]);
    expect(created.steps[0]).toEqual(
      expect.objectContaining({
        id: "flow-step-open-class",
        beforeState: expect.objectContaining({ name: "首页" }),
        action: expect.objectContaining({ type: "tap_on_text" }),
        afterExpectations: [expect.objectContaining({ type: "text" })],
        systemGuards: [expect.objectContaining({ type: "no_crash" }), expect.objectContaining({ type: "app_alive" })],
        timing: expect.objectContaining({ transitionTimeoutMs: 5000 })
      })
    );
    expect(storage.listStructuredFlows()).toEqual([
      expect.objectContaining({
        id: created.id,
        appName: "ClassIn",
        platform: "android",
        targetApp: { androidPackageName: "cn.eeo.classin" },
        appVersion: expect.objectContaining({ displayVersion: "5.0.8", compatibleRange: ">=5.0.8 <5.1.0" }),
        startState: expect.objectContaining({ id: "state-home" }),
        endState: expect.objectContaining({ id: "state-create-lesson" }),
        steps: expect.arrayContaining([expect.objectContaining({ id: "flow-step-create-lesson", order: 2 })])
      })
    ]);
    expect(storage.getStructuredFlow(created.id)).toEqual(expect.objectContaining({ id: created.id, name: "ClassIn Android v5.0.8 首页到新建课堂" }));

    const updated = storage.updateStructuredFlow(created.id, {
      ...created,
      name: "ClassIn Android v5.0.8 首页到课堂",
      status: "draft",
      steps: [secondStep]
    });
    expect(updated).toEqual(
      expect.objectContaining({
        id: created.id,
        name: "ClassIn Android v5.0.8 首页到课堂",
        status: "draft",
        version: 2,
        steps: [expect.objectContaining({ id: "flow-step-create-lesson", order: 1 })]
      })
    );
    expect(storage.getCase(legacyCase.id)).toEqual(expect.objectContaining({ id: legacyCase.id, name: "Legacy Still Works" }));

    expect(storage.deleteStructuredFlow(created.id)).toBe(true);
    expect(storage.getStructuredFlow(created.id)).toBeUndefined();
  });

  it("persists runtime interceptor rules scoped by app and flow", async () => {
    context = await createStorageContext();
    const { storage } = context;

    const created = storage.createRuntimeInterceptorRule({
      id: "runtime-rule-subject-picker",
      name: "选择学科临时页",
      enabled: true,
      platformScope: "android",
      appPackageName: "cn.eeo.classin",
      flowId: "flow-teacher-create-lesson",
      matchers: [
        { type: "text", value: "选择学科" },
        { type: "activity", value: "SubjectPickerActivity" }
      ],
      action: {
        type: "tap_text",
        text: "关闭"
      }
    });

    expect(created).toEqual(
      expect.objectContaining({
        id: "runtime-rule-subject-picker",
        enabled: true,
        platformScope: "android",
        appPackageName: "cn.eeo.classin",
        flowId: "flow-teacher-create-lesson",
        matchers: expect.arrayContaining([expect.objectContaining({ type: "text", value: "选择学科" })])
      })
    );
    expect(storage.listRuntimeInterceptorRules({ enabledOnly: true, platform: "android", appPackageName: "cn.eeo.classin", flowId: "flow-teacher-create-lesson" })).toEqual([
      expect.objectContaining({ id: created.id, name: "选择学科临时页" })
    ]);
    expect(storage.listRuntimeInterceptorRules({ enabledOnly: true, platform: "ios", appPackageName: "cn.eeo.classin" })).toEqual([]);

    const disabled = storage.updateRuntimeInterceptorRule(created.id, { enabled: false, name: "选择学科临时页-停用" });
    expect(disabled).toEqual(expect.objectContaining({ enabled: false, name: "选择学科临时页-停用" }));
    expect(storage.listRuntimeInterceptorRules({ enabledOnly: true, appPackageName: "cn.eeo.classin" })).toEqual([]);
    expect(storage.deleteRuntimeInterceptorRule(created.id)).toBe(true);
    expect(storage.listRuntimeInterceptorRules()).toEqual([]);
  });

  it("persists run details, evidence, metrics, events, report path, and cleanup rows", async () => {
    context = await createStorageContext();
    const { storage } = context;
    const step = tapStep("step-tap", 120, 240);
    const config = runConfig("device-1");
    const run = storage.createRun({
      caseName: "Recorded Flow",
      deviceSerial: "device-1",
      configJson: JSON.stringify(config),
      caseSnapshotJson: JSON.stringify({ steps: [step] }),
      steps: [step]
    });
    const expectationResult: StepExpectationResult = {
      id: "expect-result-1",
      expectationId: "expect-title",
      type: "text",
      status: "passed",
      blocking: true,
      expected: "OCR text contains \"首页\".",
      actual: "首页",
      evidenceArtifactIds: ["artifact-step-shot"],
      checkedAt: "2026-06-09T09:00:02.000Z"
    };
    const stepResult: StepResult = {
      id: "step-result-1",
      runId: run.id,
      iterationIndex: 0,
      stepId: "step-tap",
      stepOrder: 1,
      type: "tap",
      status: "passed",
      startedAt: "2026-06-09T09:00:01.000Z",
      endedAt: "2026-06-09T09:00:02.000Z",
      durationMs: 1000,
      afterScreenshotId: "artifact-step-shot",
      artifacts: [],
      expectationResults: [expectationResult],
      metadata: { condition: { matched: true } }
    };

    storage.addStepResult(stepResult);
    storage.addArtifact({
      id: "artifact-step-shot",
      runId: run.id,
      stepResultId: stepResult.id,
      type: "screenshot",
      name: "after.png",
      path: "runs/run/screenshots/after.png",
      url: "/artifacts/runs/run/screenshots/after.png",
      mimeType: "image/png",
      sizeBytes: 12,
      createdAt: "2026-06-09T09:00:02.000Z"
    });
    storage.addMetricSample({
      id: "metric-1",
      runId: run.id,
      stepResultId: stepResult.id,
      deviceSerial: "device-1",
      sampledAt: "2026-06-09T09:00:03.000Z",
      cpuPercent: 12.5,
      memoryUsedKb: 2048,
      memoryTotalKb: 4096,
      batteryLevel: 80,
      raw: { source: "test" }
    });
    storage.addDeviceEvent({
      id: "event-1",
      runId: run.id,
      stepResultId: stepResult.id,
      deviceSerial: "device-1",
      type: "command_failed",
      severity: "warning",
      occurredAt: "2026-06-09T09:00:04.000Z",
      summary: "Command warning",
      detail: "mock detail",
      artifactIds: ["artifact-step-shot"]
    });
    storage.updateRunReport(run.id, "runs/run/reports/report.html");
    storage.updateRunStatus(run.id, "failed", "2026-06-09T09:00:05.000Z");

    const loaded = storage.getRun(run.id) as {
      status: string;
      reportHtmlPath?: string;
      stepResults: StepResult[];
      metrics: Array<{ cpuPercent?: number; raw?: Record<string, unknown> }>;
      events: Array<{ type: string; artifactIds: string[] }>;
      artifacts: ArtifactRef[];
    };
    expect(loaded.status).toBe("failed");
    expect(loaded.reportHtmlPath).toBe("runs/run/reports/report.html");
    expect(loaded.stepResults[0]?.artifacts[0]?.id).toBe("artifact-step-shot");
    expect(loaded.stepResults[0]?.expectationResults?.[0]).toEqual(expect.objectContaining({ type: "text", status: "passed" }));
    expect(loaded.metrics[0]).toEqual(expect.objectContaining({ cpuPercent: 12.5, raw: { source: "test" } }));
    expect(loaded.events[0]).toEqual(expect.objectContaining({ type: "command_failed", artifactIds: ["artifact-step-shot"] }));
    expect(loaded.artifacts).toHaveLength(1);
    expect(storage.getArtifact("artifact-step-shot")).toEqual(expect.objectContaining({ id: "artifact-step-shot", type: "screenshot" }));
    expect(storage.listRuns(1, 0).map((item) => (item as { id: string }).id)).toEqual([run.id]);
    expect(storage.listRunIdsByStatus("failed")).toEqual([run.id]);
    expect(storage.listRunsForCleanup()).toEqual([
      {
        id: run.id,
        status: "failed",
        createdAt: expect.any(String),
        endedAt: "2026-06-09T09:00:05.000Z"
      }
    ]);
  });

  it("writes artifacts under DATA_DIR and deletes run records with their files", async () => {
    context = await createStorageContext();
    const { storage, artifactRoot, runArtifactPath } = context;
    const step = tapStep("step-tap", 120, 240);
    const run = storage.createRun({
      caseName: "Artifact Flow",
      deviceSerial: "device-1",
      configJson: JSON.stringify(runConfig("device-1")),
      caseSnapshotJson: JSON.stringify({ steps: [step] }),
      steps: [step]
    });
    const relativePath = runArtifactPath(run.id, "reports", "report.html");
    const written = await storage.writeArtifact(relativePath, "<html>ok</html>");

    expect(written.absolutePath.startsWith(artifactRoot)).toBe(true);
    expect(written.sizeBytes).toBe(Buffer.byteLength("<html>ok</html>"));
    await expect(access(written.absolutePath)).resolves.toBeUndefined();

    expect(await storage.deleteRun(run.id)).toBe(true);
    expect(storage.getRun(run.id)).toBeUndefined();
    await expect(stat(written.absolutePath)).rejects.toThrow();
  });

  it("persists business graph versions, nodes, edges, matchers, action policies, and route plan snapshots", async () => {
    context = await createStorageContext();
    const { storage } = context;
    const legacyCase = storage.createCase({ name: "Legacy Still Works", steps: [tapStep("legacy-step", 12, 24)] }) as { id: string };
    const graph = storage.createBusinessGraph({
      appId: "classin-android",
      targetApp: {
        androidPackageName: "cn.eeo.classin"
      },
      platformScope: "android",
      name: "ClassIn Android"
    });
    const version = storage.createBusinessGraphVersion({ graphId: graph.id, sourceSummary: ["manual seed"] });
    const root = storage.createBusinessNode({
      id: "node-root",
      graphVersionId: version.id,
      key: "root",
      name: "启动页",
      nodeType: "root",
      status: "active",
      matchers: [{ ...matcher("matcher-root", "activity", "LauncherActivity"), critical: true }]
    }) as { id: string };
    const home = storage.createBusinessNode({
      id: "node-home",
      graphVersionId: version.id,
      key: "home",
      name: "首页",
      nodeType: "page",
      status: "active",
      tags: ["smoke"],
      matchers: [
        {
          ...matcher("matcher-home", "image_region", "screenshot-region:home:%E9%A6%96%E9%A1%B5"),
          threshold: 0.9,
          region: { x: 0, y: 0, width: 100, height: 100 },
          ignoreRegions: [{ x: 0, y: 0, width: 100, height: 8 }]
        }
      ],
      defaultExpectations: [textExpectation("expect-home", "首页")],
      metadata: { owner: "qa" }
    }) as { id: string };
    storage.createOperationEdge({
      id: "edge-root-home",
      graphVersionId: version.id,
      fromNodeId: root.id,
      toNodeId: home.id,
      key: "root_to_home",
      name: "进入首页",
      intent: "open_home",
      status: "active",
      source: "manual_edit",
      preconditions: [textExpectation("pre-root", "ClassIn")],
      actionPolicies: [actionPolicy("policy-tap-home", 1, false)],
      expectations: [textExpectation("expect-edge-home", "首页")],
      reliabilityScore: 0.95
    });

    storage.setActiveBusinessGraphVersion(graph.id, version.id);
    const active = storage.getActiveBusinessGraphVersion(graph.id) as {
      id: string;
      status: string;
      sourceSummary: string[];
      nodes: Array<{ id: string; matchers: StateMatcher[]; defaultExpectations: StepExpectation[]; metadata?: Record<string, unknown> }>;
      edges: Array<{ id: string; actionPolicies: ActionPolicy[]; preconditions: StepExpectation[]; expectations: StepExpectation[]; reliabilityScore?: number }>;
    };

    expect(active).toEqual(
      expect.objectContaining({
        id: version.id,
        status: "active",
        sourceSummary: ["manual seed"]
      })
    );
    expect(active.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "node-home",
          matchers: [
            expect.objectContaining({
              id: "matcher-home",
              type: "image_region",
              value: "screenshot-region:home:%E9%A6%96%E9%A1%B5",
              region: { x: 0, y: 0, width: 100, height: 100 },
              ignoreRegions: [{ x: 0, y: 0, width: 100, height: 8 }]
            })
          ],
          defaultExpectations: [expect.objectContaining({ id: "expect-home", type: "text" })],
          metadata: { owner: "qa" }
        })
      ])
    );
    expect(active.nodes.find((item) => item.id === "node-root")?.matchers).toEqual([
      expect.objectContaining({
        id: "matcher-root",
        critical: true
      })
    ]);
    expect(active.edges).toEqual([
      expect.objectContaining({
        id: "edge-root-home",
        actionPolicies: [expect.objectContaining({ id: "policy-tap-home", priority: 1, fallback: false })],
        preconditions: [expect.objectContaining({ id: "pre-root" })],
        expectations: [expect.objectContaining({ id: "expect-edge-home" })],
        reliabilityScore: 0.95
      })
    ]);

    const routePlan = planRoute({
      graphVersion: active as never,
      appId: "classin-android",
      targetApp: {
        androidPackageName: "cn.eeo.classin"
      },
      targetNodeId: "node-home",
      platform: "android",
      idFactory: (prefix: string) => `${prefix}-storage`,
      now: "2026-06-11T10:00:00.000Z"
    });
    storage.saveRoutePlan(routePlan);
    const executionPlan = buildExecutionPlan({
      routePlan,
      platform: "android",
      now: "2026-06-11T10:00:01.000Z",
      idFactory: (prefix: string) => `${prefix}-storage`
    });

    expect(storage.getRoutePlan(routePlan.id)).toEqual(
      expect.objectContaining({
        id: "route-storage",
        snapshot: {
          graphVersionId: version.id,
          nodeIds: ["node-root", "node-home"],
          edgeIds: ["edge-root-home"],
          createdAt: "2026-06-11T10:00:00.000Z"
        }
      })
    );
    expect(executionPlan.steps).toEqual([
      expect.objectContaining({
        edgeId: "edge-root-home",
        preconditions: [expect.objectContaining({ id: "pre-root" })],
        action: expect.objectContaining({ id: "policy-tap-home-step", type: "tap_on_element" }),
        expectations: [expect.objectContaining({ id: "expect-edge-home" }), expect.objectContaining({ id: "expect-home" })],
        systemGuards: [expect.objectContaining({ type: "no_crash" }), expect.objectContaining({ type: "app_alive" })]
      })
    ]);
    expect(storage.getCase(legacyCase.id)).toEqual(expect.objectContaining({ id: legacyCase.id, name: "Legacy Still Works" }));
    expect(storage.listBusinessGraphs()).toEqual([
      expect.objectContaining({
        id: graph.id,
        activeVersionId: version.id,
        status: "active",
        targetApp: {
          androidPackageName: "cn.eeo.classin"
        }
      })
    ]);
  });

  it("replaces business node matchers when page asset details are updated", async () => {
    context = await createStorageContext();
    const { storage } = context;
    const graph = storage.createBusinessGraph({
      appId: "classin",
      targetApp: {
        androidPackageName: "cn.eeo.classin",
        iosBundleId: "com.eeo.classin"
      },
      platformScope: "mobile-both",
      name: "ClassIn"
    });
    const version = storage.createBusinessGraphVersion({ graphId: graph.id, sourceSummary: ["manual seed"] });
    const node = storage.createBusinessNode({
      id: "node-home",
      graphVersionId: version.id,
      key: "home",
      name: "首页",
      nodeType: "page",
      status: "draft",
      platformScope: "android",
      matchers: [matcher("matcher-old", "resource_id", "cn.eeo.classin:id/old_home")]
    }) as { id: string };

    storage.updateBusinessNodeDetails(node.id, {
      status: "active",
      nodeType: "business_state",
      platformScope: "mobile-both",
      matchers: [
        { ...matcher("matcher-text", "text", "主页"), platformScope: "mobile-both" },
        { ...matcher("matcher-resource", "resource_id", "cn.eeo.classin:id/home"), platformScope: "android" }
      ]
    });

    const updated = storage.getBusinessGraphVersion(version.id) as {
      nodes: Array<{ id: string; nodeType: string; platformScope?: string; matchers: StateMatcher[] }>;
    };
    const updatedNode = updated.nodes.find((item) => item.id === node.id);

    expect(updatedNode?.nodeType).toBe("business_state");
    expect(updatedNode?.platformScope).toBe("mobile-both");
    expect(updatedNode?.matchers).toEqual([
      expect.objectContaining({ id: "matcher-resource", type: "resource_id", platformScope: "android" }),
      expect.objectContaining({ id: "matcher-text", type: "text", platformScope: "mobile-both" })
    ]);
    expect(updatedNode?.matchers.map((item) => item.id)).not.toContain("matcher-old");
  });

  it("updates business graph profile without changing its active version", async () => {
    context = await createStorageContext();
    const { storage } = context;
    const graph = storage.createBusinessGraph({
      appId: "classin-android-teacher-create-lesson",
      targetApp: {
        androidPackageName: "cn.eeo.classin"
      },
      platformScope: "android",
      name: "ClassIn 教师新建课堂业务图谱",
      status: "draft"
    });
    const version = storage.createBusinessGraphVersion({ graphId: graph.id, sourceSummary: ["legacy"] });
    storage.setActiveBusinessGraphVersion(graph.id, version.id);

    const updated = storage.updateBusinessGraphProfile(graph.id, {
      appId: "classin-android",
      name: "ClassIn Android 业务图谱",
      status: "active"
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: graph.id,
        appId: "classin-android",
        name: "ClassIn Android 业务图谱",
        status: "active",
        activeVersionId: version.id
      })
    );
    expect(storage.findBusinessGraphByAppId("classin-android")).toEqual(expect.objectContaining({ id: graph.id }));
    expect(storage.getActiveBusinessGraphVersion(graph.id)).toEqual(expect.objectContaining({ id: version.id }));
  });

  it("updates business graph node and edge lifecycle status for promotion", async () => {
    context = await createStorageContext();
    const { storage } = context;
    const graph = storage.createBusinessGraph({
      appId: "classin-android",
      platformScope: "android",
      name: "ClassIn Android"
    });
    const version = storage.createBusinessGraphVersion({ graphId: graph.id, sourceSummary: ["promotion"] });
    const start = storage.createBusinessNode({
      id: "node-start",
      graphVersionId: version.id,
      key: "start",
      name: "起点",
      nodeType: "page",
      status: "active"
    }) as { id: string };
    const draftNode = storage.createBusinessNode({
      id: "node-draft",
      graphVersionId: version.id,
      key: "draft",
      name: "草稿页",
      nodeType: "page",
      status: "draft"
    }) as { id: string };
    const draftEdge = storage.createOperationEdge({
      id: "edge-draft",
      graphVersionId: version.id,
      fromNodeId: start.id,
      toNodeId: draftNode.id,
      key: "start_to_draft",
      name: "进入草稿页",
      intent: "open_draft",
      status: "draft",
      source: "exploration"
    }) as { id: string };

    storage.updateBusinessNodeStatus(draftNode.id, "active");
    storage.updateOperationEdgeStatus(draftEdge.id, "active");

    const loaded = storage.getBusinessGraphVersion(version.id) as {
      nodes: Array<{ id: string; status: string }>;
      edges: Array<{ id: string; status: string }>;
    };
    expect(loaded.nodes.find((node) => node.id === draftNode.id)?.status).toBe("active");
    expect(loaded.edges.find((edge) => edge.id === draftEdge.id)?.status).toBe("active");
  });

  it("imports source scan candidates as a draft business graph version", async () => {
    context = await createStorageContext();
    const { storage } = context;
    const imported = storage.importSourceScanGraph({
      appId: "classin-android",
      name: "ClassIn Android",
      scanResult: {
        appId: "classin-android",
        platform: "android",
        repoPath: "/repo",
        scannedAt: "2026-06-11T10:00:00.000Z",
        summary: {
          scannedFiles: 2,
          manifestFiles: 1,
          navigationFiles: 1,
          layoutFiles: 0,
          stringFiles: 0,
          sourceFiles: 0
        },
        nodes: [
          sourceNode("node-root", "activity:MainActivity", "启动页", "root", [matcher("matcher-main", "activity", "com.demo.MainActivity")]),
          sourceNode("node-home", "fragment:HomeFragment", "首页", "page", [matcher("matcher-home", "text", "首页")])
        ],
        edges: [
          {
            id: "edge-root-home",
            key: "nav:root-home",
            name: "进入首页",
            intent: "open_home",
            fromNodeKey: "activity:MainActivity",
            toNodeKey: "fragment:HomeFragment",
            status: "draft",
            platformScope: "android",
            source: { sourceType: "source_scan", filePath: "res/navigation/main.xml", line: 9, confidence: 0.8 },
            confidence: 0.8,
            actionPolicies: [actionPolicy("policy-source", 1, false)],
            metadata: {}
          },
          {
            id: "edge-skipped",
            key: "nav:missing",
            name: "缺失目标",
            intent: "missing",
            fromNodeKey: "missing",
            toNodeKey: "fragment:HomeFragment",
            status: "draft",
            platformScope: "android",
            source: { sourceType: "source_scan", filePath: "res/navigation/main.xml", line: 12, confidence: 0.3 },
            confidence: 0.3,
            actionPolicies: [],
            metadata: {}
          }
        ],
        warnings: []
      }
    });

    expect(imported.importedNodeCount).toBe(2);
    expect(imported.importedEdgeCount).toBe(1);
    expect(imported.skippedEdgeCount).toBe(1);
    expect(imported.version).toEqual(
      expect.objectContaining({
        status: "draft",
        nodes: expect.arrayContaining([
          expect.objectContaining({
            key: "fragment:HomeFragment",
            status: "draft",
            matchers: [expect.objectContaining({ type: "text", value: "首页" })],
            metadata: expect.objectContaining({
              candidateId: "node-home",
              candidateKey: "fragment:HomeFragment",
              confidence: 0.72,
              source: expect.objectContaining({ sourceType: "source_scan", filePath: "AndroidManifest.xml" })
            })
          })
        ]),
        edges: [
          expect.objectContaining({
            source: "source_scan",
            status: "draft",
            reliabilityScore: 0.8
          })
        ]
      })
    );

    const importedAgain = storage.importSourceScanGraph({
      graphId: imported.graph.id,
      appId: "classin-android",
      scanResult: {
        appId: "classin-android",
        platform: "android",
        repoPath: "/repo",
        scannedAt: "2026-06-11T10:00:00.000Z",
        summary: {
          scannedFiles: 1,
          manifestFiles: 1,
          navigationFiles: 0,
          layoutFiles: 0,
          stringFiles: 0,
          sourceFiles: 0
        },
        nodes: [sourceNode("node-home", "fragment:HomeFragment", "首页", "page", [matcher("matcher-home", "text", "首页")])],
        edges: [],
        warnings: []
      }
    });

    expect(importedAgain.importedNodeCount).toBe(1);
    expect(importedAgain.version.id).not.toBe(imported.version.id);
    expect(importedAgain.version.nodes[0]).toEqual(
      expect.objectContaining({
        key: "fragment:HomeFragment",
        metadata: expect.objectContaining({ candidateId: "node-home" })
      })
    );
  });
});

async function createStorageContext(): Promise<StorageContext> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-storage-"));
  process.env.DATA_DIR = tempRoot;
  vi.resetModules();
  const [{ Storage }, artifacts] = await Promise.all([import("./storage.js"), import("./artifacts.js")]);
  const storage = new Storage();
  await storage.ensureDirs();
  return {
    storage,
    tempRoot,
    artifactRoot: artifacts.artifactRoot,
    runArtifactPath: artifacts.runArtifactPath
  };
}

function tapStep(id: string, x: number, y: number, expectations: StepExpectation[] = []): ActionStep {
  return {
    id,
    order: 99,
    type: "tap",
    enabled: true,
    params: {},
    coordinate: { x, y, xRatio: x / 1080, yRatio: y / 2400, deviceWidth: 1080, deviceHeight: 2400 },
    expectations,
    createdAt: "2026-06-09T09:00:00.000Z"
  };
}

function waitStep(id: string, durationMs: number): ActionStep {
  return {
    id,
    order: 99,
    type: "wait",
    enabled: true,
    params: { durationMs },
    createdAt: "2026-06-09T09:00:00.000Z"
  };
}

function textExpectation(id: string, expected: string): StepExpectation {
  return {
    id,
    type: "text",
    enabled: true,
    params: { expected, mode: "contains" },
    createdAt: "2026-06-09T09:00:00.000Z"
  };
}

function flowState(id: string, name: string, activity: string, text: string): StructuredFlow["startState"] {
  return {
    id,
    name,
    matchers: [
      {
        id: `${id}-activity`,
        type: "activity",
        value: activity,
        weight: 0.7,
        critical: true
      },
      {
        id: `${id}-text`,
        type: "text",
        value: text,
        weight: 0.3
      }
    ],
    expectations: [textExpectation(`${id}-expect`, text)],
    screenshotAnchor: {
      artifactId: `${id}-baseline`,
      threshold: 0.9,
      region: { x: 0, y: 0, width: 1080, height: 2400 }
    }
  };
}

function structuredFlowStep(id: string, order: number, beforeText: string, afterText: string): StructuredFlow["steps"][number] {
  const createdAt = "2026-06-14T09:00:00.000Z";
  return {
    id,
    order,
    title: `${beforeText} -> ${afterText}`,
    enabled: true,
    beforeState: flowState(`${id}-before`, beforeText, "MainActivity", beforeText),
    action: {
      id: `${id}-action`,
      order,
      type: "tap_on_text",
      enabled: true,
      title: `点击${afterText}`,
      params: {
        text: afterText,
        mode: "contains",
        timeoutMs: 3000,
        intervalMs: 300
      },
      createdAt
    },
    afterExpectations: [textExpectation(`${id}-after`, afterText)],
    systemGuards: [
      {
        ...textExpectation(`${id}-no-crash`, "no crash"),
        type: "no_crash",
        params: { blocking: true }
      },
      {
        ...textExpectation(`${id}-app-alive`, "app alive"),
        type: "app_alive",
        params: { blocking: true }
      }
    ],
    timing: {
      transitionTimeoutMs: 5000,
      pollIntervalMs: 300,
      stableSampleCount: 2
    },
    source: {
      type: "manual_recording",
      deviceSerial: "device-1"
    },
    artifacts: {
      beforeScreenshotId: `${id}-before-shot`,
      afterScreenshotId: `${id}-after-shot`
    },
    createdAt
  };
}

function matcher(id: string, type: StateMatcher["type"], value: string): StateMatcher {
  return {
    id,
    type,
    value,
    weight: 1
  };
}

function sourceNode(id: string, key: string, name: string, nodeType: "root" | "page" | "business_state" | "terminal", matchers: StateMatcher[]) {
  return {
    id,
    key,
    name,
    nodeType,
    status: "draft" as const,
    platformScope: "android" as const,
    matchers,
    source: {
      sourceType: "source_scan" as const,
      filePath: "AndroidManifest.xml",
      line: 1,
      confidence: 0.72
    },
    confidence: 0.72,
    metadata: {
      sourceType: "test"
    }
  };
}

function actionPolicy(id: string, priority: number, fallback: boolean): ActionPolicy {
  return {
    id,
    priority,
    fallback,
    action: {
      id: `${id}-step`,
      order: 1,
      type: "tap_on_element",
      enabled: true,
      params: {
        locator: {
          strategy: "android_uiautomator",
          resourceId: `cn.eeo.classin:id/${id}`
        }
      },
      createdAt: "2026-06-11T10:00:00.000Z"
    },
    reliabilityHint: "high"
  };
}

function runConfig(deviceSerial: string): RunConfig {
  return {
    deviceSerial,
    mode: "once",
    repeatCount: 1,
    stepIntervalMs: 0,
    stopOnFailure: true,
    recordVideo: true,
    keepVideoOnSuccess: true
  };
}
