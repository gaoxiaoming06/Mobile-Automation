import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockDriver } from "@mobile-automation/test-support";
import { createId, nowIso, type ActionStep, type DeviceActionRequest, type StepExpectation, type TestRun } from "@mobile-automation/shared";
import { AutomationRunner } from "./automation-runner.js";
import type { Storage } from "./storage.js";

let context: Awaited<ReturnType<typeof createContext>> | undefined;

afterEach(async () => {
  context?.storage.close();
  const tempRoot = context?.tempRoot;
  context = undefined;
  delete process.env.DATA_DIR;
  vi.resetModules();
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("legacy flow contract", () => {
  it("keeps recorded case storage, replay, evidence, video, and HTML report stable", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new ContractMockDriver(context.tempRoot);
    const runner = new AutomationRunner(storage, driver);
    const steps = [
      tapStep("step-tap", 120, 240, [systemGuard("no_crash"), systemGuard("app_alive")]),
      swipeStep("step-swipe", 100, 1000, 900, 1000)
    ];
    const testCase = storage.createCase({
      name: "Legacy Recorded Flow",
      description: "v1 compatibility guard",
      steps
    });

    const started = runner.start({
      caseId: testCase.id,
      deviceSerial: driver.device.serial,
      repeatCount: 1,
      stepIntervalMs: 0,
      recordVideo: true
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run).toEqual(
      expect.objectContaining({
        caseId: testCase.id,
        caseName: "Legacy Recorded Flow",
        status: "passed",
        reportHtmlPath: expect.stringContaining("report.html")
      })
    );
    expect(storage.getCase(testCase.id)).toEqual(
      expect.objectContaining({
        id: testCase.id,
        steps: expect.arrayContaining([
          expect.objectContaining({ id: "step-tap", type: "tap" }),
          expect.objectContaining({ id: "step-swipe", type: "swipe" })
        ])
      })
    );
    expect(driver.actions).toEqual<DeviceActionRequest[]>([
      { type: "tap", x: 120, y: 240 },
      { type: "swipe", startX: 100, startY: 1000, endX: 900, endY: 1000, durationMs: 350 }
    ]);
    expect(driver.videoKeepRequests).toEqual([true]);
    expect(run.stepResults).toHaveLength(2);
    expect(run.stepResults.every((result) => result.status === "passed")).toBe(true);
    expect(run.stepResults.every((result) => Boolean(result.afterScreenshotId))).toBe(true);
    expect(run.stepResults[0]?.expectationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "no_crash", status: "passed" }),
        expect.objectContaining({ type: "app_alive", status: "passed" })
      ])
    );
    expect(run.metrics.length).toBeGreaterThanOrEqual(3);
    expect(run.artifacts.filter((artifact) => artifact.type === "screenshot")).toHaveLength(2);
    expect(run.artifacts.some((artifact) => artifact.type === "video" && artifact.mimeType === "video/mp4")).toBe(true);
    expect(run.artifacts.some((artifact) => artifact.type === "report_html" && artifact.url.includes("/artifacts/"))).toBe(true);

    const reportPath = path.join(context.artifactRoot, run.reportHtmlPath ?? "");
    await expect(stat(reportPath)).resolves.toEqual(expect.objectContaining({ size: expect.any(Number) }));
  });
});

async function createContext(): Promise<{ storage: Storage; tempRoot: string; artifactRoot: string }> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-legacy-flow-"));
  process.env.DATA_DIR = tempRoot;
  vi.resetModules();
  const [{ Storage }, artifacts] = await Promise.all([import("./storage.js"), import("./artifacts.js")]);
  const storage = new Storage();
  await storage.ensureDirs();
  return {
    storage,
    tempRoot,
    artifactRoot: artifacts.artifactRoot
  };
}

function tapStep(id: string, x: number, y: number, expectations: StepExpectation[] = []): ActionStep {
  return {
    id,
    order: 1,
    type: "tap",
    enabled: true,
    params: {},
    coordinate: {
      x,
      y,
      xRatio: x / 1080,
      yRatio: y / 2400,
      deviceWidth: 1080,
      deviceHeight: 2400
    },
    expectations,
    createdAt: nowIso()
  };
}

function swipeStep(id: string, startX: number, startY: number, endX: number, endY: number): ActionStep {
  return {
    id,
    order: 2,
    type: "swipe",
    enabled: true,
    params: {
      durationMs: 350
    },
    coordinate: {
      startX,
      startY,
      endX,
      endY,
      startXRatio: startX / 1080,
      startYRatio: startY / 2400,
      endXRatio: endX / 1080,
      endYRatio: endY / 2400,
      deviceWidth: 1080,
      deviceHeight: 2400
    },
    createdAt: nowIso()
  };
}

function systemGuard(type: "no_crash" | "app_alive"): StepExpectation {
  return {
    id: createId("expectation"),
    type,
    enabled: true,
    params: {},
    createdAt: nowIso()
  };
}

class ContractMockDriver extends MockDriver {
  readonly videoKeepRequests: boolean[] = [];

  constructor(private readonly tempRoot: string) {
    super();
    this.device.capabilities.recordVideo = true;
  }

  override async startVideoRecording(serial: string, runId: string, localDir: string): Promise<{ id: string; serial: string; localPath: string; startedAt: string }> {
    await this.getDeviceInfo(serial);
    const localPath = path.join(localDir || this.tempRoot, `${runId}.mp4`);
    await import("node:fs/promises").then(({ mkdir, writeFile }) =>
      mkdir(path.dirname(localPath), { recursive: true }).then(() => writeFile(localPath, "legacy-contract-video"))
    );
    return {
      id: runId,
      serial,
      localPath,
      startedAt: nowIso()
    };
  }

  override async stopVideoRecording(recording: { serial: string; localPath: string }, keep: boolean): Promise<string | undefined> {
    await this.getDeviceInfo(recording.serial);
    this.videoKeepRequests.push(keep);
    return keep ? recording.localPath : undefined;
  }
}

async function waitForRun(runner: AutomationRunner, storage: Storage, runId: string): Promise<TestRun> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!runner.isRunning(runId)) {
      const run = storage.getRun(runId);
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }
      return run;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error(`Run did not finish: ${runId}`);
}
