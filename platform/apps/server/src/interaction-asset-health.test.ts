import { describe, expect, it } from "vitest";
import {
  classifyInteractionAssetStepOutcome,
  nextInteractionAssetHealth,
  type InteractionAssetHealth
} from "./interaction-asset-health.js";

describe("interaction asset health", () => {
  const activeHealth: InteractionAssetHealth = {
    status: "active",
    consecutiveLocatorFailures: 0,
    successfulRunCount: 0
  };

  it("degrades an asset only after three consecutive locator failures", () => {
    const once = nextInteractionAssetHealth(activeHealth, "locator_failed");
    const twice = nextInteractionAssetHealth(once, "locator_failed");
    const third = nextInteractionAssetHealth(twice, "locator_failed");

    expect(once).toMatchObject({ status: "active", consecutiveLocatorFailures: 1 });
    expect(twice).toMatchObject({ status: "active", consecutiveLocatorFailures: 2 });
    expect(third).toMatchObject({ status: "degraded", consecutiveLocatorFailures: 3 });
  });

  it("resets consecutive failures after a successful use", () => {
    expect(nextInteractionAssetHealth({
      ...activeHealth,
      consecutiveLocatorFailures: 2
    }, "passed")).toEqual({
      status: "active",
      consecutiveLocatorFailures: 0,
      successfulRunCount: 1
    });
  });

  it("ignores ANR, business assertions, and unrelated execution failures", () => {
    expect(nextInteractionAssetHealth({
      ...activeHealth,
      consecutiveLocatorFailures: 2
    }, "ignored_failure")).toEqual({
      status: "active",
      consecutiveLocatorFailures: 2,
      successfulRunCount: 0
    });
  });

  it("recognizes target lookup failures without treating assertions as locator failures", () => {
    expect(classifyInteractionAssetStepOutcome({
      status: "failed",
      errorCode: "SEMANTIC_TARGET_NOT_FOUND",
      errorMessage: "Element target was not found"
    })).toBe("locator_failed");
    expect(classifyInteractionAssetStepOutcome({
      status: "failed",
      errorCode: "ACTION_FAILED",
      errorMessage: "OCR target '添加好友' was not found on the current screen"
    })).toBe("locator_failed");
    expect(classifyInteractionAssetStepOutcome({
      status: "failed",
      errorCode: "EXPECTATION_FAILED",
      errorMessage: "Expected the report page"
    })).toBe("ignored_failure");
    expect(classifyInteractionAssetStepOutcome({
      status: "failed",
      errorCode: "ANDROID_APP_MONITOR_ANR",
      errorMessage: "ANR detected"
    })).toBe("ignored_failure");
  });
});
