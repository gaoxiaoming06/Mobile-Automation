import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
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
