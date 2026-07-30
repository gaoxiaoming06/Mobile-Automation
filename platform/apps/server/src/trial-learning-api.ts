import type express from "express";
import type { FlowVerification, LearningSession } from "@mobile-automation/shared";
import type { Storage } from "./storage.js";

export type TrialLearningApiStorage = Pick<
  Storage,
  | "getLearningSessionForRun"
  | "listFlowVerificationsForRun"
  | "reviewTrialOutcome"
>;

export function registerTrialLearningRoutes(
  app: express.Application,
  deps: { storage: TrialLearningApiStorage }
): void {
  app.get("/api/trial-runs/:runId/learning-summary", (req, res) => {
    const session = deps.storage.getLearningSessionForRun(req.params.runId);
    if (!session) {
      res.status(404).json({ error: "Learning session not found" });
      return;
    }
    res.json({
      session,
      verification: deps.storage.listFlowVerificationsForRun(req.params.runId)[0]
    } satisfies LearningSummaryResponse);
  });

  app.post("/api/trial-runs/:runId/outcome-review", (req, res) => {
    try {
      const body = strictReviewBody(req.body);
      if (!deps.storage.getLearningSessionForRun(req.params.runId)) {
        res.status(404).json({ error: "Learning session not found" });
        return;
      }
      res.json(deps.storage.reviewTrialOutcome(req.params.runId, body.decision));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(message === "Trial outcome is not awaiting review" ? 409 : 400).json({ error: message });
    }
  });
}

type LearningSummaryResponse = {
  session: LearningSession;
  verification?: FlowVerification;
};

function strictReviewBody(value: unknown): { decision: "confirmed" | "rejected" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be an object");
  }
  const body = value as Record<string, unknown>;
  const unknown = Object.keys(body).find((key) => key !== "decision");
  if (unknown) throw new Error(`Unknown request field: ${unknown}`);
  if (body.decision !== "confirmed" && body.decision !== "rejected") {
    throw new Error("decision must be confirmed or rejected");
  }
  return { decision: body.decision };
}
