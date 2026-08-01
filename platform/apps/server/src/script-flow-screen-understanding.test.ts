import { describe, expect, it } from "vitest";
import type { Observation } from "@mobile-automation/graph-core";
import { understandScreenForScriptFlow } from "./script-flow-screen-understanding.js";

describe("script flow screen understanding", () => {
  it("uses screenshot evidence and returns a sanitized screen understanding context", async () => {
    const requests: unknown[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              page: { key: "classin.lesson.create", name: "新建课堂", confidence: 0.92 },
              visibleStableTexts: ["课堂信息", "发布"],
              dynamicTexts: [{ text: "小王", reason: "name" }],
              controlCandidates: [
                {
                  candidateId: "field.lessonName",
                  control: "textField",
                  semanticName: "lessonName",
                  scopeText: "课堂信息",
                  ordinal: 1,
                  currentValue: "小王",
                  valueKind: "dynamicValue",
                  confidence: 0.78,
                  assetEligible: true
                },
                {
                  candidateId: "bad.publish",
                  control: "button",
                  text: "发布",
                  bounds: { x: 1, y: 2, width: 3, height: 4 },
                  confidence: 0.8,
                  assetEligible: true
                }
              ],
              warnings: []
            })
          }
        }]
      });
    };

    const context = await understandScreenForScriptFlow({
      config: {
        enabled: true,
        baseURL: "https://ai.example.test/v1",
        apiKey: "token",
        model: "vision-planner",
        timeoutMs: 1000
      },
      prompt: "把当前页面课堂名字改成自动化课堂",
      appId: "cn.eeo.classin",
      platform: "android",
      observation: observation(),
      fetchImpl
    });

    expect(context).toMatchObject({
      used: true,
      observationId: "observation-1",
      visionUsed: true,
      page: { key: "classin.lesson.create", name: "新建课堂", confidence: 0.92 },
      controlCandidates: [{
        candidateId: "field.lessonName",
        control: "textField",
        semanticName: "lessonName",
        scopeText: "课堂信息",
        ordinal: 1,
        valueKind: "dynamicValue",
        confidence: 0.78,
        assetEligible: false
      }]
    });
    expect(JSON.stringify(context)).not.toContain("小王");
    expect(context.rejectedReasons).toContain("controlCandidates[1] rejected because it contains bounds");
    expect(JSON.stringify(requests[0])).toContain("data:image/png;base64,aW1hZ2U=");
    expect(JSON.stringify(requests[0])).not.toContain("18743085313");
  });
});

function observation(): Observation {
  return {
    id: "observation-1",
    deviceSerial: "device-1",
    platform: "android",
    capturedAt: "2026-08-01T00:00:00.000Z",
    resolution: { width: 1000, height: 2000 },
    screenshot: { width: 1000, height: 2000, sizeBytes: 10 },
    uiElements: [],
    ocrTexts: [
      { text: "课堂信息", source: "ocr" },
      { text: "18743085313", source: "ocr" }
    ],
    raw: { screenshotBase64: "aW1hZ2U=" }
  };
}
