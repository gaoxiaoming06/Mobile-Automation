import { describe, expect, it } from "vitest";
import { ScriptFlowValidationError, parseScriptFlow } from "./index.js";

const validSource = `
version: 1
name: 指定班级创建课堂但不发布
app:
  id: cn.eeo.classin
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
    before: { screenRef: classin.teacher.home }
    tap:
      target:
        text: \${className}
        area: content
      search:
        mode: auto
        direction: down
        maxSwipes: 8
    after: { screenRef: classin.teacher.class.detail }
  - id: select-duration
    before: { screenRef: classin.teacher.lesson.create }
    risk: interaction
    selectText:
      target:
        text: 课堂时长
        area: content
      value: \${duration}
  - id: verify-form
    assertPage: { screenRef: classin.teacher.lesson.create }
`;

describe("parseScriptFlow", () => {
  it("parses an explicit no-reset loop contract", () => {
    const flow = parseScriptFlow(`
version: 1
name: 同页刷新
app: { id: cn.eeo.classin, platform: android }
loop: { reset: none }
steps:
  - id: refresh
    role: business
    tap: { target: { text: 刷新 } }
`);

    expect(flow.loop).toEqual({ reset: "none" });
  });

  it("parses flow purpose and semantic step roles as first-class fields", () => {
    const flow = parseScriptFlow(`
version: 1
kind: scenario
purpose: business
testLevel: business_smoke
name: 创建课堂场景
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: prepare-home
    role: navigation
    waitForPage: { screenRef: classin.home }
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
      testLevel: "business_smoke",
      steps: [
        { id: "prepare-home", role: "navigation" },
        { id: "publish-lesson", role: "business" },
        { id: "verify-result", role: "assertion" }
      ]
    });
  });

  it("treats purpose as metadata instead of blocking explicit steps", () => {
    const flow = parseScriptFlow(`
version: 1
purpose: navigation
name: 混合流程
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: publish
    role: business
    risk: publish
    tap: { target: { text: 发布 } }
`);

    expect(flow.purpose).toBe("navigation");
    expect(flow.steps[0]).toMatchObject({ id: "publish", role: "business", tap: { target: { text: "发布" } } });
    expect(flow.steps[0]).not.toHaveProperty("risk");
  });

  it("parses test kind, entry state, and expected outcome as first-class semantics", () => {
    const flow = parseScriptFlow(`
version: 1
kind: case
name: 教师登录
app: { id: cn.eeo.classin, platform: android }
entry:
  screenRef: classin.teacher.login
  session: unauthenticated
outcome:
  screenRef: classin.teacher.classes
  session: authenticated
  role: teacher
steps:
  - id: submit-login
    before: { screenRef: classin.teacher.login }
    after: { screenRef: classin.teacher.classes }
    tap: { target: { text: 登录 } }
`);

    expect(flow).toMatchObject({
      kind: "case",
      testLevel: "business_smoke",
      entry: { screenRef: "classin.teacher.login", session: "unauthenticated" },
      outcome: { screenRef: "classin.teacher.classes", session: "authenticated", role: "teacher" }
    });
  });

  it("rejects unknown test levels", () => {
    expect(() => parseScriptFlow(`
version: 1
testLevel: journey
name: invalid level
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: assert-home
    assertText: { text: 主页 }
`)).toThrow(/testLevel.*probe, component, business_smoke, or full_regression/i);
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
    expect(flow.app).toEqual({ id: "cn.eeo.classin" });
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

  it("parses a fixed delay wait step", () => {
    const flow = parseScriptFlow(`
version: 1
name: wait between actions
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: submit
    tap: { target: { text: 提交 } }
  - id: wait-after-submit
    name: 提交后停留 3 秒
    wait: { durationMs: 3000 }
  - id: continue
    tap: { target: { text: 继续 } }
`);

    expect(flow.steps[1]).toMatchObject({
      id: "wait-after-submit",
      name: "提交后停留 3 秒",
      role: "business",
      wait: { durationMs: 3000 }
    });
  });

  it("rejects fixed delay waits without a positive duration", () => {
    expect(() => parseScriptFlow(`
version: 1
name: invalid wait
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: wait-without-duration
    wait: {}
`)).toThrow(/wait\.durationMs.*positive number/i);

    expect(() => parseScriptFlow(`
version: 1
name: invalid wait
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: wait-zero
    wait: { durationMs: 0 }
`)).toThrow(/wait\.durationMs.*positive number/i);
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

  it("accepts a standard icon target even when the precise bar position is unknown", () => {
    const flow = parseScriptFlow(`
version: 1
name: open search
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-search
    tap:
      target:
        icon: search
      search: { mode: visibleOnly }
`);

    expect(flow.steps[0]).toMatchObject({
      tap: {
        target: { icon: "search" },
        search: { mode: "visibleOnly" }
      }
    });
  });

  it("accepts a visual icon target with scoped visual hints", () => {
    const flow = parseScriptFlow(`
version: 1
name: tap sort icon
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: tap-sort-icon
    tap:
      target:
        visual:
          kind: icon
          query: 排序图标
          area: content
          nearText: 课节
          scopeText: 工具区
          ordinal: 2
      search: { mode: visibleOnly }
`);

    expect(flow.steps[0]).toMatchObject({
      tap: {
        target: {
          visual: {
            kind: "icon",
            query: "排序图标",
            area: "content",
            nearText: "课节",
            scopeText: "工具区",
            ordinal: 2
          }
        },
        search: { mode: "visibleOnly" }
      }
    });
  });

  it("accepts OCR text targets with semantic match mode", () => {
    const flow = parseScriptFlow(`
version: 1
name: open teaching plan
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-teaching-plan
    tap:
      target:
        text: 进入教学方案的入口
        match: semantic
        area: content
      search: { mode: auto }
`);

    expect(flow.steps[0]).toMatchObject({
      tap: {
        target: { text: "进入教学方案的入口", match: "semantic", area: "content" },
        search: { mode: "auto" }
      }
    });
  });

  it("rejects legacy semantic targets", () => {
    expect(() => parseScriptFlow(`
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
`)).toThrow(/target\.semantic.*Unknown field/i);
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

  it("rejects legacy semantic targets even when mixed with a text target", () => {
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
`)).toThrow(/target\.semantic.*Unknown field/i);
  });

  it("accepts a standard floating add icon in the lower page content", () => {
    const flow = parseScriptFlow(`
version: 1
name: open publish activity
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-publish-activity
    tap:
      target: { icon: add, area: content, position: trailing, vertical: bottom }
      search: { mode: visibleOnly }
`);

    expect(flow.steps[0]).toMatchObject({
      tap: {
        target: { icon: "add", area: "content", position: "trailing", vertical: "bottom" },
        search: { mode: "visibleOnly" }
      }
    });
  });

  it("accepts a visual icon target with vertical placement hints", () => {
    const flow = parseScriptFlow(`
version: 1
name: open bottom visual button
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-visual-button
    tap:
      target:
        visual:
          kind: icon
          query: 右下角加号按钮
          area: content
          position: trailing
          vertical: bottom
      search: { mode: visibleOnly }
`);

    expect(flow.steps[0]).toMatchObject({
      tap: {
        target: {
          visual: {
            kind: "icon",
            query: "右下角加号按钮",
            area: "content",
            position: "trailing",
            vertical: "bottom"
          }
        }
      }
    });
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
    assertPage: { screenRef: classin.teacher.home }
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
`)).toThrow(/exactly one of text, icon, visual, or control/i);
  });

  it("rejects reusable element references as an unknown target field", () => {
    expect(() => parseScriptFlow(`
version: 1
name: legacy element reference
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open
    before: { screenRef: lesson-create }
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

  it("accepts a switch described by nearby text and desired state", () => {
    const flow = parseScriptFlow(`
version: 1
name: enable recording
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: enable-recording
    tap:
      target:
        control: switch
        nearText: 录制ClassIn教室
        area: content
        checked: true
`);

    expect(flow.steps[0]).toMatchObject({
      tap: { target: { control: "switch", nearText: "录制ClassIn教室", area: "content", checked: true } }
    });
  });

  it("requires switch control targets to use a nearby text anchor and desired state", () => {
    expect(() => parseScriptFlow(`
version: 1
name: invalid switch
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: enable-recording
    tap:
      target:
        control: switch
        area: content
`)).toThrow(/switch.*nearText.*checked.*area content/i);
  });

  it("accepts a text field described by scope and ordinal without using dynamic current text", () => {
    const flow = parseScriptFlow(`
version: 1
name: fill lesson title
app: { id: cn.eeo.classin, platform: android }
parameters:
  lessonName: { type: string, required: true }
steps:
  - id: fill-title
    role: business
    inputText:
      target:
        control: textField
        area: content
        scopeText: 课堂信息
        ordinal: 1
      value: \${lessonName}
      search: { mode: visibleOnly }
`);

    expect(flow.steps[0]).toMatchObject({
      inputText: {
        target: {
          control: "textField",
          area: "content",
          scopeText: "课堂信息",
          ordinal: 1
        },
        value: "${lessonName}",
        search: { mode: "visibleOnly" }
      }
    });
  });

  it("accepts a text field described only by content ordinal", () => {
    const flow = parseScriptFlow(`
version: 1
name: fill first field
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: fill-first-field
    role: business
    inputText:
      target:
        control: textField
        area: content
        ordinal: 1
      value: 自动化课堂
      search: { mode: auto }
`);

    expect(flow.steps[0]).toMatchObject({
      inputText: {
        target: {
          control: "textField",
          area: "content",
          ordinal: 1
        },
        value: "自动化课堂",
        search: { mode: "auto" }
      }
    });
  });

  it("accepts a text field described by a relative text anchor", () => {
    const flow = parseScriptFlow(`
version: 1
name: fill field above start time
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: fill-title
    role: business
    inputText:
      target:
        control: textField
        area: content
        anchorText: 开始时间
        relation: above
      value: 自动化课堂
      search: { mode: auto }
`);

    expect(flow.steps[0]).toMatchObject({
      inputText: {
        target: {
          control: "textField",
          area: "content",
          anchorText: "开始时间",
          relation: "above"
        }
      }
    });
  });

  it("accepts composer buttons as content icon targets", () => {
    const flow = parseScriptFlow(`
version: 1
name: send message reaction
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-emoji-panel
    role: business
    tap:
      target:
        icon: emoji
        area: content
        position: leading
      search: { mode: visibleOnly }
  - id: send
    role: business
    tap:
      target:
        icon: arrowUp
        area: content
        position: trailing
      search: { mode: visibleOnly }
`);

    expect(flow.steps).toMatchObject([
      {
        tap: {
          target: {
            icon: "emoji",
            area: "content",
            position: "leading"
          }
        }
      },
      {
        tap: {
          target: {
            icon: "arrowUp",
            area: "content",
            position: "trailing"
          }
        }
      }
    ]);
  });

  it("rejects legacy scoped control target fields", () => {
    expect(() => parseScriptFlow(`
version: 1
name: invalid scoped control
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: tap-button
    role: business
    tap:
      target:
        control: iconButton
        scope: messageComposer
        role: emojiPicker
`)).toThrow(/iconButton|Unknown field/i);
  });

  it("accepts a content search icon target as a semantic visual target", () => {
    const flow = parseScriptFlow(`
version: 1
name: open content search
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open-search
    tap:
      target:
        icon: search
        area: content
      search: { mode: visibleOnly }
`);

    expect(flow.steps[0]).toMatchObject({
      tap: {
        target: { icon: "search", area: "content" },
        search: { mode: "visibleOnly" }
      }
    });
  });

  it("requires text field control targets to use content scope and positive ordinal", () => {
    expect(() => parseScriptFlow(`
version: 1
name: invalid text field
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: fill-title
    inputText:
      target:
        control: textField
        area: topBar
        scopeText: 课堂信息
        ordinal: 0
      value: 自动化课堂
`)).toThrow(/textField.*scopeText.*ordinal.*area content/i);
  });

  it("accepts and discards legacy risk metadata", () => {
    const none = parseScriptFlow(`
version: 1
name: legacy risk none
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: order
    risk: none
    tap: { target: { text: 立即下单 } }
`);
    const unknown = parseScriptFlow(`
version: 1
name: legacy unknown risk
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: target
    risk: dangerous
    tap: { target: { text: 主页 } }
`);

    expect(none.steps[0]).not.toHaveProperty("risk");
    expect(unknown.steps[0]).not.toHaveProperty("risk");
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

  it("ignores legacy app platform fields so scripts stay cross-platform", () => {
    expect(parseScriptFlow(validSource.replace("id: cn.eeo.classin", "id: cn.eeo.classin\n  platform: harmony")).app).toEqual({ id: "cn.eeo.classin" });
    expect(parseScriptFlow(validSource.replace("id: cn.eeo.classin", "id: cn.eeo.classin\n  platform: ios")).app).toEqual({ id: "cn.eeo.classin" });
  });

  it("uses screen contracts and rejects legacy page contract fields", () => {
    const flow = parseScriptFlow(`
version: 1
name: create class
app: { id: cn.eeo.classin }
entry: { screenRef: classin.home }
outcome: { screenRef: classin.class.detail }
steps:
  - id: open-create
    before: { screenRef: classin.home }
    after: { screenRef: classin.class.detail }
    tap: { target: { text: 创建课堂 } }
  - id: return-home
    waitForPage: { screenRef: classin.home }
`);

    expect(flow.entry).toEqual({ screenRef: "classin.home" });
    expect(flow.outcome).toEqual({ screenRef: "classin.class.detail" });
    expect(flow.steps[0]).toMatchObject({
      before: { screenRef: "classin.home" },
      after: { screenRef: "classin.class.detail" }
    });
    expect(flow.steps[1]).toMatchObject({
      waitForPage: { screenRef: "classin.home" }
    });

    expect(() => parseScriptFlow(`
version: 1
name: legacy page contract
app: { id: cn.eeo.classin }
steps:
  - id: legacy-step
    onPage: classin.home
    expectPage: classin.class.detail
    tap: { target: { text: 创建课堂 } }
`)).toThrow(/onPage|expectPage.*unknown field/i);
  });
});
