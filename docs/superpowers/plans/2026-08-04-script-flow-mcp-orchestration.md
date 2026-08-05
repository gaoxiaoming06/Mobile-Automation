# ScriptFlow MCP 对外编排实现方案

> **对于智能体：** 必需子技能：使用 superpowers:subagent-driven-development (推荐) 或 superpowers:executing-plans 来逐个任务执行此方案。步骤使用复选框 (`- [ ]`) 语法进行进度追踪。

**目标：** 对外提供一套真正可被外部 AI 调用的 MCP 能力：获取 ScriptFlow 规则、根据外部代码上下文生成确定脚本、预览冻结执行计划、跨 Android/iOS/Harmony 选择或校验真机、调起试运行或正式执行，并返回结构化结果与 HTML 报告。

**架构：** 复用现有 REST 能力作为唯一执行入口，`@mobile-automation/mcp-adapter` 负责 MCP 工具/资源协议、输入收敛、跨平台设备前置校验和结果摘要，不直接访问数据库或设备驱动。外部 AI 负责读取代码、本地目录或 classin-code MCP 并整理上下文；本系统 MCP 负责最终 ScriptFlow 生成、校验、预览、执行和报告。

**技术栈：** TypeScript、Node.js、MCP stdio server、Express REST adapter、Vitest、现有 ScriptFlow parser/compiler/runner/report-core。

## 当前实现状态

更新日期：2026-08-05。

已完成第一阶段外部 MCP 编排能力：

- `@mobile-automation/mcp-adapter` 增加 ScriptFlow authoring contract，并通过 `get_script_flow_authoring_contract` 和 `scriptflow://v1/authoring-contract` 暴露。
- MCP wrapper 已覆盖设备发现/预检、草稿生成、YAML 校验、草稿预览、草稿试运行、已保存用例预览/执行、等待终态、结构化报告和 outcome review。
- 新增 `generate_and_run_script_flow`，组合执行 `validate device -> generate draft -> preview -> trial run -> wait -> report`。
- 新增真正的 MCP stdio server：`platform/packages/mcp-adapter/src/server.ts`，通过 `MOBILE_AUTOMATION_SERVER_URL` 指向 REST 服务，默认 `http://127.0.0.1:4010`。
- `script-flow-ai-api` 已接受 `scriptPlatform` 和严格白名单的 `externalContext`。
- `script-flow-ai-planner` 已把外部代码上下文作为非权威生成线索写入 prompt，并继续禁止平台私有 selector、坐标、resource id。
- `docs/guides/script-flow-tools.md` 已更新 MCP 启动配置和推荐外部 AI 调用链。

本轮已执行的局部验收：

```bash
pnpm exec vitest run platform/packages/mcp-adapter/src/index.test.ts platform/packages/mcp-adapter/src/mcp-wrapper.test.ts platform/packages/mcp-adapter/src/server.test.ts platform/apps/server/src/script-flow-ai-api.test.ts platform/apps/server/src/script-flow-ai-planner.test.ts
pnpm --filter @mobile-automation/mcp-adapter typecheck
pnpm exec vitest run platform/apps/server/src/script-flow-api.test.ts platform/apps/server/src/script-flow-ai-api.test.ts platform/apps/server/src/script-flow-ai-planner.test.ts platform/packages/mcp-adapter/src/index.test.ts platform/packages/mcp-adapter/src/mcp-wrapper.test.ts platform/packages/mcp-adapter/src/server.test.ts
pnpm -r typecheck
```

后续未做：

- `save_script_flow` / `update_script_flow` 还未纳入 MCP。
- 还未做真实 MCP client 端到端握手测试。
- 还未跑全量 server 测试。

---

## 现状与去重结论

当前已有能力：

- `platform/packages/mcp-adapter` 已有工具定义和 handler，但只是库封装，还不是一个可直接被外部 AI 连接的 MCP stdio server。
- 已有 MCP 工具：`list_apps`、`list_page_assets`、`get_page_asset`、`list_script_flows`、`get_script_flow`、`generate_script_flow`、`preview_script_flow`、`run_script_flow`、`get_run`、`get_report`。这些工具仍缺少 `list_devices`、`validate_device`、草稿校验/预览/试运行和一站式 job。
- REST 已支持设备发现：`GET /api/devices`，并返回 Android、iOS、Harmony 设备的 `platform`、`status`、`capabilities`。
- REST 已支持草稿生成：`POST /api/script-flow-drafts/generate`。
- REST 已支持人工导入校验：`POST /api/script-flows/validate`。
- REST 已支持临时草稿预览与执行：`POST /api/script-flow-drafts/preview`、`POST /api/script-flow-drafts/trial-runs`、`POST /api/script-flow-drafts/runs`。
- REST 已支持已保存用例预览与执行：`POST /api/script-flows/:id/preview`、`POST /api/script-flows/:id/runs`。
- REST 已支持执行查询和报告：`GET /api/runs/:id`、`GET /api/script-flow-runs/:runId`、`GET /api/reports/:runId/html`。
- 合并 Harmony MVP 后，`MobileDriver` 已聚合 Android/iOS/Harmony driver，`@mobile-automation/harmony-driver` 已支持 hdc 设备发现、截图、点击、滑动、输入、启动/关闭 App、hilog 采集。
- `target-app-runtime.ts` 已把 `classin`、Android package、Harmony bundle 等别名归一到运行时 App 标识；`ScriptFlowRunner` 执行时会根据真实设备平台解析 runtime app identifier。
- ScriptFlow YAML 中 `app.platform` 已被 parser 当作 legacy 字段忽略，serializer 不会写出 `platform`。平台属于生成/保存/执行上下文，不属于脚本身份。

需要避免重复：

- 外部 AI 不应该直接成为最终 YAML 作者。它可以从代码、本地目录或 classin-code MCP 整理业务路径、页面名、入口、断言候选，作为 `externalContext` 或 `candidateSteps` 输入；最终 ScriptFlow 仍由本系统 planner 生成并由 parser/compiler 校验。
- “生成脚本规则的 MCP”和“生成确定脚本的 MCP”不是两套规则。规则应该以 `get_script_flow_authoring_contract` 工具和 `scriptflow://v1/authoring-contract` 资源暴露；生成工具读取同一份规则上下文。
- MCP 不新增一条绕过执行器的执行链路。所有执行必须走现有 `preview -> planDigest -> run` 契约。
- 外部 AI 不能让本系统自动确认业务结果。没有自动断言的试运行只能返回 `outcomeReviewRequired: true`、截图和报告；如果调用方是外部 AI，它可以基于证据自行判断，但本系统只记录调用方明确给出的 review 决策。

## 跨平台与设备契约

MCP 输入不能默认 Android。最新代码里有两层平台概念，文档和工具描述必须显式区分：

```ts
type DevicePlatform = "android" | "ios" | "harmony";
type ScriptPlatform = DevicePlatform | "flutter" | "mobile";
```

- `scriptPlatform` 用于生成、筛选页面资产、筛选 ScriptFlow 和保存用例元数据，对应现有 `ScriptFlowPlatform = android | ios | harmony | flutter | mobile`。其中 `mobile` 是跨端脚本范围，`flutter` 是 UI 技术栈/资产筛选范围，不是可连接设备平台。
- `devicePlatform` 用于真实设备选择和执行，只能是 `android | ios | harmony`。任何会触发真机动作的 MCP 工具都必须带 `devicePlatform` 或能从 `deviceSerial` 精确推断出设备平台。
- 保留兼容字段 `platform` 时，工具说明必须写清楚它在该工具中的含义：生成/列表工具里等同 `scriptPlatform`；设备校验/执行工具里等同 `devicePlatform`。新增一站式工具优先使用 `scriptPlatform` 和 `devicePlatform` 两个字段，避免歧义。
- `appId` 对外统一命名，允许传 `classin` 或实际平台标识。运行时通过 `target-app-runtime.ts` 解析到 Android package name、iOS bundle identifier、Harmony bundle name/app id。执行报告必须回显 `requestedApp`、`resolvedApp`、`scriptPlatform`、`executionPlatform` 和 `selectedDevice`。
- ScriptFlow YAML 只保留 `app.id`，不要把平台写成脚本身份。`app.platform` 目前只为兼容旧 YAML 被忽略；planner 和 serializer 都不应主动生成它。
- `deviceSerial` 可选。调用方指定时必须精确匹配同平台在线设备；不指定时，如果同平台在线设备恰好只有一台，可以自动选择并在结果里返回 `selectedDevice`；如果同平台在线设备为 0 台或多台，必须返回结构化错误。
- `generate_script_flow_draft` 可以离线生成，不强制要求设备。但只要使用 `screenAssist`、当前屏幕截图或一站式 `generate_and_run_script_flow`，就必须先做设备校验，并且 `screenAssist.deviceSerial` 的真实平台必须和请求的 `devicePlatform` 一致。
- `preview_script_flow_draft` 不需要设备。`run_script_flow_draft`、`run_script_flow` 和所有组合执行工具必须先调用同一套设备校验逻辑，失败时不能进入真实执行。

设备错误码统一为：

```ts
type DevicePreflightErrorCode =
  | "DEVICE_NOT_CONNECTED"
  | "DEVICE_OFFLINE"
  | "DEVICE_PLATFORM_MISMATCH"
  | "DEVICE_SELECTION_REQUIRED"
  | "PLATFORM_NOT_SUPPORTED_BY_RUNTIME";
```

错误返回至少包含：

```ts
{
  ok: false,
  error: {
    code: "DEVICE_NOT_CONNECTED",
    message: "未发现可用于 harmony 的在线设备，请连接设备后重试。",
    devicePlatform: "harmony",
    appId: "classin",
    requestedDeviceSerial: undefined,
    availableDevices: []
  }
}
```

## 推荐外部工作流

1. 外部 AI 调用 `get_script_flow_authoring_contract`，了解当前支持的动作、目标类型、平台枚举、限制和示例。
2. 外部 AI 根据它正在处理的仓库或任务确定 `scriptPlatform + devicePlatform + appId`，例如 Android 改动传 `devicePlatform: "android"`，Harmony 改动传 `devicePlatform: "harmony"`；如果脚本希望跨端复用，`scriptPlatform` 可以是 `mobile`。
3. 外部 AI 用本地代码、目录或 classin-code MCP 总结业务链路，形成 `externalContext`，不要输出最终可执行 YAML。
4. 外部 AI 调用 `generate_script_flow_draft`，输入 `goal + appId + scriptPlatform + externalContext`。如果使用当前屏幕辅助生成，还要传 `screenAssist.deviceSerial + devicePlatform`。
5. 如果返回 `needs_clarification`，外部 AI 自行补充更多上下文后重试；否则拿到 `sourceYaml`、`document`、参数定义和验证状态。
6. 外部 AI 调用 `preview_script_flow_draft`，拿到 `planDigest`、依赖、验证状态。
7. 外部 AI 调用 `validate_device` 或在 `run_script_flow_draft` 中让 adapter 隐式校验设备；无匹配在线设备、设备离线、平台不匹配或设备不唯一时直接返回设备错误，不执行脚本。
8. 外部 AI 调用 `run_script_flow_draft`，默认以 `trial` 执行未验证脚本。
9. 外部 AI 调用 `wait_for_run` 轮询到终态。
10. 外部 AI 调用 `get_run_report`，按 `responseMode` 拿到结构化摘要、失败原因、关键证据或完整附件、最终截图和 HTML 报告 URL。
11. 如果 `outcomeReviewRequired`，外部 AI 可以基于截图和报告自行判断，但必须显式调用 `review_trial_outcome` 才能把试运行结果标为已确认或已拒绝。

## 目标 MCP 工具集

第一阶段必须提供：

- `get_script_flow_authoring_contract`
- `list_devices`
- `validate_device`
- `list_apps`
- `list_page_assets`
- `list_script_flows`
- `get_script_flow`
- `generate_script_flow_draft`
- `validate_script_flow`
- `preview_script_flow_draft`
- `run_script_flow_draft`
- `preview_script_flow`
- `run_script_flow`
- `wait_for_run`
- `get_run`
- `get_run_report`：支持 `responseMode: compact | evidence | full`

第二阶段可提供：

- `generate_and_run_script_flow`：组合 `generate -> preview -> trial-run -> wait -> report` 的便捷工具，支持 `responseMode: compact | evidence | full`。
- `review_trial_outcome`：只在调用方明确确认业务结果时使用。
- `save_script_flow` / `update_script_flow`：把已验证草稿保存到用例中心。
- `get_visual_grounding_status`：后续接入 OmniParser 后返回视觉解析后端启用状态、端点健康状态和降级原因。

## 典型外部 AI 场景

- UI 改动验证：外部 AI 修改 Android/iOS/Harmony 代码后，输入目标页面描述和代码上下文，本系统生成并执行到达路径，返回最终截图和报告，由外部 AI 判断 UI 改动是否生效。
- 偶现问题复现：外部 AI 根据线上反馈或日志整理操作路径，调用本系统生成脚本并循环试运行，直到出现崩溃、ANR、进程异常、断言失败或达到最大次数。
- 修复回归验证：外部 AI 修复问题后复用同一条路径再次执行，比较结果、截图、异常事件和关键日志，判断问题是否已修复。
- 跨端一致性探测：同一业务目标分别传入 `devicePlatform: "android" | "ios" | "harmony"` 和对应 `appId`，分别生成或执行端侧脚本，报告中必须明确所选设备、真实执行平台和实际 App。

## 后续视觉解析能力：OmniParser

OmniParser 暂不纳入第一阶段 MCP 编排交付，但应作为后续视觉目标定位增强方案记录下来。它解决的问题不是让外部 AI 自己点坐标，而是提升执行器在 `visual` / `icon` / `control` 目标上的候选发现和语义分类能力，尤其针对头像、搜索、排序、筛选、更多、返回、添加等非文字目标。

参考资料：

- Microsoft GitHub：<https://github.com/microsoft/OmniParser>
- Microsoft Research：<https://www.microsoft.com/en-us/research/articles/omniparser-v2-turning-any-llm-into-a-computer-use-agent/>
- Hugging Face 模型卡：<https://huggingface.co/microsoft/OmniParser-v2.0>
- 论文：<https://arxiv.org/abs/2408.00203>

定位原则：

- OmniParser 是执行器/视觉定位层能力，不是 planner 特殊规则库。planner 仍只按 ScriptFlow v1 contract 生成 `text`、`icon`、`visual`、`control` 等目标类型，不写平台私有 selector，也不写坐标。
- OmniParser 只作为可选后端启用。未配置时现有 OCR、页面资产、模板图标、结构化控件和现有视觉组件检测继续工作。
- OmniParser 输出的 bbox 只能作为候选元素位置，不能变成脚本身份。脚本仍用 `target.visual.kind/query`、`target.icon`、`target.text` 等跨平台描述。
- 执行器必须继续做唯一性和置信度校验。低置信、多个高分候选或候选和文本区域冲突时不点击，返回可读失败原因和候选证据。
- 对 `text` 目标，优先使用现有 OCR/文本匹配；OmniParser 不替代 OCR 文字断言。
- 对非文字目标，优先排除 OCR 文本区域，再融合 OmniParser 的 icon/control 候选，避免把“全部班级”等文字笔画误识别成头像或图标。

建议架构：

```text
ScriptFlow step
  -> semantic-locator / executor
  -> deterministic locators
       OCR text / page asset / standard icon template / structural control
  -> if unresolved or ambiguous
       VisualGroundingService
         -> OmniParser local HTTP service
         -> normalized candidates
  -> rank by query + kind + area + position + nearText + page context
  -> unique high-confidence candidate
  -> device tap
```

服务边界：

- 不在 TypeScript server 内直接加载模型权重。新增一个 `VisualGroundingService` TypeScript 接口和一个 OmniParser HTTP client；OmniParser 以本地独立服务运行。
- 配置项：

```bash
VISUAL_GROUNDING_BACKEND=disabled|omniparser
OMNIPARSER_ENDPOINT=http://127.0.0.1:7861/parse
VISUAL_GROUNDING_TIMEOUT_MS=3000
```

- 未配置 `OMNIPARSER_ENDPOINT` 或请求超时，定位器要降级为现有能力，并在 step metadata 中记录 `visualGroundingSkipped` 或 `visualGroundingTimeout`。
- OmniParser V2 模型卡标注在 A100 和 4090 上可达到亚秒级到秒级推理；本地部署仍需要评估显卡、延迟和并发。
- 模型组件存在不同许可证，特别是 icon detection 相关许可证需要在产品化前做法务确认。

候选结果规范：

```ts
export type VisualGroundingCandidate = {
  id: string;
  kind: "icon" | "text" | "control" | "image" | "unknown";
  label?: string;
  caption?: string;
  confidence?: number;
  bbox: { x: number; y: number; width: number; height: number };
  source: "omniparser";
};
```

执行器融合规则：

- `target.visual.kind === "icon"`：只接受 `kind: "icon" | "control"` 的候选；候选 caption/label/query 做语义相似度评分，area/position/nearText 只作为加权，不作为唯一依据。
- `target.icon`：先走现有标准 icon/template；找不到或不唯一时，把 `target.icon` 转为视觉 query 输入 OmniParser 候选排序。
- `target.control`：优先结构化控件；结构化不可用时用 OmniParser 的 `control` 候选补充。
- `target.text` 和 `assertText`：继续用 OCR 文本行/文本框匹配，必要时只用 OmniParser text bbox 辅助定位，不改变文字匹配语义。
- 所有非文字点击目标都要计算 OCR 文本重叠率；超过阈值时默认降权或排除，除非脚本目标明确是文字附近的控件。

后续任务拆分：

### 后续视觉任务 1: 抽象 VisualGroundingService

**文件：**

- 创建：`platform/apps/server/src/visual-grounding.ts`
- 创建：`platform/apps/server/src/visual-grounding.test.ts`
- 修改：`platform/apps/server/src/semantic-locator.ts`

- [ ] **步骤 1: 编写失败测试**

覆盖 `disabled` backend 返回空候选、timeout 降级、候选 bbox 坐标归一化和 metadata 记录。

- [ ] **步骤 2: 实现接口与 disabled backend**

先只定义 `VisualGroundingService.parseScreenshot({ screenshotPath, platform, viewport })` 和空实现，不接真实模型。

- [ ] **步骤 3: 接入 semantic-locator fallback**

仅当现有 deterministic locator 找不到或目标不唯一时调用服务；服务返回空结果时保持原失败路径。

### 后续视觉任务 2: OmniParser HTTP client

**文件：**

- 创建：`platform/apps/server/src/omniparser-client.ts`
- 创建：`platform/apps/server/src/omniparser-client.test.ts`
- 修改：`platform/apps/server/src/visual-grounding.ts`

- [ ] **步骤 1: 编写 mock HTTP 测试**

用 fake fetch 模拟 OmniParser 返回 icon/control/text bbox，断言 client 会转换为 `VisualGroundingCandidate[]`。

- [ ] **步骤 2: 实现 client**

读取 `OMNIPARSER_ENDPOINT` 和 timeout 配置，POST 当前截图路径或图片 bytes，返回归一化候选。

- [ ] **步骤 3: 错误降级**

网络错误、超时、返回格式不合法时不让 run 直接失败，只把视觉增强失败写入 step metadata。

### 后续视觉任务 3: 视觉候选融合和报告证据

**文件：**

- 修改：`platform/apps/server/src/semantic-locator.ts`
- 修改：`platform/apps/server/src/semantic-locator.test.ts`
- 修改：`platform/apps/server/src/report-core.ts`
- 修改：`platform/apps/server/src/report-core.test.ts`

- [ ] **步骤 1: 编写头像/搜索/排序图标回归测试**

构造 OCR 文本候选和 OmniParser 图标候选并存的场景，断言非文字目标不会点击 OCR 文本区域。

- [ ] **步骤 2: 实现候选排序**

按 `kind`、`query/caption`、`area`、`position`、`nearText`、OCR 重叠率和 page context 计算综合分。

- [ ] **步骤 3: 处理不唯一**

多个候选分数接近时返回 `target_not_unique`，报告中展示候选截图、bbox 和每个候选的评分原因。

- [ ] **步骤 4: 报告展示**

HTML 报告默认只展示最终选择候选；完整调试证据放入折叠区，避免把所有候选截图平铺到报告里。

## 任务 1: MCP authoring contract

**文件：**

- 创建：`platform/packages/mcp-adapter/src/script-flow-contract.ts`
- 修改：`platform/packages/mcp-adapter/src/mcp-wrapper.ts`
- 修改：`platform/packages/mcp-adapter/src/mcp-wrapper.test.ts`
- 修改：`docs/guides/script-flow-tools.md`

- [ ] **步骤 1: 编写失败测试**

在 `platform/packages/mcp-adapter/src/mcp-wrapper.test.ts` 增加测试：

```ts
it("exposes a ScriptFlow authoring contract without platform-private locators", async () => {
  const handlers = createMobileAutomationMcpToolHandlers({ serverUrl: "http://server.test", fetch: fakeFetch([], {}) });
  for (const scriptPlatform of ["android", "ios", "harmony", "flutter", "mobile"] as const) {
    await expect(handlers.get_script_flow_authoring_contract({ scriptPlatform })).resolves.toMatchObject({
      version: 1,
      scriptPlatforms: ["android", "ios", "harmony", "flutter", "mobile"],
      devicePlatforms: ["android", "ios", "harmony"],
      targetTypes: ["text", "icon", "visual", "control"],
      unsupportedTargets: expect.arrayContaining(["semantic", "coordinate", "resourceId"])
    });
  }
  expect(JSON.stringify(mobileAutomationMcpTools)).toContain("get_script_flow_authoring_contract");
  expect(JSON.stringify(mobileAutomationMcpTools)).not.toContain("password");
});
```

- [ ] **步骤 2: 运行测试验证失败**

运行：

```bash
pnpm exec vitest run platform/packages/mcp-adapter/src/mcp-wrapper.test.ts
```

预期：失败，提示 `get_script_flow_authoring_contract` 不存在。

- [ ] **步骤 3: 实现 contract**

创建 `script-flow-contract.ts`，导出固定对象：

```ts
export type ScriptFlowAuthoringContract = {
  version: 1;
  scriptPlatforms: Array<"android" | "ios" | "harmony" | "flutter" | "mobile">;
  devicePlatforms: Array<"android" | "ios" | "harmony">;
  actions: string[];
  targetTypes: Array<"text" | "icon" | "visual" | "control">;
  unsupportedTargets: string[];
  executionContract: string[];
  examples: Array<{ title: string; yaml: string }>;
};

export function scriptFlowAuthoringContract(): ScriptFlowAuthoringContract {
  return {
    version: 1,
    scriptPlatforms: ["android", "ios", "harmony", "flutter", "mobile"],
    devicePlatforms: ["android", "ios", "harmony"],
    actions: ["launchApp", "tap", "inputText", "clearText", "selectText", "swipe", "scrollUntilVisible", "reachPage", "waitForPage", "assertPage", "assertText", "runFlow", "repeat", "when"],
    targetTypes: ["text", "icon", "visual", "control"],
    unsupportedTargets: ["semantic", "coordinate", "resourceId", "accessibilityId", "platformPrivateSelector"],
    executionContract: [
      "AI 输出必须经过 ScriptFlow v1 schema 校验",
      "ScriptFlow YAML 只写 app.id，不写 app.platform",
      "生成/列表平台使用 scriptPlatform，真实执行平台使用 devicePlatform",
      "执行前必须 preview 并使用 planDigest",
      "图标或图片目标必须使用 icon 或 visual，不能退化为 OCR 文本",
      "MCP 不接受坐标和平台私有元素标识作为目标身份"
    ],
    examples: [
      {
        title: "点击可见文字",
        yaml: "steps:\\n  - id: open-growth\\n    role: business\\n    tap:\\n      target: { text: 成长, area: bottomBar, match: exact }\\n      search: { mode: visibleOnly }"
      },
      {
        title: "点击视觉图标",
        yaml: "steps:\\n  - id: open-sort\\n    role: business\\n    tap:\\n      target:\\n        visual: { kind: icon, query: 排序图标 }\\n      search: { mode: visibleOnly }"
      }
    ]
  };
}
```

- [ ] **步骤 4: 接入 MCP 工具**

在 `mcp-wrapper.ts` 增加工具名、schema 和 handler。输入接受可选 `scriptPlatform`，同时兼容旧 `platform` 字段但在工具描述中标注旧字段含义。返回对应平台能力与限制；示例可以用 Android，但必须声明同一脚本规则适用于 iOS/Harmony，且 `flutter/mobile` 不是可直接连接的设备平台。

- [ ] **步骤 5: 更新文档并测试通过**

运行：

```bash
pnpm exec vitest run platform/packages/mcp-adapter/src/mcp-wrapper.test.ts
pnpm --filter @mobile-automation/mcp-adapter typecheck
```

## 任务 2: 草稿校验、预览、试运行 MCP

**文件：**

- 修改：`platform/packages/mcp-adapter/src/index.ts`
- 修改：`platform/packages/mcp-adapter/src/mcp-wrapper.ts`
- 修改：`platform/packages/mcp-adapter/src/index.test.ts`
- 修改：`platform/packages/mcp-adapter/src/mcp-wrapper.test.ts`

- [ ] **步骤 1: 编写失败测试**

在 `index.test.ts` 增加草稿链路测试，期望请求顺序：

```ts
expect(requests).toEqual([
  "POST /api/script-flows/validate",
  "POST /api/script-flow-drafts/preview",
  "GET /api/devices",
  "POST /api/script-flow-drafts/trial-runs"
]);
```

测试断言：

```ts
const sourceYaml = `
version: 1
kind: case
name: 打开班级
app: { id: classin }
steps:
  - id: open-class
    tap:
      target: { text: 班级四十二号, match: exact }
`.trim();

await expect(adapter.validateScriptFlow({ sourceYaml })).resolves.toEqual(expect.objectContaining({ valid: true }));
await expect(adapter.previewScriptFlowDraft({ sourceYaml, parameters: { className: "班级四十二号" } })).resolves.toEqual(expect.objectContaining({ planDigest: "a".repeat(64) }));
await expect(adapter.runScriptFlowDraft({ sourceYaml, planDigest: "a".repeat(64), appId: "classin", devicePlatform: "android", deviceSerial: "device-1", parameters: { className: "班级四十二号" } })).resolves.toEqual(expect.objectContaining({ runId: "run-1" }));
```

- [ ] **步骤 2: 运行测试验证失败**

运行：

```bash
pnpm exec vitest run platform/packages/mcp-adapter/src/index.test.ts platform/packages/mcp-adapter/src/mcp-wrapper.test.ts
```

预期：失败，提示 adapter 方法和 MCP 工具不存在。

- [ ] **步骤 3: 实现 adapter 方法**

在 `index.ts` 增加：

- `validateScriptFlow({ sourceYaml })` -> `POST /api/script-flows/validate`
- `previewScriptFlowDraft({ sourceYaml, parameters })` -> `POST /api/script-flow-drafts/preview`
- `runScriptFlowDraft({ sourceYaml, planDigest, appId?, devicePlatform, deviceSerial?, parameters, executionPurpose })` -> 先校验设备，再默认 `POST /api/script-flow-drafts/trial-runs`

`executionPurpose` 只能是 `trial` 或 `normal`。默认 `trial`，避免未验证草稿走普通执行。

- [ ] **步骤 4: 接入 MCP 工具**

在 `mcp-wrapper.ts` 增加：

- `validate_script_flow`
- `preview_script_flow_draft`
- `run_script_flow_draft`

`sourceYaml` 最大长度先沿用 REST 的 1MB 上限，不在工具描述中暴露敏感字段。

- [ ] **步骤 5: 测试通过**

运行：

```bash
pnpm exec vitest run platform/packages/mcp-adapter/src/index.test.ts platform/packages/mcp-adapter/src/mcp-wrapper.test.ts
pnpm --filter @mobile-automation/mcp-adapter typecheck
```

## 任务 3: 外部代码上下文生成输入

**文件：**

- 修改：`platform/apps/server/src/script-flow-ai-api.ts`
- 修改：`platform/apps/server/src/script-flow-ai-api.test.ts`
- 修改：`platform/apps/server/src/script-flow-ai-planner.ts`
- 修改：`platform/apps/server/src/script-flow-ai-planner.test.ts`
- 修改：`platform/packages/mcp-adapter/src/index.ts`
- 修改：`platform/packages/mcp-adapter/src/mcp-wrapper.ts`

- [ ] **步骤 1: 编写 API 失败测试**

在 `script-flow-ai-api.test.ts` 增加。下面使用 Android 作为单个平台样例，同时需要补充 `ios`、`harmony`、`mobile` 和 `flutter` 参数化用例，确保外部 MCP 入口不把 `scriptPlatform` 默认成 Android：

```ts
const response = await fetch(`${baseUrl}/api/script-flow-drafts/generate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    prompt: "从成长页进入全网搜索",
    appId: "classin",
    scriptPlatform: "android",
    externalContext: {
      source: "classin-code",
      implementationStack: "android-native",
      summary: "GrowthFragment 顶栏存在搜索入口，点击后进入全网搜索页。",
      candidateSteps: ["打开成长 Tab", "点击搜索入口", "确认搜索输入框"]
    }
  })
});
expect(response.status).toBe(200);
expect(generateDraft).toHaveBeenCalledWith(expect.objectContaining({
  externalContext: expect.objectContaining({ source: "classin-code" })
}));
```

- [ ] **步骤 2: 运行测试验证失败**

运行：

```bash
pnpm exec vitest run platform/apps/server/src/script-flow-ai-api.test.ts
```

预期：失败，提示 `Unknown request field: externalContext` 或 `Unknown request field: scriptPlatform`。当前 REST API 只接受 `platform` 字段，MCP adapter 可以先把 `scriptPlatform` 映射到 REST `platform`，但对外工具描述不要继续混用。

- [ ] **步骤 3: 实现严格 externalContext**

新增类型：

```ts
export type ScriptFlowExternalContext = {
  source: "code" | "directory" | "classin-code" | "manual";
  summary: string;
  implementationStack?: "android-native" | "ios-native" | "harmony-native" | "flutter" | "compose" | "swiftui" | "arkui" | "unknown";
  relevantFiles?: string[];
  candidateSteps?: string[];
  constraints?: string[];
};
```

只接受摘要、文件路径、候选步骤和约束，不接受任意大段源码或凭据字段。

- [ ] **步骤 4: 注入 planner prompt**

在 `script-flow-ai-planner.ts` 里把 `externalContext` 作为“非权威提示”加入 prompt：

- 说明它来自外部代码理解，仅作为生成线索。
- 最终脚本仍必须符合 ScriptFlow v1。
- 不能生成平台私有 selector、坐标、resource id。

- [ ] **步骤 5: MCP generate 工具升级**

将现有 `generate_script_flow` 改为保留兼容，同时新增或重命名推荐工具 `generate_script_flow_draft`，支持 `externalContext`、`screenAssist`、`flowId + expectedVersion` 修改场景。

## 任务 4: 跨平台设备发现、前置校验、等待执行和报告摘要

**文件：**

- 修改：`platform/packages/mcp-adapter/src/index.ts`
- 修改：`platform/packages/mcp-adapter/src/mcp-wrapper.ts`
- 修改：`platform/packages/mcp-adapter/src/index.test.ts`
- 修改：`platform/packages/mcp-adapter/src/mcp-wrapper.test.ts`

- [ ] **步骤 1: 编写失败测试**

覆盖：

- `list_devices` -> `GET /api/devices`
- `validate_device({ devicePlatform })`：无同平台在线设备时返回 `DEVICE_NOT_CONNECTED`
- `validate_device({ devicePlatform, deviceSerial })`：指定设备离线时返回 `DEVICE_OFFLINE`
- `validate_device({ devicePlatform: "harmony", deviceSerial: "android-1" })`：设备存在但平台不匹配时返回 `DEVICE_PLATFORM_MISMATCH`
- `validate_device({ devicePlatform })`：多台同平台在线设备且未指定 `deviceSerial` 时返回 `DEVICE_SELECTION_REQUIRED`
- `validate_device({ devicePlatform: "flutter" })`：非法设备平台时返回 `PLATFORM_NOT_SUPPORTED_BY_RUNTIME`
- `wait_for_run` -> 多次 `GET /api/runs/:id` 直到 `passed|failed|stopped|timeout|device_lost`
- `get_run_report` -> 按 `responseMode` 返回：
  - `compact`：`runId`、`status`、`reportUrl`、`failedSteps`、`finalScreenshotUrl`
  - `evidence`：默认；返回关键 `artifactUrls`、异常 `events`、`failure`
  - `full`：返回完整 `artifactUrls`、`events`、`failureEvidence`

- [ ] **步骤 2: 运行测试验证失败**

运行：

```bash
pnpm exec vitest run platform/packages/mcp-adapter/src/index.test.ts platform/packages/mcp-adapter/src/mcp-wrapper.test.ts
```

- [ ] **步骤 3: 实现 adapter**

新增：

- `listDevices({ devicePlatform?, status? })`
- `validateDevice({ devicePlatform, appId?, deviceSerial? })`
- `waitForRun({ runId, timeoutMs = 120000, pollIntervalMs = 1000 })`
- `getRunReport({ runId })`

`validateDevice` 只做发现和选择，不启动 App；从 `GET /api/devices` 获取设备后必须过滤 `device.platform === devicePlatform` 且 `device.status === "online"`，并校验执行所需 capability：至少 `screenshot`、`tap`、`launchApp`。成功时返回 `selectedDevice`，失败时返回统一 `DevicePreflightErrorCode`。`runScriptFlowDraft`、`runScriptFlow`、`generateAndRunScriptFlow` 必须复用它，不能各自实现一套判断。

`waitForRun` 只在 adapter 层轮询 REST，不要求 server 长连接。

- [ ] **步骤 4: 使用 ScriptFlow run API 获取 failure**

`getRunReport` 优先请求 `/api/script-flow-runs/:runId` 拿 `failure`，再拼 `/api/reports/:runId/html`。

## 任务 5: 真正的 MCP stdio server

**文件：**

- 创建：`platform/packages/mcp-adapter/src/server.ts`
- 修改：`platform/packages/mcp-adapter/package.json`
- 创建：`platform/packages/mcp-adapter/src/server.test.ts`
- 修改：`docs/guides/script-flow-tools.md`

- [ ] **步骤 1: 编写失败测试**

测试 server 模块至少导出：

```ts
expect(createMobileAutomationMcpServer).toBeTypeOf("function");
```

并验证 tool registry 中包含 `generate_script_flow_draft`、`preview_script_flow_draft`、`run_script_flow_draft`。

- [ ] **步骤 2: 添加 MCP SDK 依赖**

在 `package.json` 增加 MCP server 运行依赖，并增加脚本：

```json
{
  "bin": {
    "mobile-automation-mcp": "./src/server.ts"
  },
  "scripts": {
    "start": "tsx src/server.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

- [ ] **步骤 3: 实现 stdio server**

`server.ts` 从环境变量读取：

- `MOBILE_AUTOMATION_SERVER_URL`，默认 `http://127.0.0.1:4010`

只注册工具和只读资源，不直接读取本地数据库。

- [ ] **步骤 4: 文档给出 Codex/外部 AI 配置示例**

更新 `docs/guides/script-flow-tools.md`：

```json
{
  "mcpServers": {
    "mobile-automation": {
      "command": "pnpm",
      "args": ["--filter", "@mobile-automation/mcp-adapter", "start"],
      "env": {
        "MOBILE_AUTOMATION_SERVER_URL": "http://127.0.0.1:4010"
      }
    }
  }
}
```

## 任务 6: 一站式 generate-and-run 便捷工具

**文件：**

- 修改：`platform/packages/mcp-adapter/src/index.ts`
- 修改：`platform/packages/mcp-adapter/src/mcp-wrapper.ts`
- 修改：`platform/packages/mcp-adapter/src/index.test.ts`

- [ ] **步骤 1: 编写失败测试**

模拟请求顺序：

```ts
expect(requests).toEqual([
  "GET /api/devices",
  "POST /api/script-flow-drafts/generate",
  "POST /api/script-flow-drafts/preview",
  "POST /api/script-flow-drafts/trial-runs",
  "GET /api/runs/run-1",
  "GET /api/script-flow-runs/run-1"
]);
```

- [ ] **步骤 2: 实现组合工具**

`generateAndRunScriptFlow` 输入：

- `goal`
- `appId`
- `scriptPlatform`
- `devicePlatform`
- `deviceSerial?`
- `parameters`
- `externalContext`
- `screenAssist`
- `timeoutMs`

执行：

1. `validate_device({ devicePlatform, appId, deviceSerial })`，无设备、平台不匹配、设备离线、设备不唯一或缺少必要 capability 时直接返回结构化错误。
2. `generate_script_flow_draft`
3. 如果 `needs_clarification`，直接返回 clarification，不执行脚本。
4. `preview_script_flow_draft`
5. 未验证默认 `trial-runs`
6. `wait_for_run`
7. `get_run_report`

- [ ] **步骤 3: 明确 outcome review**

如果 run 通过但 `/api/trial-runs/:runId/learning-summary` 返回 `needs_outcome_review`，结果中设置：

```ts
{
  outcomeReviewRequired: true,
  nextAction: "caller_review_required"
}
```

不自动调用 `outcome-review`。

## 任务 7: outcome review 工具

**文件：**

- 修改：`platform/packages/mcp-adapter/src/index.ts`
- 修改：`platform/packages/mcp-adapter/src/mcp-wrapper.ts`
- 修改：`platform/packages/mcp-adapter/src/index.test.ts`

- [ ] **步骤 1: 编写失败测试**

`review_trial_outcome({ runId, decision })` 调用：

```text
POST /api/trial-runs/:runId/outcome-review
```

只允许 `confirmed | rejected`。

- [ ] **步骤 2: 实现工具**

工具描述必须写明：只有调用方明确确认业务结果后才调用。调用方可以是人，也可以是外部 AI；本系统不能根据“run passed”自动确认业务结果。

## 验收命令

每个任务完成后运行局部测试。全部完成后运行：

```bash
pnpm exec vitest run platform/packages/mcp-adapter/src/index.test.ts platform/packages/mcp-adapter/src/mcp-wrapper.test.ts platform/apps/server/src/script-flow-ai-api.test.ts platform/apps/server/src/script-flow-ai-planner.test.ts platform/apps/server/src/script-flow-api.test.ts
pnpm -r typecheck
```

## 风险与边界

- 真实 MCP server 引入 SDK 依赖时要确认包版本和 ESM 用法，避免影响现有 REST/server。
- 外部 AI 传入的 `externalContext` 可能包含敏感信息，必须限制字段并在文档中要求摘要化，不接受账号密码或大段源码。
- MCP 工具不能默认 Android。所有真实执行入口必须带 `devicePlatform + appId`，或带可精确推断平台的 `deviceSerial`，并经过同一套设备前置校验；无设备、离线、平台不匹配、设备不唯一都必须返回结构化错误。
- 一站式工具会真实操作设备，必须默认 trial，不允许跳过 preview。
- 对没有自动断言的脚本，MCP 只能返回报告和待确认状态，不能替调用方确认业务结果。
- `normal` 执行仍只允许已验证 sourceHash，保持现有安全契约。
