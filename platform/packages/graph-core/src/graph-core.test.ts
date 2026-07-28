import { describe, expect, it } from "vitest";
import {
  detectNode,
  type BusinessGraphVersion,
  type BusinessNode,
  type Observation,
  type StateMatcher
} from "./index.js";

describe("graph-core state detector", () => {
  it("matches the current node using activity, resource-id, and UI text", () => {
    const graphVersion = graph({
      nodes: [
        node("root", "root", matcher("activity", "SplashActivity", 3)),
        node(
          "home",
          "page",
          matcher("package", "com.demo", 2),
          matcher("activity", "com.demo.HomeActivity", 3),
          matcher("resource_id", "com.demo:id/join_class", 2),
          matcher("text", "进入课堂", 1)
        )
      ]
    });

    const result = detectNode(observation(), graphVersion, "android");

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("home");
    expect(result.score).toBe(1);
    expect(result.candidates[0]?.matcherResults.every((item) => item.matched)).toBe(true);
  });

  it("uses OCR text as a fallback signal when UI tree text is unavailable", () => {
    const graphVersion = graph({
      nodes: [
        node("home", "page", matcher("activity", "HomeActivity", 2), matcher("ocr_text", "全部班级", 1)),
        node("settings", "page", matcher("activity", "SettingsActivity", 2), matcher("ocr_text", "设置", 1))
      ]
    });

    const result = detectNode(
      {
        ...observation(),
        activityName: "com.demo.HomeActivity",
        uiElements: [],
        ocrTexts: [{ text: "首页 全部班级 我是老师", confidence: 0.9, source: "ocr" }]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("home");
    expect(result.candidates[0]?.matcherResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "activity", matched: true }),
        expect.objectContaining({ type: "ocr_text", matched: true })
      ])
    );
  });

  it("accepts OCR evidence for an equivalent critical UI text matcher when the UI tree is unavailable", () => {
    const graphVersion = graph({
      nodes: [
        node(
          "login",
          "page",
          { ...matcher("activity", "cn.eeo.startup.newui.LoginActivity", 2), critical: true },
          { ...matcher("text", "立即注册", 2), critical: true },
          { ...matcher("package", "cn.eeo.classin", 1), critical: true },
          matcher("text", "登录", 1),
          matcher("ocr_text", "立即注册", 0.5),
          matcher("ocr_text", "登录", 0.5)
        )
      ]
    });

    const result = detectNode(
      {
        ...observation(),
        packageName: "cn.eeo.classin",
        activityName: "cn.eeo.startup.newui.LoginActivity",
        uiElements: [],
        ocrTexts: [
          { text: "立即注册", confidence: 0.9, source: "ocr" },
          { text: "登录", confidence: 0.9, source: "ocr" }
        ]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("login");
    expect(result.candidates[0]?.quality.missingCriticalMatcherIds).toEqual([]);
  });

  it("does not accept UI tree text as a substitute for required OCR evidence", () => {
    const graphVersion = graph({
      nodes: [
        node(
          "login",
          "page",
          { ...matcher("activity", "cn.eeo.startup.newui.LoginActivity", 2), critical: true },
          { ...matcher("ocr_text", "立即注册", 2), critical: true },
          { ...matcher("package", "cn.eeo.classin", 1), critical: true },
          matcher("text", "立即注册", 0.5)
        )
      ]
    });

    const result = detectNode(
      {
        ...observation(),
        packageName: "cn.eeo.classin",
        activityName: "cn.eeo.startup.newui.LoginActivity",
        uiElements: [{ text: "立即注册" }],
        ocrTexts: []
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("unknown");
    expect(result.candidates[0]?.quality.missingCriticalMatcherIds).toContain("ocr_text-立即注册");
  });

  it("returns unknown when no candidate reaches the minimum score", () => {
    const graphVersion = graph({
      nodes: [node("home", "page", matcher("activity", "HomeActivity", 2), matcher("resource_id", "com.demo:id/home", 2))]
    });

    const result = detectNode(
      {
        ...observation(),
        activityName: "com.demo.OtherActivity",
        uiElements: []
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("unknown");
    expect(result.node).toBeUndefined();
    expect(result.score).toBeLessThan(result.threshold);
  });

  it("does not match a business node from app context and a single weak text signal", () => {
    const graphVersion = graph({
      nodes: [node("home-shell", "page", matcher("package", "com.demo", 2), matcher("text", "首页", 4))]
    });

    const result = detectNode(
      {
        ...observation(),
        uiElements: [{ text: "首页" }],
        ocrTexts: []
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("unknown");
    expect(result.candidates[0]?.quality).toEqual(
      expect.objectContaining({
        status: "low_confidence",
        reasons: ["single_weak_state_signal"],
        matchedContextSignals: 1,
        matchedWeakSignals: 1
      })
    );
  });

  it("accepts two weak state signals as a fallback when no strong state anchor exists", () => {
    const graphVersion = graph({
      nodes: [node("teacher-classes", "page", matcher("package", "com.demo", 2), matcher("text", "我是教师", 2), matcher("ocr_text", "全部班级", 2))]
    });

    const result = detectNode(
      {
        ...observation(),
        uiElements: [{ text: "我是教师" }],
        ocrTexts: [{ text: "全部班级", confidence: 0.92, source: "ocr" }]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("teacher-classes");
    expect(result.candidates[0]?.quality).toEqual(
      expect.objectContaining({
        status: "sufficient",
        reasons: [],
        matchedWeakSignals: 2
      })
    );
  });

  it("requires configured strong state anchors to match before accepting weak text evidence", () => {
    const graphVersion = graph({
      nodes: [node("class-detail", "page", matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/activity_list", 3), matcher("text", "课节", 4))]
    });

    const result = detectNode(
      {
        ...observation(),
        uiElements: [{ text: "课节" }],
        ocrTexts: []
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("unknown");
    expect(result.candidates[0]?.quality).toEqual(
      expect.objectContaining({
        status: "low_confidence",
        reasons: ["strong_state_anchor_missing"],
        missingStrongMatcherIds: ["resource_id-com.demo:id/activity_list"]
      })
    );
  });

  it("rejects a node when a configured critical matcher is missing even if other evidence is strong", () => {
    const graphVersion = graph({
      nodes: [
        node(
          "class-detail",
          "page",
          matcher("package", "com.demo", 2),
          { ...matcher("activity", "ClassDetailActivity", 3), critical: true },
          matcher("resource_id", "com.demo:id/activity_list", 3),
          matcher("text", "课节", 3)
        )
      ]
    });

    const result = detectNode(
      {
        ...observation(),
        activityName: "com.demo.OtherActivity",
        uiElements: [{ resourceId: "com.demo:id/activity_list" }, { text: "课节" }],
        ocrTexts: []
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("unknown");
    expect(result.candidates[0]?.quality).toEqual(
      expect.objectContaining({
        status: "low_confidence",
        reasons: expect.arrayContaining(["critical_matcher_missing"]),
        missingCriticalMatcherIds: ["activity-ClassDetailActivity"]
      })
    );
  });

  it("ignores derived region OCR noise when its image region anchor already matched", () => {
    const sharedRegion = { x: 3.4, y: 90.36, width: 92.39, height: 7.36 };
    const graphVersion = graph({
      nodes: [
        node(
          "home",
          "page",
          {
            ...matcher("image_region", "screenshot-region:bottom:%E5%87%BA%E5%8B%A4%200%2F2", 3),
            critical: true,
            region: sharedRegion,
            threshold: 0.9
          },
          {
            ...matcher("ocr_text", "40", 2.4),
            critical: true,
            region: sharedRegion,
            source: { sourceType: "manual_edit", confidence: 0.9 }
          },
          {
            ...matcher("ocr_text", "71", 2.4),
            critical: true,
            region: sharedRegion,
            source: { sourceType: "manual_edit", confidence: 0.9 }
          },
          matcher("ocr_text", "主页", 1.8),
          matcher("ocr_text", "我是教师", 1.8),
          matcher("ocr_text", "全部班级", 1.8)
        )
      ]
    });

    const result = detectNode(
      {
        ...observation(),
        uiElements: [],
        ocrTexts: [
          { text: "主页", confidence: 0.9, source: "ocr" },
          { text: "我是教师", confidence: 0.9, source: "ocr" },
          { text: "全部班级", confidence: 0.9, source: "ocr" }
        ],
        imageRegions: [{ value: "screenshot-region:bottom:%E5%87%BA%E5%8B%A4%200%2F2", region: sharedRegion, similarity: 0.99 }]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("home");
    expect(result.candidates[0]?.quality.missingCriticalMatcherIds).toEqual([]);
  });

  it("does not let one changed screenshot region veto a page when other page anchors match", () => {
    const titleRegion = { x: 16.84, y: 7.64, width: 13.81, height: 4.33 };
    const toolbarRegion = { x: 69.1, y: 7.45, width: 25.74, height: 5.79 };
    const dynamicBottomRegion = { x: 3.1, y: 90.87, width: 95.09, height: 7.44 };
    const graphVersion = graph({
      nodes: [
        node(
          "home",
          "page",
          {
            ...matcher("image_region", "screenshot-region:title:%E4%B8%BB%E9%A1%B5", 3),
            critical: true,
            region: titleRegion,
            threshold: 0.9
          },
          {
            ...matcher("image_region", "screenshot-region:toolbar:contact%7Csearch", 3),
            critical: true,
            region: toolbarRegion,
            threshold: 0.9
          },
          {
            ...matcher("image_region", "screenshot-region:dynamic-bottom:%E5%87%BA%E5%8B%A4%200%2F2", 3),
            critical: true,
            region: dynamicBottomRegion,
            threshold: 0.9
          },
          matcher("ocr_text", "主页", 1.8),
          matcher("ocr_text", "我是教师", 1.8),
          matcher("ocr_text", "全部班级", 1.8)
        )
      ]
    });

    const result = detectNode(
      {
        ...observation(),
        ocrTexts: [
          { text: "主页", confidence: 0.9, source: "ocr" },
          { text: "我是教师", confidence: 0.9, source: "ocr" },
          { text: "全部班级", confidence: 0.9, source: "ocr" }
        ],
        imageRegions: [
          { value: "screenshot-region:title:%E4%B8%BB%E9%A1%B5", region: titleRegion, similarity: 1 },
          { value: "screenshot-region:toolbar:contact%7Csearch", region: toolbarRegion, similarity: 1 },
          { value: "screenshot-region:dynamic-bottom:%E5%87%BA%E5%8B%A4%200%2F2", region: dynamicBottomRegion, similarity: 0.52 }
        ]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("home");
    expect(result.candidates[0]?.quality.missingCriticalMatcherIds).toEqual([]);
  });

  it("does not let non-critical semantic image regions satisfy missing critical pixel regions", () => {
    const titleRegion = { x: 15.52, y: 7.15, width: 16.38, height: 5.06 };
    const toolbarRegion = { x: 70.58, y: 6.91, width: 23.12, height: 5.35 };
    const bottomRegion = { x: 2.2, y: 90.87, width: 93.9, height: 7.1 };
    const graphVersion = graph({
      nodes: [
        node(
          "message",
          "page",
          {
            ...matcher("image_region", "screenshot-region:message-title:%E6%B6%88%E6%81%AF", 3),
            critical: true,
            region: titleRegion,
            threshold: 0.9
          },
          {
            ...matcher("image_region", "screenshot-region:message-toolbar:contact%7Csearch", 3),
            critical: true,
            region: toolbarRegion,
            threshold: 0.9
          },
          {
            ...matcher("image_region", "screenshot-region:message-bottom:fixed_bottom_navigation_container", 3),
            critical: true,
            region: bottomRegion,
            threshold: 0.9
          },
          {
            ...matcher("semantic_image_region", "semantic-image-region:message-title:%E6%B6%88%E6%81%AF", 2.2),
            region: titleRegion,
            threshold: 0.68
          },
          {
            ...matcher("semantic_image_region", "semantic-image-region:message-toolbar:contact%7Csearch", 2.2),
            region: toolbarRegion,
            threshold: 0.68
          },
          {
            ...matcher("semantic_image_region", "semantic-image-region:message-bottom:fixed_bottom_navigation_container", 2.2),
            region: bottomRegion,
            threshold: 0.68
          },
          {
            ...matcher("ocr_text", "消息", 1.8),
            critical: true,
            region: { x: 16.35, y: 8.74, width: 13.21, height: 2.91 }
          }
        )
      ]
    });

    const result = detectNode(
      {
        ...observation(),
        ocrTexts: [{ text: "消息", confidence: 0.9, source: "ocr", region: { x: 170, y: 205, width: 140, height: 68 } }],
        resolution: { width: 1080, height: 2340 },
        imageRegions: [
          { value: "screenshot-region:message-title:%E6%B6%88%E6%81%AF", region: titleRegion, similarity: 0.87 },
          { value: "screenshot-region:message-toolbar:contact%7Csearch", region: toolbarRegion, similarity: 0.88 },
          { value: "screenshot-region:message-bottom:fixed_bottom_navigation_container", region: bottomRegion, similarity: 0.86 },
          { value: "semantic-image-region:message-title:%E6%B6%88%E6%81%AF", region: titleRegion, similarity: 1 },
          { value: "semantic-image-region:message-toolbar:contact%7Csearch", region: toolbarRegion, similarity: 1 },
          { value: "semantic-image-region:message-bottom:fixed_bottom_navigation_container", region: bottomRegion, similarity: 1 }
        ]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("unknown");
    expect(result.node).toBeUndefined();
    expect(result.candidates[0]?.quality.missingCriticalMatcherIds).toEqual([
      "image_region-screenshot-region:message-title:%E6%B6%88%E6%81%AF",
      "image_region-screenshot-region:message-toolbar:contact%7Csearch",
      "image_region-screenshot-region:message-bottom:fixed_bottom_navigation_container"
    ]);
  });

  it("returns multiple candidates when active nodes tie above threshold", () => {
    const graphVersion = graph({
      nodes: [
        node("dialog-a", "business_state", matcher("ocr_text", "允许", 1)),
        node("dialog-b", "business_state", matcher("ocr_text", "允许", 1))
      ]
    });

    const result = detectNode(
      {
        ...observation(),
        ocrTexts: [{ text: "允许 通知权限", source: "ocr" }]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("multiple_candidates");
    expect(result.candidates.map((item) => item.node.id)).toEqual(["dialog-a", "dialog-b"]);
  });

  it("prefers the more specific state when broad and detailed page nodes both match", () => {
    const graphVersion = graph({
      nodes: [
        node("home-shell", "page", matcher("package", "cn.eeo.classin", 2), matcher("text", "主页", 1)),
        node(
          "teacher-classes",
          "page",
          matcher("package", "cn.eeo.classin", 2),
          matcher("text", "主页", 1),
          matcher("text", "我是教师", 3),
          matcher("text", "全部班级", 2)
        )
      ]
    });

    const result = detectNode(
      {
        ...observation(),
        packageName: "cn.eeo.classin",
        uiElements: [{ text: "主页" }, { text: "我是教师" }, { text: "全部班级" }],
        ocrTexts: []
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("teacher-classes");
    expect(result.candidates[0]?.matchedWeight).toBeGreaterThan(result.candidates[1]?.matchedWeight ?? 0);
  });

  it("matches image region signals when similarity reaches the configured threshold", () => {
    const graphVersion = graph({
      nodes: [
        {
          ...node("canvas-home", "page", matcher("image_region", "homework-card", 1)),
          matchers: [
            {
              ...matcher("image_region", "homework-card", 1),
              threshold: 0.92
            }
          ]
        }
      ]
    });

    const result = detectNode(
      {
        ...observation(),
        imageRegions: [
          {
            value: "homework-card",
            similarity: 0.95,
            region: {
              x: 100,
              y: 200,
              width: 300,
              height: 180
            }
          }
        ]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("canvas-home");
  });

  it("matches semantic image region signals when lightweight similarity reaches the configured threshold", () => {
    const semanticValue = "semantic-image-region:bottom-tabs:%E4%B8%BB%E9%A1%B5%7C%E6%B6%88%E6%81%AF%7C%E8%AF%BE%E7%A8%8B%E8%A1%A8";
    const graphVersion = graph({
      nodes: [
        {
          ...node("home-bottom-tabs", "page", matcher("semantic_image_region", semanticValue, 1)),
          matchers: [
            {
              ...matcher("semantic_image_region", semanticValue, 1),
              threshold: 0.68
            }
          ]
        }
      ]
    });

    const result = detectNode(
      {
        ...observation(),
        imageRegions: [
          {
            value: semanticValue,
            similarity: 0.72,
            region: {
              x: 0,
              y: 90,
              width: 100,
              height: 10
            }
          }
        ]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("home-bottom-tabs");
  });

  it("treats page-local bottom OCR tabs as page identity instead of common app navigation", () => {
    const graphVersion = graph({
      nodes: [
        {
          ...node("class-detail", "page"),
          matchers: [
            {
              ...matcher("ocr_text", "目录", 1.8),
              critical: true,
              region: { x: 15, y: 91, width: 14, height: 5 }
            },
            {
              ...matcher("ocr_text", "聊天", 1.8),
              critical: true,
              region: { x: 35, y: 91, width: 14, height: 5 }
            },
            {
              ...matcher("ocr_text", "待办", 1.8),
              critical: true,
              region: { x: 55, y: 91, width: 14, height: 5 }
            },
            {
              ...matcher("ocr_text", "公告", 1.8),
              critical: true,
              region: { x: 75, y: 91, width: 14, height: 5 }
            }
          ]
        }
      ]
    });

    const result = detectNode(
      {
        ...observation(),
        resolution: { width: 1080, height: 2400 },
        ocrTexts: [
          { text: "目录", region: { x: 162, y: 2184, width: 151, height: 80 }, source: "ocr" },
          { text: "聊天", region: { x: 378, y: 2184, width: 151, height: 80 }, source: "ocr" },
          { text: "待办", region: { x: 594, y: 2184, width: 151, height: 80 }, source: "ocr" },
          { text: "公告", region: { x: 810, y: 2184, width: 151, height: 80 }, source: "ocr" }
        ]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("class-detail");
    expect(result.candidates[0]?.quality).toEqual(
      expect.objectContaining({
        status: "sufficient",
        reasons: []
      })
    );
  });

  it("treats a selected bottom navigation item visual anchor as page identity", () => {
    const selectedHomeRegion = { x: 0, y: 90.34, width: 16.67, height: 9.66 };
    const selectedHomeSignature = "screenshot-region:home-bottom-selected-tab:%E4%B8%BB%E9%A1%B5%7Chome_selected_tab";
    const graphVersion = graph({
      nodes: [
        {
          ...node("home", "page"),
          matchers: [
            {
              ...matcher("image_region", selectedHomeSignature, 3),
              critical: true,
              region: selectedHomeRegion,
              threshold: 0.9
            }
          ]
        }
      ]
    });

    const result = detectNode(
      {
        ...observation(),
        imageRegions: [
          {
            value: selectedHomeSignature,
            region: selectedHomeRegion,
            similarity: 0.99
          }
        ]
      },
      graphVersion,
      "android"
    );

    expect(result.status).toBe("matched");
    expect(result.node?.id).toBe("home");
    expect(result.candidates[0]?.quality.reasons).toEqual([]);
  });

  it("matches OCR text only inside the configured relative title region", () => {
    const graphVersion = graph({
      nodes: [
        {
          ...node("create-public-course", "page", matcher("ocr_text", "新建公开课", 3)),
          matchers: [
            {
              ...matcher("ocr_text", "新建公开课", 3),
              critical: true,
              region: { x: 0, y: 0, width: 100, height: 12 }
            }
          ]
        }
      ]
    });

    const bottomTextResult = detectNode(
      {
        ...observation(),
        ocrTexts: [{ text: "新建公开课", region: { x: 120, y: 2100, width: 240, height: 64 }, source: "ocr" }]
      },
      graphVersion,
      "android"
    );

    expect(bottomTextResult.status).toBe("unknown");
    expect(bottomTextResult.candidates[0]?.matcherResults[0]).toEqual(
      expect.objectContaining({
        type: "ocr_text",
        matched: false
      })
    );

    const titleTextResult = detectNode(
      {
        ...observation(),
        ocrTexts: [{ text: "新建公开课", region: { x: 120, y: 80, width: 240, height: 64 }, source: "ocr" }]
      },
      graphVersion,
      "android"
    );

    expect(titleTextResult.status).toBe("matched");
    expect(titleTextResult.node?.id).toBe("create-public-course");
  });

  it("matches OCR title text when old confirmed evidence contains leading symbol noise", () => {
    const graphVersion = graph({
      nodes: [
        {
          ...node("create-public-course", "page", matcher("ocr_text", "< 新建公开课", 3)),
          matchers: [
            {
              ...matcher("ocr_text", "< 新建公开课", 3),
              critical: true,
              region: { x: 0, y: 0, width: 100, height: 12 }
            }
          ]
        }
      ]
    });

    const bottomTextResult = detectNode(
      {
        ...observation(),
        ocrTexts: [{ text: "新建公开课", region: { x: 120, y: 2100, width: 240, height: 64 }, source: "ocr" }]
      },
      graphVersion,
      "android"
    );

    expect(bottomTextResult.status).toBe("unknown");

    const titleTextResult = detectNode(
      {
        ...observation(),
        ocrTexts: [{ text: "新建公开课", region: { x: 120, y: 80, width: 240, height: 64 }, source: "ocr" }]
      },
      graphVersion,
      "android"
    );

    expect(titleTextResult.status).toBe("matched");
    expect(titleTextResult.node?.id).toBe("create-public-course");
  });

  it("matches UI text only inside the configured relative title region", () => {
    const graphVersion = graph({
      nodes: [
        {
          ...node("create-public-course", "page", matcher("text", "新建公开课", 3)),
          matchers: [
            {
              ...matcher("text", "新建公开课", 3),
              critical: true,
              region: { x: 0, y: 0, width: 100, height: 12 }
            }
          ]
        }
      ]
    });

    const bottomTextResult = detectNode(
      {
        ...observation(),
        uiElements: [{ text: "新建公开课", bounds: { x: 120, y: 2100, width: 240, height: 64 } }],
        ocrTexts: []
      },
      graphVersion,
      "android"
    );

    expect(bottomTextResult.status).toBe("unknown");

    const titleTextResult = detectNode(
      {
        ...observation(),
        uiElements: [{ text: "新建公开课", bounds: { x: 120, y: 80, width: 240, height: 64 } }],
        ocrTexts: []
      },
      graphVersion,
      "android"
    );

    expect(titleTextResult.status).toBe("matched");
    expect(titleTextResult.node?.id).toBe("create-public-course");
  });
});

function graph(input: { nodes: BusinessNode[] }): BusinessGraphVersion {
  return {
    id: "graph-version-1",
    graphId: "graph-1",
    version: 1,
    sourceSummary: [],
    status: "active",
    nodes: input.nodes,
    createdAt: "2026-06-11T00:00:00.000Z"
  };
}

function node(id: string, nodeType: BusinessNode["nodeType"], ...matchers: StateMatcher[]): BusinessNode {
  return {
    id,
    graphVersionId: "graph-version-1",
    key: id,
    name: id,
    nodeType,
    tags: [],
    status: "active",
    matchers,
    defaultExpectations: []
  };
}

function matcher(type: StateMatcher["type"], value: string, weight = 1): StateMatcher {
  return {
    id: `${type}-${value}`,
    type,
    value,
    weight
  };
}

function observation(): Observation {
  return {
    id: "observation-1",
    deviceSerial: "device-1",
    platform: "android",
    capturedAt: "2026-06-11T00:00:00.000Z",
    packageName: "com.demo",
    activityName: "com.demo.HomeActivity",
    componentName: "com.demo/com.demo.HomeActivity",
    resolution: {
      width: 1080,
      height: 2400
    },
    orientation: "portrait",
    uiElements: [
      {
        resourceId: "com.demo:id/join_class",
        text: "进入课堂",
        packageName: "com.demo",
        className: "android.widget.Button",
        enabled: true,
        visible: true
      }
    ],
    ocrTexts: [{ text: "进入课堂 首页", confidence: 0.98, source: "ocr" }]
  };
}
