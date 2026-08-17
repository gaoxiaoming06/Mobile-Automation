# ScriptFlow 生成上下文开关与执行边界实现方案

> 日期：2026-08-14
> 关联需求：`docs/superpowers/plans/2026-08-14-scriptflow-generation-context-policy.md`

## 目标

把 ScriptFlow 的“生成时是否参考沉淀资产/历史脚本”和“执行时严格按脚本执行”拆成两条独立边界：

1. 生成阶段默认严格模式，只按用户文字、结构化脚本 schema、显式开启的当前屏幕辅助生成。
2. 生成阶段只有在用户打开“参考沉淀资产/历史脚本”开关时，才读取 PageAsset、NavigationEntry、历史脚本等上下文。
3. 执行阶段不读取 PageAsset、InteractionAsset、NavigationEntry、历史脚本；执行器只消费 ScriptFlow 脚本和实时设备状态。
4. 学习沉淀可以继续写入资产，但写入结果不能在用户未开启增强生成时影响下一次生成，更不能影响执行器。

## 当前代码切入点

- 生成入口：
  - `platform/apps/server/src/script-flow-ai-api.ts`
  - `platform/apps/server/src/index.ts`
  - `platform/apps/server/src/script-flow-ai-planner.ts`
  - `platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx`
- 执行资产依赖入口：
  - `platform/apps/server/src/script-flow-api.ts`
  - `platform/apps/server/src/script-flow-runner.ts`
  - `platform/apps/server/src/script-target-resolver.ts`
- 共享类型：
  - `platform/packages/shared/src/index.ts`
- 测试：
  - `platform/apps/server/src/script-flow-ai-api.test.ts`
  - `platform/apps/server/src/script-flow-ai-planner.test.ts`
  - `platform/apps/server/src/script-flow-api.test.ts`
  - `platform/apps/server/src/script-flow-runner.test.ts`
  - `platform/apps/server/src/script-target-resolver.test.ts`
  - `platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx`

## 实现顺序

### 1. 先定义生成上下文策略

在共享类型里增加生成策略，前端和 server 使用同一套字段。

文件：`platform/packages/shared/src/index.ts`

```ts
export type ScriptFlowGenerationMode = "strict" | "asset_enhanced";

export interface ScriptFlowGenerationContextPolicy {
  mode: ScriptFlowGenerationMode;
  useCurrentScreen: boolean;
  useAssetsForGeneration: boolean;
  useHistoryScriptsForGeneration: boolean;
}
```

归一化规则放在 server 侧，避免前端漏传导致行为不稳定。

文件：`platform/apps/server/src/script-flow-generation-context.ts`

```ts
import type { ScriptFlowGenerationContextPolicy } from "@mobile-automation/shared";

export const DEFAULT_GENERATION_CONTEXT_POLICY: ScriptFlowGenerationContextPolicy = {
  mode: "strict",
  useCurrentScreen: false,
  useAssetsForGeneration: false,
  useHistoryScriptsForGeneration: false,
};

export function normalizeGenerationContextPolicy(
  policy?: Partial<ScriptFlowGenerationContextPolicy>,
): ScriptFlowGenerationContextPolicy {
  if (!policy) {
    return DEFAULT_GENERATION_CONTEXT_POLICY;
  }
  if (policy.mode === "asset_enhanced") {
    return {
      mode: "asset_enhanced",
      useCurrentScreen: policy.useCurrentScreen === true,
      useAssetsForGeneration: policy.useAssetsForGeneration !== false,
      useHistoryScriptsForGeneration: policy.useHistoryScriptsForGeneration === true,
    };
  }
  return {
    mode: "strict",
    useCurrentScreen: policy.useCurrentScreen === true,
    useAssetsForGeneration: false,
    useHistoryScriptsForGeneration: false,
  };
}
```

验收点：

- 没传策略时是 strict。
- strict 模式强制关闭 assets/history，不接受前端误传 true。
- asset_enhanced 模式默认读取资产，但历史脚本仍需要显式 true。

### 2. API 接受策略并保持严格字段校验

文件：`platform/apps/server/src/script-flow-ai-api.ts`

允许请求体新增 `generationContext`，继续拒绝未声明的外层字段。

```ts
const allowedFields = new Set([
  "prompt",
  "appId",
  "platform",
  "scriptPlatform",
  "flowId",
  "expectedVersion",
  "screenAssist",
  "externalContext",
  "generationContext",
]);
```

生成调用传入归一化后的策略：

```ts
const generationContext = normalizeGenerationContextPolicy(body.generationContext);
const draft = await this.generator.generateDraft({
  prompt,
  appId,
  platform,
  existingFlow,
  screenAssist,
  externalContext,
  generationContext,
});
```

测试先写：

```ts
it("accepts generationContext and keeps strict as the default", async () => {
  await api.handleGenerateDraft({
    prompt: "点击消息",
    appId: "classin",
    generationContext: { mode: "strict", useAssetsForGeneration: true },
  });

  expect(generator.generateDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      generationContext: expect.objectContaining({
        mode: "strict",
        useAssetsForGeneration: false,
      }),
    }),
  );
});
```

验收点：

- 不再出现“AI 返回包含未允许外层字段”之外的请求字段误判。
- 前端可以明确发送生成策略。

### 3. 生成入口按策略决定是否读取资产

文件：`platform/apps/server/src/index.ts`

当前 server 生成入口会把 `pageCatalog`、`navigationEntries` 交给 planner。改成只在增强生成模式读取真实资产。

```ts
const generationContext = normalizeGenerationContextPolicy(request.generationContext);
const pageCatalogForGeneration = generationContext.useAssetsForGeneration
  ? pageCatalog
  : createEmptyPageAssetCatalog();
const navigationEntriesForGeneration = generationContext.useAssetsForGeneration
  ? navigationEntries
  : [];

return generateScriptFlowDraft({
  prompt,
  appId,
  platform,
  pageCatalog: pageCatalogForGeneration,
  navigationEntries: navigationEntriesForGeneration,
  ai,
  existingFlow,
  screenContext,
  externalContext,
  generationContext,
});
```

`createEmptyPageAssetCatalog()` 使用真实 `PageAssetCatalog` 接口的空实现，保证 planner 不需要判断 null。

```ts
export function createEmptyPageAssetCatalog(): PageAssetCatalog {
  return {
    listPages: () => [],
    findPage: () => undefined,
    listElements: () => [],
  };
}
```

测试先写：

```ts
it("does not read learned assets in strict generation mode", async () => {
  const pageCatalog = createThrowingPageCatalog();
  await generateScriptFlowDraft({
    prompt: "点击班级四十二号",
    appId: "classin",
    platform: "android",
    pageCatalog,
    navigationEntries: [learnedNavigationEntry()],
    ai,
    generationContext: { mode: "strict", useCurrentScreen: false, useAssetsForGeneration: false, useHistoryScriptsForGeneration: false },
  });
  expect(ai.completeJson).toHaveBeenCalled();
});
```

验收点：

- strict 模式下 PageAsset/NavigationEntry 读取方法被调用就会测试失败。
- asset_enhanced 模式下仍可读取资产，用于补强生成。

### 4. Planner 明确区分 strict 和 asset_enhanced

文件：`platform/apps/server/src/script-flow-ai-planner.ts`

输入类型增加 `generationContext`。

```ts
export interface GenerateScriptFlowDraftInput {
  prompt: string;
  appId: string;
  platform?: string;
  pageCatalog: PageAssetCatalog;
  navigationEntries?: NavigationEntry[];
  generationContext?: ScriptFlowGenerationContextPolicy;
  screenContext?: ScreenAssistContext;
  externalContext?: ScriptFlowAiExternalContext;
}
```

构建 prompt 时：

- strict：
  - 不注入已有页面、导航资产、历史脚本。
  - 不把用户没有说的页面前置条件或后置页面验证补进去。
  - 缺少必要定位信息时返回需要用户补充，而不是借资产猜。
- asset_enhanced：
  - 可以注入资产摘要。
  - 可以复用明确匹配用户描述的页面/导航/控件信息。
  - 需要在生成结果 metadata 记录“使用了增强上下文”。

核心判断：

```ts
const generationContext = normalizeGenerationContextPolicy(input.generationContext);
const canUseLearnedAssets = generationContext.useAssetsForGeneration;
const canUseHistoryScripts = generationContext.useHistoryScriptsForGeneration;
```

Prompt 规则补充：

```ts
const generationBoundaryRules = canUseLearnedAssets
  ? [
      "可以参考提供的资产和历史信息，但只能用于补全用户明确表达过的目标、路径或页面。",
      "不得因为资产里存在常见路径，就添加用户没有描述的业务步骤。",
    ]
  : [
      "不要使用沉淀资产、历史脚本、页面目录或导航知识。",
      "只按照用户当前描述生成动作。",
      "用户没有明确页面前置或页面结果时，不要生成 onPage 或 expectPage。",
      "缺少必要定位信息时，返回 needs_clarification。",
    ];
```

测试先写：

```ts
it("does not add onPage or expectPage in strict mode for action-only prompts", async () => {
  ai.completeJson.mockResolvedValue({
    title: "点击班级",
    appId: "classin",
    steps: [
      {
        id: "step-1",
        action: "tap",
        target: { text: "班级四十二号" },
        onPage: "class_list",
        expectPage: "class_detail",
      },
    ],
  });

  const draft = await generateScriptFlowDraft(strictInput("点击班级四十二号"));

  expect(draft.steps[0].onPage).toBeUndefined();
  expect(draft.steps[0].expectPage).toBeUndefined();
});
```

验收点：

- strict 模式默认不猜页面。
- asset_enhanced 模式可以参考资产，但必须有 provenance。

### 5. 前端加生成上下文开关

文件：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx`

当前已有“结合当前屏幕生成”，新增“参考沉淀资产/历史脚本”开关，默认关闭。

```tsx
const [useAssetEnhancedGeneration, setUseAssetEnhancedGeneration] = useState(false);
const [useHistoryScriptsForGeneration, setUseHistoryScriptsForGeneration] = useState(false);

const generationContext = {
  mode: useAssetEnhancedGeneration ? "asset_enhanced" : "strict",
  useCurrentScreen,
  useAssetsForGeneration: useAssetEnhancedGeneration,
  useHistoryScriptsForGeneration,
};
```

请求 payload：

```ts
const payload = {
  prompt,
  appId,
  platform,
  screenAssist: useCurrentScreen ? screenAssistPayload : undefined,
  generationContext,
};
```

UI 文案建议：

- 复选框：`参考沉淀资产生成`
- 辅助说明：`开启后会参考已学习的页面、控件和历史脚本；关闭时严格按当前描述生成。`
- 历史脚本复选框仅在资产增强开启后可用：`参考历史脚本`

测试先写：

```ts
it("sends strict generation context by default", async () => {
  render(<AiScriptFlowsPanel />);
  await user.type(screen.getByLabelText("测试目标或操作过程"), "点击消息");
  await user.click(screen.getByRole("button", { name: "生成测试" }));

  expect(fetchMock).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      body: expect.stringContaining('"mode":"strict"'),
    }),
  );
});
```

验收点：

- 默认关闭增强。
- 开启增强后 payload 清晰可见。
- 历史脚本不再默认参与生成。

### 6. 去掉执行器对 InteractionAsset 的读取和绑定

这是边界最重要的一步。执行阶段只消费脚本，不消费学习资产。

文件：`platform/apps/server/src/script-flow-api.ts`

当前 `compileSnapshot()` 会调用 `freezeInteractionAssets()`，并把结果传给 runner。改成不读取 `listInteractionAssets`。

```ts
async function compileSnapshot(...) {
  const plan = compileScriptFlowPlan(document, parameters);
  return {
    plan,
    planDigest: digestPlan(plan),
    dependencies,
    interactionAssets: [],
    navigationIndex,
  };
}
```

然后删除或停止调用：

```ts
freezeInteractionAssets(...)
```

测试先写：

```ts
it("does not read interaction assets when previewing or starting a run", async () => {
  const storage = createStorage({
    listInteractionAssets: async () => {
      throw new Error("executor must not read learned interaction assets");
    },
  });

  await api.preview(flowId, request);
  await api.startRun(flowId, request);
});
```

文件：`platform/apps/server/src/script-flow-runner.ts`

移除 runner 入参里的 `interactionAssets`，不再构建 `interactionAssetMap`，执行 metadata 不再写 `interactionAsset`。

```ts
await runner.start({
  flowId,
  runId,
  plan,
  device,
  app,
});
```

文件：`platform/apps/server/src/script-target-resolver.ts`

移除：

```ts
if (input.interactionAsset) {
  return this.resolveInteractionAsset(input, input.interactionAsset);
}
```

并删除 `resolveInteractionAsset()` 相关分支。

验收点：

- preview/run 不调用 `storage.listInteractionAssets`。
- runner 不接受资产绑定。
- target resolver 不存在资产优先分支。
- 旧脚本里如果只有标准 target，就继续执行；如果依赖旧 asset binding，直接按标准校验失败即可。

### 7. 保留学习写入，但明确它不驱动执行

学习沉淀逻辑可以继续运行，用于未来增强生成或资产管理。

需要检查文件：

- `platform/apps/server/src/script-flow-asset-learning.ts`
- `platform/apps/server/src/script-flow-learning-service.ts`
- `platform/apps/server/src/script-flow-runner.ts`

改动原则：

```ts
// after run
await learningService.recordRunOutcome({
  run,
  plan,
  observations,
});
```

但不要把学习产物回灌给本次执行器，也不要让下一次 strict generation 读取。

测试先写：

```ts
it("can write learned assets after a run without changing strict generation", async () => {
  await learningService.recordRunOutcome(successfulRun);
  const draft = await generateScriptFlowDraft(strictInput("点击消息"));

  expect(draft.sourceSnapshot?.generationContext.mode).toBe("strict");
  expect(draft.sourceSnapshot?.usedAssets).toEqual([]);
});
```

验收点：

- 学习写入仍可发生。
- strict 生成结果不包含资产 provenance。
- 执行器没有学习资产输入。

### 8. sourceSnapshot 记录生成来源

文件：

- `platform/packages/shared/src/index.ts`
- `platform/apps/server/src/script-flow-ai-planner.ts`

给草稿/保存后的脚本记录生成策略和资产使用情况。

```ts
export interface ScriptFlowSourceSnapshot {
  prompt: string;
  generatedAt: string;
  generationContext: ScriptFlowGenerationContextPolicy;
  usedAssets: Array<{
    type: "page" | "navigation" | "history_script";
    id: string;
    version?: number;
  }>;
}
```

strict 模式：

```ts
sourceSnapshot: {
  prompt,
  generatedAt,
  generationContext,
  usedAssets: [],
}
```

asset_enhanced 模式：

```ts
sourceSnapshot.usedAssets = collectUsedAssetReferences(aiResult, plannerContext);
```

验收点：

- 用户能知道某个脚本是否参考过沉淀资产。
- 执行报告里不需要再展示“本次执行使用了资产”，因为执行不使用资产。

### 9. 错误提示改成可见的面板错误

文件：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx`

当前错误只在顶部一行状态里出现，点击执行失败不明显。统一做成右侧内容区的错误卡片，并保留顶部简短状态。

```tsx
{error ? (
  <div role="alert" className="script-flow-error-panel">
    <div className="script-flow-error-title">生成失败</div>
    <div className="script-flow-error-message">{error.message}</div>
    <button onClick={() => setError(null)}>关闭错误提示</button>
  </div>
) : null}
```

执行失败也复用同一套组件：

```tsx
setRunError({
  title: "执行失败",
  message: normalizeErrorMessage(error),
  reportUrl,
});
```

测试先写：

```ts
it("shows a visible alert when execution fails", async () => {
  await user.click(screen.getByRole("button", { name: "执行" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("执行失败");
});
```

验收点：

- 生成失败、执行失败都在主内容区域明显展示。
- 顶部状态只做摘要，不作为唯一错误反馈。

### 10. 回归命令

先跑定向测试：

```bash
pnpm --filter @mobile-automation/server test -- script-flow-ai-api.test.ts script-flow-ai-planner.test.ts script-flow-api.test.ts script-flow-runner.test.ts script-target-resolver.test.ts
pnpm --filter @mobile-automation/dashboard test -- AiScriptFlowsPanel.test.tsx
```

再跑 lint：

```bash
pnpm lint
```

如果定向测试和 lint 通过，再根据耗时决定是否跑全量 unit：

```bash
pnpm test
```

## 分阶段落地建议

第一阶段先做执行边界：

1. 去掉 `compileSnapshot()` 的 `freezeInteractionAssets()`。
2. 去掉 runner/target resolver 的 `interactionAsset` 入口。
3. 加 preview/run 不读取资产的测试。

这样可以先保证“执行器严格按脚本执行”。

第二阶段做生成开关：

1. 增加 `generationContext` 类型和 API。
2. 前端默认 strict。
3. planner strict 模式隔离资产。

这样可以保证“生成阶段是否参考资产”由用户显式控制。

第三阶段再恢复增强生成能力：

1. asset_enhanced 模式注入资产摘要。
2. 记录 `sourceSnapshot.usedAssets`。
3. 历史脚本单独受 `useHistoryScriptsForGeneration` 控制。

这样学习沉淀逻辑可以继续建设，但不会默认污染普通生成和执行。

## 需要避免的实现方式

- 不在执行器里按 appId/pageId/resourceId 去查沉淀资产。
- 不把 PageAsset/InteractionAsset 编译进 runnable plan。
- 不靠“用户没提页面就删除 onPage”这种单点特例作为唯一保障；严格模式应该从上下文隔离、prompt 规则、postprocess 校验三层一起保证。
- 不让历史脚本默认参与生成。
- 不让“结合当前屏幕生成”和“参考沉淀资产生成”混成同一个开关。

## 交付标准

- 默认生成同一句“点击班级四十二号”，不会因为资产里有班级列表页/班级详情页而自动生成 `onPage` 或 `expectPage`。
- 开启“参考沉淀资产生成”后，生成可以使用资产，但必须在 `sourceSnapshot` 记录来源。
- 执行同一个脚本时，无论资产库有没有数据，执行行为一致。
- 删除或改动沉淀资产，不会影响已保存脚本的执行结果。
- 学习沉淀写入失败，不影响脚本执行成败。
