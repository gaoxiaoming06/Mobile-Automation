# Agent 设备性能与崩溃监控会话待办需求

> **对于智能体：** 后续实现此需求时，建议使用 TDD。每个任务先补失败测试，再实现。步骤使用复选框 (`- [ ]`) 语法追踪进度。

**目标：** 让通过 device agent 接入的 Android 设备具备和本地直连 Android driver 一致的目标 App 性能监控、崩溃/ANR/process death 检测、报告附件输出能力，并支持多 agent、多设备、多 run 并发时的事件隔离。

**背景：** 当前 agent 设备对外展示 `events.crash/anr/logs=true`，但 server 端 `ServerAgentDeviceDriver.watchDeviceEvents()` 对 agent 设备返回 no-op，`startAppMonitor()` 对 agent 设备直接报不支持。结果是 agent 自动化过程中真实发生 ClassIn 闪退时，报告没有 `crash` 事件，也没有 monitor summary，只会在后续步骤表现为普通定位失败。

**核心结论：** monitor session 必须按 `runId + deviceKey` 隔离。一个 agent 可以同时监控多台设备；限制只发生在同一台设备维度，同一设备同一时间只允许一个 active run monitor。

---

## 问题定义

### 现状问题

- agent Android 设备能力声明了崩溃、ANR、日志能力，但执行链路没有真正接上。
- agent run 期间不会实时监听 logcat crash/ANR/process death。
- agent run 没有完整 Android app monitor session，因此不会输出 CPU/MEM/lifecycle CSV 和 summary JSON。
- 目标 App 崩溃后，如果下一步是 semantic locator，runner 容易把崩溃包装成 `SEMANTIC_TARGET_NOT_FOUND`。
- 报告 `Events = 0` 会误导用户，以为没有闪退。

### 需要解决的用户场景

- 在 agent Android 设备上跑自动化，目标 App 崩溃时，报告必须显示 crash 事件和崩溃栈摘要。
- 一个 agent 连接多台 Android 设备时，不同设备上的 run 可以同时开启监控。
- 多个 agent 同时在线时，事件不能串到别的 agent、设备或 run。
- run 停止、失败、server 断开、agent 断开、设备掉线时，monitor 进程必须被清理。

## 目标与非目标

### 目标

- agent 设备真实支持 `watchDeviceEvents` 或等价的 app monitor incident 上报。
- agent 设备真实支持 `startAppMonitor` / `stopAppMonitor`。
- crash/anr/native crash/process death 能实时写入 `DeviceEvent`。
- `stopOnFailure=true` 时，目标 App runtime failure 应停止 run，并把当前步骤标记为设备运行失败。
- run 结束时写入 Android app monitor CSV/JSON artifact，并在 HTML report 展示。
- capabilities 必须可信：只有真实接通的能力才能声明为 true。

### 非目标

- 不实现 iOS agent 崩溃监控。
- 不把原始 logcat 全量实时推给 server。
- 不允许一个设备同时跑多个自动化任务。
- 不在 ScriptFlow 脚本里增加 crash 监控语义，监控属于执行环境能力。

## 并发与隔离模型

### 允许的并发

```text
agent-a
  android-device-1 -> run-1 -> monitor-session-1
  android-device-2 -> run-2 -> monitor-session-2
  android-device-3 -> run-3 -> monitor-session-3

agent-b
  android-device-4 -> run-4 -> monitor-session-4
```

### 不允许的并发

```text
android-device-1 -> run-1 -> monitor-session-1
android-device-1 -> run-2 -> monitor-session-2
```

同一台设备同时跑两个自动化任务会导致点击、截图、logcat 归属都不可靠，应由设备 lease 或 run 占用机制阻止。

### monitor session key

- `monitorId`: server 生成的不透明 ID。
- `runId`: 运行 ID。
- `deviceKey`: agent 维度设备 key，例如 `agent-local:android:ERLDU20115007395`。
- `localSerial`: agent 本地设备 serial，例如 `ERLDU20115007395`。
- 推荐唯一约束：`deviceKey` 同一时刻最多一个 active monitor；`runId + deviceKey` 唯一。

## 功能需求

### 1. 能力声明真实化

- agent heartbeat 不能盲目透传 `defaultAndroidCapabilities().events=true`。
- 如果 agent 端没有实现事件 watch 或 monitor session，则 `events.crash/anr=false`。
- 如果 agent 端支持 `collectLogs`，可以单独声明 `events.logs=true`。
- Dashboard 和报告只相信实际 capability。

### 2. Agent monitor session manager

- agent 内维护 `Map<monitorId, MonitorSession>`。
- 每个 session 绑定 `runId`、`deviceKey`、`localSerial`、`packageName`。
- 同一 `localSerial` 已有 active run monitor 时，新的 start 请求应失败并说明当前占用的 `runId`。
- session 必须支持幂等 stop。
- session 必须支持 TTL 兜底清理。

### 3. Agent 协议扩展

新增或扩展 agent 命令：

- `startAppMonitor`
  - 输入：`runId`、`monitorId`、`packageName`、采样间隔、阈值、process filters。
  - 输出：启动成功、monitorId、实际配置。
- `stopAppMonitor`
  - 输入：`monitorId`。
  - 输出：summary，包括 samples、incidents、artifact text payload 或可写入内容。
- `getAppMonitorSummary`
  - 输入：`monitorId`。
  - 输出：当前 summary，用于异常恢复或调试。

新增 agent 到 server 的上报消息：

- `appMonitorIncident`
  - 上报 crash/anr/native crash/process death/cpu/memory threshold。
- `appMonitorHeartbeat`
  - 可选，用于确认 session 仍活着。

### 4. Server proxy session

- `ServerAgentDeviceDriver.startAppMonitor()` 对 agent 设备不再抛错。
- server 创建 proxy session，向 agent 发送 `startAppMonitor`。
- proxy session 的 `stop()` 向 agent 发送 `stopAppMonitor` 并返回 summary。
- agent 实时 incident 到达 server 后，server 写入 `DeviceEvent`，并根据 `stopOnFailure` 停止 run。
- `ServerAgentDeviceDriver.watchDeviceEvents()` 对 agent 设备不能再 no-op；可以实现为轻量事件订阅，或者统一由 app monitor incident 覆盖。

### 5. Android agent 端监控实现

- 复用 `@mobile-automation/android-driver` 已有 `AndroidAppMonitorSession`、`AndroidLogcatEventWatcher`、稳定性事件 parser。
- 只实时上报结构化 incident，不实时传全量 logcat。
- crash 命中时保留必要 detail：process、pid、exception、top stack、timestamp。
- stop 时返回 summary，server 负责写 artifacts。

### 6. 报告与 artifact

- run 结束时写入：
  - `android-app-monitor-cpu.csv`
  - `android-app-monitor-memory.csv`
  - `android-app-monitor-lifecycle.csv`
  - `android-app-monitor-summary.json`
- HTML report 显示 Android app monitor 区块。
- crash event 需要能关联当前 `stepResultId`。
- crash detail 需要作为 log artifact 可下载。

### 7. 崩溃兜底识别

即使实时 watcher 漏掉，也应在关键失败点做兜底：

- 每步 after 阶段检查目标 App 是否仍在前台。
- semantic locator 失败前，如果 `startAppPackageName` 存在且前台不属于目标 App，应优先归因为 `app_exit` 或 runtime failure。
- Android 可在 run 时间窗内查询 dropbox/logcat crash，找到目标包崩溃时补写 crash event。

## 非功能需求

- **并发安全：** 不同设备的 monitor session 互不影响。
- **资源限制：** agent 端限制单 agent 最大 active monitors，默认可等于在线 Android 设备数，也可配置上限。
- **回压控制：** 不推全量 logcat，只推 incident；原始详情按 incident 截断。
- **去重：** 用 `timestamp + pid + processName + type + exception/topStack` 去重。
- **清理：** stop、run finish、agent disconnect、server disconnect、device offline、TTL 到期都要释放 adb/logcat 子进程。
- **安全：** shared agent 下，monitor 数据只能回传给拥有该 device lease/run 的 server 流程。
- **时间窗：** 事件必须过滤到 run start 之后，避免旧 crash 污染当前报告。

## 待办任务

### 任务 1：修正能力声明

- [ ] 添加测试：agent Android 未实现 monitor/session 时不能声明 `events.crash/anr=true`。
- [ ] 为 agent capabilities 增加真实能力探测或版本能力字段。
- [ ] Dashboard 设备能力展示使用真实 capability。

### 任务 2：扩展 shared agent 协议类型

- [ ] 在 shared 类型中增加 `startAppMonitor`、`stopAppMonitor`、`getAppMonitorSummary` command。
- [ ] 增加 `appMonitorIncident` 上报消息类型。
- [ ] 增加协议版本兼容处理：老 agent 不支持时 server 明确降级并记录 warning event。

### 任务 3：实现 agent 端 MonitorSessionManager

- [ ] 添加 `MonitorSessionManager` 单元测试。
- [ ] 覆盖同一设备重复 start 拒绝。
- [ ] 覆盖多设备并发 start 成功。
- [ ] 覆盖 stop 幂等。
- [ ] 覆盖 TTL / disconnect 清理。

### 任务 4：接入 Android app monitor 到 agent

- [ ] `LocalDeviceAgentDriver` 暴露 `startAppMonitor`。
- [ ] device-agent command handler 支持 `startAppMonitor` / `stopAppMonitor`。
- [ ] 复用 Android driver watcher 和 monitor session。
- [ ] incident 实时上报 server。

### 任务 5：server agent driver proxy

- [ ] `ServerAgentDeviceDriver.startAppMonitor()` 对 agent 设备创建 proxy session。
- [ ] `ServerAgentDeviceDriver.watchDeviceEvents()` 不再对 agent 设备 no-op。
- [ ] proxy session stop 时拉取 summary。
- [ ] agent incident 写入 pending event queue，支持当前 stepResultId 关联。

### 任务 6：runner runtime failure 归因

- [ ] agent crash incident 到达时设置 `runtimeFailure=true`。
- [ ] `stopOnFailure=true` 时停止 run。
- [ ] 当前步骤标记为 `DEVICE_EVENT_FAILED`，错误文案指向 crash/anr。
- [ ] semantic locator 失败前检查 target app foreground，避免 crash 被包装成普通定位失败。

### 任务 7：artifact 与报告

- [ ] server 写入 agent monitor CSV/JSON artifact。
- [ ] report-core 显示 agent monitor summary。
- [ ] report 中 crash event 显示 exception、process、top stack 摘要。
- [ ] Dashboard run results 展示 monitor 状态和 crash 事件。

### 任务 8：回归测试与并发测试

- [ ] 单 agent 单 Android 设备 crash run：报告出现 crash event。
- [ ] 单 agent 多 Android 设备并发 run：每个 run 只收到自己设备事件。
- [ ] 多 agent 多设备并发 run：事件不串线。
- [ ] run stop / agent disconnect 后没有残留 adb logcat 子进程。
- [ ] 旧 agent 不支持 monitor 时，capability 和 warning 表现一致。

## 验收标准

- agent Android 设备发生目标 App Java crash 时，run 报告必须出现 `crash` event。
- crash event 必须关联到发生时的 active step。
- `stopOnFailure=true` 时，run 停止并显示目标 App runtime failure，不显示成普通定位失败。
- 同一个 agent 下 N 台 Android 设备可以同时运行 N 个 monitor session。
- 同一台设备重复启动第二个 active monitor 会失败并提示占用 run。
- run 结束后 artifacts 中包含 Android app monitor summary 和 CSV。
- agent 或 server 异常断开后，monitor 子进程不会残留。

## 风险与开放问题

- 老 agent 版本兼容：需要明确 dashboard 是否提示“agent 需升级”。
- logcat 权限差异：部分 Android 设备可能无法读到完整 crash buffer，需要 dropbox 兜底。
- 时间同步：server 和 agent 机器时间可能有偏差，事件时间窗过滤应优先使用 agent 本地 run start 时间。
- 大规模并发：需要配置 agent 最大 monitor 数和 incident detail 截断长度。
- 隐私：日志 detail 需要截断，后续可加敏感字段脱敏。
