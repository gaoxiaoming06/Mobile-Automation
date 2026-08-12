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

  it("matches OCR text when class names use spaced or full-width hyphens", () => {
    const candidate = findTextCandidate(
      {
        text: "班级四十二号 - 22\n班级四十二号－23",
        engine: "fake-layout",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          { text: "班级四十二号 - 22", confidence: 0.99, x: 140, y: 520, width: 320, height: 48 },
          { text: "班级四十二号－23", confidence: 0.98, x: 140, y: 720, width: 320, height: 48 }
        ]
      },
      "班级四十二号-22"
    );

    expect(candidate).toEqual(expect.objectContaining({
      text: "班级四十二号-22",
      centerY: 544
    }));
  });

  it("treats attached OCR icon noise around a text label as an exact candidate", () => {
    const candidate = findTextCandidate(
      {
        text: "8+添加好友\n28加入班级\n加入公开课\n扫一扫",
        engine: "fake-layout",
        lang: "test",
        width: 1200,
        height: 2000,
        boxes: [
          { text: "8+添加好友", confidence: 0.98, x: 900, y: 232, width: 160, height: 44 },
          { text: "28加入班级", confidence: 0.98, x: 896, y: 300, width: 168, height: 44 },
          { text: "加入公开课", confidence: 0.98, x: 945, y: 374, width: 144, height: 44 },
          { text: "扫一扫", confidence: 0.98, x: 896, y: 440, width: 139, height: 44 }
        ]
      },
      "添加好友",
      { mode: "equals", semanticArea: "content", deviceSize: { width: 1200, height: 2000 } }
    );

    expect(candidate).toEqual(expect.objectContaining({
      text: "8+添加好友",
      centerX: 980,
      centerY: 254
    }));
  });

  it("treats a separated leading OCR glyph as decoration for an exact text candidate", () => {
    const candidate = findTextCandidate(
      {
        text: "Q Jej\n打卡|14/30天",
        engine: "fake-layout",
        lang: "test",
        width: 1256,
        height: 2760,
        boxes: [
          { text: "Q Jej", confidence: 0.84, x: 185, y: 619, width: 140, height: 65 },
          { text: "打卡|14/30天", confidence: 0.96, x: 289, y: 719, width: 282, height: 47 }
        ]
      },
      "Jej",
      { mode: "equals", semanticArea: "content", deviceSize: { width: 1256, height: 2760 } }
    );

    expect(candidate).toEqual(expect.objectContaining({
      text: "Q Jej",
      centerX: 255,
      centerY: 652
    }));
  });

  it("treats a separated non-Latin OCR glyph as decoration for an exact text candidate", () => {
    const candidate = findTextCandidate(
      {
        text: "心 Jej\n打卡|14/30天",
        engine: "fake-layout",
        lang: "test",
        width: 1256,
        height: 2760,
        boxes: [
          { text: "心 Jej", confidence: 0.84, x: 185, y: 619, width: 140, height: 65 },
          { text: "打卡|14/30天", confidence: 0.96, x: 289, y: 719, width: 282, height: 47 }
        ]
      },
      "Jej",
      { mode: "equals", semanticArea: "content", deviceSize: { width: 1256, height: 2760 } }
    );

    expect(candidate).toEqual(expect.objectContaining({
      text: "心 Jej",
      centerX: 255,
      centerY: 652
    }));
  });

  it("does not treat a separated multi-character OCR prefix as decoration for an exact text candidate", () => {
    const candidate = findTextCandidate(
      {
        text: "新建 Jej",
        engine: "fake-layout",
        lang: "test",
        width: 1256,
        height: 2760,
        boxes: [
          { text: "新建 Jej", confidence: 0.96, x: 185, y: 619, width: 180, height: 65 }
        ]
      },
      "Jej",
      { mode: "equals", semanticArea: "content", deviceSize: { width: 1256, height: 2760 } }
    );

    expect(candidate).toBeUndefined();
  });

  it("allows contains mode to match OCR icon noise around a text label", () => {
    const candidate = findTextCandidate(
      {
        text: "8+添加好友\n28加入班级\n加入公开课\n扫一扫",
        engine: "fake-layout",
        lang: "test",
        width: 1200,
        height: 2000,
        boxes: [
          { text: "8+添加好友", confidence: 0.98, x: 900, y: 232, width: 160, height: 44 },
          { text: "28加入班级", confidence: 0.98, x: 896, y: 300, width: 168, height: 44 },
          { text: "加入公开课", confidence: 0.98, x: 945, y: 374, width: 144, height: 44 },
          { text: "扫一扫", confidence: 0.98, x: 896, y: 440, width: 139, height: 44 }
        ]
      },
      "添加好友",
      { mode: "contains", semanticArea: "content", deviceSize: { width: 1200, height: 2000 } }
    );

    expect(candidate).toEqual(expect.objectContaining({
      text: "8+添加好友",
      centerX: 980,
      centerY: 254
    }));
  });

  it("does not treat a longer readable text label as an exact candidate", () => {
    const candidate = findTextCandidate(
      {
        text: "添加好友设置",
        engine: "fake-layout",
        lang: "test",
        width: 1200,
        height: 2000,
        boxes: [
          { text: "添加好友设置", confidence: 0.98, x: 900, y: 232, width: 220, height: 44 }
        ]
      },
      "添加好友",
      { mode: "equals" }
    );

    expect(candidate).toBeUndefined();
  });

  it("does not treat a compact selection-count suffix as an exact action label", () => {
    const candidate = findTextCandidate(
      {
        text: "选择联席教师\n海外55\n确定(1/6)",
        engine: "fake-layout",
        lang: "test",
        width: 1256,
        height: 2760,
        boxes: [
          { text: "选择联席教师", confidence: 0.99, x: 188, y: 198, width: 240, height: 60 },
          { text: "海外55", confidence: 0.99, x: 320, y: 1030, width: 160, height: 60 },
          { text: "确定(1/6)", confidence: 0.99, x: 836, y: 2528, width: 288, height: 72 }
        ]
      },
      "确定",
      { mode: "equals", deviceSize: { width: 1256, height: 2760 } }
    );

    expect(candidate).toBeUndefined();
  });

  it("allows contains mode to match a compact selection-count suffix", () => {
    const candidate = findTextCandidate(
      {
        text: "选择联席教师\n海外55\n确定(1/6)",
        engine: "fake-layout",
        lang: "test",
        width: 1256,
        height: 2760,
        boxes: [
          { text: "选择联席教师", confidence: 0.99, x: 188, y: 198, width: 240, height: 60 },
          { text: "海外55", confidence: 0.99, x: 320, y: 1030, width: 160, height: 60 },
          { text: "确定(1/6)", confidence: 0.99, x: 836, y: 2528, width: 288, height: 72 }
        ]
      },
      "确定",
      { mode: "contains", deviceSize: { width: 1256, height: 2760 } }
    );

    expect(candidate).toEqual(expect.objectContaining({
      text: "确定(1/6)",
      centerX: 980,
      centerY: 2564
    }));
  });

  it("finds text near a clicked point for recording-time locator suggestions", () => {
    const candidate = findNearestTextCandidate(layout("首页", "进入课堂"), { x: 200, y: 225 });

    expect(candidate?.text).toBe("进入课堂");
  });
});

describe("SemanticStepResolver", () => {
  it("resolves tap_on_text from UI hierarchy before OCR", async () => {
    const actions: DeviceActionRequest[] = [];
    const locateText = vi.fn(async () => {
      throw new Error("OCR should not be used when hierarchy resolves the text");
    });
    const captureLocatorScreenshot = vi.fn(async () => {
      throw new Error("screenshot should not be captured when hierarchy resolves the text");
    });
    const resolver = new SemanticStepResolver({
      ocr: {
        recognize: async () => layout("添加好友"),
        locateText
      },
      dumpUiHierarchy: async () => addFriendMenuHierarchy(),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-tree-text",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: tapOnTextStep("添加好友", 0, 0, {
        mode: "equals",
        searchMode: "visibleOnly"
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 992, y: 253 }]);
    expect(locateText).not.toHaveBeenCalled();
    expect(captureLocatorScreenshot).not.toHaveBeenCalled();
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        actual: "添加好友",
        matchStrategy: "ui_hierarchy_equals",
        tapPointSource: "ui_text_center",
        evidenceArtifactIds: []
      })
    }));
  });

  it("does not resolve a UI hierarchy action label with a compact selection-count suffix in equals mode", async () => {
    const actions: DeviceActionRequest[] = [];
    const locateText = vi.fn(async () => layout("确定(1/6)"));
    const resolver = new SemanticStepResolver({
      ocr: {
        recognize: async () => layout("确定(1/6)"),
        locateText
      },
      dumpUiHierarchy: async () => hierarchyWithText("确定(1/6)", {
        className: "harmony.widget.Button",
        bounds: "[706,2493][1178,2622]",
        clickable: true
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-decorated-confirm-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-decorated-confirm",
      serial: "device-1",
      deviceSize: { width: 1256, height: 2760 },
      step: tapOnTextStep("确定", 0, 0, {
        mode: "equals",
        searchMode: "visibleOnly",
        timeoutMs: 1,
        intervalMs: 1
      })
    });

    expect(actions).toEqual([]);
    expect(locateText).toHaveBeenCalled();
    expect(outcome).toEqual(expect.objectContaining({
      resolved: false,
      metadata: expect.objectContaining({
        reason: "target_not_found"
      })
    }));
  });

  it("resolves a UI hierarchy action label with a compact selection-count suffix in contains mode", async () => {
    const actions: DeviceActionRequest[] = [];
    const locateText = vi.fn(async () => {
      throw new Error("OCR should not be used when hierarchy resolves the decorated action text in contains mode");
    });
    const resolver = new SemanticStepResolver({
      ocr: {
        recognize: async () => layout("确定(1/6)"),
        locateText
      },
      dumpUiHierarchy: async () => hierarchyWithText("确定(1/6)", {
        className: "harmony.widget.Button",
        bounds: "[706,2493][1178,2622]",
        clickable: true
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async () => {
        throw new Error("screenshot should not be captured when hierarchy resolves the decorated action text in contains mode");
      }
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-decorated-confirm-contains",
      serial: "device-1",
      deviceSize: { width: 1256, height: 2760 },
      step: tapOnTextStep("确定", 0, 0, {
        mode: "contains",
        searchMode: "visibleOnly"
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 942, y: 2558 }]);
    expect(locateText).not.toHaveBeenCalled();
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        actual: "确定(1/6)",
        matchStrategy: "ui_hierarchy_contains"
      })
    }));
  });

  it("resolves a Harmony clickable card when the exact target is one label line", async () => {
    const actions: DeviceActionRequest[] = [];
    const locateText = vi.fn(async () => {
      throw new Error("OCR should not be used when hierarchy exposes the card label line");
    });
    const resolver = new SemanticStepResolver({
      ocr: {
        recognize: async () => layout("Jej"),
        locateText
      },
      dumpUiHierarchy: async () => hierarchyWithText(
        "Jej\n打卡｜14/30天\n8月27日 周四 23:59 截止\n嚯嚯嚯666\n｜ 今日已提交 1/7\n已打卡",
        {
          className: "harmony.widget.Image",
          bounds: "[0,1207][1256,1654]",
          clickable: true
        }
      ),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async () => {
        throw new Error("screenshot should not be captured when hierarchy resolves the card label line");
      }
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-harmony-card-label",
      serial: "device-1",
      deviceSize: { width: 1256, height: 2760 },
      step: tapOnTextStep("Jej", 0, 0, {
        mode: "equals",
        searchMode: "visibleOnly"
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 628, y: 1431 }]);
    expect(locateText).not.toHaveBeenCalled();
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        actual: "Jej\n打卡｜14/30天\n8月27日 周四 23:59 截止\n嚯嚯嚯666\n｜ 今日已提交 1/7\n已打卡",
        matchStrategy: "ui_hierarchy_equals",
        tapPointSource: "ui_text_center"
      })
    }));
  });

  it("taps the visible text center for text exposed inside a large Compose clickable container", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: {
        recognize: async () => layout("修改"),
        locateText: vi.fn(async () => {
          throw new Error("OCR should not be used for exposed Compose text");
        })
      },
      dumpUiHierarchy: async () => composeLessonInfoHierarchy(),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async () => {
        throw new Error("screenshot should not be captured for exposed Compose text");
      }
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-compose-text",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: tapOnTextStep("修改", 0, 0, {
        mode: "equals",
        searchMode: "visibleOnly"
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 1076, y: 701 }]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        actual: "修改",
        tapPointSource: "ui_text_center",
        uiActionableCandidate: expect.objectContaining({
          selector: "id=cn.eeo.classin:id/lesson_info"
        })
      })
    }));
  });

  it("filters hierarchy text candidates that are hidden behind the current visual layer", async () => {
    const actions: DeviceActionRequest[] = [];
    const locateText = vi.fn(async () => ({
      text: "课堂\n多模式实时师生互动授课，AI赋能课堂分析与智能章节总结",
      engine: "fake-layout",
      lang: "test",
      width: 1080,
      height: 2340,
      boxes: [
        { text: "课堂", confidence: 0.99, x: 105, y: 554, width: 91, height: 49 },
        { text: "多模式实时师生互动授课，AI赋能课堂分析与智能章节总结", confidence: 0.98, x: 108, y: 614, width: 842, height: 38 }
      ]
    }));
    const resolver = new SemanticStepResolver({
      ocr: {
        recognize: async () => layout("课堂"),
        locateText
      },
      dumpUiHierarchy: async () => publishActivityOverlayHierarchy(),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-visible-layer-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-visible-layer",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2340 },
      step: tapOnTextStep("课堂", 0, 0, {
        mode: "equals",
        searchMode: "visibleOnly"
      })
    });

    expect(locateText).toHaveBeenCalledTimes(1);
    expect(actions).toEqual([{ type: "tap", x: 150, y: 580 }]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        actual: "课堂",
        matchStrategy: "ui_hierarchy_equals",
        visibilityFilteredCandidateCount: 1
      })
    }));
  });

  it("falls back to OCR when UI hierarchy does not expose the text", async () => {
    const actions: DeviceActionRequest[] = [];
    const locateText = vi.fn(async () => layout("进入课堂"));
    const captureLocatorScreenshot = vi.fn(async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-fallback-${attempt}`));
    const resolver = new SemanticStepResolver({
      ocr: {
        recognize: async () => layout("进入课堂"),
        locateText
      },
      dumpUiHierarchy: async () => emptyHierarchy(),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-tree-miss",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: tapOnTextStep("进入课堂", 0, 0, {
        mode: "equals",
        searchMode: "visibleOnly"
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 730, y: 1615 }]);
    expect(locateText).toHaveBeenCalledTimes(1);
    expect(captureLocatorScreenshot).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        matchStrategy: "equals",
        tapPointSource: "ocr_text_center",
        evidenceArtifactIds: ["artifact-fallback-1"]
      })
    }));
  });

  it("scrolls with UI hierarchy snapshots before using OCR", async () => {
    const actions: DeviceActionRequest[] = [];
    const hierarchies = [emptyHierarchy(), addFriendMenuHierarchy()];
    const locateText = vi.fn(async () => {
      throw new Error("OCR should not be used when scrolling hierarchy finds the text");
    });
    const captureLocatorScreenshot = vi.fn(async () => {
      throw new Error("screenshot should not be captured when hierarchy scrolling finds the text");
    });
    const resolver = new SemanticStepResolver({
      ocr: {
        recognize: async () => layout("添加好友"),
        locateText
      },
      dumpUiHierarchy: async () => hierarchies.shift() ?? addFriendMenuHierarchy(),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-tree-scroll",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: tapOnTextStep("添加好友", 0, 0, {
        mode: "equals",
        searchMode: "scroll",
        searchDirection: "down",
        resetToTop: false,
        maxSwipes: 2,
        intervalMs: 0
      })
    });

    expect(actions).toEqual([
      { type: "swipe", startX: 600, startY: 1500, endX: 600, endY: 500, durationMs: 450 },
      { type: "tap", x: 992, y: 253 }
    ]);
    expect(locateText).not.toHaveBeenCalled();
    expect(captureLocatorScreenshot).not.toHaveBeenCalled();
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        matchStrategy: "ui_hierarchy_equals",
        search: expect.objectContaining({
          scanSwipes: 1
        })
      })
    }));
  });

  it("resolves a decorated OCR label only when the script asks for contains mode", async () => {
    const actions: DeviceActionRequest[] = [];
    const dumpUiHierarchy = vi.fn(async () => decoratedAddFriendMenuHierarchy());
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "8+添加好友",
        engine: "fake-layout",
        lang: "test",
        width: 1200,
        height: 2000,
        boxes: [
          { text: "8+添加好友", confidence: 0.98, x: 900, y: 232, width: 184, height: 44 }
        ]
      }),
      dumpUiHierarchy,
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-decorated-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-reuse-hierarchy",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: tapOnTextStep("添加好友", 0, 0, {
        mode: "contains",
        searchMode: "visibleOnly"
      })
    });

    expect(dumpUiHierarchy).toHaveBeenCalledTimes(1);
    expect(actions).toEqual([{ type: "tap", x: 992, y: 253 }]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        matchStrategy: "ui_hierarchy_contains"
      })
    }));
  });

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

  it("taps the clickable container for a text target inside a card", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "班级四十二号",
        engine: "fake-layout",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          { text: "班级四十二号", confidence: 0.99, x: 601, y: 1386, width: 232, height: 40 }
        ]
      }),
      dumpUiHierarchy: async () => cardTextHierarchy(),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-card-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-card",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: tapOnTextStep("班级四十二号", 0, 0, {
        searchMode: "auto",
        searchDirection: "down"
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 750, y: 1490 }]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        tapPointSource: "ui_clickable_ancestor",
        uiCandidate: expect.objectContaining({
          selector: "id=cn.eeo.classin:id/class_card"
        })
      })
    }));
  });

  it("scrolls past ambiguous contains matches to find an exact text target", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "汇聚\n霍昌峰2号的在线课堂\n哭哭啼啼\n霍昌峰2号的在线课堂\n拖拖拉拉\n霍昌峰2号的在线课堂",
          engine: "fake-layout",
          lang: "test",
          width: 1200,
          height: 2000,
          boxes: [
            { text: "霍昌峰2号的在线课堂", confidence: 0.98, x: 468, y: 581, width: 240, height: 32 },
            { text: "霍昌峰2号的在线课堂", confidence: 0.98, x: 850, y: 581, width: 240, height: 32 },
            { text: "霍昌峰2号的在线课堂", confidence: 0.98, x: 84, y: 981, width: 240, height: 32 }
          ]
        },
        {
          text: "2号\n霍昌峰2号的在线课堂",
          engine: "fake-layout",
          lang: "test",
          width: 1200,
          height: 2000,
          boxes: [
            { text: "2号", confidence: 0.99, x: 84, y: 681, width: 50, height: 36 },
            { text: "霍昌峰2号的在线课堂", confidence: 0.98, x: 84, y: 731, width: 240, height: 32 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-short-text",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: tapOnTextStep("2号", 0, 0, {
        mode: "contains",
        searchMode: "auto",
        searchDirection: "down",
        resetToTop: false,
        maxSwipes: 2,
        intervalMs: 0
      })
    });

    expect(actions).toEqual([
      expect.objectContaining({ type: "swipe" }),
      { type: "tap", x: 109, y: 699 }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        actual: "2号",
        matchStrategy: "equals",
        search: expect.objectContaining({
          scanSwipes: 1
        })
      })
    }));
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

  it("does not issue another device action after the run is stopped", async () => {
    const actions: DeviceActionRequest[] = [];
    const controller = new AbortController();
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        layout("页面中部"),
        layout("页面顶部"),
        layout("页面顶部")
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        controller.abort();
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-stop-${attempt}`)
    });
    const input = {
      runId: "run-1",
      stepResultId: "step-result-stop",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: tapOnTextStep("不存在的目标", 0, 0, {
        searchMode: "auto",
        searchDirection: "down",
        resetToTop: true,
        maxSwipes: 4,
        intervalMs: 1
      }),
      signal: controller.signal
    };

    await expect(resolver.resolveIfNeeded(input)).rejects.toMatchObject({ name: "RunnerStoppedError" });
    expect(actions).toHaveLength(1);
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

  it("does not guess when identical visible text targets are ambiguous", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "公告 公告",
        engine: "fake-layout",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          { text: "公告", confidence: 0.99, x: 120, y: 500, width: 100, height: 50 },
          { text: "公告", confidence: 0.98, x: 760, y: 1500, width: 100, height: 50 }
        ]
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-ambiguous-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-ambiguous",
      serial: "device-1",
      deviceSize: { width: 1080, height: 2400 },
      step: tapOnTextStep("公告", 0, 0, {
        searchMode: "visibleOnly",
        timeoutMs: 1,
        intervalMs: 1
      })
    });

    expect(actions).toEqual([]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: false,
      metadata: expect.objectContaining({ reason: "ambiguous_target" })
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

  it("prefers the avatar near the recorded candidate over a lower leading round component", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(topBarLayout()),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: topBarAvatarComponentsScreenshot(1200, 2000, [
          { centerX: 105, centerY: 200, radius: 38 },
          { centerX: 81, centerY: 327, radius: 28 }
        ])
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-avatar-with-distractor",
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
            { role: "avatar", label: "头像", score: 0.93, semanticArea: "top", region: { x: 6.8, y: 8.1, width: 4, height: 3.8 } }
          ]
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 105, y: 200 }]);
    expect(actions).not.toContainEqual({ type: "tap", x: 81, y: 327 });
    expect(outcome?.metadata).toEqual(expect.objectContaining({ relocatedBy: "top_bar_current_visual" }));
  });

  it("does not treat OCR text strokes as a leading avatar candidate", async () => {
    const actions: DeviceActionRequest[] = [];
    const layoutWithTabText = topBarLayout();
    layoutWithTabText.text = "主页\n全部班级";
    layoutWithTabText.boxes = [
      { text: "主页", confidence: 0.99, x: 145, y: 170, width: 100, height: 54 },
      { text: "全部班级", confidence: 0.98, x: 42, y: 278, width: 150, height: 100 }
    ];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layoutWithTabText),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: topBarAvatarWithTextStrokeDistractorScreenshot(1200, 2000)
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-avatar-text-distractor",
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
            { role: "avatar", label: "头像", score: 0.93, semanticArea: "top", region: { x: 5, y: 7, width: 4, height: 4 } }
          ]
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 84, y: 250 }]);
    expect(outcome?.metadata).toEqual(
      expect.objectContaining({
        relocatedBy: "top_bar_current_visual",
        currentVisual: expect.objectContaining({
          strategy: "avatar_container",
          ocrTextExcludedComponentCount: 1
        })
      })
    );
  });

  it("uses the top title as a structural fallback for a pale leading avatar", async () => {
    const actions: DeviceActionRequest[] = [];
    const layoutWithTabText = topBarLayout();
    layoutWithTabText.text = "主页\n全部班级";
    layoutWithTabText.boxes = [
      { text: "主页", confidence: 0.99, x: 145, y: 170, width: 100, height: 54 },
      { text: "全部班级", confidence: 0.98, x: 42, y: 278, width: 150, height: 100 }
    ];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layoutWithTabText),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: topBarPaleAvatarWithTextStrokeDistractorScreenshot(1200, 2000)
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-avatar-pale",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "top-bar-icon:avatar",
        locatorKind: "top_bar_icon_locator",
        role: "avatar",
        slot: "leading",
        semanticArea: "top",
        visualLocator: {
          candidates: [
            { role: "avatar", label: "头像", score: 0.93, semanticArea: "top", region: { x: 5, y: 7, width: 4, height: 4 } }
          ]
        }
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 91, y: 197 }]);
    expect(outcome?.metadata).toEqual(
      expect.objectContaining({
        relocatedBy: "top_bar_current_visual",
        currentVisual: expect.objectContaining({
          reason: "current_visual_icon_selected_by_title_relation",
          fallbackStrategy: "top_title_leading_avatar"
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

  it("resolves light back and share icons on a dark top bar by their visual roles", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("班级详情")),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: topBarIconScreenshot(1200, 2000, [
          { role: "back", centerX: 64, centerY: 182 },
          { role: "share", centerX: 1122, centerY: 182 }
        ], { background: 62, foreground: 245 })
      })
    });

    const backOutcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-back",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "semantic_icon_locator",
        role: "back",
        slot: "leading",
        semanticArea: "top",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      })
    });

    const shareOutcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-share",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "semantic_icon_locator",
        role: "share",
        slot: "trailing",
        semanticArea: "top",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 65, y: 183 },
      { type: "tap", x: 1123, y: 183 }
    ]);
    expect(backOutcome?.metadata).toEqual(expect.objectContaining({
      role: "back",
      relocatedBy: "top_bar_current_visual",
      currentVisual: expect.objectContaining({ polarity: "light" })
    }));
    expect(shareOutcome?.metadata).toEqual(expect.objectContaining({
      role: "share",
      relocatedBy: "top_bar_current_visual",
      currentVisual: expect.objectContaining({ polarity: "light" })
    }));
  });

  it("selects trailing icons by role when their visual order changes", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(topBarLayout()),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-${attempt}`),
        png: topBarIconScreenshot(1200, 2000, [
          { role: "add", centerX: 985, centerY: 210 },
          { role: "search", centerX: 1064, centerY: 214 }
        ])
      })
    });

    for (const role of ["add", "search"] as const) {
      await resolver.resolveIfNeeded({
        runId: "run-1",
        stepResultId: `step-result-${role}`,
        serial: "device-1",
        deviceSize: { width: 1200, height: 2000 },
        step: semanticStep("tap_on_image", {
          locatorKind: "semantic_icon_locator",
          role,
          slot: "trailing",
          semanticArea: "top",
          searchMode: "visibleOnly",
          allowRegionFallback: false
        })
      });
    }

    expect(actions).toEqual([
      { type: "tap", x: 986, y: 211 },
      { type: "tap", x: 1066, y: 216 }
    ]);
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

  it("resolves a semantic content add icon from UI hierarchy before screenshot visuals", async () => {
    const actions: DeviceActionRequest[] = [];
    const captureLocatorScreenshot = vi.fn(async () => {
      throw new Error("screenshot should not be captured when hierarchy exposes the add icon");
    });
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("班级详情")),
      dumpUiHierarchy: async () => androidContentAddButtonHierarchy(),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-content-add-tree",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "semantic_icon_locator",
        role: "add",
        slot: "trailing",
        semanticArea: "content",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 875, y: 1600 }]);
    expect(captureLocatorScreenshot).not.toHaveBeenCalled();
    expect(outcome?.metadata).toEqual(expect.objectContaining({
      role: "add",
      semanticArea: "content",
      relocatedBy: "ui_hierarchy_icon",
      hierarchy: expect.objectContaining({
        matchReason: "semantic_accessibility"
      })
    }));
  });

  it("keeps a visually strong floating add icon when OCR recognizes the plus sign as text", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "+",
        engine: "fake-layout",
        lang: "test",
        width: 1000,
        height: 2000,
        boxes: [
          { text: "+", confidence: 0.99, x: 850, y: 1575, width: 50, height: 50 }
        ]
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-floating-add-ocr-${attempt}`),
        png: floatingAddIconScreenshot(1000, 2000, { centerX: 875, centerY: 1600, radius: 70 })
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-floating-add-ocr-overlap",
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
      currentVisual: expect.objectContaining({
        ocrTextOverlappingComponentCount: 1,
        componentCount: 1
      })
    }));
  });

  it("resolves a report or clipboard visual icon query from UI hierarchy semantics", async () => {
    const actions: DeviceActionRequest[] = [];
    const captureLocatorScreenshot = vi.fn(async () => {
      throw new Error("screenshot should not be captured when hierarchy exposes the report icon");
    });
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("主课程")),
      dumpUiHierarchy: async () => androidContentReportButtonHierarchy(),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-report-tree",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "visual_query_locator",
        visualKind: "icon",
        visualQuery: "右下角剪贴板图标",
        semanticArea: "content",
        slot: "trailing",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 875, y: 1410 }]);
    expect(captureLocatorScreenshot).not.toHaveBeenCalled();
    expect(outcome?.metadata).toEqual(expect.objectContaining({
      type: "visual_query_locator",
      visualKind: "icon",
      visualQuery: "右下角剪贴板图标",
      role: "report",
      relocatedBy: "ui_hierarchy_icon"
    }));
  });

  it("visually resolves a report or clipboard content icon when hierarchy is generic", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("主课程")),
      dumpUiHierarchy: async () => harmonyGenericContentReportButtonHierarchy(),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-report-visual-${attempt}`),
        png: contentReportIconScreenshot(1000, 2000, { centerX: 875, centerY: 1410 })
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-report-visual",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "visual_query_locator",
        visualKind: "icon",
        visualQuery: "右下角剪贴板图标",
        semanticArea: "content",
        slot: "trailing",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 876, y: 1411 }]);
    expect(outcome?.metadata).toEqual(expect.objectContaining({
      type: "visual_query_locator",
      role: "report",
      relocatedBy: "visible_icon_current_visual",
      currentVisual: expect.objectContaining({
        roleScore: expect.any(Number),
        competingRole: expect.any(String)
      })
    }));
  });

  it("searches the visible screen for a bare semantic icon instead of defaulting to the top bar", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("课节")),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-visible-search-${attempt}`),
        png: semanticIconScreenshot(1200, 2000, [
          { role: "chevron", centerX: 876, centerY: 358 },
          { role: "search", centerX: 955, centerY: 843 }
        ])
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-visible-search",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "semantic_icon_locator",
        role: "search",
        semanticArea: "unknown",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 957, y: 845 }]);
    expect(outcome?.metadata).toEqual(expect.objectContaining({
      role: "search",
      semanticArea: "unknown",
      relocatedBy: "visible_icon_current_visual",
      currentVisual: expect.objectContaining({
        phase: "global",
        strategy: "semantic_icon_shape"
      })
    }));
  });

  it("resolves visual icon queries through current standard icon recognition", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("课节")),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-visual-search-${attempt}`),
        png: semanticIconScreenshot(1200, 2000, [
          { role: "chevron", centerX: 876, centerY: 358 },
          { role: "search", centerX: 955, centerY: 843 }
        ])
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-visual-search",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "visual_query_locator",
        visualKind: "icon",
        visualQuery: "搜索图标",
        semanticArea: "unknown",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 957, y: 845 }]);
    expect(outcome?.metadata).toEqual(expect.objectContaining({
      type: "visual_query_locator",
      action: "tap",
      visualKind: "icon",
      visualQuery: "搜索图标",
      role: "search",
      relocatedBy: "visible_icon_current_visual"
    }));
  });

  it("fails unsupported visual queries instead of falling back to OCR text or region center", async () => {
    const actions: DeviceActionRequest[] = [];
    let screenshots = 0;
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("封面")),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => {
        screenshots += 1;
        return {
          ...screenshot(`artifact-visual-image-${attempt}`),
          png: semanticIconScreenshot(1200, 2000, [])
        };
      }
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-visual-image",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "visual_query_locator",
        visualKind: "image",
        visualQuery: "封面图片",
        semanticArea: "content",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      })
    });

    expect(actions).toEqual([]);
    expect(screenshots).toBe(0);
    expect(outcome).toEqual(expect.objectContaining({
      supported: true,
      resolved: false,
      metadata: expect.objectContaining({
        type: "visual_query_locator",
        action: "fail",
        reason: "visual_grounding_unavailable",
        visualKind: "image",
        visualQuery: "封面图片"
      })
    }));
  });

  it("uses the requested content area before global icon fallback", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("课节")),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-content-search-${attempt}`),
        png: semanticIconScreenshot(1200, 2000, [
          { role: "search", centerX: 1030, centerY: 210 },
          { role: "search", centerX: 955, centerY: 843 }
        ])
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-content-search",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "semantic_icon_locator",
        role: "search",
        semanticArea: "content",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 957, y: 845 }]);
    expect(outcome?.metadata).toEqual(expect.objectContaining({
      semanticArea: "content",
      relocatedBy: "visible_icon_current_visual",
      currentVisual: expect.objectContaining({ phase: "primary" })
    }));
  });

  it("falls back globally when a requested icon area has no matching role", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("课节")),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-content-miss-${attempt}`),
        png: semanticIconScreenshot(1200, 2000, [
          { role: "search", centerX: 1030, centerY: 210 },
          { role: "chevron", centerX: 955, centerY: 843 }
        ])
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-content-miss",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "semantic_icon_locator",
        role: "search",
        semanticArea: "content",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 1032, y: 212 }]);
    expect(outcome?.metadata).toEqual(expect.objectContaining({
      semanticArea: "content",
      relocatedBy: "visible_icon_current_visual",
      currentVisual: expect.objectContaining({ phase: "fallback_global" })
    }));
  });

  it("does not treat a top chevron as search before falling back globally", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(topBarLayout()),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-top-fallback-search-${attempt}`),
        png: semanticIconScreenshot(1200, 2000, [
          { role: "chevron", centerX: 1030, centerY: 210 },
          { role: "search", centerX: 955, centerY: 843 }
        ])
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-top-fallback-search",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "semantic_icon_locator",
        role: "search",
        semanticArea: "top",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      })
    });

    expect(actions).toEqual([{ type: "tap", x: 957, y: 845 }]);
    expect(outcome?.metadata).toEqual(expect.objectContaining({
      semanticArea: "top",
      relocatedBy: "visible_icon_current_visual",
      currentVisual: expect.objectContaining({ phase: "fallback_global" })
    }));
  });

  it("does not tap when a visible icon target is ambiguous", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("课节")),
      performAction: async (_serial, action) => {
        actions.push(action);
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        ...screenshot(`artifact-ambiguous-search-${attempt}`),
        png: semanticIconScreenshot(1200, 2000, [
          { role: "search", centerX: 1030, centerY: 210 },
          { role: "search", centerX: 955, centerY: 843 }
        ])
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-ambiguous-search",
      serial: "device-1",
      deviceSize: { width: 1200, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "semantic_icon_locator",
        role: "search",
        semanticArea: "unknown",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      })
    });

    expect(actions).toEqual([]);
    expect(outcome).toEqual(expect.objectContaining({
      supported: true,
      resolved: false,
      message: "当前屏幕找到 2 个搜索图标，无法判断要点击哪一个；请补充位置（例如右上角、底部、或某段文字附近）后重试。",
      metadata: expect.objectContaining({
        reason: "ambiguous_icon_candidates",
        role: "search",
        semanticArea: "unknown"
      })
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

  it("falls back from a learned text locator to the original semantic query without coordinates", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService(layout("教学方案")),
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
      step: tapOnTextStep("旧版教学入口", 540, 1200, {
        fallbackSemanticQuery: "进入教学方案的入口",
        allowRegionFallback: false
      })
    });

    expect(actions).toHaveLength(1);
    expect(outcome).toEqual(expect.objectContaining({
      supported: true,
      resolved: true,
      metadata: expect.objectContaining({
        actual: "教学方案",
        matchStrategy: "semantic_fallback"
      })
    }));
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

  it("does not hide the soft keyboard implicitly after low-level input text", async () => {
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
          driverChannel: "hdc_input"
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
        focusDelayMs: 0,
        hideKeyboardSettleMs: 0,
        inputVerificationDelayMs: 0,
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
          inputVerified: true,
          verificationRegionSource: "runtime_focus_candidate"
        })
      })
    );
  });

  it("resolves the login account field from scoped text field ordinal rows", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "ClassIn\n+86\n12133333300\n请输入密码\n登录\n忘记密码\n验证码登录\nHUAWEI\n华为账号登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86", confidence: 0.98, x: 90, y: 560, width: 70, height: 42 },
            { text: "12133333300", confidence: 0.98, x: 245, y: 560, width: 260, height: 42 },
            { text: "请输入密码", confidence: 0.99, x: 100, y: 715, width: 180, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 },
            { text: "忘记密码", confidence: 0.99, x: 70, y: 1160, width: 170, height: 44 },
            { text: "验证码登录", confidence: 0.99, x: 760, y: 1160, width: 180, height: 44 },
            { text: "HUAWEI", confidence: 0.99, x: 130, y: 1410, width: 90, height: 28 },
            { text: "华为账号登录", confidence: 0.99, x: 430, y: 1410, width: 220, height: 44 }
          ]
        },
        {
          text: "ClassIn\n+86\n18743085313\n请输入密码\n登录\n忘记密码\n验证码登录\nHUAWEI\n华为账号登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86", confidence: 0.98, x: 90, y: 560, width: 70, height: 42 },
            { text: "18743085313", confidence: 0.98, x: 245, y: 560, width: 260, height: 42 },
            { text: "请输入密码", confidence: 0.99, x: 100, y: 715, width: 180, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 },
            { text: "忘记密码", confidence: 0.99, x: 70, y: 1160, width: 170, height: 44 },
            { text: "验证码登录", confidence: 0.99, x: 760, y: 1160, width: 180, height: 44 },
            { text: "HUAWEI", confidence: 0.99, x: 130, y: 1410, width: 90, height: 28 },
            { text: "华为账号登录", confidence: 0.99, x: 430, y: 1410, width: 220, height: 44 }
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
        focusDelayMs: 0,
        inputVerificationDelayMs: 0,
        locatorKind: "structural_locator",
        semanticArea: "content",
        structuralLocator: {
          strategy: "scoped_text_field",
          scopeText: "ClassIn",
          ordinal: 1,
          role: "text_input"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 375, y: 581 },
      { type: "clear_text" },
      { type: "input_text", text: "18743085313" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          focusResolvedBy: "scoped_text_field",
          focusLocator: expect.objectContaining({
            text: "12133333300"
          }),
          inputVerified: true
        })
      })
    );
  });

  it("verifies a scoped account field when OCR keeps the country code in the same target text box", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "ClassIn\n+86 18743085313\n请输入密码\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86 18743085313", confidence: 0.98, x: 90, y: 560, width: 415, height: 42 },
            { text: "请输入密码", confidence: 0.99, x: 100, y: 715, width: 180, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 }
          ]
        },
        {
          text: "ClassIn\n+86 12133333300\n请输入密码\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86 12133333300", confidence: 0.98, x: 90, y: 560, width: 415, height: 42 },
            { text: "请输入密码", confidence: 0.99, x: 100, y: 715, width: 180, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 }
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
        text: "12133333300",
        clearFirst: true,
        focusDelayMs: 0,
        inputVerificationDelayMs: 0,
        locatorKind: "structural_locator",
        semanticArea: "content",
        structuralLocator: {
          strategy: "scoped_text_field",
          scopeText: "ClassIn",
          ordinal: 1,
          role: "text_input"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 298, y: 581 },
      { type: "clear_text" },
      { type: "input_text", text: "12133333300" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          focusResolvedBy: "scoped_text_field",
          inputVerified: true,
          verificationStrategy: "input_identity_target_region",
          verifiedBy: "+86 12133333300"
        })
      })
    );
  });

  it("resolves the login password field from scoped text field ordinal rows", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "ClassIn\n+86\n12133333300\n请输入密码\n登录\n忘记密码\n验证码登录\nHUAWEI\n华为账号登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86", confidence: 0.98, x: 90, y: 560, width: 70, height: 42 },
            { text: "12133333300", confidence: 0.98, x: 245, y: 560, width: 260, height: 42 },
            { text: "请输入密码", confidence: 0.99, x: 100, y: 715, width: 180, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 },
            { text: "忘记密码", confidence: 0.99, x: 70, y: 1160, width: 170, height: 44 },
            { text: "验证码登录", confidence: 0.99, x: 760, y: 1160, width: 180, height: 44 },
            { text: "HUAWEI", confidence: 0.99, x: 130, y: 1410, width: 90, height: 28 },
            { text: "华为账号登录", confidence: 0.99, x: 430, y: 1410, width: 220, height: 44 }
          ]
        },
        {
          text: "ClassIn\n+86\n12133333300\n123qwe\n登录\n忘记密码\n验证码登录\nHUAWEI\n华为账号登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86", confidence: 0.98, x: 90, y: 560, width: 70, height: 42 },
            { text: "12133333300", confidence: 0.98, x: 245, y: 560, width: 260, height: 42 },
            { text: "123qwe", confidence: 0.99, x: 100, y: 715, width: 150, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 },
            { text: "忘记密码", confidence: 0.99, x: 70, y: 1160, width: 170, height: 44 },
            { text: "验证码登录", confidence: 0.99, x: 760, y: 1160, width: 180, height: 44 },
            { text: "HUAWEI", confidence: 0.99, x: 130, y: 1410, width: 90, height: 28 },
            { text: "华为账号登录", confidence: 0.99, x: 430, y: 1410, width: 220, height: 44 }
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
        focusDelayMs: 0,
        inputVerificationDelayMs: 0,
        locatorKind: "structural_locator",
        semanticArea: "content",
        structuralLocator: {
          strategy: "scoped_text_field",
          scopeText: "ClassIn",
          ordinal: 2,
          role: "text_input"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 190, y: 736 },
      { type: "clear_text" },
      { type: "input_text", text: "123qwe" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          focusResolvedBy: "scoped_text_field",
          focusLocator: expect.objectContaining({
            text: "请输入密码"
          }),
          inputVerified: true
        })
      })
    );
  });

  it("does not infer a password field from valueParamKey when the scripted target text disappeared", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "ClassIn\n+86\n12133333300\neeo123\n登录\n忘记密码\n验证码登录\nHUAWEI\n华为账号登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86", confidence: 0.98, x: 90, y: 560, width: 70, height: 42 },
            { text: "12133333300", confidence: 0.98, x: 245, y: 560, width: 260, height: 42 },
            { text: "eeo123", confidence: 0.99, x: 100, y: 715, width: 150, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 },
            { text: "忘记密码", confidence: 0.99, x: 70, y: 1160, width: 170, height: 44 },
            { text: "验证码登录", confidence: 0.99, x: 760, y: 1160, width: 180, height: 44 },
            { text: "HUAWEI", confidence: 0.99, x: 130, y: 1410, width: 90, height: 28 },
            { text: "华为账号登录", confidence: 0.99, x: 430, y: 1410, width: 220, height: 44 }
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
        focusDelayMs: 0,
        inputVerificationDelayMs: 0,
        locator: "runtime-locator:password_input",
        locatorKind: "structural_locator",
        targetText: "请输入密码",
        valueParamKey: "password",
        semanticArea: "content",
        coordinateSpace: "runtime",
        structuralLocator: {
          strategy: "ocr_or_edittext",
          role: "password_input",
          preferredPlaceholderText: "请输入密码",
          fallbackPolicy: "no_region_center_fallback"
        }
      })
    });

    expect(actions).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: false,
        metadata: expect.objectContaining({
          reason: "runtime_relocation_required",
          focusResolvedBy: "region_center_disabled"
        })
      })
    );
  });

  it("does not infer an account field from valueParamKey when the scripted target text disappeared", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "+86 12133333300",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "+86", confidence: 0.98, x: 80, y: 395, width: 60, height: 30 },
            { text: "12133333300", confidence: 0.98, x: 245, y: 395, width: 210, height: 30 }
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

    expect(actions).toEqual([]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: false,
        metadata: expect.objectContaining({
          reason: "runtime_relocation_required",
          focusResolvedBy: "region_center_disabled"
        })
      })
    );
  });

  it("fails scoped text field verification when clear text leaves an appended old value", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "ClassIn\n+86\n12133333300\n请输入密码",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86", confidence: 0.98, x: 90, y: 560, width: 70, height: 42 },
            { text: "12133333300", confidence: 0.98, x: 245, y: 560, width: 260, height: 42 },
            { text: "请输入密码", confidence: 0.99, x: 100, y: 715, width: 180, height: 42 }
          ]
        },
        {
          text: "ClassIn\n+86\n1213333330018743085313\n请输入密码",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86", confidence: 0.98, x: 90, y: 560, width: 70, height: 42 },
            { text: "1213333330018743085313", confidence: 0.98, x: 245, y: 560, width: 390, height: 42 },
            { text: "请输入密码", confidence: 0.99, x: 100, y: 715, width: 180, height: 42 }
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
        focusDelayMs: 0,
        inputVerificationDelayMs: 0,
        locatorKind: "structural_locator",
        semanticArea: "content",
        structuralLocator: {
          strategy: "scoped_text_field",
          scopeText: "ClassIn",
          ordinal: 1,
          role: "text_input"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 375, y: 581 },
      { type: "clear_text" },
      { type: "input_text", text: "18743085313" }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      supported: true,
      resolved: false,
      message: 'Input text "18743085313" was not verified by OCR after typing.',
      metadata: expect.objectContaining({
        reason: "input_text_not_verified",
        actual: expect.stringContaining("1213333330018743085313")
      })
    }));
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

  it("resolves a dynamic input value from the nearest text to the right of a stable OCR anchor", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "课堂名称 班级四十二号 开始时间 当前时间",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "课堂名称", confidence: 0.99, x: 90, y: 330, width: 160, height: 52 },
            { text: "班级四十二号", confidence: 0.98, x: 310, y: 330, width: 260, height: 52 },
            { text: "开始时间", confidence: 0.99, x: 90, y: 510, width: 160, height: 52 },
            { text: "当前时间", confidence: 0.99, x: 680, y: 510, width: 160, height: 52 }
          ]
        },
        {
          text: "课堂名称 自动化课堂 开始时间 当前时间",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "课堂名称", confidence: 0.99, x: 90, y: 330, width: 160, height: 52 },
            { text: "自动化课堂", confidence: 0.99, x: 310, y: 330, width: 240, height: 52 },
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
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-right-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-relative-right",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("input_text_to_element", {
        text: "自动化课堂",
        clearFirst: true,
        focusDelayMs: 1,
        inputVerificationDelayMs: 1,
        locatorKind: "structural_locator",
        semanticArea: "content",
        structuralLocator: {
          strategy: "ocr_relative_input",
          anchorText: "课堂名称",
          relation: "nearest_text_right",
          role: "text_input",
          fallbackPolicy: "no_region_center_fallback"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 440, y: 356 },
      { type: "clear_text" },
      { type: "input_text", text: "自动化课堂" }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      supported: true,
      resolved: true,
      metadata: expect.objectContaining({
        focusResolvedBy: "ocr_relative_structure",
        inputVerified: true
      })
    }));
  });

  it("resolves a scoped text field by ordinal without relying on a dynamic current value as a label", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "新建课堂 课堂信息 小王 教师 修改 课堂时长 30分钟",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "新建课堂", confidence: 0.99, x: 145, y: 150, width: 180, height: 50 },
            { text: "课堂信息", confidence: 0.99, x: 90, y: 300, width: 160, height: 52 },
            { text: "小王", confidence: 0.92, x: 90, y: 380, width: 90, height: 52 },
            { text: "教师", confidence: 0.92, x: 260, y: 380, width: 90, height: 52 },
            { text: "修改", confidence: 0.98, x: 820, y: 380, width: 90, height: 52 },
            { text: "课堂时长", confidence: 0.99, x: 90, y: 560, width: 160, height: 52 },
            { text: "30分钟", confidence: 0.99, x: 720, y: 560, width: 120, height: 52 }
          ]
        },
        {
          text: "新建课堂 课堂信息 自动化课堂 教师 修改 课堂时长 30分钟",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "自动化课堂", confidence: 0.99, x: 90, y: 380, width: 240, height: 52 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-scoped-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-scoped-field",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("input_text_to_element", {
        text: "自动化课堂",
        clearFirst: true,
        focusDelayMs: 1,
        inputVerificationDelayMs: 1,
        locatorKind: "structural_locator",
        semanticArea: "content",
        structuralLocator: {
          strategy: "scoped_text_field",
          scopeText: "课堂信息",
          ordinal: 1,
          role: "text_input"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 135, y: 406 },
      { type: "clear_text" },
      { type: "input_text", text: "自动化课堂" }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      supported: true,
      resolved: true,
      metadata: expect.objectContaining({
        resolvedBy: "runtime_structural_locator",
        focusResolvedBy: "scoped_text_field",
        inputVerified: true
      })
    }));
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

  it("searches from the current viewport, resets, and scans down for an offscreen input", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        layout("页面中部"),
        layout("页面顶部"),
        {
          text: "课堂名称",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [{ text: "课堂名称", confidence: 0.99, x: 90, y: 600, width: 180, height: 52 }]
        },
        {
          text: "课堂名称 自动化课堂",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [{ text: "自动化课堂", confidence: 0.99, x: 90, y: 600, width: 220, height: 52 }]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-search-input-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-search-input",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("input_text_to_element", {
        text: "自动化课堂",
        clearFirst: true,
        focusDelayMs: 0,
        inputVerificationDelayMs: 0,
        locatorKind: "structural_locator",
        targetText: "课堂名称",
        semanticArea: "content",
        searchMode: "auto",
        searchDirection: "down",
        resetToTop: true,
        maxSwipes: 1,
        intervalMs: 0,
        structuralLocator: { strategy: "ocr_or_edittext", text: "课堂名称" }
      })
    });

    expect(actions).toEqual([
      { type: "swipe", startX: 500, startY: 500, endX: 500, endY: 1500, durationMs: 450 },
      { type: "swipe", startX: 500, startY: 1500, endX: 500, endY: 500, durationMs: 450 },
      { type: "tap", x: 180, y: 626 },
      { type: "clear_text" },
      { type: "input_text", text: "自动化课堂" }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        search: expect.objectContaining({ resetSwipes: 1, scanSwipes: 1, maxSwipes: 1 })
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

  it("resolves a masked scoped text field row from structural TextInput candidates", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "ClassIn\n立即注册\n+86\n12133333300\n已阅读并同意\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "立即注册", confidence: 0.99, x: 760, y: 300, width: 140, height: 44 },
            { text: "+86", confidence: 0.98, x: 100, y: 560, width: 60, height: 42 },
            { text: "12133333300", confidence: 0.99, x: 190, y: 560, width: 250, height: 42 },
            { text: "已阅读并同意", confidence: 0.98, x: 120, y: 860, width: 260, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 }
          ]
        },
        {
          text: "ClassIn\n立即注册\n+86\n12133333300\n已阅读并同意\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "立即注册", confidence: 0.99, x: 760, y: 300, width: 140, height: 44 },
            { text: "+86", confidence: 0.98, x: 100, y: 560, width: 60, height: 42 },
            { text: "12133333300", confidence: 0.99, x: 190, y: 560, width: 250, height: 42 },
            { text: "已阅读并同意", confidence: 0.98, x: 120, y: 860, width: 260, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 }
          ]
        }
      ]),
      dumpUiHierarchy: async () => harmonyTextInputHierarchy(),
      performAction: async (_serial, action) => {
        actions.push(action);
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-masked-scoped-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-masked-scoped",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("input_text_to_element", {
        text: "123qwe",
        clearFirst: true,
        valueParamKey: "secret",
        sensitiveInput: true,
        focusDelayMs: 0,
        inputVerificationDelayMs: 0,
        pageTaskStepLabel: "输入表单内容",
        locatorKind: "structural_locator",
        semanticArea: "content",
        structuralLocator: {
          strategy: "scoped_text_field",
          scopeText: "立即注册下方",
          ordinal: 2,
          role: "text_input"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 500, y: 720 },
      { type: "clear_text" },
      { type: "input_text", text: "123qwe" }
    ]);
    expect(outcome).toEqual(expect.objectContaining({
      supported: true,
      resolved: true,
      metadata: expect.objectContaining({
        focusResolvedBy: "ui_edit_text_structural",
        focusUiCandidate: expect.objectContaining({
          className: "harmony.widget.TextInput",
          contentDesc: "请输入密码",
          bounds: expect.objectContaining({
            centerX: 500,
            centerY: 720
          })
        }),
        verificationStrategy: "sensitive_target_region_unreadable"
      })
    }));
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
        targetText: "请输入密码",
        sensitiveInput: true,
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
        targetText: "请输入密码",
        sensitiveInput: true,
        semanticArea: "content",
        coordinateSpace: "screen"
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
          inputFallback: "keyevent_retry",
          initialVerificationStrategy: "target_region_still_placeholder",
          verificationStrategy: "masked_target_region"
        })
      })
    );
  });

  it("retries a scoped text field through Android keyevents when normal input leaves the placeholder", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "ClassIn\n+86 12133333300\n请输入密码\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86 12133333300", confidence: 0.98, x: 90, y: 560, width: 415, height: 42 },
            { text: "请输入密码", confidence: 0.99, x: 100, y: 715, width: 180, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 }
          ]
        },
        {
          text: "ClassIn\n+86 12133333300\n请输入密码\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86 12133333300", confidence: 0.98, x: 90, y: 560, width: 415, height: 42 },
            { text: "请输入密码", confidence: 0.99, x: 100, y: 715, width: 180, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 }
          ]
        },
        {
          text: "ClassIn\n+86 12133333300\n••••••\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86 12133333300", confidence: 0.98, x: 90, y: 560, width: 415, height: 42 },
            { text: "••••••", confidence: 0.98, x: 100, y: 715, width: 140, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 }
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
        focusDelayMs: 0,
        inputVerificationDelayMs: 0,
        secureKeyboardKeyEventIntervalMs: 0,
        locatorKind: "structural_locator",
        semanticArea: "content",
        structuralLocator: {
          strategy: "scoped_text_field",
          scopeText: "ClassIn",
          ordinal: 2,
          role: "text_input"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 190, y: 736 },
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
          focusResolvedBy: "scoped_text_field",
          inputVerified: true,
          sensitiveInput: false,
          inputFallback: "keyevent_retry",
          initialVerificationStrategy: "target_region_still_placeholder",
          verificationStrategy: "masked_target_region"
        })
      })
    );
  });

  it("accepts an unreadable scoped text field region after keyevent retry removes the placeholder", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "ClassIn\n+86 12133333300\n请输入密码\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86 12133333300", confidence: 0.98, x: 90, y: 560, width: 415, height: 42 },
            { text: "请输入密码", confidence: 0.99, x: 100, y: 715, width: 180, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 }
          ]
        },
        {
          text: "ClassIn\n+86 12133333300\n请输入密码\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86 12133333300", confidence: 0.98, x: 90, y: 560, width: 415, height: 42 },
            { text: "请输入密码", confidence: 0.99, x: 100, y: 715, width: 180, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 }
          ]
        },
        {
          text: "ClassIn\n+86 12133333300\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 70, y: 300, width: 220, height: 56 },
            { text: "+86 12133333300", confidence: 0.98, x: 90, y: 560, width: 415, height: 42 },
            { text: "登录", confidence: 0.99, x: 455, y: 1010, width: 90, height: 48 }
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
        focusDelayMs: 0,
        inputVerificationDelayMs: 0,
        secureKeyboardKeyEventIntervalMs: 0,
        locatorKind: "structural_locator",
        semanticArea: "content",
        structuralLocator: {
          strategy: "scoped_text_field",
          scopeText: "ClassIn",
          ordinal: 2,
          role: "text_input"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 190, y: 736 },
      { type: "clear_text" },
      { type: "input_text", text: "123qwe" },
      { type: "input_keyevents", text: "123qwe", intervalMs: 0 }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          inputVerified: true,
          inputFallback: "keyevent_retry",
          verificationStrategy: "target_region_unreadable_after_keyevent_retry"
        })
      })
    );
  });

  it("accepts an unreadable scoped text field region after ordinary text input removes the placeholder", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "ClassIn\n+86 18743085313\n请输入密码\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1200,
          height: 1920,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 48, y: 190, width: 190, height: 56 },
            { text: "+86 18743085313", confidence: 0.99, x: 79, y: 395, width: 278, height: 30 },
            { text: "请输入密码", confidence: 0.99, x: 79, y: 521, width: 143, height: 34 },
            { text: "登录", confidence: 0.99, x: 570, y: 732, width: 60, height: 42 }
          ]
        },
        {
          text: "ClassIn\n+86 18743085313\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1200,
          height: 1920,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 48, y: 190, width: 190, height: 56 },
            { text: "+86 18743085313", confidence: 0.99, x: 79, y: 395, width: 278, height: 30 },
            { text: "登录", confidence: 0.99, x: 570, y: 732, width: 60, height: 42 }
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
      deviceSize: { width: 1200, height: 1920 },
      step: semanticStep("input_text_to_element", {
        text: "eeo123",
        clearFirst: true,
        focusDelayMs: 0,
        inputVerificationDelayMs: 0,
        secureKeyboardKeyEventIntervalMs: 0,
        locatorKind: "structural_locator",
        semanticArea: "content",
        structuralLocator: {
          strategy: "scoped_text_field",
          scopeText: "ClassIn",
          ordinal: 2,
          role: "text_input"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 151, y: 538 },
      { type: "clear_text" },
      { type: "input_text", text: "eeo123" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          focusResolvedBy: "scoped_text_field",
          inputVerified: true,
          sensitiveInput: false,
          verificationStrategy: "target_region_unreadable_after_input"
        })
      })
    );
  });

  it("dismisses the keyboard and retries verification when input screenshot is protected", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "ClassIn\n+86 12133333300\n123qwe\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1256,
          height: 2760,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 60, y: 500, width: 250, height: 80 },
            { text: "+86 12133333300", confidence: 0.99, x: 200, y: 780, width: 450, height: 56 },
            { text: "123qwe", confidence: 0.99, x: 120, y: 960, width: 160, height: 56 },
            { text: "登录", confidence: 0.99, x: 570, y: 1240, width: 80, height: 56 }
          ]
        },
        {
          text: "",
          engine: "fake-layout",
          lang: "test",
          width: 1256,
          height: 2760,
          boxes: []
        },
        {
          text: "ClassIn\n+86 18743085313\n123qwe\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1256,
          height: 2760,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 60, y: 500, width: 250, height: 80 },
            { text: "+86 18743085313", confidence: 0.99, x: 200, y: 780, width: 450, height: 56 },
            { text: "123qwe", confidence: 0.99, x: 120, y: 960, width: 160, height: 56 },
            { text: "登录", confidence: 0.99, x: 570, y: 1240, width: 80, height: 56 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        if (action.type === "hide_keyboard") {
          throw new Error("HarmonyOS action is not supported yet: hide_keyboard");
        }
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
      deviceSize: { width: 1256, height: 2760 },
      step: semanticStep("input_text_to_element", {
        text: "18743085313",
        clearFirst: true,
        focusDelayMs: 0,
        inputVerificationDelayMs: 0,
        locatorKind: "structural_locator",
        semanticArea: "content",
        structuralLocator: {
          strategy: "scoped_text_field",
          scopeText: "ClassIn",
          ordinal: 1,
          role: "text_input"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 425, y: 808 },
      { type: "clear_text" },
      { type: "input_text", text: "18743085313" },
      { type: "hide_keyboard" },
      { type: "back" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          inputVerified: true,
          verificationRecovery: "keyboard_dismissed_after_empty_ocr",
          verificationRecoveryAction: "back",
          verificationStrategy: "input_identity_target_region",
          verifiedBy: "+86 18743085313"
        })
      })
    );
  });

  it("dismisses the keyboard when a protected input screenshot contains OCR noise", async () => {
    const actions: DeviceActionRequest[] = [];
    let screenshotCount = 0;
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        {
          text: "ClassIn\n+86 12133333300\n123qwe\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1256,
          height: 2760,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 60, y: 500, width: 250, height: 80 },
            { text: "+86 12133333300", confidence: 0.99, x: 200, y: 780, width: 450, height: 56 },
            { text: "123qwe", confidence: 0.99, x: 120, y: 960, width: 160, height: 56 },
            { text: "登录", confidence: 0.99, x: 570, y: 1240, width: 80, height: 56 }
          ]
        },
        {
          text: "?",
          engine: "fake-layout",
          lang: "test",
          width: 1256,
          height: 2760,
          boxes: [
            { text: "?", confidence: 0.57, x: 224, y: 57, width: 29, height: 32 }
          ]
        },
        {
          text: "ClassIn\n+86 18743085313\n123qwe\n登录",
          engine: "fake-layout",
          lang: "test",
          width: 1256,
          height: 2760,
          boxes: [
            { text: "ClassIn", confidence: 0.98, x: 60, y: 500, width: 250, height: 80 },
            { text: "+86 18743085313", confidence: 0.99, x: 200, y: 780, width: 450, height: 56 },
            { text: "123qwe", confidence: 0.99, x: 120, y: 960, width: 160, height: 56 },
            { text: "登录", confidence: 0.99, x: 570, y: 1240, width: 80, height: 56 }
          ]
        }
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        if (action.type === "hide_keyboard") {
          throw new Error("HarmonyOS action is not supported yet: hide_keyboard");
        }
        return {
          driverChannel: "mock"
        };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => {
        screenshotCount += 1;
        return {
          ...screenshot(`artifact-noisy-protected-${attempt}`),
          png: screenshotCount === 2 ? protectedPng(1256, 2760, 80_193) : Buffer.from("screen")
        };
      }
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1",
      stepResultId: "step-result-1",
      serial: "device-1",
      deviceSize: { width: 1256, height: 2760 },
      step: semanticStep("input_text_to_element", {
        text: "18743085313",
        clearFirst: true,
        focusDelayMs: 0,
        inputVerificationDelayMs: 0,
        locatorKind: "structural_locator",
        semanticArea: "content",
        structuralLocator: {
          strategy: "scoped_text_field",
          scopeText: "ClassIn",
          ordinal: 1,
          role: "text_input"
        }
      })
    });

    expect(actions).toEqual([
      { type: "tap", x: 425, y: 808 },
      { type: "clear_text" },
      { type: "input_text", text: "18743085313" },
      { type: "hide_keyboard" },
      { type: "back" }
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({
        supported: true,
        resolved: true,
        metadata: expect.objectContaining({
          inputVerified: true,
          verificationRecovery: "keyboard_dismissed_after_protected_screenshot",
          verificationRecoveryAction: "back",
          verificationStrategy: "input_identity_target_region",
          verifiedBy: "+86 18743085313"
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

  it("selects abbreviated minute labels in a duration picker", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        durationPickerLayout("7小时", "0分", "5分"),
        durationPickerLayout("7小时", "0分", "5分"),
        durationPickerLayout("7小时", "20分", "25分"),
        {
          text: "确定",
          engine: "fake-layout",
          lang: "test",
          width: 1000,
          height: 2000,
          boxes: [
            { text: "确定", confidence: 0.99, x: 820, y: 1120, width: 100, height: 55 }
          ]
        },
        fieldValueLayout("课堂时长", "7小时20分钟")
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-abbrev-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-abbrev",
      stepResultId: "step-result-abbrev",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 8, y: 38, width: 84, height: 7 },
        fieldType: "picker_select",
        targetText: "课堂时长",
        selectedValue: "7小时20分",
        confirmText: "确定",
        verifySelectedValue: true,
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1,
        pickerScrollIntervalMs: 1,
        structuralLocator: { pickerMode: "duration_hours_minutes" }
      })
    });

    expect(actions[0]).toEqual({ type: "tap", x: 500, y: 830 });
    expect(actions).toContainEqual(expect.objectContaining({ type: "swipe", startX: 750, endX: 750 }));
    expect(actions.at(-1)).toEqual({ type: "tap", x: 870, y: 1148 });
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        pickerMode: "duration_hours_minutes",
        selectedValue: "7小时20分",
        verifiedSelectedValue: "7小时20分钟",
        selectedParts: ["7小时", "20分钟"],
        confirmedBy: "确定"
      })
    }));
  });

  it("taps a visible duration value and verifies that it reaches the picker center", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        durationPickerLayout("10小时", "30分钟", "40分钟"),
        durationPickerLayout("10小时", "30分钟", "40分钟"),
        durationPickerLayout("10小时", "40分钟", "45分钟"),
        durationPickerLayout("10小时", "40分钟", "45分钟"),
        fieldValueLayout("课堂时长", "10小时40分钟")
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
        targetText: "课堂时长",
        selectedValue: "10小时40分钟",
        confirmText: "确定",
        verifySelectedValue: true,
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1,
        pickerScrollIntervalMs: 1,
        structuralLocator: { pickerMode: "duration_hours_minutes" }
      })
    });

    expect(actions).toContainEqual({ type: "tap", x: 765, y: 1730 });
    expect(actions).not.toContainEqual(expect.objectContaining({ type: "swipe", startX: 750, endX: 750 }));
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        selectedValue: "10小时40分钟",
        verifiedSelectedValue: "10小时40分钟"
      })
    }));
  });

  it("selects the adjacent visible hour instead of overshooting it with a coarse swipe", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        durationPickerLayout("10小时", "40分钟", "45分钟", "11小时"),
        durationPickerLayout("11小时", "40分钟", "45分钟", "12小时"),
        durationPickerLayout("11小时", "40分钟", "45分钟", "12小时"),
        durationPickerLayout("11小时", "40分钟", "45分钟", "12小时"),
        fieldValueLayout("课堂时长", "11小时40分钟")
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-adjacent-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-adjacent",
      stepResultId: "step-result-adjacent",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 8, y: 38, width: 84, height: 7 },
        fieldType: "picker_select",
        targetText: "课堂时长",
        selectedValue: "11小时40分钟",
        confirmText: "确定",
        verifySelectedValue: true,
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1,
        pickerScrollIntervalMs: 1,
        structuralLocator: { pickerMode: "duration_hours_minutes" }
      })
    });

    expect(actions).toContainEqual({ type: "tap", x: 205, y: 1730 });
    expect(actions).not.toContainEqual(expect.objectContaining({ type: "swipe", startX: 250, endX: 250 }));
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        selectedValue: "11小时40分钟",
        verifiedSelectedValue: "11小时40分钟"
      })
    }));
  });

  it("stops a duration wheel after repeated swipes make no progress", async () => {
    const actions: DeviceActionRequest[] = [];
    const stuckLayout = durationPickerLayout("10小时", "55分钟", "50分钟");
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        stuckLayout,
        stuckLayout,
        stuckLayout,
        stuckLayout
      ]),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-stuck-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-stuck",
      stepResultId: "step-result-stuck",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        region: { x: 8, y: 38, width: 84, height: 7 },
        fieldType: "picker_select",
        selectedValue: "10小时40分钟",
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1,
        pickerScrollIntervalMs: 1,
        structuralLocator: { pickerMode: "duration_hours_minutes" }
      })
    });

    expect(actions.filter((action) => action.type === "swipe")).toHaveLength(2);
    expect(outcome).toEqual(expect.objectContaining({
      resolved: false,
      metadata: expect.objectContaining({
        reason: "picker_no_progress",
        stalledAt: "55分钟"
      })
    }));
  });

  it("fails a duration selection when the field does not contain the requested value after confirmation", async () => {
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        durationPickerLayout("10小时", "40分钟", "45分钟"),
        durationPickerLayout("10小时", "40分钟", "45分钟"),
        durationPickerLayout("10小时", "40分钟", "45分钟"),
        fieldValueLayout("课堂时长", "10小时30分钟")
      ]),
      performAction: async () => ({ driverChannel: "mock" }),
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
        targetText: "课堂时长",
        selectedValue: "10小时40分钟",
        confirmText: "确定",
        verifySelectedValue: true,
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1,
        structuralLocator: { pickerMode: "duration_hours_minutes" }
      })
    });

    expect(outcome).toEqual(expect.objectContaining({
      resolved: false,
      metadata: expect.objectContaining({
        reason: "picker_value_not_applied",
        selectedValue: "10小时40分钟",
        actualValue: "10小时30分钟"
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

  it("uses the shared bounded search contract for an offscreen picker", async () => {
    const actions: DeviceActionRequest[] = [];
    const resolver = new SemanticStepResolver({
      ocr: new QueueLayoutOcrService([
        layout("页面中部"),
        layout("页面顶部"),
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
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => screenshot(`artifact-search-picker-${attempt}`)
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-1", stepResultId: "step-result-search-picker", serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locator: "runtime-locator:lesson_duration_row",
        locatorKind: "structural_locator",
        targetText: "课堂时长",
        semanticArea: "content",
        coordinateSpace: "runtime",
        fieldType: "picker_select",
        selectedValue: "30分钟",
        searchMode: "auto",
        searchDirection: "down",
        resetToTop: true,
        maxSwipes: 1,
        intervalMs: 0,
        pickerOpenDelayMs: 1,
        pickerConfirmDelayMs: 1,
        pickerScrollIntervalMs: 1,
        structuralLocator: {
          strategy: "ocr_text_row",
          anchorText: "课堂时长",
          pickerMode: "duration_hours_minutes"
        }
      })
    });

    expect(actions[0]).toEqual({ type: "swipe", startX: 500, startY: 500, endX: 500, endY: 1500, durationMs: 450 });
    expect(actions[1]).toEqual({ type: "swipe", startX: 500, startY: 1500, endX: 500, endY: 500, durationMs: 450 });
    expect(outcome).toEqual(expect.objectContaining({
      resolved: true,
      metadata: expect.objectContaining({
        search: expect.objectContaining({ resetSwipes: 1, scanSwipes: 1, maxSwipes: 1 })
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

  it("matches trailing switch anchors with common mixed Latin OCR confusions", async () => {
    const actions: DeviceActionRequest[] = [];
    const screenshots = [trailingSwitchScreenshot(false), trailingSwitchScreenshot(true)];
    const resolver = new SemanticStepResolver({
      ocr: new LayoutOcrService({
        text: "录制Classln教室",
        engine: "fake-layout",
        lang: "test",
        width: 1000,
        height: 2000,
        boxes: [
          { text: "录制Classln教室", confidence: 0.99, x: 90, y: 1200, width: 360, height: 60 }
        ]
      }),
      performAction: async (_serial, action) => {
        actions.push(action);
        return { driverChannel: "mock" };
      },
      captureLocatorScreenshot: async (_runId, _stepResultId, _serial, _stepId, attempt) => ({
        artifact: artifact(`artifact-confusable-${attempt}`),
        png: screenshots.shift() ?? trailingSwitchScreenshot(true)
      })
    });

    const outcome = await resolver.resolveIfNeeded({
      runId: "run-confusable",
      stepResultId: "step-result-confusable",
      serial: "device-1",
      deviceSize: { width: 1000, height: 2000 },
      step: semanticStep("tap_on_image", {
        locatorKind: "structural_locator",
        targetText: "录制ClassIn教室",
        semanticArea: "content",
        fieldType: "toggle_set",
        desiredState: "on",
        toggleVerifyDelayMs: 1,
        structuralLocator: {
          strategy: "ocr_trailing_switch",
          anchorText: "录制ClassIn教室"
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
        verifiedState: "on"
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

function hierarchyWithText(
  text: string,
  options: { className?: string; bounds?: string; clickable?: boolean } = {}
): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="harmony.widget.Root" package="cn.eeo.hos.classin.mobile" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1256,2760]">
    <node index="0" text="${text}" resource-id="" class="${options.className ?? "harmony.widget.Text"}" package="cn.eeo.hos.classin.mobile" content-desc="" clickable="${options.clickable ?? false}" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="${options.bounds ?? "[100,100][300,180]"}" />
  </node>
</hierarchy>`;
}

function cardTextHierarchy(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="cn.eeo.classin:id/class_card" class="android.view.ViewGroup" package="cn.eeo.classin" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[490,1240][1010,1740]">
      <node index="0" text="班级四十二号" resource-id="cn.eeo.classin:id/class_name" class="android.widget.TextView" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[601,1386][833,1426]" />
    </node>
  </node>
</hierarchy>`;
}

function addFriendMenuHierarchy(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1200,2000]">
    <node index="0" text="" resource-id="cn.eeo.classin:id/menu_item" class="android.view.ViewGroup" package="cn.eeo.classin" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[884,220][1100,286]">
      <node index="0" text="添加好友" resource-id="cn.eeo.classin:id/menu_text" class="android.widget.TextView" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[934,231][1050,275]" />
    </node>
  </node>
</hierarchy>`;
}

function decoratedAddFriendMenuHierarchy(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1200,2000]">
    <node index="0" text="8+添加好友" resource-id="cn.eeo.classin:id/menu_item" class="android.view.ViewGroup" package="cn.eeo.classin" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[884,220][1100,286]" />
  </node>
</hierarchy>`;
}

function androidContentAddButtonHierarchy(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1000,2000]">
    <node index="0" text="" resource-id="cn.eeo.classin:id/btn_add" class="androidx.compose.ui.platform.ComposeView" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[795,1520][955,1680]">
      <node index="0" text="" resource-id="" class="android.widget.ImageView" package="cn.eeo.classin" content-desc="add btn" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[795,1520][955,1680]" />
    </node>
  </node>
</hierarchy>`;
}

function androidContentReportButtonHierarchy(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1000,2000]">
    <node index="0" text="" resource-id="cn.eeo.classin:id/iv_activity_lesson_report" class="android.widget.ImageView" package="cn.eeo.classin" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[755,1360][995,1460]" />
  </node>
</hierarchy>`;
}

function harmonyGenericContentReportButtonHierarchy(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="harmony.widget.Root" package="cn.eeo.hos.classin.mobile" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1000,2000]">
    <node index="0" text="" resource-id="" class="harmony.widget.Button" package="cn.eeo.hos.classin.mobile" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[755,1360][995,1460]" />
  </node>
</hierarchy>`;
}

function composeLessonInfoHierarchy(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1200,2000]">
    <node index="0" text="" resource-id="cn.eeo.classin:id/lesson_info" class="androidx.compose.ui.platform.ComposeView" package="cn.eeo.classin" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[0,656][1200,794]">
      <node index="0" text="课堂信息" resource-id="" class="android.widget.TextView" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[64,682][192,720]" />
      <node index="1" text="修改" resource-id="" class="android.widget.TextView" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[1050,686][1102,716]" />
    </node>
  </node>
</hierarchy>`;
}

function publishActivityOverlayHierarchy(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2340]">
    <node index="0" text="" resource-id="" class="androidx.compose.ui.platform.ComposeView" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2218]">
      <node index="0" text="" resource-id="" class="android.widget.ScrollView" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="true" bounds="[60,338][1020,2218]">
        <node index="0" text="" resource-id="" class="android.view.View" package="cn.eeo.classin" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[60,411][1020,742]">
          <node index="0" text="课堂" resource-id="" class="android.widget.TextView" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[108,555][192,604]" />
          <node index="1" text="多模式实时师生互动授课， AI 赋能课堂分析与智能章节总结" resource-id="" class="android.widget.TextView" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[108,616][972,694]" />
        </node>
      </node>
    </node>
    <node index="1" text="" resource-id="cn.eeo.classin:id/background_list" class="android.view.ViewGroup" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="true" bounds="[0,0][1080,2218]">
      <node index="0" text="课堂" resource-id="cn.eeo.classin:id/tv_activity_type" class="android.widget.TextView" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[252,1465][318,1504]" />
      <node index="1" text="课堂" resource-id="cn.eeo.classin:id/tv_activity_type" class="android.widget.TextView" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[252,1939][318,1978]" />
    </node>
  </node>
</hierarchy>`;
}

function emptyHierarchy(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]" />
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

function harmonyTextInputHierarchy(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="harmony.widget.Root" package="cn.eeo.hos.classin.mobile" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1000,2000]">
    <node index="0" text="" resource-id="" class="harmony.widget.TextInput" package="cn.eeo.hos.classin.mobile" content-desc="请输入手机号/邮箱" clickable="true" enabled="true" focusable="true" long-clickable="true" scrollable="false" bounds="[100,500][900,620]" />
    <node index="1" text="" resource-id="" class="harmony.widget.TextInput" package="cn.eeo.hos.classin.mobile" content-desc="请输入密码" clickable="true" enabled="true" focusable="true" long-clickable="true" scrollable="false" bounds="[100,660][900,780]" />
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

function durationPickerLayout(
  hours: string,
  selectedMinutes: string,
  visibleMinutes: string,
  visibleHours?: string
): OcrLayoutResult {
  return {
    text: `确定 ${hours} ${selectedMinutes} ${visibleMinutes}`,
    engine: "fake-layout",
    lang: "test",
    width: 1000,
    height: 2000,
    boxes: [
      { text: "确定", confidence: 0.99, x: 820, y: 1100, width: 100, height: 50 },
      { text: hours, confidence: 0.99, x: 120, y: 1550, width: 170, height: 60 },
      ...(visibleHours ? [{ text: visibleHours, confidence: 0.95, x: 120, y: 1700, width: 170, height: 60 }] : []),
      { text: selectedMinutes, confidence: 0.99, x: 680, y: 1550, width: 170, height: 60 },
      { text: visibleMinutes, confidence: 0.95, x: 680, y: 1700, width: 170, height: 60 }
    ]
  };
}

function fieldValueLayout(label: string, value: string): OcrLayoutResult {
  return {
    text: `${label} ${value}`,
    engine: "fake-layout",
    lang: "test",
    width: 1000,
    height: 2000,
    boxes: [
      { text: label, confidence: 0.99, x: 80, y: 760, width: 180, height: 55 },
      { text: value, confidence: 0.99, x: 650, y: 760, width: 260, height: 55 }
    ]
  };
}

function screenshot(id: string): ScreenshotCapture {
  return {
    artifact: artifact(id),
    png: Buffer.from("screen")
  };
}

function protectedPng(width: number, height: number, sizeBytes: number): Buffer {
  const buffer = Buffer.alloc(sizeBytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
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
  icons: Array<{ role: "add" | "search" | "back" | "share"; centerX: number; centerY: number }>,
  colors: { background: number; foreground: number } = { background: 255, foreground: 20 }
): Buffer {
  const pixels = Array.from({ length: width * height }, () => colors.background);
  for (const icon of icons) {
    if (icon.role === "add") {
      drawCircle(pixels, width, height, icon.centerX, icon.centerY, 22, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX - 13, icon.centerY, icon.centerX + 13, icon.centerY, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX, icon.centerY - 13, icon.centerX, icon.centerY + 13, 5, colors.foreground);
    } else if (icon.role === "search") {
      drawCircle(pixels, width, height, icon.centerX - 3, icon.centerY - 3, 18, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX + 9, icon.centerY + 9, icon.centerX + 24, icon.centerY + 24, 5, colors.foreground);
    } else if (icon.role === "back") {
      drawLine(pixels, width, height, icon.centerX + 10, icon.centerY - 20, icon.centerX - 10, icon.centerY, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX - 10, icon.centerY, icon.centerX + 10, icon.centerY + 20, 5, colors.foreground);
    } else {
      drawLine(pixels, width, height, icon.centerX - 18, icon.centerY - 2, icon.centerX - 18, icon.centerY + 22, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX - 18, icon.centerY + 22, icon.centerX + 18, icon.centerY + 22, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX + 18, icon.centerY + 22, icon.centerX + 18, icon.centerY - 2, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX, icon.centerY + 8, icon.centerX, icon.centerY - 22, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX, icon.centerY - 22, icon.centerX - 10, icon.centerY - 12, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX, icon.centerY - 22, icon.centerX + 10, icon.centerY - 12, 5, colors.foreground);
    }
  }
  return pgm(width, height, pixels);
}

function semanticIconScreenshot(
  width: number,
  height: number,
  icons: Array<{ role: "add" | "search" | "back" | "share" | "chevron"; centerX: number; centerY: number }>,
  colors: { background: number; foreground: number } = { background: 255, foreground: 20 }
): Buffer {
  const pixels = Array.from({ length: width * height }, () => colors.background);
  for (const icon of icons) {
    if (icon.role === "add") {
      drawCircle(pixels, width, height, icon.centerX, icon.centerY, 22, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX - 13, icon.centerY, icon.centerX + 13, icon.centerY, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX, icon.centerY - 13, icon.centerX, icon.centerY + 13, 5, colors.foreground);
    } else if (icon.role === "search") {
      drawCircle(pixels, width, height, icon.centerX - 3, icon.centerY - 3, 18, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX + 9, icon.centerY + 9, icon.centerX + 24, icon.centerY + 24, 5, colors.foreground);
    } else if (icon.role === "back" || icon.role === "chevron") {
      drawLine(pixels, width, height, icon.centerX + 10, icon.centerY - 20, icon.centerX - 10, icon.centerY, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX - 10, icon.centerY, icon.centerX + 10, icon.centerY + 20, 5, colors.foreground);
    } else {
      drawLine(pixels, width, height, icon.centerX - 18, icon.centerY - 2, icon.centerX - 18, icon.centerY + 22, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX - 18, icon.centerY + 22, icon.centerX + 18, icon.centerY + 22, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX + 18, icon.centerY + 22, icon.centerX + 18, icon.centerY - 2, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX, icon.centerY + 8, icon.centerX, icon.centerY - 22, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX, icon.centerY - 22, icon.centerX - 10, icon.centerY - 12, 5, colors.foreground);
      drawLine(pixels, width, height, icon.centerX, icon.centerY - 22, icon.centerX + 10, icon.centerY - 12, 5, colors.foreground);
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

function contentReportIconScreenshot(
  width: number,
  height: number,
  icon: { centerX: number; centerY: number }
): Buffer {
  const pixels = Array.from({ length: width * height }, () => 255);
  const left = icon.centerX - 23;
  const right = icon.centerX + 23;
  const top = icon.centerY - 28;
  const bottom = icon.centerY + 28;
  drawLine(pixels, width, height, left, top + 8, left, bottom, 6, 20);
  drawLine(pixels, width, height, left, bottom, right, bottom, 6, 20);
  drawLine(pixels, width, height, right, bottom, right, top + 8, 6, 20);
  drawLine(pixels, width, height, left, top + 8, right, top + 8, 6, 20);
  drawLine(pixels, width, height, icon.centerX - 10, top, icon.centerX + 10, top, 6, 20);
  drawLine(pixels, width, height, icon.centerX - 10, top, icon.centerX - 10, top + 11, 6, 20);
  drawLine(pixels, width, height, icon.centerX + 10, top, icon.centerX + 10, top + 11, 6, 20);
  drawLine(pixels, width, height, icon.centerX - 10, icon.centerY - 5, icon.centerX + 12, icon.centerY - 5, 4, 20);
  drawLine(pixels, width, height, icon.centerX - 10, icon.centerY + 9, icon.centerX + 12, icon.centerY + 9, 4, 20);
  return pgm(width, height, pixels);
}

function topBarAvatarScreenshot(
  width: number,
  height: number,
  avatar: { centerX: number; centerY: number; radius: number }
): Buffer {
  return topBarAvatarComponentsScreenshot(width, height, [avatar]);
}

function topBarAvatarComponentsScreenshot(
  width: number,
  height: number,
  avatars: Array<{ centerX: number; centerY: number; radius: number }>
): Buffer {
  const pixels = Array.from({ length: width * height }, () => 255);
  for (const avatar of avatars) {
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
  }
  return pgm(width, height, pixels);
}

function topBarAvatarWithTextStrokeDistractorScreenshot(width: number, height: number): Buffer {
  const pixels = Array.from({ length: width * height }, () => 255);
  for (let y = 232; y <= 268; y += 1) {
    for (let x = 66; x <= 102; x += 1) {
      if (x < 0 || x >= width || y < 0 || y >= height) {
        continue;
      }
      if (Math.hypot(x - 84, y - 250) <= 18) {
        pixels[y * width + x] = 232;
      }
    }
  }
  for (let y = 286; y <= 369; y += 1) {
    for (let x = 48; x <= 126; x += 1) {
      if (x < 0 || x >= width || y < 0 || y >= height) {
        continue;
      }
      pixels[y * width + x] = 28;
    }
  }
  return pgm(width, height, pixels);
}

function topBarPaleAvatarWithTextStrokeDistractorScreenshot(width: number, height: number): Buffer {
  const pixels = Array.from({ length: width * height }, () => 255);
  for (let y = 232; y <= 268; y += 1) {
    for (let x = 66; x <= 102; x += 1) {
      if (x < 0 || x >= width || y < 0 || y >= height) {
        continue;
      }
      if (Math.hypot(x - 84, y - 250) <= 18) {
        pixels[y * width + x] = 252;
      }
    }
  }
  for (let y = 286; y <= 369; y += 1) {
    for (let x = 48; x <= 126; x += 1) {
      if (x < 0 || x >= width || y < 0 || y >= height) {
        continue;
      }
      pixels[y * width + x] = 28;
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
