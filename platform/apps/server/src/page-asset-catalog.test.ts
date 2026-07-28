import { describe, expect, it } from "vitest";
import type { BusinessGraph, BusinessGraphVersion, BusinessNode, OperationEdge, StateMatcher } from "@mobile-automation/graph-core";
import { StoragePageAssetCatalog } from "./page-asset-catalog.js";

describe("StoragePageAssetCatalog", () => {
  it("lists only active confirmed page assets for the requested app and platform", () => {
    const home = page({ id: "home", key: "classin.home", name: "主页", metadata: { assetRecordingConfirmed: true } });
    const draft = page({ id: "draft", key: "classin.draft", name: "草稿", status: "draft", metadata: { assetRecordingConfirmed: true } });
    const unconfirmed = page({ id: "unconfirmed", key: "classin.unconfirmed", name: "未确认" });
    const overlay = page({
      id: "overlay",
      key: "classin.overlay",
      name: "浮层",
      nodeType: "business_state",
      metadata: { assetRecordingConfirmed: true }
    });
    const ios = page({
      id: "ios",
      key: "classin.ios",
      name: "iOS 页",
      platformScope: "ios",
      metadata: { assetRecordingConfirmed: true }
    });
    const storage = new MemoryCatalogStorage(graph([home, draft, unconfirmed, overlay, ios]));
    const catalog = new StoragePageAssetCatalog(storage);

    expect(catalog.listPages("cn.eeo.classin", "android").map((item) => item.id)).toEqual(["home"]);
    expect(catalog.listPages("cn.eeo.classin", "ios").map((item) => item.id)).toEqual(["home", "ios"]);
    expect(catalog.listPages("other.app", "android")).toEqual([]);
  });

  it("reads optional public locators but ignores transitions and page tasks", () => {
    const home = page({
      id: "home",
      key: "classin.home",
      name: "主页",
      metadata: {
        assetRecordingConfirmed: true,
        assetRecordingPageElements: [
          { id: "search", label: "搜索", locator: "ocr:搜索", locatorKind: "text_locator" }
        ],
        assetRecordingManualElements: [
          { id: "search", label: "全局搜索", targetText: "搜索", locatorKind: "text_locator" },
          { id: "class-grid", label: "班级列表", structuralLocator: { role: "grid" }, locatorKind: "structural_locator" }
        ],
        assetRecordingPageTransitions: [{ id: "legacy-transition", elementId: "search" }],
        assetRecordingPageTasks: [{ id: "legacy-task", name: "旧任务" }]
      }
    });
    const catalog = new StoragePageAssetCatalog(new MemoryCatalogStorage(graph([home])));

    expect(catalog.listLocators("home")).toEqual([
      expect.objectContaining({ id: "search", label: "全局搜索", requiresUiTree: false }),
      expect.objectContaining({ id: "class-grid", label: "班级列表", requiresUiTree: true })
    ]);
    expect(catalog.listLocators("home").map((item) => item.id)).not.toContain("legacy-transition");
    expect(catalog.listLocators("home").map((item) => item.id)).not.toContain("legacy-task");
  });

  it("finds pages that share stable identity evidence", () => {
    const home = page({
      id: "home",
      key: "classin.home",
      name: "主页",
      metadata: { assetRecordingConfirmed: true },
      matchers: [matcher("package", "cn.eeo.classin"), matcher("ocr_text", "全部班级")]
    });
    const duplicate = page({
      id: "duplicate",
      key: "classin.home.variant",
      name: "主页变体",
      metadata: { assetRecordingConfirmed: true },
      matchers: [matcher("package", "cn.eeo.classin"), matcher("ocr_text", "全部班级")]
    });
    const settings = page({
      id: "settings",
      key: "classin.settings",
      name: "设置",
      metadata: { assetRecordingConfirmed: true },
      matchers: [matcher("package", "cn.eeo.classin"), matcher("ocr_text", "账号与安全")]
    });
    const catalog = new StoragePageAssetCatalog(new MemoryCatalogStorage(graph([home, duplicate, settings])));

    expect(catalog.findConfusablePages("home").map((item) => item.id)).toEqual(["duplicate"]);
  });
});

class MemoryCatalogStorage {
  private readonly businessGraph: BusinessGraph = {
    id: "graph",
    appId: "cn.eeo.classin",
    platformScope: "mobile-both",
    name: "ClassIn",
    status: "active",
    activeVersionId: "version",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z"
  };

  constructor(private readonly version: BusinessGraphVersion) {}

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

function graph(nodes: BusinessNode[], edges: OperationEdge[] = []): BusinessGraphVersion {
  return {
    id: "version",
    graphId: "graph",
    version: 1,
    sourceSummary: [],
    status: "active",
    nodes,
    edges,
    createdAt: "2026-07-28T00:00:00.000Z"
  };
}

function page(input: Partial<BusinessNode> & Pick<BusinessNode, "id" | "key" | "name">): BusinessNode {
  return {
    graphVersionId: "version",
    nodeType: "page",
    tags: ["page-asset"],
    status: "active",
    matchers: [matcher("package", "cn.eeo.classin"), matcher("ocr_text", input.name)],
    defaultExpectations: [],
    platformScope: "mobile-both",
    ...input
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
