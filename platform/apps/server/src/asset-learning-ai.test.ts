import { describe, expect, it } from "vitest";
import {
  buildAssetLearningPrompt,
  parseAssetLearningResponse,
  type AssetLearningSample
} from "./asset-learning-ai.js";

describe("asset learning AI boundary", () => {
  const samples: AssetLearningSample[] = [
    {
      runId: "run-1",
      artifactId: "shot-1",
      ocrTexts: ["课堂报告", "课程数据", "班级四十二号", "10:20"]
    },
    {
      runId: "run-2",
      artifactId: "shot-2",
      ocrTexts: ["课堂报告", "课程数据", "班级十一号", "11:35"]
    },
    {
      runId: "run-3",
      artifactId: "shot-3",
      ocrTexts: ["课堂报告", "课程数据", "演示班", "12:10"]
    }
  ];

  it("asks the model to cite observed evidence and never to publish assets", () => {
    const prompt = buildAssetLearningPrompt({
      kind: "page",
      stableKey: "unknown-page.report",
      payload: { suggestedName: "课堂报告" },
      samples
    });

    expect(prompt).toContain("课堂报告");
    expect(prompt).toContain("只能提出候选");
    expect(prompt).toContain("不得决定发布");
  });

  it("accepts only stable page identity text present in every sample", () => {
    expect(parseAssetLearningResponse(JSON.stringify({
      decision: "approve",
      canonicalName: "课堂报告",
      canonicalKey: "classroom-report",
      stableTexts: ["课堂报告", "课程数据"],
      dynamicTexts: ["班级四十二号"],
      confidence: 0.98,
      reason: "两个身份文案跨样本稳定"
    }), { kind: "page", samples })).toMatchObject({
      decision: "approve",
      canonicalKey: "classroom-report",
      stableTexts: ["课堂报告", "课程数据"]
    });
  });

  it("downgrades approval when the model cites invented or changing text", () => {
    expect(parseAssetLearningResponse(JSON.stringify({
      decision: "approve",
      canonicalName: "课堂报告",
      canonicalKey: "classroom-report",
      stableTexts: ["课堂报告", "班级四十二号", "AI 编造文案"],
      dynamicTexts: [],
      confidence: 0.99,
      reason: "看起来稳定"
    }), { kind: "page", samples })).toMatchObject({
      decision: "observe",
      stableTexts: ["课堂报告"]
    });
  });

  it("rejects sensitive literals even if they appear in every sample", () => {
    const sensitiveSamples = samples.map((sample) => ({
      ...sample,
      ocrTexts: [...sample.ocrTexts, "13800138000"]
    }));
    expect(parseAssetLearningResponse(JSON.stringify({
      decision: "approve",
      canonicalName: "账号页",
      canonicalKey: "account",
      stableTexts: ["课堂报告", "13800138000"],
      dynamicTexts: [],
      confidence: 0.99,
      reason: "稳定"
    }), { kind: "page", samples: sensitiveSamples })).toMatchObject({
      decision: "observe",
      stableTexts: ["课堂报告"]
    });
  });
});
