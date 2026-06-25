import type { ActionStep } from "@mobile-automation/shared";

type StepConditionEditorProps = {
  step: ActionStep;
  update: (patch: Partial<ActionStep>) => void;
};

const textModeOptions = [
  { value: "contains", label: "包含" },
  { value: "equals", label: "等于" },
  { value: "not_contains", label: "不包含" }
];

export function StepConditionEditor({ step, update }: StepConditionEditorProps) {
  if (step.type !== "tap_if_text") {
    return null;
  }
  const mode = typeof step.params.mode === "string" ? step.params.mode : "contains";
  const text = String(step.params.text ?? "");
  const timeoutMs = Number(step.params.timeoutMs ?? 3000);
  const intervalMs = Number(step.params.intervalMs ?? 500);
  const x = step.coordinate?.x ?? "";
  const y = step.coordinate?.y ?? "";

  return (
    <div className="condition-editor">
      <label>
        触发文字
        <input
          value={text}
          onChange={(event) =>
            update({
              params: {
                ...step.params,
                text: event.target.value
              }
            })
          }
          placeholder="例如：允许、稍后、关闭"
        />
      </label>
      <label>
        匹配
        <select
          value={mode}
          onChange={(event) =>
            update({
              params: {
                ...step.params,
                mode: event.target.value
              }
            })
          }
        >
          {textModeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        点击 X
        <input
          type="number"
          value={x}
          onChange={(event) =>
            update({
              coordinate: {
                ...(step.coordinate ?? {}),
                x: Number(event.target.value)
              }
            })
          }
        />
      </label>
      <label>
        点击 Y
        <input
          type="number"
          value={y}
          onChange={(event) =>
            update({
              coordinate: {
                ...(step.coordinate ?? {}),
                y: Number(event.target.value)
              }
            })
          }
        />
      </label>
      <label>
        等待 ms
        <input
          type="number"
          min={0}
          step={100}
          value={timeoutMs}
          onChange={(event) =>
            update({
              params: {
                ...step.params,
                timeoutMs: Number(event.target.value)
              }
            })
          }
        />
      </label>
      <label>
        轮询 ms
        <input
          type="number"
          min={100}
          step={100}
          value={intervalMs}
          onChange={(event) =>
            update({
              params: {
                ...step.params,
                intervalMs: Number(event.target.value)
              }
            })
          }
        />
      </label>
    </div>
  );
}
