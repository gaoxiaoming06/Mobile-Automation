import { useCallback, useEffect, useState } from "react";
import {
  createId,
  nowIso,
  type ActionStep,
  type DeviceActionRequest,
  type InstalledAppInfo,
  type StepExpectation,
  type StepExpectationType,
  type StructuredFlow,
  type TestCase
} from "@mobile-automation/shared";
import {
  applyInstalledAppInfoToStructuredFlowDraft,
  buildStructuredFlowDraft,
  createRecordedStep,
  createStepExpectation,
  defaultCaseName,
  mergeActionStepPatch,
  renumberSteps,
  type RecordableAction
} from "../recording";

type DeviceSize = {
  width: number;
  height: number;
};

type UseRecorderOptions = {
  selectedDeviceSize: DeviceSize;
  selectedSerial: string;
  setMessage: (message: string) => void;
};

const defaultStructuredFlowApp = {
  appName: "未命名应用",
  platform: "android" as const,
  targetApp: {
    androidPackageName: "unknown.android.package"
  },
  appVersion: {
    displayVersion: "unknown"
  },
  startStateName: "起点",
  endStateName: "终点"
};

export function useRecorder({ selectedDeviceSize, selectedSerial, setMessage }: UseRecorderOptions) {
  const [steps, setSteps] = useState<ActionStep[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [recording, setRecording] = useState(false);
  const [caseName, setCaseName] = useState(defaultCaseName);
  const [cases, setCases] = useState<TestCase[]>([]);

  const refreshCases = useCallback(async () => {
    const response = await fetch("/api/cases");
    const json = (await response.json()) as { cases: TestCase[] };
    setCases(json.cases);
  }, []);

  useEffect(() => {
    refreshCases().catch(() => undefined);
  }, [refreshCases]);

  const appendStep = useCallback(
    (action: RecordableAction): ActionStep => {
      const stepId = createId("step");
      const step = createRecordedStep({
        action,
        order: steps.length + 1,
        deviceSize: selectedDeviceSize,
        id: stepId
      });
      setSteps((current) => [
        ...current,
        {
          ...step,
          order: current.length + 1
        }
      ]);
      return step;
    },
    [selectedDeviceSize, steps.length]
  );

  const updateStepById = useCallback((stepId: string, patch: Partial<ActionStep>) => {
    setSteps((current) =>
      current.map((step) => (step.id === stepId ? mergeActionStepPatch(step, patch) : step))
    );
  }, []);

  const replaceStepAction = useCallback(
    (stepId: string, action: RecordableAction) => {
      setSteps((current) =>
        current.map((step) =>
          step.id === stepId
            ? {
                ...createRecordedStep({
                  action,
                  order: step.order,
                  deviceSize: selectedDeviceSize,
                  id: step.id,
                  createdAt: step.createdAt
                }),
                enabled: step.enabled,
                note: step.note
              }
            : step
        )
      );
    },
    [selectedDeviceSize]
  );

  const moveStep = useCallback((index: number, direction: -1 | 1) => {
    setSteps((current) => {
      const next = current.slice();
      const target = index + direction;
      if (target < 0 || target >= next.length) {
        return current;
      }
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return renumberSteps(next);
    });
  }, []);

  const removeStep = useCallback((index: number) => {
    setSteps((current) => renumberSteps(current.filter((_, itemIndex) => itemIndex !== index)));
  }, []);

  const insertWaitStep = useCallback(
    (index: number) => {
      setSteps((current) => {
        const next = current.slice();
        next.splice(
          index + 1,
          0,
          createRecordedStep({
            action: { type: "wait", durationMs: 1000 },
            order: index + 2,
            deviceSize: selectedDeviceSize,
            autoExpectations: false
          })
        );
        return renumberSteps(next);
      });
    },
    [selectedDeviceSize]
  );

  const insertConditionalTapStep = useCallback(
    (index: number) => {
      setSteps((current) => {
        const next = current.slice();
        const source = current[index];
        const x = source?.coordinate?.x ?? Math.round(selectedDeviceSize.width / 2);
        const y = source?.coordinate?.y ?? Math.round(selectedDeviceSize.height / 2);
        next.splice(index + 1, 0, {
          id: createId("step"),
          order: index + 2,
          type: "tap_if_text",
          enabled: true,
          title: "条件点击",
          note: "看到指定文字时才点击；未看到则跳过该步骤。",
          params: {
            text: "",
            mode: "contains",
            timeoutMs: 3000,
            intervalMs: 500,
            lang: ""
          },
          coordinate: {
            x,
            y,
            xRatio: selectedDeviceSize.width ? x / selectedDeviceSize.width : undefined,
            yRatio: selectedDeviceSize.height ? y / selectedDeviceSize.height : undefined,
            deviceWidth: selectedDeviceSize.width,
            deviceHeight: selectedDeviceSize.height
          },
          expectations: [],
          createdAt: nowIso()
        });
        return renumberSteps(next);
      });
    },
    [selectedDeviceSize]
  );

  const copyStep = useCallback((index: number) => {
    setSteps((current) => {
      const source = current[index];
      if (!source) {
        return current;
      }
      const next = current.slice();
      const createdAt = nowIso();
      next.splice(index + 1, 0, {
        ...source,
        id: createId("step"),
        title: source.title ? `${source.title} copy` : source.title,
        preconditions: (source.preconditions ?? []).map((precondition) => ({
          ...precondition,
          id: createId("expectation"),
          createdAt
        })),
        expectations: (source.expectations ?? []).map((expectation) => ({
          ...expectation,
          id: createId("expectation"),
          createdAt
        })),
        createdAt
      });
      return renumberSteps(next);
    });
  }, []);

  const toggleStepEnabled = useCallback((index: number) => {
    setSteps((current) =>
      renumberSteps(
        current.map((step, itemIndex) =>
          itemIndex === index
            ? {
                ...step,
                enabled: !step.enabled
              }
            : step
        )
      )
    );
  }, []);

  const updateStep = useCallback((index: number, patch: Partial<ActionStep>) => {
    setSteps((current) =>
      renumberSteps(
        current.map((step, itemIndex) => (itemIndex === index ? mergeActionStepPatch(step, patch) : step))
      )
    );
  }, []);

  const addStepExpectation = useCallback((index: number, type: StepExpectationType) => {
    setSteps((current) =>
      current.map((step, itemIndex) =>
        itemIndex === index
          ? {
              ...step,
              expectations: [...(step.expectations ?? []), createStepExpectation(type)]
            }
          : step
      )
    );
  }, []);

  const updateStepExpectation = useCallback((stepIndex: number, expectationIndex: number, patch: Partial<StepExpectation>) => {
    setSteps((current) =>
      current.map((step, itemIndex) => {
        if (itemIndex !== stepIndex) {
          return step;
        }
        return {
          ...step,
          expectations: (step.expectations ?? []).map((expectation, itemExpectationIndex) =>
            itemExpectationIndex === expectationIndex
              ? {
                  ...expectation,
                  ...patch,
                  params: patch.params ?? expectation.params
                }
              : expectation
          )
        };
      })
    );
  }, []);

  const removeStepExpectation = useCallback((stepIndex: number, expectationIndex: number) => {
    setSteps((current) =>
      current.map((step, itemIndex) =>
        itemIndex === stepIndex
          ? {
              ...step,
              expectations: (step.expectations ?? []).filter((_, itemExpectationIndex) => itemExpectationIndex !== expectationIndex)
            }
          : step
      )
    );
  }, []);

  const resetEditor = useCallback(() => {
    setSelectedCaseId("");
    setCaseName(defaultCaseName);
    setSteps([]);
    setRecording(false);
  }, []);

  const saveCase = useCallback(async (): Promise<TestCase | StructuredFlow | undefined> => {
    if (!steps.length) {
      setMessage("没有可保存的步骤");
      return undefined;
    }
    const flowDraft = buildStructuredFlowDraft({
      ...defaultStructuredFlowApp,
      steps,
      createdAt: nowIso()
    });
    const appInfo = await fetchInstalledAppInfo(selectedSerial, flowDraft).catch(() => undefined);
    const versionedFlowDraft = applyInstalledAppInfoToStructuredFlowDraft(flowDraft, appInfo);
    const response = await fetch("/api/structured-flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...versionedFlowDraft,
        name: caseName.trim() && caseName.trim() !== defaultCaseName ? caseName.trim() : versionedFlowDraft.name
      })
    });
    const json = (await response.json()) as { flow?: StructuredFlow; error?: string };
    if (!response.ok || !json.flow) {
      setMessage(json.error ?? "保存失败");
      return undefined;
    }
    setSelectedCaseId(json.flow.id);
    setCaseName(json.flow.name);
    setMessage(`已保存结构化用例：${json.flow.name}`);
    await refreshCases();
    return json.flow;
  }, [caseName, refreshCases, selectedSerial, setMessage, steps]);

  const loadCase = useCallback(
    async (caseId: string): Promise<TestCase | undefined> => {
      const response = await fetch(`/api/cases/${caseId}`);
      const json = (await response.json()) as { case?: TestCase; error?: string };
      if (!response.ok || !json.case) {
        setMessage(json.error ?? "加载用例失败");
        return undefined;
      }
      setSelectedCaseId(json.case.id);
      setCaseName(json.case.name);
      setSteps(json.case.steps);
      setRecording(false);
      setMessage(`已加载用例：${json.case.name}`);
      return json.case;
    },
    [setMessage]
  );

  const loadStructuredFlow = useCallback(
    async (flowId: string): Promise<StructuredFlow | undefined> => {
      const response = await fetch(`/api/structured-flows/${flowId}`);
      const json = (await response.json()) as { flow?: StructuredFlow; error?: string };
      if (!response.ok || !json.flow) {
        setMessage(json.error ?? "加载结构化用例失败");
        return undefined;
      }
      setSelectedCaseId(json.flow.id);
      setCaseName(json.flow.name);
      setSteps(
        renumberSteps(
          json.flow.steps.map((step) => ({
            ...step.action,
            id: step.action.id,
            order: step.order,
            title: step.title,
            enabled: step.enabled,
            preconditions: step.beforeState.expectations ?? [],
            expectations: [...(step.afterExpectations ?? []), ...(step.systemGuards ?? [])],
            createdAt: step.createdAt,
            timing: {
              ...step.action.timing,
              timeoutMs: step.timing?.transitionTimeoutMs ?? step.action.timing?.timeoutMs,
              delayBeforeMs: step.action.timing?.delayBeforeMs
            }
          }))
        )
      );
      setRecording(false);
      setMessage(`已加载结构化用例：${json.flow.name}`);
      return json.flow;
    },
    [setMessage]
  );

  const deleteCase = useCallback(
    async (caseId: string) => {
      const response = await fetch(`/api/cases/${caseId}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) {
        setMessage("删除用例失败");
        return;
      }
      if (selectedCaseId === caseId) {
        resetEditor();
      }
      await refreshCases();
      setMessage("已删除用例");
    },
    [refreshCases, resetEditor, selectedCaseId, setMessage]
  );

  return {
    steps,
    selectedCaseId,
    recording,
    caseName,
    cases,
    setRecording,
    setCaseName,
    appendStep,
    updateStepById,
    replaceStepAction,
    moveStep,
    removeStep,
    insertWaitStep,
    insertConditionalTapStep,
    copyStep,
    toggleStepEnabled,
    updateStep,
    addStepExpectation,
    updateStepExpectation,
    removeStepExpectation,
    resetEditor,
    saveCase,
    loadCase,
    loadStructuredFlow,
    deleteCase
  };
}

async function fetchInstalledAppInfo(selectedSerial: string, flow: StructuredFlow): Promise<InstalledAppInfo | undefined> {
  if (!selectedSerial || flow.platform !== "android") {
    return undefined;
  }
  const packageName = flow.targetApp.androidPackageName?.trim();
  if (!packageName || packageName === "unknown.android.package") {
    return undefined;
  }
  const response = await fetch(`/api/devices/${encodeURIComponent(selectedSerial)}/apps/${encodeURIComponent(packageName)}`);
  if (!response.ok) {
    return undefined;
  }
  const json = (await response.json()) as { appInfo?: InstalledAppInfo };
  return json.appInfo;
}
