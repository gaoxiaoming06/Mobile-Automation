import { describe, expect, it } from "vitest";
import {
  RunExecutionController,
  RunStateMachine,
  enabledSteps,
  normalizeRunConfig,
  shouldRecordVideoForDevice,
  totalStepExecutions
} from "./index.js";
import { defaultAndroidCapabilities, defaultIosCapabilities, type ActionStep } from "@mobile-automation/shared";

const steps: ActionStep[] = [
  {
    id: "2",
    order: 2,
    type: "back",
    enabled: true,
    params: {},
    createdAt: "2026-06-04T00:00:00.000Z"
  },
  {
    id: "1",
    order: 1,
    type: "tap",
    enabled: false,
    params: {},
    createdAt: "2026-06-04T00:00:00.000Z"
  }
];

describe("runner-core", () => {
  it("normalizes repeat count", () => {
    const config = normalizeRunConfig({ deviceSerial: "serial", repeatCount: 3 });

    expect(config.mode).toBe("repeat_n");
    expect(config.repeatCount).toBe(3);
  });

  it("sorts and filters enabled steps", () => {
    expect(enabledSteps(steps).map((step) => step.id)).toEqual(["2"]);
  });

  it("counts total executions", () => {
    const config = normalizeRunConfig({ deviceSerial: "serial", repeatCount: 4 });

    expect(totalStepExecutions(config, steps)).toBe(4);
  });

  it("only records video when the selected device reports recording capability", () => {
    const config = normalizeRunConfig({ deviceSerial: "serial", recordVideo: true });
    const androidCapabilities = defaultAndroidCapabilities();
    androidCapabilities.recordVideo = true;

    expect(shouldRecordVideoForDevice(config, { capabilities: androidCapabilities })).toBe(true);
    expect(shouldRecordVideoForDevice(config, { capabilities: defaultIosCapabilities({ recordVideo: false }) })).toBe(false);
    expect(shouldRecordVideoForDevice({ ...config, recordVideo: false }, { capabilities: androidCapabilities })).toBe(false);
  });

  it("keeps successful run videos by default as test evidence", () => {
    expect(normalizeRunConfig({ deviceSerial: "serial" }).keepVideoOnSuccess).toBe(true);
    expect(normalizeRunConfig({ deviceSerial: "serial", keepVideoOnSuccess: false }).keepVideoOnSuccess).toBe(false);
  });

  it("preserves android app monitor config without mutating input", () => {
    const input = {
      deviceSerial: "serial",
      androidAppMonitor: {
        enabled: true,
        packageName: "com.demo",
        includeSubprocesses: false,
        processFilters: [":push"],
        thresholds: {
          cpuPercent: { enabled: true, value: 80, sustainMs: 1000, cooldownMs: 5000 }
        }
      }
    };

    const config = normalizeRunConfig(input);

    expect(config.androidAppMonitor).toEqual(input.androidAppMonitor);
    expect(config.androidAppMonitor).not.toBe(input.androidAppMonitor);
    expect(config.androidAppMonitor?.processFilters).not.toBe(input.androidAppMonitor.processFilters);
    expect(config.androidAppMonitor?.thresholds?.cpuPercent).not.toBe(input.androidAppMonitor.thresholds.cpuPercent);

    config.androidAppMonitor?.processFilters?.push(":worker");
    if (config.androidAppMonitor?.thresholds?.cpuPercent) {
      config.androidAppMonitor.thresholds.cpuPercent.value = 90;
    }
    expect(input.androidAppMonitor.processFilters).toEqual([":push"]);
    expect(input.androidAppMonitor.thresholds.cpuPercent.value).toBe(80);
  });

  it("executes repeat_n with enabled steps only", async () => {
    const controller = new RunExecutionController();
    const executed: string[] = [];
    const machine = new RunStateMachine({
      controller,
      config: normalizeRunConfig({ deviceSerial: "serial", repeatCount: 3, stepIntervalMs: 0 }),
      steps,
      executeStep: async ({ iterationIndex, step }) => {
        executed.push(`${iterationIndex}:${step.id}`);
        return { status: "passed" };
      }
    });

    const result = await machine.run();

    expect(result.status).toBe("passed");
    expect(result.completedIterationCount).toBe(3);
    expect(executed).toEqual(["1:2", "2:2", "3:2"]);
  });

  it("stops after the first failed step when stopOnFailure is enabled", async () => {
    const controller = new RunExecutionController();
    const executed: string[] = [];
    const machine = new RunStateMachine({
      controller,
      config: normalizeRunConfig({ deviceSerial: "serial", repeatCount: 3, stepIntervalMs: 0, stopOnFailure: true }),
      steps,
      executeStep: async ({ step }) => {
        executed.push(step.id);
        return { status: "failed" };
      }
    });

    const result = await machine.run();

    expect(result.status).toBe("failed");
    expect(result.executedStepCount).toBe(1);
    expect(executed).toEqual(["2"]);
  });

  it("continues after an optional skipped step", async () => {
    const controller = new RunExecutionController();
    const executableSteps = [
      { ...steps[0], id: "optional", order: 1 },
      { ...steps[0], id: "next", order: 2 }
    ];
    const executed: string[] = [];
    const machine = new RunStateMachine({
      controller,
      config: normalizeRunConfig({ deviceSerial: "serial", stepIntervalMs: 0, stopOnFailure: true }),
      steps: executableSteps,
      executeStep: async ({ step }) => {
        executed.push(step.id);
        return { status: step.id === "optional" ? "skipped" : "passed" };
      }
    });

    const result = await machine.run();

    expect(result.status).toBe("passed");
    expect(result.executedStepCount).toBe(2);
    expect(executed).toEqual(["optional", "next"]);
  });

  it("pauses after each step and resumes on demand", async () => {
    const controller = new RunExecutionController();
    const statusChanges: string[] = [];
    const executableSteps = [
      { ...steps[0], id: "first", order: 1 },
      { ...steps[0], id: "second", order: 2 }
    ];
    const executed: string[] = [];
    const machine = new RunStateMachine({
      controller,
      config: normalizeRunConfig({ deviceSerial: "serial", stepIntervalMs: 0, pauseAfterEachStep: true }),
      steps: executableSteps,
      onStatusChange: (status) => statusChanges.push(status),
      executeStep: async ({ step }) => {
        executed.push(step.id);
        return { status: "passed" };
      }
    });

    const runPromise = machine.run();
    await eventually(() => executed.length === 1);
    await eventually(() => controller.status === "paused");

    expect(controller.status).toBe("paused");
    expect(statusChanges).toContain("paused");

    controller.resume();
    const result = await runPromise;

    expect(result.status).toBe("passed");
    expect(executed).toEqual(["first", "second"]);
  });

  it("supports single stepping while paused", async () => {
    const controller = new RunExecutionController();
    const executableSteps = [
      { ...steps[0], id: "first", order: 1 },
      { ...steps[0], id: "second", order: 2 }
    ];
    const executed: string[] = [];
    controller.pause();
    const machine = new RunStateMachine({
      controller,
      config: normalizeRunConfig({ deviceSerial: "serial", stepIntervalMs: 0 }),
      steps: executableSteps,
      executeStep: async ({ step }) => {
        executed.push(step.id);
        return { status: "passed" };
      }
    });

    const runPromise = machine.run();
    await delay(0);
    expect(executed).toEqual([]);

    controller.step();
    await eventually(() => executed.length === 1);
    expect(controller.status).toBe("paused");

    controller.step();
    const result = await runPromise;

    expect(result.status).toBe("passed");
    expect(executed).toEqual(["first", "second"]);
  });

  it("runs loop_until_stop until the controller stops it", async () => {
    const controller = new RunExecutionController();
    const executed: string[] = [];
    const machine = new RunStateMachine({
      controller,
      config: normalizeRunConfig({ deviceSerial: "serial", mode: "loop_until_stop", stepIntervalMs: 0 }),
      steps,
      executeStep: async ({ iterationIndex, step }) => {
        executed.push(`${iterationIndex}:${step.id}`);
        if (executed.length === 3) {
          controller.stop();
        }
        return { status: "passed" };
      }
    });

    const result = await machine.run();

    expect(result.status).toBe("stopped");
    expect(executed).toEqual(["1:2", "2:2", "3:2"]);
  });
});

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await delay(5);
  }
  throw new Error("Condition was not met");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
