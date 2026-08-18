export type ScriptFlowKind = "case" | "scenario";

export type ScriptFlowPurpose = "navigation" | "fixture" | "business" | "recovery";

export type ScriptFlowTestLevel = "probe" | "component" | "business_smoke" | "full_regression";

export type ScriptStepRole = "setup" | "navigation" | "business" | "assertion" | "cleanup" | "recovery" | "reset";

export type ScriptFlowLoop = {
  reset: "none";
};

export type ScriptSessionState = "authenticated" | "unauthenticated";

export type ScriptFlowState = {
  screenRef?: string;
  session?: ScriptSessionState;
  role?: string;
};

export type ScriptScreenContract = {
  screenRef: string;
};

export type ScriptFlowStartStrategy = "keepCurrent" | "goHome" | "launchApp" | "restartApp" | "clearDataAndLaunch";

export type ScriptParameterType = "string" | "number" | "boolean" | "datetime";

export type ScriptParameterOption = {
  label: string;
  value: string | number | boolean;
};

export type ScriptParameterDefinition = {
  type: ScriptParameterType;
  label?: string;
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  sensitive?: boolean;
  control?: "text" | "number" | "toggle" | "datetime" | "select";
  options?: ScriptParameterOption[];
  advanced?: boolean;
};

export type ScriptParameterValue = string | number | boolean;

export type ScriptTargetArea = "topBar" | "content" | "bottomBar";

export type ScriptTargetPosition = "leading" | "trailing";

export type ScriptTargetVertical = "top" | "center" | "bottom";

export type ScriptTargetControl = "checkbox" | "switch" | "textField";

export type ScriptTargetRelation = "above" | "below" | "leftOf" | "rightOf";

export type ScriptVisualTargetKind = "icon" | "image" | "object";

export type ScriptVisualTarget = {
  kind: ScriptVisualTargetKind;
  query: string;
  area?: ScriptTargetArea;
  position?: ScriptTargetPosition;
  vertical?: ScriptTargetVertical;
  nearText?: string;
  scopeText?: string;
  ordinal?: number;
};

export type ScriptTarget = {
  text?: string;
  icon?: string;
  visual?: ScriptVisualTarget;
  control?: ScriptTargetControl;
  area?: ScriptTargetArea;
  position?: ScriptTargetPosition;
  vertical?: ScriptTargetVertical;
  nearText?: string;
  scopeText?: string;
  ordinal?: number;
  anchorText?: string;
  relation?: ScriptTargetRelation;
  checked?: boolean;
  match?: "contains" | "exact" | "semantic";
};

export type ScriptSearchPolicy = {
  mode?: "auto" | "visibleOnly" | "scroll";
  direction?: "up" | "down" | "both";
  maxSwipes?: number;
  resetToTop?: boolean;
  container?: "content";
};

export type ScriptStepBase = {
  id: string;
  name?: string;
  role?: ScriptStepRole;
  before?: ScriptScreenContract;
  after?: ScriptScreenContract;
  timeoutMs?: number;
  /** @deprecated Accepted only when reading legacy ScriptFlow v1 documents. */
  risk?: string;
};

export type ScriptLaunchAppStep = ScriptStepBase & {
  launchApp: {
    appId?: string;
  };
};

export type ScriptTapStep = ScriptStepBase & {
  tap: {
    target: ScriptTarget;
    search?: ScriptSearchPolicy;
  };
};

export type ScriptInputTextStep = ScriptStepBase & {
  inputText: {
    target: ScriptTarget;
    value: string;
    search?: ScriptSearchPolicy;
  };
};

export type ScriptClearTextStep = ScriptStepBase & {
  clearText: {
    target: ScriptTarget;
    search?: ScriptSearchPolicy;
  };
};

export type ScriptSelectTextStep = ScriptStepBase & {
  selectText: {
    target: ScriptTarget;
    value: string;
    confirmText?: string;
    search?: ScriptSearchPolicy;
  };
};

export type ScriptSwipeStep = ScriptStepBase & {
  swipe: {
    direction: "up" | "down" | "left" | "right";
    distance?: number;
  };
};

export type ScriptWaitStep = ScriptStepBase & {
  wait: {
    durationMs: number;
  };
};

export type ScriptScrollUntilVisibleStep = ScriptStepBase & {
  scrollUntilVisible: {
    target: ScriptTarget;
    direction?: "up" | "down";
    maxSwipes?: number;
  };
};

export type ScriptReachPageStep = ScriptStepBase & {
  reachPage: {
    screenRef: string;
    policy?: "safe";
  };
};

export type ScriptWaitForPageStep = ScriptStepBase & {
  waitForPage: ScriptScreenContract;
};

export type ScriptAssertPageStep = ScriptStepBase & {
  assertPage: ScriptScreenContract;
};

export type ScriptAssertTextStep = ScriptStepBase & {
  assertText: {
    text: string;
    match?: "contains" | "exact";
  };
};

export type ScriptRunFlowStep = ScriptStepBase & {
  runFlow: string;
  with?: Record<string, ScriptParameterValue>;
};

export type ScriptRepeatStep = ScriptStepBase & {
  repeat: {
    times: number | string;
    steps: ScriptStep[];
  };
};

export type ScriptWhenStep = ScriptStepBase & {
  when: {
    parameter: string;
    equals: ScriptParameterValue;
    steps: ScriptStep[];
  };
};

export type ScriptStep =
  | ScriptLaunchAppStep
  | ScriptTapStep
  | ScriptInputTextStep
  | ScriptClearTextStep
  | ScriptSelectTextStep
  | ScriptSwipeStep
  | ScriptWaitStep
  | ScriptScrollUntilVisibleStep
  | ScriptWaitForPageStep
  | ScriptAssertPageStep
  | ScriptAssertTextStep
  | ScriptRunFlowStep
  | ScriptRepeatStep
  | ScriptWhenStep;

export type ScriptFlowDocument = {
  version: 1;
  kind: ScriptFlowKind;
  purpose?: ScriptFlowPurpose;
  testLevel?: ScriptFlowTestLevel;
  name: string;
  description?: string;
  app: {
    id: string;
  };
  start?: {
    strategy: ScriptFlowStartStrategy;
  };
  entry?: ScriptFlowState;
  outcome?: ScriptFlowState;
  loop?: ScriptFlowLoop;
  parameters: Record<string, ScriptParameterDefinition>;
  steps: ScriptStep[];
  tags: string[];
};

export type ScriptExecutableAction =
  | "launchApp"
  | "tap"
  | "inputText"
  | "clearText"
  | "selectText"
  | "swipe"
  | "wait"
  | "scrollUntilVisible"
  | "waitForPage"
  | "assertPage"
  | "assertText";

export type ScriptExecutionPlanStep = {
  id: string;
  order: number;
  phase: "preparation" | "business" | "verification" | "reset";
  role: ScriptStepRole;
  name?: string;
  action: ScriptExecutableAction;
  input: Record<string, unknown>;
  before?: ScriptScreenContract;
  after?: ScriptScreenContract;
  timeoutMs?: number;
  source: {
    flowName: string;
    stepId: string;
  };
};

export type ScriptExecutionPlan = {
  flowName: string;
  kind: ScriptFlowKind;
  purpose: ScriptFlowPurpose;
  testLevel: ScriptFlowTestLevel;
  app: ScriptFlowDocument["app"];
  start?: ScriptFlowDocument["start"];
  entry?: ScriptFlowState;
  outcome?: ScriptFlowState;
  loop?: ScriptFlowLoop;
  parameters: Record<string, ScriptParameterValue>;
  steps: ScriptExecutionPlanStep[];
};

export type CompileScriptFlowOptions = {
  parameters?: Record<string, ScriptParameterValue>;
  resolveFlow?: (id: string) => ScriptFlowDocument | undefined;
  redactSensitiveParameters?: boolean;
};
