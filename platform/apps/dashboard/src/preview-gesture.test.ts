import { describe, expect, it } from "vitest";
import { classifyPreviewGesture, longPressThresholdMs, swipeDistanceThresholdPx } from "./preview-gesture.js";

describe("classifyPreviewGesture", () => {
  it("keeps short stationary touches as taps", () => {
    expect(classifyPreviewGesture({ distancePx: 2, durationMs: longPressThresholdMs - 1 })).toBe("tap");
  });

  it("classifies stationary holds as long press", () => {
    expect(classifyPreviewGesture({ distancePx: 2, durationMs: longPressThresholdMs })).toBe("long_press");
  });

  it("keeps movement above the swipe threshold as swipe even when held", () => {
    expect(classifyPreviewGesture({ distancePx: swipeDistanceThresholdPx + 1, durationMs: longPressThresholdMs + 500 })).toBe("swipe");
  });
});
