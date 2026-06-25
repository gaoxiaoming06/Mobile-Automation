export type PreviewGestureType = "tap" | "long_press" | "swipe";

export const swipeDistanceThresholdPx = 24;
export const longPressThresholdMs = 650;

export function classifyPreviewGesture(options: { distancePx: number; durationMs: number }): PreviewGestureType {
  if (options.distancePx > swipeDistanceThresholdPx) {
    return "swipe";
  }
  if (options.durationMs >= longPressThresholdMs) {
    return "long_press";
  }
  return "tap";
}
