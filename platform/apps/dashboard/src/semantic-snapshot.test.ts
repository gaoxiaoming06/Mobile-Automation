import { describe, expect, it } from "vitest";
import {
  createTapRecordingActionFromElementLookup,
  createTapRecordingActionFromSnapshot,
  findCachedElementAtPoint,
  findCachedTextNearPoint,
  type ElementSnapshot,
  type TextSnapshot
} from "./semantic-snapshot";

const capturedAt = "2026-06-10T10:00:00.000Z";
const now = Date.parse(capturedAt) + 100;
const deviceSize = { width: 1000, height: 2000 };

describe("semantic recording snapshots", () => {
  it("uses a fresh Android element snapshot before OCR or coordinates", () => {
    const action = createTapRecordingActionFromSnapshot(
      { x: 120, y: 220 },
      deviceSize,
      {
        element: elementSnapshot(),
        text: textSnapshot()
      },
      now
    );

    expect(action).toEqual(
      expect.objectContaining({
        type: "tap_on_element",
        selector: "id=com.demo:id/join_class",
        x: 120,
        y: 220
      })
    );
  });

  it("falls back to OCR text when no element candidate matches", () => {
    const action = createTapRecordingActionFromSnapshot(
      { x: 700, y: 820 },
      deviceSize,
      {
        element: elementSnapshot(),
        text: textSnapshot()
      },
      now
    );

    expect(action).toEqual(
      expect.objectContaining({
        type: "tap_on_text",
        text: "进入课堂",
        x: 700,
        y: 820
      })
    );
  });

  it("converts a live element lookup into a semantic tap before using coordinates", () => {
    const action = createTapRecordingActionFromElementLookup(
      { x: 943, y: 1030 },
      {
        stable: true,
        locator: {
          strategy: "android_uiautomator",
          resourceId: "cn.eeo.classin:id/publish_activity",
          packageName: "cn.eeo.classin"
        },
        candidate: {
          selector: "id=cn.eeo.classin:id/publish_activity",
          bounds: {
            left: 880,
            top: 960,
            right: 1010,
            bottom: 1090,
            width: 130,
            height: 130,
            centerX: 945,
            centerY: 1025
          }
        }
      }
    );

    expect(action).toEqual(
      expect.objectContaining({
        type: "tap_on_element",
        selector: "id=cn.eeo.classin:id/publish_activity",
        x: 943,
        y: 1030,
        locator: expect.objectContaining({
          resourceId: "cn.eeo.classin:id/publish_activity"
        })
      })
    );
  });

  it("preserves occurrence for repeated element locators during recording", () => {
    const action = createTapRecordingActionFromSnapshot(
      { x: 650, y: 650 },
      deviceSize,
      {
        element: {
          ...elementSnapshot(),
          candidates: [
            {
              ...elementSnapshot().candidates[0]!,
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
            }
          ]
        }
      },
      now
    );

    expect(action).toEqual(
      expect.objectContaining({
        type: "tap_on_element",
        selector: "desc=course Photo#2",
        locator: expect.objectContaining({
          contentDesc: "course Photo",
          occurrence: 2
        })
      })
    );
  });

  it("preserves occurrence from live element lookup during recording", () => {
    const action = createTapRecordingActionFromElementLookup(
      { x: 650, y: 650 },
      {
        stable: true,
        locator: {
          strategy: "android_uiautomator",
          contentDesc: "course Photo",
          packageName: "com.demo",
          occurrence: 2
        },
        candidate: {
          selector: "desc=course Photo#2",
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
        }
      }
    );

    expect(action).toEqual(
      expect.objectContaining({
        type: "tap_on_element",
        selector: "desc=course Photo#2",
        locator: expect.objectContaining({
          contentDesc: "course Photo",
          occurrence: 2
        })
      })
    );
  });

  it("ignores stale snapshots and keeps recording as a coordinate tap", () => {
    const action = createTapRecordingActionFromSnapshot(
      { x: 120, y: 220 },
      deviceSize,
      {
        element: elementSnapshot("2026-06-10T09:59:50.000Z"),
        text: textSnapshot("2026-06-10T09:59:50.000Z")
      },
      now
    );

    expect(action).toEqual({ type: "tap", x: 120, y: 220 });
  });

  it("scales device coordinates to the snapshot coordinate space", () => {
    const candidate = findCachedElementAtPoint(
      { x: 150, y: 230 },
      deviceSize,
      {
        ...elementSnapshot(),
        width: 500,
        height: 1000,
        candidates: [
          {
            ...elementSnapshot().candidates[0]!,
            bounds: {
              left: 50,
              top: 100,
              right: 100,
              bottom: 130,
              width: 50,
              height: 30,
              centerX: 75,
              centerY: 115
            }
          }
        ]
      },
      now
    );

    expect(candidate?.selector).toBe("id=com.demo:id/join_class");
  });

  it("keeps coordinates when the hierarchy only trims system bars", () => {
    const candidate = findCachedElementAtPoint(
      { x: 942, y: 1929 },
      { width: 1080, height: 2340 },
      {
        ...elementSnapshot(),
        width: 1080,
        height: 2218,
        candidates: [
          {
            ...elementSnapshot().candidates[0]!,
            selector: "id=cn.eeo.classin:id/btn_add",
            locator: {
              strategy: "android_uiautomator",
              resourceId: "cn.eeo.classin:id/btn_add",
              packageName: "cn.eeo.classin"
            },
            bounds: {
              left: 864,
              top: 1857,
              right: 1020,
              bottom: 2013,
              width: 156,
              height: 156,
              centerX: 942,
              centerY: 1935
            }
          }
        ]
      },
      now
    );

    expect(candidate?.selector).toBe("id=cn.eeo.classin:id/btn_add");
  });

  it("finds the nearest fresh OCR text box within the click neighborhood", () => {
    const box = findCachedTextNearPoint({ x: 700, y: 820 }, deviceSize, textSnapshot(), now);

    expect(box?.text).toBe("进入课堂");
  });
});

function elementSnapshot(time = capturedAt): ElementSnapshot {
  return {
    capturedAt: time,
    width: 1000,
    height: 2000,
    candidateCount: 2,
    candidates: [
      {
        stable: true,
        selector: "id=com.demo:id/join_class",
        locator: {
          strategy: "android_uiautomator",
          resourceId: "com.demo:id/join_class",
          packageName: "com.demo"
        },
        clickable: true,
        enabled: true,
        depth: 8,
        area: 8000,
        bounds: {
          left: 100,
          top: 200,
          right: 200,
          bottom: 280,
          width: 100,
          height: 80,
          centerX: 150,
          centerY: 240
        }
      }
    ]
  };
}

function textSnapshot(time = capturedAt): TextSnapshot {
  return {
    capturedAt: time,
    width: 1000,
    height: 2000,
    text: "进入课堂",
    candidateCount: 1,
    boxes: [
      {
        text: " 进入课堂\n",
        confidence: 0.92,
        x: 660,
        y: 790,
        width: 160,
        height: 60
      }
    ]
  };
}
