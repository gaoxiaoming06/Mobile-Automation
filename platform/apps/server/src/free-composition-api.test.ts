import { describe, expect, it } from "vitest";
import type { BusinessGraphVersion, BusinessNode } from "@mobile-automation/graph-core";
import type { AssetCompositeCase, MetaFunction, ParameterProfile } from "@mobile-automation/shared";
import { FreeCompositionSessionRegistry } from "./free-composition-api.js";

const now = "2026-07-18T00:00:00.000Z";

describe("FreeCompositionSessionRegistry", () => {
  it("creates, previews, and marks an in-memory free-composition execution", () => {
    const registry = new FreeCompositionSessionRegistry(() => now);
    const session = registry.create({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "测试登录，循环 2 次",
      metaFunctions: [metaFunction()],
      compositeCases: []
    });

    const preview = registry.selectAndPreview({
      sessionId: session.id,
      candidateId: "meta_login",
      parameterProfileId: "profile_teacher",
      metaFunctions: [metaFunction()],
      compositeCases: [],
      parameterProfile: parameterProfile(),
      parameterDataRecords: [],
      graphVersion: graphVersion()
    });

    expect(preview.session.status).toBe("awaiting_confirmation");
    expect(preview.plan.status).toBe("ready");
    expect(preview.plan.compositeCaseId).toBe(`free_composition_case_${session.id}`);
    expect(registry.list({ appId: "cn.eeo.classin", platform: "android" })).toHaveLength(1);

    const running = registry.markExecutionStarted(session.id, "asset_composite_execution_1");
    expect(running.status).toBe("running");
    expect(running.executionId).toBe("asset_composite_execution_1");
  });

  it("never inserts a selected temporary plan into saved composite cases", () => {
    const registry = new FreeCompositionSessionRegistry(() => now);
    const savedCase = compositeCase();
    const session = registry.create({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "登录巡检",
      metaFunctions: [metaFunction()],
      compositeCases: [savedCase]
    });

    registry.selectAndPreview({
      sessionId: session.id,
      candidateId: savedCase.id,
      metaFunctions: [metaFunction()],
      compositeCases: [savedCase],
      graphVersion: graphVersion()
    });

    expect(savedCase.id).toBe("case_login");
    expect(savedCase.runMode).toBe("once");
  });
});

function metaFunction(): MetaFunction {
  return {
    id: "meta_login",
    appId: "cn.eeo.classin",
    platform: "android",
    name: "账号密码登录",
    parameters: [{ key: "phone", type: "string", required: true }],
    steps: [{ id: "reach-home", order: 1, kind: "reach_page", targetPageModelId: "page-home", enabled: true }],
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

function compositeCase(): AssetCompositeCase {
  return {
    id: "case_login",
    appId: "cn.eeo.classin",
    platform: "android",
    name: "登录巡检",
    runMode: "once",
    repeatCount: 1,
    stopOnFailure: true,
    steps: [{ id: "case-step-login", order: 1, metaFunctionId: "meta_login", enabled: true }],
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

function parameterProfile(): ParameterProfile {
  return {
    id: "profile_teacher",
    appId: "cn.eeo.classin",
    platform: "android",
    name: "教师账号",
    values: { phone: { type: "string", value: "18800000000" } },
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

function graphVersion(): BusinessGraphVersion {
  return {
    id: "graph-version",
    graphId: "graph",
    version: 1,
    status: "active",
    sourceSummary: [],
    createdAt: now,
    nodes: [pageNode()],
    edges: []
  };
}

function pageNode(): BusinessNode {
  return {
    id: "page-home",
    graphVersionId: "graph-version",
    key: "page-home",
    name: "主页",
    nodeType: "page",
    tags: ["page-asset"],
    status: "active",
    matchers: [],
    defaultExpectations: [],
    platformScope: "android",
    metadata: { assetRecordingConfirmed: true }
  };
}
