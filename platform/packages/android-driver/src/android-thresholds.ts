import { type AndroidAppMonitorThreshold } from "@mobile-automation/shared";

export type ThresholdBreach = {
  startedAtMs: number;
  triggeredAtMs: number;
  value: number;
  peakValue: number;
};

type ActiveBreach = {
  startedAtMs: number;
  peakValue: number;
};

export class ThresholdTracker {
  private active?: ActiveBreach;
  private lastTriggeredAtMs?: number;

  constructor(private readonly threshold: AndroidAppMonitorThreshold) {}

  observe(value: number | undefined, observedAtMs: number): ThresholdBreach | undefined {
    if (!this.threshold.enabled || value === undefined) {
      this.active = undefined;
      return undefined;
    }

    if (value < this.threshold.value) {
      this.active = undefined;
      return undefined;
    }

    this.active = this.active
      ? {
          ...this.active,
          peakValue: Math.max(this.active.peakValue, value)
        }
      : {
          startedAtMs: observedAtMs,
          peakValue: value
        };

    if (observedAtMs - this.active.startedAtMs < this.threshold.sustainMs) {
      return undefined;
    }
    if (this.lastTriggeredAtMs !== undefined && observedAtMs - this.lastTriggeredAtMs < this.threshold.cooldownMs) {
      return undefined;
    }

    this.lastTriggeredAtMs = observedAtMs;
    return {
      startedAtMs: this.active.startedAtMs,
      triggeredAtMs: observedAtMs,
      value,
      peakValue: this.active.peakValue
    };
  }
}
