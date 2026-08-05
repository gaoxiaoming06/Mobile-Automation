import { describe, expect, it } from "vitest";
import type { BusinessGraph, BusinessGraphVersion, BusinessNode, Observation, StateMatcher } from "@mobile-automation/graph-core";
import { StoragePageAssetCatalog } from "./page-asset-catalog.js";
import { DefaultPageStateService } from "./page-state-service.js";

describe("DefaultPageStateService", () => {
  it("collects screenshot and OCR without UI tree, then verifies the expected page", async () => {
    const collector = new QueueObservationCollector([observation("主页")]);
    const service = serviceFor([page("home", "classin.home", "主页")], collector);

    const result = await service.verifyExpectedPage({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android",
      pageId: "home"
    });

    expect(result.status).toBe("matched");
    expect(result.page?.id).toBe("home");
    expect(collector.options).toEqual([{ includeScreenshot: true, includeOcr: true, includeUiTree: false }]);
  });

  it("verifies a page referenced by its stable key", async () => {
    const collector = new QueueObservationCollector([observation("主页")]);
    const service = serviceFor([page("node-home", "classin.home", "主页")], collector);

    const result = await service.verifyExpectedPage({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android",
      pageId: "classin.home"
    });

    expect(result.status).toBe("matched");
    expect(result.page?.id).toBe("node-home");
  });

  it("returns multiple_candidates when the target shares all stable evidence with another page", async () => {
    const home = page("home", "classin.home", "主页", "全部班级");
    const duplicate = page("home-copy", "classin.home.copy", "主页副本", "全部班级");
    const service = serviceFor([home, duplicate], new QueueObservationCollector([observation("全部班级")]));

    const result = await service.verifyExpectedPage({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android",
      pageId: "home"
    });

    expect(result.status).toBe("multiple_candidates");
    expect(result.candidates.map((item) => item.id)).toEqual(expect.arrayContaining(["home", "home-copy"]));
  });

  it("does not confirm a page when every matched identity signal is shared with a more specific page", async () => {
    const teachingPlan = page("teaching-plan", "classin.teaching.plan", "教学方案", ["教学方案"]);
    const classDetail = page("class-detail", "classin.class.detail", "班级详情", ["教学方案", "班级详情"]);
    const service = serviceFor(
      [teachingPlan, classDetail],
      new QueueObservationCollector([observation("教学方案")])
    );

    const result = await service.verifyExpectedPage({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android",
      pageId: "teaching-plan"
    });

    expect(result.status).toBe("multiple_candidates");
    expect(result.reason).toBe("ambiguous_evidence");
    expect(result.candidates.map((item) => item.id)).toEqual(expect.arrayContaining(["teaching-plan", "class-detail"]));
  });

  it("returns unknown instead of accepting a changed dynamic identity value", async () => {
    const service = serviceFor(
      [page("class-detail", "classin.class.detail", "班级详情", ["班级详情", "班级四十二号"])],
      new QueueObservationCollector([observation("班级详情 班级四十三号")])
    );

    const result = await service.identifyCurrentPage({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android"
    });

    expect(result.status).toBe("unknown");
  });

  it("keeps the page ambiguous when a half-screen surface exposes two page identities", async () => {
    const service = serviceFor(
      [
        page("home", "classin.home", "主页"),
        page("permission-sheet", "classin.permission.sheet", "权限申请")
      ],
      new QueueObservationCollector([observation("主页 权限申请")])
    );

    const result = await service.identifyCurrentPage({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android"
    });

    expect(result.status).toBe("multiple_candidates");
    expect(result.candidates.map((item) => item.id)).toEqual(expect.arrayContaining(["home", "permission-sheet"]));
  });

  it("does not scan unrelated pages while verifying a known target", async () => {
    const home = page("home", "classin.home", "主页");
    const settings = page("settings", "classin.settings", "设置");
    const service = serviceFor([home, settings], new QueueObservationCollector([observation("设置")]));

    const result = await service.verifyExpectedPage({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android",
      pageId: "home"
    });

    expect(result.status).toBe("unknown");
    expect(result.candidates.map((item) => item.id)).not.toContain("settings");
  });

  it("does not compare platform-specific pages from another platform", async () => {
    const home = page("home", "classin.home", "主页", "全部班级");
    const iosDuplicate = {
      ...page("ios-home", "classin.ios.home", "iOS 主页", "全部班级"),
      platformScope: "ios" as const
    };
    const service = serviceFor([home, iosDuplicate], new QueueObservationCollector([observation("全部班级")]));

    const result = await service.verifyExpectedPage({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android",
      pageId: "home"
    });

    expect(result.status).toBe("matched");
    expect(result.candidates.map((item) => item.id)).not.toContain("ios-home");
  });

  it("scans all confirmed pages only during explicit current-page identification", async () => {
    const home = page("home", "classin.home", "主页");
    const settings = page("settings", "classin.settings", "设置");
    const service = serviceFor([home, settings], new QueueObservationCollector([observation("设置")]));

    const result = await service.identifyCurrentPage({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android"
    });

    expect(result.status).toBe("matched");
    expect(result.page?.id).toBe("settings");
  });

  it("distinguishes an app-outside state from an unknown in-app page", async () => {
    const service = serviceFor(
      [page("home", "classin.home", "主页")],
      new QueueObservationCollector([observation("系统桌面", "com.android.launcher")])
    );

    const result = await service.identifyCurrentPage({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android"
    });

    expect(result.status).toBe("outside_app");
    expect(result.actualAppId).toBe("com.android.launcher");
  });

  it("treats configured HarmonyOS ClassIn bundle as inside the ClassIn app", async () => {
    const login = {
      ...page("login", "classin.login", "登录"),
      platformScope: "harmony" as const,
      matchers: [matcher("bundle_id", "com.eeo.classin.harmony"), matcher("ocr_text", "登录")]
    };
    const service = serviceFor(
      [login],
      new QueueObservationCollector([harmonyObservation("登录", "com.eeo.classin.harmony")]),
      "classin",
      { CLASSIN_HARMONY_BUNDLE_ID: "com.eeo.classin.harmony" }
    );

    const result = await service.verifyExpectedPage({
      serial: "HARMONY",
      appId: "classin",
      platform: "harmony",
      pageId: "login"
    });

    expect(result.status).toBe("matched");
  });

  it("treats the default Android ClassIn package as inside the product-level ClassIn app", async () => {
    const service = serviceFor(
      [page("home", "classin.home", "主页")],
      new QueueObservationCollector([observation("主页", "cn.eeo.classin")]),
      "classin"
    );

    const result = await service.verifyExpectedPage({
      serial: "device-1",
      appId: "classin",
      platform: "android",
      pageId: "home"
    });

    expect(result.status).toBe("matched");
  });

  it("returns capture_failed for observation or screenshot failures", async () => {
    const failed = serviceFor([page("home", "classin.home", "主页")], new ThrowingObservationCollector());
    const missingScreenshot = serviceFor(
      [page("home", "classin.home", "主页")],
      new QueueObservationCollector([{ ...observation("主页"), screenshot: undefined, raw: {} }])
    );

    await expect(failed.identifyCurrentPage({ serial: "device-1", appId: "cn.eeo.classin", platform: "android" }))
      .resolves.toEqual(expect.objectContaining({ status: "capture_failed", reason: "observation_failed" }));
    await expect(missingScreenshot.identifyCurrentPage({ serial: "device-1", appId: "cn.eeo.classin", platform: "android" }))
      .resolves.toEqual(expect.objectContaining({ status: "capture_failed", reason: "screenshot_missing" }));
  });

  it("waits until the expected page is stable", async () => {
    const collector = new QueueObservationCollector([observation("加载中"), observation("主页")]);
    const service = serviceFor([page("home", "classin.home", "主页")], collector);

    const result = await service.waitForExpectedPage({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android",
      pageId: "home",
      timeoutMs: 100,
      intervalMs: 0
    });

    expect(result.status).toBe("matched");
    expect(collector.calls).toBe(2);
  });
});

function serviceFor(
  nodes: BusinessNode[],
  collector: QueueObservationCollector | ThrowingObservationCollector,
  appId = "cn.eeo.classin",
  env?: { CLASSIN_HARMONY_BUNDLE_ID?: string }
): DefaultPageStateService {
  const storage = new MemoryCatalogStorage(graph(nodes), appId);
  return new DefaultPageStateService(new StoragePageAssetCatalog(storage), collector, undefined, env);
}

class QueueObservationCollector {
  calls = 0;
  options: Array<{ includeScreenshot?: boolean; includeOcr?: boolean; includeUiTree?: boolean }> = [];

  constructor(private readonly observations: Observation[]) {}

  async collect(_serial: string, options: { includeScreenshot?: boolean; includeOcr?: boolean; includeUiTree?: boolean }): Promise<Observation> {
    this.options.push(options);
    const observation = this.observations[Math.min(this.calls, this.observations.length - 1)];
    this.calls += 1;
    return observation;
  }
}

class ThrowingObservationCollector {
  async collect(): Promise<Observation> {
    throw new Error("OCR unavailable");
  }
}

class MemoryCatalogStorage {
  private readonly businessGraph: BusinessGraph;

  constructor(private readonly version: BusinessGraphVersion, appId = "cn.eeo.classin") {
    this.businessGraph = {
      id: "graph",
      appId,
      platformScope: "mobile-both",
      name: "ClassIn",
      status: "active",
      activeVersionId: "version",
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z"
    };
  }

  listBusinessGraphs(): BusinessGraph[] {
    return [this.businessGraph];
  }

  findBusinessGraphByAppId(appId: string): BusinessGraph | undefined {
    return appId === this.businessGraph.appId ? this.businessGraph : undefined;
  }

  getActiveBusinessGraphVersion(graphId: string): BusinessGraphVersion | undefined {
    return graphId === this.businessGraph.id ? this.version : undefined;
  }
}

function graph(nodes: BusinessNode[]): BusinessGraphVersion {
  return {
    id: "version",
    graphId: "graph",
    version: 1,
    sourceSummary: [],
    status: "active",
    nodes,
    createdAt: "2026-07-28T00:00:00.000Z"
  };
}

function page(id: string, key: string, name: string, evidence: string | string[] = name): BusinessNode {
  const evidenceValues = Array.isArray(evidence) ? evidence : [evidence];
  return {
    id,
    graphVersionId: "version",
    key,
    name,
    nodeType: "page",
    tags: ["page-asset"],
    status: "active",
    matchers: [matcher("package", "cn.eeo.classin"), ...evidenceValues.map((value) => matcher("ocr_text", value))],
    defaultExpectations: [],
    platformScope: "mobile-both",
    metadata: { assetRecordingConfirmed: true }
  };
}

function matcher(type: StateMatcher["type"], value: string): StateMatcher {
  return {
    id: `${type}:${value}`,
    type,
    value,
    weight: type === "package" ? 1 : 3,
    critical: type !== "package",
    platformScope: "mobile-both",
    ...(type === "ocr_text" ? { region: { x: 5, y: 5, width: 80, height: 20 } } : {})
  };
}

function observation(text: string, packageName = "cn.eeo.classin"): Observation {
  return {
    id: `observation:${text}`,
    deviceSerial: "device-1",
    platform: "android",
    capturedAt: "2026-07-28T00:00:00.000Z",
    packageName,
    resolution: { width: 1080, height: 2400 },
    screenshot: { sizeBytes: 4, width: 1080, height: 2400 },
    uiElements: [],
    ocrTexts: [{ text, source: "ocr", region: { x: 50, y: 50, width: 500, height: 120 } }],
    events: [],
    raw: { screenshotBase64: Buffer.from("fake").toString("base64") }
  };
}

function harmonyObservation(text: string, bundleId: string): Observation {
  return {
    id: `observation:${text}`,
    deviceSerial: "HARMONY",
    platform: "harmony",
    capturedAt: "2026-08-04T00:00:00.000Z",
    bundleId,
    resolution: { width: 1080, height: 2400 },
    screenshot: { sizeBytes: 4, width: 1080, height: 2400 },
    uiElements: [],
    ocrTexts: [{ text, source: "ocr", region: { x: 50, y: 50, width: 500, height: 120 } }],
    events: [],
    raw: { screenshotBase64: Buffer.from("fake").toString("base64") }
  };
}
