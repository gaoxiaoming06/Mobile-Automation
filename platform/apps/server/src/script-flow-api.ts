import type express from "express";
import {
  ScriptFlowCompileError,
  ScriptFlowValidationError,
  compileScriptFlow,
  parseScriptFlow,
  type ScriptFlowDocument,
  type ScriptParameterValue,
  type ScriptStepRisk
} from "@mobile-automation/script-flow";
import type { ScriptFlow } from "@mobile-automation/shared";
import type { Storage } from "./storage.js";
import { readAndroidAppMonitorConfig } from "./android-app-monitor-request.js";
import type { ScriptFlowRunner, StartScriptFlowRunInput } from "./script-flow-runner.js";

export type ScriptFlowApiStorage = Pick<
  Storage,
  | "createScriptFlow"
  | "listScriptFlows"
  | "getScriptFlow"
  | "updateScriptFlow"
  | "deleteScriptFlow"
  | "getRun"
>;

export type ScriptFlowApiRunner = Pick<ScriptFlowRunner, "start">;

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
      if (!deps.storage.getScriptFlow(req.params.id)) {
        res.status(404).json({ error: "ScriptFlow not found" });
        return;
      }
      res.json({ flow: deps.storage.updateScriptFlow(req.params.id, readWriteInput(req.body)) });
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
      const body = strictBody(req.body, ["parameters"]);
      const document = parseScriptFlow(flow.sourceYaml);
      const parameters = readParameters(body.parameters);
      const plan = compileScriptFlow(document, {
        parameters,
        resolveFlow: flowResolver(deps.storage)
      });
      res.json({ flow, plan });
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
        "parameters",
        "confirmedRisks",
        "mode",
        "repeatCount",
        "stepIntervalMs",
        "stopOnFailure",
        "recordVideo",
        "keepVideoOnSuccess",
        "pauseAfterEachStep",
        "androidAppMonitor"
      ]);
      const document = parseScriptFlow(flow.sourceYaml);
      const input: StartScriptFlowRunInput = {
        flowId: flow.id,
        scriptVersion: flow.version,
        sourceYaml: flow.sourceYaml,
        flow: document,
        deviceSerial: requiredString(body.deviceSerial, "deviceSerial"),
        parameters: readParameters(body.parameters),
        confirmedRisks: readConfirmedRisks(body.confirmedRisks),
        androidAppMonitor: readAndroidAppMonitorConfig(body.androidAppMonitor),
        resolveFlow: flowResolver(deps.storage),
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
  const sourceYaml = requiredSourceYaml(body.sourceYaml);
  return {
    sourceYaml,
    document: parseScriptFlow(sourceYaml),
    ...scriptFlowStatus(body.status)
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

function readConfirmedRisks(value: unknown): ScriptStepRisk[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => !["submit", "publish", "delete", "payment"].includes(String(item)))) {
    throw new ScriptFlowApiError(400, "confirmedRisks contains an invalid risk");
  }
  return value as ScriptStepRisk[];
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

function flowResolver(storage: ScriptFlowApiStorage): (id: string) => ScriptFlowDocument | undefined {
  return (id) => {
    const flow = storage.getScriptFlow(id);
    return flow ? parseScriptFlow(flow.sourceYaml) : undefined;
  };
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
  res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
}

class ScriptFlowApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ScriptFlowApiError";
  }
}
