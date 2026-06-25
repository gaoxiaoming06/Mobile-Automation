import type { ActionPolicy, StateMatcher } from "@mobile-automation/graph-core";
import type { ActionStep, StepExpectation } from "@mobile-automation/shared";
import { Storage } from "./storage.js";

const storage = new Storage();

try {
  const graph = storage.createBusinessGraph({
    appId: "demo-android",
    targetApp: {
      androidPackageName: "com.demo"
    },
    platformScope: "android",
    name: "Demo Android 业务图谱",
    status: "draft"
  });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: ["manual_seed:graph-core-demo"],
    status: "draft"
  });

  const root = storage.createBusinessNode({
    graphVersionId: version.id,
    key: "app.launch",
    name: "启动页",
    nodeType: "root",
    status: "active",
    matchers: [matcher("activity", "com.demo.LauncherActivity", 3), matcher("package", "com.demo", 1)],
    defaultExpectations: [expectation("text", "应用已启动")]
  });
  const home = storage.createBusinessNode({
    graphVersionId: version.id,
    key: "home",
    name: "首页",
    nodeType: "page",
    status: "active",
    tags: ["smoke", "home"],
    matchers: [matcher("activity", "com.demo.HomeActivity", 3), matcher("text", "首页", 2)],
    defaultExpectations: [expectation("text", "首页")]
  });
  const homeworkCreate = storage.createBusinessNode({
    graphVersionId: version.id,
    key: "homework.create",
    name: "新建作业页",
    nodeType: "page",
    status: "active",
    tags: ["homework", "smoke"],
    matchers: [matcher("text", "新建作业", 3), matcher("resource_id", "com.demo:id/homework_editor", 2)],
    defaultExpectations: [expectation("text", "新建作业")]
  });

  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: root.id,
    toNodeId: home.id,
    key: "launch_to_home",
    name: "启动后进入首页",
    intent: "打开首页",
    status: "active",
    source: "manual_edit",
    preconditions: [],
    actionPolicies: [actionPolicy("wait-home", waitStep("等待首页", 800), 1, false)],
    expectations: [expectation("text", "首页")],
    reliabilityScore: 0.95
  });
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: home.id,
    toNodeId: homeworkCreate.id,
    key: "home_to_homework_create",
    name: "从首页进入新建作业页",
    intent: "发布作业",
    status: "active",
    source: "manual_edit",
    preconditions: [expectation("text", "首页")],
    actionPolicies: [
      actionPolicy("tap-homework-create", tapOnTextStep("点击发布作业", "发布作业"), 1, false),
      actionPolicy("tap-homework-create-coordinate", tapStep("坐标兜底点击发布作业", 780, 2100), 2, true)
    ],
    expectations: [expectation("text", "新建作业")],
    reliabilityScore: 0.9
  });

  const activeGraph = storage.setActiveBusinessGraphVersion(graph.id, version.id);

  const payload = {
    graphId: activeGraph.id,
    versionId: version.id,
    appId: graph.appId,
    examples: {
      targetByKey: {
        platform: "android",
        target: {
          key: "homework.create"
        },
        persist: false
      },
      targetByText: {
        platform: "android",
        target: {
          text: "新建作业"
        },
        persist: false
      },
      targetByNodeId: {
        platform: "android",
        targetNodeId: homeworkCreate.id,
        persist: false
      }
    }
  };

  console.log(JSON.stringify(payload, null, 2));
  console.log("");
  console.log("Route plan API example:");
  console.log(
    `curl -s http://localhost:4010/api/graphs/${version.id}/route-plan -H 'Content-Type: application/json' -d '${JSON.stringify(payload.examples.targetByKey)}'`
  );
} finally {
  storage.close();
}

function matcher(type: StateMatcher["type"], value: string, weight: number): StateMatcher {
  return {
    id: `matcher_${type}_${value.replace(/[^a-zA-Z0-9_一-龥]/g, "_")}`,
    type,
    value,
    weight
  };
}

function expectation(type: StepExpectation["type"], expected: string): StepExpectation {
  return {
    id: `expect_${type}_${expected}`,
    type,
    enabled: true,
    params: {
      expected,
      mode: "contains"
    },
    createdAt: new Date().toISOString()
  };
}

function actionPolicy(id: string, action: ActionStep, priority: number, fallback: boolean): ActionPolicy {
  return {
    id,
    priority,
    action,
    fallback,
    reliabilityHint: fallback ? "low" : "high"
  };
}

function waitStep(title: string, durationMs: number): ActionStep {
  return {
    id: "step_wait_home",
    order: 1,
    type: "wait",
    enabled: true,
    title,
    params: {
      durationMs
    },
    createdAt: new Date().toISOString()
  };
}

function tapOnTextStep(title: string, text: string): ActionStep {
  return {
    id: "step_tap_homework_create_text",
    order: 1,
    type: "tap_on_text",
    enabled: true,
    title,
    params: {
      text,
      matchMode: "contains"
    },
    createdAt: new Date().toISOString()
  };
}

function tapStep(title: string, x: number, y: number): ActionStep {
  return {
    id: "step_tap_homework_create_coordinate",
    order: 1,
    type: "tap",
    enabled: true,
    title,
    params: {},
    coordinate: {
      x,
      y
    },
    createdAt: new Date().toISOString()
  };
}
