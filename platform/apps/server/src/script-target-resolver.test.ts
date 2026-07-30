import { describe, expect, it } from "vitest";
import { ScriptTargetResolutionError, ScriptTargetResolver } from "./script-target-resolver.js";

describe("ScriptTargetResolver", () => {
  it("turns text targets and search policy into runtime visual actions without coordinates", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "tap",
      target: { text: "添加好友", area: "content", match: "exact" },
      search: { mode: "auto", direction: "down", maxSwipes: 8 },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "tap_on_text",
      strategy: "semantic_text",
      params: {
        text: "添加好友",
        mode: "equals",
        semanticArea: "content",
        searchMode: "auto",
        searchDirection: "down",
        maxSwipes: 8,
        resetToTop: true
      }
    });
    expect(resolver.resolve({ action: "inputText", target: { text: "课堂名称输入框" }, value: "自动化课堂", appId: "cn.eeo.classin", platform: "android" }))
      .toEqual(expect.objectContaining({
        type: "input_text_to_element",
        strategy: "semantic_text",
        params: expect.objectContaining({
          text: "自动化课堂",
          targetText: "课堂名称输入框",
          clearFirst: true,
          locatorKind: "structural_locator"
        })
      }));
  });

  it("turns a semantic target into an outcome-aware OCR grounding request", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "tap",
      target: { semantic: "进入教学方案的入口", area: "content" },
      search: { mode: "auto", direction: "down", maxSwipes: 6 },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "tap_on_text",
      strategy: "semantic_query",
      params: {
        text: "进入教学方案的入口",
        mode: "semantic",
        semanticArea: "content",
        searchMode: "auto",
        searchDirection: "down",
        maxSwipes: 6,
        resetToTop: true
      }
    });
  });

  it("models picker selection as one compound runtime action", () => {
    const resolver = new ScriptTargetResolver();

    const result = resolver.resolve({
      action: "selectText",
      target: { text: "课程时长" },
      value: "30分钟",
      appId: "cn.eeo.classin",
      platform: "android"
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

  it("resolves a standard top-bar icon without consulting the page locator catalog", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "tap",
      target: { icon: "add", area: "topBar", position: "trailing" },
      search: { mode: "visibleOnly" },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "tap_on_image",
      strategy: "semantic_icon",
      params: {
        locatorKind: "semantic_icon_locator",
        role: "add",
        slot: "trailing",
        orderFromRight: 1,
        semanticArea: "top",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      }
    });
  });

  it("resolves a standard floating add icon without consulting the page locator catalog", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "tap",
      target: { icon: "add", area: "content", position: "trailing" },
      search: { mode: "visibleOnly" },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "tap_on_image",
      strategy: "semantic_icon",
      params: {
        locatorKind: "semantic_icon_locator",
        role: "add",
        slot: "trailing",
        orderFromRight: 1,
        semanticArea: "content",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      }
    });
  });

  it("resolves a checkbox from nearby text without a page element asset or region", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "tap",
      target: { control: "checkbox", area: "content", nearText: "我已阅读并同意" },
      search: { mode: "visibleOnly" },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "tap_on_image",
      strategy: "semantic_control",
      params: {
        locatorKind: "structural_locator",
        structuralLocator: {
          strategy: "near_text",
          role: "checkbox",
          anchorText: "我已阅读并同意",
          clickTarget: "leading_checkbox"
        },
        semanticArea: "content",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      }
    });
  });

  it("rejects unsupported actions for checkbox targets", () => {
    const resolver = new ScriptTargetResolver();

    expect(() => resolver.resolve({
      action: "inputText",
      target: { control: "checkbox", area: "content", nearText: "我已阅读并同意" },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toThrow(ScriptTargetResolutionError);
  });
});
