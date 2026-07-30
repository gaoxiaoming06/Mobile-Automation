import { describe, expect, it } from "vitest";
import { caseStepViews, type CaseDocumentView } from "./case-view.js";

describe("caseStepViews", () => {
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
});
