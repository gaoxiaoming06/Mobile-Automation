import { describe, expect, it } from "vitest";
import {
  normalizeAndroidAppMonitorConfig,
  stepToAction,
  type ActionStep,
  type AndroidAppMonitorConfig,
  type AndroidAppMonitorThreshold
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
