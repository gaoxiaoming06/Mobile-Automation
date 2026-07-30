import { parseDocument } from "yaml";
import type {
  ScriptFlowDocument,
  ScriptFlowKind,
  ScriptFlowPlatform,
  ScriptFlowState,
  ScriptFlowStartStrategy,
  ScriptParameterDefinition,
  ScriptParameterOption,
  ScriptParameterType,
  ScriptParameterValue,
  ScriptSearchPolicy,
  ScriptStep,
  ScriptStepRisk,
  ScriptTarget
} from "./types.js";

export type ScriptFlowValidationIssue = {
  path: string;
  message: string;
};

export class ScriptFlowValidationError extends Error {
  constructor(readonly issues: ScriptFlowValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "ScriptFlowValidationError";
  }
}

const rootFields = new Set(["version", "kind", "name", "description", "app", "start", "entry", "outcome", "parameters", "steps", "tags"]);
const stepBaseFields = new Set(["id", "name", "onPage", "expectPage", "timeoutMs", "risk", "with"]);
const actionFields = [
  "launchApp",
  "tap",
  "inputText",
  "clearText",
  "selectText",
  "swipe",
  "scrollUntilVisible",
  "reachPage",
  "waitForPage",
  "assertPage",
  "assertText",
  "runFlow",
  "repeat",
  "when"
] as const;
const targetFields = new Set(["text", "semantic", "icon", "control", "area", "position", "nearText", "match"]);
const parameterReferencePattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function parseScriptFlow(source: string): ScriptFlowDocument {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new ScriptFlowValidationError(document.errors.map((error) => ({
      path: "$",
      message: error.message
    })));
  }
  return validateScriptFlowDocument(document.toJS());
}

export function validateScriptFlowDocument(value: unknown): ScriptFlowDocument {
  const issues: ScriptFlowValidationIssue[] = [];
  const root = recordAt(value, "$", issues);
  rejectUnknownFields(root, rootFields, "", issues);

  if (root.version !== 1) {
    issues.push({ path: "version", message: "ScriptFlow version must be 1" });
  }
  const kind = readKind(root.kind, issues);
  const name = requiredString(root.name, "name", issues);
  const description = optionalString(root.description, "description", issues);
  const app = readApp(root.app, issues);
  const start = readStart(root.start, issues);
  const entry = readFlowState(root.entry, "entry", issues);
  const outcome = readFlowState(root.outcome, "outcome", issues);
  const parameters = readParameters(root.parameters, issues);
  const steps = readSteps(root.steps, "steps", issues);
  const tags = readStringArray(root.tags, "tags", issues, []);

  validateUniqueStepIds(steps, issues);
  validateParameterReferences({ root, parameters, steps, issues });

  if (issues.length > 0) {
    throw new ScriptFlowValidationError(issues);
  }

  return {
    version: 1,
    kind,
    name,
    ...(description ? { description } : {}),
    app,
    ...(start ? { start } : {}),
    ...(entry ? { entry } : {}),
    ...(outcome ? { outcome } : {}),
    parameters,
    steps,
    tags
  };
}

function readKind(value: unknown, issues: ScriptFlowValidationIssue[]): ScriptFlowKind {
  if (value === undefined) {
    return "case";
  }
  if (value === "case" || value === "scenario") {
    return value;
  }
  issues.push({ path: "kind", message: "Test kind must be case or scenario" });
  return "case";
}

function readFlowState(value: unknown, path: "entry" | "outcome", issues: ScriptFlowValidationIssue[]): ScriptFlowState | undefined {
  if (value === undefined) {
    return undefined;
  }
  const state = recordAt(value, path, issues);
  rejectUnknownFields(state, new Set(["page", "session", "role"]), path, issues);
  const page = optionalString(state.page, `${path}.page`, issues);
  const session = optionalString(state.session, `${path}.session`, issues);
  const role = optionalString(state.role, `${path}.role`, issues);
  if (session && session !== "authenticated" && session !== "unauthenticated") {
    issues.push({ path: `${path}.session`, message: "Session must be authenticated or unauthenticated" });
  }
  if (!page && !session) {
    issues.push({ path, message: "State requires a page or session" });
  }
  if (role && session !== "authenticated") {
    issues.push({ path: `${path}.role`, message: "Role requires an authenticated session" });
  }
  return {
    ...(page ? { page } : {}),
    ...(session === "authenticated" || session === "unauthenticated" ? { session } : {}),
    ...(role ? { role } : {})
  };
}

function readApp(value: unknown, issues: ScriptFlowValidationIssue[]): ScriptFlowDocument["app"] {
  const app = recordAt(value, "app", issues);
  rejectUnknownFields(app, new Set(["id", "platform"]), "app", issues);
  const id = requiredString(app.id, "app.id", issues);
  const platform = requiredString(app.platform, "app.platform", issues);
  if (!isScriptPlatform(platform)) {
    issues.push({ path: "app.platform", message: "Platform must be android, ios, harmony, or flutter" });
  }
  return { id, platform: isScriptPlatform(platform) ? platform : "android" };
}

function readStart(value: unknown, issues: ScriptFlowValidationIssue[]): ScriptFlowDocument["start"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const start = recordAt(value, "start", issues);
  rejectUnknownFields(start, new Set(["strategy"]), "start", issues);
  const strategy = requiredString(start.strategy, "start.strategy", issues);
  if (!isStartStrategy(strategy)) {
    issues.push({ path: "start.strategy", message: "Unknown start strategy" });
    return undefined;
  }
  return { strategy };
}

function readParameters(value: unknown, issues: ScriptFlowValidationIssue[]): Record<string, ScriptParameterDefinition> {
  if (value === undefined) {
    return {};
  }
  const parameters = recordAt(value, "parameters", issues);
  const result: Record<string, ScriptParameterDefinition> = {};
  for (const [key, rawDefinition] of Object.entries(parameters)) {
    const path = `parameters.${key}`;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      issues.push({ path, message: "Parameter name must be an identifier" });
    }
    const definition = recordAt(rawDefinition, path, issues);
    rejectUnknownFields(
      definition,
      new Set(["type", "label", "description", "required", "default", "sensitive", "control", "options", "advanced"]),
      path,
      issues
    );
    const type = requiredString(definition.type, `${path}.type`, issues);
    if (!isParameterType(type)) {
      issues.push({ path: `${path}.type`, message: "Parameter type must be string, number, boolean, or datetime" });
    }
    const parameterType = isParameterType(type) ? type : "string";
    const defaultValue = readParameterDefault(definition.default, parameterType, `${path}.default`, issues);
    const options = readParameterOptions(definition.options, `${path}.options`, issues);
    if (definition.sensitive === true && definition.default !== undefined) {
      issues.push({ path: `${path}.default`, message: "Sensitive parameter cannot define a default" });
    }
    result[key] = {
      type: parameterType,
      ...optionalStringProperty(definition.label, `${path}.label`, "label", issues),
      ...optionalStringProperty(definition.description, `${path}.description`, "description", issues),
      ...optionalBooleanProperty(definition.required, `${path}.required`, "required", issues),
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
      ...optionalBooleanProperty(definition.sensitive, `${path}.sensitive`, "sensitive", issues),
      ...readParameterControl(definition.control, `${path}.control`, issues),
      ...(options ? { options } : {}),
      ...optionalBooleanProperty(definition.advanced, `${path}.advanced`, "advanced", issues)
    };
  }
  return result;
}

function readParameterDefault(
  value: unknown,
  type: ScriptParameterType,
  path: string,
  issues: ScriptFlowValidationIssue[]
): ScriptParameterValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!parameterValueMatchesType(value, type)) {
    issues.push({ path, message: `Default value must match parameter type ${type}` });
    return undefined;
  }
  return value as ScriptParameterValue;
}

function readParameterOptions(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): ScriptParameterOption[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push({ path, message: "Options must be an array" });
    return undefined;
  }
  return value.map((rawOption, index) => {
    const optionPath = `${path}[${index}]`;
    const option = recordAt(rawOption, optionPath, issues);
    rejectUnknownFields(option, new Set(["label", "value"]), optionPath, issues);
    const label = requiredString(option.label, `${optionPath}.label`, issues);
    if (!isParameterValue(option.value)) {
      issues.push({ path: `${optionPath}.value`, message: "Option value must be string, number, or boolean" });
    }
    return {
      label,
      value: isParameterValue(option.value) ? option.value : ""
    };
  });
}

function readParameterControl(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): Pick<ScriptParameterDefinition, "control"> {
  if (value === undefined) {
    return {};
  }
  if (value === "text" || value === "number" || value === "toggle" || value === "datetime" || value === "select") {
    return { control: value };
  }
  issues.push({ path, message: "Unknown parameter control" });
  return {};
}

function readSteps(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): ScriptStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path, message: "Steps must be a non-empty array" });
    return [];
  }
  return value.map((step, index) => readStep(step, `${path}[${index}]`, issues));
}

function readStep(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): ScriptStep {
  const step = recordAt(value, path, issues);
  rejectUnknownFields(step, new Set([...stepBaseFields, ...actionFields]), path, issues);
  const id = requiredString(step.id, `${path}.id`, issues);
  const name = optionalString(step.name, `${path}.name`, issues);
  const onPage = optionalString(step.onPage, `${path}.onPage`, issues);
  const expectPage = optionalString(step.expectPage, `${path}.expectPage`, issues);
  const timeoutMs = optionalPositiveNumber(step.timeoutMs, `${path}.timeoutMs`, issues);
  const risk = readRisk(step.risk, `${path}.risk`, issues);
  const actions = actionFields.filter((field) => step[field] !== undefined);
  if (actions.length !== 1) {
    issues.push({ path, message: "Each step must contain exactly one action" });
  }
  const action = actions[0] ?? "assertPage";
  if ((action === "tap" || action === "selectText") && step.risk === "none") {
    issues.push({ path: `${path}.risk`, message: `${action} steps cannot declare risk none` });
  }
  if (risk && (action === "runFlow" || action === "repeat" || action === "when")) {
    issues.push({ path: `${path}.risk`, message: "Risk can only be declared on executable steps" });
  }
  const base = {
    id,
    ...(name ? { name } : {}),
    ...(onPage ? { onPage } : {}),
    ...(expectPage ? { expectPage } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(risk ? { risk } : {})
  };

  switch (action) {
    case "launchApp":
      return { ...base, launchApp: readLaunchApp(step.launchApp, `${path}.launchApp`, issues) };
    case "tap":
      return { ...base, tap: readTapAction(step.tap, `${path}.tap`, issues) };
    case "inputText":
      return { ...base, inputText: readValueAction(step.inputText, `${path}.inputText`, issues) };
    case "clearText":
      return { ...base, clearText: readTargetAction(step.clearText, `${path}.clearText`, issues) };
    case "selectText":
      return { ...base, selectText: readSelectText(step.selectText, `${path}.selectText`, issues) };
    case "swipe":
      return { ...base, swipe: readSwipe(step.swipe, `${path}.swipe`, issues) };
    case "scrollUntilVisible":
      return { ...base, scrollUntilVisible: readScroll(step.scrollUntilVisible, `${path}.scrollUntilVisible`, issues) };
    case "reachPage":
      return { ...base, reachPage: readReachPage(step.reachPage, `${path}.reachPage`, issues) };
    case "waitForPage":
      return { ...base, waitForPage: requiredString(step.waitForPage, `${path}.waitForPage`, issues) };
    case "assertPage":
      return { ...base, assertPage: requiredString(step.assertPage, `${path}.assertPage`, issues) };
    case "assertText":
      return { ...base, assertText: readAssertText(step.assertText, `${path}.assertText`, issues) };
    case "runFlow":
      return {
        ...base,
        runFlow: requiredString(step.runFlow, `${path}.runFlow`, issues),
        ...(step.with !== undefined ? { with: readParameterBindings(step.with, `${path}.with`, issues) } : {})
      };
    case "repeat":
      return { ...base, repeat: readRepeat(step.repeat, `${path}.repeat`, issues) };
    case "when":
      return { ...base, when: readWhen(step.when, `${path}.when`, issues) };
  }
}

function readAssertText(
  value: unknown,
  path: string,
  issues: ScriptFlowValidationIssue[]
): { text: string; match?: "contains" | "exact" } {
  const assertion = recordAt(value, path, issues);
  rejectUnknownFields(assertion, new Set(["text", "match"]), path, issues);
  const text = requiredString(assertion.text, `${path}.text`, issues);
  const match = optionalString(assertion.match, `${path}.match`, issues);
  if (match && match !== "contains" && match !== "exact") {
    issues.push({ path: `${path}.match`, message: "Text assertion match must be contains or exact" });
  }
  return {
    text,
    ...(match === "contains" || match === "exact" ? { match } : {})
  };
}

function readRisk(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): Exclude<ScriptStepRisk, "none"> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "interaction" || value === "submit" || value === "publish" || value === "delete" || value === "payment") {
    return value;
  }
  issues.push({ path, message: "Risk must be interaction, submit, publish, delete, or payment" });
  return undefined;
}

function readLaunchApp(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): { appId?: string } {
  const action = recordAt(value, path, issues);
  rejectUnknownFields(action, new Set(["appId"]), path, issues);
  const appId = optionalString(action.appId, `${path}.appId`, issues);
  return appId ? { appId } : {};
}

function readTapAction(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): { target: ScriptTarget; search?: ScriptSearchPolicy } {
  const action = recordAt(value, path, issues);
  rejectUnknownFields(action, new Set(["target", "search"]), path, issues);
  const search = readSearchPolicy(action.search, `${path}.search`, issues);
  return {
    target: readTarget(action.target, `${path}.target`, issues),
    ...(search ? { search } : {})
  };
}

function readTargetAction(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): { target: ScriptTarget } {
  const action = recordAt(value, path, issues);
  rejectUnknownFields(action, new Set(["target"]), path, issues);
  return { target: readTarget(action.target, `${path}.target`, issues) };
}

function readValueAction(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): { target: ScriptTarget; value: string } {
  const action = recordAt(value, path, issues);
  rejectUnknownFields(action, new Set(["target", "value"]), path, issues);
  return {
    target: readTarget(action.target, `${path}.target`, issues),
    value: scalarAsString(action.value, `${path}.value`, issues)
  };
}

function readSelectText(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): { target: ScriptTarget; value: string; confirmText?: string } {
  const action = recordAt(value, path, issues);
  rejectUnknownFields(action, new Set(["target", "value", "confirmText"]), path, issues);
  const confirmText = optionalString(action.confirmText, `${path}.confirmText`, issues);
  return {
    target: readTarget(action.target, `${path}.target`, issues),
    value: scalarAsString(action.value, `${path}.value`, issues),
    ...(confirmText ? { confirmText } : {})
  };
}

function readSwipe(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): { direction: "up" | "down" | "left" | "right"; distance?: number } {
  const action = recordAt(value, path, issues);
  rejectUnknownFields(action, new Set(["direction", "distance"]), path, issues);
  const direction = requiredString(action.direction, `${path}.direction`, issues);
  if (!(direction === "up" || direction === "down" || direction === "left" || direction === "right")) {
    issues.push({ path: `${path}.direction`, message: "Swipe direction must be up, down, left, or right" });
  }
  const distance = optionalFraction(action.distance, `${path}.distance`, issues);
  return {
    direction: direction === "down" || direction === "left" || direction === "right" ? direction : "up",
    ...(distance !== undefined ? { distance } : {})
  };
}

function readScroll(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): { target: ScriptTarget; direction?: "up" | "down"; maxSwipes?: number } {
  const action = recordAt(value, path, issues);
  rejectUnknownFields(action, new Set(["target", "direction", "maxSwipes"]), path, issues);
  const direction = optionalString(action.direction, `${path}.direction`, issues);
  if (direction && direction !== "up" && direction !== "down") {
    issues.push({ path: `${path}.direction`, message: "Scroll direction must be up or down" });
  }
  const maxSwipes = optionalInteger(action.maxSwipes, `${path}.maxSwipes`, issues, 1, 50);
  return {
    target: readTarget(action.target, `${path}.target`, issues),
    ...(direction === "up" || direction === "down" ? { direction } : {}),
    ...(maxSwipes !== undefined ? { maxSwipes } : {})
  };
}

function readReachPage(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): { page: string; policy?: "safe" } {
  const action = recordAt(value, path, issues);
  rejectUnknownFields(action, new Set(["page", "policy"]), path, issues);
  const page = requiredString(action.page, `${path}.page`, issues);
  const policy = optionalString(action.policy, `${path}.policy`, issues);
  if (policy && policy !== "safe") {
    issues.push({ path: `${path}.policy`, message: "reachPage policy must be safe" });
  }
  return {
    page,
    ...(policy === "safe" ? { policy } : {})
  };
}

function readRepeat(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): { times: number | string; steps: ScriptStep[] } {
  const repeat = recordAt(value, path, issues);
  rejectUnknownFields(repeat, new Set(["times", "steps"]), path, issues);
  const times = repeat.times;
  if (typeof times === "number") {
    if (!Number.isInteger(times) || times < 1 || times > 100) {
      issues.push({ path: `${path}.times`, message: "Repeat times must be between 1 and 100" });
    }
  } else if (typeof times !== "string" || !isSingleParameterReference(times)) {
    issues.push({ path: `${path}.times`, message: "Repeat times must be between 1 and 100 or reference a number parameter" });
  }
  return {
    times: typeof times === "number" || typeof times === "string" ? times : 1,
    steps: readSteps(repeat.steps, `${path}.steps`, issues)
  };
}

function readWhen(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): { parameter: string; equals: ScriptParameterValue; steps: ScriptStep[] } {
  const when = recordAt(value, path, issues);
  rejectUnknownFields(when, new Set(["parameter", "equals", "steps"]), path, issues);
  const parameter = requiredString(when.parameter, `${path}.parameter`, issues);
  if (!isParameterValue(when.equals)) {
    issues.push({ path: `${path}.equals`, message: "Condition value must be string, number, or boolean" });
  }
  return {
    parameter,
    equals: isParameterValue(when.equals) ? when.equals : "",
    steps: readSteps(when.steps, `${path}.steps`, issues)
  };
}

function readTarget(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): ScriptTarget {
  const target = recordAt(value, path, issues);
  for (const key of Object.keys(target)) {
    if (key === "x" || key === "y" || key === "xRatio" || key === "yRatio" || key === "region") {
      issues.push({ path: `${path}.${key}`, message: "Absolute coordinates are not supported" });
    } else if (!targetFields.has(key)) {
      issues.push({ path: `${path}.${key}`, message: "Unknown field" });
    }
  }
  const result: ScriptTarget = {
    ...optionalStringProperty(target.text, `${path}.text`, "text", issues),
    ...optionalStringProperty(target.semantic, `${path}.semantic`, "semantic", issues),
    ...optionalStringProperty(target.icon, `${path}.icon`, "icon", issues),
    ...readTargetControl(target.control, `${path}.control`, issues),
    ...readTargetArea(target.area, `${path}.area`, issues),
    ...readTargetPosition(target.position, `${path}.position`, issues),
    ...optionalStringProperty(target.nearText, `${path}.nearText`, "nearText", issues),
    ...readTargetMatch(target.match, `${path}.match`, issues)
  };
  if ([result.text, result.semantic, result.icon, result.control].filter(Boolean).length !== 1) {
    issues.push({ path, message: "Target requires exactly one of text, semantic, icon, or control" });
  }
  if (result.icon && (!result.area || !result.position)) {
    issues.push({ path, message: "Icon targets require area and position" });
  }
  if (result.icon && result.area === "bottomBar") {
    issues.push({ path: `${path}.area`, message: "Bottom bar icon targets are not supported yet" });
  }
  if (result.icon && result.area === "content" && result.icon.trim().toLowerCase() !== "add") {
    issues.push({ path: `${path}.icon`, message: "Content icon targets currently support only the standard add icon" });
  }
  if (result.position && !result.icon) {
    issues.push({ path: `${path}.position`, message: "Position is only supported for icon targets" });
  }
  if (result.match && !result.text) {
    issues.push({ path: `${path}.match`, message: "Match is only supported for text targets" });
  }
  if (result.control && (!result.nearText || result.area !== "content")) {
    issues.push({ path, message: "Control targets require nearText and area content" });
  }
  return result;
}

function readSearchPolicy(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): ScriptSearchPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  const search = recordAt(value, path, issues);
  rejectUnknownFields(search, new Set(["mode", "direction", "maxSwipes", "resetToTop", "container"]), path, issues);
  const mode = optionalString(search.mode, `${path}.mode`, issues);
  if (mode && mode !== "auto" && mode !== "visibleOnly" && mode !== "scroll") {
    issues.push({ path: `${path}.mode`, message: "Search mode must be auto, visibleOnly, or scroll" });
  }
  const direction = optionalString(search.direction, `${path}.direction`, issues);
  if (direction && direction !== "up" && direction !== "down" && direction !== "both") {
    issues.push({ path: `${path}.direction`, message: "Search direction must be up, down, or both" });
  }
  const maxSwipes = optionalInteger(search.maxSwipes, `${path}.maxSwipes`, issues, 1, 50);
  const resetToTop = optionalBoolean(search.resetToTop, `${path}.resetToTop`, issues);
  const container = optionalString(search.container, `${path}.container`, issues);
  if (container && container !== "content") {
    issues.push({ path: `${path}.container`, message: "Search container must be content" });
  }
  return {
    ...(mode === "auto" || mode === "visibleOnly" || mode === "scroll" ? { mode } : {}),
    ...(direction === "up" || direction === "down" || direction === "both" ? { direction } : {}),
    ...(maxSwipes !== undefined ? { maxSwipes } : {}),
    ...(resetToTop !== undefined ? { resetToTop } : {}),
    ...(container === "content" ? { container } : {})
  };
}

function readTargetArea(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): Pick<ScriptTarget, "area"> {
  if (value === undefined) {
    return {};
  }
  if (value === "topBar" || value === "content" || value === "bottomBar") {
    return { area: value };
  }
  issues.push({ path, message: "Target area must be topBar, content, or bottomBar" });
  return {};
}

function readTargetPosition(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): Pick<ScriptTarget, "position"> {
  if (value === undefined) {
    return {};
  }
  if (value === "leading" || value === "trailing") {
    return { position: value };
  }
  issues.push({ path, message: "Target position must be leading or trailing" });
  return {};
}

function readTargetControl(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): Pick<ScriptTarget, "control"> {
  if (value === undefined) {
    return {};
  }
  if (value === "checkbox") {
    return { control: value };
  }
  issues.push({ path, message: "Target control must be checkbox" });
  return {};
}

function readTargetMatch(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): Pick<ScriptTarget, "match"> {
  if (value === undefined) {
    return {};
  }
  if (value === "contains" || value === "exact") {
    return { match: value };
  }
  issues.push({ path, message: "Target match must be contains or exact" });
  return {};
}

function readParameterBindings(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): Record<string, ScriptParameterValue> {
  const bindings = recordAt(value, path, issues);
  const result: Record<string, ScriptParameterValue> = {};
  for (const [key, binding] of Object.entries(bindings)) {
    if (!isParameterValue(binding)) {
      issues.push({ path: `${path}.${key}`, message: "Binding must be string, number, or boolean" });
      continue;
    }
    result[key] = binding;
  }
  return result;
}

function validateUniqueStepIds(steps: ScriptStep[], issues: ScriptFlowValidationIssue[]): void {
  const seen = new Set<string>();
  const visit = (items: ScriptStep[]): void => {
    for (const step of items) {
      if (seen.has(step.id)) {
        issues.push({ path: `steps.${step.id}`, message: `Duplicate step id: ${step.id}` });
      }
      seen.add(step.id);
      if ("repeat" in step) {
        visit(step.repeat.steps);
      }
      if ("when" in step) {
        visit(step.when.steps);
      }
    }
  };
  visit(steps);
}

function validateParameterReferences(input: {
  root: Record<string, unknown>;
  parameters: Record<string, ScriptParameterDefinition>;
  steps: ScriptStep[];
  issues: ScriptFlowValidationIssue[];
}): void {
  const references = collectParameterReferences(input.root);
  for (const reference of references) {
    if (!input.parameters[reference]) {
      input.issues.push({ path: "parameters", message: `Undeclared parameter reference: ${reference}` });
    }
  }
  const validateControlReferences = (steps: ScriptStep[]): void => {
    for (const step of steps) {
      if ("when" in step) {
        if (!input.parameters[step.when.parameter]) {
          input.issues.push({ path: `steps.${step.id}.when.parameter`, message: `Undeclared parameter: ${step.when.parameter}` });
        }
        validateControlReferences(step.when.steps);
      }
      if ("repeat" in step) {
        validateControlReferences(step.repeat.steps);
      }
    }
  };
  validateControlReferences(input.steps);
}

function collectParameterReferences(value: unknown): Set<string> {
  const references = new Set<string>();
  const visit = (item: unknown): void => {
    if (typeof item === "string") {
      parameterReferencePattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = parameterReferencePattern.exec(item))) {
        references.add(match[1]);
      }
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (isRecord(item)) {
      Object.values(item).forEach(visit);
    }
  };
  visit(value);
  return references;
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  issues: ScriptFlowValidationIssue[]
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({ path: path ? `${path}.${key}` : key, message: "Unknown field" });
    }
  }
}

function recordAt(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): Record<string, unknown> {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected an object" });
    return {};
  }
  return value;
}

function requiredString(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): string {
  if (typeof value !== "string" || !value.trim()) {
    issues.push({ path, message: "Expected a non-empty string" });
    return "";
  }
  return value.trim();
}

function optionalString(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, path, issues) || undefined;
}

function optionalBoolean(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    issues.push({ path, message: "Expected a boolean" });
    return undefined;
  }
  return value;
}

function scalarAsString(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  issues.push({ path, message: "Expected a string or scalar parameter reference" });
  return "";
}

function optionalStringProperty<K extends string>(
  value: unknown,
  path: string,
  key: K,
  issues: ScriptFlowValidationIssue[]
): Partial<Record<K, string>> {
  const result = optionalString(value, path, issues);
  return result ? { [key]: result } as Record<K, string> : {};
}

function optionalBooleanProperty<K extends string>(
  value: unknown,
  path: string,
  key: K,
  issues: ScriptFlowValidationIssue[]
): Partial<Record<K, boolean>> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "boolean") {
    issues.push({ path, message: "Expected a boolean" });
    return {};
  }
  return { [key]: value } as Record<K, boolean>;
}

function optionalPositiveNumber(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    issues.push({ path, message: "Expected a positive number" });
    return undefined;
  }
  return value;
}

function optionalFraction(value: unknown, path: string, issues: ScriptFlowValidationIssue[]): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    issues.push({ path, message: "Expected a number greater than 0 and at most 1" });
    return undefined;
  }
  return value;
}

function optionalInteger(
  value: unknown,
  path: string,
  issues: ScriptFlowValidationIssue[],
  min: number,
  max: number
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    issues.push({ path, message: `Expected an integer between ${min} and ${max}` });
    return undefined;
  }
  return value;
}

function readStringArray(
  value: unknown,
  path: string,
  issues: ScriptFlowValidationIssue[],
  fallback: string[]
): string[] {
  if (value === undefined) {
    return fallback;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    issues.push({ path, message: "Expected an array of non-empty strings" });
    return fallback;
  }
  return value.map((item) => String(item).trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScriptPlatform(value: string): value is ScriptFlowPlatform {
  return value === "android" || value === "ios" || value === "harmony" || value === "flutter";
}

function isStartStrategy(value: string): value is ScriptFlowStartStrategy {
  return value === "keepCurrent" || value === "goHome" || value === "launchApp" || value === "restartApp" || value === "clearDataAndLaunch";
}

function isParameterType(value: string): value is ScriptParameterType {
  return value === "string" || value === "number" || value === "boolean" || value === "datetime";
}

function isParameterValue(value: unknown): value is ScriptParameterValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function parameterValueMatchesType(value: unknown, type: ScriptParameterType): boolean {
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "boolean") {
    return typeof value === "boolean";
  }
  return typeof value === "string";
}

function isSingleParameterReference(value: string): boolean {
  return /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value);
}
