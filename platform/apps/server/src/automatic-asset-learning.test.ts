import { describe, expect, it, vi } from "vitest";
import type { LearningAggregate, LearningCandidate } from "@mobile-automation/shared";
import { AutomaticAssetLearningService, type AutomaticAssetLearningRepository } from "./automatic-asset-learning.js";

describe("AutomaticAssetLearningService", () => {
  it("publishes deterministic ready candidates without invoking AI", async () => {
    const repository = fakeRepository([aggregate({ status: "ready", analysisRequired: false })]);
    const analyze = vi.fn();
    const service = new AutomaticAssetLearningService({ repository, analyze });

    await service.runOnce();

    expect(analyze).not.toHaveBeenCalled();
    expect(repository.promote).toHaveBeenCalledWith(expect.objectContaining({ id: "aggregate-1" }), undefined);
  });

  it("uses AI only for awaiting candidates and publishes a verified proposal", async () => {
    const pending = aggregate({ status: "awaiting_ai", analysisRequired: true, kind: "page" });
    const repository = fakeRepository([pending]);
    const analysis = {
      decision: "approve" as const,
      canonicalName: "班级详情",
      canonicalKey: "class-detail",
      stableTexts: ["新课程", "创建教学方案"],
      dynamicTexts: [],
      confidence: 0.98,
      reason: "多次样本稳定",
      validationIssues: []
    };
    const analyze = vi.fn().mockResolvedValue(analysis);
    const service = new AutomaticAssetLearningService({ repository, analyze });

    await service.runOnce();

    expect(analyze).toHaveBeenCalledWith(pending);
    expect(repository.update).toHaveBeenCalledWith(pending.id, expect.objectContaining({
      status: "ready",
      analysis
    }));
    expect(repository.promote).toHaveBeenCalledWith(pending, analysis);
  });

  it("keeps observe decisions collecting and does not publish them", async () => {
    const pending = aggregate({ status: "awaiting_ai", analysisRequired: true, kind: "interaction" });
    const repository = fakeRepository([pending]);
    const analysis = {
      decision: "observe" as const,
      stableTexts: [],
      dynamicTexts: [],
      confidence: 0.6,
      reason: "证据仍不足",
      validationIssues: []
    };
    const service = new AutomaticAssetLearningService({
      repository,
      analyze: vi.fn().mockResolvedValue(analysis)
    });

    await service.runOnce();

    expect(repository.update).toHaveBeenCalledWith(pending.id, expect.objectContaining({
      status: "collecting",
      analysis
    }));
    expect(repository.promote).not.toHaveBeenCalled();
  });

  it("records AI failures without throwing into the execution path", async () => {
    const pending = aggregate({ status: "awaiting_ai", analysisRequired: true });
    const repository = fakeRepository([pending]);
    const service = new AutomaticAssetLearningService({
      repository,
      analyze: vi.fn().mockRejectedValue(new Error("model unavailable"))
    });

    await expect(service.runOnce()).resolves.toBeUndefined();

    expect(repository.update).toHaveBeenCalledWith(pending.id, {
      status: "analysis_failed",
      lastError: "model unavailable"
    });
    expect(repository.promote).not.toHaveBeenCalled();
  });

  it("leaves AI candidates pending when AI is disabled", async () => {
    const pending = aggregate({ status: "awaiting_ai", analysisRequired: true });
    const repository = fakeRepository([pending]);
    const analyze = vi.fn();
    const service = new AutomaticAssetLearningService({
      repository,
      analyze,
      canAnalyze: () => false
    });

    await service.runOnce();

    expect(analyze).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });
});

function aggregate(overrides: Partial<LearningAggregate> = {}): LearningAggregate {
  return {
    id: "aggregate-1",
    appId: "cn.eeo.classin",
    platform: "android",
    kind: "interaction",
    stableKey: "classin.home.tap.text.添加好友",
    representativeCandidateId: "candidate-1",
    status: "collecting",
    successfulRunCount: 3,
    distinctEvidenceCount: 3,
    analysisRequired: false,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    ...overrides
  };
}

function fakeRepository(aggregates: LearningAggregate[]): AutomaticAssetLearningRepository & {
  update: ReturnType<typeof vi.fn>;
  promote: ReturnType<typeof vi.fn>;
} {
  return {
    listPending: vi.fn().mockResolvedValue(aggregates),
    getCandidate: vi.fn().mockResolvedValue({
      id: "candidate-1",
      sessionId: "session-1",
      kind: "interaction",
      stableKey: "classin.home.tap.text.添加好友",
      confidence: 0.99,
      status: "validated",
      payload: { semanticContract: { text: "添加好友" } },
      evidenceArtifactIds: ["artifact-1"],
      validationIssues: [],
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z"
    } satisfies LearningCandidate),
    update: vi.fn().mockResolvedValue(undefined),
    promote: vi.fn().mockResolvedValue(undefined)
  };
}
