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

架构兼容性约束：

- Server + Device Agent 是部署形态和设备接入层的演进，不改变 ScriptFlow、页面资产、Runner、Run 结果和报告模型。
- 现有 Android 和 HarmonyOS 测试流程必须继续可用；在 Agent Relay 能覆盖同等能力并通过回归前，单机本地 driver 路径保留为默认可运行路径或兼容回退路径。
- Dashboard、ScriptFlow 编排器、AI 生成和执行结果页不直接感知设备是本地 driver 还是远端 Agent；差异由中心服务的设备路由层和能力描述消化。
- Android、HarmonyOS 已实现能力优先保持稳定：设备发现、截图、点击/滑动/输入、UI dump、App monitor、性能采样、视频/预览和 ScriptFlow 执行不能因为 Agent 化被重写为另一套业务模型。
- iOS WDA 生命周期、端口转发和多设备能力作为 Agent 侧增强项推进，不阻塞 Android/HarmonyOS 主流程，也不要求把现有 WDA 外部配置方案一次性废弃。

用户使用形态：

- 用户只打开统一 Dashboard，不需要关心设备插在哪台机器上。
- 设备管理页默认只展示已共享的 Agent 设备，并按 `agentId`、平台、在线状态、忙闲状态和当前运行任务分组。
- 用户可以手动选择某台设备执行用例，也可以按平台或设备标签让中心服务自动选择空闲设备。
- 个人电脑上的 Agent 默认不把设备发布到公共设备池；用户需要自用时，通过本机会话配对临时把设备挂到当前浏览器会话。
- 设备详情、实时预览、手工操作和 ScriptFlow 运行入口仍保持一个平台体验；平台内部把请求路由到公共设备所属 Agent 或当前会话配对的本机 Agent。
- 报告、截图、日志、视频和运行结果按运行配置回传中心服务并保存；预览流默认只中转不落盘。

设备共享与本机会话：

- Agent 或单台设备需要支持 `shared=true|false` 共享开关，默认建议为 `false`。
- `shared=true` 时，设备进入中心服务的公共设备池，可以在远端 Dashboard 展示，并可被具备权限的运行入口选择或自动调度。
- `shared=false` 时，设备不进入公共设备池，不在远端 Dashboard 设备列表展示，不参与自动选设备，不接受中心服务发起的远端操作或用例调度。
- `shared=false` 不引入 owner 概念，也不按用户归属展示；只要未共享，其他用户和公共调度都不可见、不可用。
- `shared=false` 设备需要自用时，采用一次性 pairing code 建立本机会话：Dashboard 生成短期配对码，本机 Agent 绑定该配对码，中心服务只在当前浏览器会话下临时展示这些设备。
- 本机会话不是完整 Local-only 模式；链路仍是 `Dashboard -> Server -> Agent -> Device`，不做浏览器直连 `localhost`、局域网发现、CORS/HTTPS 本地桥接或第二套预览通道。
- 本机会话设备不进入公共 inventory，不被其他浏览器或其他用户看到，不参与自动调度；会话断开、超时或 Agent 退出后，中心服务清理该临时设备映射。
- 预览流、操作指令和运行数据在本机会话中仍经过中心服务中转；默认只中转屏幕流，不落盘预览帧。是否保存运行报告、截图证据、日志和视频，需要由运行配置显式决定。

Agent 运行时模型：

- `AgentSession` 记录 `agentId`、Agent 版本、连接状态、心跳时间、共享配置、工具健康状态、并发上限和当前运行计数。
- `DeviceSession` 记录 `agentId:platform:serial`、设备名称、平台、系统版本、分辨率、在线状态、共享状态、能力集、当前租约和最近一次上报时间。
- `ProcessRegistry` 由 Agent 维护，用于跟踪 scrcpy、WDA、iproxy、logcat、hilog、syslog、录屏、性能采样和其他子进程，确保设备释放、Agent 退出或连接断开时可清理。
- `StreamSession` 由 Agent 和中心服务共同维护，用于区分 screen、control、terminal/log、performance 等通道，视频流高频数据不得阻塞控制命令和运行状态回传。
- 中心服务只持久化必要的 Agent、设备、租约、运行和审计状态；WDA 进程句柄、scrcpy client、ADB/HDC/usbmuxd 连接等本机资源只存在于 Agent 进程内。

Agent 协议边界：

- `command`：中心服务发起、Agent 返回结果，覆盖 `getDeviceInfo`、`screenshot`、`performAction`、`dumpUiHierarchy`、`collectLogs`、`samplePerformance`、App 启停和运行步骤执行。
- `event`：Agent 主动上报，覆盖设备插拔、工具健康变化、租约状态、运行步骤状态、日志片段、性能样本和异常诊断。
- `stream`：中心服务中转的实时通道，覆盖 Android scrcpy 视频/控制流、iOS 截图或 WDA/MJPEG 预览、terminal/log、性能采样和未来录屏预览。
- 每条消息需要包含 `requestId`、`agentId`、`deviceKey`、`platform`、`timestamp` 和协议版本；`deviceKey` 使用 `agentId:platform:serial`，避免不同 Agent 上相同 serial 冲突。
- Agent 断线重连后需要全量上报设备快照，中心服务以最新快照修正在线状态，并对失联租约执行超时回收或环境失败标记。

并发与占用规则：

- 同一台物理设备同一时间只能被一个自动化运行或可写手工操作占用，避免点击、输入、启动 App 和截图互相干扰。
- 租约类型至少区分 `readonly_preview`、`manual_control`、`automation_run` 和 `maintenance`；`manual_control`、`automation_run` 和 `maintenance` 互斥，`readonly_preview` 是否可并存由设备能力、流资源和运行配置决定。
- 租约需要支持 TTL、心跳续租、显式释放、Agent 离线回收和旧 owner 不能释放新 owner 的保护。
- 不同设备可以同时执行不同用例；中心服务从“一台服务控制一台设备”的体验升级为“一个中心服务调度多台设备”。
- 一个 Agent 可以同时管理多台设备，不限制为一台；但 Agent 需要配置并发上限，例如 `AGENT_MAX_CONCURRENT_RUNS=3`，避免 CPU、USB 带宽、scrcpy、OCR、WDA 和日志采集资源过载。
- 设备唯一标识建议使用 `agentId:platform:serial`，避免不同 Agent 上出现相同 serial 时冲突。
- 中心服务维护设备级租约、Agent 级并发计数、任务队列和心跳超时回收；Agent 离线时，其设备标记为 offline，正在运行的任务进入环境失败或可恢复状态。
- iOS 多设备需要按 UDID 隔离 WDA 端口、MJPEG/截图通道、iproxy 进程和签名会话；Android 和 HarmonyOS 通过 `adb -s <serial>`、`hdc -t <serial>` 路由到具体设备。

iOS Agent 增强：

- 第一阶段仍允许继续使用 `IOS_WDA_URL` 或 `IOS_WDA_URL_<UDID>` 接入外部 WDA，保证现有增量 iOS 支持不被破坏。
- 后续在 Agent 侧增加 `IosWdaManager`，负责按 UDID 分配端口、启动 `xcodebuild`、启动/回收 `iproxy`、探测 `/status`、创建或复用 WDA session，并把启动日志和签名错误回传中心服务。
- WDA 生命周期与设备租约绑定：设备释放、Agent 退出、WDA 健康检查失败或端口冲突时，Agent 需要清理对应进程并上报诊断事件。
- iOS 预览可以先维持截图轮询；若启用 WDA/MJPEG 或其他低延迟流，也必须通过中心服务中转并遵守预览流默认不落盘的策略。

分阶段落地：

0. 兼容边界与协议骨架：先定义 `AgentSession`、`DeviceSession`、租约类型、command/event/stream 消息 envelope 和设备路由接口；用 mock Agent 或本地 adapter 验证协议，不改现有 Android/HarmonyOS Runner 主流程。
1. Server Relay + Agent MVP：中心服务保留现有 REST/Runner 能力，新增 Agent 注册、心跳、设备发现、设备能力上报、共享开关、本机会话配对和 Agent RPC；先支持 `getDeviceInfo`、`screenshot`、`dumpUiHierarchy` 等只读能力，再接入 `performAction`。
2. 设备控制与租约：把手工操作、ScriptFlow 执行、稳定性探索和 App monitor 接到统一设备租约；完成 `performAction`、`collectLogs`、`samplePerformance`、App 启停和异常释放，确保 Android/HarmonyOS 既能走本地路径也能走 Agent 路径。
3. 本机会话体验：Dashboard 增加“连接本机 Agent”入口、一次性 pairing code、会话内设备列表、会话断开/超时清理和运行证据保存开关，验证个人电脑设备不进入公共设备池。
4. 预览与事件流：把 Android scrcpy 视频/控制流、iOS 截图轮询、logcat/hilog 事件、App monitor 和视频录制改为 Agent 侧采集、中心服务转发，并约束本机会话预览流默认只中转不落盘。
5. 公共设备池调度：支持共享设备标签、自动选设备、Agent 并发上限、任务排队、租约可视化、异常释放和多用户冲突提示。
6. 运维与安全：支持 Agent token、TLS 或内网 mTLS、Agent 版本上报、工具健康检查、权限控制、审计日志和数据保留策略。

回归与验收门槛：

- 每个阶段完成前必须通过现有单机模式的 `pnpm test`，确保 Android 和 HarmonyOS 已实现测试流程没有回归。
- 涉及设备路由、租约或 Agent Relay 的改动，需要新增本地 adapter 和 mock Agent 双路径测试；同一个 ScriptFlow run 在本地路径和 Agent 路径下应产生等价的步骤结果、截图证据和失败语义。
- Android 验收至少覆盖设备发现、scrcpy 预览/控制、截图 fallback、UI dump、点击/滑动/输入、App monitor、性能采样和 ScriptFlow 执行。
- HarmonyOS 验收至少覆盖设备发现、截图、UI dump、点击/滑动/输入和 ScriptFlow 执行。
- iOS 增强只在对应 capability 开启时参与验收；iOS WDA 不可用不能影响 Android/HarmonyOS 设备列表、运行入口或回归结果。

详细契约见 [ScriptFlow v1](./spec/script-flow-v1.md)。
