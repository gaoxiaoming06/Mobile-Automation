import { describe, expect, it } from "vitest";
import {
  buildStabilityCandidates,
  normalizeStabilityExplorerConfig,
  StabilityExplorer,
  type StabilityExplorerStorage
} from "./stability-explorer.js";
import type { AutomationDeviceDriver, DeviceEventWatcher, MobileVideoRecording, ObservedDeviceEvent } from "./device-driver.js";
import type { OcrLayoutResult, OcrService } from "./ocr.js";
import type { RuntimeInterceptorRule } from "./runtime-interceptor.js";
import {
  createId,
  defaultAndroidCapabilities,
  nowIso,
  type ActionStep,
  type ArtifactRef,
  type DeviceActionRequest,
  type DeviceActionResult,
  type DeviceEvent,
  type DeviceInfo,
  type MetricSample,
  type StepResult,
  type TestRun
} from "@mobile-automation/shared";
import type { Observation } from "@mobile-automation/graph-core";

describe("StabilityExplorer", () => {
  it("does not mark a run stopped when it does not own the active worker", async () => {
    const storage = new MemoryExplorerStorage();
    storage.createRun({
      id: "script-run",
      caseName: "Script run",
      deviceSerial: "device-1",
      configJson: "{}",
      runSnapshotJson: "{}",
      steps: []
    });
    const explorer = new StabilityExplorer(storage, new ScriptedExplorerDriver(), scriptedOcr([[]]));

    await expect(explorer.stop("script-run")).resolves.toBe(false);
    expect(storage.getRun("script-run")?.status).toBe("running");
  });

  it("normalizes first-version exploration bounds with safe defaults", () => {
    expect(normalizeStabilityExplorerConfig({ packageName: " com.demo " })).toEqual(
      expect.objectContaining({
        packageName: "com.demo",
        maxDurationMs: 180_000,
        maxActions: 100,
        strategy: "conservative",
        startMode: "restart_app",
        allowedActions: ["tap", "swipe", "back", "wait"],
        appExitPolicy: "back_to_app",
        backtrackStrategy: "shallow",
        maxDepth: 4,
        stopOnCrash: true,
        stopOnAnr: true,
        stopOnBlackScreen: true,
        stopOnUnknownPageStuck: true
      })
    );
  });

  it("prioritizes safe OCR candidates and skips dangerous text before random actions", () => {
    const candidates = buildStabilityCandidates({
      observation: observation({
        ocrTexts: [
          { text: "删除班级", region: { x: 30, y: 100, width: 160, height: 60 } },
          { text: "添加好友", region: { x: 300, y: 200, width: 180, height: 70 } }
        ]
      }),
      config: normalizeStabilityExplorerConfig({
        packageName: "com.demo",
        strategy: "aggressive",
        allowedActions: ["tap", "wait"],
        seed: "seed-a"
      }),
      actionIndex: 0
    });

    expect(candidates[0]).toEqual(
      expect.objectContaining({
        label: "添加好友",
        source: "ocr_text",
        status: "ready",
        action: { type: "tap", x: 390, y: 235 }
      })
    );
    expect(candidates.find((candidate) => candidate.label === "删除班级")).toEqual(
      expect.objectContaining({
        status: "skipped",
        skipReason: "dangerous_text"
      })
    );
    expect(candidates.some((candidate) => candidate.source === "random_safe_region")).toBe(true);
  });

  it("skips system chrome OCR and chooses content actions first", () => {
    const candidates = buildStabilityCandidates({
      observation: observation({
        ocrTexts: [
          { text: "19:10", region: { x: 128, y: 48, width: 144, height: 56 } },
          { text: "主页", region: { x: 190, y: 204, width: 120, height: 76 } },
          { text: "创建班级", region: { x: 92, y: 500, width: 220, height: 92 } }
        ]
      }),
      config: normalizeStabilityExplorerConfig({
        packageName: "com.demo",
        strategy: "conservative",
        allowedActions: ["tap"],
        seed: "seed-a"
      }),
      actionIndex: 0
    });

    expect(candidates[0]).toEqual(
      expect.objectContaining({
        label: "创建班级",
        source: "ocr_text",
        status: "ready",
        action: { type: "tap", x: 202, y: 546 }
      })
    );
    expect(candidates.find((candidate) => candidate.label === "19:10")).toEqual(
      expect.objectContaining({
        status: "skipped",
        skipReason: "system_region"
      })
    );
  });

  it("restarts the selected package by default, stays within action bounds, and writes a reproducible run report", async () => {
    const storage = new MemoryExplorerStorage();
    const driver = new ScriptedExplorerDriver();
    const explorer = new StabilityExplorer(storage, driver, scriptedOcr([
      [{ text: "添加好友", x: 300, y: 200, width: 180, height: 70 }],
      [{ text: "设置", x: 500, y: 400, width: 120, height: 70 }],
      [{ text: "消息", x: 200, y: 900, width: 120, height: 70 }]
    ]));

    const run = explorer.start({
      deviceSerial: "device-1",
      packageName: "com.demo",
      maxActions: 2,
      maxDurationMs: 30_000,
      strategy: "balanced",
      allowedActions: ["tap"],
      seed: "stable-seed"
    });
    await explorer.waitForRun(run.id);

    const completed = storage.getRun(run.id)!;
    expect(driver.actions.slice(0, 2)).toEqual([
      { type: "close_app", packageName: "com.demo" },
      { type: "launch_app", packageName: "com.demo" }
    ]);
    expect(driver.actions.filter((action) => action.type === "tap")).toHaveLength(2);
    expect(completed.status).toBe("passed");
    expect(completed.config.runKind).toBe("stability_exploration");
    expect(completed.config.stabilityExploration).toEqual(
      expect.objectContaining({
        packageName: "com.demo",
        startMode: "restart_app",
        seed: "stable-seed",
        maxActions: 2
      })
    );
    expect(completed.stepResults).toHaveLength(2);
    expect(completed.stepResults[0]?.metadata?.stabilityExploration).toEqual(
      expect.objectContaining({
        actionIndex: 1,
        packageName: "com.demo",
        candidateLabel: "添加好友",
        candidateSource: "ocr_text",
        seed: "stable-seed"
      })
    );
    expect(completed.artifacts.some((artifact) => artifact.type === "report_json" && artifact.name === "stability-exploration-summary.json")).toBe(true);
    expect(completed.reportHtmlPath).toBe(`runs/${run.id}/reports/report.html`);
  });

  it("can start exploration from the current foreground app without relaunching", async () => {
    const storage = new MemoryExplorerStorage();
    const driver = new ScriptedExplorerDriver("com.demo");
    const explorer = new StabilityExplorer(storage, driver, scriptedOcr([
      [{ text: "当前页入口", x: 260, y: 560, width: 220, height: 80 }],
      [{ text: "当前页入口", x: 260, y: 560, width: 220, height: 80 }]
    ]));

    const run = explorer.start({
      deviceSerial: "device-1",
      packageName: "com.demo",
      startMode: "current_state",
      maxActions: 1,
      maxDurationMs: 30_000,
      strategy: "conservative",
      allowedActions: ["tap"],
      seed: "stable-seed"
    });
    await explorer.waitForRun(run.id);

    const completed = storage.getRun(run.id)!;
    expect(driver.actions).toEqual([
      { type: "tap", x: 370, y: 600 }
    ]);
    expect(completed.config.stabilityExploration).toEqual(
      expect.objectContaining({
        startMode: "current_state",
        packageName: "com.demo"
      })
    );
  });

  it("stores android app monitor config in stability exploration runs", async () => {
    const storage = new MemoryExplorerStorage();
    const driver = new ScriptedExplorerDriver("com.demo");
    const explorer = new StabilityExplorer(storage, driver, scriptedOcr([
      [{ text: "当前页入口", x: 260, y: 560, width: 220, height: 80 }]
    ]));
    const androidAppMonitor = {
      enabled: true,
      packageName: "cn.eeo.classin",
      includeSubprocesses: true
    };

    const run = explorer.start({
      deviceSerial: "device-1",
      packageName: "com.demo",
      startMode: "current_state",
      maxActions: 1,
      maxDurationMs: 30_000,
      strategy: "conservative",
      allowedActions: ["tap"],
      seed: "stable-seed",
      androidAppMonitor
    } as Parameters<StabilityExplorer["start"]>[0] & { androidAppMonitor: typeof androidAppMonitor });
    await explorer.waitForRun(run.id);

    expect(storage.getRun(run.id)?.config.androidAppMonitor).toEqual(androidAppMonitor);
  });

  it("handles temporary pages with runtime interceptor rules before normal exploration", async () => {
    const storage = new MemoryExplorerStorage();
    const driver = new RuntimeInterceptorExplorerDriver();
    const explorer = new StabilityExplorer(storage, driver, scriptedOcr([[]]));

    const run = explorer.start({
      deviceSerial: "device-1",
      packageName: "com.demo",
      maxActions: 1,
      maxDurationMs: 30_000,
      strategy: "conservative",
      startMode: "launch_app",
      allowedActions: ["tap"],
      seed: "stable-seed"
    });
    await explorer.waitForRun(run.id);

    const completed = storage.getRun(run.id)!;
    expect(driver.actions).toEqual([
      { type: "launch_app", packageName: "com.demo" },
      { type: "tap", x: 1008, y: 116 }
    ]);
    expect(completed.stepResults[0]?.metadata?.stabilityExploration).toEqual(
      expect.objectContaining({
        resultType: "runtime_interceptor",
        candidateSource: "runtime_interceptor",
        candidateLabel: "ClassIn 选择学段学科页",
        runtimeInterceptors: [
          expect.objectContaining({
            ruleId: "classin-stage-subject-picker",
            action: { type: "tap", x: 1008, y: 116 }
          })
        ]
      })
    );
  });

  it("skips a repeated OCR candidate after it causes no meaningful page change", async () => {
    const storage = new MemoryExplorerStorage();
    const driver = new ScriptedExplorerDriver();
    const unchangedPage = [
      { text: "课程", x: 50, y: 1700, width: 100, height: 80 },
      { text: "去关注", x: 720, y: 1400, width: 180, height: 80 }
    ];
    const explorer = new StabilityExplorer(storage, driver, scriptedOcr([
      unchangedPage,
      unchangedPage,
      unchangedPage,
      unchangedPage
    ]));

    const run = explorer.start({
      deviceSerial: "device-1",
      packageName: "com.demo",
      maxActions: 2,
      maxDurationMs: 30_000,
      strategy: "conservative",
      startMode: "launch_app",
      allowedActions: ["tap"],
      seed: "stable-seed"
    });
    await explorer.waitForRun(run.id);

    expect(driver.actions).toEqual([
      { type: "launch_app", packageName: "com.demo" },
      { type: "tap", x: 100, y: 1740 },
      { type: "tap", x: 810, y: 1440 }
    ]);
    expect(storage.getRun(run.id)?.stepResults[1]?.metadata?.stabilityExploration).toEqual(
      expect.objectContaining({
        candidateLabel: "去关注",
        skippedCandidates: expect.arrayContaining([
          expect.objectContaining({
            label: "课程",
            skipReason: "repeated_no_change"
          })
        ])
      })
    );
  });

  it("skips a repeated OCR candidate despite volatile overlays and punctuation drift", async () => {
    const storage = new MemoryExplorerStorage();
    const driver = new ScriptedExplorerDriver();
    const explorer = new StabilityExplorer(storage, driver, scriptedOcr([
      [
        { text: "CPU: 5.0 %", x: 200, y: 140, width: 220, height: 60 },
        { text: "run.xin", x: 620, y: 1062, width: 148, height: 76 },
        { text: "设置", x: 760, y: 1680, width: 120, height: 70 }
      ],
      [
        { text: "CPU: 6.0 %", x: 200, y: 140, width: 220, height: 60 },
        { text: "runxin", x: 620, y: 1062, width: 148, height: 76 },
        { text: "设置", x: 760, y: 1680, width: 120, height: 70 }
      ],
      [
        { text: "FPS: 60.0", x: 200, y: 220, width: 220, height: 60 },
        { text: "run.xin", x: 620, y: 1062, width: 148, height: 76 },
        { text: "设置", x: 760, y: 1680, width: 120, height: 70 }
      ],
      [
        { text: "MEM: 333.7 MB", x: 200, y: 180, width: 260, height: 60 },
        { text: "run.xin", x: 620, y: 1062, width: 148, height: 76 },
        { text: "设置", x: 760, y: 1680, width: 120, height: 70 }
      ],
      [
        { text: "MEM: 331.0 MB", x: 200, y: 180, width: 260, height: 60 },
        { text: "run.xin", x: 620, y: 1062, width: 148, height: 76 },
        { text: "设置", x: 760, y: 1680, width: 120, height: 70 }
      ],
      [
        { text: "FPS: 59.0", x: 200, y: 220, width: 220, height: 60 },
        { text: "runxin", x: 620, y: 1062, width: 148, height: 76 },
        { text: "设置", x: 760, y: 1680, width: 120, height: 70 }
      ]
    ]));

    const run = explorer.start({
      deviceSerial: "device-1",
      packageName: "com.demo",
      maxActions: 2,
      maxDurationMs: 30_000,
      strategy: "conservative",
      startMode: "launch_app",
      allowedActions: ["tap"],
      seed: "stable-seed"
    });
    await explorer.waitForRun(run.id);

    expect(driver.actions).toEqual([
      { type: "launch_app", packageName: "com.demo" },
      { type: "tap", x: 694, y: 1100 },
      { type: "tap", x: 820, y: 1715 }
    ]);
    expect(storage.getRun(run.id)?.stepResults[1]?.metadata?.stabilityExploration).toEqual(
      expect.objectContaining({
        candidateLabel: "设置",
        skippedCandidates: expect.arrayContaining([
          expect.objectContaining({
            label: "run.xin",
            skipReason: "repeated_no_change"
          })
        ])
      })
    );
  });

  it("recovers when an exploration action leaves the target app and app-exit policy returns to app", async () => {
    const storage = new MemoryExplorerStorage();
    const driver = new AppExitRecoveryExplorerDriver("com.demo");
    const explorer = new StabilityExplorer(storage, driver, scriptedOcr([
      [{ text: "打开外部", x: 260, y: 560, width: 220, height: 80 }],
      [{ text: "桌面", x: 260, y: 560, width: 220, height: 80 }],
      [{ text: "主页", x: 260, y: 560, width: 220, height: 80 }]
    ]));

    const run = explorer.start({
      deviceSerial: "device-1",
      packageName: "com.demo",
      maxActions: 1,
      maxDurationMs: 30_000,
      strategy: "conservative",
      startMode: "launch_app",
      allowedActions: ["tap", "back"],
      seed: "stable-seed",
      appExitPolicy: "back_to_app"
    });
    await explorer.waitForRun(run.id);

    const completed = storage.getRun(run.id)!;
    expect(completed.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "launch_app", packageName: "com.demo" },
      { type: "tap", x: 370, y: 600 },
      { type: "back" }
    ]);
    expect(completed.stepResults[0]?.status).toBe("passed");
    expect(completed.stepResults[0]?.metadata?.stabilityExploration).toEqual(
      expect.objectContaining({
        resultType: "app_exit_recovered",
        currentPackage: "com.demo"
      })
    );
  });

  it("waits for h5 loading text to settle before choosing the next action", async () => {
    const storage = new MemoryExplorerStorage();
    const driver = new ScriptedExplorerDriver();
    const explorer = new StabilityExplorer(storage, driver, scriptedOcr([
      [{ text: "打开H5", x: 160, y: 420, width: 180, height: 80 }],
      [{ text: "加载中", x: 420, y: 960, width: 240, height: 80 }],
      [{ text: "正在加载", x: 400, y: 960, width: 280, height: 80 }],
      [{ text: "立即进入", x: 660, y: 1280, width: 220, height: 88 }],
      [{ text: "立即进入", x: 660, y: 1280, width: 220, height: 88 }]
    ]));

    const run = explorer.start({
      deviceSerial: "device-1",
      packageName: "com.demo",
      maxActions: 2,
      maxDurationMs: 30_000,
      strategy: "conservative",
      startMode: "launch_app",
      allowedActions: ["tap"],
      seed: "stable-seed"
    });
    await explorer.waitForRun(run.id);

    expect(driver.actions).toEqual([
      { type: "launch_app", packageName: "com.demo" },
      { type: "tap", x: 250, y: 460 },
      { type: "tap", x: 770, y: 1324 }
    ]);
    expect(storage.getRun(run.id)?.stepResults[1]?.metadata?.stabilityExploration).toEqual(
      expect.objectContaining({
        candidateLabel: "立即进入",
        candidateSource: "ocr_text"
      })
    );
  });

  it("backtracks from a child page when the configured depth is reached", async () => {
    const storage = new MemoryExplorerStorage();
    const driver = new ScriptedExplorerDriver();
    const explorer = new StabilityExplorer(storage, driver, scriptedOcr([
      [{ text: "详情入口", x: 120, y: 520, width: 180, height: 80 }],
      [{ text: "详情页", x: 120, y: 220, width: 180, height: 80 }],
      [{ text: "详情页", x: 120, y: 220, width: 180, height: 80 }],
      [{ text: "详情页", x: 120, y: 220, width: 180, height: 80 }],
      [{ text: "详情入口", x: 120, y: 520, width: 180, height: 80 }],
      [{ text: "详情入口", x: 120, y: 520, width: 180, height: 80 }]
    ]));

    const run = explorer.start({
      deviceSerial: "device-1",
      packageName: "com.demo",
      maxActions: 2,
      maxDurationMs: 30_000,
      strategy: "conservative",
      startMode: "launch_app",
      allowedActions: ["tap", "back"],
      seed: "stable-seed",
      backtrackStrategy: "shallow",
      maxDepth: 1
    });
    await explorer.waitForRun(run.id);

    expect(driver.actions).toEqual([
      { type: "launch_app", packageName: "com.demo" },
      { type: "tap", x: 210, y: 560 },
      { type: "back" }
    ]);
    expect(storage.getRun(run.id)?.stepResults[1]?.metadata?.stabilityExploration).toEqual(
      expect.objectContaining({
        resultType: "backtrack",
        candidateLabel: "返回上一页",
        candidateSource: "backtrack",
        backtrackDepth: 1
      })
    );
  });
});

function observation(input: {
  packageName?: string;
  ocrTexts?: Array<{ text: string; region?: { x: number; y: number; width: number; height: number } }>;
} = {}): Observation {
  return {
    platform: "android",
    capturedAt: nowIso(),
    packageName: input.packageName ?? "com.demo",
    resolution: { width: 1080, height: 2400 },
    uiElements: [],
    ocrTexts: (input.ocrTexts ?? []).map((item) => ({
      text: item.text,
      source: "ocr",
      confidence: 0.9,
      region: item.region
    }))
  };
}

function scriptedOcr(script: Array<Array<{ text: string; x: number; y: number; width: number; height: number }>>): OcrService {
  let index = 0;
  return {
    async recognize() {
      const boxes = script[Math.min(index, script.length - 1)] ?? [];
      return { text: boxes.map((box) => box.text).join("\n"), engine: "mock", lang: "zh" };
    },
    async locateText(): Promise<OcrLayoutResult> {
      const boxes = script[Math.min(index, script.length - 1)] ?? [];
      index += 1;
      return {
        text: boxes.map((box) => box.text).join("\n"),
        engine: "mock",
        lang: "zh",
        width: 1080,
        height: 2400,
        boxes: boxes.map((box) => ({ ...box, confidence: 0.92 }))
      };
    }
  };
}

class ScriptedExplorerDriver implements AutomationDeviceDriver {
  readonly actions: DeviceActionRequest[] = [];
  protected foregroundPackage = "launcher";
  protected readonly device: DeviceInfo = {
    id: "device-1",
    serial: "device-1",
    platform: "android",
    name: "探索设备",
    status: "online",
    resolution: { width: 1080, height: 2400 },
    orientation: "portrait",
    capabilities: { ...defaultAndroidCapabilities(), recordVideo: false },
    lastSeenAt: nowIso()
  };

  constructor(initialForegroundPackage?: string) {
    if (initialForegroundPackage) {
      this.foregroundPackage = initialForegroundPackage;
    }
  }

  async getToolStatus() {
    return [];
  }

  async listDevices() {
    return [this.device];
  }

  async getDeviceInfo(serial: string) {
    this.assertDevice(serial);
    return this.device;
  }

  async screenshot(serial: string) {
    this.assertDevice(serial);
    return Buffer.from("screenshot");
  }

  async getForegroundApp(serial: string) {
    this.assertDevice(serial);
    return { packageName: this.foregroundPackage, activityName: `${this.foregroundPackage}.MainActivity` };
  }

  async dumpUiHierarchy() {
    return "<hierarchy/>";
  }

  async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult> {
    this.assertDevice(serial);
    this.actions.push(action);
    if (action.type === "launch_app") {
      this.foregroundPackage = action.packageName;
    }
    return { driverChannel: "mock" };
  }

  async clearAppData() {}

  async collectLogs() {
    return "";
  }

  async watchDeviceEvents(_serial: string, _onEvent: (event: ObservedDeviceEvent) => void): Promise<DeviceEventWatcher> {
    return { stop: async () => undefined };
  }

  async samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample> {
    this.assertDevice(serial);
    return {
      id: createId("metric"),
      runId,
      stepResultId,
      deviceSerial: serial,
      sampledAt: nowIso(),
      cpuPercent: 1,
      memoryUsedKb: 64 * 1024,
      memoryTotalKb: 512 * 1024,
      batteryLevel: 80
    };
  }

  async startVideoRecording(_serial: string, runId: string, localDir: string): Promise<MobileVideoRecording> {
    return { id: runId, serial: "device-1", localPath: `${localDir}/${runId}.mp4`, startedAt: nowIso(), kind: "screenrecord", process: {} as never };
  }

  async stopVideoRecording() {
    return undefined;
  }

  private assertDevice(serial: string): void {
    if (serial !== "device-1") {
      throw new Error(`unknown device ${serial}`);
    }
  }
}

class AppExitRecoveryExplorerDriver extends ScriptedExplorerDriver {
  constructor(private readonly targetPackageName: string) {
    super();
  }

  override async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult> {
    const result = await super.performAction(serial, action);
    if (action.type === "tap") {
      this.foregroundPackage = "com.huawei.android.launcher";
    }
    if (action.type === "back") {
      this.foregroundPackage = this.targetPackageName;
    }
    return result;
  }
}

class RuntimeInterceptorExplorerDriver extends ScriptedExplorerDriver {
  private blockingVisible = true;

  override async dumpUiHierarchy() {
    return this.blockingVisible ? closeableBlockingHierarchy("让 ClassIn 更懂你的课\n选择学段和学科") : homeHierarchy();
  }

  override async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult> {
    const result = await super.performAction(serial, action);
    if (action.type === "tap" && action.x === 1008 && action.y === 116) {
      this.blockingVisible = false;
    }
    return result;
  }
}

class MemoryExplorerStorage implements StabilityExplorerStorage {
  private readonly runs = new Map<string, TestRun>();

  createRun(input: { id?: string; caseName: string; deviceSerial: string; configJson: string; runSnapshotJson: string; steps: ActionStep[] }): TestRun {
    const run: TestRun = {
      id: input.id ?? "report-run",
      caseName: input.caseName,
      deviceSerial: input.deviceSerial,
      status: "running",
      config: JSON.parse(input.configJson),
      steps: input.steps,
      stepResults: [],
      metrics: [],
      events: [],
      artifacts: [],
      startedAt: nowIso()
    };
    this.runs.set(run.id, run);
    return run;
  }

  getRun(id: string): TestRun | undefined {
    return this.runs.get(id);
  }

  updateRunStatus(runId: string, status: TestRun["status"], endedAt?: string): void {
    const run = this.runs.get(runId);
    if (run) {
      run.status = status;
      if (!["pending", "running", "paused"].includes(status)) {
        run.endedAt = endedAt ?? nowIso();
      }
    }
  }

  addStepResult(result: StepResult): void {
    this.runs.get(result.runId)?.stepResults.push(result);
  }

  addMetricSample(sample: MetricSample): void {
    this.runs.get(sample.runId)?.metrics.push(sample);
  }

  addDeviceEvent(event: DeviceEvent): void {
    this.runs.get(event.runId)?.events.push(event);
  }

  async writeArtifact(relativePath: string, bytes: Buffer | string): Promise<{ absolutePath: string; sizeBytes: number }> {
    return { absolutePath: relativePath, sizeBytes: Buffer.byteLength(bytes) };
  }

  addArtifact(artifact: ArtifactRef): void {
    this.runs.get(artifact.runId ?? "")?.artifacts.push(artifact);
  }

  updateRunReport(runId: string, relativePath: string): void {
    const run = this.runs.get(runId);
    if (run) {
      run.reportHtmlPath = relativePath;
    }
  }

  listRunIdsByStatus(status: TestRun["status"]): string[] {
    return Array.from(this.runs.values()).filter((run) => run.status === status).map((run) => run.id);
  }

  listRuntimeInterceptorRules(): RuntimeInterceptorRule[] {
    return [];
  }

}

function homeHierarchy(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="主页" resource-id="com.demo:id/home_title" class="android.widget.TextView" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[180,200][300,280]" />
  </node>
</hierarchy>`;
}

function closeableBlockingHierarchy(text: string): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="×" resource-id="com.demo:id/close" class="android.widget.TextView" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[980,88][1036,144]" />
    <node index="1" text="${text}" resource-id="com.demo:id/blocking_title" class="android.widget.TextView" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[120,200][520,280]" />
  </node>
</hierarchy>`;
}
