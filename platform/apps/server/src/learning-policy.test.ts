import { describe, expect, it } from "vitest";
import type { LearningCandidate } from "@mobile-automation/shared";
import { automaticLearningDecision } from "./learning-policy.js";

describe("automatic learning policy", () => {
  it("promotes a high-confidence validated interaction with execution evidence", () => {
    expect(automaticLearningDecision(candidate())).toEqual({ accept: true, reason: "eligible" });
  });

  it("promotes a verified semantic navigation entry", () => {
    expect(automaticLearningDecision(candidate({
      kind: "navigation",
      confidence: 0.98,
      payload: {
        name: "主页进入成长页",
        from: { kind: "page", key: "classin.home" },
        toPage: "classin.growth",
        action: { kind: "tap", target: { text: "成长", area: "bottomBar" } }
      }
    }))).toEqual({ accept: true, reason: "eligible" });
  });

  it.each([
    ["unvalidated", { status: "needs_review" as const }],
    ["low_confidence", { confidence: 0.94 }],
    ["missing_evidence", { evidenceArtifactIds: [] }],
    ["validation_issues", { validationIssues: ["ambiguous"] }],
    ["unsupported_kind", { kind: "page" as const }]
  ])("rejects %s candidates", (_reason, override) => {
    expect(automaticLearningDecision(candidate(override))).toMatchObject({ accept: false, reason: _reason });
  });

  it("rejects coordinate-dependent evidence", () => {
    expect(automaticLearningDecision(candidate({
      payload: {
        owner: { kind: "page", key: "classin.home" },
        semanticContract: { icon: "add" },
        locatorEvidence: { strategy: "fixed", coordinate: { x: 10, y: 20 } }
      }
    }))).toMatchObject({ accept: false, reason: "coordinate_dependent" });
  });

  it.each(["13800138000", "teacher@example.com", "secret-password-12345678"])(
    "rejects dynamic or sensitive literal %s",
    (text) => {
      expect(automaticLearningDecision(candidate({
        payload: {
          owner: { kind: "page", key: "classin.home" },
          semanticContract: { text },
          locatorEvidence: { strategy: "ocr_text", selectedText: text }
        }
      }))).toMatchObject({ accept: false, reason: "dynamic_or_sensitive_literal" });
    }
  );

  it("allows parameter placeholders because they do not persist runtime values", () => {
    expect(automaticLearningDecision(candidate({
      payload: {
        owner: { kind: "page", key: "classin.home" },
        semanticContract: { text: "${className}" },
        locatorEvidence: { strategy: "ocr_text" }
      }
    }))).toEqual({ accept: true, reason: "eligible" });
  });
});

function candidate(override: Partial<LearningCandidate> = {}): LearningCandidate {
  return {
    id: "candidate-1",
    sessionId: "session-1",
    kind: "interaction",
    stableKey: "classin.home.tap.text.添加好友",
    sourceStepId: "open-add-friend",
    confidence: 0.95,
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
