import type { BusinessGraph, BusinessGraphVersion, BusinessNode, PlatformScope, StateMatcher } from "@mobile-automation/graph-core";

export type PageAssetPlatform = "android" | "ios" | "harmony" | "flutter";

export type PageAssetSummary = {
  id: string;
  key: string;
  name: string;
  appId: string;
  graphVersionId: string;
  platformScope?: PlatformScope;
  matcherCount: number;
  tags?: string[];
};

export type PageAsset = PageAssetSummary & {
  node: BusinessNode;
};

export interface PageAssetCatalog {
  listPages(appId: string, platform: PageAssetPlatform): PageAssetSummary[];
  getPage(pageId: string): PageAsset | undefined;
  resolvePage(reference: string, appId: string, platform: PageAssetPlatform): PageAsset | undefined;
  findConfusablePages(pageId: string): PageAssetSummary[];
}

export type PageAssetCatalogStorage = {
  listBusinessGraphs(): BusinessGraph[];
  findBusinessGraphByAppId(appId: string): BusinessGraph | undefined;
  getActiveBusinessGraphVersion(graphId: string): BusinessGraphVersion | undefined;
};

export class StoragePageAssetCatalog implements PageAssetCatalog {
  constructor(private readonly storage: PageAssetCatalogStorage) {}

  listPages(appId: string, platform: PageAssetPlatform): PageAssetSummary[] {
    const graph = this.storage.findBusinessGraphByAppId(appId);
    const version = graph ? this.storage.getActiveBusinessGraphVersion(graph.id) : undefined;
    if (!graph || !version) {
      return [];
    }
    return version.nodes
      .filter((node) => isConfirmedPage(node) && supportsPlatform(node.platformScope, platform))
      .map((node) => summarizePage(graph, node));
  }

  getPage(pageId: string): PageAsset | undefined {
    const found = this.findPage(pageId);
    return found ? { ...summarizePage(found.graph, found.node), node: found.node } : undefined;
  }

  resolvePage(reference: string, appId: string, platform: PageAssetPlatform): PageAsset | undefined {
    const pages = this.listPages(appId, platform);
    const stableMatches = pages.filter((page) => page.id === reference || page.key === reference);
    if (stableMatches.length === 1) {
      return this.getPage(stableMatches[0].id);
    }
    const normalizedReference = normalize(reference);
    const nameMatches = pages.filter((page) => normalize(page.name) === normalizedReference);
    return nameMatches.length === 1 ? this.getPage(nameMatches[0].id) : undefined;
  }

  findConfusablePages(pageId: string): PageAssetSummary[] {
    const found = this.findPage(pageId);
    if (!found) {
      return [];
    }
    const signatures = identitySignatures(found.node.matchers);
    return found.version.nodes
      .filter((node) => node.id !== pageId && isConfirmedPage(node))
      .filter((node) => {
        const other = identitySignatures(node.matchers);
        return intersects(signatures, other) || normalize(found.node.name) === normalize(node.name);
      })
      .map((node) => summarizePage(found.graph, node));
  }

  private findPage(pageId: string): { graph: BusinessGraph; version: BusinessGraphVersion; node: BusinessNode } | undefined {
    for (const graph of this.storage.listBusinessGraphs()) {
      const version = this.storage.getActiveBusinessGraphVersion(graph.id);
      const node = version?.nodes.find((candidate) => candidate.id === pageId && isConfirmedPage(candidate));
      if (version && node) {
        return { graph, version, node };
      }
    }
    return undefined;
  }
}

function summarizePage(graph: BusinessGraph, node: BusinessNode): PageAssetSummary {
  return {
    id: node.id,
    key: node.key,
    name: node.name,
    appId: graph.appId,
    graphVersionId: node.graphVersionId,
    platformScope: node.platformScope,
    matcherCount: node.matchers.length,
    tags: [...node.tags]
  };
}

function isConfirmedPage(node: BusinessNode): boolean {
  return node.status === "active" && node.nodeType === "page" && node.metadata?.assetRecordingConfirmed === true;
}

function supportsPlatform(scope: PlatformScope | undefined, platform: PageAssetPlatform): boolean {
  if (!scope || scope === "mobile-both") {
    return true;
  }
  return scope === platform;
}

function identitySignatures(matchers: StateMatcher[]): Set<string> {
  const signatures = new Set<string>();
  for (const matcher of matchers) {
    if (matcher.type === "package" || matcher.type === "bundle_id") {
      continue;
    }
    const value = normalize(safeDecode(matcher.value));
    if (value) {
      signatures.add(`${matcher.type}:${value}`);
    }
  }
  return signatures;
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  return [...left].some((value) => right.has(value));
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, "");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
