# ScriptFlow v1

## 事实来源

| 数据 | 唯一事实来源 |
| --- | --- |
| 页面身份 | PageAsset |
| 测试过程 | ScriptFlow YAML |
| 测试数据 | ScriptFlow 参数定义与运行参数 |
| 执行结果 | Run、StepResult、Artifact |

## 页面资产

页面资产按真实 App ID 和平台隔离。当前 ClassIn Android 使用 `cn.eeo.classin`。

页面资产可保存：

- 页面名称、稳定 key、平台范围和页面变体类型。
- OCR 文本、截图重点区域、视觉基线及其他页面身份 matcher。
- 可选公共定位器，如稳定文本、视觉区域、集合项定位规则。

页面资产不得保存业务动作、跳转目标、发布流程或页面任务。一次性动作直接写入 ScriptFlow。

## ScriptFlow

第一版支持：

- `launchApp`
- `tap`
- `inputText`
- `clearText`
- `selectText`
- `swipe`
- `scrollUntilVisible`
- `waitForPage`
- `assertPage`
- `runFlow`
- `repeat`
- `when`

步骤可声明 `onPage` 和 `expectPage`。执行器在运行时识别页面，并在已知目标页时只匹配指定页面，避免全库视觉扫描。

## 执行原则

1. YAML 先经过 schema 和参数校验。
2. `tap` 与 `selectText` 默认属于需确认的交互；提交、发布、删除和支付使用更具体的风险类别。脚本禁止用 `risk: none` 绕过确认。
3. 动作目标只接受 `ocrText` 或公共 `pageElement`；未稳定定位时失败，不回退到录制坐标。
4. 页面跳转结果由 PageStateService 验证。
5. 运行前必须预览。预览固定父流程版本、全部 `runFlow` 依赖版本、参数和编译计划，并返回 `planDigest`；执行只接受同一摘要。
6. 敏感参数只在内存中参与执行，持久化步骤按参数来源脱敏，不扫描或改写无关结构字段。
7. 一个 ScriptFlow 产生一个 Run，报告按脚本步骤展示。

## AI 生成

AI 输入只包含自然语言、目标 App、平台、页面目录、公共定位器和可复用 ScriptFlow 摘要。AI 输出必须是可校验的 ScriptFlow v1 文档，不直接控制设备，也不能绕过风险确认。

网页端 AI 配置只允许启用本机 Codex Provider、选择模型和超时。外部 HTTP Provider 只能由运维通过环境变量配置，地址和密钥不写入项目数据库。

## 验收

- 页面资产库不出现连接边、PageTask、MetaFunction 或动作资产。
- 自然语言可以生成可编辑的 ScriptFlow 草稿。
- ScriptFlow 可保存、版本化、参数化并运行。
- `onPage` / `expectPage` 使用统一页面身份服务。
- REST、CLI 和 MCP 只暴露页面资产、ScriptFlow、Run 和报告能力。
- REST、CLI 和 MCP 均使用 `preview -> planDigest -> run` 契约；子流程变化后旧摘要立即失效。
- Android 先完整落地；iOS、Harmony 和 Flutter 复用视觉页面样本扩展字段，不引入平台专属定位为主路径。
