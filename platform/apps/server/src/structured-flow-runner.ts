import type { RunMode, StepExpectation, StructuredFlow, TestRun } from "@mobile-automation/shared";
import type { AutomationDeviceDriver } from "./mobile-driver.js";
import type { OcrService } from "./ocr.js";
import { AutomationRunner, DeviceBusyError, type RunnerStorage } from "./automation-runner.js";
import type { Storage } from "./storage.js";
import { inferAndroidPackageNameFromStructuredFlow, structuredFlowToExecutableSteps } from "./test-rule-step.js";

export type StructuredFlowRunnerStorage = RunnerStorage & Pick<Storage, "getStructuredFlow">;

export type StartStructuredFlowRunInput = {
  flowId: string;
  deviceSerial: string;
  mode?: RunMode;
  repeatCount?: number;
  stepIntervalMs?: number;
  stopOnFailure?: boolean;
  recordVideo?: boolean;
  keepVideoOnSuccess?: boolean;
  pauseAfterEachStep?: boolean;
  stopAtStepId?: string;
  expectationOverrides?: StructuredFlowExpectationOverride[];
};

export type StructuredFlowExpectationOverride = {
  stepId: string;
  expectationId: string;
  scope?: "beforeState" | "afterExpectations" | "systemGuards";
  enabled?: boolean;
  title?: string;
  note?: string;
  params?: Record<string, unknown>;
};

export class StructuredFlowRunner {
  private readonly legacyRunner: AutomationRunner;

  constructor(
    private readonly storage: StructuredFlowRunnerStorage,
    private readonly driver: AutomationDeviceDriver,
    ocr?: OcrService
  ) {
    this.legacyRunner = new AutomationRunner(storage, driver, ocr);
  }

  async start(input: StartStructuredFlowRunInput): Promise<TestRun> {
    const flow = this.storage.getStructuredFlow(input.flowId);
    if (!flow) {
      throw new Error(`Structured flow not found: ${input.flowId}`);
    }
    const activeRun = this.getActiveRunForDevice(input.deviceSerial);
    if (activeRun) {
      throw new DeviceBusyError(input.deviceSerial, activeRun.runId);
    }
    const runtimeFlow = applyStructuredFlowExpectationOverrides(flow, input.expectationOverrides ?? []);
    const targetPackageName = inferAndroidPackageNameFromStructuredFlow(runtimeFlow);
    await this.validateBeforeRun(runtimeFlow, input, targetPackageName);
    const steps = structuredFlowToExecutableSteps(runtimeFlow, input.stopAtStepId);
    return this.legacyRunner.start({
      deviceSerial: input.deviceSerial,
      caseName: flow.name,
      steps,
      mode: input.mode,
      repeatCount: input.repeatCount,
      stepIntervalMs: input.stepIntervalMs ?? 0,
      stopOnFailure: input.stopOnFailure,
      recordVideo: input.recordVideo,
      keepVideoOnSuccess: input.keepVideoOnSuccess,
      pauseAfterEachStep: input.pauseAfterEachStep,
      startStrategy: flow.startStrategy === "install_build_and_launch" ? "restart_app" : flow.startStrategy,
      startAppPackageName: targetPackageName,
      startSetupScope: "before_run"
    });
  }

  private async validateBeforeRun(flow: StructuredFlow, input: StartStructuredFlowRunInput, targetPackageName: string | undefined): Promise<void> {
    const errors: string[] = [];
    const device = await this.driver.getDeviceInfo(input.deviceSerial);
    if (device.platform !== flow.platform) {
      errors.push(`用例平台 ${flow.platform} 与当前设备平台 ${device.platform} 不一致`);
    }

    const startStrategy = flow.startStrategy === "install_build_and_launch" ? "restart_app" : flow.startStrategy;
    if (flow.platform === "android" && requiresAndroidPackage(startStrategy) && !targetPackageName) {
      errors.push(`${startStrategy} 需要明确的 Android packageName，请在用例目标 App 或语义 locator 中配置包名`);
    }

    if (targetPackageName && this.driver.getInstalledAppInfo) {
      try {
        const installed = await this.driver.getInstalledAppInfo(input.deviceSerial, targetPackageName);
        if (installed.displayVersion && flow.appVersion.displayVersion && installed.displayVersion !== flow.appVersion.displayVersion) {
          errors.push(`设备已安装版本 ${installed.displayVersion} 与用例版本 ${flow.appVersion.displayVersion} 不一致`);
        }
        if (flow.appVersion.buildNumber && installed.buildNumber && installed.buildNumber !== flow.appVersion.buildNumber) {
          errors.push(`设备已安装 build ${installed.buildNumber} 与用例 build ${flow.appVersion.buildNumber} 不一致`);
        }
        if (flow.appVersion.versionCode && installed.versionCode && installed.versionCode !== flow.appVersion.versionCode) {
          errors.push(`设备已安装 versionCode ${installed.versionCode} 与用例 versionCode ${flow.appVersion.versionCode} 不一致`);
        }
      } catch (error) {
        errors.push(`无法读取目标 App 安装信息：${errorToString(error)}`);
      }
    }

    if (errors.length) {
      throw new Error(`结构化用例执行前校验失败：${errors.join("；")}`);
    }
  }

  isRunning(runId: string): boolean {
    return this.legacyRunner.isRunning(runId);
  }

  getActiveRunForDevice(deviceSerial: string): { runId: string; deviceSerial: string } | undefined {
    return this.legacyRunner.getActiveRunForDevice(deviceSerial);
  }

  stop(runId: string): Promise<boolean> {
    return this.legacyRunner.stop(runId);
  }

  pause(runId: string): TestRun | undefined {
    return this.legacyRunner.pause(runId);
  }

  resume(runId: string): TestRun | undefined {
    return this.legacyRunner.resume(runId);
  }

  step(runId: string): TestRun | undefined {
    return this.legacyRunner.step(runId);
  }

  stopAll(): Promise<void> {
    return this.legacyRunner.stopAll();
  }
}

function requiresAndroidPackage(strategy: string | undefined): boolean {
  return strategy === "launch_app" || strategy === "restart_app" || strategy === "clear_data_and_launch";
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function applyStructuredFlowExpectationOverrides(
  flow: StructuredFlow,
  overrides: StructuredFlowExpectationOverride[]
): StructuredFlow {
  if (!overrides.length) {
    return flow;
  }
  return {
    ...flow,
    steps: flow.steps.map((step) => {
      const matchingOverrides = overrides.filter((override) => override.stepId === step.id || override.stepId === step.action.id);
      if (!matchingOverrides.length) {
        return step;
      }
      return matchingOverrides.reduce((current, override) => applyStructuredFlowStepExpectationOverride(current, override), step);
    })
  };
}

function applyStructuredFlowStepExpectationOverride(
  step: StructuredFlow["steps"][number],
  override: StructuredFlowExpectationOverride
): StructuredFlow["steps"][number] {
  if (override.scope === "beforeState") {
    return {
      ...step,
      beforeState: {
        ...step.beforeState,
        expectations: applyExpectationOverrideList(step.beforeState.expectations ?? [], override)
      }
    };
  }
  if (override.scope === "systemGuards") {
    return {
      ...step,
      systemGuards: applyExpectationOverrideList(step.systemGuards, override)
    };
  }
  if (override.scope === "afterExpectations") {
    return {
      ...step,
      afterExpectations: applyExpectationOverrideList(step.afterExpectations, override)
    };
  }
  const after = applyExpectationOverrideList(step.afterExpectations, override);
  if (after !== step.afterExpectations) {
    return {
      ...step,
      afterExpectations: after
    };
  }
  const before = applyExpectationOverrideList(step.beforeState.expectations ?? [], override);
  if (before !== (step.beforeState.expectations ?? [])) {
    return {
      ...step,
      beforeState: {
        ...step.beforeState,
        expectations: before
      }
    };
  }
  const guards = applyExpectationOverrideList(step.systemGuards, override);
  if (guards !== step.systemGuards) {
    return {
      ...step,
      systemGuards: guards
    };
  }
  return step;
}

function applyExpectationOverrideList(expectations: StepExpectation[], override: StructuredFlowExpectationOverride): StepExpectation[] {
  let changed = false;
  const next = expectations.map((expectation) => {
    if (expectation.id !== override.expectationId) {
      return expectation;
    }
    changed = true;
    return {
      ...expectation,
      ...(typeof override.enabled === "boolean" ? { enabled: override.enabled } : {}),
      ...(override.title !== undefined ? { title: override.title } : {}),
      ...(override.note !== undefined ? { note: override.note } : {}),
      params: {
        ...expectation.params,
        ...(override.params ?? {}),
        runtimeOverride: true,
        runtimeOverrideSource: "flow_run"
      }
    };
  });
  return changed ? next : expectations;
}
