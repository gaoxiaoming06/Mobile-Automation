import type { BusinessGraphVersion, Observation } from "@mobile-automation/graph-core";
import { matchCurrentPage, type PageMatcherBaselineReader, type PageMatcherDiagnostics } from "./page-matcher.js";
import type { ObservationOptions } from "./observation-service.js";
import type { PageAsset, PageAssetCatalog, PageAssetPlatform, PageAssetSummary } from "./page-asset-catalog.js";

export type PageObservationCollector = {
  collect(serial: string, options: ObservationOptions): Promise<Observation>;
};

export type IdentifyPageInput = {
  serial: string;
  appId: string;
  platform: PageAssetPlatform;
  observation?: Observation;
  screenshot?: Buffer;
};

export type VerifyExpectedPageInput = IdentifyPageInput & {
  pageId: string;
};

export type WaitForExpectedPageInput = VerifyExpectedPageInput & {
  timeoutMs?: number;
  intervalMs?: number;
};

export type PageStateResult = {
  status: "matched" | "multiple_candidates" | "unknown" | "outside_app" | "capture_failed";
  page?: PageAssetSummary;
  candidates: PageAssetSummary[];
  observation?: Observation;
  diagnostics?: PageMatcherDiagnostics;
  actualAppId?: string;
  reason?: "page_asset_not_found" | "observation_failed" | "screenshot_missing" | "page_not_matched" | "ambiguous_evidence";
  error?: string;
};

export interface PageStateService {
  identifyCurrentPage(input: IdentifyPageInput): Promise<PageStateResult>;
  verifyExpectedPage(input: VerifyExpectedPageInput): Promise<PageStateResult>;
  waitForExpectedPage(input: WaitForExpectedPageInput): Promise<PageStateResult>;
}

export class DefaultPageStateService implements PageStateService {
  constructor(
    private readonly catalog: PageAssetCatalog,
    private readonly observations: PageObservationCollector,
    private readonly baselineReader?: PageMatcherBaselineReader
  ) {}

  async identifyCurrentPage(input: IdentifyPageInput): Promise<PageStateResult> {
    const pages = this.catalog.listPages(input.appId, input.platform)
      .map((page) => this.catalog.getPage(page.id))
      .filter((page): page is PageAsset => Boolean(page));
    return this.matchPages(input, pages);
  }

  async verifyExpectedPage(input: VerifyExpectedPageInput): Promise<PageStateResult> {
    const target = this.catalog.resolvePage(input.pageId, input.appId, input.platform);
    const eligiblePageIds = new Set(this.catalog.listPages(input.appId, input.platform).map((page) => page.id));
    if (!target || target.appId !== input.appId || !eligiblePageIds.has(target.id)) {
      return { status: "unknown", candidates: [], reason: "page_asset_not_found" };
    }
    const confusable = this.catalog.findConfusablePages(target.id)
      .filter((page) => page.appId === input.appId && eligiblePageIds.has(page.id))
      .map((page) => this.catalog.getPage(page.id))
      .filter((page): page is PageAsset => Boolean(page));
    return this.matchPages(input, [target, ...confusable], target.id);
  }

  async waitForExpectedPage(input: WaitForExpectedPageInput): Promise<PageStateResult> {
    const timeoutMs = input.timeoutMs ?? 10_000;
    const intervalMs = input.intervalMs ?? 300;
    const deadline = Date.now() + timeoutMs;
    let latest = await this.verifyExpectedPage({ ...input, observation: input.observation });
    while (latest.status !== "matched" && latest.status !== "outside_app" && latest.status !== "capture_failed" && Date.now() < deadline) {
      if (intervalMs > 0) {
        await delay(intervalMs);
      }
      latest = await this.verifyExpectedPage({ ...input, observation: undefined, screenshot: undefined });
    }
    return latest;
  }

  private async matchPages(input: IdentifyPageInput, pages: PageAsset[], expectedPageId?: string): Promise<PageStateResult> {
    if (pages.length === 0) {
      return { status: "unknown", candidates: [], reason: "page_asset_not_found" };
    }
    const observationResult = await this.readObservation(input);
    if ("failure" in observationResult) {
      return observationResult.failure;
    }
    const observation = observationResult.observation;
    if (observation.packageName && observation.packageName !== input.appId) {
      return {
        status: "outside_app",
        candidates: [],
        observation,
        actualAppId: observation.packageName
      };
    }
    const graphVersion = graphForPages(pages);
    const result = await matchCurrentPage({
      graphVersion,
      observation,
      baselineReader: this.baselineReader,
      candidateNodeIds: pages.map((page) => page.id),
      promoteLocalState: false
    });
    const candidates = result.match.candidates
      .map((candidate) => pages.find((page) => page.id === candidate.node.id))
      .filter((page): page is PageAsset => Boolean(page))
      .map(stripNode);
    if (result.match.status === "multiple_candidates") {
      return {
        status: "multiple_candidates",
        candidates,
        observation: result.observation,
        diagnostics: result.diagnostics,
        reason: "ambiguous_evidence"
      };
    }
    const matched = result.match.node ? pages.find((page) => page.id === result.match.node?.id) : undefined;
    if (result.match.status === "matched" && matched && (!expectedPageId || matched.id === expectedPageId)) {
      return {
        status: "matched",
        page: stripNode(matched),
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

  private async readObservation(input: IdentifyPageInput): Promise<{ observation: Observation } | { failure: PageStateResult }> {
    let observation: Observation;
    try {
      observation = input.observation ?? await this.observations.collect(input.serial, {
        includeScreenshot: true,
        includeOcr: true,
        includeUiTree: false,
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
    if (!observation.screenshot || typeof observation.raw?.screenshotBase64 !== "string") {
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

function graphForPages(pages: PageAsset[]): BusinessGraphVersion {
  return {
    id: pages[0].graphVersionId,
    graphId: pages[0].appId,
    version: 1,
    sourceSummary: ["page-state-service"],
    status: "active",
    nodes: pages.map((page) => page.node),
    createdAt: new Date(0).toISOString()
  };
}

function stripNode(page: PageAsset): PageAssetSummary {
  const { node: _node, ...summary } = page;
  return summary;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
