import type { BusinessGraphVersion, BusinessNode, Observation } from "@mobile-automation/graph-core";
import { CROSS_PLATFORM_SCRIPT_SCOPE } from "@mobile-automation/shared";
import { matchCurrentPage, type PageMatcherBaselineReader, type PageMatcherDiagnostics } from "./page-matcher.js";
import type { ObservationOptions } from "./observation-service.js";
import type { PageAssetPlatform, PageAssetSummary } from "./page-asset-catalog.js";
import type { ExecutionProfileScreen, ExecutionProfileSnapshot } from "./execution-profile.js";
import { isObservationInsideTargetApp, type RuntimeAppEnv } from "./target-app-runtime.js";

export type PageObservationCollector = {
  collect(serial: string, options: ObservationOptions): Promise<Observation>;
};

export type IdentifyScreenInput = {
  serial: string;
  appId: string;
  platform: PageAssetPlatform;
  observation?: Observation;
  screenshot?: Buffer;
  executionProfile: ExecutionProfileSnapshot;
};

export type VerifyExpectedScreenInput = IdentifyScreenInput & {
  screenRef: string;
};

export type WaitForExpectedScreenInput = VerifyExpectedScreenInput & {
  timeoutMs?: number;
  intervalMs?: number;
};

export type ScreenStateSummary = PageAssetSummary & {
  screenRef: string;
};

export type PageStateResult = {
  status: "matched" | "multiple_candidates" | "unknown" | "outside_app" | "capture_failed";
  page?: PageAssetSummary;
  screen?: ScreenStateSummary;
  candidates: PageAssetSummary[];
  observation?: Observation;
  diagnostics?: PageMatcherDiagnostics;
  actualAppId?: string;
  reason?:
    | "page_asset_not_found"
    | "profile_not_found"
    | "observation_failed"
    | "screenshot_missing"
    | "page_not_matched"
    | "ambiguous_evidence";
  error?: string;
};

export interface PageStateService {
  identifyCurrentScreen(input: IdentifyScreenInput): Promise<PageStateResult>;
  verifyExpectedScreen(input: VerifyExpectedScreenInput): Promise<PageStateResult>;
  waitForExpectedScreen(input: WaitForExpectedScreenInput): Promise<PageStateResult>;
}

type ProfilePage = {
  screen: ExecutionProfileScreen;
  node: BusinessNode;
};

export class DefaultPageStateService implements PageStateService {
  private readonly observations: PageObservationCollector;
  private readonly baselineReader?: PageMatcherBaselineReader;
  private readonly env?: RuntimeAppEnv;

  constructor(
    observations: PageObservationCollector,
    baselineReader?: PageMatcherBaselineReader,
    env?: RuntimeAppEnv
  ) {
    this.observations = observations;
    this.baselineReader = baselineReader;
    this.env = env;
  }

  async identifyCurrentScreen(input: IdentifyScreenInput): Promise<PageStateResult> {
    const pages = profilePages(input.executionProfile);
    return this.matchPages(input, pages);
  }

  async verifyExpectedScreen(input: VerifyExpectedScreenInput): Promise<PageStateResult> {
    const target = resolveProfileScreen(input.executionProfile, input.screenRef);
    if (!target) {
      return { status: "unknown", candidates: [], reason: "profile_not_found" };
    }
    const pages = profilePages(input.executionProfile);
    const confusable = pages.filter((page) => page.screen.assetId !== target.screen.assetId && sharesEvidence(target, page));
    return this.matchPages(input, [target, ...confusable], target.screen.assetId);
  }

  async waitForExpectedScreen(input: WaitForExpectedScreenInput): Promise<PageStateResult> {
    const timeoutMs = input.timeoutMs ?? 10_000;
    const intervalMs = input.intervalMs ?? 300;
    const deadline = Date.now() + timeoutMs;
    let latest = await this.verifyExpectedScreen({ ...input, observation: input.observation });
    while (
      latest.status !== "matched"
      && latest.status !== "outside_app"
      && latest.status !== "capture_failed"
      && Date.now() < deadline
    ) {
      if (intervalMs > 0) {
        await delay(intervalMs);
      }
      latest = await this.verifyExpectedScreen({ ...input, observation: undefined, screenshot: undefined });
    }
    return latest;
  }

  private async matchPages(
    input: IdentifyScreenInput,
    pages: ProfilePage[],
    expectedPageId?: string
  ): Promise<PageStateResult> {
    if (pages.length === 0) {
      return { status: "unknown", candidates: [], reason: "profile_not_found" };
    }
    const observationResult = await this.readObservation(input);
    if ("failure" in observationResult) {
      return observationResult.failure;
    }
    const observation = observationResult.observation;
    const appMatch = isObservationInsideTargetApp({
      appId: input.appId,
      platform: input.platform === "flutter" || input.platform === CROSS_PLATFORM_SCRIPT_SCOPE ? observation.platform : input.platform,
      observation,
      env: this.env
    });
    if (!appMatch.inside) {
      return {
        status: "outside_app",
        candidates: [],
        observation,
        actualAppId: appMatch.actualAppIdentifier
      };
    }
    const graphVersion = graphForPages(pages);
    const result = await matchCurrentPage({
      graphVersion,
      observation,
      baselineReader: this.baselineReader,
      candidateNodeIds: pages.map((page) => page.node.id),
      promoteLocalState: false
    });
    const candidates = result.match.candidates
      .map((candidate) => pages.find((page) => page.node.id === candidate.node.id))
      .filter((page): page is ProfilePage => Boolean(page))
      .map((page) => summaryForScreen(page, input.appId));
    if (result.match.status === "multiple_candidates") {
      return {
        status: "multiple_candidates",
        candidates,
        observation: result.observation,
        diagnostics: result.diagnostics,
        reason: "ambiguous_evidence"
      };
    }
    const matched = result.match.node
      ? pages.find((page) => page.node.id === result.match.node?.id)
      : undefined;
    if (result.match.status === "matched" && matched && (!expectedPageId || matched.node.id === expectedPageId)) {
      const conflicts = pagesWithSharedOnlyMatchedEvidence(matched, pages, result.diagnostics);
      if (conflicts.length > 0) {
        return {
          status: "multiple_candidates",
          candidates: [matched, ...conflicts].map((page) => summaryForScreen(page, input.appId)),
          observation: result.observation,
          diagnostics: result.diagnostics,
          reason: "ambiguous_evidence"
        };
      }
      const screen = summaryForScreen(matched, input.appId);
      return {
        status: "matched",
        page: screen,
        screen,
        candidates,
        observation: result.observation,
        diagnostics: result.diagnostics
      };
    }
    return {
      status: "unknown",
      candidates,
      observation: result.observation,
      diagnostics: result.diagnostics,
      reason: "page_not_matched"
    };
  }

  private async readObservation(
    input: IdentifyScreenInput
  ): Promise<{ observation: Observation } | { failure: PageStateResult }> {
    let observation: Observation;
    try {
      observation = input.observation ?? await this.observations.collect(input.serial, {
        includeScreenshot: true,
        includeOcr: true,
        includeUiTree: true,
        ...(input.screenshot ? { screenshotOverride: input.screenshot } : {})
      });
    } catch (error) {
      return {
        failure: {
          status: "capture_failed",
          candidates: [],
          reason: "observation_failed",
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
    if (!observationHasEvidence(observation)) {
      return {
        failure: {
          status: "capture_failed",
          candidates: [],
          observation,
          reason: "screenshot_missing"
        }
      };
    }
    return { observation };
  }
}

function profilePages(profile: ExecutionProfileSnapshot): ProfilePage[] {
  return profile.screens.map((screen) => ({
    screen,
    node: {
      id: screen.assetId,
      graphVersionId: screen.graphVersionId,
      key: screen.screenRef,
      name: screen.name,
      nodeType: "page",
      tags: ["execution-profile"],
      status: "active",
      matchers: screen.evidence,
      defaultExpectations: [],
      platformScope: profile.platform,
      metadata: { assetRecordingConfirmed: true }
    }
  }));
}

function resolveProfileScreen(profile: ExecutionProfileSnapshot, reference: string): ProfilePage | undefined {
  return profilePages(profile).find((page) => page.screen.screenRef === reference);
}

function graphForPages(pages: ProfilePage[]): BusinessGraphVersion {
  return {
    id: pages[0]!.screen.graphVersionId,
    graphId: pages[0]!.screen.assetId,
    version: 1,
    sourceSummary: ["execution-profile"],
    status: "active",
    nodes: pages.map((page) => page.node),
    createdAt: new Date(0).toISOString()
  };
}

function summaryForScreen(page: ProfilePage, appId: string): ScreenStateSummary {
  return {
    id: page.screen.assetId,
    key: page.screen.screenRef,
    screenRef: page.screen.screenRef,
    name: page.screen.name,
    appId,
    graphVersionId: page.screen.graphVersionId,
    matcherCount: page.screen.evidence.length,
    platformScope: page.node.platformScope
  };
}

function sharesEvidence(left: ProfilePage, right: ProfilePage): boolean {
  const rightEvidence = new Set(
    right.screen.evidence
      .filter((matcher) => matcher.type !== "package" && matcher.type !== "bundle_id")
      .map((matcher) => identitySignature(matcher.type, matcher.value))
      .filter(Boolean)
  );
  return left.screen.evidence
    .filter((matcher) => matcher.type !== "package" && matcher.type !== "bundle_id")
    .some((matcher) => rightEvidence.has(identitySignature(matcher.type, matcher.value)));
}

function pagesWithSharedOnlyMatchedEvidence(
  matched: ProfilePage,
  pages: ProfilePage[],
  diagnostics: PageMatcherDiagnostics
): ProfilePage[] {
  const matchedSignatures = new Set(
    diagnostics.matchedEvidence
      .filter((evidence) => evidence.type !== "package" && evidence.type !== "bundle_id")
      .map((evidence) => identitySignature(evidence.type, evidence.expected))
      .filter(Boolean)
  );
  if (matchedSignatures.size === 0) {
    return [];
  }
  const others = pages.filter((page) => page.node.id !== matched.node.id);
  const signaturesByPage = others.map((page) => ({
    page,
    signatures: new Set(
      page.screen.evidence
        .filter((matcher) => matcher.type !== "package" && matcher.type !== "bundle_id")
        .map((matcher) => identitySignature(matcher.type, matcher.value))
        .filter(Boolean)
    )
  }));
  const hasExclusiveEvidence = [...matchedSignatures].some((signature) =>
    !signaturesByPage.some((candidate) => candidate.signatures.has(signature))
  );
  if (hasExclusiveEvidence) {
    return [];
  }
  return signaturesByPage
    .filter((candidate) => [...matchedSignatures].some((signature) => candidate.signatures.has(signature)))
    .map((candidate) => candidate.page);
}

function identitySignature(type: string, value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep malformed evidence comparable without failing page recognition.
  }
  const normalized = decoded.trim().toLocaleLowerCase().replace(/\s+/g, "");
  return normalized ? `${type}:${normalized}` : "";
}

function observationHasEvidence(observation: Observation): boolean {
  return Boolean(
    observation.screenshot
    || observation.uiElements.length > 0
    || observation.ocrTexts.length > 0
    || observation.packageName
    || observation.bundleId
    || observation.activityName
    || observation.routeName
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
