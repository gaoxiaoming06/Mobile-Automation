import { describe, expect, it } from "vitest";
import { caseStepViews, loopBodyAvailability, type CaseDocumentView, type CasePlanView } from "./case-view.js";

describe("caseStepViews", () => {
  it("requires reset steps or an explicit no-reset contract for business looping", () => {
    const base: CaseDocumentView = {
      version: 1,
      kind: "case",
      name: "打开笔记",
      app: { id: "cn.eeo.classin" },
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
      app: { id: "cn.eeo.classin" },
      parameters: {},
      steps: [{
        id: "verify-result",
        assertText: { text: "教学方案列表", match: "contains" }
      }],
      tags: []
    };

    expect(caseStepViews(document)).toEqual([expect.objectContaining({
      name: "确认出现“教学方案列表”",
      action: "assertText",
      context: "教学方案列表"
    })]);
  });

  it("presents fixed delay wait steps as readable test logic", () => {
    const document: CaseDocumentView = {
      version: 1,
      kind: "case",
      name: "提交后继续",
      app: { id: "cn.eeo.classin" },
      parameters: {},
      steps: [
        { id: "wait-after-submit", wait: { durationMs: 3000 } }
      ],
      tags: []
    };

    expect(caseStepViews(document)).toEqual([expect.objectContaining({
      name: "等待 3 秒",
      action: "wait",
      context: "3000 ms"
    })]);
  });

  it("presents source action targets instead of page keys for form and switch steps", () => {
    const document: CaseDocumentView = {
      version: 1,
      kind: "case",
      purpose: "business",
      testLevel: "component",
      name: "新建课堂字段验证",
      app: { id: "cn.eeo.classin" },
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

    expect(caseStepViews(document).map((step) => [step.name, step.action, step.context])).toEqual([
      ["打开“录制ClassIn教室”开关", "tap", "录制ClassIn教室 开关：开启"],
      ["在“课堂标题”中输入“${classTitle}”", "inputText", "课堂标题 = ${classTitle}"],
      ["清空“课堂标题”", "clearText", "课堂标题"],
      ["将“课堂时长”选择为“11小时20分钟”", "selectText", "课堂时长 → 11小时20分钟"]
    ]);
  });

  it("presents relative text field anchors in generated step titles", () => {
    const document: CaseDocumentView = {
      version: 1,
      kind: "case",
      purpose: "business",
      testLevel: "component",
      name: "更新开始时间上方输入框",
      app: { id: "cn.eeo.classin" },
      parameters: {},
      steps: [
        {
          id: "clear-relative-field",
          clearText: {
            target: { control: "textField", area: "content", anchorText: "开始时间", relation: "above" },
            search: { mode: "auto" }
          }
        },
        {
          id: "fill-relative-field",
          inputText: {
            target: { control: "textField", area: "content", anchorText: "开始时间", relation: "above" },
            value: "1212",
            search: { mode: "auto" }
          }
        }
      ],
      tags: []
    };

    expect(caseStepViews(document).map((step) => [step.name, step.context])).toEqual([
      ["清空“开始时间上方输入框”", "开始时间上方输入框"],
      ["在“开始时间上方输入框”中输入“1212”", "开始时间上方输入框 = 1212"]
    ]);
  });

  it("renders current parameter values in step summaries while keeping the parameter identity visible", () => {
    const document: CaseDocumentView = {
      version: 1,
      kind: "case",
      purpose: "business",
      name: "创建公开课并配置联席教师",
      app: { id: "cn.eeo.classin" },
      parameters: {
        lessonDuration: { type: "string", label: "课堂时长", required: true },
        coTeacherName: { type: "string", label: "联席教师", required: true }
      },
      steps: [
        {
          id: "select-duration",
          selectText: {
            target: { text: "课堂时长", area: "content" },
            value: "${lessonDuration}"
          }
        },
        {
          id: "select-co-teacher",
          tap: { target: { text: "${coTeacherName}" } }
        }
      ],
      tags: []
    };

    expect(caseStepViews(document, undefined, {
      parameterValues: {
        lessonDuration: "7小时20分钟",
        coTeacherName: "海外55"
      }
    }).map((step) => [step.name, step.context])).toEqual([
      ["将“课堂时长”选择为“7小时20分钟（参数：lessonDuration）”", "课堂时长 → 7小时20分钟（参数：lessonDuration）"],
      ["点击“海外55（参数：coTeacherName）”", "海外55（参数：coTeacherName）"]
    ]);
  });

  it("keeps readable source actions when a compiled execution plan is present", () => {
    const document: CaseDocumentView = {
      version: 1,
      kind: "case",
      purpose: "business",
      name: "从主页进入新建课堂页",
      app: { id: "classin" },
      parameters: {
        className: { type: "string", label: "班级名称", required: true },
        checkinActivityTitle: { type: "string", label: "打卡活动", required: true }
      },
      steps: [
        {
          id: "open-home",
          name: "点击目标",
          onPage: "classin.launch",
          expectPage: "classin.home",
          tap: { target: { text: "主页" } }
        },
        {
          id: "open-class",
          name: "点击目标",
          onPage: "classin.home",
          expectPage: "classin.teacher.class.detail.visual",
          tap: { target: { text: "${className}" } }
        },
        {
          id: "open-checkin-activity",
          name: "点击目标",
          onPage: "classin.teacher.activity.publish.visual",
          expectPage: "classin.teacher.lesson.create.visual",
          tap: { target: { text: "${checkinActivityTitle}" } }
        }
      ],
      tags: []
    };
    const plan: CasePlanView = {
      steps: [
        {
          id: "open-home",
          order: 1,
          name: "点击目标",
          action: "tap",
          input: { target: { text: "主页" } },
          onPage: "classin.launch",
          expectPage: "classin.home"
        },
        {
          id: "open-class",
          order: 2,
          name: "点击目标",
          action: "tap",
          input: { target: { text: "班级四十二号" } },
          onPage: "classin.home",
          expectPage: "classin.teacher.class.detail.visual"
        },
        {
          id: "open-checkin-activity",
          order: 3,
          name: "点击目标",
          action: "tap",
          input: { target: { text: "Jej" } },
          onPage: "classin.teacher.activity.publish.visual",
          expectPage: "classin.teacher.lesson.create.visual"
        }
      ]
    };

    expect(caseStepViews(document, plan, {
      parameterValues: {
        className: "班级四十二号",
        checkinActivityTitle: "Jej"
      }
    }).map((step) => [step.name, step.context])).toEqual([
      ["点击“主页”", "classin.launch → classin.home"],
      ["点击“班级四十二号（参数：className）”", "classin.home → classin.teacher.class.detail.visual"],
      ["点击“Jej（参数：checkinActivityTitle）”", "classin.teacher.activity.publish.visual → classin.teacher.lesson.create.visual"]
    ]);
  });

  it("summarizes text and positioned icon taps while preserving custom names", () => {
    const document: CaseDocumentView = {
      version: 1,
      kind: "case",
      name: "发布课堂",
      app: { id: "cn.eeo.classin" },
      parameters: {},
      steps: [
        { id: "open-info", name: "点击目标", tap: { target: { text: "课堂信息" } } },
        { id: "go-back", tap: { target: { icon: "back", area: "topBar", position: "leading" } } },
        { id: "publish", name: "提交课堂发布", tap: { target: { text: "发布" } } }
      ],
      tags: []
    };

    expect(caseStepViews(document).map((step) => step.name)).toEqual([
      "点击“课堂信息”",
      "点击左上角返回图标",
      "提交课堂发布"
    ]);
  });
});
