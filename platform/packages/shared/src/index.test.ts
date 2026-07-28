import { describe, expect, it } from "vitest";
import {
  androidAppMonitorDisplaySummaryFromRun,
  normalizeAndroidAppMonitorConfig,
  stepToAction,
  type ActionStep,
  type AndroidAppMonitorConfig,
  type AndroidAppMonitorThreshold,
  type TestRun
} from "./index.js";

describe("shared stepToAction", () => {
  it("converts ratio-based tap coordinates to device coordinates", () => {
    expect(
      stepToAction(
        actionStep({
          type: "tap",
          coordinate: {
            xRatio: 0.5,
            yRatio: 0.25
          }
        }),
        { width: 1080, height: 2400 }
      )
    ).toEqual({ type: "tap", x: 540, y: 600 });
  });

  it("keeps semantic action steps out of direct device action conversion", () => {
    expect(() => stepToAction(actionStep({ type: "tap_on_text", params: { text: "进入课堂" } }))).toThrow("Unsupported direct action step: tap_on_text");
    expect(() => stepToAction(actionStep({ type: "tap_on_element", params: { selector: "button.start" } }))).toThrow("Unsupported direct action step: tap_on_element");
    expect(() => stepToAction(actionStep({ type: "tap_on_image", params: { baselineArtifactId: "artifact-1" } }))).toThrow("Unsupported direct action step: tap_on_image");
    expect(() => stepToAction(actionStep({ type: "input_text_to_element", params: { text: "hello" } }))).toThrow("Unsupported direct action step: input_text_to_element");
    expect(() => stepToAction(actionStep({ type: "scroll_until_visible", params: { text: "更多" } }))).toThrow("Unsupported direct action step: scroll_until_visible");
    expect(() => stepToAction(actionStep({ type: "wait_until_state", params: { text: "完成" } }))).toThrow("Unsupported direct action step: wait_until_state");
  });
});

describe("normalizeAndroidAppMonitorConfig", () => {
  it("fills default android app monitor values", () => {
    expect(normalizeAndroidAppMonitorConfig({ enabled: true, packageName: "cn.eeo.classin" })).toEqual({
      enabled: true,
      packageName: "cn.eeo.classin",
      includeSubprocesses: true,
      processFilters: [],
      cpuIntervalMs: 1000,
      memoryIntervalMs: 5000,
      lifecycleIntervalMs: 2000,
      enableHeapDump: false,
      thresholds: {}
    });
  });

  it("keeps explicit process filters and thresholds", () => {
    const cpuPercent: AndroidAppMonitorThreshold = {
      enabled: true,
      value: 85,
      sustainMs: 3000,
      cooldownMs: 10000
    };
    const pssMb: AndroidAppMonitorThreshold = {
      enabled: true,
      value: 512,
      sustainMs: 5000,
      cooldownMs: 15000
    };

    expect(
      normalizeAndroidAppMonitorConfig({
        enabled: true,
        packageName: "cn.eeo.classin",
        processFilters: ["main", ":privileged_process0"],
        thresholds: {
          cpuPercent,
          pssMb
        }
      })
    ).toMatchObject({
      processFilters: ["main", ":privileged_process0"],
      thresholds: {
        cpuPercent,
        pssMb
      }
    });
  });

  it("isolates normalized process filters and thresholds from input references", () => {
    const cpuPercent: AndroidAppMonitorThreshold = {
      enabled: true,
      value: 85,
      sustainMs: 3000,
      cooldownMs: 10000
    };
    const config = {
      enabled: true,
      packageName: "cn.eeo.classin",
      processFilters: ["main"],
      thresholds: {
        cpuPercent
      }
    } satisfies AndroidAppMonitorConfig;

    const normalized = normalizeAndroidAppMonitorConfig(config);
    const normalizedCpuPercent = normalized.thresholds.cpuPercent;
    if (!normalizedCpuPercent) {
      throw new Error("Expected normalized cpu threshold");
    }

    normalized.processFilters.push(":privileged_process0");
    normalizedCpuPercent.value = 42;

    expect(config.processFilters).toEqual(["main"]);
    expect(cpuPercent.value).toBe(85);
    expect(config.thresholds.cpuPercent?.value).toBe(85);
  });

  it("normalizes disabled config without dropping package name or thresholds", () => {
    const cpuPercent: AndroidAppMonitorThreshold = {
      enabled: false,
      value: 90,
      sustainMs: 1000,
      cooldownMs: 5000
    };

    expect(
      normalizeAndroidAppMonitorConfig({
        enabled: false,
        packageName: "cn.eeo.classin",
        thresholds: {
          cpuPercent
        }
      })
    ).toEqual({
      enabled: false,
      packageName: "cn.eeo.classin",
      includeSubprocesses: true,
      processFilters: [],
      cpuIntervalMs: 1000,
      memoryIntervalMs: 5000,
      lifecycleIntervalMs: 2000,
      enableHeapDump: false,
      thresholds: {
        cpuPercent
      }
    });
  });
});

describe("androidAppMonitorDisplaySummaryFromRun", () => {
  it("extracts readable app performance summary from android app monitor event detail", () => {
    expect(
      androidAppMonitorDisplaySummaryFromRun(
        runWithAndroidAppMonitorEvent({
          severity: "warning",
          detail: JSON.stringify({
            packageName: "cn.eeo.classin",
            sampleCounts: { cpu: 12, memory: 6, lifecycle: 4 },
            processes: [
              { pid: 123, processName: "cn.eeo.classin", isMainProcess: true },
              { pid: 456, processName: "cn.eeo.classin:worker", isMainProcess: false }
            ],
            incidents: 1
          })
        })
      )
    ).toEqual({
      packageName: "cn.eeo.classin",
      processCount: 2,
      cpuSamples: 12,
      memorySamples: 6,
      lifecycleSamples: 4,
      incidentCount: 1,
      severity: "warning"
    });
  });
});

function actionStep(overrides: Partial<ActionStep>): ActionStep {
  return {
    id: "step-1",
    order: 1,
    type: "tap",
    enabled: true,
    params: {},
    createdAt: "2026-06-09T00:00:00.000Z",
    ...overrides
  };
}

function runWithAndroidAppMonitorEvent(overrides: Partial<TestRun["events"][number]>): TestRun {
  return {
    id: "run-monitor",
    caseName: "Monitor",
    deviceSerial: "device-1",
    status: "passed",
    config: {
      deviceSerial: "device-1",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 0,
      stopOnFailure: true,
      recordVideo: false,
      keepVideoOnSuccess: false
    },
    steps: [],
    stepResults: [],
    metrics: [],
    events: [
      {
        id: "event-monitor",
        runId: "run-monitor",
        deviceSerial: "device-1",
        type: "android_app_monitor",
        severity: "info",
        occurredAt: "2026-06-09T00:00:00.000Z",
        summary: "[Android App Monitor] collected 0 CPU, 0 memory, 0 lifecycle samples",
        artifactIds: [],
        ...overrides
      }
    ],
    artifacts: [],
    startedAt: "2026-06-09T00:00:00.000Z"
  };
}
