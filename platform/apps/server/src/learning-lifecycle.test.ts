import { describe, expect, it } from "vitest";
import type { LearningCandidate } from "@mobile-automation/shared";
import {
  learningAggregateReadiness,
  nextAggregateStatusAfterAi,
  requiresAiLearningAnalysis
} from "./learning-lifecycle.js";

describe("automatic learning lifecycle", () => {
  it("keeps a candidate collecting until evidence spans three runs and two distinct samples", () => {
    expect(learningAggregateReadiness({
      candidate: interactionCandidate(),
      successfulRunCount: 2,
      distinctEvidenceCount: 2
    })).toEqual({ status: "collecting", reason: "insufficient_runs" });

    expect(learningAggregateReadiness({
      candidate: interactionCandidate(),
      successfulRunCount: 3,
      distinctEvidenceCount: 1
    })).toEqual({ status: "collecting", reason: "insufficient_evidence_variation" });
  });

  it("allows a repeated exact text interaction to become ready without an AI call", () => {
    expect(requiresAiLearningAnalysis(interactionCandidate())).toBe(false);
    expect(learningAggregateReadiness({
      candidate: interactionCandidate(),
      successfulRunCount: 3,
      distinctEvidenceCount: 2
    })).toEqual({ status: "ready", reason: "deterministic_evidence" });
  });

  it("requires AI analysis for page identity and non-text semantic targets", () => {
    expect(requiresAiLearningAnalysis(pageCandidate())).toBe(true);
    expect(requiresAiLearningAnalysis(interactionCandidate({
      payload: {
        owner: { kind: "page", key: "classin.home" },
        name: "右上角加号",
        supportedAction: "tap",
        semanticContract: { icon: "add", area: "top", position: "right" },
        locatorEvidence: { strategy: "visual_icon" }
      }
    }))).toBe(true);
    expect(learningAggregateReadiness({
      candidate: pageCandidate(),
      successfulRunCount: 3,
      distinctEvidenceCount: 2
    })).toEqual({ status: "awaiting_ai", reason: "ai_analysis_required" });
  });

  it("maps AI decisions without letting the model publish an asset directly", () => {
    expect(nextAggregateStatusAfterAi("approve")).toEqual({ status: "ready", reason: "ai_proposal_verified" });
    expect(nextAggregateStatusAfterAi("observe")).toEqual({ status: "collecting", reason: "more_samples_required" });
    expect(nextAggregateStatusAfterAi("reject")).toEqual({ status: "rejected", reason: "ai_rejected" });
  });
});

function interactionCandidate(override: Partial<LearningCandidate> = {}): LearningCandidate {
  return {
    id: "candidate-1",
    sessionId: "session-1",
    kind: "interaction",
    stableKey: "classin.home.tap.text.添加好友",
    sourceStepId: "open-add-friend",
    confidence: 0.98,
    status: "validated",
    payload: {
      owner: { kind: "page", key: "classin.home" },
      name: "添加好友",
      supportedAction: "tap",
      semanticContract: { text: "添加好友" },
      locatorEvidence: { strategy: "ocr_text", selectedText: "添加好友" }
    },
    evidenceArtifactIds: ["artifact-1"],
    validationIssues: [],
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    ...override
  };
}

function pageCandidate(): LearningCandidate {
  return interactionCandidate({
    kind: "page",
    stableKey: "unknown-page.flow-hash.assert-report",
    confidence: 0.75,
    status: "needs_review",
    payload: {
      suggestedName: "课堂报告",
      outcomeTexts: ["课堂报告", "课程数据"],
      sourceFlowName: "打开课堂报告"
    },
    validationIssues: ["requires_ai_identity"]
  });
}
