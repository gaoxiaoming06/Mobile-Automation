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

  it("grounds a semantic query to one unambiguous visible OCR candidate", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("教学方案", "学习方案")),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-semantic",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: tapOnTextStep("进入教学方案的入口", 0, 0, {
        mode: "semantic",
        semanticArea: "content",
        searchMode: "auto"
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 730, y: 1615 }]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({ actual: "教学方案", matchStrategy: "semantic" })
    }));
  });

  it("searches a scrollable page from the top until a text target becomes visible", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        layout("页面中部"),
        layout("页面顶部"),
        layout("页面顶部"),
        layout("创建教学方案")
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-scroll-text",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: tapOnTextStep("创建教学方案", 0, 0, {
        searchMode: "auto",
        searchDirection: "down",
        resetToTop: true,
        maxSwipes: 4,
        intervalMs: 1
      })
    });

    expect(actions.slice(0, 3)).toEqual([
      { type: "swipe", startX: 540, startY: 600, endX: 540, endY: 1800, durationMs: 450 },
      { type: "swipe", startX: 540, startY: 600, endX: 540, endY: 1800, durationMs: 450 },
      { type: "swipe", startX: 540, startY: 1800, endX: 540, endY: 600, durationMs: 450 }
    ]);
    expect(actions.at(-1)).toEqual({ type: "tap", x: 730, y: 1615 });
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        search: expect.objectContaining({ resetSwipes: 2, scanSwipes: 1 })
      })
    }));
  });

  it("treats the same OCR content with shifted boxes as a scroll boundary", async () => {
    const actions: DeviceActionRequest[] = [];
    const top = layout("页面顶部");
    const shiftedTop = {
      ...top,
      boxes: top.boxes.map((box) => ({ ...box, y: box.y - 96 }))
    };
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        top,
        shiftedTop,
        layout("教学方案")
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-shift-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-shifted-boundary",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: tapOnTextStep("教学方案", 0, 0, {
        searchMode: "auto",
        searchDirection: "down",
        resetToTop: true,
        maxSwipes: 4,
        intervalMs: 1
      })
    });

    expect(actions).toEqual([
      { type: "swipe", startX: 540, startY: 600, endX: 540, endY: 1800, durationMs: 450 },
      { type: "swipe", startX: 540, startY: 1800, endX: 540, endY: 600, durationMs: 450 },
      { type: "tap", x: 730, y: 1615 }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        search: expect.objectContaining({ resetSwipes: 1, scanSwipes: 1 })
      })
    }));
  });

  it("does not scroll when a text target uses visibleOnly search", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("页面中部")),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-visible-only",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: tapOnTextStep("创建教学方案", 0, 0, {
        searchMode: "visibleOnly",
        timeoutMs: 1,
        intervalMs: 1
      })
    });

    expect(actions).toEqual([]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: false,
      metadata: expect.objectContaining({
        search: expect.objectContaining({ mode: "visibleOnly", resetSwipes: 0, scanSwipes: 0 })
      })
    }));
  });

  it("rejects legacy grid candidate index taps without a semantic target", async () => {
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

    expect(actions).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: false,
        metadata: expect.objectContaining({
          action: "fail",
          abilityType: "grid_candidate",
          reason: "deprecated_grid_candidate_without_target"
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

  it("relocates a leading avatar by its current light circular container", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(topBarLayout()),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: topBarAvatarScreenshot(1200, 2000, { centerX: 80, centerY: 172, radius: 42 })
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-avatar",
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
            { role: "avatar", label: "头像", score: 0.93, semanticArea: "top", region: { x: 4.2, y: 6.1, width: 5, height: 5 } }
          ]
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 80, y: 172 }]);
    expect(outcome?.metadata).toEqual(
      expect.objectContaining({
        role: "avatar",
        relocatedBy: "top_bar_current_visual",
        currentVisual: expect.objectContaining({ strategy: "avatar_container" })
      })
    );
  });

  it("keeps a large current avatar when the recorded candidate was smaller and shifted", async () => {
    const actions: DeviceActionRequest[] = [];
    const shiftedTitleLayout = topBarLayout();
    shiftedTitleLayout.boxes = shiftedTitleLayout.boxes.map((box) => box.text === "主页" ? { ...box, x: 220 } : box);
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(shiftedTitleLayout),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: topBarAvatarScreenshot(1200, 2000, { centerX: 116, centerY: 230, radius: 50 })
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-avatar-shifted",
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
            { role: "avatar", label: "头像", score: 0.93, semanticArea: "top", region: { x: 4.1, y: 6, width: 5.2, height: 3.2 } }
          ]
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 116, y: 230 }]);
    expect(outcome?.metadata).toEqual(expect.objectContaining({ relocatedBy: "top_bar_current_visual" }));
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

  it("resolves a standard trailing top-bar icon without a recorded visual candidate", async () => {
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
      stepResultId: "step-result-semantic-add",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "semantic_icon_locator",
        role: "add",
        slot: "trailing",
        orderFromRight: 1,
        semanticArea: "top",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 1065, y: 215 }]);
    expect(outcome?.metadata).toEqual(expect.objectContaining({
      role: "add",
      relocatedBy: "top_bar_current_visual",
      recordedCandidateUsed: false
    }));
  });

  it("resolves a standard floating add icon in page content without a recorded region", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("班级详情")),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: floatingAddIconScreenshot(1000, 2000, { centerX: 875, centerY: 1600, radius: 70 })
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-floating-add",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "semantic_icon_locator",
        role: "add",
        slot: "trailing",
        orderFromRight: 1,
        semanticArea: "content",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 876, y: 1601 }]);
    expect(outcome?.metadata).toEqual(expect.objectContaining({
      role: "add",
      semanticArea: "content",
      relocatedBy: "content_current_visual",
      recordedCandidateUsed: false
    }));
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

  it("clears a runtime structural input as one semantic action without typing a placeholder", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "课堂名称 自动化课堂",
        engine: "fake-layout",
        lang: "test",
        width: 1000,
        height: 2000,
        boxes: [
          { text: "课堂名称", confidence: 0.98, x: 80, y: 395, width: 180, height: 30 }
        ]
      }),
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
      step: semanticStep("input_text_to_element", {
        text: "",
        clearFirst: true,
        clearOnly: true,
        focusDelayMs: 0,
        locatorKind: "structural_locator",
        targetText: "课堂名称",
        semanticArea: "content",
        structuralLocator: {
          strategy: "ocr_or_edittext",
          text: "课堂名称"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 170, y: 410 },
      { type: "clear_text" }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      supported: true,
      resolved: true,
      metadata: expect.objectContaining({
        action: "clear_text",
        clearOnly: true
      })
    }));
  });

  it("resolves a dynamic input value from the nearest text above a stable OCR anchor", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "新建课堂 班级四十二号-主课程-52 开始时间 当前时间",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "新建课堂", confidence: 0.99, x: 145, y: 150, width: 180, height: 50 },
            { text: "班级四十二号-主课程-52", confidence: 0.98, x: 90, y: 330, width: 390, height: 52 },
            { text: "开始时间", confidence: 0.99, x: 90, y: 510, width: 160, height: 52 },
            { text: "当前时间", confidence: 0.99, x: 680, y: 510, width: 160, height: 52 }
          ]
        },
        {
          text: "新建课堂 自动化组合课堂 开始时间 当前时间",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "新建课堂", confidence: 0.99, x: 145, y: 150, width: 180, height: 50 },
            { text: "自动化组合课堂", confidence: 0.99, x: 90, y: 330, width: 280, height: 52 },
            { text: "开始时间", confidence: 0.99, x: 90, y: 510, width: 160, height: 52 },
            { text: "当前时间", confidence: 0.99, x: 680, y: 510, width: 160, height: 52 }
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
        text: "自动化组合课堂",
        clearFirst: true,
        focusDelayMs: 1,
        inputVerificationDelayMs: 1,
        locator: "runtime-locator:lesson_title_input",
        locatorKind: "structural_locator",
        semanticArea: "content",
        coordinateSpace: "runtime",
        structuralLocator: {
          strategy: "ocr_relative_input",
          anchorText: "开始时间",
          relation: "nearest_text_above",
          role: "text_input",
          fallbackPolicy: "no_region_center_fallback"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 285, y: 356 },
      { type: "clear_text" },
      { type: "input_text", text: "自动化组合课堂" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          resolvedBy: "runtime_structural_locator",
          focusResolvedBy: "ocr_relative_structure",
          inputVerified: true,
          verificationRegionSource: "runtime_focus_candidate"
        })
      })
    );
  });

  it("restores the content area to the top before resolving a hidden runtime input", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "课堂信息 录制ClassIn教室 AI授课分析",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "课堂信息", confidence: 0.99, x: 90, y: 360, width: 160, height: 52 },
            { text: "录制ClassIn教室", confidence: 0.99, x: 90, y: 650, width: 260, height: 52 }
          ]
        },
        {
          text: "新建课堂 请输入课堂名称（90字以内） 开始时间",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "新建课堂", confidence: 0.99, x: 145, y: 150, width: 180, height: 50 },
            { text: "请输入课堂名称（90字以内）", confidence: 0.99, x: 90, y: 330, width: 420, height: 52 },
            { text: "开始时间", confidence: 0.99, x: 90, y: 510, width: 160, height: 52 }
          ]
        },
        {
          text: "新建课堂 滚动恢复课堂 开始时间",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "滚动恢复课堂", confidence: 0.99, x: 90, y: 330, width: 240, height: 52 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("input_text_to_element", {
        text: "滚动恢复课堂",
        clearFirst: true,
        focusDelayMs: 1,
        inputVerificationDelayMs: 1,
        locator: "runtime-locator:lesson_title_input",
        locatorKind: "structural_locator",
        semanticArea: "content",
        coordinateSpace: "runtime",
        structuralLocator: {
          strategy: "ocr_relative_input",
          anchorText: "开始时间",
          relation: "nearest_text_above",
          revealStrategy: "scroll_to_top",
          revealMaxSwipes: 3,
          fallbackPolicy: "no_region_center_fallback"
        }
      })
    });

    expect(actions).toEqual([
      { type: "swipe", startX: 500, startY: 500, endX: 500, endY: 1500, durationMs: 450 },
      { type: "tap", x: 300, y: 356 },
      { type: "clear_text" },
      { type: "input_text", text: "滚动恢复课堂" }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        focusResolvedBy: "ocr_relative_structure",
        reveal: expect.objectContaining({ strategy: "scroll_to_top", swipes: 1 })
      })
    }));
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

  it("restores content to the top before tapping a hidden runtime structural row", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "AI内容总结 AI转写",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "AI转写", confidence: 0.99, x: 90, y: 1000, width: 160, height: 52 }]
        },
        {
          text: "课堂信息 修改",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "课堂信息", confidence: 0.99, x: 90, y: 640, width: 180, height: 52 }]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1", stepResultId: "step-result-1", serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:lesson_classroom_info_row",
        locatorKind: "structural_locator",
        semanticArea: "content",
        coordinateSpace: "runtime",
        targetText: "课堂信息",
        structuralLocator: {
          strategy: "ocr_text_row",
          anchorText: "课堂信息",
          revealStrategy: "scroll_to_top",
          revealMaxSwipes: 3
        }
      })
    });

    expect(actions).toEqual([
      { type: "swipe", startX: 500, startY: 500, endX: 500, endY: 1500, durationMs: 450 },
      { type: "tap", x: 180, y: 666 }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        relocatedBy: "runtime_ocr_text_after_reveal",
        reveal: { strategy: "scroll_to_top", swipes: 1 }
      })
    }));
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

  it("selects hours and minutes independently in a multi-column duration picker", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "0小时 1小时 2小时 45分钟 50分钟 55分钟",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "0小时", confidence: 0.99, x: 120, y: 1500, width: 150, height: 60 },
            { text: "1小时", confidence: 0.9, x: 120, y: 1600, width: 150, height: 60 },
            { text: "2小时", confidence: 0.85, x: 120, y: 1700, width: 150, height: 60 },
            { text: "45分钟", confidence: 0.9, x: 680, y: 1400, width: 170, height: 60 },
            { text: "50分钟", confidence: 0.99, x: 680, y: 1500, width: 170, height: 60 },
            { text: "55分钟", confidence: 0.9, x: 680, y: 1600, width: 170, height: 60 }
          ]
        },
        {
          text: "确定 8小时 9小时 10 小时 45分钟 50分钟 55分钟",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "8小时", confidence: 0.9, x: 120, y: 1400, width: 150, height: 60 },
            { text: "9小时", confidence: 0.95, x: 120, y: 1500, width: 150, height: 60 },
            { text: "确定", confidence: 0.99, x: 820, y: 1500, width: 100, height: 55 },
            { text: "10", confidence: 0.99, x: 120, y: 1770, width: 70, height: 60 },
            { text: "小时", confidence: 0.99, x: 198, y: 1770, width: 90, height: 60 },
            { text: "50分钟", confidence: 0.99, x: 680, y: 1500, width: 170, height: 60 }
          ]
        },
        {
          text: "确定 10小时 25分钟 30 分钟 35分钟",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "确定", confidence: 0.99, x: 820, y: 1500, width: 100, height: 55 },
            { text: "10小时", confidence: 0.99, x: 120, y: 1770, width: 170, height: 60 },
            { text: "25分钟", confidence: 0.9, x: 680, y: 1400, width: 170, height: 60 },
            { text: "30", confidence: 0.99, x: 680, y: 1770, width: 70, height: 60 },
            { text: "分钟", confidence: 0.99, x: 758, y: 1770, width: 90, height: 60 },
            { text: "35分钟", confidence: 0.9, x: 680, y: 1600, width: 170, height: 60 }
          ]
        },
        {
          text: "确定",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "确定", confidence: 0.99, x: 820, y: 1120, width: 100, height: 55 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
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
        selectedValue: "10小时30分钟",
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1,
        structuralLocator: {
          pickerMode: "duration_hours_minutes"
        }
      })
    });

    expect(actions[0]).toEqual({ type: "tap", x: 500, y: 830 });
    expect(actions[1]).toEqual(expect.objectContaining({ type: "swipe", startX: 250, endX: 250 }));
    expect(actions[2]).toEqual({ type: "tap", x: 870, y: 1148 });
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        action: "picker_select",
        selectedValue: "10小时30分钟",
        pickerMode: "duration_hours_minutes",
        selectedParts: ["10小时", "30分钟"]
      })
    }));
  });

  it("relocates a runtime picker row after scrolling before selecting duration columns", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "AI授课分析 AI内容总结",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "AI授课分析", confidence: 0.99, x: 90, y: 800, width: 200, height: 52 }]
        },
        {
          text: "AI授课分析 AI内容总结",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "AI授课分析", confidence: 0.99, x: 90, y: 800, width: 200, height: 52 }]
        },
        {
          text: "课堂时长 50分钟",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "课堂时长", confidence: 0.99, x: 90, y: 600, width: 180, height: 52 }]
        },
        {
          text: "0小时 50分钟",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [
            { text: "0小时", confidence: 0.99, x: 120, y: 1500, width: 150, height: 60 },
            { text: "50分钟", confidence: 0.99, x: 680, y: 1500, width: 170, height: 60 }
          ]
        },
        {
          text: "0小时 30分钟",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [
            { text: "0小时", confidence: 0.99, x: 120, y: 1500, width: 150, height: 60 },
            { text: "30分钟", confidence: 0.99, x: 680, y: 1500, width: 170, height: 60 }
          ]
        },
        {
          text: "确定",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "确定", confidence: 0.99, x: 820, y: 1120, width: 100, height: 55 }]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1", stepResultId: "step-result-1", serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:lesson_duration_row",
        locatorKind: "structural_locator",
        targetText: "课堂时长",
        semanticArea: "content",
        coordinateSpace: "runtime",
        fieldType: "picker_select",
        selectedValue: "30分钟",
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1,
        pickerScrollIntervalMs: 1,
        structuralLocator: {
          strategy: "ocr_text_row",
          anchorText: "课堂时长",
          revealStrategy: "scroll_to_top",
          revealMaxSwipes: 3,
          pickerMode: "duration_hours_minutes"
        }
      })
    });

    expect(actions[0]).toEqual({ type: "swipe", startX: 500, startY: 500, endX: 500, endY: 1500, durationMs: 450 });
    expect(actions[1]).toEqual({ type: "tap", x: 180, y: 626 });
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        pickerMode: "duration_hours_minutes",
        selectedValue: "30分钟",
        openerRelocatedBy: "runtime_ocr_text_after_reveal"
      })
    }));
  });

  it("selects the current time shortcut in a date-time picker", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "开始时间 当前时间",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "开始时间", confidence: 0.99, x: 90, y: 520, width: 180, height: 52 }]
        },
        {
          text: "开始时间 2026-07-13 周一 10 40 选择当前时间",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [
            { text: "2026-07-13 周一", confidence: 0.99, x: 80, y: 1450, width: 440, height: 60 },
            { text: "10", confidence: 0.99, x: 650, y: 1450, width: 80, height: 60 },
            { text: "40", confidence: 0.99, x: 850, y: 1450, width: 80, height: 60 },
            { text: "选择当前时间", confidence: 0.99, x: 340, y: 1800, width: 320, height: 70 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1", stepResultId: "step-result-1", serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:lesson_start_time_row",
        locatorKind: "structural_locator",
        targetText: "开始时间",
        semanticArea: "content",
        coordinateSpace: "runtime",
        fieldType: "picker_select",
        selectedValue: "current",
        pickerOpenDelayMs: 1,
        structuralLocator: {
          strategy: "ocr_text_row",
          anchorText: "开始时间",
          revealStrategy: "scroll_to_top",
          pickerMode: "date_time"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 180, y: 546 },
      { type: "tap", x: 500, y: 1835 }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        pickerMode: "date_time",
        selectedValue: "current",
        selectedBy: "current_time_shortcut"
      })
    }));
  });

  it("selects date hour and minute independently in a date-time picker", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "开始时间 当前时间",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "开始时间", confidence: 0.99, x: 90, y: 520, width: 180, height: 52 }]
        },
        {
          text: "2026-07-13 周一 10 40",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [
            { text: "2026-07-13 周一", confidence: 0.99, x: 80, y: 1450, width: 440, height: 60 },
            { text: "10", confidence: 0.99, x: 650, y: 1450, width: 80, height: 60 },
            { text: "40", confidence: 0.99, x: 850, y: 1450, width: 80, height: 60 }
          ]
        },
        {
          text: "2026-07-14 周二 10 40",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [
            { text: "2026-07-14 周二", confidence: 0.99, x: 80, y: 1450, width: 440, height: 60 },
            { text: "10", confidence: 0.99, x: 650, y: 1450, width: 80, height: 60 },
            { text: "40", confidence: 0.99, x: 850, y: 1450, width: 80, height: 60 }
          ]
        },
        {
          text: "2026-07-14 周二 14 40",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [
            { text: "2026-07-14 周二", confidence: 0.99, x: 80, y: 1450, width: 440, height: 60 },
            { text: "14", confidence: 0.99, x: 650, y: 1450, width: 80, height: 60 },
            { text: "40", confidence: 0.99, x: 850, y: 1450, width: 80, height: 60 }
          ]
        },
        {
          text: "2026-07-14 周二 14 30",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [
            { text: "2026-07-14 周二", confidence: 0.99, x: 80, y: 1450, width: 440, height: 60 },
            { text: "14", confidence: 0.99, x: 650, y: 1450, width: 80, height: 60 },
            { text: "30", confidence: 0.99, x: 850, y: 1450, width: 80, height: 60 }
          ]
        },
        {
          text: "确定",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "确定", confidence: 0.99, x: 820, y: 1120, width: 100, height: 55 }]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1", stepResultId: "step-result-1", serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:lesson_start_time_row",
        locatorKind: "structural_locator",
        targetText: "开始时间",
        semanticArea: "content",
        coordinateSpace: "runtime",
        fieldType: "picker_select",
        selectedValue: "2026-07-14 14:30",
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1,
        pickerScrollIntervalMs: 0,
        structuralLocator: {
          strategy: "ocr_text_row",
          anchorText: "开始时间",
          revealStrategy: "scroll_to_top",
          pickerMode: "date_time"
        }
      })
    });

    expect(actions[0]).toEqual({ type: "tap", x: 180, y: 546 });
    expect(actions).toContainEqual(expect.objectContaining({ type: "swipe", startX: 270, endX: 270 }));
    expect(actions.at(-1)).toEqual({ type: "tap", x: 870, y: 1148 });
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        pickerMode: "date_time",
        selectedValue: "2026-07-14 14:30",
        selectedParts: ["2026-07-14", "14", "30"]
      })
    }));
  });

  it("allows an explicitly marked structural form row in the bottom viewport", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "编辑课堂信息",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "编辑课堂信息", confidence: 0.99, x: 150, y: 150, width: 260, height: 52 }]
        },
        {
          text: "编辑课堂信息 台上人数 1V8",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "台上人数", confidence: 0.99, x: 90, y: 1820, width: 180, height: 52 }]
        },
        {
          text: "1V7 1V8 1V9",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [
            { text: "1V7", confidence: 0.9, x: 420, y: 1350, width: 160, height: 60 },
            { text: "1V8", confidence: 0.99, x: 420, y: 1470, width: 160, height: 60 },
            { text: "1V9", confidence: 0.9, x: 420, y: 1590, width: 160, height: 60 }
          ]
        },
        {
          text: "确定",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "确定", confidence: 0.99, x: 820, y: 1120, width: 100, height: 55 }]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1", stepResultId: "step-result-1", serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:classroom_stage_count_row",
        locatorKind: "structural_locator",
        targetText: "台上人数",
        semanticArea: "content",
        coordinateSpace: "runtime",
        fieldType: "picker_select",
        selectedValue: "1V8",
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1,
        structuralLocator: {
          strategy: "ocr_text_row",
          anchorText: "台上人数",
          pickerMode: "single_wheel",
          allowBottomContent: true
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 180, y: 1846 },
      { type: "tap", x: 870, y: 1148 }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        pickerMode: "single_wheel",
        selectedValue: "1V8",
        selectedBy: "wheel_center",
        confirmedBy: "确定",
        openerRelocatedBy: "runtime_ocr_text_bottom_content"
      })
    }));
  });

  it("does not use a bottom-viewport OCR candidate without structural permission", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "编辑课堂信息 台上人数 1V8",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "台上人数", confidence: 0.99, x: 90, y: 1820, width: 180, height: 52 }]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1", stepResultId: "step-result-1", serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:classroom_stage_count_row",
        locatorKind: "structural_locator",
        targetText: "台上人数",
        semanticArea: "content",
        coordinateSpace: "runtime",
        fieldType: "picker_select",
        selectedValue: "1V8",
        structuralLocator: {
          strategy: "ocr_text_row",
          anchorText: "台上人数",
          pickerMode: "single_wheel",
          locatorReadAttempts: 1
        }
      })
    });

    expect(actions).toEqual([]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: false,
      message: 'Runtime picker row "台上人数" was not found.'
    }));
  });

  it("retries a transient empty OCR frame before selecting a single-wheel value", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "编辑课堂信息 台上人数 1V8",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "台上人数", confidence: 0.99, x: 90, y: 1200, width: 180, height: 52 }]
        },
        { text: "", engine: "fake-layout", lang: "test", width: 1000, height: 2000, boxes: [] },
        {
          text: "1V7 1V8 1V9",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [
            { text: "1V7", confidence: 0.9, x: 420, y: 1350, width: 160, height: 60 },
            { text: "1V8", confidence: 0.99, x: 420, y: 1470, width: 160, height: 60 },
            { text: "1V9", confidence: 0.9, x: 420, y: 1590, width: 160, height: 60 }
          ]
        },
        {
          text: "确定",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "确定", confidence: 0.99, x: 820, y: 1120, width: 100, height: 55 }]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1", stepResultId: "step-result-1", serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:classroom_stage_count_row",
        locatorKind: "structural_locator",
        targetText: "台上人数",
        semanticArea: "content",
        coordinateSpace: "runtime",
        fieldType: "picker_select",
        selectedValue: "1V8",
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1,
        pickerReadAttempts: 2,
        structuralLocator: {
          strategy: "ocr_text_row",
          anchorText: "台上人数",
          pickerMode: "single_wheel"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 180, y: 1226 },
      { type: "tap", x: 870, y: 1148 }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        pickerMode: "single_wheel",
        selectedValue: "1V8",
        pickerReadRetries: 1
      })
    }));
  });

  it("selects a runtime option from a temporary form overlay and confirms it", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "编辑课堂信息 选择课程 主课程",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "选择课程", confidence: 0.99, x: 90, y: 700, width: 220, height: 60 }]
        },
        {
          text: "选择课程 新建课程 主课程 课节 确定",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [
            { text: "选择课程", confidence: 0.99, x: 70, y: 280, width: 220, height: 60 },
            { text: "主课程", confidence: 0.99, x: 70, y: 560, width: 180, height: 60 },
            { text: "课节", confidence: 0.99, x: 70, y: 700, width: 120, height: 60 }
          ]
        },
        {
          text: "选择课程 主课程 确定",
          engine: "fake-layout", lang: "test", width: 1000, height: 2000,
          boxes: [{ text: "确定", confidence: 0.99, x: 100, y: 1820, width: 800, height: 90 }]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1", stepResultId: "step-result-1", serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:classroom_course_row",
        locatorKind: "structural_locator",
        targetText: "选择课程",
        semanticArea: "content",
        coordinateSpace: "runtime",
        fieldType: "subpage_edit",
        selectedValue: "主课程",
        overlayOpenDelayMs: 1,
        optionSelectDelayMs: 1,
        structuralLocator: {
          strategy: "ocr_text_row",
          anchorText: "选择课程",
          selectionMode: "ocr_option_confirm",
          confirmText: "确定"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 200, y: 730 },
      { type: "tap", x: 160, y: 590 },
      { type: "tap", x: 500, y: 1865 }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        action: "subpage_edit",
        selectedValue: "主课程",
        selectedBy: "ocr_option",
        confirmedBy: "确定"
      })
    }));
  });

  it("keeps an already selected checkbox option checked before confirming", async () => {
    const actions: DeviceActionRequest[] = [];
    const screenshots = [Buffer.from("screen"), checkboxScreenshot(true), Buffer.from("screen")];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "编辑课堂信息 学生",
          engine: "fake-layout", lang: "test", width: 1080, height: 2400,
          boxes: [{ text: "学生", confidence: 0.99, x: 90, y: 700, width: 120, height: 60 }]
        },
        {
          text: "选择学生 学生昵称02",
          engine: "fake-layout", lang: "test", width: 1080, height: 2400,
          boxes: [{ text: "学生昵称02", confidence: 0.99, x: 240, y: 975, width: 260, height: 60 }]
        },
        {
          text: "确定",
          engine: "fake-layout", lang: "test", width: 1080, height: 2400,
          boxes: [{ text: "确定", confidence: 0.99, x: 780, y: 2200, width: 200, height: 100 }]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        artifact: artifact(`artifact-${attempt}`),
        png: screenshots.shift() ?? Buffer.from("screen")
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1", stepResultId: "step-result-1", serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:classroom_students_row",
        locatorKind: "structural_locator",
        targetText: "学生",
        semanticArea: "content",
        coordinateSpace: "runtime",
        fieldType: "subpage_edit",
        selectedValue: "学生昵称02",
        overlayOpenDelayMs: 1,
        optionSelectDelayMs: 1,
        structuralLocator: {
          strategy: "ocr_text_row",
          anchorText: "学生",
          selectionMode: "ocr_option_confirm",
          optionRole: "checkbox",
          optionCheckboxXPercent: 8,
          confirmText: "确定"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 150, y: 730 },
      { type: "tap", x: 880, y: 2250 }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        selectedValue: "学生昵称02",
        optionState: "already_checked",
        confirmedBy: "确定"
      })
    }));
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

  it("relocates a trailing switch by its row label and verifies the desired state visually", async () => {
    const actions: DeviceActionRequest[] = [];
    const screenshots = [trailingSwitchScreenshot(false), trailingSwitchScreenshot(true)];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "AI内容总结",
        engine: "fake-layout",
        lang: "test",
        width: 1000,
        height: 2000,
        boxes: [
          { text: "AI内容总结", confidence: 0.99, x: 90, y: 1200, width: 240, height: 60 }
        ]
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        artifact: artifact(`artifact-${attempt}`),
        png: screenshots.shift() ?? trailingSwitchScreenshot(true)
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:ai_content_summary_switch",
        locatorKind: "structural_locator",
        targetText: "AI内容总结",
        semanticArea: "content",
        coordinateSpace: "runtime",
        fieldType: "toggle_set",
        desiredState: "on",
        toggleVerifyDelayMs: 1,
        structuralLocator: {
          strategy: "ocr_trailing_switch",
          anchorText: "AI内容总结",
          controlCenterXPercent: 84,
          controlWidthPercent: 16,
          controlHeightPercent: 6
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 840, y: 1230 }]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        action: "toggle_set",
        currentState: "off",
        desiredState: "on",
        verifiedState: "on",
        relocatedBy: "ocr_trailing_switch"
      })
    }));
  });

  it("searches the full content area for an offscreen trailing switch", async () => {
    const actions: DeviceActionRequest[] = [];
    const screenshots = [
      trailingSwitchScreenshot(false),
      trailingSwitchScreenshot(false),
      trailingSwitchScreenshot(false),
      trailingSwitchScreenshot(false),
      trailingSwitchScreenshot(true)
    ];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "课堂信息 录制ClassIn教室",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [{ text: "课堂信息", confidence: 0.99, x: 90, y: 420, width: 160, height: 52 }]
        },
        {
          text: "新建课堂 开始时间 课堂时长",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [{ text: "开始时间", confidence: 0.99, x: 90, y: 420, width: 160, height: 52 }]
        },
        {
          text: "新建课堂 开始时间 课堂时长",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [{ text: "开始时间", confidence: 0.99, x: 90, y: 420, width: 160, height: 52 }]
        },
        {
          text: "AI内容总结 AI转写",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [{ text: "AI转写", confidence: 0.99, x: 90, y: 1200, width: 160, height: 52 }]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        artifact: artifact(`artifact-${attempt}`),
        png: screenshots.shift() ?? trailingSwitchScreenshot(true)
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:ai_transcription_switch",
        locatorKind: "structural_locator",
        targetText: "AI转写",
        semanticArea: "content",
        coordinateSpace: "runtime",
        fieldType: "toggle_set",
        desiredState: "on",
        toggleVerifyDelayMs: 1,
        structuralLocator: {
          strategy: "ocr_trailing_switch",
          anchorText: "AI转写",
          revealStrategy: "search_content",
          restoreMaxSwipes: 3,
          searchMaxSwipes: 6,
          revealIntervalMs: 0,
          controlCenterXPercent: 84,
          controlWidthPercent: 16,
          controlHeightPercent: 6
        }
      })
    });

    expect(actions).toEqual([
      { type: "swipe", startX: 500, startY: 500, endX: 500, endY: 1500, durationMs: 450 },
      { type: "swipe", startX: 500, startY: 500, endX: 500, endY: 1500, durationMs: 450 },
      { type: "swipe", startX: 500, startY: 1500, endX: 500, endY: 500, durationMs: 450 },
      { type: "tap", x: 840, y: 1226 }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        action: "toggle_set",
        relocatedBy: "ocr_trailing_switch_after_content_search",
        reveal: {
          strategy: "search_content",
          restoreSwipes: 2,
          searchSwipes: 1
        },
        desiredState: "on",
        verifiedState: "on"
      })
    }));
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

  it("rejects grid candidate image regions without a semantic target instead of tapping the configured safe point", async () => {
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

    expect(actions).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: false,
        metadata: expect.objectContaining({
          type: "image_region",
          action: "fail",
          abilityType: "grid_candidate",
          reason: "deprecated_grid_candidate_without_target"
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

    expect(actions).toEqual([{ type: "tap", x: 650, y: 760 }]);
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

  it("resolves grid candidates by structural search hint instead of a primary image region locator", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "主页\n班级四十二号",
        engine: "fake-layout",
        lang: "test",
        width: 1000,
        height: 2000,
        boxes: [
          {
            text: "班级四十二号",
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
        locator: "runtime-locator:home_class_grid",
        locatorKind: "collection_item_locator",
        semanticArea: "content",
        coordinateSpace: "runtime",
        abilityType: "grid_candidate",
        structuralLocator: {
          strategy: "collection_grid",
          role: "class_grid",
          searchHintRegion: { x: 10, y: 20, width: 80, height: 60 }
        },
        scrollProfile: {
          containerKind: "grid_list",
          direction: "vertical",
          columns: 2,
          targetKind: "item_text",
          targetQuery: "班级四十二号",
          candidateItemHeightPercent: 25,
          clickSafePoint: { xPercent: 50, yPercent: 28 },
          scrollStepPercent: 65
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 650, y: 760 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          action: "tap",
          abilityType: "grid_candidate",
          targetQuery: "班级四十二号",
          relocatedBy: "ocr_text_in_grid"
        })
      })
    );
  });

  it("searches the semantic content area when a collection target has no recorded region", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "主页\n班级四十二号",
        engine: "fake-layout",
        lang: "test",
        width: 1000,
        height: 2000,
        boxes: [
          {
            text: "班级四十二号",
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
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "image-region:3.06,30.44,93.99,59.13",
        locatorKind: "collection_item_locator",
        abilityType: "grid_candidate",
        scrollProfile: {
          containerKind: "grid_list",
          direction: "vertical",
          columns: 2,
          targetKind: "item_text",
          targetQuery: "班级四十二号",
          candidateItemHeightPercent: 24.5,
          scrollStepPercent: 65
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 650, y: 760 }]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        targetQuery: "班级四十二号",
        relocatedBy: "ocr_text_in_grid",
        regionSource: "semantic_content"
      })
    }));
  });

  it("taps the OCR matched collection item instead of a stale recorded grid column", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "主页\n班级七十号\n415641",
        engine: "fake-layout",
        lang: "test",
        width: 1200,
        height: 2000,
        boxes: [
          {
            text: "班级七十号",
            confidence: 0.95,
            x: 84,
            y: 1640,
            width: 130,
            height: 28
          },
          {
            text: "415641",
            confidence: 0.99,
            x: 467,
            y: 1646,
            width: 95,
            height: 24
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
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:home_class_grid",
        locatorKind: "collection_item_locator",
        semanticArea: "content",
        coordinateSpace: "runtime",
        abilityType: "grid_candidate",
        structuralLocator: {
          strategy: "collection_grid",
          role: "class_grid",
          searchHintRegion: { x: 3.06, y: 30.44, width: 93.99, height: 59.13 }
        },
        scrollProfile: {
          containerKind: "grid_list",
          direction: "vertical",
          columns: 2,
          targetKind: "item_text",
          targetQuery: "415641",
          candidateItemHeightPercent: 24.5,
          clickSafePoint: { xPercent: 50, yPercent: 28 },
          scrollStepPercent: 65
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 515, y: 1658 }]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          action: "tap",
          abilityType: "grid_candidate",
          targetQuery: "415641",
          actual: "415641",
          relocatedBy: "ocr_text_in_grid",
          center: { x: 515, y: 1658 }
        })
      })
    );
  });

  it("scrolls the marked list region until a target grid candidate text is visible", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          ...layout("中间位置"),
          width: 1000,
          height: 2000
        },
        {
          ...layout("顶部位置"),
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
      { type: "swipe", startX: 500, startY: 700, endX: 500, endY: 1300, durationMs: 450 },
      { type: "swipe", startX: 500, startY: 1300, endX: 500, endY: 700, durationMs: 450 },
      { type: "tap", x: 650, y: 760 }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        resolved: true,
        metadata: expect.objectContaining({
          relocatedBy: "ocr_text_in_grid_after_scroll",
          search: expect.objectContaining({
            strategy: "current_then_top_down",
            phase: "scan_down",
            swipes: 1,
            attempts: 3
          })
        })
      })
    );
  });

  it("does not use maxCandidateAttempts as a hard grid OCR search window", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        { ...layout("中间"), width: 1000, height: 2000 },
        { ...layout("顶部"), width: 1000, height: 2000 },
        { ...layout("顶部"), width: 1000, height: 2000 },
        { ...layout("第一页"), width: 1000, height: 2000 },
        { ...layout("第二页"), width: 1000, height: 2000 },
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
        return undefined;
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
        maxCandidateAttempts: 2,
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
      { type: "swipe", startX: 500, startY: 700, endX: 500, endY: 1300, durationMs: 450 },
      { type: "swipe", startX: 500, startY: 700, endX: 500, endY: 1300, durationMs: 450 },
      { type: "swipe", startX: 500, startY: 1300, endX: 500, endY: 700, durationMs: 450 },
      { type: "swipe", startX: 500, startY: 1300, endX: 500, endY: 700, durationMs: 450 },
      { type: "swipe", startX: 500, startY: 1300, endX: 500, endY: 700, durationMs: 450 },
      { type: "tap", x: 650, y: 760 }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        resolved: true,
        metadata: expect.objectContaining({
          relocatedBy: "ocr_text_in_grid_after_scroll",
          search: expect.objectContaining({
            strategy: "current_then_top_down",
            phase: "scan_down",
            attempts: 6
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

function trailingSwitchScreenshot(on: boolean): Buffer {
  const width = 1000;
  const height = 2000;
  const pixels = Array.from({ length: width * height }, () => 255);
  const left = 760;
  const right = 920;
  const top = 1195;
  const bottom = 1265;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      pixels[y * width + x] = on ? 125 : 190;
    }
  }
  const knobX = on ? 882 : 798;
  const knobY = 1230;
  for (let y = knobY - 30; y <= knobY + 30; y += 1) {
    for (let x = knobX - 30; x <= knobX + 30; x += 1) {
      if (Math.hypot(x - knobX, y - knobY) <= 30) {
        pixels[y * width + x] = 255;
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

function floatingAddIconScreenshot(
  width: number,
  height: number,
  icon: { centerX: number; centerY: number; radius: number }
): Buffer {
  const pixels = Array.from({ length: width * height }, () => 255);
  for (let y = icon.centerY - icon.radius; y <= icon.centerY + icon.radius; y += 1) {
    for (let x = icon.centerX - icon.radius; x <= icon.centerX + icon.radius; x += 1) {
      if (x >= 0 && x < width && y >= 0 && y < height && Math.hypot(x - icon.centerX, y - icon.centerY) <= icon.radius) {
        pixels[y * width + x] = 20;
      }
    }
  }
  drawLine(pixels, width, height, icon.centerX - 24, icon.centerY, icon.centerX + 24, icon.centerY, 10, 255);
  drawLine(pixels, width, height, icon.centerX, icon.centerY - 24, icon.centerX, icon.centerY + 24, 10, 255);
  return pgm(width, height, pixels);
}

function topBarAvatarScreenshot(
  width: number,
  height: number,
  avatar: { centerX: number; centerY: number; radius: number }
): Buffer {
  const pixels = Array.from({ length: width * height }, () => 255);
  for (let y = avatar.centerY - avatar.radius; y <= avatar.centerY + avatar.radius; y += 1) {
    for (let x = avatar.centerX - avatar.radius; x <= avatar.centerX + avatar.radius; x += 1) {
      if (x < 0 || x >= width || y < 0 || y >= height) {
        continue;
      }
      if (Math.hypot(x - avatar.centerX, y - avatar.centerY) <= avatar.radius) {
        pixels[y * width + x] = 232;
      }
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
