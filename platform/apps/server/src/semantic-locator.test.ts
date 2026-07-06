import { describe, expect, it, vi } from "vitest";
import type { ActionStep, ArtifactRef, DeviceActionRequest, SemanticDeviceActionRequest } from "@mobile-automation/shared";
import type { OcrInput, OcrLayoutResult, OcrResult, OcrService } from "./ocr.js";
import { findNearestTextCandidate, findTextCandidate, SemanticStepResolver } from "./semantic-locator.js";
import type { ScreenshotCapture } from "./step-expectations.js";

describe("semantic locator helpers", () => {
  it("finds the matching text candidate closest to the recorded point", () => {
    const candidate = findTextCandidate(layout("允许", "取消"), "允许", {
      preferredPoint: { x: 760, y: 1620 }
    });

    expect(candidate).toEqual(
      expect.objectContaining({
        text: "允许",
        centerX: 730,
        centerY: 1615
      })
    );
  });

  it("prefers an exact OCR text box before a longer contains match", () => {
    const candidate = findTextCandidate(
      {
        text: "确定退出登录？\n取消\n确定",
        engine: "fake-layout",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          { text: "确定退出登录？", confidence: 0.99, x: 169, y: 1194, width: 313, height: 47 },
          { text: "确定", confidence: 0.92, x: 804, y: 1373, width: 88, height: 48 }
        ]
      },
      "确定"
    );

    expect(candidate).toEqual(
      expect.objectContaining({
        text: "确定",
        centerX: 848,
        centerY: 1397
      })
    );
  });

  it("finds text near a clicked point for recording-time locator suggestions", () => {
    const candidate = findNearestTextCandidate(layout("首页", "进入课堂"), { x: 200, y: 225 });

    expect(candidate?.text).toBe("进入课堂");
  });
});

describe("SemanticStepResolver", () => {
  it("resolves tap_on_text into a concrete tap action", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("进入课堂")),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: tapOnTextStep("进入课堂", 720, 1610)
    });

    expect(actions).toEqual([{ type: "tap", x: 730, y: 1615 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          action: "tap",
          actual: "进入课堂",
          evidenceArtifactIds: ["artifact-1"]
        })
      })
    );
  });

  it("uses grid candidate index to tap different cells inside a marked visual list region", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("主页")),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 10, y: 20, width: 80, height: 60 },
        abilityType: "grid_candidate",
        candidateIndex: 3,
        scrollProfile: {
          containerKind: "grid_list",
          direction: "vertical",
          columns: 2,
          candidateItemHeightPercent: 25,
          clickSafePoint: { xPercent: 50, yPercent: 28 }
        },
        tapPointPercent: { x: 25, y: 7 }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 700, y: 784 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        resolved: true,
        metadata: expect.objectContaining({
          candidateIndex: 3,
          candidatePointPercent: { x: 75, y: 32 }
        })
      })
    );
  });

  it("relocates an OCR anchor and taps a configured offset from it", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "主页",
        engine: "fake-layout",
        lang: "test",
        width: 1000,
        height: 2000,
        boxes: [
          { text: "主页", confidence: 0.96, x: 200, y: 180, width: 120, height: 80 }
        ]
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "ocr-anchor:主页@offset(-14,0)",
        locatorKind: "ocr_anchor_offset",
        anchorText: "主页",
        targetText: "主页",
        anchorOffsetPercent: { x: -14, y: 0 },
        semanticArea: "top"
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 120, y: 220 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          type: "ocr_anchor_offset",
          action: "tap",
          relocatedBy: "ocr_anchor_offset",
          actual: "主页",
          offsetPercent: { x: -14, y: 0 }
        })
      })
    );
  });

  it("does not tap a top bar icon when only a recorded candidate region exists", async () => {
    const performAction = vi.fn();
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(topBarLayout()),
      performAction,
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "top-bar-icon:avatar",
        locatorKind: "top_bar_icon_locator",
        role: "avatar",
        slot: "leading",
        anchorText: "主页",
        semanticArea: "top",
        visualLocator: {
          candidates: [
            { role: "avatar", label: "头像", score: 0.93, semanticArea: "top", region: { x: 4.2, y: 6.1, width: 5, height: 5 } },
            { role: "search", label: "搜索", score: 0.94, semanticArea: "top", region: { x: 84.5, y: 5.9, width: 4, height: 4 } }
          ]
        }
      })
    });

    expect(performAction).not.toHaveBeenCalled();
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: false,
        message: "Top bar icon \"avatar\" could not be visually relocated in the current screenshot.",
        metadata: expect.objectContaining({
          type: "top_bar_icon_locator",
          action: "fail",
          reason: "current_visual_icon_not_found",
          role: "avatar",
          slot: "leading",
          fallback: "candidate_center_disabled"
        })
      })
    );
  });

  it("resolves top bar trailing icons from current screenshot visuals instead of candidate centers", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(topBarLayout()),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: topBarIconScreenshot(1200, 2000, [
          { role: "search", centerX: 985, centerY: 210 },
          { role: "add", centerX: 1064, centerY: 214 }
        ])
      })
    });

    const searchOutcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-search",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "top-bar-icon:search",
        locatorKind: "top_bar_icon_locator",
        role: "search",
        slot: "trailing",
        orderFromRight: 2,
        anchorText: "主页",
        semanticArea: "top",
        visualLocator: {
          candidates: [
            { role: "search", label: "搜索", score: 0.94, semanticArea: "top", region: { x: 84, y: 6.6, width: 4, height: 3.8 } },
            { role: "add", label: "加号", score: 0.95, semanticArea: "top", region: { x: 91.2, y: 6.5, width: 4.2, height: 4 } }
          ]
        }
      })
    });

    const addOutcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-add",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "top-bar-icon:add",
        locatorKind: "top_bar_icon_locator",
        role: "add",
        slot: "trailing",
        orderFromRight: 1,
        anchorText: "主页",
        semanticArea: "top",
        visualLocator: {
          candidates: [
            { role: "search", label: "搜索", score: 0.94, semanticArea: "top", region: { x: 84, y: 6.6, width: 4, height: 3.8 } },
            { role: "add", label: "加号", score: 0.95, semanticArea: "top", region: { x: 91.2, y: 6.5, width: 4.2, height: 4 } }
          ]
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 987, y: 212 },
      { type: "tap", x: 1065, y: 215 }
    ]);
    expect(actions).not.toContainEqual({ type: "tap", x: 1119, y: 170 });
    expect(searchOutcome?.metadata).toEqual(
      expect.objectContaining({
        role: "search",
        slot: "trailing",
        orderFromRight: 2,
        relocatedBy: "top_bar_current_visual"
      })
    );
    expect(addOutcome?.metadata).toEqual(
      expect.objectContaining({
        role: "add",
        slot: "trailing",
        orderFromRight: 1,
        relocatedBy: "top_bar_current_visual"
      })
    );
  });

  it("uses the current top bar visual order when a recorded search candidate is stale", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(topBarLayout()),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: topBarIconScreenshot(1200, 2000, [
          { role: "search", centerX: 985, centerY: 210 },
          { role: "add", centerX: 1064, centerY: 214 }
        ])
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-search",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "top-bar-icon:search",
        locatorKind: "top_bar_icon_locator",
        role: "search",
        slot: "trailing",
        orderFromRight: 2,
        anchorText: "主页",
        semanticArea: "top",
        visualLocator: {
          candidates: [
            { role: "search", label: "搜索", score: 0.94, semanticArea: "top", region: { x: 88.2, y: 6.5, width: 4, height: 3.8 } },
            { role: "add", label: "加号", score: 0.95, semanticArea: "top", region: { x: 91.2, y: 6.5, width: 4.2, height: 4 } }
          ]
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 987, y: 212 }]);
    expect(actions).not.toContainEqual({ type: "tap", x: 1065, y: 215 });
    expect(outcome?.metadata).toEqual(
      expect.objectContaining({
        role: "search",
        slot: "trailing",
        orderFromRight: 2,
        relocatedBy: "top_bar_current_visual"
      })
    );
  });

  it("resolves tap_on_text using configured text alternatives", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("我是老师")),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: tapOnTextStep("我是教师", 720, 240, { textAlternatives: ["我是老师"] })
    });

    expect(actions).toEqual([{ type: "tap", x: 730, y: 1615 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          expected: ["我是教师", "我是老师"],
          actual: "我是老师"
        })
      })
    );
  });

  it("fails semantic resolution without falling back to recorded coordinates", async () => {
    const performAction = vi.fn();
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("首页")),
      performAction,
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: tapOnTextStep("进入课堂", 720, 1610, { timeoutMs: 1, intervalMs: 1 })
    });

    expect(performAction).not.toHaveBeenCalled();
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: false,
        message: 'Text target "进入课堂" was not found.',
        metadata: expect.objectContaining({
          action: "fail",
          actual: "首页"
        })
      })
    );
  });

  it("resolves tap_on_element through the current Android UI hierarchy", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("首页")),
      dumpUiHierarchy: async () => hierarchy("com.demo:id/join_class"),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: tapOnElementStep("com.demo:id/join_class", 200, 240)
    });

    expect(actions).toEqual([{ type: "tap", x: 240, y: 240 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          type: "element",
          action: "tap",
          resolvedLocator: expect.objectContaining({
            resourceId: "com.demo:id/join_class"
          })
        }),
        actionResult: expect.objectContaining({
          driverChannel: "mock"
        })
      })
    );
  });

  it("treats accessibilityId params as Android content-desc locators", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("主页")),
      dumpUiHierarchy: async () => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="" class="android.widget.ImageView" package="cn.eeo.classin" content-desc="user avatar" clickable="true" enabled="true" focusable="true" bounds="[48,156][192,300]" />
    <node index="1" text="主页" resource-id="" class="android.widget.TextView" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" bounds="[198,180][318,276]" />
  </node>
</hierarchy>`,
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("tap_on_element", {
        accessibilityId: "user avatar",
        locator: "accessibility/desc: user avatar",
        semanticArea: "top",
        elementLabel: "个人入口"
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 120, y: 228 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          type: "element",
          action: "tap",
          locator: expect.objectContaining({
            contentDesc: "user avatar"
          }),
          resolvedLocator: expect.objectContaining({
            contentDesc: "user avatar"
          })
        })
      })
    );
  });

  it("prefers the semantic Android backend for tap_on_element when available", async () => {
    const semanticActions: SemanticDeviceActionRequest[] = [];
    const fallbackActions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("首页")),
      dumpUiHierarchy: async () => hierarchy("com.demo:id/join_class"),
      performAction: async (_serial, action) => {
        fallbackActions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      performSemanticAction: async (_serial, action) => {
        semanticActions.push(action);
        return {
          driverChannel: "uiautomator2",
          details: {
            selector: action.locator.resourceId
          }
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: tapOnElementStep("com.demo:id/join_class", 200, 240)
    });

    expect(fallbackActions).toEqual([]);
    expect(semanticActions).toEqual([
      {
        type: "tap_on_element",
        locator: expect.objectContaining({
          resourceId: "com.demo:id/join_class"
        }),
        fallbackTap: {
          x: 240,
          y: 240
        }
      }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        actionResult: expect.objectContaining({
          driverChannel: "uiautomator2",
          details: {
            selector: "com.demo:id/join_class"
          }
        }),
        metadata: expect.objectContaining({
          action: "tap",
          driverChannel: "uiautomator2"
        })
      })
    );
  });

  it("resolves input_text_to_element by focusing a semantic element before typing", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "hello class",
        engine: "fake-layout",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          { text: "hello class", confidence: 0.98, x: 130, y: 220, width: 180, height: 40 }
        ]
      }),
      dumpUiHierarchy: async () => hierarchy("com.demo:id/search_box"),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("input_text_to_element", {
        text: "hello class",
        clearFirst: true,
        locator: {
          strategy: "android_uiautomator",
          resourceId: "com.demo:id/search_box",
          packageName: "com.demo"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 240, y: 240 },
      { type: "clear_text" },
      { type: "input_text", text: "hello class" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          type: "element_input",
          action: "input_text",
          textLength: 11,
          resolvedLocator: expect.objectContaining({
            resourceId: "com.demo:id/search_box"
          })
        })
      })
    );
  });

  it("resolves input_text_to_element by OCR semantic text even when the marked region is stale", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "请输入课程名称",
        engine: "fake-layout",
        lang: "test",
        width: 1000,
        height: 2000,
        boxes: [
          { text: "请输入课程名称", confidence: 0.98, x: 180, y: 440, width: 240, height: 56 }
        ]
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("input_text_to_element", {
        text: "自动化课堂",
        clearFirst: true,
        targetText: "请输入课程名称",
        verifyInputText: false,
        region: { x: 80, y: 80, width: 5, height: 5 },
        semanticArea: "content",
        coordinateSpace: "screen"
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 300, y: 468 },
      { type: "clear_text" },
      { type: "input_text", text: "自动化课堂" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          type: "element_input",
          action: "input_text",
          resolvedBy: "image_region",
          focusResolvedBy: "ocr_text_semantic",
          textLength: 5,
          region: { x: 80, y: 80, width: 5, height: 5 }
        })
      })
    );
  });

  it("verifies input text inside the runtime OCR focus candidate when the marked region is stale", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "+86√请输入手机号/邮箱",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "+86√请输入手机号/邮箱", confidence: 0.98, x: 80, y: 395, width: 335, height: 30 }
          ]
        },
        {
          text: "+86 18743085313",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "18743085313", confidence: 0.98, x: 180, y: 395, width: 180, height: 30 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("input_text_to_element", {
        text: "18743085313",
        clearFirst: true,
        focusDelayMs: 1,
        inputVerificationDelayMs: 1,
        targetText: "请输入手机号/邮箱",
        valueParamKey: "phone",
        region: { x: 10, y: 60, width: 80, height: 6.7 },
        semanticArea: "content",
        coordinateSpace: "screen"
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 248, y: 410 },
      { type: "clear_text" },
      { type: "input_text", text: "18743085313" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          type: "element_input",
          action: "input_text",
          focusResolvedBy: "ocr_text_semantic",
          inputVerified: true,
          verificationRegionSource: "runtime_focus_candidate"
        })
      })
    );
  });

  it("resolves input_text_to_element from a runtime structural locator without a recorded region", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "+86 请输入手机号/邮箱",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "+86 请输入手机号/邮箱", confidence: 0.98, x: 80, y: 395, width: 335, height: 30 }
          ]
        },
        {
          text: "+86 18743085313",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "18743085313", confidence: 0.98, x: 180, y: 395, width: 180, height: 30 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("input_text_to_element", {
        text: "18743085313",
        clearFirst: true,
        focusDelayMs: 1,
        inputVerificationDelayMs: 1,
        locator: "runtime-locator:phone_or_email_input",
        locatorKind: "structural_locator",
        targetText: "请输入手机号/邮箱",
        valueParamKey: "phone",
        semanticArea: "content",
        coordinateSpace: "runtime",
        structuralLocator: {
          strategy: "ocr_or_edittext",
          role: "phone_or_email_input",
          preferredPlaceholderText: "请输入手机号/邮箱",
          fallbackPolicy: "no_region_center_fallback"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 248, y: 410 },
      { type: "clear_text" },
      { type: "input_text", text: "18743085313" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          resolvedBy: "runtime_structural_locator",
          focusResolvedBy: "ocr_text_semantic",
          inputVerified: true,
          verificationRegionSource: "runtime_focus_candidate"
        })
      })
    );
  });

  it("resolves input_text_to_element from UI EditText structure when OCR has no field text", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "登录",
        engine: "fake-layout",
        lang: "test",
        width: 1000,
        height: 2000,
        boxes: [
          { text: "登录", confidence: 0.98, x: 120, y: 120, width: 120, height: 56 }
        ]
      }),
      dumpUiHierarchy: async () => inputHierarchy(),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("input_text_to_element", {
        text: "secret",
        clearFirst: true,
        valueParamKey: "password",
        region: { x: 10, y: 32, width: 80, height: 8 },
        semanticArea: "content",
        coordinateSpace: "screen"
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 500, y: 720 },
      { type: "clear_text" },
      { type: "input_text", text: "secret" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          type: "element_input",
          action: "input_text",
          resolvedBy: "image_region",
          focusResolvedBy: "ui_edit_text_structural",
          textLength: 6
        })
      })
    );
  });

  it("does not input text into a marked image region when the input focus cannot be relocated", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("新建课堂")),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("input_text_to_element", {
        text: "自动化课堂",
        clearFirst: true,
        focusDelayMs: 120,
        region: { x: 10, y: 20, width: 60, height: 8 },
        semanticArea: "content",
        coordinateSpace: "screen"
      })
    });

    expect(actions).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: false,
        message: "Input region could not be relocated by OCR, visual template, or structural evidence.",
        metadata: expect.objectContaining({
          type: "element_input",
          action: "fail",
          reason: "runtime_relocation_required",
          fallback: "region_center_disabled",
          focusResolvedBy: "region_center_disabled",
          recordedCenter: { x: 400, y: 480 }
        })
      })
    );
  });

  it("fails input_text_to_element when OCR verifies the text outside the target image region", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "请输入密码",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "请输入密码", confidence: 0.98, x: 120, y: 1240, width: 160, height: 40 }
          ]
        },
        {
          text: "登录\n123qwe",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "登录", confidence: 0.98, x: 460, y: 940, width: 80, height: 50 },
            { text: "123qwe", confidence: 0.98, x: 120, y: 1120, width: 180, height: 56 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("input_text_to_element", {
        text: "123qwe",
        clearFirst: true,
        focusDelayMs: 1,
        inputVerificationDelayMs: 1,
        targetText: "请输入密码",
        region: { x: 6, y: 62, width: 88, height: 4 },
        semanticArea: "content",
        coordinateSpace: "screen"
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 200, y: 1260 },
      { type: "clear_text" },
      { type: "input_text", text: "123qwe" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: false,
        message: 'Input text "123qwe" was not verified by OCR after typing.',
        metadata: expect.objectContaining({
          type: "element_input",
          action: "fail",
          reason: "input_text_not_verified",
          actual: "登录 123qwe"
        })
      })
    );
  });

  it("focuses a marked input region at OCR semantic text before typing", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "请输入密码",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "请输入密码", confidence: 0.98, x: 120, y: 700, width: 160, height: 40 }
          ]
        },
        {
          text: "123qwe",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "123qwe", confidence: 0.98, x: 120, y: 700, width: 140, height: 40 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("input_text_to_element", {
        text: "123qwe",
        clearFirst: true,
        focusDelayMs: 1,
        inputVerificationDelayMs: 1,
        targetText: "请输入密码",
        region: { x: 6, y: 31, width: 88, height: 6 },
        semanticArea: "content",
        coordinateSpace: "screen"
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 200, y: 720 },
      { type: "clear_text" },
      { type: "input_text", text: "123qwe" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          resolvedBy: "image_region",
          focusResolvedBy: "ocr_text_semantic",
          focusLocator: expect.objectContaining({
            text: "请输入密码"
          })
        })
      })
    );
  });

  it("accepts sensitive input when the target region is masked and the clear text is absent elsewhere", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "请输入密码",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "请输入密码", confidence: 0.98, x: 120, y: 700, width: 160, height: 40 }
          ]
        },
        {
          text: "••••••",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "••••••", confidence: 0.98, x: 120, y: 700, width: 140, height: 40 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("input_text_to_element", {
        text: "123qwe",
        clearFirst: true,
        focusDelayMs: 1,
        inputVerificationDelayMs: 1,
        region: { x: 6, y: 31, width: 88, height: 6 },
        semanticArea: "content",
        coordinateSpace: "screen",
        valueParamKey: "password"
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 200, y: 720 },
      { type: "clear_text" },
      { type: "input_text", text: "123qwe" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          inputVerified: true,
          sensitiveInput: true,
          verificationStrategy: "masked_target_region"
        })
      })
    );
  });

  it("retries sensitive input through Android keyevents when secure keyboard keeps the placeholder", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "请输入密码",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "请输入密码", confidence: 0.98, x: 120, y: 700, width: 160, height: 40 }
          ]
        },
        {
          text: "请输入密码 华为安全键盘",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "请输入密码", confidence: 0.98, x: 120, y: 700, width: 160, height: 40 },
            { text: "华为安全键盘", confidence: 0.9, x: 80, y: 1180, width: 220, height: 40 }
          ]
        },
        {
          text: "••••••",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "••••••", confidence: 0.98, x: 120, y: 700, width: 140, height: 40 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("input_text_to_element", {
        text: "123qwe",
        clearFirst: true,
        focusDelayMs: 1,
        inputVerificationDelayMs: 1,
        secureKeyboardKeyEventIntervalMs: 0,
        region: { x: 6, y: 31, width: 88, height: 6 },
        semanticArea: "content",
        coordinateSpace: "screen",
        valueParamKey: "password"
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 200, y: 720 },
      { type: "clear_text" },
      { type: "input_text", text: "123qwe" },
      { type: "input_keyevents", text: "123qwe", intervalMs: 0 }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        action: { type: "input_keyevents", text: "123qwe", intervalMs: 0 },
        metadata: expect.objectContaining({
          inputVerified: true,
          sensitiveInput: true,
          inputFallback: "secure_keyboard_keyevent_retry",
          initialVerificationStrategy: "target_region_still_placeholder",
          verificationStrategy: "masked_target_region"
        })
      })
    );
  });

  it("scrolls until the semantic target becomes visible", async () => {
    const actions: DeviceActionRequest[] = [];
    const hierarchySnapshots = [hierarchy("com.demo:id/other"), hierarchy("com.demo:id/target")];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("目标")),
      dumpUiHierarchy: async () => hierarchySnapshots.shift() ?? hierarchy("com.demo:id/target"),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("scroll_until_visible", {
        locator: {
          strategy: "android_uiautomator",
          resourceId: "com.demo:id/target",
          packageName: "com.demo"
        },
        direction: "down",
        maxSwipes: 3,
        intervalMs: 1
      })
    });

    expect(actions).toEqual([{ type: "swipe", startX: 540, startY: 1800, endX: 540, endY: 600, durationMs: 450 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          type: "scroll",
          action: "visible",
          attempts: 2,
          swipes: 1
        })
      })
    );
  });

  it("waits until a UI state expectation is satisfied without performing a coordinate action", async () => {
    const actions: DeviceActionRequest[] = [];
    const hierarchySnapshots = [hierarchy("com.demo:id/loading"), hierarchy("com.demo:id/target")];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("完成")),
      dumpUiHierarchy: async () => hierarchySnapshots.shift() ?? hierarchy("com.demo:id/target"),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("wait_until_state", {
        locator: {
          strategy: "android_uiautomator",
          resourceId: "com.demo:id/target",
          packageName: "com.demo"
        },
        timeoutMs: 200,
        intervalMs: 1
      })
    });

    expect(actions).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          type: "state_wait",
          action: "matched",
          attempts: 2
        })
      })
    );
  });

  it("does not execute a plain marked image region without runtime relocation evidence", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("首页")),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("tap_on_image", {
        region: { x: 12.5, y: 8.25, width: 20, height: 6 },
        locator: "image-region:12.5,8.25,20,6",
        targetMode: "image_region"
      })
    });

    expect(actions).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: false,
        message: "Image region could not be relocated by OCR, visual template, or visual candidates.",
        metadata: expect.objectContaining({
          type: "image_region",
          action: "fail",
          reason: "runtime_relocation_required",
          region: { x: 12.5, y: 8.25, width: 20, height: 6 },
          fallback: "region_center_disabled"
        })
      })
    );
  });

  it("relocates manually marked image regions by OCR text before falling back to recorded coordinates", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "发布",
        engine: "fake-layout",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          {
            text: "发布",
            confidence: 0.92,
            x: 493,
            y: 2245,
            width: 93,
            height: 54
          }
        ]
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("tap_on_image", {
        region: { x: 45.91, y: 98.91, width: 8.18, height: 1.09 },
        locator: "image-region:45.91,98.91,8.18,1.09",
        targetMode: "image_region",
        targetText: "发布",
        semanticArea: "bottom"
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 540, y: 2272 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          action: "tap",
          relocatedBy: "ocr_text",
          semanticArea: "bottom",
          actual: "发布"
        })
      })
    );
  });

  it("relocates leading checkboxes by nearby OCR anchor text before visual templates", async () => {
    const actions: DeviceActionRequest[] = [];
    const screenshots = [checkboxScreenshot(false), checkboxScreenshot(true)];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "已阅读并同意 用户协议",
        engine: "fake-layout",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          {
            text: "已阅读并同意",
            confidence: 0.94,
            x: 120,
            y: 980,
            width: 180,
            height: 50
          }
        ]
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: screenshots.shift() ?? checkboxScreenshot(true)
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("tap_on_image", {
        region: { x: 3.2, y: 41, width: 8, height: 4.5 },
        locator: "image-region:3.2,41,8,4.5",
        targetMode: "image_region",
        semanticArea: "content",
        structuralLocator: {
          strategy: "near_text",
          role: "checkbox",
          anchorText: "已阅读并同意",
          clickTarget: "leading_checkbox",
          fallbackPolicy: "no_region_center_fallback"
        },
        visualLocator: {
          minTemplateSimilarity: 0.9,
          template: {
            version: 1,
            source: "recorded_crop",
            width: 3,
            height: 3,
            pixels: [
              0, 255, 0,
              255, 255, 255,
              0, 255, 0
            ],
            hash: "old-template",
            region: { x: 3.2, y: 41, width: 8, height: 4.5 }
          }
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 88, y: 1005 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          action: "tap",
          relocatedBy: "near_text_checkbox",
          structuralLocator: expect.objectContaining({
            anchorText: "已阅读并同意"
          }),
          verification: expect.objectContaining({
            strategy: "checkbox_visual_state",
            afterState: expect.objectContaining({
              checked: true
            })
          })
        })
      })
    );
  });

  it("skips leading checkbox taps when the checkbox is already checked", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "已阅读并同意 用户协议",
        engine: "fake-layout",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          {
            text: "已阅读并同意",
            confidence: 0.94,
            x: 120,
            y: 980,
            width: 180,
            height: 50
          }
        ]
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: checkboxScreenshot(true)
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("tap_on_image", {
        region: { x: 3.2, y: 41, width: 8, height: 4.5 },
        locator: "image-region:3.2,41,8,4.5",
        targetMode: "image_region",
        semanticArea: "content",
        structuralLocator: {
          strategy: "near_text",
          role: "checkbox",
          anchorText: "已阅读并同意",
          clickTarget: "leading_checkbox"
        }
      })
    });

    expect(actions).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          action: "skip",
          reason: "checkbox_already_checked",
          relocatedBy: "near_text_checkbox",
          verification: expect.objectContaining({
            strategy: "checkbox_visual_state",
            state: "checked"
          })
        })
      })
    );
  });

  it("relocates a runtime structural checkbox without a recorded region", async () => {
    const actions: DeviceActionRequest[] = [];
    const screenshots = [checkboxScreenshot(false), checkboxScreenshot(true)];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "已阅读并同意 用户协议",
        engine: "fake-layout",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          {
            text: "已阅读并同意",
            confidence: 0.94,
            x: 120,
            y: 980,
            width: 180,
            height: 50
          }
        ]
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: screenshots.shift() ?? checkboxScreenshot(true)
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:agreement_checkbox",
        locatorKind: "structural_locator",
        semanticArea: "content",
        coordinateSpace: "runtime",
        structuralLocator: {
          strategy: "near_text",
          role: "checkbox",
          anchorText: "已阅读并同意",
          clickTarget: "leading_checkbox"
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 88, y: 1005 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          action: "tap",
          relocatedBy: "near_text_checkbox"
        })
      })
    );
  });

  it("relocates a runtime structural button by OCR text without a recorded region", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "登录",
        engine: "fake-layout",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          { text: "登录", confidence: 0.98, x: 460, y: 1120, width: 160, height: 70 }
        ]
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:primary_login_button",
        locatorKind: "structural_locator",
        semanticArea: "content",
        coordinateSpace: "runtime",
        targetText: "登录",
        structuralLocator: {
          strategy: "ocr_text",
          role: "primary_button",
          text: "登录",
          fallbackPolicy: "no_region_center_fallback"
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 540, y: 1155 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          action: "tap",
          relocatedBy: "runtime_ocr_text",
          targetText: "登录"
        })
      })
    );
  });

  it("fails leading checkbox taps when the checkbox region does not visually change", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "已阅读并同意 用户协议",
        engine: "fake-layout",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          {
            text: "已阅读并同意",
            confidence: 0.94,
            x: 120,
            y: 980,
            width: 180,
            height: 50
          }
        ]
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: checkboxScreenshot(false)
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("tap_on_image", {
        region: { x: 3.2, y: 41, width: 8, height: 4.5 },
        locator: "image-region:3.2,41,8,4.5",
        targetMode: "image_region",
        semanticArea: "content",
        structuralLocator: {
          strategy: "near_text",
          role: "checkbox",
          anchorText: "已阅读并同意",
          clickTarget: "leading_checkbox"
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 88, y: 1005 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: false,
        metadata: expect.objectContaining({
          action: "fail",
          reason: "checkbox_not_checked_after_tap"
        })
      })
    );
  });

  it("relocates manually marked image regions by visual candidates before using the recorded center", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("主页")),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 10, y: 20, width: 20, height: 10 },
        locator: "image-region:10,20,20,10",
        targetMode: "image_region",
        semanticArea: "top",
        visualLocator: {
          minScore: 0.72,
          targetRole: "button",
          candidates: [
            { source: "vision", label: "头像", role: "image", score: 0.96, semanticArea: "top", region: { x: 10, y: 8, width: 8, height: 5 } },
            { source: "omniparser", label: "更多", role: "button", score: 0.91, semanticArea: "top", region: { x: 70, y: 10, width: 8, height: 5 } }
          ]
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 740, y: 250 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          action: "tap",
          relocatedBy: "visual_candidate",
          semanticArea: "top",
          visualCandidate: expect.objectContaining({
            label: "更多",
            score: 0.91
          })
        })
      })
    );
  });

  it("relocates manually marked image regions by recorded crop template local search", async () => {
    const actions: DeviceActionRequest[] = [];
    const pixels = Array.from({ length: 100 }, () => 20);
    const templatePixels = [
      0, 255, 0,
      255, 255, 255,
      0, 255, 0
    ];
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        pixels[(2 + row) * 10 + 3 + column] = templatePixels[row * 3 + column]!;
      }
    }
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("主页")),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: pgm(10, 10, pixels)
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 10, height: 10 },
      step: semanticStep("tap_on_image", {
        region: { x: 20, y: 20, width: 30, height: 30 },
        locator: "image-region:20,20,30,30",
        targetMode: "image_region",
        semanticArea: "content",
        visualLocator: {
          minTemplateSimilarity: 0.9,
          template: {
            version: 1,
            source: "recorded_crop",
            width: 3,
            height: 3,
            pixels: templatePixels,
            hash: "cross",
            region: { x: 20, y: 20, width: 30, height: 30 }
          }
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 5, y: 4 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        artifacts: [expect.objectContaining({ id: "artifact-1" })],
        metadata: expect.objectContaining({
          action: "tap",
          relocatedBy: "template_search",
          visualTemplate: expect.objectContaining({
            hash: "cross",
            similarity: expect.any(Number),
            region: { x: 30, y: 20, width: 30, height: 30 }
          }),
          visualRelocation: expect.objectContaining({
            reason: "template_selected",
            templateHash: "cross"
          })
        })
      })
    );
  });

  it("fails instead of using region-center fallback when visual candidates are below the confidence threshold", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("主页")),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 10, y: 20, width: 20, height: 10 },
        locator: "image-region:10,20,20,10",
        targetMode: "image_region",
        semanticArea: "content",
        visualLocator: {
          minScore: 0.72,
          candidates: [
            { source: "vision", label: "弱候选", role: "button", score: 0.41, semanticArea: "content", region: { x: 70, y: 10, width: 8, height: 5 } }
          ]
        }
      })
    });

    expect(actions).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({
        resolved: false,
        metadata: expect.objectContaining({
          action: "fail",
          reason: "runtime_relocation_required",
          fallback: "region_center_disabled",
          visualRelocation: expect.objectContaining({
            reason: "candidate_below_threshold"
          })
        })
      })
    );
  });

  it("selects a picker value from a manually marked form row and confirms it", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "30分钟\n45分钟\n1小时",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            {
              text: "45分钟",
              confidence: 0.96,
              x: 430,
              y: 1260,
              width: 140,
              height: 60
            }
          ]
        },
        {
          text: "确定",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            {
              text: "确定",
              confidence: 0.95,
              x: 790,
              y: 980,
              width: 90,
              height: 50
            }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 8, y: 38, width: 84, height: 7 },
        fieldType: "picker_select",
        selectedValue: "45分钟",
        confirmText: "确定",
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 500, y: 830 },
      { type: "tap", x: 500, y: 1290 },
      { type: "tap", x: 835, y: 1005 }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        resolved: true,
        metadata: expect.objectContaining({
          action: "picker_select",
          selectedValue: "45分钟",
          confirmedBy: "确定"
        })
      })
    );
  });

  it("runs picker selection even when the form row has OCR target text", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "30分钟\n45分钟\n1小时",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "45分钟", confidence: 0.96, x: 430, y: 1260, width: 140, height: 60 }
          ]
        },
        {
          text: "确定",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "确定", confidence: 0.95, x: 790, y: 980, width: 90, height: 50 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 8, y: 38, width: 84, height: 7 },
        targetText: "课堂时长",
        fieldType: "picker_select",
        selectedValue: "45分钟",
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 500, y: 830 },
      { type: "tap", x: 500, y: 1290 },
      { type: "tap", x: 835, y: 1005 }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        resolved: true,
        metadata: expect.objectContaining({
          action: "picker_select",
          selectedValue: "45分钟",
          confirmedBy: "确定"
        })
      })
    );
  });

  it("selects a picker value when OCR splits the value with spaces", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "11小时 30分钟\n12小时 35分钟\n13小时 40分钟\n14 小时 45 分钟",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "14 小时 45 分钟", confidence: 0.92, x: 360, y: 1570, width: 280, height: 60 }
          ]
        },
        {
          text: "确定",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "确定", confidence: 0.95, x: 790, y: 980, width: 90, height: 50 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 8, y: 38, width: 84, height: 7 },
        fieldType: "picker_select",
        selectedValue: "45分钟",
        confirmText: "确定",
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 500, y: 830 },
      { type: "tap", x: 500, y: 1600 },
      { type: "tap", x: 835, y: 1005 }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        resolved: true,
        metadata: expect.objectContaining({
          action: "picker_select",
          selectedValue: "45分钟",
          actual: "14 小时 45 分钟",
          confirmedBy: "确定"
        })
      })
    );
  });

  it("selects a picker value when OCR separates the number and unit into boxes", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "14\n小时\n45\n分钟",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "14", confidence: 0.9, x: 170, y: 1510, width: 70, height: 60 },
            { text: "小时", confidence: 0.93, x: 260, y: 1510, width: 100, height: 60 },
            { text: "45", confidence: 0.91, x: 700, y: 1510, width: 70, height: 60 },
            { text: "分钟", confidence: 0.94, x: 790, y: 1510, width: 110, height: 60 }
          ]
        },
        {
          text: "确定",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "确定", confidence: 0.95, x: 790, y: 980, width: 90, height: 50 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 8, y: 38, width: 84, height: 7 },
        fieldType: "picker_select",
        selectedValue: "45分钟",
        confirmText: "确定",
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 500, y: 830 },
      { type: "tap", x: 790, y: 1540 },
      { type: "tap", x: 835, y: 1005 }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        resolved: true,
        metadata: expect.objectContaining({
          action: "picker_select",
          selectedValue: "45分钟",
          actual: "45 分钟",
          confirmedBy: "确定"
        })
      })
    );
  });

  it("does not tap a manually marked switch when it already matches the desired off state", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("新建课堂")),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 76, y: 46, width: 14, height: 5 },
        fieldType: "toggle_set",
        desiredState: "off",
        currentState: "off"
      })
    });

    expect(actions).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({
        resolved: true,
        metadata: expect.objectContaining({
          action: "toggle_set",
          desiredState: "off",
          currentState: "off",
          changed: false
        })
      })
    );
  });

  it("skips an off switch request when current state is unknown to avoid turning it on", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("新建课堂")),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 76, y: 46, width: 14, height: 5 },
        fieldType: "toggle_set",
        desiredState: "off"
      })
    });

    expect(actions).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({
        resolved: true,
        metadata: expect.objectContaining({
          action: "toggle_set",
          desiredState: "off",
          currentState: "unknown",
          changed: false,
          reason: "safe_skip_unknown_state"
        })
      })
    );
  });

  it("reveals after-scroll image regions in the content area before tapping OCR relocated text", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        layout("主页"),
        {
          text: "主页\n创建公开课",
          engine: "fake-layout",
          lang: "test",
          width: 1080,
          height: 2400,
          boxes: [
            {
              text: "创建公开课",
              confidence: 0.94,
              x: 600,
              y: 360,
              width: 220,
              height: 70
            }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("tap_on_image", {
        region: { x: 53.85, y: 15.84, width: 38.63, height: 7.33 },
        locator: "image-region:53.85,15.84,38.63,7.33",
        targetMode: "image_region",
        targetText: "创建公开课",
        semanticArea: "content",
        availability: "after_scroll",
        revealMaxSwipes: 1,
        revealIntervalMs: 1
      })
    });

    expect(actions).toEqual([
      { type: "swipe", startX: 540, startY: 600, endX: 540, endY: 1800, durationMs: 450 },
      { type: "tap", x: 710, y: 395 }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          action: "tap",
          targetText: "创建公开课",
          relocatedBy: "ocr_text_after_reveal",
          reveal: expect.objectContaining({
            swipes: 1,
            attempts: 2
          })
        })
      })
    );
  });

  it("reveals content target text when a visible ability is currently folded by scroll", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        layout("主课程\n只看课堂\n目录\n聊天\n待办\n公告"),
        {
          text: "课节\n创建教学方案\n创建学习方案\n目录\n聊天\n待办\n公告",
          engine: "fake-layout",
          lang: "test",
          width: 1080,
          height: 2400,
          boxes: [
            {
              text: "创建学习方案",
              confidence: 0.96,
              x: 410,
              y: 1180,
              width: 260,
              height: 52
            }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("tap_on_image", {
        region: { x: 6, y: 47.8, width: 88, height: 8.8 },
        locator: "image-region:6,47.8,88,8.8",
        targetMode: "image_region",
        targetText: "创建学习方案",
        semanticArea: "content",
        availability: "visible",
        revealOnMissing: true,
        revealDirection: "up",
        revealMaxSwipes: 1,
        revealIntervalMs: 1
      })
    });

    expect(actions).toEqual([
      { type: "swipe", startX: 540, startY: 600, endX: 540, endY: 1800, durationMs: 450 },
      { type: "tap", x: 540, y: 1206 }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        resolved: true,
        metadata: expect.objectContaining({
          targetText: "创建学习方案",
          relocatedBy: "ocr_text_after_reveal",
          reveal: expect.objectContaining({
            direction: "up",
            swipes: 1
          })
        })
      })
    );
  });

  it("uses legacy elementLabel as OCR target when revealing after-scroll image regions", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        layout("主页"),
        {
          text: "主页\n创建公开课",
          engine: "fake-layout",
          lang: "test",
          width: 1080,
          height: 2400,
          boxes: [
            {
              text: "创建公开课",
              confidence: 0.94,
              x: 600,
              y: 360,
              width: 220,
              height: 70
            }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("tap_on_image", {
        region: { x: 53.85, y: 15.84, width: 38.63, height: 7.33 },
        locator: "image-region:53.85,15.84,38.63,7.33",
        targetMode: "image_region",
        elementLabel: "创建公开课",
        semanticArea: "content",
        availability: "after_scroll",
        revealMaxSwipes: 1,
        revealIntervalMs: 1
      })
    });

    expect(actions).toEqual([
      { type: "swipe", startX: 540, startY: 600, endX: 540, endY: 1800, durationMs: 450 },
      { type: "tap", x: 710, y: 395 }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        resolved: true,
        metadata: expect.objectContaining({
          targetText: "创建公开课",
          relocatedBy: "ocr_text_after_reveal"
        })
      })
    );
  });

  it("does not tap manually marked image regions when only an element label is present", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "发布",
        engine: "fake-layout",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          {
            text: "发布",
            confidence: 0.92,
            x: 493,
            y: 2245,
            width: 93,
            height: 54
          }
        ]
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("tap_on_image", {
        region: { x: 45.91, y: 98.91, width: 8.18, height: 1.09 },
        locator: "image-region:45.91,98.91,8.18,1.09",
        targetMode: "image_region",
        elementLabel: "发布",
        semanticArea: "bottom"
      })
    });

    expect(actions).toEqual([]);
    if (!outcome) {
      throw new Error("expected semantic locator to return an outcome");
    }
    expect(outcome.resolved).toBe(false);
    expect(outcome.message).toBe("Image region could not be relocated by OCR, visual template, or visual candidates.");
    expect(outcome.metadata).toEqual(
      expect.objectContaining({
        action: "fail",
        reason: "runtime_relocation_required",
        fallback: "region_center_disabled",
        recordedCenter: { x: 540, y: 2387 }
      })
    );
  });

  it("executes grid candidate image regions by tapping the configured safe point", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("首页")),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("tap_on_image", {
        region: { x: 3.06, y: 30.44, width: 93.99, height: 59.13 },
        locator: "image-region:3.06,30.44,93.99,59.13",
        targetMode: "image_region",
        abilityType: "grid_candidate",
        tapPointPercent: { x: 25, y: 6.86 }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 287, y: 828 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          type: "image_region",
          action: "tap",
          tapPointPercent: { x: 25, y: 6.86 },
          center: { x: 287, y: 828 }
        })
      })
    );
  });

  it("resolves grid candidates by OCR target text inside the marked list region", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "主页\n班级四十一号",
        engine: "fake-layout",
        lang: "test",
        width: 1000,
        height: 2000,
        boxes: [
          {
            text: "班级四十一号",
            confidence: 0.95,
            x: 600,
            y: 735,
            width: 100,
            height: 50
          }
        ]
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 10, y: 20, width: 80, height: 60 },
        locator: "image-region:10,20,80,60",
        targetMode: "image_region",
        abilityType: "grid_candidate",
        scrollProfile: {
          containerKind: "grid_list",
          direction: "vertical",
          columns: 2,
          targetKind: "item_text",
          targetQuery: "班级四十一号",
          candidateItemHeightPercent: 25,
          clickSafePoint: { xPercent: 50, yPercent: 28 },
          scrollStepPercent: 65
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 700, y: 784 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          action: "tap",
          abilityType: "grid_candidate",
          targetQuery: "班级四十一号",
          relocatedBy: "ocr_text_in_grid",
          candidateGrid: { column: 1, row: 1 }
        })
      })
    );
  });

  it("scrolls the marked list region until a target grid candidate text is visible", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          ...layout("主页"),
          width: 1000,
          height: 2000
        },
        {
          text: "主页\n班级四十一号",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            {
              text: "班级四十一号",
              confidence: 0.95,
              x: 600,
              y: 735,
              width: 100,
              height: 50
            }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 10, y: 20, width: 80, height: 60 },
        locator: "image-region:10,20,80,60",
        targetMode: "image_region",
        abilityType: "grid_candidate",
        maxSearchSwipes: 1,
        searchIntervalMs: 1,
        scrollProfile: {
          containerKind: "grid_list",
          direction: "vertical",
          columns: 2,
          targetKind: "item_text",
          targetQuery: "班级四十一号",
          candidateItemHeightPercent: 25,
          clickSafePoint: { xPercent: 50, yPercent: 28 },
          scrollStepPercent: 50
        }
      })
    });

    expect(actions).toEqual([
      { type: "swipe", startX: 500, startY: 1300, endX: 500, endY: 700, durationMs: 450 },
      { type: "tap", x: 700, y: 784 }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        resolved: true,
        metadata: expect.objectContaining({
          relocatedBy: "ocr_text_in_grid_after_scroll",
          search: expect.objectContaining({
            swipes: 1,
            attempts: 2
          })
        })
      })
    );
  });

  it("fails parameterized grid candidates instead of falling back to the first visible item", async () => {
    const performAction = vi.fn();
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        ...layout("主页", "别的班级"),
        width: 1000,
        height: 2000
      }),
      performAction,
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 10, y: 20, width: 80, height: 60 },
        locator: "image-region:10,20,80,60",
        targetMode: "image_region",
        abilityType: "grid_candidate",
        maxSearchSwipes: 0,
        scrollProfile: {
          containerKind: "grid_list",
          direction: "vertical",
          columns: 2,
          targetKind: "item_text",
          targetQuery: "班级四十一号",
          candidateItemHeightPercent: 25,
          clickSafePoint: { xPercent: 50, yPercent: 28 }
        }
      })
    });

    expect(performAction).not.toHaveBeenCalled();
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: false,
        message: 'Grid candidate target "班级四十一号" was not found inside the marked list region.',
        metadata: expect.objectContaining({
          action: "fail",
          reason: "target_not_found",
          targetQuery: "班级四十一号"
        })
      })
    );
  });

  it("fails tap_on_element when the recorded locator is absent", async () => {
    const performAction = vi.fn();
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("首页")),
      dumpUiHierarchy: async () => hierarchy("com.demo:id/other"),
      performAction,
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: tapOnElementStep("com.demo:id/join_class", 200, 240, { timeoutMs: 1, intervalMs: 1 })
    });

    expect(performAction).not.toHaveBeenCalled();
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: false,
        message: "Element target id=com.demo:id/join_class was not found.",
        metadata: expect.objectContaining({
          action: "fail",
          reason: "target_not_found"
        })
      })
    );
  });
});

function tapOnTextStep(text: string, x: number, y: number, params: Record<string, unknown> = {}): ActionStep {
  return {
    id: "step-text",
    order: 1,
    type: "tap_on_text",
    enabled: true,
    params: {
      text,
      mode: "contains",
      ...params
    },
    coordinate: {
      x,
      y,
      xRatio: x / 1080,
      yRatio: y / 2400,
      deviceWidth: 1080,
      deviceHeight: 2400
    },
    createdAt: "2026-06-10T00:00:00.000Z"
  };
}

function tapOnElementStep(resourceId: string, x: number, y: number, params: Record<string, unknown> = {}): ActionStep {
  return {
    id: "step-element",
    order: 1,
    type: "tap_on_element",
    enabled: true,
    params: {
      locator: {
        strategy: "android_uiautomator",
        resourceId,
        packageName: "com.demo"
      },
      selector: `id=${resourceId}`,
      ...params
    },
    coordinate: {
      x,
      y,
      xRatio: x / 1080,
      yRatio: y / 2400,
      deviceWidth: 1080,
      deviceHeight: 2400
    },
    createdAt: "2026-06-10T00:00:00.000Z"
  };
}

function semanticStep(type: ActionStep["type"], params: Record<string, unknown> = {}): ActionStep {
  return {
    id: `step-${type}`,
    order: 1,
    type,
    enabled: true,
    params,
    createdAt: "2026-06-10T00:00:00.000Z"
  };
}

function hierarchy(resourceId: string): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="进入课堂" resource-id="${resourceId}" class="android.widget.Button" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[120,200][360,280]" />
  </node>
</hierarchy>`;
}

function inputHierarchy(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1000,2000]">
    <node index="0" text="登录" resource-id="com.demo:id/login_title" class="android.widget.TextView" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[120,120][240,176]" />
    <node index="1" text="" resource-id="com.demo:id/phone_input" class="android.widget.EditText" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="true" scrollable="false" bounds="[100,500][900,620]" />
    <node index="2" text="" resource-id="com.demo:id/password_input" class="android.widget.EditText" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="true" scrollable="false" bounds="[100,660][900,780]" />
  </node>
</hierarchy>`;
}

function layout(...texts: string[]): OcrLayoutResult {
  const boxes = texts.map((text, index) => ({
    text,
    confidence: 0.9 - index * 0.1,
    x: index === 0 ? 680 : 120,
    y: index === 0 ? 1580 : 200,
    width: index === 0 ? 100 : 160,
    height: index === 0 ? 70 : 50
  }));
  return {
    text: texts.join("\n"),
    engine: "fake-layout",
    lang: "test",
    width: 1080,
    height: 2400,
    boxes
  };
}

function topBarLayout(): OcrLayoutResult {
  return {
    text: "主页\n免费版",
    engine: "fake-layout",
    lang: "test",
    width: 1200,
    height: 2000,
    boxes: [
      { text: "主页", confidence: 0.99, x: 129, y: 129, width: 86, height: 48 },
      { text: "免费版", confidence: 0.92, x: 232, y: 133, width: 84, height: 38 }
    ]
  };
}

function screenshot(id: string): ScreenshotCapture {
  return {
    artifact: artifact(id),
    png: Buffer.from("screen")
  };
}

function pgm(width: number, height: number, pixels: number[]): Buffer {
  if (pixels.length !== width * height) {
    throw new Error("Invalid PGM pixel count");
  }
  return Buffer.concat([
    Buffer.from(`P5\n${width} ${height}\n255\n`, "ascii"),
    Buffer.from(pixels)
  ]);
}

function checkboxScreenshot(checked: boolean): Buffer {
  const width = 1080;
  const height = 2400;
  const pixels = Array.from({ length: width * height }, () => 255);
  const centerX = 88;
  const centerY = 1005;
  for (let y = centerY - 18; y <= centerY + 18; y += 1) {
    for (let x = centerX - 18; x <= centerX + 18; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance >= 14 && distance <= 18) {
        pixels[y * width + x] = 170;
      }
      if (checked && distance <= 11) {
        pixels[y * width + x] = 60;
      }
    }
  }
  return pgm(width, height, pixels);
}

function topBarIconScreenshot(
  width: number,
  height: number,
  icons: Array<{ role: "add" | "search"; centerX: number; centerY: number }>
): Buffer {
  const pixels = Array.from({ length: width * height }, () => 255);
  for (const icon of icons) {
    if (icon.role === "add") {
      drawCircle(pixels, width, height, icon.centerX, icon.centerY, 22, 5, 20);
      drawLine(pixels, width, height, icon.centerX - 13, icon.centerY, icon.centerX + 13, icon.centerY, 5, 20);
      drawLine(pixels, width, height, icon.centerX, icon.centerY - 13, icon.centerX, icon.centerY + 13, 5, 20);
    } else {
      drawCircle(pixels, width, height, icon.centerX - 3, icon.centerY - 3, 18, 5, 20);
      drawLine(pixels, width, height, icon.centerX + 9, icon.centerY + 9, icon.centerX + 24, icon.centerY + 24, 5, 20);
    }
  }
  return pgm(width, height, pixels);
}

function drawCircle(pixels: number[], width: number, height: number, centerX: number, centerY: number, radius: number, thickness: number, color: number): void {
  const minX = Math.max(0, Math.floor(centerX - radius - thickness));
  const maxX = Math.min(width - 1, Math.ceil(centerX + radius + thickness));
  const minY = Math.max(0, Math.floor(centerY - radius - thickness));
  const maxY = Math.min(height - 1, Math.ceil(centerY + radius + thickness));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      if (Math.abs(distance - radius) <= thickness / 2) {
        pixels[y * width + x] = color;
      }
    }
  }
}

function drawLine(pixels: number[], width: number, height: number, x1: number, y1: number, x2: number, y2: number, thickness: number, color: number): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  const radius = Math.max(1, Math.floor(thickness / 2));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x1 + ((x2 - x1) * step) / steps);
    const y = Math.round(y1 + ((y2 - y1) * step) / steps);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.hypot(dx, dy) > radius) {
          continue;
        }
        const px = x + dx;
        const py = y + dy;
        if (px >= 0 && px < width && py >= 0 && py < height) {
          pixels[py * width + px] = color;
        }
      }
    }
  }
}

function artifact(id: string): ArtifactRef {
  return {
    id,
    runId: "run-1",
    stepResultId: "step-result-1",
    type: "screenshot",
    name: `${id}.png`,
    path: `runs/run-1/screenshots/${id}.png`,
    url: `/artifacts/runs/run-1/screenshots/${id}.png`,
    createdAt: "2026-06-10T00:00:00.000Z"
  };
}

class LayoutOcrService implements OcrService {
  constructor(private readonly result: OcrLayoutResult) {}

  async recognize(_input: OcrInput): Promise<OcrResult> {
    return this.result;
  }

  async locateText(_input: OcrInput): Promise<OcrLayoutResult> {
    return this.result;
  }
}

class QueueLayoutOcrService implements OcrService {
  constructor(private readonly results: OcrLayoutResult[]) {}

  async recognize(_input: OcrInput): Promise<OcrResult> {
    return this.peek();
  }

  async locateText(_input: OcrInput): Promise<OcrLayoutResult> {
    return this.results.shift() ?? this.peek();
  }

  private peek(): OcrLayoutResult {
    return this.results[0] ?? layout();
  }
}
