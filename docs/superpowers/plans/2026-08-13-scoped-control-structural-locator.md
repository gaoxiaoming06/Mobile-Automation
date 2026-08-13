# Scoped Control Structural Locator 实现方案

> **对于智能体：** 必需子技能：使用 superpowers:subagent-driven-development (推荐) 或 superpowers:executing-plans 来逐个任务执行此方案。步骤使用复选框 (`- [ ]`) 语法进行进度追踪。

**目标：** 让 ScriptFlow 用跨平台的 `control + scope + role/ordinal` 描述消息输入器、面板集合和工具按钮，并在执行时动态解析到当前平台的可点击目标，替代不可执行的自由文本 `visual.query`。

**架构：** 脚本层只保留稳定语义；`script-target-resolver` 把结构化目标编译为 `structuralLocator.strategy = "scoped_control"`；`semantic-locator` 在运行时根据 UI hierarchy、OCR、截图视觉候选在当前页面动态寻找 scope 和 scope 内控件。ClassIn 当前聊天输入区只能作为测试样例，不能写成页面标题、具体班级名或单一 resource-id 特例。

**技术栈：** TypeScript、Vitest、ScriptFlow YAML schema、Android UIAutomator hierarchy、OCR layout、现有 `SemanticStepResolver`。

---

## 文件结构

- 修改 `platform/packages/script-flow/src/types.ts`：扩展 ScriptFlow 目标类型。
- 修改 `platform/packages/script-flow/src/parser.ts`：解析和校验 `scope`、`role`、`selection`。
- 修改 `platform/packages/script-flow/src/parser.test.ts`：覆盖新 schema。
- 修改 `platform/packages/script-flow/src/compiler.test.ts`：覆盖 YAML 到文档模型。
- 修改 `platform/apps/server/src/script-target-resolver.ts`：把 scoped control 编译成 runtime structural locator。
- 修改 `platform/apps/server/src/script-target-resolver.test.ts`：验证 resolver 输出参数。
- 修改 `platform/apps/server/src/semantic-locator.ts`：增加 `scoped_control` 运行时定位分支。
- 修改 `platform/apps/server/src/semantic-locator.test.ts`：覆盖 message composer、emoji panel、keyboard toolbar 三类状态。
- 修改 `platform/apps/server/src/script-flow-ai-planner.ts`：生成约束从自由 `visual.query` 收敛到 typed target。
- 修改 `platform/apps/server/src/script-flow-ai-planner.test.ts`：保证表情入口、表情项、发送按钮不再生成自由 visual query。
- 修改 `docs/product/mobile-automation-platform/spec/script-flow-v1.md`：更新脚本语义合同。

## 设计约束

- 不能写死“班级四十二号”、当前截图中的坐标、当前用户 prompt 文本。
- 不能把 Android `resource-id` 写入 ScriptFlow 用例脚本。
- `resource-id` 只能作为运行时候选证据之一，后续可以降权或替换。
- `scope=messageComposer` 表示“包含输入框、工具按钮和发送入口的输入组合容器”，不表示固定底部区域。
- `scope=emojiPanel` 表示“当前可见的表情集合面板”，不表示固定屏幕下半区。
- 点击后需要用状态变化或目标可见性做校验，避免误点。

## 任务 1: 扩展 ScriptFlow 目标 schema

**文件：**
- 修改：`platform/packages/script-flow/src/types.ts`
- 修改：`platform/packages/script-flow/src/parser.ts`
- 测试：`platform/packages/script-flow/src/parser.test.ts`
- 测试：`platform/packages/script-flow/src/compiler.test.ts`

- [ ] **步骤 1: 编写失败的 parser 测试**

在 `platform/packages/script-flow/src/parser.test.ts` 添加：

```ts
it("accepts a scoped icon button target inside a message composer", () => {
  const flow = parseScriptFlow(`
version: 1
name: open composer emoji panel
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-emoji-panel
    tap:
      target:
        control: iconButton
        scope: messageComposer
        role: emojiPickerEntry
      search: { mode: visibleOnly }
`);

  expect(flow.steps[0]).toMatchObject({
    tap: {
      target: {
        control: "iconButton",
        scope: "messageComposer",
        role: "emojiPickerEntry"
      },
      search: { mode: "visibleOnly" }
    }
  });
});

it("accepts a scoped collection item target inside an emoji panel", () => {
  const flow = parseScriptFlow(`
version: 1
name: pick emoji
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: pick-any-emoji
    tap:
      target:
        control: collectionItem
        scope: emojiPanel
        role: emojiItem
        selection: any
`);

  expect(flow.steps[0]).toMatchObject({
    tap: {
      target: {
        control: "collectionItem",
        scope: "emojiPanel",
        role: "emojiItem",
        selection: "any"
      }
    }
  });
});
```

- [ ] **步骤 2: 运行测试以验证失败**

运行：

```bash
pnpm test:unit platform/packages/script-flow/src/parser.test.ts
```

预期：失败，提示 `control` 不支持 `iconButton` 或 `target.scope` / `target.role` / `target.selection` 是 unknown field。

- [ ] **步骤 3: 修改类型定义**

在 `platform/packages/script-flow/src/types.ts` 调整：

```ts
export type ScriptTargetControl = "checkbox" | "switch" | "textField" | "iconButton" | "submitButton" | "collectionItem";

export type ScriptTargetScope = "messageComposer" | "emojiPanel" | "attachmentPanel" | "keyboardToolbar";

export type ScriptTargetSelection = "any" | "first";

export type ScriptTarget = {
  text?: string;
  icon?: string;
  visual?: ScriptVisualTarget;
  control?: ScriptTargetControl;
  area?: ScriptTargetArea;
  position?: ScriptTargetPosition;
  nearText?: string;
  scopeText?: string;
  scope?: ScriptTargetScope;
  role?: string;
  ordinal?: number;
  selection?: ScriptTargetSelection;
  anchorText?: string;
  relation?: ScriptTargetRelation;
  checked?: boolean;
  match?: "contains" | "exact" | "semantic";
};
```

- [ ] **步骤 4: 修改 parser 字段白名单和校验**

在 `platform/packages/script-flow/src/parser.ts` 的 `targetFields` 中加入：

```ts
"scope", "role", "selection"
```

在读取 `control` 的逻辑中允许：

```ts
const allowedControls = new Set(["checkbox", "switch", "textField", "iconButton", "submitButton", "collectionItem"]);
```

新增 scoped control 校验：

```ts
const scopedControls = new Set(["iconButton", "submitButton", "collectionItem"]);
if (result.control && scopedControls.has(result.control)) {
  if (!result.scope) {
    issues.push({ path, message: `${result.control} targets require scope` });
  }
  if (!result.role && !result.ordinal && !result.selection) {
    issues.push({ path, message: `${result.control} targets require role, ordinal, or selection` });
  }
}
if (result.selection && result.selection !== "any" && result.selection !== "first") {
  issues.push({ path: `${path}.selection`, message: "selection must be any or first" });
}
```

- [ ] **步骤 5: 运行 parser/compiler 测试**

运行：

```bash
pnpm test:unit platform/packages/script-flow/src/parser.test.ts platform/packages/script-flow/src/compiler.test.ts
```

预期：通过。

## 任务 2: Resolver 编译 scoped control

**文件：**
- 修改：`platform/apps/server/src/script-target-resolver.ts`
- 测试：`platform/apps/server/src/script-target-resolver.test.ts`

- [ ] **步骤 1: 编写失败的 resolver 测试**

在 `platform/apps/server/src/script-target-resolver.test.ts` 添加：

```ts
it("resolves a message composer icon button into a scoped structural locator", () => {
  const resolver = new ScriptTargetResolver();

  expect(resolver.resolve({
    action: "tap",
    target: {
      control: "iconButton",
      scope: "messageComposer",
      role: "emojiPickerEntry"
    },
    search: { mode: "visibleOnly" }
  })).toMatchObject({
    type: "tap_on_image",
    strategy: "semantic_control",
    params: {
      locatorKind: "structural_locator",
      structuralLocator: {
        strategy: "scoped_control",
        scope: "messageComposer",
        control: "iconButton",
        role: "emojiPickerEntry"
      },
      searchMode: "visibleOnly",
      allowRegionFallback: false
    }
  });
});

it("resolves an emoji panel collection item into a scoped structural locator", () => {
  const resolver = new ScriptTargetResolver();

  expect(resolver.resolve({
    action: "tap",
    target: {
      control: "collectionItem",
      scope: "emojiPanel",
      role: "emojiItem",
      ordinal: 1
    }
  })).toMatchObject({
    type: "tap_on_image",
    strategy: "semantic_control",
    params: {
      locatorKind: "structural_locator",
      structuralLocator: {
        strategy: "scoped_control",
        scope: "emojiPanel",
        control: "collectionItem",
        role: "emojiItem",
        ordinal: 1
      },
      allowRegionFallback: false
    }
  });
});
```

- [ ] **步骤 2: 运行测试以验证失败**

运行：

```bash
pnpm test:unit platform/apps/server/src/script-target-resolver.test.ts
```

预期：失败，提示 scoped controls 还没有 resolver 分支。

- [ ] **步骤 3: 实现 resolver 分支**

在 `resolveSemanticControl` 中加入：

```ts
if (input.target.control === "iconButton" || input.target.control === "submitButton" || input.target.control === "collectionItem") {
  return this.resolveScopedControlTap(input);
}
```

新增方法：

```ts
private resolveScopedControlTap(input: ScriptTargetResolutionInput): ResolvedScriptTarget {
  if (input.action !== "tap") {
    throw new ScriptTargetResolutionError(`${input.target.control} targets do not support ${input.action}`);
  }
  if (!input.target.scope) {
    throw new ScriptTargetResolutionError(`${input.target.control} targets require scope`);
  }
  return {
    type: "tap_on_image",
    strategy: "semantic_control",
    params: {
      locatorKind: "structural_locator",
      structuralLocator: {
        strategy: "scoped_control",
        scope: input.target.scope,
        control: input.target.control,
        ...(input.target.role ? { role: input.target.role } : {}),
        ...(input.target.ordinal ? { ordinal: input.target.ordinal } : {}),
        ...(input.target.selection ? { selection: input.target.selection } : {})
      },
      ...searchParams(input.target, input.search),
      allowRegionFallback: false
    }
  };
}
```

- [ ] **步骤 4: 运行 resolver 测试**

运行：

```bash
pnpm test:unit platform/apps/server/src/script-target-resolver.test.ts
```

预期：通过。

## 任务 3: 执行层新增 scoped_control 定位

**文件：**
- 修改：`platform/apps/server/src/semantic-locator.ts`
- 测试：`platform/apps/server/src/semantic-locator.test.ts`

- [ ] **步骤 1: 编写失败的 message composer 测试**

在 `platform/apps/server/src/semantic-locator.test.ts` 添加测试，构造 Android hierarchy，包含：

```xml
<node resource-id="cn.eeo.classin:id/input_board" class="android.widget.LinearLayout" bounds="[0,1257][1080,2218]">
  <node resource-id="cn.eeo.classin:id/edit_input" class="android.widget.EditText" clickable="true" bounds="[108,1329][972,1449]" />
  <node resource-id="cn.eeo.classin:id/iv_input_face" class="android.widget.ImageView" clickable="true" bounds="[108,1497][204,1593]" />
  <node resource-id="cn.eeo.classin:id/iv_input_voice" class="android.widget.ImageView" clickable="true" bounds="[216,1497][312,1593]" />
  <node resource-id="cn.eeo.classin:id/iv_input_add" class="android.widget.ImageView" clickable="true" bounds="[324,1497][420,1593]" />
  <node resource-id="cn.eeo.classin:id/iv_send" class="android.widget.TextView" clickable="true" enabled="true" bounds="[876,1497][972,1593]" />
</node>
```

断言：

```ts
const outcome = await resolver.resolveIfNeeded({
  runId: "run-1",
  stepResultId: "step-result-1",
  serial: "device-1",
  deviceSize: { width: 1080, height: 2340 },
  step: semanticStep("tap_on_image", {
    locatorKind: "structural_locator",
    structuralLocator: {
      strategy: "scoped_control",
      scope: "messageComposer",
      control: "iconButton",
      role: "emojiPickerEntry"
    }
  })
});

expect(outcome).toMatchObject({
  supported: true,
  resolved: true,
  metadata: {
    type: "scoped_control_locator",
    scope: "messageComposer",
    control: "iconButton",
    role: "emojiPickerEntry",
    relocatedBy: "ui_hierarchy_scoped_control"
  }
});
expect(actions).toEqual([{ type: "tap", x: 156, y: 1545 }]);
```

- [ ] **步骤 2: 编写失败的 emoji panel collection 测试**

构造 hierarchy，包含：

```xml
<node resource-id="cn.eeo.classin:id/emotion_board" class="android.widget.RelativeLayout" bounds="[0,1665][1080,2218]">
  <node resource-id="cn.eeo.classin:id/emojicon_icon" class="android.widget.TextView" clickable="true" bounds="[84,1683][180,1779]" />
  <node resource-id="cn.eeo.classin:id/emojicon_icon" class="android.widget.TextView" clickable="true" bounds="[288,1683][384,1779]" />
</node>
```

断言 `ordinal: 1` 点击 `{ x: 132, y: 1731 }`。

- [ ] **步骤 3: 运行测试以验证失败**

运行：

```bash
pnpm test:unit platform/apps/server/src/semantic-locator.test.ts
```

预期：新测试失败，`resolveRuntimeStructuralTap` 要求 targetText。

- [ ] **步骤 4: 在 structural tap 入口插入 scoped_control 分支**

在 `resolveRuntimeStructuralTap` 开头读取：

```ts
const scopedControl = readScopedControlLocator(input.step.params.structuralLocator);
if (scopedControl) {
  return this.resolveRuntimeScopedControlTap(input, scopedControl);
}
```

新增读取函数：

```ts
function readScopedControlLocator(value: unknown): {
  strategy: "scoped_control";
  scope: string;
  control: string;
  role?: string;
  ordinal?: number;
  selection?: string;
} | undefined {
  const locator = readRecord(value);
  if (textParam(locator?.strategy).trim() !== "scoped_control") {
    return undefined;
  }
  const scope = textParam(locator.scope).trim();
  const control = textParam(locator.control).trim();
  if (!scope || !control) {
    return undefined;
  }
  const ordinal = positiveNumberParam(locator.ordinal);
  return {
    strategy: "scoped_control",
    scope,
    control,
    ...(textParam(locator.role).trim() ? { role: textParam(locator.role).trim() } : {}),
    ...(ordinal ? { ordinal: Math.floor(ordinal) } : {}),
    ...(textParam(locator.selection).trim() ? { selection: textParam(locator.selection).trim() } : {})
  };
}
```

- [ ] **步骤 5: 实现 UI hierarchy scoped control 解析**

新增方法骨架：

```ts
private async resolveRuntimeScopedControlTap(
  input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  },
  locator: ScopedControlLocator
): Promise<SemanticResolutionOutcome> {
  if (!this.deps.dumpUiHierarchy || !input.deviceSize) {
    return scopedControlFailure(locator, "ui_hierarchy_unavailable", "Scoped control locator requires UI hierarchy and device size.");
  }
  const candidates = parseAndroidUiHierarchy(await this.deps.dumpUiHierarchy(input.serial));
  const scope = findScopedControlContainer(candidates, locator, input.deviceSize);
  if (!scope) {
    return scopedControlFailure(locator, "scope_not_found", `Scope "${locator.scope}" was not found.`);
  }
  const target = findControlWithinScope(candidates, scope, locator, input.deviceSize);
  if (!target) {
    return scopedControlFailure(locator, "control_not_found", `Control "${locator.control}" was not found in scope "${locator.scope}".`);
  }
  const action = { type: "tap", x: target.bounds.centerX, y: target.bounds.centerY } satisfies DeviceActionRequest;
  const actionResult = normalizeActionResult(await this.performAction(input, action));
  return {
    supported: true,
    resolved: true,
    action,
    actionResult,
    message: `Resolved ${locator.scope}.${locator.role ?? locator.control} from UI hierarchy.`,
    artifacts: [],
    metadata: {
      type: "scoped_control_locator",
      action: "tap",
      ...pageTaskSemanticMetadata(input.step.params),
      scope: locator.scope,
      control: locator.control,
      role: locator.role,
      ordinal: locator.ordinal,
      selection: locator.selection,
      relocatedBy: "ui_hierarchy_scoped_control",
      scopeCandidate: summarizeUiElementCandidate(scope),
      candidate: summarizeUiElementCandidate(target),
      center: action,
      driverChannel: actionResult?.driverChannel
    }
  };
}
```

- [ ] **步骤 6: 实现通用 scope 和 control 评分**

实现原则：

```ts
function findScopedControlContainer(candidates, locator, deviceSize) {
  if (locator.scope === "messageComposer") {
    return candidates
      .filter(hasDescendantTextField)
      .filter(hasDescendantInteractiveIconOrSubmit)
      .filter(isInLowerInteractiveBandOrAboveOverlay)
      .sort(byComposerScore)[0];
  }
  if (locator.scope === "emojiPanel") {
    return candidates
      .filter(hasMultipleClickableCollectionItems)
      .filter(isBelowMessageComposerOrInLowerHalf)
      .sort(byCollectionPanelScore)[0];
  }
  if (locator.scope === "attachmentPanel") {
    return candidates
      .filter(hasGridLikeClickableItems)
      .filter(hasImageLikeOrTextLabelItems)
      .sort(byCollectionPanelScore)[0];
  }
  return undefined;
}
```

`findControlWithinScope` 规则：

```ts
function findControlWithinScope(candidates, scope, locator, deviceSize) {
  const inScope = candidates.filter((candidate) => rectContains(scope.bounds, candidate.bounds));
  const pool = inScope
    .filter((candidate) => candidate.clickable || candidate.focusable || candidate.longClickable)
    .filter((candidate) => controlTypeMatches(candidate, locator.control));
  const roleCandidates = pool
    .map((candidate) => ({ candidate, score: scopedControlRoleScore(candidate, locator, scope, deviceSize) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.bounds.centerX - right.candidate.bounds.centerX);
  if (locator.selection === "any" || locator.selection === "first") {
    return roleCandidates[0]?.candidate ?? pool.sort(readingOrder)[0];
  }
  if (locator.ordinal) {
    return (roleCandidates.length ? roleCandidates : pool.sort(readingOrder))[locator.ordinal - 1];
  }
  return roleCandidates[0]?.candidate;
}
```

Role aliases must be generic and reusable:

```ts
emojiPickerEntry: ["emoji", "emoticon", "face", "smile", "ivinputface", "inputface", "表情"]
voiceInput: ["voice", "mic", "microphone", "ivinputvoice", "语音"]
attachmentAdd: ["add", "plus", "attach", "attachment", "ivinputadd", "添加"]
sendMessage: ["send", "submit", "ivsend", "发送"]
emojiItem: ["emoji", "emojicon", "emojiconicon"]
```

- [ ] **步骤 7: 运行 semantic locator 测试**

运行：

```bash
pnpm test:unit platform/apps/server/src/semantic-locator.test.ts
```

预期：新增测试通过，旧测试不回归。

## 任务 4: 收紧 visualQuery 生成和预检

**文件：**
- 修改：`platform/apps/server/src/script-flow-ai-planner.ts`
- 测试：`platform/apps/server/src/script-flow-ai-planner.test.ts`
- 修改：`docs/product/mobile-automation-platform/spec/script-flow-v1.md`

- [ ] **步骤 1: 编写失败的 planner 测试**

在 `script-flow-ai-planner.test.ts` 添加：

```ts
it("asks AI to use scoped controls for composer buttons and panel items instead of free visual queries", () => {
  const prompt = buildScriptFlowPlannerPrompt(
    "打开消息输入区的表情面板，选择一个表情，然后发送",
    "classin",
    "android",
    buildScriptFlowPlannerCatalog(pageCatalog(), [], "classin", "android")
  );

  expect(prompt).toContain("messageComposer");
  expect(prompt).toContain("emojiPanel");
  expect(prompt).toContain("control: iconButton");
  expect(prompt).toContain("control: collectionItem");
  expect(prompt).toContain("不要把输入区工具按钮、发送按钮、面板集合项生成成自由 visual.query");
});
```

- [ ] **步骤 2: 修改 planner 指令**

在 `SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS` 中加入规则：

```text
当目标属于输入区工具按钮、发送按钮、表情面板项、更多面板项等稳定 UI 结构时，必须使用 target.control + target.scope + target.role/ordinal/selection。
例如表情入口使用 control: iconButton, scope: messageComposer, role: emojiPickerEntry。
例如任意表情使用 control: collectionItem, scope: emojiPanel, role: emojiItem, selection: any。
不要把这些目标生成成 visual.query；visual.query 只允许标准图标 role 或已确认视觉资产。
```

- [ ] **步骤 3: 更新 spec**

在 `script-flow-v1.md` 中加入：

```yaml
tap:
  target:
    control: iconButton
    scope: messageComposer
    role: emojiPickerEntry
```

并说明：

```text
scope 是语义容器，不是坐标区域。messageComposer 可随键盘、表情面板、附件面板动态移动。
```

- [ ] **步骤 4: 运行 planner 测试**

运行：

```bash
pnpm test:unit platform/apps/server/src/script-flow-ai-planner.test.ts
```

预期：通过。

## 任务 5: 端到端验证当前三个界面状态

**文件：**
- 测试：`platform/apps/server/src/semantic-locator.test.ts`
- 可选：新增 fixture helper 在同文件底部，沿用现有测试风格。

- [ ] **步骤 1: 增加三种状态测试**

三种 hierarchy fixture：

```text
状态 A: messageComposer + attachmentPanel
状态 B: messageComposer + emojiPanel
状态 C: messageComposer + keyboardToolbar + system keyboard
```

每种状态断言：

```ts
messageComposer 内 role=emojiPickerEntry 能定位。
messageComposer 内 role=attachmentAdd 能定位。
messageComposer 内 role=sendMessage 能定位或在 disabled 时明确失败。
emojiPanel 可见时 role=emojiItem + selection=any 能定位。
attachmentPanel 可见时 role=attachmentItem + ordinal=1 能定位。
```

- [ ] **步骤 2: 运行聚焦测试**

运行：

```bash
pnpm test:unit platform/apps/server/src/semantic-locator.test.ts -- --runInBand
```

预期：通过。

- [ ] **步骤 3: 运行相关测试集合**

运行：

```bash
pnpm test:unit \
  platform/packages/script-flow/src/parser.test.ts \
  platform/packages/script-flow/src/compiler.test.ts \
  platform/apps/server/src/script-target-resolver.test.ts \
  platform/apps/server/src/semantic-locator.test.ts \
  platform/apps/server/src/script-flow-ai-planner.test.ts
```

预期：通过。

## 任务 6: 验收与边界检查

**文件：**
- 修改：`docs/product/mobile-automation-platform/spec/script-flow-v1.md`

- [ ] **步骤 1: 执行类型检查**

运行：

```bash
pnpm -r typecheck
```

预期：通过。

- [ ] **步骤 2: 执行格式和空白检查**

运行：

```bash
git diff --check
```

预期：无输出。

- [ ] **步骤 3: 人工验证生成结果**

在开发环境里用“结合当前屏幕生成”输入：

```text
打开消息输入区的表情面板，选择一个表情，然后发送
```

预期 YAML 不包含：

```yaml
visual:
  query: 左下角表情符号
```

预期 YAML 包含：

```yaml
control: iconButton
scope: messageComposer
role: emojiPickerEntry
```

和：

```yaml
control: collectionItem
scope: emojiPanel
role: emojiItem
```

## 自我审查

- 规范覆盖率：已覆盖 schema、AI 生成、resolver、runtime locator、三种当前 UI 状态、visualQuery 收紧、文档。
- 占位符扫描：无 TBD、TODO、稍后实现。
- 类型一致性：`scope`、`role`、`selection` 在 types、parser、resolver、locator 中名称一致；runtime strategy 固定为 `scoped_control`。

