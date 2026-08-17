# AI 测试点规划实现方案

> **对于智能体：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 来逐个任务执行此方案。步骤使用复选框（`- [ ]`）语法进行进度追踪。

**目标：** 在 AI 直接生成 ScriptFlow 前，提供一个可选的“测试点规划”阶段，将 Bug 描述、代码逻辑、冒烟目标或普通测试目标拆解为用户可选择的测试点，再复用现有生成、试运行、修复和报告链路。

**架构：** 新增不持久化的 `TestPointPlan` 草稿 API 和 AI 规划器。Dashboard 允许用户选择测试意图类型，先拆解测试点；用户选择单个测试点后，前端将其作为受控外部上下文传入既有 ScriptFlow 生成接口。`ScriptFlow` 继续是唯一可执行用例事实来源，第一期不创建需求库、测试计划表、覆盖率数据库或新的执行路径。

**技术栈：** TypeScript、Express、React、Vitest、现有 `runAiJsonRequest`、ScriptFlow v1、现有 AI 模型配置和 ClassIn 代码上下文检索。

---

## 范围与产品决定

- 这是**可选**步骤：普通“直接生成测试”流程保持不变。
- 测试意图类型只支持 `manual`、`bug`、`code`、`smoke`。
- 测试点规划只输出草稿，不落库；刷新页面后不保留。
- 一次只允许选择一个测试点生成一个 ScriptFlow，避免把相互独立的验证目标混成难以试运行和维护的大场景。
- 选中的测试点通过 `externalContext.source: "test-point-plan"` 传给现有 ScriptFlow 规划器；不要把测试点内容拼接成不可区分的用户 prompt。
- `bug` 规划至少应考虑复现、修复验证和相邻回归；`code` 规划只能将代码信息作为线索，不能输出资源 ID、类名、selector、坐标或内部 key；`smoke` 规划优先覆盖最小主链路和可观察结果。
- 第一期不提供“需求文档上传”“思维导图”“批量生成”“自动激活”“需求覆盖率”。这些都依赖持久化的 `RequirementItem/TestPoint/TraceLink` 模型，应作为后续独立项目。

## 数据流

```text
Bug / 代码逻辑 / 冒烟目标 / 普通描述
  -> POST /api/test-point-plans/generate
  -> TestPointPlan 草稿
  -> 用户选择一个 TestPoint
  -> POST /api/script-flow-drafts/generate
       externalContext = test-point-plan
  -> ScriptFlow 草稿
  -> 现有步骤审查、trial、repair、保存、Run Report
```

## 文件结构

- 修改：`platform/packages/shared/src/index.ts`
  - 放置浏览器与服务端共用的测试点规划 DTO。
- 创建：`platform/apps/server/src/test-point-ai-planner.ts`
  - AI prompt、响应解析、确定性校验和 `generateTestPointPlan`。
- 创建：`platform/apps/server/src/test-point-ai-planner.test.ts`
  - 覆盖 JSON 合同、意图边界和 AI 输入。
- 创建：`platform/apps/server/src/test-point-ai-api.ts`
  - HTTP body 校验、App ID/平台归一化和规划器调用。
- 创建：`platform/apps/server/src/test-point-ai-api.test.ts`
  - 覆盖 HTTP 正常路径、非法字段和意图类型。
- 修改：`platform/apps/server/src/index.ts`
  - 注册新路由，并复用现有 AI 模型配置和可选 ClassIn 代码上下文。
- 修改：`platform/apps/server/src/script-flow-ai-api.ts`
  - 接受受控的 `externalContext.source: "test-point-plan"`。
- 修改：`platform/apps/server/src/script-flow-ai-planner.ts`
  - 扩展 `ScriptFlowExternalContext` 来源联合类型，并在 prompt 中将测试点当作“已确认范围”处理。
- 修改：`platform/apps/server/src/script-flow-ai-api.test.ts`
  - 覆盖测试点上下文可通过 API 并原样传入规划器。
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx`
  - 增加测试意图选择、测试点草稿/选择状态、规划请求和将选中点传给既有生成请求的逻辑。
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx`
  - 覆盖请求体、选择状态和页面文案。
- 修改：`platform/apps/dashboard/src/styles.css`
  - 仅添加测试意图分段控件和测试点列表所需的局部样式。
- 修改：`docs/product/mobile-automation-platform/README.md`
  - 说明测试点规划是 AI 生成的可选前置步骤，且不改变 ScriptFlow 的事实来源地位。

## API 合同

```ts
export type TestIntentKind = "manual" | "bug" | "code" | "smoke";

export type TestPointCategory =
  | "functional"
  | "negative"
  | "boundary"
  | "regression"
  | "smoke"
  | "performance"
  | "compatibility";

export type TestPoint = {
  id: string;
  title: string;
  category: TestPointCategory;
  priority: "high" | "medium" | "low";
  rationale: string;
  preconditions: string[];
  actions: string[];
  expectedResults: string[];
};

export type TestPointPlan = {
  version: 1;
  intentKind: TestIntentKind;
  summary: string;
  assumptions: string[];
  points: TestPoint[];
};

export type TestPointPlanDraft =
  | {
      status: "ready";
      plan: TestPointPlan;
      channel: "codex" | "openai-compatible";
      model: string;
    }
  | {
      status: "needs_clarification";
      clarification: string;
      channel: "codex" | "openai-compatible";
      model: string;
    };
```

`POST /api/test-point-plans/generate` 请求：

```json
{
  "prompt": "修复后切换网络课程列表不应持续加载",
  "appId": "classin",
  "platform": "android",
  "intentKind": "bug",
  "generationContext": {
    "mode": "asset_enhanced",
    "useAssetsForGeneration": true,
    "useHistoryScriptsForGeneration": true
  }
}
```

第一期请求不接受 `screenAssist`。选中测试点后，用户仍可在既有 ScriptFlow 生成页开启“结合当前屏幕生成”，用于把抽象测试点落到当前 UI。

### 任务 1: 定义共享 DTO 和 ScriptFlow 测试点上下文

**文件：**
- 修改：`platform/packages/shared/src/index.ts:201`
- 修改：`platform/apps/server/src/script-flow-ai-api.ts:24-31`
- 修改：`platform/apps/server/src/script-flow-ai-planner.ts:77-84`
- 测试：`platform/apps/server/src/script-flow-ai-api.test.ts`

- [ ] **步骤 1: 为测试点上下文编写失败的 API 测试**

在 `platform/apps/server/src/script-flow-ai-api.test.ts` 添加测试，明确 API 只接受结构化测试点上下文，且不能让调用方绕过正常 body 校验：

```ts
it("accepts a selected test-point plan as controlled external context", async () => {
  const generateDraft = vi.fn().mockResolvedValue({
    status: "needs_clarification",
    clarification: "请补充测试设备",
    channel: "codex",
    model: "planner"
  });
  const { baseUrl } = await testServer(registerScriptFlowAiRoutes, {
    generateDraft,
    getFlow: () => undefined
  });

  const response = await fetch(`${baseUrl}/api/script-flow-drafts/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "验证已选择测试点",
      appId: "classin",
      platform: "android",
      externalContext: {
        source: "test-point-plan",
        summary: "已确认测试点：网络恢复后课程列表停止加载。",
        candidateSteps: ["断开网络打开课程列表", "恢复网络", "验证加载结束"],
        constraints: ["只覆盖该测试点", "预期必须转换为可观察断言"]
      }
    })
  });

  expect(response.status).toBe(200);
  expect(generateDraft).toHaveBeenCalledWith(expect.objectContaining({
    externalContext: expect.objectContaining({
      source: "test-point-plan",
      candidateSteps: ["断开网络打开课程列表", "恢复网络", "验证加载结束"]
    })
  }));
});
```

- [ ] **步骤 2: 运行测试以验证其失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/script-flow-ai-api.test.ts
```

预期：失败，错误包含 `externalContext.source must be code, directory, classin-code, or manual`。

- [ ] **步骤 3: 在 shared 包中加入测试点 DTO**

在 `platform/packages/shared/src/index.ts` 的 ScriptFlow 类型附近加入：

```ts
export type TestIntentKind = "manual" | "bug" | "code" | "smoke";

export type TestPointCategory =
  | "functional"
  | "negative"
  | "boundary"
  | "regression"
  | "smoke"
  | "performance"
  | "compatibility";

export type TestPoint = {
  id: string;
  title: string;
  category: TestPointCategory;
  priority: "high" | "medium" | "low";
  rationale: string;
  preconditions: string[];
  actions: string[];
  expectedResults: string[];
};

export type TestPointPlan = {
  version: 1;
  intentKind: TestIntentKind;
  summary: string;
  assumptions: string[];
  points: TestPoint[];
};

export type TestPointPlanDraft =
  | { status: "ready"; plan: TestPointPlan; channel: "codex" | "openai-compatible"; model: string }
  | { status: "needs_clarification"; clarification: string; channel: "codex" | "openai-compatible"; model: string };
```

- [ ] **步骤 4: 允许 `test-point-plan` 作为现有外部上下文来源**

在 `platform/apps/server/src/script-flow-ai-api.ts` 和 `platform/apps/server/src/script-flow-ai-planner.ts` 中，把来源联合类型改为：

```ts
source: "code" | "directory" | "classin-code" | "manual" | "test-point-plan";
```

并将解析函数替换为：

```ts
function externalContextSource(value: string): ScriptFlowExternalContextRequest["source"] {
  if (value === "code" || value === "directory" || value === "classin-code" || value === "manual" || value === "test-point-plan") {
    return value;
  }
  throw new ScriptFlowAiApiError(
    400,
    "externalContext.source must be code, directory, classin-code, manual, or test-point-plan"
  );
}
```

在 `buildScriptFlowPlannerPrompt` 的 `externalContext` 分支前增加测试点范围约束：

```ts
externalContext?.source === "test-point-plan"
  ? "测试点规划上下文是用户已确认的生成范围。只生成该测试点的用例；不要把同一规划中的其它点合并进来。"
  : undefined,
```

- [ ] **步骤 5: 运行测试以验证其通过**

运行：

```bash
pnpm vitest run platform/apps/server/src/script-flow-ai-api.test.ts
```

预期：通过，新增测试确认 `test-point-plan` 被原样传递。

- [ ] **步骤 6: 提交代码**

```bash
git add platform/packages/shared/src/index.ts \
  platform/apps/server/src/script-flow-ai-api.ts \
  platform/apps/server/src/script-flow-ai-planner.ts \
  platform/apps/server/src/script-flow-ai-api.test.ts
git commit -m "feat: accept test point context for ScriptFlow drafts"
```

### 任务 2: 实现测试点 AI 规划器和确定性响应校验

**文件：**
- 创建：`platform/apps/server/src/test-point-ai-planner.ts`
- 创建：`platform/apps/server/src/test-point-ai-planner.test.ts`

- [ ] **步骤 1: 编写失败的规划器测试**

创建 `platform/apps/server/src/test-point-ai-planner.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import {
  buildTestPointPlannerPrompt,
  generateTestPointPlan,
  parseTestPointPlanResponse
} from "./test-point-ai-planner.js";

describe("TestPoint AI planner", () => {
  it("parses an atomic bug-regression plan", () => {
    const plan = parseTestPointPlanResponse(JSON.stringify({
      status: "ready",
      plan: {
        version: 1,
        intentKind: "bug",
        summary: "验证课程列表在网络恢复后结束加载",
        assumptions: ["课程列表页可通过现有导航进入"],
        points: [{
          id: "network-recovery",
          title: "网络恢复后课程列表结束加载",
          category: "regression",
          priority: "high",
          rationale: "验证缺陷修复后的用户可见结果",
          preconditions: ["已登录", "存在至少一个课程"],
          actions: ["断开网络打开课程列表", "恢复网络"],
          expectedResults: ["加载状态结束", "课程列表或明确空态可见"]
        }]
      }
    }));

    expect(plan).toMatchObject({
      status: "ready",
      plan: { intentKind: "bug", points: [{ id: "network-recovery", category: "regression" }] }
    });
  });

  it("rejects duplicate point ids and unknown response fields", () => {
    expect(() => parseTestPointPlanResponse(JSON.stringify({
      status: "ready",
      extra: true,
      plan: { version: 1, intentKind: "smoke", summary: "x", assumptions: [], points: [] }
    }))).toThrow("Unknown AI test point response field: extra");

    expect(() => parseTestPointPlanResponse(JSON.stringify({
      status: "ready",
      plan: {
        version: 1,
        intentKind: "smoke",
        summary: "x",
        assumptions: [],
        points: [point("open-home"), point("open-home")]
      }
    }))).toThrow("duplicate test point id: open-home");
  });

  it("passes code context as a hint without exposing it as executable targets", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      output_text: JSON.stringify(readyPlan("code"))
    }));

    await generateTestPointPlan({
      config: { enabled: true, baseURL: "https://example.test/v1", apiKey: "key", model: "test-model", timeoutMs: 1_000 },
      prompt: "根据课程详情的刷新逻辑生成冒烟验证点",
      appId: "classin",
      platform: "android",
      intentKind: "code",
      externalContext: {
        source: "classin-code",
        summary: "CourseDetailViewModel 在刷新成功后更新课程状态。",
        relevantFiles: ["classin-android:CourseDetailViewModel.kt"]
      },
      fetchImpl
    });

    expect(buildTestPointPlannerPrompt(
      "根据课程详情的刷新逻辑生成冒烟验证点",
      "classin",
      "android",
      "code",
      { source: "classin-code", summary: "CourseDetailViewModel 在刷新成功后更新课程状态。" }
    )).toContain("禁止输出类名、resource-id、selector、坐标或内部 key");
  });
});
```

测试文件中实现本地 `point`、`readyPlan` 和 `jsonResponse` 辅助函数；其返回值必须满足本任务开头的 API 合同。

- [ ] **步骤 2: 运行测试以验证其失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/test-point-ai-planner.test.ts
```

预期：失败，提示找不到 `test-point-ai-planner.js`。

- [ ] **步骤 3: 实现规划器**

创建 `platform/apps/server/src/test-point-ai-planner.ts`，导出以下公共 API：

```ts
export const TEST_POINT_AI_DEVELOPER_INSTRUCTIONS = [
  "你是移动自动化测试点规划器，只输出可审查的测试点，不生成 ScriptFlow，不操作设备。",
  "测试点必须原子化：一个点只验证一个用户可观察的行为或失败处理。",
  "bug 类型必须优先覆盖复现、修复验证和相邻回归；代码类型只能把代码作为行为线索；smoke 类型优先最小主链路和可观察结果。",
  "没有证据支持的 UI 文案、页面路径、接口、类名、resource-id、selector、坐标或内部 key 一律不得输出。",
  "信息不足时返回 needs_clarification；ready 时只返回结构化 TestPointPlan JSON。"
].join("\n");

export function buildTestPointPlannerPrompt(
  prompt: string,
  appId: string,
  platform: PageAssetPlatform,
  intentKind: TestIntentKind,
  externalContext?: ScriptFlowExternalContext
): string;

export function parseTestPointPlanResponse(raw: string): Omit<TestPointPlanDraft, "channel" | "model">;

export async function generateTestPointPlan(input: {
  config: AiModelConfig;
  prompt: string;
  appId: string;
  platform: PageAssetPlatform;
  intentKind: TestIntentKind;
  externalContext?: ScriptFlowExternalContext;
  fetchImpl?: AiClientFetch;
}): Promise<TestPointPlanDraft>;
```

实现细节：

```ts
const RESPONSE_FIELDS = new Set(["status", "clarification", "plan"]);
const PLAN_FIELDS = new Set(["version", "intentKind", "summary", "assumptions", "points"]);
const POINT_FIELDS = new Set([
  "id", "title", "category", "priority", "rationale", "preconditions", "actions", "expectedResults"
]);
const MAX_POINTS = 12;

function validateReadyPlan(value: Record<string, unknown>): TestPointPlan {
  assertKnownFields(value, RESPONSE_FIELDS, "AI test point response");
  const plan = record(value.plan, "plan");
  assertKnownFields(plan, PLAN_FIELDS, "test point plan");
  const points = stringRecordArray(plan.points, "plan.points").map(validatePoint);
  if (points.length < 1 || points.length > MAX_POINTS) {
    throw new Error(`plan.points must contain 1-${MAX_POINTS} test points`);
  }
  const ids = new Set<string>();
  for (const point of points) {
    if (ids.has(point.id)) throw new Error(`duplicate test point id: ${point.id}`);
    ids.add(point.id);
  }
  return {
    version: 1,
    intentKind: intentKindValue(plan.intentKind),
    summary: requiredString(plan.summary, "plan.summary"),
    assumptions: stringArray(plan.assumptions, "plan.assumptions"),
    points
  };
}
```

`validatePoint` 必须拒绝非 `kebab-case` ID、未知分类、未知优先级、空 `actions` 或空 `expectedResults`。使用现有 `runAiJsonRequest`，用 `isCodexAppServerProvider` 计算 channel；AI 未启用时抛出现有一致的“AI 配置不完整 / AI 生成未启用”错误。

- [ ] **步骤 4: 运行测试以验证其通过**

运行：

```bash
pnpm vitest run platform/apps/server/src/test-point-ai-planner.test.ts
```

预期：通过，且 parser 对非法字段、重复 ID、无执行动作和无预期结果均返回明确错误。

- [ ] **步骤 5: 提交代码**

```bash
git add platform/apps/server/src/test-point-ai-planner.ts \
  platform/apps/server/src/test-point-ai-planner.test.ts
git commit -m "feat: add AI test point planner"
```

### 任务 3: 暴露测试点规划 HTTP API

**文件：**
- 创建：`platform/apps/server/src/test-point-ai-api.ts`
- 创建：`platform/apps/server/src/test-point-ai-api.test.ts`

- [ ] **步骤 1: 编写失败的路由测试**

创建 `platform/apps/server/src/test-point-ai-api.test.ts`：

```ts
it("normalizes a bug test-point planning request", async () => {
  const generatePlan = vi.fn().mockResolvedValue({
    status: "needs_clarification",
    clarification: "请补充修复后的预期表现",
    channel: "codex",
    model: "planner"
  });
  const { baseUrl } = await startTestPointApi(generatePlan);

  const response = await fetch(`${baseUrl}/api/test-point-plans/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "网络恢复后列表一直 loading",
      appId: "cn.eeo.classin",
      scriptPlatform: "harmony",
      intentKind: "bug",
      generationContext: { mode: "asset_enhanced", useAssetsForGeneration: true }
    })
  });

  expect(response.status).toBe(200);
  expect(generatePlan).toHaveBeenCalledWith({
    prompt: "网络恢复后列表一直 loading",
    appId: "classin",
    platform: "harmony",
    intentKind: "bug",
    generationContext: {
      mode: "asset_enhanced",
      useCurrentScreen: false,
      useAssetsForGeneration: true,
      useHistoryScriptsForGeneration: false
    }
  });
});

it("rejects screen assist and unknown test-point planning fields", async () => {
  const { baseUrl } = await startTestPointApi(vi.fn());

  const response = await fetch(`${baseUrl}/api/test-point-plans/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "验证首页",
      appId: "classin",
      intentKind: "smoke",
      screenAssist: { mode: "current", deviceSerial: "device-1" }
    })
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Unknown request field: screenAssist" });
});
```

- [ ] **步骤 2: 运行测试以验证其失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/test-point-ai-api.test.ts
```

预期：失败，提示找不到 `test-point-ai-api.js`。

- [ ] **步骤 3: 实现严格的请求解析与路由**

创建 `platform/apps/server/src/test-point-ai-api.ts`：

```ts
export type TestPointPlanGenerator = (input: {
  prompt: string;
  appId: string;
  platform: PageAssetPlatform;
  intentKind: TestIntentKind;
  generationContext: ScriptFlowGenerationContextPolicy;
}) => Promise<TestPointPlanDraft>;

export function registerTestPointAiRoutes(
  app: express.Application,
  deps: { generatePlan: TestPointPlanGenerator }
): void {
  app.post("/api/test-point-plans/generate", async (req, res) => {
    try {
      const body = strictBody(req.body);
      const plan = await deps.generatePlan({
        prompt: requiredString(body.prompt, "prompt"),
        appId: normalizeTargetAppId(requiredString(body.appId, "appId")),
        platform: platformValue(body.scriptPlatform ?? body.platform),
        intentKind: intentKindValue(requiredString(body.intentKind, "intentKind")),
        generationContext: generationContextValue(body.generationContext)
      });
      res.json({ plan });
    } catch (error) {
      const status = error instanceof TestPointAiApiError ? error.status : 422;
      res.status(status).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });
}
```

`strictBody` 只允许 `prompt`、`appId`、`platform`、`scriptPlatform`、`intentKind`、`generationContext`。复制现有 ScriptFlow API 的平台和 generation context 语义，但固定 `useCurrentScreen: false`；当请求中 `generationContext.useCurrentScreen === true` 时返回 400：

```ts
throw new TestPointAiApiError(
  400,
  "test-point planning does not support generationContext.useCurrentScreen"
);
```

- [ ] **步骤 4: 运行测试以验证其通过**

运行：

```bash
pnpm vitest run platform/apps/server/src/test-point-ai-api.test.ts
```

预期：通过，确认 App ID、平台、意图和生成上下文均被归一化。

- [ ] **步骤 5: 提交代码**

```bash
git add platform/apps/server/src/test-point-ai-api.ts \
  platform/apps/server/src/test-point-ai-api.test.ts
git commit -m "feat: expose test point planning API"
```

### 任务 4: 在 Server composition root 中接线并复用代码上下文

**文件：**
- 修改：`platform/apps/server/src/index.ts:65-203`
- 测试：`platform/apps/server/src/test-point-ai-api.test.ts`

- [ ] **步骤 1: 增加一个失败的依赖注入行为测试**

在 `platform/apps/server/src/test-point-ai-api.test.ts` 添加一项调用级测试：`asset_enhanced` 上下文会作为 `externalContext` 传给 `generateTestPointPlan`，`strict` 不会传入它。测试使用 `generatePlan` 注入函数，不需要启动真实代码检索服务。

```ts
expect(generatePlan).toHaveBeenLastCalledWith(expect.objectContaining({
  generationContext: expect.objectContaining({ mode: "asset_enhanced" }),
  externalContext: expect.objectContaining({ source: "classin-code" })
}));
```

- [ ] **步骤 2: 运行测试以验证其失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/test-point-ai-api.test.ts
```

预期：失败，因为 `TestPointPlanGenerator` 尚未接受 `externalContext`。

- [ ] **步骤 3: 扩展生成器输入并注册路由**

将 `TestPointPlanGenerator` 输入和新 API 依赖扩展为：

```ts
externalContext?: ScriptFlowExternalContext;
```

在 `platform/apps/server/src/index.ts` 中导入并注册：

```ts
import { registerTestPointAiRoutes } from "./test-point-ai-api.js";
import { generateTestPointPlan } from "./test-point-ai-planner.js";

registerTestPointAiRoutes(app, {
  generatePlan: async ({ prompt, appId, platform, intentKind, generationContext }) => {
    const config = resolveAiModelConfig(process.env, storage.getAiModelSettings());
    const externalContext = generationContext.mode === "asset_enhanced"
      ? await classInCodeContextProvider({ prompt, appId, platform })
      : undefined;
    return generateTestPointPlan({
      config,
      prompt,
      appId,
      platform,
      intentKind,
      ...(externalContext ? { externalContext } : {})
    });
  }
});
```

不要为测试点规划读取截图、UI hierarchy 或 OCR。当前屏幕只属于后续 ScriptFlow 落地阶段，避免在抽象范围规划时将偶然可见页面状态误认为全局业务事实。

- [ ] **步骤 4: 运行测试以验证其通过**

运行：

```bash
pnpm vitest run platform/apps/server/src/test-point-ai-api.test.ts \
  platform/apps/server/src/test-point-ai-planner.test.ts
```

预期：通过。

- [ ] **步骤 5: 提交代码**

```bash
git add platform/apps/server/src/index.ts \
  platform/apps/server/src/test-point-ai-api.ts \
  platform/apps/server/src/test-point-ai-api.test.ts
git commit -m "feat: wire test point planning into server AI context"
```

### 任务 5: 在 AI 用例面板中添加测试点规划和单点生成

**文件：**
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx:283-446`
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx:993-1100`
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx`
- 修改：`platform/apps/dashboard/src/styles.css`

- [ ] **步骤 1: 为请求构建函数编写失败的测试**

在 `AiScriptFlowsPanel.test.tsx` 添加：

```ts
it("builds a bug test-point planning request without screen assist", () => {
  expect(buildTestPointPlanRequestBody({
    prompt: "恢复网络后课程列表一直 loading",
    appId: "classin",
    intentKind: "bug",
    useAssetEnhancedGeneration: true
  })).toEqual({
    prompt: "恢复网络后课程列表一直 loading",
    appId: "classin",
    intentKind: "bug",
    generationContext: {
      mode: "asset_enhanced",
      useCurrentScreen: false,
      useAssetsForGeneration: true,
      useHistoryScriptsForGeneration: true
    }
  });
});

it("adds the selected test point as structured ScriptFlow context", () => {
  const body = buildAiGenerateRequestBody({
    prompt: "验证课程列表",
    appId: "classin",
    useCurrentScreen: false,
    useAssetEnhancedGeneration: false,
    deviceSerial: "",
    selectedTestPoint: selectedPoint()
  });

  expect(body.externalContext).toEqual({
    source: "test-point-plan",
    summary: expect.stringContaining("网络恢复后课程列表结束加载"),
    candidateSteps: ["断开网络打开课程列表", "恢复网络"],
    constraints: ["只覆盖已确认测试点", "预期必须转换为可观察的 ScriptFlow 断言"]
  });
});
```

- [ ] **步骤 2: 运行测试以验证其失败**

运行：

```bash
pnpm vitest run platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx
```

预期：失败，提示 `buildTestPointPlanRequestBody` 不存在，且 `buildAiGenerateRequestBody` 不接受 `selectedTestPoint`。

- [ ] **步骤 3: 添加状态、请求和选择规则**

在 `AiScriptFlowsPanel.tsx`：

```ts
type TestPointPlanResponse = Extract<TestPointPlanDraft, { status: "ready" }>;

const [intentKind, setIntentKind] = useState<TestIntentKind>("manual");
const [testPointPlan, setTestPointPlan] = useState<TestPointPlanResponse>();
const [selectedTestPointId, setSelectedTestPointId] = useState<string>();
```

将 `busyAction` 扩展为：

```ts
"generate" | "plan" | "import" | "save" | "run" | "review" | "select" | "stepRun" | "runControl" | "repair"
```

实现：

```ts
async function planTestPoints() {
  if (!prompt.trim() || !appId.trim()) return;
  try {
    setBusyAction("plan");
    clearPanelOperationError();
    setTestPointPlan(undefined);
    setSelectedTestPointId(undefined);
    const response = await apiFetchJson<{ plan: TestPointPlanDraft }>("/api/test-point-plans/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildTestPointPlanRequestBody({
        prompt: prompt.trim(),
        appId: appId.trim(),
        intentKind,
        useAssetEnhancedGeneration
      }))
    });
    if (response.plan.status === "needs_clarification") {
      setMessage(response.plan.clarification);
      return;
    }
    setTestPointPlan(response.plan);
    setSelectedTestPointId(response.plan.plan.points[0]?.id);
    setMessage(`已拆解 ${response.plan.plan.points.length} 个测试点，请选择一个生成用例。`);
  } catch (error) {
    reportPanelOperationError("测试点拆解失败", error);
  } finally {
    setBusyAction(undefined);
  }
}
```

当 `prompt`、`intentKind` 或 `appId` 改变时，在它们的 `onChange` 处理器内清除 `testPointPlan` 和 `selectedTestPointId`，防止旧计划套用到新输入。生成成功、导入、保存或切换到 YAML 导入模式时也清除这两个状态。

- [ ] **步骤 4: 将选中的测试点传入既有 ScriptFlow 生成请求**

扩展现有请求构建函数：

```ts
export function buildAiGenerateRequestBody(input: {
  prompt: string;
  appId: string;
  revision?: CaseRevision;
  useCurrentScreen: boolean;
  useAssetEnhancedGeneration: boolean;
  deviceSerial: string;
  selectedTestPoint?: TestPoint;
}): Record<string, unknown> {
  const testPointContext = input.selectedTestPoint
    ? {
        externalContext: {
          source: "test-point-plan",
          summary: [
            `已确认测试点：${input.selectedTestPoint.title}`,
            `类型：${input.selectedTestPoint.category}`,
            `优先级：${input.selectedTestPoint.priority}`,
            `测试理由：${input.selectedTestPoint.rationale}`,
            `前置条件：${input.selectedTestPoint.preconditions.join("；")}`,
            `预期结果：${input.selectedTestPoint.expectedResults.join("；")}`
          ].join("\n"),
          candidateSteps: input.selectedTestPoint.actions,
          constraints: [
            "只覆盖已确认测试点",
            "预期必须转换为可观察的 ScriptFlow 断言"
          ]
        }
      }
    : {};
  // 保留原有 revision、新建、screenAssist 和 generationContext 分支，并在每个返回对象中展开 ...testPointContext。
}
```

`generate()` 调用时传入：

```ts
selectedTestPoint: testPointPlan?.plan.points.find((point) => point.id === selectedTestPointId)
```

- [ ] **步骤 5: 渲染测试意图和测试点列表**

在新建 AI 生成面板中、prompt 输入框之前增加四项分段控件：

```tsx
<div className="test-intent-selector" role="group" aria-label="测试依据">
  {([
    ["manual", "直接目标"],
    ["bug", "缺陷回归"],
    ["code", "代码逻辑"],
    ["smoke", "冒烟目标"]
  ] as const).map(([kind, label]) => (
    <button
      key={kind}
      type="button"
      className={intentKind === kind ? "selected" : ""}
      aria-pressed={intentKind === kind}
      disabled={busy}
      onClick={() => {
        setIntentKind(kind);
        setTestPointPlan(undefined);
        setSelectedTestPointId(undefined);
      }}
    >
      {label}
    </button>
  ))}
</div>
```

在“参考沉淀资产生成”开关后增加：

```tsx
<button
  className="secondary-button"
  type="button"
  onClick={() => void planTestPoints()}
  disabled={busy || !prompt.trim() || !appId.trim()}
>
  <FileSearch size={16} />
  <span>{busyAction === "plan" ? "拆解中" : "拆解测试点"}</span>
</button>
```

当 `testPointPlan` 存在时渲染单选列表；每项展示 title、category、priority、rationale、expectedResults。使用 `<input type="radio">` 或具备 `role="radio"` 的语义控件，禁止多选。选中项存在时，将生成按钮文本从“生成测试”改成“按选中测试点生成”。

为 Bug、代码和冒烟三种类型分别更新 placeholder：

```ts
const promptPlaceholder: Record<TestIntentKind, string> = {
  manual: "例如：启动 App，进入班级四十二号，打开新建课堂，填写课堂名称但不要发布",
  bug: "例如：恢复网络后课程列表持续加载，修复后应正常显示内容或空态",
  code: "例如：根据课程详情刷新后的状态更新逻辑生成冒烟验证",
  smoke: "例如：验证教师创建课堂后可在课堂列表看到该课堂"
};
```

- [ ] **步骤 6: 添加局部 CSS**

在 `styles.css` 添加紧凑、可扫描的样式，复用现有按钮色板；不要使用卡片嵌套：

```css
.test-intent-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.test-intent-selector button,
.test-point-option {
  border: 1px solid var(--border-color);
  background: var(--surface);
  color: var(--text-muted);
}

.test-intent-selector button.selected,
.test-point-option.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.test-point-list {
  display: grid;
  gap: 8px;
}
```

用仓库中真实 CSS 变量替换示例变量名；移动端将测试点的 priority 与 category 排到标题下一行，避免文本挤压。

- [ ] **步骤 7: 运行 Dashboard 测试以验证其通过**

运行：

```bash
pnpm vitest run platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx
```

预期：通过；新增测试确认规划请求不含 screen assist，选中测试点以 `test-point-plan` 上下文传给既有生成 API。

- [ ] **步骤 8: 提交代码**

```bash
git add platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx \
  platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx \
  platform/apps/dashboard/src/styles.css
git commit -m "feat: plan test points before generating ScriptFlow"
```

### 任务 6: 更新产品文档并执行回归验收

**文件：**
- 修改：`docs/product/mobile-automation-platform/README.md:7-12`
- 测试：现有 `platform/**/*.test.ts` 与 `platform/**/*.test.tsx`

- [ ] **步骤 1: 更新产品边界说明**

在 ScriptFlow 边界说明后加入：

```md
- AI 用例生成前可选执行“测试点规划”：将 Bug 描述、代码逻辑、冒烟目标或普通测试目标拆成用户选择的原子测试点。测试点规划为临时草稿，不是用例事实来源；用户选择一个测试点后，系统才生成对应 ScriptFlow 草稿并继续走既有试运行、修复和保存门禁。
```

- [ ] **步骤 2: 运行新增模块的窄测试**

运行：

```bash
pnpm vitest run \
  platform/apps/server/src/test-point-ai-planner.test.ts \
  platform/apps/server/src/test-point-ai-api.test.ts \
  platform/apps/server/src/script-flow-ai-api.test.ts \
  platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx
```

预期：全部通过。

- [ ] **步骤 3: 执行完整回归**

运行：

```bash
pnpm test
```

预期：`lint` 和全部 Vitest 测试通过。

- [ ] **步骤 4: 进行手工 UI 验收**

运行：

```bash
pnpm dev
```

在浏览器打开 `https://localhost:5173`，按以下顺序验证：

1. 打开“AI 生成测试”，选择“缺陷回归”，填写一条 Bug 描述并点击“拆解测试点”。
2. 确认页面显示单选测试点列表，切换选择后生成按钮显示“按选中测试点生成”。
3. 点击生成，确认 AI ScriptFlow 草稿进入现有步骤审查界面，不自动保存或激活。
4. 对草稿执行 trial，确认现有 `needs_trial -> verified` 或失败 repair 流程未改变。
5. 选择“代码逻辑”并开启“参考沉淀资产生成”，确认请求完成；关闭该开关后，确认严格模式下不会注入 ClassIn 代码上下文。
6. 选择“直接目标”并直接点击“生成测试”，确认原有流程无需先拆解测试点。

- [ ] **步骤 5: 提交文档**

```bash
git add docs/product/mobile-automation-platform/README.md
git commit -m "docs: describe optional test point planning"
```

## 后续独立项目（不包含在本方案）

以下能力需要新的持久化模型和单独验收，不能顺手塞进第一期：

1. `RequirementSet -> RequirementItem -> TestPoint -> ScriptFlow -> Run` 的持久化追溯链。
2. 文档上传、PDF/Word/Excel 解析、页码/段落级引用和版本对比。
3. 需求覆盖率、未覆盖测试点、失效 ScriptFlow 和报告矩阵。
4. 多选测试点批量生成并管理多个草稿。
5. 将 Run 失败、人工评审和修复补丁回写为测试点质量状态。

## 自我审查

- 规范覆盖：Bug、代码、冒烟和直接目标均通过 `TestIntentKind` 覆盖；不改变 ScriptFlow、Runner、trial、repair、report 的事实来源与执行语义。
- YAGNI：第一期不建表、不迁移 SQLite、不增加批量生成、不改报告模型。
- 类型一致性：`TestPointPlanDraft` 由 shared 包提供；server 只创建临时 DTO，Dashboard 只以 DTO 选择单个 `TestPoint`。
- 门禁一致性：生成后的 ScriptFlow 仍使用现有 `needs_trial / verified / blocked`，测试点规划不具备自动激活能力。
