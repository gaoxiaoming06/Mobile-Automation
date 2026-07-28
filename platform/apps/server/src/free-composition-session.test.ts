import { describe, expect, it } from "vitest";
import type {
  AssetCompositeCase,
  MetaFunction,
  ParameterProfile
} from "@mobile-automation/shared";
import type { BusinessGraphVersion, BusinessNode } from "@mobile-automation/graph-core";
import { resolveFreeComposition } from "./free-composition.js";
import {
  assertFreeCompositionExecutionAllowed,
  createFreeCompositionSession,
  markFreeCompositionSessionExecutionStarted,
  previewFreeCompositionSession,
  selectFreeCompositionCandidate
} from "./free-composition-session.js";

const now = "2026-07-17T08:00:00.000Z";

function metaFunction(overrides: Partial<MetaFunction> = {}): MetaFunction {
  return {
    id: "meta_login",
    appId: "cn.eeo.classin",
    platform: "android",
    name: "账号密码登录",
    description: "输入账号密码并验证回到主页",
    parameters: [
      {
        key: "phone",
        label: "手机号",
        type: "string",
        required: true
      }
    ],
    steps: [],
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function compositeCase(overrides: Partial<AssetCompositeCase> = {}): AssetCompositeCase {
  return {
    id: "case_login",
    appId: "cn.eeo.classin",
    platform: "android",
    name: "登录巡检",
    description: "登录后验证主页",
    parameterProfileId: "profile_default",
    runMode: "once",
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
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("free composition sessions", () => {
  it("turns a selected meta function into an in-memory repeatable temporary case", () => {
    const login = metaFunction();
    const resolution = resolveFreeComposition("我想测试登录流程，循环 50 次", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [login],
      compositeCases: []
    });
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "我想测试登录流程，循环 50 次",
      resolution,
      now
    });

    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: login.id,
      parameterProfileId: "profile_login",
      metaFunctions: [login],
      compositeCases: [],
      now
    });

    expect(selected.status).toBe("awaiting_confirmation");
    expect(selected.compositeCase).toMatchObject({
      id: `free_composition_case_${session.id}`,
      name: "AI资产用例：账号密码登录",
      parameterProfileId: "profile_login",
      runMode: "repeat_n",
      repeatCount: 50,
      steps: [{ metaFunctionId: login.id, enabled: true }]
    });
  });

  it("clones an existing composite case without mutating its saved execution settings", () => {
    const login = metaFunction();
    const savedCase = compositeCase();
    const resolution = resolveFreeComposition("登录巡检", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [login],
      compositeCases: [savedCase]
    });
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "登录巡检",
      resolution,
      now
    });

    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: savedCase.id,
      parameterProfileId: "profile_override",
      metaFunctions: [login],
      compositeCases: [savedCase],
      now
    });

    expect(selected.compositeCase).not.toBe(savedCase);
    expect(selected.compositeCase).toMatchObject({
      id: `free_composition_case_${session.id}`,
      parameterProfileId: "profile_override"
    });
    expect(savedCase).toMatchObject({
      parameterProfileId: "profile_default",
      runMode: "once",
      repeatCount: 1
    });
  });

  it("requires an explicit risk acknowledgement before executing high-risk intents", () => {
    const publish = metaFunction({
      id: "meta_publish",
      name: "发布作业",
      description: "发布作业给班级"
    });
    const resolution = resolveFreeComposition("发布作业", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [publish],
      compositeCases: []
    });
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "发布作业",
      resolution,
      now
    });
    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: publish.id,
      metaFunctions: [publish],
      compositeCases: [],
      now
    });

    expect(() =>
      assertFreeCompositionExecutionAllowed(selected, {
        confirmed: true,
        riskConfirmed: false
      })
    ).toThrow("高风险");
    expect(() =>
      assertFreeCompositionExecutionAllowed(selected, {
        confirmed: true,
        riskConfirmed: true
      })
    ).not.toThrow();
  });

  it("does not turn navigation labels inside a generated route into risk operations after selection", () => {
    const resolution = resolveFreeComposition("测试进入新建课堂 循环2次", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      pageAssets: [
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-home", pageModelName: "主页", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-activity-type", pageModelName: "发布活动类型选择页", status: "active" },
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-new-lesson", pageModelName: "新建课堂", status: "active" }
      ],
      pageTransitions: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          sourcePageModelId: "page-home",
          sourcePageModelName: "主页",
          targetPageModelId: "page-activity-type",
          targetPageModelName: "发布活动类型选择页",
          pageElementId: "publish-activity",
          pageElementLabel: "发布活动",
          pageTransitionId: "edge-home-activity-type",
          pageTransitionName: "主页 -> 发布活动类型选择页",
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
      ]
    });
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "测试进入新建课堂 循环2次",
      resolution,
      now
    });

    expect(session.resolution.intent.riskTerms).toEqual([]);

    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: resolution.candidates[0]!.id,
      metaFunctions: [],
      compositeCases: [],
      now
    });

    expect(selected.resolution.intent.riskTerms).toEqual([]);
  });

  it("previews a selected temporary case through the existing composition compiler", () => {
    const login = metaFunction({
      steps: [
        {
          id: "reach-home",
          order: 1,
          kind: "reach_page",
          targetPageModelId: "page-home",
          enabled: true
        }
      ]
    });
    const resolution = resolveFreeComposition("登录循环 2 次", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [login],
      compositeCases: []
    });
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "登录循环 2 次",
      resolution,
      now
    });
    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: login.id,
      parameterProfileId: "profile_login",
      metaFunctions: [login],
      compositeCases: [],
      now
    });

    const preview = previewFreeCompositionSession({
      session: selected,
      metaFunctions: [login],
      parameterProfile: parameterProfile(),
      parameterDataRecords: [],
      graphVersion: graphVersion(),
      now
    });

    expect(preview.plan).toMatchObject({
      status: "ready",
      compositeCaseId: `free_composition_case_${session.id}`,
      parameterProfileId: "profile_login",
      runtimeParams: { phone: "18800000000" }
    });
    expect(preview.session).toMatchObject({
      status: "awaiting_confirmation",
      parameterProfileId: "profile_login",
      plan: { status: "ready" }
    });
  });

  it("records the delegated composite execution on the session without changing the temporary case", () => {
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "登录",
      resolution: resolveFreeComposition("登录", {
        appId: "cn.eeo.classin",
        platform: "android",
        metaFunctions: [metaFunction()],
        compositeCases: []
      }),
      now
    });

    const running = markFreeCompositionSessionExecutionStarted(session, {
      executionId: "asset_composite_execution_1",
      now
    });

    expect(running).toMatchObject({
      status: "running",
      executionId: "asset_composite_execution_1"
    });
  });

  it("wraps a selected page task as a temporary meta function without saving one", () => {
    const resolution = resolveFreeComposition("进入登录页面 然后发起登录", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      pageTasks: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          pageModelId: "page-home",
          pageModelName: "登录",
          pageTaskId: "login-task-account-password",
          pageTaskName: "账号密码登录",
          parameterKeys: [],
          status: "active"
        }
      ]
    });
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "进入登录页面 然后发起登录",
      resolution,
      now
    });

    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: "page_task:page-home:login-task-account-password",
      metaFunctions: [],
      compositeCases: [],
      now
    });
    const preview = previewFreeCompositionSession({
      session: selected,
      metaFunctions: [],
      parameterDataRecords: [],
      graphVersion: graphVersion(),
      now
    });

    expect(selected.generatedMetaFunctions?.[0]).toMatchObject({
      name: "登录 / 账号密码登录",
      steps: [
        { kind: "reach_page", targetPageModelId: "page-home" },
        { kind: "run_page_task", pageModelId: "page-home", pageTaskId: "login-task-account-password" }
      ]
    });
    expect(preview.plan.status).toBe("ready");
    expect(preview.plan.steps.map((step) => step.kind)).toEqual(["reach_page", "run_page_task"]);
  });

  it("derives risk confirmation from the selected task's actual submit step", () => {
    const resolution = resolveFreeComposition("创建课堂", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      pageTasks: [
        {
          appId: "cn.eeo.classin",
          platform: "android",
          pageModelId: "page-create-lesson",
          pageModelName: "新建课堂",
          pageTaskId: "task-create-lesson",
          pageTaskName: "创建课堂",
          parameterKeys: ["lessonName"],
          status: "active"
        }
      ]
    });
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "创建课堂",
      resolution,
      now
    });
    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: "page_task:page-create-lesson:task-create-lesson",
      metaFunctions: [],
      compositeCases: [],
      now
    });

    const preview = previewFreeCompositionSession({
      session: selected,
      metaFunctions: [],
      parameterDataRecords: [],
      graphVersion: creationTaskGraphVersion(),
      runtimeOverrides: { lessonName: "自动化课堂" },
      now
    });

    expect(preview.plan.status).toBe("ready");
    expect(preview.session.resolution.intent.riskTerms).toEqual(["发布"]);
    expect(() => assertFreeCompositionExecutionAllowed(preview.session, {
      confirmed: true,
      riskConfirmed: false
    })).toThrow("该计划包含高风险操作：发布");
  });

  it("wraps a selected page transition as a temporary meta function without saving one", () => {
    const resolution = resolveFreeComposition("打开新建公开课", {
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
          status: "active"
        }
      ]
    });
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "打开新建公开课",
      resolution,
      now
    });

    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: "page_transition:page-home:create-public:page-public",
      metaFunctions: [],
      compositeCases: [],
      now
    });
    const preview = previewFreeCompositionSession({
      session: selected,
      metaFunctions: [],
      parameterDataRecords: [],
      graphVersion: transitionGraphVersion(),
      now
    });

    expect(selected.generatedMetaFunctions?.[0]).toMatchObject({
      name: "主页 / 创建公开课 → 新建公开课",
      steps: [
        { kind: "reach_page", name: "确认当前在主页", targetPageModelId: "page-home" },
        {
          kind: "invoke_capability",
          name: "点击「创建公开课」并进入新建公开课",
          sourcePageModelId: "page-home",
          pageElementId: "create-public",
          targetPageModelId: "page-public"
        }
      ]
    });
    expect(preview.plan.status).toBe("ready");
    expect(preview.plan.steps.map((step) => [step.metaFunctionStepName, step.kind, step.targetPageModelId, step.pageElementId])).toEqual([
      ["确认当前在主页", "reach_page", "page-home", undefined],
      ["点击「创建公开课」并进入新建公开课", "invoke_capability", "page-public", "create-public"]
    ]);
  });

  it("requires className before previewing a parameterized class-detail transition", () => {
    const resolution = resolveFreeComposition("跳转到班级详情", {
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
          targetPageModelId: "page-class-detail",
          targetPageModelName: "班级详情",
          pageElementId: "class-grid",
          pageElementLabel: "班级列表",
          pageTransitionId: "edge-home-class-detail",
          pageTransitionName: "主页 -> 班级详情",
          parameterKeys: ["className"],
          status: "active"
        }
      ]
    });
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "跳转到班级详情",
      resolution,
      now
    });

    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: "page_transition:page-home:class-grid:page-class-detail",
      metaFunctions: [],
      compositeCases: [],
      now
    });
    const preview = previewFreeCompositionSession({
      session: selected,
      metaFunctions: [],
      parameterDataRecords: [],
      graphVersion: classDetailTransitionGraphVersion(),
      now
    });

    expect(selected.generatedMetaFunctions?.[0]?.parameters).toEqual([
      { key: "className", type: "string", required: true }
    ]);
    expect(preview.plan.status).toBe("needs_parameters");
    expect(preview.session.status).toBe("awaiting_parameters");
    expect(preview.plan.issues).toContainEqual(expect.objectContaining({
      code: "MISSING_REQUIRED_PARAMETER",
      assetId: "className"
    }));
  });

  it("wraps a selected built-in app launch as a temporary system step", () => {
    const resolution = resolveFreeComposition("打开app", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: []
    });
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "打开app",
      resolution,
      now
    });

    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: "system_action:launch_app",
      metaFunctions: [],
      compositeCases: [],
      now
    });
    const preview = previewFreeCompositionSession({
      session: selected,
      metaFunctions: [],
      parameterDataRecords: [],
      graphVersion: emptyGraphVersion(),
      now
    });

    expect(selected.generatedMetaFunctions?.[0]).toMatchObject({
      name: "启动 App",
      steps: [
        { kind: "system_action", actionType: "launch_app" }
      ]
    });
    expect(preview.plan.status).toBe("ready");
    expect(preview.plan.steps.map((step) => [step.metaFunctionName, step.kind, step.systemAction, step.packageName])).toEqual([
      ["启动 App", "system_action", "launch_app", "cn.eeo.classin"]
    ]);
  });

  it("keeps a page-task session waiting for required task parameters instead of blocking it", () => {
    const resolution = resolveFreeComposition("进入登录页面 然后发起登录", {
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
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "进入登录页面 然后发起登录",
      resolution,
      now
    });

    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: "page_task:page-login:login-task-account-password",
      metaFunctions: [],
      compositeCases: [],
      now
    });
    const preview = previewFreeCompositionSession({
      session: selected,
      metaFunctions: [],
      parameterDataRecords: [],
      graphVersion: loginGraphVersionWithRequiredParams(),
      now
    });

    expect(preview.plan.status).toBe("needs_parameters");
    expect(preview.session.status).toBe("awaiting_parameters");
    expect(preview.plan.requiredParameters).toEqual(["password", "phone"]);
    expect(preview.plan.issues.map((issue) => issue.assetId)).toEqual(expect.arrayContaining(["phone", "password"]));
    expect(() =>
      assertFreeCompositionExecutionAllowed(preview.session, {
        confirmed: true,
        riskConfirmed: false
      })
    ).toThrow("请先补充参数：password、phone");
  });

  it("uses prompt runtime overrides for page tasks but still asks for missing required parameters", () => {
    const resolution = resolveFreeComposition("切换登录账号为12133333302", {
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
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "切换登录账号为12133333302",
      resolution,
      now
    });

    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: "page_task:page-login:login-task-account-password",
      metaFunctions: [],
      compositeCases: [],
      now
    });
    const preview = previewFreeCompositionSession({
      session: selected,
      metaFunctions: [],
      parameterDataRecords: [],
      graphVersion: loginGraphVersionWithRequiredParams(),
      now
    });

    expect(preview.plan.status).toBe("needs_parameters");
    expect(preview.session.status).toBe("awaiting_parameters");
    expect(preview.plan.runtimeParams.phone).toBe("12133333302");
    expect(preview.plan.issues.map((issue) => issue.assetId)).toEqual(["password"]);
    expect(() =>
      assertFreeCompositionExecutionAllowed(preview.session, {
        confirmed: true,
        riskConfirmed: false
      })
    ).toThrow("请先补充参数：password");
  });

  it("allows explicit runtime overrides to satisfy page-task parameters without a saved profile", () => {
    const resolution = resolveFreeComposition("进入登录页面 然后发起登录", {
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
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "进入登录页面 然后发起登录",
      resolution,
      now
    });

    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: "page_task:page-login:login-task-account-password",
      metaFunctions: [],
      compositeCases: [],
      now
    });
    const preview = previewFreeCompositionSession({
      session: selected,
      metaFunctions: [],
      parameterDataRecords: [],
      graphVersion: loginGraphVersionWithRequiredParams(),
      runtimeOverrides: { phone: "12133333302", password: "secret" },
      now
    });

    expect(preview.plan.status).toBe("ready");
    expect(preview.plan.runtimeParams).toMatchObject({
      phone: "12133333302",
      password: "secret"
    });
  });

  it("previews a fixed-start target as a runtime reach-page step", () => {
    const resolution = resolveFreeComposition("跳转到主页", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [],
      compositeCases: [],
      pageAssets: [
        { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-home", pageModelName: "主页", status: "active" }
      ]
    });
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "跳转到主页",
      resolution,
      now
    });
    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: resolution.candidates[0]!.id,
      metaFunctions: [],
      compositeCases: [],
      now
    });
    const preview = previewFreeCompositionSession({
      session: selected,
      metaFunctions: [],
      parameterDataRecords: [],
      graphVersion: graphVersion(),
      now
    });

    expect(preview.plan.status).toBe("ready");
    expect(preview.plan.steps).toMatchObject([
      {
        kind: "reach_page",
        targetPageModelId: "page-home",
        metaFunctionStepName: "执行时到达主页"
      }
    ]);
    expect(preview.session.status).toBe("awaiting_confirmation");
    expect(() =>
      assertFreeCompositionExecutionAllowed(preview.session, {
        confirmed: true,
        riskConfirmed: false
      })
    ).not.toThrow();
  });

  it("turns an explicit ordered multi-step request into one temporary composite case", () => {
    const enterClass = metaFunction({
      id: "meta-enter-class",
      name: "进入指定班级",
      description: "从主页进入指定班级详情",
      parameters: [{ key: "className", type: "string", required: true }],
      steps: [
        { id: "reach-home", order: 1, kind: "reach_page", targetPageModelId: "page-home", enabled: true },
        { id: "verify-class-detail", order: 2, kind: "verify_page", pageModelId: "page-class-detail", enabled: true }
      ]
    });
    const resolution = resolveFreeComposition("先登录账号18743085313 然后从主页跳转到班级四十二号的班级详情", {
      appId: "cn.eeo.classin",
      platform: "android",
      metaFunctions: [enterClass],
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
    const session = createFreeCompositionSession({
      appId: "cn.eeo.classin",
      platform: "android",
      prompt: "先登录账号18743085313 然后从主页跳转到班级四十二号的班级详情",
      resolution,
      now
    });

    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: resolution.candidates[0]!.id,
      metaFunctions: [enterClass],
      compositeCases: [],
      now
    });
    const preview = previewFreeCompositionSession({
      session: selected,
      metaFunctions: [enterClass],
      parameterDataRecords: [],
      graphVersion: multiStepGraphVersion(),
      runtimeOverrides: { password: "secret" },
      now
    });

    expect(selected.compositeCase?.steps.map((step) => step.metaFunctionId)).toEqual([
      selected.generatedMetaFunctions?.[0]?.id,
      "meta-enter-class"
    ]);
    expect(preview.plan.status).toBe("ready");
    expect(preview.plan.runtimeParams).toMatchObject({
      phone: "18743085313",
      password: "secret",
      className: "班级四十二号"
    });
    expect(preview.plan.steps.map((step) => [step.metaFunctionName, step.kind, step.targetPageModelId, step.pageTaskId])).toEqual([
      ["登录 / 账号密码登录", "reach_page", "page-login", undefined],
      ["登录 / 账号密码登录", "run_page_task", "page-login", "login-task-account-password"],
      ["进入指定班级", "reach_page", "page-home", undefined],
      ["进入指定班级", "verify_page", "page-class-detail", undefined]
    ]);
  });
});

function parameterProfile(): ParameterProfile {
  return {
    id: "profile_login",
    appId: "cn.eeo.classin",
    platform: "android",
    name: "教师账号",
    values: {
      phone: { type: "string", value: "18800000000" }
    },
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
    nodes: [pageNode("page-home", "主页")],
    edges: []
  };
}

function emptyGraphVersion(): BusinessGraphVersion {
  return {
    id: "graph-version-empty",
    graphId: "graph",
    version: 1,
    status: "active",
    sourceSummary: [],
    createdAt: now,
    nodes: [],
    edges: []
  };
}

function loginGraphVersionWithRequiredParams(): BusinessGraphVersion {
  return {
    id: "graph-version-login",
    graphId: "graph",
    version: 1,
    status: "active",
    sourceSummary: [],
    createdAt: now,
    nodes: [
      pageNode("page-login", "登录", {
        assetRecordingPageTasks: [
          {
            id: "login-task-account-password",
            name: "账号密码登录",
            status: "active",
            steps: [
              { id: "task-step-phone", order: 1, elementId: "manual-phone", fieldType: "text_input", label: "手机号输入框", valueParamKey: "phone" },
              { id: "task-step-password", order: 2, elementId: "manual-password", fieldType: "text_input", label: "密码输入框", valueParamKey: "password" }
            ]
          }
        ]
      })
    ],
    edges: []
  };
}

function creationTaskGraphVersion(): BusinessGraphVersion {
  return {
    id: "graph-version-create-lesson",
    graphId: "graph",
    version: 1,
    status: "active",
    sourceSummary: [],
    createdAt: now,
    nodes: [
      pageNode("page-create-lesson", "新建课堂", {
        assetRecordingPageElements: [
          { id: "lesson-title", label: "课堂名称" },
          { id: "lesson-publish", label: "发布课堂", targetText: "发布" }
        ],
        assetRecordingPageTasks: [
          {
            id: "task-create-lesson",
            name: "创建课堂",
            status: "active",
            steps: [
              { id: "task-title", order: 1, elementId: "lesson-title", fieldType: "text_input", label: "课堂名称", valueParamKey: "lessonName" },
              { id: "task-publish", order: 2, elementId: "lesson-publish", fieldType: "submit", label: "发布课堂" }
            ]
          }
        ]
      })
    ],
    edges: []
  };
}

function multiStepGraphVersion(): BusinessGraphVersion {
  return {
    id: "graph-version-multi-step",
    graphId: "graph",
    version: 1,
    status: "active",
    sourceSummary: [],
    createdAt: now,
    nodes: [
      pageNode("page-login", "登录", {
        assetRecordingPageTasks: [
          {
            id: "login-task-account-password",
            name: "账号密码登录",
            status: "active",
            steps: [
              { id: "task-step-phone", order: 1, elementId: "manual-phone", fieldType: "text_input", label: "手机号输入框", valueParamKey: "phone" },
              { id: "task-step-password", order: 2, elementId: "manual-password", fieldType: "text_input", label: "密码输入框", valueParamKey: "password" }
            ]
          }
        ]
      }),
      pageNode("page-home", "主页"),
      pageNode("page-class-detail", "班级详情")
    ],
    edges: []
  };
}

function transitionGraphVersion(): BusinessGraphVersion {
  return {
    id: "graph-version-transition",
    graphId: "graph",
    version: 1,
    status: "active",
    sourceSummary: [],
    createdAt: now,
    nodes: [
      pageNode("page-home", "主页", {
        assetRecordingPageElements: [{ id: "create-public", label: "创建公开课" }],
        assetRecordingPageTransitions: [{ id: "edge-home-public", elementId: "create-public", targetNodeId: "page-public", outcomeType: "navigate" }],
        assetRecordingPageTasks: []
      }),
      pageNode("page-public", "新建公开课", {
        assetRecordingPageTasks: []
      })
    ],
    edges: []
  };
}

function classDetailTransitionGraphVersion(): BusinessGraphVersion {
  return {
    id: "graph-version-class-detail-transition",
    graphId: "graph",
    version: 1,
    status: "active",
    sourceSummary: [],
    createdAt: now,
    nodes: [
      pageNode("page-home", "主页", {
        assetRecordingPageElements: [{ id: "class-grid", label: "班级列表" }],
        assetRecordingPageTransitions: [{ id: "edge-home-class-detail", elementId: "class-grid", targetNodeId: "page-class-detail", outcomeType: "navigate", params: { itemText: "{{className}}" } }],
        assetRecordingPageTasks: []
      }),
      pageNode("page-class-detail", "班级详情", {
        assetRecordingPageTasks: []
      })
    ],
    edges: []
  };
}

function pageNode(id: string, name: string, metadata: Record<string, unknown> = {}): BusinessNode {
  return {
    id,
    graphVersionId: "graph-version",
    key: id,
    name,
    nodeType: "page",
    tags: ["page-asset"],
    status: "active",
    matchers: [],
    defaultExpectations: [],
    platformScope: "android",
    metadata: {
      assetRecordingConfirmed: true,
      assetRecordingPageTasks: [{ id: "login-task-account-password", name: "账号密码登录", status: "active" }],
      ...metadata
    }
  };
}
