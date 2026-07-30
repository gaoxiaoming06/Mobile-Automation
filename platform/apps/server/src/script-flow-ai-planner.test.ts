import { describe, expect, it } from "vitest";
import type { ScriptFlowDocument } from "@mobile-automation/script-flow";
import type { ScriptFlow } from "@mobile-automation/shared";
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
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("不在页面目录");
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
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("场景编排命中完全匹配的启用用例时自动使用 runFlow");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("无需运行前确认");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("内容区悬浮新增按钮使用 { icon: add, area: content, position: trailing }");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("禁止元素资产 ID");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("唯一 JSON 对象");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).not.toMatch(/\bref\b/i);
});

describe("ScriptFlow AI planner", () => {
  it("accepts a target-only request as reachPage without asking how to navigate", () => {
    const catalog = buildScriptFlowPlannerCatalog(pageCatalog(), [], "cn.eeo.classin", "android");
    const response = readyResponse();
    response.document.name = "到达主页";
    response.document.steps = [{
      id: "reach-home",
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
      { id: "login", runFlow: "flow-login" },
      { id: "reach-lesson", reachPage: { page: "classin.lesson.create", policy: "safe" } }
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
    response.document.steps = [{ id: "login", runFlow: "flow-login" }];
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

    expect(result).toMatchObject({ status: "ready", document: { name: "打开添加好友" } });
    if (result.status === "ready") {
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
        name: "进入主页",
        app: { id: "cn.eeo.classin", platform: "android" },
        parameters: {},
        steps: [{ action: "assertPage", page: "classin.home" }],
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
                steps: [{ id: "assert-home", assertPage: "classin.home" }]
              }
            });
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
      }
    });

    expect(result).toMatchObject({ status: "ready", document: { name: "确认主页" } });
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

    expect(result).toMatchObject({ status: "ready", document: { steps: [expect.anything(), expect.objectContaining({
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
    response.document.steps = [{ id: "reach-teaching-plan", reachPage: { page: "classin.teaching.plan", policy: "safe" } }];
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
      expect(result.clarification).toContain("页面资产");
      expect(result.clarification).toContain("稳定文字");
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
        onPage: "classin.home",
        tap: {
          target: { semantic: "进入教学方案的入口", area: "content" },
          search: { mode: "auto" }
        }
      },
      {
        id: "verify-teaching-plan",
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
      { id: "page-home", key: "classin.home", name: "主页" },
      { id: "page-friend-add", key: "classin.friend.add", name: "添加好友" }
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
      name: "打开添加好友",
      app: { id: "cn.eeo.classin", platform: "android" as const },
      start: { strategy: "keepCurrent" as const },
      parameters: {},
      steps: [
        {
          id: "open-more-menu",
          name: "打开主页更多菜单",
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

function pageCatalog(): PageAssetCatalog {
  const pages = [
    { id: "page-home", key: "classin.home", name: "主页", appId: "cn.eeo.classin", graphVersionId: "v1", matcherCount: 2 },
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
