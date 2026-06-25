import { describe, expect, it } from "vitest";
import {
  applyInstalledAppInfoToStructuredFlowDraft,
  attachRecordingObservationsToActionStep,
  buildStructuredFlowDraft,
  createRecordedStep,
  defaultCaseName,
  mergeActionStepPatch,
  renumberSteps
} from "./recording.js";

const deviceSize = { width: 1000, height: 2000 };
const createdAt = "2026-06-05T00:00:00.000Z";

describe("createRecordedStep", () => {
  it("uses a Chinese default case name", () => {
    expect(defaultCaseName).toBe("录制用例");
  });

  it("records tap device coordinates and ratios", () => {
    const step = createRecordedStep({
      action: { type: "tap", x: 250, y: 1000 },
      order: 2,
      deviceSize,
      id: "step-tap",
      createdAt
    });

    expect(step).toMatchObject({
      id: "step-tap",
      order: 2,
      type: "tap",
      enabled: true,
      coordinate: {
        x: 250,
        y: 1000,
        xRatio: 0.25,
        yRatio: 0.5,
        deviceWidth: 1000,
        deviceHeight: 2000
      },
      createdAt
    });
    expect(step.expectations?.map((expectation) => [expectation.type, expectation.enabled, expectation.params.reliability, expectation.params.blocking])).toEqual([
      ["no_crash", true, "P0", true],
      ["app_alive", true, "P0", true],
      ["screen_changed", false, "P1", false]
    ]);
  });

  it("records swipe endpoints and default duration", () => {
    const step = createRecordedStep({
      action: { type: "swipe", startX: 100, startY: 200, endX: 700, endY: 1200 },
      order: 1,
      deviceSize,
      id: "step-swipe",
      createdAt
    });

    expect(step.params).toEqual({ durationMs: 450 });
    expect(step.coordinate).toMatchObject({
      startX: 100,
      startY: 200,
      endX: 700,
      endY: 1200,
      startXRatio: 0.1,
      startYRatio: 0.1,
      endXRatio: 0.7,
      endYRatio: 0.6
    });
    expect(step.expectations?.map((expectation) => [expectation.type, expectation.enabled, expectation.params.blocking])).toEqual([
      ["no_crash", true, true],
      ["app_alive", true, true],
      ["screen_changed", true, false]
    ]);
  });

  it("records long press coordinates and duration", () => {
    const step = createRecordedStep({
      action: { type: "long_press", x: 300, y: 900, durationMs: 900 },
      order: 1,
      deviceSize,
      id: "step-long-press",
      createdAt
    });

    expect(step).toMatchObject({
      id: "step-long-press",
      type: "long_press",
      params: { durationMs: 900 },
      coordinate: {
        x: 300,
        y: 900,
        xRatio: 0.3,
        yRatio: 0.45
      }
    });
  });

  it("records Android element locators before falling back to raw coordinates", () => {
    const step = createRecordedStep({
      action: {
        type: "tap_on_element",
        x: 240,
        y: 360,
        selector: "id=com.demo:id/join_class",
        locator: {
          strategy: "android_uiautomator",
          resourceId: "com.demo:id/join_class",
          packageName: "com.demo"
        },
        bounds: {
          left: 120,
          top: 320,
          right: 360,
          bottom: 400,
          width: 240,
          height: 80,
          centerX: 240,
          centerY: 360
        }
      },
      order: 1,
      deviceSize,
      id: "step-element",
      createdAt
    });

    expect(step).toMatchObject({
      id: "step-element",
      type: "tap_on_element",
      title: "点击元素：id=com.demo:id/join_class",
      params: {
        selector: "id=com.demo:id/join_class",
        resourceId: "com.demo:id/join_class",
        packageName: "com.demo",
        timeoutMs: 3000,
        intervalMs: 500,
        maxDistance: 240,
        locator: {
          strategy: "android_uiautomator",
          resourceId: "com.demo:id/join_class",
          packageName: "com.demo"
        }
      },
      coordinate: {
        x: 240,
        y: 360,
        xRatio: 0.24,
        yRatio: 0.18
      }
    });
  });

  it("records occurrence for repeated Android element locators", () => {
    const step = createRecordedStep({
      action: {
        type: "tap_on_element",
        x: 650,
        y: 650,
        selector: "desc=course Photo#2",
        locator: {
          strategy: "android_uiautomator",
          contentDesc: "course Photo",
          packageName: "com.demo",
          occurrence: 2
        },
        bounds: {
          left: 500,
          top: 500,
          right: 800,
          bottom: 800,
          width: 300,
          height: 300,
          centerX: 650,
          centerY: 650
        }
      },
      order: 1,
      deviceSize,
      id: "step-repeated-element",
      createdAt
    });

    expect(step).toMatchObject({
      type: "tap_on_element",
      title: "点击元素：desc=course Photo#2",
      params: {
        selector: "desc=course Photo#2",
        contentDesc: "course Photo",
        packageName: "com.demo",
        occurrence: 2,
        locator: {
          contentDesc: "course Photo",
          occurrence: 2
        }
      }
    });
  });

  it("records text tap preconditions so replay waits for the recorded target state", () => {
    const step = createRecordedStep({
      action: {
        type: "tap_on_text",
        text: "进入课堂",
        x: 240,
        y: 360,
        mode: "contains",
        timeoutMs: 5000,
        intervalMs: 250,
        lang: "chi_sim"
      },
      order: 1,
      deviceSize,
      id: "step-text",
      createdAt
    });

    expect(step).toMatchObject({
      id: "step-text",
      type: "tap_on_text",
      preconditions: [
        expect.objectContaining({
          type: "text",
          enabled: true,
          params: expect.objectContaining({
            expected: "进入课堂",
            mode: "contains",
            lang: "chi_sim",
            timeoutMs: 5000,
            intervalMs: 250,
            source: "recording_precondition_text"
          })
        })
      ]
    });
  });

  it("records element tap preconditions so replay waits for the recorded target element", () => {
    const step = createRecordedStep({
      action: {
        type: "tap_on_element",
        x: 240,
        y: 360,
        selector: "id=com.demo:id/join_class",
        locator: {
          strategy: "android_uiautomator",
          resourceId: "com.demo:id/join_class",
          text: "进入课堂",
          packageName: "com.demo"
        },
        bounds: {
          left: 120,
          top: 320,
          right: 360,
          bottom: 400,
          width: 240,
          height: 80,
          centerX: 240,
          centerY: 360
        },
        timeoutMs: 5000,
        intervalMs: 250
      },
      order: 1,
      deviceSize,
      id: "step-element-precondition",
      createdAt
    });

    expect(step).toMatchObject({
      id: "step-element-precondition",
      type: "tap_on_element",
      preconditions: [
        expect.objectContaining({
          type: "text",
          enabled: true,
          params: expect.objectContaining({
            resourceId: "com.demo:id/join_class",
            expected: "进入课堂",
            mode: "exists",
            timeoutMs: 5000,
            intervalMs: 250,
            source: "recording_precondition_element"
          })
        })
      ]
    });
  });

  it("records non-coordinate action params", () => {
    expect(
      createRecordedStep({
        action: { type: "input_text", text: "hello" },
        order: 1,
        deviceSize,
        id: "step-input",
        createdAt
      }).params
    ).toEqual({ text: "hello" });

    expect(
      createRecordedStep({
        action: { type: "wait", durationMs: 1000 },
        order: 2,
        deviceSize,
        id: "step-wait",
        createdAt
      }).params
    ).toEqual({ durationMs: 1000 });
  });

  it("records recent apps as a replayable system action", () => {
    const step = createRecordedStep({
      action: { type: "recent_apps" },
      order: 1,
      deviceSize,
      id: "step-recent-apps",
      createdAt
    });

    expect(step).toMatchObject({
      id: "step-recent-apps",
      type: "recent_apps",
      params: {}
    });
    expect(step.expectations?.map((expectation) => [expectation.type, expectation.enabled, expectation.params.blocking])).toEqual([
      ["no_crash", true, true],
      ["app_alive", true, true],
      ["screen_changed", true, false]
    ]);
  });

  it("can skip automatic expectations for editor-created helper steps", () => {
    const step = createRecordedStep({
      action: { type: "wait", durationMs: 1000 },
      order: 1,
      deviceSize,
      id: "step-wait",
      createdAt,
      autoExpectations: false
    });

    expect(step.expectations).toEqual([]);
    expect(step.preconditions).toEqual([]);
  });

  it("attaches compact before and after recording observation summaries", () => {
    const step = createRecordedStep({
      action: { type: "tap", x: 250, y: 1000 },
      order: 1,
      deviceSize,
      id: "step-observed",
      createdAt
    });

    const next = attachRecordingObservationsToActionStep(
      step,
      {
        platform: "android",
        capturedAt: "2026-06-05T00:00:01.000Z",
        deviceSerial: "device-1",
        packageName: "cn.eeo.classin",
        activityName: ".MainActivity",
        resolution: { width: 1080, height: 2400 },
        uiElements: [
          { resourceId: "cn.eeo.classin:id/tab_teacher", text: "我是教师", packageName: "cn.eeo.classin", clickable: true },
          { resourceId: "cn.eeo.classin:id/tab_message", text: "消息", packageName: "cn.eeo.classin", clickable: true }
        ],
        ocrTexts: [{ text: "我是教师", confidence: 0.95, source: "ocr" }]
      },
      {
        platform: "android",
        capturedAt: "2026-06-05T00:00:03.000Z",
        packageName: "cn.eeo.classin",
        activityName: ".ClassListActivity",
        resolution: { width: 1080, height: 2400 },
        uiElements: [{ resourceId: "cn.eeo.classin:id/class_item", text: "高三一班", packageName: "cn.eeo.classin", clickable: true }],
        ocrTexts: [{ text: "高三一班", confidence: 0.92, source: "ocr" }]
      }
    );

    expect(next.params.recordingContext).toEqual({
      beforeObservation: expect.objectContaining({
        packageName: "cn.eeo.classin",
        activityName: ".MainActivity",
        uiElementCount: 2,
        ocrTextCount: 1,
        resourceIds: ["cn.eeo.classin:id/tab_teacher", "cn.eeo.classin:id/tab_message"],
        texts: ["我是教师", "消息"],
        elementCandidates: expect.arrayContaining([
          expect.objectContaining({
            resourceId: "cn.eeo.classin:id/tab_teacher",
            text: "我是教师",
            clickable: true
          })
        ]),
        textCandidates: expect.arrayContaining([
          expect.objectContaining({
            text: "我是教师",
            source: "ocr",
            confidence: 0.95
          })
        ])
      }),
      afterObservation: expect.objectContaining({
        activityName: ".ClassListActivity",
        uiElementCount: 1,
        resourceIds: ["cn.eeo.classin:id/class_item"],
        texts: ["高三一班"]
      })
    });
  });

  it("adds arrival expectations from after recording observations", () => {
    const step = createRecordedStep({
      action: {
        type: "tap_on_element",
        x: 938,
        y: 1933,
        selector: "desc=add btn",
        locator: {
          strategy: "android_uiautomator",
          contentDesc: "add btn",
          packageName: "cn.eeo.classin"
        }
      },
      order: 1,
      deviceSize,
      id: "step-add",
      createdAt
    });

    const next = attachRecordingObservationsToActionStep(step, undefined, {
      platform: "android",
      capturedAt: "2026-06-05T00:00:03.000Z",
      packageName: "cn.eeo.classin",
      activityName: ".PublishActivity",
      resolution: { width: 1080, height: 2400 },
      uiElements: [
        { resourceId: "cn.eeo.classin:id/title", text: "发布活动", packageName: "cn.eeo.classin", clickable: false },
        { resourceId: "cn.eeo.classin:id/course", text: "课堂", packageName: "cn.eeo.classin", clickable: true }
      ],
      ocrTexts: [{ text: "发布活动", confidence: 0.96, source: "ocr" }]
    });

    expect(next.expectations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          enabled: true,
          note: "自动生成后置预期：动作后应到达录制时的目标页面",
          params: expect.objectContaining({
            expected: "发布活动",
            mode: "contains",
            source: "recording_arrival_text",
            blocking: true
          })
        }),
        expect.objectContaining({
          type: "text",
          enabled: true,
          params: expect.objectContaining({
            resourceId: "cn.eeo.classin:id/title",
            expected: "发布活动",
            mode: "exists",
            source: "recording_arrival_element",
            blocking: true
          })
        })
      ])
    );
  });

  it("does not use transient list status text as the arrival page expectation", () => {
    const step = createRecordedStep({
      action: {
        type: "tap_on_element",
        x: 938,
        y: 1933,
        selector: "desc=add btn",
        locator: {
          strategy: "android_uiautomator",
          contentDesc: "add btn",
          packageName: "cn.eeo.classin"
        }
      },
      order: 1,
      deviceSize,
      id: "step-add",
      createdAt
    });

    const next = attachRecordingObservationsToActionStep(step, undefined, {
      platform: "android",
      capturedAt: "2026-06-05T00:00:03.000Z",
      packageName: "cn.eeo.classin",
      activityName: ".PublishActivity",
      resolution: { width: 1080, height: 2400 },
      uiElements: [
        { resourceId: "cn.eeo.classin:id/tv_activity_status", text: "已结束", packageName: "cn.eeo.classin", className: "android.widget.TextView" },
        { resourceId: "cn.eeo.classin:id/title", text: "发布活动", packageName: "cn.eeo.classin", className: "android.widget.TextView" },
        { resourceId: "cn.eeo.classin:id/course", text: "课堂", packageName: "cn.eeo.classin", clickable: true }
      ],
      ocrTexts: [
        { text: "已结束", confidence: 0.94, source: "ocr" },
        { text: "发布活动", confidence: 0.96, source: "ocr" }
      ]
    });

    const generatedTexts = (next.expectations ?? [])
      .filter((expectation) => expectation.type === "text" && expectation.params.source !== "recording_precondition_element")
      .map((expectation) => expectation.params.expected);

    expect(generatedTexts).toContain("发布活动");
    expect(generatedTexts).not.toContain("已结束");
  });

  it("prefers OCR page title over transient UI status labels for arrival expectations", () => {
    const step = createRecordedStep({
      action: {
        type: "tap_on_element",
        x: 938,
        y: 1933,
        selector: "desc=add btn",
        locator: {
          strategy: "android_uiautomator",
          contentDesc: "add btn",
          packageName: "cn.eeo.classin"
        }
      },
      order: 1,
      deviceSize,
      id: "step-add",
      createdAt
    });

    const next = attachRecordingObservationsToActionStep(step, undefined, {
      platform: "android",
      capturedAt: "2026-06-05T00:00:03.000Z",
      packageName: "cn.eeo.classin",
      activityName: ".PublishActivity",
      resolution: { width: 1080, height: 2400 },
      uiElements: [
        { resourceId: "cn.eeo.classin:id/tv_activity_status", text: "已结束", packageName: "cn.eeo.classin", className: "android.widget.TextView" },
        { resourceId: "cn.eeo.classin:id/course", text: "课堂", packageName: "cn.eeo.classin", clickable: true }
      ],
      ocrTexts: [
        { text: "已结束", confidence: 0.94, source: "ocr" },
        { text: "发布活动", confidence: 0.96, source: "ocr" }
      ]
    });

    const generatedTexts = (next.expectations ?? [])
      .filter((expectation) => expectation.type === "text" && expectation.params.source !== "recording_precondition_element")
      .map((expectation) => expectation.params.expected);

    expect(generatedTexts).toContain("发布活动");
    expect(generatedTexts).not.toContain("已结束");
  });

  it("replaces stale generated arrival expectations when a new after observation is attached", () => {
    const staleStep = createRecordedStep({
      action: {
        type: "tap_on_element",
        x: 938,
        y: 1933,
        selector: "desc=add btn",
        locator: {
          strategy: "android_uiautomator",
          contentDesc: "add btn",
          packageName: "cn.eeo.classin"
        }
      },
      order: 1,
      deviceSize,
      id: "step-add",
      createdAt
    });
    const withStaleArrival = mergeActionStepPatch(staleStep, {
      expectations: [
        ...(staleStep.expectations ?? []),
        {
          id: "stale-arrival-text",
          type: "text",
          enabled: true,
          note: "自动生成后置预期：动作后应到达录制时的目标页面",
          params: {
            expected: "已结束",
            mode: "contains",
            source: "recording_arrival_text",
            autoGenerated: true,
            blocking: true
          },
          createdAt
        },
        {
          id: "stale-arrival-element",
          type: "text",
          enabled: true,
          note: "自动生成后置预期：动作后应到达录制时的目标页面",
          params: {
            resourceId: "cn.eeo.classin:id/tv_activity_status",
            expected: "已结束",
            mode: "exists",
            source: "recording_arrival_element",
            autoGenerated: true,
            blocking: true
          },
          createdAt
        }
      ]
    });

    const next = attachRecordingObservationsToActionStep(withStaleArrival, undefined, {
      platform: "android",
      capturedAt: "2026-06-05T00:00:03.000Z",
      packageName: "cn.eeo.classin",
      activityName: ".PublishActivity",
      resolution: { width: 1080, height: 2400 },
      uiElements: [
        { resourceId: "cn.eeo.classin:id/tv_activity_status", text: "已结束", packageName: "cn.eeo.classin", className: "android.widget.TextView" },
        { resourceId: "cn.eeo.classin:id/title", text: "发布活动", packageName: "cn.eeo.classin", className: "android.widget.TextView" }
      ],
      ocrTexts: [
        { text: "已结束", confidence: 0.94, source: "ocr" },
        { text: "发布活动", confidence: 0.96, source: "ocr" }
      ]
    });

    const generatedTexts = (next.expectations ?? [])
      .filter((expectation) => expectation.type === "text" && String(expectation.params.source ?? "").startsWith("recording_arrival_"))
      .map((expectation) => expectation.params.expected);

    expect(generatedTexts).toContain("发布活动");
    expect(generatedTexts).not.toContain("已结束");
  });

  it("does not attach automatic expectations to screenshot-only steps", () => {
    const step = createRecordedStep({
      action: { type: "screenshot" },
      order: 1,
      deviceSize,
      id: "step-screenshot",
      createdAt
    });

    expect(step.expectations).toEqual([]);
  });
});

describe("renumberSteps", () => {
  it("keeps step content and rewrites sequential order", () => {
    const steps = [
      createRecordedStep({ action: { type: "tap", x: 1, y: 1 }, order: 9, deviceSize, id: "a", createdAt }),
      createRecordedStep({ action: { type: "wait", durationMs: 500 }, order: 3, deviceSize, id: "b", createdAt })
    ];

    expect(renumberSteps(steps).map((step) => [step.id, step.order])).toEqual([
      ["a", 1],
      ["b", 2]
    ]);
  });
});

describe("mergeActionStepPatch", () => {
  it("merges params without dropping previously recorded runtime metadata", () => {
    const step = createRecordedStep({
      action: { type: "tap", x: 1, y: 1 },
      order: 1,
      deviceSize,
      id: "step-merge",
      createdAt
    });

    const next = mergeActionStepPatch(
      {
        ...step,
        params: {
          graphAsset: { status: "pending" },
          recordingContext: { beforeObservation: { capturedAt: "before" } }
        }
      },
      {
        params: {
          recordingContext: { beforeObservation: { capturedAt: "before" }, afterObservation: { capturedAt: "after" } }
        }
      }
    );

    expect(next.params).toEqual({
      graphAsset: { status: "pending" },
      recordingContext: {
        beforeObservation: { capturedAt: "before" },
        afterObservation: { capturedAt: "after" }
      }
    });
  });

  it("merges asynchronously generated arrival expectations without dropping existing runtime metadata", () => {
    const step = createRecordedStep({
      action: {
        type: "tap_on_element",
        x: 938,
        y: 1933,
        selector: "desc=add btn",
        locator: {
          strategy: "android_uiautomator",
          contentDesc: "add btn",
          packageName: "cn.eeo.classin"
        }
      },
      order: 1,
      deviceSize,
      id: "step-add",
      createdAt
    });
    const withAfter = attachRecordingObservationsToActionStep(step, undefined, {
      platform: "android",
      capturedAt: "2026-06-05T00:00:03.000Z",
      packageName: "cn.eeo.classin",
      activityName: ".PublishActivity",
      uiElements: [{ resourceId: "cn.eeo.classin:id/title", text: "发布活动", packageName: "cn.eeo.classin", clickable: false }],
      ocrTexts: [{ text: "发布活动", confidence: 0.96, source: "ocr" }]
    });

    const merged = mergeActionStepPatch(
      {
        ...step,
        params: {
          graphAsset: { status: "pending" }
        }
      },
      {
        params: {
          recordingContext: withAfter.params.recordingContext
        },
        expectations: withAfter.expectations
      }
    );

    expect(merged.params.graphAsset).toEqual({ status: "pending" });
    expect(merged.params.recordingContext).toEqual(withAfter.params.recordingContext);
    expect(merged.expectations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          params: expect.objectContaining({ expected: "发布活动", source: "recording_arrival_text" })
        })
      ])
    );
  });
});

describe("buildStructuredFlowDraft", () => {
  it("creates a structured flow draft from recorded steps with app version naming and state anchors", () => {
    const first = createRecordedStep({
      action: {
        type: "tap_on_text",
        text: "我是教师",
        x: 300,
        y: 400
      },
      order: 9,
      deviceSize,
      id: "step-teacher",
      createdAt
    });
    const second = createRecordedStep({
      action: {
        type: "tap_on_element",
        x: 500,
        y: 1500,
        locator: {
          strategy: "android_uiautomator",
          resourceId: "cn.eeo.classin:id/create_lesson",
          text: "课堂",
          packageName: "cn.eeo.classin"
        }
      },
      order: 3,
      deviceSize,
      id: "step-create",
      createdAt
    });

    const flow = buildStructuredFlowDraft({
      appName: "ClassIn",
      platform: "android",
      targetApp: {
        androidPackageName: "cn.eeo.classin"
      },
      appVersion: {
        displayVersion: "5.0.8",
        buildNumber: "99856"
      },
      startStateName: "首页",
      endStateName: "新建课堂页",
      role: "teacher",
      steps: [first, second],
      createdAt
    });

    expect(flow).toEqual(
      expect.objectContaining({
        id: "draft",
        name: "ClassIn-5.0.8(99856)-首页-新建课堂页",
        appName: "ClassIn",
        platform: "android",
        targetApp: { androidPackageName: "cn.eeo.classin" },
        appVersion: { displayVersion: "5.0.8", buildNumber: "99856" },
        role: "teacher",
        startStrategy: "restart_app",
        status: "draft",
        version: 1
      })
    );
    expect(flow.startState).toEqual(expect.objectContaining({ id: "state-start", name: "首页" }));
    expect(flow.endState).toEqual(expect.objectContaining({ id: "state-end", name: "新建课堂页" }));
    expect(flow.steps.map((step) => [step.id, step.order, step.action.order])).toEqual([
      ["flow-step-step-teacher", 1, 1],
      ["flow-step-step-create", 2, 2]
    ]);
    expect(flow.steps[0]).toEqual(
      expect.objectContaining({
        beforeState: expect.objectContaining({
          name: "首页"
        }),
        action: expect.objectContaining({
          id: "step-teacher",
          type: "tap_on_text"
        }),
        afterExpectations: expect.arrayContaining([expect.objectContaining({ type: "screen_changed" })]),
        systemGuards: [expect.objectContaining({ type: "no_crash" }), expect.objectContaining({ type: "app_alive" })],
        source: expect.objectContaining({
          sourceType: "manual_recording",
          originalStepId: "step-teacher"
        })
      })
    );
  });

  it("infers Android app identity from semantic locators and avoids placeholder state assertions", () => {
    const first = createRecordedStep({
      action: {
        type: "tap_on_element",
        x: 500,
        y: 1500,
        locator: {
          strategy: "android_uiautomator",
          resourceId: "cn.eeo.classin:id/create_lesson",
          packageName: "cn.eeo.classin"
        }
      },
      order: 1,
      deviceSize,
      id: "step-create",
      createdAt
    });

    const flow = buildStructuredFlowDraft({
      appName: "未命名应用",
      platform: "android",
      targetApp: {
        androidPackageName: "unknown.android.package"
      },
      appVersion: {
        displayVersion: "unknown"
      },
      startStateName: "起点",
      endStateName: "终点",
      steps: [first],
      createdAt
    });

    expect(flow.appName).toBe("cn.eeo.classin");
    expect(flow.targetApp).toEqual({ androidPackageName: "cn.eeo.classin" });
    expect(flow.name).toBe("cn.eeo.classin-unknown-点击元素：id=cn.eeo.classin:id/create_lesson-点击元素：id=cn.eeo.classin:id/create_lesson");
    expect(flow.startState.matchers).toEqual([expect.objectContaining({ type: "resource_id", value: "cn.eeo.classin:id/create_lesson", critical: true })]);
    expect(flow.startState.expectations).toEqual([]);
    expect(flow.steps[0]?.beforeState.expectations).toEqual([]);
    expect(flow.steps[0]?.action.preconditions).toEqual([
      expect.objectContaining({
        type: "text",
        params: expect.objectContaining({
          mode: "exists",
          resourceId: "cn.eeo.classin:id/create_lesson",
          source: "recording_precondition_element"
        })
      })
    ]);
  });

  it("applies installed app version info to a structured flow draft", () => {
    const step = createRecordedStep({
      action: {
        type: "tap_on_element",
        x: 500,
        y: 1500,
        locator: {
          strategy: "android_uiautomator",
          resourceId: "cn.eeo.classin:id/create_lesson",
          packageName: "cn.eeo.classin"
        }
      },
      order: 1,
      deviceSize,
      id: "step-create",
      createdAt
    });
    const flow = buildStructuredFlowDraft({
      appName: "未命名应用",
      platform: "android",
      targetApp: {
        androidPackageName: "unknown.android.package"
      },
      appVersion: {
        displayVersion: "unknown"
      },
      startStateName: "起点",
      endStateName: "终点",
      steps: [step],
      createdAt
    });

    const next = applyInstalledAppInfoToStructuredFlowDraft(flow, {
      packageName: "cn.eeo.classin",
      displayVersion: "5.0.8",
      versionCode: "99856",
      buildNumber: "20260615"
    });

    expect(next.appName).toBe("cn.eeo.classin");
    expect(next.targetApp).toEqual({ androidPackageName: "cn.eeo.classin" });
    expect(next.appVersion).toEqual({
      displayVersion: "5.0.8",
      versionCode: "99856",
      buildNumber: "20260615"
    });
    expect(next.name).toContain("5.0.8(20260615)");
  });

  it("uses recording observation summaries as structured flow state metadata and matchers", () => {
    const observed = attachRecordingObservationsToActionStep(
      createRecordedStep({
        action: { type: "tap", x: 500, y: 1500 },
        order: 1,
        deviceSize,
        id: "step-open-class",
        createdAt
      }),
      {
        platform: "android",
        capturedAt: "2026-06-05T00:00:01.000Z",
        packageName: "cn.eeo.classin",
        activityName: ".MainActivity",
        resolution: { width: 1080, height: 2400 },
        uiElements: [
          { resourceId: "cn.eeo.classin:id/class_list", text: "我是教师", packageName: "cn.eeo.classin", clickable: true },
          { resourceId: "cn.eeo.classin:id/message", text: "消息", packageName: "cn.eeo.classin", clickable: true }
        ],
        ocrTexts: [{ text: "我是教师", confidence: 0.95, source: "ocr" }]
      },
      {
        platform: "android",
        capturedAt: "2026-06-05T00:00:04.000Z",
        packageName: "cn.eeo.classin",
        activityName: ".ClassDetailActivity",
        uiElements: [{ resourceId: "cn.eeo.classin:id/publish_activity", text: "发布活动", packageName: "cn.eeo.classin", clickable: true }],
        ocrTexts: [{ text: "发布活动", confidence: 0.93, source: "ocr" }]
      }
    );

    const flow = buildStructuredFlowDraft({
      appName: "ClassIn",
      platform: "android",
      targetApp: {
        androidPackageName: "cn.eeo.classin"
      },
      appVersion: {
        displayVersion: "5.0.8"
      },
      startStateName: "首页",
      endStateName: "班级详情",
      steps: [observed],
      createdAt
    });

    expect(flow.steps[0]?.beforeState.metadata?.recordingObservation).toEqual(
      expect.objectContaining({
        packageName: "cn.eeo.classin",
        activityName: ".MainActivity",
        uiElementCount: 2
      })
    );
    expect(flow.steps[0]?.beforeState.matchers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "activity", value: ".MainActivity", critical: true }),
        expect.objectContaining({ type: "resource_id", value: "cn.eeo.classin:id/class_list" }),
        expect.objectContaining({ type: "text", value: "我是教师" })
      ])
    );
    expect(flow.steps[0]?.source?.recordingContext).toEqual(
      expect.objectContaining({
        beforeObservation: expect.objectContaining({ activityName: ".MainActivity" }),
        afterObservation: expect.objectContaining({ activityName: ".ClassDetailActivity" })
      })
    );
    expect(flow.steps[0]?.artifacts?.recordingContext).toEqual(flow.steps[0]?.source?.recordingContext);
  });
});
