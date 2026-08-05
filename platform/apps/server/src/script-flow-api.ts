import type express from "express";
import { createHash } from "node:crypto";
import {
  ScriptFlowCompileError,
  ScriptFlowValidationError,
  compileScriptFlow,
  parseScriptFlow,
  reusableCoreSteps,
  type ScriptExecutionPlan,
  type ScriptFlowDocument,
  type ScriptParameterValue
} from "@mobile-automation/script-flow";
import {
  CROSS_PLATFORM_SCRIPT_SCOPE,
  publicExecutionFailure,
  publicExecutionFailureFromRun,
  type InteractionAsset,
  type PublicExecutionFailureKind,
  type ScriptFlow
} from "@mobile-automation/shared";
import type { Storage } from "./storage.js";
import type { PageNavigationSegmentSnapshot } from "./page-navigation.js";
import { readAndroidAppMonitorConfig } from "./android-app-monitor-request.js";
import { DeviceExecutionBusyError } from "./device-execution-lease.js";
import type {
  ScriptFlowRunner,
  ScriptInteractionAssetBinding,
  StartScriptFlowRunInput
} from "./script-flow-runner.js";
import { selectScriptExecutionSteps } from "./script-flow-runner.js";
import { ScriptTargetResolutionError } from "./script-target-resolver.js";
import { assessScriptFlowVerification } from "./script-flow-verification.js";
import { targetAppIdAliases } from "./target-app-runtime.js";

export type ScriptFlowApiStorage = Pick<
  Storage,
  | "createScriptFlow"
  | "listScriptFlows"
  | "listPageNavigationSegments"
  | "listInteractionAssets"
  | "findLatestFlowVerification"
  | "getScriptFlow"
  | "updateScriptFlow"
  | "deleteScriptFlow"
  | "recordTemporaryTest"
  | "listTemporaryTests"
  | "getRun"
>;

export type ScriptFlowApiRunner = Pick<ScriptFlowRunner, "start" | "validatePlan">;

type ScriptFlowRouteDeps = { storage: ScriptFlowApiStorage; runner: ScriptFlowApiRunner };

export function registerScriptFlowRoutes(
  app: express.Application,
  deps: ScriptFlowRouteDeps
): void {
  app.get("/api/script-flows", (req, res) => {
    try {
      res.json({ flows: listScriptFlows(deps.storage, scriptFlowFilter(req.query)) });
    } catch (error) {
      sendScriptFlowError(res, error);
    }
  });

  app.get("/api/temporary-tests", (req, res) => {
    try {
      res.json({ tests: listTemporaryTests(deps.storage, temporaryTestFilter(req.query)) });
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
      assertCaseCenterEligible(input.document);
      assertActivationAllowed(deps.storage, input, input.status ?? "draft");
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
      const input = readWriteBody(body);
      assertCaseCenterEligible(input.document);
      assertActivationAllowed(deps.storage, input, input.status ?? existing.status);
      res.json({ flow: deps.storage.updateScriptFlow(req.params.id, input) });
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
      const verification = verificationAssessment(deps.storage, flow, document, compiled.dependencies);
      deps.runner.validatePlan(compiled.plan, compiled.interactionAssets);
      res.json({
        flow,
        plan: compiled.plan,
        planDigest: compiled.planDigest,
        verification,
        dependencies: compiled.dependencies.map(publicDependency),
        interactionAssets: compiled.interactionAssets.map(publicInteractionAsset),
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
      const verification = verificationAssessment(deps.storage, root, document, compiled.dependencies);
      deps.runner.validatePlan(compiled.plan, compiled.interactionAssets);
      res.json({
        document,
        plan: compiled.plan,
        planDigest: compiled.planDigest,
        verification,
        dependencies: compiled.dependencies.map(publicDependency),
        interactionAssets: compiled.interactionAssets.map(publicInteractionAsset),
        navigationIndex: compiled.navigationIndex
      });
    } catch (error) {
      sendScriptFlowError(res, error);
    }
  });

  app.post("/api/script-flow-drafts/verification", (req, res) => {
    try {
      const body = strictBody(req.body, ["sourceYaml"]);
      const root = temporaryFlow(requiredSourceYaml(body.sourceYaml));
      const document = parseScriptFlow(root.sourceYaml);
      res.json({ verification: verificationAssessment(deps.storage, root, document, dependencySnapshots(deps.storage, document)) });
    } catch (error) {
      sendScriptFlowError(res, error);
    }
  });

  app.get("/api/script-flows/:id/verification", (req, res) => {
    try {
      const flow = requireFlow(deps.storage, requiredString(req.params.id, "id"));
      const document = parseScriptFlow(flow.sourceYaml);
      res.json({
        flowId: flow.id,
        version: flow.version,
        verification: verificationAssessment(deps.storage, flow, document, dependencySnapshots(deps.storage, document))
      });
    } catch (error) {
      sendScriptFlowError(res, error);
    }
  });

  app.post("/api/script-flow-drafts/runs", async (req, res) => {
    await startDraftExecution(req, res, deps, "normal");
  });

  app.post("/api/script-flow-drafts/trial-runs", async (req, res) => {
    await startDraftExecution(req, res, deps, "trial");
  });

  app.post("/api/script-flow-drafts/step-runs", async (req, res) => {
    await startDraftStepExecution(req, res, deps);
  });

  app.post("/api/script-flows/:id/runs", async (req, res) => {
    await startPersistedExecution(req, res, deps, "normal");
  });

  app.post("/api/script-flows/:id/trial-runs", async (req, res) => {
    await startPersistedExecution(req, res, deps, "trial");
  });

  app.get("/api/script-flow-runs/:runId", (req, res) => {
    const run = deps.storage.getRun(req.params.runId);
    if (!run?.sourceSnapshot || run.sourceSnapshot.kind !== "script_flow") {
      res.status(404).json({ error: "ScriptFlow run not found" });
      return;
    }
    res.json({ run, failure: publicExecutionFailureFromRun(run) });
  });
}

const DRAFT_RUN_FIELDS = [
  "prompt",
  "sourceYaml",
  "deviceSerial",
  "planDigest",
  "parameters",
  "mode",
  "loopScope",
  "repeatCount",
  "stepIntervalMs",
  "stopOnFailure",
  "recordVideo",
  "keepVideoOnSuccess",
  "pauseAfterEachStep",
  "androidAppMonitor"
];

const PERSISTED_RUN_FIELDS = DRAFT_RUN_FIELDS.filter(
  (field) => field !== "sourceYaml" && field !== "prompt",
).concat("expectedVersion");

const DRAFT_STEP_RUN_FIELDS = [
  "sourceYaml",
  "deviceSerial",
  "parameters",
  "startStepId",
  "endStepId",
  "pauseAfterEachStep",
  "androidAppMonitor"
];

async function startDraftStepExecution(
  req: express.Request,
  res: express.Response,
  deps: ScriptFlowRouteDeps
): Promise<void> {
  try {
    const body = strictBody(req.body, DRAFT_STEP_RUN_FIELDS);
    const root = temporaryFlow(requiredSourceYaml(body.sourceYaml));
    const document = parseScriptFlow(root.sourceYaml);
    const parameters = readParameters(body.parameters);
    const compiled = compileSnapshot(deps.storage, root, document, parameters);
    const startStepId = requiredString(body.startStepId, "startStepId");
    const endStepId = optionalString(body.endStepId);
    const stepSelection = { startStepId, ...(endStepId ? { endStepId } : {}) };
    try {
      selectScriptExecutionSteps(compiled.plan, stepSelection);
    } catch (error) {
      throw new ScriptFlowApiError(400, error instanceof Error ? error.message : String(error));
    }
    const pauseAfterEachStep = optionalBoolean(body.pauseAfterEachStep, "pauseAfterEachStep");
    const run = await deps.runner.start({
      flowId: root.id,
      scriptVersion: 1,
      planDigest: compiled.planDigest,
      dependencies: compiled.dependencies,
      navigationSegments: compiled.navigationSegments,
      navigationRootPages: compiled.navigationRootPages,
      interactionAssets: compiled.interactionAssets,
      sourceYaml: root.sourceYaml,
      executionPurpose: "step_trial",
      flow: document,
      deviceSerial: requiredString(body.deviceSerial, "deviceSerial"),
      parameters,
      androidAppMonitor: readAndroidAppMonitorConfig(body.androidAppMonitor),
      resolveFlow: compiled.resolveFlow,
      stepSelection,
      startStrategy: "keep_current",
      mode: "once",
      stopOnFailure: true,
      recordVideo: false,
      keepVideoOnSuccess: false,
      pauseAfterEachStep: pauseAfterEachStep.pauseAfterEachStep ?? false
    });
    res.status(202).json({ run });
  } catch (error) {
    sendScriptFlowError(res, error);
  }
}

async function startDraftExecution(
  req: express.Request,
  res: express.Response,
  deps: ScriptFlowRouteDeps,
  purpose: "trial" | "normal"
): Promise<void> {
  try {
    const body = strictBody(req.body, DRAFT_RUN_FIELDS);
    const root = temporaryFlow(requiredSourceYaml(body.sourceYaml));
    const document = parseScriptFlow(root.sourceYaml);
    const parameters = readParameters(body.parameters);
    const compiled = compileSnapshot(deps.storage, root, document, parameters);
    if (requiredPlanDigest(body.planDigest) !== compiled.planDigest) {
      throw new ScriptFlowApiError(409, "Execution plan changed; preview again");
    }
    const verification = verificationAssessment(deps.storage, root, document, compiled.dependencies);
    assertExecutionAllowed(verification.status, purpose);
    const run = await deps.runner.start({
      flowId: root.id,
      scriptVersion: 1,
      planDigest: compiled.planDigest,
      dependencies: compiled.dependencies,
      navigationSegments: compiled.navigationSegments,
      navigationRootPages: compiled.navigationRootPages,
      interactionAssets: compiled.interactionAssets,
      sourceYaml: root.sourceYaml,
      sourceHash: verification.sourceHash,
      executionPurpose: purpose,
      verificationAssessment: verification,
      flow: document,
      deviceSerial: requiredString(body.deviceSerial, "deviceSerial"),
      parameters,
      androidAppMonitor: readAndroidAppMonitorConfig(body.androidAppMonitor),
      resolveFlow: compiled.resolveFlow,
      ...(purpose === "trial" ? trialRunOptions(body) : runOptions(body))
    });
    deps.storage.recordTemporaryTest({
      prompt: optionalString(body.prompt) ?? document.description ?? document.name,
      sourceYaml: root.sourceYaml,
      document,
      parameterValues: nonSensitiveParameterValues(document, parameters),
      runId: run.id
    });
    res.status(202).json({ run });
  } catch (error) {
    sendScriptFlowError(res, error);
  }
}

function nonSensitiveParameterValues(
  document: ScriptFlowDocument,
  parameters: Record<string, ScriptParameterValue>
): Record<string, ScriptParameterValue> {
  return Object.fromEntries(Object.entries(parameters).filter(([key]) => document.parameters[key]?.sensitive !== true));
}

function assertCaseCenterEligible(document: ScriptFlowDocument): void {
  if (document.purpose === "navigation") {
    throw new ScriptFlowApiError(409, "导航流程由系统内部复用，不保存到用例中心");
  }
}

async function startPersistedExecution(
  req: express.Request,
  res: express.Response,
  deps: ScriptFlowRouteDeps,
  purpose: "trial" | "normal"
): Promise<void> {
  try {
    const flow = requireFlow(deps.storage, requiredString(req.params.id, "id"));
    if (flow.status === "archived") {
      throw new ScriptFlowApiError(409, "Archived ScriptFlow cannot run");
    }
    const body = strictBody(req.body, PERSISTED_RUN_FIELDS);
    assertExpectedVersion(flow, body.expectedVersion);
    const document = parseScriptFlow(flow.sourceYaml);
    const parameters = readParameters(body.parameters);
    const compiled = compileSnapshot(deps.storage, flow, document, parameters);
    if (requiredPlanDigest(body.planDigest) !== compiled.planDigest) {
      throw new ScriptFlowApiError(409, "Execution plan changed; preview again");
    }
    const verification = verificationAssessment(deps.storage, flow, document, compiled.dependencies);
    assertExecutionAllowed(verification.status, purpose);
    const input: StartScriptFlowRunInput = {
      flowId: flow.id,
      scriptVersion: flow.version,
      planDigest: compiled.planDigest,
      dependencies: compiled.dependencies,
      navigationSegments: compiled.navigationSegments,
      navigationRootPages: compiled.navigationRootPages,
      interactionAssets: compiled.interactionAssets,
      sourceYaml: flow.sourceYaml,
      sourceHash: verification.sourceHash,
      executionPurpose: purpose,
      verificationAssessment: verification,
      flow: document,
      deviceSerial: requiredString(body.deviceSerial, "deviceSerial"),
      parameters,
      androidAppMonitor: readAndroidAppMonitorConfig(body.androidAppMonitor),
      resolveFlow: compiled.resolveFlow,
      ...(purpose === "trial" ? trialRunOptions(body) : runOptions(body))
    };
    const run = await deps.runner.start(input);
    res.status(202).json({ run });
  } catch (error) {
    sendScriptFlowError(res, error);
  }
}

function verificationAssessment(
  storage: ScriptFlowApiStorage,
  flow: ScriptFlow,
  document: ScriptFlowDocument,
  dependencies: ScriptFlowDependencySnapshot[] = []
) {
  const sourceHash = sha256(flow.sourceYaml);
  const verified = storage.findLatestFlowVerification({
    sourceHash,
    appId: flow.appId,
    platform: flow.platform,
    status: "verified"
  });
  const assessment = assessScriptFlowVerification({
    document,
    sourceYaml: flow.sourceYaml,
    verifiedSourceHashes: verified ? [sourceHash] : []
  });
  const unverifiedDependencies = dependencies.filter((dependency) => !storage.findLatestFlowVerification({
    sourceHash: dependency.sourceHash,
    appId: flow.appId,
    platform: flow.platform,
    status: "verified"
  }));
  if (unverifiedDependencies.length === 0) return assessment;
  return {
    ...assessment,
    status: assessment.status === "blocked" ? "blocked" as const : "needs_trial" as const,
    reasons: [...new Set([
      ...assessment.reasons,
      ...unverifiedDependencies.map((dependency) =>
        `复用用例 ${dependency.flowId} · v${dependency.version} 尚未通过试运行`
      )
    ])]
  };
}

function assertExecutionAllowed(status: "verified" | "needs_trial" | "blocked", purpose: "trial" | "normal"): void {
  if (status === "blocked") {
    throw new ScriptFlowApiError(409, "ScriptFlow is blocked and cannot run");
  }
  if (purpose === "normal" && status !== "verified") {
    throw new ScriptFlowApiError(409, "ScriptFlow must pass a trial run before normal execution");
  }
}

function assertActivationAllowed(
  storage: ScriptFlowApiStorage,
  input: { sourceYaml: string; document: ScriptFlowDocument },
  status: ScriptFlow["status"]
): void {
  if (status !== "active") return;
  const verification = verificationAssessment(
    storage,
    temporaryFlow(input.sourceYaml),
    input.document,
    dependencySnapshots(storage, input.document)
  );
  if (verification.status !== "verified") {
    throw new ScriptFlowApiError(409, "ScriptFlow must pass a trial run before it can be activated");
  }
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
    platform: CROSS_PLATFORM_SCRIPT_SCOPE,
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

function listScriptFlows(
  storage: Pick<ScriptFlowApiStorage, "listScriptFlows">,
  filter: {
    appId?: string;
    platform?: ScriptFlow["platform"];
    status?: ScriptFlow["status"];
  }
): ScriptFlow[] {
  if (!filter.appId) {
    return storage.listScriptFlows(filter);
  }
  const flowsById = new Map<string, ScriptFlow>();
  for (const appId of targetAppIdAliases(filter.appId)) {
    for (const flow of storage.listScriptFlows({ ...filter, appId })) {
      flowsById.set(flow.id, flow);
    }
  }
  return [...flowsById.values()];
}

function listTemporaryTests(
  storage: Pick<ScriptFlowApiStorage, "listTemporaryTests">,
  filter: {
    appId?: string;
    platform?: ScriptFlow["platform"];
    limit?: number;
  }
) {
  if (!filter.appId) {
    return storage.listTemporaryTests(filter);
  }
  const testsById = new Map<string, ReturnType<ScriptFlowApiStorage["listTemporaryTests"]>[number]>();
  for (const appId of targetAppIdAliases(filter.appId)) {
    for (const test of storage.listTemporaryTests({ ...filter, appId })) {
      testsById.set(test.id, test);
    }
  }
  return [...testsById.values()].slice(0, filter.limit ?? 50);
}

function scriptFlowFilter(query: express.Request["query"]): {
  appId?: string;
  platform?: ScriptFlow["platform"];
  status?: ScriptFlow["status"];
} {
  const appId = optionalString(query.appId);
  const platform = optionalString(query.platform);
  const status = optionalString(query.status);
  if (platform && !["android", "ios", "harmony", "flutter", CROSS_PLATFORM_SCRIPT_SCOPE].includes(platform)) {
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

function temporaryTestFilter(query: express.Request["query"]): {
  appId?: string;
  platform?: ScriptFlow["platform"];
  limit?: number;
} {
  const base = scriptFlowFilter({ appId: query.appId, platform: query.platform });
  const rawLimit = optionalString(query.limit);
  const limit = rawLimit === undefined ? undefined : Number(rawLimit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
    throw new ScriptFlowApiError(400, "limit must be an integer between 1 and 200");
  }
  return {
    ...(base.appId ? { appId: base.appId } : {}),
    ...(base.platform ? { platform: base.platform } : {}),
    ...(limit ? { limit } : {})
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
  const loopScope = body.loopScope;
  if (loopScope !== undefined && loopScope !== "all_steps" && loopScope !== "exclude_preparation") {
    throw new ScriptFlowApiError(400, "Invalid loop scope");
  }
  return {
    ...(mode ? { mode } : {}),
    ...(loopScope ? { loopScope } : {}),
    ...optionalPositiveInteger(body.repeatCount, "repeatCount"),
    ...optionalNonNegativeNumber(body.stepIntervalMs, "stepIntervalMs"),
    ...optionalBoolean(body.stopOnFailure, "stopOnFailure"),
    ...optionalBoolean(body.recordVideo, "recordVideo"),
    ...optionalBoolean(body.keepVideoOnSuccess, "keepVideoOnSuccess"),
    ...optionalBoolean(body.pauseAfterEachStep, "pauseAfterEachStep")
  };
}

function trialRunOptions(body: Record<string, unknown>): Partial<StartScriptFlowRunInput> {
  const options = runOptions(body);
  return {
    ...options,
    recordVideo: false,
    keepVideoOnSuccess: false
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
  navigationRootPages: string[];
  interactionAssets: ScriptInteractionAssetBinding[];
  navigationIndex: { segmentCount: number; rootCount: number; digest: string };
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
  const navigationRootPages = listNavigationRootPages(storage, root.appId, root.platform);
  const navigationIndex = {
    segmentCount: orderedNavigationSegments.length,
    rootCount: navigationRootPages.length,
    digest: sha256(canonicalJson({ segments: orderedNavigationSegments, roots: navigationRootPages }))
  };
  const resolveFlow = (id: string) => documents.get(id);
  const plan = compileScriptFlow(document, { parameters, resolveFlow });
  const interactionAssets = freezeInteractionAssets(storage, plan);
  const planDigest = sha256(canonicalJson({
    root: { flowId: root.id, version: root.version, sourceHash: sha256(root.sourceYaml) },
    dependencies: orderedDependencies.map(publicDependency),
    navigationIndex,
    interactionAssets,
    plan
  }));
  return {
    plan,
    planDigest,
    dependencies: orderedDependencies,
    navigationSegments: orderedNavigationSegments,
    navigationRootPages,
    interactionAssets,
    navigationIndex,
    resolveFlow
  };
}

function listNavigationRootPages(
  storage: ScriptFlowApiStorage,
  appId: string,
  platform: ScriptFlow["platform"]
): string[] {
  return [...new Set(storage.listScriptFlows({ appId, platform, status: "active" }).flatMap((flow) => {
    const entry = recordValue(flow.parsed.entry) ?? {};
    const page = normalizedString(entry.page);
    const session = normalizedString(entry.session);
    return page && session ? [page] : [];
  }))].sort();
}

function freezeInteractionAssets(
  storage: ScriptFlowApiStorage,
  plan: ScriptExecutionPlan
): ScriptInteractionAssetBinding[] {
  const assets = storage.listInteractionAssets({ appId: plan.app.id, platform: CROSS_PLATFORM_SCRIPT_SCOPE })
    .filter((asset) => asset.status === "active");
  return plan.steps.flatMap((step) => {
    if (!isInteractionAction(step.action) || !step.onPage) return [];
    const target = recordValue(step.input.target);
    if (!target) return [];
    const matches = assets.filter((asset) =>
      asset.owner.kind === "page"
      && asset.owner.key === step.onPage
      && asset.supportedActions.includes(step.action as InteractionAsset["supportedActions"][number])
      && asset.locatorVariants.length > 0
      && interactionTargetMatches(target, asset)
    );
    if (matches.length > 1) {
      throw new ScriptFlowCompileError(
        `Multiple interaction assets match step ${step.id}; review the duplicated assets before previewing`
      );
    }
    return matches.length === 1 ? [{ stepId: step.id, asset: matches[0]! }] : [];
  });
}

function isInteractionAction(action: string): action is InteractionAsset["supportedActions"][number] {
  return action === "tap" || action === "inputText" || action === "clearText" || action === "selectText";
}

function interactionTargetMatches(target: Record<string, unknown>, asset: InteractionAsset): boolean {
  const text = normalizedString(target.text);
  if (text) {
    const textCandidates = [
      asset.name,
      ...asset.aliases,
      asset.semanticContract.text,
      ...asset.locatorVariants.map((variant) => variant.descriptor.selectedText)
    ].map(normalizedString).filter((value): value is string => Boolean(value));
    if (!textCandidates.includes(text)) return false;
  }
  for (const key of ["semantic", "icon", "control"] as const) {
    const expected = normalizedString(target[key]);
    if (expected && normalizedString(asset.semanticContract[key]) !== expected) return false;
  }
  if (!text && !["semantic", "icon", "control"].some((key) => normalizedString(target[key]))) return false;
  for (const key of ["area", "position", "nearText"] as const) {
    const expected = normalizedString(target[key]);
    const actual = normalizedString(asset.semanticContract[key]);
    if (expected && actual && expected !== actual) return false;
  }
  return true;
}

function publicInteractionAsset(binding: ScriptInteractionAssetBinding): {
  stepId: string;
  assetId: string;
  key: string;
  version: number;
} {
  return {
    stepId: binding.stepId,
    assetId: binding.asset.id,
    key: binding.asset.key,
    version: binding.asset.version
  };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
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
    collectDependencies(storage, reusableCoreSteps(child.steps), documents, dependencies);
  }
}

function dependencySnapshots(
  storage: ScriptFlowApiStorage,
  document: ScriptFlowDocument
): ScriptFlowDependencySnapshot[] {
  const documents = new Map<string, ScriptFlowDocument>();
  const dependencies = new Map<string, ScriptFlowDependencySnapshot>();
  collectDependencies(storage, document.steps, documents, dependencies);
  return [...dependencies.values()].sort((left, right) => left.flowId.localeCompare(right.flowId));
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
    const kind = compileFailureKind(error.message);
    if (kind) {
      sendPublicFailure(res, 400, kind);
      return;
    }
    res.status(400).json({ error: "测试计划无法通过校验，请调整测试描述后重试。" });
    return;
  }
  if (error instanceof ScriptTargetResolutionError) {
    sendPublicFailure(res, 400, targetResolutionFailureKind(error.message));
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
  sendPublicFailure(res, 500, "infrastructure_failure");
}

function sendPublicFailure(res: express.Response, status: number, kind: PublicExecutionFailureKind): void {
  const failure = publicExecutionFailure(kind);
  res.status(status).json({ error: failure.message, failure });
}

function compileFailureKind(message: string): PublicExecutionFailureKind | undefined {
  if (/missing required parameter|缺少.*参数/i.test(message)) return "missing_parameter";
  if (/multiple interaction assets|ambiguous|多个.*目标/i.test(message)) return "target_ambiguous";
  return undefined;
}

function targetResolutionFailureKind(message: string): PublicExecutionFailureKind {
  if (/需要参数|required parameter|parameter\s+[\w.-]+/i.test(message)) return "missing_parameter";
  if (/multiple|ambiguous|多个|歧义/i.test(message)) return "target_ambiguous";
  return "target_not_found";
}

class ScriptFlowApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ScriptFlowApiError";
  }
}
