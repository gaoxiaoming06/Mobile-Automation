import { describe, expect, it } from "vitest";
import type { BusinessGraphVersion, BusinessNode, Observation, StateMatcher } from "@mobile-automation/graph-core";
import { matchCurrentPage } from "./page-matcher.js";

describe("PageMatcher", () => {
  it("matches only confirmed active page assets and reports evidence diagnostics", async () => {
    const confirmedHome = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        matcher("package", "cn.eeo.classin", 2, true, "android"),
        matcher("text", "主页", 2, true, "android"),
        matcher("ocr_text", "我是教师", 1.8, true, "mobile-both")
      ],
      metadata: { assetRecordingConfirmed: true }
    });
    const runtimeDraft = node({
      id: "runtime-node",
      key: "runtime.unknown.home",
      name: "待确认页面：首页",
      status: "active",
      tags: ["runtime-discovered"],
      matchers: [matcher("text", "主页", 9, true, "android")]
    });
    const deprecated = node({
      id: "deprecated-page",
      key: "classin.old.home",
      name: "旧主页",
      status: "deprecated",
      tags: ["page-asset"],
      matchers: [matcher("text", "主页", 9, true, "android")],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([runtimeDraft, deprecated, confirmedHome]),
      observation: observation({
        packageName: "cn.eeo.classin",
        uiTexts: ["主页"],
        ocrTexts: ["我是教师"]
      })
    });

    expect(result.match.status).toBe("matched");
    expect(result.match.node?.id).toBe("node-home");
    expect(result.diagnostics.status).toBe("matched");
    expect(result.diagnostics.matchedEvidence).toEqual([
      expect.objectContaining({ type: "package", expected: "cn.eeo.classin", matched: true }),
      expect.objectContaining({ type: "text", expected: "主页", matched: true }),
      expect.objectContaining({ type: "ocr_text", expected: "我是教师", matched: true })
    ]);
    expect(result.diagnostics.missingEvidence).toEqual([]);
    expect(result.match.candidates.map((candidate) => candidate.node.id)).not.toContain("runtime-node");
    expect(result.match.candidates.map((candidate) => candidate.node.id)).not.toContain("deprecated-page");
  });

  it("returns missing evidence when a confirmed page asset does not satisfy its saved matchers", async () => {
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        matcher("package", "cn.eeo.classin", 2, true, "android"),
        matcher("text", "主页", 2, true, "android"),
        matcher("ocr_text", "我是教师", 1.8, true, "mobile-both")
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([home]),
      observation: observation({
        packageName: "cn.eeo.classin",
        uiTexts: ["消息"],
        ocrTexts: ["通知"]
      })
    });

    expect(result.match.status).toBe("unknown");
    expect(result.diagnostics.status).toBe("unknown");
    expect(result.diagnostics.topCandidate?.nodeId).toBe("node-home");
    expect(result.diagnostics.matchedEvidence).toEqual([expect.objectContaining({ type: "package", expected: "cn.eeo.classin" })]);
    expect(result.diagnostics.missingEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", expected: "主页", matched: false, reason: "not_found" }),
        expect.objectContaining({ type: "ocr_text", expected: "我是教师", matched: false, reason: "not_found" })
      ])
    );
  });

  it("enriches observations with visual baseline similarity before matching image regions", async () => {
    const baseline = Buffer.from("same-region");
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        {
          ...matcher("image_region", "screenshot-region:home-title:%E4%B8%BB%E9%A1%B5", 3, true, "mobile-both"),
          threshold: 0.9,
          region: { x: 20, y: 8, width: 30, height: 8 },
          source: { sourceType: "manual_edit", artifactId: "artifact-home-title" }
        }
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([home]),
      observation: observation({
        screenshotBase64: baseline.toString("base64"),
        resolution: { width: 1080, height: 2400 }
      }),
      baselineReader: async (artifactId) => (artifactId === "artifact-home-title" ? baseline : undefined)
    });

    expect(result.match.status).toBe("matched");
    expect(result.diagnostics.matchedEvidence).toEqual([
      expect.objectContaining({
        type: "image_region",
        expected: "screenshot-region:home-title:%E4%B8%BB%E9%A1%B5",
        matched: true
      })
    ]);
    expect(result.observation.imageRegions?.[0]).toEqual(
      expect.objectContaining({
        value: "screenshot-region:home-title:%E4%B8%BB%E9%A1%B5",
        similarity: 1
      })
    );
  });

  it("does not report old derived region OCR noise as missing evidence when the image region matches", async () => {
    const sharedRegion = { x: 3.4, y: 90.36, width: 92.39, height: 7.36 };
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        {
          ...matcher("image_region", "screenshot-region:home-bottom:%E5%87%BA%E5%8B%A4%200%2F2", 3, true, "mobile-both"),
          threshold: 0.9,
          region: sharedRegion
        },
        {
          ...matcher("ocr_text", "40", 2.4, true, "mobile-both"),
          region: sharedRegion,
          source: { sourceType: "manual_edit", confidence: 0.9 }
        }
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([home]),
      observation: observation({
        imageRegions: [
          {
            value: "screenshot-region:home-bottom:%E5%87%BA%E5%8B%A4%200%2F2",
            region: sharedRegion,
            similarity: 0.99
          }
        ]
      })
    });

    expect(result.match.status).toBe("matched");
    expect(result.diagnostics.matchedEvidence).toEqual([expect.objectContaining({ type: "image_region", matched: true })]);
    expect(result.diagnostics.missingEvidence).toEqual([]);
  });

  it("does not report one changed screenshot region when other page anchors are sufficient", async () => {
    const titleRegion = { x: 16.84, y: 7.64, width: 13.81, height: 4.33 };
    const toolbarRegion = { x: 69.1, y: 7.45, width: 25.74, height: 5.79 };
    const dynamicBottomRegion = { x: 3.1, y: 90.87, width: 95.09, height: 7.44 };
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        {
          ...matcher("image_region", "screenshot-region:title:%E4%B8%BB%E9%A1%B5", 3, true, "mobile-both"),
          threshold: 0.9,
          region: titleRegion
        },
        {
          ...matcher("image_region", "screenshot-region:toolbar:contact%7Csearch", 3, true, "mobile-both"),
          threshold: 0.9,
          region: toolbarRegion
        },
        {
          ...matcher("image_region", "screenshot-region:dynamic-bottom:%E5%87%BA%E5%8B%A4%200%2F2", 3, true, "mobile-both"),
          threshold: 0.9,
          region: dynamicBottomRegion
        },
        matcher("ocr_text", "主页", 1.8, true, "mobile-both"),
        matcher("ocr_text", "我是教师", 1.8, true, "mobile-both"),
        matcher("ocr_text", "全部班级", 1.8, true, "mobile-both")
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([home]),
      observation: observation({
        ocrTexts: ["主页", "我是教师", "全部班级"],
        imageRegions: [
          { value: "screenshot-region:title:%E4%B8%BB%E9%A1%B5", region: titleRegion, similarity: 1 },
          { value: "screenshot-region:toolbar:contact%7Csearch", region: toolbarRegion, similarity: 1 },
          { value: "screenshot-region:dynamic-bottom:%E5%87%BA%E5%8B%A4%200%2F2", region: dynamicBottomRegion, similarity: 0.52 }
        ]
      })
    });

    expect(result.match.status).toBe("matched");
    expect(result.diagnostics.missingEvidence).toEqual([]);
  });

  it("matches semantic image regions from OCR and layout tokens when dynamic numbers change", async () => {
    const titleRegion = { x: 15, y: 7, width: 18, height: 6 };
    const semanticValue = "semantic-image-region:title:%E4%B8%BB%E9%A1%B5%7C%E6%88%91%E6%98%AF%E6%95%99%E5%B8%88";
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        {
          ...matcher("semantic_image_region", semanticValue, 2.2, true, "mobile-both"),
          threshold: 0.68,
          region: titleRegion
        }
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([home]),
      observation: observation({
        resolution: { width: 1080, height: 2400 },
        uiTexts: [],
        ocrTexts: ["主页", "我是教师 12"]
      })
    });

    expect(result.match.status).toBe("matched");
    expect(result.diagnostics.matchedEvidence).toEqual([
      expect.objectContaining({
        type: "semantic_image_region",
        expected: semanticValue,
        matched: true
      })
    ]);
    expect(result.observation.imageRegions?.[0]).toEqual(
      expect.objectContaining({
        value: semanticValue,
        similarity: 1
      })
    );
  });

  it("ignores platform-specific tokens in semantic image region signatures", async () => {
    const titleRegion = { x: 15, y: 7, width: 18, height: 6 };
    const semanticValue = "semantic-image-region:title:cn.eeo.classin%3Aid%2Ftitle%7Cuser%20avatar";
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        {
          ...matcher("semantic_image_region", semanticValue, 2.2, true, "mobile-both"),
          threshold: 0.68,
          region: titleRegion
        }
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([home]),
      observation: observation({
        resolution: { width: 1080, height: 2400 },
        uiTexts: ["cn.eeo.classin:id/title", "user avatar"],
        ocrTexts: []
      })
    });

    expect(result.match.status).toBe("unknown");
    expect(result.observation.imageRegions?.[0]).toEqual(
      expect.objectContaining({
        value: semanticValue,
        similarity: 0
      })
    );
  });

  it("does not identify a page from common bottom navigation evidence alone", async () => {
    const bottomTabsRegion = { x: 3.1, y: 88.5, width: 95.09, height: 10.2 };
    const message = node({
      id: "node-message",
      key: "classin.message",
      name: "消息",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        matcher("ocr_text", "消息", 1.8, true, "mobile-both"),
        matcher("ocr_text", "搜索", 1.8, true, "mobile-both"),
        {
          ...matcher(
            "semantic_image_region",
            "semantic-image-region:bottom-tabs:%E4%B8%BB%E9%A1%B5%7C%E6%B6%88%E6%81%AF%7C%E5%BE%85%E5%8A%9E%7C%E8%AF%BE%E7%A8%8B%E8%A1%A8%7C%E7%A9%BA%E9%97%B4%7C%E6%88%90%E9%95%BF",
            2.2,
            false,
            "mobile-both"
          ),
          threshold: 0.68,
          region: bottomTabsRegion
        }
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([message]),
      observation: observation({
        resolution: { width: 1080, height: 2400 },
        ocrTexts: ["待办", "搜索", "主页", "消息", "课程表", "空间", "成长"]
      })
    });

    expect(result.match.status).toBe("unknown");
    expect(result.diagnostics.topCandidate?.nodeId).toBe("node-message");
    expect(result.diagnostics.topCandidate?.quality.reasons).toContain("page_specific_evidence_missing");
  });

  it("accepts page-local bottom OCR tabs as confirmed page identity", async () => {
    const classDetail = node({
      id: "node-class-detail",
      key: "classin.teacher.class.detail.visual",
      name: "班级详情",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        {
          ...matcher("ocr_text", "目录", 1.8, true, "mobile-both"),
          region: { x: 15, y: 91, width: 14, height: 5 }
        },
        {
          ...matcher("ocr_text", "聊天", 1.8, true, "mobile-both"),
          region: { x: 35, y: 91, width: 14, height: 5 }
        },
        {
          ...matcher("ocr_text", "待办", 1.8, true, "mobile-both"),
          region: { x: 55, y: 91, width: 14, height: 5 }
        },
        {
          ...matcher("ocr_text", "公告", 1.8, true, "mobile-both"),
          region: { x: 75, y: 91, width: 14, height: 5 }
        }
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([classDetail]),
      observation: observation({
        resolution: { width: 1080, height: 2400 },
        ocrTextRegions: [
          { text: "目录", region: { x: 162, y: 2184, width: 151, height: 80 } },
          { text: "聊天", region: { x: 378, y: 2184, width: 151, height: 80 } },
          { text: "待办", region: { x: 594, y: 2184, width: 151, height: 80 } },
          { text: "公告", region: { x: 810, y: 2184, width: 151, height: 80 } }
        ]
      })
    });

    expect(result.match.status).toBe("matched");
    expect(result.match.node?.id).toBe("node-class-detail");
    expect(result.diagnostics.topCandidate?.quality.reasons).not.toContain("page_specific_evidence_missing");
    expect(result.diagnostics.matchedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ocr_text", expected: "目录", matched: true }),
        expect.objectContaining({ type: "ocr_text", expected: "聊天", matched: true }),
        expect.objectContaining({ type: "ocr_text", expected: "待办", matched: true }),
        expect.objectContaining({ type: "ocr_text", expected: "公告", matched: true })
      ])
    );
  });

  it("promotes a high-quality page asset candidate when only optional scroll-variant matchers are missing", async () => {
    const classDetail = node({
      id: "node-class-detail",
      key: "classin.teacher.class.detail.visual",
      name: "班级详情",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        {
          ...matcher("ocr_text", "目录", 1.8, true, "mobile-both"),
          region: { x: 15, y: 91, width: 14, height: 5 }
        },
        {
          ...matcher("ocr_text", "聊天", 1.8, true, "mobile-both"),
          region: { x: 35, y: 91, width: 14, height: 5 }
        },
        {
          ...matcher("ocr_text", "待办", 1.8, true, "mobile-both"),
          region: { x: 55, y: 91, width: 14, height: 5 }
        },
        {
          ...matcher("ocr_text", "公告", 1.8, true, "mobile-both"),
          region: { x: 75, y: 91, width: 14, height: 5 }
        },
        {
          ...matcher("ocr_text", "课节", 1, false, "mobile-both"),
          region: { x: 8, y: 5.5, width: 25, height: 7 }
        },
        {
          ...matcher("ocr_text", "学习方案", 1, false, "mobile-both"),
          region: { x: 34, y: 48, width: 34, height: 6 }
        },
        {
          ...matcher("ocr_text", "教学方案", 1, false, "mobile-both"),
          region: { x: 34, y: 40, width: 34, height: 6 }
        },
        {
          ...matcher("image_region", "screenshot-region:class-detail-topbar:%E8%AF%BE%E8%8A%82", 2, false, "mobile-both"),
          threshold: 0.9,
          region: { x: 5, y: 5.5, width: 90, height: 11 }
        }
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([classDetail]),
      observation: observation({
        resolution: { width: 1080, height: 2400 },
        ocrTextRegions: [
          { text: "目录", region: { x: 162, y: 2184, width: 151, height: 80 } },
          { text: "聊天", region: { x: 378, y: 2184, width: 151, height: 80 } },
          { text: "待办", region: { x: 594, y: 2184, width: 151, height: 80 } },
          { text: "公告", region: { x: 810, y: 2184, width: 151, height: 80 } }
        ]
      })
    });

    expect(result.match.status).toBe("matched");
    expect(result.match.node?.id).toBe("node-class-detail");
    expect(result.match.score).toBeLessThan(result.match.threshold);
    expect(result.diagnostics.topCandidate?.quality).toEqual(
      expect.objectContaining({
        status: "sufficient",
        missingCriticalMatcherIds: []
      })
    );
  });

  it("keeps region-bound OCR from matching the same text in a different screen area", async () => {
    const message = node({
      id: "node-message",
      key: "classin.message",
      name: "消息",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        {
          ...matcher("ocr_text", "消息", 1.8, true, "mobile-both"),
          region: { x: 15, y: 7, width: 18, height: 6 }
        }
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([message]),
      observation: observation({
        resolution: { width: 1080, height: 2400 },
        ocrTextRegions: [{ text: "消息", region: { x: 450, y: 2240, width: 80, height: 48 } }]
      })
    });

    expect(result.match.status).toBe("unknown");
    expect(result.diagnostics.missingEvidence).toEqual([
      expect.objectContaining({ type: "ocr_text", expected: "消息", matched: false })
    ]);
  });

  it("matches region-bound OCR inside the same semantic screen area when engine boxes drift", async () => {
    const createCourse = node({
      id: "node-create-public-course",
      key: "runtime.unknown.1u41ebp",
      name: "新建公开课",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        {
          ...matcher("ocr_text", "发布", 1.8, true, "mobile-both"),
          region: { x: 45.91, y: 98.91, width: 8.18, height: 1.09 },
          source: {
            sourceType: "manual_edit",
            confidence: 0.95
          }
        },
        {
          ...matcher("ocr_text", "课堂信息", 1.8, true, "mobile-both"),
          region: { x: 8.47, y: 49.04, width: 18.27, height: 2.52 },
          source: {
            sourceType: "manual_edit",
            confidence: 0.95
          }
        }
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([createCourse]),
      observation: observation({
        resolution: { width: 1080, height: 2400 },
        ocrTextRegions: [
          { text: "发布", region: { x: 493.45, y: 2245.2, width: 93.1, height: 54.48 } },
          { text: "课堂信息", region: { x: 93.1, y: 1114.08, width: 194.4, height: 54.48 } }
        ]
      })
    });

    expect(result.match.status).toBe("matched");
    expect(result.diagnostics.matchedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ocr_text", expected: "发布", matched: true }),
        expect.objectContaining({ type: "ocr_text", expected: "课堂信息", matched: true })
      ])
    );
  });

  it("ignores dynamic sub-regions when comparing visual baselines", async () => {
    const baseline = pgm(4, 4, [
      200, 200, 200, 200,
      200, 200, 200, 200,
      50, 50, 50, 50,
      50, 50, 50, 50
    ]);
    const actual = pgm(4, 4, [
      200, 200, 200, 200,
      200, 200, 200, 200,
      0, 0, 0, 0,
      0, 0, 0, 0
    ]);
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      metadata: {
        assetRecordingConfirmed: true,
        screenshotRegions: [
          {
            id: "region-home",
            label: "主页主体",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            signature: "screenshot-region:region-home:%E4%B8%BB%E9%A1%B5",
            baselineArtifactId: "artifact-home",
            ignoreRegions: [{ x: 0, y: 50, width: 100, height: 50 }]
          }
        ]
      }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([home]),
      observation: observation({
        screenshotBase64: actual.toString("base64"),
        resolution: { width: 4, height: 4 }
      }),
      baselineReader: async (artifactId) => (artifactId === "artifact-home" ? baseline : undefined)
    });

    expect(result.match.status).toBe("matched");
    expect(result.observation.imageRegions?.[0]).toEqual(
      expect.objectContaining({
        value: "screenshot-region:region-home:%E4%B8%BB%E9%A1%B5",
        similarity: 1
      })
    );
  });

  it("keeps visual baseline mismatches below threshold when stable regions change", async () => {
    const baseline = pgm(4, 4, [
      200, 200, 200, 200,
      200, 200, 200, 200,
      50, 50, 50, 50,
      50, 50, 50, 50
    ]);
    const actual = pgm(4, 4, [
      0, 0, 0, 0,
      0, 0, 0, 0,
      50, 50, 50, 50,
      50, 50, 50, 50
    ]);
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      metadata: {
        assetRecordingConfirmed: true,
        screenshotRegions: [
          {
            id: "region-home",
            label: "主页主体",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            signature: "screenshot-region:region-home:%E4%B8%BB%E9%A1%B5",
            baselineArtifactId: "artifact-home",
            ignoreRegions: [{ x: 0, y: 50, width: 100, height: 50 }]
          }
        ]
      }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([home]),
      observation: observation({
        screenshotBase64: actual.toString("base64"),
        resolution: { width: 4, height: 4 }
      }),
      baselineReader: async (artifactId) => (artifactId === "artifact-home" ? baseline : undefined)
    });

    expect(result.match.status).toBe("unknown");
    expect(result.observation.imageRegions?.[0]?.similarity).toBeLessThan(0.9);
    expect(result.diagnostics.missingEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "image_region",
        expected: "screenshot-region:region-home:%E4%B8%BB%E9%A1%B5",
        matched: false
      })
    ]));
  });

  it("automatically ignores overlapping system bar pixels when comparing visual regions", async () => {
    const baseline = pgm(4, 4, [
      10, 10, 10, 10,
      210, 210, 210, 210,
      210, 210, 210, 210,
      210, 210, 210, 210
    ]);
    const actual = pgm(4, 4, [
      250, 250, 250, 250,
      210, 210, 210, 210,
      210, 210, 210, 210,
      210, 210, 210, 210
    ]);
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      metadata: {
        assetRecordingConfirmed: true,
        screenshotRegions: [
          {
            id: "region-title",
            label: "标题区域",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            signature: "screenshot-region:region-title:%E4%B8%BB%E9%A1%B5",
            baselineArtifactId: "artifact-title"
          }
        ]
      }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([home]),
      observation: observation({
        screenshotBase64: actual.toString("base64"),
        resolution: { width: 4, height: 4 }
      }),
      baselineReader: async (artifactId) => (artifactId === "artifact-title" ? baseline : undefined)
    });

    expect(result.match.status).toBe("matched");
    expect(result.observation.imageRegions?.[0]).toEqual(
      expect.objectContaining({
        value: "screenshot-region:region-title:%E4%B8%BB%E9%A1%B5",
        similarity: 1
      })
    );
  });

  it("finds a saved visual region when it shifts slightly instead of relying on the fixed percent crop only", async () => {
    const baseline = pgm(4, 4, [
      0, 0, 0, 0,
      0, 255, 255, 0,
      0, 255, 255, 0,
      0, 0, 0, 0
    ]);
    const actual = pgm(6, 6, [
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 255, 255, 0, 0,
      0, 0, 255, 255, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0
    ]);
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      metadata: {
        assetRecordingConfirmed: true,
        screenshotRegions: [
          {
            id: "region-title",
            label: "标题区域",
            x: 16.67,
            y: 16.67,
            width: 66.67,
            height: 66.67,
            signature: "screenshot-region:region-title:%E4%B8%BB%E9%A1%B5",
            baselineArtifactId: "artifact-title"
          }
        ]
      }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([home]),
      observation: observation({
        screenshotBase64: actual.toString("base64"),
        resolution: { width: 6, height: 6 }
      }),
      baselineReader: async (artifactId) => (artifactId === "artifact-title" ? baseline : undefined)
    });

    expect(result.match.status).toBe("matched");
    expect(result.observation.imageRegions?.[0]?.similarity).toBeGreaterThanOrEqual(0.9);
  });

  it("reuses the same visual baseline within a page matching pass", async () => {
    const baseline = Buffer.from("same-region");
    let baselineReads = 0;
    const region = { x: 20, y: 8, width: 30, height: 8 };
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        {
          ...matcher("image_region", "screenshot-region:home-title:%E4%B8%BB%E9%A1%B5", 3, true, "mobile-both"),
          threshold: 0.9,
          region,
          source: { sourceType: "manual_edit", artifactId: "artifact-home-title" }
        },
        {
          ...matcher("semantic_image_region", "semantic-image-region:home-title:%E4%B8%BB%E9%A1%B5", 2.2, false, "mobile-both"),
          threshold: 0.68,
          region,
          source: { sourceType: "manual_edit", artifactId: "artifact-home-title" }
        }
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    await matchCurrentPage({
      graphVersion: graph([home]),
      observation: observation({
        screenshotBase64: baseline.toString("base64"),
        resolution: { width: 1080, height: 2400 }
      }),
      baselineReader: async (artifactId) => {
        baselineReads += 1;
        return artifactId === "artifact-home-title" ? baseline : undefined;
      }
    });

    expect(baselineReads).toBe(1);
  });

  it("limits visual enrichment to requested candidate nodes", async () => {
    const baseline = pgm(2, 2, [0, 0, 0, 0]);
    let baselineReads = 0;
    const target = node({
      id: "node-target",
      key: "classin.target",
      name: "目标页",
      tags: ["page-asset", "asset-recording"],
      matchers: [matcher("package", "cn.eeo.classin", 2, true, "android"), matcher("text", "目标页", 2, true, "android"), matcher("ocr_text", "目标页", 2, true, "mobile-both")],
      metadata: { assetRecordingConfirmed: true }
    });
    const unrelated = node({
      id: "node-unrelated",
      key: "classin.unrelated",
      name: "无关页",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        {
          ...matcher("image_region", "screenshot-region:unrelated:%E6%97%A0%E5%85%B3", 3, true, "mobile-both"),
          threshold: 0.9,
          region: { x: 0, y: 0, width: 100, height: 100 },
          source: { sourceType: "manual_edit", artifactId: "artifact-unrelated" }
        }
      ],
      metadata: { assetRecordingConfirmed: true }
    });

    const result = await matchCurrentPage({
      graphVersion: graph([target, unrelated]),
      candidateNodeIds: ["node-target"],
      observation: observation({
        uiTexts: ["目标页"],
        ocrTexts: ["目标页"],
        screenshotBase64: baseline.toString("base64"),
        resolution: { width: 2, height: 2 }
      }),
      baselineReader: async (artifactId) => {
        baselineReads += 1;
        return artifactId === "artifact-unrelated" ? baseline : undefined;
      }
    });

    expect(result.match.status).toBe("matched");
    expect(result.match.node?.id).toBe("node-target");
    expect(baselineReads).toBe(0);
  });
});

function graph(nodes: BusinessNode[]): BusinessGraphVersion {
  return {
    id: "version-1",
    graphId: "graph-1",
    version: 1,
    sourceSummary: [],
    status: "active",
    nodes,
    createdAt: "2026-06-18T10:00:00.000Z"
  };
}

function node(input: Partial<BusinessNode> & { id: string; key: string; name: string }): BusinessNode {
  return {
    graphVersionId: "version-1",
    nodeType: "page",
    tags: [],
    status: "active",
    matchers: [],
    defaultExpectations: [],
    platformScope: "android",
    ...input
  };
}

function matcher(
  type: StateMatcher["type"],
  value: string,
  weight: number,
  critical: boolean,
  platformScope: StateMatcher["platformScope"]
): StateMatcher {
  return {
    id: `${type}-${value}`,
    type,
    value,
    weight,
    critical,
    platformScope
  };
}

function observation(input: {
  packageName?: string;
  uiTexts?: string[];
  ocrTexts?: string[];
  ocrTextRegions?: Array<{ text: string; region: NonNullable<Observation["ocrTexts"][number]["region"]> }>;
  imageRegions?: Observation["imageRegions"];
  screenshotBase64?: string;
  resolution?: Observation["resolution"];
} = {}): Observation {
  return {
    id: "observation-1",
    platform: "android",
    capturedAt: "2026-06-18T10:00:00.000Z",
    packageName: input.packageName ?? "cn.eeo.classin",
    activityName: ".MainActivity",
    resolution: input.resolution,
    uiElements: (input.uiTexts ?? []).map((text) => ({ text, visible: true, enabled: true })),
    ocrTexts: [
      ...(input.ocrTexts ?? []).map((text) => ({ text, source: "ocr" as const })),
      ...(input.ocrTextRegions ?? []).map((text) => ({ text: text.text, region: text.region, source: "ocr" as const }))
    ],
    imageRegions: input.imageRegions,
    raw: input.screenshotBase64 ? { screenshotBase64: input.screenshotBase64 } : undefined
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
