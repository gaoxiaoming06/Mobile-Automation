import type { TestRun } from "./index.js";

export type PublicExecutionFailureKind =
  | "needs_clarification"
  | "missing_parameter"
  | "target_not_found"
  | "target_ambiguous"
  | "page_not_recognized"
  | "route_mismatch"
  | "result_not_verified"
  | "left_target_app"
  | "app_failure"
  | "infrastructure_failure";

export type PublicExecutionFailure = {
  kind: PublicExecutionFailureKind;
  message: string;
  details?: Array<{
    label: string;
    value: string;
  }>;
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
    case "route_mismatch":
      return { kind, message: "当前页面已偏离目标业务路径，请补充真实入口、测试数据或可复用导航流程后重试。", nextAction: "supplement_process" };
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
    const kind = isAmbiguousSemanticReason(reason) ? "target_ambiguous" : "target_not_found";
    const failure = publicExecutionFailure(kind);
    return kind === "target_not_found" ? detailedTextTargetFailure(run, step, failure) : failure;
  }
  if (step.errorCode === "SEMANTIC_ACTION_UNSUPPORTED") {
    return publicExecutionFailure("target_not_found");
  }
  if (step.errorCode === "PAGE_NAVIGATION_FAILED") {
    const status = nestedString(step.metadata, "pageNavigation", "status");
    if (status === "recovery_left_app") return publicExecutionFailure("left_target_app");
    if (status === "no_reliable_path" || status === "route_mismatch" || status === "business_context_mismatch") {
      return publicExecutionFailure("route_mismatch");
    }
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

function isAmbiguousSemanticReason(reason: string | undefined): boolean {
  return reason === "ambiguous_target" || reason === "ambiguous_icon_candidates";
}

function detailedTextTargetFailure(
  run: TestRun,
  result: TestRun["stepResults"][number],
  fallback: PublicExecutionFailure
): PublicExecutionFailure {
  const semantic = nestedRecord(result.metadata, "semantic");
  if (semantic?.type !== "text") return fallback;

  const expected = stringList(semantic.expected);
  if (!expected.length) return fallback;

  const target = formatTextTargets(expected);
  const attempts = positiveInteger(semantic.attempts);
  const candidateCount = nonNegativeInteger(semantic.candidateCount);
  const actual = typeof semantic.actual === "string" ? semantic.actual.trim() : "";
  const search = nestedRecord(semantic, "search");
  const scope = search?.mode === "visibleOnly" ? "当前屏幕" : "页面范围内";
  const lookup = attempts && attempts > 1 ? `连续查找 ${attempts} 次` : "查找";
  const action = run.steps.find((step) => step.id === result.stepId);
  const actionTitle = action?.title?.trim();
  const stepName = actionTitle && !GENERIC_ACTION_TITLES.has(actionTitle)
    ? actionTitle
    : `点击${expected[0]}`;
  const nearest = nearestVisibleText(expected, actual);

  const details: NonNullable<PublicExecutionFailure["details"]> = [
    { label: "预期目标", value: `文字${target}` },
    { label: "实际结果", value: ocrLookupResult(expected, actual, candidateCount) }
  ];
  if (nearest) {
    details.push({ label: "相近文字", value: `现场识别到“${nearest}”，目标文字可能填写有误。` });
  }

  return {
    ...fallback,
    message: `步骤“${stepName}”需要点击文字${target}，但在${scope}${lookup}仍未找到。`,
    details
  };
}

function ocrLookupResult(expected: string[], actual: string, candidateCount: number | undefined): string {
  const target = formatTextTargets(expected);
  const empty = !actual || actual === "(empty OCR result)";
  if (empty || candidateCount === 0) {
    return `OCR 未识别到可用文字，因此无法匹配${target}。`;
  }
  if (candidateCount !== undefined) {
    return `OCR 识别到 ${candidateCount} 个文字候选，但没有匹配到${target}。`;
  }
  return `OCR 已读取当前屏幕文字，但没有匹配到${target}。`;
}

function formatTextTargets(values: string[]): string {
  return values.map((value) => `“${value}”`).join("或");
}

function nearestVisibleText(expected: string[], actual: string): string | undefined {
  if (!actual || actual === "(empty OCR result)") return undefined;
  const candidates = Array.from(new Set(actual
    .split(/[\s,，。；;、|/]+/u)
    .map((value) => value.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean)));

  let nearest: { value: string; score: number } | undefined;
  for (const target of expected) {
    const normalizedTarget = target.toLocaleLowerCase();
    for (const candidate of candidates) {
      const normalizedCandidate = candidate.toLocaleLowerCase();
      if (normalizedCandidate === normalizedTarget) continue;
      const longest = Math.max(characterLength(normalizedTarget), characterLength(normalizedCandidate));
      if (longest === 0) continue;
      const score = 1 - levenshteinDistance(normalizedTarget, normalizedCandidate) / longest;
      const threshold = longest <= 2 ? 0.5 : 0.67;
      if (score < threshold || (nearest && score <= nearest.score)) continue;
      nearest = { value: candidate, score };
    }
  }
  return nearest?.value;
}

function levenshteinDistance(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const previous = b.map((_, index) => index + 1);
  previous.unshift(0);

  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      const substitution = previous[column - 1]! + (a[row - 1] === b[column - 1] ? 0 : 1);
      current[column] = Math.min(previous[column]! + 1, current[column - 1]! + 1, substitution);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length] ?? a.length;
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function nestedRecord(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const nested = value?.[key];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : undefined;
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

const GENERIC_ACTION_TITLES = new Set(["tap", "tap_on_text", "点击目标"]);
