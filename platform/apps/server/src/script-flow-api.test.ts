import express from "express";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { ScriptFlowDocument } from "@mobile-automation/script-flow";
import type { FlowVerification, InteractionAsset, ScriptFlow, ScriptFlowVersion, TemporaryTest, TestRun } from "@mobile-automation/shared";
import { derivePageNavigationSegments } from "./page-navigation.js";
import { registerScriptFlowRoutes, type ScriptFlowApiStorage } from "./script-flow-api.js";
import type { StartScriptFlowRunInput } from "./script-flow-runner.js";
import { ScriptTargetResolutionError } from "./script-target-resolver.js";

const sourceYaml = `
version: 1
name: 打开添加好友
app:
  id: cn.eeo.classin
  platform: android
parameters:
  friendName:
    type: string
    label: 好友姓名
    required: true
steps:
  - id: open-add-friend
    onPage: classin.home
    tap:
      target:
        text: 添加好友
    expectPage: classin.friend.add
tags: [friend]
`;

describe("ScriptFlow API", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it("validates YAML and rejects client-supplied compiled steps", async () => {
    const context = await apiContext(servers);

    const valid = await post(context.baseUrl, "/api/script-flows/validate", { sourceYaml });
    expect(valid.status).toBe(200);
    expect(valid.body).toEqual(expect.objectContaining({ valid: true, document: expect.objectContaining({ name: "打开添加好友" }) }));

    const invalid = await post(context.baseUrl, "/api/script-flows/validate", { sourceYaml: "version: 1\nsteps: []" });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual(expect.objectContaining({ valid: false, issues: expect.any(Array) }));

    const bypass = await post(context.baseUrl, "/api/script-flows", {
      sourceYaml,
      steps: [{ type: "tap", coordinate: { x: 10, y: 20 } }]
    });
    expect(bypass.status).toBe(400);
    expect(bypass.body).toEqual({ error: "Unknown request field: steps" });
  });

  it("creates, versions, previews, runs, and deletes ScriptFlow from YAML only", async () => {
    const context = await apiContext(servers);
    const createdResponse = await post(context.baseUrl, "/api/script-flows", { sourceYaml, status: "draft" });
    expect(createdResponse.status).toBe(201);
    const created = (createdResponse.body as { flow: ScriptFlow }).flow;
    expect(created).toEqual(expect.objectContaining({ name: "打开添加好友", appId: "cn.eeo.classin", version: 1 }));

    const listResponse = await get(context.baseUrl, "/api/script-flows?appId=cn.eeo.classin&platform=android");
    expect((listResponse.body as { flows: ScriptFlow[] }).flows).toHaveLength(1);

    const updatedYaml = sourceYaml.replace("打开添加好友", "打开添加好友页面");
    const unverifiedUpdate = await put(context.baseUrl, `/api/script-flows/${created.id}`, {
      sourceYaml: updatedYaml,
      status: "active",
      expectedVersion: 1
    });
    expect(unverifiedUpdate).toEqual({
      status: 409,
      body: { error: "ScriptFlow must pass a trial run before it can be activated" }
    });
    context.storage.markSourceVerified(updatedYaml);
    const updatedResponse = await put(context.baseUrl, `/api/script-flows/${created.id}`, { sourceYaml: updatedYaml, status: "active", expectedVersion: 1 });
    expect(updatedResponse.body).toEqual({
      flow: expect.objectContaining({ version: 2, name: "打开添加好友页面", status: "active" })
    });
    const preview = await post(context.baseUrl, `/api/script-flows/${created.id}/preview`, {
      expectedVersion: 2,
      parameters: { friendName: "张三" }
    });
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual(expect.objectContaining({
      planDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      plan: expect.objectContaining({ steps: [expect.objectContaining({ id: "open-add-friend", action: "tap" })] })
    }));
    expect(await post(context.baseUrl, "/api/script-flow-drafts/verification", { sourceYaml })).toEqual({
      status: 200,
      body: {
        verification: expect.objectContaining({ status: "needs_trial", sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
      }
    });
    const planDigest = (preview.body as { planDigest: string }).planDigest;

    const runResponse = await post(context.baseUrl, `/api/script-flows/${created.id}/runs`, {
      expectedVersion: 2,
      planDigest,
      deviceSerial: "device-1",
      parameters: { friendName: "张三" },
      androidAppMonitor: {
        enabled: true,
        packageName: "cn.eeo.classin",
        includeSubprocesses: true
      }
    });
    expect(runResponse.status).toBe(202);
    expect(context.runner.inputs).toEqual([
      expect.objectContaining({
        flowId: created.id,
        scriptVersion: 2,
        planDigest,
        sourceYaml: updatedYaml,
        deviceSerial: "device-1",
        parameters: { friendName: "张三" },
        androidAppMonitor: {
          enabled: true,
          packageName: "cn.eeo.classin",
          includeSubprocesses: true
        }
      })
    ]);

    const runId = ((runResponse.body as { run: TestRun }).run).id;
    const run = await get(context.baseUrl, `/api/script-flow-runs/${runId}`);
    expect(run.body).toEqual({ run: expect.objectContaining({ sourceSnapshot: expect.objectContaining({ flowId: created.id, version: 2 }) }) });

    const deleted = await remove(context.baseUrl, `/api/script-flows/${created.id}`);
    expect(deleted.body).toEqual({ deleted: true });
    expect(context.storage.listScriptFlowVersions(created.id)).toEqual([]);
    expect((await get(context.baseUrl, `/api/script-flow-runs/${runId}`)).status).toBe(200);
  });

  it("records draft executions as reusable temporary history without sensitive values", async () => {
    const context = await apiContext(servers);
    const loginSource = `
version: 1
purpose: fixture
name: 教师登录
app: { id: cn.eeo.classin, platform: android }
parameters:
  account: { type: string, required: true }
  password: { type: string, required: true, sensitive: true }
steps:
  - id: login
    role: setup
    risk: submit
    tap: { target: { text: 登录 } }
`;
    const preview = await post(context.baseUrl, "/api/script-flow-drafts/preview", {
      sourceYaml: loginSource,
      parameters: { account: "teacher@example.com", password: "secret" }
    });

    const started = await post(context.baseUrl, "/api/script-flow-drafts/trial-runs", {
      prompt: "登录教师账号",
      sourceYaml: loginSource,
      planDigest: (preview.body as { planDigest: string }).planDigest,
      deviceSerial: "device-1",
      parameters: { account: "teacher@example.com", password: "secret" }
    });
    const history = await get(context.baseUrl, "/api/temporary-tests?appId=cn.eeo.classin&platform=android");

    expect(started.status).toBe(202);
    expect(history.body).toEqual({
      tests: [expect.objectContaining({
        prompt: "登录教师账号",
        purpose: "fixture",
        parameterValues: { account: "teacher@example.com" },
        lastRunId: "run-1"
      })]
    });
  });

  it("keeps navigation-only flows out of the case center", async () => {
    const context = await apiContext(servers);
    const response = await post(context.baseUrl, "/api/script-flows", {
      sourceYaml: `
version: 1
kind: case
purpose: navigation
name: 从主页进入添加好友
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: reach-friend
    role: navigation
    reachPage: { page: classin.friend.add, policy: safe }
`
    });

    expect(response).toEqual({
      status: 409,
      body: { error: "导航流程由系统内部复用，不保存到用例中心" }
    });
  });

  it("rejects preview and execution when the client version is stale", async () => {
    const context = await apiContext(servers);
    const created = ((await post(context.baseUrl, "/api/script-flows", { sourceYaml })).body as { flow: ScriptFlow }).flow;
    await put(context.baseUrl, `/api/script-flows/${created.id}`, { sourceYaml: sourceYaml.replace("打开添加好友", "打开添加好友页面"), expectedVersion: 1 });

    const preview = await post(context.baseUrl, `/api/script-flows/${created.id}/preview`, {
      expectedVersion: 1,
      parameters: { friendName: "张三" }
    });
    const run = await post(context.baseUrl, `/api/script-flows/${created.id}/runs`, {
      expectedVersion: 1,
      deviceSerial: "device-1",
      parameters: { friendName: "张三" }
    });

    expect(preview).toEqual({ status: 409, body: { error: "ScriptFlow version changed; reload before continuing" } });
    expect(run).toEqual({ status: 409, body: { error: "ScriptFlow version changed; reload before continuing" } });
    expect(context.runner.inputs).toEqual([]);
  });

  it("previews and trial-runs an unverified draft without adding it to the use case center", async () => {
    const context = await apiContext(servers);

    const preview = await post(context.baseUrl, "/api/script-flow-drafts/preview", {
      sourceYaml,
      parameters: { friendName: "张三" }
    });
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual(expect.objectContaining({
      verification: expect.objectContaining({
        status: "needs_trial",
        sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        unresolvedStepIds: ["open-add-friend"],
        unresolvedOutcome: false
      })
    }));
    const planDigest = (preview.body as { planDigest: string }).planDigest;

    const normalRun = await post(context.baseUrl, "/api/script-flow-drafts/runs", {
      sourceYaml,
      planDigest,
      deviceSerial: "device-1",
      parameters: { friendName: "张三" }
    });
    expect(normalRun).toEqual({
      status: 409,
      body: { error: "ScriptFlow must pass a trial run before normal execution" }
    });

    const started = await post(context.baseUrl, "/api/script-flow-drafts/trial-runs", {
      sourceYaml,
      planDigest,
      deviceSerial: "device-1",
      parameters: { friendName: "张三" },
      recordVideo: true
    });

    expect(started.status).toBe(202);
    expect(context.storage.listScriptFlows()).toEqual([]);
    expect(context.runner.inputs).toEqual([
      expect.objectContaining({
        flowId: expect.stringMatching(/^temporary:/),
        scriptVersion: 1,
        sourceYaml,
        deviceSerial: "device-1",
        executionPurpose: "trial",
        recordVideo: false,
        verificationAssessment: expect.objectContaining({ status: "needs_trial" })
      })
    ]);

    context.storage.markSourceVerified(sourceYaml);
    const verification = await post(context.baseUrl, "/api/script-flow-drafts/verification", { sourceYaml });
    expect(verification).toEqual({
      status: 200,
      body: { verification: expect.objectContaining({ status: "verified", unresolvedStepIds: [] }) }
    });

    const direct = await post(context.baseUrl, "/api/script-flow-drafts/runs", {
      sourceYaml,
      planDigest,
      deviceSerial: "device-1",
      parameters: { friendName: "张三" }
    });
    expect(direct.status).toBe(202);
    expect(context.runner.inputs[1]).toEqual(expect.objectContaining({ executionPurpose: "normal" }));
  });

  it("rejects an infinite loop trial run", async () => {
    const context = await apiContext(servers);
    const preview = await post(context.baseUrl, "/api/script-flow-drafts/preview", { sourceYaml, parameters: { friendName: "张三" } });

    const started = await post(context.baseUrl, "/api/script-flow-drafts/trial-runs", {
      sourceYaml,
      planDigest: (preview.body as { planDigest: string }).planDigest,
      deviceSerial: "device-1",
      parameters: { friendName: "张三" },
      mode: "loop_until_stop"
    });

    expect(started).toEqual({
      status: 400,
      body: { error: "Trial runs do not support loop_until_stop" }
    });
    expect(context.runner.inputs).toEqual([]);
  });

  it("freezes the derived navigation index without copying active use case sources into dependencies", async () => {
    const context = await apiContext(servers);
    context.storage.markSourceVerified(navigationSource("从详情到主页"));
    const route = ((await post(context.baseUrl, "/api/script-flows", {
      sourceYaml: navigationSource("从详情到主页"),
      status: "active"
    })).body as { flow: ScriptFlow }).flow;

    const preview = await post(context.baseUrl, "/api/script-flow-drafts/preview", {
      sourceYaml: reachHomeSource(),
      parameters: {}
    });

    expect(preview.status).toBe(200);
    expect(preview.body).toEqual(expect.objectContaining({
      plan: expect.objectContaining({
        steps: [expect.objectContaining({ action: "reachPage", input: { pageId: "classin.home", policy: "safe" } })]
      }),
      dependencies: [],
      navigationIndex: expect.objectContaining({
        segmentCount: 1,
        digest: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    }));
    expect(route.status).toBe("active");
  });

  it("loads the navigation index for an entry page added by the compiler", async () => {
    const context = await apiContext(servers);
    context.storage.markSourceVerified(navigationSource("从详情到主页"));
    await post(context.baseUrl, "/api/script-flows", {
      sourceYaml: navigationSource("从详情到主页"),
      status: "active"
    });

    const preview = await post(context.baseUrl, "/api/script-flow-drafts/preview", {
      sourceYaml: entryHomeSource(),
      parameters: {}
    });

    expect(preview.status).toBe(200);
    expect(preview.body).toEqual(expect.objectContaining({
      plan: expect.objectContaining({
        steps: [
          expect.objectContaining({ id: "__prepare.entry-page", phase: "preparation", action: "reachPage" }),
          expect.objectContaining({ id: "verify-home", phase: "test", action: "assertPage" })
        ]
      }),
      navigationIndex: expect.objectContaining({ segmentCount: 1 })
    }));
  });

  it("freezes active session entry pages as runtime recovery roots", async () => {
    const context = await apiContext(servers);
    const rootSource = navigationRootSource();
    context.storage.markSourceVerified(rootSource);
    await post(context.baseUrl, "/api/script-flows", {
      sourceYaml: rootSource,
      status: "active"
    });

    const preview = await post(context.baseUrl, "/api/script-flow-drafts/preview", {
      sourceYaml: reachHomeSource(),
      parameters: {}
    });

    expect(preview.status).toBe(200);
    expect(preview.body).toEqual(expect.objectContaining({
      navigationIndex: expect.objectContaining({ rootCount: 1 })
    }));

    const started = await post(context.baseUrl, "/api/script-flow-drafts/trial-runs", {
      sourceYaml: reachHomeSource(),
      planDigest: (preview.body as { planDigest: string }).planDigest,
      deviceSerial: "device-1",
      parameters: {}
    });

    expect(started.status).toBe(202);
    expect(context.runner.inputs[0]?.navigationRootPages).toEqual(["classin.home"]);
  });

  it("freezes a unique interaction asset into the preview and invalidates the digest when its version changes", async () => {
    const context = await apiContext(servers);
    context.storage.setInteractionAssets([interactionAsset(2)]);

    const preview = await post(context.baseUrl, "/api/script-flow-drafts/preview", {
      sourceYaml,
      parameters: { friendName: "张三" }
    });

    expect(preview.status).toBe(200);
    expect(preview.body).toEqual(expect.objectContaining({
      interactionAssets: [{
        stepId: "open-add-friend",
        assetId: "asset-add-friend",
        key: "classin.home.tap.text.添加好友",
        version: 2
      }]
    }));
    const firstDigest = (preview.body as { planDigest: string }).planDigest;

    context.storage.setInteractionAssets([interactionAsset(3)]);
    const changed = await post(context.baseUrl, "/api/script-flow-drafts/preview", {
      sourceYaml,
      parameters: { friendName: "张三" }
    });

    expect(changed.status).toBe(200);
    expect((changed.body as { planDigest: string }).planDigest).not.toBe(firstDigest);
  });

  it("blocks preview when multiple interaction assets match the same semantic step", async () => {
    const context = await apiContext(servers);
    const first = interactionAsset(2);
    context.storage.setInteractionAssets([
      first,
      { ...first, id: "asset-add-friend-copy", key: `${first.key}.copy` }
    ]);

    const preview = await post(context.baseUrl, "/api/script-flow-drafts/preview", {
      sourceYaml,
      parameters: { friendName: "张三" }
    });

    expect(preview).toEqual({
      status: 400,
      body: {
        error: "当前操作匹配到多个目标，请补充位置、附近文字或更明确的操作描述。",
        failure: {
          kind: "target_ambiguous",
          message: "当前操作匹配到多个目标，请补充位置、附近文字或更明确的操作描述。",
          nextAction: "supplement_process"
        }
      }
    });
  });

  it("rejects saving an AI revision over a newer use case version", async () => {
    const context = await apiContext(servers);
    context.storage.markSourceVerified(sourceYaml);
    const created = ((await post(context.baseUrl, "/api/script-flows", { sourceYaml, status: "active" })).body as { flow: ScriptFlow }).flow;

    const stale = await put(context.baseUrl, `/api/script-flows/${created.id}`, {
      sourceYaml: sourceYaml.replace("打开添加好友", "教师登录"),
      status: "active",
      expectedVersion: created.version + 1
    });

    expect(stale).toEqual({ status: 409, body: { error: "ScriptFlow version changed; reload before continuing" } });
  });

  it("returns a validation error when a page element is missing a runtime parameter", async () => {
    const context = await apiContext(servers);
    const created = ((await post(context.baseUrl, "/api/script-flows", { sourceYaml })).body as { flow: ScriptFlow }).flow;
    context.runner.validationError = new ScriptTargetResolutionError("页面元素“班级列表”需要参数 className（班级名称）");

    const preview = await post(context.baseUrl, `/api/script-flows/${created.id}/preview`, {
      expectedVersion: created.version,
      parameters: { friendName: "张三" }
    });

    expect(preview).toEqual({
      status: 400,
      body: {
        error: "测试缺少执行所需参数，请补充运行配置后重试。",
        failure: {
          kind: "missing_parameter",
          message: "测试缺少执行所需参数，请补充运行配置后重试。",
          nextAction: "supplement_parameter"
        }
      }
    });
  });

  it("returns a public failure summary for a failed run without leaking technical details", async () => {
    const context = await apiContext(servers);
    const preview = await post(context.baseUrl, "/api/script-flow-drafts/preview", {
      sourceYaml,
      parameters: { friendName: "张三" }
    });
    const started = await post(context.baseUrl, "/api/script-flow-drafts/trial-runs", {
      sourceYaml,
      planDigest: (preview.body as { planDigest: string }).planDigest,
      deviceSerial: "device-1",
      parameters: { friendName: "张三" }
    });
    const run = (started.body as { run: TestRun }).run;
    context.storage.saveRun({
      ...run,
      status: "failed",
      stepResults: [{
        id: "result-1",
        runId: run.id,
        iterationIndex: 0,
        stepId: "internal-open-add-friend",
        stepOrder: 1,
        type: "tap_on_text",
        status: "failed",
        startedAt: "2026-07-31T00:00:00.000Z",
        errorCode: "SEMANTIC_TARGET_NOT_FOUND",
        errorMessage: "OCR target not found; locator={x:12,y:34}",
        artifacts: [],
        metadata: { semantic: { reason: "target_not_found", locator: { x: 12, y: 34 } } }
      }]
    });

    const response = await get(context.baseUrl, `/api/script-flow-runs/${run.id}`);
    expect(response.body).toEqual(expect.objectContaining({
      failure: {
        kind: "target_not_found",
        message: "未找到当前操作的目标，请补充目标文字、图标特征或所在位置。",
        nextAction: "supplement_process"
      }
    }));
    expect(JSON.stringify((response.body as { failure: unknown }).failure)).not.toContain("locator");
  });

  it("rejects execution when a previewed runFlow dependency changes", async () => {
    const context = await apiContext(servers);
    const child = ((await post(context.baseUrl, "/api/script-flows", { sourceYaml: childSource("打开主页") })).body as { flow: ScriptFlow }).flow;
    const parent = ((await post(context.baseUrl, "/api/script-flows", { sourceYaml: parentSource(child.id) })).body as { flow: ScriptFlow }).flow;
    const preview = await post(context.baseUrl, `/api/script-flows/${parent.id}/preview`, {
      expectedVersion: parent.version,
      parameters: {}
    });

    expect(preview.status).toBe(200);
    expect(preview.body).toEqual(expect.objectContaining({
      planDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      dependencies: [{ flowId: child.id, version: 1, sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/) }]
    }));

    await put(context.baseUrl, `/api/script-flows/${child.id}`, { sourceYaml: childSource("打开新主页"), expectedVersion: child.version });
    const run = await post(context.baseUrl, `/api/script-flows/${parent.id}/runs`, {
      expectedVersion: parent.version,
      planDigest: (preview.body as { planDigest: string }).planDigest,
      deviceSerial: "device-1",
      parameters: {}
    });

    expect(run).toEqual({ status: 409, body: { error: "Execution plan changed; preview again" } });
    expect(context.runner.inputs).toEqual([]);
  });

  it("requires every exact runFlow dependency version to be verified before normal execution", async () => {
    const context = await apiContext(servers);
    const child = ((await post(context.baseUrl, "/api/script-flows", {
      sourceYaml: childSource("未验证子流程")
    })).body as { flow: ScriptFlow }).flow;
    const parentYaml = parentSource(child.id);
    context.storage.markSourceVerified(parentYaml);
    const parent = ((await post(context.baseUrl, "/api/script-flows", {
      sourceYaml: parentYaml,
      status: "draft"
    })).body as { flow: ScriptFlow }).flow;
    const preview = await post(context.baseUrl, `/api/script-flows/${parent.id}/preview`, {
      expectedVersion: parent.version,
      parameters: {}
    });

    expect(preview.body).toEqual(expect.objectContaining({
      verification: expect.objectContaining({
        status: "needs_trial",
        reasons: expect.arrayContaining([expect.stringContaining(child.id)])
      })
    }));
    const normalRun = await post(context.baseUrl, `/api/script-flows/${parent.id}/runs`, {
      expectedVersion: parent.version,
      planDigest: (preview.body as { planDigest: string }).planDigest,
      deviceSerial: "device-1",
      parameters: {}
    });

    expect(normalRun).toEqual({
      status: 409,
      body: { error: "ScriptFlow must pass a trial run before normal execution" }
    });
    expect(context.runner.inputs).toEqual([]);
  });
});

async function apiContext(servers: Server[]): Promise<{
  baseUrl: string;
  storage: MemoryScriptFlowStorage;
  runner: CapturingScriptFlowRunner;
}> {
  const storage = new MemoryScriptFlowStorage();
  const runner = new CapturingScriptFlowRunner(storage);
  const app = express();
  app.use(express.json());
  registerScriptFlowRoutes(app, { storage, runner });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server address unavailable");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}`, storage, runner };
}

class MemoryScriptFlowStorage implements ScriptFlowApiStorage {
  private readonly flows = new Map<string, ScriptFlow>();
  private readonly versions = new Map<string, ScriptFlowVersion[]>();
  private readonly runs = new Map<string, TestRun>();
  private readonly verifiedSourceHashes = new Set<string>();
  private readonly temporaryTests = new Map<string, TemporaryTest>();
  private interactionAssets: InteractionAsset[] = [];

  setInteractionAssets(assets: InteractionAsset[]): void {
    this.interactionAssets = assets;
  }

  listInteractionAssets(filter: { appId: string; platform?: ScriptFlow["platform"] }): InteractionAsset[] {
    return this.interactionAssets
      .filter((asset) => asset.appId === filter.appId)
      .filter((asset) => !filter.platform || asset.platformScope === "mobile-both" || asset.platformScope === filter.platform);
  }

  markSourceVerified(sourceYaml: string): void {
    this.verifiedSourceHashes.add(createHash("sha256").update(sourceYaml).digest("hex"));
  }

  findLatestFlowVerification(filter: {
    sourceHash: string;
    appId: string;
    platform: ScriptFlow["platform"];
    status?: FlowVerification["status"];
  }): FlowVerification | undefined {
    if (!this.verifiedSourceHashes.has(filter.sourceHash) || (filter.status && filter.status !== "verified")) return undefined;
    return {
      id: `verification-${filter.sourceHash.slice(0, 8)}`,
      sourceHash: filter.sourceHash,
      appId: filter.appId,
      platform: filter.platform,
      runId: "run-verified",
      status: "verified",
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

  createScriptFlow(input: { sourceYaml: string; document: ScriptFlowDocument; status?: ScriptFlow["status"] }): ScriptFlow {
    const flow = storedFlow(`flow-${this.flows.size + 1}`, 1, input);
    this.flows.set(flow.id, flow);
    this.versions.set(flow.id, [storedVersion(flow)]);
    return flow;
  }

  listScriptFlows(filter: { appId?: string; platform?: ScriptFlow["platform"]; status?: ScriptFlow["status"] } = {}): ScriptFlow[] {
    return [...this.flows.values()]
      .filter((flow) => !filter.appId || flow.appId === filter.appId)
      .filter((flow) => !filter.platform || flow.platform === filter.platform)
      .filter((flow) => !filter.status || flow.status === filter.status);
  }

  listPageNavigationSegments(filter: { appId: string; platform: ScriptFlow["platform"] }) {
    return this.listScriptFlows({ ...filter, status: "active" }).flatMap((flow) => derivePageNavigationSegments({
      flowId: flow.id,
      flowVersion: flow.version,
      document: flow.parsed as unknown as ScriptFlowDocument
    }));
  }

  getScriptFlow(id: string): ScriptFlow | undefined { return this.flows.get(id); }

  updateScriptFlow(id: string, input: { sourceYaml: string; document: ScriptFlowDocument; status?: ScriptFlow["status"] }): ScriptFlow {
    const existing = this.flows.get(id);
    if (!existing) throw new Error(`ScriptFlow not found: ${id}`);
    const flow = storedFlow(id, existing.version + 1, input);
    this.flows.set(id, flow);
    this.versions.set(id, [storedVersion(flow), ...(this.versions.get(id) ?? [])]);
    return flow;
  }

  deleteScriptFlow(id: string): boolean {
    this.versions.delete(id);
    return this.flows.delete(id);
  }

  recordTemporaryTest(input: {
    prompt: string;
    sourceYaml: string;
    document: ScriptFlowDocument;
    parameterValues: Record<string, string | number | boolean>;
    runId: string;
  }): TemporaryTest {
    const key = `${input.document.app.id}:${input.document.app.platform}:${createHash("sha256").update(input.sourceYaml).digest("hex")}`;
    const existing = this.temporaryTests.get(key);
    const next: TemporaryTest = {
      id: existing?.id ?? `temporary-${this.temporaryTests.size + 1}`,
      appId: input.document.app.id,
      platform: input.document.app.platform,
      kind: input.document.kind,
      purpose: input.document.purpose ?? "business",
      name: input.document.name,
      prompt: input.prompt,
      sourceYaml: input.sourceYaml,
      parsed: input.document as unknown as Record<string, unknown>,
      parameterValues: input.parameterValues,
      lastRunId: input.runId,
      lastRunStatus: this.runs.get(input.runId)?.status,
      runCount: (existing?.runCount ?? 0) + 1,
      createdAt: existing?.createdAt ?? "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T01:00:00.000Z"
    };
    this.temporaryTests.set(key, next);
    return next;
  }

  listTemporaryTests(filter: { appId?: string; platform?: ScriptFlow["platform"]; limit?: number } = {}): TemporaryTest[] {
    return [...this.temporaryTests.values()]
      .filter((test) => !filter.appId || test.appId === filter.appId)
      .filter((test) => !filter.platform || test.platform === filter.platform)
      .slice(0, filter.limit ?? 50);
  }

  listScriptFlowVersions(id: string): ScriptFlowVersion[] { return this.versions.get(id) ?? []; }
  getRun(id: string): TestRun | undefined { return this.runs.get(id); }
  saveRun(run: TestRun): void { this.runs.set(run.id, run); }
}

function interactionAsset(version: number): InteractionAsset {
  return {
    id: "asset-add-friend",
    key: "classin.home.tap.text.添加好友",
    appId: "cn.eeo.classin",
    platformScope: "android",
    owner: { kind: "page", key: "classin.home" },
    name: "添加好友",
    aliases: ["添加好友"],
    supportedActions: ["tap"],
    semanticContract: { text: "添加好友" },
    locatorVariants: [{
      platform: "android",
      strategy: "ocr_text",
      descriptor: { selectedText: "添加好友" },
      confidence: 0.95
    }],
    status: "active",
    version,
    provenance: { runIds: ["run-trial"], stepIds: ["open-add-friend"], artifactIds: [] },
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: `2026-07-30T00:00:0${version}.000Z`
  };
}

function childSource(name: string): string {
  return `
version: 1
name: ${name}
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-home
    tap: { target: { text: 主页 } }
`;
}

function parentSource(childId: string): string {
  return `
version: 1
name: 父流程
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: child
    runFlow: ${childId}
`;
}

function reachHomeSource(): string {
  return `
version: 1
name: 到达主页
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: reach-home
    reachPage: { page: classin.home, policy: safe }
`;
}

function entryHomeSource(): string {
  return `
version: 1
kind: case
name: 校验主页
app: { id: cn.eeo.classin, platform: android }
entry: { page: classin.home }
steps:
  - id: verify-home
    assertPage: classin.home
`;
}

function navigationSource(name: string): string {
  return `
version: 1
name: ${name}
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-home
    onPage: classin.detail
    tap: { target: { text: 主页 } }
    expectPage: classin.home
`;
}

function navigationRootSource(): string {
  return `
version: 1
kind: case
name: 教师主页入口
app: { id: cn.eeo.classin, platform: android }
entry: { page: classin.home, session: authenticated, role: teacher }
steps:
  - id: verify-home
    assertPage: classin.home
`;
}

class CapturingScriptFlowRunner {
  readonly inputs: StartScriptFlowRunInput[] = [];
  validationError?: Error;
  constructor(private readonly storage: MemoryScriptFlowStorage) {}

  validatePlan(): void {
    if (this.validationError) throw this.validationError;
  }

  async start(input: StartScriptFlowRunInput): Promise<TestRun> {
    this.inputs.push(input);
    const run: TestRun = {
      id: "run-1",
      caseName: input.flow.name,
      deviceSerial: input.deviceSerial,
      status: "running",
      config: {} as TestRun["config"],
      steps: [],
      stepResults: [],
      metrics: [],
      events: [],
      artifacts: [],
      sourceSnapshot: {
        kind: "script_flow",
        flowId: input.flowId,
        version: input.scriptVersion ?? 1,
        planDigest: input.planDigest,
        dependencies: input.dependencies,
        executionPurpose: input.executionPurpose,
        sourceHash: input.sourceHash,
        verificationAssessment: input.verificationAssessment,
        sourceYaml: input.sourceYaml,
        parsed: input.flow as unknown as Record<string, unknown>
      },
      startedAt: "2026-07-28T00:00:00.000Z"
    };
    this.storage.saveRun(run);
    return run;
  }
}

function storedFlow(
  id: string,
  version: number,
  input: { sourceYaml: string; document: ScriptFlowDocument; status?: ScriptFlow["status"] }
): ScriptFlow {
  return {
    id,
    appId: input.document.app.id,
    platform: input.document.app.platform,
    name: input.document.name,
    description: input.document.description,
    sourceYaml: input.sourceYaml,
    parsed: input.document as unknown as Record<string, unknown>,
    status: input.status ?? "draft",
    version,
    tags: input.document.tags,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z"
  };
}

function storedVersion(flow: ScriptFlow): ScriptFlowVersion {
  return { id: `${flow.id}-${flow.version}`, flowId: flow.id, version: flow.version, sourceYaml: flow.sourceYaml, parsed: flow.parsed, createdAt: flow.updatedAt };
}

async function get(baseUrl: string, path: string): Promise<{ status: number; body: unknown }> {
  return response(await fetch(baseUrl + path));
}

async function post(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  return response(await fetch(baseUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

async function put(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  return response(await fetch(baseUrl + path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

async function remove(baseUrl: string, path: string): Promise<{ status: number; body: unknown }> {
  return response(await fetch(baseUrl + path, { method: "DELETE" }));
}

async function response(value: Response): Promise<{ status: number; body: unknown }> {
  return { status: value.status, body: await value.json() };
}
