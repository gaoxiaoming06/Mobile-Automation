import type { BusinessGraph, GraphTargetApp, GraphTargetProfile, Observation, PlatformScope } from "@mobile-automation/graph-core";
import type { Platform } from "@mobile-automation/shared";

export type AssetTargetProfileLookup = {
  androidPackageName?: string;
  iosBundleId?: string;
};

export function selectAssetGraphForTargetProfile(
  graphs: BusinessGraph[],
  target: AssetTargetProfileLookup | undefined,
  platform: Platform
): BusinessGraph | undefined {
  const activeGraphs = graphs.filter((graph) => graph.status !== "deprecated" && graph.activeVersionId && platformScopeMatches(graph.platformScope, platform));
  if (hasTargetIdentity(target, platform)) {
    return activeGraphs.find((graph) => graphMatchesTargetProfile(graph, target, platform));
  }
  return activeGraphs[0];
}

export function targetProfilesForGraph(graph: Pick<BusinessGraph, "targetApp">): GraphTargetProfile[] {
  return targetProfilesForTargetApp(graph.targetApp);
}

export function targetProfilesForTargetApp(targetApp: GraphTargetApp | undefined): GraphTargetProfile[] {
  const profiles = (targetApp?.profiles ?? []).map((profile) => normalizeTargetProfile(profile)).filter((profile): profile is GraphTargetProfile => Boolean(profile));
  const legacyProfiles: GraphTargetProfile[] = [];
  const legacyAndroidPackageName = normalizeText(targetApp?.androidPackageName);
  if (legacyAndroidPackageName) {
    legacyProfiles.push({
      id: "legacy-android-primary",
      platform: "android",
      displayName: "Android",
      androidPackageName: legacyAndroidPackageName,
      isPrimary: profiles.every((profile) => profile.platform !== "android")
    });
  }
  const legacyIosBundleId = normalizeText(targetApp?.iosBundleId);
  if (legacyIosBundleId) {
    legacyProfiles.push({
      id: "legacy-ios-primary",
      platform: "ios",
      displayName: "iOS",
      iosBundleId: legacyIosBundleId,
      isPrimary: profiles.every((profile) => profile.platform !== "ios")
    });
  }
  return dedupeProfiles([...profiles, ...legacyProfiles]);
}

export function graphMatchesTargetProfile(
  graph: Pick<BusinessGraph, "platformScope" | "targetApp">,
  target: AssetTargetProfileLookup | undefined,
  platform: Platform
): boolean {
  if (!platformScopeMatches(graph.platformScope, platform) || !hasTargetIdentity(target, platform)) {
    return false;
  }
  return targetProfilesForTargetApp(graph.targetApp).some((profile) => profileMatchesTarget(profile, target, platform));
}

export function isObservationInAssetGraphTarget(observation: Observation, targetApp: GraphTargetApp | undefined): boolean {
  const profiles = targetProfilesForTargetApp(targetApp);
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
  return true;
}

export function graphTargetMismatchMessage(graph: Pick<BusinessGraph, "targetApp">, observation: Observation): string | undefined {
  if (isObservationInAssetGraphTarget(observation, graph.targetApp)) {
    return undefined;
  }
  const actual = observation.platform === "ios" ? normalizeText(observation.bundleId) : normalizeText(observation.packageName);
  const expected = expectedTargetLabel(graph.targetApp, observation.platform);
  return `当前页面属于 ${actual ?? "未知 App"}，不属于资产库 ${expected ?? "目标 App"}`;
}

export function assertObservationMatchesGraphTargetApp(graph: Pick<BusinessGraph, "targetApp">, observation: Observation): void {
  const message = graphTargetMismatchMessage(graph, observation);
  if (message) {
    throw new Error(message);
  }
}

export function targetProfileLookupFromObservation(observation: Observation | undefined): AssetTargetProfileLookup | undefined {
  if (!observation) {
    return undefined;
  }
  if (observation.platform === "android") {
    const androidPackageName = normalizeText(observation.packageName);
    return androidPackageName ? { androidPackageName } : undefined;
  }
  const iosBundleId = normalizeText(observation.bundleId);
  return iosBundleId ? { iosBundleId } : undefined;
}

function normalizeTargetProfile(profile: GraphTargetProfile): GraphTargetProfile | undefined {
  const platform = profile.platform === "android" || profile.platform === "ios" || profile.platform === "harmony" || profile.platform === "flutter" ? profile.platform : undefined;
  if (!platform) {
    return undefined;
  }
  const androidPackageName = normalizeText(profile.androidPackageName);
  const iosBundleId = normalizeText(profile.iosBundleId);
  const harmonyBundleName = normalizeText(profile.harmonyBundleName);
  const flutterAppId = normalizeText(profile.flutterAppId);
  return {
    ...profile,
    id: normalizeText(profile.id) ?? profileIdFor({ ...profile, platform, androidPackageName, iosBundleId, harmonyBundleName, flutterAppId }),
    platform,
    displayName: normalizeText(profile.displayName),
    androidPackageName,
    iosBundleId,
    harmonyBundleName,
    flutterAppId
  };
}

function dedupeProfiles(profiles: GraphTargetProfile[]): GraphTargetProfile[] {
  const seen = new Set<string>();
  const result: GraphTargetProfile[] = [];
  for (const profile of profiles) {
    const key = profileKey(profile);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(profile);
  }
  return result;
}

function profileMatchesTarget(profile: GraphTargetProfile, target: AssetTargetProfileLookup | undefined, platform: Platform): boolean {
  if (platform === "android") {
    const androidPackageName = normalizeText(target?.androidPackageName);
    return profile.platform === "android" && Boolean(androidPackageName) && normalizeText(profile.androidPackageName) === androidPackageName;
  }
  const iosBundleId = normalizeText(target?.iosBundleId);
  return profile.platform === "ios" && Boolean(iosBundleId) && normalizeText(profile.iosBundleId) === iosBundleId;
}

function hasTargetIdentity(target: AssetTargetProfileLookup | undefined, platform: Platform): boolean {
  return platform === "android" ? Boolean(normalizeText(target?.androidPackageName)) : Boolean(normalizeText(target?.iosBundleId));
}

function platformScopeMatches(scope: PlatformScope | undefined, platform: Platform): boolean {
  return !scope || scope === "mobile-both" || scope === platform;
}

function expectedTargetLabel(targetApp: GraphTargetApp | undefined, platform: Platform): string | undefined {
  const profiles = targetProfilesForTargetApp(targetApp).filter((profile) => profile.platform === platform);
  const labels = profiles
    .map((profile) => (platform === "android" ? profile.androidPackageName : profile.iosBundleId))
    .map((value) => normalizeText(value))
    .filter((value): value is string => Boolean(value));
  return labels.join(" / ") || undefined;
}

function profileKey(profile: GraphTargetProfile): string {
  if (profile.platform === "android" && profile.androidPackageName) {
    return `android:${profile.androidPackageName}`;
  }
  if (profile.platform === "ios" && profile.iosBundleId) {
    return `ios:${profile.iosBundleId}`;
  }
  if (profile.platform === "harmony" && profile.harmonyBundleName) {
    return `harmony:${profile.harmonyBundleName}`;
  }
  if (profile.platform === "flutter" && profile.flutterAppId) {
    return `flutter:${profile.flutterAppId}`;
  }
  return `${profile.platform}:${profile.id}`;
}

function profileIdFor(profile: Pick<GraphTargetProfile, "platform" | "androidPackageName" | "iosBundleId" | "harmonyBundleName" | "flutterAppId">): string {
  if (profile.platform === "android" && profile.androidPackageName) {
    return `android:${profile.androidPackageName}`;
  }
  if (profile.platform === "ios" && profile.iosBundleId) {
    return `ios:${profile.iosBundleId}`;
  }
  if (profile.platform === "harmony" && profile.harmonyBundleName) {
    return `harmony:${profile.harmonyBundleName}`;
  }
  if (profile.platform === "flutter" && profile.flutterAppId) {
    return `flutter:${profile.flutterAppId}`;
  }
  return `${profile.platform}:profile`;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
