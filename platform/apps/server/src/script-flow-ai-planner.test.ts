import { describe, expect, it } from "vitest";
import type { ScriptFlow } from "@mobile-automation/shared";
import type { PageAssetCatalog } from "./page-asset-catalog.js";
import {
  SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
  buildScriptFlowPlannerCatalog,
  generateScriptFlowDraft,
  parseScriptFlowAiResponse
} from "./script-flow-ai-planner.js";

it("only instructs AI to use supported ScriptFlow target modes", () => {
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).toContain("ocrText 或 pageElement");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).not.toContain("semantic");
  expect(SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS).not.toContain("risk，值只能是 none");
});

describe("ScriptFlow AI planner", () => {
  it("builds a draft from page identity and optional locator assets", async () => {
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
      expect(result.sourceYaml).toContain('pageElement: "home-add-friend"');
    }
    expect(requestBody).not.toContain("risk，值只能是 none");
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

  it("derives a read-only transition index from active scripts", () => {
    const flow: ScriptFlow = {
      id: "flow-add-friend",
      appId: "cn.eeo.classin",
      platform: "android",
      name: "打开添加好友",
      sourceYaml: "",
      parsed: readyResponse().document,
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
  });
});

function readyResponse() {
  return {
    status: "ready",
    summary: "从主页进入添加好友页",
    assumptions: [],
    document: {
      version: 1 as const,
      name: "打开添加好友",
      app: { id: "cn.eeo.classin", platform: "android" as const },
      start: { strategy: "keepCurrent" as const },
      parameters: {},
      steps: [{
        id: "open-add-friend",
        name: "点击添加好友",
        onPage: "classin.home",
        expectPage: "classin.friend.add",
        risk: "interaction" as const,
        tap: { target: { pageElement: "home-add-friend" } }
      }],
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
    listLocators: (pageId) => pageId === "page-home" ? [{ id: "home-add-friend", label: "添加好友", targetText: "添加好友", requiresUiTree: false, raw: {} }] : [],
    findConfusablePages: () => []
  };
}
