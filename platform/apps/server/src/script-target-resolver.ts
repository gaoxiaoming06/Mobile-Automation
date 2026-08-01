import type { ActionStep, InteractionAsset } from "@mobile-automation/shared";
import type { ScriptParameterValue, ScriptSearchPolicy, ScriptTarget } from "@mobile-automation/script-flow";
import type { PageAssetPlatform } from "./page-asset-catalog.js";

export type ScriptTargetAction = "tap" | "inputText" | "clearText" | "selectText" | "scrollUntilVisible";

export type ScriptTargetResolutionInput = {
  action: ScriptTargetAction;
  target: ScriptTarget;
  appId: string;
  platform: PageAssetPlatform;
  onPage?: string;
  value?: string;
  confirmText?: string;
  direction?: "up" | "down";
  maxSwipes?: number;
  search?: ScriptSearchPolicy;
  parameters?: Record<string, ScriptParameterValue>;
  interactionAsset?: InteractionAsset;
};

export type ResolvedScriptTarget = {
  type: ActionStep["type"];
  params: Record<string, unknown>;
  strategy: string;
};

export class ScriptTargetResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptTargetResolutionError";
  }
}

export class ScriptTargetResolver {
  resolve(input: ScriptTargetResolutionInput): ResolvedScriptTarget {
    if (input.interactionAsset) {
      return this.resolveInteractionAsset(input, input.interactionAsset);
    }
    return this.resolveUnbound(input);
  }

  private resolveUnbound(input: ScriptTargetResolutionInput): ResolvedScriptTarget {
    if (input.target.text) {
      return this.resolveRuntimeText(input, input.target.text);
    }
    if (input.target.semantic) {
      return this.resolveSemanticQuery(input, input.target.semantic);
    }
    if (input.target.icon) {
      return this.resolveSemanticIcon(input);
    }
    if (input.target.control) {
      return this.resolveSemanticControl(input);
    }
    throw new ScriptTargetResolutionError("Target has no executable text, semantic query, icon, or control");
  }

  private resolveInteractionAsset(
    input: ScriptTargetResolutionInput,
    asset: InteractionAsset
  ): ResolvedScriptTarget {
    validateInteractionAsset(input, asset);
    const variant = [...asset.locatorVariants]
      .filter((candidate) => candidate.platform === input.platform)
      .sort((left, right) => right.confidence - left.confidence)[0];
    if (!variant) {
      throw new ScriptTargetResolutionError(
        `Interaction asset ${asset.key} has no ${input.platform} locator variant`
      );
    }
    const target = targetFromInteractionAsset(input.target, asset, variant.descriptor);
    const resolved = this.resolveUnbound({ ...input, target, interactionAsset: undefined });
    return {
      ...resolved,
      strategy: `interaction_asset:${resolved.strategy}`,
      params: {
        ...resolved.params,
        ...(input.action === "tap" && input.target.semantic
          ? { fallbackSemanticQuery: input.target.semantic }
          : {}),
        interactionAssetId: asset.id,
        interactionAssetKey: asset.key,
        interactionAssetVersion: asset.version,
        allowRegionFallback: false
      }
    };
  }

  private resolveSemanticQuery(input: ScriptTargetResolutionInput, query: string): ResolvedScriptTarget {
    if (input.action !== "tap") {
      throw new ScriptTargetResolutionError(`Semantic targets do not support ${input.action}`);
    }
    return {
      type: "tap_on_text",
      strategy: "semantic_query",
      params: {
        text: query,
        mode: "semantic",
        ...searchParams(input.target, input.search)
      }
    };
  }

  private resolveRuntimeText(input: ScriptTargetResolutionInput, text: string): ResolvedScriptTarget {
    const strategy = "semantic_text";
    const search = searchParams(input.target, input.search);
    if (input.action === "tap") {
      return {
        type: "tap_on_text",
        strategy,
        params: {
          text,
          mode: input.target.match === "exact" ? "equals" : "contains",
          ...search
        }
      };
    }
    if (input.action === "inputText" || input.action === "clearText") {
      return {
        type: "input_text_to_element",
        strategy,
        params: {
          text: input.value ?? "",
          targetText: text,
          clearFirst: true,
          ...(input.action === "clearText" ? { clearOnly: true } : {}),
          locatorKind: "structural_locator",
          structuralLocator: {
            strategy: "ocr_or_edittext",
            text
          },
          ...search,
          allowRegionFallback: false
        }
      };
    }
    if (input.action === "selectText") {
      const selectedValue = requiredValue(input);
      const pickerMode = runtimePickerMode(text, selectedValue);
      return {
        type: "tap_on_image",
        strategy: "runtime_picker",
        params: {
          fieldType: "picker_select",
          targetText: text,
          selectedValue,
          ...(input.confirmText ? { confirmText: input.confirmText } : {}),
          locatorKind: "structural_locator",
          structuralLocator: {
            strategy: "ocr_runtime_picker",
            text,
            ...(pickerMode ? { pickerMode } : {})
          },
          ...(pickerMode ? { verifySelectedValue: true } : {}),
          ...search,
          allowRegionFallback: false
        }
      };
    }
    return {
      type: "scroll_until_visible",
      strategy,
      params: {
        locator: { text },
        direction: input.direction ?? "up",
        maxSwipes: input.maxSwipes ?? 5
      }
    };
  }

  private resolveSemanticIcon(input: ScriptTargetResolutionInput): ResolvedScriptTarget {
    if (input.action !== "tap") {
      throw new ScriptTargetResolutionError(`Icon targets do not support ${input.action}`);
    }
    const semanticArea = semanticAreaParam(input.target.area);
    const role = (input.target.icon ?? "").trim().toLowerCase();
    if (semanticArea !== "top" && !(semanticArea === "content" && role === "add")) {
      throw new ScriptTargetResolutionError("Standard icon target is not supported in this area");
    }
    return {
      type: "tap_on_image",
      strategy: "semantic_icon",
      params: {
        locatorKind: "semantic_icon_locator",
        role,
        slot: input.target.position,
        semanticArea,
        ...(input.target.nearText ? { anchorText: input.target.nearText } : {}),
        ...searchParams(input.target, input.search),
        allowRegionFallback: false
      }
    };
  }

  private resolveSemanticControl(input: ScriptTargetResolutionInput): ResolvedScriptTarget {
    if (input.target.control === "textField") {
      return this.resolveTextFieldControl(input);
    }
    if (input.target.control === "switch") {
      return this.resolveSwitchControl(input);
    }
    if (input.action !== "tap") {
      throw new ScriptTargetResolutionError(`Control targets do not support ${input.action}`);
    }
    if (input.target.control !== "checkbox" || !input.target.nearText) {
      throw new ScriptTargetResolutionError("Checkbox targets require nearText");
    }
    return {
      type: "tap_on_image",
      strategy: "semantic_control",
      params: {
        locatorKind: "structural_locator",
        structuralLocator: {
          strategy: "near_text",
          role: "checkbox",
          anchorText: input.target.nearText,
          clickTarget: "leading_checkbox"
        },
        ...searchParams(input.target, input.search),
        allowRegionFallback: false
      }
    };
  }

  private resolveSwitchControl(input: ScriptTargetResolutionInput): ResolvedScriptTarget {
    if (input.action !== "tap") {
      throw new ScriptTargetResolutionError(`Switch targets do not support ${input.action}`);
    }
    if (input.target.area !== "content" || !input.target.nearText || input.target.checked === undefined) {
      throw new ScriptTargetResolutionError("Switch targets require nearText, checked, and area content");
    }
    return {
      type: "tap_on_image",
      strategy: "semantic_control",
      params: {
        fieldType: "toggle_set",
        desiredState: input.target.checked ? "on" : "off",
        targetText: input.target.nearText,
        locatorKind: "structural_locator",
        structuralLocator: {
          strategy: "ocr_trailing_switch",
          anchorText: input.target.nearText,
          ...switchRevealParams(input.search)
        },
        ...searchParams(input.target, input.search),
        allowRegionFallback: false
      }
    };
  }

  private resolveTextFieldControl(input: ScriptTargetResolutionInput): ResolvedScriptTarget {
    if (input.action !== "inputText" && input.action !== "clearText") {
      throw new ScriptTargetResolutionError(`Text field targets do not support ${input.action}`);
    }
    if (input.target.area !== "content" || !input.target.scopeText || !input.target.ordinal) {
      throw new ScriptTargetResolutionError("Text field targets require scopeText, ordinal, and area content");
    }
    return {
      type: "input_text_to_element",
      strategy: "semantic_control",
      params: {
        text: input.value ?? "",
        clearFirst: true,
        ...(input.action === "clearText" ? { clearOnly: true } : {}),
        locatorKind: "structural_locator",
        structuralLocator: {
          strategy: "scoped_text_field",
          scopeText: input.target.scopeText,
          ordinal: input.target.ordinal,
          role: "text_input"
        },
        ...searchParams(input.target, input.search),
        allowRegionFallback: false
      }
    };
  }
}

function runtimePickerMode(targetText: string, selectedValue: string): "duration_hours_minutes" | undefined {
  const compactTarget = targetText.toLowerCase().replace(/\s+/g, "");
  const compactValue = selectedValue.replace(/\s+/g, "");
  const durationValue = /^(?:(\d+)小时)?(?:(\d+)分钟)?$/u.exec(compactValue);
  if (!durationValue || (!durationValue[1] && !durationValue[2])) return undefined;
  return /时长|持续时间|duration/u.test(compactTarget) || Boolean(durationValue[1] && durationValue[2])
    ? "duration_hours_minutes"
    : undefined;
}

function validateInteractionAsset(input: ScriptTargetResolutionInput, asset: InteractionAsset): void {
  if (asset.status !== "active") {
    throw new ScriptTargetResolutionError(`Interaction asset ${asset.key} is not active`);
  }
  if (asset.appId !== input.appId) {
    throw new ScriptTargetResolutionError(`Interaction asset ${asset.key} belongs to another App`);
  }
  if (asset.platformScope !== "mobile-both" && asset.platformScope !== input.platform) {
    throw new ScriptTargetResolutionError(`Interaction asset ${asset.key} does not support ${input.platform}`);
  }
  if (asset.owner.kind !== "page" || !input.onPage || asset.owner.key !== input.onPage) {
    throw new ScriptTargetResolutionError(`Interaction asset ${asset.key} does not belong to the current step page`);
  }
  if (!asset.supportedActions.includes(input.action as InteractionAsset["supportedActions"][number])) {
    throw new ScriptTargetResolutionError(`Interaction asset ${asset.key} does not support ${input.action}`);
  }
}

function targetFromInteractionAsset(
  original: ScriptTarget,
  asset: InteractionAsset,
  descriptor: Record<string, unknown>
): ScriptTarget {
  const selectedText = nonEmptyString(descriptor.selectedText) ?? nonEmptyString(asset.semanticContract.text);
  if (selectedText) {
    return {
      ...original,
      text: selectedText,
      semantic: undefined,
      icon: undefined,
      control: undefined
    };
  }
  const semantic = nonEmptyString(asset.semanticContract.semantic);
  if (semantic) {
    return { ...original, text: undefined, semantic, icon: undefined, control: undefined };
  }
  const icon = nonEmptyString(asset.semanticContract.icon);
  if (icon) {
    return { ...original, text: undefined, semantic: undefined, icon, control: undefined };
  }
  const control = nonEmptyString(asset.semanticContract.control);
  if (control) {
    return {
      ...original,
      text: undefined,
      semantic: undefined,
      icon: undefined,
      control: control as ScriptTarget["control"],
      nearText: nonEmptyString(asset.semanticContract.nearText) ?? original.nearText
    };
  }
  throw new ScriptTargetResolutionError(`Interaction asset ${asset.key} has no executable semantic locator`);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function searchParams(target: ScriptTarget, policy: ScriptSearchPolicy | undefined): Record<string, unknown> {
  const semanticArea = semanticAreaParam(target.area);
  const requestedMode = policy?.mode ?? "auto";
  const searchMode = semanticArea === "top" || semanticArea === "bottom" ? "visibleOnly" : requestedMode;
  if (searchMode === "visibleOnly") {
    return {
      ...(semanticArea ? { semanticArea } : {}),
      searchMode
    };
  }
  return {
    ...(semanticArea ? { semanticArea } : {}),
    searchMode,
    searchDirection: policy?.direction ?? "down",
    maxSwipes: policy?.maxSwipes ?? 6,
    resetToTop: policy?.resetToTop ?? true,
    ...(policy?.container ? { searchContainer: policy.container } : {})
  };
}

function semanticAreaParam(area: ScriptTarget["area"]): "top" | "content" | "bottom" | undefined {
  if (area === "topBar") return "top";
  if (area === "bottomBar") return "bottom";
  if (area === "content") return "content";
  return undefined;
}

function switchRevealParams(policy: ScriptSearchPolicy | undefined): Record<string, unknown> {
  if (!policy || policy.mode === "visibleOnly") {
    return {};
  }
  const maxSwipes = policy.maxSwipes && Number.isFinite(policy.maxSwipes)
    ? Math.max(1, Math.floor(policy.maxSwipes))
    : 6;
  return {
    revealStrategy: "search_content",
    restoreMaxSwipes: maxSwipes,
    searchMaxSwipes: maxSwipes
  };
}

function requiredValue(input: ScriptTargetResolutionInput): string {
  if (!input.value) {
    throw new ScriptTargetResolutionError(`${input.action} requires a value`);
  }
  return input.value;
}
