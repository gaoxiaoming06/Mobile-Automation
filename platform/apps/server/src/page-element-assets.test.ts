import { describe, expect, it } from "vitest";
import type { BusinessNode } from "@mobile-automation/graph-core";
import { deletePageElementAsset, persistPageElementAsset } from "./page-element-assets.js";

describe("page element assets", () => {
  it("stores only reusable locator evidence on a confirmed page", () => {
    const storage = new MemoryStorage(page());

    const result = persistPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: "home",
      label: "添加好友",
      locator: "text:添加好友",
      locatorKind: "text_locator",
      targetText: "添加好友",
      semanticArea: "content",
      platformScope: "mobile-both"
    });

    expect(result).toEqual({
      status: "saved",
      element: expect.objectContaining({
        id: expect.stringMatching(/^page_element_/),
        label: "添加好友",
        locator: "text:添加好友",
        locatorKind: "text_locator",
        targetText: "添加好友"
      })
    });
    expect(result.element).not.toHaveProperty("actionKind");
    expect(result.element).not.toHaveProperty("targetNodeId");
    expect(result.element).not.toHaveProperty("outcomeType");
  });

  it("updates by stable id and deletes without touching unrelated page metadata", () => {
    const storage = new MemoryStorage(page({
      assetRecordingManualElements: [{ id: "search", label: "搜索", locator: "text:搜索" }],
      confirmedOcrTexts: ["主页"]
    }));

    persistPageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: "home",
      elementId: "search",
      label: "全局搜索",
      locator: "text:搜索",
      locatorKind: "text_locator"
    });
    expect(storage.node.metadata?.assetRecordingManualElements).toEqual([
      expect.objectContaining({ id: "search", label: "全局搜索" })
    ]);

    expect(deletePageElementAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: "home",
      elementId: "search"
    })).toEqual({ status: "deleted" });
    expect(storage.node.metadata?.assetRecordingManualElements).toEqual([]);
    expect(storage.node.metadata?.confirmedOcrTexts).toEqual(["主页"]);
  });
});

class MemoryStorage {
  constructor(public node: BusinessNode) {}

  findBusinessNodeById(graphVersionId: string, nodeId: string): BusinessNode | undefined {
    return graphVersionId === this.node.graphVersionId && nodeId === this.node.id ? this.node : undefined;
  }

  updateBusinessNodeDetails(nodeId: string, input: { metadata?: Record<string, unknown> }): BusinessNode | undefined {
    if (nodeId !== this.node.id) return undefined;
    this.node = { ...this.node, metadata: input.metadata };
    return this.node;
  }
}

function page(metadata: Record<string, unknown> = {}): BusinessNode {
  return {
    id: "home",
    graphVersionId: "version-1",
    key: "classin.home",
    name: "主页",
    nodeType: "page",
    tags: ["page-asset"],
    status: "active",
    matchers: [],
    defaultExpectations: [],
    platformScope: "mobile-both",
    metadata: { assetRecordingConfirmed: true, ...metadata }
  };
}
