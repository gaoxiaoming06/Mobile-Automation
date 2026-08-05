import type express from "express";
import { CROSS_PLATFORM_SCRIPT_SCOPE, type ScriptFlow } from "@mobile-automation/shared";
import type { PageAssetPlatform } from "./page-asset-catalog.js";
import type { ScriptFlowAiDraft } from "./script-flow-ai-planner.js";
import { normalizeTargetAppId } from "./target-app-runtime.js";

export type ScriptFlowScreenAssistRequest = {
  mode: "current";
  deviceSerial: string;
};

export type ScriptFlowAiDraftGenerator = (input: {
  prompt: string;
  appId: string;
  platform: PageAssetPlatform;
  existingFlow?: ScriptFlow;
  screenAssist?: ScriptFlowScreenAssistRequest;
}) => Promise<ScriptFlowAiDraft>;

export function registerScriptFlowAiRoutes(
  app: express.Application,
  deps: { generateDraft: ScriptFlowAiDraftGenerator; getFlow: (id: string) => ScriptFlow | undefined }
): void {
  app.post("/api/script-flow-drafts/generate", async (req, res) => {
    try {
      const body = strictBody(req.body);
      const prompt = requiredString(body.prompt, "prompt");
      const flowId = optionalString(body.flowId);
      const screenAssist = screenAssistValue(body.screenAssist);
      const draft = flowId
        ? await generateRevisionDraft(deps, flowId, body.expectedVersion, prompt, screenAssist)
        : await deps.generateDraft({
            prompt,
            appId: normalizeTargetAppId(requiredString(body.appId, "appId")),
            platform: platformValue(body.platform),
            ...(screenAssist ? { screenAssist } : {})
          });
      res.json({ draft });
    } catch (error) {
      const status = error instanceof ScriptFlowAiApiError ? error.status : 422;
      res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function strictBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScriptFlowAiApiError(400, "Request body must be an object");
  }
  const body = value as Record<string, unknown>;
  const unknown = Object.keys(body).find((key) => !["prompt", "appId", "platform", "flowId", "expectedVersion", "screenAssist"].includes(key));
  if (unknown) throw new ScriptFlowAiApiError(400, `Unknown request field: ${unknown}`);
  return body;
}

async function generateRevisionDraft(
  deps: { generateDraft: ScriptFlowAiDraftGenerator; getFlow: (id: string) => ScriptFlow | undefined },
  flowId: string,
  expectedVersion: unknown,
  prompt: string,
  screenAssist: ScriptFlowScreenAssistRequest | undefined
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

function screenAssistValue(value: unknown): ScriptFlowScreenAssistRequest | undefined {
  if (value === undefined) {
    return undefined;
  }
  const screenAssist = recordValue(value, "screenAssist");
  const mode = requiredString(screenAssist.mode, "screenAssist.mode");
  if (mode !== "current") {
    throw new ScriptFlowAiApiError(400, "screenAssist.mode must be current");
  }
  return {
    mode: "current",
    deviceSerial: requiredString(screenAssist.deviceSerial, "screenAssist.deviceSerial")
  };
}

function recordValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScriptFlowAiApiError(400, `${field} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => !["mode", "deviceSerial"].includes(key));
  if (unknown) {
    throw new ScriptFlowAiApiError(400, `Unknown ${field} field: ${unknown}`);
  }
  return record;
}

function platformValue(value: unknown): PageAssetPlatform {
  if (value === undefined) return CROSS_PLATFORM_SCRIPT_SCOPE;
  if (value === "android" || value === "ios" || value === "harmony" || value === "flutter") return value;
  if (value === CROSS_PLATFORM_SCRIPT_SCOPE) return value;
  throw new ScriptFlowAiApiError(400, "platform must be android, ios, harmony, flutter, or mobile");
}

class ScriptFlowAiApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
