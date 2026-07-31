import { describe, expect, it } from "vitest";
import { ScriptFlowValidationError, parseScriptFlow } from "./index.js";

const validSource = `
version: 1
name: 指定班级创建课堂但不发布
app:
  id: cn.eeo.classin
  platform: android
start:
  strategy: restartApp
parameters:
  className:
    type: string
    label: 班级
    required: true
  duration:
    type: number
    default: 30
steps:
  - id: open-class
    onPage: classin.teacher.home
    tap:
      target:
        text: \${className}
        area: content
      search:
        mode: auto
        direction: down
        maxSwipes: 8
    expectPage: classin.teacher.class.detail
  - id: select-duration
    onPage: classin.teacher.lesson.create
    risk: interaction
    selectText:
      target:
        text: 课堂时长
        area: content
      value: \${duration}
  - id: verify-form
    assertPage: classin.teacher.lesson.create
`;

describe("parseScriptFlow", () => {
  it("parses flow purpose and semantic step roles as first-class fields", () => {
    const flow = parseScriptFlow(`
version: 1
kind: scenario
purpose: business
name: 创建课堂场景
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: prepare-home
    role: navigation
    reachPage: { page: classin.home, policy: safe }
  - id: publish-lesson
    role: business
    risk: publish
    tap: { target: { text: 发布 } }
  - id: verify-result
    role: assertion
    assertText: { text: 创建成功 }
`);

    expect(flow).toMatchObject({
      kind: "scenario",
      purpose: "business",
      steps: [
        { id: "prepare-home", role: "navigation" },
        { id: "publish-lesson", role: "business" },
        { id: "verify-result", role: "assertion" }
      ]
    });
  });

  it("rejects navigation flows that contain business side effects", () => {
    expect(() => parseScriptFlow(`
version: 1
purpose: navigation
name: 错误导航
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: publish
    role: business
    risk: publish
    tap: { target: { text: 发布 } }
`)).toThrow(/navigation.*business side effects/i);
  });

  it("parses test kind, entry state, and expected outcome as first-class semantics", () => {
    const flow = parseScriptFlow(`
version: 1
kind: case
name: 教师登录
app: { id: cn.eeo.classin, platform: android }
entry:
  page: classin.teacher.login
  session: unauthenticated
outcome:
  page: classin.teacher.classes
  session: authenticated
  role: teacher
steps:
  - id: submit-login
    onPage: classin.teacher.login
    expectPage: classin.teacher.classes
    tap: { target: { text: 登录 } }
`);

    expect(flow).toMatchObject({
      kind: "case",
      entry: { page: "classin.teacher.login", session: "unauthenticated" },
      outcome: { page: "classin.teacher.classes", session: "authenticated", role: "teacher" }
    });
  });

  it("rejects unknown test kinds", () => {
    expect(() => parseScriptFlow(`
version: 1
kind: journey
name: invalid kind
app: { id: cn.eeo.classin, platform: android }
steps: []
`)).toThrow(/kind.*case or scenario/i);
  });

  it("parses a strict ScriptFlow v1 document", () => {
    const flow = parseScriptFlow(validSource);

    expect(flow.version).toBe(1);
    expect(flow.app).toEqual({ id: "cn.eeo.classin", platform: "android" });
    expect(flow.parameters.className).toMatchObject({ type: "string", required: true });
    expect(flow.parameters.duration).toMatchObject({ type: "number", default: 30 });
    expect(flow.steps.map((step) => step.id)).toEqual(["open-class", "select-duration", "verify-form"]);
    expect(flow.steps[0]).toMatchObject({
      tap: {
        target: { text: "${className}", area: "content" },
        search: { mode: "auto", direction: "down", maxSwipes: 8 }
      }
    });
  });

  it("accepts a standard icon target without a recorded element asset", () => {
    const flow = parseScriptFlow(`
version: 1
name: open add menu
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-menu
    tap:
      target:
        icon: add
        area: topBar
        position: trailing
      search: { mode: visibleOnly }
`);

    expect(flow.steps[0]).toMatchObject({
      tap: {
        target: { icon: "add", area: "topBar", position: "trailing" },
        search: { mode: "visibleOnly" }
      }
    });
  });

  it("accepts a semantic target when the exact visible label is unknown", () => {
    const flow = parseScriptFlow(`
version: 1
name: open teaching plan
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-teaching-plan
    tap:
      target:
        semantic: 进入教学方案的入口
        area: content
      search: { mode: auto }
`);

    expect(flow.steps[0]).toMatchObject({
      tap: {
        target: { semantic: "进入教学方案的入口", area: "content" },
        search: { mode: "auto" }
      }
    });
  });

  it("accepts stable visible text as a result assertion", () => {
    const flow = parseScriptFlow(`
version: 1
name: verify an unrecorded result page
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: verify-teaching-plan
    assertText:
      text: 教学方案列表
      match: contains
`);

    expect(flow.steps[0]).toMatchObject({
      assertText: { text: "教学方案列表", match: "contains" }
    });
  });

  it("rejects an empty text assertion", () => {
    expect(() => parseScriptFlow(`
version: 1
name: invalid text assertion
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: verify-result
    assertText: { text: "" }
`)).toThrow(/assertText\.text.*non-empty string/i);
  });

  it("requires semantic and literal target forms to remain mutually exclusive", () => {
    expect(() => parseScriptFlow(`
version: 1
name: ambiguous target
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-teaching-plan
    tap:
      target:
        text: 教学方案
        semantic: 进入教学方案的入口
`)).toThrow(/exactly one of text, semantic, icon, or control/i);
  });

  it("accepts a standard floating add icon in the page content", () => {
    const flow = parseScriptFlow(`
version: 1
name: open publish activity
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-publish-activity
    tap:
      target: { icon: add, area: content, position: trailing }
      search: { mode: visibleOnly }
`);

    expect(flow.steps[0]).toMatchObject({
      tap: {
        target: { icon: "add", area: "content", position: "trailing" },
        search: { mode: "visibleOnly" }
      }
    });
  });

  it("parses a goal-directed reachPage step without prescribing navigation mechanics", () => {
    const flow = parseScriptFlow(`
version: 1
name: return home
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: reach-home
    reachPage:
      page: classin.home
      policy: safe
`);

    expect(flow.steps[0]).toEqual({
      id: "reach-home",
      role: "navigation",
      reachPage: { page: "classin.home", policy: "safe" }
    });
  });

  it("rejects unsupported reachPage policies instead of silently enabling destructive navigation", () => {
    expect(() => parseScriptFlow(`
version: 1
name: unsafe home
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: reach-home
    reachPage: { page: classin.home, policy: restart }
`)).toThrow(/reachPage\.policy.*safe/i);
  });

  it("rejects bottom bar icon areas that are not supported by the v1 visual resolver", () => {
    expect(() => parseScriptFlow(`
version: 1
name: unsupported icon area
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-tab
    tap:
      target: { icon: growth, area: bottomBar, position: trailing }
    `)).toThrow(/bottom bar icon targets are not supported/i);
  });

  it("accepts the same bounded search policy for input, clear, and select actions", () => {
    const flow = parseScriptFlow(`
version: 1
name: searchable form fields
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: fill-name
    inputText:
      target: { text: 课堂名称 }
      value: 自动化课堂
      search: { mode: auto, direction: down, maxSwipes: 6 }
  - id: clear-name
    clearText:
      target: { text: 课堂名称 }
      search: { mode: scroll, direction: both, maxSwipes: 4 }
  - id: select-duration
    risk: interaction
    selectText:
      target: { text: 课堂时长 }
      value: 30分钟
      search: { mode: auto, direction: down, maxSwipes: 5 }
`);

    expect(flow.steps).toMatchObject([
      { inputText: { search: { mode: "auto", direction: "down", maxSwipes: 6 } } },
      { clearText: { search: { mode: "scroll", direction: "both", maxSwipes: 4 } } },
      { selectText: { search: { mode: "auto", direction: "down", maxSwipes: 5 } } }
    ]);
  });

  it("rejects absolute coordinates instead of accepting a hidden coordinate fallback", () => {
    expect(() => parseScriptFlow(`
version: 1
name: invalid
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: tap-by-coordinate
    tap:
      target: { x: 100, y: 200 }
`)).toThrow(/absolute coordinates are not supported/i);
  });

  it("rejects unknown fields with their exact document path", () => {
    try {
      parseScriptFlow(`
version: 1
name: invalid
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-home
    tap:
      target: { text: 主页 }
    magicRetry: true
`);
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ScriptFlowValidationError);
      expect((error as ScriptFlowValidationError).issues).toContainEqual({
        path: "steps[0].magicRetry",
        message: "Unknown field"
      });
    }
  });

  it("requires exactly one action per step", () => {
    expect(() => parseScriptFlow(`
version: 1
name: invalid
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: ambiguous
    tap: { target: { text: 主页 } }
    assertPage: classin.teacher.home
`)).toThrow(/exactly one action/i);
  });

  it("rejects duplicate step ids across nested control blocks", () => {
    expect(() => parseScriptFlow(`
version: 1
name: invalid
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: duplicate
    repeat:
      times: 2
      steps:
        - id: duplicate
          tap: { target: { text: 主页 } }
`)).toThrow(/duplicate step id.*duplicate/i);
  });

  it("rejects undeclared parameter references", () => {
    expect(() => parseScriptFlow(`
version: 1
name: invalid
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: search
    inputText:
      target: { text: 搜索输入框 }
      value: \${query}
`)).toThrow(/undeclared parameter.*query/i);
  });

  it.each(["visualTemplate", "within"])("rejects unsupported target field %s", (field) => {
    expect(() => parseScriptFlow(`
version: 1
name: unsupported target
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: target
    tap:
      target:
        text: 主页
        ${field}: legacy
`)).toThrow(new RegExp(`target\\.${field}.*unknown field`, "i"));
  });

  it("requires exactly one supported target strategy", () => {
    expect(() => parseScriptFlow(`
version: 1
name: ambiguous target
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: target
    tap:
      target: { text: 主页, icon: home, area: topBar, position: leading }
`)).toThrow(/exactly one of text, semantic, icon, or control/i);
  });

  it("rejects reusable element references as an unknown target field", () => {
    expect(() => parseScriptFlow(`
version: 1
name: legacy element reference
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open
    onPage: lesson-create
    tap: { target: { ref: details-button } }
`)).toThrow(/target\.ref.*unknown field/i);
  });

  it("accepts a checkbox described by a nearby text anchor", () => {
    const flow = parseScriptFlow(`
version: 1
name: accept agreement
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: accept
    tap:
      target:
        control: checkbox
        nearText: 我已阅读并同意
        area: content
`);

    expect(flow.steps[0]).toMatchObject({
      tap: { target: { control: "checkbox", nearText: "我已阅读并同意", area: "content" } }
    });
  });

  it("rejects risk none for click-like interactions", () => {
    expect(() => parseScriptFlow(`
version: 1
name: unsafe opt out
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: order
    risk: none
    tap: { target: { text: 立即下单 } }
`)).toThrow(/tap.*risk none/i);
  });

  it("rejects unknown risk declarations", () => {
    expect(() => parseScriptFlow(`
version: 1
name: invalid risk
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: target
    risk: dangerous
    tap: { target: { text: 主页 } }
`)).toThrow(/risk must be interaction, submit, publish, delete, or payment/i);
  });

  it("rejects defaults for sensitive parameters", () => {
    expect(() => parseScriptFlow(`
version: 1
name: sensitive default
app: { id: cn.eeo.classin, platform: android }
parameters:
  password: { type: string, sensitive: true, default: secret }
steps:
  - id: login
    inputText: { target: { text: 密码 }, value: "\${password}" }
`)).toThrow(/sensitive parameter cannot define a default/i);
  });

  it("rejects unbounded static loops", () => {
    expect(() => parseScriptFlow(`
version: 1
name: invalid
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: loop
    repeat:
      times: 101
      steps:
        - id: go-back
          tap: { target: { text: 返回 } }
`)).toThrow(/repeat times must be between 1 and 100/i);
  });

  it.each(["ocrText", "pageElement"])("rejects deprecated target field %s", (field) => {
    expect(() => parseScriptFlow(`
version: 1
name: deprecated target
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: target
    tap:
      target:
        ${field}: legacy
`)).toThrow(new RegExp(`target\\.${field}.*unknown field`, "i"));
  });

  it("accepts Harmony and Flutter as target profile platforms", () => {
    expect(parseScriptFlow(validSource.replace("platform: android", "platform: harmony")).app.platform).toBe("harmony");
    expect(parseScriptFlow(validSource.replace("platform: android", "platform: flutter")).app.platform).toBe("flutter");
  });
});
