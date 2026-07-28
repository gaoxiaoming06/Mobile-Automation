import type { ActionStep } from "@mobile-automation/shared";
import type { ScriptTarget } from "@mobile-automation/script-flow";
import type { PageAssetCatalog, PageElementLocator } from "./page-asset-catalog.js";

export type ScriptTargetAction = "tap" | "inputText" | "clearText" | "selectText" | "scrollUntilVisible";

export type ScriptTargetResolutionInput = {
  action: ScriptTargetAction;
  target: ScriptTarget;
  onPage?: string;
  value?: string;
  confirmText?: string;
  direction?: "up" | "down";
  maxSwipes?: number;
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
  constructor(private readonly catalog: PageAssetCatalog) {}

  resolve(input: ScriptTargetResolutionInput): ResolvedScriptTarget {
    if (input.target.pageElement) {
      return this.resolvePageElement(input);
    }
    if (input.target.ocrText) {
      return this.resolveRuntimeText(input, input.target.ocrText, "ocr_text");
    }
    if (input.target.visualTemplate) {
      throw new ScriptTargetResolutionError(
        `visualTemplate ${input.target.visualTemplate} is not executable without a pageElement locator`
      );
    }
    if (input.target.semantic) {
      return this.resolveRuntimeText(input, input.target.semantic, "semantic_ocr");
    }
    throw new ScriptTargetResolutionError("Target has no executable visual or semantic evidence");
  }

  private resolvePageElement(input: ScriptTargetResolutionInput): ResolvedScriptTarget {
    if (!input.onPage) {
      throw new ScriptTargetResolutionError(`pageElement ${input.target.pageElement} requires onPage`);
    }
    const locator = this.catalog.listLocators(input.onPage).find((candidate) => candidate.id === input.target.pageElement);
    if (!locator) {
      throw new ScriptTargetResolutionError(`Page element not found: ${input.onPage}/${input.target.pageElement}`);
    }
    const params = locatorParams(locator);
    const strategy = `page_element:${locator.locatorKind ?? "visual"}`;
    if (input.action === "tap") {
      if (locator.locatorKind === "text_locator" && locator.targetText) {
        return { type: "tap_on_text", strategy, params: { text: locator.targetText, mode: "contains" } };
      }
      if (isStableElementLocator(locator.raw.locator)) {
        return { type: "tap_on_element", strategy, params };
      }
      return { type: "tap_on_image", strategy, params };
    }
    if (input.action === "inputText" || input.action === "clearText") {
      return {
        type: "input_text_to_element",
        strategy,
        params: {
          ...params,
          text: input.value ?? "",
          clearFirst: true,
          ...(input.action === "clearText" ? { clearOnly: true } : {})
        }
      };
    }
    if (input.action === "selectText") {
      return {
        type: "tap_on_image",
        strategy,
        params: {
          ...params,
          fieldType: "picker_select",
          selectedValue: requiredValue(input),
          ...(input.confirmText ? { confirmText: input.confirmText } : {})
        }
      };
    }
    return {
      type: "scroll_until_visible",
      strategy,
      params: {
        ...params,
        direction: input.direction ?? "up",
        maxSwipes: input.maxSwipes ?? 5
      }
    };
  }

  private resolveRuntimeText(input: ScriptTargetResolutionInput, text: string, strategy: "ocr_text" | "semantic_ocr"): ResolvedScriptTarget {
    if (input.action === "tap") {
      return { type: "tap_on_text", strategy, params: { text, mode: "contains" } };
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
          allowRegionFallback: false
        }
      };
    }
    if (input.action === "selectText") {
      return {
        type: "tap_on_image",
        strategy: "runtime_picker",
        params: {
          fieldType: "picker_select",
          targetText: text,
          selectedValue: requiredValue(input),
          ...(input.confirmText ? { confirmText: input.confirmText } : {}),
          locatorKind: "structural_locator",
          structuralLocator: {
            strategy: "ocr_runtime_picker",
            text
          },
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
}

function locatorParams(locator: PageElementLocator): Record<string, unknown> {
  const { id: _id, ...raw } = locator.raw;
  return {
    ...raw,
    allowRegionFallback: false
  };
}

function isStableElementLocator(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const locator = value as Record<string, unknown>;
  return [locator.resourceId, locator.contentDesc, locator.text].some((item) => typeof item === "string" && item.trim());
}

function requiredValue(input: ScriptTargetResolutionInput): string {
  if (!input.value) {
    throw new ScriptTargetResolutionError(`${input.action} requires a value`);
  }
  return input.value;
}
