import type express from "express";
import { parseScriptFlow, type ScriptFlowDocument } from "@mobile-automation/script-flow";
import {
  CROSS_PLATFORM_SCRIPT_SCOPE,
  publicExecutionFailureFromRun,
  type PublicExecutionFailure,
  type PublicExecutionFailureKind,
  type ScriptFlow,
  type TestRun
} from "@mobile-automation/shared";
import type { PageAssetPlatform } from "./page-asset-catalog.js";
import type { ScriptFlowAiDraft } from "./script-flow-ai-planner.js";
import { normalizeTargetAppId } from "./target-app-runtime.js";

export type ScriptFlowScreenAssistRequest = {
  mode: "current";
  deviceSerial: string;
};

export type ScriptFlowExternalContextRequest = {
  source: "code" | "directory" | "classin-code" | "manual";
  summary: string;
  implementationStack?: "android-native" | "ios-native" | "harmony-native" | "flutter" | "compose" | "swiftui" | "arkui" | "unknown";
  relevantFiles?: string[];
  candidateSteps?: string[];
  constraints?: string[];
};

export type ScriptFlowAiDraftGenerator = (input: {
  prompt: string;
  appId: string;
  platform: PageAssetPlatform;
  existingFlow?: ScriptFlow;
  screenAssist?: ScriptFlowScreenAssistRequest;
  externalContext?: ScriptFlowExternalContextRequest;
}) => Promise<ScriptFlowAiDraft>;

export function registerScriptFlowAiRoutes(
  app: express.Application,
  deps: {
    generateDraft: ScriptFlowAiDraftGenerator;
    getFlow: (id: string) => ScriptFlow | undefined;
    getRun?: (id: string) => TestRun | undefined;
  }
): void {
  app.post("/api/script-flow-drafts/generate", async (req, res) => {
    try {
      const body = strictBody(req.body);
      const prompt = requiredString(body.prompt, "prompt");
      const flowId = optionalString(body.flowId);
      const screenAssist = screenAssistValue(body.screenAssist);
      const externalContext = externalContextValue(body.externalContext);
      const draft = flowId
        ? await generateRevisionDraft(deps, flowId, body.expectedVersion, prompt, screenAssist, externalContext)
        : await deps.generateDraft({
            prompt,
            appId: normalizeTargetAppId(requiredString(body.appId, "appId")),
            platform: platformValue(body.scriptPlatform ?? body.platform),
            ...(externalContext ? { externalContext } : {}),
            ...(screenAssist ? { screenAssist } : {})
          });
      res.json({ draft });
    } catch (error) {
      const status = error instanceof ScriptFlowAiApiError ? error.status : 422;
      res.status(status).json(errorPayload(error));
    }
  });

  app.post("/api/script-flow-drafts/repair", async (req, res) => {
    try {
      const body = strictRepairBody(req.body);
      const sourceYaml = requiredSourceYaml(body.sourceYaml);
      const runId = requiredString(body.runId, "runId");
      const screenAssist = screenAssistValue(body.screenAssist);
      const run = deps.getRun?.(runId);
      if (!run) {
        throw new ScriptFlowAiApiError(404, "Run not found");
      }
      const failure = publicExecutionFailureFromRun(run);
      if (!failure) {
        throw new ScriptFlowAiApiError(409, "当前执行没有可修复失败。");
      }
      if (!isRepairableFailure(failure.kind)) {
        throw new ScriptFlowAiApiError(409, "当前失败属于 App、设备或环境问题，不应通过修改脚本掩盖。", { failure });
      }
      const document = parseScriptFlow(sourceYaml);
      const appId = normalizeTargetAppId(optionalString(body.appId) ?? document.app.id);
      const platform = platformValue(body.scriptPlatform ?? body.platform);
      const repairPrompt = buildRepairPrompt({
        instruction: optionalString(body.instruction) ?? optionalString(body.prompt),
        failure,
        run
      });
      const draft = stripRepairSourceFlow(await deps.generateDraft({
        prompt: repairPrompt,
        appId,
        platform,
        existingFlow: temporaryRepairFlow({ sourceYaml, document, appId, platform, runId }),
        externalContext: repairExternalContext({ run, failure, callerContext: externalContextValue(body.externalContext) }),
        ...(screenAssist ? { screenAssist } : {})
      }));
      res.json({ draft, repair: { runId, failure } });
    } catch (error) {
      const status = error instanceof ScriptFlowAiApiError ? error.status : 422;
      res.status(status).json(errorPayload(error));
    }
  });
}

function strictBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScriptFlowAiApiError(400, "Request body must be an object");
  }
  const body = value as Record<string, unknown>;
  const unknown = Object.keys(body).find((key) => !["prompt", "appId", "platform", "scriptPlatform", "flowId", "expectedVersion", "screenAssist", "externalContext"].includes(key));
  if (unknown) throw new ScriptFlowAiApiError(400, `Unknown request field: ${unknown}`);
  return body;
}

function strictRepairBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScriptFlowAiApiError(400, "Request body must be an object");
  }
  const body = value as Record<string, unknown>;
  const allowed = [
    "sourceYaml",
    "runId",
    "instruction",
    "prompt",
    "appId",
    "platform",
    "scriptPlatform",
    "screenAssist",
    "externalContext"
  ];
  const unknown = Object.keys(body).find((key) => !allowed.includes(key));
  if (unknown) throw new ScriptFlowAiApiError(400, `Unknown request field: ${unknown}`);
  return body;
}

async function generateRevisionDraft(
  deps: { generateDraft: ScriptFlowAiDraftGenerator; getFlow: (id: string) => ScriptFlow | undefined },
  flowId: string,
  expectedVersion: unknown,
  prompt: string,
  screenAssist: ScriptFlowScreenAssistRequest | undefined,
  externalContext: ScriptFlowExternalContextRequest | undefined
): Promise<ScriptFlowAiDraft> {
  const existingFlow = deps.getFlow(flowId);
  if (!existingFlow) {
    throw new ScriptFlowAiApiError(404, "Use case not found");
  }
  if (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ScriptFlowAiApiError(400, "expectedVersion must be a positive integer");
  }
  if (existingFlow.version !== expectedVersion) {
    throw new ScriptFlowAiApiError(409, "Use case version changed; reload before modifying");
  }
  return deps.generateDraft({
    prompt,
    appId: existingFlow.appId,
    platform: existingFlow.platform,
    existingFlow,
    ...(externalContext ? { externalContext } : {}),
    ...(screenAssist ? { screenAssist } : {})
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ScriptFlowAiApiError(400, `${field} is required`);
  }
  return value.trim();
}

function requiredSourceYaml(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ScriptFlowAiApiError(400, "sourceYaml is required");
  }
  return value;
}

function screenAssistValue(value: unknown): ScriptFlowScreenAssistRequest | undefined {
  if (value === undefined) {
    return undefined;
  }
  const screenAssist = recordValue(value, "screenAssist", ["mode", "deviceSerial"]);
  const mode = requiredString(screenAssist.mode, "screenAssist.mode");
  if (mode !== "current") {
    throw new ScriptFlowAiApiError(400, "screenAssist.mode must be current");
  }
  return {
    mode: "current",
    deviceSerial: requiredString(screenAssist.deviceSerial, "screenAssist.deviceSerial")
  };
}

function externalContextValue(value: unknown): ScriptFlowExternalContextRequest | undefined {
  if (value === undefined) {
    return undefined;
  }
  const context = recordValue(value, "externalContext", ["source", "summary", "implementationStack", "relevantFiles", "candidateSteps", "constraints"]);
  const source = externalContextSource(requiredString(context.source, "externalContext.source"));
  const summary = requiredString(context.summary, "externalContext.summary");
  const implementationStack = optionalImplementationStack(context.implementationStack);
  return {
    source,
    summary,
    ...(implementationStack ? { implementationStack } : {}),
    ...optionalStringArrayField(context.relevantFiles, "externalContext.relevantFiles"),
    ...optionalStringArrayField(context.candidateSteps, "externalContext.candidateSteps"),
    ...optionalStringArrayField(context.constraints, "externalContext.constraints")
  };
}

function recordValue(value: unknown, field: string, allowedFields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScriptFlowAiApiError(400, `${field} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => !allowedFields.includes(key));
  if (unknown) {
    throw new ScriptFlowAiApiError(400, `Unknown ${field} field: ${unknown}`);
  }
  return record;
}

function externalContextSource(value: string): ScriptFlowExternalContextRequest["source"] {
  if (value === "code" || value === "directory" || value === "classin-code" || value === "manual") {
    return value;
  }
  throw new ScriptFlowAiApiError(400, "externalContext.source must be code, directory, classin-code, or manual");
}

function optionalImplementationStack(value: unknown): ScriptFlowExternalContextRequest["implementationStack"] | undefined {
  if (value === undefined) return undefined;
  if (
    value === "android-native"
    || value === "ios-native"
    || value === "harmony-native"
    || value === "flutter"
    || value === "compose"
    || value === "swiftui"
    || value === "arkui"
    || value === "unknown"
  ) {
    return value;
  }
  throw new ScriptFlowAiApiError(400, "externalContext.implementationStack is invalid");
}

function optionalStringArrayField(value: unknown, field: "externalContext.relevantFiles" | "externalContext.candidateSteps" | "externalContext.constraints"): Partial<ScriptFlowExternalContextRequest> {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ScriptFlowAiApiError(400, `${field} must be a string array`);
  }
  const array = value.map((item) => item.trim());
  if (field === "externalContext.relevantFiles") return { relevantFiles: array };
  if (field === "externalContext.candidateSteps") return { candidateSteps: array };
  return { constraints: array };
}

function platformValue(value: unknown): PageAssetPlatform {
  if (value === undefined) return CROSS_PLATFORM_SCRIPT_SCOPE;
  if (value === "android" || value === "ios" || value === "harmony" || value === "flutter") return value;
  if (value === CROSS_PLATFORM_SCRIPT_SCOPE) return value;
  throw new ScriptFlowAiApiError(400, "platform must be android, ios, harmony, flutter, or mobile");
}

function temporaryRepairFlow(input: {
  sourceYaml: string;
  document: ScriptFlowDocument;
  appId: string;
  platform: PageAssetPlatform;
  runId: string;
}): ScriptFlow {
  const now = new Date(0).toISOString();
  return {
    id: `repair:${input.runId}`,
    appId: input.appId,
    platform: input.platform,
    name: input.document.name,
    ...(input.document.description ? { description: input.document.description } : {}),
    sourceYaml: input.sourceYaml,
    parsed: input.document as unknown as Record<string, unknown>,
    status: "draft",
    version: 1,
    tags: input.document.tags,
    createdAt: now,
    updatedAt: now
  };
}

function repairExternalContext(input: {
  run: TestRun;
  failure: PublicExecutionFailure;
  callerContext?: ScriptFlowExternalContextRequest;
}): ScriptFlowExternalContextRequest {
  const caller = input.callerContext;
  return {
    source: caller?.source ?? "manual",
    ...(caller?.implementationStack ? { implementationStack: caller.implementationStack } : {}),
    ...(caller?.relevantFiles ? { relevantFiles: caller.relevantFiles } : {}),
    ...(caller?.candidateSteps ? { candidateSteps: caller.candidateSteps } : {}),
    summary: [caller?.summary, repairFailureSummary(input.run, input.failure)].filter(Boolean).join("\n"),
    constraints: uniqueStrings([
      ...(caller?.constraints ?? []),
      "只修复失败步骤，不改变原业务目标。",
      "禁止使用坐标、resourceId、accessibilityId 或平台私有 selector。",
      "优先使用跨平台目标：text、icon、visual、control、area、nearText、position。",
      "如果失败原因显示目标不唯一，应补充位置、附近文字或更稳定的页面约束。"
    ])
  };
}

function buildRepairPrompt(input: {
  instruction?: string;
  failure: PublicExecutionFailure;
  run: TestRun;
}): string {
  const failedStep = latestFailedStep(input.run);
  return [
    "修复当前 ScriptFlow v1 草稿，使它能继续稳定执行。",
    `失败类型：${input.failure.kind}`,
    `失败说明：${input.failure.message}`,
    failedStep ? `失败步骤：${failedStep.stepId}${failedStep.errorCode ? ` / ${failedStep.errorCode}` : ""}${failedStep.errorMessage ? ` / ${failedStep.errorMessage}` : ""}` : undefined,
    input.instruction ? `调用方要求：${input.instruction}` : undefined,
    "请返回完整修复后的 ScriptFlow v1 YAML。"
  ].filter(Boolean).join("\n");
}

function repairFailureSummary(run: TestRun, failure: PublicExecutionFailure): string {
  const failedStep = latestFailedStep(run);
  const details = failure.details?.map((detail) => `${detail.label}: ${detail.value}`).join("；");
  const artifacts = (run.artifacts ?? []).filter((artifact) => artifact.type === "screenshot" && !artifact.deletedAt).map((artifact) => artifact.url || artifact.name);
  return [
    `runId: ${run.id}`,
    `failureKind: ${failure.kind}`,
    `failureMessage: ${failure.message}`,
    failedStep ? `failedStep: ${failedStep.stepId}` : undefined,
    failedStep?.errorCode ? `errorCode: ${failedStep.errorCode}` : undefined,
    failedStep?.errorMessage ? `errorMessage: ${failedStep.errorMessage}` : undefined,
    details ? `details: ${details}` : undefined,
    artifacts.length ? `screenshots: ${artifacts.join(", ")}` : undefined
  ].filter(Boolean).join("\n");
}

function latestFailedStep(run: TestRun): TestRun["stepResults"][number] | undefined {
  return [...(run.stepResults ?? [])].reverse().find((step) => step.status === "failed" || step.status === "timeout");
}

function isRepairableFailure(kind: PublicExecutionFailureKind): boolean {
  return kind !== "app_failure" && kind !== "infrastructure_failure" && kind !== "left_target_app";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim()).map((value) => value.trim())));
}

function stripRepairSourceFlow(draft: ScriptFlowAiDraft): ScriptFlowAiDraft {
  if (!("sourceFlow" in draft)) return draft;
  const { sourceFlow: _sourceFlow, ...rest } = draft as ScriptFlowAiDraft & { sourceFlow?: unknown };
  return rest as ScriptFlowAiDraft;
}

function errorPayload(error: unknown): Record<string, unknown> {
  return {
    error: error instanceof Error ? error.message : String(error),
    ...(error instanceof ScriptFlowAiApiError ? error.payload : {})
  };
}

class ScriptFlowAiApiError extends Error {
  constructor(readonly status: number, message: string, readonly payload: Record<string, unknown> = {}) {
    super(message);
  }
}
