import { describe, expect, it } from "vitest";
import type { Observation } from "@mobile-automation/graph-core";
import type { ActionStep } from "@mobile-automation/shared";
import { RuntimeInterceptor, type RuntimeInterceptorRule } from "./runtime-interceptor.js";

describe("RuntimeInterceptor", () => {
  it("handles a custom transient page by matching page text and tapping the configured close text", async () => {
    const actions: ActionStep[] = [];
    const observations = [
      observation({
        texts: ["选择学科", "数学", "关闭"],
        elements: [{ text: "关闭", bounds: { x: 900, y: 120, width: 120, height: 80 } }]
      }),
      observation({
        texts: ["班级详情"],
        elements: [{ resourceId: "com.demo:id/class_detail", text: "班级详情" }]
      })
    ];
    const rule: RuntimeInterceptorRule = {
      id: "rule-subject-picker",
      name: "选择学科临时页",
      enabled: true,
      platformScope: "android",
      appPackageName: "com.demo",
      matchers: [{ type: "text", value: "选择学科" }],
      action: {
        type: "tap_text",
        text: "关闭"
      }
    };

    const interceptor = new RuntimeInterceptor(
      {
        observe: async () => observations.shift() ?? observation({ texts: ["班级详情"] }),
        performAction: async (action) => {
          actions.push(action);
        }
      },
      [rule]
    );

    const outcome = await interceptor.handle({ phase: "precondition" });

    expect(actions).toEqual([
      expect.objectContaining({
        type: "tap_on_text",
        params: expect.objectContaining({ text: "关闭" }),
        coordinate: { x: 960, y: 160 }
      })
    ]);
    expect(outcome.records).toEqual([
      expect.objectContaining({
        ruleId: "rule-subject-picker",
        ruleName: "选择学科临时页",
        matchedText: "选择学科",
        action: { type: "tap", x: 960, y: 160 }
      })
    ]);
    expect(outcome.observation.uiElements[0]?.resourceId).toBe("com.demo:id/class_detail");
  });

  it("can use back as the configured recovery action", async () => {
    const actions: ActionStep[] = [];
    const rule: RuntimeInterceptorRule = {
      id: "rule-upgrade",
      name: "升级提示",
      enabled: true,
      platformScope: "mobile-both",
      matchers: [{ type: "text", value: "发现新版本" }],
      action: {
        type: "back"
      }
    };

    const interceptor = new RuntimeInterceptor(
      {
        observe: async () => observation({ texts: ["发现新版本"] }),
        performAction: async (action) => {
          actions.push(action);
        }
      },
      [rule]
    );

    await interceptor.handle({ phase: "state_transition", maxPasses: 1 });

    expect(actions).toEqual([
      expect.objectContaining({
        type: "back",
        params: expect.objectContaining({ source: "runtime_interceptor" })
      })
    ]);
  });

  it("does not dismiss confirmation dialogs by tapping the built-in cancel text", async () => {
    const actions: ActionStep[] = [];
    const interceptor = new RuntimeInterceptor({
      observe: async () =>
        observation({
          texts: ["确定退出登录？", "取消", "确定"]
        }),
      performAction: async (action) => {
        actions.push(action);
      }
    });

    const outcome = await interceptor.handle({ phase: "state_transition", maxPasses: 1 });

    expect(actions).toEqual([]);
    expect(outcome.records).toEqual([]);
    expect(outcome.observation.ocrTexts.map((text) => text.text)).toContain("取消");
  });

  it("dismisses the built-in ClassIn stage subject picker even when OCR misreads ClassIn", async () => {
    const actions: ActionStep[] = [];
    const observations = [
      observation({
        texts: ["×", "让 Classln 更懂你的课", "选择学段和学科，为你推荐贴合课堂的共创资源与", "AI教学工具"],
        elements: [{ text: "×", bounds: { x: 980, y: 88, width: 56, height: 56 } }]
      }),
      observation({ texts: ["主页"] })
    ];
    const interceptor = new RuntimeInterceptor({
      observe: async () => observations.shift() ?? observation({ texts: ["主页"] }),
      performAction: async (action) => {
        actions.push(action);
      }
    });

    const outcome = await interceptor.handle({ phase: "state_transition", maxPasses: 1 });

    expect(actions).toEqual([
      expect.objectContaining({
        type: "tap_on_text",
        params: expect.objectContaining({
          text: "×",
          mode: "equals",
          source: "runtime_interceptor",
          ruleId: "classin-stage-subject-picker"
        }),
        coordinate: { x: 1008, y: 116 }
      })
    ]);
    expect(outcome.records).toEqual([
      expect.objectContaining({
        ruleId: "classin-stage-subject-picker",
        matchedText: expect.stringContaining("更懂你的课"),
        action: { type: "tap", x: 1008, y: 116 }
      })
    ]);
  });
});

function observation(input: {
  texts: string[];
  elements?: Observation["uiElements"];
  packageName?: string;
  activityName?: string;
}): Observation {
  return {
    id: "observation",
    deviceSerial: "device-1",
    platform: "android",
    capturedAt: "2026-06-16T09:00:00.000Z",
    packageName: input.packageName ?? "com.demo",
    activityName: input.activityName ?? "MainActivity",
    resolution: { width: 1080, height: 2400 },
    uiElements: input.elements ?? input.texts.map((text, index) => ({ text, bounds: { x: 20, y: 100 + index * 80, width: 220, height: 60 } })),
    ocrTexts: input.texts.map((text, index) => ({
      text,
      source: "ocr",
      region: { x: 20, y: 100 + index * 80, width: 220, height: 60 }
    }))
  };
}
