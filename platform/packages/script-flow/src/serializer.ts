import { stringify } from "yaml";
import { validateScriptFlowDocument } from "./parser.js";
import type { ScriptFlowDocument } from "./types.js";

export function serializeScriptFlow(document: ScriptFlowDocument): string {
  const validated = validateScriptFlowDocument(document);
  return stringify(validated, {
    lineWidth: 0,
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN"
  });
}
