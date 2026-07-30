import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { ScriptFlowDocument } from "@mobile-automation/script-flow";
import type { ScriptFlow, ScriptFlowVersion, TestRun } from "@mobile-automation/shared";
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

  it("previews and runs an unsaved draft without adding it to the use case center", async () => {
    const context = await apiContext(servers);

    const preview = await post(context.baseUrl, "/api/script-flow-drafts/preview", {
      sourceYaml,
      parameters: { friendName: "张三" }
    });
    expect(preview.status).toBe(200);
    const planDigest = (preview.body as { planDigest: string }).planDigest;

    const started = await post(context.baseUrl, "/api/script-flow-drafts/runs", {
      sourceYaml,
      planDigest,
      deviceSerial: "device-1",
      parameters: { friendName: "张三" }
    });

    expect(started.status).toBe(202);
    expect(context.storage.listScriptFlows()).toEqual([]);
    expect(context.runner.inputs).toEqual([
      expect.objectContaining({
        flowId: expect.stringMatching(/^temporary:/),
        scriptVersion: 1,
        sourceYaml,
        deviceSerial: "device-1"
      })
    ]);
  });

  it("freezes the derived navigation index without copying active use case sources into dependencies", async () => {
    const context = await apiContext(servers);
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

  it("rejects saving an AI revision over a newer use case version", async () => {
    const context = await apiContext(servers);
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
      body: { error: "页面元素“班级列表”需要参数 className（班级名称）" }
    });
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

  listScriptFlowVersions(id: string): ScriptFlowVersion[] { return this.versions.get(id) ?? []; }
  getRun(id: string): TestRun | undefined { return this.runs.get(id); }
  saveRun(run: TestRun): void { this.runs.set(run.id, run); }
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
