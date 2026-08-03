import { describe, expect, it } from "vitest";
import { ScriptFlowCompileError, compileScriptFlow, parseScriptFlow } from "./index.js";

describe("compileScriptFlow", () => {
  it("compiles reset steps as a distinct execution phase", () => {
    const flow = parseScriptFlow(`
version: 1
name: 循环打开笔记
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-note
    role: business
    tap: { target: { text: 笔记 } }
  - id: return-home
    role: reset
    tap: { target: { text: 主页 } }
`);

    const plan = compileScriptFlow(flow);

    expect(plan.steps).toEqual([
      expect.objectContaining({ id: "open-note", phase: "business" }),
      expect.objectContaining({ id: "return-home", role: "reset", phase: "reset" })
    ]);
  });

  it("keeps purpose, test level, and semantic roles in the execution plan", () => {
    const flow = parseScriptFlow(`
version: 1
purpose: fixture
testLevel: component
name: 教师登录
app: { id: cn.eeo.classin, platform: android }
entry: { session: unauthenticated }
outcome: { session: authenticated, role: teacher }
steps:
  - id: submit-login
    role: setup
    risk: submit
    tap: { target: { text: 登录 } }
`);

    const plan = compileScriptFlow(flow);

    expect(plan).toMatchObject({
      purpose: "fixture",
      testLevel: "component",
      steps: [{ id: "submit-login", role: "setup" }]
    });
  });

  it("does not turn declared entry and outcome metadata into hidden execution steps", () => {
    const flow = parseScriptFlow(`
version: 1
kind: case
name: teacher login
app: { id: cn.eeo.classin, platform: android }
entry: { page: classin.teacher.login, session: unauthenticated }
outcome: { page: classin.teacher.classes, session: authenticated, role: teacher }
parameters:
  account: { type: string, required: true }
steps:
  - id: input-account
    inputText:
      target: { text: 手机号或邮箱, area: content }
      value: "\${account}"
`);

    const plan = compileScriptFlow(flow, { parameters: { account: "teacher@example.com" } });

    expect(plan).toMatchObject({
      kind: "case",
      entry: { page: "classin.teacher.login", session: "unauthenticated" },
      outcome: { page: "classin.teacher.classes", session: "authenticated", role: "teacher" }
    });
    expect(plan.steps).toEqual([
      expect.objectContaining({ id: "input-account", phase: "business", action: "inputText" })
    ]);
  });

  it("requires result verification to be an explicit script step", () => {
    const flow = parseScriptFlow(`
version: 1
name: open settings
app: { id: cn.eeo.classin, platform: android }
outcome: { page: classin.settings }
steps:
  - id: open-settings
    tap: { target: { text: 设置 } }
`);

    const plan = compileScriptFlow(flow);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ id: "open-settings", action: "tap", phase: "business" });
  });

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
    tap: { target: { text: "\${className}" }, search: { mode: auto } }
    expectPage: class-detail
  - id: select-duration
    onPage: lesson-create
    risk: interaction
    selectText:
      target: { text: 课堂时长, area: content }
      value: "\${duration}"
      search: { mode: auto, direction: down, maxSwipes: 5 }
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
      input: { target: { text: "班级四十二号" }, search: { mode: "auto" } }
    });
    expect(plan.steps[1]).toMatchObject({
      order: 2,
      id: "select-duration",
      action: "selectText",
      input: {
        value: "30",
        search: { mode: "auto", direction: "down", maxSwipes: 5 }
      }
    });
  });

  it("compiles reachPage as one explicit goal-directed execution step", () => {
    const flow = parseScriptFlow(`
version: 1
name: reach home
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: reach-home
    name: 到达主页
    reachPage: { page: classin.home, policy: safe }
`);

    const plan = compileScriptFlow(flow);

    expect(plan.steps).toEqual([
      expect.objectContaining({
        id: "reach-home",
        action: "reachPage",
        input: { pageId: "classin.home", policy: "safe" }
      })
    ]);
    expect(plan).not.toHaveProperty("riskConfirmations");
  });

  it("preserves semantic targets in the execution plan", () => {
    const flow = parseScriptFlow(`
version: 1
name: open teaching plan
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-teaching-plan
    tap:
      target: { semantic: 进入教学方案的入口, area: content }
      search: { mode: auto }
`);

    expect(compileScriptFlow(flow).steps[0]).toMatchObject({
      action: "tap",
      input: {
        target: { semantic: "进入教学方案的入口", area: "content" },
        search: { mode: "auto" }
      }
    });
  });

  it("compiles a stable-text result assertion in the verification phase", () => {
    const flow = parseScriptFlow(`
version: 1
name: verify unrecorded page
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: verify-result
    name: 确认进入教学方案页
    timeoutMs: 6000
    assertText: { text: 教学方案列表, match: exact }
`);

    expect(compileScriptFlow(flow).steps[0]).toMatchObject({
      id: "verify-result",
      action: "assertText",
      phase: "verification",
      input: { text: "教学方案列表", match: "exact" },
      timeoutMs: 6000
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
          tap: { target: { text: 返回 } }
  - id: optional-search
    when:
      parameter: shouldSearch
      equals: true
      steps:
        - id: search
          tap: { target: { text: 搜索 } }
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
    tap: { target: { text: "\${targetClass}" } }
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
      input: { target: { text: "班级四十二号" } },
      source: { flowName: "open class", stepId: "tap-class" }
    });
  });

  it("does not turn a child flow outcome into an implicit assertion", () => {
    const child = parseScriptFlow(`
version: 1
name: open class detail
app: { id: cn.eeo.classin, platform: android }
outcome: { page: classin.class.detail }
steps:
  - id: tap-class
    tap: { target: { text: 班级四十二号 } }
`);
    const parent = parseScriptFlow(`
version: 1
name: parent scenario
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-class
    runFlow: open-class-detail
`);

    const plan = compileScriptFlow(parent, {
      resolveFlow: (id) => id === "open-class-detail" ? child : undefined
    });

    expect(plan.steps).toEqual([expect.objectContaining({
      id: "open-class.tap-class",
      action: "tap",
      source: { flowName: "open class detail", stepId: "tap-class" }
    })]);
    expect(plan).not.toHaveProperty("outcome");
  });

  it("inherits same-named parent parameters when runFlow omits explicit bindings", () => {
    const child = parseScriptFlow(`
version: 1
name: teacher login
app: { id: cn.eeo.classin, platform: android }
parameters:
  account: { type: string, required: true, sensitive: true }
  password: { type: string, required: true, sensitive: true }
steps:
  - id: input-account
    inputText: { target: { text: 手机号或邮箱, area: content }, value: "\${account}" }
  - id: input-password
    inputText: { target: { text: 密码, area: content }, value: "\${password}" }
`);
    const parent = parseScriptFlow(`
version: 1
name: relogin
app: { id: cn.eeo.classin, platform: android }
parameters:
  account: { type: string, required: true, sensitive: true }
  password: { type: string, required: true, sensitive: true }
steps:
  - id: login
    runFlow: teacher-login
`);

    const plan = compileScriptFlow(parent, {
      parameters: { account: "teacher@example.com", password: "secret" },
      resolveFlow: (id) => id === "teacher-login" ? child : undefined
    });

    expect(plan.steps.map((step) => step.input.value)).toEqual(["teacher@example.com", "secret"]);
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
            target: { text: 课堂时长 }
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

  it("does not classify actions from their target text", () => {
    const flow = parseScriptFlow(`
version: 1
name: risky
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: publish
    tap: { target: { text: 发布 } }
  - id: delete
    tap: { target: { text: 删除当前课堂 } }
  - id: safe
    tap: { target: { text: 返回 } }
`);

    const plan = compileScriptFlow(flow);

    expect(plan.steps.every((step) => !("risk" in step))).toBe(true);
    expect(plan).not.toHaveProperty("riskConfirmations");
  });

  it("discards legacy risk metadata", () => {
    const flow = parseScriptFlow(`
version: 1
name: publish once
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: publish-lesson
    name: 发布课堂
    onPage: lesson-create
    risk: publish
    tap: { target: { text: 发布, area: content, match: exact } }
`);

    const plan = compileScriptFlow(flow);

    expect(plan.steps[0]).not.toHaveProperty("risk");
    expect(plan).not.toHaveProperty("riskConfirmations");
  });
});
