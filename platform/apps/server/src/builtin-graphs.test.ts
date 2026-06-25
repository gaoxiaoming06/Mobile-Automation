import { describe, expect, it, vi } from "vitest";
import { buildExecutionPlan, planRoute, type BusinessGraphVersion, type BusinessNode, type OperationEdge } from "@mobile-automation/graph-core";
import {
  classInAndroidGraphAppId,
  classInAndroidGraphName,
  classInCreateLessonTargetNodeKey,
  classInTeacherCreateLessonLegacyGraphAppId,
  classInTeacherCreateLessonGraphRevision,
  seedBuiltinGraphs
} from "./builtin-graphs.js";

describe("builtin business graphs", () => {
  it("seeds or repairs the canonical ClassIn Android app graph by app id", () => {
    const storage = {
      findBusinessGraphByAppId: vi.fn((appId: string) => {
        if (appId === classInAndroidGraphAppId) {
          return storage.findBusinessGraphByAppId.mock.calls.filter(([calledAppId]) => calledAppId === classInAndroidGraphAppId).length === 1
            ? undefined
            : { id: "graph-existing" };
        }
        return undefined;
      }),
      getActiveBusinessGraphVersion: vi.fn().mockReturnValue(undefined),
      getBusinessGraph: vi.fn().mockReturnValue({ id: "graph-existing", appId: classInAndroidGraphAppId, name: classInAndroidGraphName }),
      createBusinessGraph: vi.fn().mockReturnValue({ id: "graph-1", appId: classInAndroidGraphAppId }),
      updateBusinessGraphProfile: vi.fn(),
      createBusinessGraphVersion: vi.fn().mockReturnValue({ id: "version-1", graphId: "graph-1", version: 1 }),
      createBusinessNode: vi.fn((input) => ({ id: input.id ?? `node-${input.key}` })),
      createOperationEdge: vi.fn((input) => ({ id: input.id ?? `edge-${input.key}` })),
      setActiveBusinessGraphVersion: vi.fn(),
      getBusinessGraphVersion: vi.fn().mockReturnValue({ id: "version-1" })
    };

    expect(seedBuiltinGraphs(storage as never)).toEqual({ created: 1, skipped: 0 });
    expect(seedBuiltinGraphs(storage as never)).toEqual({ created: 1, skipped: 0 });
    expect(storage.createBusinessGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: classInAndroidGraphAppId,
        name: classInAndroidGraphName,
        targetApp: {
          androidPackageName: "cn.eeo.classin"
        }
      })
    );
    expect(storage.createBusinessNode).toHaveBeenCalledTimes(12);
    expect(storage.createOperationEdge).toHaveBeenCalledTimes(10);
  });

  it("repairs an old ClassIn graph when the active version lacks the current built-in revision", () => {
    const storage = {
      findBusinessGraphByAppId: vi.fn().mockImplementation((appId: string) => (appId === classInAndroidGraphAppId ? { id: "graph-existing", activeVersionId: "version-existing" } : undefined)),
      getActiveBusinessGraphVersion: vi.fn().mockReturnValue({
        id: "version-existing",
        nodes: [{ key: classInCreateLessonTargetNodeKey }],
        sourceSummary: []
      }),
      getBusinessGraph: vi.fn().mockReturnValue({ id: "graph-existing", appId: classInAndroidGraphAppId, name: "旧名称" }),
      createBusinessGraph: vi.fn(),
      updateBusinessGraphProfile: vi.fn(),
      createBusinessGraphVersion: vi.fn().mockReturnValue({ id: "version-new", graphId: "graph-existing", version: 2 }),
      createBusinessNode: vi.fn((input) => ({ id: input.id ?? `node-${input.key}` })),
      createOperationEdge: vi.fn((input) => ({ id: input.id ?? `edge-${input.key}` })),
      setActiveBusinessGraphVersion: vi.fn(),
      getBusinessGraphVersion: vi.fn().mockReturnValue({ id: "version-new" })
    };

    expect(seedBuiltinGraphs(storage as never)).toEqual({ created: 1, skipped: 0 });
    expect(storage.createBusinessGraph).not.toHaveBeenCalled();
    expect(storage.updateBusinessGraphProfile).toHaveBeenCalledWith(
      "graph-existing",
      expect.objectContaining({
        name: classInAndroidGraphName,
        appId: classInAndroidGraphAppId
      })
    );
    expect(storage.createBusinessGraphVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        graphId: "graph-existing",
        sourceSummary: expect.arrayContaining([`builtin_revision:${classInTeacherCreateLessonGraphRevision}`])
      })
    );
  });

  it("carries user confirmed page assets and manual transitions into repaired built-in graph versions", () => {
    const oldHome = nodeDraft({
      id: "old-home",
      graphVersionId: "version-existing",
      key: "classin.teacher.classes",
      name: "主页",
      tags: ["classin", "teacher", "class-list", "page-asset", "asset-recording"],
      metadata: {
        assetRecordingConfirmed: true,
        assetRecordingManualElements: [{ id: "manual-create", label: "创建公开课" }]
      },
      matchers: [
        {
          id: "old-home-region",
          type: "image_region",
          value: "screenshot-region:home-title",
          weight: 3,
          critical: true,
          platformScope: "android",
          source: { sourceType: "manual_edit" }
        }
      ]
    });
    const oldCreatePublic = nodeDraft({
      id: "old-create-public",
      graphVersionId: "version-existing",
      key: "runtime.unknown.1u41ebp",
      name: "新建公开课",
      tags: ["page-asset", "asset-recording"],
      metadata: {
        assetRecordingConfirmed: true
      }
    });
    const oldTransition = edgeDraft({
      id: "old-edge-home-create-public",
      graphVersionId: "version-existing",
      fromNodeId: oldHome.id,
      toNodeId: oldCreatePublic.id,
      key: "manual.home.create-public",
      name: "主页 -> 新建公开课",
      preconditions: [
        {
          id: "old-pre-home",
          type: "state_is",
          enabled: true,
          title: "前置状态：主页",
          params: {
            nodeId: oldHome.id,
            nodeKey: oldHome.key,
            nodeName: oldHome.name,
            matcherCount: 7,
            criticalMatcherCount: 4
          },
          createdAt: "2026-06-20T00:00:00.000Z"
        }
      ],
      actionPolicies: [
        {
          id: "policy-old",
          priority: 1,
          fallback: false,
          reliabilityHint: "high",
          source: { sourceType: "manual_edit" },
          action: {
            id: "step-old",
            order: 1,
            type: "tap_on_image",
            enabled: true,
            params: {
              targetText: "创建公开课",
              availability: "after_scroll"
            },
            createdAt: "2026-06-20T00:00:00.000Z"
          }
        }
      ],
      expectations: [
        {
          id: "old-expect-create-public",
          type: "state_is",
          enabled: true,
          title: "预期状态：新建公开课",
          params: {
            nodeId: oldCreatePublic.id,
            nodeKey: oldCreatePublic.key,
            nodeName: oldCreatePublic.name,
            matcherCount: 12,
            criticalMatcherCount: 9
          },
          createdAt: "2026-06-20T00:00:00.000Z"
        }
      ]
    });
    const createdNodes: BusinessNode[] = [];
    const createdEdges: OperationEdge[] = [];
    const storage = {
      findBusinessGraphByAppId: vi.fn().mockImplementation((appId: string) => (appId === classInAndroidGraphAppId ? { id: "graph-existing", activeVersionId: "version-existing" } : undefined)),
      getActiveBusinessGraphVersion: vi.fn().mockReturnValue({
        id: "version-existing",
        graphId: "graph-existing",
        version: 1,
        status: "active",
        sourceSummary: [],
        nodes: [
          { key: classInCreateLessonTargetNodeKey },
          oldHome,
          oldCreatePublic
        ],
        edges: [oldTransition],
        createdAt: "2026-06-20T00:00:00.000Z"
      }),
      getBusinessGraph: vi.fn().mockReturnValue({ id: "graph-existing", appId: classInAndroidGraphAppId, name: classInAndroidGraphName }),
      createBusinessGraph: vi.fn(),
      updateBusinessGraphProfile: vi.fn(),
      createBusinessGraphVersion: vi.fn().mockReturnValue({ id: "version-new", graphId: "graph-existing", version: 2 }),
      createBusinessNode: vi.fn((input) => {
        const node = { ...input, id: input.id ?? `node-${input.key}`, graphVersionId: input.graphVersionId ?? "version-new" } as BusinessNode;
        createdNodes.push(node);
        return node;
      }),
      createOperationEdge: vi.fn((input) => {
        const edge = { ...input, id: input.id ?? `edge-${input.key}`, graphVersionId: input.graphVersionId ?? "version-new" } as OperationEdge;
        createdEdges.push(edge);
        return edge;
      }),
      setActiveBusinessGraphVersion: vi.fn(),
      getBusinessGraphVersion: vi.fn().mockImplementation((versionId: string) =>
        versionId === "version-new"
          ? {
              id: "version-new",
              graphId: "graph-existing",
              version: 2,
              status: "draft",
              sourceSummary: [],
              nodes: createdNodes,
              edges: createdEdges,
              createdAt: "2026-06-20T00:00:00.000Z"
            }
          : undefined
      )
    };

    expect(seedBuiltinGraphs(storage as never)).toEqual({ created: 1, skipped: 0 });

    const migratedHome = createdNodes.find((node) => node.key === "classin.teacher.classes");
    const migratedCreatePublic = createdNodes.find((node) => node.key === "runtime.unknown.1u41ebp");
    expect(migratedHome).toEqual(
      expect.objectContaining({
        name: "主页",
        tags: expect.arrayContaining(["page-asset", "asset-recording"]),
        metadata: expect.objectContaining({
          assetRecordingConfirmed: true,
          assetRecordingManualElements: [{ id: "manual-create", label: "创建公开课" }]
        }),
        matchers: expect.arrayContaining([
          expect.objectContaining({
            type: "image_region",
            value: "screenshot-region:home-title"
          })
        ])
      })
    );
    expect(migratedHome?.defaultExpectations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "builtin_classin_teacher_classes_create" })
      ])
    );
    expect(migratedCreatePublic).toEqual(
      expect.objectContaining({
        name: "新建公开课",
        tags: expect.arrayContaining(["page-asset"])
      })
    );
    expect(createdEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "manual.home.create-public",
          fromNodeId: migratedHome?.id,
          toNodeId: migratedCreatePublic?.id,
          preconditions: [
            expect.objectContaining({
              type: "state_is",
              params: expect.objectContaining({
                nodeId: migratedHome?.id,
                nodeKey: "classin.teacher.classes",
                nodeName: "主页",
                matcherCount: migratedHome?.matchers.length,
                criticalMatcherCount: migratedHome?.matchers.filter((matcher) => matcher.critical).length
              })
            })
          ],
          actionPolicies: expect.arrayContaining([
            expect.objectContaining({
              action: expect.objectContaining({
                type: "tap_on_image",
                params: expect.objectContaining({
                  targetText: "创建公开课"
                })
              })
            })
          ]),
          expectations: [
            expect.objectContaining({
              type: "state_is",
              params: expect.objectContaining({
                nodeId: migratedCreatePublic?.id,
                nodeKey: "runtime.unknown.1u41ebp",
                nodeName: "新建公开课",
                matcherCount: migratedCreatePublic?.matchers.length,
                criticalMatcherCount: migratedCreatePublic?.matchers.filter((matcher) => matcher.critical).length
              })
            })
          ]
        })
      ])
    );
  });

  it("repairs a partially updated ClassIn graph when the launch edge still uses an old target", () => {
    const storage = {
      findBusinessGraphByAppId: vi.fn().mockImplementation((appId: string) => (appId === classInAndroidGraphAppId ? { id: "graph-existing", activeVersionId: "version-existing" } : undefined)),
      getActiveBusinessGraphVersion: vi.fn().mockReturnValue({
        id: "version-existing",
        nodes: [{ key: classInCreateLessonTargetNodeKey }],
        edges: [{ key: "classin.launch.to.home" }],
        sourceSummary: [`builtin_revision:${classInTeacherCreateLessonGraphRevision}`]
      }),
      getBusinessGraph: vi.fn().mockReturnValue({ id: "graph-existing", appId: classInAndroidGraphAppId, name: classInAndroidGraphName }),
      createBusinessGraph: vi.fn(),
      updateBusinessGraphProfile: vi.fn(),
      createBusinessGraphVersion: vi.fn().mockReturnValue({ id: "version-new", graphId: "graph-existing", version: 2 }),
      createBusinessNode: vi.fn((input) => ({ id: input.id ?? `node-${input.key}` })),
      createOperationEdge: vi.fn((input) => ({ id: input.id ?? `edge-${input.key}` })),
      setActiveBusinessGraphVersion: vi.fn(),
      getBusinessGraphVersion: vi.fn().mockReturnValue({ id: "version-new" })
    };

    expect(seedBuiltinGraphs(storage as never)).toEqual({ created: 1, skipped: 0 });
    expect(storage.createOperationEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "classin.launch.to.teacher.classes"
      })
    );
  });

  it("skips the ClassIn graph when the active version already contains the target node and current revision", () => {
    const storage = {
      findBusinessGraphByAppId: vi.fn().mockImplementation((appId: string) => (appId === classInAndroidGraphAppId ? { id: "graph-existing", activeVersionId: "version-existing" } : undefined)),
      getActiveBusinessGraphVersion: vi.fn().mockReturnValue({
        id: "version-existing",
        nodes: [{ key: classInCreateLessonTargetNodeKey }],
        edges: [{ key: "classin.launch.to.teacher.classes" }],
        sourceSummary: [`builtin_revision:${classInTeacherCreateLessonGraphRevision}`]
      }),
      getBusinessGraph: vi.fn(),
      createBusinessGraph: vi.fn(),
      updateBusinessGraphProfile: vi.fn(),
      createBusinessGraphVersion: vi.fn(),
      createBusinessNode: vi.fn(),
      createOperationEdge: vi.fn(),
      setActiveBusinessGraphVersion: vi.fn(),
      getBusinessGraphVersion: vi.fn()
    };

    expect(seedBuiltinGraphs(storage as never)).toEqual({ created: 0, skipped: 1 });
    expect(storage.createBusinessGraph).not.toHaveBeenCalled();
  });

  it("archives the legacy teacher-create-lesson graph after seeding the canonical app graph", () => {
    const storage = {
      findBusinessGraphByAppId: vi.fn().mockImplementation((appId: string) => {
        if (appId === classInAndroidGraphAppId) {
          return { id: "graph-canonical", activeVersionId: "version-existing" };
        }
        if (appId === classInTeacherCreateLessonLegacyGraphAppId) {
          return { id: "graph-legacy", activeVersionId: "version-legacy", status: "active" };
        }
        return undefined;
      }),
      getActiveBusinessGraphVersion: vi.fn().mockReturnValue({
        id: "version-existing",
        nodes: [{ key: classInCreateLessonTargetNodeKey }],
        edges: [{ key: "classin.launch.to.teacher.classes" }],
        sourceSummary: [`builtin_revision:${classInTeacherCreateLessonGraphRevision}`]
      }),
      getBusinessGraph: vi.fn(),
      createBusinessGraph: vi.fn(),
      updateBusinessGraphProfile: vi.fn(),
      createBusinessGraphVersion: vi.fn(),
      createBusinessNode: vi.fn(),
      createOperationEdge: vi.fn(),
      setActiveBusinessGraphVersion: vi.fn(),
      getBusinessGraphVersion: vi.fn()
    };

    expect(seedBuiltinGraphs(storage as never)).toEqual({ created: 0, skipped: 1 });
    expect(storage.updateBusinessGraphProfile).toHaveBeenCalledWith("graph-legacy", {
      status: "deprecated"
    });
  });

  it("creates a route plan to the create lesson node without coordinate primary actions", () => {
    const graphVersion = captureSeededGraphVersion();
    const targetNode = graphVersion.nodes.find((node) => node.key === classInCreateLessonTargetNodeKey);
    const publishNode = graphVersion.nodes.find((node) => node.key === "classin.teacher.activity.publish");
    expect(targetNode).toBeDefined();
    expect(publishNode).toEqual(
      expect.objectContaining({
        nodeType: "business_state",
        matchers: expect.arrayContaining([
          expect.objectContaining({ type: "text", value: "发布活动" }),
          expect.objectContaining({ type: "text", value: "课堂" })
        ])
      })
    );

    const routePlan = planRoute({
      graphVersion,
      appId: classInAndroidGraphAppId,
      targetApp: {
        androidPackageName: "cn.eeo.classin"
      },
      targetNodeId: targetNode?.id ?? "",
      platform: "android",
      idFactory: (prefix) => `${prefix}-builtin`
    });
    const executionPlan = buildExecutionPlan({
      routePlan,
      platform: "android",
      idFactory: (prefix) => `${prefix}-builtin`
    });

    expect(executionPlan.unresolvedIssues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(executionPlan.steps.map((step) => step.edgeKey)).toEqual([
      "classin.launch.to.teacher.classes",
      "classin.teacher.classes.to.class.detail",
      "classin.class.detail.to.publish.activity",
      "classin.publish.activity.to.create.lesson"
    ]);
    expect(executionPlan.steps.map((step) => step.action?.type)).toEqual(["launch_app", "tap_on_element", "tap_on_element", "tap_on_element"]);
    expect(executionPlan.steps.some((step) => step.action?.type === "tap")).toBe(false);
    expect(executionPlan.steps[1]?.action?.params).toEqual(
      expect.objectContaining({
        locator: expect.objectContaining({
          text: "班级",
          tapTarget: "clickable_ancestor"
        })
      })
    );
    expect(executionPlan.steps.at(-1)?.expectations).toEqual(expect.arrayContaining([expect.objectContaining({ id: "builtin_classin_create_lesson_title" })]));
  });

  it("models the ClassIn home title separately from the teacher class-list state", () => {
    const graphVersion = captureSeededGraphVersion();
    const homeShell = graphVersion.nodes.find((node) => node.key === "classin.home");
    const teacherClasses = graphVersion.nodes.find((node) => node.key === "classin.teacher.classes");

    expect(homeShell).toEqual(
      expect.objectContaining({
        name: "ClassIn 首页壳",
        matchers: expect.arrayContaining([expect.objectContaining({ type: "text", value: "主页" })])
      })
    );
    expect(teacherClasses).toEqual(
      expect.objectContaining({
        name: "我是教师班级列表",
        matchers: expect.arrayContaining([
          expect.objectContaining({ type: "text", value: "主页" }),
          expect.objectContaining({ type: "text", value: "我是教师" }),
          expect.objectContaining({ type: "text", value: "全部班级" })
        ])
      })
    );
    expect(teacherClasses?.matchers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", value: "创建班级" })
      ])
    );
    expect(teacherClasses?.defaultExpectations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "builtin_classin_teacher_classes_create" })
      ])
    );
  });
});

function captureSeededGraphVersion(): BusinessGraphVersion {
  const nodes: BusinessGraphVersion["nodes"] = [];
  const edges: BusinessGraphVersion["edges"] = [];
  const storage = {
    findBusinessGraphByAppId: vi.fn().mockReturnValue(undefined),
    getActiveBusinessGraphVersion: vi.fn().mockReturnValue(undefined),
    getBusinessGraph: vi.fn().mockReturnValue(undefined),
    createBusinessGraph: vi.fn().mockReturnValue({ id: "graph-1", appId: classInAndroidGraphAppId }),
    updateBusinessGraphProfile: vi.fn(),
    createBusinessGraphVersion: vi.fn().mockReturnValue({ id: "version-1", graphId: "graph-1", version: 1 }),
    createBusinessNode: vi.fn((input) => {
      const node = { ...input, id: input.id ?? `node-${input.key}`, graphVersionId: "version-1" };
      nodes.push(node);
      return node;
    }),
    createOperationEdge: vi.fn((input) => {
      const edge = { ...input, id: input.id ?? `edge-${input.key}`, graphVersionId: "version-1" };
      edges.push(edge);
      return edge;
    }),
    setActiveBusinessGraphVersion: vi.fn(),
    getBusinessGraphVersion: vi.fn().mockReturnValue(undefined)
  };
  seedBuiltinGraphs(storage as never);
  return {
    id: "version-1",
    graphId: "graph-1",
    version: 1,
    sourceSummary: [],
    status: "active",
    nodes,
    edges,
    createdAt: "2026-06-11T00:00:00.000Z"
  };
}

function nodeDraft(input: Partial<BusinessNode> & Pick<BusinessNode, "id" | "graphVersionId" | "key" | "name">): BusinessNode {
  return {
    id: input.id,
    graphVersionId: input.graphVersionId,
    key: input.key,
    name: input.name,
    nodeType: input.nodeType ?? "page",
    tags: input.tags ?? [],
    status: input.status ?? "active",
    matchers: input.matchers ?? [],
    defaultExpectations: input.defaultExpectations ?? [],
    platformScope: input.platformScope ?? "android",
    metadata: input.metadata ?? {}
  };
}

function edgeDraft(input: Partial<OperationEdge> & Pick<OperationEdge, "id" | "graphVersionId" | "fromNodeId" | "toNodeId" | "key" | "name">): OperationEdge {
  return {
    id: input.id,
    graphVersionId: input.graphVersionId,
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    key: input.key,
    name: input.name,
    intent: input.intent ?? input.name,
    status: input.status ?? "active",
    source: input.source ?? "manual_edit",
    preconditions: input.preconditions ?? [],
    actionPolicies: input.actionPolicies ?? [],
    expectations: input.expectations ?? [],
    failurePolicy: input.failurePolicy,
    platformScope: input.platformScope ?? "android",
    reliabilityScore: input.reliabilityScore ?? 0.9
  };
}
