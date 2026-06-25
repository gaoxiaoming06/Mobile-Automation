import { describe, expect, it } from "vitest";
import type { ActionStep, TestCase } from "@mobile-automation/shared";
import { importLegacyCaseAsDraftGraph, type LegacyCaseGraphStorage } from "./legacy-case-graph.js";

describe("importLegacyCaseAsDraftGraph", () => {
  it("imports a legacy recording case as a draft business graph version", () => {
    const storage = new FakeLegacyGraphStorage();
    const imported = importLegacyCaseAsDraftGraph(storage, legacyCase());

    expect(imported.importedNodeCount).toBe(3);
    expect(imported.importedEdgeCount).toBe(2);
    expect(imported.graph).toEqual(
      expect.objectContaining({
        appId: "com.demo",
        name: "登录冒烟 录制候选图谱",
        status: "draft"
      })
    );
    expect(imported.version).toEqual(
      expect.objectContaining({
        status: "draft",
        sourceSummary: expect.arrayContaining(["manual_recording", "source_case:case-1", "source_steps:2"]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            key: "legacy.case_1.after_step_1",
            status: "draft",
            defaultExpectations: [expect.objectContaining({ id: "expect-home", type: "text" })],
            matchers: expect.arrayContaining([expect.objectContaining({ type: "text", value: "首页" })]),
            metadata: expect.objectContaining({
              sourceCaseId: "case-1",
              sourceStepId: "step-1",
              originalParams: expect.objectContaining({ text: "我是教师" })
            })
          })
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({
            key: "legacy.case_1.step_1",
            source: "manual_recording",
            status: "draft",
            reliabilityScore: 0.72,
            actionPolicies: [
              expect.objectContaining({
                fallback: false,
                reliabilityHint: "high",
                source: expect.objectContaining({
                  sourceType: "manual_recording",
                  caseId: "case-1",
                  stepId: "step-1"
                })
              })
            ],
            expectations: [expect.objectContaining({ id: "expect-home" })]
          }),
          expect.objectContaining({
            key: "legacy.case_1.step_2",
            reliabilityScore: 0.35,
            actionPolicies: [expect.objectContaining({ fallback: true, reliabilityHint: "low" })]
          })
        ])
      })
    );
    expect(imported.unresolvedSteps).toEqual([
      expect.objectContaining({
        stepId: "step-2",
        reason: "coordinate_fallback_only"
      })
    ]);
  });

  it("promotes recorded semantic element locators into critical graph matchers", () => {
    const storage = new FakeLegacyGraphStorage();
    const imported = importLegacyCaseAsDraftGraph(storage, legacyCaseWithElementLocator());

    expect(imported.version.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "legacy.case_element.after_step_1",
          matchers: expect.arrayContaining([
            expect.objectContaining({
              type: "resource_id",
              value: "com.demo:id/first_class",
              weight: 3,
              critical: true
            }),
            expect.objectContaining({
              type: "text",
              value: "一班"
            }),
            expect.objectContaining({
              type: "accessibility_id",
              value: "进入一班"
            })
          ]),
          metadata: expect.objectContaining({
            graphCandidate: expect.objectContaining({
              needsReview: true,
              repairHint: "recorded_semantic_locator"
            })
          })
        })
      ])
    );
    expect(imported.version.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reliabilityScore: 0.82,
          actionPolicies: [
            expect.objectContaining({
              fallback: false,
              reliabilityHint: "high"
            })
          ]
        })
      ])
    );
  });
});

class FakeLegacyGraphStorage implements LegacyCaseGraphStorage {
  private graphIndex = 0;
  private versionIndex = 0;
  private nodeIndex = 0;
  private edgeIndex = 0;
  private readonly graphs = new Map<string, any>();
  private readonly versions = new Map<string, any>();

  createBusinessGraph(input: Parameters<LegacyCaseGraphStorage["createBusinessGraph"]>[0]) {
    const graph = {
      id: `graph-${++this.graphIndex}`,
      activeVersionId: undefined,
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z",
      ...input,
      status: input.status ?? "draft"
    };
    this.graphs.set(graph.id, graph);
    return graph;
  }

  getBusinessGraph(id: string) {
    return this.graphs.get(id);
  }

  createBusinessGraphVersion(input: Parameters<LegacyCaseGraphStorage["createBusinessGraphVersion"]>[0]) {
    const version = {
      id: `version-${++this.versionIndex}`,
      version: this.versionIndex,
      nodes: [],
      edges: [],
      createdAt: "2026-06-12T00:00:00.000Z",
      ...input,
      sourceSummary: input.sourceSummary ?? [],
      status: input.status ?? "draft"
    };
    this.versions.set(version.id, version);
    return version;
  }

  createBusinessNode(input: Parameters<LegacyCaseGraphStorage["createBusinessNode"]>[0]) {
    const node = {
      id: `node-${++this.nodeIndex}`,
      tags: [],
      status: "draft",
      matchers: [],
      defaultExpectations: [],
      ...input
    };
    this.versions.get(input.graphVersionId)?.nodes.push(node);
    return node;
  }

  createOperationEdge(input: Parameters<LegacyCaseGraphStorage["createOperationEdge"]>[0]) {
    const edge = {
      id: `edge-${++this.edgeIndex}`,
      status: "draft",
      preconditions: [],
      actionPolicies: [],
      expectations: [],
      ...input
    };
    this.versions.get(input.graphVersionId)?.edges.push(edge);
    return edge;
  }

  getBusinessGraphVersion(id: string) {
    return this.versions.get(id);
  }
}

function legacyCase(): TestCase {
  return {
    id: "case-1",
    name: "登录冒烟",
    platformScope: "android",
    targetApp: {
      androidPackageName: "com.demo"
    },
    tags: [],
    version: 2,
    steps: [
      {
        id: "step-1",
        order: 1,
        type: "tap_on_text",
        enabled: true,
        title: "点击我是教师",
        params: {
          text: "我是教师"
        },
        expectations: [
          {
            id: "expect-home",
            type: "text",
            enabled: true,
            params: { expected: "首页", mode: "contains" },
            createdAt: "2026-06-12T00:00:00.000Z"
          },
          {
            id: "guard-no-crash",
            type: "no_crash",
            enabled: true,
            params: {},
            createdAt: "2026-06-12T00:00:00.000Z"
          }
        ],
        createdAt: "2026-06-12T00:00:00.000Z"
      } as ActionStep,
      {
        id: "step-2",
        order: 2,
        type: "tap",
        enabled: true,
        params: {},
        coordinate: { x: 100, y: 200 },
        expectations: [],
        createdAt: "2026-06-12T00:00:00.000Z"
      } as ActionStep
    ],
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z"
  };
}

function legacyCaseWithElementLocator(): TestCase {
  return {
    id: "case-element",
    name: "进入班级",
    platformScope: "android",
    targetApp: {
      androidPackageName: "com.demo"
    },
    tags: [],
    version: 1,
    steps: [
      {
        id: "step-element",
        order: 1,
        type: "tap_on_element",
        enabled: true,
        title: "点击第一个班级",
        params: {
          locator: {
            strategy: "android_uiautomator",
            resourceId: "com.demo:id/first_class",
            text: "一班",
            contentDesc: "进入一班",
            className: "android.widget.TextView",
            packageName: "com.demo"
          },
          resourceId: "com.demo:id/first_class",
          text: "一班",
          contentDesc: "进入一班"
        },
        expectations: [],
        createdAt: "2026-06-12T00:00:00.000Z"
      } as ActionStep
    ],
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z"
  };
}
