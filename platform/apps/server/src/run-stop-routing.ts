import type { RunConfig } from "@mobile-automation/shared";

export type RunStopTarget = "case" | "flow" | "graph" | "stability" | "asset_patrol";

export function orderedRunStopTargets(runKind: RunConfig["runKind"] | undefined): RunStopTarget[] {
  if (runKind === "asset_patrol") {
    return ["asset_patrol"];
  }
  if (runKind === "stability_exploration") {
    return ["stability"];
  }
  if (runKind === "business_graph") {
    return ["graph"];
  }
  if (runKind === "structured_flow") {
    return ["flow"];
  }
  if (runKind === "case") {
    return ["case"];
  }
  return ["graph", "asset_patrol", "stability", "flow", "case"];
}
