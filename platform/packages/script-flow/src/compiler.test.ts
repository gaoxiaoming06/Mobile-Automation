import { describe, expect, it } from "vitest";
import { ScriptFlowCompileError, compileScriptFlow, parseScriptFlow } from "./index.js";

describe("compileScriptFlow", () => {
  it("resolves runtime parameters and defaults into a linear execution plan", () => {
    const flow = parseScriptFlow(`
version: 1
name: create lesson
app: { id: cn.eeo.classin, platform: android }
parameters:
  className: { type: string, required: true }
  duration: { type: number, default: 30 }
steps:
  - id: open-class
    onPage: home
    tap: { target: { ocrText: "\${className}" } }
    expectPage: class-detail
  - id: select-duration
    onPage: lesson-create
    risk: interaction
    selectText:
      target: { pageElement: duration-picker }
      value: "\${duration}"
`);

    const plan = compileScriptFlow(flow, { parameters: { className: "班级四十二号" } });

    expect(plan.parameters).toEqual({ className: "班级四十二号", duration: 30 });
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]).toMatchObject({
      order: 1,
      id: "open-class",
      action: "tap",
      onPage: "home",
      expectPage: "class-detail",
      input: { target: { ocrText: "班级四十二号" } }
    });
    expect(plan.steps[1]).toMatchObject({
      order: 2,
      id: "select-duration",
      action: "selectText",
      input: { value: "30" }
    });
  });

  it("expands repeat and parameter conditions deterministically", () => {
    const flow = parseScriptFlow(`
version: 1
name: repeat actions
app: { id: cn.eeo.classin, platform: android }
parameters:
  count: { type: number, default: 2 }
  shouldSearch: { type: boolean, default: true }
steps:
  - id: repeat-back
    repeat:
      times: "\${count}"
      steps:
        - id: back
          tap: { target: { ocrText: 返回 } }
  - id: optional-search
    when:
      parameter: shouldSearch
      equals: true
      steps:
        - id: search
          tap: { target: { ocrText: 搜索 } }
`);

    const plan = compileScriptFlow(flow);

    expect(plan.steps.map((step) => step.id)).toEqual(["repeat-back[1].back", "repeat-back[2].back", "optional-search.search"]);
    expect(plan.steps.map((step) => step.order)).toEqual([1, 2, 3]);
  });

  it("expands runFlow with explicit child parameter bindings", () => {
    const child = parseScriptFlow(`
version: 1
name: open class
app: { id: cn.eeo.classin, platform: android }
parameters:
  targetClass: { type: string, required: true }
steps:
  - id: tap-class
    tap: { target: { ocrText: "\${targetClass}" } }
`);
    const parent = parseScriptFlow(`
version: 1
name: parent
app: { id: cn.eeo.classin, platform: android }
parameters:
  className: { type: string, required: true }
steps:
  - id: open-class
    runFlow: open-class
    with:
      targetClass: "\${className}"
`);

    const plan = compileScriptFlow(parent, {
      parameters: { className: "班级四十二号" },
      resolveFlow: (id) => id === "open-class" ? child : undefined
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      id: "open-class.tap-class",
      action: "tap",
      input: { target: { ocrText: "班级四十二号" } },
      source: { flowName: "open class", stepId: "tap-class" }
    });
  });

  it("preserves number and boolean values in runFlow parameter bindings", () => {
    const child = parseScriptFlow(`
version: 1
name: configure child
app: { id: cn.eeo.classin, platform: android }
parameters:
  duration: { type: number, required: true }
  enabled: { type: boolean, required: true }
steps:
  - id: conditional-duration
    when:
      parameter: enabled
      equals: true
      steps:
        - id: duration
          selectText:
            target: { ocrText: 课堂时长 }
            value: "\${duration}"
`);
    const parent = parseScriptFlow(`
version: 1
name: configure parent
app: { id: cn.eeo.classin, platform: android }
parameters:
  duration: { type: number, default: 30 }
  enabled: { type: boolean, default: true }
steps:
  - id: child
    runFlow: configure-child
    with:
      duration: "\${duration}"
      enabled: "\${enabled}"
`);

    const plan = compileScriptFlow(parent, {
      resolveFlow: (id) => id === "configure-child" ? child : undefined
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      id: "child.conditional-duration.duration",
      input: { value: "30" }
    });
  });

  it("rejects recursive runFlow references", () => {
    const recursive = parseScriptFlow(`
version: 1
name: recursive
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: recurse
    runFlow: recursive
`);

    expect(() => compileScriptFlow(recursive, {
      resolveFlow: (id) => id === "recursive" ? recursive : undefined
    })).toThrow(/recursive runFlow.*recursive/i);
  });

  it("rejects missing and mistyped runtime parameters", () => {
    const flow = parseScriptFlow(`
version: 1
name: params
app: { id: cn.eeo.classin, platform: android }
parameters:
  count: { type: number, required: true }
steps:
  - id: wait-home
    waitForPage: home
`);

    expect(() => compileScriptFlow(flow)).toThrowError(ScriptFlowCompileError);
    expect(() => compileScriptFlow(flow, { parameters: { count: "two" } })).toThrow(/parameter count must be number/i);
  });

  it("marks publish and delete actions as confirmation risks", () => {
    const flow = parseScriptFlow(`
version: 1
name: risky
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: publish
    tap: { target: { ocrText: 发布 } }
  - id: delete
    tap: { target: { ocrText: 删除当前课堂 } }
  - id: safe
    tap: { target: { ocrText: 返回 } }
`);

    const plan = compileScriptFlow(flow);

    expect(plan.steps.map((step) => step.risk)).toEqual(["publish", "delete", "interaction"]);
    expect(plan.riskConfirmations).toEqual([
      { stepId: "publish", risk: "publish" },
      { stepId: "delete", risk: "delete" },
      { stepId: "safe", risk: "interaction" }
    ]);
  });

  it("binds explicit pageElement risk confirmation to its exact step", () => {
    const flow = parseScriptFlow(`
version: 1
name: publish once
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: publish-lesson
    name: 发布课堂
    onPage: lesson-create
    risk: publish
    tap: { target: { pageElement: publish-button } }
`);

    const plan = compileScriptFlow(flow);

    expect(plan.steps[0].risk).toBe("publish");
    expect(plan.riskConfirmations).toEqual([
      { stepId: "publish-lesson", risk: "publish", stepName: "发布课堂" }
    ]);
  });
});
