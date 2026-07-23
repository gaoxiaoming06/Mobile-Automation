import { useCallback, useEffect, useState } from "react";
import type { AndroidAppMonitorConfig, FlowStartStrategy, TestRun } from "@mobile-automation/shared";
import type { GraphRunSummary } from "../components/GraphRunDetail";

type UseRunExecutionOptions = {
  selectedSerial: string;
  setMessage: (message: string) => void;
};

export const ACTIVE_RUN_LIST_REFRESH_INTERVAL_MS = 1000;
export const IDLE_RUN_LIST_REFRESH_INTERVAL_MS = 5000;

export function runListRefreshIntervalMs(runs: TestRun[]): number {
  return runs.some(isActiveRun) ? ACTIVE_RUN_LIST_REFRESH_INTERVAL_MS : IDLE_RUN_LIST_REFRESH_INTERVAL_MS;
}

export function useRunExecution({ selectedSerial, setMessage }: UseRunExecutionOptions) {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [currentRunId, setCurrentRunId] = useState("");
  const [currentRun, setCurrentRun] = useState<TestRun | null>(null);
  const [currentGraphRun, setCurrentGraphRun] = useState<GraphRunSummary | null>(null);
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
    const intervalMs = runListRefreshIntervalMs(runs);
    const timer = window.setInterval(() => {
      refreshRuns().catch(() => undefined);
    }, intervalMs);
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
    setCurrentRunId: selectRun,
    loadMoreRuns: () => setRunsLimit((value) => Math.min(200, value + 30)),
    refreshRuns,
    stopCurrentRun,
    pauseCurrentRun: () => controlCurrentRun("pause"),
    resumeCurrentRun: () => controlCurrentRun("resume"),
    stepCurrentRun: () => controlCurrentRun("step")
  };
}

export type AndroidAppMonitorRequestState = {
  enabled: boolean;
  packageName: string;
  startStrategy: FlowStartStrategy;
  startAppPackageName: string;
  includeSubprocesses: boolean;
  cpuThresholdEnabled: boolean;
  cpuThresholdPercent: number;
  memoryThresholdEnabled: boolean;
  memoryThresholdMb: number;
  enableHeapDump: boolean;
};

export function buildAndroidAppMonitorRequest(state: AndroidAppMonitorRequestState): AndroidAppMonitorConfig | undefined {
  if (!state.enabled) {
    return undefined;
  }
  const packageName = state.packageName.trim() || (requiresStartAppPackageName(state.startStrategy) ? state.startAppPackageName.trim() : "");
  if (!packageName) {
    return undefined;
  }
  const cpuThreshold = positiveNumber(state.cpuThresholdPercent);
  const memoryThreshold = positiveNumber(state.memoryThresholdMb);
  return {
    enabled: true,
    packageName,
    includeSubprocesses: state.includeSubprocesses,
    enableHeapDump: state.enableHeapDump,
    ...((state.cpuThresholdEnabled && cpuThreshold) || (state.memoryThresholdEnabled && memoryThreshold)
      ? {
          thresholds: {
            ...(state.cpuThresholdEnabled && cpuThreshold ? { cpuPercent: enabledThreshold(cpuThreshold) } : {}),
            ...(state.memoryThresholdEnabled && memoryThreshold ? { pssMb: enabledThreshold(memoryThreshold) } : {})
          }
        }
      : {})
  };
}

function enabledThreshold(value: number) {
  return { enabled: true, value, sustainMs: 5000, cooldownMs: 30000 };
}

function positiveNumber(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function isActiveRun(run: TestRun): boolean {
  return run.status === "running" || run.status === "paused";
}

function requiresStartAppPackageName(strategy: FlowStartStrategy): boolean {
  return strategy === "launch_app" || strategy === "restart_app" || strategy === "clear_data_and_launch";
}
