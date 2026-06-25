import { Plus, Trash2 } from "lucide-react";
import { isSystemGuardExpectationType, type ActionStep, type StepExpectation, type StepExpectationType } from "@mobile-automation/shared";

type StepExpectationPanelProps = {
  step?: ActionStep;
  stepIndex?: number;
  title?: string;
  addLabel?: string;
  emptyText?: string;
  expectations?: StepExpectation[];
  addStepExpectation?: (index: number, type: StepExpectationType) => void;
  updateStepExpectation?: (stepIndex: number, expectationIndex: number, patch: Partial<StepExpectation>) => void;
  removeStepExpectation?: (stepIndex: number, expectationIndex: number) => void;
  onAddExpectation?: (type: StepExpectationType) => void;
  onUpdateExpectation?: (expectationIndex: number, patch: Partial<StepExpectation>) => void;
  onRemoveExpectation?: (expectationIndex: number) => void;
};

const expectationOptions: Array<{ type: StepExpectationType; label: string }> = [
  { type: "text", label: "文字" },
  { type: "screen_changed", label: "画面变化" },
  { type: "metric_below", label: "指标阈值" },
  { type: "log_not_contains", label: "日志排除" }
];

const metricOptions = [
  { value: "cpuPercent", label: "CPU %" },
  { value: "memoryUsedMb", label: "内存 MB" },
  { value: "batteryLevel", label: "电量 %" },
  { value: "batteryTemperatureC", label: "电池温度" }
];

const textModeOptions = [
  { value: "contains", label: "包含" },
  { value: "equals", label: "等于" },
  { value: "not_contains", label: "不包含" }
];

export function StepExpectationPanel({
  step,
  stepIndex = 0,
  title = "预期验证",
  addLabel,
  emptyText = "系统会默认检查崩溃和可响应；建议给关键步骤增加文字、画面或指标验证。",
  expectations,
  addStepExpectation,
  updateStepExpectation,
  removeStepExpectation,
  onAddExpectation,
  onUpdateExpectation,
  onRemoveExpectation
}: StepExpectationPanelProps) {
  const rawExpectations = expectations ?? step?.expectations ?? [];
  const visibleExpectations = rawExpectations
    .map((expectation, originalIndex) => ({ expectation, originalIndex }))
    .filter(({ expectation }) => !isSystemGuardExpectationType(expectation.type));
  const addExpectation = (type: StepExpectationType) => {
    if (onAddExpectation) {
      onAddExpectation(type);
      return;
    }
    addStepExpectation?.(stepIndex, type);
  };
  const updateExpectation = (originalIndex: number, patch: Partial<StepExpectation>) => {
    if (onUpdateExpectation) {
      onUpdateExpectation(originalIndex, patch);
      return;
    }
    updateStepExpectation?.(stepIndex, originalIndex, patch);
  };
  const removeExpectation = (originalIndex: number) => {
    if (onRemoveExpectation) {
      onRemoveExpectation(originalIndex);
      return;
    }
    removeStepExpectation?.(stepIndex, originalIndex);
  };

  return (
    <div className="step-expectations">
      <div className="expectation-toolbar">
        <span>{title}</span>
        <div>
          {expectationOptions.map((option) => (
            <button className="expectation-add" key={option.type} onClick={() => addExpectation(option.type)} type="button">
              <Plus size={12} />
              {addLabel ?? option.label}
            </button>
          ))}
        </div>
      </div>
      {visibleExpectations.length ? (
        <div className="expectation-list">
          {visibleExpectations.map(({ expectation, originalIndex }) => (
            <div className={expectation.enabled ? "expectation-item" : "expectation-item disabled-expectation"} key={expectation.id}>
              <div className="expectation-main">
                <label className="expectation-toggle">
                  <input
                    type="checkbox"
                    checked={expectation.enabled}
                    onChange={(event) => updateExpectation(originalIndex, { enabled: event.target.checked })}
                  />
                  <strong>{expectationLabel(expectation.type)}</strong>
                  {renderExpectationMeta(expectation)}
                </label>
                <span>{expectationHint(expectation)}</span>
              </div>
              {renderExpectationStrengthEditor(expectation, (patch) => updateExpectation(originalIndex, patch))}
              {renderExpectationEditor(expectation, (patch) => updateExpectation(originalIndex, patch))}
              <button className="icon-only danger" onClick={() => removeExpectation(originalIndex)} title="删除预期">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="expectation-empty">{emptyText}</div>
      )}
    </div>
  );
}

function renderExpectationStrengthEditor(expectation: StepExpectation, update: (patch: Partial<StepExpectation>) => void) {
  const strength = expectation.enabled ? (isBlockingExpectation(expectation) ? "blocking" : "advisory") : "candidate";
  return (
    <div className="expectation-strength">
      <label>
        <span>基准</span>
        <select
          value={strength}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "candidate") {
              update({ enabled: false });
              return;
            }
            update({
              enabled: true,
              params: {
                ...expectation.params,
                blocking: value === "blocking"
              }
            });
          }}
        >
          <option value="blocking">强基准</option>
          <option value="advisory">建议</option>
          <option value="candidate">候选</option>
        </select>
      </label>
    </div>
  );
}

function renderExpectationEditor(expectation: StepExpectation, update: (patch: Partial<StepExpectation>) => void) {
  if (expectation.type === "metric_below") {
    const metric = typeof expectation.params.metric === "string" ? expectation.params.metric : "cpuPercent";
    const threshold = typeof expectation.params.threshold === "number" || typeof expectation.params.threshold === "string" ? expectation.params.threshold : 80;
    return (
      <div className="expectation-editor metric-editor">
        <select
          value={metric}
          onChange={(event) =>
            update({
              params: {
                ...expectation.params,
                metric: event.target.value
              }
            })
          }
        >
          {metricOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={threshold}
          onChange={(event) =>
            update({
              params: {
                ...expectation.params,
                threshold: Number(event.target.value)
              }
            })
          }
        />
      </div>
    );
  }

  if (expectation.type === "log_not_contains") {
    return (
      <div className="expectation-editor">
        <input
          value={String(expectation.params.text ?? "")}
          onChange={(event) =>
            update({
              params: {
                ...expectation.params,
                text: event.target.value
              }
            })
          }
          placeholder="不能出现在日志里的文本"
        />
      </div>
    );
  }

  if (expectation.type === "text") {
    const mode = typeof expectation.params.mode === "string" ? expectation.params.mode : "contains";
    return (
      <div className="expectation-editor text-editor">
        <div className="text-editor-row">
          <label>
            <span>匹配</span>
            <select
              value={mode}
              onChange={(event) =>
                update({
                  params: {
                    ...expectation.params,
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
            <span>期望文字</span>
            <input
              value={String(expectation.params.expected ?? "")}
              onChange={(event) =>
                update({
                  params: {
                    ...expectation.params,
                    expected: event.target.value
                  }
                })
              }
              placeholder="期望文字"
            />
          </label>
          <label>
            <span>OCR 语言</span>
            <input
              value={String(expectation.params.lang ?? "")}
              onChange={(event) =>
                update({
                  params: {
                    ...expectation.params,
                    lang: event.target.value
                  }
                })
              }
              placeholder="可空"
            />
          </label>
        </div>
        <div className="region-editor">
          <span>OCR 区域</span>
          {(["x", "y", "width", "height"] as const).map((key) => (
            <input
              key={key}
              type="number"
              min={key === "width" || key === "height" ? 1 : 0}
              value={String(readExpectationRegionValue(expectation, key) ?? "")}
              onChange={(event) => updateExpectationRegion(expectation, key, event.target.value, update)}
              placeholder={key}
            />
          ))}
        </div>
      </div>
    );
  }

  return null;
}

function readExpectationRegionValue(expectation: StepExpectation, key: "x" | "y" | "width" | "height"): number | string | undefined {
  const region = expectation.params.region;
  if (typeof region === "object" && region !== null) {
    const value = (region as Record<string, unknown>)[key];
    return typeof value === "number" || typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function updateExpectationRegion(
  expectation: StepExpectation,
  key: "x" | "y" | "width" | "height",
  rawValue: string,
  update: (patch: Partial<StepExpectation>) => void
) {
  const currentRegion = typeof expectation.params.region === "object" && expectation.params.region !== null ? expectation.params.region : {};
  const nextRegion = {
    ...(currentRegion as Record<string, unknown>)
  };
  if (rawValue.trim()) {
    nextRegion[key] = Number(rawValue);
  } else {
    delete nextRegion[key];
  }
  const hasRegionValue = Object.values(nextRegion).some((value) => value !== undefined && value !== "");
  update({
    params: {
      ...expectation.params,
      region: hasRegionValue ? nextRegion : undefined
    }
  });
}

export function expectationLabel(type: StepExpectationType): string {
  if (type === "no_crash") {
    return "无崩溃/ANR";
  }
  if (type === "app_alive") {
    return "应用可响应";
  }
  if (type === "screen_changed") {
    return "画面变化";
  }
  if (type === "metric_below") {
    return "指标阈值";
  }
  if (type === "log_not_contains") {
    return "日志排除";
  }
  if (type === "image") {
    return "图像基准";
  }
  return "文字断言";
}

function expectationHint(expectation: StepExpectation): string {
  const autoNote = typeof expectation.note === "string" && expectation.note ? `${expectation.note}；` : "";
  if (expectation.type === "metric_below") {
    return `${autoNote}${expectation.params.metric ?? "cpuPercent"} <= ${expectation.params.threshold ?? "-"}`;
  }
  if (expectation.type === "log_not_contains") {
    return `${autoNote}不包含 "${expectation.params.text ?? ""}"`;
  }
  if (expectation.type === "text") {
    return `${autoNote}${expectation.params.mode ?? "contains"} "${expectation.params.expected ?? ""}"`;
  }
  if (expectation.type === "image") {
    return `${autoNote}图像基准对比规划中，启用后需要人工确认或后续自动比对`;
  }
  if (expectation.type === "screen_changed") {
    return `${autoNote}比较动作前后截图是否变化`;
  }
  if (expectation.type === "app_alive") {
    return `${autoNote}动作后能截图且没有崩溃/ANR`;
  }
  return `${autoNote}执行期间不出现崩溃或 ANR`;
}

function renderExpectationMeta(expectation: StepExpectation) {
  const reliability = typeof expectation.params.reliability === "string" ? expectation.params.reliability : "auto";
  const autoLabel = expectation.enabled ? `自动 ${reliability}` : `候选 ${reliability}`;
  const blocking = isBlockingExpectation(expectation);
  return (
    <>
      {expectation.params.autoGenerated === true && (
        <span className={`expectation-badge ${expectation.enabled ? "enabled" : "candidate"}`} title={expectation.note}>
          {autoLabel}
        </span>
      )}
      <span className={`expectation-badge ${blocking ? "blocking" : "advisory"}`} title={blocking ? "失败会阻断当前步骤" : "失败只记录为建议，不阻断主流程"}>
        {blocking ? "阻断" : "建议"}
      </span>
    </>
  );
}

function isBlockingExpectation(expectation: StepExpectation): boolean {
  if (expectation.params.blocking === false) {
    return false;
  }
  if (expectation.params.autoGenerated === true && expectation.params.reliability === "P1") {
    return false;
  }
  return true;
}
