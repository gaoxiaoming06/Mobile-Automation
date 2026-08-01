# AI 实时看屏辅助生成实现方案（阶段 1.5）

> **对于智能体：** 必需子技能：使用 superpowers:subagent-driven-development (推荐) 或 superpowers:executing-plans 来逐个任务执行此方案。步骤使用复选框 (`- [ ]`) 语法进行进度追踪。

**目标：** 在 AI 生成测试入口中引入显式的“结合当前屏幕生成”能力，让 AI 可以看当前截图理解页面，并生成更准确的 ScriptFlow；本阶段不实现资产沉淀。

**架构：** 生成链路采用“资产优先、看屏辅助、两段式 AI、系统裁决”的结构。第一段 AI 基于当前截图和观察证据输出 `ScreenUnderstandingCandidate`；系统过滤动态值、坐标、平台私有标识和不合规候选；第二段 AI 基于用户描述、已验证资产和受控屏幕理解生成 ScriptFlow。看屏结果只作为生成上下文，不写入 PageAsset、InteractionAsset、NavigationEntry 或 LearningCandidate；资产沉淀继续归属第二阶段的试运行后学习状态机。

**技术栈：** TypeScript、React、Express、Vitest、现有 `ObservationService`、`ai-client` 多模态输入、ScriptFlow v1、现有 OCR/UI hierarchy/PageMatcher/语义定位器。

---

## 一、产品与架构结论

### 1. 默认路径：资产库优先

已验证资产足够时，不读取当前设备屏幕：

```text
用户自然语言
  -> 页面目录、已验证用例、InteractionAsset、NavigationEntry 检索
  -> AI 生成 ScriptFlow
  -> schema/语义校验
  -> 预览、试运行或普通执行
```

这条路径保持现在的主线：生成阶段默认不依赖设备状态，脚本严格按 ScriptFlow 执行。

### 2. 显式路径：结合当前屏幕生成

只有用户在 AI 生成页面主动开启“结合当前屏幕生成”，或者后续产品明确提供同等显式入口时，才读取当前设备：

```text
用户自然语言
  + 已验证资产
  + 当前 Observation
  + 当前截图
        ↓
AI 屏幕理解
        ↓
ScreenUnderstandingCandidate
        ↓
系统规则校验与过滤
        ↓
ScreenUnderstandingContext
        ↓
AI 生成 ScriptFlow
        ↓
ScriptFlow schema/语义校验
        ↓
预览、试运行、结果验证
```

屏幕信息只用于理解当前页面，不直接沉淀为候选资产或正式资产，不直接改变执行器行为，也不能覆盖已验证资产。试运行结束后的资产学习仍按第二阶段规划处理。

### 3. AI 看截图，但不能直接写资产

第一段 AI 可以看原始截图，因为它比纯 OCR 摘要更容易理解“最上面的输入框”“课堂信息第一行”“预填课堂名”这类视觉语义。

但是第一段 AI 只能输出候选屏幕模型：

```ts
export type ScreenUnderstandingCandidate = {
  page: {
    key?: string;
    name?: string;
    confidence: number;
  };
  visibleStableTexts: string[];
  dynamicTexts: Array<{
    text: string;
    reason: "account" | "phone" | "email" | "name" | "date" | "time" | "number" | "unknown_dynamic";
  }>;
  controlCandidates: ScreenControlCandidate[];
  warnings: string[];
};

export type ScreenControlCandidate = {
  candidateId: string;
  control: "button" | "textField" | "checkbox" | "switch" | "select" | "text";
  semanticName?: string;
  text?: string;
  scopeText?: string;
  nearText?: string;
  ordinal?: number;
  currentValue?: string;
  valueKind?: "stableLabel" | "dynamicValue" | "sensitiveValue" | "unknown";
  confidence: number;
  assetEligible: boolean;
};
```

系统会把它过滤成第二段 AI 可用的受控上下文：

```ts
export type ScreenUnderstandingContext = {
  used: true;
  observationId: string;
  visionUsed: boolean;
  page: {
    key?: string;
    name?: string;
    confidence: number;
  };
  visibleStableTexts: string[];
  controlCandidates: Array<{
    candidateId: string;
    control: "button" | "textField" | "checkbox" | "switch" | "select" | "text";
    semanticName?: string;
    text?: string;
    scopeText?: string;
    nearText?: string;
    ordinal?: number;
    valueKind?: "stableLabel" | "dynamicValue" | "unknown";
    confidence: number;
    assetEligible: boolean;
  }>;
  rejectedReasons: string[];
};
```

过滤后不保留坐标、bounds、resource-id、accessibility-id、手机号、账号、邮箱、密码和截图区域。

### 4. 资产沉淀边界

本阶段不创建 `assetProposals`，不把看屏结果写入 LearningCandidate，也不修改现有学习状态机。看屏结果只参与当次 AI 生成 prompt，生成出的 ScriptFlow 仍要通过预览、试运行和结果验证。

第二阶段如果要把“看屏理解”作为学习辅助证据，只能在试运行成功后由学习状态机读取已验证 Run、StepResult、Artifact 和脱敏生成上下文，再按既有规则生成候选。正式资产仍然沿用现有门槛：至少 3 次独立成功运行、2 份不同证据、确定性校验通过，高歧义候选再由受控 AI 分析。

## 二、文件边界

### 新建文件

- `platform/apps/server/src/script-flow-screen-context.ts`：从 `Observation` 构建给 AI 的看屏上下文，负责脱敏、裁剪、限制数量和去平台私有字段。
- `platform/apps/server/src/script-flow-screen-context.test.ts`：覆盖动态文本过滤、截图提取、候选数量限制、坐标字段拒绝。
- `platform/apps/server/src/script-flow-screen-understanding.ts`：第一段 AI 看图理解当前屏幕，输出候选屏幕模型，并调用校验器产出 `ScreenUnderstandingContext`。
- `platform/apps/server/src/script-flow-screen-understanding.test.ts`：覆盖 AI 输出合法、坐标输出被拒、动态值降级、vision fallback。

### 修改文件

- `platform/packages/shared/src/index.ts`：新增 `ScreenUnderstandingContext` 公共类型。
- `platform/apps/server/src/script-flow-ai-api.ts`：生成接口显式接受 `screenAssist`，拒绝旧的 `currentPage`、坐标和任意设备状态字段。
- `platform/apps/server/src/script-flow-ai-api.test.ts`：保留旧字段拒绝测试，新增显式看屏请求测试。
- `platform/apps/server/src/index.ts`：注册 AI 生成路由时注入 `ObservationService`、AI 配置和页面目录，按 `screenAssist` 采集当前屏幕。
- `platform/apps/server/src/script-flow-ai-planner.ts`：第二段 AI 接收受控 `screenContext`，调整开发者指令、prompt 和 target grounding。
- `platform/apps/server/src/script-flow-ai-planner.test.ts`：覆盖“最上面的输入框”“当前页面”“资产优先不读屏”“截图候选不能输出坐标”。
- `platform/packages/script-flow/src/types.ts`：扩展 `ScriptTargetControl` 和 `ScriptTarget`，支持 `textField`、`scopeText`、`ordinal`。
- `platform/packages/script-flow/src/parser.ts`：校验 textField 控件目标，保持坐标和未知字段拒绝。
- `platform/packages/script-flow/src/parser.test.ts`：覆盖 textField 合法和非法结构。
- `platform/apps/server/src/script-target-resolver.ts`：把 `control: textField` 编译为运行时结构定位契约。
- `platform/apps/server/src/script-target-resolver.test.ts`：覆盖 textField 的结构化 locator 输出。
- `platform/apps/server/src/semantic-locator.ts`：实现 textField 的 OCR/可访问性/视觉结构综合定位。
- `platform/apps/server/src/semantic-locator.test.ts`：覆盖有 label、无 label 但有 scope+ordinal、重复输入框、Compose UI hierarchy 不可用的 OCR-only 场景。
- `platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx`：增加“结合当前屏幕生成”开关和设备选择提示。
- `platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx`：覆盖默认不读屏、开启后带 `screenAssist`、无设备时禁用。
- `docs/product/mobile-automation-platform/spec/script-flow-v1.md`：更新 AI 生成章节，明确默认不读屏、显式看屏、两段式屏幕理解和不沉淀资产边界。

## 三、实施任务

### 任务 1：更新产品契约文档

**文件：**
- 修改：`docs/product/mobile-automation-platform/spec/script-flow-v1.md`

- [ ] **步骤 1：修改“AI 生成”章节中的默认规则**

把“规划阶段禁止识别实时设备页面”调整为：

```markdown
新建用例时，AI 默认只读取自然语言、目标 App、平台、页面身份目录、可复用用例摘要、已启用 InteractionAsset 摘要和 NavigationEntry 摘要，不读取实时设备页面。

当用户显式开启“结合当前屏幕生成”时，服务端可以采集当前设备 Observation 和截图，并先让 AI 输出 ScreenUnderstandingCandidate。该候选经过确定性校验、脱敏、去坐标、去平台私有字段和动态值标注后，才能作为 ScreenUnderstandingContext 进入 ScriptFlow 生成 prompt。实时屏幕上下文不是资产事实来源，不能覆盖已验证资产，不能写入 PageAsset、InteractionAsset、NavigationEntry 或 LearningCandidate。
```

- [ ] **步骤 2：补充看屏不沉淀原则**

在“试运行成功且结果已验证后”段落后追加：

```markdown
看屏辅助生成得到的 ScreenUnderstandingContext 只表示 AI 对当前页面的临时理解。本阶段不会把它转换为 LearningCandidate，也不会直接写入 PageAsset、InteractionAsset 或 NavigationEntry。资产学习仍只发生在第二阶段：试运行成功、结果已验证、学习模式允许采集时，系统从实际 Run、StepResult 和 Artifact 中生成学习候选，再按多次证据聚合和确定性规则晋级；AI 不能直接发布资产。
```

- [ ] **步骤 3：运行文档校验命令**

运行：

```bash
rg -n "规划阶段禁止识别实时设备页面|ScreenUnderstandingCandidate|结合当前屏幕生成|不会把它转换为 LearningCandidate" docs/product/mobile-automation-platform/spec/script-flow-v1.md
```

预期：旧的绝对禁止表述不存在，新的显式看屏和“不沉淀资产”边界存在。

- [ ] **步骤 4：提交文档**

```bash
git add docs/product/mobile-automation-platform/spec/script-flow-v1.md
git commit -m "docs: 规划看屏辅助生成边界"
```

### 任务 2：定义共享类型和屏幕上下文过滤器

**文件：**
- 修改：`platform/packages/shared/src/index.ts`
- 创建：`platform/apps/server/src/script-flow-screen-context.ts`
- 创建：`platform/apps/server/src/script-flow-screen-context.test.ts`

- [ ] **步骤 1：先写失败测试**

在 `platform/apps/server/src/script-flow-screen-context.test.ts` 新增：

```ts
import { describe, expect, it } from "vitest";
import { buildScreenEvidence, sanitizeScreenUnderstandingCandidate } from "./script-flow-screen-context.js";

describe("script flow screen context", () => {
  it("keeps screenshot evidence but does not expose coordinates as model facts", () => {
    const evidence = buildScreenEvidence({
      id: "observation-1",
      deviceSerial: "serial-1",
      platform: "android",
      capturedAt: "2026-08-01T00:00:00.000Z",
      resolution: { width: 1000, height: 2000 },
      screenshot: { width: 1000, height: 2000, sizeBytes: 10 },
      ocrTexts: [
        { text: "课堂信息", source: "ocr", region: { x: 10, y: 10, width: 20, height: 5 } },
        { text: "+8618743085313", source: "ocr", region: { x: 10, y: 20, width: 20, height: 5 } }
      ],
      uiElements: [],
      raw: { screenshotBase64: "aW1hZ2U=" }
    });

    expect(evidence.imagePngBase64).toBe("aW1hZ2U=");
    expect(JSON.stringify(evidence.promptEvidence)).toContain("课堂信息");
    expect(JSON.stringify(evidence.promptEvidence)).not.toContain("18743085313");
    expect(JSON.stringify(evidence.promptEvidence)).not.toContain("\"x\"");
    expect(JSON.stringify(evidence.promptEvidence)).not.toContain("\"region\"");
  });

  it("drops dynamic current values from asset-eligible control candidates", () => {
    const context = sanitizeScreenUnderstandingCandidate({
      observationId: "observation-1",
      visionUsed: true,
      candidate: {
        page: { key: "classin.teacher.lesson.create.visual", name: "新建课堂", confidence: 0.91 },
        visibleStableTexts: ["课堂信息", "发布"],
        dynamicTexts: [{ text: "小王", reason: "name" }],
        controlCandidates: [{
          candidateId: "field.lessonName.candidate",
          control: "textField",
          semanticName: "lessonName",
          scopeText: "课堂信息",
          ordinal: 1,
          currentValue: "小王",
          valueKind: "dynamicValue",
          confidence: 0.76,
          assetEligible: true
        }],
        warnings: []
      }
    });

    expect(context.controlCandidates).toEqual([{
      candidateId: "field.lessonName.candidate",
      control: "textField",
      semanticName: "lessonName",
      scopeText: "课堂信息",
      ordinal: 1,
      valueKind: "dynamicValue",
      confidence: 0.76,
      assetEligible: true
    }]);
    expect(JSON.stringify(context)).not.toContain("小王");
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/script-flow-screen-context.test.ts
```

预期：模块不存在或导出不存在导致失败。

- [ ] **步骤 3：新增共享类型**

在 `platform/packages/shared/src/index.ts` 增加：

```ts
export type ScreenControlKind = "button" | "textField" | "checkbox" | "switch" | "select" | "text";

export type ScreenUnderstandingContext = {
  used: true;
  observationId: string;
  visionUsed: boolean;
  page: {
    key?: string;
    name?: string;
    confidence: number;
  };
  visibleStableTexts: string[];
  controlCandidates: Array<{
    candidateId: string;
    control: ScreenControlKind;
    semanticName?: string;
    text?: string;
    scopeText?: string;
    nearText?: string;
    ordinal?: number;
    valueKind?: "stableLabel" | "dynamicValue" | "unknown";
    confidence: number;
    assetEligible: boolean;
  }>;
  rejectedReasons: string[];
};
```

- [ ] **步骤 4：实现过滤器**

在 `platform/apps/server/src/script-flow-screen-context.ts` 实现：

```ts
import type { Observation } from "@mobile-automation/graph-core";
import type { ScreenUnderstandingContext } from "@mobile-automation/shared";

type ScreenUnderstandingCandidate = {
  page: { key?: string; name?: string; confidence: number };
  visibleStableTexts: string[];
  dynamicTexts: Array<{ text: string; reason: string }>;
  controlCandidates: Array<Record<string, unknown>>;
  warnings: string[];
};

export function buildScreenEvidence(observation: Observation): {
  observationId: string;
  imagePngBase64?: string;
  promptEvidence: Record<string, unknown>;
} {
  const visibleTexts = uniqueStrings([
    ...observation.ocrTexts.map((item) => item.text),
    ...observation.uiElements.flatMap((item) => [item.text, item.contentDesc])
  ])
    .filter((text) => !isSensitiveOrDynamicText(text))
    .slice(0, 80);

  return {
    observationId: observation.id,
    imagePngBase64: typeof observation.raw?.screenshotBase64 === "string" ? observation.raw.screenshotBase64 : undefined,
    promptEvidence: {
      observationId: observation.id,
      platform: observation.platform,
      packageName: observation.packageName,
      activityName: observation.activityName,
      visibleTexts
    }
  };
}

export function sanitizeScreenUnderstandingCandidate(input: {
  observationId: string;
  visionUsed: boolean;
  candidate: ScreenUnderstandingCandidate;
}): ScreenUnderstandingContext {
  const rejectedReasons: string[] = [];
  const controlCandidates = input.candidate.controlCandidates.flatMap((raw) => {
    if (containsForbiddenKey(raw)) {
      rejectedReasons.push("candidate_contains_forbidden_key");
      return [];
    }
    const control = screenControl(raw.control);
    const confidence = numberInRange(raw.confidence, 0, 1);
    if (!control || confidence === undefined) return [];
    const valueKind = raw.valueKind === "stableLabel" || raw.valueKind === "dynamicValue" ? raw.valueKind : "unknown";
    return [{
      candidateId: stringValue(raw.candidateId) || `${control}-${input.observationId}`,
      control,
      ...stringProp("semanticName", raw.semanticName),
      ...stableTextProp("text", raw.text, valueKind),
      ...stringProp("scopeText", raw.scopeText),
      ...stringProp("nearText", raw.nearText),
      ...ordinalProp(raw.ordinal),
      valueKind,
      confidence,
      assetEligible: raw.assetEligible === true
    }];
  }).slice(0, 40);

  return {
    used: true,
    observationId: input.observationId,
    visionUsed: input.visionUsed,
    page: {
      ...stringProp("key", input.candidate.page.key),
      ...stringProp("name", input.candidate.page.name),
      confidence: numberInRange(input.candidate.page.confidence, 0, 1) ?? 0
    },
    visibleStableTexts: uniqueStrings(input.candidate.visibleStableTexts)
      .filter((text) => !isSensitiveOrDynamicText(text))
      .slice(0, 80),
    controlCandidates,
    rejectedReasons
  };
}

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    /^(?:x|y|bounds|region|resourceId|accessibilityId|className|xpath|selector)$/i.test(key)
    || containsForbiddenKey(child)
  );
}

function isSensitiveOrDynamicText(text: string | undefined): boolean {
  if (!text?.trim()) return true;
  return /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(text)
    || /(?:^|\D)\d{7,}(?:\D|$)/.test(text)
    || /(?:password|passwd|secret|token)/i.test(text);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((item) => item?.trim()).filter((item): item is string => Boolean(item)))];
}

function screenControl(value: unknown): ScreenUnderstandingContext["controlCandidates"][number]["control"] | undefined {
  return value === "button" || value === "textField" || value === "checkbox" || value === "switch" || value === "select" || value === "text"
    ? value
    : undefined;
}

function numberInRange(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringProp<K extends string>(key: K, value: unknown): Record<K, string> | Record<string, never> {
  const text = stringValue(value);
  return text ? { [key]: text } as Record<K, string> : {};
}

function stableTextProp<K extends string>(key: K, value: unknown, valueKind: string): Record<K, string> | Record<string, never> {
  const text = stringValue(value);
  return text && valueKind === "stableLabel" && !isSensitiveOrDynamicText(text) ? { [key]: text } as Record<K, string> : {};
}

function ordinalProp(value: unknown): { ordinal: number } | Record<string, never> {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? { ordinal: value } : {};
}
```

- [ ] **步骤 5：运行测试确认通过**

```bash
pnpm vitest run platform/apps/server/src/script-flow-screen-context.test.ts
```

预期：新增测试通过。

- [ ] **步骤 6：提交**

```bash
git add platform/packages/shared/src/index.ts platform/apps/server/src/script-flow-screen-context.ts platform/apps/server/src/script-flow-screen-context.test.ts
git commit -m "feat: 增加看屏生成上下文过滤器"
```

### 任务 3：实现第一段 AI 看图理解

**文件：**
- 创建：`platform/apps/server/src/script-flow-screen-understanding.ts`
- 创建：`platform/apps/server/src/script-flow-screen-understanding.test.ts`

- [ ] **步骤 1：先写失败测试**

新增测试：

```ts
import { describe, expect, it, vi } from "vitest";
import { understandScreenForScriptFlow } from "./script-flow-screen-understanding.js";

describe("screen understanding for ScriptFlow", () => {
  it("uses screenshot image input and returns sanitized context", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.messages[1].content[1].image_url.url).toBe("data:image/png;base64,aW1hZ2U=");
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              page: { key: "classin.teacher.lesson.create.visual", name: "新建课堂", confidence: 0.9 },
              visibleStableTexts: ["课堂信息", "发布"],
              dynamicTexts: [{ text: "小王", reason: "name" }],
              controlCandidates: [{
                candidateId: "field.lessonName.candidate",
                control: "textField",
                semanticName: "lessonName",
                scopeText: "课堂信息",
                ordinal: 1,
                currentValue: "小王",
                valueKind: "dynamicValue",
                confidence: 0.74,
                assetEligible: true
              }],
              warnings: []
            })
          }
        }]
      }));
    });

    const context = await understandScreenForScriptFlow({
      config: { enabled: true, baseURL: "https://llm.example.com/v1", apiKey: "sk", model: "vision-model", timeoutMs: 5000 },
      prompt: "把最上面的课堂名字改成自动化课堂",
      appId: "cn.eeo.classin",
      platform: "android",
      observation: {
        id: "observation-1",
        deviceSerial: "serial-1",
        platform: "android",
        capturedAt: "2026-08-01T00:00:00.000Z",
        ocrTexts: [{ text: "课堂信息", source: "ocr" }],
        uiElements: [],
        raw: { screenshotBase64: "aW1hZ2U=" }
      },
      fetchImpl
    });

    expect(context.visionUsed).toBe(true);
    expect(context.controlCandidates[0]).toMatchObject({
      control: "textField",
      scopeText: "课堂信息",
      ordinal: 1
    });
    expect(JSON.stringify(context)).not.toContain("小王");
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
pnpm vitest run platform/apps/server/src/script-flow-screen-understanding.test.ts
```

预期：模块不存在导致失败。

- [ ] **步骤 3：实现 `understandScreenForScriptFlow`**

核心实现：

```ts
import type { Observation } from "@mobile-automation/graph-core";
import type { ScreenUnderstandingContext } from "@mobile-automation/shared";
import { runAiJsonRequest, type AiClientFetch } from "./ai-client.js";
import type { AiModelConfig } from "./ai-model-settings.js";
import type { PageAssetPlatform } from "./page-asset-catalog.js";
import { buildScreenEvidence, sanitizeScreenUnderstandingCandidate } from "./script-flow-screen-context.js";

export async function understandScreenForScriptFlow(input: {
  config: AiModelConfig;
  prompt: string;
  appId: string;
  platform: PageAssetPlatform;
  observation: Observation;
  fetchImpl?: AiClientFetch;
}): Promise<ScreenUnderstandingContext> {
  if (!input.config.enabled) throw new Error("AI 生成未启用");
  const evidence = buildScreenEvidence(input.observation);
  const result = await runAiJsonRequest({
    baseURL: input.config.baseURL,
    apiKey: input.config.apiKey,
    model: input.config.model,
    timeoutMs: input.config.timeoutMs
  }, {
    developerInstructions: SCREEN_UNDERSTANDING_INSTRUCTIONS,
    userContent: JSON.stringify({
      prompt: input.prompt,
      appId: input.appId,
      platform: input.platform,
      evidence: evidence.promptEvidence,
      output: {
        page: { key: "known page key if confident", name: "visible page name", confidence: 0.0 },
        visibleStableTexts: ["stable UI labels only"],
        dynamicTexts: [{ text: "dynamic visible value", reason: "name" }],
        controlCandidates: [{
          candidateId: "stable temporary id",
          control: "textField",
          semanticName: "lessonName",
          scopeText: "课堂信息",
          ordinal: 1,
          currentValue: "visible current value",
          valueKind: "dynamicValue",
          confidence: 0.0,
          assetEligible: false
        }],
        warnings: []
      }
    }, null, 2),
    imagePngBase64: evidence.imagePngBase64,
    effort: "medium"
  }, input.fetchImpl);

  return sanitizeScreenUnderstandingCandidate({
    observationId: evidence.observationId,
    visionUsed: result.visionUsed,
    candidate: parseScreenUnderstandingJson(result.content)
  });
}
```

`SCREEN_UNDERSTANDING_INSTRUCTIONS` 必须包含：

```ts
const SCREEN_UNDERSTANDING_INSTRUCTIONS = [
  "你只负责理解当前移动端截图，输出候选屏幕模型，不生成 ScriptFlow，不操作设备，不沉淀资产。",
  "禁止输出坐标、bounds、resource-id、accessibility-id、XPath、selector 或截图区域。",
  "把按钮标题、区域标题、字段标签标为 stableLabel；把姓名、账号、手机号、邮箱、日期、数量、预填值标为 dynamicValue 或 sensitiveValue。",
  "预填输入框没有标签时，可以用 scopeText + ordinal 表达，例如课堂信息区域第 1 个 textField。",
  "只返回唯一 JSON 对象，不要 Markdown、代码围栏或解释。"
].join(\"\\n\");
```

- [ ] **步骤 4：运行测试确认通过**

```bash
pnpm vitest run platform/apps/server/src/script-flow-screen-understanding.test.ts platform/apps/server/src/ai-client.test.ts
```

预期：新增测试和现有 vision 测试通过。

- [ ] **步骤 5：提交**

```bash
git add platform/apps/server/src/script-flow-screen-understanding.ts platform/apps/server/src/script-flow-screen-understanding.test.ts
git commit -m "feat: 增加截图屏幕理解阶段"
```

### 任务 4：让 AI 生成 API 显式接入看屏上下文

**文件：**
- 修改：`platform/apps/server/src/script-flow-ai-api.ts`
- 修改：`platform/apps/server/src/script-flow-ai-api.test.ts`
- 修改：`platform/apps/server/src/index.ts`

- [ ] **步骤 1：先写失败测试**

在 `script-flow-ai-api.test.ts` 新增：

```ts
it("passes explicit screen assist request to the draft generator", async () => {
  const generateDraft = vi.fn().mockResolvedValue({ status: "needs_clarification", clarification: "请选择班级", channel: "codex", model: "planner" });
  const app = express();
  app.use(express.json());
  registerScriptFlowAiRoutes(app, { generateDraft, getFlow: () => undefined });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address unavailable");

  const response = await fetch(`http://127.0.0.1:${address.port}/api/script-flow-drafts/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "把当前页第一个输入框改成自动化课堂",
      appId: "cn.eeo.classin",
      platform: "android",
      screenAssist: { mode: "current", deviceSerial: "device-1" }
    })
  });

  expect(response.status).toBe(200);
  expect(generateDraft).toHaveBeenCalledWith({
    prompt: "把当前页第一个输入框改成自动化课堂",
    appId: "cn.eeo.classin",
    platform: "android",
    screenAssist: { mode: "current", deviceSerial: "device-1" }
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
pnpm vitest run platform/apps/server/src/script-flow-ai-api.test.ts
```

预期：`Unknown request field: screenAssist`。

- [ ] **步骤 3：扩展 API 输入类型**

在 `script-flow-ai-api.ts` 中：

```ts
export type ScriptFlowScreenAssistRequest = {
  mode: "current";
  deviceSerial: string;
};

export type ScriptFlowAiDraftGenerator = (input: {
  prompt: string;
  appId: string;
  platform: PageAssetPlatform;
  existingFlow?: ScriptFlow;
  screenAssist?: ScriptFlowScreenAssistRequest;
}) => Promise<ScriptFlowAiDraft>;
```

`strictBody` 允许字段增加 `screenAssist`，但继续拒绝 `currentPage`、`deviceState`、坐标等旧绕过字段。

```ts
const unknown = Object.keys(body).find((key) => !["prompt", "appId", "platform", "flowId", "expectedVersion", "screenAssist"].includes(key));
```

读取函数：

```ts
function screenAssistValue(value: unknown): ScriptFlowScreenAssistRequest | undefined {
  if (value === undefined) return undefined;
  const screenAssist = record(value, "screenAssist");
  if (screenAssist.mode !== "current") {
    throw new ScriptFlowAiApiError(400, "screenAssist.mode must be current");
  }
  return {
    mode: "current",
    deviceSerial: requiredString(screenAssist.deviceSerial, "screenAssist.deviceSerial")
  };
}
```

- [ ] **步骤 4：新建用例生成时透传，修改已有用例时也允许显式看屏**

新建路径：

```ts
await deps.generateDraft({
  prompt,
  appId: requiredString(body.appId, "appId"),
  platform: platformValue(body.platform),
  screenAssist: screenAssistValue(body.screenAssist)
});
```

修改路径：

```ts
return deps.generateDraft({
  prompt,
  appId: existingFlow.appId,
  platform: existingFlow.platform,
  existingFlow,
  screenAssist: screenAssistValue(body.screenAssist)
});
```

- [ ] **步骤 5：在 `index.ts` 中采集 Observation 并调用第一段 AI**

注册路由处调整为：

```ts
generateDraft: async ({ prompt, appId, platform, existingFlow, screenAssist }) => {
  const config = resolveAiModelConfig(process.env, storage.getAiModelSettings());
  const screenContext = screenAssist
    ? await understandScreenForScriptFlow({
        config,
        prompt,
        appId,
        platform,
        observation: await observationService.collect(screenAssist.deviceSerial, {
          includeScreenshot: true,
          includeUiTree: true,
          includeOcr: true
        })
      })
    : undefined;
  return generateScriptFlowDraft({
    config,
    prompt,
    appId,
    platform,
    existingFlow,
    screenContext,
    pageCatalog: pageAssetCatalog,
    flows: storage.listScriptFlows({ appId, platform }),
    navigationEntries: storage.listNavigationEntries({ appId, platform })
  });
}
```

- [ ] **步骤 6：运行测试**

```bash
pnpm vitest run platform/apps/server/src/script-flow-ai-api.test.ts platform/apps/server/src/script-flow-screen-understanding.test.ts
```

预期：全部通过。

- [ ] **步骤 7：提交**

```bash
git add platform/apps/server/src/script-flow-ai-api.ts platform/apps/server/src/script-flow-ai-api.test.ts platform/apps/server/src/index.ts
git commit -m "feat: AI 生成接口接入显式看屏请求"
```

### 任务 5：让第二段 AI 使用受控屏幕理解生成 ScriptFlow

**文件：**
- 修改：`platform/apps/server/src/script-flow-ai-planner.ts`
- 修改：`platform/apps/server/src/script-flow-ai-planner.test.ts`

- [ ] **步骤 1：先写失败测试：当前屏幕第一个输入框**

在 `script-flow-ai-planner.test.ts` 新增：

```ts
it("grounds current screen ordinal text field from screen context", async () => {
  const result = await generateScriptFlowDraft({
    config: enabledConfig(),
    prompt: "就在当前页面，把最上面的课堂名字改成自动化课堂A",
    appId: "cn.eeo.classin",
    platform: "android",
    pageCatalog: catalogWithCreateLessonPage(),
    flows: [],
    screenContext: {
      used: true,
      observationId: "observation-1",
      visionUsed: true,
      page: { key: "classin.teacher.lesson.create.visual", name: "新建课堂", confidence: 0.9 },
      visibleStableTexts: ["课堂信息", "课堂时长", "发布"],
      controlCandidates: [{
        candidateId: "field.lessonName.candidate",
        control: "textField",
        semanticName: "lessonName",
        scopeText: "课堂信息",
        ordinal: 1,
        valueKind: "dynamicValue",
        confidence: 0.76,
        assetEligible: true
      }],
      rejectedReasons: []
    },
    fetchImpl: aiResponse({
      status: "ready",
      summary: "填写当前新建课堂页的课堂名称。",
      assumptions: ["用户明确从当前页面继续，因此起点保持当前页面。"],
      parameterValues: { lessonName: "自动化课堂A" },
      document: {
        version: 1,
        kind: "case",
        purpose: "business",
        testLevel: "component",
        name: "修改课堂名称",
        app: { id: "cn.eeo.classin", platform: "android" },
        start: { strategy: "keepCurrent" },
        entry: { page: "classin.teacher.lesson.create.visual", session: "authenticated" },
        parameters: {
          lessonName: { type: "string", label: "课堂名称", required: true, control: "text" }
        },
        steps: [{
          id: "input-lesson-name",
          role: "business",
          onPage: "classin.teacher.lesson.create.visual",
          inputText: {
            target: { control: "textField", area: "content", scopeText: "课堂信息", ordinal: 1 },
            value: "${lessonName}"
          }
        }],
        tags: ["ai-generated"]
      }
    })
  });

  expect(result.status).toBe("trial_ready");
  if (result.status !== "trial_ready" && result.status !== "ready") throw new Error("expected generated draft");
  expect(result.document.steps[0]).toMatchObject({
    inputText: { target: { control: "textField", scopeText: "课堂信息", ordinal: 1 } }
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
pnpm vitest run platform/apps/server/src/script-flow-ai-planner.test.ts
```

预期：`textField` 不被 parser 接受，或 `screenContext` 不被函数签名接受。

- [ ] **步骤 3：调整 planner 输入和 prompt**

`generateScriptFlowDraft` 输入增加：

```ts
screenContext?: ScreenUnderstandingContext;
```

`buildScriptFlowPlannerPrompt` 增加参数：

```ts
screenContext?: ScreenUnderstandingContext
```

prompt 中增加：

```ts
screenContext
  ? [
      "当前屏幕理解上下文由用户显式开启看屏后生成。它只能帮助理解用户对当前页面的描述，不能覆盖已验证资产。",
      "如果用户说当前页面、当前屏幕、最上面、第一个输入框，可以优先使用 screenContext.controlCandidates 中的受控候选。",
      "screenContext 中 valueKind=dynamicValue 的内容只是当前值，不能写成 target.text、字段名、资产名或默认值。",
      "使用 textField 候选时，生成 target: { control: \"textField\", area: \"content\", scopeText, ordinal }。",
      "仍然禁止坐标、bounds、region、resource-id、accessibility-id 和 candidateId 出现在 ScriptFlow 中。",
      JSON.stringify({ screenContext }, null, 2)
    ].join(\"\\n\")
  : "未启用当前屏幕上下文；不要假装读取了设备页面。"
```

- [ ] **步骤 4：调整开发者指令**

把原有绝对句：

```ts
"规划阶段禁止识别实时设备页面；start、onPage 和 expectPage 表达运行时页面约束。"
```

改为：

```ts
"规划阶段默认不读取实时设备页面。只有输入中包含系统校验后的 screenContext 时，才可以把它作为当前屏幕理解辅助；screenContext 不是资产事实来源，不能覆盖已验证资产。"
```

并把 control 指令从：

```ts
"control 当前只支持 checkbox，必须描述 area: content 和 nearText；执行器会在文字附近识别并校验勾选状态。"
```

改为：

```ts
"control 支持 checkbox 和 textField。checkbox 必须描述 area: content 和 nearText；textField 必须描述 area: content，并优先使用 nearText，或使用 scopeText + ordinal 表示某区域内第几个输入框。"
```

- [ ] **步骤 5：target grounding 接受 screenContext**

`validateGeneratedTargetGrounding` 中把可追溯字面量来源扩展为：

```ts
const screenGroundingTexts = input.screenContext
  ? [
      input.screenContext.page.name,
      ...input.screenContext.visibleStableTexts,
      ...input.screenContext.controlCandidates.flatMap((candidate) => [candidate.text, candidate.scopeText, candidate.nearText])
    ].filter((item): item is string => Boolean(item))
  : [];
```

并明确不加入 `dynamicTexts` 或 `currentValue`。

- [ ] **步骤 6：运行 planner 测试**

```bash
pnpm vitest run platform/apps/server/src/script-flow-ai-planner.test.ts
```

预期：新增测试进入 parser 阶段，等待任务 6 的 textField schema 支持。

- [ ] **步骤 7：提交**

本任务依赖任务 6 完成后再提交，避免中间提交导致主干测试红灯。

### 任务 6：扩展 ScriptFlow schema 支持 `control: textField`

**文件：**
- 修改：`platform/packages/script-flow/src/types.ts`
- 修改：`platform/packages/script-flow/src/parser.ts`
- 修改：`platform/packages/script-flow/src/parser.test.ts`

- [ ] **步骤 1：先写失败测试**

在 `parser.test.ts` 新增：

```ts
it("accepts textField control targets with scope text and ordinal", () => {
  const flow = parseScriptFlow(`
version: 1
kind: case
purpose: business
testLevel: component
name: 修改课堂名称
app:
  id: cn.eeo.classin
  platform: android
start:
  strategy: keepCurrent
parameters:
  lessonName:
    type: string
steps:
  - id: input-lesson-name
    role: business
    inputText:
      target:
        control: textField
        area: content
        scopeText: 课堂信息
        ordinal: 1
      value: \${lessonName}
`);

  expect(flow.steps[0]).toMatchObject({
    inputText: { target: { control: "textField", scopeText: "课堂信息", ordinal: 1 } }
  });
});

it("rejects textField control targets without nearText or scopeText ordinal", () => {
  expect(() => parseScriptFlow(`
version: 1
kind: case
purpose: business
testLevel: component
name: 修改课堂名称
app:
  id: cn.eeo.classin
  platform: android
start:
  strategy: keepCurrent
steps:
  - id: input-lesson-name
    role: business
    inputText:
      target:
        control: textField
        area: content
      value: 自动化课堂
`)).toThrow(/textField targets require nearText or scopeText with ordinal/i);
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
pnpm vitest run platform/packages/script-flow/src/parser.test.ts
```

预期：`Target control must be checkbox`。

- [ ] **步骤 3：扩展类型**

`types.ts` 修改：

```ts
export type ScriptTargetControl = "checkbox" | "textField";

export type ScriptTarget = {
  text?: string;
  semantic?: string;
  icon?: string;
  control?: ScriptTargetControl;
  area?: ScriptTargetArea;
  position?: ScriptTargetPosition;
  nearText?: string;
  scopeText?: string;
  ordinal?: number;
  match?: "contains" | "exact";
};
```

- [ ] **步骤 4：扩展 parser 字段白名单和读取**

`targetFields` 增加：

```ts
const targetFields = new Set(["text", "semantic", "icon", "control", "area", "position", "nearText", "scopeText", "ordinal", "match"]);
```

`readTarget` 增加：

```ts
...optionalStringProperty(target.scopeText, `${path}.scopeText`, "scopeText", issues),
...optionalIntegerProperty(target.ordinal, `${path}.ordinal`, "ordinal", issues, 1, 50),
```

新增校验：

```ts
if (result.control === "checkbox" && (!result.nearText || result.area !== "content")) {
  issues.push({ path, message: "Checkbox targets require nearText and area content" });
}
if (result.control === "textField") {
  const hasScopeOrdinal = Boolean(result.scopeText && result.ordinal);
  if (result.area !== "content" || (!result.nearText && !hasScopeOrdinal)) {
    issues.push({ path, message: "textField targets require nearText or scopeText with ordinal and area content" });
  }
}
```

`readTargetControl` 改为：

```ts
if (value === "checkbox" || value === "textField") {
  return { control: value };
}
issues.push({ path, message: "Target control must be checkbox or textField" });
```

- [ ] **步骤 5：运行 parser 和 planner 测试**

```bash
pnpm vitest run platform/packages/script-flow/src/parser.test.ts platform/apps/server/src/script-flow-ai-planner.test.ts
```

预期：任务 5 和任务 6 的测试均通过。

- [ ] **步骤 6：提交任务 5 和任务 6**

```bash
git add platform/apps/server/src/script-flow-ai-planner.ts platform/apps/server/src/script-flow-ai-planner.test.ts platform/packages/script-flow/src/types.ts platform/packages/script-flow/src/parser.ts platform/packages/script-flow/src/parser.test.ts
git commit -m "feat: 支持看屏上下文生成 textField 目标"
```

### 任务 7：实现 textField 目标的运行时定位

**文件：**
- 修改：`platform/apps/server/src/script-target-resolver.ts`
- 修改：`platform/apps/server/src/script-target-resolver.test.ts`
- 修改：`platform/apps/server/src/semantic-locator.ts`
- 修改：`platform/apps/server/src/semantic-locator.test.ts`

- [ ] **步骤 1：先写 resolver 失败测试**

在 `script-target-resolver.test.ts` 新增：

```ts
it("resolves textField control targets to an ordinal text field structural locator", () => {
  const resolver = new ScriptTargetResolver();
  const action = resolver.resolveInputTextTarget({
    target: { control: "textField", area: "content", scopeText: "课堂信息", ordinal: 1 },
    appId: "cn.eeo.classin",
    platform: "android",
    stepId: "input-lesson-name"
  });

  expect(action).toMatchObject({
    type: "input_text_to_element",
    locatorKind: "structural_locator",
    structuralLocator: {
      strategy: "ordinal_text_field",
      role: "text_field",
      scopeText: "课堂信息",
      ordinal: 1
    }
  });
});
```

- [ ] **步骤 2：实现 resolver 映射**

在 control 分支中保留 checkbox 逻辑，新增：

```ts
if (input.target.control === "textField") {
  return {
    type: "input_text_to_element",
    locatorKind: "structural_locator",
    structuralLocator: {
      strategy: "ordinal_text_field",
      role: "text_field",
      ...(input.target.scopeText ? { scopeText: input.target.scopeText } : {}),
      ...(input.target.nearText ? { anchorText: input.target.nearText } : {}),
      ...(input.target.ordinal ? { ordinal: input.target.ordinal } : {})
    },
    allowRegionFallback: false
  };
}
```

- [ ] **步骤 3：先写 semantic locator 失败测试**

在 `semantic-locator.test.ts` 新增 OCR-only 场景：

```ts
it("locates the first text field inside a scoped form area without Android hierarchy", async () => {
  const locator = new SemanticLocator({
    ocr: fakeOcr([
      textBox("课堂时长", 10, 8, 20, 4),
      textBox("课堂信息", 8, 25, 20, 4),
      textBox("小王", 12, 33, 18, 4),
      textBox("教师", 34, 33, 12, 4),
      textBox("发布", 82, 5, 10, 4)
    ]),
    driver: fakeDriverWithoutUiHierarchy()
  });

  const result = await locator.resolve({
    serial: "device-1",
    deviceSize: { width: 1000, height: 2000 },
    locator: {
      kind: "structural_locator",
      structuralLocator: {
        strategy: "ordinal_text_field",
        role: "text_field",
        scopeText: "课堂信息",
        ordinal: 1
      }
    }
  });

  expect(result.action).toMatchObject({
    type: "tap"
  });
  expect(result.metadata?.semantic?.reason).toBe("ordinal_text_field_selected");
});
```

- [ ] **步骤 4：实现候选选择策略**

`semantic-locator.ts` 中新增结构定位分支：

```ts
if (structuralLocator.strategy === "ordinal_text_field") {
  return this.resolveOrdinalTextField(input, structuralLocator);
}
```

候选策略：

1. 如果 UI hierarchy 或可访问性有 `EditText`、`TextInput`、`editable=true`、`focusable=true` 且位于内容区，作为高置信 textField 候选。
2. 如果没有可用结构树，用 OCR 行块推断：在 `scopeText` 下方的同一卡片或同一区域中，选取可作为输入值的文本行；按钮、开关、单位、标题和明显标签不作为输入框本体。
3. 按从上到下、从左到右排序。
4. 使用 `ordinal` 选择候选。
5. 候选不唯一或置信度不足时失败，错误码保持 `SEMANTIC_TARGET_NOT_FOUND` 或细化为 `AMBIGUOUS_TEXT_FIELD_TARGET`。
6. 禁止使用屏幕中心、固定百分比区域或坐标回退。

- [ ] **步骤 5：运行定位测试**

```bash
pnpm vitest run platform/apps/server/src/script-target-resolver.test.ts platform/apps/server/src/semantic-locator.test.ts
```

预期：textField resolver 和 OCR-only 定位测试通过。

- [ ] **步骤 6：提交**

```bash
git add platform/apps/server/src/script-target-resolver.ts platform/apps/server/src/script-target-resolver.test.ts platform/apps/server/src/semantic-locator.ts platform/apps/server/src/semantic-locator.test.ts
git commit -m "feat: 增加 textField 结构定位能力"
```

### 任务 8：前端增加“结合当前屏幕生成”

**文件：**
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx`
- 修改：`platform/apps/dashboard/src/styles.css`

- [ ] **步骤 1：先写失败测试**

在 `AiScriptFlowsPanel.test.tsx` 新增静态渲染测试：

```tsx
it("shows an explicit current screen assist option when a device is available", () => {
  const markup = renderToStaticMarkup(<AiScriptFlowsPanel
    defaultAppId="cn.eeo.classin"
    devices={[{ serial: "device-1", name: "Pixel" }]}
    selectedSerial="device-1"
    setMessage={() => undefined}
    onSaved={() => undefined}
    onOpenRun={() => undefined}
  />);

  expect(markup).toContain("结合当前屏幕生成");
  expect(markup).toContain("默认优先使用资产库");
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
pnpm vitest run platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx
```

预期：页面不包含新文案。

- [ ] **步骤 3：新增状态和请求体**

`AiScriptFlowsPanel.tsx` 增加：

```tsx
const [useCurrentScreen, setUseCurrentScreen] = useState(false);
```

构造请求体：

```tsx
const screenAssist = useCurrentScreen && deviceSerial
  ? { screenAssist: { mode: "current" as const, deviceSerial } }
  : {};

const body = revision
  ? { prompt: prompt.trim(), flowId: revision.flowId, expectedVersion: revision.version, ...screenAssist }
  : { prompt: prompt.trim(), appId: appId.trim(), platform, ...screenAssist };
```

- [ ] **步骤 4：新增 UI 控件**

放在 textarea 下方、生成按钮上方：

```tsx
<label className="ai-screen-assist">
  <input
    type="checkbox"
    checked={useCurrentScreen}
    onChange={(event) => setUseCurrentScreen(event.target.checked)}
    disabled={!deviceSerial || busy}
  />
  <span>结合当前屏幕生成</span>
  <small>{deviceSerial ? "默认优先使用资产库；开启后会读取当前设备截图辅助理解。" : "请选择设备后可用。"}</small>
</label>
```

- [ ] **步骤 5：更新空态文案**

把：

```tsx
<span>规划时不会读取或改变当前设备页面。</span>
```

改为：

```tsx
<span>{useCurrentScreen ? "生成时会读取当前设备截图，但不会操作设备。" : "默认优先使用资产库，不读取当前设备页面。"}</span>
```

- [ ] **步骤 6：运行前端测试**

```bash
pnpm vitest run platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx
```

预期：新增测试和原有测试通过。

- [ ] **步骤 7：提交**

```bash
git add platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx platform/apps/dashboard/src/styles.css
git commit -m "feat: 前端支持结合当前屏幕生成"
```

## 四、第二阶段衔接任务（不在本次实现范围）

以下任务只记录“看屏辅助生成”与后续持续学习方案的可能衔接点，不属于阶段 1.5 的交付范围。当前实现阶段不创建 `assetProposals`，不扩展 `TestRun.sourceSnapshot.generationContext`，不从生成入口写 LearningCandidate。真正的资产沉淀继续按 `docs/superpowers/plans/2026-07-31-generation-execution-first-learning-modes.md` 的第二阶段执行。

### 后续任务 A：候选资产提议与学习策略衔接

**文件：**
- 创建：`platform/apps/server/src/script-flow-asset-proposal.ts`
- 创建：`platform/apps/server/src/script-flow-asset-proposal.test.ts`
- 修改：`platform/packages/shared/src/index.ts`
- 修改：`platform/apps/server/src/learning-policy.ts`
- 修改：`platform/apps/server/src/learning-policy.test.ts`

- [ ] **步骤 1：先写失败测试**

新增：

```ts
import { describe, expect, it } from "vitest";
import { assetProposalsFromScreenContext } from "./script-flow-asset-proposal.js";

describe("script flow asset proposal", () => {
  it("turns eligible text field candidates into interaction proposals without current values", () => {
    const proposals = assetProposalsFromScreenContext({
      used: true,
      observationId: "observation-1",
      visionUsed: true,
      page: { key: "classin.teacher.lesson.create.visual", name: "新建课堂", confidence: 0.9 },
      visibleStableTexts: ["课堂信息"],
      rejectedReasons: [],
      controlCandidates: [{
        candidateId: "field.lessonName.candidate",
        control: "textField",
        semanticName: "lessonName",
        scopeText: "课堂信息",
        ordinal: 1,
        valueKind: "dynamicValue",
        confidence: 0.8,
        assetEligible: true
      }]
    });

    expect(proposals).toEqual([{
      kind: "interaction",
      source: "screen_understanding",
      semanticContract: {
        control: "textField",
        area: "content",
        scopeText: "课堂信息",
        ordinal: 1
      },
      confidence: 0.8
    }]);
  });
});
```

- [ ] **步骤 2：实现提议映射**

`script-flow-asset-proposal.ts`：

```ts
import type { ScreenUnderstandingContext, ScriptFlowAssetProposal } from "@mobile-automation/shared";

export function assetProposalsFromScreenContext(context: ScreenUnderstandingContext): ScriptFlowAssetProposal[] {
  return context.controlCandidates
    .filter((candidate) => candidate.assetEligible && candidate.confidence >= 0.7)
    .flatMap((candidate): ScriptFlowAssetProposal[] => {
      if (candidate.control === "textField" && candidate.scopeText && candidate.ordinal) {
        return [{
          kind: "interaction",
          source: "screen_understanding",
          semanticContract: {
            control: "textField",
            area: "content",
            scopeText: candidate.scopeText,
            ordinal: candidate.ordinal
          },
          confidence: candidate.confidence
        }];
      }
      if (candidate.control === "checkbox" && candidate.nearText) {
        return [{
          kind: "interaction",
          source: "screen_understanding",
          semanticContract: {
            control: "checkbox",
            area: "content",
            nearText: candidate.nearText
          },
          confidence: candidate.confidence
        }];
      }
      if (candidate.control === "button" && candidate.text) {
        return [{
          kind: "interaction",
          source: "screen_understanding",
          semanticContract: {
            text: candidate.text,
            area: "content"
          },
          confidence: candidate.confidence
        }];
      }
      return [];
    });
}
```

- [ ] **步骤 3：扩展 InteractionAsset 语义合同**

`platform/packages/shared/src/index.ts` 的 `InteractionAsset.semanticContract` 增加：

```ts
scopeText?: string;
ordinal?: number;
```

`NavigationEntry.action.target` 同步增加：

```ts
scopeText?: string;
ordinal?: number;
```

- [ ] **步骤 4：学习策略接受 textField，但拒绝动态值和坐标**

在 `learning-policy.test.ts` 新增：

```ts
it("accepts validated textField interaction candidates without dynamic current values", () => {
  expect(automaticLearningDecision({
    id: "candidate-1",
    sessionId: "session-1",
    kind: "interaction",
    stableKey: "interaction.lessonName",
    confidence: 0.98,
    status: "validated",
    payload: {
      semanticContract: {
        control: "textField",
        area: "content",
        scopeText: "课堂信息",
        ordinal: 1
      }
    },
    evidenceArtifactIds: ["artifact-1"],
    validationIssues: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z"
  }).accept).toBe(true);
});
```

现有 `containsDynamicOrSensitiveLiteral` 已拒绝账号、手机号、邮箱和密码；新增测试确保 `currentValue: "小王"` 出现在 payload 时不通过。

- [ ] **步骤 5：运行测试**

```bash
pnpm vitest run platform/apps/server/src/script-flow-asset-proposal.test.ts platform/apps/server/src/learning-policy.test.ts
```

预期：全部通过。

- [ ] **步骤 6：提交**

```bash
git add platform/apps/server/src/script-flow-asset-proposal.ts platform/apps/server/src/script-flow-asset-proposal.test.ts platform/packages/shared/src/index.ts platform/apps/server/src/learning-policy.ts platform/apps/server/src/learning-policy.test.ts
git commit -m "feat: 衔接看屏候选资产提议"
```

### 后续任务 B：把生成上下文随试运行进入证据链

**文件：**
- 修改：`platform/packages/shared/src/index.ts`
- 修改：`platform/apps/server/src/script-flow-runner.ts`
- 修改：`platform/apps/server/src/script-flow-api.ts`
- 修改：`platform/apps/server/src/script-flow-api.test.ts`
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx`
- 修改：`platform/apps/server/src/storage.ts`
- 修改：`platform/apps/server/src/learning-storage.test.ts`

- [ ] **步骤 1：先写 API 失败测试**

在 `script-flow-api.test.ts` 新增：试运行 body 带 `generationContext` 时，run.sourceSnapshot 保留脱敏上下文摘要和 assetProposals。

```ts
expect(run.sourceSnapshot?.generationContext).toEqual({
  screen: {
    used: true,
    observationId: "observation-1",
    visionUsed: true,
    page: { key: "classin.teacher.lesson.create.visual", name: "新建课堂", confidence: 0.9 },
    visibleStableTexts: ["课堂信息"],
    controlCandidates: [{
      candidateId: "field.lessonName.candidate",
      control: "textField",
      semanticName: "lessonName",
      scopeText: "课堂信息",
      ordinal: 1,
      valueKind: "dynamicValue",
      confidence: 0.8,
      assetEligible: true
    }],
    rejectedReasons: []
  },
  assetProposals: [{
    kind: "interaction",
    source: "screen_understanding",
    semanticContract: { control: "textField", area: "content", scopeText: "课堂信息", ordinal: 1 },
    confidence: 0.8
  }]
});
```

- [ ] **步骤 2：扩展共享类型**

`TestRun.sourceSnapshot` 增加：

```ts
generationContext?: {
  screen?: ScreenUnderstandingContext;
  assetProposals?: ScriptFlowAssetProposal[];
};
```

- [ ] **步骤 3：扩展 draft result**

`ScriptFlowAiDraft` 的 ready/trial_ready 分支增加：

```ts
generationContext?: {
  screen?: ScreenUnderstandingContext;
  assetProposals?: ScriptFlowAssetProposal[];
};
```

`generateScriptFlowDraft` 在有 `screenContext` 时返回：

```ts
generationContext: {
  screen: input.screenContext,
  assetProposals: assetProposalsFromScreenContext(input.screenContext)
}
```

- [ ] **步骤 4：前端执行草稿时带上 generationContext**

`executeDraft` 的 body 增加：

```tsx
...(targetDraft.generationContext ? { generationContext: targetDraft.generationContext } : {})
```

- [ ] **步骤 5：后端运行 API 严格读取 generationContext**

`DRAFT_RUN_FIELDS` 增加：

```ts
"generationContext"
```

读取时复用 `sanitizeScreenUnderstandingCandidate` 的输出结构校验，不接受 raw screenshot 或动态 currentValue。

- [ ] **步骤 6：runner 写入 sourceSnapshot**

`StartScriptFlowRunInput` 增加：

```ts
generationContext?: NonNullable<TestRun["sourceSnapshot"]>["generationContext"];
```

`sourceSnapshot` 增加：

```ts
...(input.generationContext ? { generationContext: input.generationContext } : {})
```

- [ ] **步骤 7：storage 只在运行成功后转学习候选**

在 `recordTrialLearningSession` 或候选生成入口中增加：

```ts
const proposals = sourceSnapshot.generationContext?.assetProposals ?? [];
```

只有 `runStatus === "passed"` 且 `outcomeStatus !== "rejected"` 且学习模式允许采集时，把 proposal 转为 `LearningCandidate`。失败运行只保留 run sourceSnapshot，不生成候选。

- [ ] **步骤 8：运行测试**

```bash
pnpm vitest run platform/apps/server/src/script-flow-api.test.ts platform/apps/server/src/learning-storage.test.ts platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx
```

预期：API、存储和前端请求体测试通过。

- [ ] **步骤 9：提交**

```bash
git add platform/packages/shared/src/index.ts platform/apps/server/src/script-flow-runner.ts platform/apps/server/src/script-flow-api.ts platform/apps/server/src/script-flow-api.test.ts platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx platform/apps/server/src/storage.ts platform/apps/server/src/learning-storage.test.ts
git commit -m "feat: 记录看屏生成上下文证据"
```

## 五、阶段 1.5 验收与回归

### 任务 9：端到端验收与回归

**文件：**
- 不新增产品代码
- 可修改：`docs/test/plans/screen-assisted-generation-acceptance.md`

- [ ] **步骤 1：运行全量静态检查和单测**

```bash
export PATH=/Users/eeo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
pnpm lint
pnpm test:unit
```

预期：类型检查通过，单元测试全部通过。

- [ ] **步骤 2：手工验收默认不读屏**

在 Dashboard AI 生成测试页面，不勾选“结合当前屏幕生成”，输入：

```text
进入新建课堂页面，把课堂名称改成自动化课堂A，不要发布
```

预期：

1. 请求体不包含 `screenAssist`。
2. 后端不调用 `ObservationService.collect`。
3. 如果资产库已有页面和字段资产，生成可执行 ScriptFlow。
4. 如果资产不足，返回可理解的补充问题或生成需试运行草稿。

- [ ] **步骤 3：手工验收看屏生成**

设备停在“新建课堂”页面，勾选“结合当前屏幕生成”，输入：

```text
就在当前页面，把最上面的课堂名字改成自动化课堂A
```

预期生成结果：

```yaml
start:
  strategy: keepCurrent
steps:
  - id: input-lesson-name
    role: business
    onPage: classin.teacher.lesson.create.visual
    inputText:
      target:
        control: textField
        area: content
        scopeText: 课堂信息
        ordinal: 1
      value: ${lessonName}
```

不得出现：

```yaml
target:
  text: 课堂名字
```

不得出现：

```yaml
x: 123
y: 456
region:
resourceId:
candidateId:
```

- [ ] **步骤 4：手工验收不会误发布**

输入：

```text
测试一下课堂时长不能选择10小时40分钟
```

预期：生成选择课堂时长和断言/待确认逻辑；除非用户明确说发布，否则不得生成 `发布` 点击，不得基于“发布按钮在右上角”生成顶部发布动作。

- [ ] **步骤 5：手工验收 Compose/UI hierarchy 退化路径**

在 `dumpUiHierarchy` 失败或无 EditText 信息时，OCR-only 仍可根据 `scopeText + ordinal` 尝试定位；定位不足时明确失败为目标不唯一或未找到，不回退坐标。

- [ ] **步骤 6：提交验收记录**

```bash
git add docs/test/plans/screen-assisted-generation-acceptance.md
git commit -m "test: 记录看屏辅助生成验收结果"
```

## 六、验收标准

- 默认生成不读取设备页面，旧的任意 `currentPage` 字段仍被拒绝。
- 开启“结合当前屏幕生成”后，服务端采集 Observation 和截图，AI 第一段使用截图理解当前屏幕。
- AI 屏幕理解输出经过确定性过滤后才进入 ScriptFlow 生成。
- 任何 AI 输出中的坐标、bounds、resource-id、accessibility-id、XPath、selector 或截图区域都被拒绝。
- 动态值可以帮助识别当前控件，但不能成为 target.text、字段名、资产名、默认值或正式资产 matcher。
- `control: textField` 支持 `scopeText + ordinal`，能表达“课堂信息区域第一个输入框”。
- textField 定位在 UI hierarchy 可用和不可用时都有测试覆盖；不可用时走 OCR/视觉结构，不依赖 Android XML。
- 本阶段不创建、不保存、不发布学习候选；试运行后的资产学习仍由第二阶段持续学习方案控制。
- 已验证资产优先于当前屏幕；当前屏幕与资产冲突时返回澄清或保留待验证假设，不自动覆盖资产。
- `pnpm lint` 和 `pnpm test:unit` 在 Node 24 下通过。

## 七、推荐提交顺序

1. `docs: 规划看屏辅助生成边界`
2. `feat: 增加看屏生成上下文过滤器`
3. `feat: 增加截图屏幕理解阶段`
4. `feat: AI 生成接口接入显式看屏请求`
5. `feat: 支持看屏上下文生成 textField 目标`
6. `feat: 增加 textField 结构定位能力`
7. `feat: 前端支持结合当前屏幕生成`
8. `test: 记录看屏辅助生成验收结果`

## 八、风险与控制

- 截图理解过拟合当前动态数据：第一段 AI 必须标注 valueKind，系统过滤器不把 currentValue 传给第二段生成。
- 模型输出坐标或平台私有字段：过滤器递归拒绝，并在 repair prompt 中要求重新输出。
- 看屏入口被误认为默认行为：前端默认关闭，后端只有 `screenAssist.mode=current` 才采集设备。
- 资产被当前屏幕覆盖：planner prompt 明确资产优先，冲突时澄清；本阶段不写资产，也不支持直接覆盖 active 资产。
- Compose 场景 UI hierarchy 不可靠：textField 定位必须有 OCR-only 测试，UI hierarchy 只是候选来源之一。
- 多模态 Provider 不支持图片：`ai-client` 已支持 image fallback，`visionUsed=false` 时仍返回文本上下文结果，并在 draft assumptions 中标注“本次未使用视觉截图”。

## 九、执行建议

优先执行任务 1 到任务 8，先把用户可见价值闭环做出来：

```text
勾选当前屏幕 -> AI 看截图理解 -> 生成 textField 脚本 -> 真实执行
```

后续任务 A 和后续任务 B 接资产候选沉淀，建议等阶段 1.5 的真实设备验收稳定后，再放回第二阶段持续学习方案中执行。这样能避免还没证明“看屏生成”有效，就先把候选资产表和学习生命周期复杂度引进来。
