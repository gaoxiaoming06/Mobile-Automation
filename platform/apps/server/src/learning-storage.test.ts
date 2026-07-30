import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScriptFlowDocument } from "@mobile-automation/script-flow";
import type { Storage } from "./storage.js";

describe("trial learning storage", () => {
  let storage: Storage | undefined;
  let tempRoot: string | undefined;

  afterEach(async () => {
    storage?.close();
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    storage = undefined;
    tempRoot = undefined;
    delete process.env.DATA_DIR;
  });

  it("creates a ready learning session after a trial with an automatic outcome passes", async () => {
    ({ storage, tempRoot } = await createStorage());
    const run = createTrialRun(storage, { unresolvedOutcome: false });

    storage.updateRunStatus(run.id, "passed");

    expect(storage.getLearningSessionForRun(run.id)).toMatchObject({
      runId: run.id,
      executionPassed: true,
      outcomeStatus: "verified",
      status: "ready",
      summary: { pageCandidates: 0, interactionCandidates: 0, navigationCandidates: 0, testCandidates: 1, issues: [] }
    });
  });

  it("requires outcome review before upgrading a provisional trial verification", async () => {
    ({ storage, tempRoot } = await createStorage());
    const run = createTrialRun(storage, { unresolvedOutcome: true });
    storage.updateRunStatus(run.id, "passed");

    expect(storage.getLearningSessionForRun(run.id)).toMatchObject({
      outcomeStatus: "unverified",
      status: "needs_outcome_review"
    });
    expect(storage.listFlowVerificationsForRun(run.id)).toEqual([
      expect.objectContaining({ status: "provisional", coverage: expect.objectContaining({ humanConfirmedOutcome: false }) })
    ]);

    const reviewed = storage.reviewTrialOutcome(run.id, "confirmed");

    expect(reviewed.session).toMatchObject({ outcomeStatus: "human_confirmed", status: "ready" });
    expect(reviewed.verification).toMatchObject({
      status: "verified",
      coverage: expect.objectContaining({ humanConfirmedOutcome: true })
    });
  });

  it("invalidates learning when the trial fails or the user rejects its outcome", async () => {
    ({ storage, tempRoot } = await createStorage());
    const failed = createTrialRun(storage, { unresolvedOutcome: true });
    storage.updateRunStatus(failed.id, "failed");
    expect(storage.getLearningSessionForRun(failed.id)).toMatchObject({
      executionPassed: false,
      outcomeStatus: "unverified",
      status: "invalid"
    });

    const rejected = createTrialRun(storage, { unresolvedOutcome: true });
    storage.updateRunStatus(rejected.id, "passed");
    const reviewed = storage.reviewTrialOutcome(rejected.id, "rejected");
    expect(reviewed.session).toMatchObject({ outcomeStatus: "rejected", status: "rejected" });
    expect(reviewed.verification).toMatchObject({ status: "invalidated" });
  });

  it("persists reviewable candidates and removes them with their learning session", async () => {
    ({ storage, tempRoot } = await createStorage());
    const run = createTrialRun(storage, { unresolvedOutcome: false });
    storage.updateRunStatus(run.id, "passed");
    const session = storage.getLearningSessionForRun(run.id)!;

    const candidate = storage.createLearningCandidate({
      sessionId: session.id,
      kind: "interaction",
      stableKey: "home.add-friend",
      sourceStepId: "open-add-friend",
      confidence: 0.91,
      status: "validated",
      payload: { ownerPage: "classin.home", target: { text: "添加好友" } },
      evidenceArtifactIds: ["artifact-1"],
      validationIssues: []
    });

    expect(storage.listLearningCandidates(session.id)).toEqual([candidate]);
    expect(storage.updateLearningCandidateStatus(candidate.id, "accepted")).toMatchObject({ status: "accepted" });
    expect(storage.deleteLearningSession(session.id)).toBe(true);
    expect(storage.listLearningCandidates(session.id)).toEqual([]);
  });

  it("automatically promotes safe interaction candidates after an automatic outcome is verified", async () => {
    ({ storage, tempRoot } = await createStorage());
    const run = createTrialRun(storage, { unresolvedOutcome: false });
    storage.addStepResult({
      id: "result-1",
      runId: run.id,
      iterationIndex: 0,
      stepId: "open-add-friend",
      stepOrder: 1,
      type: "tap",
      status: "passed",
      startedAt: "2026-07-30T00:00:00.000Z",
      endedAt: "2026-07-30T00:00:01.000Z",
      afterScreenshotId: "artifact-1",
      artifacts: [],
      metadata: {
        onPage: "classin.home",
        semantic: { type: "ocr_text", action: "tap", selectedLocator: { text: "添加好友", centerX: 320, centerY: 100 } }
      }
    });
    storage.addArtifact({
      id: "artifact-1",
      runId: run.id,
      stepResultId: "result-1",
      type: "screenshot",
      name: "after.png",
      path: "runs/run-1/after.png",
      url: "/artifacts/runs/run-1/after.png",
      createdAt: "2026-07-30T00:00:01.000Z"
    });

    storage.updateRunStatus(run.id, "passed");

    const session = storage.getLearningSessionForRun(run.id)!;
    expect(storage.listLearningCandidates(session.id)).toEqual([
      expect.objectContaining({
        kind: "interaction",
        stableKey: "classin.home.tap.text.添加好友",
        status: "accepted",
        payload: expect.objectContaining({ semanticContract: { text: "添加好友" } })
      })
    ]);
    expect(storage.getLearningSession(session.id)).toMatchObject({ status: "accepted" });
    expect(storage.listInteractionAssets({ appId: "cn.eeo.classin", platform: "android" })).toEqual([
      expect.objectContaining({ key: "classin.home.tap.text.添加好友", status: "active" })
    ]);
    expect(session.summary).toMatchObject({ interactionCandidates: 1 });
  });

  it("automatically promotes navigation candidates only for verified page transitions", async () => {
    ({ storage, tempRoot } = await createStorage());
    const run = createTrialRun(storage, { unresolvedOutcome: false, steps: [{
      id: "open-growth",
      onPage: "classin.home",
      expectPage: "classin.growth",
      risk: "interaction",
      tap: {
        target: { text: "成长", area: "bottomBar" },
        search: { mode: "visibleOnly" }
      }
    }] });
    storage.addStepResult({
      id: "result-growth",
      runId: run.id,
      iterationIndex: 0,
      stepId: "open-growth",
      stepOrder: 1,
      type: "tap",
      status: "passed",
      startedAt: "2026-07-30T00:00:00.000Z",
      endedAt: "2026-07-30T00:00:01.000Z",
      afterScreenshotId: "artifact-growth",
      artifacts: [],
      expectationResults: [{
        id: "expectation-growth",
        expectationId: "after:open-growth",
        type: "state_is",
        status: "passed",
        expected: "Page classin.growth",
        actual: "成长页",
        evidenceArtifactIds: ["artifact-growth"],
        checkedAt: "2026-07-30T00:00:01.000Z"
      }],
      metadata: {
        onPage: "classin.home",
        expectPage: "classin.growth",
        semantic: { type: "ocr_text", action: "tap", selectedLocator: { text: "成长" } }
      }
    });

    storage.updateRunStatus(run.id, "passed");

    const session = storage.getLearningSessionForRun(run.id)!;
    expect(storage.listLearningCandidates(session.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "navigation",
        stableKey: "classin.home.tap.text.成长.area.bottomBar.to.classin.growth",
        status: "accepted"
      })
    ]));
    expect(storage.listNavigationEntries({ appId: "cn.eeo.classin", platform: "android" })).toEqual([
      expect.objectContaining({
        key: "classin.home.tap.text.成长.area.bottomBar.to.classin.growth",
        from: { kind: "page", key: "classin.home" },
        toPage: "classin.growth",
        status: "active"
      })
    ]);
    expect(session.summary).toMatchObject({ navigationCandidates: 1 });
  });

  it("waits for human outcome confirmation before automatically promoting evidence", async () => {
    ({ storage, tempRoot } = await createStorage());
    const run = createTrialRun(storage, { unresolvedOutcome: true });
    storage.addStepResult({
      id: "result-human-review",
      runId: run.id,
      iterationIndex: 0,
      stepId: "open-add-friend",
      stepOrder: 1,
      type: "tap",
      status: "passed",
      startedAt: "2026-07-30T00:00:00.000Z",
      endedAt: "2026-07-30T00:00:01.000Z",
      afterScreenshotId: "artifact-human-review",
      artifacts: [],
      metadata: {
        onPage: "classin.home",
        semantic: { type: "ocr_text", action: "tap", selectedLocator: { text: "添加好友" } }
      }
    });
    storage.addArtifact({
      id: "artifact-human-review",
      runId: run.id,
      stepResultId: "result-human-review",
      type: "screenshot",
      name: "after.png",
      path: "runs/run-human-review/after.png",
      url: "/artifacts/runs/run-human-review/after.png",
      createdAt: "2026-07-30T00:00:01.000Z"
    });

    storage.updateRunStatus(run.id, "passed");

    const pending = storage.getLearningSessionForRun(run.id)!;
    expect(pending).toMatchObject({ status: "needs_outcome_review" });
    expect(storage.listLearningCandidates(pending.id)).toEqual([
      expect.objectContaining({ status: "validated" })
    ]);
    expect(storage.listInteractionAssets({ appId: "cn.eeo.classin", platform: "android" })).toEqual([]);

    const reviewed = storage.reviewTrialOutcome(run.id, "confirmed");

    expect(reviewed.session).toMatchObject({ status: "accepted", outcomeStatus: "human_confirmed" });
    expect(storage.listLearningCandidates(pending.id)).toEqual([
      expect.objectContaining({ status: "accepted" })
    ]);
    expect(storage.listInteractionAssets({ appId: "cn.eeo.classin", platform: "android" })).toHaveLength(1);
  });

  it("atomically accepts selected interaction candidates into the reusable asset catalog", async () => {
    ({ storage, tempRoot } = await createStorage());
    const run = createTrialRun(storage, { unresolvedOutcome: false });
    storage.updateRunStatus(run.id, "passed");
    const session = storage.getLearningSessionForRun(run.id)!;
    const candidate = storage.createLearningCandidate({
      sessionId: session.id,
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
      validationIssues: []
    });

    const accepted = storage.acceptLearningSession(session.id, [candidate.id]);

    expect(accepted.session).toMatchObject({ status: "accepted" });
    expect(accepted.assets).toEqual([
      expect.objectContaining({
        key: candidate.stableKey,
        appId: "cn.eeo.classin",
        owner: { kind: "page", key: "classin.home" },
        semanticContract: { text: "添加好友" },
        status: "active",
        provenance: expect.objectContaining({ runIds: [run.id], stepIds: ["open-add-friend"] })
      })
    ]);
    expect(storage.listLearningCandidates(session.id)).toEqual([expect.objectContaining({ status: "accepted" })]);
    expect(storage.listInteractionAssets({ appId: "cn.eeo.classin", platform: "android" })).toEqual(accepted.assets);
    expect(storage.listFlowVerificationsForRun(run.id)[0]).toMatchObject({
      coverage: expect.objectContaining({ interactionAssetIds: [accepted.assets[0]!.id] })
    });
    expect(JSON.stringify(accepted.assets)).not.toMatch(/"x"|"y"|coordinate|region/i);
  });

  it("accepts a verified navigation candidate into the runtime navigation index", async () => {
    ({ storage, tempRoot } = await createStorage());
    const run = createTrialRun(storage, { unresolvedOutcome: false });
    storage.updateRunStatus(run.id, "passed");
    const session = storage.getLearningSessionForRun(run.id)!;
    const candidate = storage.createLearningCandidate({
      sessionId: session.id,
      kind: "navigation",
      stableKey: "classin.home.tap.text.成长.area.bottomBar.to.classin.growth",
      sourceStepId: "open-growth",
      confidence: 0.98,
      status: "validated",
      payload: {
        name: "主页进入成长页",
        from: { kind: "page", key: "classin.home" },
        toPage: "classin.growth",
        action: {
          kind: "tap",
          target: { text: "成长", area: "bottomBar" },
          search: { mode: "visibleOnly" }
        }
      },
      evidenceArtifactIds: ["artifact-growth"],
      validationIssues: []
    });

    const accepted = storage.acceptLearningSession(session.id, [candidate.id]);

    expect(accepted.navigationEntries).toEqual([
      expect.objectContaining({
        key: candidate.stableKey,
        appId: "cn.eeo.classin",
        platformScope: "android",
        from: { kind: "page", key: "classin.home" },
        toPage: "classin.growth",
        action: {
          kind: "tap",
          target: { text: "成长", area: "bottomBar" },
          search: { mode: "visibleOnly" }
        },
        status: "active"
      })
    ]);
    expect(storage.listNavigationEntries({ appId: "cn.eeo.classin", platform: "android" })).toEqual(accepted.navigationEntries);
    expect(storage.listPageNavigationSegments({ appId: "cn.eeo.classin", platform: "android" })).toEqual([
      expect.objectContaining({
        fromPage: "classin.home",
        toPage: "classin.growth",
        flowId: `navigation-entry:${accepted.navigationEntries[0]!.id}`,
        steps: [expect.objectContaining({
          onPage: "classin.home",
          expectPage: "classin.growth",
          tap: {
            target: { text: "成长", area: "bottomBar" },
            search: { mode: "visibleOnly" }
          }
        })]
      })
    ]);
    expect(JSON.stringify(accepted.navigationEntries)).not.toMatch(/coordinate|bounds|region/i);
  });

  it("merges repeated navigation evidence without creating duplicate entries", async () => {
    ({ storage, tempRoot } = await createStorage());
    const firstRun = createTrialRun(storage, { unresolvedOutcome: false });
    const secondRun = createTrialRun(storage, { unresolvedOutcome: false });
    storage.updateRunStatus(firstRun.id, "passed");
    storage.updateRunStatus(secondRun.id, "passed");
    const firstSession = storage.getLearningSessionForRun(firstRun.id)!;
    const secondSession = storage.getLearningSessionForRun(secondRun.id)!;
    const candidateInput = {
      kind: "navigation" as const,
      stableKey: "classin.home.tap.text.成长.area.bottomBar.to.classin.growth",
      sourceStepId: "open-growth",
      confidence: 0.98,
      status: "validated" as const,
      payload: {
        name: "主页进入成长页",
        from: { kind: "page", key: "classin.home" },
        toPage: "classin.growth",
        action: {
          kind: "tap",
          target: { text: "成长", area: "bottomBar" },
          search: { mode: "visibleOnly" }
        }
      },
      evidenceArtifactIds: [],
      validationIssues: []
    };
    const firstCandidate = storage.createLearningCandidate({ sessionId: firstSession.id, ...candidateInput });
    const secondCandidate = storage.createLearningCandidate({ sessionId: secondSession.id, ...candidateInput });

    const firstEntry = storage.acceptLearningSession(firstSession.id, [firstCandidate.id]).navigationEntries[0]!;
    const secondEntry = storage.acceptLearningSession(secondSession.id, [secondCandidate.id]).navigationEntries[0]!;

    expect(secondEntry.id).toBe(firstEntry.id);
    expect(secondEntry.version).toBe(2);
    expect(secondEntry.provenance.runIds).toEqual([firstRun.id, secondRun.id]);
    expect(storage.listNavigationEntries({ appId: "cn.eeo.classin", platform: "android" })).toEqual([secondEntry]);
  });

  it("rolls back candidate acceptance when any selected candidate is invalid", async () => {
    ({ storage, tempRoot } = await createStorage());
    const run = createTrialRun(storage, { unresolvedOutcome: false });
    storage.updateRunStatus(run.id, "passed");
    const session = storage.getLearningSessionForRun(run.id)!;
    const candidate = storage.createLearningCandidate({
      sessionId: session.id,
      kind: "interaction",
      stableKey: "unsafe",
      sourceStepId: "unsafe-step",
      confidence: 0.99,
      status: "validated",
      payload: {
        owner: { kind: "page", key: "classin.home" },
        name: "不安全目标",
        supportedAction: "tap",
        semanticContract: { icon: "add" },
        locatorEvidence: { strategy: "fixed", coordinate: { x: 10, y: 20 } }
      },
      evidenceArtifactIds: [],
      validationIssues: []
    });

    expect(() => storage!.acceptLearningSession(session.id, [candidate.id])).toThrow(/coordinate/i);
    expect(storage.listLearningCandidates(session.id)).toEqual([expect.objectContaining({ status: "validated" })]);
    expect(storage.listInteractionAssets({ appId: "cn.eeo.classin", platform: "android" })).toEqual([]);
    expect(storage.getLearningSession(session.id)).toMatchObject({ status: "ready" });
  });

  it("keeps otherwise identical interaction assets isolated by platform", async () => {
    ({ storage, tempRoot } = await createStorage());
    const androidRun = createTrialRun(storage, { unresolvedOutcome: false, platform: "android" });
    const iosRun = createTrialRun(storage, { unresolvedOutcome: false, platform: "ios" });
    storage.updateRunStatus(androidRun.id, "passed");
    storage.updateRunStatus(iosRun.id, "passed");
    const androidSession = storage.getLearningSessionForRun(androidRun.id)!;
    const iosSession = storage.getLearningSessionForRun(iosRun.id)!;
    const candidateInput = {
      kind: "interaction" as const,
      stableKey: "classin.home.tap.text.添加好友",
      sourceStepId: "open-add-friend",
      confidence: 0.95,
      status: "validated" as const,
      payload: {
        owner: { kind: "page", key: "classin.home" },
        name: "添加好友",
        supportedAction: "tap",
        semanticContract: { text: "添加好友" },
        locatorEvidence: { strategy: "ocr_text", selectedText: "添加好友" }
      },
      evidenceArtifactIds: [],
      validationIssues: []
    };
    const androidCandidate = storage.createLearningCandidate({ sessionId: androidSession.id, ...candidateInput });
    const iosCandidate = storage.createLearningCandidate({ sessionId: iosSession.id, ...candidateInput });

    const androidAsset = storage.acceptLearningSession(androidSession.id, [androidCandidate.id]).assets[0]!;
    const iosAsset = storage.acceptLearningSession(iosSession.id, [iosCandidate.id]).assets[0]!;

    expect(androidAsset.id).not.toBe(iosAsset.id);
    expect(androidAsset.platformScope).toBe("android");
    expect(iosAsset.platformScope).toBe("ios");
    expect(storage.listInteractionAssets({ appId: "cn.eeo.classin", platform: "android" })).toEqual([androidAsset]);
    expect(storage.listInteractionAssets({ appId: "cn.eeo.classin", platform: "ios" })).toEqual([iosAsset]);
  });

  it("keeps otherwise identical interaction assets isolated by App ID", async () => {
    ({ storage, tempRoot } = await createStorage());
    const classInRun = createTrialRun(storage, { unresolvedOutcome: false, appId: "cn.eeo.classin" });
    const anotherRun = createTrialRun(storage, { unresolvedOutcome: false, appId: "com.example.another" });
    storage.updateRunStatus(classInRun.id, "passed");
    storage.updateRunStatus(anotherRun.id, "passed");
    const candidateInput = {
      kind: "interaction" as const,
      stableKey: "home.tap.text.添加好友",
      sourceStepId: "open-add-friend",
      confidence: 0.95,
      status: "validated" as const,
      payload: {
        owner: { kind: "page", key: "home" },
        name: "添加好友",
        supportedAction: "tap",
        semanticContract: { text: "添加好友" },
        locatorEvidence: { strategy: "ocr_text", selectedText: "添加好友" }
      },
      evidenceArtifactIds: [],
      validationIssues: []
    };
    const classInSession = storage.getLearningSessionForRun(classInRun.id)!;
    const anotherSession = storage.getLearningSessionForRun(anotherRun.id)!;
    const classInCandidate = storage.createLearningCandidate({ sessionId: classInSession.id, ...candidateInput });
    const anotherCandidate = storage.createLearningCandidate({ sessionId: anotherSession.id, ...candidateInput });

    const classInAsset = storage.acceptLearningSession(classInSession.id, [classInCandidate.id]).assets[0]!;
    const anotherAsset = storage.acceptLearningSession(anotherSession.id, [anotherCandidate.id]).assets[0]!;

    expect(classInAsset.id).not.toBe(anotherAsset.id);
    expect(classInAsset.appId).toBe("cn.eeo.classin");
    expect(anotherAsset.appId).toBe("com.example.another");
    expect(storage.listInteractionAssets({ appId: "cn.eeo.classin", platform: "android" })).toEqual([classInAsset]);
    expect(storage.listInteractionAssets({ appId: "com.example.another", platform: "android" })).toEqual([anotherAsset]);
  });
});

async function createStorage(): Promise<{ storage: Storage; tempRoot: string }> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-learning-"));
  process.env.DATA_DIR = tempRoot;
  vi.resetModules();
  const { Storage: StorageConstructor } = await import("./storage.js");
  const storage = new StorageConstructor();
  await storage.ensureDirs();
  return { storage, tempRoot };
}

function createTrialRun(storage: Storage, input: {
  unresolvedOutcome: boolean;
  appId?: string;
  platform?: ScriptFlowDocument["app"]["platform"];
  steps?: ScriptFlowDocument["steps"];
}) {
  const platform = input.platform ?? "android";
  const appId = input.appId ?? "cn.eeo.classin";
  const document: ScriptFlowDocument = {
    version: 1,
    kind: "case",
    name: "打开添加好友",
    app: { id: appId, platform },
    start: { strategy: "keepCurrent" },
    parameters: {},
    steps: input.steps ?? [{ id: "open-add-friend", onPage: "classin.home", tap: { target: { text: "添加好友" } } }],
    tags: []
  };
  const sourceYaml = JSON.stringify(document);
  const sourceHash = input.unresolvedOutcome
    ? "1".repeat(64)
    : platform === "android" ? "2".repeat(64) : "4".repeat(64);
  const flow = storage.createScriptFlow({ sourceYaml, document, status: "draft" });
  return storage.createRun({
    caseName: flow.name,
    deviceSerial: "device-1",
    configJson: JSON.stringify({ deviceSerial: "device-1", mode: "once", repeatCount: 1, stepIntervalMs: 0, stopOnFailure: true }),
    runSnapshotJson: JSON.stringify({
      steps: [{ id: "open-add-friend" }],
      sourceSnapshot: {
        kind: "script_flow",
        flowId: flow.id,
        version: flow.version,
        planDigest: "3".repeat(64),
        executionPurpose: "trial",
        sourceHash,
        verificationAssessment: {
          status: "needs_trial",
          sourceHash,
          reasons: ["当前脚本版本尚未通过试运行"],
          unresolvedStepIds: ["open-add-friend"],
          unresolvedOutcome: input.unresolvedOutcome
        },
        dependencies: [],
        sourceYaml,
        parsed: document
      }
    }),
    steps: []
  });
}
