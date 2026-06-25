import type { ActionPolicy, BusinessGraphVersion, BusinessNode, OperationEdge, StateMatcher } from "@mobile-automation/graph-core";
import { createId, type ActionStep, type StepExpectation } from "@mobile-automation/shared";
import type { Storage } from "./storage.js";

export const classInAndroidGraphAppId = "classin-android";
export const classInAndroidGraphName = "ClassIn Android 业务图谱";
export const classInTeacherCreateLessonLegacyGraphAppId = "classin-android-teacher-create-lesson";
export const classInCreateLessonTargetNodeKey = "classin.teacher.lesson.create";
export const classInTeacherCreateLessonGraphRevision = "classin_android_graph:v8";

type BuiltinGraphSeedResult = {
  created: number;
  skipped: number;
};

type GraphNodeDraft = Omit<BusinessNode, "id" | "graphVersionId"> & {
  id: string;
};

type GraphEdgeDraft = Omit<OperationEdge, "id" | "graphVersionId" | "fromNodeId" | "toNodeId"> & {
  id: string;
  fromNodeKey: string;
  toNodeKey: string;
};

export function seedBuiltinGraphs(storage: Storage): BuiltinGraphSeedResult {
  const existingGraph = resolveCanonicalClassInGraph(storage);
  const activeVersion = existingGraph ? storage.getActiveBusinessGraphVersion(existingGraph.id) : undefined;
  const hasCreateLessonTarget = activeVersion?.nodes?.some((node) => node.key === classInCreateLessonTargetNodeKey) === true;
  const hasCurrentLaunchEdge = activeVersion?.edges?.some((edge) => edge.key === "classin.launch.to.teacher.classes") === true;
  const isCurrentRevision = activeVersion?.sourceSummary?.includes(`builtin_revision:${classInTeacherCreateLessonGraphRevision}`) === true;
  archiveLegacyClassInCreateLessonGraph(storage, existingGraph?.id);
  if (existingGraph?.activeVersionId && hasCreateLessonTarget && hasCurrentLaunchEdge && isCurrentRevision) {
    return { created: 0, skipped: 1 };
  }
  seedClassInTeacherCreateLessonGraph(storage, existingGraph?.id, activeVersion);
  return { created: 1, skipped: 0 };
}

function resolveCanonicalClassInGraph(storage: Storage): ReturnType<Storage["getBusinessGraph"]> {
  const canonical = storage.findBusinessGraphByAppId(classInAndroidGraphAppId);
  if (canonical) {
    storage.updateBusinessGraphProfile(canonical.id, {
      appId: classInAndroidGraphAppId,
      name: classInAndroidGraphName,
      targetApp: {
        androidPackageName: "cn.eeo.classin"
      },
      platformScope: "android"
    });
    return storage.getBusinessGraph(canonical.id) ?? canonical;
  }
  const legacy = storage.findBusinessGraphByAppId(classInTeacherCreateLessonLegacyGraphAppId);
  if (legacy) {
    storage.updateBusinessGraphProfile(legacy.id, {
      appId: classInAndroidGraphAppId,
      name: classInAndroidGraphName,
      targetApp: {
        androidPackageName: "cn.eeo.classin"
      },
      platformScope: "android"
    });
    return storage.getBusinessGraph(legacy.id) ?? legacy;
  }
  return undefined;
}

function archiveLegacyClassInCreateLessonGraph(storage: Storage, canonicalGraphId: string | undefined): void {
  const legacy = storage.findBusinessGraphByAppId(classInTeacherCreateLessonLegacyGraphAppId);
  if (!legacy || legacy.id === canonicalGraphId) {
    return;
  }
  storage.updateBusinessGraphProfile(legacy.id, {
    status: "deprecated"
  });
}

function seedClassInTeacherCreateLessonGraph(storage: Storage, existingGraphId?: string, previousVersion?: BusinessGraphVersion): BusinessGraphVersion {
  const graph =
    (existingGraphId ? storage.getBusinessGraph(existingGraphId) : undefined) ??
    storage.createBusinessGraph({
      appId: classInAndroidGraphAppId,
      targetApp: {
        androidPackageName: "cn.eeo.classin"
      },
      platformScope: "android",
      name: classInAndroidGraphName,
      status: "draft"
    });
  storage.updateBusinessGraphProfile(graph.id, {
    appId: classInAndroidGraphAppId,
    name: classInAndroidGraphName,
    targetApp: {
      androidPackageName: "cn.eeo.classin"
    },
    platformScope: "android"
  });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: [
      "builtin_graph:classin_android",
      "builtin_target_path:classin_teacher_create_lesson",
      `builtin_revision:${classInTeacherCreateLessonGraphRevision}`,
      "source:/Users/eeo/StudioProject_classin/modules/business/lms/src/main/res/layout"
    ],
    status: "draft"
  });
  const nodesByKey = new Map<string, string>();
  const previousNodeIdsByKey = new Map<string, string[]>();
  const previousPageAssetsByKey = new Map<string, BusinessNode>();
  const migratedNodeIds = new Map<string, string>();
  for (const node of previousVersion?.nodes ?? []) {
    previousNodeIdsByKey.set(node.key, [...(previousNodeIdsByKey.get(node.key) ?? []), node.id]);
    if (isMigratablePageAssetNode(node) && !previousPageAssetsByKey.has(node.key)) {
      previousPageAssetsByKey.set(node.key, node);
    }
  }

  for (const node of classInTeacherCreateLessonNodes()) {
    const mergedNode = mergeBuiltinNodeWithPreviousPageAsset(node, previousPageAssetsByKey.get(node.key));
    const { id: _stableId, ...nodeInput } = mergedNode;
    const created = storage.createBusinessNode({
      ...nodeInput,
      graphVersionId: version.id
    });
    nodesByKey.set(node.key, created.id);
    for (const previousNodeId of previousNodeIdsByKey.get(node.key) ?? []) {
      migratedNodeIds.set(previousNodeId, created.id);
    }
  }

  for (const previousNode of previousVersion?.nodes ?? []) {
    if (!isMigratablePageAssetNode(previousNode) || nodesByKey.has(previousNode.key)) {
      continue;
    }
    const created = storage.createBusinessNode(copyPreviousNodeInput(version.id, previousNode));
    nodesByKey.set(previousNode.key, created.id);
    migratedNodeIds.set(previousNode.id, created.id);
  }

  for (const edge of classInTeacherCreateLessonEdges()) {
    const fromNodeId = nodesByKey.get(edge.fromNodeKey);
    const toNodeId = nodesByKey.get(edge.toNodeKey);
    if (!fromNodeId || !toNodeId) {
      throw new Error(`Invalid built-in graph edge ${edge.key}: missing from/to node.`);
    }
    const { id: _stableId, fromNodeKey: _fromNodeKey, toNodeKey: _toNodeKey, ...edgeInput } = edge;
    storage.createOperationEdge({
      ...edgeInput,
      graphVersionId: version.id,
      fromNodeId,
      toNodeId
    });
  }
  migratePreviousManualEdges(storage, version.id, previousVersion, migratedNodeIds);

  storage.setActiveBusinessGraphVersion(graph.id, version.id);
  return storage.getBusinessGraphVersion(version.id) ?? version;
}

function mergeBuiltinNodeWithPreviousPageAsset(node: GraphNodeDraft, previousAsset: BusinessNode | undefined): GraphNodeDraft {
  if (!previousAsset) {
    return node;
  }
  const merged: GraphNodeDraft = {
    ...node,
    name: previousAsset.name || node.name,
    tags: Array.from(new Set([...node.tags, ...previousAsset.tags])),
    matchers: dedupeMatchers([...node.matchers, ...cloneMatchers(previousAsset.matchers)]),
    defaultExpectations: node.defaultExpectations,
    platformScope: previousAsset.platformScope ?? node.platformScope,
    metadata: {
      ...(node.metadata ?? {}),
      ...(previousAsset.metadata ?? {}),
      builtinSource: node.metadata?.source
    }
  };
  return sanitizeMigratedNode(merged);
}

function copyPreviousNodeInput(graphVersionId: string, node: BusinessNode): Omit<BusinessNode, "id"> {
  const sanitized = sanitizeMigratedNode({
    ...node,
    id: node.id,
    graphVersionId,
    matchers: cloneMatchers(node.matchers)
  });
  const { id: _oldId, ...input } = sanitized;
  return input;
}

function migratePreviousManualEdges(
  storage: Storage,
  graphVersionId: string,
  previousVersion: BusinessGraphVersion | undefined,
  migratedNodeIds: Map<string, string>
): void {
  const migratedNodesById = new Map<string, BusinessNode>();
  const latestGraphVersion = storage.getBusinessGraphVersion(graphVersionId);
  for (const node of latestGraphVersion?.nodes ?? []) {
    migratedNodesById.set(node.id, node);
  }
  for (const edge of previousVersion?.edges ?? []) {
    if (!isMigratableManualEdge(edge)) {
      continue;
    }
    const fromNodeId = migratedNodeIds.get(edge.fromNodeId);
    const toNodeId = migratedNodeIds.get(edge.toNodeId);
    if (!fromNodeId || !toNodeId) {
      continue;
    }
    storage.createOperationEdge({
      graphVersionId,
      fromNodeId,
      toNodeId,
      key: edge.key,
      name: edge.name,
      intent: edge.intent,
      status: edge.status,
      source: edge.source,
      preconditions: rewriteMigratedStateExpectations(edge.preconditions, migratedNodeIds, migratedNodesById),
      actionPolicies: edge.actionPolicies.map((policy) => ({
        ...policy,
        id: createId("policy")
      })),
      expectations: rewriteMigratedStateExpectations(edge.expectations, migratedNodeIds, migratedNodesById),
      failurePolicy: edge.failurePolicy,
      platformScope: edge.platformScope,
      reliabilityScore: edge.reliabilityScore
    });
  }
}

function rewriteMigratedStateExpectations(
  expectations: StepExpectation[],
  migratedNodeIds: Map<string, string>,
  migratedNodesById: Map<string, BusinessNode>
): StepExpectation[] {
  return expectations.map((expectation) => {
    if (expectation.type !== "state_is") {
      return {
        ...expectation,
        params: { ...expectation.params }
      };
    }
    const previousNodeId = typeof expectation.params.nodeId === "string"
      ? expectation.params.nodeId
      : typeof expectation.params.expectedNodeId === "string"
        ? expectation.params.expectedNodeId
        : typeof expectation.params.expected === "string"
          ? expectation.params.expected
          : undefined;
    const migratedNodeId = previousNodeId ? migratedNodeIds.get(previousNodeId) : undefined;
    const migratedNode = migratedNodeId ? migratedNodesById.get(migratedNodeId) : undefined;
    if (!migratedNode) {
      return {
        ...expectation,
        params: { ...expectation.params }
      };
    }
    return {
      ...expectation,
      params: {
        ...expectation.params,
        nodeId: migratedNode.id,
        nodeKey: migratedNode.key,
        nodeName: migratedNode.name,
        matcherCount: migratedNode.matchers.length,
        criticalMatcherCount: migratedNode.matchers.filter((matcher) => matcher.critical).length
      }
    };
  });
}

function isMigratablePageAssetNode(node: BusinessNode): boolean {
  return node.status === "active" &&
    node.nodeType === "page" &&
    (node.metadata?.assetRecordingConfirmed === true || node.tags.includes("page-asset") || node.tags.includes("asset-recording"));
}

function isMigratableManualEdge(edge: OperationEdge): boolean {
  return edge.status === "active" && edge.key.startsWith("manual.");
}

function cloneMatchers(matchers: StateMatcher[]): StateMatcher[] {
  return matchers.map((matcher) => ({
    ...matcher,
    id: createId("matcher")
  }));
}

function dedupeMatchers(matchers: StateMatcher[]): StateMatcher[] {
  const seen = new Set<string>();
  const result: StateMatcher[] = [];
  for (const matcher of matchers) {
    const key = JSON.stringify({
      type: matcher.type,
      value: matcher.value,
      region: matcher.region,
      semanticArea: matcher.semanticArea,
      coordinateSpace: matcher.coordinateSpace
    });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(matcher);
  }
  return result;
}

function sanitizeMigratedNode<T extends Omit<BusinessNode, "id"> | GraphNodeDraft>(node: T): T {
  if (node.key !== "classin.teacher.classes") {
    return node;
  }
  return {
    ...node,
    matchers: node.matchers.filter((matcher) => !(matcher.type === "text" && matcher.value === "创建班级")),
    defaultExpectations: node.defaultExpectations.filter((expectation) => expectation.id !== "builtin_classin_teacher_classes_create")
  };
}

function classInTeacherCreateLessonNodes(): GraphNodeDraft[] {
  return [
    graphNode({
      id: "builtin_classin_node_root",
      key: "classin.app.root",
      name: "ClassIn App 启动前准备态",
      nodeType: "root",
      matchers: [matcher("custom", "foreground_package_not=cn.eeo.classin", 1)],
      expectations: [],
      tags: ["classin", "root"]
    }),
    graphNode({
      id: "builtin_classin_node_home",
      key: "classin.home",
      name: "ClassIn 首页壳",
      nodeType: "page",
      matchers: [matcher("package", "cn.eeo.classin", 2), matcher("text", "主页", 1)],
      expectations: [expectText("builtin_classin_home_teacher_tab", "我是", "首页显示身份切换入口")],
      tags: ["classin", "home"]
    }),
    graphNode({
      id: "builtin_classin_node_teacher_classes",
      key: "classin.teacher.classes",
      name: "我是教师班级列表",
      nodeType: "page",
      matchers: [
        matcher("package", "cn.eeo.classin", 2),
        matcher("text", "主页", 1),
        matcher("text", "我是教师", 3),
        matcher("text", "全部班级", 2),
        matcher("accessibility_id", "course Photo", 1.5)
      ],
      expectations: [
        expectText("builtin_classin_teacher_classes_teacher_tab", "我是教师", "教师身份标签可见"),
        expectText("builtin_classin_teacher_classes_all_tab", "全部班级", "班级筛选标签可见")
      ],
      tags: ["classin", "teacher", "class-list"]
    }),
    graphNode({
      id: "builtin_classin_node_class_detail",
      key: "classin.teacher.class.detail",
      name: "班级详情",
      nodeType: "page",
      matchers: [
        matcher("activity", "cn.eeo.lms.coursedetail.activity.CourseDetailActivity", 3),
        matcher("resource_id", "cn.eeo.classin:id/activity_list", 2),
        matcher("resource_id", "cn.eeo.classin:id/btn_add", 2),
        matcher("text", "课节", 2)
      ],
      expectations: [expectText("builtin_classin_class_detail_visible", "课节", "班级详情显示课节页")],
      tags: ["classin", "teacher", "class-detail"]
    }),
    graphNode({
      id: "builtin_classin_node_publish_activity",
      key: "classin.teacher.activity.publish",
      name: "发布活动类型选择页",
      nodeType: "business_state",
      matchers: [
        matcher("activity", "cn.eeo.lms.coursedetail.activity.CourseDetailActivity", 2),
        matcher("text", "发布活动", 4),
        matcher("text", "通用活动", 3),
        matcher("text", "课堂", 4),
        matcher("text", "作业", 2),
        matcher("accessibility_id", "icon", 1)
      ],
      expectations: [
        expectText("builtin_classin_publish_activity_visible", "发布活动", "进入发布活动页"),
        expectText("builtin_classin_publish_lesson_visible", "课堂", "课堂活动入口可见")
      ],
      tags: ["classin", "teacher", "publish"]
    }),
    graphNode({
      id: "builtin_classin_node_create_lesson",
      key: classInCreateLessonTargetNodeKey,
      name: "新建课堂页",
      nodeType: "page",
      matchers: [matcher("text", "新建课堂", 3), matcher("resource_id", "cn.eeo.classin:id/et_course_name", 3)],
      expectations: [
        expectText("builtin_classin_create_lesson_title", "新建课堂", "进入新建课堂页"),
        expectElement("builtin_classin_create_lesson_name_input", "cn.eeo.classin:id/et_course_name", "课堂名称输入框可见")
      ],
      tags: ["classin", "teacher", "lesson", "target"]
    })
  ];
}

function classInTeacherCreateLessonEdges(): GraphEdgeDraft[] {
  return [
    graphEdge({
      id: "builtin_classin_edge_launch_home",
      fromNodeKey: "classin.app.root",
      toNodeKey: "classin.teacher.classes",
      key: "classin.launch.to.teacher.classes",
      name: "启动 ClassIn 到教师班级列表",
      intent: "启动 ClassIn 并进入教师班级列表",
      actionPolicies: [actionPolicy("builtin_classin_action_launch", launchAppStep("启动 ClassIn", "cn.eeo.classin"), 1, false)],
      expectations: [
        expectText("builtin_classin_launch_expect_teacher_tab", "我是教师", "启动后显示教师身份标签"),
        expectText("builtin_classin_launch_expect_teacher_classes", "全部班级", "启动后显示教师班级列表")
      ],
      reliabilityScore: 0.8
    }),
    graphEdge({
      id: "builtin_classin_edge_home_teacher",
      fromNodeKey: "classin.home",
      toNodeKey: "classin.teacher.classes",
      key: "classin.home.to.teacher.classes",
      name: "切换到我是教师",
      intent: "从首页切换到教师班级列表",
      preconditions: [expectText("builtin_classin_pre_home_teacher_tab", "我是教师", "首页教师身份入口可见")],
      actionPolicies: [
        actionPolicy(
          "builtin_classin_action_teacher_tab",
          tapOnElementStep("点击我是教师", {
            strategy: "android_uiautomator",
            text: "我是教师",
            textMatchMode: "equals",
            tapTarget: "clickable_ancestor",
            packageName: "cn.eeo.classin"
          }),
          1,
          false,
          "high"
        )
      ],
      expectations: [
        expectText("builtin_classin_expect_teacher_classes", "我是教师", "教师身份标签显示"),
        expectText("builtin_classin_expect_teacher_classes_all", "全部班级", "教师班级列表显示")
      ],
      reliabilityScore: 0.85
    }),
    graphEdge({
      id: "builtin_classin_edge_teacher_first_class",
      fromNodeKey: "classin.teacher.classes",
      toNodeKey: "classin.teacher.class.detail",
      key: "classin.teacher.classes.to.class.detail",
      name: "进入第一个教师班级",
      intent: "打开教师班级列表中的第一个班级",
      preconditions: [
        expectText("builtin_classin_pre_teacher_classes", "我是教师", "教师身份标签可见"),
        expectText("builtin_classin_pre_teacher_class_cards", "班级", "教师班级卡片可见")
      ],
      actionPolicies: [
        actionPolicy(
          "builtin_classin_action_first_class_card",
          tapOnElementStep("点击第一个班级卡片", {
            strategy: "android_uiautomator",
            text: "班级",
            textMatchMode: "contains",
            excludeTexts: ["创建班级", "全部班级"],
            occurrence: 1,
            tapTarget: "clickable_ancestor",
            packageName: "cn.eeo.classin"
          }),
          1,
          false,
          "medium"
        )
      ],
      expectations: [expectText("builtin_classin_expect_class_detail", "课节", "进入班级详情并显示课节页")],
      reliabilityScore: 0.55
    }),
    graphEdge({
      id: "builtin_classin_edge_class_publish",
      fromNodeKey: "classin.teacher.class.detail",
      toNodeKey: "classin.teacher.activity.publish",
      key: "classin.class.detail.to.publish.activity",
      name: "打开发布活动页",
      intent: "从班级详情点击发布活动入口",
      preconditions: [expectText("builtin_classin_pre_class_detail", "课节", "班级详情课节页可见")],
      actionPolicies: [
        actionPolicy(
          "builtin_classin_action_add_activity_icon",
          tapOnElementStep("点击发布活动入口", {
            strategy: "android_uiautomator",
            resourceId: "cn.eeo.classin:id/btn_add"
          }),
          1,
          false,
          "high"
        ),
        actionPolicy(
          "builtin_classin_action_add_btn_desc",
          tapOnElementStep("点击添加按钮", {
            strategy: "android_uiautomator",
            contentDesc: "add btn"
          }),
          2,
          true,
          "medium"
        )
      ],
      expectations: [expectText("builtin_classin_expect_publish_activity", "发布活动", "进入发布活动类型选择页")],
      reliabilityScore: 0.75
    }),
    graphEdge({
      id: "builtin_classin_edge_publish_lesson",
      fromNodeKey: "classin.teacher.activity.publish",
      toNodeKey: classInCreateLessonTargetNodeKey,
      key: "classin.publish.activity.to.create.lesson",
      name: "选择课堂进入新建课堂",
      intent: "在发布活动页选择课堂类型",
      preconditions: [expectText("builtin_classin_pre_publish_activity", "发布活动", "发布活动页可见")],
      actionPolicies: [
        actionPolicy(
          "builtin_classin_action_lesson_category_text",
          tapOnElementStep("选择课堂", {
            strategy: "android_uiautomator",
            text: "课堂",
            textMatchMode: "equals",
            occurrence: 1,
            tapTarget: "clickable_ancestor",
            packageName: "cn.eeo.classin"
          }),
          1,
          false,
          "high"
        ),
        actionPolicy(
          "builtin_classin_action_lesson_category_element",
          tapOnElementStep("选择课堂类型卡片", {
            strategy: "android_uiautomator",
            text: "课堂",
            textMatchMode: "equals",
            occurrence: 1,
            tapTarget: "clickable_ancestor",
            packageName: "cn.eeo.classin"
          }),
          2,
          true,
          "medium"
        )
      ],
      expectations: [expectText("builtin_classin_expect_create_lesson", "新建课堂", "进入新建课堂页")],
      reliabilityScore: 0.85
    })
  ];
}

function graphNode(input: {
  id: string;
  key: string;
  name: string;
  nodeType: BusinessNode["nodeType"];
  matchers: StateMatcher[];
  expectations: StepExpectation[];
  tags: string[];
}): GraphNodeDraft {
  return {
    id: input.id,
    key: input.key,
    name: input.name,
    nodeType: input.nodeType,
    tags: input.tags,
    status: "active",
    matchers: input.matchers,
    defaultExpectations: input.expectations,
    platformScope: "android",
    metadata: {
      source: "builtin_classin_teacher_create_lesson"
    }
  };
}

function graphEdge(input: {
  id: string;
  fromNodeKey: string;
  toNodeKey: string;
  key: string;
  name: string;
  intent: string;
  preconditions?: StepExpectation[];
  actionPolicies: ActionPolicy[];
  expectations: StepExpectation[];
  reliabilityScore: number;
}): GraphEdgeDraft {
  return {
    id: input.id,
    fromNodeKey: input.fromNodeKey,
    toNodeKey: input.toNodeKey,
    key: input.key,
    name: input.name,
    intent: input.intent,
    status: "active",
    source: "manual_edit",
    preconditions: input.preconditions ?? [],
    actionPolicies: input.actionPolicies,
    expectations: input.expectations,
    platformScope: "android",
    reliabilityScore: input.reliabilityScore
  };
}

function matcher(type: StateMatcher["type"], value: string, weight: number): StateMatcher {
  return {
    id: createId("matcher"),
    type,
    value,
    weight,
    platformScope: "android",
    source: {
      sourceType: "manual_edit",
      confidence: 0.8
    }
  };
}

function expectText(id: string, expected: string, title: string, extraParams: Record<string, unknown> = {}): StepExpectation {
  return {
    id,
    type: "text",
    enabled: true,
    title,
    params: {
      expected,
      mode: "contains",
      ...extraParams
    },
    createdAt: "2026-06-11T00:00:00.000Z"
  };
}

function expectElement(id: string, resourceId: string, title: string): StepExpectation {
  return {
    id,
    type: "text",
    enabled: true,
    title,
    params: {
      resourceId,
      mode: "exists"
    },
    createdAt: "2026-06-11T00:00:00.000Z"
  };
}

function actionPolicy(
  id: string,
  action: ActionStep,
  priority: number,
  fallback: boolean,
  reliabilityHint: ActionPolicy["reliabilityHint"] = fallback ? "medium" : "high"
): ActionPolicy {
  return {
    id: createId("policy"),
    priority,
    action,
    fallback,
    reliabilityHint,
    source: {
      sourceType: "manual_edit",
      artifactId: id,
      confidence: reliabilityHint === "high" ? 0.9 : 0.65
    }
  };
}

function launchAppStep(title: string, packageName: string): ActionStep {
  return {
    id: createId("step"),
    order: 1,
    type: "launch_app",
    enabled: true,
    title,
    params: {
      packageName,
      delayBeforeMs: 800,
      timeoutMs: 15000
    },
    createdAt: "2026-06-11T00:00:00.000Z"
  };
}

function tapOnTextStep(title: string, text: string, textAlternatives: string[] = []): ActionStep {
  return {
    id: createId("step"),
    order: 1,
    type: "tap_on_text",
    enabled: true,
    title,
    params: {
      text,
      textAlternatives,
      matchMode: "contains",
      timeoutMs: 8000
    },
    createdAt: "2026-06-11T00:00:00.000Z"
  };
}

function tapOnElementStep(title: string, locator: Record<string, unknown>): ActionStep {
  return {
    id: createId("step"),
    order: 1,
    type: "tap_on_element",
    enabled: true,
    title,
    params: {
      locator,
      timeoutMs: 8000
    },
    createdAt: "2026-06-11T00:00:00.000Z"
  };
}
