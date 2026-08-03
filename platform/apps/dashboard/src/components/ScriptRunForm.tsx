import { Play, Square } from "lucide-react";

export type ScriptParameterValue = string | number | boolean;
export type ScriptRunExecutionMode = "once" | "loop_body" | "loop_all";

export type ScriptParameterDefinitionView = {
  type: "string" | "number" | "boolean" | "datetime";
  label?: string;
  description?: string;
  required?: boolean;
  default?: ScriptParameterValue;
  sensitive?: boolean;
  control?: "text" | "number" | "toggle" | "datetime" | "select";
  options?: Array<{ label: string; value: ScriptParameterValue }>;
  advanced?: boolean;
};

type ScriptRunFormProps = {
  parameters: Record<string, ScriptParameterDefinitionView>;
  values: Record<string, ScriptParameterValue>;
  devices: Array<{ serial: string; name?: string }>;
  deviceSerial: string;
  busy: boolean;
  executionMode?: ScriptRunExecutionMode;
  active?: boolean;
  currentIteration?: number;
  disabled?: boolean;
  loopBodyAvailable?: boolean;
  loopBodyUnavailableReason?: string;
  buttonLabel?: string;
  onValueChange: (key: string, value: ScriptParameterValue) => void;
  onDeviceChange: (serial: string) => void;
  onExecutionModeChange?: (mode: ScriptRunExecutionMode) => void;
  onRun: () => void;
  onStop?: () => void;
};

export function ScriptRunForm({
  parameters,
  values,
  devices,
  deviceSerial,
  busy,
  executionMode = "once",
  active = false,
  currentIteration,
  disabled = false,
  loopBodyAvailable = true,
  loopBodyUnavailableReason,
  buttonLabel = "开始执行",
  onValueChange,
  onDeviceChange,
  onExecutionModeChange,
  onRun,
  onStop
}: ScriptRunFormProps) {
  const entries = Object.entries(parameters);
  const primary = entries.filter(([, definition]) => definition.required || !definition.advanced);
  const optional = entries.filter(([, definition]) => !definition.required && definition.advanced);
  const missingRequired = entries.some(([key, definition]) => definition.required && isMissing(values[key]));

  return (
    <section className="script-run-form">
      <header><h3>运行配置</h3></header>
      <label className="script-run-device">
        <span>设备</span>
        <select value={deviceSerial} onChange={(event) => onDeviceChange(event.target.value)}>
          <option value="">选择设备</option>
          {devices.map((device) => <option key={device.serial} value={device.serial}>{device.name ?? device.serial}</option>)}
        </select>
      </label>
      <div className="script-run-mode">
        <span>执行方式</span>
        <div role="group" aria-label="执行方式">
          {executionModes.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={executionMode === option.value}
              disabled={busy || active || (option.value === "loop_body" && !loopBodyAvailable)}
              title={option.value === "loop_body" && !loopBodyAvailable ? loopBodyUnavailableReason : undefined}
              onClick={() => onExecutionModeChange?.(option.value)}
            >{option.label}</button>
          ))}
        </div>
        {executionMode === "loop_body" && !loopBodyAvailable
          ? <small className="script-run-mode-warning">{loopBodyUnavailableReason ?? "请先配置每轮复位步骤。"}</small>
          : executionMode !== "once" ? <small>
              {executionMode === "loop_body"
                ? "前置准备只执行一次；每轮按业务、验证、复位的顺序执行。"
                : "全部常规步骤每轮都会执行；每轮复位步骤不参与此模式。"}
            </small> : null}
      </div>
      <div className="script-parameter-grid">
        {primary.map(([key, definition]) => (
          <ParameterField key={key} parameterKey={key} definition={definition} value={values[key]} onChange={onValueChange} />
        ))}
      </div>
      {optional.length ? (
        <details className="script-optional-parameters">
          <summary>可选参数</summary>
          <div className="script-parameter-grid">
            {optional.map(([key, definition]) => (
              <ParameterField key={key} parameterKey={key} definition={definition} value={values[key]} onChange={onValueChange} />
            ))}
          </div>
        </details>
      ) : null}
      {active ? <button className="script-run-button script-stop-button" type="button" onClick={onStop} disabled={busy || !onStop}>
        <Square size={15} />
        <span>{busy ? "停止中" : executionMode === "once" ? "停止执行" : `停止循环${currentIteration ? ` · 第 ${currentIteration} 轮` : ""}`}</span>
        </button> : <button className="primary-button script-run-button" type="button" onClick={onRun} disabled={busy || disabled || !deviceSerial || missingRequired || (executionMode === "loop_body" && !loopBodyAvailable)}>
          <Play size={16} />
          <span>{busy ? "启动中" : buttonLabel}</span>
        </button>}
    </section>
  );
}

const executionModes: Array<{ value: ScriptRunExecutionMode; label: string }> = [
  { value: "once", label: "单次执行" },
  { value: "loop_body", label: "循环业务与验证" },
  { value: "loop_all", label: "循环整个用例" }
];

export function runOptionsForExecutionMode(mode: ScriptRunExecutionMode): {
  mode: "once" | "loop_until_stop";
  loopScope?: "all_steps" | "exclude_preparation";
} {
  if (mode === "loop_body") return { mode: "loop_until_stop", loopScope: "exclude_preparation" };
  if (mode === "loop_all") return { mode: "loop_until_stop", loopScope: "all_steps" };
  return { mode: "once" };
}

export function currentRunIteration(stepResults: Array<{ iterationIndex: number }>): number {
  return stepResults.reduce((current, result) => Math.max(current, result.iterationIndex), 0);
}

function ParameterField({
  parameterKey,
  definition,
  value,
  onChange
}: {
  parameterKey: string;
  definition: ScriptParameterDefinitionView;
  value: ScriptParameterValue | undefined;
  onChange: (key: string, value: ScriptParameterValue) => void;
}) {
  const label = definition.label ?? parameterKey;
  const control = definition.control ?? defaultControl(definition);
  return (
    <label className="script-parameter-field">
      <span>{label}{definition.required ? <strong>必填</strong> : null}</span>
      {control === "select" ? (
        <select value={scalarInputValue(value)} onChange={(event) => onChange(parameterKey, optionValue(definition, event.target.value))}>
          <option value="">请选择</option>
          {(definition.options ?? []).map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
        </select>
      ) : control === "toggle" || definition.type === "boolean" ? (
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(parameterKey, event.target.checked)} />
      ) : (
        <input
          type={control === "datetime" || definition.type === "datetime" ? "datetime-local" : control === "number" || definition.type === "number" ? "number" : definition.sensitive ? "password" : "text"}
          value={scalarInputValue(value)}
          onChange={(event) => onChange(parameterKey, definition.type === "number" ? Number(event.target.value) : event.target.value)}
        />
      )}
      {definition.description ? <small>{definition.description}</small> : null}
    </label>
  );
}

function defaultControl(definition: ScriptParameterDefinitionView): NonNullable<ScriptParameterDefinitionView["control"]> {
  if (definition.type === "boolean") return "toggle";
  if (definition.type === "number") return "number";
  if (definition.type === "datetime") return "datetime";
  return "text";
}

function optionValue(definition: ScriptParameterDefinitionView, raw: string): ScriptParameterValue {
  return definition.options?.find((option) => String(option.value) === raw)?.value ?? raw;
}

function scalarInputValue(value: ScriptParameterValue | undefined): string {
  return value === undefined ? "" : String(value);
}

function isMissing(value: ScriptParameterValue | undefined): boolean {
  return value === undefined || value === "";
}
