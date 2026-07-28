import { describe, expect, it } from "vitest";
import type { BusinessGraphVersion, BusinessNode } from "@mobile-automation/graph-core";
import { nowIso, type AssetCompositeCase, type MetaFunction, type ParameterProfile } from "@mobile-automation/shared";
import { assetCompositionCatalog, compileAssetCompositeCase } from "./asset-composition.js";

describe("compileAssetCompositeCase", () => {
  it("builds an editor catalog from confirmed page assets", () => {
    const catalog = assetCompositionCatalog(graphVersion());

    expect(catalog.pages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "page-home",
        name: "主页",
        elements: [expect.objectContaining({ id: "class-grid", label: "班级列表" })],
        transitions: [expect.objectContaining({ id: "transition-home-detail", elementId: "class-grid", targetPageModelId: "page-detail", parameterKeys: ["className"] })]
      }),
      expect.objectContaining({
        id: "page-create",
        tasks: [expect.objectContaining({ id: "task-fill-lesson", name: "填写课堂信息" })]
      })
    ]));
  });

  it("compiles capabilities from current manual page elements and active graph edges", () => {
    const version = graphVersion();
    const home = version.nodes.find((node) => node.id === "page-home")!;
    home.metadata = {
      assetRecordingConfirmed: true,
      assetRecordingManualElements: [
        {
          id: "class-grid",
          label: "班级列表",
          locator: "runtime-locator:class_grid",
          actionKind: "tap",
          outcomeType: "navigate",
          targetNodeId: "page-detail"
        }
      ]
    };
    version.edges = [
      {
        id: "edge-home-detail",
        graphVersionId: version.id,
        fromNodeId: "page-home",
        toNodeId: "page-detail",
        key: "home.detail",
        name: "主页 -> 班级详情",
        intent: "打开班级详情",
        status: "active",
        source: "manual_edit",
        preconditions: [],
        actionPolicies: [],
        expectations: [],
        failurePolicy: { retryCount: 1, recoverTo: "replan" },
        platformScope: "android",
        reliabilityScore: 0.9
      }
    ];

    const result = compileAssetCompositeCase({
      compositeCase: compositeCase(["meta-enter"]),
      metaFunctions: [enterClassMetaFunction()],
      parameterProfile: parameterProfile(),
      graphVersion: version
    });

    expect(result.status).toBe("ready");
    expect(result.steps[1]).toEqual(expect.objectContaining({
      pageElementId: "class-grid",
      pageTransitionId: "edge-home-detail",
      targetPageModelId: "page-detail"
    }));
    expect(assetCompositionCatalog(version).pages.find((page) => page.id === "page-home")).toEqual(
      expect.objectContaining({
        elements: [expect.objectContaining({ id: "class-grid", label: "班级列表" })],
        transitions: [expect.objectContaining({ id: "edge-home-detail", elementId: "class-grid", targetPageModelId: "page-detail" })]
      })
    );
  });

  it("keeps manual navigation target metadata in the catalog before an active edge exists", () => {
    const version = graphVersion();
    version.nodes = [
      pageNode("page-class-detail", "班级详情", {
        assetRecordingManualElements: [
          {
            id: "course-card",
            label: "课程卡片",
            locator: "image-region:14,52,72,8",
            actionKind: "tap",
            outcomeType: "navigate",
            targetNodeId: "page-course-detail"
          }
        ]
      }),
      pageNode("page-course-detail", "课程详情", {})
    ];
    version.edges = [];

    expect(assetCompositionCatalog(version).pages.find((page) => page.id === "page-class-detail")).toEqual(
      expect.objectContaining({
        elements: [
          expect.objectContaining({
            id: "course-card",
            label: "课程卡片",
            targetPageModelId: "page-course-detail",
            targetPageName: "课程详情",
            outcomeType: "navigate"
          })
        ],
        transitions: []
      })
    );
  });

  it("uses active operation edges that were not mirrored into page transition metadata", () => {
    const version = graphVersion();
    version.nodes = [
      pageNode("page-home", "主页", {
        assetRecordingManualElements: [
          {
            id: "manual-create-public",
            label: "创建公开课",
            locator: "image-region:53.85,15.84,38.63,7.33",
            actionKind: "tap"
          }
        ]
      }),
      pageNode("page-public", "新建公开课", {})
    ];
    version.edges = [
      {
        id: "edge-home-public",
        graphVersionId: version.id,
        fromNodeId: "page-home",
        toNodeId: "page-public",
        key: "home.public",
        name: "主页 -> 新建公开课",
        intent: "点击：创建公开课",
        status: "active",
        source: "manual_edit",
        preconditions: [],
        actionPolicies: [
          {
            id: "policy-create-public",
            priority: 1,
            fallback: false,
            reliabilityHint: "medium",
            action: {
              id: "tap-create-public",
              order: 1,
              type: "tap_on_image",
              enabled: true,
              title: "点击：创建公开课",
              params: {
                elementLabel: "创建公开课",
                targetText: "创建公开课",
                locator: "image-region:53.85,15.84,38.63,7.33"
              },
              createdAt: nowIso()
            }
          }
        ],
        expectations: [],
        platformScope: "android"
      }
    ];
    const meta: MetaFunction = {
      id: "meta-open-public",
      appId: "cn.eeo.classin",
      platform: "android",
      name: "打开新建公开课",
      parameters: [],
      steps: [
        { id: "reach-home", order: 1, kind: "reach_page", targetPageModelId: "page-home", enabled: true },
        { id: "open-public", order: 2, kind: "invoke_capability", sourcePageModelId: "page-home", pageElementId: "manual-create-public", targetPageModelId: "page-public", enabled: true }
      ],
      status: "active",
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    const catalogHome = assetCompositionCatalog(version).pages.find((page) => page.id === "page-home");
    expect(catalogHome?.transitions).toEqual([
      expect.objectContaining({
        id: "edge-home-public",
        elementId: "manual-create-public",
        targetPageModelId: "page-public",
        targetPageName: "新建公开课"
      })
    ]);

    const result = compileAssetCompositeCase({
      compositeCase: compositeCase([meta.id]),
      metaFunctions: [meta],
      graphVersion: version
    });
    expect(result.status).toBe("ready");
    expect(result.steps[1]).toEqual(expect.objectContaining({
      pageElementId: "manual-create-public",
      pageTransitionId: "edge-home-public",
      targetPageModelId: "page-public"
    }));
  });

  it("catalogs active operation edges whose action policy is the only executable locator", () => {
    const version = graphVersion();
    version.nodes = [
      pageNode("page-todo", "待办", {}),
      pageNode("page-home", "主页", {})
    ];
    version.edges = [
      {
        id: "edge-tab-todo-home",
        graphVersionId: version.id,
        fromNodeId: "page-todo",
        toNodeId: "page-home",
        key: "todo.home",
        name: "待办 -> 主页",
        intent: "底部 Tab 切回主页",
        status: "active",
        source: "manual_edit",
        preconditions: [],
        actionPolicies: [
          {
            id: "policy-tab-home",
            priority: 1,
            fallback: false,
            reliabilityHint: "high",
            action: {
              id: "tap-home-tab",
              order: 1,
              type: "tap_on_image",
              enabled: true,
              title: "点击：切回主页",
              params: {
                elementLabel: "切回主页",
                targetText: "主页",
                locator: "image-region:0,90.34,16.67,9.66"
              },
              createdAt: nowIso()
            }
          }
        ],
        expectations: [],
        platformScope: "android"
      }
    ];
    const meta: MetaFunction = {
      id: "meta-todo-home",
      appId: "cn.eeo.classin",
      platform: "android",
      name: "待办回主页",
      parameters: [],
      steps: [
        { id: "back-home", order: 1, kind: "invoke_capability", sourcePageModelId: "page-todo", pageElementId: "edge_action:edge-tab-todo-home", targetPageModelId: "page-home", enabled: true }
      ],
      status: "active",
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    expect(assetCompositionCatalog(version).pages.find((page) => page.id === "page-todo")).toEqual(
      expect.objectContaining({
        elements: [expect.objectContaining({ id: "edge_action:edge-tab-todo-home", label: "切回主页" })],
        transitions: [expect.objectContaining({ id: "edge-tab-todo-home", elementId: "edge_action:edge-tab-todo-home", targetPageModelId: "page-home" })]
      })
    );

    const result = compileAssetCompositeCase({
      compositeCase: compositeCase([meta.id]),
      metaFunctions: [meta],
      graphVersion: version
    });

    expect(result.status).toBe("ready");
    expect(result.steps[0]).toEqual(expect.objectContaining({
      pageElementId: "edge_action:edge-tab-todo-home",
      pageTransitionId: "edge-tab-todo-home",
      targetPageModelId: "page-home"
    }));
  });

  it("compiles meta functions into current active asset references and runtime parameters", () => {
    const result = compileAssetCompositeCase({
      compositeCase: compositeCase(["meta-enter", "meta-create"]),
      metaFunctions: [enterClassMetaFunction(), createLessonMetaFunction()],
      parameterProfile: parameterProfile(),
      graphVersion: graphVersion()
    });

    expect(result.status).toBe("ready");
    expect(result.runtimeParams).toEqual({
      className: "班级四十二号",
      lessonName: "自动化课堂",
      duration: "30"
    });
    expect(result.steps.map((step) => [step.metaFunctionName, step.kind, step.targetPageModelId, step.pageTaskId])).toEqual([
      ["进入指定班级", "reach_page", "page-home", undefined],
      ["进入指定班级", "invoke_capability", "page-detail", undefined],
      ["创建课堂但不发布", "reach_page", "page-create", undefined],
      ["创建课堂但不发布", "run_page_task", "page-create", "task-fill-lesson"],
      ["创建课堂但不发布", "verify_page", "page-create", undefined]
    ]);
    expect(result.steps[1]).toEqual(expect.objectContaining({ pageElementId: "class-grid", pageTransitionId: "transition-home-detail" }));
  });

  it("blocks a parameterized page transition when its runtime target is missing", () => {
    const result = compileAssetCompositeCase({
      compositeCase: compositeCase(["meta-open-class-without-param"]),
      metaFunctions: [
        {
          id: "meta-open-class-without-param",
          appId: "cn.eeo.classin",
          platform: "android",
          name: "打开班级详情",
          parameters: [],
          steps: [
            { id: "open-class", order: 1, kind: "invoke_capability", sourcePageModelId: "page-home", pageElementId: "class-grid", targetPageModelId: "page-detail", enabled: true }
          ],
          status: "active",
          version: 1,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      ],
      graphVersion: graphVersion()
    });

    expect(result.status).toBe("needs_parameters");
    expect(result.requiredParameters).toContain("className");
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "MISSING_REQUIRED_PARAMETER",
      assetId: "className",
      message: "页面连接 主页 -> 班级详情 缺少必需参数 className。"
    }));
  });

  it("compiles launch-app system steps without requiring page assets", () => {
    const launchMeta: MetaFunction = {
      id: "meta-launch-app",
      appId: "cn.eeo.classin",
      platform: "android",
      name: "启动 App",
      parameters: [],
      steps: [
        { id: "launch-app", order: 1, kind: "system_action", actionType: "launch_app", enabled: true }
      ],
      status: "active",
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    const result = compileAssetCompositeCase({
      compositeCase: compositeCase([launchMeta.id]),
      metaFunctions: [launchMeta],
      graphVersion: emptyGraphVersion()
    });

    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
    expect(result.steps[0]).toEqual(expect.objectContaining({
      kind: "system_action",
      systemAction: "launch_app",
      packageName: "cn.eeo.classin",
      targetPageModelId: "cn.eeo.classin"
    }));
  });

  it("reports broken asset references and missing required parameters before execution", () => {
    const brokenMeta: MetaFunction = {
      ...enterClassMetaFunction(),
      parameters: [{ key: "missingParam", type: "string", required: true }],
      steps: [
        { id: "broken-capability", order: 1, kind: "invoke_capability", sourcePageModelId: "page-home", pageElementId: "missing-element", targetPageModelId: "page-missing", enabled: true },
        { id: "broken-task", order: 2, kind: "run_page_task", pageModelId: "page-detail", pageTaskId: "missing-task", enabled: true }
      ]
    };
    const result = compileAssetCompositeCase({
      compositeCase: compositeCase([brokenMeta.id]),
      metaFunctions: [brokenMeta],
      parameterProfile: { ...parameterProfile(), values: {} },
      graphVersion: graphVersion()
    });

    expect(result.status).toBe("blocked");
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "MISSING_REQUIRED_PARAMETER",
      "PAGE_ELEMENT_NOT_FOUND",
      "TARGET_PAGE_NOT_FOUND",
      "PAGE_TASK_NOT_FOUND"
    ]));
  });

  it("reports missing parameters declared by page task input steps", () => {
    const version = graphVersion();
    const createPage = version.nodes.find((node) => node.id === "page-create")!;
    createPage.metadata = {
      ...createPage.metadata,
      assetRecordingPageTasks: [
        {
          id: "task-fill-lesson",
          name: "填写课堂信息",
          status: "active",
          steps: [
            { id: "task-step-title", order: 1, elementId: "manual-title", fieldType: "text_input", label: "课堂标题", valueParamKey: "lessonName" },
            { id: "task-step-duration", order: 2, elementId: "manual-duration", fieldType: "picker_select", label: "课堂时长", valueParamKey: "duration" }
          ]
        }
      ]
    };
    const result = compileAssetCompositeCase({
      compositeCase: compositeCase(["meta-create"]),
      metaFunctions: [{
        ...createLessonMetaFunction(),
        parameters: []
      }],
      parameterProfile: { ...parameterProfile(), values: {} },
      graphVersion: version
    });

    expect(result.status).toBe("needs_parameters");
    expect(result.requiredParameters).toEqual(["duration", "lessonName"]);
    expect(result.issues.map((issue) => issue.assetId)).toEqual(expect.arrayContaining(["duration", "lessonName"]));
  });

  it("does not require page-task parameters explicitly declared optional by the meta function", () => {
    const version = graphVersion();
    const createPage = version.nodes.find((node) => node.id === "page-create")!;
    createPage.metadata = {
      ...createPage.metadata,
      assetRecordingPageTasks: [
        {
          id: "task-fill-lesson",
          name: "填写课堂信息",
          status: "active",
          steps: [
            { id: "task-step-title", order: 1, elementId: "manual-title", fieldType: "text_input", label: "课堂名称", valueParamKey: "lessonName" },
            { id: "task-step-duration", order: 2, elementId: "manual-duration", fieldType: "picker_select", label: "课堂时长", valueParamKey: "duration" }
          ]
        }
      ]
    };
    const result = compileAssetCompositeCase({
      compositeCase: compositeCase(["meta-create"]),
      metaFunctions: [{
        ...createLessonMetaFunction(),
        parameters: [
          { key: "lessonName", type: "string", required: true },
          { key: "duration", type: "number", required: false }
        ]
      }],
      parameterProfile: {
        ...parameterProfile(),
        values: { lessonName: { type: "string", value: "自动化课堂" } }
      },
      graphVersion: version
    });

    expect(result.status).toBe("ready");
    expect(result.requiredParameters).toEqual(["lessonName"]);
    expect(result.issues).toEqual([]);
  });

  it("keeps explicit runtime values ahead of meta-function defaults", () => {
    const result = compileAssetCompositeCase({
      compositeCase: compositeCase(["meta-create"]),
      metaFunctions: [{
        ...createLessonMetaFunction(),
        parameters: [{ key: "duration", type: "number", required: false, defaultValue: 30 }]
      }],
      runtimeOverrides: { duration: 60 },
      graphVersion: graphVersion()
    });

    expect(result.steps[0]?.runtimeParams.duration).toBe("60");
  });

  it("applies case-step parameter overrides without mutating the profile", () => {
    const sourceProfile = parameterProfile();
    const testCase = compositeCase(["meta-enter"]);
    testCase.steps[0]!.parameterOverrides = { className: "班级四十一号" };

    const result = compileAssetCompositeCase({
      compositeCase: testCase,
      metaFunctions: [enterClassMetaFunction()],
      parameterProfile: sourceProfile,
      graphVersion: graphVersion()
    });

    expect(result.runtimeParams.className).toBe("班级四十一号");
    expect(sourceProfile.values.className?.value).toBe("班级四十二号");
  });
});

function graphVersion(): BusinessGraphVersion {
  return {
    id: "graph-version",
    graphId: "graph",
    version: 1,
    status: "active",
    sourceSummary: [],
    createdAt: nowIso(),
    nodes: [
      pageNode("page-home", "主页", {
        assetRecordingPageElements: [{ id: "class-grid", label: "班级列表" }],
        assetRecordingPageTransitions: [{ id: "transition-home-detail", elementId: "class-grid", targetNodeId: "page-detail", outcomeType: "navigate", params: { itemText: "{{className}}" } }]
      }),
      pageNode("page-detail", "班级详情", {
        assetRecordingPageTransitions: [{ id: "transition-detail-create", elementId: "create-lesson", targetNodeId: "page-create", outcomeType: "navigate" }]
      }),
      pageNode("page-create", "新建课堂", {
        assetRecordingPageTasks: [{ id: "task-fill-lesson", name: "填写课堂信息", status: "active", steps: [] }]
      })
    ],
    edges: []
  };
}

function emptyGraphVersion(): BusinessGraphVersion {
  return {
    id: "graph-version-empty",
    graphId: "graph",
    version: 1,
    status: "active",
    sourceSummary: [],
    createdAt: nowIso(),
    nodes: [],
    edges: []
  };
}

function pageNode(id: string, name: string, metadata: Record<string, unknown>): BusinessNode {
  return {
    id,
    graphVersionId: "graph-version",
    key: id,
    name,
    nodeType: "page",
    tags: ["page-asset"],
    status: "active",
    matchers: [],
    defaultExpectations: [],
    platformScope: "android",
    metadata: { assetRecordingConfirmed: true, ...metadata }
  };
}

function parameterProfile(): ParameterProfile {
  return {
    id: "profile-teacher",
    appId: "cn.eeo.classin",
    platform: "android",
    name: "教师账号",
    values: {
      className: { type: "string", value: "班级四十二号" },
      lessonName: { type: "string", value: "自动化课堂" },
      duration: { type: "number", value: 30 }
    },
    status: "active",
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function enterClassMetaFunction(): MetaFunction {
  return {
    id: "meta-enter",
    appId: "cn.eeo.classin",
    platform: "android",
    name: "进入指定班级",
    parameters: [{ key: "className", type: "string", required: true }],
    steps: [
      { id: "reach-home", order: 1, kind: "reach_page", targetPageModelId: "page-home", enabled: true },
      { id: "open-class", order: 2, kind: "invoke_capability", sourcePageModelId: "page-home", pageElementId: "class-grid", targetPageModelId: "page-detail", enabled: true }
    ],
    status: "active",
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function createLessonMetaFunction(): MetaFunction {
  return {
    id: "meta-create",
    appId: "cn.eeo.classin",
    platform: "android",
    name: "创建课堂但不发布",
    parameters: [
      { key: "lessonName", type: "string" },
      { key: "duration", type: "number" }
    ],
    steps: [
      { id: "reach-create", order: 1, kind: "reach_page", targetPageModelId: "page-create", enabled: true },
      { id: "fill-form", order: 2, kind: "run_page_task", pageModelId: "page-create", pageTaskId: "task-fill-lesson", enabled: true },
      { id: "verify-create", order: 3, kind: "verify_page", pageModelId: "page-create", enabled: true }
    ],
    status: "active",
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function compositeCase(metaFunctionIds: string[]): AssetCompositeCase {
  return {
    id: "case-create-lesson",
    appId: "cn.eeo.classin",
    platform: "android",
    name: "指定班级创建课堂",
    parameterProfileId: "profile-teacher",
    runMode: "once",
    repeatCount: 1,
    stopOnFailure: true,
    steps: metaFunctionIds.map((metaFunctionId, index) => ({ id: `case-step-${index + 1}`, order: index + 1, metaFunctionId, enabled: true })),
    status: "active",
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}
