import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AssetRecordingPanel,
  applyEditedEvidenceValue,
  applySemanticAreaOverrideToRegion,
  clientPointToImagePercent,
  pageNameDraftPatch
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

  it("renders only page identity controls", () => {
    const markup = renderToStaticMarkup(React.createElement(AssetRecordingPanel, {
      ...commonProps,
      currentPage: {
        status: "matched",
        graphVersionId: "version-1",
        nodeId: "page-home",
        pageName: "主页",
        packageName: "cn.eeo.classin",
        confirmedOcrTexts: ["主页"]
      }
    }));

    expect(markup).toContain("页面匹配");
    expect(markup).toContain("重新识别当前页");
    expect(markup).not.toContain("公共定位器");
    expect(markup).not.toContain("连接边");
    expect(markup).not.toContain("页面任务");
    expect(markup).not.toContain("自动探索");
  });

  it("shows first-library initialization instead of page editing controls", () => {
    const markup = renderToStaticMarkup(React.createElement(AssetRecordingPanel, {
      ...commonProps,
      currentPage: { status: "error", message: "当前 App 尚未创建页面资产库" },
      libraryInitialization: {
        platform: "android",
        targetIdentifier: "cn.eeo.classin",
        defaultName: "ClassIn 页面资产"
      },
      onInitializePageAssetLibrary: vi.fn()
    }));

    expect(markup).toContain("初始化页面资产库");
    expect(markup).toContain("cn.eeo.classin");
    expect(markup).toContain("ClassIn 页面资产");
    expect(markup).toContain("创建并识别当前页");
    expect(markup).not.toContain("页面匹配");
    expect(markup).not.toContain("公共定位器");
  });

  it("normalizes page names before saving", () => {
    expect(pageNameDraftPatch(" 班级详情 ")).toEqual({ pageName: "班级详情" });
    expect(pageNameDraftPatch("   ")).toBeUndefined();
  });
});
