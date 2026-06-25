import { useEffect, useState } from "react";
import { ChevronUp } from "lucide-react";
import type { FlowStartSetupScope, FlowStartStrategy, ToolStatus } from "@mobile-automation/shared";

export function ToolStatusBar({ tools }: { tools: ToolStatus[] }) {
  if (!tools.length) {
    return null;
  }

  return (
    <div className="tool-status">
      {tools.map((tool) => (
        <span key={tool.name} className={tool.available ? "tool-ok" : "tool-missing"}>
          {tool.name}: {tool.available ? tool.version ?? "available" : "missing"}
        </span>
      ))}
    </div>
  );
}

export function RunConfigDrawer({
  repeatCount,
  stepIntervalMs,
  loopUntilStopped,
  pauseAfterEachStep,
  startStrategy,
  startAppPackageName,
  startSetupScope,
  setRepeatCount,
  setStepIntervalMs,
  setLoopUntilStopped,
  setPauseAfterEachStep,
  setStartStrategy,
  setStartAppPackageName,
  setStartSetupScope
}: {
  repeatCount: number;
  stepIntervalMs: number;
  loopUntilStopped: boolean;
  pauseAfterEachStep: boolean;
  startStrategy: FlowStartStrategy;
  startAppPackageName: string;
  startSetupScope: FlowStartSetupScope;
  setRepeatCount: (value: number) => void;
  setStepIntervalMs: (value: number) => void;
  setLoopUntilStopped: (value: boolean) => void;
  setPauseAfterEachStep: (value: boolean) => void;
  setStartStrategy: (value: FlowStartStrategy) => void;
  setStartAppPackageName: (value: string) => void;
  setStartSetupScope: (value: FlowStartSetupScope) => void;
}) {
  const startPackageRequired = requiresStartAppPackageName(startStrategy);
  const startPackageMissing = startPackageRequired && !startAppPackageName.trim();
  const [open, setOpen] = useState(startPackageMissing);

  useEffect(() => {
    if (startPackageMissing) {
      setOpen(true);
    }
  }, [startPackageMissing]);

  return (
    <div className={`run-config-popover ${open ? "config-open" : ""}`}>
      <button className="run-config-trigger" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>
          执行配置
          <ChevronUp size={16} />
        </span>
        <small>
          {loopUntilStopped ? "持续循环" : `${repeatCount} 次`} · {stepIntervalMs} ms · {startStrategyLabel(startStrategy)}
        </small>
      </button>
      {open && (
        <div className="run-config-popover-panel" role="dialog" aria-label="执行配置">
          <div className="run-config">
        <label>
          执行次数
          <input type="number" min={1} max={999} value={repeatCount} disabled={loopUntilStopped} onChange={(event) => setRepeatCount(Number(event.target.value))} />
        </label>
        <label>
          步骤间隔 ms
          <input type="number" min={0} max={10000} step={100} value={stepIntervalMs} onChange={(event) => setStepIntervalMs(Number(event.target.value))} />
        </label>
        <label>
          起始状态
          <select value={startStrategy} onChange={(event) => setStartStrategy(event.target.value as FlowStartStrategy)}>
            <option value="keep_current">保持当前</option>
            <option value="go_home">回到 Home</option>
            <option value="launch_app">启动 App</option>
            <option value="restart_app">重启 App</option>
            <option value="clear_data_and_launch">清数据后启动</option>
          </select>
        </label>
        <label>
          Setup 时机
          <select value={startSetupScope} onChange={(event) => setStartSetupScope(event.target.value as FlowStartSetupScope)}>
            <option value="before_run">整次执行前</option>
            <option value="before_each_iteration">每轮执行前</option>
          </select>
        </label>
        <label>
          App 包名
          <input
            className={startPackageMissing ? "field-error" : undefined}
            value={startAppPackageName}
            disabled={startStrategy === "keep_current" || startStrategy === "go_home"}
            onChange={(event) => setStartAppPackageName(event.target.value)}
            placeholder="com.example.app"
          />
        </label>
        {startPackageMissing && <div className="config-warning">当前起始状态需要 App 包名。请填写目标应用包名，或把起始状态改为“保持当前”。</div>}
        <label className="run-option">
          <input type="checkbox" checked={loopUntilStopped} onChange={(event) => setLoopUntilStopped(event.target.checked)} />
          持续循环直到停止
        </label>
        <label className="run-option">
          <input type="checkbox" checked={pauseAfterEachStep} onChange={(event) => setPauseAfterEachStep(event.target.checked)} />
          每步后暂停
        </label>
      </div>
        </div>
      )}
    </div>
  );
}

export function formatShortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")} ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

export function requiresStartAppPackageName(strategy: FlowStartStrategy): boolean {
  return strategy === "launch_app" || strategy === "restart_app" || strategy === "clear_data_and_launch";
}

export function startStrategyLabel(strategy: FlowStartStrategy): string {
  if (strategy === "go_home") {
    return "回到 Home";
  }
  if (strategy === "launch_app") {
    return "启动 App";
  }
  if (strategy === "restart_app") {
    return "重启 App";
  }
  if (strategy === "clear_data_and_launch") {
    return "清数据后启动";
  }
  return "保持当前";
}
