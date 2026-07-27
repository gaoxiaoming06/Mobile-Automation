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

  it("parses a trailing count as repeat intent for natural test requests", () => {
    const result = resolveFreeComposition("测试进入新建课堂8次", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [
        metaFunction({
          id: "meta-new-lesson",
          name: "进入新建课堂",
          description: "从班级详情进入新建课堂页面",
          parameters: []
        })
      ],
      compositeCases: []
    });

    expect(result.status).toBe("ready");
    expect(result.intent).toMatchObject({ runMode: "repeat_n", repeatCount: 8 });
    expect(result.candidates[0]).toMatchObject({ id: "meta-new-lesson" });
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

  it("plans a fixed route from the stable start page instead of the detected current page", () => {
    const result = resolveFreeComposition("跳转到空间", {
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
      name: "主页 / 打开空间 → 空间",
      composedCandidateIds: ["page_transition:page-home:open-space:page-space"]
    });
  });

  it("keeps a page-entry request on the fixed route even when AI selects a creation asset", () => {
    const result = resolveFreeComposition("测试进入新建课堂8次", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [
        metaFunction({
          id: "meta-create-lesson-without-publish",
          name: "创建课堂但不发布",
          description: "填写课堂表单后创建课堂但不发布",
          parameters: [
            { key: "lessonName", type: "string" as const, required: true },
            { key: "duration", type: "number" as const, required: true },
            { key: "aiContentSummary", type: "string" as const, required: false }
          ]
        })
      ],
      compositeCases: [],
      pageAssets: [
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-home", pageModelName: "主页", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-class-detail", pageModelName: "班级详情", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-activity-type", pageModelName: "发布活动类型选择页", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-new-lesson", pageModelName: "新建课堂", status: "active" }
      ],
      pageTransitions: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          sourcePageModelId: "page-home",
          sourcePageModelName: "主页",
          targetPageModelId: "page-class-detail",
          targetPageModelName: "班级详情",
          pageElementId: "class-list",
          pageElementLabel: "班级列表",
          pageTransitionId: "edge-home-class-detail",
          pageTransitionName: "主页 -> 班级详情",
          parameterKeys: ["className"],
          status: "active"
        },
        {
          appId: "cn.eeo.classin",
          platform: "android",
          sourcePageModelId: "page-class-detail",
          sourcePageModelName: "班级详情",
          targetPageModelId: "page-activity-type",
          targetPageModelName: "发布活动类型选择页",
          pageElementId: "publish-activity",
          pageElementLabel: "发布活动",
          pageTransitionId: "edge-class-detail-activity-type",
          pageTransitionName: "班级详情 -> 发布活动类型选择页",
          status: "active"
        },
        {
          appId: "cn.eeo.classin",
          platform: "android",
          sourcePageModelId: "page-activity-type",
          sourcePageModelName: "发布活动类型选择页",
          targetPageModelId: "page-new-lesson",
          targetPageModelName: "新建课堂",
          pageElementId: "new-lesson",
          pageElementLabel: "新建课堂",
          pageTransitionId: "edge-activity-type-new-lesson",
          pageTransitionName: "发布活动类型选择页 -> 新建课堂",
          status: "active"
        }
      ],
      pageTasks: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          pageModelId: "page-new-lesson",
          pageModelName: "新建课堂",
          pageTaskId: "fill-new-lesson-form",
          pageTaskName: "填写新建课堂表单（不发布）",
          parameterKeys: ["lessonName", "duration", "aiContentSummary"],
          status: "active"
        }
      ],
      aiPlanner: {
        status: "used",
        normalizedPrompt: "重复8次进入新建课堂页面进行测试",
        orderedAssetIds: ["meta-create-lesson-without-publish"],
        orderedAssetNames: ["创建课堂但不发布"],
        targetPageName: "新建课堂",
        runMode: "repeat_n",
        repeatCount: 8,
        summary: "理解为调用“创建课堂但不发布”资产，重复8次进入新建课堂页面。"
      }
    } as Parameters<typeof resolveFreeComposition>[1]);

    expect(result.status).toBe("ready");
    expect(result.intent).toMatchObject({ runMode: "repeat_n", repeatCount: 8 });
    expect(result.intent.riskTerms).not.toContain("发布");
    expect(result.candidates[0]).toMatchObject({
      kind: "generated_flow",
      name: "主页 / 班级列表 → 班级详情 → 班级详情 / 发布活动 → 发布活动类型选择页 → 发布活动类型选择页 / 新建课堂 → 新建课堂",
      composedCandidateIds: [
        "page_transition:page-home:class-list:page-class-detail",
        "page_transition:page-class-detail:publish-activity:page-activity-type",
        "page_transition:page-activity-type:new-lesson:page-new-lesson"
      ],
      parameterKeys: ["className"]
    });
  });

  it("does not treat an action-like target page name as a page task when repeat wording has spaces", () => {
    const result = resolveFreeComposition("测试进入新建课堂 循环2次", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      pageAssets: [
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-home", pageModelName: "主页", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-new-lesson", pageModelName: "新建课堂", status: "active" }
      ],
      pageTransitions: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          sourcePageModelId: "page-home",
          sourcePageModelName: "主页",
          targetPageModelId: "page-new-lesson",
          targetPageModelName: "新建课堂",
          pageElementId: "new-lesson",
          pageElementLabel: "新建课堂",
          pageTransitionId: "edge-home-new-lesson",
          status: "active"
        }
      ],
      pageTasks: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          pageModelId: "page-new-lesson",
          pageModelName: "新建课堂",
          pageTaskId: "fill-new-lesson-form",
          pageTaskName: "填写新建课堂表单（不发布）",
          parameterKeys: ["lessonName", "duration"],
          status: "active"
        }
      ]
    });

    expect(result.status).toBe("ready");
    expect(result.intent).toMatchObject({ runMode: "repeat_n", repeatCount: 2 });
    expect(result.candidates[0]).toMatchObject({
      kind: "generated_flow",
      name: "主页 / 新建课堂 → 新建课堂",
      composedCandidateIds: ["page_transition:page-home:new-lesson:page-new-lesson"],
      parameterKeys: []
    });
  });

  it("treats action-like page names as navigation targets when no action is requested", () => {
    const result = resolveFreeComposition("测试进入支付页3次", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [
        metaFunction({
          id: "meta-pay-order",
          name: "支付订单",
          description: "提交订单支付",
          parameters: [{ key: "orderId", type: "string" as const, required: true }]
        })
      ],
      compositeCases: [],
      pageAssets: [
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-home", pageModelName: "主页", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-payment", pageModelName: "支付页", status: "active" }
      ],
      pageTransitions: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          sourcePageModelId: "page-home",
          sourcePageModelName: "主页",
          targetPageModelId: "page-payment",
          targetPageModelName: "支付页",
          pageElementId: "payment-entry",
          pageElementLabel: "支付入口",
          pageTransitionId: "edge-home-payment",
          pageTransitionName: "主页 -> 支付页",
          status: "active"
        }
      ],
      pageTasks: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          pageModelId: "page-payment",
          pageModelName: "支付页",
          pageTaskId: "submit-payment",
          pageTaskName: "提交支付",
          parameterKeys: ["orderId"],
          status: "active"
        }
      ],
      aiPlanner: {
        status: "used",
        normalizedPrompt: "重复3次进入支付页进行测试",
        orderedAssetIds: ["meta-pay-order"],
        orderedAssetNames: ["支付订单"],
        targetPageName: "支付页",
        runMode: "repeat_n",
        repeatCount: 3,
        riskTerms: ["支付"],
        summary: "进入支付页进行测试。"
      }
    } as Parameters<typeof resolveFreeComposition>[1]);

    expect(result.status).toBe("ready");
    expect(result.intent.riskTerms).not.toContain("支付");
    expect(result.candidates[0]).toMatchObject({
      kind: "generated_flow",
      name: "主页 / 支付入口 → 支付页",
      composedCandidateIds: ["page_transition:page-home:payment-entry:page-payment"],
      parameterKeys: []
    });
  });

  it("keeps explicit page actions after navigation as an executable task flow", () => {
    const result = resolveFreeComposition("进入新建课堂并填写表单", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      pageAssets: [
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-home", pageModelName: "主页", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-new-lesson", pageModelName: "新建课堂", status: "active" }
      ],
      pageTransitions: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          sourcePageModelId: "page-home",
          sourcePageModelName: "主页",
          targetPageModelId: "page-new-lesson",
          targetPageModelName: "新建课堂",
          pageElementId: "new-lesson",
          pageElementLabel: "新建课堂",
          pageTransitionId: "edge-home-new-lesson",
          pageTransitionName: "主页 -> 新建课堂",
          status: "active"
        }
      ],
      pageTasks: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          pageModelId: "page-new-lesson",
          pageModelName: "新建课堂",
          pageTaskId: "fill-form",
          pageTaskName: "填写表单",
          parameterKeys: ["lessonName"],
          status: "active"
        }
      ]
    });

    expect(result.status).toBe("ready");
    expect(result.candidates[0]).toMatchObject({
      kind: "generated_flow",
      name: "主页 / 新建课堂 → 新建课堂 → 新建课堂 / 填写表单",
      composedCandidateIds: [
        "page_transition:page-home:new-lesson:page-new-lesson",
        "page_task:page-new-lesson:fill-form"
      ],
      parameterKeys: ["lessonName"]
    });
  });

  it("does not turn the plan into a current-page no-op when the device is already on the target page", () => {
    const result = resolveFreeComposition("跳转到空间", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      currentPage: {
        pageModelId: "page-space",
        pageModelName: "空间"
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
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      kind: "generated_flow",
      name: "主页 / 打开空间 → 空间",
      composedCandidateIds: ["page_transition:page-home:open-space:page-space"]
    });
  });

  it("still plans the fixed route when device current page detection failed", () => {
    const result = resolveFreeComposition("跳转到空间", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      currentPageDetectionAttempted: true,
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
    expect(result.candidates[0]).toMatchObject({
      kind: "generated_flow",
      name: "主页 / 打开空间 → 空间"
    });
  });

  it("still plans the fixed route when the device is outside the target app during analysis", () => {
    const result = resolveFreeComposition("跳转到空间", {
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
    expect(result.candidates[0]).toMatchObject({
      kind: "generated_flow",
      name: "主页 / 打开空间 → 空间"
    });
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

  it("uses AI planner hints to turn conversational account switching into a bounded asset flow", () => {
    const result = resolveFreeComposition("帮我换成老师账号 12133333302", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [
        metaFunction({
          id: "meta_logout",
          name: "退出登录",
          description: "从当前账号退出到登录页",
          parameters: []
        }),
        metaFunction()
      ],
      compositeCases: [],
      aiPlanner: {
        status: "used",
        orderedAssetNames: ["退出登录", "账号密码登录"],
        runtimeOverrides: { phone: "12133333302" },
        summary: "用户希望切换账号，需先退出再登录。"
      }
    } as Parameters<typeof resolveFreeComposition>[1]);

    expect(result.status).toBe("ready");
    expect(result.intent.runtimeOverrides).toMatchObject({ phone: "12133333302" });
    expect(result.aiPlanner).toMatchObject({ status: "used" });
    expect(result.candidates[0]).toMatchObject({
      kind: "generated_flow",
      name: "退出登录 → 账号密码登录",
      composedCandidateIds: ["meta_logout", "meta_login"],
      parameterKeys: ["password", "phone"]
    });
  });

  it("uses AI planner repeat hints when the prompt wording is not covered by deterministic parsing", () => {
    const result = resolveFreeComposition("把这条新建课堂流程跑八遍", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [
        metaFunction({
          id: "meta-new-lesson",
          name: "进入新建课堂",
          description: "从班级详情进入新建课堂页面",
          parameters: []
        })
      ],
      compositeCases: [],
      aiPlanner: {
        status: "used",
        normalizedPrompt: "测试进入新建课堂8次",
        orderedAssetNames: ["进入新建课堂"],
        runMode: "repeat_n",
        repeatCount: 8
      }
    } as Parameters<typeof resolveFreeComposition>[1]);

    expect(result.status).toBe("ready");
    expect(result.intent).toMatchObject({ runMode: "repeat_n", repeatCount: 8 });
    expect(result.aiPlanner).toMatchObject({ status: "used", repeatCount: 8 });
  });

  it("blocks execution when AI understood requirements that the system cannot support", () => {
    const result = resolveFreeComposition("测试进入新建课堂8次，每次之间等待10分钟", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [
        metaFunction({
          id: "meta-new-lesson",
          name: "进入新建课堂",
          description: "从班级详情进入新建课堂页面",
          parameters: []
        })
      ],
      compositeCases: [],
      aiPlanner: {
        status: "used",
        normalizedPrompt: "测试进入新建课堂8次，每次之间等待10分钟",
        orderedAssetNames: ["进入新建课堂"],
        runMode: "repeat_n",
        repeatCount: 8,
        unsupportedRequirements: ["步骤间隔等待"]
      }
    } as Parameters<typeof resolveFreeComposition>[1]);

    expect(result.status).toBe("missing_assets");
    expect(result.candidates).toEqual([]);
    expect(result.message).toContain("AI已理解：测试进入新建课堂8次，每次之间等待10分钟");
    expect(result.message).toContain("系统暂不支持：步骤间隔等待");
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
