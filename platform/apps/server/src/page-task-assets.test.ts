import { describe, expect, it } from "vitest";
import type { BusinessNode } from "@mobile-automation/graph-core";
import { deletePageTaskAsset, persistPageTaskAsset, type PageTaskAssetStorage } from "./page-task-assets.js";

describe("persistPageTaskAsset", () => {
  it("saves a page task on a confirmed page asset", () => {
    const storage = new MemoryPageTaskStorage();
    const source = pageAssetNode("node-create-lesson", "新建课堂");
    storage.nodes.push(source);

    const result = persistPageTaskAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      name: "创建课堂",
      steps: [
        { order: 2, elementId: "manual-submit", fieldType: "submit", label: "发布" },
        { order: 1, elementId: "manual-title", fieldType: "text_input", label: "课堂标题", valueParamKey: "lessonName" }
      ]
    });

    expect(result.status).toBe("saved");
    expect(storage.findBusinessNodeById("version-1", source.id)?.metadata?.assetRecordingPageTasks).toEqual([
      expect.objectContaining({
        id: "page_task_创建课堂",
        name: "创建课堂",
        status: "active",
        steps: [
          expect.objectContaining({ id: "task_step_1", order: 1, elementId: "manual-title", fieldType: "text_input", label: "课堂标题", valueParamKey: "lessonName" }),
          expect.objectContaining({ id: "task_step_2", order: 2, elementId: "manual-submit", fieldType: "submit", label: "发布" })
        ],
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      })
    ]);
  });

  it("updates an existing page task without duplicating it", () => {
    const storage = new MemoryPageTaskStorage();
    const source = pageAssetNode("node-create-lesson", "新建课堂", {
      assetRecordingPageTasks: [
        {
          id: "task-create-lesson",
          name: "创建课堂",
          status: "active",
          steps: [{ id: "old-step", order: 1, elementId: "manual-title", fieldType: "text_input" }],
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z"
        }
      ]
    });
    storage.nodes.push(source);

    const result = persistPageTaskAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      taskId: "task-create-lesson",
      name: "创建公开课",
      status: "draft",
      steps: [{ id: "submit-step", order: 1, elementId: "manual-submit", fieldType: "tap" }]
    });

    expect(result.status).toBe("saved");
    expect(storage.findBusinessNodeById("version-1", source.id)?.metadata?.assetRecordingPageTasks).toEqual([
      expect.objectContaining({
        id: "task-create-lesson",
        name: "创建公开课",
        status: "draft",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: expect.any(String),
        steps: [expect.objectContaining({ id: "submit-step", order: 1, elementId: "manual-submit", fieldType: "tap" })]
      })
    ]);
  });

  it("deletes a saved page task", () => {
    const storage = new MemoryPageTaskStorage();
    const source = pageAssetNode("node-create-lesson", "新建课堂", {
      assetRecordingPageTasks: [
        { id: "task-create-lesson", name: "创建课堂", status: "active", steps: [{ id: "step-1", order: 1, elementId: "manual-title", fieldType: "text_input" }] },
        { id: "task-other", name: "其他任务", status: "active", steps: [{ id: "step-2", order: 1, elementId: "manual-submit", fieldType: "tap" }] }
      ]
    });
    storage.nodes.push(source);

    const result = deletePageTaskAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      taskId: "task-create-lesson"
    });

    expect(result.status).toBe("deleted");
    expect(storage.findBusinessNodeById("version-1", source.id)?.metadata?.assetRecordingPageTasks).toEqual([
      expect.objectContaining({ id: "task-other" })
    ]);
  });

  it("skips unconfirmed source pages", () => {
    const storage = new MemoryPageTaskStorage();
    const source = pageAssetNode("node-draft", "运行期节点", { assetRecordingConfirmed: false }, []);
    storage.nodes.push(source);

    const result = persistPageTaskAsset({
      graphVersionId: "version-1",
      storage,
      sourceNodeId: source.id,
      name: "创建课堂",
      steps: [{ order: 1, elementId: "manual-title", fieldType: "text_input", valueParamKey: "lessonName" }]
    });

    expect(result).toEqual({ status: "skipped", reason: "source_page_asset_missing" });
  });
});

class MemoryPageTaskStorage implements PageTaskAssetStorage {
  readonly nodes: BusinessNode[] = [];

  findBusinessNodeById(_graphVersionId: string, nodeId: string): BusinessNode | undefined {
    return this.nodes.find((node) => node.id === nodeId);
  }

  updateBusinessNodeDetails(nodeId: string, input: { metadata?: Record<string, unknown> }): BusinessNode | undefined {
    const index = this.nodes.findIndex((node) => node.id === nodeId);
    if (index < 0) {
      return undefined;
    }
    this.nodes[index] = {
      ...this.nodes[index],
      metadata: input.metadata ?? this.nodes[index].metadata
    };
    return this.nodes[index];
  }
}

function pageAssetNode(id: string, name: string, metadata: Record<string, unknown> = {}, tags = ["page-asset"]): BusinessNode {
  return {
    id,
    graphVersionId: "version-1",
    key: id.replace(/^node-/, "page."),
    name,
    nodeType: "business_state",
    status: "active",
    tags,
    matchers: [],
    defaultExpectations: [],
    metadata: {
      assetRecordingConfirmed: true,
      ...metadata
    }
  };
}
