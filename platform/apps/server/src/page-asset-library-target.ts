import type { GraphTargetApp, GraphTargetProfile, Observation } from "@mobile-automation/graph-core";
import type { Platform } from "@mobile-automation/shared";

export function isObservationInPageAssetLibrary(observation: Observation, targetApp: GraphTargetApp | undefined): boolean {
  const profiles = normalizedProfiles(targetApp);
  if (!profiles.length) {
    return true;
  }
  if (observation.platform === "android") {
    const androidProfiles = profiles.filter((profile) => profile.platform === "android" && profile.androidPackageName);
    return !androidProfiles.length || androidProfiles.some((profile) => normalizeText(observation.packageName) === normalizeText(profile.androidPackageName));
  }
  if (observation.platform === "ios") {
    const iosProfiles = profiles.filter((profile) => profile.platform === "ios" && profile.iosBundleId);
    return !iosProfiles.length || iosProfiles.some((profile) => normalizeText(observation.bundleId) === normalizeText(profile.iosBundleId));
  }
  if (observation.platform === "harmony") {
    const harmonyProfiles = profiles.filter((profile) => profile.platform === "harmony" && profile.harmonyBundleName);
    return !harmonyProfiles.length || harmonyProfiles.some((profile) => normalizeText(observation.bundleId) === normalizeText(profile.harmonyBundleName));
  }
  return true;
}

export function pageAssetLibraryTargetMismatchMessage(
  library: { targetApp?: GraphTargetApp },
  observation: Observation
): string | undefined {
  if (isObservationInPageAssetLibrary(observation, library.targetApp)) {
    return undefined;
  }
  const actual = observation.platform === "android" ? normalizeText(observation.packageName) : normalizeText(observation.bundleId);
  const expected = expectedTargetLabel(library.targetApp, observation.platform);
  return `当前页面属于 ${actual ?? "未知 App"}，不属于页面资产库 ${expected ?? "目标 App"}`;
}

function normalizedProfiles(targetApp: GraphTargetApp | undefined): GraphTargetProfile[] {
  return (targetApp?.profiles ?? []).filter((profile) => {
    if (profile.platform === "android") return Boolean(normalizeText(profile.androidPackageName));
    if (profile.platform === "ios") return Boolean(normalizeText(profile.iosBundleId));
    if (profile.platform === "harmony") return Boolean(normalizeText(profile.harmonyBundleName));
    if (profile.platform === "flutter") return Boolean(normalizeText(profile.flutterAppId));
    return false;
  });
}

function expectedTargetLabel(targetApp: GraphTargetApp | undefined, platform: Platform): string | undefined {
  const labels = normalizedProfiles(targetApp)
    .filter((profile) => profile.platform === platform)
    .map((profile) => {
      if (platform === "android") return profile.androidPackageName;
      if (platform === "ios") return profile.iosBundleId;
      if (platform === "harmony") return profile.harmonyBundleName;
      return undefined;
    })
    .map(normalizeText)
    .filter((value): value is string => Boolean(value));
  return labels.join(" / ") || undefined;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
