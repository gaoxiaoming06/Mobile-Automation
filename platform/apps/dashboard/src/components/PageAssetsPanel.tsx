import { DatabaseZap, Info, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../api";

type PageAssetLibrary = {
  id: string;
  appId: string;
  name: string;
  status: string;
  platformScope?: string;
  activeVersion?: {
    id: string;
    version: number;
  };
};

type PageAssetSummary = {
  id: string;
  key: string;
  name: string;
  status: string;
  platformScope?: string;
  tags: string[];
  matcherCount: number;
  criticalMatcherCount: number;
  elementCount: number;
  identityTexts?: string[];
  confirmedMatchers?: string[];
  confirmedUiTexts?: string[];
  confirmedOcrTexts?: string[];
  screenshotRegions?: PageAssetScreenshotRegionSummary[];
  visibleTexts: string[];
  resourceIds: string[];
  accessibilityIds: string[];
  updatedAt?: string;
};

type PageAssetScreenshotRegionSummary = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  semanticArea?: string;
  coordinateSpace?: string;
  evidenceTexts?: string[];
  baselineUrl?: string;
};

type GraphAssetGovernanceSummary = {
  graphVersionId: string;
  pageAssets: PageAssetSummary[];
};

type PageAssetLibraryListResponse = {
  libraries: PageAssetLibrary[];
};

type GraphAssetsResponse = {
  assets: GraphAssetGovernanceSummary;
};

type PageAssetsSnapshot = {
  libraries: PageAssetLibrary[];
  assetsByVersionId: Record<string, GraphAssetGovernanceSummary>;
};

type PageAssetsPanelProps = {
  libraries?: PageAssetLibrary[];
  assetsByVersionId?: Record<string, GraphAssetGovernanceSummary>;
  onOpenAssetRecording: () => void;
  setMessage: (message: string) => void;
};

type DecoratedPageAsset = PageAssetSummary & { graphName?: string; appId?: string; graphVersion?: number; graphVersionId?: string };

export function PageAssetsPanel({
  libraries: initialLibraries,
  assetsByVersionId: initialAssetsByVersionId,
  onOpenAssetRecording,
  setMessage
}: PageAssetsPanelProps) {
  const [libraries, setLibraries] = useState<PageAssetLibrary[]>(initialLibraries ?? []);
  const [assetsByVersionId, setAssetsByVersionId] = useState<Record<string, GraphAssetGovernanceSummary>>(initialAssetsByVersionId ?? {});
  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const pageAssets = useMemo(
    () =>
      libraries.flatMap((library) =>
        library.activeVersion?.id
          ? (assetsByVersionId[library.activeVersion.id]?.pageAssets ?? []).map((asset) => ({
              ...asset,
              graphName: library.name,
              appId: library.appId,
              graphVersion: library.activeVersion?.version,
              graphVersionId: library.activeVersion?.id
            }))
          : []
      ),
    [assetsByVersionId, libraries]
  );
  const selectedLibraryAsset = useMemo(() => pageAssets.find((asset) => asset.id === selectedAssetId) ?? pageAssets[0], [pageAssets, selectedAssetId]);
  const libraryStats = useMemo(() => pageAssetLibraryStats(pageAssets), [pageAssets]);

  useEffect(() => {
    if (!initialLibraries && !initialAssetsByVersionId) {
      void refreshPageAssets();
    }
  }, [initialAssetsByVersionId, initialLibraries]);

  useEffect(() => {
    if (initialLibraries || initialAssetsByVersionId) {
      return;
    }
    function refreshOnVisible() {
      if (document.visibilityState === "visible") {
        void refreshPageAssets();
      }
    }
    document.addEventListener("visibilitychange", refreshOnVisible);
    window.addEventListener("focus", refreshOnVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshOnVisible);
      window.removeEventListener("focus", refreshOnVisible);
    };
  }, [initialAssetsByVersionId, initialLibraries]);

  async function refreshPageAssets() {
    try {
      setBusy(true);
      const snapshot = await loadPageAssetsSnapshot();
      setLibraries(snapshot.libraries);
      setAssetsByVersionId(snapshot.assetsByVersionId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function deletePageAsset(graphVersionId: string | undefined, assetId: string, assetName: string) {
    if (!graphVersionId) {
      setMessage("页面资产缺少资产库版本，无法删除");
      return;
    }
    try {
      setBusy(true);
      const response = await apiFetchJson<GraphAssetsResponse>(`/api/page-assets/${encodeURIComponent(graphVersionId)}/assets/nodes/${encodeURIComponent(assetId)}`, {
        method: "DELETE"
      });
      setAssetsByVersionId((current) => ({
        ...current,
        [graphVersionId]: response.assets
      }));
      if (selectedAssetId === assetId) {
        setSelectedAssetId(undefined);
      }
      setMessage(`已删除页面资产：${assetName}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="module-page page-assets-module">
      <div className="panel page-assets-library-panel">
        <div className="panel-head">
          <div>
            <h2>已保存页面资产</h2>
          </div>
          <button className="icon-button" type="button" onClick={refreshPageAssets} disabled={busy}>
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
        <PageAssetLibraryStats stats={libraryStats} />
        <div className="page-assets-library-layout">
          <PageAssetList
            assets={pageAssets}
            busy={busy}
            emptyText="还没有保存过页面资产。请先进入资产录制页保存当前页面。"
            selectedAssetId={selectedLibraryAsset?.id}
            onSelectAsset={setSelectedAssetId}
            onDeletePageAsset={deletePageAsset}
            onOpenAssetRecording={onOpenAssetRecording}
          />
          {selectedLibraryAsset ? <PageAssetDetailPanel asset={selectedLibraryAsset} /> : null}
        </div>
      </div>
    </section>
  );
}

export async function loadPageAssetsSnapshot(fetchJson: typeof apiFetchJson = apiFetchJson): Promise<PageAssetsSnapshot> {
  const libraryResponse = await fetchJson<PageAssetLibraryListResponse>("/api/page-assets");
  const activeLibraries = libraryResponse.libraries.filter((library) => library.status !== "deprecated" && library.activeVersion?.id);
  const summaries = await Promise.all(
    activeLibraries.map(async (library) => {
      const versionId = library.activeVersion?.id;
      if (!versionId) {
        return undefined;
      }
      const response = await fetchJson<GraphAssetsResponse>(`/api/page-assets/${encodeURIComponent(versionId)}/assets?limit=120`);
      return [versionId, response.assets] as const;
    })
  );
  return {
    libraries: activeLibraries,
    assetsByVersionId: Object.fromEntries(summaries.filter((item): item is [string, GraphAssetGovernanceSummary] => Boolean(item)))
  };
}

type PageAssetLibraryStats = {
  pages: number;
  matchers: number;
  elements: number;
  regions: number;
};

function PageAssetLibraryStats({ stats }: { stats: PageAssetLibraryStats }) {
  return (
    <section className="page-assets-summary" aria-label="页面资产概览">
      <div>
        <strong>{stats.pages}</strong>
        <span>页面资产</span>
      </div>
      <div>
        <strong>{stats.matchers}</strong>
        <span>匹配依据</span>
      </div>
      <div>
        <strong>{stats.elements}</strong>
        <span>公共定位器</span>
      </div>
      <div>
        <strong>{stats.regions}</strong>
        <span>重点区域</span>
      </div>
    </section>
  );
}

function pageAssetLibraryStats(assets: DecoratedPageAsset[]): PageAssetLibraryStats {
  return assets.reduce(
    (stats, asset) => ({
      pages: stats.pages + 1,
      matchers: stats.matchers + (asset.criticalMatcherCount || asset.matcherCount),
      elements: stats.elements + asset.elementCount,
      regions: stats.regions + (asset.screenshotRegions?.length ?? 0)
    }),
    { pages: 0, matchers: 0, elements: 0, regions: 0 }
  );
}

function PageAssetList({
  assets,
  busy,
  emptyText,
  selectedAssetId,
  onSelectAsset,
  onDeletePageAsset,
  onOpenAssetRecording
}: {
  assets: DecoratedPageAsset[];
  busy: boolean;
  emptyText: string;
  selectedAssetId?: string;
  onSelectAsset: (assetId: string) => void;
  onDeletePageAsset: (graphVersionId: string | undefined, assetId: string, assetName: string) => void | Promise<void>;
  onOpenAssetRecording: () => void;
}) {
  if (!assets.length) {
    return (
      <div className="page-assets-empty">
        <div className="empty">{emptyText}</div>
        <button className="icon-button" type="button" onClick={onOpenAssetRecording}>
          <DatabaseZap size={16} />
          去资产录制
        </button>
      </div>
    );
  }
  return (
    <div className="page-assets-list">
      {assets.map((asset) => (
        <article className={asset.id === selectedAssetId ? "page-asset-row selected" : "page-asset-row"} key={asset.id}>
          <button className="page-asset-main" type="button" onClick={() => onSelectAsset(asset.id)}>
            <span className="page-asset-row-kicker">{assetGraphSummary(asset)} · {asset.status}</span>
            <strong>{asset.name}</strong>
            <span>{assetIdentitySummary(asset)}</span>
            <small>{asset.updatedAt ? `更新于 ${asset.updatedAt}` : `${platformLabel(asset.platformScope)} · ${asset.key}`}</small>
          </button>
          <div className="page-asset-row-stats" aria-label={`${asset.name} 页面资产统计`}>
            <span>
              <strong>{asset.criticalMatcherCount || asset.matcherCount}</strong>
              匹配依据
            </span>
            <span>
              <strong>{asset.elementCount}</strong>
              公共定位器
            </span>
          </div>
          <div className="page-asset-row-actions">
            <button className="page-asset-action detail" type="button" disabled={busy} onClick={() => onSelectAsset(asset.id)}>
              <Info size={14} />
              详情
            </button>
            <button className="page-asset-action danger" type="button" disabled={busy} aria-label={`删除页面资产：${asset.name}`} onClick={() => void onDeletePageAsset(asset.graphVersionId, asset.id, asset.name)}>
              <Trash2 size={14} />
              删除
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function PageAssetDetailPanel({ asset }: { asset: DecoratedPageAsset }) {
  const identityTexts = assetIdentityTexts(asset);
  const screenshotRegions = asset.screenshotRegions ?? [];
  return (
    <aside className="page-asset-detail-panel" aria-label={`页面资产详情：${asset.name}`}>
      <div className="page-asset-detail-head">
        <div>
          <h3>{asset.name}</h3>
          <span>{assetGraphSummary(asset)} · {platformLabel(asset.platformScope)} · {asset.elementCount} 个公共定位器</span>
        </div>
      </div>

      <div className="page-asset-detail-content">
        <div className="page-asset-detail-section">
                <h4>页面身份</h4>
          <dl>
            <div>
              <dt>确认依据</dt>
              <dd>{asset.criticalMatcherCount || asset.matcherCount}</dd>
            </div>
            <div>
              <dt>重点区域</dt>
              <dd>{screenshotRegions.length}</dd>
            </div>
            <div>
              <dt>公共定位器</dt>
              <dd>{asset.elementCount}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{asset.status}</dd>
            </div>
          </dl>
        </div>

          <div className="page-asset-detail-section">
            <h4>页面匹配依据</h4>
            {identityTexts.length ? (
              <div className="page-asset-chip-list">
                {identityTexts.map((text) => (
                  <span key={text}>{text}</span>
                ))}
              </div>
            ) : (
              <p>暂无已确认匹配依据；请在资产录制页确认 OCR 文字或截图重点区域。</p>
            )}
          </div>

          <div className="page-asset-detail-section">
            <h4>截图重点区域</h4>
            {screenshotRegions.length ? (
              <div className="page-asset-region-list">
                {screenshotRegions.map((region) => (
                  <div className="page-asset-region-card" key={region.id}>
                    {region.baselineUrl ? <img src={region.baselineUrl} alt={`${region.label} baseline`} /> : null}
                    <strong>{region.label}</strong>
                    <span>{semanticAreaLabel(region.semanticArea)} · x {formatPercent(region.x)} / y {formatPercent(region.y)} / w {formatPercent(region.width)} / h {formatPercent(region.height)}</span>
                    {displayRegionEvidenceSummary(region.evidenceTexts) ? <small>{displayRegionEvidenceSummary(region.evidenceTexts)}</small> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p>暂无截图重点区域。</p>
            )}
          </div>

          <div className="page-asset-detail-section">
            <h4>公共定位器</h4>
            <p>{asset.elementCount > 0 ? `已录入 ${asset.elementCount} 个可复用定位器；临时动作可以直接写在 ScriptFlow 中。` : "暂无公共定位器；脚本仍可使用 OCR 或语义目标执行临时动作。"}</p>
          </div>

          <div className="page-asset-detail-section page-asset-identity-card">
            <h4>资产标识</h4>
            <code>{asset.key}</code>
            <span>{asset.graphVersionId ?? "-"}</span>
            {asset.updatedAt ? <span>更新于 {asset.updatedAt}</span> : null}
          </div>
        </div>
    </aside>
  );
}

function platformLabel(platformScope: string | undefined): string {
  if (platformScope === "mobile-both") {
    return "Android / iOS";
  }
  if (platformScope === "ios") {
    return "iOS";
  }
  return "Android";
}

function assetGraphSummary(asset: DecoratedPageAsset): string {
  return `${asset.graphName ?? asset.appId ?? "未分组资产"}${asset.graphVersion ? ` · v${asset.graphVersion}` : ""}`;
}

export function assetIdentitySummary(asset: PageAssetSummary, limit = 4): string {
  const texts = assetIdentityTexts(asset).slice(0, limit);
  return texts.length ? texts.join(" · ") : "暂无已确认匹配依据";
}

function assetIdentityTexts(asset: PageAssetSummary): string[] {
  return uniqueStrings(
    [
      ...(asset.identityTexts ?? []).map(cleanEvidenceText).filter((text) => isDisplaySafeIdentityText(text)),
      ...(asset.confirmedMatchers ?? []).map(cleanEvidenceText).filter((text) => isDisplaySafeIdentityText(text)),
      ...(asset.confirmedOcrTexts ?? []).map(cleanEvidenceText).filter((text) => isDisplaySafeIdentityText(text)),
      ...(asset.screenshotRegions ?? []).flatMap((region) => [
        region.label,
        ...(region.evidenceTexts ?? []).map(cleanEvidenceText).filter((text) => isDisplaySafeIdentityText(text, { autoEvidence: true }))
      ])
    ].filter((text): text is string => Boolean(text))
  );
}

function cleanEvidenceText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const withoutPrefix = value.replace(/^(?:text|ocr_text|ocr|matcher):/i, "");
  const withoutRegion = withoutPrefix.replace(/@region\([^)]+\)$/i, "");
  const trimmed = withoutRegion.trim();
  return trimmed.length ? trimmed : undefined;
}

export function displayRegionEvidenceSummary(values: string[] | undefined): string | undefined {
  const texts = uniqueStrings((values ?? []).map(cleanEvidenceText).filter((text) => isDisplaySafeIdentityText(text, { autoEvidence: true })));
  return texts.length ? texts.join(" · ") : undefined;
}

function isDisplaySafeIdentityText(value: string | undefined, options: { autoEvidence?: boolean } = {}): value is string {
  if (!value) {
    return false;
  }
  const text = value.trim();
  if (!text || isPlatformSpecificText(text)) {
    return false;
  }
  if (options.autoEvidence && isCommonTechnicalAccessibilityLabel(text)) {
    return false;
  }
  return /[\p{L}\p{N}]/u.test(text);
}

function isPlatformSpecificText(value: string): boolean {
  const normalized = value.trim();
  return (
    /^[a-z][\w.]+:id\/[\w.]+$/i.test(normalized) ||
    /^android(?:x)?\.[\w.$]+$/i.test(normalized) ||
    /^ios\.[\w.$]+$/i.test(normalized) ||
    /^XCUIElementType\w+$/i.test(normalized) ||
    /^(?:resource-id|accessibility-id|content-desc|class)\s*:/i.test(normalized)
  );
}

function isCommonTechnicalAccessibilityLabel(value: string): boolean {
  return new Set([
    "avatar",
    "back",
    "close",
    "contact",
    "down",
    "icon",
    "search",
    "user avatar"
  ]).has(value.trim().toLowerCase());
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
}

function formatPercent(value: number): string {
  return `${Number(value.toFixed(1))}%`;
}

function semanticAreaLabel(value: string | undefined): string {
  if (value === "top") {
    return "顶部标题栏区域";
  }
  if (value === "content") {
    return "中间内容区域";
  }
  if (value === "bottom") {
    return "底部固定区域";
  }
  return "未知区域";
}
