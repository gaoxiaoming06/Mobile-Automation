import { type ActionStep, type ArtifactRef, type DeviceActionRequest } from "@mobile-automation/shared";
import type { OcrService } from "./ocr.js";
import {
  matchTextExpectation,
  normalizeOcrText,
  positiveNumberParam,
  readOcrRegion,
  textExpectationMode,
  textExpectedDescription,
  tryRecognizeTextFromScreenshot,
  type OcrRegion,
  type ScreenshotCapture
} from "./step-expectations.js";

export type ConditionalStepOutcome = {
  performed: boolean;
  message: string;
  artifacts: ArtifactRef[];
  metadata: Record<string, unknown>;
};

type ConditionalStepExecutorDeps = {
  ocr: OcrService;
  performAction: (serial: string, action: DeviceActionRequest) => Promise<void>;
  captureConditionScreenshot: (runId: string, stepResultId: string, serial: string, stepId: string, attempt: number) => Promise<ScreenshotCapture>;
};

export class ConditionalStepExecutor {
  constructor(private readonly deps: ConditionalStepExecutorDeps) {}

  async executeIfNeeded(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<ConditionalStepOutcome | undefined> {
    const { runId, stepResultId, step, serial, deviceSize } = input;
    if (step.type !== "tap_if_text") {
      return undefined;
    }

    const expected = stringParam(step.params.text ?? step.params.expected).trim();
    const mode = textExpectationMode(step.params.mode);
    let region: OcrRegion | undefined;
    try {
      region = readOcrRegion(step.params);
    } catch (error) {
      return {
        performed: false,
        message: `Skipped optional tap because OCR region is invalid: ${errorToString(error)}`,
        artifacts: [],
        metadata: {
          type: "text",
          expected: expected ? textExpectedDescription(mode, expected) : "Text condition must configure text.",
          actual: "OCR region is invalid.",
          matched: false,
          attempts: 0,
          action: "skip",
          evidenceArtifactIds: []
        }
      };
    }
    const timeoutMs = positiveNumberParam(step.params.timeoutMs, 3000);
    const intervalMs = positiveNumberParam(step.params.intervalMs, 500);
    const started = Date.now();
    let attempt = 0;
    let latestText = "";
    const artifacts: ArtifactRef[] = [];

    while (Date.now() - started <= timeoutMs) {
      attempt += 1;
      const screenshot = await this.deps.captureConditionScreenshot(runId, stepResultId, serial, step.id, attempt);
      artifacts.push(screenshot.artifact);
      latestText = await tryRecognizeTextFromScreenshot(this.deps.ocr, screenshot, step.params);
      const matched = expected ? matchTextExpectation(normalizeOcrText(latestText), normalizeOcrText(expected), mode) : false;
      if (matched) {
        await this.deps.performAction(serial, tapActionFromStep(step, deviceSize));
        return {
          performed: true,
          message: `Condition matched after ${attempt} attempt(s).`,
          artifacts,
          metadata: {
            type: "text",
            expected: textExpectedDescription(mode, expected, region),
            actual: normalizeOcrText(latestText) || "(empty OCR result)",
            matched: true,
            attempts: attempt,
            action: "tap",
            evidenceArtifactIds: artifacts.map((artifact) => artifact.id)
          }
        };
      }

      const elapsed = Date.now() - started;
      if (elapsed >= timeoutMs) {
        break;
      }
      await sleep(Math.min(intervalMs, timeoutMs - elapsed));
    }

    return {
      performed: false,
      message: expected
        ? `Skipped optional tap because ${textExpectedDescription(mode, expected, region)} was not satisfied.`
        : "Skipped optional tap because no text condition was configured.",
      artifacts,
      metadata: {
        type: "text",
        expected: expected ? textExpectedDescription(mode, expected, region) : "Text condition must configure text.",
        actual: normalizeOcrText(latestText) || "(empty OCR result)",
        matched: false,
        attempts: attempt,
        action: "skip",
        evidenceArtifactIds: artifacts.map((artifact) => artifact.id)
      }
    };
  }
}

function stringParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function tapActionFromStep(step: ActionStep, deviceSize?: { width: number; height: number }): { type: "tap"; x: number; y: number } {
  return {
    type: "tap",
    x: readCoordinate(step.coordinate?.x, step.coordinate?.xRatio, deviceSize?.width),
    y: readCoordinate(step.coordinate?.y, step.coordinate?.yRatio, deviceSize?.height)
  };
}

function readCoordinate(value: number | undefined, ratio: number | undefined, size: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof ratio === "number" && typeof size === "number") {
    return Math.round(ratio * size);
  }
  throw new Error("Step coordinate is missing");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
