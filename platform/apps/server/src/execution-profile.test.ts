import { describe, expect, it } from "vitest";
import type { BusinessGraph, BusinessGraphVersion, BusinessNode, Observation } from "@mobile-automation/graph-core";
import { StoragePageAssetCatalog } from "./page-asset-catalog.js";
import {
  createPageAssetExecutionProfileProvider,
  type ExecutionProfileSnapshot
} from "./execution-profile.js";
import { DefaultPageStateService } from "./page-state-service.js";

describe("execution profiles", () => {
  it("materializes a platform-specific profile from page evidence without changing the cross-platform script", () => {
    const provider = createPageAssetExecutionProfileProvider(
      new StoragePageAssetCatalog(new MemoryCatalogStorage(graph([
        page("home", "classin.teacher.classes", "班级列表", [
          matcher("package", "cn.eeo.classin", 4),
          matcher("activity", "TeacherHomeActivity", 4),
          matcher("resource_id", "cn.eeo.classin:id/class_list", 3),
          matcher("accessibility_id", "班级列表", 2)
        ])
      ])))
    );

    const profile = provider.createSnapshot("cn.eeo.classin", "android");

    expect(profile).toEqual(expect.objectContaining({
      appId: "cn.eeo.classin",
      platform: "android",
      status: "verified",
      version: 1,
      digest: expect.stringMatching(/^[a-f0-9]{64}$/)
    }));
    expect(profile.screens).toEqual([
      expect.objectContaining({
        screenRef: "classin.teacher.classes",
        evidence: expect.arrayContaining([
          expect.objectContaining({ type: "resource_id", value: "cn.eeo.classin:id/class_list" }),
          expect.objectContaining({ type: "accessibility_id", value: "班级列表" })
        ])
      })
    ]);
  });

  it("verifies a frozen screen contract with UI tree evidence when OCR misses the page title", async () => {
    const profile: ExecutionProfileSnapshot = {
      id: "profile:classin:android",
      appId: "cn.eeo.classin",
      platform: "android",
      version: 1,
      status: "verified",
      digest: "profile-digest",
      createdAt: "2026-08-15T00:00:00.000Z",
      screens: [{
        screenRef: "classin.teacher.classes",
        name: "班级列表",
        assetId: "page-home",
        graphVersionId: "graph-v1",
        evidence: [
          matcher("package", "cn.eeo.classin", 4),
          matcher("resource_id", "cn.eeo.classin:id/class_list", 4),
          matcher("accessibility_id", "班级列表", 3),
          matcher("ocr_text", "主页", 1)
        ]
      }]
    };
    const collector = new QueueObservationCollector([{
      platform: "android",
      capturedAt: "2026-08-15T00:00:00.000Z",
      packageName: "cn.eeo.classin",
      uiElements: [{
        resourceId: "cn.eeo.classin:id/class_list",
        accessibilityId: "班级列表",
        visible: true
      }],
      ocrTexts: [{ text: "页", confidence: 0.21 }],
      screenshot: { width: 1080, height: 2400, sizeBytes: 10 },
      raw: { screenshotBase64: "cG5n" }
    }]);
    const service = new DefaultPageStateService(collector);

    const result = await service.verifyExpectedScreen({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android",
      screenRef: "classin.teacher.classes",
      executionProfile: profile
    });

    expect(result.status).toBe("matched");
    expect(result.screen?.screenRef).toBe("classin.teacher.classes");
    expect(collector.options).toEqual([
      { includeScreenshot: true, includeOcr: true, includeUiTree: true }
    ]);
  });

  it("does not consult a mutable page catalog after the profile snapshot is created", async () => {
    const storage = new MemoryCatalogStorage(graph([
      page("home", "classin.teacher.classes", "班级列表", [
        matcher("package", "cn.eeo.classin", 4),
        matcher("resource_id", "cn.eeo.classin:id/class_list", 4)
      ])
    ]));
    const catalog = new StoragePageAssetCatalog(storage);
    const provider = createPageAssetExecutionProfileProvider(catalog);
    const profile = provider.createSnapshot("cn.eeo.classin", "android");
    storage.graphVersion = graph([
      page("settings", "classin.teacher.settings", "设置", [
        matcher("package", "cn.eeo.classin", 4),
        matcher("resource_id", "cn.eeo.classin:id/settings", 4)
      ])
    ]).versions[0]!;

    const service = new DefaultPageStateService(new QueueObservationCollector([{
      platform: "android",
      capturedAt: "2026-08-15T00:00:00.000Z",
      packageName: "cn.eeo.classin",
      uiElements: [{ resourceId: "cn.eeo.classin:id/class_list", visible: true }],
      ocrTexts: [],
      screenshot: { width: 1080, height: 2400, sizeBytes: 10 },
      raw: { screenshotBase64: "cG5n" }
    }]));

    const result = await service.verifyExpectedScreen({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android",
      screenRef: "classin.teacher.classes",
      executionProfile: profile
    });

    expect(result.status).toBe("matched");
  });
});

function matcher(
  type: "package" | "activity" | "resource_id" | "accessibility_id" | "ocr_text",
  value: string,
  weight: number
) {
  return {
    id: `${type}-${value}`,
    type,
    value,
    weight
  } as const;
}

function page(id: string, key: string, name: string, matchers: BusinessNode["matchers"]): BusinessNode {
  return {
    id,
    graphVersionId: "graph-v1",
    key,
    name,
    nodeType: "page",
    tags: ["page-asset"],
    status: "active",
    matchers,
    defaultExpectations: [],
    metadata: { assetRecordingConfirmed: true }
  };
}

function graph(nodes: BusinessNode[]): BusinessGraph & { versions: BusinessGraphVersion[] } {
  return {
    id: "graph-classin",
    appId: "cn.eeo.classin",
    platformScope: "mobile-both",
    name: "ClassIn",
    status: "active",
    activeVersionId: "graph-v1",
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    versions: [{
      id: "graph-v1",
      graphId: "graph-classin",
      version: 1,
      sourceSummary: ["test"],
      status: "active",
      nodes,
      createdAt: "2026-08-15T00:00:00.000Z"
    }]
  };
}

class MemoryCatalogStorage {
  graphVersion: BusinessGraphVersion;

  constructor(private readonly graphValue: BusinessGraph & { versions: BusinessGraphVersion[] }) {
    this.graphVersion = graphValue.versions[0]!;
  }

  listBusinessGraphs(): BusinessGraph[] {
    return [this.graphValue];
  }

  findBusinessGraphByAppId(appId: string): BusinessGraph | undefined {
    return this.graphValue.appId === appId ? this.graphValue : undefined;
  }

  getActiveBusinessGraphVersion(_graphId: string): BusinessGraphVersion | undefined {
    return this.graphVersion;
  }
}

class QueueObservationCollector {
  readonly options: Array<{ includeScreenshot?: boolean; includeOcr?: boolean; includeUiTree?: boolean }> = [];

  constructor(private readonly observations: Observation[]) {}

  async collect(_serial: string, options: { includeScreenshot?: boolean; includeOcr?: boolean; includeUiTree?: boolean }): Promise<Observation> {
    this.options.push(options);
    return this.observations.shift()!;
  }
}
