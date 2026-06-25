import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { isSystemGuardExpectationType, type ActionStep, type ActionType, type StepExpectation, type StepExpectationType } from "@mobile-automation/shared";
import { createStepExpectation } from "../recording";
import { StepConditionEditor } from "./StepConditionEditor";
import { expectationLabel, StepExpectationPanel } from "./StepExpectationPanel";

type StepListProps = {
  steps: ActionStep[];
  moveStep: (index: number, direction: -1 | 1) => void;
  removeStep: (index: number) => void;
  insertWaitStep: (index: number) => void;
  insertConditionalTapStep: (index: number) => void;
  copyStep: (index: number) => void;
  toggleStepEnabled: (index: number) => void;
  updateStep: (index: number, patch: Partial<ActionStep>) => void;
  addStepExpectation: (index: number, type: StepExpectationType) => void;
  updateStepExpectation: (stepIndex: number, expectationIndex: number, patch: Partial<StepExpectation>) => void;
  removeStepExpectation: (stepIndex: number, expectationIndex: number) => void;
};

export type RecordingEvidencePhase = "before" | "after";

export type RecordingEvidenceCandidate = {
  kind: "activity" | "element" | "text" | "ocr_text";
  label: string;
  value: string;
  source: "activity" | "element" | "ocr" | "summary";
  candidate?: Record<string, unknown>;
  textCandidate?: Record<string, unknown>;
};

export function StepList({
  steps,
  moveStep,
  removeStep,
  insertWaitStep,
  insertConditionalTapStep,
  copyStep,
  toggleStepEnabled,
  updateStep,
  addStepExpectation,
  updateStepExpectation,
  removeStepExpectation
}: StepListProps) {
  return (
    <div className={steps.length ? "step-list" : "step-list empty-step-list"}>
      {steps.map((step, index) => (
        <div className={step.enabled ? "step-item" : "step-item disabled-step"} key={step.id}>
          <div className="step-row">
            <div className="step-main">
              <span className="step-order">{step.order}</span>
              <div>
                <strong>{step.type}</strong>
                <span>{summarizeStep(step)}</span>
              </div>
            </div>
            <div className="step-actions">
              <button className="icon-only" onClick={() => toggleStepEnabled(index)} title={step.enabled ? "禁用" : "启用"}>
                {step.enabled ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              <button className="icon-only" onClick={() => insertWaitStep(index)} title="插入等待">
                <Plus size={15} />
              </button>
              <button className="icon-only" onClick={() => insertConditionalTapStep(index)} title="插入条件点击">
                条件
              </button>
              <button className="icon-only" onClick={() => copyStep(index)} title="复制">
                <Copy size={15} />
              </button>
              <button className="icon-only" onClick={() => moveStep(index, -1)} title="上移">
                <ArrowUp size={15} />
              </button>
              <button className="icon-only" onClick={() => moveStep(index, 1)} title="下移">
                <ArrowDown size={15} />
              </button>
              <button className="icon-only danger" onClick={() => removeStep(index)} title="删除">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
          <StepRuleEditor
            addStepExpectation={addStepExpectation}
            index={index}
            removeStepExpectation={removeStepExpectation}
            step={step}
            updateStep={(patch) => updateStep(index, patch)}
            updateStepExpectation={updateStepExpectation}
          />
        </div>
      ))}
      {!steps.length && <div className="empty">点击预览、返回、Home、输入或等待会生成步骤</div>}
    </div>
  );
}

function StepRuleEditor({
  addStepExpectation,
  index,
  removeStepExpectation,
  step,
  updateStep,
  updateStepExpectation
}: {
  addStepExpectation: (index: number, type: StepExpectationType) => void;
  index: number;
  removeStepExpectation: (stepIndex: number, expectationIndex: number) => void;
  step: ActionStep;
  updateStep: (patch: Partial<ActionStep>) => void;
  updateStepExpectation: (stepIndex: number, expectationIndex: number, patch: Partial<StepExpectation>) => void;
}) {
  const preconditions = step.preconditions ?? [];
  const expectations = (step.expectations ?? []).filter((expectation) => !isSystemGuardExpectationType(expectation.type));
  const recordingContext = objectParam(step.params.recordingContext);

  return (
    <div className="step-rule-editor">
      <RuleSummaryRow label="前置条件" values={preconditions.map(formatExpectationSummary)} emptyText="未配置，回放时按当前步骤顺序执行" />
      <RuleSummaryRow label="动作策略" values={[formatActionDetail(step)]} emptyText={step.type} strong />
      <RuleSummaryRow label="后置预期" values={expectations.map(formatExpectationSummary)} emptyText="未配置业务预期，建议给关键步骤补充文字或画面验证" />
      <ObservationEvidenceStrip
        context={recordingContext}
        onUseActionTarget={(candidate) => updateStep(buildActionTargetPatchFromEvidence(candidate))}
        onUseStrongAfter={(candidate) =>
          updateStep({
            expectations: [...(step.expectations ?? []), buildStrongExpectationFromEvidence(candidate, "after")]
          })
        }
        onUseStrongBefore={(candidate) =>
          updateStep({
            preconditions: [...preconditions, buildStrongExpectationFromEvidence(candidate, "before")]
          })
        }
      />
      <StepExpectationPanel
        addLabel="添加前置条件"
        emptyText="还没有强前置；可以从录制前页面信息里选择文字、resource-id、desc 或页面状态作为强基准。"
        expectations={preconditions}
        onAddExpectation={(type) =>
          updateStep({
            preconditions: [...preconditions, createStepExpectation(type)]
          })
        }
        onRemoveExpectation={(expectationIndex) =>
          updateStep({
            preconditions: preconditions.filter((_, itemIndex) => itemIndex !== expectationIndex)
          })
        }
        onUpdateExpectation={(expectationIndex, patch) =>
          updateStep({
            preconditions: preconditions.map((expectation, itemIndex) =>
              itemIndex === expectationIndex
                ? {
                    ...expectation,
                    ...patch,
                    params: patch.params ?? expectation.params
                  }
                : expectation
            )
          })
        }
        title="前置条件"
      />
      <ActionPolicyEditor step={step} updateStep={updateStep} />
      <StepConditionEditor step={step} update={updateStep} />
      <StepExpectationPanel
        addLabel="添加后置预期"
        emptyText="还没有业务后置预期；建议从动作后页面信息里选择到达页面文字、元素或画面变化作为强基准。"
        step={step}
        stepIndex={index}
        addStepExpectation={addStepExpectation}
        updateStepExpectation={updateStepExpectation}
        removeStepExpectation={removeStepExpectation}
        title="后置预期"
      />
    </div>
  );
}

function ActionPolicyEditor({ step, updateStep }: { step: ActionStep; updateStep: (patch: Partial<ActionStep>) => void }) {
  const actionType = editableActionTypes.includes(step.type) ? step.type : "tap";
  return (
    <div className="action-policy-editor">
      <div className="action-policy-head">
        <strong>动作策略</strong>
        <label>
          <span>驱动方式</span>
          <select value={actionType} onChange={(event) => updateStep(actionPatchForType(step, event.target.value as ActionType))}>
            {editableActionTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="action-policy-grid">
        {renderActionFields(step, updateStep)}
      </div>
      <div className="action-policy-note">录制坐标只作为 fallback；稳定流程优先使用 resource-id、content-desc、文字或图像区域。</div>
    </div>
  );
}

const editableActionTypes: ActionType[] = [
  "tap_on_element",
  "tap_on_text",
  "tap_on_image",
  "input_text_to_element",
  "scroll_until_visible",
  "wait_until_state",
  "tap",
  "long_press",
  "swipe",
  "input_text",
  "wait",
  "back",
  "home",
  "recent_apps"
];

function actionPatchForType(step: ActionStep, type: ActionType): Partial<ActionStep> {
  const locator = objectParam(step.params.locator);
  const resourceId = stringValue(step.params.resourceId ?? locator?.resourceId);
  const contentDesc = stringValue(step.params.contentDesc ?? locator?.contentDesc);
  const text = stringValue(step.params.text ?? locator?.text);
  const occurrence = numberValue(step.params.occurrence ?? locator?.occurrence);
  const nextParams: Record<string, unknown> = {};
  if (type === "tap_on_element" || type === "input_text_to_element" || type === "scroll_until_visible" || type === "wait_until_state") {
    nextParams.locator = {
      strategy: "android_uiautomator",
      ...(resourceId ? { resourceId } : {}),
      ...(contentDesc ? { contentDesc } : {}),
      ...(text ? { text } : {}),
      ...(occurrence ? { occurrence } : {})
    };
    nextParams.selector = resourceId ? `id=${resourceId}` : contentDesc ? `desc=${contentDesc}` : text ? `text=${text}` : "";
    if (resourceId) {
      nextParams.resourceId = resourceId;
    }
    if (contentDesc) {
      nextParams.contentDesc = contentDesc;
    }
    if (text) {
      nextParams.text = text;
    }
  }
  if (type === "tap_on_text") {
    nextParams.text = text ?? "";
    nextParams.mode = stringValue(step.params.mode) ?? "contains";
    nextParams.lang = stringValue(step.params.lang) ?? "";
  }
  if (type === "tap_on_image") {
    nextParams.baselineArtifactId = stringValue(step.params.baselineArtifactId) ?? "";
  }
  if (type === "input_text" || type === "input_text_to_element") {
    nextParams.text = type === "input_text_to_element" ? "" : text ?? stringValue(step.params.inputText) ?? "";
    if (type === "input_text_to_element") {
      nextParams.inputText = stringValue(step.params.inputText) ?? "";
    }
  }
  if (type === "scroll_until_visible") {
    nextParams.direction = stringValue(step.params.direction) ?? "down";
    nextParams.maxSwipes = numberValue(step.params.maxSwipes) ?? 5;
  }
  if (type === "wait_until_state") {
    nextParams.timeoutMs = numberValue(step.params.timeoutMs) ?? 8000;
    nextParams.intervalMs = numberValue(step.params.intervalMs) ?? 500;
  }
  if (type === "wait") {
    nextParams.durationMs = numberValue(step.params.durationMs) ?? 1000;
  }
  return {
    type,
    params: nextParams
  };
}

function renderActionFields(step: ActionStep, updateStep: (patch: Partial<ActionStep>) => void) {
  const locator = objectParam(step.params.locator);
  if (["tap_on_element", "input_text_to_element", "scroll_until_visible", "wait_until_state"].includes(step.type)) {
    return (
      <>
        <ParamInput label="resource-id" value={stringValue(step.params.resourceId ?? locator?.resourceId)} onChange={(value) => updateLocatorParam(step, updateStep, "resourceId", value)} />
        <ParamInput label="content-desc" value={stringValue(step.params.contentDesc ?? locator?.contentDesc)} onChange={(value) => updateLocatorParam(step, updateStep, "contentDesc", value)} />
        <ParamInput label="文字" value={stringValue(step.params.text ?? locator?.text)} onChange={(value) => updateLocatorParam(step, updateStep, "text", value)} />
        <ParamInput label="序号" type="number" value={numberValue(step.params.occurrence ?? locator?.occurrence)} onChange={(value) => updateLocatorParam(step, updateStep, "occurrence", value ? Number(value) : undefined)} />
        {step.type === "input_text_to_element" && (
          <ParamInput label="输入文本" value={stringValue(step.params.inputText ?? step.params.text)} onChange={(value) => updateStep({ params: { inputText: value, text: value } })} />
        )}
        {step.type === "scroll_until_visible" && (
          <>
            <ParamSelect label="方向" value={stringValue(step.params.direction) ?? "down"} options={["down", "up", "left", "right"]} onChange={(value) => updateStep({ params: { direction: value } })} />
            <ParamInput label="最大滑动" type="number" value={numberValue(step.params.maxSwipes) ?? 5} onChange={(value) => updateStep({ params: { maxSwipes: Number(value) } })} />
          </>
        )}
      </>
    );
  }
  if (step.type === "tap_on_text") {
    return (
      <>
        <ParamInput label="目标文字" value={stringValue(step.params.text)} onChange={(value) => updateStep({ params: { text: value } })} />
        <ParamSelect label="匹配" value={stringValue(step.params.mode) ?? "contains"} options={["contains", "equals"]} onChange={(value) => updateStep({ params: { mode: value } })} />
        <ParamInput label="OCR 语言" value={stringValue(step.params.lang)} onChange={(value) => updateStep({ params: { lang: value } })} />
      </>
    );
  }
  if (step.type === "tap_on_image") {
    return <ParamInput label="图像基准" value={stringValue(step.params.baselineArtifactId)} onChange={(value) => updateStep({ params: { baselineArtifactId: value } })} />;
  }
  if (step.type === "input_text") {
    return <ParamInput label="输入文本" value={stringValue(step.params.text)} onChange={(value) => updateStep({ params: { text: value } })} />;
  }
  if (step.type === "wait") {
    return <ParamInput label="等待 ms" type="number" value={numberValue(step.params.durationMs) ?? 1000} onChange={(value) => updateStep({ params: { durationMs: Number(value) } })} />;
  }
  if (step.type === "tap" || step.type === "long_press") {
    return (
      <>
        <ParamInput label="fallback X" type="number" value={step.coordinate?.x} onChange={(value) => updateStep({ coordinate: { ...(step.coordinate ?? {}), x: Number(value) } })} />
        <ParamInput label="fallback Y" type="number" value={step.coordinate?.y} onChange={(value) => updateStep({ coordinate: { ...(step.coordinate ?? {}), y: Number(value) } })} />
      </>
    );
  }
  if (step.type === "swipe") {
    return (
      <>
        <ParamInput label="起点 X" type="number" value={step.coordinate?.startX} onChange={(value) => updateStep({ coordinate: { ...(step.coordinate ?? {}), startX: Number(value) } })} />
        <ParamInput label="起点 Y" type="number" value={step.coordinate?.startY} onChange={(value) => updateStep({ coordinate: { ...(step.coordinate ?? {}), startY: Number(value) } })} />
        <ParamInput label="终点 X" type="number" value={step.coordinate?.endX} onChange={(value) => updateStep({ coordinate: { ...(step.coordinate ?? {}), endX: Number(value) } })} />
        <ParamInput label="终点 Y" type="number" value={step.coordinate?.endY} onChange={(value) => updateStep({ coordinate: { ...(step.coordinate ?? {}), endY: Number(value) } })} />
      </>
    );
  }
  return <span className="muted">该系统动作无需额外参数。</span>;
}

function updateLocatorParam(
  step: ActionStep,
  updateStep: (patch: Partial<ActionStep>) => void,
  key: "resourceId" | "contentDesc" | "text" | "occurrence",
  value: string | number | undefined
) {
  const locator = objectParam(step.params.locator) ?? {};
  const nextLocator = {
    ...locator,
    [key]: value
  };
  const resourceId = key === "resourceId" ? value : nextLocator.resourceId;
  const contentDesc = key === "contentDesc" ? value : nextLocator.contentDesc;
  const text = key === "text" ? value : nextLocator.text;
  const selector = typeof resourceId === "string" && resourceId ? `id=${resourceId}` : typeof contentDesc === "string" && contentDesc ? `desc=${contentDesc}` : typeof text === "string" && text ? `text=${text}` : "";
  updateStep({
    params: {
      locator: nextLocator,
      selector,
      ...(key === "resourceId" ? { resourceId: value } : {}),
      ...(key === "contentDesc" ? { contentDesc: value } : {}),
      ...(key === "text" ? { text: value } : {}),
      ...(key === "occurrence" ? { occurrence: value } : {})
    }
  });
}

function ParamInput({
  label,
  onChange,
  type = "text",
  value
}: {
  label: string;
  onChange: (value: string) => void;
  type?: "number" | "text";
  value: number | string | undefined;
}) {
  return (
    <label>
      <span>{label}</span>
      <input type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ParamSelect({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ObservationEvidenceStrip({
  context,
  onUseActionTarget,
  onUseStrongAfter,
  onUseStrongBefore
}: {
  context: Record<string, unknown> | undefined;
  onUseActionTarget: (candidate: RecordingEvidenceCandidate) => void;
  onUseStrongAfter: (candidate: RecordingEvidenceCandidate) => void;
  onUseStrongBefore: (candidate: RecordingEvidenceCandidate) => void;
}) {
  const before = objectParam(context?.beforeObservation);
  const after = objectParam(context?.afterObservation);
  if (!before && !after) {
    return null;
  }
  return (
    <div className="recording-evidence-strip">
      <EvidenceGroup
        label="动作前采集"
        observation={before}
        phase="before"
        onUseActionTarget={onUseActionTarget}
        onUseStrongBaseline={onUseStrongBefore}
      />
      <EvidenceGroup
        label="动作后采集"
        observation={after}
        phase="after"
        onUseActionTarget={onUseActionTarget}
        onUseStrongBaseline={onUseStrongAfter}
      />
    </div>
  );
}

function EvidenceGroup({
  label,
  observation,
  onUseActionTarget,
  onUseStrongBaseline,
  phase
}: {
  label: string;
  observation: Record<string, unknown> | undefined;
  onUseActionTarget: (candidate: RecordingEvidenceCandidate) => void;
  onUseStrongBaseline: (candidate: RecordingEvidenceCandidate) => void;
  phase: RecordingEvidencePhase;
}) {
  if (!observation) {
    return (
      <div className="recording-evidence-group empty">
        <strong>{label}</strong>
        <span>暂无采集</span>
      </div>
    );
  }
  const chips = [
    stringValue(observation.activityName),
    ...arrayOfStrings(observation.resourceIds).slice(0, 3),
    ...arrayOfStrings(observation.contentDescriptions).slice(0, 2),
    ...arrayOfStrings(observation.texts).slice(0, 4)
  ].filter(Boolean);
  return (
    <div className="recording-evidence-group">
      <strong>{label}</strong>
      <span>
        UI {String(observation.uiElementCount ?? 0)} · OCR {String(observation.ocrTextCount ?? 0)}
      </span>
      <small>可选为强基准；动作前证据也可以直接用作动作目标。</small>
      <div className="recording-evidence-chips">
        {chips.length ? chips.map((chip) => <em key={`${label}-${chip}`}>{chip}</em>) : <em>未提取到稳定候选</em>}
      </div>
      <EvidenceCandidateList
        candidates={recordingEvidenceCandidates(observation)}
        onUseActionTarget={onUseActionTarget}
        onUseStrongBaseline={onUseStrongBaseline}
        phase={phase}
      />
    </div>
  );
}

function EvidenceCandidateList({
  candidates,
  onUseActionTarget,
  onUseStrongBaseline,
  phase
}: {
  candidates: RecordingEvidenceCandidate[];
  onUseActionTarget: (candidate: RecordingEvidenceCandidate) => void;
  onUseStrongBaseline: (candidate: RecordingEvidenceCandidate) => void;
  phase: RecordingEvidencePhase;
}) {
  if (!candidates.length) {
    return null;
  }
  return (
    <div className="recording-evidence-candidates">
      {candidates.map((candidate, index) => (
        <div className="recording-evidence-candidate" key={`${phase}-${candidate.kind}-${candidate.value}-${index}`}>
          <div>
            <span>{candidate.label}</span>
            <strong>{candidate.value}</strong>
            {candidateMeta(candidate) && <small>{candidateMeta(candidate)}</small>}
          </div>
          <div className="recording-evidence-actions">
            {isActionTargetEvidence(candidate) && (
              <button type="button" onClick={() => onUseActionTarget(candidate)}>
                用作动作目标
              </button>
            )}
            <button type="button" onClick={() => onUseStrongBaseline(candidate)}>
              {phase === "before" ? "设为强前置" : "设为强后置"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function recordingEvidenceCandidates(observation: Record<string, unknown>): RecordingEvidenceCandidate[] {
  const candidates: RecordingEvidenceCandidate[] = [];
  const activityName = stringValue(observation.activityName);
  if (activityName) {
    candidates.push({
      kind: "activity",
      label: "Activity",
      value: activityName,
      source: "activity"
    });
  }

  arrayOfObjects(observation.elementCandidates)
    .slice(0, 6)
    .forEach((candidate) => {
      const resourceId = stringValue(candidate.resourceId);
      const contentDesc = stringValue(candidate.contentDesc ?? candidate.accessibilityId);
      const text = stringValue(candidate.text);
      const className = stringValue(candidate.className);
      if (resourceId) {
        candidates.push({
          kind: "element",
          label: "resource-id",
          value: resourceId,
          source: "element",
          candidate
        });
      } else if (contentDesc) {
        candidates.push({
          kind: "element",
          label: "content-desc",
          value: contentDesc,
          source: "element",
          candidate
        });
      } else if (text) {
        candidates.push({
          kind: "element",
          label: "元素文字",
          value: text,
          source: "element",
          candidate
        });
      } else if (className) {
        candidates.push({
          kind: "element",
          label: "className",
          value: className,
          source: "element",
          candidate
        });
      }
    });

  arrayOfStrings(observation.texts)
    .slice(0, 4)
    .forEach((text) => {
      candidates.push({
        kind: "text",
        label: "页面文字",
        value: text,
        source: "summary"
      });
    });

  arrayOfObjects(observation.textCandidates)
    .slice(0, 4)
    .forEach((candidate) => {
      const text = stringValue(candidate.text);
      if (!text) {
        return;
      }
      candidates.push({
        kind: "ocr_text",
        label: "OCR 文字",
        value: text,
        source: "ocr",
        textCandidate: candidate
      });
    });

  return dedupeEvidenceCandidates(candidates).slice(0, 10);
}

function dedupeEvidenceCandidates(candidates: RecordingEvidenceCandidate[]): RecordingEvidenceCandidate[] {
  const result: RecordingEvidenceCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.label}:${candidate.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function isActionTargetEvidence(candidate: RecordingEvidenceCandidate): boolean {
  return candidate.kind === "element" || candidate.kind === "text" || candidate.kind === "ocr_text";
}

function candidateMeta(candidate: RecordingEvidenceCandidate): string | undefined {
  const source = candidate.source === "ocr" ? "OCR" : candidate.source === "activity" ? "页面状态" : candidate.source === "element" ? "UI 树" : "摘要";
  const occurrence = numberValue(candidate.candidate?.occurrence);
  const confidence = numberValue(candidate.textCandidate?.confidence);
  return [source, occurrence ? `#${occurrence}` : undefined, confidence ? `置信度 ${Math.round(confidence * 100)}%` : undefined].filter(Boolean).join(" · ") || undefined;
}

export function buildStrongExpectationFromEvidence(candidate: RecordingEvidenceCandidate, phase: RecordingEvidencePhase): StepExpectation {
  const source = `recording_evidence_${phase}_${candidate.kind}`;
  if (candidate.kind === "activity") {
    return createStepExpectation("text", {
      note: `${phase === "before" ? "动作前" : "动作后"}强基准：Activity 应匹配录制时页面`,
      params: {
        activityName: candidate.value,
        expected: candidate.value,
        mode: "exists",
        blocking: true,
        source
      }
    });
  }

  if (candidate.kind === "element") {
    const element = candidate.candidate ?? {};
    const resourceId = stringValue(element.resourceId);
    const contentDesc = stringValue(element.contentDesc ?? element.accessibilityId);
    const text = stringValue(element.text);
    const className = stringValue(element.className);
    const packageName = stringValue(element.packageName);
    const occurrence = numberValue(element.occurrence);
    return createStepExpectation("text", {
      note: `${phase === "before" ? "动作前" : "动作后"}强基准：UI 元素应存在`,
      params: {
        expected: text ?? candidate.value,
        mode: "exists",
        ...(resourceId ? { resourceId } : {}),
        ...(contentDesc ? { contentDesc } : {}),
        ...(className ? { className } : {}),
        ...(packageName ? { packageName } : {}),
        ...(occurrence ? { occurrence } : {}),
        blocking: true,
        source
      }
    });
  }

  const textCandidate = candidate.textCandidate ?? {};
  return createStepExpectation("text", {
    note: `${phase === "before" ? "动作前" : "动作后"}强基准：文字应匹配录制时内容`,
    params: {
      expected: candidate.value,
      mode: "contains",
      ...(objectParam(textCandidate.region) ? { region: textCandidate.region } : {}),
      ...(stringValue(textCandidate.source) ? { ocrSource: textCandidate.source } : {}),
      blocking: true,
      source
    }
  });
}

export function buildActionTargetPatchFromEvidence(candidate: RecordingEvidenceCandidate): Partial<ActionStep> {
  if (candidate.kind === "element") {
    const element = candidate.candidate ?? {};
    const resourceId = stringValue(element.resourceId);
    const contentDesc = stringValue(element.contentDesc ?? element.accessibilityId);
    const text = stringValue(element.text);
    const className = stringValue(element.className);
    const packageName = stringValue(element.packageName);
    const occurrence = numberValue(element.occurrence);
    const locator = {
      strategy: "android_uiautomator",
      ...(resourceId ? { resourceId } : {}),
      ...(contentDesc ? { contentDesc } : {}),
      ...(text ? { text } : {}),
      ...(className ? { className } : {}),
      ...(packageName ? { packageName } : {}),
      ...(occurrence ? { occurrence } : {})
    };
    return {
      type: "tap_on_element",
      params: {
        locator,
        selector: selectorFromLocator(locator),
        ...(resourceId ? { resourceId } : {}),
        ...(contentDesc ? { contentDesc } : {}),
        ...(text ? { text } : {}),
        ...(occurrence ? { occurrence } : {})
      }
    };
  }

  return {
    type: "tap_on_text",
    params: {
      text: candidate.value,
      mode: "contains",
      ...(candidate.kind === "ocr_text" && objectParam(candidate.textCandidate?.region) ? { region: candidate.textCandidate?.region } : {})
    }
  };
}

function selectorFromLocator(locator: Record<string, unknown>): string {
  const resourceId = stringValue(locator.resourceId);
  const contentDesc = stringValue(locator.contentDesc);
  const text = stringValue(locator.text);
  const occurrence = numberValue(locator.occurrence);
  const suffix = occurrence && occurrence > 1 ? `#${Math.floor(occurrence)}` : "";
  if (resourceId) {
    return `id=${resourceId}${suffix}`;
  }
  if (contentDesc) {
    return `desc=${contentDesc}${suffix}`;
  }
  if (text) {
    return `text=${text}${suffix}`;
  }
  return "";
}

function RuleSummaryRow({ label, values, emptyText, strong }: { label: string; values: string[]; emptyText: string; strong?: boolean }) {
  const displayValues = values.filter(Boolean);
  return (
    <div className="step-rule-row">
      <span className="step-rule-label">{label}</span>
      <div className={strong ? "step-rule-values strong" : "step-rule-values"}>
        {displayValues.length ? displayValues.map((value) => <span key={value}>{value}</span>) : <span className="muted">{emptyText}</span>}
      </div>
    </div>
  );
}

function formatActionDetail(step: ActionStep): string {
  const locator = objectParam(step.params.locator);
  const details = [
    step.type,
    stringParam(step.params.selector, "selector"),
    stringParam(step.params.resourceId ?? locator?.resourceId, "resourceId"),
    stringParam(step.params.text ?? locator?.text, "text"),
    stringParam(step.params.contentDesc ?? locator?.contentDesc, "contentDesc"),
    numberParam(step.params.occurrence ?? locator?.occurrence, "occurrence"),
    stringParam(step.params.baselineArtifactId, "baseline"),
    coordinateSummary(step)
  ].filter(Boolean);

  if (step.type === "input_text" && typeof step.params.text === "string") {
    return `${step.type} · text=${step.params.text}`;
  }
  if (step.type === "wait") {
    return `${step.type} · durationMs=${step.params.durationMs ?? 1000}`;
  }
  return details.join(" · ") || step.type;
}

function formatExpectationSummary(expectation: StepExpectation): string {
  const prefix = expectation.enabled ? "" : "候选：";
  if (expectation.type === "text") {
    if (isElementExistenceExpectation(expectation)) {
      return `${prefix}元素存在${expectationLocator(expectation)}`;
    }
    return `${prefix}${expectationLabel(expectation.type)} ${expectation.params.mode ?? "contains"} "${expectation.params.expected ?? expectation.params.text ?? ""}"${expectationLocator(expectation)}`;
  }
  if (expectation.type === "image") {
    return `${prefix}${expectationLabel(expectation.type)} baseline=${expectation.params.baselineArtifactId ?? "-"} threshold=${expectation.params.threshold ?? "-"}`;
  }
  if (expectation.type === "metric_below") {
    return `${prefix}${expectationLabel(expectation.type)} ${expectation.params.metric ?? "cpuPercent"} <= ${expectation.params.threshold ?? "-"}`;
  }
  if (expectation.type === "log_not_contains") {
    return `${prefix}${expectationLabel(expectation.type)} 不包含 "${expectation.params.text ?? ""}"`;
  }
  if (expectation.type === "state_is") {
    return `${prefix}状态锚点 ${expectation.params.expected ?? expectation.params.nodeId ?? "-"}`;
  }
  if (expectation.type === "performance_not_regressed") {
    return `${prefix}性能不劣化 ${expectation.params.metric ?? ""}`.trim();
  }
  return `${prefix}${expectationLabel(expectation.type)}`;
}

function expectationLocator(expectation: StepExpectation): string {
  const resourceId = stringParam(expectation.params.resourceId, "resourceId");
  const contentDesc = stringParam(expectation.params.contentDesc, "contentDesc");
  const className = stringParam(expectation.params.className, "className");
  const text = typeof expectation.params.expected === "string" && expectation.params.mode === "exists" ? stringParam(expectation.params.expected, "text") : undefined;
  const occurrence = numberParam(expectation.params.occurrence, "occurrence");
  return [resourceId, contentDesc, className, text, occurrence].filter(Boolean).map((value) => ` · ${value}`).join("");
}

function isElementExistenceExpectation(expectation: StepExpectation): boolean {
  if (expectation.type !== "text" || expectation.params.mode !== "exists") {
    return false;
  }
  return Boolean(expectation.params.resourceId || expectation.params.contentDesc || expectation.params.accessibilityId || expectation.params.className);
}

function stringParam(value: unknown, label: string): string | undefined {
  return typeof value === "string" && value.trim() ? `${label}=${value}` : undefined;
}

function numberParam(value: unknown, label: string): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? `${label}=${Math.floor(value)}` : undefined;
}

function elementLocatorLabel(selector: unknown, resourceId: unknown, contentDesc: unknown, text: unknown, occurrence: unknown): string {
  const base = [selector, resourceId, contentDesc, text].find((value) => typeof value === "string" && value.trim());
  const label = String(base ?? "-");
  if (typeof occurrence !== "number" || !Number.isFinite(occurrence) || occurrence <= 1) {
    return label;
  }
  const suffix = `#${Math.floor(occurrence)}`;
  return label.endsWith(suffix) ? label : `${label}${suffix}`;
}


function coordinateSummary(step: ActionStep): string | undefined {
  if (!step.coordinate) {
    return undefined;
  }
  if (step.type === "swipe") {
    return `from=${step.coordinate.startX ?? "-"},${step.coordinate.startY ?? "-"} to=${step.coordinate.endX ?? "-"},${step.coordinate.endY ?? "-"}`;
  }
  if (typeof step.coordinate.x === "number" || typeof step.coordinate.y === "number") {
    return `fallback=${step.coordinate.x ?? "-"},${step.coordinate.y ?? "-"}`;
  }
  return undefined;
}

export function summarizeStep(step: ActionStep): string {
  if (step.type === "tap_if_text") {
    return `看到 "${step.params.text ?? ""}" 时点击 ${step.coordinate?.x ?? "-"}, ${step.coordinate?.y ?? "-"}`;
  }
  if (step.type === "tap_on_text") {
    return `点击文字 "${step.params.text ?? ""}"，兜底坐标 ${step.coordinate?.x ?? "-"}, ${step.coordinate?.y ?? "-"}`;
  }
  if (step.type === "tap_on_element") {
    const locator = objectParam(step.params.locator);
    return `点击元素 ${elementLocatorLabel(step.params.selector, step.params.resourceId ?? locator?.resourceId, step.params.contentDesc ?? locator?.contentDesc, step.params.text ?? locator?.text, step.params.occurrence ?? locator?.occurrence)}`;
  }
  if (step.type === "tap_on_image") {
    return `点击图像 ${String(step.params.baselineArtifactId ?? "-")}`;
  }
  if (step.type === "input_text_to_element") {
    const locator = objectParam(step.params.locator);
    return `输入到元素 ${String(step.params.selector ?? step.params.resourceId ?? locator?.resourceId ?? locator?.contentDesc ?? locator?.text ?? "-")}`;
  }
  if (step.type === "scroll_until_visible") {
    const locator = objectParam(step.params.locator);
    return `滚动直到可见 ${String(step.params.selector ?? step.params.resourceId ?? locator?.resourceId ?? locator?.contentDesc ?? locator?.text ?? "-")}`;
  }
  if (step.type === "wait_until_state") {
    const locator = objectParam(step.params.locator);
    return `等待状态 ${String(step.params.selector ?? step.params.resourceId ?? locator?.resourceId ?? locator?.contentDesc ?? locator?.text ?? "-")}`;
  }
  if (step.type === "tap" || step.type === "long_press") {
    return `${step.coordinate?.x ?? "-"}, ${step.coordinate?.y ?? "-"}`;
  }
  if (step.type === "swipe") {
    return `${step.coordinate?.startX ?? "-"},${step.coordinate?.startY ?? "-"} -> ${step.coordinate?.endX ?? "-"},${step.coordinate?.endY ?? "-"}`;
  }
  if (step.type === "input_text") {
    return String(step.params.text ?? "");
  }
  if (step.type === "wait") {
    return `${step.params.durationMs ?? 1000} ms`;
  }
  if (step.type === "back") {
    return "系统返回";
  }
  if (step.type === "home") {
    return "回到系统首页";
  }
  if (step.type === "recent_apps") {
    return "打开最近任务";
  }
  return "";
}

function objectParam(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function arrayOfObjects(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}
