import { describe, expect, it } from "vitest";
import type { Observation } from "@mobile-automation/graph-core";
import type { ScreenUnderstandingCandidate } from "@mobile-automation/shared";
import { buildScreenEvidence, sanitizeScreenUnderstandingCandidate } from "./script-flow-screen-context.js";

describe("script flow screen context", () => {
  it("keeps screenshot image evidence while redacting dynamic sensitive OCR text from prompt evidence", () => {
    const evidence = buildScreenEvidence(observation({
      ocrTexts: [
        { text: "课堂信息", source: "ocr", region: { x: 10, y: 10, width: 120, height: 40 } },
        { text: "手机号 18743085313", source: "ocr", region: { x: 10, y: 60, width: 180, height: 40 } },
        { text: "teacher@example.com", source: "ocr", region: { x: 10, y: 110, width: 200, height: 40 } }
      ],
      raw: { screenshotBase64: "aW1hZ2U=" }
    }));

    const promptJson = JSON.stringify(evidence.promptEvidence);
    expect(evidence.imagePngBase64).toBe("aW1hZ2U=");
    expect(promptJson).toContain("课堂信息");
    expect(promptJson).not.toContain("18743085313");
    expect(promptJson).not.toContain("teacher@example.com");
  });

  it("does not expose coordinates or platform-private identifiers in prompt evidence", () => {
    const evidence = buildScreenEvidence(observation({
      ocrTexts: [{ text: "发布", source: "ocr", region: { x: 10, y: 20, width: 80, height: 40 } }],
      uiElements: [{
        text: "发布",
        resourceId: "cn.eeo.classin:id/publish",
        accessibilityId: "publish_button",
        bounds: { x: 100, y: 200, width: 120, height: 48 },
        clickable: true,
        visible: true
      }],
      raw: { screenshotBase64: "aW1hZ2U=" }
    }));

    const promptJson = JSON.stringify(evidence.promptEvidence);
    expect(promptJson).not.toContain('"x"');
    expect(promptJson).not.toContain('"region"');
    expect(promptJson).not.toContain('"bounds"');
    expect(promptJson).not.toContain('"resourceId"');
    expect(promptJson).not.toContain('"accessibilityId"');
    expect(promptJson).not.toContain("cn.eeo.classin:id/publish");
    expect(promptJson).not.toContain("publish_button");
    expect(promptJson).not.toContain("aW1hZ2U=");
  });

  it("drops dynamic current values and downgrades asset eligibility", () => {
    const context = sanitizeScreenUnderstandingCandidate({
      observationId: "observation-1",
      visionUsed: true,
      candidate: {
        page: { key: "classin.lesson.create", name: "新建课堂", confidence: 0.91 },
        visibleStableTexts: ["课堂信息", "发布"],
        dynamicTexts: [{ text: "小王", reason: "name" }],
        controlCandidates: [{
          candidateId: "field.lessonName",
          control: "textField",
          semanticName: "lessonName",
          scopeText: "课堂信息",
          ordinal: 1,
          currentValue: "小王",
          valueKind: "dynamicValue",
          confidence: 0.76,
          assetEligible: true
        }],
        warnings: []
      }
    });

    expect(context.controlCandidates).toEqual([{
      candidateId: "field.lessonName",
      control: "textField",
      semanticName: "lessonName",
      scopeText: "课堂信息",
      ordinal: 1,
      valueKind: "dynamicValue",
      confidence: 0.76,
      assetEligible: false
    }]);
    expect(JSON.stringify(context)).not.toContain("小王");
    expect(context.rejectedReasons).toContain("controlCandidates[0].currentValue removed because valueKind is dynamicValue");
  });

  it("rejects AI control candidates that include coordinates or platform-private fields", () => {
    const context = sanitizeScreenUnderstandingCandidate({
      observationId: "observation-1",
      visionUsed: true,
      candidate: {
        page: { name: "新建课堂", confidence: 0.91 },
        visibleStableTexts: ["发布"],
        dynamicTexts: [],
        controlCandidates: [
          {
            candidateId: "bad.bounds",
            control: "button",
            text: "发布",
            bounds: { x: 1, y: 2, width: 3, height: 4 },
            confidence: 0.8,
            assetEligible: true
          },
          {
            candidateId: "bad.resource",
            control: "button",
            text: "发布",
            resourceId: "cn.eeo.classin:id/publish",
            accessibilityId: "publish_button",
            confidence: 0.8,
            assetEligible: true
          },
          {
            candidateId: "good.publish",
            control: "button",
            text: "发布",
            confidence: 0.8,
            assetEligible: true
          }
        ],
        warnings: []
      } as unknown as ScreenUnderstandingCandidate
    });

    expect(context.controlCandidates).toEqual([{
      candidateId: "good.publish",
      control: "button",
      text: "发布",
      confidence: 0.8,
      assetEligible: true
    }]);
    expect(context.rejectedReasons).toEqual(expect.arrayContaining([
      "controlCandidates[0] rejected because it contains bounds",
      "controlCandidates[1] rejected because it contains resourceId",
      "controlCandidates[1] rejected because it contains accessibilityId"
    ]));
    expect(JSON.stringify(context.controlCandidates)).not.toContain("bounds");
    expect(JSON.stringify(context.controlCandidates)).not.toContain("resourceId");
    expect(JSON.stringify(context.controlCandidates)).not.toContain("accessibilityId");
  });
});

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "observation-1",
    deviceSerial: "serial-1",
    platform: "android",
    capturedAt: "2026-08-01T00:00:00.000Z",
    resolution: { width: 1000, height: 2000 },
    screenshot: { width: 1000, height: 2000, sizeBytes: 10 },
    uiElements: [],
    ocrTexts: [],
    raw: {},
    ...overrides
  };
}
