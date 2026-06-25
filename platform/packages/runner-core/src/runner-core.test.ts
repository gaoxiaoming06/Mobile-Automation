import { describe, expect, it } from "vitest";
import {
  GraphRunner,
  RunExecutionController,
  RunStateMachine,
  enabledSteps,
  normalizeRunConfig,
  shouldRecordVideoForDevice,
  totalStepExecutions
} from "./index.js";
import {
  buildExecutionPlan,
  planRoute,
  type BusinessGraphVersion,
  type BusinessNode,
  type ExecutionPlan,
  type ExecutionPlanStep,
  type NodeMatchResult,
  type Observation,
  type OperationEdge,
  type StateMatcher
} from "@mobile-automation/graph-core";
import { defaultAndroidCapabilities, defaultIosCapabilities, type ActionStep, type StepExpectation, type StepExpectationResult } from "@mobile-automation/shared";

const steps: ActionStep[] = [
  {
    id: "2",
    order: 2,
    type: "back",
    enabled: true,
    params: {},
    createdAt: "2026-06-04T00:00:00.000Z"
  },
  {
    id: "1",
    order: 1,
    type: "tap",
    enabled: false,
    params: {},
    createdAt: "2026-06-04T00:00:00.000Z"
  }
];

describe("runner-core", () => {
  it("normalizes repeat count", () => {
    const config = normalizeRunConfig({ deviceSerial: "serial", repeatCount: 3 });

    expect(config.mode).toBe("repeat_n");
    expect(config.repeatCount).toBe(3);
  });

  it("sorts and filters enabled steps", () => {
    expect(enabledSteps(steps).map((step) => step.id)).toEqual(["2"]);
  });

  it("counts total executions", () => {
    const config = normalizeRunConfig({ deviceSerial: "serial", repeatCount: 4 });

    expect(totalStepExecutions(config, steps)).toBe(4);
  });

  it("only records video when the selected device reports recording capability", () => {
    const config = normalizeRunConfig({ deviceSerial: "serial", recordVideo: true });
    const androidCapabilities = defaultAndroidCapabilities();
    androidCapabilities.recordVideo = true;

    expect(shouldRecordVideoForDevice(config, { capabilities: androidCapabilities })).toBe(true);
    expect(shouldRecordVideoForDevice(config, { capabilities: defaultIosCapabilities({ recordVideo: false }) })).toBe(false);
    expect(shouldRecordVideoForDevice({ ...config, recordVideo: false }, { capabilities: androidCapabilities })).toBe(false);
  });

  it("keeps successful run videos by default as test evidence", () => {
    expect(normalizeRunConfig({ deviceSerial: "serial" }).keepVideoOnSuccess).toBe(true);
    expect(normalizeRunConfig({ deviceSerial: "serial", keepVideoOnSuccess: false }).keepVideoOnSuccess).toBe(false);
  });

  it("executes repeat_n with enabled steps only", async () => {
    const controller = new RunExecutionController();
    const executed: string[] = [];
    const machine = new RunStateMachine({
      controller,
      config: normalizeRunConfig({ deviceSerial: "serial", repeatCount: 3, stepIntervalMs: 0 }),
      steps,
      executeStep: async ({ iterationIndex, step }) => {
        executed.push(`${iterationIndex}:${step.id}`);
        return { status: "passed" };
      }
    });

    const result = await machine.run();

    expect(result.status).toBe("passed");
    expect(result.completedIterationCount).toBe(3);
    expect(executed).toEqual(["1:2", "2:2", "3:2"]);
  });

  it("stops after the first failed step when stopOnFailure is enabled", async () => {
    const controller = new RunExecutionController();
    const executed: string[] = [];
    const machine = new RunStateMachine({
      controller,
      config: normalizeRunConfig({ deviceSerial: "serial", repeatCount: 3, stepIntervalMs: 0, stopOnFailure: true }),
      steps,
      executeStep: async ({ step }) => {
        executed.push(step.id);
        return { status: "failed" };
      }
    });

    const result = await machine.run();

    expect(result.status).toBe("failed");
    expect(result.executedStepCount).toBe(1);
    expect(executed).toEqual(["2"]);
  });

  it("continues after an optional skipped step", async () => {
    const controller = new RunExecutionController();
    const executableSteps = [
      { ...steps[0], id: "optional", order: 1 },
      { ...steps[0], id: "next", order: 2 }
    ];
    const executed: string[] = [];
    const machine = new RunStateMachine({
      controller,
      config: normalizeRunConfig({ deviceSerial: "serial", stepIntervalMs: 0, stopOnFailure: true }),
      steps: executableSteps,
      executeStep: async ({ step }) => {
        executed.push(step.id);
        return { status: step.id === "optional" ? "skipped" : "passed" };
      }
    });

    const result = await machine.run();

    expect(result.status).toBe("passed");
    expect(result.executedStepCount).toBe(2);
    expect(executed).toEqual(["optional", "next"]);
  });

  it("pauses after each step and resumes on demand", async () => {
    const controller = new RunExecutionController();
    const statusChanges: string[] = [];
    const executableSteps = [
      { ...steps[0], id: "first", order: 1 },
      { ...steps[0], id: "second", order: 2 }
    ];
    const executed: string[] = [];
    const machine = new RunStateMachine({
      controller,
      config: normalizeRunConfig({ deviceSerial: "serial", stepIntervalMs: 0, pauseAfterEachStep: true }),
      steps: executableSteps,
      onStatusChange: (status) => statusChanges.push(status),
      executeStep: async ({ step }) => {
        executed.push(step.id);
        return { status: "passed" };
      }
    });

    const runPromise = machine.run();
    await eventually(() => executed.length === 1);
    await eventually(() => controller.status === "paused");

    expect(controller.status).toBe("paused");
    expect(statusChanges).toContain("paused");

    controller.resume();
    const result = await runPromise;

    expect(result.status).toBe("passed");
    expect(executed).toEqual(["first", "second"]);
  });

  it("supports single stepping while paused", async () => {
    const controller = new RunExecutionController();
    const executableSteps = [
      { ...steps[0], id: "first", order: 1 },
      { ...steps[0], id: "second", order: 2 }
    ];
    const executed: string[] = [];
    controller.pause();
    const machine = new RunStateMachine({
      controller,
      config: normalizeRunConfig({ deviceSerial: "serial", stepIntervalMs: 0 }),
      steps: executableSteps,
      executeStep: async ({ step }) => {
        executed.push(step.id);
        return { status: "passed" };
      }
    });

    const runPromise = machine.run();
    await delay(0);
    expect(executed).toEqual([]);

    controller.step();
    await eventually(() => executed.length === 1);
    expect(controller.status).toBe("paused");

    controller.step();
    const result = await runPromise;

    expect(result.status).toBe("passed");
    expect(executed).toEqual(["first", "second"]);
  });

  it("runs loop_until_stop until the controller stops it", async () => {
    const controller = new RunExecutionController();
    const executed: string[] = [];
    const machine = new RunStateMachine({
      controller,
      config: normalizeRunConfig({ deviceSerial: "serial", mode: "loop_until_stop", stepIntervalMs: 0 }),
      steps,
      executeStep: async ({ iterationIndex, step }) => {
        executed.push(`${iterationIndex}:${step.id}`);
        if (executed.length === 3) {
          controller.stop();
        }
        return { status: "passed" };
      }
    });

    const result = await machine.run();

    expect(result.status).toBe("stopped");
    expect(executed).toEqual(["1:2", "2:2", "3:2"]);
  });
});

describe("graph runner", () => {
  it("executes a planned graph route with preconditions, action, expectations, and system guards", async () => {
    const executionPlan = planTo("homework_create");
    const driver = new MockGraphDriver(["root", "home", "homework_create"]);

    const result = await new GraphRunner({
      executionPlan,
      driver,
      idFactory: fixedIdFactory(),
      now: fixedNow()
    }).run();

    expect(result.status).toBe("passed");
    expect(result.steps.map((step) => step.edgeId)).toEqual(["edge-root-home", "edge-home-homework"]);
    expect(driver.actions.map((action) => action.id)).toEqual(["tap-home", "tap-homework"]);
    expect(result.steps[1]).toEqual(
      expect.objectContaining({
        fromNodeId: "home",
        toNodeId: "homework_create",
        preconditionResults: [expect.objectContaining({ expectationId: "expect-home-ready", status: "passed" })],
        expectationResults: [expect.objectContaining({ expectationId: "expect-homework-ready", status: "passed" })],
        systemGuardResults: [
          expect.objectContaining({ type: "no_crash", status: "passed" }),
          expect.objectContaining({ type: "app_alive", status: "passed" })
        ]
      })
    );
  });

  it("fails before action when the current node does not match the edge source", async () => {
    const executionPlan = planTo("homework_create");
    const driver = new MockGraphDriver(["unexpected"]);

    const result = await new GraphRunner({
      executionPlan,
      driver,
      idFactory: fixedIdFactory(),
      now: fixedNow()
    }).run();

    expect(result.status).toBe("failed");
    expect(result.failure).toEqual(
      expect.objectContaining({
        phase: "precondition",
        code: "FROM_NODE_NOT_MATCHED"
      })
    );
    expect(driver.actions).toEqual([]);
  });

  it("fails in action phase when the selected action cannot be performed", async () => {
    const executionPlan = planTo("home");
    const driver = new MockGraphDriver(["root", "home"], { failActionId: "tap-home" });

    const result = await new GraphRunner({
      executionPlan,
      driver,
      idFactory: fixedIdFactory(),
      now: fixedNow()
    }).run();

    expect(result.status).toBe("failed");
    expect(result.steps[0]).toEqual(
      expect.objectContaining({
        phase: "action",
        errorCode: "ACTION_FAILED"
      })
    );
  });

  it("fails after action when the target node is not reached", async () => {
    const executionPlan = planTo("home");
    const driver = new MockGraphDriver(["root", "settings"]);

    const result = await new GraphRunner({
      executionPlan,
      driver,
      idFactory: fixedIdFactory(),
      now: fixedNow()
    }).run();

    expect(result.status).toBe("failed");
    expect(result.failure).toEqual(
      expect.objectContaining({
        phase: "state_transition",
        code: "TO_NODE_NOT_REACHED"
      })
    );
  });

  it("can skip state transition validation for page task field steps that keep focus on the same page", async () => {
    const basePlan = planTo("home");
    const executionPlan = {
      ...basePlan,
      steps: basePlan.steps.map((step) => ({
        ...step,
        toNode: step.fromNode,
        expectations: [],
        systemGuards: [],
        action: step.action
          ? {
              ...step.action,
              params: {
                ...step.action.params,
                skipStateTransitionValidation: true
              }
            }
          : step.action
      }))
    };
    const driver = new MockGraphDriver(["root", "keyboard_overlay"]);

    const result = await new GraphRunner({
      executionPlan,
      driver,
      idFactory: fixedIdFactory(),
      now: fixedNow()
    }).run();

    expect(result.status).toBe("passed");
    expect(result.steps[0]).toEqual(
      expect.objectContaining({
        phase: "action",
        nodeMatches: expect.objectContaining({
          before: expect.objectContaining({ node: expect.objectContaining({ id: "root" }) })
        })
      })
    );
    expect(result.steps[0]?.nodeMatches.after).toBeUndefined();
  });

  it("records transition deviation and retries observation when a page is still settling", async () => {
    const basePlan = planTo("home");
    const executionPlan = {
      ...basePlan,
      steps: basePlan.steps.map((step) => ({
        ...step,
        failurePolicy: {
          retryCount: 1,
          recoverTo: "replan" as const
        }
      }))
    };
    const driver = new MockGraphDriver(["root", "settings", "home"], { advanceOnStateTransitionObserve: true });

    const result = await new GraphRunner({
      executionPlan,
      driver,
      idFactory: fixedIdFactory(),
      now: fixedNow()
    }).run();

    expect(result.status).toBe("passed");
    expect(result.deviations).toEqual([
      expect.objectContaining({
        phase: "state_transition",
        expectedNodeId: "home",
        actualNodeId: "settings",
        action: "retry_observe",
        attempt: 1
      })
    ]);
  });

  it("polls transition observations until the target node appears within the wait window", async () => {
    const basePlan = planTo("home");
    const executionPlan = {
      ...basePlan,
      steps: basePlan.steps.map((step) => ({
        ...step,
        action: step.action
          ? {
              ...step.action,
              params: {
                ...step.action.params,
                transitionTimeoutMs: 200,
                pollIntervalMs: 10
              }
            }
          : step.action
      }))
    };
    const driver = new MockGraphDriver(["root", "loading", "loading", "home"], { advanceOnEveryStateTransitionObserve: true });

    const result = await new GraphRunner({
      executionPlan,
      driver,
      idFactory: fixedIdFactory(),
      now: fixedNow()
    }).run();

    expect(result.status).toBe("passed");
    expect(result.deviations.map((deviation) => deviation.action)).toEqual(["retry_observe"]);
    expect(result.steps[0]?.nodeMatches.after?.node?.id).toBe("home");
  });

  it("records final recovery requirement when transition retries still miss the target node", async () => {
    const basePlan = planTo("home");
    const executionPlan = {
      ...basePlan,
      steps: basePlan.steps.map((step) => ({
        ...step,
        failurePolicy: {
          retryCount: 1,
          recoverTo: "replan" as const
        }
      }))
    };
    const driver = new MockGraphDriver(["root", "settings", "profile"], { advanceOnStateTransitionObserve: true });

    const result = await new GraphRunner({
      executionPlan,
      driver,
      idFactory: fixedIdFactory(),
      now: fixedNow()
    }).run();

    expect(result.status).toBe("failed");
    expect(result.deviations.map((deviation) => deviation.action)).toEqual(["retry_observe", "replan_required"]);
    expect(result.failure).toEqual(expect.objectContaining({ code: "TO_NODE_NOT_REACHED" }));
  });

  it("fails when a default system guard fails", async () => {
    const executionPlan = planTo("home");
    const driver = new MockGraphDriver(["root", "home"], {
      failedExpectationIds: new Set(["guard_no_crash_edge-root-home"])
    });

    const result = await new GraphRunner({
      executionPlan,
      driver,
      idFactory: fixedIdFactory(),
      now: fixedNow()
    }).run();

    expect(result.status).toBe("failed");
    expect(result.failure).toEqual(
      expect.objectContaining({
        phase: "system_guard",
        code: "SYSTEM_GUARD_FAILED"
      })
    );
  });

  it("validates the target node without performing an action when route is already at the target", async () => {
    const executionPlan = planTo("root");
    const driver = new MockGraphDriver(["root"]);

    const result = await new GraphRunner({
      executionPlan,
      driver,
      idFactory: fixedIdFactory(),
      now: fixedNow()
    }).run();

    expect(result.status).toBe("passed");
    expect(driver.actions).toEqual([]);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toEqual(
      expect.objectContaining({
        edgeId: "__target_validation__",
        fromNodeId: "root",
        toNodeId: "root",
        phase: "target_validation",
        expectationResults: [],
        systemGuardResults: [
          expect.objectContaining({ type: "no_crash", status: "passed" }),
          expect.objectContaining({ type: "app_alive", status: "passed" })
        ]
      })
    );
  });

  it("fails target validation when an already-at-target expectation fails", async () => {
    const executionPlan = planTo("home", "home");
    const driver = new MockGraphDriver(["home"], {
      failedExpectationIds: new Set(["expect-home-ready"])
    });

    const result = await new GraphRunner({
      executionPlan,
      driver,
      idFactory: fixedIdFactory(),
      now: fixedNow()
    }).run();

    expect(result.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(result.failure).toEqual(
      expect.objectContaining({
        phase: "expectation",
        code: "EXPECTATION_FAILED"
      })
    );
    expect(result.steps[0]).toEqual(
      expect.objectContaining({
        edgeId: "__target_validation__",
        expectationResults: [expect.objectContaining({ expectationId: "expect-home-ready", status: "failed" })]
      })
    );
  });

  it("blocks execution when the route has unresolved errors", async () => {
    const graphVersion = graph({
      nodes: [node("root", "root", matcher("activity", "RootActivity")), node("empty", "page", matcher("text", "Empty"))],
      edges: [edge("edge-root-empty", "root", "empty")]
    });
    const routePlan = planRoute({
      graphVersion,
      appId: "demo",
      targetApp: {
        androidPackageName: "com.demo"
      },
      targetNodeId: "empty",
      platform: "android"
    });
    const executionPlan = buildExecutionPlan({
      routePlan,
      platform: "android"
    });

    const result = await new GraphRunner({
      executionPlan,
      driver: new MockGraphDriver(["root", "empty"]),
      idFactory: fixedIdFactory(),
      now: fixedNow()
    }).run();

    expect(result.status).toBe("blocked");
    expect(result.steps).toEqual([]);
    expect(result.failure).toEqual(expect.objectContaining({ code: "MISSING_ACTION_POLICY" }));
  });
});

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await delay(5);
  }
  throw new Error("Condition was not met");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function planTo(targetNodeId: string, startNodeId?: string): ExecutionPlan {
  const graphVersion = graph({
    nodes: [
      node("root", "root", matcher("activity", "RootActivity")),
      {
        ...node("home", "page", matcher("text", "首页")),
        defaultExpectations: [expectation("expect-home-ready", "text")]
      },
      {
        ...node("homework_create", "page", matcher("text", "新建作业")),
        defaultExpectations: [expectation("expect-homework-ready", "text")]
      }
    ],
    edges: [edge("edge-root-home", "root", "home", tapStep("tap-home")), edge("edge-home-homework", "home", "homework_create", tapStep("tap-homework"))]
  });
  const routePlan = planRoute({
    graphVersion,
    appId: "demo",
    targetApp: {
      androidPackageName: "com.demo"
    },
    targetNodeId,
    startNodeId,
    platform: "android",
    now: "2026-06-11T00:00:00.000Z",
    idFactory: (prefix) => `${prefix}-test`
  });
  return buildExecutionPlan({
    routePlan,
    platform: "android",
    now: "2026-06-11T00:00:01.000Z",
    idFactory: (prefix) => `${prefix}-test`
  });
}

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

function edge(id: string, fromNodeId: string, toNodeId: string, action?: ActionStep): OperationEdge {
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
    actionPolicies: action
      ? [
          {
            id: `${action.id}-policy`,
            priority: 1,
            action,
            fallback: false,
            reliabilityHint: "high"
          }
        ]
      : [],
    expectations: []
  };
}

function matcher(type: StateMatcher["type"], value: string): StateMatcher {
  return {
    id: `${type}-${value}`,
    type,
    value,
    weight: 1
  };
}

function tapStep(id: string): ActionStep {
  return {
    id,
    order: 1,
    type: "tap_on_element",
    enabled: true,
    params: {
      locator: {
        strategy: "resource_id",
        resourceId: `com.demo:id/${id}`
      }
    },
    createdAt: "2026-06-11T00:00:00.000Z"
  };
}

function expectation(id: string, type: StepExpectation["type"]): StepExpectation {
  return {
    id,
    type,
    enabled: true,
    params: {},
    createdAt: "2026-06-11T00:00:00.000Z"
  };
}

function fixedIdFactory(): (prefix: string) => string {
  let index = 0;
  return (prefix) => `${prefix}-${++index}`;
}

function fixedNow(): () => string {
  let index = 0;
  return () => `2026-06-11T00:00:${String(index++).padStart(2, "0")}.000Z`;
}

class MockGraphDriver {
  readonly actions: ActionStep[] = [];
  private observeIndex = 0;

  constructor(
    private readonly nodeSequence: string[],
    private readonly options: {
      failActionId?: string;
      failedExpectationIds?: Set<string>;
      advanceOnStateTransitionObserve?: boolean;
      advanceOnEveryStateTransitionObserve?: boolean;
    } = {}
  ) {}

  async observe(_step: ExecutionPlanStep, phase: "precondition" | "state_transition" | "expectation" | "system_guard"): Promise<Observation> {
    const nodeId = this.nodeSequence[Math.min(this.observeIndex, this.nodeSequence.length - 1)] ?? "unknown";
    if (
      phase === "state_transition" &&
      (this.options.advanceOnStateTransitionObserve || this.options.advanceOnEveryStateTransitionObserve) &&
      this.observeIndex < this.nodeSequence.length - 1
    ) {
      this.observeIndex += 1;
      if (this.options.advanceOnStateTransitionObserve) {
        this.options.advanceOnStateTransitionObserve = false;
      }
    }
    return {
      id: `observation-${phase}-${this.observeIndex}`,
      platform: "android",
      capturedAt: "2026-06-11T00:00:00.000Z",
      raw: {
        nodeId
      },
      uiElements: [],
      ocrTexts: []
    };
  }

  async detectNode(observation: Observation): Promise<NodeMatchResult> {
    const nodeId = String(observation.raw?.nodeId ?? "unknown");
    return {
      status: "matched",
      observationId: observation.id,
      capturedAt: observation.capturedAt,
      node: node(nodeId, nodeId === "root" ? "root" : "page"),
      score: 1,
      candidates: [],
      threshold: 0.6
    };
  }

  async performAction(action: ActionStep): Promise<void> {
    this.actions.push(action);
    if (action.id === this.options.failActionId) {
      throw new Error(`Action failed: ${action.id}`);
    }
    this.observeIndex += 1;
  }

  async evaluateExpectation(input: { expectation: StepExpectation; phase: string }): Promise<StepExpectationResult> {
    const failed = this.options.failedExpectationIds?.has(input.expectation.id) ?? false;
    return {
      id: `expectation-result-${input.expectation.id}`,
      expectationId: input.expectation.id,
      type: input.expectation.type,
      status: failed ? "failed" : "passed",
      blocking: true,
      expected: input.expectation.id,
      actual: failed ? "failed" : "passed",
      reason: failed ? `${input.expectation.id} failed during ${input.phase}` : undefined,
      evidenceArtifactIds: [],
      checkedAt: "2026-06-11T00:00:00.000Z"
    };
  }
}
