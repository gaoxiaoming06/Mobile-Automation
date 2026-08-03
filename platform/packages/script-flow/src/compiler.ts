import type {
  CompileScriptFlowOptions,
  ScriptExecutableAction,
  ScriptExecutionPlan,
  ScriptExecutionPlanStep,
  ScriptFlowDocument,
  ScriptParameterDefinition,
  ScriptParameterValue,
  ScriptStep
} from "./types.js";

export class ScriptFlowCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptFlowCompileError";
  }
}

type ExpansionContext = {
  flow: ScriptFlowDocument;
  parameters: Record<string, ScriptParameterValue>;
  renderedParameters: Record<string, ScriptParameterValue>;
  resolveFlow?: CompileScriptFlowOptions["resolveFlow"];
  redactSensitiveParameters: boolean;
  stack: string[];
  prefix: string;
};

type CompiledBodyStep = Omit<ScriptExecutionPlanStep, "order" | "phase">;

export function compileScriptFlow(flow: ScriptFlowDocument, options: CompileScriptFlowOptions = {}): ScriptExecutionPlan {
  const parameters = resolveParameters(flow.parameters, options.parameters ?? {});
  const redactSensitiveParameters = options.redactSensitiveParameters === true;
  const bodySteps = expandSteps(flow.steps, {
    flow,
    parameters,
    renderedParameters: redactSensitiveParameters ? redactParameters(flow.parameters, parameters) : parameters,
    resolveFlow: options.resolveFlow,
    redactSensitiveParameters,
    stack: [flow.name],
    prefix: ""
  }).map((step) => ({ ...step, phase: executionPhase(step) }));
  const steps = bodySteps.map((step, index) => ({ ...step, order: index + 1 }));
  return {
    flowName: flow.name,
    kind: flow.kind,
    purpose: flow.purpose ?? "business",
    testLevel: flow.testLevel ?? "business_smoke",
    app: flow.app,
    ...(flow.start ? { start: flow.start } : {}),
    ...(flow.entry ? { entry: flow.entry } : {}),
    ...(flow.outcome ? { outcome: flow.outcome } : {}),
    ...(flow.loop ? { loop: flow.loop } : {}),
    parameters,
    steps
  };
}

function executionPhase(step: CompiledBodyStep): ScriptExecutionPlanStep["phase"] {
  if (step.role === "reset") return "reset";
  if (step.role === "setup" || step.role === "recovery" || step.action === "launchApp") return "preparation";
  if (step.role === "assertion" || step.role === "cleanup" || step.action === "assertPage" || step.action === "assertText" || step.action === "waitForPage") {
    return "verification";
  }
  return "business";
}

function expandSteps(steps: ScriptStep[], context: ExpansionContext): CompiledBodyStep[] {
  const result: CompiledBodyStep[] = [];
  for (const step of steps) {
    const expandedId = joinId(context.prefix, step.id);
    if ("repeat" in step) {
      const times = resolveRepeatTimes(step.repeat.times, context.parameters, step.id);
      for (let iteration = 1; iteration <= times; iteration += 1) {
        result.push(...expandSteps(step.repeat.steps, {
          ...context,
          prefix: `${expandedId}[${iteration}]`
        }));
      }
      continue;
    }
    if ("when" in step) {
      const actual = context.parameters[step.when.parameter];
      if (actual === step.when.equals) {
        result.push(...expandSteps(step.when.steps, {
          ...context,
          prefix: expandedId
        }));
      }
      continue;
    }
    if ("runFlow" in step) {
      result.push(...expandChildFlow(step, expandedId, context));
      continue;
    }
    result.push(compileExecutableStep(step, expandedId, context));
  }
  return result;
}

function expandChildFlow(
  step: Extract<ScriptStep, { runFlow: string }>,
  expandedId: string,
  context: ExpansionContext
): CompiledBodyStep[] {
  if (context.stack.includes(step.runFlow)) {
    throw new ScriptFlowCompileError(`Recursive runFlow reference: ${[...context.stack, step.runFlow].join(" -> ")}`);
  }
  const child = context.resolveFlow?.(step.runFlow);
  if (!child) {
    throw new ScriptFlowCompileError(`runFlow not found: ${step.runFlow}`);
  }
  if (child.app.id !== context.flow.app.id || child.app.platform !== context.flow.app.platform) {
    throw new ScriptFlowCompileError(`runFlow ${step.runFlow} targets a different app or platform`);
  }
  const rawBindings = step.with ?? {};
  const bindings: Record<string, ScriptParameterValue> = {};
  const renderedBindings: Record<string, ScriptParameterValue> = {};
  for (const key of Object.keys(child.parameters)) {
    if (key in rawBindings) continue;
    const value = context.parameters[key];
    const rendered = context.renderedParameters[key];
    if (value !== undefined) bindings[key] = value;
    if (rendered !== undefined) renderedBindings[key] = rendered;
  }
  for (const [key, value] of Object.entries(rawBindings)) {
    const resolved = interpolateBindingValue(value, context.parameters);
    const rendered = interpolateBindingValue(value, context.renderedParameters);
    if (!isParameterValue(resolved)) {
      throw new ScriptFlowCompileError(`runFlow binding ${key} must resolve to a scalar value`);
    }
    if (!isParameterValue(rendered)) {
      throw new ScriptFlowCompileError(`runFlow binding ${key} must resolve to a scalar value`);
    }
    bindings[key] = resolved;
    renderedBindings[key] = rendered;
  }
  const parameters = resolveParameters(child.parameters, bindings);
  const renderedParameters = context.redactSensitiveParameters
    ? redactParameters(child.parameters, resolveParameters(child.parameters, renderedBindings))
    : parameters;
  return expandSteps(child.steps, {
    flow: child,
    parameters,
    renderedParameters,
    resolveFlow: context.resolveFlow,
    redactSensitiveParameters: context.redactSensitiveParameters,
    stack: [...context.stack, step.runFlow],
    prefix: expandedId
  });
}

function interpolateBindingValue(value: unknown, parameters: Record<string, ScriptParameterValue>): unknown {
  if (typeof value === "string" && /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)) {
    return exactParameterValue(value, parameters);
  }
  return interpolateValue(value, parameters);
}

function compileExecutableStep(
  step: Exclude<ScriptStep, { repeat: unknown } | { when: unknown } | { runFlow: string }>,
  id: string,
  context: ExpansionContext
): CompiledBodyStep {
  const { action, input } = executableAction(step, context.renderedParameters);
  const onPage = step.onPage ? interpolateString(step.onPage, context.renderedParameters) : undefined;
  const expectPage = step.expectPage ? interpolateString(step.expectPage, context.renderedParameters) : undefined;
  return {
    id,
    ...(step.name ? { name: interpolateString(step.name, context.renderedParameters) } : {}),
    role: step.role ?? "business",
    action,
    input,
    ...(onPage ? { onPage } : {}),
    ...(expectPage ? { expectPage } : {}),
    ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}),
    source: {
      flowName: context.flow.name,
      stepId: step.id
    }
  };
}

function executableAction(
  step: Exclude<ScriptStep, { repeat: unknown } | { when: unknown } | { runFlow: string }>,
  parameters: Record<string, ScriptParameterValue>
): { action: ScriptExecutableAction; input: Record<string, unknown> } {
  if ("launchApp" in step) {
    return { action: "launchApp", input: interpolateRecord(step.launchApp, parameters) };
  }
  if ("tap" in step) {
    return { action: "tap", input: interpolateRecord(step.tap, parameters) };
  }
  if ("inputText" in step) {
    return { action: "inputText", input: interpolateRecord(step.inputText, parameters) };
  }
  if ("clearText" in step) {
    return { action: "clearText", input: interpolateRecord(step.clearText, parameters) };
  }
  if ("selectText" in step) {
    return { action: "selectText", input: interpolateRecord(step.selectText, parameters) };
  }
  if ("swipe" in step) {
    return { action: "swipe", input: interpolateRecord(step.swipe, parameters) };
  }
  if ("scrollUntilVisible" in step) {
    return { action: "scrollUntilVisible", input: interpolateRecord(step.scrollUntilVisible, parameters) };
  }
  if ("reachPage" in step) {
    return {
      action: "reachPage",
      input: {
        pageId: interpolateString(step.reachPage.page, parameters),
        policy: step.reachPage.policy ?? "safe"
      }
    };
  }
  if ("waitForPage" in step) {
    return {
      action: "waitForPage",
      input: {
        pageId: interpolateString(step.waitForPage, parameters),
        ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {})
      }
    };
  }
  if ("assertText" in step) {
    return { action: "assertText", input: interpolateRecord(step.assertText, parameters) };
  }
  return {
    action: "assertPage",
    input: { pageId: interpolateString(step.assertPage, parameters) }
  };
}

function resolveParameters(
  definitions: Record<string, ScriptParameterDefinition>,
  provided: Record<string, ScriptParameterValue>
): Record<string, ScriptParameterValue> {
  for (const key of Object.keys(provided)) {
    if (!definitions[key]) {
      throw new ScriptFlowCompileError(`Unknown parameter: ${key}`);
    }
  }
  const result: Record<string, ScriptParameterValue> = {};
  for (const [key, definition] of Object.entries(definitions)) {
    const value = provided[key] ?? definition.default;
    if (value === undefined) {
      if (definition.required) {
        throw new ScriptFlowCompileError(`Missing required parameter: ${key}`);
      }
      continue;
    }
    if (!valueMatchesType(value, definition.type)) {
      throw new ScriptFlowCompileError(`Parameter ${key} must be ${definition.type}`);
    }
    result[key] = value;
  }
  return result;
}

function redactParameters(
  definitions: Record<string, ScriptParameterDefinition>,
  parameters: Record<string, ScriptParameterValue>
): Record<string, ScriptParameterValue> {
  return Object.fromEntries(Object.entries(parameters).map(([key, value]) => [
    key,
    definitions[key]?.sensitive === true ? redactedValue(value) : value
  ]));
}

function redactedValue(value: ScriptParameterValue): ScriptParameterValue {
  if (typeof value === "number") {
    return value === Number.MIN_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;
  }
  if (typeof value === "boolean") {
    return !value;
  }
  const marker = "__SCRIPT_FLOW_REDACTED__";
  return value === marker ? `${marker}_` : marker;
}

function resolveRepeatTimes(value: number | string, parameters: Record<string, ScriptParameterValue>, stepId: string): number {
  const resolved = typeof value === "number" ? value : exactParameterValue(value, parameters);
  if (typeof resolved !== "number" || !Number.isInteger(resolved) || resolved < 1 || resolved > 100) {
    throw new ScriptFlowCompileError(`Repeat step ${stepId} requires an integer between 1 and 100`);
  }
  return resolved;
}

function interpolateRecord<T extends Record<string, unknown>>(value: T, parameters: Record<string, ScriptParameterValue>): Record<string, unknown> {
  return interpolateValue(value, parameters) as Record<string, unknown>;
}

function interpolateValue(value: unknown, parameters: Record<string, ScriptParameterValue>): unknown {
  if (typeof value === "string") {
    return interpolateString(value, parameters);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, parameters));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolateValue(item, parameters)]));
  }
  return value;
}

function interpolateString(value: string, parameters: Record<string, ScriptParameterValue>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, key: string) => {
    const replacement = parameters[key];
    if (replacement === undefined) {
      throw new ScriptFlowCompileError(`Missing parameter value: ${key}`);
    }
    return String(replacement);
  });
}

function exactParameterValue(value: string, parameters: Record<string, ScriptParameterValue>): ScriptParameterValue {
  const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
  if (!match) {
    throw new ScriptFlowCompileError(`Expected a parameter reference, received: ${value}`);
  }
  const result = parameters[match[1]];
  if (result === undefined) {
    throw new ScriptFlowCompileError(`Missing parameter value: ${match[1]}`);
  }
  return result;
}

function valueMatchesType(value: ScriptParameterValue, type: ScriptParameterDefinition["type"]): boolean {
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "boolean") {
    return typeof value === "boolean";
  }
  return typeof value === "string";
}

function isParameterValue(value: unknown): value is ScriptParameterValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function joinId(prefix: string, id: string): string {
  return prefix ? `${prefix}.${id}` : id;
}
