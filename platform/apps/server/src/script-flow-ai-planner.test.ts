import { describe, expect, it } from "vitest";
import { serializeScriptFlow, type ScriptFlowDocument } from "@mobile-automation/script-flow";
import type { NavigationEntry, ScriptFlow } from "@mobile-automation/shared";
import type { PageAssetCatalog } from "./page-asset-catalog.js";
import {
  SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
  buildScriptFlowPlannerCatalog,
  buildScriptFlowPlannerPrompt,
  generateScriptFlowDraft,
  parseScriptFlowAiResponse
} from "./script-flow-ai-planner.js";

it("only instructs AI to use supported ScriptFlow target modes", () => {
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("text、semantic、icon 或 control");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("禁止擅自增加");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("未录入页面");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("完整操作链");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("必须补充结果验证依据");
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

  it("rejects prose or Markdown wrapped around the JSON response", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = `\`\`\`json\n${JSON.stringify(readyResponse())}\n\`\`\``;

    expect(() => parseScriptFlowAiResponse(response, {
      appId: "cn.eeo.classin",
      platform: "android",
      catalog
    })).toThrow("唯一、完整的 JSON 对象");
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

  it("asks for stable result evidence before accepting an unrecorded outcome", async () => {
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
      status: "needs_clarification",
      clarification: expect.stringMatching(/稳定文字|验证结果/)
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
