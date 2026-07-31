export type InteractionAssetHealthStatus = "active" | "degraded";

export type InteractionAssetHealth = {
  status: InteractionAssetHealthStatus;
  consecutiveLocatorFailures: number;
  successfulRunCount: number;
};

export type InteractionAssetStepOutcome = "passed" | "locator_failed" | "ignored_failure";

const LOCATOR_FAILURE_CODE = /(?:TARGET|ELEMENT|TEXT|IMAGE|ICON|CONTROL|LOCATOR).*NOT_FOUND|NOT_FOUND.*(?:TARGET|ELEMENT|TEXT|IMAGE|ICON|CONTROL|LOCATOR)/i;
const LOCATOR_FAILURE_MESSAGE = /(?:target|element|text|image|icon|control|locator|ocr).{0,80}(?:not found|cannot find|could not find|未找到|找不到|无法定位)|(?:not found|cannot find|could not find|未找到|找不到|无法定位).{0,80}(?:target|element|text|image|icon|control|locator|ocr)/i;

export function classifyInteractionAssetStepOutcome(input: {
  status: string;
  errorCode?: string;
  errorMessage?: string;
}): InteractionAssetStepOutcome {
  if (input.status === "passed") return "passed";
  const errorCode = input.errorCode?.trim() ?? "";
  const errorMessage = input.errorMessage?.trim() ?? "";
  if (LOCATOR_FAILURE_CODE.test(errorCode) || LOCATOR_FAILURE_MESSAGE.test(errorMessage)) {
    return "locator_failed";
  }
  return "ignored_failure";
}

export function nextInteractionAssetHealth(
  current: InteractionAssetHealth,
  outcome: InteractionAssetStepOutcome,
  degradationThreshold = 3
): InteractionAssetHealth {
  if (outcome === "passed") {
    return {
      status: current.status,
      consecutiveLocatorFailures: 0,
      successfulRunCount: current.successfulRunCount + 1
    };
  }
  if (outcome === "ignored_failure") return current;
  const consecutiveLocatorFailures = current.consecutiveLocatorFailures + 1;
  return {
    ...current,
    status: consecutiveLocatorFailures >= degradationThreshold ? "degraded" : current.status,
    consecutiveLocatorFailures
  };
}
