import type express from "express";
import { createHash } from "node:crypto";
import {
  ScriptFlowCompileError,
  ScriptFlowValidationError,
  compileScriptFlow,
  parseScriptFlow,
  type ScriptFlowDocument,
  type ScriptParameterValue
} from "@mobile-automation/script-flow";
import type { ScriptFlow } from "@mobile-automation/shared";
import type { Storage } from "./storage.js";
import type { PageNavigationSegmentSnapshot } from "./page-navigation.js";
import { readAndroidAppMonitorConfig } from "./android-app-monitor-request.js";
import { DeviceExecutionBusyError } from "./device-execution-lease.js";
import type { ScriptFlowRunner, StartScriptFlowRunInput } from "./script-flow-runner.js";
import { ScriptTargetResolutionError } from "./script-target-resolver.js";

export type ScriptFlowApiStorage = Pick<
  Storage,
  | "createScriptFlow"
  | "listScriptFlows"
  | "listPageNavigationSegments"
  | "getScriptFlow"
  | "updateScriptFlow"
  | "deleteScriptFlow"
  | "getRun"
>;

export type ScriptFlowApiRunner = Pick<ScriptFlowRunner, "start" | "validatePlan">;

export function registerScriptFlowRoutes(
  app: express.Application,
  deps: { storage: ScriptFlowApiStorage; runner: ScriptFlowApiRunner }
): void {
  app.get("/api/script-flows", (req, res) => {
    try {
      res.json({ flows: deps.storage.listScriptFlows(scriptFlowFilter(req.query)) });
    } catch (error) {
      sendScriptFlowError(res, error);
    }
  });

  app.post("/api/script-flows/validate", (req, res) => {
    try {
      const body = strictBody(req.body, ["sourceYaml"]);
      const document = parseScriptFlow(requiredSourceYaml(body.sourceYaml));
      res.json({ valid: true, document });
    } catch (error) {
      if (error instanceof ScriptFlowValidationError) {
        res.status(400).json({ valid: false, issues: error.issues });
        return;
      }
      sendScriptFlowError(res, error);
    }
  });

  app.post("/api/script-flows", (req, res) => {
    try {
      const input = readWriteInput(req.body);
      res.status(201).json({ flow: deps.storage.createScriptFlow(input) });
    } catch (error) {
      sendScriptFlowError(res, error);
    }
  });

  app.get("/api/script-flows/:id", (req, res) => {
    const flow = deps.storage.getScriptFlow(req.params.id);
    if (!flow) {
      res.status(404).json({ error: "ScriptFlow not found" });
      return;
    }
    res.json({ flow });
  });

  app.put("/api/script-flows/:id", (req, res) => {
    try {
      const existing = deps.storage.getScriptFlow(req.params.id);
      if (!existing) {
        res.status(404).json({ error: "ScriptFlow not found" });
        return;
      }
      const body = strictBody(req.body, ["sourceYaml", "status", "expectedVersion"]);
      assertExpectedVersion(existing, body.expectedVersion);
      res.json({ flow: deps.storage.updateScriptFlow(req.params.id, readWriteBody(body)) });
    } catch (error) {
      sendScriptFlowError(res, error);
    }
  });

  app.delete("/api/script-flows/:id", (req, res) => {
    const deleted = deps.storage.deleteScriptFlow(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "ScriptFlow not found" });
      return;
    }
    res.json({ deleted: true });
  });

  app.post("/api/script-flows/:id/preview", (req, res) => {
    try {
      const flow = requireFlow(deps.storage, req.params.id);
      const body = strictBody(req.body, ["expectedVersion", "parameters"]);
      assertExpectedVersion(flow, body.expectedVersion);
      const document = parseScriptFlow(flow.sourceYaml);
      const parameters = readParameters(body.parameters);
      const compiled = compileSnapshot(deps.storage, flow, document, parameters);
      deps.runner.validatePlan(compiled.plan);
      res.json({
        flow,
        plan: compiled.plan,
        planDigest: compiled.planDigest,
        dependencies: compiled.dependencies.map(publicDependency),
        navigationIndex: compiled.navigationIndex
      });
    } catch (error) {
      sendScriptFlowError(res, error);
    }
  });

  app.post("/api/script-flow-drafts/preview", (req, res) => {
    try {
      const body = strictBody(req.body, ["sourceYaml", "parameters"]);
      const root = temporaryFlow(requiredSourceYaml(body.sourceYaml));
      const document = parseScriptFlow(root.sourceYaml);
      const compiled = compileSnapshot(deps.storage, root, document, readParameters(body.parameters));
      deps.runner.validatePlan(compiled.plan);
      res.json({
        document,
        plan: compiled.plan,
        planDigest: compiled.planDigest,
        dependencies: compiled.dependencies.map(publicDependency),
        navigationIndex: compiled.navigationIndex
      });
    } catch (error) {
      sendScriptFlowError(res, error);
    }
  });

  app.post("/api/script-flow-drafts/runs", async (req, res) => {
    try {
      const body = strictBody(req.body, [
        "sourceYaml",
        "deviceSerial",
        "planDigest",
        "parameters",
        "mode",
        "repeatCount",
        "stepIntervalMs",
        "stopOnFailure",
        "recordVideo",
        "keepVideoOnSuccess",
        "pauseAfterEachStep",
        "androidAppMonitor"
      ]);
      const root = temporaryFlow(requiredSourceYaml(body.sourceYaml));
      const document = parseScriptFlow(root.sourceYaml);
      const parameters = readParameters(body.parameters);
      const compiled = compileSnapshot(deps.storage, root, document, parameters);
      if (requiredPlanDigest(body.planDigest) !== compiled.planDigest) {
        throw new ScriptFlowApiError(409, "Execution plan changed; preview again");
      }
      const run = await deps.runner.start({
        flowId: root.id,
        scriptVersion: 1,
        planDigest: compiled.planDigest,
        dependencies: compiled.dependencies,
        navigationSegments: compiled.navigationSegments,
        sourceYaml: root.sourceYaml,
        flow: document,
        deviceSerial: requiredString(body.deviceSerial, "deviceSerial"),
        parameters,
        androidAppMonitor: readAndroidAppMonitorConfig(body.androidAppMonitor),
        resolveFlow: compiled.resolveFlow,
        ...runOptions(body)
      });
      res.status(202).json({ run });
    } catch (error) {
      sendScriptFlowError(res, error);
    }
  });

  app.post("/api/script-flows/:id/runs", async (req, res) => {
    try {
      const flow = requireFlow(deps.storage, req.params.id);
      if (flow.status === "archived") {
        res.status(409).json({ error: "Archived ScriptFlow cannot run" });
        return;
      }
      const body = strictBody(req.body, [
        "deviceSerial",
        "expectedVersion",
        "planDigest",
        "parameters",
        "mode",
        "repeatCount",
        "stepIntervalMs",
        "stopOnFailure",
        "recordVideo",
        "keepVideoOnSuccess",
        "pauseAfterEachStep",
        "androidAppMonitor"
      ]);
      assertExpectedVersion(flow, body.expectedVersion);
      const document = parseScriptFlow(flow.sourceYaml);
      const parameters = readParameters(body.parameters);
      const compiled = compileSnapshot(deps.storage, flow, document, parameters);
      if (requiredPlanDigest(body.planDigest) !== compiled.planDigest) {
        throw new ScriptFlowApiError(409, "Execution plan changed; preview again");
      }
      const input: StartScriptFlowRunInput = {
        flowId: flow.id,
        scriptVersion: flow.version,
        planDigest: compiled.planDigest,
        dependencies: compiled.dependencies,
        navigationSegments: compiled.navigationSegments,
        sourceYaml: flow.sourceYaml,
        flow: document,
        deviceSerial: requiredString(body.deviceSerial, "deviceSerial"),
        parameters,
        androidAppMonitor: readAndroidAppMonitorConfig(body.androidAppMonitor),
        resolveFlow: compiled.resolveFlow,
        ...runOptions(body)
      };
      const run = await deps.runner.start(input);
      res.status(202).json({ run });
    } catch (error) {
      sendScriptFlowError(res, error);
    }
  });

  app.get("/api/script-flow-runs/:runId", (req, res) => {
    const run = deps.storage.getRun(req.params.runId);
    if (!run?.sourceSnapshot || run.sourceSnapshot.kind !== "script_flow") {
      res.status(404).json({ error: "ScriptFlow run not found" });
      return;
    }
    res.json({ run });
  });
}

function readWriteInput(value: unknown): { sourceYaml: string; document: ScriptFlowDocument; status?: ScriptFlow["status"] } {
  const body = strictBody(value, ["sourceYaml", "status"]);
  return readWriteBody(body);
}

function readWriteBody(body: Record<string, unknown>): { sourceYaml: string; document: ScriptFlowDocument; status?: ScriptFlow["status"] } {
  const sourceYaml = requiredSourceYaml(body.sourceYaml);
  return {
    sourceYaml,
    document: parseScriptFlow(sourceYaml),
    ...scriptFlowStatus(body.status)
  };
}

function temporaryFlow(sourceYaml: string): ScriptFlow {
  const document = parseScriptFlow(sourceYaml);
  const now = new Date(0).toISOString();
  return {
    id: `temporary:${sha256(sourceYaml).slice(0, 24)}`,
    appId: document.app.id,
    platform: document.app.platform,
    name: document.name,
    description: document.description,
    sourceYaml,
    parsed: document as unknown as Record<string, unknown>,
    status: "draft",
    version: 1,
    tags: document.tags,
    createdAt: now,
    updatedAt: now
  };
}

function strictBody(value: unknown, allowedFields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScriptFlowApiError(400, "Request body must be an object");
  }
  const body = value as Record<string, unknown>;
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) {
    throw new ScriptFlowApiError(400, `Unknown request field: ${unknown}`);
  }
  return body;
}

function requiredSourceYaml(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ScriptFlowApiError(400, "sourceYaml is required");
  }
  const source = value;
  if (Buffer.byteLength(source, "utf8") > 1_000_000) {
    throw new ScriptFlowApiError(413, "sourceYaml is too large");
  }
  return source;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ScriptFlowApiError(400, `${field} is required`);
  }
  return value.trim();
}

function requiredPlanDigest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new ScriptFlowApiError(400, "planDigest must be a SHA-256 digest from preview");
  }
  return value;
}

function assertExpectedVersion(flow: ScriptFlow, value: unknown): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ScriptFlowApiError(400, "expectedVersion must be a positive integer");
  }
  if (flow.version !== value) {
    throw new ScriptFlowApiError(409, "ScriptFlow version changed; reload before continuing");
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function scriptFlowStatus(value: unknown): { status?: ScriptFlow["status"] } {
  if (value === undefined) {
    return {};
  }
  if (value !== "draft" && value !== "active" && value !== "archived") {
    throw new ScriptFlowApiError(400, "status must be draft, active, or archived");
  }
  return { status: value };
}

function scriptFlowFilter(query: express.Request["query"]): {
  appId?: string;
  platform?: ScriptFlow["platform"];
  status?: ScriptFlow["status"];
} {
  const appId = optionalString(query.appId);
  const platform = optionalString(query.platform);
  const status = optionalString(query.status);
  if (platform && !["android", "ios", "harmony", "flutter"].includes(platform)) {
    throw new ScriptFlowApiError(400, "Invalid ScriptFlow platform");
  }
  if (status && !["draft", "active", "archived"].includes(status)) {
    throw new ScriptFlowApiError(400, "Invalid ScriptFlow status");
  }
  return {
    ...(appId ? { appId } : {}),
    ...(platform ? { platform: platform as ScriptFlow["platform"] } : {}),
    ...(status ? { status: status as ScriptFlow["status"] } : {})
  };
}

function readParameters(value: unknown): Record<string, ScriptParameterValue> {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScriptFlowApiError(400, "parameters must be an object");
  }
  const result: Record<string, ScriptParameterValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
      throw new ScriptFlowApiError(400, `parameters.${key} must be a scalar value`);
    }
    result[key] = item;
  }
  return result;
}

function runOptions(body: Record<string, unknown>): Partial<StartScriptFlowRunInput> {
  const mode = body.mode;
  if (mode !== undefined && mode !== "once" && mode !== "repeat_n" && mode !== "loop_until_stop") {
    throw new ScriptFlowApiError(400, "Invalid run mode");
  }
  return {
    ...(mode ? { mode } : {}),
    ...optionalPositiveInteger(body.repeatCount, "repeatCount"),
    ...optionalNonNegativeNumber(body.stepIntervalMs, "stepIntervalMs"),
    ...optionalBoolean(body.stopOnFailure, "stopOnFailure"),
    ...optionalBoolean(body.recordVideo, "recordVideo"),
    ...optionalBoolean(body.keepVideoOnSuccess, "keepVideoOnSuccess"),
    ...optionalBoolean(body.pauseAfterEachStep, "pauseAfterEachStep")
  };
}

function optionalPositiveInteger(value: unknown, key: "repeatCount"): Pick<StartScriptFlowRunInput, "repeatCount"> {
  if (value === undefined) return {};
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new ScriptFlowApiError(400, `${key} must be a positive integer`);
  return { [key]: value };
}

function optionalNonNegativeNumber(value: unknown, key: "stepIntervalMs"): Pick<StartScriptFlowRunInput, "stepIntervalMs"> {
  if (value === undefined) return {};
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new ScriptFlowApiError(400, `${key} must be non-negative`);
  return { [key]: value };
}

function optionalBoolean<K extends "stopOnFailure" | "recordVideo" | "keepVideoOnSuccess" | "pauseAfterEachStep">(
  value: unknown,
  key: K
): Pick<StartScriptFlowRunInput, K> {
  if (value === undefined) return {} as Pick<StartScriptFlowRunInput, K>;
  if (typeof value !== "boolean") throw new ScriptFlowApiError(400, `${key} must be boolean`);
  return { [key]: value } as Pick<StartScriptFlowRunInput, K>;
}

export type ScriptFlowDependencySnapshot = {
  flowId: string;
  version: number;
  sourceHash: string;
  sourceYaml: string;
  parsed: Record<string, unknown>;
};

function compileSnapshot(
  storage: ScriptFlowApiStorage,
  root: ScriptFlow,
  document: ScriptFlowDocument,
  parameters: Record<string, ScriptParameterValue>
): {
  plan: ReturnType<typeof compileScriptFlow>;
  planDigest: string;
  dependencies: ScriptFlowDependencySnapshot[];
  navigationSegments: PageNavigationSegmentSnapshot[];
  navigationIndex: { segmentCount: number; digest: string };
  resolveFlow: (id: string) => ScriptFlowDocument | undefined;
} {
  const documents = new Map<string, ScriptFlowDocument>();
  const dependencies = new Map<string, ScriptFlowDependencySnapshot>();
  collectDependencies(storage, document.steps, documents, dependencies);
  const navigationSegments = (Boolean(document.entry?.page) || containsReachPage(document.steps))
    ? storage.listPageNavigationSegments({ appId: root.appId, platform: root.platform }).filter((segment) => segment.flowId !== root.id)
    : [];
  const orderedDependencies = [...dependencies.values()].sort((left, right) => left.flowId.localeCompare(right.flowId));
  const orderedNavigationSegments = [...navigationSegments].sort((left, right) => left.id.localeCompare(right.id));
  const navigationIndex = {
    segmentCount: orderedNavigationSegments.length,
    digest: sha256(canonicalJson(orderedNavigationSegments))
  };
  const resolveFlow = (id: string) => documents.get(id);
  const plan = compileScriptFlow(document, { parameters, resolveFlow });
  const planDigest = sha256(canonicalJson({
    root: { flowId: root.id, version: root.version, sourceHash: sha256(root.sourceYaml) },
    dependencies: orderedDependencies.map(publicDependency),
    navigationIndex,
    plan
  }));
  return {
    plan,
    planDigest,
    dependencies: orderedDependencies,
    navigationSegments: orderedNavigationSegments,
    navigationIndex,
    resolveFlow
  };
}

function containsReachPage(steps: ScriptFlowDocument["steps"]): boolean {
  return steps.some((step) => {
    if ("reachPage" in step) return true;
    if ("repeat" in step) return containsReachPage(step.repeat.steps);
    if ("when" in step) return containsReachPage(step.when.steps);
    return false;
  });
}

function collectDependencies(
  storage: ScriptFlowApiStorage,
  steps: ScriptFlowDocument["steps"],
  documents: Map<string, ScriptFlowDocument>,
  dependencies: Map<string, ScriptFlowDependencySnapshot>
): void {
  for (const step of steps) {
    if ("repeat" in step) {
      collectDependencies(storage, step.repeat.steps, documents, dependencies);
      continue;
    }
    if ("when" in step) {
      collectDependencies(storage, step.when.steps, documents, dependencies);
      continue;
    }
    if (!("runFlow" in step) || dependencies.has(step.runFlow)) {
      continue;
    }
    const flow = storage.getScriptFlow(step.runFlow);
    if (!flow || flow.status === "archived") {
      throw new ScriptFlowCompileError(`runFlow not found: ${step.runFlow}`);
    }
    const child = parseScriptFlow(flow.sourceYaml);
    documents.set(flow.id, child);
    dependencies.set(flow.id, dependencySnapshot(flow, child));
    collectDependencies(storage, child.steps, documents, dependencies);
  }
}

function dependencySnapshot(flow: ScriptFlow, document = parseScriptFlow(flow.sourceYaml)): ScriptFlowDependencySnapshot {
  return {
    flowId: flow.id,
    version: flow.version,
    sourceHash: sha256(flow.sourceYaml),
    sourceYaml: flow.sourceYaml,
    parsed: document as unknown as Record<string, unknown>
  };
}

function publicDependency(dependency: ScriptFlowDependencySnapshot): Pick<ScriptFlowDependencySnapshot, "flowId" | "version" | "sourceHash"> {
  return { flowId: dependency.flowId, version: dependency.version, sourceHash: dependency.sourceHash };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireFlow(storage: ScriptFlowApiStorage, id: string): ScriptFlow {
  const flow = storage.getScriptFlow(id);
  if (!flow) {
    throw new ScriptFlowApiError(404, "ScriptFlow not found");
  }
  return flow;
}

function sendScriptFlowError(res: express.Response, error: unknown): void {
  if (error instanceof ScriptFlowApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof ScriptFlowValidationError) {
    res.status(400).json({ error: "ScriptFlow validation failed", issues: error.issues });
    return;
  }
  if (error instanceof ScriptFlowCompileError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof ScriptTargetResolutionError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof DeviceExecutionBusyError) {
    res.status(409).json({
      error: "设备正在执行其他任务，请等待当前执行结束或先停止当前执行。",
      activeRunId: error.activeRunId,
      deviceSerial: error.deviceSerial,
      activeKind: error.activeKind
    });
    return;
  }
  res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
}

class ScriptFlowApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ScriptFlowApiError";
  }
}
