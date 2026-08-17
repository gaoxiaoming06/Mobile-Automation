import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScriptFlowDocument } from "@mobile-automation/script-flow";
import { nowIso, type ActionStep, type ArtifactRef, type StepResult } from "@mobile-automation/shared";
import type { RuntimeInterceptorRule } from "./runtime-interceptor.js";
import { scriptFlowSourceHash } from "./script-flow-verification.js";
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

  it("deletes legacy test-case tables and rebuilds the run schema", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-storage-legacy-"));
    const databasePath = path.join(tempRoot, "mobile-automation.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE test_cases (id TEXT PRIMARY KEY);
      CREATE TABLE steps (id TEXT PRIMARY KEY, case_id TEXT);
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        case_id TEXT,
        case_name TEXT NOT NULL,
        device_serial TEXT NOT NULL,
        status TEXT NOT NULL,
        config_json TEXT NOT NULL,
        case_snapshot_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        report_html_path TEXT,
        created_at TEXT NOT NULL
      );
    `);
    legacy.close();

    context = await createStorageContext(tempRoot);
    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    const tables = inspection.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name));
    const runColumns = inspection.prepare("PRAGMA table_info(runs)").all().map((row) => String(row.name));
    inspection.close();

    expect(tables).not.toContain("test_cases");
    expect(tables).not.toContain("steps");
    expect(runColumns).not.toContain("case_id");
    expect(runColumns).not.toContain("case_snapshot_json");
    expect(runColumns).toContain("run_snapshot_json");
  });

  it("removes legacy AI provider URLs and keys from persisted settings", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-storage-ai-settings-"));
    const databasePath = path.join(tempRoot, "mobile-automation.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE app_settings (
        setting_key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO app_settings VALUES (
        'ai_model',
        '{"enabled":true,"baseURL":"http://127.0.0.1:9999","apiKey":"legacy-secret","model":"gpt-5.4","timeoutMs":5000}',
        '2026-07-28T00:00:00.000Z'
      );
    `);
    legacy.close();

    context = await createStorageContext(tempRoot);
    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    const row = inspection.prepare("SELECT value_json FROM app_settings WHERE setting_key = 'ai_model'").get();
    inspection.close();

    expect(String(row?.value_json)).toBe('{"enabled":true,"model":"gpt-5.4","timeoutMs":5000}');
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
      runSnapshotJson: JSON.stringify({
        steps: [],
        sourceSnapshot: {
          kind: "script_flow",
          flowId: updated.id,
          version: updated.version,
          planDigest: "a".repeat(64),
          dependencies: [],
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

  it("round-trips the frozen execution profile in a ScriptFlow run snapshot", async () => {
    context = await createStorageContext();
    const document = scriptFlowDocument("校验班级主页");
    const flow = context.storage.createScriptFlow({
      sourceYaml: JSON.stringify(document),
      document
    });
    const executionProfile = {
      id: "execution-profile:classin:android:graph-v7",
      appId: "cn.eeo.classin",
      platform: "android",
      version: 7,
      status: "verified",
      digest: "f".repeat(64),
      createdAt: "2026-08-15T00:00:00.000Z",
      screens: [{
        screenRef: "classin.home",
        name: "班级主页",
        assetId: "page-home",
        graphVersionId: "graph-v7",
        evidence: [{
          id: "home-title",
          type: "resource_id",
          value: "cn.eeo.classin:id/home_title",
          weight: 1,
          critical: true
        }]
      }]
    };
    const run = context.storage.createRun({
      caseName: flow.name,
      deviceSerial: "device-1",
      configJson: JSON.stringify({ deviceSerial: "device-1", mode: "once", repeatCount: 1, stepIntervalMs: 0, stopOnFailure: true }),
      runSnapshotJson: JSON.stringify({
        steps: [],
        sourceSnapshot: {
          kind: "script_flow",
          flowId: flow.id,
          version: flow.version,
          planDigest: "a".repeat(64),
          executionPlatform: "android",
          executionProfile,
          dependencies: [],
          parsed: document
        }
      }),
      steps: []
    });

    expect(context.storage.getRun(run.id)?.sourceSnapshot?.executionProfile).toEqual(executionProfile);
  });

  it("keeps reusable temporary test history isolated by app and updates the latest run", async () => {
    context = await createStorageContext();
    const document = {
      ...scriptFlowDocument("从主页进入班级详情"),
      purpose: "navigation" as const
    };
    const first = context.storage.recordTemporaryTest({
      prompt: "从主页进入班级四十二号",
      sourceYaml: "version: 1\nname: 从主页进入班级详情",
      document,
      parameterValues: { className: "班级四十二号" },
      runId: "run-1"
    });
    const second = context.storage.recordTemporaryTest({
      prompt: "从主页进入班级四十二号",
      sourceYaml: "version: 1\nname: 从主页进入班级详情",
      document,
      parameterValues: { className: "班级四十二号" },
      runId: "run-2"
    });

    expect(second.id).toBe(first.id);
    expect(context.storage.listTemporaryTests({ appId: "cn.eeo.classin" })).toEqual([
      expect.objectContaining({
        id: first.id,
        prompt: "从主页进入班级四十二号",
        purpose: "navigation",
        parameterValues: { className: "班级四十二号" },
        lastRunId: "run-2",
        runCount: 2
      })
    ]);
    expect(context.storage.listTemporaryTests({ appId: "another.app" })).toEqual([]);
  });

  it("persists trial snapshot fields and finds verification by exact source hash", async () => {
    context = await createStorageContext();
    const sourceYaml = "version: 1\nname: 打开主页\napp: { id: cn.eeo.classin, platform: android }\nsteps: []\n";
    const sourceHash = "b".repeat(64);
    const flow = context.storage.createScriptFlow({
      sourceYaml,
      document: scriptFlowDocument("打开主页"),
      status: "draft"
    });
    const run = context.storage.createRun({
      caseName: flow.name,
      deviceSerial: "device-1",
      configJson: JSON.stringify({ deviceSerial: "device-1", mode: "once", repeatCount: 1, stepIntervalMs: 0, stopOnFailure: true }),
      runSnapshotJson: JSON.stringify({
        steps: [],
        sourceSnapshot: {
          kind: "script_flow",
          flowId: flow.id,
          version: flow.version,
          planDigest: "a".repeat(64),
          executionPurpose: "trial",
          sourceHash,
          verificationAssessment: {
            status: "needs_trial",
            sourceHash,
            reasons: ["当前脚本版本尚未通过试运行"],
            unresolvedStepIds: [],
            unresolvedOutcome: false
          },
          interactionAssets: [{
            stepId: "open-home",
            assetId: "interaction-home",
            key: "classin.home.tap.open-home",
            version: 3
          }],
          dependencies: [],
          sourceYaml,
          parsed: flow.parsed
        }
      }),
      steps: []
    });

    expect(context.storage.getRun(run.id)?.sourceSnapshot).toEqual(expect.objectContaining({
      executionPurpose: "trial",
      sourceHash,
      verificationAssessment: expect.objectContaining({ status: "needs_trial" }),
      interactionAssets: [{
        stepId: "open-home",
        assetId: "interaction-home",
        key: "classin.home.tap.open-home",
        version: 3
      }]
    }));

    const verification = context.storage.createFlowVerification({
      flowId: flow.id,
      flowVersion: flow.version,
      sourceHash,
      appId: flow.appId,
      platform: flow.platform,
      runId: run.id,
      status: "verified",
      coverage: {
        totalSteps: 1,
        verifiedSteps: 1,
        interactionAssetIds: [],
        pageAssetIds: ["classin.home"],
        humanConfirmedOutcome: false
      }
    });

    expect(context.storage.findLatestFlowVerification({
      sourceHash,
      appId: flow.appId,
      platform: flow.platform,
      status: "verified"
    })).toEqual(verification);
    expect(context.storage.findLatestFlowVerification({
      sourceHash: "c".repeat(64),
      appId: flow.appId,
      platform: flow.platform,
      status: "verified"
    })).toBeUndefined();

    expect(context.storage.updateFlowVerificationStatus(verification.id, "invalidated")).toMatchObject({ status: "invalidated" });
    expect(context.storage.findLatestFlowVerification({
      sourceHash,
      appId: flow.appId,
      platform: flow.platform,
      status: "verified"
    })).toBeUndefined();
  });

  it("creates a verified source record when a trial with an automatic oracle passes", async () => {
    context = await createStorageContext();
    const sourceYaml = "version: 1\nname: 校验主页\napp: { id: cn.eeo.classin, platform: android }\nsteps: []\n";
    const sourceHash = "d".repeat(64);
    const flow = context.storage.createScriptFlow({ sourceYaml, document: scriptFlowDocument("校验主页"), status: "draft" });
    const run = context.storage.createRun({
      caseName: flow.name,
      deviceSerial: "device-1",
      configJson: JSON.stringify({ deviceSerial: "device-1", mode: "once", repeatCount: 1, stepIntervalMs: 0, stopOnFailure: true }),
      runSnapshotJson: JSON.stringify({
        steps: [{ id: "verify-home" }],
        sourceSnapshot: {
          kind: "script_flow",
          flowId: flow.id,
          version: flow.version,
          planDigest: "e".repeat(64),
          executionPurpose: "trial",
          sourceHash,
          verificationAssessment: {
            status: "needs_trial",
            sourceHash,
            reasons: ["当前脚本版本尚未通过试运行"],
            unresolvedStepIds: [],
            unresolvedOutcome: false
          },
          interactionAssets: [{
            stepId: "verify-home",
            assetId: "interaction-home",
            key: "classin.home.tap.verify-home",
            version: 1
          }],
          dependencies: [],
          sourceYaml,
          parsed: flow.parsed
        }
      }),
      steps: []
    });

    context.storage.updateRunStatus(run.id, "passed");

    expect(context.storage.findLatestFlowVerification({
      sourceHash,
      appId: flow.appId,
      platform: flow.platform,
      status: "verified"
    })).toMatchObject({
      flowId: flow.id,
      flowVersion: flow.version,
      runId: run.id,
      status: "verified",
      coverage: {
        totalSteps: 1,
        verifiedSteps: 1,
        interactionAssetIds: ["interaction-home"],
        humanConfirmedOutcome: false
      }
    });
  });

  it("adds an active flow to the navigation index immediately after its trial becomes verified", async () => {
    context = await createStorageContext();
    const document = navigationFlowDocument("classin.add_friend");
    const sourceYaml = JSON.stringify(document);
    const sourceHash = scriptFlowSourceHash(sourceYaml);
    const flow = context.storage.createScriptFlow({ sourceYaml, document, status: "active" });
    expect(context.storage.listPageNavigationSegments({ appId: flow.appId, platform: flow.platform })).toEqual([]);
    const run = context.storage.createRun({
      caseName: flow.name,
      deviceSerial: "device-1",
      configJson: JSON.stringify({ deviceSerial: "device-1", mode: "once", repeatCount: 1, stepIntervalMs: 0, stopOnFailure: true }),
      runSnapshotJson: JSON.stringify({
        steps: [{ id: "open-more-menu" }, { id: "open-target" }],
        sourceSnapshot: {
          kind: "script_flow",
          flowId: flow.id,
          version: flow.version,
          planDigest: "f".repeat(64),
          executionPurpose: "trial",
          sourceHash,
          verificationAssessment: {
            status: "needs_trial",
            sourceHash,
            reasons: ["当前脚本版本尚未通过试运行"],
            unresolvedStepIds: ["open-more-menu", "open-target"],
            unresolvedOutcome: false
          },
          dependencies: [],
          sourceYaml,
          parsed: document
        }
      }),
      steps: []
    });

    context.storage.updateRunStatus(run.id, "passed");

    expect(context.storage.listPageNavigationSegments({ appId: flow.appId, platform: flow.platform })).toEqual([
      expect.objectContaining({ flowId: flow.id, flowVersion: flow.version, toPage: "classin.add_friend" })
    ]);
  });

  it("maintains navigation segments incrementally for active use cases", async () => {
    context = await createStorageContext();
    const first = navigationFlowDocument("classin.add_friend");
    const created = context.storage.createScriptFlow({
      sourceYaml: JSON.stringify(first),
      document: first,
      status: "active"
    });

    expect(context.storage.listPageNavigationSegments({ appId: "cn.eeo.classin", platform: "android" })).toEqual([]);

    recordVerifiedSource(context.storage, created, JSON.stringify(first));
    const verifiedFirst = context.storage.updateScriptFlow(created.id, {
      sourceYaml: JSON.stringify(first),
      document: first,
      status: "active"
    });

    expect(context.storage.listPageNavigationSegments({ appId: "cn.eeo.classin", platform: "android" })).toEqual([
      expect.objectContaining({
        flowId: verifiedFirst.id,
        flowVersion: 2,
        fromPage: "classin.home",
        toPage: "classin.add_friend",
        stepIds: ["open-more-menu", "open-target"]
      })
    ]);

    const second = navigationFlowDocument("classin.settings");
    context.storage.updateScriptFlow(created.id, {
      sourceYaml: JSON.stringify(second),
      document: second,
      status: "active"
    });
    expect(context.storage.listPageNavigationSegments({ appId: "cn.eeo.classin", platform: "android" })).toEqual([]);

    recordVerifiedSource(context.storage, created, JSON.stringify(second));
    context.storage.updateScriptFlow(created.id, {
      sourceYaml: JSON.stringify(second),
      document: second,
      status: "active"
    });
    expect(context.storage.listPageNavigationSegments({ appId: "cn.eeo.classin", platform: "android" })).toEqual([
      expect.objectContaining({
        flowId: created.id,
        flowVersion: 4,
        fromPage: "classin.home",
        toPage: "classin.settings"
      })
    ]);

    context.storage.updateScriptFlow(created.id, {
      sourceYaml: JSON.stringify(second),
      document: second,
      status: "archived"
    });
    expect(context.storage.listPageNavigationSegments({ appId: "cn.eeo.classin", platform: "android" })).toEqual([]);
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

  it("creates the first page asset library with an active version", async () => {
    context = await createStorageContext();

    const library = context.storage.createPageAssetLibrary({
      appId: "cn.eeo.classin",
      name: "ClassIn 页面资产",
      targetApp: {
        productId: "cn.eeo.classin",
        productName: "ClassIn",
        profiles: [{ id: "android:cn.eeo.classin", platform: "android", androidPackageName: "cn.eeo.classin", isPrimary: true }]
      }
    });

    expect(library).toEqual(expect.objectContaining({
      appId: "cn.eeo.classin",
      status: "active",
      platformScope: "mobile-both",
      activeVersionId: expect.any(String)
    }));
    expect(context.storage.getBusinessGraphVersion(library.activeVersionId ?? "")).toEqual(expect.objectContaining({
      graphId: library.id,
      version: 1,
      status: "active",
      nodes: []
    }));
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
      runSnapshotJson: JSON.stringify({ steps: [step] }),
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
    kind: "case",
    name,
    app: { id: "cn.eeo.classin" },
    start: { strategy: "keepCurrent" },
    parameters: {},
    steps: [],
    tags: ["teacher"]
  };
}

function navigationFlowDocument(targetPage: string): ScriptFlowDocument {
  return {
    version: 1,
    kind: "case",
    name: "主页导航",
    app: { id: "cn.eeo.classin" },
    start: { strategy: "keepCurrent" },
    parameters: {},
    steps: [
      {
        id: "open-more-menu",
        before: { screenRef: "classin.home" },
        tap: { target: { icon: "add", area: "topBar", position: "trailing" } }
      },
      {
        id: "open-target",
        tap: { target: { text: targetPage === "classin.settings" ? "设置" : "添加好友" } },
        after: { screenRef: targetPage }
      }
    ],
    tags: []
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

function recordVerifiedSource(storage: Storage, flow: ReturnType<Storage["createScriptFlow"]>, sourceYaml: string): void {
  const run = storage.createRun({
    caseName: flow.name,
    deviceSerial: "device-1",
    configJson: JSON.stringify({ deviceSerial: "device-1", mode: "once", repeatCount: 1, stepIntervalMs: 0, stopOnFailure: true }),
    runSnapshotJson: JSON.stringify({ steps: [] }),
    steps: []
  });
  storage.createFlowVerification({
    flowId: flow.id,
    flowVersion: flow.version,
    sourceHash: scriptFlowSourceHash(sourceYaml),
    appId: flow.appId,
    platform: flow.platform,
    runId: run.id,
    status: "verified",
    coverage: {
      totalSteps: 0,
      verifiedSteps: 0,
      interactionAssetIds: [],
      pageAssetIds: [],
      humanConfirmedOutcome: false
    }
  });
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
