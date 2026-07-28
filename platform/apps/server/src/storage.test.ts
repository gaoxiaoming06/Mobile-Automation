import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScriptFlowDocument } from "@mobile-automation/script-flow";
import { nowIso, type ActionStep, type ArtifactRef, type StepResult } from "@mobile-automation/shared";
import type { RuntimeInterceptorRule } from "./runtime-interceptor.js";
import type { Storage } from "./storage.js";

type StorageContext = {
  storage: Storage;
  tempRoot: string;
};

describe("Storage", () => {
  let context: StorageContext | undefined;

  afterEach(async () => {
    context?.storage.close();
    if (context) {
      await rm(context.tempRoot, { recursive: true, force: true });
    }
    context = undefined;
    delete process.env.DATA_DIR;
  });

  it("persists ScriptFlow versions and keeps the run source snapshot", async () => {
    context = await createStorageContext();
    const firstDocument = scriptFlowDocument("创建课堂");
    const firstYaml = "version: 1\nname: 创建课堂\napp: { id: cn.eeo.classin, platform: android }\nsteps: []\n";
    const created = context.storage.createScriptFlow({ sourceYaml: firstYaml, document: firstDocument });

    const secondDocument = scriptFlowDocument("创建课堂但不发布");
    const secondYaml = firstYaml.replace("创建课堂", "创建课堂但不发布");
    const updated = context.storage.updateScriptFlow(created.id, {
      sourceYaml: secondYaml,
      document: secondDocument,
      status: "active"
    });

    expect(updated).toEqual(expect.objectContaining({ version: 2, status: "active" }));
    expect(context.storage.listScriptFlowVersions(created.id).map((item) => item.version)).toEqual([2, 1]);

    const run = context.storage.createRun({
      caseName: updated.name,
      deviceSerial: "device-1",
      configJson: JSON.stringify({ deviceSerial: "device-1", mode: "once", repeatCount: 1, stepIntervalMs: 0, stopOnFailure: true }),
      caseSnapshotJson: JSON.stringify({
        steps: [],
        sourceSnapshot: {
          kind: "script_flow",
          flowId: updated.id,
          version: updated.version,
          sourceYaml: updated.sourceYaml,
          parsed: updated.parsed
        }
      }),
      steps: []
    });

    expect(context.storage.getRun(run.id)?.sourceSnapshot).toEqual(expect.objectContaining({ flowId: created.id, version: 2 }));
    expect(context.storage.deleteScriptFlow(created.id)).toBe(true);
    expect(context.storage.getRun(run.id)?.sourceSnapshot).toEqual(expect.objectContaining({ sourceYaml: secondYaml }));
  });

  it("persists page identity assets without operation edges", async () => {
    context = await createStorageContext();
    const graph = context.storage.createBusinessGraph({
      appId: "cn.eeo.classin",
      targetApp: {
        profiles: [{ id: "classin-android", platform: "android", androidPackageName: "cn.eeo.classin" }]
      },
      platformScope: "android",
      name: "ClassIn 页面资产"
    });
    const version = context.storage.createBusinessGraphVersion({ graphId: graph.id, status: "active" });
    context.storage.setActiveBusinessGraphVersion(graph.id, version.id);
    const page = context.storage.createBusinessNode({
      graphVersionId: version.id,
      key: "classin.home",
      name: "主页",
      nodeType: "page",
      tags: ["page-asset"],
      status: "active",
      matchers: [
        { id: "matcher-home", type: "ocr_text", value: "主页", weight: 3, critical: true, platformScope: "android" }
      ],
      defaultExpectations: [],
      platformScope: "android",
      metadata: { assetRecordingConfirmed: true }
    });

    expect(context.storage.findBusinessNodeByKey(version.id, page.key)).toEqual(expect.objectContaining({ name: "主页" }));
  });

  it("persists runtime interceptor rules", async () => {
    context = await createStorageContext();
    const rule = context.storage.createRuntimeInterceptorRule(runtimeRule());

    expect(context.storage.listRuntimeInterceptorRules({ enabledOnly: true, appPackageName: "cn.eeo.classin" })).toHaveLength(1);
    expect(context.storage.updateRuntimeInterceptorRule(rule.id, { enabled: false })?.enabled).toBe(false);
    expect(context.storage.deleteRuntimeInterceptorRule(rule.id)).toBe(true);
  });

  it("persists run evidence and report metadata", async () => {
    context = await createStorageContext();
    const step = tapStep();
    const run = context.storage.createRun({
      caseName: "视觉点击",
      deviceSerial: "device-1",
      configJson: JSON.stringify({ deviceSerial: "device-1" }),
      caseSnapshotJson: JSON.stringify({ steps: [step] }),
      steps: [step]
    });
    const result: StepResult = {
      id: "result-1",
      runId: run.id,
      iterationIndex: 0,
      stepId: step.id,
      stepOrder: 1,
      type: "tap",
      status: "passed",
      startedAt: nowIso(),
      endedAt: nowIso(),
      durationMs: 12,
      artifacts: [],
      expectationResults: [],
      metadata: { source: "script_flow" }
    };
    const artifact: ArtifactRef = {
      id: "artifact-1",
      runId: run.id,
      stepResultId: result.id,
      type: "screenshot",
      name: "after.png",
      path: "runs/demo/after.png",
      url: "/artifacts/runs/demo/after.png",
      createdAt: nowIso()
    };
    context.storage.addStepResult(result);
    context.storage.addArtifact(artifact);
    context.storage.updateRunReport(run.id, "runs/demo/report.html");
    context.storage.updateRunStatus(run.id, "passed", nowIso());

    expect(context.storage.getRun(run.id)).toEqual(expect.objectContaining({
      status: "passed",
      reportHtmlPath: "runs/demo/report.html",
      stepResults: [expect.objectContaining({ id: result.id })],
      artifacts: [expect.objectContaining({ id: artifact.id })]
    }));
  });

});

async function createStorageContext(existingRoot?: string): Promise<StorageContext> {
  const tempRoot = existingRoot ?? await mkdtemp(path.join(os.tmpdir(), "mobile-automation-storage-"));
  process.env.DATA_DIR = tempRoot;
  vi.resetModules();
  const { Storage: StorageConstructor } = await import("./storage.js");
  const storage = new StorageConstructor();
  await storage.ensureDirs();
  return { storage, tempRoot };
}

function scriptFlowDocument(name: string): ScriptFlowDocument {
  return {
    version: 1,
    name,
    app: { id: "cn.eeo.classin", platform: "android" },
    start: { strategy: "keepCurrent" },
    parameters: {},
    steps: [],
    tags: ["teacher"]
  };
}

function runtimeRule(): Omit<RuntimeInterceptorRule, "id" | "createdAt" | "updatedAt"> {
  return {
    name: "关闭升级提示",
    enabled: true,
    platformScope: "android",
    appPackageName: "cn.eeo.classin",
    matchers: [{ type: "text", value: "稍后再说" }],
    action: { type: "tap_text", text: "稍后再说" }
  };
}

function tapStep(): ActionStep {
  return {
    id: "step-1",
    order: 1,
    type: "tap",
    enabled: true,
    params: {},
    coordinate: { x: 100, y: 200 },
    createdAt: nowIso()
  };
}
