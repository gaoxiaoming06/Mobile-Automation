import type { TestRun } from "./index.js";

export type PublicExecutionFailureKind =
  | "needs_clarification"
  | "missing_parameter"
  | "target_not_found"
  | "target_ambiguous"
  | "page_not_recognized"
  | "result_not_verified"
  | "left_target_app"
  | "app_failure"
  | "infrastructure_failure";

export type PublicExecutionFailure = {
  kind: PublicExecutionFailureKind;
  message: string;
  nextAction: "supplement_process" | "supplement_parameter" | "retry" | "view_report";
};

export function publicExecutionFailure(kind: PublicExecutionFailureKind): PublicExecutionFailure {
  switch (kind) {
    case "needs_clarification":
      return { kind, message: "测试需求还不够明确，请补充操作过程或预期结果。", nextAction: "supplement_process" };
    case "missing_parameter":
      return { kind, message: "测试缺少执行所需参数，请补充运行配置后重试。", nextAction: "supplement_parameter" };
    case "target_not_found":
      return { kind, message: "未找到当前操作的目标，请补充目标文字、图标特征或所在位置。", nextAction: "supplement_process" };
    case "target_ambiguous":
      return { kind, message: "当前操作匹配到多个目标，请补充位置、附近文字或更明确的操作描述。", nextAction: "supplement_process" };
    case "page_not_recognized":
      return { kind, message: "未能稳定识别当前页面，无法继续执行后续步骤。", nextAction: "view_report" };
    case "result_not_verified":
      return { kind, message: "操作已经执行，但未能确认结果符合预期。", nextAction: "view_report" };
    case "left_target_app":
      return { kind, message: "恢复过程中已离开目标 App，系统已停止继续返回。", nextAction: "view_report" };
    case "app_failure":
      return { kind, message: "目标 App 在执行过程中出现异常，请查看报告后重试。", nextAction: "view_report" };
    case "infrastructure_failure":
      return { kind, message: "设备或执行服务出现异常，请检查连接后重试。", nextAction: "retry" };
  }
}

export function publicExecutionFailureFromRun(run: TestRun): PublicExecutionFailure | undefined {
  if (!isFailureStatus(run.status)) return undefined;

  if (run.status === "device_lost") return publicExecutionFailure("infrastructure_failure");
  if (run.events.some((event) => event.severity === "error" && APP_FAILURE_EVENTS.has(event.type))) {
    return publicExecutionFailure("app_failure");
  }

  const step = [...run.stepResults].reverse().find((item) => item.status === "failed" || item.status === "timeout");
  if (!step) return publicExecutionFailure("infrastructure_failure");

  if (step.errorCode === "SEMANTIC_TARGET_NOT_FOUND") {
    const reason = nestedString(step.metadata, "semantic", "reason");
    return publicExecutionFailure(reason === "ambiguous_target" ? "target_ambiguous" : "target_not_found");
  }
  if (step.errorCode === "SEMANTIC_ACTION_UNSUPPORTED") {
    return publicExecutionFailure("target_not_found");
  }
  if (step.errorCode === "PAGE_NAVIGATION_FAILED") {
    const status = nestedString(step.metadata, "pageNavigation", "status");
    if (status === "recovery_left_app") return publicExecutionFailure("left_target_app");
    if (status === "route_verification_failed" || status === "target_not_reached") {
      return publicExecutionFailure("result_not_verified");
    }
    return publicExecutionFailure("page_not_recognized");
  }
  if (step.errorCode === "EXPECTATION_FAILED" || step.errorCode === "CONDITION_NOT_MET") {
    return publicExecutionFailure("result_not_verified");
  }
  if (step.errorCode === "DEVICE_EVENT_FAILED") return publicExecutionFailure("app_failure");
  if (step.errorCode === "PRECONDITION_FAILED") return publicExecutionFailure("page_not_recognized");
  return publicExecutionFailure("infrastructure_failure");
}

const APP_FAILURE_EVENTS = new Set<TestRun["events"][number]["type"]>([
  "crash",
  "anr",
  "app_exit",
  "black_screen",
  "native_crash",
  "process_death"
]);

function isFailureStatus(status: TestRun["status"]): boolean {
  return status === "failed" || status === "timeout" || status === "device_lost";
}

function nestedString(metadata: Record<string, unknown> | undefined, parent: string, key: string): string | undefined {
  const value = metadata?.[parent];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "string" ? nested : undefined;
}
