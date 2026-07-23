# Android App 旁路性能与稳定性监控实现方案

> **对于智能体：** 必需子技能：使用 superpowers:subagent-driven-development (推荐) 或 superpowers:executing-plans 来逐个任务执行此方案。步骤使用复选框 (`- [ ]`) 语法进行进度追踪。

**目标：** 在现有移动端自动化平台中新增 Android 目标 App 级旁路 watcher，按包名自动监控主进程和子进程的 CPU / PSS、进程生命周期、阈值 incident、Java / Native Crash、ANR 和 process death，并把摘要与证据接入 Run 报告。

**架构：** 旁路 watcher 放在 `@mobile-automation/android-driver` 内核中，Runner 只负责按 RunConfig 启停 session 与接收事件。高频时序写入 Run artifact，数据库保留摘要、DeviceEvent 和 ArtifactRef，Report Core / Dashboard 只消费 shared summary，不直接解析 ADB 原始输出。

**技术栈：** TypeScript、Node.js、ADB shell、Vitest、SQLite ArtifactRef、现有 Report Core、现有 React Dashboard。

---

## 背景与边界

本方案吸收 `apk_auto_test` 中值得借鉴的旁路监控思路：包名多进程发现、进程级 CPU / PSS、sustain / cooldown 阈值状态机、incident 现场证据、logcat 稳定性事件和 HTML 报告摘要。长期实现不把 Python CLI 作为平台主路径；第一版可以保留外部工具产出的报告作为调研证据，但产品实现必须落入本仓 TypeScript 代码和现有 Run 体系。

不纳入本方案的内容：iOS 目标进程监控、网络流量精确归因、FPS / Jank、后台常驻服务管理、自动提交真实 TAPD 缺陷、默认 heap dump。heap dump 只作为显式开启的高成本证据动作。

## 文件结构

- 修改：`platform/packages/shared/src/index.ts`
  新增 `AndroidAppMonitorConfig`、`AndroidProcessInfo`、`AndroidProcessMetricSample`、`AndroidProcessLifecycleEvent`、`AndroidAppMonitorIncident`、`AndroidAppMonitorSummary`，并扩展 `RunConfig` 与 `DeviceEvent["type"]`。
- 修改：`platform/packages/shared/src/index.test.ts`
  覆盖监控配置默认值和 JSON 可序列化。
- 创建：`platform/packages/android-driver/src/android-process-discovery.ts`
  负责 `ps` / `dumpsys activity processes` / `/proc/<pid>/cmdline` 的进程发现和过滤。
- 创建：`platform/packages/android-driver/src/android-process-discovery.test.ts`
  覆盖主进程、子进程、截断 cmdline 校验和过滤器。
- 创建：`platform/packages/android-driver/src/android-process-metrics.ts`
  负责 `/proc/stat`、`/proc/<pid>/stat`、`dumpsys meminfo` 的进程级指标采样。
- 创建：`platform/packages/android-driver/src/android-process-metrics.test.ts`
  覆盖 CPU 差分、PSS 解析和进程消失。
- 创建：`platform/packages/android-driver/src/android-thresholds.ts`
  负责 sustain / cooldown 阈值状态机。
- 创建：`platform/packages/android-driver/src/android-thresholds.test.ts`
  覆盖短尖峰、持续超阈、冷却合并和恢复。
- 创建：`platform/packages/android-driver/src/android-incident-dumper.ts`
  负责 CPU / 内存 incident 的现场证据采集。
- 创建：`platform/packages/android-driver/src/android-incident-dumper.test.ts`
  覆盖 `top -H`、`/proc/<pid>/task` fallback、`dumpsys meminfo -d` 和 heap dump 默认关闭。
- 创建：`platform/packages/android-driver/src/android-stability-events.ts`
  负责 Java Crash、Native Crash、ANR、process death 的解析、归属和去重。
- 创建：`platform/packages/android-driver/src/android-stability-events.test.ts`
  覆盖四类稳定性事件和目标包过滤。
- 创建：`platform/packages/android-driver/src/android-app-monitor.ts`
  负责编排进程发现、采样循环、logcat watcher、artifact writer、incident dumper 和 stop / flush 生命周期。
- 创建：`platform/packages/android-driver/src/android-app-monitor.test.ts`
  覆盖 session 启停、artifact 输出、事件回调、采样失败和重复 stop。
- 修改：`platform/packages/android-driver/src/index.ts`、`platform/apps/server/src/mobile-driver.ts`
  暴露 `startAppMonitor` 能力，iOS 返回 unsupported watcher。
- 修改：`platform/apps/server/src/run-artifact-service.ts`
  新增 metrics artifact 写入方法，复用现有 artifact root 和 URL。
- 修改：`platform/apps/server/src/automation-runner.ts`、`platform/apps/server/src/graph-run-service.ts`、`platform/apps/server/src/asset-patrol.ts`、`platform/apps/server/src/stability-explorer.ts`
  在 Run 生命周期中启动 / 停止 monitor，并把事件关联到当前 step。
- 修改：`platform/apps/server/src/automation-runner.test.ts`、`platform/apps/server/src/graph-run-service.test.ts`、`platform/apps/server/src/asset-patrol.test.ts`、`platform/apps/server/src/stability-explorer.test.ts`
  覆盖 RunConfig 透传、finally stop、事件入库和报告生成。
- 修改：`platform/packages/report-core/src/index.ts`、`platform/packages/report-core/src/report-core.test.ts`
  新增“目标 App 旁路监控”报告区块。
- 修改：`platform/apps/dashboard/src/App.tsx`、`platform/apps/dashboard/src/App.test.ts`
  执行配置、资产巡检和稳定性探索入口展示监控开关、阈值、采样间隔和进程过滤。

## 任务 1：Shared 配置与结果模型

**文件：**
- 修改：`platform/packages/shared/src/index.ts`
- 修改：`platform/packages/shared/src/index.test.ts`

- [ ] **步骤 1：编写失败的配置默认值测试**

在 `platform/packages/shared/src/index.test.ts` 追加：

```ts
import { describe, expect, it } from "vitest";
import { normalizeAndroidAppMonitorConfig } from "./index.js";

describe("normalizeAndroidAppMonitorConfig", () => {
  it("enables lightweight app monitoring defaults", () => {
    expect(normalizeAndroidAppMonitorConfig({ enabled: true, packageName: "cn.eeo.classin" })).toMatchObject({
      enabled: true,
      packageName: "cn.eeo.classin",
      includeSubprocesses: true,
      cpuIntervalMs: 1000,
      memoryIntervalMs: 5000,
      lifecycleIntervalMs: 2000,
      enableHeapDump: false
    });
  });

  it("keeps explicit process filters and threshold windows", () => {
    const config = normalizeAndroidAppMonitorConfig({
      enabled: true,
      packageName: "cn.eeo.classin",
      processFilters: ["main", ":privileged_process0"],
      thresholds: {
        cpuPercent: { enabled: true, value: 80, sustainMs: 15000, cooldownMs: 60000 },
        pssMb: { enabled: true, value: 700, sustainMs: 30000, cooldownMs: 120000 }
      }
    });

    expect(config.processFilters).toEqual(["main", ":privileged_process0"]);
    expect(config.thresholds.cpuPercent?.sustainMs).toBe(15000);
    expect(config.thresholds.pssMb?.cooldownMs).toBe(120000);
  });
});
```

- [ ] **步骤 2：运行测试以验证失败**

运行：`pnpm exec vitest run platform/packages/shared/src/index.test.ts -t "normalizeAndroidAppMonitorConfig"`

预期：失败，提示 `normalizeAndroidAppMonitorConfig` 未导出。

- [ ] **步骤 3：实现 shared 类型与默认值归一化**

在 `platform/packages/shared/src/index.ts` 中加入：

```ts
export type AndroidAppMonitorThreshold = {
  enabled: boolean;
  value: number;
  sustainMs: number;
  cooldownMs: number;
};

export type AndroidAppMonitorConfig = {
  enabled: boolean;
  packageName: string;
  includeSubprocesses?: boolean;
  processFilters?: string[];
  cpuIntervalMs?: number;
  memoryIntervalMs?: number;
  lifecycleIntervalMs?: number;
  enableHeapDump?: boolean;
  thresholds?: {
    cpuPercent?: AndroidAppMonitorThreshold;
    pssMb?: AndroidAppMonitorThreshold;
  };
};

export type NormalizedAndroidAppMonitorConfig = Required<
  Omit<AndroidAppMonitorConfig, "processFilters" | "thresholds">
> & {
  processFilters: string[];
  thresholds: {
    cpuPercent?: AndroidAppMonitorThreshold;
    pssMb?: AndroidAppMonitorThreshold;
  };
};

export function normalizeAndroidAppMonitorConfig(config: AndroidAppMonitorConfig): NormalizedAndroidAppMonitorConfig {
  return {
    enabled: config.enabled,
    packageName: config.packageName,
    includeSubprocesses: config.includeSubprocesses ?? true,
    processFilters: config.processFilters ?? [],
    cpuIntervalMs: config.cpuIntervalMs ?? 1000,
    memoryIntervalMs: config.memoryIntervalMs ?? 5000,
    lifecycleIntervalMs: config.lifecycleIntervalMs ?? 2000,
    enableHeapDump: config.enableHeapDump ?? false,
    thresholds: config.thresholds ?? {}
  };
}

export type AndroidProcessInfo = {
  pid: number;
  processName: string;
  packageName: string;
  isMainProcess: boolean;
  discoveredAt: string;
};

export type AndroidProcessMetricSample = {
  sampledAt: string;
  pid: number;
  processName: string;
  cpuPercent?: number;
  pssKb?: number;
  rssKb?: number;
  raw?: Record<string, unknown>;
};

export type AndroidProcessLifecycleEvent = {
  occurredAt: string;
  type: "process_started" | "process_exited" | "process_restarted";
  pid?: number;
  previousPid?: number;
  processName: string;
};

export type AndroidAppMonitorIncident = {
  id: string;
  type: "cpu_threshold" | "memory_threshold" | "java_crash" | "native_crash" | "anr" | "process_death";
  severity: "info" | "warning" | "error";
  occurredAt: string;
  processName?: string;
  pid?: number;
  summary: string;
  detail?: string;
  artifactIds: string[];
  metadata?: Record<string, unknown>;
};

export type AndroidAppMonitorSummary = {
  packageName: string;
  startedAt: string;
  endedAt?: string;
  processes: AndroidProcessInfo[];
  sampleCounts: {
    cpu: number;
    memory: number;
    lifecycle: number;
  };
  incidents: AndroidAppMonitorIncident[];
  artifacts: {
    cpuCsvArtifactId?: string;
    memoryCsvArtifactId?: string;
    lifecycleCsvArtifactId?: string;
    summaryJsonArtifactId?: string;
  };
};
```

扩展 `RunConfig`：

```ts
export type RunConfig = {
  // 保留现有字段
  androidAppMonitor?: AndroidAppMonitorConfig;
};
```

扩展 `DeviceEvent["type"]` 联合类型：

```ts
| "native_crash"
| "process_death"
| "performance_threshold"
| "android_app_monitor"
```

- [ ] **步骤 4：运行 shared 测试**

运行：`pnpm exec vitest run platform/packages/shared/src/index.test.ts -t "normalizeAndroidAppMonitorConfig"`

预期：通过。

- [ ] **步骤 5：提交代码**

```bash
git add platform/packages/shared/src/index.ts platform/packages/shared/src/index.test.ts
git commit -m "feat: add android app monitor shared model"
```

## 任务 2：Android 进程发现

**文件：**
- 创建：`platform/packages/android-driver/src/android-process-discovery.ts`
- 创建：`platform/packages/android-driver/src/android-process-discovery.test.ts`
- 修改：`platform/packages/android-driver/src/index.ts`

- [ ] **步骤 1：编写失败的多进程发现测试**

在 `platform/packages/android-driver/src/android-process-discovery.test.ts` 写入：

```ts
import { describe, expect, it } from "vitest";
import { AndroidProcessDiscovery } from "./android-process-discovery.js";

describe("AndroidProcessDiscovery", () => {
  it("discovers main and package subprocesses using cmdline verification", async () => {
    const shell = async (_serial: string, args: string[]) => {
      const command = args.join(" ");
      if (command.includes("ps")) {
        return [
          "USER PID PPID VSZ RSS WCHAN ADDR S NAME",
          "u0_a123 2665 601 123 456 0 0 S cn.eeo.classin",
          "u0_a123 3769 601 123 456 0 0 S cn.eeo.classin:priv"
        ].join("\n");
      }
      if (command.includes("/proc/2665/cmdline")) return "cn.eeo.classin\\0";
      if (command.includes("/proc/3769/cmdline")) return "cn.eeo.classin:privileged_process0\\0";
      return "";
    };

    const discovery = new AndroidProcessDiscovery({ shell });
    const processes = await discovery.discover("device-1", "cn.eeo.classin", {
      includeSubprocesses: true,
      processFilters: []
    });

    expect(processes.map((item) => item.processName)).toEqual(["cn.eeo.classin", "cn.eeo.classin:privileged_process0"]);
    expect(processes[0]?.isMainProcess).toBe(true);
    expect(processes[1]?.isMainProcess).toBe(false);
  });

  it("applies main and suffix process filters", async () => {
    const shell = async (_serial: string, args: string[]) => {
      const command = args.join(" ");
      if (command.includes("ps")) {
        return "u0_a123 1 0 0 0 0 0 S cn.eeo.classin\nu0_a123 2 0 0 0 0 0 S cn.eeo.classin:privileged_process0";
      }
      if (command.includes("/proc/1/cmdline")) return "cn.eeo.classin\\0";
      if (command.includes("/proc/2/cmdline")) return "cn.eeo.classin:privileged_process0\\0";
      return "";
    };

    const discovery = new AndroidProcessDiscovery({ shell });
    const processes = await discovery.discover("device-1", "cn.eeo.classin", {
      includeSubprocesses: true,
      processFilters: [":privileged_process0"]
    });

    expect(processes).toHaveLength(1);
    expect(processes[0]?.processName).toBe("cn.eeo.classin:privileged_process0");
  });
});
```

- [ ] **步骤 2：运行测试以验证失败**

运行：`pnpm exec vitest run platform/packages/android-driver/src/android-process-discovery.test.ts`

预期：失败，提示找不到 `android-process-discovery.js`。

- [ ] **步骤 3：实现进程发现**

在 `platform/packages/android-driver/src/android-process-discovery.ts` 写入：

```ts
import { nowIso, type AndroidProcessInfo } from "@mobile-automation/shared";
import type { AndroidShellExecutor } from "./android-actions.js";

export type AndroidProcessDiscoveryOptions = {
  shell: AndroidShellExecutor;
};

export type AndroidProcessDiscoveryFilter = {
  includeSubprocesses: boolean;
  processFilters: string[];
};

export class AndroidProcessDiscovery {
  constructor(private readonly options: AndroidProcessDiscoveryOptions) {}

  async discover(serial: string, packageName: string, filter: AndroidProcessDiscoveryFilter): Promise<AndroidProcessInfo[]> {
    const candidates = parsePsOutput(await this.safeShell(serial, ["ps", "-A", "-o", "PID,NAME"]));
    const fallback = candidates.length ? candidates : parsePsOutput(await this.safeShell(serial, ["ps"]));
    const verified = await Promise.all(
      fallback.map(async (candidate) => ({
        pid: candidate.pid,
        processName: (await this.readCmdline(serial, candidate.pid)) || candidate.processName
      }))
    );

    return verified
      .filter((candidate) => isPackageProcess(candidate.processName, packageName, filter.includeSubprocesses))
      .filter((candidate) => matchesProcessFilter(candidate.processName, packageName, filter.processFilters))
      .map((candidate) => ({
        pid: candidate.pid,
        processName: candidate.processName,
        packageName,
        isMainProcess: candidate.processName === packageName,
        discoveredAt: nowIso()
      }));
  }

  private async readCmdline(serial: string, pid: number): Promise<string | undefined> {
    const raw = await this.safeShell(serial, ["cat", `/proc/${pid}/cmdline`]);
    return raw.replace(/\0/g, "").trim() || undefined;
  }

  private async safeShell(serial: string, args: string[]): Promise<string> {
    return this.options.shell(serial, args, { timeoutMs: 5000 }).catch(() => "");
  }
}

export function parsePsOutput(output: string): Array<{ pid: number; processName: string }> {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^USER\s+PID\b/.test(line) && !/^PID\s+/.test(line))
    .map((line) => {
      const parts = line.split(/\s+/);
      const pidIndex = parts.findIndex((part) => /^\d+$/.test(part));
      const pid = Number(parts[pidIndex]);
      const processName = parts.at(-1) ?? "";
      return Number.isFinite(pid) && processName ? { pid, processName } : undefined;
    })
    .filter((item): item is { pid: number; processName: string } => Boolean(item));
}

export function isPackageProcess(processName: string, packageName: string, includeSubprocesses: boolean): boolean {
  return processName === packageName || (includeSubprocesses && processName.startsWith(`${packageName}:`));
}

export function matchesProcessFilter(processName: string, packageName: string, filters: string[]): boolean {
  if (!filters.length) return true;
  return filters.some((filter) => {
    if (filter === "main") return processName === packageName;
    if (filter.startsWith(":")) return processName === `${packageName}${filter}`;
    return processName === filter;
  });
}
```

在 `platform/packages/android-driver/src/index.ts` 导出：

```ts
export { AndroidProcessDiscovery } from "./android-process-discovery.js";
export type { AndroidProcessDiscoveryFilter } from "./android-process-discovery.js";
```

- [ ] **步骤 4：运行进程发现测试**

运行：`pnpm exec vitest run platform/packages/android-driver/src/android-process-discovery.test.ts`

预期：通过。

- [ ] **步骤 5：提交代码**

```bash
git add platform/packages/android-driver/src/android-process-discovery.ts platform/packages/android-driver/src/android-process-discovery.test.ts platform/packages/android-driver/src/index.ts
git commit -m "feat: discover android app processes"
```

## 任务 3：进程级 CPU / PSS 采样与阈值状态机

**文件：**
- 创建：`platform/packages/android-driver/src/android-process-metrics.ts`
- 创建：`platform/packages/android-driver/src/android-process-metrics.test.ts`
- 创建：`platform/packages/android-driver/src/android-thresholds.ts`
- 创建：`platform/packages/android-driver/src/android-thresholds.test.ts`

- [ ] **步骤 1：编写失败的 CPU / PSS 采样测试**

在 `platform/packages/android-driver/src/android-process-metrics.test.ts` 写入：

```ts
import { describe, expect, it } from "vitest";
import { AndroidProcessMetricSampler } from "./android-process-metrics.js";

describe("AndroidProcessMetricSampler", () => {
  it("calculates per-process cpu percent from proc deltas", async () => {
    let tick = 0;
    const shell = async (_serial: string, args: string[]) => {
      const path = args.at(-1);
      if (path === "/proc/stat") return tick++ === 0 ? "cpu  100 0 0 900 0 0 0 0 0 0" : "cpu  140 0 0 960 0 0 0 0 0 0";
      if (path === "/proc/2665/stat") {
        return tick < 2
          ? "2665 (cn.eeo.classin) S 1 1 1 0 0 0 0 0 0 20 10 0 0 20 0 1 0 0 0 0"
          : "2665 (cn.eeo.classin) S 1 1 1 0 0 0 0 0 0 40 20 0 0 20 0 1 0 0 0 0";
      }
      return "";
    };

    const sampler = new AndroidProcessMetricSampler({ shell, sleep: async () => undefined });
    const sample = await sampler.sampleCpu("device-1", { pid: 2665, processName: "cn.eeo.classin", packageName: "cn.eeo.classin", isMainProcess: true, discoveredAt: "2026-07-22T00:00:00.000Z" });

    expect(sample.cpuPercent).toBeCloseTo(30);
  });

  it("parses total pss from dumpsys meminfo", async () => {
    const shell = async () => "TOTAL PSS: 528864K\nApp Summary\nJava Heap: 12000\nNative Heap: 34000\n";
    const sampler = new AndroidProcessMetricSampler({ shell, sleep: async () => undefined });

    const sample = await sampler.sampleMemory("device-1", { pid: 2665, processName: "cn.eeo.classin", packageName: "cn.eeo.classin", isMainProcess: true, discoveredAt: "2026-07-22T00:00:00.000Z" });

    expect(sample.pssKb).toBe(528864);
    expect(sample.raw?.appSummary).toMatchObject({ javaHeapKb: 12000, nativeHeapKb: 34000 });
  });
});
```

- [ ] **步骤 2：编写失败的阈值状态机测试**

在 `platform/packages/android-driver/src/android-thresholds.test.ts` 写入：

```ts
import { describe, expect, it } from "vitest";
import { ThresholdTracker } from "./android-thresholds.js";

describe("ThresholdTracker", () => {
  it("fires only after sustained threshold breach", () => {
    const tracker = new ThresholdTracker({ enabled: true, value: 500, sustainMs: 3000, cooldownMs: 10000 });

    expect(tracker.observe(499, 0)).toBeUndefined();
    expect(tracker.observe(520, 1000)).toBeUndefined();
    expect(tracker.observe(530, 2500)).toBeUndefined();
    expect(tracker.observe(540, 4000)).toMatchObject({ startedAtMs: 1000, triggeredAtMs: 4000, peakValue: 540 });
  });

  it("merges repeated breaches during cooldown", () => {
    const tracker = new ThresholdTracker({ enabled: true, value: 80, sustainMs: 1000, cooldownMs: 5000 });

    expect(tracker.observe(90, 0)).toBeUndefined();
    const first = tracker.observe(91, 1200);
    expect(first).toBeDefined();
    expect(tracker.observe(95, 2500)).toBeUndefined();
    expect(tracker.observe(96, 7500)).toMatchObject({ peakValue: 96 });
  });
});
```

- [ ] **步骤 3：运行测试以验证失败**

运行：`pnpm exec vitest run platform/packages/android-driver/src/android-process-metrics.test.ts platform/packages/android-driver/src/android-thresholds.test.ts`

预期：失败，提示新模块不存在。

- [ ] **步骤 4：实现采样器和阈值状态机**

在 `platform/packages/android-driver/src/android-thresholds.ts` 写入：

```ts
import type { AndroidAppMonitorThreshold } from "@mobile-automation/shared";

export type ThresholdBreach = {
  startedAtMs: number;
  triggeredAtMs: number;
  value: number;
  peakValue: number;
};

export class ThresholdTracker {
  private breachStartedAtMs?: number;
  private lastIncidentAtMs?: number;
  private peakValue = Number.NEGATIVE_INFINITY;

  constructor(private readonly config: AndroidAppMonitorThreshold) {}

  observe(value: number | undefined, observedAtMs: number): ThresholdBreach | undefined {
    if (!this.config.enabled || value === undefined || value < this.config.value) {
      this.breachStartedAtMs = undefined;
      this.peakValue = Number.NEGATIVE_INFINITY;
      return undefined;
    }

    this.breachStartedAtMs ??= observedAtMs;
    this.peakValue = Math.max(this.peakValue, value);
    const sustained = observedAtMs - this.breachStartedAtMs >= this.config.sustainMs;
    const cooledDown = this.lastIncidentAtMs === undefined || observedAtMs - this.lastIncidentAtMs >= this.config.cooldownMs;
    if (!sustained || !cooledDown) {
      return undefined;
    }

    this.lastIncidentAtMs = observedAtMs;
    return {
      startedAtMs: this.breachStartedAtMs,
      triggeredAtMs: observedAtMs,
      value,
      peakValue: this.peakValue
    };
  }
}
```

在 `platform/packages/android-driver/src/android-process-metrics.ts` 写入核心结构：

```ts
import { nowIso, type AndroidProcessInfo, type AndroidProcessMetricSample } from "@mobile-automation/shared";
import type { AndroidShellExecutor } from "./android-actions.js";

export type AndroidProcessMetricSamplerOptions = {
  shell: AndroidShellExecutor;
  sleep?: (ms: number) => Promise<void>;
};

export class AndroidProcessMetricSampler {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: AndroidProcessMetricSamplerOptions) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async sampleCpu(serial: string, process: AndroidProcessInfo): Promise<AndroidProcessMetricSample> {
    const firstTotal = parseSystemCpu(await this.options.shell(serial, ["cat", "/proc/stat"], { timeoutMs: 5000 }));
    const firstProcess = parseProcessCpu(await this.options.shell(serial, ["cat", `/proc/${process.pid}/stat`], { timeoutMs: 5000 }));
    await this.sleep(250);
    const secondTotal = parseSystemCpu(await this.options.shell(serial, ["cat", "/proc/stat"], { timeoutMs: 5000 }));
    const secondProcess = parseProcessCpu(await this.options.shell(serial, ["cat", `/proc/${process.pid}/stat`], { timeoutMs: 5000 }));
    const totalDelta = secondTotal - firstTotal;
    const processDelta = secondProcess - firstProcess;

    return {
      sampledAt: nowIso(),
      pid: process.pid,
      processName: process.processName,
      cpuPercent: totalDelta > 0 ? Math.max(0, (processDelta / totalDelta) * 100) : undefined
    };
  }

  async sampleMemory(serial: string, process: AndroidProcessInfo): Promise<AndroidProcessMetricSample> {
    const raw = await this.options.shell(serial, ["dumpsys", "meminfo", String(process.pid)], { timeoutMs: 10000 });
    return {
      sampledAt: nowIso(),
      pid: process.pid,
      processName: process.processName,
      pssKb: parseTotalPssKb(raw),
      raw: {
        appSummary: parseAppSummary(raw)
      }
    };
  }
}

export function parseSystemCpu(line: string): number {
  return line
    .split(/\s+/)
    .slice(1)
    .map(Number)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
}

export function parseProcessCpu(stat: string): number {
  const afterName = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
  return Number(afterName[11] ?? 0) + Number(afterName[12] ?? 0);
}

export function parseTotalPssKb(output: string): number | undefined {
  const match = output.match(/TOTAL\s+PSS:\s*(\d+)K/i) ?? output.match(/TOTAL\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

export function parseAppSummary(output: string): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(Java Heap|Native Heap|Code|Stack|Graphics|Private Other|System):\s*(\d+)/);
    if (!match) continue;
    const key = match[1].replace(/\s+(\w)/g, (_, char: string) => char.toUpperCase()).replace(/^./, (char) => char.toLowerCase());
    summary[`${key}Kb`] = Number(match[2]);
  }
  return summary;
}
```

- [ ] **步骤 5：运行采样与阈值测试**

运行：`pnpm exec vitest run platform/packages/android-driver/src/android-process-metrics.test.ts platform/packages/android-driver/src/android-thresholds.test.ts`

预期：通过。

- [ ] **步骤 6：提交代码**

```bash
git add platform/packages/android-driver/src/android-process-metrics.ts platform/packages/android-driver/src/android-process-metrics.test.ts platform/packages/android-driver/src/android-thresholds.ts platform/packages/android-driver/src/android-thresholds.test.ts
git commit -m "feat: sample android process metrics"
```

## 任务 4：Incident 证据与稳定性事件解析

**文件：**
- 创建：`platform/packages/android-driver/src/android-incident-dumper.ts`
- 创建：`platform/packages/android-driver/src/android-incident-dumper.test.ts`
- 创建：`platform/packages/android-driver/src/android-stability-events.ts`
- 创建：`platform/packages/android-driver/src/android-stability-events.test.ts`
- 修改：`platform/packages/android-driver/src/android-events.ts`
- 修改：`platform/packages/android-driver/src/android-events.test.ts`

- [ ] **步骤 1：编写失败的 incident dumper 测试**

在 `platform/packages/android-driver/src/android-incident-dumper.test.ts` 写入：

```ts
import { describe, expect, it } from "vitest";
import { AndroidIncidentDumper } from "./android-incident-dumper.js";

describe("AndroidIncidentDumper", () => {
  it("captures top -H for cpu incidents", async () => {
    const writes: Array<{ fileName: string; content: string }> = [];
    const dumper = new AndroidIncidentDumper({
      shell: async () => "2665  42% RenderThread",
      writeTextArtifact: async (_runId, fileName, content) => {
        writes.push({ fileName, content });
        return { id: "artifact_cpu_threads" };
      }
    });

    const artifactIds = await dumper.dumpCpuIncident("run-1", "device-1", { pid: 2665, processName: "cn.eeo.classin" });

    expect(artifactIds).toEqual(["artifact_cpu_threads"]);
    expect(writes[0]?.fileName).toContain("cpu-threads-2665");
    expect(writes[0]?.content).toContain("RenderThread");
  });

  it("does not dump heap when heap dump is disabled", async () => {
    const shellCalls: string[] = [];
    const dumper = new AndroidIncidentDumper({
      shell: async (_serial, args) => {
        shellCalls.push(args.join(" "));
        return "TOTAL PSS: 528864K";
      },
      writeTextArtifact: async () => ({ id: "artifact_meminfo" })
    });

    await dumper.dumpMemoryIncident("run-1", "device-1", { pid: 2665, processName: "cn.eeo.classin" }, { enableHeapDump: false });

    expect(shellCalls.some((call) => call.includes("am dumpheap"))).toBe(false);
  });
});
```

- [ ] **步骤 2：编写失败的稳定性事件解析测试**

在 `platform/packages/android-driver/src/android-stability-events.test.ts` 写入：

```ts
import { describe, expect, it } from "vitest";
import { AndroidStabilityEventParser } from "./android-stability-events.js";

describe("AndroidStabilityEventParser", () => {
  it("parses java crash for target package", () => {
    const parser = new AndroidStabilityEventParser({ packageName: "cn.eeo.classin" });
    const event = parser.observe("07-22 17:28:31.000 E AndroidRuntime: FATAL EXCEPTION: main", [
      "07-22 17:28:31.001 E AndroidRuntime: Process: cn.eeo.classin, PID: 2665",
      "07-22 17:28:31.002 E AndroidRuntime: java.lang.IllegalStateException: boom"
    ]);

    expect(event).toMatchObject({
      type: "java_crash",
      severity: "error",
      processName: "cn.eeo.classin"
    });
  });

  it("deduplicates repeated ANR lines in the same window", () => {
    const parser = new AndroidStabilityEventParser({ packageName: "cn.eeo.classin", dedupeWindowMs: 3000 });

    const first = parser.observe("07-22 17:28:32.000 I ActivityManager: ANR in cn.eeo.classin", []);
    const second = parser.observe("07-22 17:28:32.500 I ActivityManager: ANR in cn.eeo.classin", []);

    expect(first?.type).toBe("anr");
    expect(second).toBeUndefined();
  });
});
```

- [ ] **步骤 3：运行测试以验证失败**

运行：`pnpm exec vitest run platform/packages/android-driver/src/android-incident-dumper.test.ts platform/packages/android-driver/src/android-stability-events.test.ts`

预期：失败，提示新模块不存在。

- [ ] **步骤 4：实现 incident dumper 与 parser**

在 `platform/packages/android-driver/src/android-incident-dumper.ts` 写入：

```ts
import type { AndroidShellExecutor } from "./android-actions.js";

type ProcessRef = { pid: number; processName: string };
type ArtifactWriter = (runId: string, fileName: string, content: string) => Promise<{ id: string }>;

export class AndroidIncidentDumper {
  constructor(private readonly options: { shell: AndroidShellExecutor; writeTextArtifact: ArtifactWriter }) {}

  async dumpCpuIncident(runId: string, serial: string, process: ProcessRef): Promise<string[]> {
    const top = await this.options.shell(serial, ["top", "-H", "-b", "-n", "1", "-p", String(process.pid)], { timeoutMs: 8000 }).catch(async () => {
      return this.options.shell(serial, ["ls", "-la", `/proc/${process.pid}/task`], { timeoutMs: 5000 });
    });
    const artifact = await this.options.writeTextArtifact(runId, `cpu-threads-${process.pid}-${Date.now()}.txt`, top);
    return [artifact.id];
  }

  async dumpMemoryIncident(runId: string, serial: string, process: ProcessRef, config: { enableHeapDump: boolean }): Promise<string[]> {
    const artifactIds: string[] = [];
    const meminfo = await this.options.shell(serial, ["dumpsys", "meminfo", "-d", String(process.pid)], { timeoutMs: 12000 });
    artifactIds.push((await this.options.writeTextArtifact(runId, `meminfo-${process.pid}-${Date.now()}.txt`, meminfo)).id);
    if (config.enableHeapDump) {
      const hprofResult = await this.options.shell(serial, ["am", "dumpheap", String(process.pid), `/sdcard/${process.pid}.hprof`], { timeoutMs: 30000 }).catch((error) => String(error));
      artifactIds.push((await this.options.writeTextArtifact(runId, `heapdump-${process.pid}-${Date.now()}.txt`, hprofResult)).id);
    }
    return artifactIds;
  }
}
```

在 `platform/packages/android-driver/src/android-stability-events.ts` 写入：

```ts
import { nowIso } from "@mobile-automation/shared";

export type AndroidStabilityEvent = {
  type: "java_crash" | "native_crash" | "anr" | "process_death";
  severity: "error" | "warning";
  occurredAt: string;
  processName?: string;
  pid?: number;
  summary: string;
  detail: string;
};

export class AndroidStabilityEventParser {
  private readonly emittedAtBySignature = new Map<string, number>();
  private readonly dedupeWindowMs: number;

  constructor(private readonly options: { packageName: string; dedupeWindowMs?: number }) {
    this.dedupeWindowMs = options.dedupeWindowMs ?? 3000;
  }

  observe(line: string, recentLines: string[]): AndroidStabilityEvent | undefined {
    const detail = [line, ...recentLines].join("\n");
    const event = parseStabilityLine(this.options.packageName, line, detail);
    if (!event) return undefined;
    const signature = `${event.type}:${event.processName ?? this.options.packageName}:${event.summary}`;
    const now = Date.now();
    const last = this.emittedAtBySignature.get(signature) ?? 0;
    if (now - last < this.dedupeWindowMs) return undefined;
    this.emittedAtBySignature.set(signature, now);
    return event;
  }
}

export function parseStabilityLine(packageName: string, line: string, detail: string): AndroidStabilityEvent | undefined {
  if (line.includes("FATAL EXCEPTION") && detail.includes(`Process: ${packageName}`)) {
    return { type: "java_crash", severity: "error", occurredAt: nowIso(), processName: extractProcess(detail, packageName), summary: `Java crash in ${packageName}`, detail };
  }
  if (/DEBUG\s*: signal \d+/.test(line) && detail.includes(packageName)) {
    return { type: "native_crash", severity: "error", occurredAt: nowIso(), processName: extractProcess(detail, packageName), summary: `Native crash in ${packageName}`, detail };
  }
  if (line.includes(`ANR in ${packageName}`)) {
    return { type: "anr", severity: "error", occurredAt: nowIso(), processName: packageName, summary: `ANR in ${packageName}`, detail };
  }
  if (line.includes("Process") && line.includes(packageName) && /has died|died|ProcessRecord/.test(line)) {
    return { type: "process_death", severity: "warning", occurredAt: nowIso(), processName: extractProcess(detail, packageName), summary: `Process death in ${packageName}`, detail };
  }
  return undefined;
}

function extractProcess(detail: string, fallback: string): string {
  return detail.match(/Process:\s*([^,\s]+)/)?.[1] ?? detail.match(/ANR in ([^,\s]+)/)?.[1] ?? fallback;
}
```

- [ ] **步骤 5：接入现有 logcat watcher**

在 `platform/packages/android-driver/src/android-events.ts` 增加可选 `packageName` 参数，使用 `AndroidStabilityEventParser` 先解析目标包事件，再回退到现有 `parseAndroidLogEvent`：

```ts
export type AndroidWatchDeviceEventOptions = {
  since?: Date;
  packageName?: string;
};
```

在 `stdout.on("data")` 的逐行循环中加入：

```ts
const stabilityEvent = options.packageName ? stabilityParser?.observe(trimmed, recentLines) : undefined;
if (stabilityEvent) {
  onEvent({
    type: stabilityEvent.type === "java_crash" ? "crash" : stabilityEvent.type,
    severity: stabilityEvent.severity,
    occurredAt: stabilityEvent.occurredAt,
    summary: stabilityEvent.summary,
    detail: stabilityEvent.detail
  });
  continue;
}
```

- [ ] **步骤 6：运行事件测试**

运行：`pnpm exec vitest run platform/packages/android-driver/src/android-incident-dumper.test.ts platform/packages/android-driver/src/android-stability-events.test.ts platform/packages/android-driver/src/android-events.test.ts`

预期：通过。

- [ ] **步骤 7：提交代码**

```bash
git add platform/packages/android-driver/src/android-incident-dumper.ts platform/packages/android-driver/src/android-incident-dumper.test.ts platform/packages/android-driver/src/android-stability-events.ts platform/packages/android-driver/src/android-stability-events.test.ts platform/packages/android-driver/src/android-events.ts platform/packages/android-driver/src/android-events.test.ts
git commit -m "feat: capture android app monitor incidents"
```

## 任务 5：AndroidAppMonitorSession

**文件：**
- 创建：`platform/packages/android-driver/src/android-app-monitor.ts`
- 创建：`platform/packages/android-driver/src/android-app-monitor.test.ts`
- 修改：`platform/packages/android-driver/src/index.ts`
- 修改：`platform/apps/server/src/mobile-driver.ts`

- [ ] **步骤 1：编写失败的 session 生命周期测试**

在 `platform/packages/android-driver/src/android-app-monitor.test.ts` 写入：

```ts
import { describe, expect, it, vi } from "vitest";
import { AndroidAppMonitorSession } from "./android-app-monitor.js";

describe("AndroidAppMonitorSession", () => {
  it("flushes csv and summary artifacts on stop", async () => {
    const artifacts: Array<{ name: string; content: string }> = [];
    const session = new AndroidAppMonitorSession({
      serial: "device-1",
      runId: "run-1",
      config: { enabled: true, packageName: "cn.eeo.classin", includeSubprocesses: true, processFilters: [], cpuIntervalMs: 1000, memoryIntervalMs: 5000, lifecycleIntervalMs: 2000, enableHeapDump: false, thresholds: {} },
      discoverProcesses: async () => [{ pid: 2665, processName: "cn.eeo.classin", packageName: "cn.eeo.classin", isMainProcess: true, discoveredAt: "2026-07-22T00:00:00.000Z" }],
      sampleCpu: async () => ({ sampledAt: "2026-07-22T00:00:01.000Z", pid: 2665, processName: "cn.eeo.classin", cpuPercent: 12 }),
      sampleMemory: async () => ({ sampledAt: "2026-07-22T00:00:01.000Z", pid: 2665, processName: "cn.eeo.classin", pssKb: 528864 }),
      writeMetricsArtifact: async (_runId, name, content) => {
        artifacts.push({ name, content });
        return { id: `artifact_${artifacts.length}` };
      },
      onEvent: vi.fn(),
      sleep: async () => undefined
    });

    await session.start();
    await session.tickForTest();
    const summary = await session.stop();

    expect(summary.sampleCounts.cpu).toBe(1);
    expect(summary.sampleCounts.memory).toBe(1);
    expect(artifacts.map((item) => item.name)).toEqual(expect.arrayContaining(["android-app-monitor-cpu.csv", "android-app-monitor-memory.csv", "android-app-monitor-summary.json"]));
  });
});
```

- [ ] **步骤 2：运行测试以验证失败**

运行：`pnpm exec vitest run platform/packages/android-driver/src/android-app-monitor.test.ts`

预期：失败，提示新模块不存在。

- [ ] **步骤 3：实现 monitor session**

在 `platform/packages/android-driver/src/android-app-monitor.ts` 写入：

```ts
import { createId, nowIso, type AndroidAppMonitorIncident, type AndroidAppMonitorSummary, type AndroidProcessInfo, type AndroidProcessMetricSample, type NormalizedAndroidAppMonitorConfig } from "@mobile-automation/shared";

type MetricsArtifactWriter = (runId: string, name: string, content: string) => Promise<{ id: string }>;

export class AndroidAppMonitorSession {
  private startedAt = nowIso();
  private stopped = false;
  private processes: AndroidProcessInfo[] = [];
  private cpuSamples: AndroidProcessMetricSample[] = [];
  private memorySamples: AndroidProcessMetricSample[] = [];
  private incidents: AndroidAppMonitorIncident[] = [];

  constructor(
    private readonly options: {
      serial: string;
      runId: string;
      config: NormalizedAndroidAppMonitorConfig;
      discoverProcesses: () => Promise<AndroidProcessInfo[]>;
      sampleCpu: (process: AndroidProcessInfo) => Promise<AndroidProcessMetricSample>;
      sampleMemory: (process: AndroidProcessInfo) => Promise<AndroidProcessMetricSample>;
      writeMetricsArtifact: MetricsArtifactWriter;
      onEvent: (incident: AndroidAppMonitorIncident) => void;
      sleep?: (ms: number) => Promise<void>;
    }
  ) {}

  async start(): Promise<void> {
    this.processes = await this.options.discoverProcesses();
  }

  async tickForTest(): Promise<void> {
    await this.collectOnce();
  }

  async stop(): Promise<AndroidAppMonitorSummary> {
    if (this.stopped) return this.buildSummary();
    this.stopped = true;
    const cpuArtifact = await this.options.writeMetricsArtifact(this.options.runId, "android-app-monitor-cpu.csv", renderMetricCsv(this.cpuSamples, "cpuPercent"));
    const memoryArtifact = await this.options.writeMetricsArtifact(this.options.runId, "android-app-monitor-memory.csv", renderMetricCsv(this.memorySamples, "pssKb"));
    const summary = this.buildSummary({
      cpuCsvArtifactId: cpuArtifact.id,
      memoryCsvArtifactId: memoryArtifact.id
    });
    const summaryArtifact = await this.options.writeMetricsArtifact(this.options.runId, "android-app-monitor-summary.json", JSON.stringify(summary, null, 2));
    return this.buildSummary({
      cpuCsvArtifactId: cpuArtifact.id,
      memoryCsvArtifactId: memoryArtifact.id,
      summaryJsonArtifactId: summaryArtifact.id
    });
  }

  private async collectOnce(): Promise<void> {
    if (!this.processes.length) {
      this.processes = await this.options.discoverProcesses();
    }
    for (const process of this.processes) {
      const [cpu, memory] = await Promise.all([
        this.options.sampleCpu(process).catch(() => undefined),
        this.options.sampleMemory(process).catch(() => undefined)
      ]);
      if (cpu) this.cpuSamples.push(cpu);
      if (memory) this.memorySamples.push(memory);
    }
  }

  private buildSummary(artifacts: AndroidAppMonitorSummary["artifacts"] = {}): AndroidAppMonitorSummary {
    return {
      packageName: this.options.config.packageName,
      startedAt: this.startedAt,
      endedAt: this.stopped ? nowIso() : undefined,
      processes: this.processes,
      sampleCounts: {
        cpu: this.cpuSamples.length,
        memory: this.memorySamples.length,
        lifecycle: 0
      },
      incidents: this.incidents,
      artifacts
    };
  }
}

function renderMetricCsv(samples: AndroidProcessMetricSample[], valueKey: "cpuPercent" | "pssKb"): string {
  return ["sampledAt,pid,processName,value", ...samples.map((sample) => `${sample.sampledAt},${sample.pid},${sample.processName},${sample[valueKey] ?? ""}`)].join("\n");
}
```

- [ ] **步骤 4：暴露 AndroidDriver 能力**

在 `platform/packages/android-driver/src/index.ts` 中加入：

```ts
export { AndroidAppMonitorSession } from "./android-app-monitor.js";
export type { AndroidAppMonitorSummary } from "@mobile-automation/shared";
```

在 `AndroidDriver` 类中新增方法：

```ts
startAppMonitor(options: {
  serial: string;
  runId: string;
  config: NormalizedAndroidAppMonitorConfig;
  writeMetricsArtifact: (runId: string, name: string, content: string) => Promise<{ id: string }>;
  onEvent: (incident: AndroidAppMonitorIncident) => void;
}): Promise<AndroidAppMonitorSession> {
  const discovery = new AndroidProcessDiscovery({ shell: (serial, args, shellOptions) => this.shell(serial, args, shellOptions) });
  const sampler = new AndroidProcessMetricSampler({ shell: (serial, args, shellOptions) => this.shell(serial, args, shellOptions) });
  const session = new AndroidAppMonitorSession({
    ...options,
    discoverProcesses: () => discovery.discover(options.serial, options.config.packageName, options.config),
    sampleCpu: (process) => sampler.sampleCpu(options.serial, process),
    sampleMemory: (process) => sampler.sampleMemory(options.serial, process)
  });
  return session;
}
```

在 `platform/apps/server/src/mobile-driver.ts` 的 `AutomationDeviceDriver` 接口增加：

```ts
startAppMonitor?(options: {
  serial: string;
  runId: string;
  config: NormalizedAndroidAppMonitorConfig;
  writeMetricsArtifact: (runId: string, name: string, content: string) => Promise<{ id: string }>;
  onEvent: (incident: AndroidAppMonitorIncident) => void;
}): Promise<{ start(): Promise<void>; stop(): Promise<AndroidAppMonitorSummary> }>;
```

- [ ] **步骤 5：运行 session 与 driver 测试**

运行：`pnpm exec vitest run platform/packages/android-driver/src/android-app-monitor.test.ts platform/packages/android-driver/src/android-driver.test.ts platform/apps/server/src/automation-runner.test.ts`

预期：新增 session 测试通过；现有 driver / runner 测试保持通过。

- [ ] **步骤 6：提交代码**

```bash
git add platform/packages/android-driver/src/android-app-monitor.ts platform/packages/android-driver/src/android-app-monitor.test.ts platform/packages/android-driver/src/index.ts platform/apps/server/src/mobile-driver.ts
git commit -m "feat: add android app monitor session"
```

## 任务 6：Runner、Artifact 与报告接入

**文件：**
- 修改：`platform/apps/server/src/run-artifact-service.ts`
- 修改：`platform/apps/server/src/automation-runner.ts`
- 修改：`platform/apps/server/src/graph-run-service.ts`
- 修改：`platform/apps/server/src/asset-patrol.ts`
- 修改：`platform/apps/server/src/stability-explorer.ts`
- 修改：`platform/apps/server/src/automation-runner.test.ts`
- 修改：`platform/apps/server/src/graph-run-service.test.ts`
- 修改：`platform/apps/server/src/asset-patrol.test.ts`
- 修改：`platform/apps/server/src/stability-explorer.test.ts`
- 修改：`platform/packages/report-core/src/index.ts`
- 修改：`platform/packages/report-core/src/report-core.test.ts`

- [ ] **步骤 1：编写失败的 Runner 启停测试**

在 `platform/apps/server/src/automation-runner.test.ts` 增加：

```ts
it("starts and stops android app monitor around a run", async () => {
  const calls: string[] = [];
  const driver = createMockDriver({
    startAppMonitor: async () => ({
      start: async () => calls.push("start-monitor"),
      stop: async () => {
        calls.push("stop-monitor");
        return {
          packageName: "cn.eeo.classin",
          startedAt: "2026-07-22T00:00:00.000Z",
          endedAt: "2026-07-22T00:05:00.000Z",
          processes: [],
          sampleCounts: { cpu: 1, memory: 1, lifecycle: 0 },
          incidents: [],
          artifacts: { summaryJsonArtifactId: "artifact_monitor_summary" }
        };
      }
    })
  });
  const runner = createRunnerWithDriver(driver);

  await runner.runCase({
    deviceSerial: "device-1",
    mode: "once",
    repeatCount: 1,
    stepIntervalMs: 0,
    stopOnFailure: true,
    recordVideo: false,
    keepVideoOnSuccess: false,
    androidAppMonitor: { enabled: true, packageName: "cn.eeo.classin" }
  });

  expect(calls).toEqual(["start-monitor", "stop-monitor"]);
});
```

- [ ] **步骤 2：编写失败的报告区块测试**

在 `platform/packages/report-core/src/report-core.test.ts` 增加：

```ts
it("renders android app monitor summary", () => {
  const run: TestRun = {
    id: "run-1",
    caseName: "ClassIn 教师新建课堂流程",
    deviceSerial: "device-1",
    status: "failed",
    config: {
      deviceSerial: "device-1",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 0,
      stopOnFailure: true,
      recordVideo: false,
      keepVideoOnSuccess: false,
      androidAppMonitor: { enabled: true, packageName: "cn.eeo.classin" }
    },
    steps: [],
    stepResults: [],
    metrics: [],
    events: [
      {
        id: "event-1",
        runId: "run-1",
        deviceSerial: "device-1",
        type: "performance_threshold",
        severity: "warning",
        occurredAt: "2026-07-22T00:02:00.000Z",
        summary: "Memory threshold exceeded in cn.eeo.classin",
        artifactIds: ["artifact_monitor_summary"]
      }
    ],
    artifacts: [
      {
        id: "artifact_monitor_summary",
        runId: "run-1",
        type: "metrics",
        name: "android-app-monitor-summary.json",
        path: "runs/run-1/metrics/android-app-monitor-summary.json",
        url: "/artifacts/runs/run-1/metrics/android-app-monitor-summary.json",
        mimeType: "application/json",
        createdAt: "2026-07-22T00:05:00.000Z"
      }
    ],
    startedAt: "2026-07-22T00:00:00.000Z",
    endedAt: "2026-07-22T00:05:00.000Z"
  };

  const html = renderReportHtml(run);

  expect(html).toContain("目标 App 旁路监控");
  expect(html).toContain("cn.eeo.classin");
  expect(html).toContain("Memory threshold exceeded");
});
```

- [ ] **步骤 3：运行测试以验证失败**

运行：`pnpm exec vitest run platform/apps/server/src/automation-runner.test.ts platform/packages/report-core/src/report-core.test.ts`

预期：失败，Runner 未启动 monitor，报告未包含旁路监控区块。

- [ ] **步骤 4：实现 metrics artifact 写入**

在 `platform/apps/server/src/run-artifact-service.ts` 增加：

```ts
async writeMetricsArtifact(runId: string, fileName: string, content: string): Promise<ArtifactRef> {
  const relativePath = runArtifactPath(runId, "metrics", fileName);
  const written = await this.storage.writeArtifact(relativePath, content);
  const artifact: ArtifactRef = {
    id: createId("artifact"),
    runId,
    type: "metrics",
    name: fileName,
    path: relativePath,
    url: artifactUrl(relativePath),
    mimeType: fileName.endsWith(".json") ? "application/json" : "text/csv",
    sizeBytes: written.sizeBytes,
    createdAt: nowIso()
  };
  this.storage.addArtifact(artifact);
  return artifact;
}
```

- [ ] **步骤 5：实现 Runner monitor 生命周期**

在 `platform/apps/server/src/automation-runner.ts` 的 Run 开始阶段加入：

```ts
const monitorConfig = config.androidAppMonitor?.enabled ? normalizeAndroidAppMonitorConfig(config.androidAppMonitor) : undefined;
const appMonitor = monitorConfig && this.driver.startAppMonitor
  ? await this.driver.startAppMonitor({
      serial: config.deviceSerial,
      runId,
      config: monitorConfig,
      writeMetricsArtifact: (targetRunId, name, content) => this.artifactService.writeMetricsArtifact(targetRunId, name, content),
      onEvent: (incident) => this.recordAppMonitorIncident(runId, config.deviceSerial, incident, currentStepResultId)
    })
  : undefined;
await appMonitor?.start();
```

在 Run 的 `finally` 中加入：

```ts
const monitorSummary = await appMonitor?.stop().catch(async (error) => {
  const artifact = await this.artifactService.writeLog(runId, `android-app-monitor-stop-failed-${Date.now()}.txt`, errorToString(error));
  this.storage.addDeviceEvent({
    id: createId("event"),
    runId,
    deviceSerial: config.deviceSerial,
    type: "android_app_monitor",
    severity: "warning",
    occurredAt: nowIso(),
    summary: "Android app monitor failed to stop cleanly",
    detail: errorToString(error),
    artifactIds: [artifact.id]
  });
  return undefined;
});
```

新增 incident 映射方法：

```ts
private recordAppMonitorIncident(runId: string, deviceSerial: string, incident: AndroidAppMonitorIncident, stepResultId?: string): void {
  this.storage.addDeviceEvent({
    id: createId("event"),
    runId,
    stepResultId,
    deviceSerial,
    type: incident.type === "cpu_threshold" || incident.type === "memory_threshold" ? "performance_threshold" : incident.type,
    severity: incident.severity,
    occurredAt: incident.occurredAt,
    summary: incident.summary,
    detail: incident.detail,
    artifactIds: incident.artifactIds
  });
}
```

同样的启停 helper 在 `graph-run-service.ts`、`asset-patrol.ts` 和 `stability-explorer.ts` 复用；避免复制时建立一个本地私有 helper 文件 `platform/apps/server/src/android-app-monitor-runner.ts`：

```ts
export async function startAndroidAppMonitorForRun(args: StartMonitorForRunArgs): Promise<AndroidAppMonitorHandle | undefined> {
  if (!args.config.androidAppMonitor?.enabled || !args.driver.startAppMonitor) return undefined;
  const config = normalizeAndroidAppMonitorConfig(args.config.androidAppMonitor);
  const session = await args.driver.startAppMonitor({
    serial: args.config.deviceSerial,
    runId: args.runId,
    config,
    writeMetricsArtifact: args.writeMetricsArtifact,
    onEvent: args.onIncident
  });
  await session.start();
  return session;
}
```

- [ ] **步骤 6：实现报告区块**

在 `platform/packages/report-core/src/index.ts` 中增加：

```ts
function renderAndroidAppMonitorReport(run: TestRun): string {
  const config = run.config.androidAppMonitor;
  if (!config?.enabled) return "";
  const monitorArtifacts = run.artifacts.filter((artifact) => artifact.type === "metrics" && artifact.name.startsWith("android-app-monitor-"));
  const monitorEvents = run.events.filter((event) => ["performance_threshold", "crash", "native_crash", "anr", "process_death", "android_app_monitor"].includes(event.type));
  return `<h2>目标 App 旁路监控</h2>
    <section class="summary">
      <div class="metric"><span>Package</span><strong>${escapeHtml(config.packageName)}</strong></div>
      <div class="metric"><span>Monitor Artifacts</span><strong>${monitorArtifacts.length}</strong></div>
      <div class="metric"><span>Incidents</span><strong>${monitorEvents.length}</strong></div>
    </section>
    <table>
      <thead><tr><th>时间</th><th>类型</th><th>等级</th><th>摘要</th></tr></thead>
      <tbody>${monitorEvents.map((event) => `<tr><td>${escapeHtml(event.occurredAt)}</td><td>${escapeHtml(event.type)}</td><td>${escapeHtml(event.severity)}</td><td>${escapeHtml(event.summary)}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">无旁路监控事件</td></tr>'}</tbody>
    </table>
    <div class="artifact-list">${monitorArtifacts.map((artifact) => `<div class="artifact"><a href="${escapeAttr(artifact.url)}">${escapeHtml(artifact.name)}</a></div>`).join("")}</div>`;
}
```

在 `renderReportHtml` 中调用：

```ts
${renderAndroidAppMonitorReport(run)}
```

- [ ] **步骤 7：运行接入测试**

运行：`pnpm exec vitest run platform/apps/server/src/automation-runner.test.ts platform/apps/server/src/graph-run-service.test.ts platform/apps/server/src/asset-patrol.test.ts platform/apps/server/src/stability-explorer.test.ts platform/packages/report-core/src/report-core.test.ts`

预期：通过。

- [ ] **步骤 8：提交代码**

```bash
git add platform/apps/server/src/run-artifact-service.ts platform/apps/server/src/android-app-monitor-runner.ts platform/apps/server/src/automation-runner.ts platform/apps/server/src/graph-run-service.ts platform/apps/server/src/asset-patrol.ts platform/apps/server/src/stability-explorer.ts platform/apps/server/src/automation-runner.test.ts platform/apps/server/src/graph-run-service.test.ts platform/apps/server/src/asset-patrol.test.ts platform/apps/server/src/stability-explorer.test.ts platform/packages/report-core/src/index.ts platform/packages/report-core/src/report-core.test.ts
git commit -m "feat: attach android app monitor to runs"
```

## 任务 7：Dashboard 配置、CLI 入参和真机验收

**文件：**
- 修改：`platform/apps/dashboard/src/App.tsx`
- 修改：`platform/apps/dashboard/src/App.test.ts`
- 修改：`platform/packages/cli/src/index.ts`
- 修改：`platform/packages/cli/src/index.test.ts`
- 修改：`docs/product/mobile-automation-platform/spec/changelog.md`

- [ ] **步骤 1：编写失败的 Dashboard 配置测试**

在 `platform/apps/dashboard/src/App.test.ts` 增加：

```ts
it("sends android app monitor config when starting a run", async () => {
  const requests: unknown[] = [];
  mockApiPost((url, body) => {
    if (url === "/api/runs") requests.push(body);
    return Promise.resolve({ id: "run-1", status: "running" });
  });

  render(<App />);
  await userEvent.click(await screen.findByLabelText("启用目标 App 监控"));
  await userEvent.clear(screen.getByLabelText("监控包名"));
  await userEvent.type(screen.getByLabelText("监控包名"), "cn.eeo.classin");
  await userEvent.click(screen.getByRole("button", { name: "执行" }));

  expect(requests[0]).toMatchObject({
    androidAppMonitor: {
      enabled: true,
      packageName: "cn.eeo.classin",
      cpuIntervalMs: 1000,
      memoryIntervalMs: 5000,
      enableHeapDump: false
    }
  });
});
```

- [ ] **步骤 2：编写失败的 CLI 参数测试**

在 `platform/packages/cli/src/index.test.ts` 增加：

```ts
it("adds android app monitor config to run requests", () => {
  expect(
    buildRequest(parseCliArgs([
      "run",
      "--device",
      "device-1",
      "--case",
      "case-1",
      "--android-monitor-package",
      "cn.eeo.classin",
      "--android-monitor-process",
      ":privileged_process0",
      "--android-monitor-memory-mb",
      "700"
    ])).body
  ).toMatchObject({
    androidAppMonitor: {
      enabled: true,
      packageName: "cn.eeo.classin",
      processFilters: [":privileged_process0"],
      thresholds: {
        pssMb: { enabled: true, value: 700 }
      }
    }
  });
});
```

- [ ] **步骤 3：运行测试以验证失败**

运行：`pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/packages/cli/src/index.test.ts -t "android app monitor|目标 App 监控"`

预期：失败，UI 和 CLI 尚未发送 `androidAppMonitor`。

- [ ] **步骤 4：实现 Dashboard 控件**

在执行配置表单中加入字段：

```tsx
<label className="field-toggle">
  <input
    type="checkbox"
    checked={runConfig.androidAppMonitor?.enabled ?? false}
    onChange={(event) =>
      setRunConfig((current) => ({
        ...current,
        androidAppMonitor: {
          enabled: event.currentTarget.checked,
          packageName: current.androidAppMonitor?.packageName || selectedCase?.targetApp?.androidPackageName || "",
          cpuIntervalMs: 1000,
          memoryIntervalMs: 5000,
          enableHeapDump: false
        }
      }))
    }
  />
  启用目标 App 监控
</label>
<input
  aria-label="监控包名"
  value={runConfig.androidAppMonitor?.packageName ?? ""}
  onChange={(event) =>
    setRunConfig((current) => ({
      ...current,
      androidAppMonitor: {
        ...(current.androidAppMonitor ?? { enabled: true }),
        packageName: event.currentTarget.value
      }
    }))
  }
/>
```

提交 `/api/runs`、资产巡检和稳定性探索请求时保留 `androidAppMonitor` 字段。

- [ ] **步骤 5：实现 CLI 参数**

在 `platform/packages/cli/src/index.ts` 的参数解析中加入：

```ts
const androidMonitorPackage = stringOption(parsed.options["android-monitor-package"]);
const androidMonitorProcess = stringOption(parsed.options["android-monitor-process"]);
const androidMonitorMemoryMb = numberOption(parsed.options["android-monitor-memory-mb"]);
const body: Record<string, unknown> = {
  deviceSerial,
  caseId,
  mode: stringOption(parsed.options.mode),
  repeatCount: numberOption(parsed.options.repeat),
  stepIntervalMs: numberOption(parsed.options.interval),
  startStrategy: stringOption(parsed.options.startStrategy),
  startAppPackageName: stringOption(parsed.options.package),
  startSetupScope: stringOption(parsed.options.startScope)
};
if (androidMonitorPackage) {
  body.androidAppMonitor = {
    enabled: true,
    packageName: androidMonitorPackage,
    processFilters: androidMonitorProcess ? [androidMonitorProcess] : [],
    cpuIntervalMs: 1000,
    memoryIntervalMs: 5000,
    enableHeapDump: false,
    thresholds: {
      pssMb: androidMonitorMemoryMb
        ? { enabled: true, value: androidMonitorMemoryMb, sustainMs: 30000, cooldownMs: 120000 }
        : undefined
    }
  };
}
return { method: "POST", path: "/api/runs", body };
```

- [ ] **步骤 6：运行 Dashboard 与 CLI 测试**

运行：`pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/packages/cli/src/index.test.ts -t "android app monitor|目标 App 监控"`

预期：通过。

- [ ] **步骤 7：运行全量类型检查与相关单测**

运行：

```bash
pnpm -r typecheck
pnpm exec vitest run platform/packages/shared/src/index.test.ts platform/packages/android-driver/src/android-process-discovery.test.ts platform/packages/android-driver/src/android-process-metrics.test.ts platform/packages/android-driver/src/android-thresholds.test.ts platform/packages/android-driver/src/android-incident-dumper.test.ts platform/packages/android-driver/src/android-stability-events.test.ts platform/packages/android-driver/src/android-app-monitor.test.ts platform/apps/server/src/automation-runner.test.ts platform/apps/server/src/graph-run-service.test.ts platform/apps/server/src/asset-patrol.test.ts platform/apps/server/src/stability-explorer.test.ts platform/packages/report-core/src/report-core.test.ts platform/apps/dashboard/src/App.test.ts platform/packages/cli/src/index.test.ts
```

预期：全部通过。

- [ ] **步骤 8：真机验证 ClassIn 5 分钟旁路监控**

运行：

```bash
CASE_ID=$(pnpm cli -- cases | awk -F '\t' '/ClassIn 教师新建课堂流程/ {print $1; exit}')
RUN_ID=$(pnpm cli -- run --device ERLDU20115007395 --case "$CASE_ID" --android-monitor-package cn.eeo.classin --android-monitor-memory-mb 500 | sed -E 's/^Started ([^ ]+).*/\1/')
pnpm cli -- status --run "$RUN_ID"
pnpm cli -- report --run "$RUN_ID"
```

预期：

```text
Run run_
status=
case=ClassIn 教师新建课堂流程
device=ERLDU20115007395
http://localhost:4010/artifacts/runs/run_
```

报告验收：

```text
目标 App 旁路监控
Package: cn.eeo.classin
Processes: cn.eeo.classin, cn.eeo.classin:privileged_process0
Artifacts: android-app-monitor-cpu.csv, android-app-monitor-memory.csv, android-app-monitor-summary.json
```

- [ ] **步骤 9：提交代码和文档记录**

```bash
git add platform/apps/dashboard/src/App.tsx platform/apps/dashboard/src/App.test.ts platform/packages/cli/src/index.ts platform/packages/cli/src/index.test.ts docs/product/mobile-automation-platform/spec/changelog.md
git commit -m "feat: expose android app monitor controls"
```

## 自检

- 规范覆盖：REQ-046 的进程发现由任务 2 覆盖；CPU / PSS 与阈值由任务 3 覆盖；incident 证据和稳定性事件由任务 4 覆盖；Run 生命周期、artifact 和报告由任务 5、任务 6 覆盖；Dashboard / CLI 配置和真机 ClassIn 验收由任务 7 覆盖。
- 占位符扫描：方案中未保留未决占位语；每个任务包含明确文件、测试、实现片段、命令和预期。
- 类型一致性：全篇使用同一组核心名称：`AndroidAppMonitorConfig`、`NormalizedAndroidAppMonitorConfig`、`AndroidProcessInfo`、`AndroidProcessMetricSample`、`AndroidAppMonitorIncident`、`AndroidAppMonitorSummary`、`AndroidAppMonitorSession`。
