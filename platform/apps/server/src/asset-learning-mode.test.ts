import { describe, expect, it } from "vitest";
import {
  ASSET_LEARNING_MODE,
  shouldCollectAssetLearning,
  shouldPublishAssetLearning
} from "./asset-learning-mode.js";

describe("asset learning code mode", () => {
  it("keeps production learning disabled until the source constant is reviewed and changed", () => {
    expect(ASSET_LEARNING_MODE).toBe("disabled");
  });

  it("defines collection and publication boundaries for every internal mode", () => {
    expect(shouldCollectAssetLearning("disabled")).toBe(false);
    expect(shouldCollectAssetLearning("shadow")).toBe(true);
    expect(shouldCollectAssetLearning("active")).toBe(true);

    expect(shouldPublishAssetLearning("disabled")).toBe(false);
    expect(shouldPublishAssetLearning("shadow")).toBe(false);
    expect(shouldPublishAssetLearning("active")).toBe(true);
  });
});
