import { describe, expect, it } from "vitest";
import type { InteractionAsset } from "@mobile-automation/shared";
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
    expect(resolver.resolve({
      action: "inputText",
      target: { text: "课堂名称输入框", area: "content" },
      value: "自动化课堂",
      search: { mode: "auto", direction: "down", maxSwipes: 5 },
      appId: "cn.eeo.classin",
      platform: "android"
    }))
      .toEqual(expect.objectContaining({
        type: "input_text_to_element",
        strategy: "semantic_text",
        params: expect.objectContaining({
          text: "自动化课堂",
          targetText: "课堂名称输入框",
          clearFirst: true,
          locatorKind: "structural_locator",
          searchMode: "auto",
          searchDirection: "down",
          maxSwipes: 5,
          resetToTop: true
        })
      }));
  });

  it("forces fixed-bar form targets to visible-only search", () => {
    const resolver = new ScriptTargetResolver();

    const result = resolver.resolve({
      action: "clearText",
      target: { text: "搜索", area: "topBar" },
      search: { mode: "auto", direction: "down", maxSwipes: 6 },
      appId: "cn.eeo.classin",
      platform: "android"
    });

    expect(result.params).toMatchObject({
      targetText: "搜索",
      semanticArea: "top",
      searchMode: "visibleOnly"
    });
    expect(result.params).not.toHaveProperty("maxSwipes");
  });

  it("defaults scroll-until-visible text targets to downward scanning", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "scrollUntilVisible",
      target: { text: "汉娜7812" },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "scroll_until_visible",
      strategy: "semantic_text",
      params: {
        locator: { text: "汉娜7812" },
        direction: "down",
        maxSwipes: 5
      }
    });
  });

  it("rejects legacy semantic targets", () => {
    const resolver = new ScriptTargetResolver();

    expect(() => resolver.resolve({
      action: "tap",
      target: { semantic: "进入教学方案的入口", area: "content" } as any,
      search: { mode: "auto", direction: "down", maxSwipes: 6 },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toThrow(ScriptTargetResolutionError);
  });

  it("turns text targets with semantic match into OCR semantic matching instead of legacy semantic targets", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "tap",
      target: { text: "进入教学方案的入口", match: "semantic", area: "content" },
      search: { mode: "auto", direction: "down", maxSwipes: 6 },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "tap_on_text",
      strategy: "semantic_text",
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

  it("ignores deprecated interaction asset inputs and keeps the script target authoritative", () => {
    const resolver = new ScriptTargetResolver();
    const asset: InteractionAsset = {
      id: "asset-add-friend",
      key: "classin.home.tap.add-friend",
      appId: "cn.eeo.classin",
      platformScope: "android",
      owner: { kind: "page", key: "classin.home" },
      name: "添加好友",
      aliases: ["添加好友"],
      supportedActions: ["tap"],
      semanticContract: { semantic: "进入添加好友页面" },
      locatorVariants: [{
        platform: "android",
        strategy: "ocr_text",
        descriptor: { selectedText: "添加好友" },
        confidence: 0.95
      }],
      status: "active",
      version: 2,
      provenance: { runIds: ["run-trial"], stepIds: ["open-add-friend"], artifactIds: [] },
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z"
    };

    expect(resolver.resolve({
      action: "tap",
      target: { text: "进入添加好友页面", match: "semantic", area: "content" },
      before: { screenRef: "classin.home" },
      appId: "cn.eeo.classin",
      platform: "android",
      interactionAsset: asset
    } as any)).toEqual({
      type: "tap_on_text",
      strategy: "semantic_text",
      params: {
        text: "进入添加好友页面",
        mode: "semantic",
        semanticArea: "content",
        searchMode: "auto",
        searchDirection: "down",
        maxSwipes: 6,
        resetToTop: true
      }
    });
  });

  it("routes visual icon queries to the visual locator instead of OCR text matching", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "tap",
      target: {
        visual: {
          kind: "icon",
          query: "排序图标",
          area: "content",
          nearText: "课节",
          scopeText: "工具区",
          ordinal: 2
        }
      },
      search: { mode: "visibleOnly" },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "tap_on_image",
      strategy: "visual_query",
      params: {
        locatorKind: "visual_query_locator",
        visualKind: "icon",
        visualQuery: "排序图标",
        semanticArea: "content",
        anchorText: "课节",
        scopeText: "工具区",
        ordinal: 2,
        searchMode: "visibleOnly",
        allowRegionFallback: false
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

  it("routes an hour-minute duration value to the bounded duration picker", () => {
    const resolver = new ScriptTargetResolver();

    const result = resolver.resolve({
      action: "selectText",
      target: { text: "课堂时长" },
      value: "10小时40分钟",
      confirmText: "确定",
      appId: "cn.eeo.classin",
      platform: "android"
    });

    expect(result.params).toMatchObject({
      targetText: "课堂时长",
      selectedValue: "10小时40分钟",
      confirmText: "确定",
      structuralLocator: {
        strategy: "ocr_runtime_picker",
        text: "课堂时长",
        pickerMode: "duration_hours_minutes"
      },
      verifySelectedValue: true
    });
  });

  it("routes abbreviated minute duration values to the bounded duration picker", () => {
    const resolver = new ScriptTargetResolver();

    const result = resolver.resolve({
      action: "selectText",
      target: { text: "课堂时长" },
      value: "7小时20分",
      appId: "cn.eeo.classin",
      platform: "android"
    });

    expect(result.params).toMatchObject({
      targetText: "课堂时长",
      selectedValue: "7小时20分",
      structuralLocator: {
        strategy: "ocr_runtime_picker",
        text: "课堂时长",
        pickerMode: "duration_hours_minutes"
      },
      verifySelectedValue: true
    });
  });

  it("routes start-time values to the date-time picker", () => {
    const resolver = new ScriptTargetResolver();

    const result = resolver.resolve({
      action: "selectText",
      target: { text: "开始时间" },
      value: "2026-08-05 14:25",
      appId: "cn.eeo.classin",
      platform: "android"
    });

    expect(result.params).toMatchObject({
      targetText: "开始时间",
      selectedValue: "2026-08-05 14:25",
      structuralLocator: {
        strategy: "ocr_runtime_picker",
        text: "开始时间",
        pickerMode: "date_time"
      },
      verifySelectedValue: true
    });
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
        semanticArea: "top",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      }
    });
  });

  it("resolves a known icon role even when the planner omits a precise area and position", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "tap",
      target: { icon: "search" },
      search: { mode: "visibleOnly" },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "tap_on_image",
      strategy: "semantic_icon",
      params: {
        locatorKind: "semantic_icon_locator",
        role: "search",
        semanticArea: "unknown",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      }
    });
  });

  it("resolves a content search icon as a semantic visual target", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "tap",
      target: { icon: "search", area: "content" },
      search: { mode: "visibleOnly" },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "tap_on_image",
      strategy: "semantic_icon",
      params: {
        locatorKind: "semantic_icon_locator",
        role: "search",
        semanticArea: "content",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      }
    });
  });

  it("resolves a standard floating add icon without consulting the page locator catalog", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "tap",
      target: { icon: "add", area: "content", position: "trailing", vertical: "bottom" },
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
        verticalSlot: "bottom",
        semanticArea: "content",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      }
    });
  });

  it("does not encode a role-specific visual order for standard top-bar icons", () => {
    const resolver = new ScriptTargetResolver();

    const search = resolver.resolve({
      action: "tap",
      target: { icon: "search", area: "topBar", position: "trailing" },
      search: { mode: "visibleOnly" },
      appId: "cn.eeo.classin",
      platform: "android"
    });
    const share = resolver.resolve({
      action: "tap",
      target: { icon: "share", area: "topBar", position: "trailing" },
      search: { mode: "visibleOnly" },
      appId: "cn.eeo.classin",
      platform: "android"
    });

    expect(search.params).not.toHaveProperty("orderFromRight");
    expect(share.params).not.toHaveProperty("orderFromRight");
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

  it("resolves a switch target to a stateful trailing switch locator", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "tap",
      target: { control: "switch", area: "content", nearText: "录制ClassIn教室", checked: true },
      search: { mode: "visibleOnly" },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "tap_on_image",
      strategy: "semantic_control",
      params: {
        fieldType: "toggle_set",
        desiredState: "on",
        targetText: "录制ClassIn教室",
        locatorKind: "structural_locator",
        structuralLocator: {
          strategy: "ocr_trailing_switch",
          anchorText: "录制ClassIn教室"
        },
        semanticArea: "content",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      }
    });
  });

  it("enables content search for switch targets when requested by the script", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "tap",
      target: { control: "switch", area: "content", nearText: "AI 内容总结", checked: false },
      search: { mode: "auto", direction: "down", maxSwipes: 3 },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual(expect.objectContaining({
      params: expect.objectContaining({
        desiredState: "off",
        structuralLocator: expect.objectContaining({
          strategy: "ocr_trailing_switch",
          anchorText: "AI 内容总结",
          revealStrategy: "search_content",
          restoreMaxSwipes: 3,
          searchMaxSwipes: 3
        })
      })
    }));
  });

  it("resolves a scoped text field control to a runtime structural input locator", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "inputText",
      target: { control: "textField", area: "content", scopeText: "课堂信息", ordinal: 1 },
      value: "自动化课堂",
      search: { mode: "visibleOnly" },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "input_text_to_element",
      strategy: "semantic_control",
      params: {
        text: "自动化课堂",
        clearFirst: true,
        locatorKind: "structural_locator",
        structuralLocator: {
          strategy: "scoped_text_field",
          scopeText: "课堂信息",
          ordinal: 1,
          role: "text_input"
        },
        semanticArea: "content",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      }
    });
  });

  it("resolves an ordinal-only text field control to a runtime structural input locator", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "inputText",
      target: { control: "textField", area: "content", ordinal: 1 },
      value: "自动化课堂",
      search: { mode: "auto", direction: "down", maxSwipes: 4 },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "input_text_to_element",
      strategy: "semantic_control",
      params: {
        text: "自动化课堂",
        clearFirst: true,
        locatorKind: "structural_locator",
        structuralLocator: {
          strategy: "ordinal_text_field",
          ordinal: 1,
          role: "text_input"
        },
        semanticArea: "content",
        searchMode: "auto",
        searchDirection: "down",
        maxSwipes: 4,
        resetToTop: true,
        allowRegionFallback: false
      }
    });
  });

  it("passes sensitive input metadata to scoped runtime text fields", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "inputText",
      target: { control: "textField", area: "content", scopeText: "立即注册下方", ordinal: 2 },
      value: "secret",
      valueParamKey: "password",
      sensitiveInput: true,
      appId: "cn.eeo.classin",
      platform: "harmony"
    }).params).toMatchObject({
      text: "secret",
      valueParamKey: "password",
      sensitiveInput: true,
      structuralLocator: {
        strategy: "scoped_text_field",
        scopeText: "立即注册下方",
        ordinal: 2,
        role: "text_input"
      }
    });
  });

  it("routes relative text field anchors to runtime structural input locators", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "inputText",
      target: { control: "textField", area: "content", anchorText: "开始时间", relation: "above" },
      value: "自动化课堂",
      search: { mode: "auto", direction: "down", maxSwipes: 4 },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "input_text_to_element",
      strategy: "semantic_control",
      params: {
        text: "自动化课堂",
        clearFirst: true,
        locatorKind: "structural_locator",
        structuralLocator: {
          strategy: "ocr_relative_input",
          anchorText: "开始时间",
          relation: "nearest_text_above",
          role: "text_input"
        },
        semanticArea: "content",
        searchMode: "auto",
        searchDirection: "down",
        maxSwipes: 4,
        resetToTop: true,
        allowRegionFallback: false
      }
    });
  });

  it("resolves content icons to runtime semantic icon locators", () => {
    const resolver = new ScriptTargetResolver();

    expect(resolver.resolve({
      action: "tap",
      target: { icon: "emoji", area: "content", position: "leading" },
      search: { mode: "visibleOnly" },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toEqual({
      type: "tap_on_image",
      strategy: "semantic_icon",
      params: {
        locatorKind: "semantic_icon_locator",
        role: "emoji",
        slot: "leading",
        semanticArea: "content",
        searchMode: "visibleOnly",
        allowRegionFallback: false
      }
    });

    expect(resolver.resolve({
      action: "tap",
      target: { icon: "arrowUp", area: "content", position: "trailing" },
      appId: "cn.eeo.classin",
      platform: "harmony"
    }).params).toMatchObject({
      locatorKind: "semantic_icon_locator",
      role: "arrowup",
      slot: "trailing",
      semanticArea: "content",
      allowRegionFallback: false
    });
  });

  it("ignores legacy frozen interaction asset locators", () => {
    const resolver = new ScriptTargetResolver();
    const result = resolver.resolve({
      action: "tap",
      target: { text: "进入添加好友页面", match: "semantic" },
      before: { screenRef: "classin.home" },
      appId: "cn.eeo.classin",
      platform: "android",
      interactionAsset: interactionAsset()
    } as any);

    expect(result).toEqual({
      type: "tap_on_text",
      strategy: "semantic_text",
      params: expect.objectContaining({
        text: "进入添加好友页面",
        mode: "semantic"
      })
    });
    expect(result.params).not.toHaveProperty("interactionAssetId");
    expect(JSON.stringify(result)).not.toMatch(/"(?:coordinate|region|bounds|x|y)"\s*:/i);
  });
});

function interactionAsset(): InteractionAsset {
  return {
    id: "asset-1",
    key: "classin.home.tap.text.添加好友",
    appId: "cn.eeo.classin",
    platformScope: "android",
    owner: { kind: "page", key: "classin.home" },
    name: "添加好友",
    aliases: ["添加好友"],
    supportedActions: ["tap"],
    semanticContract: { text: "添加好友" },
    locatorVariants: [{
      platform: "android",
      strategy: "ocr_text",
      descriptor: { selectedText: "添加好友" },
      confidence: 0.95
    }],
    status: "active",
    version: 2,
    provenance: { runIds: ["run-1"], stepIds: ["open-add-friend"], artifactIds: [] },
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z"
  };
}
