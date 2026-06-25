import { useCallback, useEffect, useState } from "react";
import type { ActionStep, FlowStartSetupScope, FlowStartStrategy, TestRun } from "@mobile-automation/shared";
import type { GraphRunSummary } from "../components/GraphRunDetail";
import type { FlowExpectationOverride } from "../components/CaseLibraryPanel";
import { defaultCaseName } from "../recording";

type UseRunExecutionOptions = {
  selectedSerial: string;
  caseName: string;
  steps: ActionStep[];
  setMessage: (message: string) => void;
};

export function useRunExecution({ selectedSerial, caseName, steps, setMessage }: UseRunExecutionOptions) {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [currentRunId, setCurrentRunId] = useState("");
  const [currentRun, setCurrentRun] = useState<TestRun | null>(null);
  const [currentGraphRun, setCurrentGraphRun] = useState<GraphRunSummary | null>(null);
  const [repeatCount, setRepeatCount] = useState(1);
  const [stepIntervalMs, setStepIntervalMs] = useState(400);
  const [loopUntilStopped, setLoopUntilStopped] = useState(false);
  const [pauseAfterEachStep, setPauseAfterEachStep] = useState(false);
  const [startStrategy, setStartStrategy] = useState<FlowStartStrategy>("keep_current");
  const [startAppPackageName, setStartAppPackageName] = useState("");
  const [startSetupScope, setStartSetupScope] = useState<FlowStartSetupScope>("before_run");
  const [runsLimit, setRunsLimit] = useState(30);
  const activeRunForSelectedDevice = runs.find((run) => run.deviceSerial === selectedSerial && isActiveRun(run));
  const selectedDeviceBusy = Boolean(activeRunForSelectedDevice);

  const refreshRuns = useCallback(async () => {
    const response = await fetch(`/api/runs?limit=${runsLimit}`);
    const json = (await response.json()) as { runs: TestRun[] };
    setRuns(json.runs);
  }, [runsLimit]);

  useEffect(() => {
    refreshRuns().catch(() => undefined);
  }, [refreshRuns]);

  useEffect(() => {
    if (!runs.some(isActiveRun)) {
      return;
    }
    const timer = window.setInterval(() => {
      refreshRuns().catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [refreshRuns, runs]);

  const selectRun = useCallback(
    (runId: string) => {
      setCurrentRunId(runId);
      if (!runId) {
        setCurrentRun(null);
        setCurrentGraphRun(null);
        return;
      }
      const cachedRun = runs.find((run) => run.id === runId);
      if (cachedRun) {
        setCurrentRun(cachedRun);
      }
    },
    [runs]
  );

  useEffect(() => {
    if (!currentRunId) {
      setCurrentRun(null);
      setCurrentGraphRun(null);
      return;
    }
    let cancelled = false;
    const refreshCurrentGraphRun = async () => {
      const response = await fetch(`/api/graph-runs/${currentRunId}`);
      if (cancelled) {
        return;
      }
      if (response.status === 404) {
        setCurrentGraphRun(null);
        return;
      }
      if (!response.ok) {
        return;
      }
      const json = (await response.json()) as { graphRun: GraphRunSummary };
      if (!cancelled) {
        setCurrentGraphRun(json.graphRun);
      }
    };
    const refreshCurrentRun = async () => {
      const response = await fetch(`/api/runs/${currentRunId}`);
      if (!response.ok) {
        return;
      }
      const json = (await response.json()) as { run: TestRun; active: boolean };
      if (cancelled) {
        return;
      }
      setCurrentRun(json.run);
      if (!json.active && json.run.status !== "running") {
        await refreshRuns();
      }
      await refreshCurrentGraphRun();
    };
    void refreshCurrentRun();
    const timer = window.setInterval(refreshCurrentRun, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentRunId, refreshRuns]);

  const startRun = useCallback(
    async (caseId?: string) => {
      if (!selectedSerial) {
        setMessage("请先选择设备");
        return;
      }
      if (!caseId && !steps.length) {
        setMessage("没有可回放的步骤");
        return;
      }
      if (selectedDeviceBusy) {
        setMessage(`当前设备正在执行：${activeRunForSelectedDevice?.id ?? ""}`);
        return;
      }
      if (requiresStartAppPackageName(startStrategy) && !startAppPackageName.trim()) {
        setMessage(`${startStrategyLabel(startStrategy)}需要先填写 App 包名`);
        return;
      }
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceSerial: selectedSerial,
          caseId,
          caseName: caseName.trim() || defaultCaseName,
          steps: caseId ? undefined : steps,
          mode: loopUntilStopped ? "loop_until_stop" : repeatCount > 1 ? "repeat_n" : "once",
          repeatCount,
          stepIntervalMs,
          stopOnFailure: true,
          recordVideo: true,
          keepVideoOnSuccess: true,
          pauseAfterEachStep,
          startStrategy,
          startAppPackageName: startAppPackageName.trim() || undefined,
          startSetupScope
        })
      });
      const json = (await response.json()) as { run?: TestRun; error?: string; activeRunId?: string };
      if (!response.ok || !json.run) {
        setMessage(json.error ?? (json.activeRunId ? `设备正在执行：${json.activeRunId}` : "启动执行失败"));
        await refreshRuns().catch(() => undefined);
        return;
      }
      setCurrentRunId(json.run.id);
      setCurrentRun(json.run);
      setCurrentGraphRun(null);
      setRuns((current) => mergeRuns(json.run as TestRun, current));
      setMessage(`已启动回放：${json.run.id}`);
    },
    [
      activeRunForSelectedDevice?.id,
      caseName,
      loopUntilStopped,
      pauseAfterEachStep,
      refreshRuns,
      repeatCount,
      selectedDeviceBusy,
      selectedSerial,
      setMessage,
      startAppPackageName,
      startSetupScope,
      startStrategy,
      stepIntervalMs,
      steps
    ]
  );

  const startFlowRun = useCallback(
    async (flowId: string, stopAtStepId?: string, expectationOverrides?: FlowExpectationOverride[]) => {
      if (!selectedSerial) {
        setMessage("请先选择设备");
        return;
      }
      if (!flowId) {
        setMessage("请选择结构化用例");
        return;
      }
      if (selectedDeviceBusy) {
        setMessage(`当前设备正在执行：${activeRunForSelectedDevice?.id ?? ""}`);
        return;
      }
      const response = await fetch("/api/flow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceSerial: selectedSerial,
          flowId,
          stopAtStepId,
          mode: loopUntilStopped ? "loop_until_stop" : repeatCount > 1 ? "repeat_n" : "once",
          repeatCount,
          stepIntervalMs,
          stopOnFailure: true,
          recordVideo: true,
          keepVideoOnSuccess: true,
          pauseAfterEachStep,
          expectationOverrides
        })
      });
      const json = (await response.json()) as { run?: TestRun; error?: string; activeRunId?: string };
      if (!response.ok || !json.run) {
        setMessage(json.error ?? (json.activeRunId ? `设备正在执行：${json.activeRunId}` : "启动结构化用例失败"));
        await refreshRuns().catch(() => undefined);
        return;
      }
      setCurrentRunId(json.run.id);
      setCurrentRun(json.run);
      setCurrentGraphRun(null);
      setRuns((current) => mergeRuns(json.run as TestRun, current));
      setMessage(`已启动结构化用例：${json.run.id}`);
    },
    [
      activeRunForSelectedDevice?.id,
      loopUntilStopped,
      pauseAfterEachStep,
      refreshRuns,
      repeatCount,
      selectedDeviceBusy,
      selectedSerial,
      setMessage,
      stepIntervalMs
    ]
  );

  const controlCurrentRun = useCallback(
    async (action: "pause" | "resume" | "step") => {
      if (!currentRun?.id || (currentRun.status !== "running" && currentRun.status !== "paused")) {
        return;
      }
      const response = await fetch(`/api/runs/${currentRun.id}/${action}`, { method: "POST" });
      const json = (await response.json()) as { run?: TestRun; error?: string };
      if (!response.ok) {
        setMessage(json.error ?? "控制执行失败");
        return;
      }
      if (json.run) {
        setCurrentRun(json.run);
      }
      await refreshRuns();
      const label = action === "pause" ? "暂停" : action === "resume" ? "继续" : "单步执行";
      setMessage(`已${label}：${currentRun.id}`);
    },
    [currentRun, refreshRuns, setMessage]
  );

  const stopCurrentRun = useCallback(async () => {
    if (!currentRun?.id || (currentRun.status !== "running" && currentRun.status !== "paused")) {
      return;
    }
    const response = await fetch(`/api/runs/${currentRun.id}/stop`, { method: "POST" });
    const json = (await response.json()) as { run?: TestRun; error?: string };
    if (!response.ok) {
      setMessage(json.error ?? "停止执行失败");
      return;
    }
    if (json.run) {
      setCurrentRun(json.run);
    }
    await refreshRuns();
    setMessage(`已停止执行：${currentRun.id}`);
  }, [currentRun, refreshRuns, setMessage]);

  return {
    runs,
    currentRun,
    currentGraphRun,
    currentRunId,
    runsLimit,
    activeRunForSelectedDevice,
    selectedDeviceBusy,
    repeatCount,
    stepIntervalMs,
    loopUntilStopped,
    pauseAfterEachStep,
    startStrategy,
    startAppPackageName,
    startSetupScope,
    setCurrentRunId: selectRun,
    loadMoreRuns: () => setRunsLimit((value) => Math.min(200, value + 30)),
    setRepeatCount,
    setStepIntervalMs,
    setLoopUntilStopped,
    setPauseAfterEachStep,
    setStartStrategy,
    setStartAppPackageName,
    setStartSetupScope,
    startRun,
    startFlowRun,
    stopCurrentRun,
    pauseCurrentRun: () => controlCurrentRun("pause"),
    resumeCurrentRun: () => controlCurrentRun("resume"),
    stepCurrentRun: () => controlCurrentRun("step")
  };
}

function isActiveRun(run: TestRun): boolean {
  return run.status === "running" || run.status === "paused";
}

function mergeRuns(run: TestRun, runs: TestRun[]): TestRun[] {
  return [run, ...runs.filter((item) => item.id !== run.id)];
}

function requiresStartAppPackageName(strategy: FlowStartStrategy): boolean {
  return strategy === "launch_app" || strategy === "restart_app" || strategy === "clear_data_and_launch";
}

function startStrategyLabel(strategy: FlowStartStrategy): string {
  if (strategy === "launch_app") {
    return "启动 App";
  }
  if (strategy === "restart_app") {
    return "重启 App";
  }
  if (strategy === "clear_data_and_launch") {
    return "清数据后启动";
  }
  return "当前起始状态";
}
