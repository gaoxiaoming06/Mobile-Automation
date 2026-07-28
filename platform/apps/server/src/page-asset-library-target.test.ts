import { describe, expect, it } from "vitest";
import type { BusinessGraph, Observation } from "@mobile-automation/graph-core";
import {
  isObservationInPageAssetLibrary,
  pageAssetLibraryTargetMismatchMessage
} from "./page-asset-library-target.js";

describe("page asset library target", () => {
  const library: Pick<BusinessGraph, "targetApp"> = {
    targetApp: {
      productId: "classin",
      profiles: [{ id: "classin-android", platform: "android", androidPackageName: "cn.eeo.classin" }]
    }
  };

  it("accepts observations from the configured app profile", () => {
    expect(isObservationInPageAssetLibrary(observation(), library.targetApp)).toBe(true);
  });

  it("rejects observations from another app", () => {
    const otherApp = observation({ packageName: "com.demo.notes" });
    expect(isObservationInPageAssetLibrary(otherApp, library.targetApp)).toBe(false);
    expect(pageAssetLibraryTargetMismatchMessage(library, otherApp)).toBe(
      "当前页面属于 com.demo.notes，不属于页面资产库 cn.eeo.classin"
    );
  });
});

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "obs-1",
    platform: "android",
    packageName: "cn.eeo.classin",
    activityName: ".MainActivity",
    capturedAt: "2026-07-28T00:00:00.000Z",
    uiElements: [],
    ocrTexts: [],
    ...overrides
  };
}
