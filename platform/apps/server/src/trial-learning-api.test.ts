import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowVerification, LearningSession } from "@mobile-automation/shared";
import { registerTrialLearningRoutes, type TrialLearningApiStorage } from "./trial-learning-api.js";

describe("trial learning API", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it("returns only execution verification state for a trial run", async () => {
    const context = await apiContext(servers);

    expect(await get(context.baseUrl, "/api/trial-runs/run-1/learning-summary")).toEqual({
      status: 200,
      body: {
        session: expect.objectContaining({ runId: "run-1", status: "needs_outcome_review" }),
        verification: expect.objectContaining({ runId: "run-1", status: "provisional" })
      }
    });
  });

  it("confirms or rejects the business outcome through an explicit review request", async () => {
    const context = await apiContext(servers);

    expect(await post(context.baseUrl, "/api/trial-runs/run-1/outcome-review", { decision: "confirmed" })).toEqual({
      status: 200,
      body: {
        session: expect.objectContaining({ outcomeStatus: "human_confirmed", status: "ready" }),
        verification: expect.objectContaining({ status: "verified" })
      }
    });
    expect(context.storage.decisions).toEqual([{ runId: "run-1", decision: "confirmed" }]);

    expect(await post(context.baseUrl, "/api/trial-runs/run-1/outcome-review", { decision: "yes" })).toEqual({
      status: 400,
      body: { error: "decision must be confirmed or rejected" }
    });
  });

  it("returns 404 when a run has no learning session", async () => {
    const context = await apiContext(servers);
    expect(await get(context.baseUrl, "/api/trial-runs/missing/learning-summary")).toEqual({
      status: 404,
      body: { error: "Learning session not found" }
    });
  });

  it("does not expose a manual learning-candidate acceptance endpoint", async () => {
    const context = await apiContext(servers);

    const response = await fetch(`${context.baseUrl}/api/learning-sessions/session-1/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateIds: ["candidate-1"] })
    });

    expect(response.status).toBe(404);
  });
});

async function apiContext(servers: Server[]) {
  const storage = new MemoryTrialLearningStorage();
  const app = express();
  app.use(express.json());
  registerTrialLearningRoutes(app, { storage });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server address unavailable");
  return { baseUrl: `http://127.0.0.1:${address.port}`, storage };
}

class MemoryTrialLearningStorage implements TrialLearningApiStorage {
  readonly decisions: Array<{ runId: string; decision: "confirmed" | "rejected" }> = [];
  private session = learningSession();
  private verification = flowVerification();

  getLearningSessionForRun(runId: string): LearningSession | undefined {
    return runId === this.session.runId ? this.session : undefined;
  }

  listFlowVerificationsForRun(runId: string): FlowVerification[] {
    return runId === this.session.runId ? [this.verification] : [];
  }

  reviewTrialOutcome(runId: string, decision: "confirmed" | "rejected") {
    this.decisions.push({ runId, decision });
    this.session = {
      ...this.session,
      outcomeStatus: decision === "confirmed" ? "human_confirmed" : "rejected",
      status: decision === "confirmed" ? "ready" : "rejected"
    };
    this.verification = { ...this.verification, status: decision === "confirmed" ? "verified" : "invalidated" };
    return { session: this.session, verification: this.verification };
  }
}

function learningSession(): LearningSession {
  return {
    id: "session-1",
    runId: "run-1",
    appId: "cn.eeo.classin",
    platform: "android",
    sourceHash: "a".repeat(64),
    executionPassed: true,
    outcomeStatus: "unverified",
    status: "needs_outcome_review",
    summary: { pageCandidates: 1, interactionCandidates: 0, navigationCandidates: 0, testCandidates: 1, issues: [] },
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z"
  };
}

function flowVerification(): FlowVerification {
  return {
    id: "verification-1",
    sourceHash: "a".repeat(64),
    appId: "cn.eeo.classin",
    platform: "android",
    runId: "run-1",
    status: "provisional",
    coverage: {
      totalSteps: 1,
      verifiedSteps: 1,
      interactionAssetIds: [],
      pageAssetIds: [],
      humanConfirmedOutcome: false
    },
    createdAt: "2026-07-30T00:00:00.000Z"
  };
}

async function get(baseUrl: string, pathname: string) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return { status: response.status, body: await response.json() };
}

async function post(baseUrl: string, pathname: string, body: unknown) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}
