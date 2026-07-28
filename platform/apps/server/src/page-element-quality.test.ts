import { describe, expect, it } from "vitest";
import type { Observation } from "@mobile-automation/graph-core";
import { validatePageElementAssetQuality } from "./page-element-quality.js";

describe("validatePageElementAssetQuality", () => {
  it("passes a marked element when target text is uniquely found inside the marked semantic area", () => {
    const result = validatePageElementAssetQuality({
      element: {
        locator: "image-region:6,31,88,6",
        elementLabel: "密码输入框",
        targetText: "请输入密码",
        semanticArea: "content",
        region: { x: 6, y: 31, width: 88, height: 6 }
      },
      observation: observation({
        ocrTexts: [
          { text: "请输入手机号/邮箱", confidence: 0.95, region: { x: 120, y: 620, width: 260, height: 40 } },
          { text: "请输入密码", confidence: 0.96, region: { x: 120, y: 760, width: 180, height: 44 } }
        ]
      })
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "pass",
        score: expect.any(Number),
        evidence: expect.objectContaining({
          targetText: "请输入密码",
          semanticArea: "content",
          uniqueCandidate: true
        })
      })
    );
    expect(result.score).toBeGreaterThanOrEqual(0.82);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        source: "ocr_text",
        text: "请输入密码",
        region: { x: 12, y: 31.67, width: 18, height: 1.83 },
        insideMarkedRegion: true,
        semanticArea: "content"
      })
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("marks an element for review when the target text has multiple candidates in the same semantic area", () => {
    const result = validatePageElementAssetQuality({
      element: {
        locator: "image-region:6,47,88,8",
        elementLabel: "创建学习方案",
        targetText: "创建",
        semanticArea: "content",
        region: { x: 6, y: 47, width: 88, height: 8 }
      },
      observation: observation({
        ocrTexts: [
          { text: "创建教学方案", confidence: 0.94, region: { x: 220, y: 940, width: 260, height: 52 } },
          { text: "创建学习方案", confidence: 0.95, region: { x: 220, y: 1140, width: 260, height: 52 } }
        ]
      })
    });

    expect(result.status).toBe("needs_review");
    expect(result.evidence.uniqueCandidate).toBe(false);
    expect(result.candidates).toHaveLength(2);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ambiguous_target_text",
          severity: "warning"
        })
      ])
    );
  });

  it("passes a text locator without a marked region when the exact OCR target is unique", () => {
    const result = validatePageElementAssetQuality({
      element: {
        locator: "text:作业",
        elementLabel: "作业",
        targetText: "作业",
        semanticArea: "content",
        locatorKind: "text_locator"
      },
      observation: observation({
        ocrTexts: [
          { text: "课堂", confidence: 0.95, region: { x: 100, y: 1180, width: 110, height: 44 } },
          { text: "作业", confidence: 0.97, region: { x: 100, y: 1500, width: 100, height: 44 } },
          { text: "支持图片、语音、视频多格式作业提交，AI智能自动批改", confidence: 0.9, region: { x: 100, y: 1560, width: 660, height: 40 } }
        ]
      })
    });

    expect(result.status).toBe("pass");
    expect(result.candidates).toEqual([
      expect.objectContaining({
        source: "ocr_text",
        text: "作业"
      })
    ]);
    expect(result.warnings.map((item) => item.code)).not.toContain("region_missing");
    expect(result.warnings.map((item) => item.code)).not.toContain("ambiguous_target_text");
  });

  it("fails when the marked image region is too small to be a stable operation target", () => {
    const result = validatePageElementAssetQuality({
      element: {
        locator: "image-region:49,50,1.2,0.8",
        elementLabel: "更多",
        semanticArea: "content",
        region: { x: 49, y: 50, width: 1.2, height: 0.8 }
      },
      observation: observation({
        ocrTexts: []
      })
    });

    expect(result.status).toBe("fail");
    expect(result.score).toBeLessThan(0.5);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "region_too_small",
          severity: "error"
        })
      ])
    );
  });

  it("records same-locator replacements as info instead of requiring review", () => {
    const result = validatePageElementAssetQuality({
      element: {
        locator: "image-region:6,29.5,88,6",
        elementLabel: "手机号输入框",
        targetText: "请输入手机号",
        semanticArea: "content",
        region: { x: 6, y: 29.5, width: 88, height: 6 }
      },
      existingElements: [
        {
          id: "phone-input-old",
          label: "手机号输入框",
          locator: "image-region:6,29.5,88,6"
        }
      ],
      observation: observation({
        ocrTexts: [
          { text: "请输入手机号", confidence: 0.96, region: { x: 120, y: 720, width: 220, height: 44 } }
        ]
      })
    });

    expect(result.status).toBe("pass");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_element_locator",
          severity: "info"
        })
      ])
    );
  });

  it("does not treat the semantic action name as OCR target text when targetText is omitted", () => {
    const result = validatePageElementAssetQuality({
      element: {
        locator: "image-region:6,15,88.77,8.78",
        elementLabel: "个人信息",
        semanticArea: "content",
        region: { x: 6, y: 15, width: 88.77, height: 8.78 }
      },
      observation: observation({
        ocrTexts: [
          { text: "小王", confidence: 0.99, region: { x: 272, y: 409, width: 129, height: 68 } }
        ]
      })
    });

    expect(result.status).toBe("pass");
    expect(result.evidence.targetText).toBeUndefined();
    expect(result.warnings.map((item) => item.code)).not.toContain("target_text_not_found");
  });

  it("passes structural profile entries when dynamic avatar and name regions are masked", () => {
    const result = validatePageElementAssetQuality({
      element: {
        locator: "image-region:6,15,88.77,8.78",
        elementLabel: "个人信息",
        semanticArea: "content",
        region: { x: 6, y: 15, width: 88.77, height: 8.78 },
        locatorKind: "structural_locator",
        structuralLocator: {
          kind: "top_profile_entry",
          role: "list_item",
          stableAnchors: [{ kind: "right_chevron", region: { x: 86, y: 17, width: 5, height: 4 } }]
        },
        dynamicMasks: [
          { kind: "avatar", label: "头像", region: { x: 7, y: 15.5, width: 11, height: 7.5 } },
          { kind: "text", label: "昵称", region: { x: 21, y: 16, width: 25, height: 7 } }
        ]
      },
      observation: observation({
        ocrTexts: [
          { text: "小王", confidence: 0.99, region: { x: 272, y: 409, width: 129, height: 68 } }
        ]
      })
    });

    expect(result.status).toBe("pass");
    expect(result.warnings).toEqual([]);
    expect(result.evidence).toEqual(
      expect.objectContaining({
        locatorKind: "structural_locator",
        dynamicMaskCount: 2
      })
    );
  });

  it("asks for review when a visual-only locator contains dynamic text without masks", () => {
    const result = validatePageElementAssetQuality({
      element: {
        locator: "image-region:6,15,88.77,8.78",
        elementLabel: "个人信息",
        semanticArea: "content",
        region: { x: 6, y: 15, width: 88.77, height: 8.78 },
        locatorKind: "visual_locator"
      },
      observation: observation({
        ocrTexts: [
          { text: "小王", confidence: 0.99, region: { x: 272, y: 409, width: 129, height: 68 } }
        ]
      })
    });

    expect(result.status).toBe("needs_review");
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "dynamic_content_unmasked",
        severity: "warning"
      })
    ]);
  });

  it("deduplicates OCR and UI candidates for the same target but warns when the marked region misses the text center", () => {
    const result = validatePageElementAssetQuality({
      element: {
        locator: "image-region:6,53.97,88.58,4.03",
        elementLabel: "账号与安全",
        targetText: "账号与安全",
        semanticArea: "content",
        region: { x: 6, y: 53.97, width: 88.58, height: 4.03 }
      },
      observation: observation({
        ocrTexts: [
          { text: "账号与安全", confidence: 0.99, region: { x: 160, y: 1399, width: 198, height: 52 } }
        ],
        uiElements: [
          { text: "账号与安全", bounds: { x: 164, y: 1401, width: 194, height: 52 } }
        ]
      })
    });

    expect(result.status).toBe("needs_review");
    expect(result.candidates).toHaveLength(1);
    expect(result.evidence).toEqual(
      expect.objectContaining({
        uniqueCandidate: true,
        candidateCount: 1
      })
    );
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "target_outside_marked_region",
        severity: "warning"
      })
    ]);
  });

  it("normalizes OCR boxes with screenshot dimensions instead of Android UI hierarchy dimensions", () => {
    const result = validatePageElementAssetQuality({
      element: {
        locator: "image-region:6,53.97,88.58,4.03",
        elementLabel: "账号与安全",
        targetText: "账号与安全",
        semanticArea: "content",
        region: { x: 6, y: 53.97, width: 88.58, height: 4.03 }
      },
      observation: observation({
        resolution: { width: 1080, height: 2218 },
        screenshot: { width: 1080, height: 2340 },
        ocrTexts: [
          { text: "账号与安全", confidence: 0.99, region: { x: 173.4, y: 1292.66, width: 214.14, height: 48.36 } }
        ]
      })
    });

    expect(result.status).toBe("pass");
    expect(result.candidates).toEqual([
      expect.objectContaining({
        region: { x: 16.06, y: 55.24, width: 19.83, height: 2.07 },
        insideMarkedRegion: true
      })
    ]);
    expect(result.warnings.map((item) => item.code)).not.toContain("target_outside_marked_region");
  });

  it("passes a top bar icon locator without a marked region when structural role and visual candidates exist", () => {
    const result = validatePageElementAssetQuality({
      element: {
        locator: "top-bar-icon:search",
        elementLabel: "搜索",
        semanticArea: "top",
        locatorKind: "top_bar_icon_locator",
        structuralLocator: {
          kind: "top_bar_icon",
          role: "search",
          slot: "right",
          regionConstraint: { semanticArea: "top", region: { x: 84, y: 4, width: 12, height: 5 } }
        },
        visualLocator: {
          strategy: "top_bar_icon_shape",
          role: "search",
          slot: "right",
          searchRegion: { x: 84, y: 4, width: 12, height: 5 },
          candidates: [
            { source: "ai_draft", label: "搜索", role: "search", score: 0.85, region: { x: 84, y: 4, width: 12, height: 5 }, semanticArea: "top" }
          ]
        }
      },
      observation: observation({ ocrTexts: [] })
    });

    expect(result.status).toBe("pass");
    expect(result.warnings.map((item) => item.code)).not.toContain("region_missing");
    expect(result.evidence.locatorKind).toBe("top_bar_icon_locator");
  });

  it("fails a top bar icon locator that lacks structural role or visual candidates", () => {
    const missingCandidates = validatePageElementAssetQuality({
      element: {
        locator: "top-bar-icon:search",
        elementLabel: "搜索",
        semanticArea: "top",
        locatorKind: "top_bar_icon_locator",
        structuralLocator: { kind: "top_bar_icon", role: "search", slot: "right" },
        visualLocator: { strategy: "top_bar_icon_shape", role: "search", slot: "right" }
      },
      observation: observation({ ocrTexts: [] })
    });
    expect(missingCandidates.status).toBe("fail");
    expect(missingCandidates.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "top_bar_icon_candidates_missing", severity: "error" })
      ])
    );

    const missingRole = validatePageElementAssetQuality({
      element: {
        locator: "top-bar-icon:",
        elementLabel: "搜索",
        semanticArea: "top",
        locatorKind: "top_bar_icon_locator"
      },
      observation: observation({ ocrTexts: [] })
    });
    expect(missingRole.status).toBe("fail");
    expect(missingRole.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "top_bar_icon_locator_incomplete", severity: "error" })
      ])
    );
  });

  it("validates an ocr anchor offset locator against the anchor text evidence", () => {
    const found = validatePageElementAssetQuality({
      element: {
        locator: "image-region:60,20,36,6",
        elementLabel: "会员中心右侧图标",
        targetText: "会员中心",
        semanticArea: "content",
        region: { x: 60, y: 20, width: 36, height: 6 },
        locatorKind: "ocr_anchor_offset",
        anchorOffsetPercent: { x: 30, y: 0 }
      },
      observation: observation({
        ocrTexts: [{ text: "会员中心", confidence: 0.97, region: { x: 620, y: 500, width: 180, height: 44 } }]
      })
    });
    expect(found.status).toBe("pass");
    expect(found.evidence.locatorKind).toBe("ocr_anchor_offset");

    const missingAnchor = validatePageElementAssetQuality({
      element: {
        locator: "image-region:60,20,36,6",
        elementLabel: "会员中心右侧图标",
        semanticArea: "content",
        region: { x: 60, y: 20, width: 36, height: 6 },
        locatorKind: "ocr_anchor_offset"
      },
      observation: observation({ ocrTexts: [] })
    });
    expect(missingAnchor.status).toBe("fail");
    expect(missingAnchor.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "anchor_text_missing", severity: "error" })
      ])
    );
  });

  it("warns when an ocr anchor offset locator omits the offset", () => {
    const result = validatePageElementAssetQuality({
      element: {
        locator: "image-region:60,20,36,6",
        elementLabel: "会员中心右侧图标",
        targetText: "会员中心",
        semanticArea: "content",
        region: { x: 60, y: 20, width: 36, height: 6 },
        locatorKind: "ocr_anchor_offset"
      },
      observation: observation({
        ocrTexts: [{ text: "会员中心", confidence: 0.97, region: { x: 620, y: 500, width: 180, height: 44 } }]
      })
    });
    expect(result.status).toBe("needs_review");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "anchor_offset_missing", severity: "warning" })
      ])
    );
  });
});

function observation(input: {
  ocrTexts: NonNullable<Observation["ocrTexts"]>;
  uiElements?: NonNullable<Observation["uiElements"]>;
  resolution?: { width: number; height: number };
  screenshot?: { width: number; height: number };
}): Observation {
  return {
    platform: "android",
    capturedAt: "2026-06-26T00:00:00.000Z",
    resolution: input.resolution ?? { width: 1000, height: 2400 },
    screenshot: input.screenshot ? { sizeBytes: 1, ...input.screenshot } : undefined,
    uiElements: input.uiElements ?? [],
    ocrTexts: input.ocrTexts
  };
}
