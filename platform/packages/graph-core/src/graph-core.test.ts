import { describe, expect, it } from "vitest";
import {
  applyRuntimeOverlayToExecutionPlan,
  buildExecutionPlan,
  detectNode,
  planRoute,
  resolveTargetNode,
  type ActionPolicy,
  type BusinessGraphVersion,
  type BusinessNode,
  type Observation,
  type OperationEdge,
  type StateMatcher
} from "./index.js";

describe("graph-core target resolver", () => {
  it("resolves a business target by node key and text matcher without using AI", () => {
    const graphVersion = graph({
      nodes: [
        node("root", "root", matcher("activity", "LauncherActivity")),
        {
          ...node("homework_create", "page", matcher("text", "新建作业")),
          key: "homework.create",
          name: "新建作业页"
        }
      ],
      edges: []
    });

    expect(
      resolveTargetNode(graphVersion, {
        key: "homework.create",
        platform: "android"
      })
    ).toEqual(expect.objectContaining({ status: "resolved", targetNode: expect.objectContaining({ id: "homework_create" }) }));

    expect(
      resolveTargetNode(graphVersion, {
        text: "新建作业",
        platform: "android"
      })
    ).toEqual(expect.objectContaining({ status: "resolved", targetNode: expect.objectContaining({ id: "homework_create" }) }));
  });

  it("returns ambiguity instead of guessing when multiple nodes match a weak target", () => {
    const graphVersion = graph({
      nodes: [node("dialog-a", "business_state", matcher("text", "允许")), node("dialog-b", "business_state", matcher("text", "允许"))],
      edges: []
    });

    const result = resolveTargetNode(graphVersion, {
      text: "允许",
      platform: "android"
    });

    expect(result.status).toBe("ambiguous");
    expect(result.candidates.map((candidate) => candidate.node.id)).toEqual(["dialog-a", "dialog-b"]);
  });
});

describe("graph-core route planner", () => {
  it("plans an active route from root to target with a stable snapshot", () => {
    const graphVersion = graph({
      nodes: [
        node("root", "root", matcher("activity", "LauncherActivity")),
        node("home", "page", matcher("resource_id", "com.demo:id/home")),
        node("homework_create", "page", matcher("text", "新建作业"))
      ],
      edges: [
        edge("edge-root-home", "root", "home", action("tap-home"), 0.9),
        edge("edge-home-homework", "home", "homework_create", action("tap-homework"), 0.8)
      ]
    });

    const plan = planRoute({
      graphVersion,
      appId: "classin-android",
      targetApp: targetApp(),
      targetNodeId: "homework_create",
      platform: "android",
      now: "2026-06-11T00:00:00.000Z",
      idFactory: (prefix) => `${prefix}-fixed`
    });

    expect(plan.id).toBe("route-fixed");
    expect(plan.unresolvedIssues).toEqual([]);
    expect(plan.nodes.map((item) => item.id)).toEqual(["root", "home", "homework_create"]);
    expect(plan.edges.map((item) => item.edge.id)).toEqual(["edge-root-home", "edge-home-homework"]);
    expect(plan.snapshot).toEqual({
      graphVersionId: "graph-version-1",
      nodeIds: ["root", "home", "homework_create"],
      edgeIds: ["edge-root-home", "edge-home-homework"],
      createdAt: "2026-06-11T00:00:00.000Z"
    });
  });

  it("requires a concrete target app binding before planning a formal graph route", () => {
    const graphVersion = graph({
      nodes: [node("root", "root", matcher("activity", "LauncherActivity")), node("home", "page", matcher("text", "首页"))],
      edges: [edge("edge-root-home", "root", "home", action("tap-home"))]
    });

    const plan = planRoute({
      graphVersion,
      appId: "classin-android",
      targetNodeId: "home",
      platform: "android"
    });

    expect(plan.edges).toEqual([]);
    expect(plan.unresolvedIssues).toEqual([
      expect.objectContaining({
        code: "GRAPH_APP_BINDING_MISSING",
        severity: "error"
      })
    ]);
  });

  it("returns a blocking issue when the target node is unreachable", () => {
    const graphVersion = graph({
      nodes: [node("root", "root", matcher("activity", "LauncherActivity")), node("settings", "page", matcher("text", "设置"))],
      edges: []
    });

    const plan = planRoute({
      graphVersion,
      appId: "classin-android",
      targetApp: targetApp(),
      targetNodeId: "settings",
      platform: "android"
    });

    expect(plan.edges).toEqual([]);
    expect(plan.unresolvedIssues).toEqual([
      expect.objectContaining({
        code: "TARGET_NODE_UNREACHABLE",
        severity: "error",
        nodeId: "settings"
      })
    ]);
  });

  it("filters unsupported platforms before planning", () => {
    const graphVersion = graph({
      nodes: [
        node("root", "root", matcher("activity", "LauncherActivity")),
        {
          ...node("ios-only", "page", matcher("text", "iOS")),
          platformScope: "ios"
        }
      ],
      edges: [edge("edge-root-ios", "root", "ios-only", action("tap-ios"))]
    });

    const plan = planRoute({
      graphVersion,
      appId: "classin-android",
      targetApp: targetApp(),
      targetNodeId: "ios-only",
      platform: "android"
    });

    expect(plan.unresolvedIssues).toEqual([
      expect.objectContaining({
        code: "TARGET_NODE_NOT_FOUND",
        severity: "error",
        nodeId: "ios-only"
      })
    ]);
  });

  it("keeps validation issues visible for missing matcher and action policy", () => {
    const graphVersion = graph({
      nodes: [node("root", "root", matcher("activity", "LauncherActivity")), node("empty", "page")],
      edges: [edge("edge-root-empty", "root", "empty")]
    });

    const plan = planRoute({
      graphVersion,
      appId: "classin-android",
      targetApp: targetApp(),
      targetNodeId: "empty",
      platform: "android"
    });

    expect(plan.nodes.map((item) => item.id)).toEqual(["root", "empty"]);
    expect(plan.unresolvedIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MISSING_MATCHER",
          severity: "warning",
          nodeId: "empty"
        }),
        expect.objectContaining({
          code: "MISSING_ACTION_POLICY",
          severity: "error",
          edgeId: "edge-root-empty"
        })
      ])
    );
  });

  it("rejects coordinate-only actions in formal business graph routes", () => {
    const graphVersion = graph({
      nodes: [node("root", "root", matcher("activity", "LauncherActivity")), node("home", "page", matcher("text", "首页"))],
      edges: [edge("edge-root-home", "root", "home", coordinateAction("coordinate-tap"))]
    });

    const plan = planRoute({
      graphVersion,
      appId: "classin-android",
      targetApp: targetApp(),
      targetNodeId: "home",
      platform: "android"
    });

    expect(plan.unresolvedIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSTABLE_COORDINATE_ACTION",
          severity: "error",
          edgeId: "edge-root-home"
        })
      ])
    );
  });
});

describe("graph-core execution planner", () => {
  it("expands a route plan into executable steps with action policy, expectations, and guards", () => {
    const graphVersion = graph({
      nodes: [
        node("root", "root", matcher("activity", "LauncherActivity")),
        {
          ...node("home", "page", matcher("resource_id", "com.demo:id/home")),
          defaultExpectations: [expectation("expect-home-title", "text", { expected: "首页" })]
        },
        {
          ...node("homework_create", "page", matcher("text", "新建作业")),
          defaultExpectations: [expectation("expect-homework-editor", "text", { expected: "作业编辑器" })]
        }
      ],
      edges: [
        edge("edge-root-home", "root", "home", action("tap-home"), 0.9),
        {
          ...edge("edge-home-homework", "home", "homework_create", action("tap-homework"), 0.8),
          preconditions: [expectation("pre-home-ready", "text", { expected: "首页" })],
          expectations: [expectation("expect-homework", "text", { expected: "新建作业" })],
          actionPolicies: [action("tap-homework"), { ...action("tap-homework-coordinate"), priority: 2, fallback: true, reliabilityHint: "low" }]
        }
      ]
    });
    const routePlan = planRoute({
      graphVersion,
      appId: "demo-android",
      targetApp: targetApp("com.demo"),
      targetNodeId: "homework_create",
      platform: "android",
      now: "2026-06-11T00:00:00.000Z",
      idFactory: (prefix) => `${prefix}-route`
    });

    const executionPlan = buildExecutionPlan({
      routePlan,
      platform: "android",
      now: "2026-06-11T00:00:01.000Z",
      idFactory: (prefix) => `${prefix}-exec`
    });

    expect(executionPlan.id).toBe("execution_plan-exec");
    expect(executionPlan.routePlanId).toBe("route-route");
    expect(executionPlan.unresolvedIssues).toEqual([]);
    expect(executionPlan.steps).toHaveLength(2);
    expect(executionPlan.steps[0]).toEqual(
      expect.objectContaining({
        edgeId: "edge-root-home",
        executionMode: "action",
        action: expect.objectContaining({ id: "tap-home", type: "tap_on_element" })
      })
    );
    expect(executionPlan.steps[1]).toEqual(
      expect.objectContaining({
        edgeId: "edge-home-homework",
        preconditions: expect.arrayContaining([expect.objectContaining({ id: "expect-home-title" }), expect.objectContaining({ id: "pre-home-ready" })]),
        selectedActionPolicy: expect.objectContaining({ id: "tap-homework", fallback: false }),
        fallbackActionPolicies: [expect.objectContaining({ id: "tap-homework-coordinate", fallback: true })],
        expectations: [expect.objectContaining({ id: "expect-homework" }), expect.objectContaining({ id: "expect-homework-editor" })],
        systemGuards: [
          expect.objectContaining({ type: "no_crash", enabled: true }),
          expect.objectContaining({ type: "app_alive", enabled: true })
        ]
      })
    );
    expect(executionPlan.snapshot).toEqual({
      routePlanId: "route-route",
      graphVersionId: "graph-version-1",
      nodeIds: ["root", "home", "homework_create"],
      edgeIds: ["edge-root-home", "edge-home-homework"],
      actionIds: ["tap-home", "tap-homework"],
      createdAt: "2026-06-11T00:00:01.000Z"
    });
  });

  it("applies runtime overlay expectations to the matching edge and target node without mutating graph assets", () => {
    const graphVersion = graph({
      nodes: [
        node("root", "root", matcher("activity", "LauncherActivity")),
        {
          ...node("home", "page", matcher("resource_id", "com.demo:id/home")),
          defaultExpectations: [expectation("expect-home-title", "text", { expected: "首页" })]
        },
        {
          ...node("homework_create", "page", matcher("text", "新建作业")),
          defaultExpectations: [expectation("expect-homework-editor", "text", { expected: "作业编辑器" })]
        }
      ],
      edges: [
        edge("edge-root-home", "root", "home", action("tap-home"), 0.9),
        {
          ...edge("edge-home-homework", "home", "homework_create", action("tap-homework"), 0.8),
          expectations: [expectation("expect-homework", "text", { expected: "新建作业" })]
        }
      ]
    });
    const routePlan = planRoute({
      graphVersion,
      appId: "classin-android",
      targetApp: targetApp(),
      targetNodeId: "homework_create",
      platform: "android"
    });
    const executionPlan = buildExecutionPlan({
      routePlan,
      platform: "android"
    });

    const overlaid = applyRuntimeOverlayToExecutionPlan(executionPlan, {
      id: "overlay-1",
      nodeExpectationOverrides: [
        {
          nodeId: "homework_create",
          expectations: [expectation("overlay-target-text", "text", { expected: "新版作业编辑器" })]
        }
      ],
      edgeExpectationOverrides: [
        {
          edgeId: "edge-home-homework",
          expectations: [expectation("overlay-edge-text", "text", { expected: "发布按钮" })]
        }
      ],
      note: "AI changed target page copy"
    });

    expect(executionPlan.steps[1]?.expectations.map((item) => item.id)).not.toContain("overlay-target-text");
    expect(overlaid.steps[1]?.expectations.map((item) => item.id)).toEqual(
      expect.arrayContaining(["expect-homework", "expect-homework-editor", "overlay-target-text", "overlay-edge-text"])
    );
    expect(overlaid.steps[1]?.runtimeOverlay).toEqual({
      id: "overlay-1",
      note: "AI changed target page copy",
      targetExpectationIds: ["overlay-target-text"],
      edgeExpectationIds: ["overlay-edge-text"]
    });
    expect(graphVersion.nodes.find((item) => item.id === "homework_create")?.defaultExpectations.map((item) => item.id)).toEqual(["expect-homework-editor"]);
  });

  it("applies runtime params to action templates without mutating graph assets", () => {
    const graphVersion = graph({
      nodes: [node("home", "page", matcher("ocr_text", "主页")), node("class_detail", "page", matcher("ocr_text", "班级详情"))],
      edges: [
        {
          ...edge("edge-home-class-detail", "home", "class_detail", undefined, 0.8),
          actionPolicies: [
            {
              ...action("tap-class-grid"),
              action: {
                id: "tap-class-grid",
                order: 1,
                type: "tap_on_image",
                enabled: true,
                params: {
                  abilityType: "grid_candidate",
                  region: { x: 3, y: 30, width: 94, height: 60 },
                  scrollProfile: {
                    containerKind: "grid_list",
                    targetKind: "item_text",
                    targetQuery: "{{className}}"
                  }
                },
                createdAt: "2026-06-11T00:00:00.000Z"
              }
            }
          ]
        }
      ]
    });
    const routePlan = planRoute({
      graphVersion,
      appId: "classin-android",
      targetApp: targetApp(),
      startNodeId: "home",
      targetNodeId: "class_detail",
      platform: "android"
    });
    const executionPlan = buildExecutionPlan({ routePlan, platform: "android" });

    const overlaid = applyRuntimeOverlayToExecutionPlan(executionPlan, {
      id: "overlay-class-name",
      runtimeParams: {
        className: "班级四十一号"
      }
    });

    expect(executionPlan.steps[0]?.action?.params.scrollProfile).toEqual(
      expect.objectContaining({
        targetQuery: "{{className}}"
      })
    );
    expect(overlaid.steps[0]?.action?.params.scrollProfile).toEqual(
      expect.objectContaining({
        targetQuery: "班级四十一号"
      })
    );
    expect(overlaid.steps[0]?.runtimeOverlay).toEqual(
      expect.objectContaining({
        id: "overlay-class-name",
        runtimeParamKeys: ["className"]
      })
    );
  });

  it("uses className runtime param to target legacy grid candidates by text", () => {
    const graphVersion = graph({
      nodes: [node("home", "page", matcher("ocr_text", "主页")), node("class_detail", "page", matcher("ocr_text", "班级详情"))],
      edges: [
        {
          ...edge("edge-home-class-detail", "home", "class_detail", undefined, 0.8),
          actionPolicies: [
            {
              ...action("tap-class-grid"),
              action: {
                id: "tap-class-grid",
                order: 1,
                type: "tap_on_image",
                enabled: true,
                params: {
                  abilityType: "grid_candidate",
                  region: { x: 3, y: 30, width: 94, height: 60 },
                  candidateIndex: 0,
                  scrollProfile: {
                    containerKind: "grid_list",
                    targetKind: "nth_item",
                    columns: 2
                  }
                },
                createdAt: "2026-06-11T00:00:00.000Z"
              }
            }
          ]
        }
      ]
    });
    const routePlan = planRoute({
      graphVersion,
      appId: "classin-android",
      targetApp: targetApp(),
      startNodeId: "home",
      targetNodeId: "class_detail",
      platform: "android"
    });
    const executionPlan = buildExecutionPlan({ routePlan, platform: "android" });

    const overlaid = applyRuntimeOverlayToExecutionPlan(executionPlan, {
      id: "overlay-class-name",
      runtimeParams: {
        className: "班级四十二号"
      }
    });

    expect(executionPlan.steps[0]?.action?.params.scrollProfile).toEqual(
      expect.objectContaining({
        targetKind: "nth_item"
      })
    );
    expect(overlaid.steps[0]?.action?.params.scrollProfile).toEqual(
      expect.objectContaining({
        targetKind: "item_text",
        targetQuery: "班级四十二号"
      })
    );
  });

  it("builds a noop target validation step when the current node is already the target", () => {
    const graphVersion = graph({
      nodes: [
        node("root", "root", matcher("activity", "LauncherActivity")),
        {
          ...node("homework_create", "page", matcher("text", "新建作业")),
          defaultExpectations: [expectation("expect-homework-editor", "text", { expected: "作业编辑器" })]
        }
      ],
      edges: []
    });
    const routePlan = planRoute({
      graphVersion,
      appId: "classin-android",
      targetApp: targetApp(),
      startNodeId: "homework_create",
      targetNodeId: "homework_create",
      platform: "android",
      now: "2026-06-11T00:00:00.000Z",
      idFactory: (prefix) => `${prefix}-target`
    });

    const executionPlan = buildExecutionPlan({
      routePlan,
      platform: "android",
      now: "2026-06-11T00:00:01.000Z",
      idFactory: (prefix) => `${prefix}-target`
    });
    const overlaid = applyRuntimeOverlayToExecutionPlan(executionPlan, {
      id: "overlay-target",
      nodeExpectationOverrides: [
        {
          nodeId: "homework_create",
          expectations: [expectation("overlay-homework-copy", "text", { expected: "新版课堂文案" })]
        }
      ]
    });

    expect(routePlan.edges).toEqual([]);
    expect(overlaid.steps).toHaveLength(1);
    expect(overlaid.steps[0]).toEqual(
      expect.objectContaining({
        edgeId: "__target_validation__",
        edgeKey: "target.validation",
        executionMode: "noop",
        fromNode: expect.objectContaining({ id: "homework_create" }),
        toNode: expect.objectContaining({ id: "homework_create" }),
        expectations: expect.arrayContaining([
          expect.objectContaining({ id: "expect-homework-editor" }),
          expect.objectContaining({ id: "overlay-homework-copy" })
        ]),
        runtimeOverlay: expect.objectContaining({
          id: "overlay-target",
          targetExpectationIds: ["overlay-homework-copy"],
          edgeExpectationIds: []
        })
      })
    );
    expect(overlaid.steps[0]?.systemGuards.map((item) => item.type)).toEqual(["no_crash", "app_alive"]);
  });

  it("marks an execution step blocked when the edge has no action policy", () => {
    const graphVersion = graph({
      nodes: [node("root", "root", matcher("activity", "LauncherActivity")), node("empty", "page", matcher("text", "空页面"))],
      edges: [edge("edge-root-empty", "root", "empty")]
    });
    const routePlan = planRoute({
      graphVersion,
      appId: "demo-android",
      targetApp: targetApp("com.demo"),
      targetNodeId: "empty",
      platform: "android"
    });

    const executionPlan = buildExecutionPlan({
      routePlan,
      platform: "android",
      idFactory: (prefix) => `${prefix}-blocked`
    });

    expect(executionPlan.steps[0]).toEqual(
      expect.objectContaining({
        edgeId: "edge-root-empty",
        executionMode: "blocked",
        action: undefined,
        issues: [expect.objectContaining({ code: "MISSING_ACTION_POLICY", severity: "error", edgeId: "edge-root-empty" })]
      })
    );
    expect(executionPlan.unresolvedIssues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_ACTION_POLICY", edgeId: "edge-root-empty" })]));
  });

  it("selects a deterministic action over coordinate actions even when the coordinate policy has higher priority", () => {
    const graphVersion = graph({
      nodes: [node("root", "root", matcher("activity", "LauncherActivity")), node("home", "page", matcher("text", "首页"))],
      edges: [
        {
          ...edge("edge-root-home", "root", "home"),
          actionPolicies: [coordinateAction("coordinate-primary", 1, false), action("semantic-home", 2, false)]
        }
      ]
    });
    const routePlan = planRoute({
      graphVersion,
      appId: "demo-android",
      targetApp: targetApp("com.demo"),
      targetNodeId: "home",
      platform: "android"
    });

    const executionPlan = buildExecutionPlan({
      routePlan,
      platform: "android"
    });

    expect(executionPlan.steps[0]).toEqual(
      expect.objectContaining({
        executionMode: "action",
        selectedActionPolicy: expect.objectContaining({ id: "semantic-home" }),
        action: expect.objectContaining({ type: "tap_on_element" }),
        fallbackActionPolicies: expect.arrayContaining([expect.objectContaining({ id: "coordinate-primary" })])
      })
    );
  });

  it("blocks execution when a route edge only has coordinate actions", () => {
    const graphVersion = graph({
      nodes: [node("root", "root", matcher("activity", "LauncherActivity")), node("home", "page", matcher("text", "首页"))],
      edges: [edge("edge-root-home", "root", "home", coordinateAction("coordinate-only"))]
    });
    const routePlan = planRoute({
      graphVersion,
      appId: "demo-android",
      targetApp: targetApp("com.demo"),
      targetNodeId: "home",
      platform: "android"
    });

    const executionPlan = buildExecutionPlan({
      routePlan,
      platform: "android"
    });

    expect(executionPlan.steps[0]).toEqual(
      expect.objectContaining({
        executionMode: "blocked",
        action: undefined,
        issues: [expect.objectContaining({ code: "UNSTABLE_COORDINATE_ACTION", edgeId: "edge-root-home" })]
      })
    );
    expect(executionPlan.unresolvedIssues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "UNSTABLE_COORDINATE_ACTION", edgeId: "edge-root-home" })]));
  });
});

describe("graph-core state detector", () => {
  it("matches the current node using activity, resource-id, and UI text", () => {
    const graphVersion = graph({
      nodes: [
        node("root", "root", matcher("activity", "SplashActivity", 3)),
        node(
          "home",
          "page",
          matcher("package", "com.demo", 2),
          matcher("activity", "com.demo.HomeActivity", 3),
          matcher("resource_id", "com.demo:id/join_class", 2),
          matcher("text", "进入课堂", 1)
        )
      ],
      edges: []
    });

    const result = detectNode(observation(), graphVersion, "android");

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("home");
    expect(result.score).toBe(1);
    expect(result.candidates[0]?.matcherResults.every((item) => item.matched)).toBe(true);
  });

  it("uses OCR text as a fallback signal when UI tree text is unavailable", () => {
    const graphVersion = graph({
      nodes: [
        node("home", "page", matcher("activity", "HomeActivity", 2), matcher("ocr_text", "全部班级", 1)),
        node("settings", "page", matcher("activity", "SettingsActivity", 2), matcher("ocr_text", "设置", 1))
      ],
      edges: []
    });

    const result = detectNode(
      {
        ...observation(),
        activityName: "com.demo.HomeActivity",
        uiElements: [],
        ocrTexts: [{ text: "首页 全部班级 我是老师", confidence: 0.9, source: "ocr" }]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("home");
    expect(result.candidates[0]?.matcherResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "activity", matched: true }),
        expect.objectContaining({ type: "ocr_text", matched: true })
      ])
    );
  });

  it("returns unknown when no candidate reaches the minimum score", () => {
    const graphVersion = graph({
      nodes: [node("home", "page", matcher("activity", "HomeActivity", 2), matcher("resource_id", "com.demo:id/home", 2))],
      edges: []
    });

    const result = detectNode(
      {
        ...observation(),
        activityName: "com.demo.OtherActivity",
        uiElements: []
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("unknown");
    expect(result.node).toBeUndefined();
    expect(result.score).toBeLessThan(result.threshold);
  });

  it("does not match a business node from app context and a single weak text signal", () => {
    const graphVersion = graph({
      nodes: [node("home-shell", "page", matcher("package", "com.demo", 2), matcher("text", "首页", 4))],
      edges: []
    });

    const result = detectNode(
      {
        ...observation(),
        uiElements: [{ text: "首页" }],
        ocrTexts: []
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("unknown");
    expect(result.candidates[0]?.quality).toEqual(
      expect.objectContaining({
        status: "low_confidence",
        reasons: ["single_weak_state_signal"],
        matchedContextSignals: 1,
        matchedWeakSignals: 1
      })
    );
  });

  it("accepts two weak state signals as a fallback when no strong state anchor exists", () => {
    const graphVersion = graph({
      nodes: [node("teacher-classes", "page", matcher("package", "com.demo", 2), matcher("text", "我是教师", 2), matcher("ocr_text", "全部班级", 2))],
      edges: []
    });

    const result = detectNode(
      {
        ...observation(),
        uiElements: [{ text: "我是教师" }],
        ocrTexts: [{ text: "全部班级", confidence: 0.92, source: "ocr" }]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("teacher-classes");
    expect(result.candidates[0]?.quality).toEqual(
      expect.objectContaining({
        status: "sufficient",
        reasons: [],
        matchedWeakSignals: 2
      })
    );
  });

  it("requires configured strong state anchors to match before accepting weak text evidence", () => {
    const graphVersion = graph({
      nodes: [node("class-detail", "page", matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/activity_list", 3), matcher("text", "课节", 4))],
      edges: []
    });

    const result = detectNode(
      {
        ...observation(),
        uiElements: [{ text: "课节" }],
        ocrTexts: []
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("unknown");
    expect(result.candidates[0]?.quality).toEqual(
      expect.objectContaining({
        status: "low_confidence",
        reasons: ["strong_state_anchor_missing"],
        missingStrongMatcherIds: ["resource_id-com.demo:id/activity_list"]
      })
    );
  });

  it("rejects a node when a configured critical matcher is missing even if other evidence is strong", () => {
    const graphVersion = graph({
      nodes: [
        node(
          "class-detail",
          "page",
          matcher("package", "com.demo", 2),
          { ...matcher("activity", "ClassDetailActivity", 3), critical: true },
          matcher("resource_id", "com.demo:id/activity_list", 3),
          matcher("text", "课节", 3)
        )
      ],
      edges: []
    });

    const result = detectNode(
      {
        ...observation(),
        activityName: "com.demo.OtherActivity",
        uiElements: [{ resourceId: "com.demo:id/activity_list" }, { text: "课节" }],
        ocrTexts: []
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("unknown");
    expect(result.candidates[0]?.quality).toEqual(
      expect.objectContaining({
        status: "low_confidence",
        reasons: expect.arrayContaining(["critical_matcher_missing"]),
        missingCriticalMatcherIds: ["activity-ClassDetailActivity"]
      })
    );
  });

  it("ignores derived region OCR noise when its image region anchor already matched", () => {
    const sharedRegion = { x: 3.4, y: 90.36, width: 92.39, height: 7.36 };
    const graphVersion = graph({
      nodes: [
        node(
          "home",
          "page",
          {
            ...matcher("image_region", "screenshot-region:bottom:%E5%87%BA%E5%8B%A4%200%2F2", 3),
            critical: true,
            region: sharedRegion,
            threshold: 0.9
          },
          {
            ...matcher("ocr_text", "40", 2.4),
            critical: true,
            region: sharedRegion,
            source: { sourceType: "manual_edit", confidence: 0.9 }
          },
          {
            ...matcher("ocr_text", "71", 2.4),
            critical: true,
            region: sharedRegion,
            source: { sourceType: "manual_edit", confidence: 0.9 }
          },
          matcher("ocr_text", "主页", 1.8),
          matcher("ocr_text", "我是教师", 1.8),
          matcher("ocr_text", "全部班级", 1.8)
        )
      ],
      edges: []
    });

    const result = detectNode(
      {
        ...observation(),
        uiElements: [],
        ocrTexts: [
          { text: "主页", confidence: 0.9, source: "ocr" },
          { text: "我是教师", confidence: 0.9, source: "ocr" },
          { text: "全部班级", confidence: 0.9, source: "ocr" }
        ],
        imageRegions: [{ value: "screenshot-region:bottom:%E5%87%BA%E5%8B%A4%200%2F2", region: sharedRegion, similarity: 0.99 }]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("home");
    expect(result.candidates[0]?.quality.missingCriticalMatcherIds).toEqual([]);
  });

  it("does not let one changed screenshot region veto a page when other page anchors match", () => {
    const titleRegion = { x: 16.84, y: 7.64, width: 13.81, height: 4.33 };
    const toolbarRegion = { x: 69.1, y: 7.45, width: 25.74, height: 5.79 };
    const dynamicBottomRegion = { x: 3.1, y: 90.87, width: 95.09, height: 7.44 };
    const graphVersion = graph({
      nodes: [
        node(
          "home",
          "page",
          {
            ...matcher("image_region", "screenshot-region:title:%E4%B8%BB%E9%A1%B5", 3),
            critical: true,
            region: titleRegion,
            threshold: 0.9
          },
          {
            ...matcher("image_region", "screenshot-region:toolbar:contact%7Csearch", 3),
            critical: true,
            region: toolbarRegion,
            threshold: 0.9
          },
          {
            ...matcher("image_region", "screenshot-region:dynamic-bottom:%E5%87%BA%E5%8B%A4%200%2F2", 3),
            critical: true,
            region: dynamicBottomRegion,
            threshold: 0.9
          },
          matcher("ocr_text", "主页", 1.8),
          matcher("ocr_text", "我是教师", 1.8),
          matcher("ocr_text", "全部班级", 1.8)
        )
      ],
      edges: []
    });

    const result = detectNode(
      {
        ...observation(),
        ocrTexts: [
          { text: "主页", confidence: 0.9, source: "ocr" },
          { text: "我是教师", confidence: 0.9, source: "ocr" },
          { text: "全部班级", confidence: 0.9, source: "ocr" }
        ],
        imageRegions: [
          { value: "screenshot-region:title:%E4%B8%BB%E9%A1%B5", region: titleRegion, similarity: 1 },
          { value: "screenshot-region:toolbar:contact%7Csearch", region: toolbarRegion, similarity: 1 },
          { value: "screenshot-region:dynamic-bottom:%E5%87%BA%E5%8B%A4%200%2F2", region: dynamicBottomRegion, similarity: 0.52 }
        ]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("home");
    expect(result.candidates[0]?.quality.missingCriticalMatcherIds).toEqual([]);
  });

  it("does not let non-critical semantic image regions satisfy missing critical pixel regions", () => {
    const titleRegion = { x: 15.52, y: 7.15, width: 16.38, height: 5.06 };
    const toolbarRegion = { x: 70.58, y: 6.91, width: 23.12, height: 5.35 };
    const bottomRegion = { x: 2.2, y: 90.87, width: 93.9, height: 7.1 };
    const graphVersion = graph({
      nodes: [
        node(
          "message",
          "page",
          {
            ...matcher("image_region", "screenshot-region:message-title:%E6%B6%88%E6%81%AF", 3),
            critical: true,
            region: titleRegion,
            threshold: 0.9
          },
          {
            ...matcher("image_region", "screenshot-region:message-toolbar:contact%7Csearch", 3),
            critical: true,
            region: toolbarRegion,
            threshold: 0.9
          },
          {
            ...matcher("image_region", "screenshot-region:message-bottom:fixed_bottom_navigation_container", 3),
            critical: true,
            region: bottomRegion,
            threshold: 0.9
          },
          {
            ...matcher("semantic_image_region", "semantic-image-region:message-title:%E6%B6%88%E6%81%AF", 2.2),
            region: titleRegion,
            threshold: 0.68
          },
          {
            ...matcher("semantic_image_region", "semantic-image-region:message-toolbar:contact%7Csearch", 2.2),
            region: toolbarRegion,
            threshold: 0.68
          },
          {
            ...matcher("semantic_image_region", "semantic-image-region:message-bottom:fixed_bottom_navigation_container", 2.2),
            region: bottomRegion,
            threshold: 0.68
          },
          {
            ...matcher("ocr_text", "消息", 1.8),
            critical: true,
            region: { x: 16.35, y: 8.74, width: 13.21, height: 2.91 }
          }
        )
      ],
      edges: []
    });

    const result = detectNode(
      {
        ...observation(),
        ocrTexts: [{ text: "消息", confidence: 0.9, source: "ocr", region: { x: 170, y: 205, width: 140, height: 68 } }],
        resolution: { width: 1080, height: 2340 },
        imageRegions: [
          { value: "screenshot-region:message-title:%E6%B6%88%E6%81%AF", region: titleRegion, similarity: 0.87 },
          { value: "screenshot-region:message-toolbar:contact%7Csearch", region: toolbarRegion, similarity: 0.88 },
          { value: "screenshot-region:message-bottom:fixed_bottom_navigation_container", region: bottomRegion, similarity: 0.86 },
          { value: "semantic-image-region:message-title:%E6%B6%88%E6%81%AF", region: titleRegion, similarity: 1 },
          { value: "semantic-image-region:message-toolbar:contact%7Csearch", region: toolbarRegion, similarity: 1 },
          { value: "semantic-image-region:message-bottom:fixed_bottom_navigation_container", region: bottomRegion, similarity: 1 }
        ]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("unknown");
    expect(result.node).toBeUndefined();
    expect(result.candidates[0]?.quality.missingCriticalMatcherIds).toEqual([
      "image_region-screenshot-region:message-title:%E6%B6%88%E6%81%AF",
      "image_region-screenshot-region:message-toolbar:contact%7Csearch",
      "image_region-screenshot-region:message-bottom:fixed_bottom_navigation_container"
    ]);
  });

  it("returns multiple candidates when active nodes tie above threshold", () => {
    const graphVersion = graph({
      nodes: [
        node("dialog-a", "business_state", matcher("ocr_text", "允许", 1)),
        node("dialog-b", "business_state", matcher("ocr_text", "允许", 1))
      ],
      edges: []
    });

    const result = detectNode(
      {
        ...observation(),
        ocrTexts: [{ text: "允许 通知权限", source: "ocr" }]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("multiple_candidates");
    expect(result.candidates.map((item) => item.node.id)).toEqual(["dialog-a", "dialog-b"]);
  });

  it("prefers the more specific state when broad and detailed page nodes both match", () => {
    const graphVersion = graph({
      nodes: [
        node("home-shell", "page", matcher("package", "cn.eeo.classin", 2), matcher("text", "主页", 1)),
        node(
          "teacher-classes",
          "page",
          matcher("package", "cn.eeo.classin", 2),
          matcher("text", "主页", 1),
          matcher("text", "我是教师", 3),
          matcher("text", "全部班级", 2)
        )
      ],
      edges: []
    });

    const result = detectNode(
      {
        ...observation(),
        packageName: "cn.eeo.classin",
        uiElements: [{ text: "主页" }, { text: "我是教师" }, { text: "全部班级" }],
        ocrTexts: []
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("teacher-classes");
    expect(result.candidates[0]?.matchedWeight).toBeGreaterThan(result.candidates[1]?.matchedWeight ?? 0);
  });

  it("matches image region signals when similarity reaches the configured threshold", () => {
    const graphVersion = graph({
      nodes: [
        {
          ...node("canvas-home", "page", matcher("image_region", "homework-card", 1)),
          matchers: [
            {
              ...matcher("image_region", "homework-card", 1),
              threshold: 0.92
            }
          ]
        }
      ],
      edges: []
    });

    const result = detectNode(
      {
        ...observation(),
        imageRegions: [
          {
            value: "homework-card",
            similarity: 0.95,
            region: {
              x: 100,
              y: 200,
              width: 300,
              height: 180
            }
          }
        ]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("canvas-home");
  });

  it("matches semantic image region signals when lightweight similarity reaches the configured threshold", () => {
    const semanticValue = "semantic-image-region:bottom-tabs:%E4%B8%BB%E9%A1%B5%7C%E6%B6%88%E6%81%AF%7C%E8%AF%BE%E7%A8%8B%E8%A1%A8";
    const graphVersion = graph({
      nodes: [
        {
          ...node("home-bottom-tabs", "page", matcher("semantic_image_region", semanticValue, 1)),
          matchers: [
            {
              ...matcher("semantic_image_region", semanticValue, 1),
              threshold: 0.68
            }
          ]
        }
      ],
      edges: []
    });

    const result = detectNode(
      {
        ...observation(),
        imageRegions: [
          {
            value: semanticValue,
            similarity: 0.72,
            region: {
              x: 0,
              y: 90,
              width: 100,
              height: 10
            }
          }
        ]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("home-bottom-tabs");
  });

  it("treats page-local bottom OCR tabs as page identity instead of common app navigation", () => {
    const graphVersion = graph({
      nodes: [
        {
          ...node("class-detail", "page"),
          matchers: [
            {
              ...matcher("ocr_text", "目录", 1.8),
              critical: true,
              region: { x: 15, y: 91, width: 14, height: 5 }
            },
            {
              ...matcher("ocr_text", "聊天", 1.8),
              critical: true,
              region: { x: 35, y: 91, width: 14, height: 5 }
            },
            {
              ...matcher("ocr_text", "待办", 1.8),
              critical: true,
              region: { x: 55, y: 91, width: 14, height: 5 }
            },
            {
              ...matcher("ocr_text", "公告", 1.8),
              critical: true,
              region: { x: 75, y: 91, width: 14, height: 5 }
            }
          ]
        }
      ],
      edges: []
    });

    const result = detectNode(
      {
        ...observation(),
        resolution: { width: 1080, height: 2400 },
        ocrTexts: [
          { text: "目录", region: { x: 162, y: 2184, width: 151, height: 80 }, source: "ocr" },
          { text: "聊天", region: { x: 378, y: 2184, width: 151, height: 80 }, source: "ocr" },
          { text: "待办", region: { x: 594, y: 2184, width: 151, height: 80 }, source: "ocr" },
          { text: "公告", region: { x: 810, y: 2184, width: 151, height: 80 }, source: "ocr" }
        ]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("class-detail");
    expect(result.candidates[0]?.quality).toEqual(
      expect.objectContaining({
        status: "sufficient",
        reasons: []
      })
    );
  });

  it("matches OCR text only inside the configured relative title region", () => {
    const graphVersion = graph({
      nodes: [
        {
          ...node("create-public-course", "page", matcher("ocr_text", "新建公开课", 3)),
          matchers: [
            {
              ...matcher("ocr_text", "新建公开课", 3),
              critical: true,
              region: { x: 0, y: 0, width: 100, height: 12 }
            }
          ]
        }
      ],
      edges: []
    });

    const bottomTextResult = detectNode(
      {
        ...observation(),
        ocrTexts: [{ text: "新建公开课", region: { x: 120, y: 2100, width: 240, height: 64 }, source: "ocr" }]
      },
      graphVersion,
      "android"
    );

    expect(bottomTextResult.status).toBe("unknown");
    expect(bottomTextResult.candidates[0]?.matcherResults[0]).toEqual(
      expect.objectContaining({
        type: "ocr_text",
        matched: false
      })
    );

    const titleTextResult = detectNode(
      {
        ...observation(),
        ocrTexts: [{ text: "新建公开课", region: { x: 120, y: 80, width: 240, height: 64 }, source: "ocr" }]
      },
      graphVersion,
      "android"
    );

    expect(titleTextResult.status).toBe("matched");
    expect(titleTextResult.node?.id).toBe("create-public-course");
  });

  it("matches OCR title text when old confirmed evidence contains leading symbol noise", () => {
    const graphVersion = graph({
      nodes: [
        {
          ...node("create-public-course", "page", matcher("ocr_text", "< 新建公开课", 3)),
          matchers: [
            {
              ...matcher("ocr_text", "< 新建公开课", 3),
              critical: true,
              region: { x: 0, y: 0, width: 100, height: 12 }
            }
          ]
        }
      ],
      edges: []
    });

    const bottomTextResult = detectNode(
      {
        ...observation(),
        ocrTexts: [{ text: "新建公开课", region: { x: 120, y: 2100, width: 240, height: 64 }, source: "ocr" }]
      },
      graphVersion,
      "android"
    );

    expect(bottomTextResult.status).toBe("unknown");

    const titleTextResult = detectNode(
      {
        ...observation(),
        ocrTexts: [{ text: "新建公开课", region: { x: 120, y: 80, width: 240, height: 64 }, source: "ocr" }]
      },
      graphVersion,
      "android"
    );

    expect(titleTextResult.status).toBe("matched");
    expect(titleTextResult.node?.id).toBe("create-public-course");
  });

  it("matches UI text only inside the configured relative title region", () => {
    const graphVersion = graph({
      nodes: [
        {
          ...node("create-public-course", "page", matcher("text", "新建公开课", 3)),
          matchers: [
            {
              ...matcher("text", "新建公开课", 3),
              critical: true,
              region: { x: 0, y: 0, width: 100, height: 12 }
            }
          ]
        }
      ],
      edges: []
    });

    const bottomTextResult = detectNode(
      {
        ...observation(),
        uiElements: [{ text: "新建公开课", bounds: { x: 120, y: 2100, width: 240, height: 64 } }],
        ocrTexts: []
      },
      graphVersion,
      "android"
    );

    expect(bottomTextResult.status).toBe("unknown");

    const titleTextResult = detectNode(
      {
        ...observation(),
        uiElements: [{ text: "新建公开课", bounds: { x: 120, y: 80, width: 240, height: 64 } }],
        ocrTexts: []
      },
      graphVersion,
      "android"
    );

    expect(titleTextResult.status).toBe("matched");
    expect(titleTextResult.node?.id).toBe("create-public-course");
  });
});

function graph(input: { nodes: BusinessNode[]; edges: OperationEdge[] }): BusinessGraphVersion {
  return {
    id: "graph-version-1",
    graphId: "graph-1",
    version: 1,
    sourceSummary: [],
    status: "active",
    nodes: input.nodes,
    edges: input.edges,
    createdAt: "2026-06-11T00:00:00.000Z"
  };
}

function node(id: string, nodeType: BusinessNode["nodeType"], ...matchers: StateMatcher[]): BusinessNode {
  return {
    id,
    graphVersionId: "graph-version-1",
    key: id,
    name: id,
    nodeType,
    tags: [],
    status: "active",
    matchers,
    defaultExpectations: []
  };
}

function edge(id: string, fromNodeId: string, toNodeId: string, actionPolicy?: ActionPolicy, reliabilityScore?: number): OperationEdge {
  return {
    id,
    graphVersionId: "graph-version-1",
    fromNodeId,
    toNodeId,
    key: id,
    name: id,
    intent: id,
    status: "active",
    source: "manual_edit",
    preconditions: [],
    actionPolicies: actionPolicy ? [actionPolicy] : [],
    expectations: [],
    reliabilityScore
  };
}

function matcher(type: StateMatcher["type"], value: string, weight = 1): StateMatcher {
  return {
    id: `${type}-${value}`,
    type,
    value,
    weight
  };
}

function action(id: string, priority = 1, fallback = false): ActionPolicy {
  return {
    id,
    priority,
    action: {
      id,
      order: 1,
      type: "tap_on_element",
      enabled: true,
      params: {
        locator: {
          strategy: "android_uiautomator",
          resourceId: `com.demo:id/${id}`
        }
      },
      createdAt: "2026-06-11T00:00:00.000Z"
    },
    fallback,
    reliabilityHint: "high"
  };
}

function coordinateAction(id: string, priority = 1, fallback = false): ActionPolicy {
  return {
    id,
    priority,
    action: {
      id,
      order: 1,
      type: "tap",
      enabled: true,
      params: {
        x: 120,
        y: 240
      },
      createdAt: "2026-06-11T00:00:00.000Z"
    },
    fallback,
    reliabilityHint: "low"
  };
}

function targetApp(androidPackageName = "cn.eeo.classin") {
  return {
    androidPackageName
  };
}

function expectation(id: string, type: "text" | "no_crash" | "app_alive", params: Record<string, unknown>) {
  return {
    id,
    type,
    enabled: true,
    params,
    createdAt: "2026-06-11T00:00:00.000Z"
  };
}

function observation(): Observation {
  return {
    id: "observation-1",
    deviceSerial: "device-1",
    platform: "android",
    capturedAt: "2026-06-11T00:00:00.000Z",
    packageName: "com.demo",
    activityName: "com.demo.HomeActivity",
    componentName: "com.demo/com.demo.HomeActivity",
    resolution: {
      width: 1080,
      height: 2400
    },
    orientation: "portrait",
    uiElements: [
      {
        resourceId: "com.demo:id/join_class",
        text: "进入课堂",
        packageName: "com.demo",
        className: "android.widget.Button",
        enabled: true,
        visible: true
      }
    ],
    ocrTexts: [{ text: "进入课堂 首页", confidence: 0.98, source: "ocr" }]
  };
}
