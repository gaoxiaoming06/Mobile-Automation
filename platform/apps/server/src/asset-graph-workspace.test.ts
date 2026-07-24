import { describe, expect, it } from "vitest";
import type { BusinessGraph, Observation } from "@mobile-automation/graph-core";
import {
  assertObservationMatchesGraphTargetApp,
  selectAssetGraphForTargetProfile,
  targetProfilesForGraph
} from "./asset-graph-workspace.js";

describe("asset graph workspace", () => {
  it("selects a product asset graph by matching the current Android profile", () => {
    const graphs = [
      graph({
        id: "graph-classin",
        appId: "classin",
        name: "ClassIn 产品资产库",
        platformScope: "mobile-both",
        targetApp: {
          productId: "classin",
          productName: "ClassIn",
          profiles: [
            {
              id: "classin-android-primary",
              platform: "android",
              displayName: "ClassIn Android",
              androidPackageName: "cn.eeo.classin",
              isPrimary: true
            },
            {
              id: "classin-ios-primary",
              platform: "ios",
              displayName: "ClassIn iOS",
              iosBundleId: "com.eeo.classin"
            }
          ]
        },
        activeVersionId: "classin-v1"
      })
    ];

    expect(selectAssetGraphForTargetProfile(graphs, { androidPackageName: "cn.eeo.classin" }, "android")?.id).toBe("graph-classin");
  });

  it("keeps legacy graph targetApp values as primary profiles", () => {
    const profiles = targetProfilesForGraph(
      graph({
        targetApp: { androidPackageName: "cn.eeo.classin" }
      })
    );

    expect(profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: "android",
          androidPackageName: "cn.eeo.classin",
          isPrimary: true
        })
      ])
    );
  });

  it("does not select an unrelated product graph for an unbound Android package", () => {
    const graphs = [
      graph({
        id: "graph-classin",
        targetApp: {
          productId: "classin",
          profiles: [{ id: "classin-android-primary", platform: "android", androidPackageName: "cn.eeo.classin" }]
        },
        activeVersionId: "classin-v1"
      })
    ];

    expect(selectAssetGraphForTargetProfile(graphs, { androidPackageName: "com.demo.notes" }, "android")).toBeUndefined();
  });

  it("rejects an observation captured from a different Android package", () => {
    expect(() =>
      assertObservationMatchesGraphTargetApp(
        graph({ targetApp: { androidPackageName: "cn.eeo.classin" } }),
        observation({ packageName: "com.demo.notes" })
      )
    ).toThrow("当前页面属于 com.demo.notes，不属于资产库 cn.eeo.classin");
  });
});

function graph(overrides: Partial<BusinessGraph> = {}): BusinessGraph {
  return {
    id: "graph-1",
    appId: "classin",
    targetApp: undefined,
    platformScope: "android",
    name: "ClassIn 产品资产库",
    status: "active",
    activeVersionId: "version-1",
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides
  };
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "obs-1",
    platform: "android",
    packageName: "cn.eeo.classin",
    activityName: ".MainActivity",
    capturedAt: "2026-07-24T00:00:00.000Z",
    uiElements: [],
    ocrTexts: [],
    ...overrides
  };
}
