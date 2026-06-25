import { describe, expect, it, vi } from "vitest";
import type { ActionStep, ArtifactRef, DeviceActionRequest } from "@mobile-automation/shared";
import type { OcrInput, OcrResult, OcrService } from "./ocr.js";
import { ConditionalStepExecutor } from "./conditional-step-executor.js";
import type { ScreenshotCapture } from "./step-expectations.js";

describe("ConditionalStepExecutor", () => {
  it("performs tap_if_text when the OCR condition matches", async () => {
    const actions: DeviceActionRequest[] = [];
    const executor = new ConditionalStepExecutor({
      ocr: new FakeOcrService("允许 通知权限"),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureConditionScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`, "screen")
    });

    const outcome = await executor.executeIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      step: conditionalStep({ text: "允许", mode: "contains" }, { x: 120, y: 240 })
    });

    expect(actions).toEqual([{ type: "tap", x: 120, y: 240 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        performed: true,
        message: "Condition matched after 1 attempt(s).",
        metadata: expect.objectContaining({
          matched: true,
          action: "tap",
          evidenceArtifactIds: ["artifact-1"]
        })
      })
    );
  });

  it("skips tap_if_text when the OCR condition is absent", async () => {
    const performAction = vi.fn();
    const executor = new ConditionalStepExecutor({
      ocr: new FakeOcrService("首页"),
      performAction,
      captureConditionScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`, "screen")
    });

    const outcome = await executor.executeIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      step: conditionalStep({ text: "允许", timeoutMs: 1, intervalMs: 1 }, { x: 120, y: 240 })
    });

    expect(performAction).not.toHaveBeenCalled();
    expect(outcome).toEqual(
      expect.objectContaining({
        performed: false,
        metadata: expect.objectContaining({
          matched: false,
          action: "skip"
        })
      })
    );
  });

  it("returns undefined for non-conditional steps", async () => {
    const executor = new ConditionalStepExecutor({
      ocr: new FakeOcrService(""),
      performAction: vi.fn(),
      captureConditionScreenshot: async () => screenshot("artifact-1", "screen")
    });

    await expect(
      executor.executeIfNeeded({
        runId: "run-1",
        stepResultId: "step-result-1",
        serial: "device-1",
        step: {
          ...conditionalStep({ text: "允许" }, { x: 120, y: 240 }),
          type: "tap"
        }
      })
    ).resolves.toBeUndefined();
  });

  it("skips with metadata when OCR region params are invalid", async () => {
    const executor = new ConditionalStepExecutor({
      ocr: new FakeOcrService("允许"),
      performAction: vi.fn(),
      captureConditionScreenshot: async () => screenshot("artifact-1", "screen")
    });

    const outcome = await executor.executeIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      step: conditionalStep({ text: "允许", region: { x: 0, y: 0, width: 0, height: 10 } }, { x: 120, y: 240 })
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        performed: false,
        artifacts: [],
        metadata: expect.objectContaining({
          actual: "OCR region is invalid.",
          attempts: 0,
          action: "skip"
        })
      })
    );
  });
});

function conditionalStep(params: Record<string, unknown>, coordinate: ActionStep["coordinate"]): ActionStep {
  return {
    id: "step-condition",
    order: 1,
    type: "tap_if_text",
    enabled: true,
    params,
    coordinate,
    createdAt: "2026-06-09T00:00:00.000Z"
  };
}

function screenshot(artifactId: string, content: string): ScreenshotCapture {
  return {
    artifact: artifact(artifactId),
    png: Buffer.from(content)
  };
}

function artifact(id: string): ArtifactRef {
  return {
    id,
    runId: "run-1",
    stepResultId: "step-result-1",
    type: "screenshot",
    name: `${id}.png`,
    path: `runs/run-1/screenshots/${id}.png`,
    url: `/artifacts/runs/run-1/screenshots/${id}.png`,
    createdAt: "2026-06-09T00:00:00.000Z"
  };
}

class FakeOcrService implements OcrService {
  constructor(private readonly text: string) {}

  async recognize(_input: OcrInput): Promise<OcrResult> {
    return {
      text: this.text,
      engine: "fake",
      lang: "zh-Hans"
    };
  }
}
