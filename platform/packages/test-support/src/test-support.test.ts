import { describe, expect, it } from "vitest";
import { MockDriver } from "./index.js";

describe("MockDriver", () => {
  it("implements core automation driver behavior for regression tests", async () => {
    const driver = new MockDriver();

    await driver.performAction(driver.device.serial, { type: "tap", x: 10, y: 20 });
    driver.logs.push("mock log");

    const [tool] = await driver.getToolStatus();
    const screenshot = await driver.screenshot(driver.device.serial);
    const logs = await driver.collectLogs(driver.device.serial);
    const metric = await driver.samplePerformance(driver.device.serial, "run-1", "step-1");
    const recording = await driver.startVideoRecording(driver.device.serial, "run-1", "/tmp/run-1");
    const keptVideo = await driver.stopVideoRecording(recording, true);
    const droppedVideo = await driver.stopVideoRecording(recording, false);

    expect(tool?.available).toBe(true);
    expect(driver.actions).toEqual([{ type: "tap", x: 10, y: 20 }]);
    expect(screenshot.length).toBeGreaterThan(0);
    expect(logs).toBe("mock log");
    expect(metric.stepResultId).toBe("step-1");
    expect(keptVideo).toBe("/tmp/run-1/run-1.mp4");
    expect(droppedVideo).toBeUndefined();
  });

  it("creates tap steps for custom device sizes", () => {
    const driver = new MockDriver();
    const step = driver.createTapStep(50, 100, { width: 100, height: 200 });

    expect(step.coordinate?.xRatio).toBe(0.5);
    expect(step.coordinate?.yRatio).toBe(0.5);
    expect(step.coordinate?.deviceWidth).toBe(100);
    expect(step.coordinate?.deviceHeight).toBe(200);
  });
});
