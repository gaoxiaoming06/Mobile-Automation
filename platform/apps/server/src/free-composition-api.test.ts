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

  it("creates a single fixed route candidate instead of using the detected current page", () => {
    const registry = new FreeCompositionSessionRegistry(() => now);
    const session = registry.create({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "跳转到空间",
      metaFunctions: [],
      compositeCases: [],
      currentPage: {
        pageModelId: "page-login",
        pageModelName: "登录"
      },
      pageAssets: [
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-login", pageModelName: "登录", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-home", pageModelName: "主页", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-space", pageModelName: "空间", status: "active" }
      ],
      pageTransitions: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          sourcePageModelId: "page-login",
          sourcePageModelName: "登录",
          targetPageModelId: "page-home",
          targetPageModelName: "主页",
          pageElementId: "login-button",
          pageElementLabel: "登录按钮",
          pageTransitionId: "edge-login-home",
          status: "active"
        },
        {
          appId: "cn.eeo.classin",
          platform: "android",
          sourcePageModelId: "page-home",
          sourcePageModelName: "主页",
          targetPageModelId: "page-space",
          targetPageModelName: "空间",
          pageElementId: "open-space",
          pageElementLabel: "打开空间",
          pageTransitionId: "edge-home-space",
          status: "active"
        }
      ]
    });

    expect(session.resolution.candidates).toHaveLength(1);
    expect(session.resolution.candidates[0]).toMatchObject({
      kind: "generated_flow",
      name: "主页 / 打开空间 → 空间",
      composedCandidateIds: ["page_transition:page-home:open-space:page-space"]
    });
  });

  it("stores AI planner hints on newly created sessions", () => {
    const registry = new FreeCompositionSessionRegistry(() => now);
    const session = registry.create({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "帮我换成老师账号 12133333302",
      metaFunctions: [
        { ...metaFunction(), id: "meta_logout", name: "退出登录", parameters: [] },
        metaFunction()
      ],
      compositeCases: [],
      aiPlanner: {
        status: "used",
        orderedAssetNames: ["退出登录", "账号密码登录"],
        runtimeOverrides: { phone: "12133333302" }
      }
    } as Parameters<FreeCompositionSessionRegistry["create"]>[0]);

    expect(session.resolution.aiPlanner).toMatchObject({ status: "used" });
    expect(session.resolution.intent.runtimeOverrides).toMatchObject({ phone: "12133333302" });
    expect(session.resolution.candidates[0]).toMatchObject({
      kind: "generated_flow",
      composedCandidateIds: ["meta_logout", "meta_login"]
    });
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
