import { describe, expect, it } from "vitest";
import type { BusinessGraphVersion, BusinessNode } from "@mobile-automation/graph-core";
import {
  applyVerifiedAiAssetPatch,
  buildLocalPageMatcherRepairDiagnosis,
  chooseAssetRepairDiagnosis,
  decideAiAssetRepair,
  validateAiAssetPatchCandidate
} from "./asset-ai-repair.js";
import type { AiDiagnosisResult } from "./ai-diagnosis.js";

describe("AI asset repair", () => {
  it("allows a high-confidence asset patch that avoids coordinates", () => {
    const decision = decideAiAssetRepair(
      diagnosis({
        confidence: 0.93,
        recommendedAction: "apply_verified_asset_patch",
        safeToAutoApply: true,
        assetPatch: {
          kind: "page_transition",
          operation: "update",
          targetId: "home-search",
          summary: "搜索入口实际进入新版搜索页",
          changes: { targetNodeId: "node-search-v2", targetLabel: "搜索" },
          status: "draft"
        }
      })
    );

    expect(decision.action).toBe("apply");
  });

  it("does not auto-apply unverified create_asset_patch drafts", () => {
    const decision = decideAiAssetRepair(
      diagnosis({
        confidence: 0.9,
        recommendedAction: "create_asset_patch",
        safeToAutoApply: false,
        assetPatch: {
          kind: "page_matcher",
          operation: "update",
          targetId: "node-growth",
          summary: "放宽成长页识别规则",
          changes: {
            addMatchersDraft: [
              { type: "ocr_text", expected: "成长", weight: 2.2, critical: true },
              { type: "ocr_text", expected: "回放视频", weight: 1.4 }
            ],
            deprioritizeMatchersDraft: ["matcher-old-growth"]
          },
          status: "draft"
        }
      })
    );

    expect(decision).toEqual(expect.objectContaining({
      action: "skip",
      reason: expect.stringContaining("requires system verification")
    }));
  });

  it("promotes a verifiable page element draft into a system verified patch", () => {
    const home = node("node-home", "主页", {
      assetRecordingPageElements: [
        {
          id: "home-search",
          label: "搜索",
          locator: "top-bar-icon:search",
          locatorKind: "top_bar_icon_locator",
          elementKind: "icon_button",
          actions: ["tap"],
          semanticArea: "top"
        }
      ]
    });
    const graphVersion = graph([home]);

    const result = chooseAssetRepairDiagnosis({
      aiDiagnosis: diagnosis({
        confidence: 0.91,
        recommendedAction: "create_asset_patch",
        safeToAutoApply: false,
        assetPatch: {
          kind: "page_element",
          operation: "update",
          summary: "搜索图标在当前版本需要按顶部栏语义重新定位",
          changes: {
            locatorKind: "top_bar_icon_locator",
            locator: "top-bar-icon:search",
            role: "search",
            slot: "trailing",
            orderFromRight: 2,
            visualLocator: {
              strategy: "top_bar_icon_shape",
              expectedIcon: "search"
            }
          },
          status: "draft"
        }
      }),
      graphVersion,
      context: {
        failedRunId: "run-search",
        failedTargetLabel: "主页 -> 搜索",
        startNodeId: "node-home",
        targetNodeId: "node-search",
        elementId: "home-search"
      }
    });

    expect(result.source).toBe("ai");
    expect(result.rejectedAiDecision).toBeUndefined();
    expect(result.diagnosis).toEqual(expect.objectContaining({
      recommendedAction: "apply_verified_asset_patch",
      safeToAutoApply: true
    }));
    expect(result.diagnosis?.assetPatch).toEqual(expect.objectContaining({
      kind: "page_element",
      targetId: "home-search"
    }));
    expect(result.diagnosis?.assetPatch?.changes.quality).toEqual(expect.objectContaining({
      status: "system_verified",
      source: "ai_page_element_draft_verified"
    }));
  });

  it("does not promote a page element draft without runtime relocation evidence", () => {
    const graphVersion = graph([
      node("node-home", "主页", {
        assetRecordingPageElements: [
          {
            id: "home-search",
            label: "搜索",
            locator: "top-bar-icon:search",
            locatorKind: "top_bar_icon_locator"
          }
        ]
      })
    ]);

    const result = chooseAssetRepairDiagnosis({
      aiDiagnosis: diagnosis({
        confidence: 0.91,
        recommendedAction: "create_asset_patch",
        safeToAutoApply: false,
        assetPatch: {
          kind: "page_element",
          operation: "update",
          summary: "只修正元素展示名",
          targetId: "home-search",
          changes: {
            label: "搜索入口"
          },
          status: "draft"
        }
      }),
      graphVersion,
      context: {
        startNodeId: "node-home",
        elementId: "home-search"
      }
    });

    expect(result.source).toBe("ai");
    expect(result.rejectedAiDecision?.action).toBe("skip");
    expect(result.diagnosis?.recommendedAction).toBe("create_asset_patch");
  });

  it("rejects auto patches that try to restore coordinate fallback", () => {
    const validation = validateAiAssetPatchCandidate({
      kind: "page_element",
      operation: "update",
      targetId: "home-add",
      summary: "用保存坐标兜底",
      changes: { locatorKind: "region_center", regionCenter: { x: 91, y: 6 } },
      status: "draft"
    });

    expect(validation.valid).toBe(false);
    expect(validation.reasons.join("\n")).toContain("region_center");
  });

  it("applies a verified page transition patch to node metadata and records provenance", () => {
    const home = node("node-home", "主页", {
      assetRecordingPageTransitions: [
        {
          id: "home-search",
          elementId: "top-search",
          action: "tap",
          outcomeType: "navigate",
          targetNodeId: "node-search-old",
          targetLabel: "搜索"
        }
      ]
    });
    const graphVersion = graph([home, node("node-search-v2", "搜索")]);
    const storage = new MemoryStorage(graphVersion);

    const result = applyVerifiedAiAssetPatch({
      storage,
      graphVersionId: graphVersion.id,
      diagnosis: diagnosis({
        confidence: 0.91,
        recommendedAction: "apply_verified_asset_patch",
        safeToAutoApply: true,
        assetPatch: {
          kind: "page_transition",
          operation: "update",
          targetId: "home-search",
          summary: "当前搜索入口进入新版搜索页",
          changes: { targetNodeId: "node-search-v2" },
          status: "draft"
        }
      }),
      context: {
        failedRunId: "run-failed",
        failedTargetLabel: "主页 -> 搜索"
      },
      now: "2026-07-08T10:00:00.000Z"
    });

    expect(result.status).toBe("applied");
    expect(storage.updatedNode?.metadata?.assetRecordingPageTransitions).toEqual([
      expect.objectContaining({
        id: "home-search",
        targetNodeId: "node-search-v2"
      })
    ]);
    expect(storage.updatedNode?.metadata?.aiAssetRepairHistory).toEqual([
      expect.objectContaining({
        runId: "run-failed",
        patchKind: "page_transition",
        targetId: "home-search",
        status: "applied"
      })
    ]);
  });

  it("applies a verified page matcher patch to active matchers and records provenance", () => {
    const growth = node("node-growth", "成长", {}, [
      {
        id: "matcher-old-growth",
        type: "ocr_text",
        value: "旧成长",
        weight: 3,
        critical: true
      }
    ]);
    const graphVersion = graph([growth]);
    const storage = new MemoryStorage(graphVersion);

    const result = applyVerifiedAiAssetPatch({
      storage,
      graphVersionId: graphVersion.id,
      diagnosis: diagnosis({
        confidence: 0.92,
        recommendedAction: "apply_verified_asset_patch",
        safeToAutoApply: true,
        assetPatch: {
          kind: "page_matcher",
          operation: "update",
          targetId: "node-growth",
          summary: "当前成长页标题和内容锚点已变化",
          changes: {
            addMatchersDraft: [
              { type: "ocr_text", expected: "成长", weight: 2.2, critical: true },
              { type: "ocr_text", expected: "回放视频", weight: 1.4 }
            ],
            deprioritizeMatchersDraft: ["matcher-old-growth"]
          },
          status: "draft"
        }
      }),
      context: {
        failedRunId: "run-growth",
        failedTargetLabel: "主页 -> 成长"
      },
      now: "2026-07-08T10:00:00.000Z"
    });

    expect(result.status).toBe("applied");
    expect(storage.updatedDetailsNode?.matchers).toEqual([
      expect.objectContaining({
        id: "matcher-old-growth",
        critical: false
      }),
      expect.objectContaining({
        type: "ocr_text",
        value: "成长",
        critical: true,
        source: expect.objectContaining({
          sourceType: "ai_draft",
          artifactId: "run-growth",
          confidence: 0.92
        })
      }),
      expect.objectContaining({
        type: "ocr_text",
        value: "回放视频",
        source: expect.objectContaining({
          sourceType: "ai_draft",
          artifactId: "run-growth",
          confidence: 0.92
        })
      })
    ]);
    expect(storage.updatedDetailsNode?.metadata?.aiAssetRepairHistory).toEqual([
      expect.objectContaining({
        runId: "run-growth",
        patchKind: "page_matcher",
        targetId: "node-growth",
        confidence: 0.92,
        status: "applied"
      })
    ]);
    expect(storage.updatedDetailsNode?.metadata?.aiMatcherRepairDraft).toEqual(expect.objectContaining({
      repairEvidence: expect.objectContaining({
        runId: "run-growth",
        label: "主页 -> 成长",
        targetNodeId: "node-growth",
        confidence: 0.92
      })
    }));
  });

  it("merges duplicate matcher evidence instead of adding another matcher", () => {
    const growth = node("node-growth", "成长", {}, [
      {
        id: "matcher-growth-existing",
        type: "ocr_text",
        value: "成长",
        weight: 1.6,
        critical: false,
        source: { sourceType: "manual_edit", confidence: 0.96 }
      }
    ]);
    const graphVersion = graph([growth]);
    const storage = new MemoryStorage(graphVersion);

    const result = applyVerifiedAiAssetPatch({
      storage,
      graphVersionId: graphVersion.id,
      diagnosis: diagnosis({
        confidence: 0.91,
        recommendedAction: "apply_verified_asset_patch",
        safeToAutoApply: true,
        assetPatch: {
          kind: "page_matcher",
          operation: "update",
          targetId: "node-growth",
          summary: "补强成长页 OCR 锚点",
          changes: {
            addMatchersDraft: [
              { type: "ocr_text", expected: "成长", weight: 2.2, critical: true }
            ]
          },
          status: "draft"
        }
      }),
      context: {
        failedRunId: "run-duplicate-growth",
        failedTargetLabel: "主页 -> 成长"
      },
      now: "2026-07-08T10:01:00.000Z"
    });

    expect(result.status).toBe("applied");
    const growthMatchers = storage.updatedDetailsNode?.matchers.filter((matcher) =>
      matcher.type === "ocr_text" && matcher.value === "成长"
    );
    expect(growthMatchers).toHaveLength(1);
    expect(growthMatchers?.[0]).toEqual(expect.objectContaining({
      id: "matcher-growth-existing",
      weight: 2.2,
      critical: true,
      source: { sourceType: "manual_edit", confidence: 0.96 }
    }));
  });

  it("builds a local page matcher repair from graph afterMatch evidence when AI diagnosis times out", () => {
    const result = buildLocalPageMatcherRepairDiagnosis({
      targetNodeId: "node-growth",
      targetNodeName: "成长",
      afterMatch: {
        status: "unknown",
        candidates: [
          {
            nodeId: "node-home",
            nodeName: "主页",
            score: 0.6,
            matchedWeight: 4.5,
            totalWeight: 7.5,
            matcherResults: []
          },
          {
            nodeId: "node-growth",
            nodeName: "成长",
            score: 0.2857,
            matchedWeight: 4,
            totalWeight: 14,
            quality: {
              status: "low_confidence",
              reasons: ["critical_matcher_missing"],
              missingStrongMatcherIds: ["matcher-old-title", "matcher-old-main-actions"],
              missingCriticalMatcherIds: ["matcher-old-title"]
            },
            matcherResults: [
              {
                matcherId: "matcher-old-title",
                type: "image_region",
                expected: "screenshot-region:growth-title",
                matched: false,
                score: 0,
                reason: "not_found"
              },
              {
                matcherId: "matcher-growth-text",
                type: "ocr_text",
                expected: "成长",
                actual: "成长",
                weight: 1.8,
                matched: true,
                score: 1.8
              },
              {
                matcherId: "matcher-growth-actions",
                type: "semantic_image_region",
                expected: "semantic-image-region:growth-main-actions",
                actual: "semantic-image-region:growth-main-actions:0.8",
                weight: 2.2,
                matched: true,
                score: 2.2
              }
            ]
          }
        ]
      }
    });

    expect(result).toEqual(expect.objectContaining({
      classification: "asset_issue",
      recommendedAction: "apply_verified_asset_patch",
      safeToAutoApply: true,
      confidence: 0.88
    }));
    expect(result?.assetPatch).toEqual(expect.objectContaining({
      kind: "page_matcher",
      operation: "update",
      targetId: "node-growth"
    }));
    expect(result?.assetPatch?.changes.addMatchersDraft).toEqual([
      expect.objectContaining({ type: "ocr_text", expected: "成长", critical: true })
    ]);
    expect(result?.assetPatch?.changes.deprioritizeMatchersDraft).toEqual(["matcher-old-title", "matcher-old-main-actions"]);
    expect(result?.assetPatch?.changes.quality).toEqual(expect.objectContaining({
      status: "system_verified",
      source: "local_graph_evidence"
    }));
  });

  it("falls back to local graph evidence when AI returns an invalid asset patch for the matched target page", () => {
    const result = chooseAssetRepairDiagnosis({
      aiDiagnosis: diagnosis({
        confidence: 0.9,
        recommendedAction: "create_asset_patch",
        safeToAutoApply: false,
        assetPatch: {
          kind: "page_matcher",
          operation: "update",
          targetId: "node-growth",
          summary: "AI 认为成长页识别资产需要更新",
          changes: {
            nodeName: "成长",
            matcherDraft: {
              addMatchers: [{ type: "ocr_text", expected: "成长", weight: 2.2 }],
              deprioritizeMatchers: [
                {
                  matcherId: "matcher-old-title",
                  reason: "主内容 image_region 未命中，但目标页 OCR 已命中"
                }
              ]
            }
          },
          status: "draft"
        }
      }),
      targetNodeId: "node-growth",
      targetNodeName: "成长",
      afterMatch: growthAfterMatchEvidence()
    });

    expect(result.source).toBe("local_graph_evidence");
    expect(result.rejectedAiDecision?.action).toBe("skip");
    expect(result.diagnosis?.assetPatch).toEqual(expect.objectContaining({
      kind: "page_matcher",
      targetId: "node-growth"
    }));
    expect(result.diagnosis?.assetPatch?.changes.addMatchersDraft).toEqual([
      expect.objectContaining({ type: "ocr_text", expected: "成长", critical: true })
    ]);
    expect(result.diagnosis?.assetPatch?.changes.deprioritizeMatchersDraft).toEqual(["matcher-old-title", "matcher-old-main-actions"]);
  });

  it("does not build a local page matcher repair without target evidence", () => {
    expect(buildLocalPageMatcherRepairDiagnosis({
      targetNodeId: "node-growth",
      targetNodeName: "成长",
      afterMatch: {
        status: "unknown",
        candidates: [
          {
            nodeId: "node-home",
            nodeName: "主页",
            score: 0.6,
            matchedWeight: 4.5,
            totalWeight: 7.5,
            matcherResults: []
          }
        ]
      }
    })).toBeUndefined();
  });

  it("does not apply low-confidence or non-asset diagnoses", () => {
    expect(decideAiAssetRepair(diagnosis({ classification: "app_issue", confidence: 0.99 })).action).toBe("skip");
    expect(decideAiAssetRepair(diagnosis({ confidence: 0.7, recommendedAction: "apply_verified_asset_patch", safeToAutoApply: true })).action).toBe("skip");
  });
});

function growthAfterMatchEvidence(): Record<string, unknown> {
  return {
    status: "unknown",
    candidates: [
      {
        nodeId: "node-growth",
        nodeName: "成长",
        score: 0.2857,
        matchedWeight: 4,
        totalWeight: 14,
        quality: {
          status: "low_confidence",
          reasons: ["critical_matcher_missing"],
          missingStrongMatcherIds: ["matcher-old-title", "matcher-old-main-actions"],
          missingCriticalMatcherIds: ["matcher-old-title"]
        },
        matcherResults: [
          {
            matcherId: "matcher-old-title",
            type: "image_region",
            expected: "screenshot-region:growth-title",
            matched: false,
            score: 0,
            reason: "not_found"
          },
          {
            matcherId: "matcher-growth-text",
            type: "ocr_text",
            expected: "成长",
            actual: "成长",
            weight: 1.8,
            matched: true,
            score: 1.8
          }
        ]
      }
    ]
  };
}

function diagnosis(patch: Partial<AiDiagnosisResult>): AiDiagnosisResult {
  return {
    classification: "asset_issue",
    confidence: 0.9,
    summary: "资产需要更新",
    reasoning: ["失败证据指向资产失效"],
    recommendedAction: "create_asset_patch",
    safeToAutoApply: false,
    ...patch
  };
}

function graph(nodes: BusinessNode[]): BusinessGraphVersion {
  return {
    id: "graph-version-1",
    graphId: "graph-1",
    version: 1,
    sourceSummary: [],
    status: "active",
    nodes,
    edges: [],
    createdAt: "2026-07-08T10:00:00.000Z"
  };
}

function node(id: string, name: string, metadata: Record<string, unknown> = {}, matchers: BusinessNode["matchers"] = []): BusinessNode {
  return {
    id,
    graphVersionId: "graph-version-1",
    key: id.replace(/^node-/, ""),
    name,
    nodeType: "page",
    tags: ["page-asset"],
    status: "active",
    matchers,
    defaultExpectations: [],
    platformScope: "android",
    metadata
  };
}

class MemoryStorage {
  updatedNode?: BusinessNode;
  updatedDetailsNode?: BusinessNode;

  constructor(private readonly graphVersion: BusinessGraphVersion) {}

  getBusinessGraphVersion(id: string): BusinessGraphVersion | undefined {
    return id === this.graphVersion.id ? this.graphVersion : undefined;
  }

  updateBusinessNodeMetadata(nodeId: string, metadata: Record<string, unknown>): BusinessNode | undefined {
    const node = this.graphVersion.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return undefined;
    }
    node.metadata = metadata;
    this.updatedNode = node;
    return node;
  }

  updateBusinessNodeDetails(
    nodeId: string,
    input: {
      matchers?: BusinessNode["matchers"];
      metadata?: Record<string, unknown>;
    }
  ): BusinessNode | undefined {
    const node = this.graphVersion.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return undefined;
    }
    node.matchers = input.matchers ?? node.matchers;
    node.metadata = input.metadata ?? node.metadata;
    this.updatedDetailsNode = node;
    return node;
  }
}
