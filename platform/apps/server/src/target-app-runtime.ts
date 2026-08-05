import type { Observation } from "@mobile-automation/graph-core";
import type { Platform } from "@mobile-automation/shared";

const CLASSIN_APP_ID = "classin";
const DEFAULT_CLASSIN_ANDROID_PACKAGE = "cn.eeo.classin";
const DEFAULT_CLASSIN_HARMONY_BUNDLE_ID = "cn.eeo.hos.classin.mobile";
const LEGACY_CLASSIN_HARMONY_BUNDLE_ID = "com.eeo.classin.harmony";

export type RuntimeAppEnv = {
  CLASSIN_ANDROID_PACKAGE?: string;
  CLASSIN_IOS_BUNDLE_ID?: string;
  CLASSIN_HARMONY_BUNDLE_ID?: string;
  CLASSIN_HARMONY_ABILITY_NAME?: string;
};

type ObservationAppIdentity = Pick<Observation, "platform"> &
  Partial<Pick<Observation, "packageName" | "bundleId">> &
  Record<string, unknown>;

export type ResolveRuntimeAppIdentifierInput = {
  appId: string;
  platform: Platform;
  env?: RuntimeAppEnv;
};

export type ObservationTargetAppMatch = {
  inside: boolean;
  expectedAppIdentifier: string;
  actualAppIdentifier?: string;
};

export function normalizeTargetAppId(value: string, env: RuntimeAppEnv = process.env): string {
  const appId = value.trim();
  return classInAppIdAliases(env).includes(appId) ? CLASSIN_APP_ID : appId;
}

export function targetAppIdAliases(value: string, env: RuntimeAppEnv = process.env): string[] {
  const appId = value.trim();
  if (normalizeTargetAppId(appId, env) !== CLASSIN_APP_ID) {
    return appId ? [appId] : [];
  }
  return [...new Set([appId, ...classInAppIdAliases(env)].filter(Boolean))];
}

export function resolveRuntimeAppIdentifier(input: ResolveRuntimeAppIdentifierInput): string {
  const appId = normalizeTargetAppId(input.appId, input.env);
  if (!appId) {
    throw new Error("appId is required");
  }
  if (appId !== CLASSIN_APP_ID) {
    return appId;
  }

  const env = input.env ?? process.env;
  if (input.platform === "android") {
    return nonBlank(env.CLASSIN_ANDROID_PACKAGE) ?? DEFAULT_CLASSIN_ANDROID_PACKAGE;
  }
  if (input.platform === "ios") {
    return requiredEnv(env.CLASSIN_IOS_BUNDLE_ID, "CLASSIN_IOS_BUNDLE_ID");
  }
  return nonBlank(env.CLASSIN_HARMONY_BUNDLE_ID) ?? DEFAULT_CLASSIN_HARMONY_BUNDLE_ID;
}

export function resolveHarmonyAbilityName(env: RuntimeAppEnv = process.env): string | undefined {
  return nonBlank(env.CLASSIN_HARMONY_ABILITY_NAME);
}

export function appIdentifierFromObservation(observation: ObservationAppIdentity): string | undefined {
  if (observation.platform === "android") {
    return nonBlank(observation.packageName);
  }
  return nonBlank(observation.bundleId) ?? nonBlank(observation.packageName);
}

export function isObservationInsideTargetApp(input: {
  appId: string;
  platform: Platform;
  observation: ObservationAppIdentity;
  env?: RuntimeAppEnv;
}): ObservationTargetAppMatch {
  const expectedAppIdentifier = resolveRuntimeAppIdentifier({
    appId: input.appId,
    platform: input.platform,
    env: input.env
  });
  const actualAppIdentifier = appIdentifierFromObservation(input.observation);
  return {
    inside: !actualAppIdentifier || actualAppIdentifier === expectedAppIdentifier,
    expectedAppIdentifier,
    actualAppIdentifier
  };
}

function requiredEnv(value: string | undefined, name: string): string {
  const normalized = nonBlank(value);
  if (!normalized) {
    throw new Error(`${name} is required to resolve ClassIn runtime app identity`);
  }
  return normalized;
}

function classInAppIdAliases(env: RuntimeAppEnv): string[] {
  return [
    CLASSIN_APP_ID,
    DEFAULT_CLASSIN_ANDROID_PACKAGE,
    DEFAULT_CLASSIN_HARMONY_BUNDLE_ID,
    LEGACY_CLASSIN_HARMONY_BUNDLE_ID,
    nonBlank(env.CLASSIN_ANDROID_PACKAGE),
    nonBlank(env.CLASSIN_IOS_BUNDLE_ID),
    nonBlank(env.CLASSIN_HARMONY_BUNDLE_ID)
  ].filter((alias): alias is string => Boolean(alias));
}

function nonBlank(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
