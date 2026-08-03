import { describe, expect, it } from "vitest";
import { caseStepViews, loopBodyAvailability, type CaseDocumentView } from "./case-view.js";

describe("caseStepViews", () => {
  it("requires reset steps or an explicit no-reset contract for business looping", () => {
    const base: CaseDocumentView = {
      version: 1,
      kind: "case",
      name: "打开笔记",
      app: { id: "cn.eeo.classin", platform: "android" },
      parameters: {},
      steps: [{ id: "open-note", role: "business", tap: { target: { text: "笔记" } } }],
      tags: []
    };

    expect(loopBodyAvailability(base)).toEqual(expect.objectContaining({ available: false }));
    expect(loopBodyAvailability({
      ...base,
      steps: [...base.steps, { id: "return-home", role: "reset", tap: { target: { text: "主页" } } }]
    })).toEqual(expect.objectContaining({ available: true, mode: "steps" }));
    expect(loopBodyAvailability({ ...base, loop: { reset: "none" } })).toEqual(expect.objectContaining({ available: true, mode: "none" }));
  });

  it("presents stable-text result assertions as readable test logic", () => {
    const document: CaseDocumentView = {
      version: 1,
      kind: "case",
      name: "验证未录入页面",
      app: { id: "cn.eeo.classin", platform: "android" },
      parameters: {},
      steps: [{
        id: "verify-result",
        assertText: { text: "教学方案列表", match: "contains" }
      }],
      tags: []
    };

    expect(caseStepViews(document)).toEqual([expect.objectContaining({
      name: "确认出现指定内容",
      action: "assertText",
      context: "教学方案列表"
    })]);
  });

  it("presents source action targets instead of page keys for form and switch steps", () => {
    const document: CaseDocumentView = {
      version: 1,
      kind: "case",
      purpose: "business",
      testLevel: "component",
      name: "新建课堂字段验证",
      app: { id: "cn.eeo.classin", platform: "android" },
      parameters: {},
      steps: [
        {
          id: "enable-recording",
          onPage: "classin.lesson.create",
          tap: {
            target: { control: "switch", area: "content", nearText: "录制ClassIn教室", checked: true },
            search: { mode: "visibleOnly" }
          }
        },
        {
          id: "fill-title",
          onPage: "classin.lesson.create",
          inputText: {
            target: { text: "课堂标题", area: "content" },
            value: "${classTitle}",
            search: { mode: "auto" }
          }
        },
        {
          id: "clear-title",
          onPage: "classin.lesson.create",
          clearText: {
            target: { text: "课堂标题", area: "content" },
            search: { mode: "auto" }
          }
        },
        {
          id: "select-duration",
          onPage: "classin.lesson.create",
          selectText: {
            target: { text: "课堂时长", area: "content" },
            value: "11小时20分钟",
            confirmText: "确定",
            search: { mode: "auto" }
          }
        }
      ],
      tags: []
    };

    expect(caseStepViews(document).map((step) => [step.action, step.context])).toEqual([
      ["tap", "录制ClassIn教室 开关：开启"],
      ["inputText", "课堂标题 = ${classTitle}"],
      ["clearText", "课堂标题"],
      ["selectText", "课堂时长 → 11小时20分钟"]
    ]);
  });
});
