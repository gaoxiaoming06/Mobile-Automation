import { describe, expect, it } from "vitest";
import type { PageAssetCatalog, PageAssetSummary, PageElementLocator } from "./page-asset-catalog.js";
import { ScriptTargetResolutionError, ScriptTargetResolver } from "./script-target-resolver.js";

describe("ScriptTargetResolver", () => {
  it("prefers a public page locator and disables recorded-region center fallback", () => {
    const resolver = new ScriptTargetResolver(new MemoryCatalog([
      {
        id: "add-friend",
        label: "添加好友",
        locatorKind: "top_bar_icon_locator",
        locator: "top-bar-icon:add",
        targetText: "主页",
        visualLocator: { candidates: [{ label: "加号" }] },
        requiresUiTree: false,
        raw: {
          id: "add-friend",
          label: "添加好友",
          locatorKind: "top_bar_icon_locator",
          locator: "top-bar-icon:add",
          targetText: "主页",
          region: { x: 80, y: 0, width: 20, height: 15 },
          visualLocator: { candidates: [{ label: "加号" }] }
        }
      }
    ]));

    const result = resolver.resolve({
      action: "tap",
      target: { pageElement: "add-friend", ocrText: "不会使用" },
      onPage: "home"
    });

    expect(result).toEqual(expect.objectContaining({
      type: "tap_on_image",
      strategy: "page_element:top_bar_icon_locator",
      params: expect.objectContaining({
        locator: "top-bar-icon:add",
        allowRegionFallback: false
      })
    }));
  });

  it("turns OCR and semantic targets into runtime visual actions without coordinates", () => {
    const resolver = new ScriptTargetResolver(new MemoryCatalog([]));

    expect(resolver.resolve({ action: "tap", target: { ocrText: "添加好友" } })).toEqual({
      type: "tap_on_text",
      strategy: "ocr_text",
      params: { text: "添加好友", mode: "contains" }
    });
    expect(resolver.resolve({ action: "inputText", target: { semantic: "课堂名称输入框" }, value: "自动化课堂" }))
      .toEqual(expect.objectContaining({
        type: "input_text_to_element",
        strategy: "semantic_ocr",
        params: expect.objectContaining({
          text: "自动化课堂",
          targetText: "课堂名称输入框",
          clearFirst: true,
          locatorKind: "structural_locator"
        })
      }));
  });

  it("models picker selection as one compound runtime action", () => {
    const resolver = new ScriptTargetResolver(new MemoryCatalog([]));

    const result = resolver.resolve({
      action: "selectText",
      target: { ocrText: "课程时长" },
      value: "30分钟"
    });

    expect(result).toEqual(expect.objectContaining({
      type: "tap_on_image",
      strategy: "runtime_picker",
      params: expect.objectContaining({
        fieldType: "picker_select",
        targetText: "课程时长",
        selectedValue: "30分钟",
        locatorKind: "structural_locator"
      })
    }));
  });

  it("requires onPage for pageElement and rejects unsupported visual-only input", () => {
    const resolver = new ScriptTargetResolver(new MemoryCatalog([]));

    expect(() => resolver.resolve({ action: "tap", target: { pageElement: "missing" } }))
      .toThrow(ScriptTargetResolutionError);
    expect(() => resolver.resolve({ action: "tap", target: { visualTemplate: "template-1" } }))
      .toThrow("visualTemplate template-1 is not executable without a pageElement locator");
  });
});

class MemoryCatalog implements PageAssetCatalog {
  constructor(private readonly locators: PageElementLocator[]) {}
  listPages(): PageAssetSummary[] { return []; }
  getPage(): undefined { return undefined; }
  listLocators(pageId: string): PageElementLocator[] { return pageId === "home" ? this.locators : []; }
  findConfusablePages(): PageAssetSummary[] { return []; }
}
