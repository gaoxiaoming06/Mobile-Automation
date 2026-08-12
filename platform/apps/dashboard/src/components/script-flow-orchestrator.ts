import { serializeScriptFlow, type ScriptFlowDocument } from "@mobile-automation/script-flow";
import type { CaseDocumentView, CaseSourceStep } from "./case-view.js";

export type TargetKind = "text" | "icon" | "visual" | "control";

export type StepLocatorPatch = {
  targetKind?: TargetKind;
  targetValue?: string;
  area?: string;
  position?: string;
  nearText?: string;
  scopeText?: string;
  ordinal?: string;
  anchorText?: string;
  relation?: string;
  checked?: string;
  searchMode?: string;
  direction?: string;
  maxSwipes?: string;
  resetToTop?: string;
  container?: string;
};

export type EditableStepAction =
  | "launchApp"
  | "tap"
  | "inputText"
  | "clearText"
  | "selectText"
  | "swipe"
  | "scrollUntilVisible"
  | "reachPage"
  | "waitForPage"
  | "assertPage"
  | "assertText";

export type DraftStepPatch = {
  name?: string;
  role?: string;
  action?: EditableStepAction;
  value?: string;
  page?: string;
  direction?: string;
  distance?: string;
  match?: string;
};

export type EditableGeneratedDraft = {
  status: "ready" | "trial_ready";
  sourceYaml: string;
  document: CaseDocumentView;
  verification?: unknown;
};

export type DraftStepPlacement = "setup" | "business" | "assertion" | "reset";

export type ReusableFlowReferenceInput = {
  id: string;
  name: string;
  placement: DraftStepPlacement;
  parameters: CaseDocumentView["parameters"];
};

type StepLocation = {
  parent: CaseSourceStep[];
  index: number;
  path: number[];
  step: CaseSourceStep;
};

const ACTION_KEYS = [
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

export function updateDraftStep<T extends EditableGeneratedDraft>(
  draft: T,
  stepKey: string,
  patch: DraftStepPatch
): T {
  const document = cloneDocument(draft.document);
  const location = locateStep(document.steps, stepKey);
  if (patch.action && sourceActionName(location.step) !== patch.action) {
    location.parent[location.index] = changeStepAction(location.step, patch.action, document.app.id);
    location.step = location.parent[location.index]!;
  }
  applyCommonPatch(location.step, patch);
  applyActionPatch(location.step, patch);
  if (location.step.role === "reset") delete document.loop;
  return finalizeDraft(draft, document);
}

export function updateDraftStepLocator<T extends EditableGeneratedDraft>(
  draft: T,
  stepKey: string,
  patch: StepLocatorPatch
): T {
  const document = cloneDocument(draft.document);
  const location = locateStep(document.steps, stepKey);
  const targetAction = targetActionRecord(location.step);
  if (!targetAction) throw new Error("当前步骤没有可编辑的元素定位");
  applyLocatorPatch(targetAction, patch);
  return finalizeDraft(draft, document);
}

export function addDraftStep<T extends EditableGeneratedDraft>(
  draft: T,
  afterStepKey: string | undefined,
  action: EditableStepAction,
  role?: DraftStepPlacement
): { draft: T; stepKey: string } {
  const document = cloneDocument(draft.document);
  const ids = collectStepIds(document.steps);
  const id = uniqueStepId(`${kebabCase(action)}-step`, ids);
  const step = createStep(id, action, document.app.id, role);
  if (role === "reset") delete document.loop;
  let parent = document.steps;
  let insertIndex = parent.length;
  let parentPath: number[] = [];
  if (afterStepKey) {
    const location = locateStep(document.steps, afterStepKey);
    parent = location.parent;
    insertIndex = location.index + 1;
    parentPath = location.path.slice(0, -1);
  } else {
    insertIndex = sectionInsertIndex(parent, sourceStepPhase(step));
  }
  parent.splice(insertIndex, 0, step);
  return {
    draft: finalizeDraft(draft, document),
    stepKey: reviewStepKey([...parentPath, insertIndex], step)
  };
}

export function addDraftFlowReference<T extends EditableGeneratedDraft>(
  draft: T,
  afterStepKey: string | undefined,
  reference: ReusableFlowReferenceInput
): { draft: T; stepKey: string } {
  const document = cloneDocument(draft.document);
  const ids = collectStepIds(document.steps);
  const id = uniqueStepId(`reuse-${reference.id.replace(/^flow-/, "")}`, ids);
  const bindings: Record<string, string> = {};

  for (const [childKey, childDefinition] of Object.entries(reference.parameters)) {
    const existing = document.parameters[childKey];
    const parentKey = existing && existing.type !== childDefinition.type
      ? uniqueParameterKey(childKey, document.parameters)
      : childKey;
    if (!document.parameters[parentKey]) {
      document.parameters[parentKey] = JSON.parse(JSON.stringify(childDefinition));
    } else {
      const parentDefinition = document.parameters[parentKey]!;
      document.parameters[parentKey] = {
        ...parentDefinition,
        ...(parentDefinition.default === undefined && childDefinition.default !== undefined
          ? { default: childDefinition.default }
          : {}),
        ...(childDefinition.required ? { required: true } : {}),
        ...(childDefinition.sensitive ? { sensitive: true } : {})
      };
    }
    bindings[childKey] = `\${${parentKey}}`;
  }

  const step: CaseSourceStep = {
    id,
    name: `复用${reference.name}`,
    role: reference.placement,
    runFlow: reference.id,
    ...(Object.keys(bindings).length ? { with: bindings } : {})
  };
  if (reference.placement === "reset") delete document.loop;
  let parent = document.steps;
  let insertIndex = parent.length;
  let parentPath: number[] = [];
  if (afterStepKey) {
    const location = locateStep(document.steps, afterStepKey);
    parent = location.parent;
    insertIndex = location.index + 1;
    parentPath = location.path.slice(0, -1);
  } else {
    insertIndex = sectionInsertIndex(parent, sourceStepPhase(step));
  }
  parent.splice(insertIndex, 0, step);
  return {
    draft: finalizeDraft(draft, document),
    stepKey: reviewStepKey([...parentPath, insertIndex], step)
  };
}

function sourceStepPhase(step: CaseSourceStep): "preparation" | "business" | "verification" | "reset" {
  const action = sourceActionName(step);
  if (step.role === "reset") return "reset";
  if (step.role === "setup" || step.role === "recovery" || action === "launchApp") return "preparation";
  if (step.role === "assertion" || step.role === "cleanup" || action === "waitForPage" || action === "assertPage" || action === "assertText") {
    return "verification";
  }
  return "business";
}

function sectionInsertIndex(
  steps: CaseSourceStep[],
  phase: "preparation" | "business" | "verification" | "reset"
): number {
  const rank = { preparation: 0, business: 1, verification: 2, reset: 3 } as const;
  const index = steps.findIndex((step) => rank[sourceStepPhase(step)] > rank[phase]);
  return index < 0 ? steps.length : index;
}

export function setDraftLoopResetMode<T extends EditableGeneratedDraft>(
  draft: T,
  mode: "none" | "unconfigured"
): T {
  const document = cloneDocument(draft.document);
  const hasResetSteps = collectSteps(document.steps).some((step) => step.role === "reset");
  if (mode === "none" && hasResetSteps) {
    throw new Error("请先删除每轮复位步骤，再声明无需复位");
  }
  if (mode === "none") document.loop = { reset: "none" };
  else delete document.loop;
  return finalizeDraft(draft, document);
}

export function duplicateDraftStep<T extends EditableGeneratedDraft>(
  draft: T,
  stepKey: string
): { draft: T; stepKey: string } {
  const document = cloneDocument(draft.document);
  const location = locateStep(document.steps, stepKey);
  const ids = collectStepIds(document.steps);
  const copy = cloneStepWithFreshIds(location.step, ids);
  const insertIndex = location.index + 1;
  location.parent.splice(insertIndex, 0, copy);
  return {
    draft: finalizeDraft(draft, document),
    stepKey: reviewStepKey([...location.path.slice(0, -1), insertIndex], copy)
  };
}

export function moveDraftStep<T extends EditableGeneratedDraft>(
  draft: T,
  stepKey: string,
  direction: "up" | "down"
): T {
  const document = cloneDocument(draft.document);
  const location = locateStep(document.steps, stepKey);
  const targetIndex = direction === "up" ? location.index - 1 : location.index + 1;
  if (targetIndex < 0 || targetIndex >= location.parent.length) return draft;
  const target = location.parent[targetIndex]!;
  location.parent[targetIndex] = location.step;
  location.parent[location.index] = target;
  return finalizeDraft(draft, document);
}

export function removeDraftStep<T extends EditableGeneratedDraft>(draft: T, stepKey: string): T {
  const document = cloneDocument(draft.document);
  const location = locateStep(document.steps, stepKey);
  location.parent.splice(location.index, 1);
  return finalizeDraft(draft, document);
}

function changeStepAction(
  step: CaseSourceStep,
  action: EditableStepAction,
  appId: string
): CaseSourceStep {
  const next = { ...step };
  for (const key of ACTION_KEYS) delete next[key];
  delete next.risk;
  return { ...next, role: step.role ?? defaultRole(action), ...actionBody(action, appId) };
}

function createStep(id: string, action: EditableStepAction, appId: string, role?: DraftStepPlacement): CaseSourceStep {
  return {
    id,
    name: defaultStepName(action),
    role: role ?? defaultRole(action),
    ...actionBody(action, appId)
  };
}

function defaultRole(action: EditableStepAction): "setup" | "business" | "assertion" {
  if (action === "launchApp") return "setup";
  if (action === "assertPage" || action === "assertText" || action === "waitForPage") return "assertion";
  return "business";
}

function actionBody(action: EditableStepAction, appId: string): Record<string, unknown> {
  if (action === "launchApp") return { launchApp: { appId } };
  if (action === "tap") return { tap: { target: { text: "待填写目标" }, search: { mode: "auto" } } };
  if (action === "inputText") return {
    inputText: {
      target: { control: "textField", area: "content", scopeText: "待填写字段", ordinal: 1 },
      value: "待填写内容",
      search: { mode: "auto" }
    }
  };
  if (action === "clearText") return {
    clearText: {
      target: { control: "textField", area: "content", scopeText: "待填写字段", ordinal: 1 },
      search: { mode: "auto" }
    }
  };
  if (action === "selectText") return { selectText: { target: { text: "待填写选项" }, value: "待填写选项", search: { mode: "auto" } } };
  if (action === "swipe") return { swipe: { direction: "up" } };
  if (action === "scrollUntilVisible") return { scrollUntilVisible: { target: { text: "待填写目标" }, direction: "down", maxSwipes: 6 } };
  if (action === "reachPage") return { reachPage: { page: "待填写页面", policy: "safe" } };
  if (action === "waitForPage") return { waitForPage: "待填写页面" };
  if (action === "assertPage") return { assertPage: "待填写页面" };
  return { assertText: { text: "待填写内容", match: "contains" } };
}

function defaultStepName(action: EditableStepAction): string {
  const names: Record<EditableStepAction, string> = {
    launchApp: "重启 App",
    tap: "点击目标",
    inputText: "输入文本",
    clearText: "清空输入",
    selectText: "选择选项",
    swipe: "滑动页面",
    scrollUntilVisible: "查找内容",
    reachPage: "到达页面",
    waitForPage: "等待页面",
    assertPage: "确认页面",
    assertText: "确认文字"
  };
  return names[action];
}

function applyCommonPatch(step: CaseSourceStep, patch: DraftStepPatch): void {
  setOptionalString(step, "name", patch.name);
  setOptionalString(step, "role", patch.role);
}

function applyActionPatch(step: CaseSourceStep, patch: DraftStepPatch): void {
  const inputText = recordValue(step.inputText);
  const selectText = recordValue(step.selectText);
  const assertText = recordValue(step.assertText);
  const reachPage = recordValue(step.reachPage);
  const swipe = recordValue(step.swipe);
  const scroll = recordValue(step.scrollUntilVisible);

  if (patch.value !== undefined) {
    if (inputText) inputText.value = patch.value;
    else if (selectText) selectText.value = patch.value;
    else if (assertText) assertText.text = patch.value;
  }
  if (patch.page !== undefined) {
    if (reachPage) reachPage.page = patch.page;
    else if ("waitForPage" in step) step.waitForPage = patch.page;
    else if ("assertPage" in step) step.assertPage = patch.page;
  }
  if (patch.direction !== undefined) {
    if (swipe) swipe.direction = patch.direction;
    else if (scroll) scroll.direction = patch.direction;
  }
  if (patch.distance !== undefined && swipe) {
    const distance = Number(patch.distance);
    if (Number.isFinite(distance) && distance > 0) swipe.distance = distance;
    else delete swipe.distance;
  }
  if (patch.match !== undefined && assertText) assertText.match = patch.match;
}

function cloneStepWithFreshIds(step: CaseSourceStep, ids: Set<string>): CaseSourceStep {
  const copy = JSON.parse(JSON.stringify(step)) as CaseSourceStep;
  refreshStepIds(copy, ids);
  return copy;
}

function refreshStepIds(step: CaseSourceStep, ids: Set<string>): void {
  step.id = uniqueStepId(`${step.id}-copy`, ids);
  ids.add(step.id);
  for (const child of nestedSteps(step) ?? []) refreshStepIds(child, ids);
}

function collectStepIds(steps: CaseSourceStep[], result = new Set<string>()): Set<string> {
  for (const step of steps) {
    result.add(step.id);
    collectStepIds(nestedSteps(step) ?? [], result);
  }
  return result;
}

function collectSteps(steps: CaseSourceStep[]): CaseSourceStep[] {
  return steps.flatMap((step) => [step, ...collectSteps(nestedSteps(step) ?? [])]);
}

function uniqueStepId(base: string, ids: Set<string>): string {
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function uniqueParameterKey(base: string, parameters: CaseDocumentView["parameters"]): string {
  let suffix = 2;
  while (`${base}_${suffix}` in parameters) suffix += 1;
  return `${base}_${suffix}`;
}

function locateStep(steps: CaseSourceStep[], stepKey: string): StepLocation {
  const separator = stepKey.indexOf(":");
  const rawPath = separator >= 0 ? stepKey.slice(0, separator) : stepKey;
  const expectedId = separator >= 0 ? stepKey.slice(separator + 1) : undefined;
  const path = rawPath.split(".").map((item) => Number(item));
  if (!path.length || path.some((item) => !Number.isInteger(item) || item < 0)) {
    throw new Error("步骤路径无效");
  }
  let parent = steps;
  let step: CaseSourceStep | undefined;
  for (let depth = 0; depth < path.length; depth += 1) {
    const index = path[depth]!;
    step = parent[index];
    if (!step) throw new Error("没有找到要编辑的步骤");
    if (depth < path.length - 1) {
      const children = nestedSteps(step);
      if (!children) throw new Error("没有找到要编辑的嵌套步骤");
      parent = children;
    }
  }
  if (!step || (expectedId && step.id !== expectedId)) throw new Error("步骤已发生变化，请重新选择");
  return { parent, index: path.at(-1)!, path, step };
}

function nestedSteps(step: CaseSourceStep): CaseSourceStep[] | undefined {
  const repeat = recordValue(step.repeat);
  const when = recordValue(step.when);
  if (Array.isArray(repeat?.steps)) return repeat.steps as CaseSourceStep[];
  if (Array.isArray(when?.steps)) return when.steps as CaseSourceStep[];
  return undefined;
}

function reviewStepKey(path: number[], step: CaseSourceStep): string {
  return `${path.join(".")}:${step.id}`;
}

function sourceActionName(step: CaseSourceStep): string {
  return ACTION_KEYS.find((action) => action in step) ?? "unknown";
}

function targetActionRecord(step: CaseSourceStep): { actionName: string; action: Record<string, unknown>; target: Record<string, unknown> } | undefined {
  for (const actionName of ["tap", "inputText", "clearText", "selectText", "scrollUntilVisible"]) {
    const action = recordValue(step[actionName]);
    const target = recordValue(action?.target);
    if (action && target) return { actionName, action, target };
  }
  return undefined;
}

function applyLocatorPatch(
  targetAction: { actionName: string; action: Record<string, unknown>; target: Record<string, unknown> },
  patch: StepLocatorPatch
): void {
  applyPrimaryTargetPatch(targetAction.target, patch);
  setOptionalString(targetAction.target, "area", patch.area);
  setOptionalString(targetAction.target, "position", patch.position);
  setOptionalString(targetAction.target, "nearText", patch.nearText);
  setOptionalString(targetAction.target, "scopeText", patch.scopeText);
  setOptionalNumber(targetAction.target, "ordinal", patch.ordinal);
  setOptionalString(targetAction.target, "anchorText", patch.anchorText);
  setOptionalString(targetAction.target, "relation", patch.relation);
  setOptionalBoolean(targetAction.target, "checked", patch.checked);
  normalizeTargetConstraints(targetAction.target);

  if (targetAction.actionName === "scrollUntilVisible") {
    setOptionalString(targetAction.action, "direction", patch.direction);
    setOptionalNumber(targetAction.action, "maxSwipes", patch.maxSwipes);
    return;
  }

  const search = { ...recordValue(targetAction.action.search) };
  setOptionalString(search, "mode", patch.searchMode);
  setOptionalString(search, "direction", patch.direction);
  setOptionalNumber(search, "maxSwipes", patch.maxSwipes);
  setOptionalBoolean(search, "resetToTop", patch.resetToTop);
  setOptionalString(search, "container", patch.container);
  if (Object.keys(search).length) targetAction.action.search = search;
  else delete targetAction.action.search;
}

function normalizeTargetConstraints(target: Record<string, unknown>): void {
  const primary = primaryTargetValue(target);
  if (primary.kind !== "icon" && primary.kind !== "visual") delete target.position;
  if (primary.kind !== "control" || primary.value !== "switch") delete target.checked;
  if (primary.kind !== "control" || primary.value !== "textField") {
    delete target.anchorText;
    delete target.relation;
  }

  if (primary.kind === "icon") {
    if (target.area !== "topBar" && target.area !== "content") target.area = "topBar";
    if (target.position !== "leading" && target.position !== "trailing") target.position = "trailing";
    return;
  }
  if (primary.kind !== "control") return;

  target.area = "content";
  if (primary.value === "textField") {
    const relation = typeof target.relation === "string" && ["above", "below", "leftOf", "rightOf"].includes(target.relation)
      ? target.relation
      : undefined;
    if (typeof target.anchorText === "string" && target.anchorText.trim() && relation) {
      target.anchorText = target.anchorText.trim();
      target.relation = relation;
      delete target.scopeText;
      delete target.ordinal;
      return;
    }
    delete target.anchorText;
    delete target.relation;
    if (typeof target.scopeText !== "string" || !target.scopeText.trim()) {
      target.scopeText = typeof target.nearText === "string" && target.nearText.trim()
        ? target.nearText.trim()
        : "待填写字段";
    }
    if (typeof target.ordinal !== "number" || !Number.isInteger(target.ordinal) || target.ordinal < 1) {
      target.ordinal = 1;
    }
    return;
  }
  if (primary.value === "checkbox" || primary.value === "switch") {
    if (typeof target.nearText !== "string" || !target.nearText.trim()) {
      target.nearText = typeof target.scopeText === "string" && target.scopeText.trim()
        ? target.scopeText.trim()
        : primary.value === "switch" ? "待填写开关" : "待填写选项";
    }
    if (primary.value === "switch" && typeof target.checked !== "boolean") target.checked = false;
  }
}

function applyPrimaryTargetPatch(target: Record<string, unknown>, patch: StepLocatorPatch): void {
  const current = primaryTargetValue(target);
  const kind = patch.targetKind ?? current.kind;
  const value = patch.targetValue ?? (patch.targetKind && patch.targetKind !== current.kind
    ? defaultTargetValue(kind, current.value)
    : current.value);
  if (patch.targetKind === undefined && patch.targetValue === undefined) return;
  delete target.text;
  delete target.semantic;
  delete target.icon;
  delete target.visual;
  delete target.control;
  if (!value.trim()) return;
  if (kind === "visual") {
    target.visual = { kind: "icon", query: value.trim() };
    return;
  }
  target[kind] = value.trim();
}

function primaryTargetValue(target: Record<string, unknown>): { kind: TargetKind; value: string } {
  if (typeof target.text === "string") return { kind: "text", value: target.text };
  if (typeof target.icon === "string") return { kind: "icon", value: target.icon };
  const visual = recordValue(target.visual);
  if (typeof visual?.query === "string") return { kind: "visual", value: visual.query };
  if (typeof target.control === "string") return { kind: "control", value: target.control };
  return { kind: "text", value: "" };
}

function defaultTargetValue(kind: TargetKind, currentValue: string): string {
  if (kind === "control") return "textField";
  if (kind === "visual") return "待填写视觉目标";
  return currentValue;
}

function setOptionalString(target: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value === undefined) return;
  if (value.trim()) target[key] = value.trim();
  else delete target[key];
}

function setOptionalNumber(target: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value === undefined) return;
  if (!value.trim()) {
    delete target[key];
    return;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) target[key] = numeric;
}

function setOptionalBoolean(target: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value === undefined) return;
  if (value === "true") target[key] = true;
  else if (value === "false") target[key] = false;
  else delete target[key];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function cloneDocument(document: CaseDocumentView): CaseDocumentView {
  return JSON.parse(JSON.stringify(document)) as CaseDocumentView;
}

function finalizeDraft<T extends EditableGeneratedDraft>(draft: T, document: CaseDocumentView): T {
  const { verification: _verification, ...rest } = draft;
  return {
    ...rest,
    status: "trial_ready",
    document,
    sourceYaml: serializeScriptFlow(document as unknown as ScriptFlowDocument)
  } as T;
}

function kebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
