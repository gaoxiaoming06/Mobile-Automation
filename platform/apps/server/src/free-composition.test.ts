import { describe, expect, it } from "vitest";

import { resolveFreeComposition } from "./free-composition.js";

const now = "2026-07-17T00:00:00.000Z";

function metaFunction(overrides: Record<string, unknown> = {}) {
  return {
    id: "meta_login",
    appId: "cn.eeo.classin",
    platform: "android" as const,
    name: "账号密码登录",
    description: "输入账号密码并进入主页",
    parameters: [
      { key: "phone", type: "string" as const, required: true },
      { key: "password", type: "string" as const, required: true }
    ],
    steps: [],
    status: "active" as const,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function compositeCase(overrides: Record<string, unknown> = {}) {
  return {
    id: "case_login",
    appId: "cn.eeo.classin",
    platform: "android" as const,
    name: "登录流程巡检",
    description: "账号密码登录后验证主页",
    runMode: "once" as const,
    repeatCount: 1,
    stopOnFailure: true,
    steps: [
      {
        id: "case_step_login",
        order: 1,
        metaFunctionId: "meta_login",
        enabled: true
      }
    ],
    status: "active" as const,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("resolveFreeComposition", () => {
  it("resolves an active login flow and parses an explicit repeat count", () => {
    const result = resolveFreeComposition("我想测试登录流程，循环 50 次", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [metaFunction()],
      compositeCases: [compositeCase()]
    });

    expect(result.status).toBe("ready");
    expect(result.intent).toMatchObject({ runMode: "repeat_n", repeatCount: 50 });
    expect(result.candidates[0]).toMatchObject({ id: "case_login", kind: "composite_case" });
  });

  it("asks for clarification when a generic course-creation request matches distinct flows", () => {
    const result = resolveFreeComposition("帮我测试一下建课", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [
        metaFunction({ id: "meta_new_class", name: "新建课堂" }),
        metaFunction({ id: "meta_public_class", name: "新建公开课" })
      ],
      compositeCases: []
    });

    expect(result.status).toBe("needs_clarification");
    expect(result.candidates.map((candidate) => candidate.name)).toEqual([
      "新建课堂",
      "新建公开课"
    ]);
  });

  it("does not expose inactive assets as a candidate", () => {
    const result = resolveFreeComposition("测试登录", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [metaFunction({ status: "deprecated" })],
      compositeCases: []
    });

    expect(result.status).toBe("missing_assets");
    expect(result.candidates).toEqual([]);
  });

  it("resolves an app launch prompt as a built-in system action without saved assets", () => {
    const result = resolveFreeComposition("打开app", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: []
    });

    expect(result.status).toBe("ready");
    expect(result.candidates[0]).toMatchObject({
      id: "system_action:launch_app",
      kind: "system_action",
      name: "启动 App",
      appId: "cn.eeo.classin",
      systemAction: "launch_app",
      parameterKeys: []
    });
  });

  it("can resolve a page task directly when no meta function has been created yet", () => {
    const result = resolveFreeComposition("进入登录页面 然后发起登录", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      pageTasks: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          pageModelId: "page-login",
          pageModelName: "登录",
          pageTaskId: "login-task-account-password",
          pageTaskName: "账号密码登录",
          parameterKeys: ["phone", "password"],
          status: "active"
        }
      ]
    });

    expect(result.status).toBe("ready");
    expect(result.candidates[0]).toMatchObject({
      kind: "page_task",
      pageModelId: "page-login",
      pageTaskId: "login-task-account-password",
      name: "登录 / 账号密码登录",
      parameterKeys: ["phone", "password"]
    });
  });

  it("can resolve an active page transition directly", () => {
    const result = resolveFreeComposition("打开新建公开课", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      pageTransitions: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          sourcePageModelId: "page-home",
          sourcePageModelName: "主页",
          targetPageModelId: "page-public",
          targetPageModelName: "新建公开课",
          pageElementId: "create-public",
          pageElementLabel: "创建公开课",
          pageTransitionId: "edge-home-public",
          pageTransitionName: "主页 -> 新建公开课",
          status: "active"
        }
      ]
    });

    expect(result.status).toBe("ready");
    expect(result.candidates[0]).toMatchObject({
      kind: "page_transition",
      name: "主页 / 创建公开课 → 新建公开课",
      sourcePageModelId: "page-home",
      targetPageModelId: "page-public",
      pageElementId: "create-public"
    });
  });

  it("plans a single generated route from the current page to the requested target page", () => {
    const result = resolveFreeComposition("跳转到主页", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      currentPage: {
        pageModelId: "page-login",
        pageModelName: "登录"
      },
      pageAssets: [
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-login", pageModelName: "登录", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-home", pageModelName: "主页", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-space", pageModelName: "空间", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-search", pageModelName: "搜索", status: "active" }
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
          pageTransitionName: "登录 -> 主页",
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
          pageTransitionName: "主页 -> 空间",
          status: "active"
        },
        {
          appId: "cn.eeo.classin",
          platform: "android",
          sourcePageModelId: "page-home",
          sourcePageModelName: "主页",
          targetPageModelId: "page-search",
          targetPageModelName: "搜索",
          pageElementId: "open-search",
          pageElementLabel: "搜索",
          pageTransitionId: "edge-home-search",
          pageTransitionName: "主页 -> 搜索",
          status: "active"
        }
      ]
    });

    expect(result.status).toBe("ready");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      kind: "generated_flow",
      name: "登录 / 登录按钮 → 主页",
      composedCandidateIds: ["page_transition:page-login:login-button:page-home"]
    });
  });

  it("returns a single no-op flow when the current page is already the requested target page", () => {
    const result = resolveFreeComposition("跳转到主页", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      currentPage: {
        pageModelId: "page-home",
        pageModelName: "主页"
      },
      pageAssets: [
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-home", pageModelName: "主页", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-space", pageModelName: "空间", status: "active" }
      ],
      pageTransitions: [
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
          pageTransitionName: "主页 -> 空间",
          status: "active"
        }
      ]
    });

    expect(result.status).toBe("ready");
    expect(result.message).toBe("当前设备已在目标页面，无需执行。");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      kind: "generated_flow",
      name: "当前已在主页",
      pageModelId: "page-home",
      composedCandidateIds: [],
      requiresExecution: false
    });
  });

  it("does not offer routes from arbitrary pages when device current page detection failed", () => {
    const result = resolveFreeComposition("跳转到主页", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      currentPageDetectionAttempted: true,
      pageAssets: [
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-home", pageModelName: "主页", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-login", pageModelName: "登录", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-schedule", pageModelName: "课程表", status: "active" }
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
          pageTransitionName: "登录 -> 主页",
          status: "active"
        },
        {
          appId: "cn.eeo.classin",
          platform: "android",
          sourcePageModelId: "page-schedule",
          sourcePageModelName: "课程表",
          targetPageModelId: "page-home",
          targetPageModelName: "主页",
          pageElementId: "open-home",
          pageElementLabel: "切回主页",
          pageTransitionId: "edge-schedule-home",
          pageTransitionName: "课程表 -> 主页",
          status: "active"
        }
      ]
    });

    expect(result.status).toBe("missing_assets");
    expect(result.candidates).toEqual([]);
    expect(result.message).toContain("未能稳定识别当前设备页面");
  });

  it("explains route planning blockers differently when the device is outside the target app", () => {
    const result = resolveFreeComposition("跳转到主页", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      currentPageDetectionAttempted: true,
      currentPageDetectionFailure: {
        reason: "outside_app",
        expectedAppId: "cn.eeo.classin",
        actualAppId: "com.android.launcher"
      },
      pageAssets: [
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-home", pageModelName: "主页", status: "active" }
      ]
    });

    expect(result.status).toBe("missing_assets");
    expect(result.candidates).toEqual([]);
    expect(result.message).toContain("当前设备不在目标 App 内");
    expect(result.message).toContain("请先启动目标 App 后重试");
  });

  it("carries required runtime parameters from a current-page transition route", () => {
    const result = resolveFreeComposition("跳转到班级详情", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      currentPage: {
        pageModelId: "page-home",
        pageModelName: "主页"
      },
      pageAssets: [
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-home", pageModelName: "主页", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-detail", pageModelName: "班级详情", status: "active" }
      ],
      pageTransitions: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          sourcePageModelId: "page-home",
          sourcePageModelName: "主页",
          targetPageModelId: "page-detail",
          targetPageModelName: "班级详情",
          pageElementId: "class-grid",
          pageElementLabel: "班级列表",
          pageTransitionId: "transition-home-detail",
          pageTransitionName: "主页 -> 班级详情",
          parameterKeys: ["className"],
          status: "active"
        }
      ]
    });

    expect(result.status).toBe("ready");
    expect(result.candidates[0]).toMatchObject({
      kind: "generated_flow",
      name: "主页 / 班级列表 → 班级详情",
      parameterKeys: ["className"]
    });
  });

  it("explains a page target that exists but has no executable route", () => {
    const result = resolveFreeComposition("打开新建公开课", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      pageAssets: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          pageModelId: "page-public",
          pageModelName: "新建公开课"
        }
      ],
      pageAbilities: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          pageModelId: "page-home",
          pageModelName: "主页",
          pageElementId: "create-public",
          pageElementLabel: "创建公开课"
        }
      ]
    });

    expect(result.status).toBe("missing_assets");
    expect(result.message).toContain("已找到页面资产“新建公开课”");
    expect(result.message).toContain("入口能力“主页 / 创建公开课”");
    expect(result.message).toContain("没有找到绑定到该页面的 active 连接边");
  });

  it("extracts explicit runtime parameter values from natural-language input", () => {
    const result = resolveFreeComposition("切换登录账号为12133333302，lessonName=自动化课堂", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      pageTasks: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          pageModelId: "page-login",
          pageModelName: "登录",
          pageTaskId: "login-task-account-password",
          pageTaskName: "账号密码登录",
          parameterKeys: ["phone", "password"],
          status: "active"
        }
      ]
    });

    expect(result.intent.runtimeOverrides).toEqual({
      lessonName: "自动化课堂",
      phone: "12133333302"
    });
  });

  it("builds a generated flow for an explicit ordered multi-step request", () => {
    const result = resolveFreeComposition("先登录账号18743085313 然后从主页跳转到班级四十二号的班级详情", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [
        metaFunction({
          id: "meta-enter-class",
          name: "进入指定班级",
          description: "从主页进入指定班级详情",
          parameters: [{ key: "className", type: "string", required: true }]
        })
      ],
      compositeCases: [
        compositeCase({
          id: "case-create-lesson",
          name: "指定班级创建课堂（不发布）",
          description: "进入指定班级后创建课堂"
        })
      ],
      pageTasks: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          pageModelId: "page-login",
          pageModelName: "登录",
          pageTaskId: "login-task-account-password",
          pageTaskName: "账号密码登录",
          parameterKeys: ["phone", "password"],
          status: "active"
        }
      ]
    });

    expect(result.status).toBe("ready");
    expect(result.intent.runtimeOverrides).toMatchObject({
      phone: "18743085313",
      className: "班级四十二号"
    });
    expect(result.candidates[0]).toMatchObject({
      kind: "generated_flow",
      name: "登录 / 账号密码登录 → 进入指定班级",
      composedCandidateIds: [
        "page_task:page-login:login-task-account-password",
        "meta-enter-class"
      ],
      parameterKeys: ["className", "password", "phone"]
    });
  });

  it("extracts high-risk intents without treating them as execution approval", () => {
    const result = resolveFreeComposition("登录后发布课堂并提交", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [metaFunction()],
      compositeCases: [compositeCase({ name: "登录后发布课堂", description: "发布并提交课堂" })]
    });

    expect(result.intent.riskTerms).toEqual(expect.arrayContaining(["发布", "提交"]));
  });
});
