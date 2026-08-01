export type ScriptFlowAiTimingContext = {
  requestId: string;
  promptPreview: string;
};

export function createScriptFlowAiTimingContext(prompt: string): ScriptFlowAiTimingContext {
  return {
    requestId: `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    promptPreview: prompt.replace(/\s+/g, " ").trim().slice(0, 80)
  };
}

export async function timedScriptFlowAiStage<T>(
  context: ScriptFlowAiTimingContext | undefined,
  stage: string,
  fn: () => Promise<T>,
  details: Record<string, unknown> = {}
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    logScriptFlowAiTiming(context, stage, Date.now() - startedAt, { ...details, status: "ok" });
    return result;
  } catch (error) {
    logScriptFlowAiTiming(context, stage, Date.now() - startedAt, {
      ...details,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export function logScriptFlowAiTiming(
  context: ScriptFlowAiTimingContext | undefined,
  stage: string,
  durationMs: number,
  details: Record<string, unknown> = {}
): void {
  if (!shouldLogScriptFlowAiTiming()) return;
  const requestId = context?.requestId ?? "unknown";
  const payload = {
    requestId,
    stage,
    durationMs,
    ...(context?.promptPreview ? { prompt: context.promptPreview } : {}),
    ...details
  };
  console.info(`[script-flow-ai-timing] ${JSON.stringify(payload)}`);
}

function shouldLogScriptFlowAiTiming(): boolean {
  return process.env.NODE_ENV !== "test" && process.env.SCRIPT_FLOW_AI_TIMING !== "0";
}
