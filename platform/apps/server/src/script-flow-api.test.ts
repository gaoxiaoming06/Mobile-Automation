import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { ScriptFlowDocument } from "@mobile-automation/script-flow";
import type { ScriptFlow, ScriptFlowVersion, TestRun } from "@mobile-automation/shared";
import { registerScriptFlowRoutes, type ScriptFlowApiStorage } from "./script-flow-api.js";
import type { StartScriptFlowRunInput } from "./script-flow-runner.js";

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
        ocrText: 添加好友
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
    const updatedResponse = await put(context.baseUrl, `/api/script-flows/${created.id}`, { sourceYaml: updatedYaml, status: "active" });
    expect(updatedResponse.body).toEqual({
      flow: expect.objectContaining({ version: 2, name: "打开添加好友页面", status: "active" })
    });

    const preview = await post(context.baseUrl, `/api/script-flows/${created.id}/preview`, {
      parameters: { friendName: "张三" }
    });
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual(expect.objectContaining({
      plan: expect.objectContaining({ steps: [expect.objectContaining({ id: "open-add-friend", action: "tap" })] })
    }));

    const runResponse = await post(context.baseUrl, `/api/script-flows/${created.id}/runs`, {
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
    const flow = storedFlow("flow-1", 1, input);
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

class CapturingScriptFlowRunner {
  readonly inputs: StartScriptFlowRunInput[] = [];
  constructor(private readonly storage: MemoryScriptFlowStorage) {}

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
