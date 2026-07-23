import { DatabaseZap, Info, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../api";

type BusinessGraph = {
  id: string;
  appId: string;
  name: string;
  status: string;
  platformScope?: string;
  targetApp?: {
    androidPackageName?: string;
    iosBundleId?: string;
  };
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
  transitions?: PageAssetTransitionSummary[];
  tasks?: PageAssetTaskSummary[];
  updatedAt?: string;
};

type PageAssetTaskSummary = {
  id: string;
  name: string;
  status: "active" | "draft" | "deprecated";
  stepCount: number;
  parameterKeys: string[];
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

type PageAssetTransitionSummary = {
  id: string;
  key: string;
  name: string;
  status: string;
  source: string;
  actionSummary?: string;
  actionLocator?: string;
  actionKind?: "tap" | "scroll" | "long_press" | "input" | "unknown";
  targetNodeId: string;
  targetName?: string;
  targetKey?: string;
  expectationSummary?: string;
  reliabilityScore?: number;
};

type GraphAssetGovernanceSummary = {
  graphVersionId: string;
  pageAssets: PageAssetSummary[];
};

type GraphListResponse = {
  graphs: BusinessGraph[];
};

type GraphAssetsResponse = {
  assets: GraphAssetGovernanceSummary;
};

type PageAssetsSnapshot = {
  graphs: BusinessGraph[];
  assetsByVersionId: Record<string, GraphAssetGovernanceSummary>;
};

type PageAssetsPanelProps = {
  graphs?: BusinessGraph[];
  assetsByVersionId?: Record<string, GraphAssetGovernanceSummary>;
  onOpenAssetRecording: () => void;
  setMessage: (message: string) => void;
};

type DecoratedPageAsset = PageAssetSummary & { graphName?: string; appId?: string; graphVersion?: number; graphVersionId?: string };

export function PageAssetsPanel({
  graphs: initialGraphs,
  assetsByVersionId: initialAssetsByVersionId,
  onOpenAssetRecording,
  setMessage
}: PageAssetsPanelProps) {
  const [graphs, setGraphs] = useState<BusinessGraph[]>(initialGraphs ?? []);
  const [assetsByVersionId, setAssetsByVersionId] = useState<Record<string, GraphAssetGovernanceSummary>>(initialAssetsByVersionId ?? {});
  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const pageAssets = useMemo(
    () =>
      graphs.flatMap((graph) =>
        graph.activeVersion?.id
          ? (assetsByVersionId[graph.activeVersion.id]?.pageAssets ?? []).map((asset) => ({
              ...asset,
              graphName: graph.name,
              appId: graph.appId,
              graphVersion: graph.activeVersion?.version,
              graphVersionId: graph.activeVersion?.id
            }))
          : []
      ),
    [assetsByVersionId, graphs]
  );
  const selectedLibraryAsset = useMemo(() => pageAssets.find((asset) => asset.id === selectedAssetId) ?? pageAssets[0], [pageAssets, selectedAssetId]);
  const libraryStats = useMemo(() => pageAssetLibraryStats(pageAssets), [pageAssets]);

  useEffect(() => {
    if (!initialGraphs && !initialAssetsByVersionId) {
      void refreshPageAssets();
    }
  }, [initialAssetsByVersionId, initialGraphs]);

  useEffect(() => {
    if (initialGraphs || initialAssetsByVersionId) {
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
  }, [initialAssetsByVersionId, initialGraphs]);

  async function refreshPageAssets() {
    try {
      setBusy(true);
      const snapshot = await loadPageAssetsSnapshot();
      setGraphs(snapshot.graphs);
      setAssetsByVersionId(snapshot.assetsByVersionId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function deletePageAsset(graphVersionId: string | undefined, assetId: string, assetName: string) {
    if (!graphVersionId) {
      setMessage("页面资产缺少图谱版本，无法删除");
      return;
    }
    try {
      setBusy(true);
      const response = await apiFetchJson<GraphAssetsResponse>(`/api/graphs/${encodeURIComponent(graphVersionId)}/assets/nodes/${encodeURIComponent(assetId)}`, {
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
  const graphResponse = await fetchJson<GraphListResponse>("/api/graphs");
  const activeGraphs = graphResponse.graphs.filter((graph) => graph.status !== "deprecated" && graph.activeVersion?.id);
  const summaries = await Promise.all(
    activeGraphs.map(async (graph) => {
      const versionId = graph.activeVersion?.id;
      if (!versionId) {
        return undefined;
      }
      const response = await fetchJson<GraphAssetsResponse>(`/api/graphs/${encodeURIComponent(versionId)}/assets?limit=120`);
      return [versionId, response.assets] as const;
    })
  );
  return {
    graphs: activeGraphs,
    assetsByVersionId: Object.fromEntries(summaries.filter((item): item is [string, GraphAssetGovernanceSummary] => Boolean(item)))
  };
}

type PageAssetLibraryStats = {
  pages: number;
  matchers: number;
  elements: number;
  transitions: number;
  tasks: number;
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
        <span>可操作</span>
      </div>
      <div>
        <strong>{stats.transitions}</strong>
        <span>连接边</span>
      </div>
      <div>
        <strong>{stats.tasks}</strong>
        <span>页面任务</span>
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
      transitions: stats.transitions + transitionCount(asset),
      tasks: stats.tasks + taskCount(asset),
      regions: stats.regions + (asset.screenshotRegions?.length ?? 0)
    }),
    { pages: 0, matchers: 0, elements: 0, transitions: 0, tasks: 0, regions: 0 }
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
              可操作
            </span>
            <span>
              <strong>{transitionCount(asset)}</strong>
              出口
            </span>
            <span>
              <strong>{taskCount(asset)}</strong>
              任务
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
  const transitions = asset.transitions ?? [];
  const tasks = asset.tasks ?? [];
  return (
    <aside className="page-asset-detail-panel" aria-label={`页面资产详情：${asset.name}`}>
      <div className="page-asset-detail-head">
        <div>
          <h3>{asset.name}</h3>
          <span>{assetGraphSummary(asset)} · {platformLabel(asset.platformScope)} · {asset.elementCount} 个可操作元素</span>
        </div>
      </div>

      <div className="page-asset-detail-content">
        <div className="page-asset-detail-section">
          <h4>概览</h4>
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
              <dt>可操作</dt>
              <dd>{asset.elementCount}</dd>
            </div>
            <div>
              <dt>连接边</dt>
              <dd>{transitionCount(asset)}</dd>
            </div>
            <div>
              <dt>页面任务</dt>
              <dd>{taskCount(asset)}</dd>
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
            <h4>页面能力</h4>
            <p>{asset.elementCount > 0 ? `已录入 ${asset.elementCount} 个可操作区域；具体区域和能力类型在资产录制页维护。` : "还没有录入可操作区域。"}</p>
          </div>

          <div className="page-asset-detail-section">
            <h4>页面任务</h4>
            {tasks.length ? (
              <div className="page-asset-transition-list">
                {tasks.map((task) => (
                  <div className="page-asset-transition-card" key={task.id}>
                    <strong>{task.name}</strong>
                    <span>{task.stepCount} 个步骤{task.parameterKeys.length ? ` · 参数：${task.parameterKeys.join("、")}` : ""}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p>暂无页面任务；表单填写、提交、页面内配置会在资产录制页维护。</p>
            )}
          </div>

          <div className="page-asset-detail-section">
            <h4>连接边</h4>
            {transitions.length ? (
              <div className="page-asset-transition-list">
                {transitions.map((transition) => (
                  <div className="page-asset-transition-card" key={transition.id}>
                    <strong>{transition.targetName ? `到 ${transition.targetName}` : transition.name}</strong>
                    <span>{transition.actionSummary ?? transition.actionLocator ?? "未记录动作摘要"}</span>
                    {transition.expectationSummary ? <small>{transition.expectationSummary}</small> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p>暂无连接边；需要在资产录制页把本页能力连接到目标页面。</p>
            )}
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

function transitionCount(asset: PageAssetSummary): number {
  return asset.transitions?.length ?? 0;
}

function taskCount(asset: PageAssetSummary): number {
  return asset.tasks?.filter((task) => task.status !== "deprecated").length ?? 0;
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
