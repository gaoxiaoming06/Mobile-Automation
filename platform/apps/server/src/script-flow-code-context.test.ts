import { describe, expect, it, vi } from "vitest";
import {
  buildClassInCodeSearchPlan,
  createClassInCodeContextProvider,
  mergeScriptFlowExternalContexts
} from "./script-flow-code-context.js";

describe("ScriptFlow code context", () => {
  it("extracts bounded code-search queries from a natural-language test goal", () => {
    const plan = buildClassInCodeSearchPlan({
      prompt: "启动 App，进入班级四十二号，打开新建课堂，填写课堂名称但不要发布",
      appId: "classin",
      platform: "android"
    });

    expect(plan.languages).toEqual(["kotlin", "java"]);
    expect(plan.semanticQueries[0]).toBe("启动 App，进入班级四十二号，打开新建课堂，填写课堂名称但不要发布");
    expect(plan.semanticQueries).toContain("新建课堂 课堂名称 发布");
    expect(plan.exactQueries).toEqual(expect.arrayContaining(["新建课堂", "课堂名称", "发布"]));
    expect(plan.exactQueries).not.toContain("启动");
  });

  it("retrieves classin-code context and compresses it before planner usage", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ url, body });
      if (url.includes("/api/v1/search")) {
        return jsonResponse({
          results: [
            {
              rank: 1,
              score: 0.93,
              title: "CreateLessonFragment renders 新建课堂",
              repo_name: "ClassInX",
              file_path: "app/src/main/java/cn/eeo/classin/lesson/CreateLessonFragment.kt",
              start_line: 42,
              end_line: 58,
              language: "kotlin",
              content: "val id = \"cn.eeo.classin:id/create\" // resource-id should not leak"
            }
          ]
        });
      }
      return jsonResponse({
        results: [
          {
            title: "LessonPublishDialog",
            repo_name: "ClassInX",
            file_path: "app/src/main/java/cn/eeo/classin/lesson/LessonPublishDialog.kt",
            start_line: 13,
            content: "accessibilityId: publishButton"
          }
        ]
      });
    });

    const provider = createClassInCodeContextProvider({
      enabled: true,
      embeddingBaseUrl: "https://embedding.example/code-embedding",
      codeSearchBaseUrl: "https://code.example",
      timeoutMs: 500,
      topK: 2,
      maxSemanticQueries: 1,
      maxExactQueries: 2,
      fetchImpl
    });

    const context = await provider({
      prompt: "启动 App，进入班级四十二号，打开新建课堂，填写课堂名称但不要发布",
      appId: "classin",
      platform: "android"
    });

    expect(context).toMatchObject({
      source: "classin-code",
      implementationStack: "android-native"
    });
    expect(context?.summary).toContain("CreateLessonFragment renders 新建课堂");
    expect(context?.relevantFiles).toEqual(expect.arrayContaining([
      "ClassInX:app/src/main/java/cn/eeo/classin/lesson/CreateLessonFragment.kt"
    ]));
    expect(context?.candidateSteps).toEqual(expect.arrayContaining([
      "进入班级四十二号",
      "打开新建课堂",
      "填写课堂名称",
      "不要发布"
    ]));
    expect(context?.constraints).toContain("代码上下文只作为生成线索，页面资产、用户明示步骤和真机试运行结果优先。");

    const serializedContext = JSON.stringify(context);
    expect(serializedContext).not.toContain("resource-id");
    expect(serializedContext).not.toContain("accessibilityId");
    expect(serializedContext).not.toContain("cn.eeo.classin:id/create");

    expect(requests.some((request) => request.url === "https://embedding.example/code-embedding/api/v1/search")).toBe(true);
    expect(requests.some((request) => request.url === "https://code.example/code/api/search")).toBe(true);
  });

  it("fails open when classin-code retrieval is disabled or unavailable", async () => {
    const disabledProvider = createClassInCodeContextProvider({
      enabled: false,
      fetchImpl: vi.fn()
    });
    await expect(disabledProvider({
      prompt: "打开新建课堂",
      appId: "classin",
      platform: "android"
    })).resolves.toBeUndefined();

    const failingProvider = createClassInCodeContextProvider({
      enabled: true,
      timeoutMs: 500,
      fetchImpl: vi.fn(async () => {
        throw new Error("service down");
      })
    });
    await expect(failingProvider({
      prompt: "打开新建课堂",
      appId: "classin",
      platform: "android"
    })).resolves.toBeUndefined();
  });

  it("merges automatic code context after caller-provided context", () => {
    const merged = mergeScriptFlowExternalContexts(
      {
        source: "manual",
        summary: "用户补充：从班级页开始。",
        candidateSteps: ["进入班级页"],
        constraints: ["不要发布"]
      },
      {
        source: "classin-code",
        summary: "代码检索：存在新建课堂入口。",
        relevantFiles: ["ClassInX:lesson/CreateLessonFragment.kt"],
        candidateSteps: ["打开新建课堂"],
        constraints: ["禁止生成 selector。"]
      }
    );

    expect(merged).toEqual({
      source: "manual",
      summary: "用户补充：从班级页开始。\n\nclassin-code 自动检索补充：\n代码检索：存在新建课堂入口。",
      relevantFiles: ["ClassInX:lesson/CreateLessonFragment.kt"],
      candidateSteps: ["进入班级页", "打开新建课堂"],
      constraints: ["不要发布", "禁止生成 selector。"]
    });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
