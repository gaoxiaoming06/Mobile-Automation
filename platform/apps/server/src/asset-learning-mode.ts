export type AssetLearningMode = "disabled" | "shadow" | "active";

// Keep this code-controlled until generation and execution pass the phase-one gate.
export const ASSET_LEARNING_MODE: AssetLearningMode = "disabled";

export function shouldCollectAssetLearning(mode: AssetLearningMode): boolean {
  return mode === "shadow" || mode === "active";
}

export function shouldPublishAssetLearning(mode: AssetLearningMode): boolean {
  return mode === "active";
}
