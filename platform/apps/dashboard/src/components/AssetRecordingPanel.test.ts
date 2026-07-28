import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AssetRecordingPanel,
  applyEditedEvidenceValue,
  applySemanticAreaOverrideToRegion,
  clientPointToImagePercent,
  pageNameDraftPatch,
  updateEditableScreenshotRegion
} from "./AssetRecordingPanel.js";

const commonProps = {
  selectedSerial: "device-1",
  busy: false,
  onPageDraftChange: vi.fn(),
  onIdentifyCurrentPage: vi.fn(),
  onSaveCurrentPageAsset: vi.fn()
};

describe("AssetRecordingPanel", () => {
  it("maps pointer positions to image percentages", () => {
    expect(clientPointToImagePercent(
      { clientX: 400, clientY: 500 },
      { left: 250, top: 100, width: 300, height: 600 }
    )).toEqual({ x: 50, y: 66.67 });
  });

  it("draws, moves, and resizes screenshot evidence regions", () => {
    expect(updateEditableScreenshotRegion({
      type: "draw",
      start: { x: 60, y: 40 },
      region: { id: "region", label: "身份区域", x: 60, y: 40, width: 0, height: 0 }
    }, { x: 50, y: 55 })).toEqual({
      id: "region",
      label: "身份区域",
      x: 50,
      y: 40,
      width: 10,
      height: 15,
      semanticArea: "content",
      coordinateSpace: "screen"
    });

    expect(updateEditableScreenshotRegion({
      type: "move",
      start: { x: 15, y: 25 },
      region: { id: "region", label: "身份区域", x: 10, y: 20, width: 30, height: 15 }
    }, { x: 95, y: 90 })).toEqual({
      id: "region",
      label: "身份区域",
      x: 70,
      y: 85,
      width: 30,
      height: 15,
      semanticArea: "bottom",
      coordinateSpace: "screen"
    });
  });

  it("keeps an explicit semantic area override", () => {
    expect(applySemanticAreaOverrideToRegion(
      { id: "title", label: "标题", x: 10, y: 2, width: 30, height: 8 },
      "content"
    )).toEqual({
      id: "title",
      label: "标题",
      x: 10,
      y: 2,
      width: 30,
      height: 8,
      semanticArea: "content",
      coordinateSpace: "screen"
    });
  });

  it("preserves region metadata when editing OCR evidence", () => {
    expect(applyEditedEvidenceValue({
      item: { kind: "OCR 文字", value: "ocr_text:旧标题@region(10,2,30,8)" },
      nextValue: "新标题",
      confirmedMatchers: [],
      confirmedUiTexts: [],
      confirmedOcrTexts: ["ocr_text:旧标题@region(10,2,30,8)"]
    })).toEqual({
      confirmedOcrTexts: ["ocr_text:新标题@region(10,2,30,8)"]
    });
  });

  it("renders only page identity and public locator tabs", () => {
    const markup = renderToStaticMarkup(React.createElement(AssetRecordingPanel, {
      ...commonProps,
      currentPage: {
        status: "matched",
        graphVersionId: "version-1",
        nodeId: "page-home",
        pageName: "主页",
        packageName: "cn.eeo.classin",
        confirmedOcrTexts: ["主页"],
        elements: []
      }
    }));

    expect(markup).toContain("页面匹配");
    expect(markup).toContain("公共定位器");
    expect(markup).not.toContain("连接边");
    expect(markup).not.toContain("页面任务");
    expect(markup).not.toContain("自动探索");
  });

  it("shows reusable locators without navigation outcomes", () => {
    const markup = renderToStaticMarkup(React.createElement(AssetRecordingPanel, {
      ...commonProps,
      initialDetailTab: "actions",
      currentPage: {
        status: "matched",
        graphVersionId: "version-1",
        nodeId: "page-home",
        pageName: "主页",
        elements: [{
          id: "home-add",
          label: "右上角加号",
          locator: "text:+",
          locatorKind: "text_locator",
          source: "manual"
        }]
      }
    }));

    expect(markup).toContain("公共定位器");
    expect(markup).toContain("右上角加号");
    expect(markup).not.toContain("目标页面");
    expect(markup).not.toContain("结果类型");
  });

  it("normalizes page names before saving", () => {
    expect(pageNameDraftPatch(" 班级详情 ")).toEqual({ pageName: "班级详情" });
    expect(pageNameDraftPatch("   ")).toBeUndefined();
  });
});
