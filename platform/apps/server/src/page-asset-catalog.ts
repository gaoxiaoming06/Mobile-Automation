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
};

export type PageAsset = PageAssetSummary & {
  node: BusinessNode;
};

export type PageElementLocator = {
  id: string;
  label: string;
  locatorKind?: string;
  locator?: string;
  targetText?: string;
  visualLocator?: Record<string, unknown>;
  structuralLocator?: Record<string, unknown>;
  requiresUiTree: boolean;
  raw: Record<string, unknown>;
};

export interface PageAssetCatalog {
  listPages(appId: string, platform: PageAssetPlatform): PageAssetSummary[];
  getPage(pageId: string): PageAsset | undefined;
  listLocators(pageId: string): PageElementLocator[];
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

  listLocators(pageId: string): PageElementLocator[] {
    const page = this.getPage(pageId);
    if (!page) {
      return [];
    }
    const byId = new Map<string, PageElementLocator>();
    for (const value of [page.node.metadata?.assetRecordingPageElements, page.node.metadata?.assetRecordingManualElements]) {
      if (!Array.isArray(value)) {
        continue;
      }
      for (const raw of value) {
        const locator = readLocator(raw);
        if (locator) {
          byId.set(locator.id, locator);
        }
      }
    }
    return [...byId.values()];
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
    matcherCount: node.matchers.length
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

function readLocator(value: unknown): PageElementLocator | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    return undefined;
  }
  const locatorKind = optionalString(value.locatorKind);
  const structuralLocator = isRecord(value.structuralLocator) ? value.structuralLocator : undefined;
  return {
    id: value.id.trim(),
    label: optionalString(value.label) ?? optionalString(value.name) ?? value.id.trim(),
    ...(locatorKind ? { locatorKind } : {}),
    ...stringProperty(value.locator, "locator"),
    ...stringProperty(value.targetText, "targetText"),
    ...(isRecord(value.visualLocator) ? { visualLocator: value.visualLocator } : {}),
    ...(structuralLocator ? { structuralLocator } : {}),
    requiresUiTree: locatorKind === "structural_locator" || Boolean(structuralLocator),
    raw: value
  };
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringProperty<K extends string>(value: unknown, key: K): Partial<Record<K, string>> {
  const text = optionalString(value);
  return text ? { [key]: text } as Record<K, string> : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
