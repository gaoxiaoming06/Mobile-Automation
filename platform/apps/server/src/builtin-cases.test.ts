import { describe, expect, it, vi } from "vitest";
import { builtinCases, classInTeacherCreateLessonCaseName, seedBuiltinCases } from "./builtin-cases.js";

describe("builtinCases", () => {
  it("defines the ClassIn teacher create lesson flow as an executable case", () => {
    const definition = builtinCases().find((item) => item.name === classInTeacherCreateLessonCaseName);

    expect(definition).toBeDefined();
    expect(definition?.steps.map((step) => step.title)).toEqual([
      "结束 ClassIn 进程",
      "启动 ClassIn",
      "切到我是教师",
      "进入第一个班级",
      "打开发布活动入口",
      "选择课堂",
      "等待新建课堂页"
    ]);
    expect(definition?.steps.map((step) => step.type)).toEqual([
      "close_app",
      "launch_app",
      "tap_on_element",
      "tap_on_element",
      "tap_on_element",
      "tap_on_element",
      "wait"
    ]);
    expect(definition?.steps.some((step) => step.type === "tap")).toBe(false);
    expect(definition?.steps[1]?.params).toEqual({ packageName: "cn.eeo.classin" });
    expect(definition?.steps[2]?.params).toEqual(
      expect.objectContaining({
        locator: expect.objectContaining({
          text: "我是教师",
          textMatchMode: "equals",
          tapTarget: "clickable_ancestor"
        })
      })
    );
    expect(definition?.steps[3]?.params).toEqual(
      expect.objectContaining({
        locator: expect.objectContaining({
          text: "班级",
          textMatchMode: "contains",
          excludeTexts: ["创建班级", "全部班级"],
          tapTarget: "clickable_ancestor"
        })
      })
    );
    expect(definition?.steps[4]?.params).toEqual(
      expect.objectContaining({
        locator: expect.objectContaining({ resourceId: "cn.eeo.classin:id/btn_add" })
      })
    );
    expect(definition?.steps[5]?.params).toEqual(
      expect.objectContaining({
        locator: expect.objectContaining({
          text: "课堂",
          textMatchMode: "equals",
          tapTarget: "clickable_ancestor"
        })
      })
    );
    expect(definition?.steps[5]?.preconditions?.[0]).toEqual(
      expect.objectContaining({
        type: "text",
        params: expect.objectContaining({ expected: "发布活动" })
      })
    );
    expect(definition?.steps[6]?.expectations?.[0]).toEqual(
      expect.objectContaining({
        type: "text",
        params: expect.objectContaining({ expected: "新建课堂" })
      })
    );
  });

  it("seeds built-in cases only once by name", () => {
    const latestDefinition = builtinCases().find((item) => item.name === classInTeacherCreateLessonCaseName);
    const storage = {
      findCaseByName: vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce({ id: "case-existing", steps: latestDefinition?.steps }),
      updateCase: vi.fn(),
      createCase: vi.fn()
    };

    expect(seedBuiltinCases(storage as never)).toEqual({ created: 1, skipped: 0, updated: 0 });
    expect(seedBuiltinCases(storage as never)).toEqual({ created: 0, skipped: 1, updated: 0 });
    expect(storage.createCase).toHaveBeenCalledTimes(1);
    expect(storage.createCase).toHaveBeenCalledWith(expect.objectContaining({ name: classInTeacherCreateLessonCaseName }));
  });

  it("upgrades an older built-in case when the built-in step signature changes", () => {
    const latestDefinition = builtinCases().find((item) => item.name === classInTeacherCreateLessonCaseName);
    const storage = {
      findCaseByName: vi.fn().mockReturnValue({
        id: "case-existing",
        steps: [{ ...latestDefinition?.steps[3], type: "tap", params: {}, coordinate: { x: 540, y: 720 } }]
      }),
      updateCase: vi.fn(),
      createCase: vi.fn()
    };

    expect(seedBuiltinCases(storage as never)).toEqual({ created: 0, skipped: 0, updated: 1 });
    expect(storage.updateCase).toHaveBeenCalledWith("case-existing", expect.objectContaining({ name: classInTeacherCreateLessonCaseName }));
    expect(storage.createCase).not.toHaveBeenCalled();
  });
});
