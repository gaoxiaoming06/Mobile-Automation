import { Play } from "lucide-react";

export type ScriptParameterValue = string | number | boolean;

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
  requiredRisks: string[];
  confirmedRisks: string[];
  busy: boolean;
  disabled?: boolean;
  onValueChange: (key: string, value: ScriptParameterValue) => void;
  onDeviceChange: (serial: string) => void;
  onRiskChange: (risk: string, checked: boolean) => void;
  onRun: () => void;
};

export function ScriptRunForm({
  parameters,
  values,
  devices,
  deviceSerial,
  requiredRisks,
  confirmedRisks,
  busy,
  disabled = false,
  onValueChange,
  onDeviceChange,
  onRiskChange,
  onRun
}: ScriptRunFormProps) {
  const entries = Object.entries(parameters);
  const primary = entries.filter(([, definition]) => definition.required || !definition.advanced);
  const optional = entries.filter(([, definition]) => !definition.required && definition.advanced);
  const missingRequired = entries.some(([key, definition]) => definition.required && isMissing(values[key]));
  const missingRisk = requiredRisks.some((risk) => !confirmedRisks.includes(risk));

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
      {requiredRisks.length ? (
        <fieldset className="script-risk-confirmations">
          <legend>风险确认</legend>
          {requiredRisks.map((risk) => (
            <label key={risk}>
              <input
                type="checkbox"
                checked={confirmedRisks.includes(risk)}
                onChange={(event) => onRiskChange(risk, event.target.checked)}
              />
              <span>{riskLabel(risk)}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <button className="primary-button script-run-button" type="button" onClick={onRun} disabled={busy || disabled || !deviceSerial || missingRequired || missingRisk}>
        <Play size={16} />
        <span>{busy ? "启动中" : "开始执行"}</span>
      </button>
    </section>
  );
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

function riskLabel(risk: string): string {
  const labels: Record<string, string> = { publish: "发布", submit: "提交", delete: "删除", payment: "支付" };
  return `确认执行${labels[risk] ?? risk}`;
}
