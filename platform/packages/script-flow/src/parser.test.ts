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
        ocrText: \${className}
    expectPage: classin.teacher.class.detail
  - id: select-duration
    onPage: classin.teacher.lesson.create
    risk: interaction
    selectText:
      target:
        pageElement: lesson-duration-picker
      value: \${duration}
  - id: verify-form
    assertPage: classin.teacher.lesson.create
`;

describe("parseScriptFlow", () => {
  it("parses a strict ScriptFlow v1 document", () => {
    const flow = parseScriptFlow(validSource);

    expect(flow.version).toBe(1);
    expect(flow.app).toEqual({ id: "cn.eeo.classin", platform: "android" });
    expect(flow.parameters.className).toMatchObject({ type: "string", required: true });
    expect(flow.parameters.duration).toMatchObject({ type: "number", default: 30 });
    expect(flow.steps.map((step) => step.id)).toEqual(["open-class", "select-duration", "verify-form"]);
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
      target: { ocrText: 主页 }
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
    tap: { target: { ocrText: 主页 } }
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
          tap: { target: { ocrText: 主页 } }
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
      target: { ocrText: 搜索输入框 }
      value: \${query}
`)).toThrow(/undeclared parameter.*query/i);
  });

  it.each(["semantic", "visualTemplate", "within"])("rejects unsupported target field %s", (field) => {
    expect(() => parseScriptFlow(`
version: 1
name: unsupported target
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: target
    tap:
      target:
        ocrText: 主页
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
      target: { ocrText: 主页, pageElement: home-title }
`)).toThrow(/exactly one of ocrText or pageElement/i);
  });

  it("accepts pageElement interactions without a manual risk classification", () => {
    const flow = parseScriptFlow(`
version: 1
name: public locator interaction
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: open
    onPage: lesson-create
    tap: { target: { pageElement: details-button } }
`);

    expect(flow.steps[0]).toMatchObject({ id: "open" });
  });

  it("rejects risk none for click-like interactions", () => {
    expect(() => parseScriptFlow(`
version: 1
name: unsafe opt out
app: { id: cn.eeo.classin, platform: android }
steps:
  - id: order
    risk: none
    tap: { target: { ocrText: 立即下单 } }
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
    tap: { target: { ocrText: 主页 } }
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
    inputText: { target: { ocrText: 密码 }, value: "\${password}" }
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
          tap: { target: { ocrText: 返回 } }
`)).toThrow(/repeat times must be between 1 and 100/i);
  });

  it("accepts Harmony and Flutter as target profile platforms", () => {
    expect(parseScriptFlow(validSource.replace("platform: android", "platform: harmony")).app.platform).toBe("harmony");
    expect(parseScriptFlow(validSource.replace("platform: android", "platform: flutter")).app.platform).toBe("flutter");
  });
});
