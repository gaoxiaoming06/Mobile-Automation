import { describe, expect, it } from "vitest";
import type { AiClientFetch } from "./ai-client.js";
import {
  generateFreeCompositionAiPlan,
  planFreeCompositionWithAiFallback
} from "./free-composition-ai-planner.js";
import type { ResolveFreeCompositionInput } from "./free-composition.js";

const enabledConfig = {
  enabled: true as const,
  baseURL: "https://ai.example/v1",
  apiKey: "sk-test",
  model: "gpt-test",
  timeoutMs: 10_000
};

describe("free composition AI planner", () => {
  it("skips the model when deterministic planning already has a fixed page route", async () => {
    let fetchCalls = 0;

    const result = await planFreeCompositionWithAiFallback({
      config: enabledConfig,
      prompt: "测试进入新建课堂 循环2次",
      input: routePlannerInput(),
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    expect(fetchCalls).toBe(0);
    expect(result).toMatchObject({
      status: "fallback",
      errorMessage: "本地确定性规划已命中，未调用 AI。"
    });
  });

  it("calls the configured model and keeps only asset-bounded planning hints", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchImpl: AiClientFetch = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                normalizedPrompt: "切换老师账号后进入登录页",
                orderedAssetNames: ["退出登录", "账号密码登录", "不存在的资产"],
                targetPageName: "登录",
                runMode: "repeat_n",
                repeatCount: 8,
                unsupportedRequirements: ["步骤间隔等待"],
                runtimeOverrides: {
                  phone: "12133333302",
                  password: "secret",
                  unknownKey: "should-drop"
                },
                confidence: 0.92,
                summary: "用户要切换账号，需退出后重新登录。"
              })
            }
          }
        ]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const result = await generateFreeCompositionAiPlan({
      config: enabledConfig,
      prompt: "帮我换成老师账号 12133333302",
      input: plannerInput(),
      fetchImpl
    });

    expect(requestBody?.model).toBe("gpt-test");
    expect(JSON.stringify(requestBody)).toContain("只返回一个 JSON");
    expect(JSON.stringify(requestBody)).toContain("账号密码登录");
    expect(result.channel).toBe("openai-compatible");
    expect(result.plan).toMatchObject({
      status: "used",
      normalizedPrompt: "切换老师账号后进入登录页",
      orderedAssetNames: ["退出登录", "账号密码登录"],
      targetPageName: "登录",
      runMode: "repeat_n",
      repeatCount: 8,
      unsupportedRequirements: ["步骤间隔等待"],
      runtimeOverrides: {
        phone: "12133333302",
        password: "secret"
      },
      confidence: 0.92
    });
    expect(result.plan.warnings).toEqual(expect.arrayContaining([
      "AI 返回了未入库资产，已忽略：不存在的资产",
      "AI 返回了未声明参数，已忽略：unknownKey"
    ]));
  });

  it("falls back to deterministic parsing when AI is disabled or fails", async () => {
    await expect(planFreeCompositionWithAiFallback({
      config: { enabled: false, reason: "disabled" },
      prompt: "测试登录",
      input: plannerInput()
    })).resolves.toMatchObject({ status: "fallback", errorMessage: "AI 未启用：disabled" });

    await expect(planFreeCompositionWithAiFallback({
      config: enabledConfig,
      prompt: "测试登录",
      input: plannerInput(),
      fetchImpl: async () => {
        throw new Error("network down");
      }
    })).resolves.toMatchObject({ status: "fallback", errorMessage: "network down" });
  });
});

function plannerInput(): ResolveFreeCompositionInput {
  return {
    appId: "cn.eeo.classin",
    platform: "android",
    metaFunctions: [
      {
        id: "meta_logout",
        appId: "cn.eeo.classin",
        platform: "android",
        name: "退出登录",
        description: "从当前账号退出到登录页",
        parameters: [],
        steps: [],
        status: "active",
        version: 1,
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z"
      },
      {
        id: "meta_login",
        appId: "cn.eeo.classin",
        platform: "android",
        name: "账号密码登录",
        description: "输入账号密码并进入主页",
        parameters: [
          { key: "phone", type: "string", required: true },
          { key: "password", type: "string", required: true }
        ],
        steps: [],
        status: "active",
        version: 1,
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z"
      }
    ],
    compositeCases: [],
    pageAssets: [
      { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-login", pageModelName: "登录", status: "active" }
    ]
  };
}

function routePlannerInput(): ResolveFreeCompositionInput {
  return {
    appId: "cn.eeo.classin",
    platform: "android",
    metaFunctions: [],
    compositeCases: [],
    pageAssets: [
      { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-home", pageModelName: "主页", status: "active" },
      { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-detail", pageModelName: "班级详情", status: "active" },
      { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-activity-type", pageModelName: "发布活动类型选择页", status: "active" },
      { appId: "cn.eeo.classin", platform: "android", pageModelId: "page-new-lesson", pageModelName: "新建课堂", status: "active" }
    ],
    pageTransitions: [
      {
        appId: "cn.eeo.classin",
        platform: "android",
        sourcePageModelId: "page-home",
        sourcePageModelName: "主页",
        targetPageModelId: "page-detail",
        targetPageModelName: "班级详情",
        pageElementId: "class-list",
        pageElementLabel: "班级列表",
        pageTransitionId: "edge-home-detail",
        parameterKeys: ["className"],
        status: "active"
      },
      {
        appId: "cn.eeo.classin",
        platform: "android",
        sourcePageModelId: "page-detail",
        sourcePageModelName: "班级详情",
        targetPageModelId: "page-activity-type",
        targetPageModelName: "发布活动类型选择页",
        pageElementId: "publish-activity",
        pageElementLabel: "发布活动",
        pageTransitionId: "edge-detail-activity-type",
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
  };
}
