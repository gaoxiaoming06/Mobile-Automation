import type express from "express";
import type { ScriptFlow } from "@mobile-automation/shared";
import type { PageAssetPlatform } from "./page-asset-catalog.js";
import type { ScriptFlowAiDraft } from "./script-flow-ai-planner.js";

export type ScriptFlowAiDraftGenerator = (input: {
  prompt: string;
  appId: string;
  platform: PageAssetPlatform;
  existingFlow?: ScriptFlow;
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
      const draft = flowId
        ? await generateRevisionDraft(deps, flowId, body.expectedVersion, prompt)
        : await deps.generateDraft({
            prompt,
            appId: requiredString(body.appId, "appId"),
            platform: platformValue(body.platform)
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
  const unknown = Object.keys(body).find((key) => !["prompt", "appId", "platform", "flowId", "expectedVersion"].includes(key));
  if (unknown) throw new ScriptFlowAiApiError(400, `Unknown request field: ${unknown}`);
  return body;
}

async function generateRevisionDraft(
  deps: { generateDraft: ScriptFlowAiDraftGenerator; getFlow: (id: string) => ScriptFlow | undefined },
  flowId: string,
  expectedVersion: unknown,
  prompt: string
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
    existingFlow
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

function platformValue(value: unknown): PageAssetPlatform {
  if (value === "android" || value === "ios" || value === "harmony" || value === "flutter") return value;
  throw new ScriptFlowAiApiError(400, "platform must be android, ios, harmony, or flutter");
}

class ScriptFlowAiApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
