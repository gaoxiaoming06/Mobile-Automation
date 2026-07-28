import type express from "express";
import type { PageAssetPlatform } from "./page-asset-catalog.js";
import type { ScriptFlowAiDraft } from "./script-flow-ai-planner.js";

export type ScriptFlowAiDraftGenerator = (input: {
  prompt: string;
  appId: string;
  platform: PageAssetPlatform;
}) => Promise<ScriptFlowAiDraft>;

export function registerScriptFlowAiRoutes(
  app: express.Application,
  deps: { generateDraft: ScriptFlowAiDraftGenerator }
): void {
  app.post("/api/script-flow-drafts/generate", async (req, res) => {
    try {
      const body = strictBody(req.body);
      const draft = await deps.generateDraft({
        prompt: requiredString(body.prompt, "prompt"),
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
  const unknown = Object.keys(body).find((key) => !["prompt", "appId", "platform"].includes(key));
  if (unknown) throw new ScriptFlowAiApiError(400, `Unknown request field: ${unknown}`);
  return body;
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
