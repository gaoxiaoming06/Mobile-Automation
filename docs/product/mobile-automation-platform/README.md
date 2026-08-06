# Mobile Automation Platform

平台当前以 ScriptFlow 为唯一用例事实来源，以页面资产为页面身份和公共定位器来源。

## 产品边界

- 页面资产回答“当前是什么页面”，保存稳定视觉/OCR 证据、页面变体和可选公共定位器。
- ScriptFlow 回答“接下来做什么”，保存动作、参数、页面前置条件和执行后页面断言。
- AI 根据自然语言、页面目录和已有子流程生成 ScriptFlow 草稿；编排器也可直接引用用例中心中同 App、同平台的稳定用例。确定性编译器只校验结构、参数和执行能力，不根据业务文字改写或阻止显式步骤。
- Run 保存步骤结果、截图、视频、性能、异常和 HTML 报告。
- 已验证用例可单次执行、仅循环业务与验证，或循环整个用例；循环过程严格按显式步骤闭环，不自动返回起点。
- 页面连接边、PageTask、MetaFunction、组合资产和图谱路径执行不属于当前模型。

## 当前入口

| 入口 | 职责 |
| --- | --- |
| 设备管理 | 发现、选择和控制设备 |
| 设备详情 | 实时预览与手工操作 |
| 资产录制 | 录入页面身份和公共定位器 |
| 页面资产库 | 查看、删除页面身份资产 |
| ScriptFlow 用例 | 查看、编排、校验和执行用例 |
| AI 生成用例 | 把自然语言生成可编排的 ScriptFlow 草稿 |
| 稳定性探索 | 对指定 App 执行受控随机探索 |
| 执行结果 | 查看 Run、步骤证据和报告 |

脚本编排器通过统一“添加”弹窗新增操作步骤或引用稳定用例，并指定前置准备、业务步骤、结果验证或每轮复位。父用例通过 `runFlow` 引用时只复用子用例核心步骤，不继承子用例自己的前置准备和每轮复位；引用点角色决定核心步骤在父用例中的执行阶段。

## 后续规划：中心服务 + Device Agent 设备池

当前部署模型是单机 QA 工作站：服务端进程直接调用本机 `adb`、`hdc`、`idevice*`、`xcrun`、WDA 和 scrcpy，因此服务部署在哪台机器，就只能发现和控制那台机器可访问的设备。后续需要演进为中心服务一对多设备节点的架构，让主逻辑部署在远端或内网服务器上，本机只负责把实际连接的 Android、iOS、HarmonyOS 设备作为可调度资源注册到平台。

目标架构：

```text
用户浏览器
  -> 中心服务
     - Dashboard
     - ScriptFlow 编排
     - AI 生成
     - 用例、报告、资产和运行数据
     - Agent 注册表、设备池、任务调度和设备租约
  -> Device Agent 1
     - Android / ADB
     - HarmonyOS / HDC
  -> Device Agent 2
     - iOS / libimobiledevice / xcrun / WDA
  -> Device Agent N
     - 多台本机或实验室设备
```

Device Agent 运行在真实连接设备的机器上，主动连接中心服务并定期心跳，上报本机设备列表、工具状态和设备能力。中心服务不直接访问 USB、ADB server、HDC server 或 usbmuxd，只通过 Agent RPC 下发截图、点击、输入、启动 App、停止 App、dump UI、采集日志、性能采样和视频/预览流等请求。Android、iOS、HarmonyOS 现有 driver 逻辑继续保留在 Agent 侧复用。

用户使用形态：

- 用户只打开统一 Dashboard，不需要关心设备插在哪台机器上。
- 设备管理页展示所有 Agent 上报的设备，并按 `agentId`、平台、在线状态、忙闲状态和当前运行任务分组。
- 用户可以手动选择某台设备执行用例，也可以按平台或设备标签让中心服务自动选择空闲设备。
- 设备详情、实时预览、手工操作和 ScriptFlow 运行入口仍保持一个平台体验；平台内部把请求路由到设备所属 Agent。
- 报告、截图、日志、视频和运行结果统一回传中心服务保存。

并发与占用规则：

- 同一台物理设备同一时间只能被一个自动化运行或可写手工操作占用，避免点击、输入、启动 App 和截图互相干扰。
- 不同设备可以同时执行不同用例；中心服务从“一台服务控制一台设备”的体验升级为“一个中心服务调度多台设备”。
- 一个 Agent 可以同时管理多台设备，不限制为一台；但 Agent 需要配置并发上限，例如 `AGENT_MAX_CONCURRENT_RUNS=3`，避免 CPU、USB 带宽、scrcpy、OCR、WDA 和日志采集资源过载。
- 设备唯一标识建议使用 `agentId:platform:serial`，避免不同 Agent 上出现相同 serial 时冲突。
- 中心服务维护设备级租约、Agent 级并发计数、任务队列和心跳超时回收；Agent 离线时，其设备标记为 offline，正在运行的任务进入环境失败或可恢复状态。
- iOS 多设备需要按 UDID 隔离 WDA 端口和签名会话；Android 和 HarmonyOS 通过 `adb -s <serial>`、`hdc -t <serial>` 路由到具体设备。

分阶段落地：

1. Agent MVP：支持 Agent 注册、心跳、设备发现、设备能力上报、`getDeviceInfo`、`screenshot`、`performAction`、`dumpUiHierarchy`、`collectLogs` 和 `samplePerformance`，先跑通远端中心服务操作本机设备。
2. 预览与事件流：把 Android scrcpy 视频/控制流、iOS 截图轮询、logcat/hilog 事件、App monitor 和视频录制改为 Agent 侧采集、中心服务转发。
3. 设备池调度：支持设备标签、自动选设备、Agent 并发上限、任务排队、租约可视化、异常释放和多用户冲突提示。
4. 运维与安全：支持 Agent token、TLS 或内网 mTLS、Agent 版本上报、工具健康检查、权限控制和审计日志。

详细契约见 [ScriptFlow v1](./spec/script-flow-v1.md)。
