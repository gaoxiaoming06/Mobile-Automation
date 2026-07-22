import { describe, expect, it } from "vitest";
import { type AndroidAppMonitorThreshold } from "@mobile-automation/shared";
import { ThresholdTracker } from "./android-thresholds.js";

const threshold: AndroidAppMonitorThreshold = {
  enabled: true,
  value: 80,
  sustainMs: 1_000,
  cooldownMs: 2_000
};

describe("ThresholdTracker", () => {
  it("does not alert for a short spike", () => {
    const tracker = new ThresholdTracker(threshold);

    expect(tracker.observe(90, 0)).toBeUndefined();
    expect(tracker.observe(70, 500)).toBeUndefined();
    expect(tracker.observe(90, 1_100)).toBeUndefined();
  });

  it("alerts after the value stays at or above the threshold for sustainMs", () => {
    const tracker = new ThresholdTracker(threshold);

    expect(tracker.observe(80, 1_000)).toBeUndefined();
    expect(tracker.observe(95, 1_500)).toBeUndefined();

    expect(tracker.observe(90, 2_000)).toEqual({
      startedAtMs: 1_000,
      triggeredAtMs: 2_000,
      value: 90,
      peakValue: 95
    });
  });

  it("merges observations during cooldown and does not repeat an alert", () => {
    const tracker = new ThresholdTracker(threshold);

    expect(tracker.observe(90, 0)).toBeUndefined();
    expect(tracker.observe(100, 1_000)).toEqual({
      startedAtMs: 0,
      triggeredAtMs: 1_000,
      value: 100,
      peakValue: 100
    });
    expect(tracker.observe(110, 2_000)).toBeUndefined();
    expect(tracker.observe(120, 2_999)).toBeUndefined();
    expect(tracker.observe(130, 3_000)).toEqual({
      startedAtMs: 0,
      triggeredAtMs: 3_000,
      value: 130,
      peakValue: 130
    });
  });

  it("resets after recovery so the next sustained breach can alert again", () => {
    const tracker = new ThresholdTracker(threshold);

    expect(tracker.observe(90, 0)).toBeUndefined();
    expect(tracker.observe(100, 1_000)).toEqual(
      expect.objectContaining({
        startedAtMs: 0,
        triggeredAtMs: 1_000
      })
    );
    expect(tracker.observe(70, 1_500)).toBeUndefined();
    expect(tracker.observe(90, 4_000)).toBeUndefined();
    expect(tracker.observe(95, 5_000)).toEqual({
      startedAtMs: 4_000,
      triggeredAtMs: 5_000,
      value: 95,
      peakValue: 95
    });
  });

  it("does not alert when disabled or the value is undefined", () => {
    const disabled = new ThresholdTracker({ ...threshold, enabled: false });
    const tracker = new ThresholdTracker(threshold);

    expect(disabled.observe(100, 0)).toBeUndefined();
    expect(disabled.observe(100, 2_000)).toBeUndefined();
    expect(tracker.observe(undefined, 0)).toBeUndefined();
    expect(tracker.observe(100, 500)).toBeUndefined();
  });
});
