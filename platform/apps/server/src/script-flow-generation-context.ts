export type ScriptFlowGenerationMode = "strict" | "knowledge_enhanced" | "asset_enhanced";

export type ScriptFlowGenerationContextPolicy = {
  mode: ScriptFlowGenerationMode;
  useCurrentScreen: boolean;
  useCaseKnowledge?: boolean;
  /** @deprecated Use useCaseKnowledge. Kept only so existing callers can be migrated. */
  useAssetsForGeneration?: boolean;
  /** @deprecated Use useCaseKnowledge. */
  useHistoryScriptsForGeneration?: boolean;
};

export const DEFAULT_SCRIPT_FLOW_GENERATION_CONTEXT: ScriptFlowGenerationContextPolicy = {
  mode: "strict",
  useCurrentScreen: false,
  useCaseKnowledge: false
};

export function normalizeScriptFlowGenerationContext(
  value: Partial<ScriptFlowGenerationContextPolicy> | undefined,
  options: { hasScreenAssist?: boolean } = {}
): ScriptFlowGenerationContextPolicy {
  const useCurrentScreen = options.hasScreenAssist === true;
  if (!value || (value.mode !== "knowledge_enhanced" && value.mode !== "asset_enhanced")) {
    return {
      ...DEFAULT_SCRIPT_FLOW_GENERATION_CONTEXT,
      useCurrentScreen
    };
  }
  return {
    mode: "knowledge_enhanced",
    useCurrentScreen,
    useCaseKnowledge: value.useCaseKnowledge === true || value.useHistoryScriptsForGeneration === true,
    ...(value.useAssetsForGeneration !== undefined ? { useAssetsForGeneration: value.useAssetsForGeneration } : {}),
    ...(value.useHistoryScriptsForGeneration !== undefined
      ? { useHistoryScriptsForGeneration: value.useHistoryScriptsForGeneration }
      : {})
  };
}
