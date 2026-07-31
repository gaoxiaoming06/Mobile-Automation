export type ScriptFlowPlatform = "android" | "ios" | "harmony" | "flutter";

export type ScriptFlowKind = "case" | "scenario";

export type ScriptFlowPurpose = "navigation" | "fixture" | "business" | "recovery";

export type ScriptStepRole = "setup" | "navigation" | "business" | "assertion" | "cleanup" | "recovery";

export type ScriptSessionState = "authenticated" | "unauthenticated";

export type ScriptFlowState = {
  page?: string;
  session?: ScriptSessionState;
  role?: string;
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

export type ScriptTargetControl = "checkbox";

export type ScriptTarget = {
  text?: string;
  semantic?: string;
  icon?: string;
  control?: ScriptTargetControl;
  area?: ScriptTargetArea;
  position?: ScriptTargetPosition;
  nearText?: string;
  match?: "contains" | "exact";
};

export type ScriptSearchPolicy = {
  mode?: "auto" | "visibleOnly" | "scroll";
  direction?: "up" | "down" | "both";
  maxSwipes?: number;
  resetToTop?: boolean;
  container?: "content";
};

export type ScriptStepRisk = "none" | "interaction" | "submit" | "publish" | "delete" | "payment";

export type ScriptStepBase = {
  id: string;
  name?: string;
  role?: ScriptStepRole;
  onPage?: string;
  expectPage?: string;
  timeoutMs?: number;
  risk?: Exclude<ScriptStepRisk, "none">;
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

export type ScriptScrollUntilVisibleStep = ScriptStepBase & {
  scrollUntilVisible: {
    target: ScriptTarget;
    direction?: "up" | "down";
    maxSwipes?: number;
  };
};

export type ScriptReachPageStep = ScriptStepBase & {
  reachPage: {
    page: string;
    policy?: "safe";
  };
};

export type ScriptWaitForPageStep = ScriptStepBase & {
  waitForPage: string;
};

export type ScriptAssertPageStep = ScriptStepBase & {
  assertPage: string;
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
  | ScriptScrollUntilVisibleStep
  | ScriptReachPageStep
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
  name: string;
  description?: string;
  app: {
    id: string;
    platform: ScriptFlowPlatform;
  };
  start?: {
    strategy: ScriptFlowStartStrategy;
  };
  entry?: ScriptFlowState;
  outcome?: ScriptFlowState;
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
  | "scrollUntilVisible"
  | "reachPage"
  | "waitForPage"
  | "assertPage"
  | "assertText";

export type ScriptExecutionPlanStep = {
  id: string;
  order: number;
  phase: "preparation" | "test";
  role: ScriptStepRole;
  name?: string;
  action: ScriptExecutableAction;
  input: Record<string, unknown>;
  onPage?: string;
  expectPage?: string;
  timeoutMs?: number;
  risk: ScriptStepRisk;
  source: {
    flowName: string;
    stepId: string;
  };
};

export type ScriptRiskConfirmation = {
  stepId: string;
  risk: Exclude<ScriptStepRisk, "none">;
  stepName?: string;
};

export type ScriptExecutionPlan = {
  flowName: string;
  kind: ScriptFlowKind;
  purpose: ScriptFlowPurpose;
  app: ScriptFlowDocument["app"];
  start?: ScriptFlowDocument["start"];
  entry?: ScriptFlowState;
  outcome?: ScriptFlowState;
  parameters: Record<string, ScriptParameterValue>;
  steps: ScriptExecutionPlanStep[];
  riskConfirmations: ScriptRiskConfirmation[];
};

export type CompileScriptFlowOptions = {
  parameters?: Record<string, ScriptParameterValue>;
  resolveFlow?: (id: string) => ScriptFlowDocument | undefined;
  redactSensitiveParameters?: boolean;
};
