import { createId, nowIso, type ActionStep, type DeviceActionRequest } from "@mobile-automation/shared";
import type { Observation, ObservationText, ObservationUiElement } from "@mobile-automation/graph-core";
import { normalizeOcrText } from "./step-expectations.js";

export type RuntimeInterceptorRule = {
  id: string;
  name: string;
  enabled?: boolean;
  text?: string;
  matchers?: RuntimeInterceptorMatcher[];
  action: RuntimeInterceptorAction;
  platformScope?: "android" | "ios" | "mobile-both";
  appPackageName?: string;
  iosBundleId?: string;
  flowId?: string;
  stepId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type RuntimeInterceptorRecord = {
  id: string;
  ruleId: string;
  ruleName: string;
  matchedText: string;
  action: DeviceActionRequest;
  handledAt: string;
};

export type RuntimeInterceptorMatcher = {
  type: "text" | "resource_id" | "content_desc" | "activity" | "package";
  value: string;
  mode?: "contains" | "equals";
};

export type RuntimeInterceptorAction =
  | {
      type: "tap_text";
      text: string;
      mode?: "contains" | "equals";
    }
  | {
      type: "tap_element";
      resourceId?: string;
      text?: string;
      contentDesc?: string;
      mode?: "contains" | "equals";
    }
  | {
      type: "back";
    };

export type RuntimeInterceptorDeps = {
  observe: () => Promise<Observation>;
  performAction: (action: ActionStep) => Promise<void>;
};

export type RuntimeInterceptorInput = {
  phase: "precondition" | "state_transition";
  maxPasses?: number;
};

export type RuntimeInterceptorOutcome = {
  observation: Observation;
  records: RuntimeInterceptorRecord[];
};

const DEFAULT_RULES: RuntimeInterceptorRule[] = [
  {
    id: "classin-service-agreement",
    name: "ClassIn 服务协议弹窗",
    enabled: true,
    matchers: [
      { type: "package", value: "cn.eeo.classin", mode: "equals" },
      { type: "text", value: "ClassIn服务协议" },
      { type: "resource_id", value: "cn.eeo.classin:id/btn_agree", mode: "equals" }
    ],
    action: {
      type: "tap_element",
      resourceId: "cn.eeo.classin:id/btn_agree",
      text: "同意",
      mode: "equals"
    },
    platformScope: "android",
    appPackageName: "cn.eeo.classin"
  },
  {
    id: "classin-stage-subject-picker",
    name: "ClassIn 选择学段学科页",
    enabled: true,
    matchers: [
      { type: "text", value: "更懂你的课" },
      { type: "text", value: "选择学段和学科" }
    ],
    action: { type: "tap_text", text: "×", mode: "equals" },
    platformScope: "mobile-both"
  },
  rule("android-permission-allow", "Android 权限允许", "允许"),
  rule("common-known", "确认提示", "知道了"),
  rule("common-later", "稍后提示", "稍后"),
  rule("common-skip", "跳过提示", "跳过")
];

export class RuntimeInterceptor {
  private readonly rules: RuntimeInterceptorRule[];

  constructor(
    private readonly deps: RuntimeInterceptorDeps,
    rules: RuntimeInterceptorRule[] = []
  ) {
    this.rules = [...rules, ...DEFAULT_RULES];
  }

  async handle(input: RuntimeInterceptorInput): Promise<RuntimeInterceptorOutcome> {
    const maxPasses = Math.max(0, Math.floor(input.maxPasses ?? 2));
    const records: RuntimeInterceptorRecord[] = [];
    let observation = await this.deps.observe();

    for (let pass = 0; pass < maxPasses; pass += 1) {
      const match = this.findBlockingMatch(observation);
      if (!match) {
        break;
      }
      const actionStep = actionStepForMatch(match);
      const action = deviceActionForMatch(match);
      await this.deps.performAction(actionStep);
      records.push({
        id: createId("runtime_interceptor"),
        ruleId: match.rule.id,
        ruleName: match.rule.name,
        matchedText: match.text,
        action,
        handledAt: nowIso()
      });
      observation = await this.deps.observe();
    }

    return {
      observation,
      records
    };
  }

  private findBlockingMatch(observation: Observation): RuntimeInterceptorMatch | undefined {
    const candidates = [...observation.uiElements.map(candidateFromElement), ...observation.ocrTexts.map(candidateFromOcr)].filter(
      (candidate): candidate is RuntimeInterceptorCandidate => Boolean(candidate)
    );
    for (const rule of this.rules) {
      if (rule.enabled === false) {
        continue;
      }
      if (rule.platformScope && rule.platformScope !== "mobile-both" && rule.platformScope !== observation.platform) {
        continue;
      }
      if (rule.appPackageName && observation.packageName && rule.appPackageName !== observation.packageName) {
        continue;
      }
      if (rule.iosBundleId && observation.bundleId && rule.iosBundleId !== observation.bundleId) {
        continue;
      }
      const matchers = normalizedMatchers(rule);
      if (!matchers.length || !matchers.every((matcher) => matcherMatchesObservation(matcher, observation, candidates))) {
        continue;
      }
      const trigger = candidates.find((candidate) => matcherMatchesCandidate(matchers[0], candidate));
      const found = actionCandidate(rule.action, candidates) ?? trigger;
      if (found) {
        return {
          rule,
          text: trigger?.text ?? found.text,
          centerX: found.centerX,
          centerY: found.centerY
        };
      }
    }
    return undefined;
  }
}

type RuntimeInterceptorCandidate = {
  text: string;
  resourceId?: string;
  contentDesc?: string;
  centerX: number;
  centerY: number;
};

type RuntimeInterceptorMatch = RuntimeInterceptorCandidate & {
  rule: RuntimeInterceptorRule;
};

function rule(id: string, name: string, text: string): RuntimeInterceptorRule {
  return {
    id,
    name,
    text,
    enabled: true,
    matchers: [{ type: "text", value: text }],
    action: {
      type: "tap_text",
      text
    },
    platformScope: "mobile-both"
  };
}

function candidateFromElement(element: ObservationUiElement): RuntimeInterceptorCandidate | undefined {
  const text = element.text || element.contentDesc || element.accessibilityId;
  if (!text || !element.bounds) {
    return undefined;
  }
  return {
    text,
    resourceId: element.resourceId,
    contentDesc: element.contentDesc ?? element.accessibilityId,
    centerX: Math.round(element.bounds.x + element.bounds.width / 2),
    centerY: Math.round(element.bounds.y + element.bounds.height / 2)
  };
}

function candidateFromOcr(text: ObservationText): RuntimeInterceptorCandidate | undefined {
  if (!text.text || !text.region) {
    return undefined;
  }
  return {
    text: text.text,
    centerX: Math.round(text.region.x + text.region.width / 2),
    centerY: Math.round(text.region.y + text.region.height / 2)
  };
}

function normalizedMatchers(rule: RuntimeInterceptorRule): RuntimeInterceptorMatcher[] {
  if (rule.matchers?.length) {
    return rule.matchers;
  }
  return rule.text ? [{ type: "text", value: rule.text }] : [];
}

function matcherMatchesObservation(
  matcher: RuntimeInterceptorMatcher,
  observation: Observation,
  candidates: RuntimeInterceptorCandidate[]
): boolean {
  if (matcher.type === "activity") {
    return textMatches(observation.activityName, matcher.value, matcher.mode);
  }
  if (matcher.type === "package") {
    return textMatches(observation.packageName ?? observation.bundleId, matcher.value, matcher.mode);
  }
  return candidates.some((candidate) => matcherMatchesCandidate(matcher, candidate));
}

function matcherMatchesCandidate(matcher: RuntimeInterceptorMatcher, candidate: RuntimeInterceptorCandidate): boolean {
  if (matcher.type === "text") {
    return textMatches(candidate.text, matcher.value, matcher.mode);
  }
  if (matcher.type === "resource_id") {
    return textMatches(candidate.resourceId, matcher.value, matcher.mode);
  }
  if (matcher.type === "content_desc") {
    return textMatches(candidate.contentDesc, matcher.value, matcher.mode);
  }
  return false;
}

function actionCandidate(action: RuntimeInterceptorAction, candidates: RuntimeInterceptorCandidate[]): RuntimeInterceptorCandidate | undefined {
  if (action.type === "tap_text") {
    return candidates.find((candidate) => textMatches(candidate.text, action.text, action.mode));
  }
  if (action.type === "tap_element") {
    return candidates.find((candidate) => {
      const resourceIdMatched = action.resourceId ? textMatches(candidate.resourceId, action.resourceId, action.mode) : true;
      const textMatched = action.text ? textMatches(candidate.text, action.text, action.mode) : true;
      const contentDescMatched = action.contentDesc ? textMatches(candidate.contentDesc, action.contentDesc, action.mode) : true;
      return resourceIdMatched && textMatched && contentDescMatched;
    });
  }
  return candidates[0];
}

function textMatches(actual: string | undefined, expected: string, mode: "contains" | "equals" = "contains"): boolean {
  if (!actual) {
    return false;
  }
  const actualNormalized = normalizeOcrText(actual);
  const expectedNormalized = normalizeOcrText(expected);
  return mode === "equals" ? actualNormalized === expectedNormalized : actualNormalized.includes(expectedNormalized);
}

function actionStepForMatch(match: RuntimeInterceptorMatch): ActionStep {
  if (match.rule.action.type === "back") {
    return {
      id: createId("runtime_interceptor_step"),
      order: 0,
      type: "back",
      enabled: true,
      params: {
        source: "runtime_interceptor",
        ruleId: match.rule.id
      },
      createdAt: nowIso()
    };
  }
  const params =
    match.rule.action.type === "tap_element"
      ? {
          locator: {
            strategy: "android_uiautomator",
            resourceId: match.rule.action.resourceId,
            text: match.rule.action.text,
            contentDesc: match.rule.action.contentDesc,
            textMatchMode: match.rule.action.mode ?? "contains"
          },
          source: "runtime_interceptor",
          ruleId: match.rule.id
        }
      : {
          text: match.rule.action.text,
          mode: match.rule.action.mode ?? "contains",
          source: "runtime_interceptor",
          ruleId: match.rule.id
        };
  return {
    id: createId("runtime_interceptor_step"),
    order: 0,
    type: match.rule.action.type === "tap_element" ? "tap_on_element" : "tap_on_text",
    enabled: true,
    params,
    coordinate: {
      x: match.centerX,
      y: match.centerY
    },
    createdAt: nowIso()
  };
}

function deviceActionForMatch(match: RuntimeInterceptorMatch): DeviceActionRequest {
  if (match.rule.action.type === "back") {
    return { type: "back" };
  }
  return {
    type: "tap",
    x: match.centerX,
    y: match.centerY
  };
}
