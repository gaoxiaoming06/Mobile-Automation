export type ScriptFlowPlatform = "android" | "ios" | "harmony" | "flutter";

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

export type ScriptTarget = {
  ocrText?: string;
  pageElement?: string;
};

export type ScriptStepRisk = "none" | "interaction" | "submit" | "publish" | "delete" | "payment";

export type ScriptStepBase = {
  id: string;
  name?: string;
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
  };
};

export type ScriptInputTextStep = ScriptStepBase & {
  inputText: {
    target: ScriptTarget;
    value: string;
  };
};

export type ScriptClearTextStep = ScriptStepBase & {
  clearText: {
    target: ScriptTarget;
  };
};

export type ScriptSelectTextStep = ScriptStepBase & {
  selectText: {
    target: ScriptTarget;
    value: string;
    confirmText?: string;
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

export type ScriptWaitForPageStep = ScriptStepBase & {
  waitForPage: string;
};

export type ScriptAssertPageStep = ScriptStepBase & {
  assertPage: string;
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
  | ScriptWaitForPageStep
  | ScriptAssertPageStep
  | ScriptRunFlowStep
  | ScriptRepeatStep
  | ScriptWhenStep;

export type ScriptFlowDocument = {
  version: 1;
  name: string;
  description?: string;
  app: {
    id: string;
    platform: ScriptFlowPlatform;
  };
  start?: {
    strategy: ScriptFlowStartStrategy;
  };
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
  | "waitForPage"
  | "assertPage";

export type ScriptExecutionPlanStep = {
  id: string;
  order: number;
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
  app: ScriptFlowDocument["app"];
  start?: ScriptFlowDocument["start"];
  parameters: Record<string, ScriptParameterValue>;
  steps: ScriptExecutionPlanStep[];
  riskConfirmations: ScriptRiskConfirmation[];
};

export type CompileScriptFlowOptions = {
  parameters?: Record<string, ScriptParameterValue>;
  resolveFlow?: (id: string) => ScriptFlowDocument | undefined;
  redactSensitiveParameters?: boolean;
};
