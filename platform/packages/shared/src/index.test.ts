import { describe, expect, it } from "vitest";
import { stepToAction, type ActionStep } from "./index.js";

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
