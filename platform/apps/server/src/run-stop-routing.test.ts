import { describe, expect, it } from "vitest";
import { orderedRunStopTargets } from "./run-stop-routing.js";

describe("run stop routing", () => {
  it("routes stability exploration stops to the stability explorer first", () => {
    expect(orderedRunStopTargets("stability_exploration")).toEqual(["stability"]);
  });

  it("routes asset patrol stops to the asset patrol runner first", () => {
    expect(orderedRunStopTargets("asset_patrol")).toEqual(["asset_patrol"]);
  });

  it("routes normal case stops to the legacy case runner", () => {
    expect(orderedRunStopTargets("case")).toEqual(["case"]);
  });

  it("tries every runner when the persisted run kind is missing", () => {
    expect(orderedRunStopTargets(undefined)).toEqual(["graph", "asset_patrol", "stability", "flow", "case"]);
  });
});
