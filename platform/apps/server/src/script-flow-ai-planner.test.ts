import { describe, expect, it } from "vitest";
import { serializeScriptFlow, type ScriptFlowDocument } from "@mobile-automation/script-flow";
import type { NavigationEntry, ScreenUnderstandingContext, ScriptFlow } from "@mobile-automation/shared";
import type { PageAssetCatalog } from "./page-asset-catalog.js";
import {
  SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
  buildScriptFlowPlannerCatalog,
  buildScriptFlowPlannerPrompt,
  classifyScriptFlowTestLevel,
  generateScriptFlowDraft,
  parseScriptFlowAiResponse
} from "./script-flow-ai-planner.js";

it("only instructs AI to use supported ScriptFlow target modes", () => {
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("text、semantic、icon 或 control");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("禁止擅自增加");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("未录入页面");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("完整操作链");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("系统标记为结果待确认");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("不能因此返回 needs_clarification");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).not.toContain("用户确认业务结果");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("search");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("一个 tap 只执行一次点击");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("不要再紧跟一个独立 assertPage");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("目标状态");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("reachPage");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("assertText");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).not.toContain("ocrText");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).not.toContain("pageElement");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).not.toContain("risk，值只能是 none");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("单一业务目标标记为 case");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("多个可独立成立的业务目标标记为 scenario");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("purpose");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("navigation、fixture、business 或 recovery");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("每个步骤必须显式标记 role");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("场景编排命中完全匹配的启用用例时自动使用 runFlow");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("无需运行前确认");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("内容区悬浮新增按钮使用 { icon: add, area: content, position: trailing }");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("点击左上角返回按钮");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("icon: back");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("icon: share");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("明确操作是硬约束");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("禁止元素资产 ID");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("唯一 JSON 对象");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("具体选中值");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("selectText");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("禁止猜测固定滑动次数");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("完整当前页控件动作");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("不要补 entry、outcome、onPage、reachPage 或 runFlow");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("表单字段动作默认使用 search: { mode: auto }");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).not.toMatch(/\bref\b/i);
});

describe("ScriptFlow AI planner", () => {
  it("requires AI drafts to classify the flow purpose and every step role explicitly", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const missingPurpose = readyResponse();
    delete missingPurpose.document.purpose;
    expect(() => parseScriptFlowAiResponse(JSON.stringify(missingPurpose), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt: "从主页进入添加好友页面"
    })).toThrow(/purpose/);

    const missingRole = readyResponse();
    delete missingRole.document.steps[0]!.role;
    expect(() => parseScriptFlowAiResponse(JSON.stringify(missingRole), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt: "从主页进入添加好友页面"
    })).toThrow(/role/);

    const missingLevel = readyResponse();
    delete missingLevel.document.testLevel;
    expect(() => parseScriptFlowAiResponse(JSON.stringify(missingLevel), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt: "测试一下课堂时长能不能选到10小时40分钟"
    })).toThrow(/testLevel/);
  });

  it("classifies user requests into system-controlled test levels", () => {
    expect(classifyScriptFlowTestLevel("测试一下课堂时长能不能选到10小时40分钟")).toBe("component");
    expect(classifyScriptFlowTestLevel("创建课堂，设置时长10小时40分钟，然后发布")).toBe("business_smoke");
    expect(classifyScriptFlowTestLevel("创建课堂页面所有表单都填一遍")).toBe("full_regression");
    expect(classifyScriptFlowTestLevel("临时验证一下发布按钮能不能找到")).toBe("probe");
  });

  it("requires the AI response to keep the system-classified test level", async () => {
    let requestBody = "";
    const componentResponse = readyResponse();
    componentResponse.document.purpose = "business";
    componentResponse.document.testLevel = "business_smoke";
    componentResponse.document.name = "设置课堂时长";
    componentResponse.document.steps = [{
      id: "select-duration",
      role: "business",
      risk: "interaction",
      selectText: {
        target: { text: "课堂时长", area: "content" },
        value: "10小时40分钟",
        confirmText: "确定",
        search: { mode: "auto" }
      }
    }];

    await expect(generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "测试一下课堂时长能不能选到10小时40分钟",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: pageCatalog(),
      flows: [],
      fetchImpl: async (_url, init) => {
        requestBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(componentResponse) } }] }), { status: 200 });
      }
    })).rejects.toThrow(/testLevel.*component/);

    expect(requestBody).toContain("系统判定的 testLevel：component");
  });

  it("grounds current-screen wording with the explicit screen context text field candidate", async () => {
    const response = readyResponse();
    response.summary = "填写当前页面课堂名称";
    response.document.purpose = "business";
    response.document.testLevel = "component";
    response.document.name = "填写课堂名称";
    response.document.parameters = {
      lessonName: { type: "string", required: true, label: "课堂名称" }
    };
    response.document.steps = [{
      id: "fill-lesson-name",
      role: "business",
      inputText: {
        target: { control: "textField", area: "content", scopeText: "课堂信息", ordinal: 1 },
        value: "${lessonName}",
        search: { mode: "visibleOnly" }
      }
    }];
    response.parameterValues = { lessonName: "自动化课堂" };
    let plannerPrompt = "";

    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "请根据当前页面生成课堂名称字段用例，值为自动化课堂",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: planningPageCatalog(),
      flows: [],
      screenContext: lessonCreateScreenContext(),
      fetchImpl: async (_url, init) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { messages: Array<{ content: string }> };
        plannerPrompt = request.messages[1]?.content ?? "";
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }), { status: 200 });
      }
    });

    expect(plannerPrompt).toContain("当前屏幕理解上下文");
    expect(plannerPrompt).toContain("\"screenContext\"");
    expect(plannerPrompt).toContain("\"control\": \"textField\"");
    expect(plannerPrompt).toContain("target: { control: \"textField\", area: \"content\", scopeText, ordinal }");
    expect(plannerPrompt).not.toContain("小王");
    expect(result).toMatchObject({
      status: "trial_ready",
      document: {
        testLevel: "component",
        steps: [{
          inputText: {
            target: { control: "textField", area: "content", scopeText: "课堂信息", ordinal: 1 }
          }
        }]
      },
      parameterValues: { lessonName: "自动化课堂" }
    });
  });

  it("accepts explicit text field editing when screen context supplies the scoped field target", () => {
    const response = readyResponse();
    response.summary = "修改当前页面课堂名称";
    response.document.purpose = "business";
    response.document.testLevel = "component";
    response.document.name = "修改课堂名称";
    response.document.entry = undefined;
    response.document.outcome = undefined;
    response.document.parameters = {
      lessonName: { type: "string", required: true, label: "课堂名称" }
    };
    response.document.steps = [{
      id: "fill-lesson-name",
      role: "business",
      risk: "interaction",
      inputText: {
        target: { control: "textField", area: "content", scopeText: "课堂信息", ordinal: 1 },
        value: "${lessonName}",
        search: { mode: "visibleOnly" }
      }
    }];
    response.parameterValues = { lessonName: "自动化课堂字段验证0801" };

    expect(parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog: buildScriptFlowPlannerCatalog(planningPageCatalog(), [], "cn.eeo.classin", "android"),
      prompt: "把当前页面最上方的课堂名称输入框改成 自动化课堂字段验证0801，改完停在当前页。",
      screenContext: lessonCreateScreenContext()
    })).toMatchObject({
      status: "ready",
      document: {
        steps: [{
          inputText: {
            target: { control: "textField", area: "content", scopeText: "课堂信息", ordinal: 1 }
          }
        }]
      },
      parameterValues: { lessonName: "自动化课堂字段验证0801" }
    });
  });

  it("grounds current-screen switch requests with a stateful switch control target", async () => {
    const response = readyResponse();
    response.summary = "打开录制ClassIn教室开关";
    response.document.purpose = "business";
    response.document.testLevel = "component";
    response.document.name = "打开录制ClassIn教室";
    response.document.steps = [{
      id: "enable-record-classin",
      role: "business",
      risk: "interaction",
      tap: {
        target: { control: "switch", area: "content", nearText: "录制ClassIn教室", checked: true },
        search: { mode: "visibleOnly" }
      }
    }];

    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "把当前页面的录制ClassIn教室开关打开，改完停在当前页。",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: planningPageCatalog(),
      flows: [],
      screenContext: lessonCreateScreenContext(),
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }), { status: 200 })
    });

    expect(result.status).toBe("trial_ready");
    if (result.status === "needs_clarification") throw new Error(result.clarification);
    expect(result.document.entry).toBeUndefined();
    expect(result.document.outcome).toBeUndefined();
    expect(result.document.steps[0]?.onPage).toBeUndefined();
    expect(result.document).toMatchObject({
      testLevel: "component",
      steps: [{
        tap: {
          target: { control: "switch", area: "content", nearText: "录制ClassIn教室", checked: true }
        }
      }]
    });
  });

  it("repairs current-page control intents that invent navigation context", async () => {
    const badResponse = readyResponse();
    badResponse.summary = "打开录制ClassIn教室开关";
    badResponse.document.purpose = "business";
    badResponse.document.testLevel = "business_smoke";
    badResponse.document.name = "打开录制ClassIn教室";
    badResponse.document.entry = { page: "classin.lesson.create", session: "authenticated", role: "teacher" };
    badResponse.document.outcome = { page: "classin.lesson.create", session: "authenticated", role: "teacher" };
    badResponse.document.steps = [
      { id: "reach-create-lesson", role: "navigation", reachPage: { page: "classin.lesson.create", policy: "safe" } },
      {
        id: "enable-record-classin",
        role: "business",
        onPage: "classin.lesson.create",
        risk: "interaction",
        tap: {
          target: { control: "switch", area: "content", nearText: "录制ClassIn教室", checked: true },
          search: { mode: "visibleOnly" }
        }
      }
    ];
    const fixedResponse = readyResponse();
    fixedResponse.summary = "打开录制ClassIn教室开关";
    fixedResponse.document.purpose = "business";
    fixedResponse.document.testLevel = "business_smoke";
    fixedResponse.document.name = "打开录制ClassIn教室";
    fixedResponse.document.entry = undefined;
    fixedResponse.document.outcome = undefined;
    fixedResponse.document.steps = [{
      id: "enable-record-classin",
      role: "business",
      risk: "interaction",
      tap: {
        target: { control: "switch", area: "content", nearText: "录制ClassIn教室", checked: true },
        search: { mode: "visibleOnly" }
      }
    }];
    let callCount = 0;

    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "选择录制ClassIn教室 开启",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: planningPageCatalog(),
      flows: [],
      fetchImpl: async () => {
        callCount += 1;
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(callCount === 1 ? badResponse : fixedResponse) } }]
        }), { status: 200 });
      }
    });

    expect(callCount).toBe(2);
    expect(result.status).toBe("trial_ready");
    if (result.status === "needs_clarification") throw new Error(result.clarification);
    expect(result.document.entry).toBeUndefined();
    expect(result.document.outcome).toBeUndefined();
    expect(result.document.steps).toHaveLength(1);
    expect(result.document.steps[0]).toMatchObject({
      tap: {
        target: { control: "switch", area: "content", nearText: "录制ClassIn教室", checked: true }
      }
    });
    expect(result.document.steps[0]).not.toHaveProperty("onPage");
    expect(result.document.steps[0]).not.toHaveProperty("reachPage");
    expect(result.document.steps[0]).not.toHaveProperty("runFlow");
  });

  it("rejects text field locators scoped only by page title instead of the requested field label", () => {
    const response = readyResponse();
    response.summary = "修改课堂标题";
    response.document.purpose = "business";
    response.document.testLevel = "business_smoke";
    response.document.name = "修改课堂标题";
    response.document.entry = undefined;
    response.document.outcome = undefined;
    response.document.parameters = {};
    response.document.steps = [{
      id: "fill-lesson-title",
      role: "business",
      risk: "interaction",
      inputText: {
        target: { control: "textField", area: "content", scopeText: "新建课堂", ordinal: 1 },
        value: "11111",
        search: { mode: "visibleOnly" }
      }
    }];

    expect(() => parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog: buildScriptFlowPlannerCatalog(planningPageCatalog(), [], "cn.eeo.classin", "android"),
      prompt: "把课堂标题改成11111"
    })).toThrow(/课堂标题.*定位|字段标签/);
  });

  it("normalizes reusable form field searches to auto when the prompt does not pin the visible viewport", () => {
    const response = readyResponse();
    response.summary = "修改课堂标题";
    response.document.purpose = "business";
    response.document.testLevel = "business_smoke";
    response.document.name = "修改课堂标题";
    response.document.entry = undefined;
    response.document.outcome = undefined;
    response.document.parameters = {};
    response.document.steps = [{
      id: "fill-lesson-title",
      role: "business",
      risk: "interaction",
      inputText: {
        target: { control: "textField", area: "content", scopeText: "课堂标题", ordinal: 1 },
        value: "11111",
        search: { mode: "visibleOnly" }
      }
    }];

    expect(parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog: buildScriptFlowPlannerCatalog(planningPageCatalog(), [], "cn.eeo.classin", "android"),
      prompt: "把课堂标题改成11111"
    })).toMatchObject({
      document: {
        steps: [{
          inputText: {
            target: { control: "textField", scopeText: "课堂标题" },
            search: { mode: "auto" }
          }
        }]
      }
    });
  });

  it("asks for field coverage before accepting full form regression drafts without explicit fields", async () => {
    const response = fullRegressionLessonResponse();
    let aiCalls = 0;

    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "创建课堂页面所有表单都填一遍",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: planningPageCatalog(),
      flows: [],
      fetchImpl: async () => {
        aiCalls += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }), { status: 200 });
      }
    });

    expect(aiCalls).toBe(1);
    expect(result).toMatchObject({
      status: "needs_clarification",
      clarification: expect.stringContaining("字段")
    });
  });

  it("accepts full form regression drafts when the prompt explicitly lists covered fields", async () => {
    const response = fullRegressionLessonResponse();

    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "创建课堂页面全字段覆盖，字段包括课堂名称、课堂说明",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: planningPageCatalog(),
      flows: [],
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }), { status: 200 })
    });

    expect(result).toMatchObject({
      status: "trial_ready",
      document: { testLevel: "full_regression" }
    });
  });

  it("reuses an exactly matching saved draft as a trial candidate without calling AI", async () => {
    const candidate = draftAddFriendFlow();
    let aiCalled = false;

    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "从主页进入添加好友页面",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: pageCatalog(),
      flows: [candidate],
      fetchImpl: async () => {
        aiCalled = true;
        throw new Error("AI should not be called for an exact draft match");
      }
    });

    expect(aiCalled).toBe(false);
    expect(result).toMatchObject({
      status: "trial_ready",
      sourceYaml: candidate.sourceYaml,
      sourceFlow: { id: candidate.id, version: candidate.version, name: candidate.name }
    });
  });

  it("uses a matching saved draft as revision context when the user supplies explicit operations", async () => {
    const candidate = draftAddFriendFlow();
    const requestBodies: string[] = [];

    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "在主页点击右上角加号，然后点击添加好友",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: pageCatalog(),
      flows: [candidate],
      fetchImpl: async (_url, init) => {
        requestBodies.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(readyResponse()) } }] }), { status: 200 });
      }
    });

    expect(requestBodies).toHaveLength(1);
    const request = JSON.parse(requestBodies[0]!) as { messages: Array<{ content: string }> };
    expect(request.messages[1]?.content).toContain("修改现有用例");
    expect(result).toMatchObject({
      status: "trial_ready",
      sourceFlow: { id: candidate.id, version: candidate.version, name: candidate.name }
    });
  });

  it("replaces internal page identifiers in user-facing clarification messages", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");

    const result = parseScriptFlowAiResponse(JSON.stringify({
      status: "needs_clarification",
      clarification: "当前没有从 classin.home 到 classin.friend.add 的已验证路径。"
    }), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt: "从主页进入添加好友页面"
    });

    expect(result).toEqual({
      status: "needs_clarification",
      clarification: "当前没有从“主页”到“添加好友”的已验证路径。"
    });
  });

  it("rejects replacing explicit user clicks with a reachPage shortcut", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = "打开添加好友";
    response.document.steps = [{
      id: "reach-home",
      role: "navigation",
      reachPage: { page: "classin.home", policy: "safe" }
    }];

    expect(() => parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt: "在主页点击右上角加号，然后点击添加好友"
    })).toThrow(/明确操作.*点击右上角加号.*不能被 reachPage、runFlow 或已有资产替代/);
  });

  it("preserves explicit operations while allowing reachPage for a vague segment", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = "从主页打开更多菜单";
    response.document.steps = [
      { id: "reach-home", role: "navigation", reachPage: { page: "classin.home", policy: "safe" } },
      {
        id: "open-more-menu",
        role: "navigation",
        onPage: "classin.home",
        risk: "interaction",
        tap: {
          target: { icon: "add", area: "topBar", position: "trailing" },
          search: { mode: "visibleOnly" }
        }
      }
    ];

    expect(parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt: "先到主页，然后点击右上角加号"
    })).toMatchObject({
      status: "ready",
      document: { steps: [{ reachPage: { page: "classin.home" } }, { tap: expect.any(Object) }] }
    });
  });

  it("accepts the complete explicit click sequence even when assets could provide a shortcut", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");

    expect(parseScriptFlowAiResponse(JSON.stringify(readyResponse()), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt: "在主页点击右上角加号，然后点击添加好友"
    })).toMatchObject({
      status: "ready",
      document: { steps: [{ tap: expect.any(Object) }, { tap: expect.any(Object) }] }
    });
  });

  it("does not reject an actionable click only because it has no page or result oracle", async () => {
    const response = readyResponse();
    response.summary = "点击左上角返回按钮";
    response.document.name = "点击左上角返回";
    response.document.entry = undefined;
    response.document.outcome = undefined;
    response.document.steps = [{
      id: "tap-top-left-back",
      role: "navigation",
      risk: "interaction",
      tap: {
        target: { icon: "back", area: "topBar", position: "leading" },
        search: { mode: "visibleOnly" }
      }
    }];
    let callCount = 0;

    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "点击左上角返回",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: pageCatalog(),
      flows: [],
      fetchImpl: async () => {
        callCount += 1;
        const content = callCount === 1
          ? { status: "needs_clarification", clarification: "请补充当前页面 key 或返回后的结果验证。" }
          : response;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
      }
    });

    expect(callCount).toBe(2);
    expect(result).toMatchObject({
      status: "trial_ready",
      document: {
        steps: [{
          tap: {
            target: { icon: "back", area: "topBar", position: "leading" },
            search: { mode: "visibleOnly" }
          }
        }]
      },
      verification: { unresolvedOutcome: true }
    });
  });

  it.each([
    {
      label: "文字点击",
      prompt: "点击课堂报告",
      step: {
        id: "tap-class-report",
        role: "business" as const,
        risk: "interaction" as const,
        tap: { target: { text: "课堂报告", area: "content" as const }, search: { mode: "auto" as const } }
      }
    },
    {
      label: "标准图标点击",
      prompt: "点击右上角分享图标",
      step: {
        id: "tap-share",
        role: "business" as const,
        risk: "interaction" as const,
        tap: {
          target: { icon: "share", area: "topBar" as const, position: "trailing" as const },
          search: { mode: "visibleOnly" as const }
        }
      }
    },
    {
      label: "文字输入",
      prompt: "在课堂名称中输入自动化测试",
      step: {
        id: "input-class-name",
        role: "business" as const,
        inputText: {
          target: { text: "课堂名称", area: "content" as const },
          value: "自动化测试",
          search: { mode: "auto" as const }
        }
      }
    },
    {
      label: "页面滑动",
      prompt: "向上滑动",
      step: {
        id: "swipe-up",
        role: "business" as const,
        swipe: { direction: "up" as const }
      }
    }
  ])("accepts $label as an executable trial without inventing an outcome", ({ prompt, step }) => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = prompt;
    response.document.purpose = "business";
    response.document.testLevel = classifyScriptFlowTestLevel(prompt);
    response.document.entry = undefined;
    response.document.outcome = undefined;
    response.document.steps = [step];

    expect(parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt
    })).toMatchObject({
      status: "ready",
      document: { steps: [expect.objectContaining({ id: step.id })] }
    });
  });

  it("canonicalizes an explicit picker sequence without losing its selected value", () => {
    const prompt = "主页进入班级四十二号，打开创建课堂页面，然后点击课堂时长，再弹出的时间选择中滑动选择10小时40分钟，点确定，然后点击发布";
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = "设置课堂时长并发布";
    response.document.purpose = "business";
    response.document.entry = undefined;
    response.document.outcome = undefined;
    response.document.steps = [
      {
        id: "select-duration",
        role: "business",
        risk: "interaction",
        selectText: {
          target: { text: "课堂时长", area: "content" },
          value: "10小时40分钟",
          confirmText: "确定",
          search: { mode: "auto" }
        }
      },
      {
        id: "publish",
        role: "business",
        risk: "publish",
        tap: { target: { text: "发布" }, search: { mode: "visibleOnly" } }
      }
    ];

    expect(parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt
    })).toMatchObject({
      status: "ready",
      document: { steps: [{ id: "select-duration" }, { id: "publish" }] }
    });
  });

  it.each(["topBar", "content"] as const)("rejects an ungrounded %s constraint for a publish target", (area) => {
    const prompt = "点击发布";
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = "发布课堂";
    response.document.purpose = "business";
    response.document.entry = undefined;
    response.document.outcome = undefined;
    response.document.steps = [{
      id: "publish",
      role: "business",
      risk: "publish",
      tap: {
        target: { text: "发布", area },
        search: { mode: "visibleOnly" }
      }
    }];

    expect(() => parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt
    })).toThrow(new RegExp(`发布.*${area}.*没有.*位置依据`));
  });

  it("rejects guessed swipes when the user supplied an exact picker value", () => {
    const prompt = "点击课堂时长，在弹出的时间选择中滑动选择10小时40分钟，点确定";
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = "设置课堂时长";
    response.document.purpose = "business";
    response.document.testLevel = "component";
    response.document.entry = undefined;
    response.document.outcome = undefined;
    response.document.steps = [
      {
        id: "tap-duration",
        role: "business",
        risk: "interaction",
        tap: { target: { text: "课堂时长", area: "content" }, search: { mode: "auto" } }
      },
      { id: "swipe-duration", role: "business", swipe: { direction: "up" } },
      {
        id: "confirm-duration",
        role: "business",
        risk: "interaction",
        tap: { target: { text: "确定", area: "content" }, search: { mode: "visibleOnly" } }
      }
    ];

    expect(() => parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt
    })).toThrow(/10小时40分钟.*selectText/);
  });

  it("rejects a redundant field tap before a compound picker selection", () => {
    const prompt = "点击课堂时长，在弹出的时间选择中滑动选择10小时40分钟，点确定";
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = "设置课堂时长";
    response.document.purpose = "business";
    response.document.testLevel = "component";
    response.document.entry = undefined;
    response.document.outcome = undefined;
    response.document.steps = [
      {
        id: "tap-duration",
        role: "business",
        risk: "interaction",
        tap: { target: { text: "课堂时长", area: "content" }, search: { mode: "auto" } }
      },
      {
        id: "select-duration",
        role: "business",
        risk: "interaction",
        selectText: {
          target: { text: "课堂时长", area: "content" },
          value: "10小时40分钟",
          confirmText: "确定",
          search: { mode: "auto" }
        }
      }
    ];

    expect(() => parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt
    })).toThrow(/selectText.*前置.*tap/);
  });

  it("still allows clarification when an explicit operation is missing a real parameter", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");

    expect(parseScriptFlowAiResponse(JSON.stringify({
      status: "needs_clarification",
      clarification: "请提供要点击的具体班级名称。"
    }), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt: "点击指定班级"
    })).toEqual({
      status: "needs_clarification",
      clarification: "请提供要点击的具体班级名称。"
    });
  });

  it("reviews a clarification once and extracts a parameter already present in the user request", async () => {
    const response = readyResponse();
    response.document.name = "进入指定班级的新建课堂页面";
    response.document.outcome = { page: "classin.lesson.create", session: "authenticated", role: "teacher" };
    response.document.parameters = {};
    response.document.steps = [{ id: "open-create-lesson", role: "navigation", runFlow: "flow-open-lesson" }];
    response.parameterValues = { className: "班级四十二号" };
    let callCount = 0;
    let reviewRequest = "";

    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "进入班级四十二号的新建课堂页面",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: planningPageCatalog(),
      flows: planningFlows(),
      fetchImpl: async (_url, init) => {
        callCount += 1;
        if (callCount === 2) reviewRequest = String(init?.body ?? "");
        const content = callCount === 1
          ? { status: "needs_clarification", clarification: "请补充要进入的班级名称。" }
          : response;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
      }
    });

    expect(callCount).toBe(2);
    expect(reviewRequest).toContain("可能已经给出了班级");
    expect(result).toMatchObject({
      status: "trial_ready",
      parameterValues: { className: "班级四十二号" }
    });
  });

  it("returns the clarification after one review when the required value is truly absent", async () => {
    let callCount = 0;
    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "进入指定班级的新建课堂页面",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: planningPageCatalog(),
      flows: planningFlows(),
      fetchImpl: async () => {
        callCount += 1;
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            status: "needs_clarification",
            clarification: "请补充要进入的班级名称。"
          }) } }]
        }), { status: 200 });
      }
    });

    expect(callCount).toBe(2);
    expect(result).toMatchObject({
      status: "needs_clarification",
      clarification: "请补充要进入的班级名称。"
    });
  });

  it("rejects explicit click targets generated in the wrong order", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.steps = [response.document.steps[1]!, response.document.steps[0]!];

    expect(() => parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt: "在主页点击右上角加号，然后点击添加好友"
    })).toThrow(/明确操作.*点击右上角加号.*目标.*顺序/);
  });

  it("accepts a target-only request as reachPage without asking how to navigate", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = "到达主页";
    response.document.steps = [{
      id: "reach-home",
      role: "navigation",
      reachPage: { page: "classin.home", policy: "safe" }
    }];

    expect(parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog
    })).toMatchObject({
      status: "ready",
      document: { steps: [{ reachPage: { page: "classin.home", policy: "safe" } }] }
    });

    const prompt = buildScriptFlowPlannerPrompt("回到主页", "cn.eeo.classin", "android", catalog);
    expect(prompt).toContain("reachPage");
    expect(prompt).toContain("不要因为“回到”推断系统返回");
    expect(prompt).toContain("tap、inputText、clearText 和 selectText 使用同一 search 合同");
    expect(prompt).toContain('"kind": "case | scenario"');
    expect(prompt).toContain('"entry"');
    expect(prompt).toContain('"outcome"');
  });

  it("rejects a bare reachPage for an unindexed bottom-tab page", () => {
    const catalog = buildScriptFlowPlannerCatalog(bottomTabPageCatalog(), planningFlows(), "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = "进入成长页";
    response.document.entry = { session: "authenticated", role: "teacher" };
    response.document.steps = [{
      id: "reach-growth",
      role: "navigation",
      reachPage: { page: "classin.growth", policy: "safe" }
    }];

    expect(() => parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt: "进入成长页"
    })).toThrow(/成长页.*没有可执行导航路径/);

    const prompt = buildScriptFlowPlannerPrompt("进入成长页", "cn.eeo.classin", "android", catalog);
    expect(prompt).not.toContain("带 bottom-tab 标签但无路径");
    expect(prompt).toContain('"navigationAnchors"');
  });

  it("uses only accepted navigation entries as executable planner transitions", () => {
    const catalog = buildScriptFlowPlannerCatalog(
      bottomTabPageCatalog(),
      planningFlows(),
      "cn.eeo.classin",
      "android",
      [learnedNavigationEntry()]
    );
    const response = readyResponse();
    response.document.name = "进入成长页";
    response.document.entry = { page: "classin.home", session: "authenticated", role: "teacher" };
    response.document.steps = [{
      id: "reach-growth",
      role: "navigation",
      reachPage: { page: "classin.growth", policy: "safe" }
    }];

    expect(catalog.navigationEntries).toEqual([
      expect.objectContaining({
        id: "navigation-growth",
        from: { kind: "page", key: "classin.home" },
        toPage: "classin.growth",
        action: expect.objectContaining({ target: { text: "成长", area: "bottomBar" } })
      })
    ]);
    expect(catalog.transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        onPage: "classin.home",
        expectPage: "classin.growth",
        source: "navigation_entry"
      })
    ]));
    expect(parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt: "进入成长页"
    })).toMatchObject({
      status: "ready",
      document: { steps: [{ reachPage: { page: "classin.growth", policy: "safe" } }] }
    });

    const prompt = buildScriptFlowPlannerPrompt("进入成长页", "cn.eeo.classin", "android", catalog);
    expect(prompt).toContain('"navigationEntries"');
    expect(prompt).toContain('"toPage": "classin.growth"');
    expect(prompt).toContain('"text": "成长"');
  });

  it("excludes reusable flows and navigation entries from another App or platform", () => {
    const classInFlow = planningFlows()[0]!;
    const anotherAppFlow = { ...classInFlow, id: "flow-other-app", appId: "com.example.another" };
    const iosFlow = { ...classInFlow, id: "flow-ios", platform: "ios" as const };
    const classInNavigation = learnedNavigationEntry();
    const anotherAppNavigation = { ...classInNavigation, id: "navigation-other-app", appId: "com.example.another" };
    const iosNavigation = { ...classInNavigation, id: "navigation-ios", platformScope: "ios" as const };

    const catalog = buildScriptFlowPlannerCatalog(
      bottomTabPageCatalog(),
      [classInFlow, anotherAppFlow, iosFlow],
      "cn.eeo.classin",
      "android",
      [classInNavigation, anotherAppNavigation, iosNavigation]
    );

    expect(catalog.reusableFlows.map((flow) => flow.id)).toEqual([classInFlow.id]);
    expect(catalog.navigationEntries.map((entry) => entry.id)).toEqual([classInNavigation.id]);
    expect(JSON.stringify(catalog)).not.toContain("com.example.another");
    expect(JSON.stringify(catalog)).not.toContain("navigation-ios");
  });

  it("returns the model classification with the generated test draft", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.kind = "scenario";

    expect(parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog
    })).toMatchObject({ status: "ready", kind: "scenario", document: { kind: "scenario" } });
  });

  it("adds parameters required by reused flows and the navigation path to a target page", () => {
    const catalog = buildScriptFlowPlannerCatalog(planningPageCatalog(), planningFlows(), "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = "重新登录后进入新建课堂";
    response.document.parameters = {};
    response.document.steps = [
      { id: "login", role: "setup", runFlow: "flow-login" },
      { id: "reach-lesson", role: "navigation", reachPage: { page: "classin.lesson.create", policy: "safe" } }
    ];

    expect(parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog
    })).toMatchObject({
      status: "ready",
      document: {
        parameters: {
          account: { label: "手机号或邮箱", required: true, sensitive: true },
          password: { label: "密码", required: true, sensitive: true },
          className: { label: "班级名称", required: true }
        }
      }
    });
  });

  it("accepts AI-extracted credentials as ephemeral runtime values", () => {
    const catalog = buildScriptFlowPlannerCatalog(planningPageCatalog(), planningFlows(), "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = "重新登录后进入新建课堂";
    response.document.parameters = {};
    response.document.steps = [{ id: "login", role: "setup", runFlow: "flow-login" }];
    response.parameterValues = {
      account: "demo-account",
      password: "demo-secret"
    };

    const result = parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog
    });

    expect(result).toMatchObject({
      status: "ready",
      parameterValues: {
        account: "demo-account",
        password: "demo-secret"
      }
    });
    if (result.status === "ready") {
      expect(result.sourceYaml).not.toContain("demo-account");
      expect(result.sourceYaml).not.toContain("demo-secret");
    }
  });

  it("rejects AI-extracted values for undeclared parameters", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.parameterValues = { unknownAccount: "demo-account" };

    expect(() => parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog
    })).toThrow("未声明的运行参数");
  });

  it("rejects a tap risk emitted inside the action object", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.steps = [{
      id: "open-menu",
      role: "navigation",
      onPage: "classin.home",
      tap: {
        target: { icon: "add", area: "topBar", position: "trailing" },
        search: { mode: "visibleOnly" },
        risk: "interaction"
      }
    } as unknown as ScriptFlowDocument["steps"][number]];

    expect(() => parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog
    })).toThrow(/risk.*unknown field/i);
  });

  it("rejects legacy element asset targets instead of normalizing them", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.steps = [{
      id: "legacy-target",
      role: "navigation",
      onPage: "classin.home",
      tap: { target: { ref: "home-add-friend" } }
    } as unknown as ScriptFlowDocument["steps"][number]];

    expect(() => parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog
    })).toThrow(/禁止字段.*target\.ref/i);
  });

  it("rejects extra response fields instead of ignoring model pollution", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = { ...readyResponse(), explanation: "I also changed the selector" };

    expect(() => parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog
    })).toThrow("未允许的外层字段");
  });

  it("safely unwraps a single Markdown JSON fence before strict schema validation", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = `\`\`\`json\n${JSON.stringify(readyResponse())}\n\`\`\``;

    expect(parseScriptFlowAiResponse(response, {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog
    })).toMatchObject({ status: "ready", document: { name: "打开添加好友" } });
  });

  it("wraps a flattened ready ScriptFlow document response from the AI", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = {
      status: "ready",
      summary: "设置课堂时长",
      assumptions: [],
      parameterValues: {},
      version: 1,
      kind: "case",
      purpose: "business",
      testLevel: "component",
      name: "设置课堂时长",
      app: { id: "cn.eeo.classin", platform: "android" },
      parameters: {},
      steps: [{
        id: "select-duration",
        role: "business",
        risk: "interaction",
        selectText: {
          target: { text: "课堂时长", area: "content" },
          value: "10小时40分钟",
          confirmText: "确定",
          search: { mode: "auto" }
        }
      }],
      tags: ["ai-generated"]
    };

    expect(parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt: "测试一下课堂时长能不能选到10小时40分钟"
    })).toMatchObject({
      status: "ready",
      summary: "设置课堂时长",
      document: {
        testLevel: "component",
        name: "设置课堂时长",
        steps: [{ id: "select-duration" }]
      }
    });
  });

  it("builds a draft from page identity without exposing element locator assets", async () => {
    const catalog = pageCatalog();
    let requestBody = "";
    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "在主页点击添加好友",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: catalog,
      flows: [],
      fetchImpl: async (_url, init) => {
        requestBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(readyResponse()) } }] }), { status: 200 });
      }
    });

    expect(result).toMatchObject({
      status: "trial_ready",
      document: { name: "打开添加好友" },
      verification: expect.objectContaining({ status: "needs_trial" })
    });
    if (result.status === "ready" || result.status === "trial_ready") {
      expect(result.sourceYaml).toContain('icon: "add"');
      expect(result.sourceYaml).toContain('text: "添加好友"');
      expect(result.sourceYaml).not.toContain("pageElement");
    }
    expect(requestBody).not.toContain("risk，值只能是 none");
    expect(requestBody).not.toContain("home-add-friend");
    expect(requestBody).not.toContain('"locators"');
  });

	  it("asks the model to repair an invalid ScriptFlow response once", async () => {
    const catalog = pageCatalog();
    const requestBodies: string[] = [];
    const invalidResponse = {
      status: "ready",
      summary: "进入主页",
      assumptions: [],
      document: {
        version: 1,
        kind: "case",
        purpose: "navigation",
        testLevel: "business_smoke",
        name: "进入主页",
        app: { id: "cn.eeo.classin", platform: "android" },
        parameters: {},
        steps: [{ role: "assertion", action: "assertPage", page: "classin.home" }],
        tags: ["ai-generated"]
      }
    };
    let callCount = 0;

    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "确认当前在主页",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: catalog,
      flows: [],
      fetchImpl: async (_url, init) => {
        requestBodies.push(String(init?.body ?? ""));
        callCount += 1;
        const content = callCount === 1
          ? JSON.stringify(invalidResponse)
          : JSON.stringify({
              ...readyResponse(),
              document: {
                ...readyResponse().document,
                name: "确认主页",
                steps: [{ id: "assert-home", role: "assertion", assertPage: "classin.home" }]
              }
            });
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
      }
    });

    expect(result).toMatchObject({ status: "trial_ready", document: { name: "确认主页" } });
    expect(requestBodies).toHaveLength(2);
    const repairPrompt = JSON.parse(requestBodies[1]) as { messages: Array<{ content: string }> };
    expect(repairPrompt.messages[1]?.content).toContain("steps[0].action: Unknown field");
    expect(repairPrompt.messages[1]?.content).toContain('"assertPage": "classin.home"');
	    expect(repairPrompt.messages[1]?.content).toContain("不要输出 action 或 page 字段");
	  });

	  it("fills an empty runFlow reference from a unique reusable flow outcome without repair", async () => {
	    let calls = 0;
	    const response = readyResponse();
	    response.document.name = "进入新建课堂";
	    response.document.purpose = "business";
	    response.document.entry = { page: "classin.home", session: "authenticated", role: "teacher" };
	    response.document.outcome = { page: "classin.lesson.create", session: "authenticated", role: "teacher" };
	    response.document.steps = [{
	      id: "open-create-lesson-flow",
	      role: "navigation",
	      expectPage: "classin.lesson.create",
	      runFlow: ""
	    }];

	    const result = await generateScriptFlowDraft({
	      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
	      prompt: "进入新建课堂",
	      appId: "cn.eeo.classin",
	      platform: "android",
	      pageCatalog: planningPageCatalog(),
	      flows: planningFlows(),
	      fetchImpl: async () => {
	        calls += 1;
	        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }), { status: 200 });
	      }
	    });

	    expect(calls).toBe(1);
	    expect(result).toMatchObject({
	      status: "trial_ready",
	      document: {
	        steps: [{ runFlow: "flow-open-lesson" }]
	      }
	    });
	  });

	  it("drops an empty runFlow placeholder when the step already has an executable action", async () => {
	    let calls = 0;
	    const response = readyResponse();
	    response.document.name = "进入新建课堂";
	    response.document.purpose = "business";
	    response.document.entry = { page: "classin.home", session: "authenticated", role: "teacher" };
	    response.document.outcome = { page: "classin.lesson.create", session: "authenticated", role: "teacher" };
	    response.document.steps = [{
	      id: "reach-create-lesson",
	      role: "navigation",
	      runFlow: "",
	      reachPage: { page: "classin.lesson.create", policy: "safe" }
	    } as unknown as ScriptFlowDocument["steps"][number]];

	    const result = await generateScriptFlowDraft({
	      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
	      prompt: "进入新建课堂",
	      appId: "cn.eeo.classin",
	      platform: "android",
	      pageCatalog: planningPageCatalog(),
	      flows: planningFlows(),
	      fetchImpl: async () => {
	        calls += 1;
	        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }), { status: 200 });
	      }
	    });

	    expect(calls).toBe(1);
	    expect(result).toMatchObject({
	      status: "trial_ready",
	      document: {
	        steps: [{ reachPage: { page: "classin.lesson.create" } }]
	      }
	    });
	    expect(result.status === "trial_ready" || result.status === "ready" ? result.document.steps[0] : {}).not.toHaveProperty("runFlow");
	  });

	  it("repairs literal target text invented by the model instead of executing it", async () => {
    const catalog = pageCatalog();
    const requestBodies: string[] = [];
    const invented = readyResponse();
    invented.document.steps[1] = {
      ...invented.document.steps[1],
      tap: {
        target: { text: "创建添加好友", area: "content" },
        search: { mode: "visibleOnly" }
      }
    } as ScriptFlowDocument["steps"][number];
    let callCount = 0;

    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "在主页点击加号，然后点击添加好友",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: catalog,
      flows: [],
      fetchImpl: async (_url, init) => {
        requestBodies.push(String(init?.body ?? ""));
        callCount += 1;
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(callCount === 1 ? invented : readyResponse()) } }]
        }), { status: 200 });
      }
    });

    expect(result).toMatchObject({ status: "trial_ready", document: { steps: [expect.anything(), expect.objectContaining({
      tap: expect.objectContaining({ target: expect.objectContaining({ text: "添加好友" }) })
    })] } });
    expect(requestBodies).toHaveLength(2);
    const repairPrompt = JSON.parse(requestBodies[1]) as { messages: Array<{ content: string }> };
    expect(repairPrompt.messages[1]?.content).toContain("没有来自用户描述或已知目录的字面依据");
    expect(repairPrompt.messages[1]?.content).toContain("semantic");
  });

  it("asks for result evidence when the generated target page is not recorded", async () => {
    const response = readyResponse();
    response.document.outcome = { page: "classin.teaching.plan" };
    response.document.steps = [{ id: "reach-teaching-plan", role: "navigation", reachPage: { page: "classin.teaching.plan", policy: "safe" } }];
    let callCount = 0;

    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "打开教学方案页面",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: pageCatalog(),
      flows: [],
      fetchImpl: async () => {
        callCount += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }), { status: 200 });
      }
    });

    expect(callCount).toBe(1);
    expect(result).toMatchObject({
      status: "needs_clarification",
      clarification: expect.stringContaining("教学方案")
    });
    if (result.status === "needs_clarification") {
      expect(result.clarification).toContain("完整操作过程");
      expect(result.clarification).toContain("稳定文字");
      expect(result.clarification).not.toContain("先录入");
    }
  });

  it("accepts user-provided stable text as the result evidence for an unrecorded page", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = "进入教学方案并验证结果";
    response.document.outcome = undefined;
    response.document.steps = [
      {
        id: "open-teaching-plan",
        role: "navigation",
        onPage: "classin.home",
        tap: {
          target: { semantic: "进入教学方案的入口", area: "content" },
          search: { mode: "auto" }
        }
      },
      {
        id: "verify-teaching-plan",
        role: "assertion",
        assertText: { text: "教学方案列表", match: "contains" }
      }
    ];

    expect(parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt: "在主页找到教学方案入口并点击，看到教学方案列表就算成功"
    })).toMatchObject({
      status: "ready",
      document: {
        steps: [expect.anything(), {
          assertText: { text: "教学方案列表", match: "contains" }
        }]
      }
    });
  });

  it("accepts an explicit operation chain without an oracle as a trial requiring outcome review", async () => {
    const response = readyResponse();
    response.document.name = "进入未录入的教学方案页面";
    response.document.entry = undefined;
    response.document.outcome = undefined;
    response.document.steps = [
      {
        id: "open-class",
        role: "navigation",
        tap: { target: { text: "班级四十二号" }, search: { mode: "auto" } }
      },
      {
        id: "open-teaching-plan",
        role: "navigation",
        tap: { target: { semantic: "进入教学方案的入口", area: "content" }, search: { mode: "auto" } }
      }
    ];

    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "点击班级四十二号，然后找到教学方案入口并点击",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: emptyPageCatalog(),
      flows: [],
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(response) } }]
      }), { status: 200 })
    });

    expect(result).toMatchObject({
      status: "trial_ready",
      document: { steps: [{ tap: expect.any(Object) }, { tap: expect.any(Object) }] },
      verification: { unresolvedOutcome: true }
    });
  });

  it("rejects page references invented by the model", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.steps[0].onPage = "classin.unknown";

    expect(() => parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog
    })).toThrow("未录入页面");
  });

  it("rejects page references used as executable action targets", async () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = "选择添加好友页面";
    response.document.purpose = "business";
    response.document.testLevel = "component";
    response.document.steps = [{
      id: "select-page-key",
      role: "business",
      risk: "interaction",
      selectText: {
        target: { text: "classin.friend.add" },
        value: "10小时40分钟",
        search: { mode: "auto" }
      }
    }];

    expect(() => parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog
    })).toThrow(/页面引用.*动作目标/);

    let calls = 0;
    await expect(generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "打开新建课堂，然后修改课堂时长为11小时20分钟。班级：班级四十二号",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: pageCatalog(),
      flows: [],
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }), { status: 200 });
      }
    })).resolves.toMatchObject({
      status: "needs_clarification",
      clarification: expect.stringContaining("字段或按钮原文")
    });
    expect(calls).toBe(1);
  });

  it("canonicalizes grounded picker semantic targets into executable text targets", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = "设置课堂时长";
    response.document.purpose = "business";
    response.document.testLevel = "component";
    response.document.steps = [{
      id: "select-duration",
      role: "business",
      risk: "interaction",
      selectText: {
        target: { semantic: "课堂时长" },
        value: "11小时20分钟",
        search: { mode: "auto" }
      }
    }];

    expect(parseScriptFlowAiResponse(JSON.stringify(response), {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog,
      prompt: "修改课堂时长为11小时20分钟"
    })).toMatchObject({
      status: "ready",
      document: {
        steps: [{
          selectText: { target: { text: "课堂时长" } }
        }]
      }
    });
  });

  it("asks for clarification when a non-tap action target is not executable", async () => {
    const response = readyResponse();
    response.document.name = "设置未知字段";
    response.document.purpose = "business";
    response.document.testLevel = "component";
    response.document.steps = [{
      id: "select-unknown",
      role: "business",
      risk: "interaction",
      selectText: {
        target: { semantic: "要调整的选择器" },
        value: "11小时20分钟",
        search: { mode: "auto" }
      }
    }];

    const result = await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "把当前页面字段改成11小时20分钟",
      appId: "cn.eeo.classin",
      platform: "android",
      pageCatalog: pageCatalog(),
      flows: [],
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }), { status: 200 })
    });

    expect(result).toMatchObject({
      status: "needs_clarification",
      clarification: expect.stringContaining("字段或按钮原文")
    });
  });

  it("keeps page element locators out of the AI planner catalog", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");

    expect(catalog.pages).toEqual([
      { id: "page-home", key: "classin.home", name: "主页", tags: ["navigation-root"] },
      { id: "page-friend-add", key: "classin.friend.add", name: "添加好友", tags: [] }
    ]);
  });

  it("derives a read-only transition index from active scripts", () => {
    const document = readyResponse().document;
    document.entry = { page: "classin.home", session: "authenticated", role: "teacher" };
    document.outcome = { page: "classin.friend.add", session: "authenticated", role: "teacher" };
    const flow: ScriptFlow = {
      id: "flow-add-friend",
      appId: "cn.eeo.classin",
      platform: "android",
      name: "打开添加好友",
      sourceYaml: "",
      parsed: document,
      status: "active",
      version: 1,
      tags: [],
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z"
    };

    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [flow], "cn.eeo.classin", "android");

    expect(catalog.transitions).toEqual([expect.objectContaining({
      onPage: "classin.home",
      expectPage: "classin.friend.add",
      flowId: "flow-add-friend",
      action: "tap"
    })]);
    expect(catalog.reusableFlows).toEqual([expect.objectContaining({
      id: "flow-add-friend",
      kind: "case",
      entry: document.entry,
      outcome: document.outcome
    })]);
  });

  it("includes the complete existing use case when asking AI to modify it", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const existing = readyResponse().document;
    const prompt = buildScriptFlowPlannerPrompt(
      "把添加好友改成搜索好友后再确认",
      "cn.eeo.classin",
      "android",
      catalog,
      existing
    );

    expect(prompt).toContain("修改现有用例");
    expect(prompt).toContain("未提及的步骤、参数和约束保持不变");
    expect(prompt).toContain('"name": "打开添加好友"');
    expect(prompt).toContain("把添加好友改成搜索好友后再确认");
  });

  it("does not offer the use case being revised as its own reusable child flow", async () => {
    const existingFlow: ScriptFlow = {
      id: "flow-add-friend",
      appId: "cn.eeo.classin",
      platform: "android",
      name: "打开添加好友",
      sourceYaml: "",
      parsed: readyResponse().document,
      status: "active",
      version: 2,
      tags: [],
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z"
    };
    existingFlow.sourceYaml = JSON.stringify(existingFlow.parsed);
    let requestBody = "";

    await generateScriptFlowDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      prompt: "增加搜索步骤",
      appId: existingFlow.appId,
      platform: existingFlow.platform,
      pageCatalog: pageCatalog(),
      flows: [existingFlow],
      existingFlow: { ...existingFlow, sourceYaml: scriptSource(readyResponse().document) },
      fetchImpl: async (_url, init) => {
        requestBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(readyResponse()) } }] }), { status: 200 });
      }
    });

    const request = JSON.parse(requestBody) as { messages: Array<{ content: string }> };
    expect(request.messages[1]?.content).not.toContain('"id": "flow-add-friend"');
  });
});

function scriptSource(document: ScriptFlowDocument): string {
  return [
    "version: 1",
    `name: ${document.name}`,
    "app: { id: cn.eeo.classin, platform: android }",
    "steps:",
    "  - id: open-more-menu",
    "    onPage: classin.home",
    "    tap: { target: { icon: add, area: topBar, position: trailing } }"
  ].join("\n");
}

function readyResponse(): {
  status: "ready";
  summary: string;
  assumptions: string[];
  parameterValues?: Record<string, string | number | boolean>;
  document: ScriptFlowDocument;
} {
  return {
    status: "ready",
    summary: "从主页进入添加好友页",
    assumptions: [],
    document: {
      version: 1 as const,
      kind: "case" as const,
      purpose: "navigation" as const,
      testLevel: "business_smoke" as const,
      name: "打开添加好友",
      app: { id: "cn.eeo.classin", platform: "android" as const },
      start: { strategy: "keepCurrent" as const },
      parameters: {},
      steps: [
        {
          id: "open-more-menu",
          name: "打开主页更多菜单",
          role: "navigation" as const,
          onPage: "classin.home",
          risk: "interaction" as const,
          tap: {
            target: { icon: "add", area: "topBar" as const, position: "trailing" as const },
            search: { mode: "visibleOnly" as const }
          }
        },
        {
          id: "open-add-friend",
          name: "点击添加好友",
          role: "navigation" as const,
          onPage: "classin.home",
          expectPage: "classin.friend.add",
          risk: "interaction" as const,
          tap: {
            target: { text: "添加好友", area: "content" as const },
            search: { mode: "visibleOnly" as const }
          }
        }
      ],
      tags: ["ai-generated"]
    }
  };
}

function lessonCreateScreenContext(): ScreenUnderstandingContext {
  return {
    used: true,
    observationId: "observation-lesson-create",
    visionUsed: true,
    page: { key: "classin.lesson.create", name: "新建课堂", confidence: 0.92 },
    visibleStableTexts: ["课堂信息", "课堂时长", "录制ClassIn教室", "发布"],
    controlCandidates: [
      {
        candidateId: "field.lessonName",
        control: "textField",
        semanticName: "lessonName",
        scopeText: "课堂信息",
        ordinal: 1,
        valueKind: "dynamicValue",
        confidence: 0.78,
        assetEligible: false
      },
      {
        candidateId: "switch.recordClassIn",
        control: "switch",
        semanticName: "recordClassIn",
        nearText: "录制ClassIn教室",
        valueKind: "unknown",
        confidence: 0.82,
        assetEligible: false
      }
    ],
    rejectedReasons: ["controlCandidates[0].currentValue removed because valueKind is dynamicValue"]
  };
}

function fullRegressionLessonResponse(): ReturnType<typeof readyResponse> {
  const response = readyResponse();
  response.document.name = "创建课堂全字段回归";
  response.document.purpose = "business";
  response.document.testLevel = "full_regression";
  response.document.entry = { page: "classin.lesson.create", session: "authenticated", role: "teacher" };
  response.document.outcome = { page: "classin.lesson.create", session: "authenticated", role: "teacher" };
  response.document.steps = [
    {
      id: "fill-lesson-name",
      role: "business",
      onPage: "classin.lesson.create",
      risk: "interaction",
      inputText: {
        target: { semantic: "课堂名称输入框", area: "content" },
        value: "自动化课堂",
        search: { mode: "auto" }
      }
    },
    {
      id: "fill-lesson-summary",
      role: "business",
      onPage: "classin.lesson.create",
      risk: "interaction",
      inputText: {
        target: { semantic: "课堂说明输入框", area: "content" },
        value: "自动化说明",
        search: { mode: "auto" }
      }
    }
  ];
  return response;
}

function draftAddFriendFlow(): ScriptFlow {
  const document = {
    ...readyResponse().document,
    name: "从主页进入添加好友页面"
  };
  return {
    id: "flow-add-friend-draft",
    appId: "cn.eeo.classin",
    platform: "android",
    name: document.name,
    description: "从主页点击右上角加号，再点击添加好友。",
    sourceYaml: serializeScriptFlow(document),
    parsed: document as unknown as Record<string, unknown>,
    status: "draft",
    version: 4,
    tags: [],
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z"
  };
}

function pageCatalog(): PageAssetCatalog {
  const pages = [
    { id: "page-home", key: "classin.home", name: "主页", appId: "cn.eeo.classin", graphVersionId: "v1", matcherCount: 2, tags: ["navigation-root"] },
    { id: "page-friend-add", key: "classin.friend.add", name: "添加好友", appId: "cn.eeo.classin", graphVersionId: "v1", matcherCount: 2 }
  ];
  return {
    listPages: () => pages,
    getPage: () => undefined,
    resolvePage: (reference) => {
      const page = pages.find((candidate) => candidate.id === reference || candidate.key === reference);
      return page ? { ...page, node: {} as never } : undefined;
    },
    findConfusablePages: () => []
  };
}

function emptyPageCatalog(): PageAssetCatalog {
  return {
    listPages: () => [],
    getPage: () => undefined,
    resolvePage: () => undefined,
    findConfusablePages: () => []
  };
}

function planningPageCatalog(): PageAssetCatalog {
  const pages = [
    { id: "page-login", key: "classin.login", name: "登录页", appId: "cn.eeo.classin", graphVersionId: "v1", matcherCount: 2 },
    { id: "page-home", key: "classin.home", name: "主页", appId: "cn.eeo.classin", graphVersionId: "v1", matcherCount: 2 },
    { id: "page-class", key: "classin.class.detail", name: "班级详情", appId: "cn.eeo.classin", graphVersionId: "v1", matcherCount: 2 },
    { id: "page-lesson", key: "classin.lesson.create", name: "新建课堂", appId: "cn.eeo.classin", graphVersionId: "v1", matcherCount: 2 }
  ];
  return {
    listPages: () => pages,
    getPage: () => undefined,
    resolvePage: (reference) => {
      const page = pages.find((candidate) => candidate.id === reference || candidate.key === reference);
      return page ? { ...page, node: {} as never } : undefined;
    },
    findConfusablePages: () => []
  };
}

function bottomTabPageCatalog(): PageAssetCatalog {
  const pages = [
    {
      id: "page-home",
      key: "classin.home",
      name: "主页",
      appId: "cn.eeo.classin",
      graphVersionId: "v1",
      matcherCount: 2,
      tags: ["navigation-root"]
    },
    {
      id: "page-growth",
      key: "classin.growth",
      name: "成长页",
      appId: "cn.eeo.classin",
      graphVersionId: "v1",
      matcherCount: 2,
      tags: ["bottom-tab"]
    }
  ];
  return {
    listPages: () => pages,
    getPage: () => undefined,
    resolvePage: (reference) => {
      const page = pages.find((candidate) => candidate.id === reference || candidate.key === reference || candidate.name === reference);
      return page ? { ...page, node: {} as never } : undefined;
    },
    findConfusablePages: () => []
  };
}

function learnedNavigationEntry(): NavigationEntry {
  return {
    id: "navigation-growth",
    key: "classin.home.tap.text.成长.area.bottomBar.to.classin.growth",
    appId: "cn.eeo.classin",
    platformScope: "android",
    from: { kind: "page", key: "classin.home" },
    toPage: "classin.growth",
    name: "主页进入成长页",
    action: {
      kind: "tap",
      target: { text: "成长", area: "bottomBar" },
      search: { mode: "visibleOnly" }
    },
    confidence: 0.98,
    status: "active",
    version: 1,
    provenance: { runIds: ["run-growth"], stepIds: ["open-growth"], artifactIds: [] },
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z"
  };
}

function planningFlows(): ScriptFlow[] {
  const base = {
    appId: "cn.eeo.classin",
    platform: "android" as const,
    sourceYaml: "",
    status: "active" as const,
    version: 1,
    tags: [],
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z"
  };
  return [
    {
      ...base,
      id: "flow-login",
      name: "教师登录",
      parsed: {
        version: 1,
        kind: "case",
        name: "教师登录",
        app: { id: "cn.eeo.classin", platform: "android" },
        entry: { page: "classin.login", session: "unauthenticated" },
        outcome: { page: "classin.home", session: "authenticated", role: "teacher" },
        parameters: {
          account: { type: "string", label: "手机号或邮箱", required: true, sensitive: true, control: "text" },
          password: { type: "string", label: "密码", required: true, sensitive: true, control: "text" }
        },
        steps: [],
        tags: []
      }
    },
    {
      ...base,
      id: "flow-open-lesson",
      name: "进入新建课堂",
      parsed: {
        version: 1,
        kind: "case",
        name: "进入新建课堂",
        app: { id: "cn.eeo.classin", platform: "android" },
        entry: { page: "classin.home", session: "authenticated", role: "teacher" },
        outcome: { page: "classin.lesson.create", session: "authenticated", role: "teacher" },
        parameters: {
          className: { type: "string", label: "班级名称", required: true, control: "text" }
        },
        steps: [
          {
            id: "open-class",
            onPage: "classin.home",
            expectPage: "classin.class.detail",
            tap: { target: { text: "\${className}" } }
          },
          {
            id: "open-lesson",
            onPage: "classin.class.detail",
            expectPage: "classin.lesson.create",
            tap: { target: { text: "新建课堂" } }
          }
        ],
        tags: []
      }
    }
  ];
}
