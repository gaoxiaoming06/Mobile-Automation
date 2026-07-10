import { describe, expect, it, vi } from "vitest";
import {
  buildAiDiagnosisEvidencePack,
  buildDiagnosisPrompt,
  createAiDiagnosisClient,
  createOpenAiCompatibleDiagnosisClient,
  parseAiDiagnosisResponse,
  previewAiDiagnosisSettingsUpdate,
  publicAiDiagnosisSettings,
  resolveAiDiagnosisConfig,
  isCodexAppServerProvider
} from "./ai-diagnosis.js";

describe("ai diagnosis", () => {
  it("resolves model config from AI and Midscene-compatible environment variables", () => {
    expect(
      resolveAiDiagnosisConfig({
        AI_DIAGNOSIS_ENABLED: "true",
        MIDSCENE_MODEL_BASE_URL: "https://model.example/v1",
        MIDSCENE_MODEL_API_KEY: "sk-midscene",
        MIDSCENE_MODEL_NAME: "qwen3-vl-plus"
      })
    ).toEqual({
      enabled: true,
      baseURL: "https://model.example/v1",
      apiKey: "sk-midscene",
      model: "qwen3-vl-plus",
      timeoutMs: 30_000
    });

    expect(
      resolveAiDiagnosisConfig({
        AI_DIAGNOSIS_ENABLED: "true",
        AI_MODEL_BASE_URL: "https://ai.example/v1",
        AI_MODEL_API_KEY: "sk-ai",
        AI_MODEL_NAME: "gpt-5.4",
        AI_DIAGNOSIS_TIMEOUT_MS: "12000"
      })
    ).toEqual({
      enabled: true,
      baseURL: "https://ai.example/v1",
      apiKey: "sk-ai",
      model: "gpt-5.4",
      timeoutMs: 12_000
    });

    expect(resolveAiDiagnosisConfig({ AI_DIAGNOSIS_ENABLED: "false" })).toEqual({ enabled: false, reason: "disabled" });
  });

  it("resolves model config from saved dashboard settings before environment variables", () => {
    expect(
      resolveAiDiagnosisConfig(
        {
          AI_DIAGNOSIS_ENABLED: "true",
          AI_MODEL_BASE_URL: "https://env.example/v1",
          AI_MODEL_API_KEY: "env-key",
          AI_MODEL_NAME: "env-model"
        },
        {
          enabled: true,
          baseURL: "https://settings.example/v1",
          apiKey: "settings-key",
          model: "settings-model",
          timeoutMs: 9000
        }
      )
    ).toEqual({
      enabled: true,
      baseURL: "https://settings.example/v1",
      apiKey: "settings-key",
      model: "settings-model",
      timeoutMs: 9000
    });

    expect(
      resolveAiDiagnosisConfig(
        {
          AI_DIAGNOSIS_ENABLED: "true",
          AI_MODEL_BASE_URL: "https://env.example/v1",
          AI_MODEL_API_KEY: "env-key",
          AI_MODEL_NAME: "env-model"
        },
        { enabled: false }
      )
    ).toEqual({ enabled: false, reason: "disabled" });
  });

  it("accepts Codex app-server model settings without an API key", () => {
    const config = resolveAiDiagnosisConfig(
      {},
      {
        enabled: true,
        baseURL: "codex://app-server",
        model: "gpt-5.4"
      }
    );

    expect(config).toEqual({
      enabled: true,
      baseURL: "codex://app-server",
      model: "gpt-5.4",
      timeoutMs: 30_000
    });
    expect(isCodexAppServerProvider(config.enabled ? config.baseURL : "")).toBe(true);
  });

  it("routes Codex app-server settings to a diagnosis client", () => {
    const client = createAiDiagnosisClient({
      enabled: true,
      baseURL: "codex://app-server",
      model: "gpt-5.4",
      timeoutMs: 30_000
    });

    expect(client).toHaveProperty("diagnose");
  });

  it("exposes public dashboard settings without leaking the api key", () => {
    expect(
      publicAiDiagnosisSettings(
        {
          AI_DIAGNOSIS_ENABLED: "true",
          AI_MODEL_BASE_URL: "https://env.example/v1",
          AI_MODEL_API_KEY: "env-key",
          AI_MODEL_NAME: "env-model"
        },
        {
          enabled: true,
          baseURL: "https://settings.example/v1",
          apiKey: "settings-key",
          model: "settings-model",
          timeoutMs: 9000
        }
      )
    ).toEqual({
      enabled: true,
      baseURL: "https://settings.example/v1",
      model: "settings-model",
      timeoutMs: 9000,
      apiKeyConfigured: true,
      source: "stored"
    });
  });

  it("previews dashboard settings updates before persisting them", () => {
    expect(
      previewAiDiagnosisSettingsUpdate(
        {
          enabled: true,
          baseURL: "https://old.example/v1",
          apiKey: "secret-key",
          model: "old-model",
          timeoutMs: 9000
        },
        {
          baseURL: "https://new.example/v1",
          model: "new-model"
        }
      )
    ).toEqual({
      enabled: true,
      baseURL: "https://new.example/v1",
      apiKey: "secret-key",
      model: "new-model",
      timeoutMs: 9000
    });

    expect(
      previewAiDiagnosisSettingsUpdate(
        {
          enabled: true,
          baseURL: "https://old.example/v1",
          apiKey: "secret-key",
          model: "old-model"
        },
        { clearApiKey: true }
      )
    ).toEqual({
      enabled: true,
      baseURL: "https://old.example/v1",
      model: "old-model"
    });
  });

  it("builds a redacted evidence pack for failed automation runs", () => {
    const evidence = buildAiDiagnosisEvidencePack({
      runId: "run-1",
      runKind: "asset_patrol",
      deviceSerial: "device-1",
      packageName: "cn.eeo.classin",
      error: new Error('Input password "eeo123" for phone 18743085313 failed with token abcdef1234567890'),
      runtimeParams: {
        phone: "18743085313",
        password: "eeo123",
        lessonName: "班级四十二号",
        sessionToken: "abcdef1234567890"
      },
      recentSteps: [
        {
          id: "step-1",
          title: "账号密码登录",
          status: "failed",
          errorMessage: "password=eeo123 phone=18743085313"
        }
      ],
      recentEvents: [
        {
          type: "runner_error",
          summary: "Graph run failed",
          detail: "token=abcdef1234567890"
        }
      ]
    });

    expect(JSON.stringify(evidence)).not.toContain("18743085313");
    expect(JSON.stringify(evidence)).not.toContain("eeo123");
    expect(JSON.stringify(evidence)).not.toContain("abcdef1234567890");
    expect(evidence.runtimeParams).toEqual({
      phone: "<redacted:phone>",
      password: "<redacted:password>",
      lessonName: "班级四十二号",
      sessionToken: "<redacted:secret>"
    });
  });

  it("parses fenced JSON diagnosis and keeps asset patches controlled", () => {
    const diagnosis = parseAiDiagnosisResponse(`这里是诊断结果：
\`\`\`json
{
  "classification": "asset_issue",
  "confidence": 0.93,
  "summary": "搜索图标资产仍然依赖旧截图区域。",
  "reasoning": ["当前页面是主页", "动作后未进入搜索页"],
  "recommendedAction": "create_asset_patch",
  "safeToAutoApply": true,
  "assetPatch": {
    "kind": "page_transition",
    "operation": "update",
    "targetId": "edge-search",
    "summary": "把搜索图标改为文字/视觉候选重定位",
    "changes": { "locatorKind": "visual_text_icon" }
  }
}
\`\`\``);

    expect(diagnosis).toEqual({
      classification: "asset_issue",
      confidence: 0.93,
      summary: "搜索图标资产仍然依赖旧截图区域。",
      reasoning: ["当前页面是主页", "动作后未进入搜索页"],
      recommendedAction: "create_asset_patch",
      safeToAutoApply: true,
      assetPatch: {
        kind: "page_transition",
        operation: "update",
        targetId: "edge-search",
        summary: "把搜索图标改为文字/视觉候选重定位",
        changes: { locatorKind: "visual_text_icon" },
        status: "draft"
      }
    });
  });

  it("includes the PageStateFlow asset rulebook and executable patch schema in the diagnosis prompt", () => {
    const prompt = buildDiagnosisPrompt(
      buildAiDiagnosisEvidencePack({
        runId: "run-1",
        deviceSerial: "device-1",
        error: "Expected next node growth, got unknown"
      })
    );

    expect(prompt).toContain("当前 PageStateFlow 资产规则");
    expect(prompt).toContain("PageModel / 页面资产");
    expect(prompt).toContain("PageMatcher / 页面识别资产");
    expect(prompt).toContain("PageElement / 可操作元素资产");
    expect(prompt).toContain("PageTransition / 连接边资产");
    expect(prompt).toContain("PageTask / 页面任务资产");
    expect(prompt).toContain("动态区域 / 列表模板 / 参数化");
    expect(prompt).toContain("AI 需要按这些资产规则生成新的 matcher、元素、边或任务修复草稿");
    expect(prompt).toContain("先选择要修复的资产类型，再按对应 PageStateFlow 资产模型生成完整语义");
    expect(prompt).toContain("字段白名单只是系统可执行补丁协议，不是资产设计规则本身");
    expect(prompt).toContain("page_element 补丁必须说明定位策略、语义目标、动态内容处理和验证证据");
    expect(prompt).toContain("page_matcher.changes 只允许");
    expect(prompt).toContain("addMatchersDraft");
    expect(prompt).toContain("deprioritizeMatchersDraft");
    expect(prompt).toContain("不要返回 matcherDraft、nodeName、reason 对象");
    expect(prompt).toContain("page_transition.changes 只允许");
    expect(prompt).toContain("page_element.changes 只允许");
  });

  it("calls an OpenAI-compatible chat completion endpoint and parses the response", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  classification: "automation_issue",
                  confidence: 0.78,
                  summary: "定位策略失败，未产生可执行坐标。",
                  reasoning: ["未找到 OCR 候选"],
                  recommendedAction: "report_only",
                  safeToAutoApply: false
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const client = createOpenAiCompatibleDiagnosisClient(
      {
        enabled: true,
        baseURL: "https://model.example/v1",
        apiKey: "sk-test",
        model: "gpt-5.4",
        timeoutMs: 1000
      },
      fetchMock
    );

    const diagnosis = await client.diagnose(
      buildAiDiagnosisEvidencePack({
        runId: "run-1",
        deviceSerial: "device-1",
        error: "Image region could not be relocated"
      })
    );

    expect(diagnosis.classification).toBe("automation_issue");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = fetchCalls[0]!;
    expect(url).toBe("https://model.example/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer sk-test",
        "Content-Type": "application/json"
      })
    );
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({
        model: "gpt-5.4",
        temperature: 0.1,
        response_format: { type: "json_object" }
      })
    );
  });
});
