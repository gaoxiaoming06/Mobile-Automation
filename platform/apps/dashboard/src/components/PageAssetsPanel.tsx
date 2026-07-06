import { DatabaseZap, Info, PlayCircle, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { TestRun } from "@mobile-automation/shared";
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

type GraphRunResponse = {
  run: TestRun;
  routePlanId: string;
  executionPlanId: string;
  graphVersionId: string;
  targetNodeId: string;
};

type RoutePlanIssue = {
  code?: string;
  severity?: string;
  message?: string;
};

type RoutePlanPreviewResponse = {
  executionPlan?: {
    steps?: unknown[];
    unresolvedIssues?: RoutePlanIssue[];
  };
  startRecovery?: {
    status?: "recovered" | "failed";
    fromNodeName?: string;
    recoveredNodeName?: string;
  };
  startDetection?: {
    startNodeId?: string;
    nodeMatch?: {
      node?: {
        id?: string;
        key?: string;
        name?: string;
      };
    };
  };
};

type TargetActionMode = "none" | "page_task";

type TargetVerificationMode = "arrived" | "text_contains";

type RuntimeOverlay = {
  id?: string;
  targetNodeId?: string;
  targetTaskId?: string;
  note?: string;
  runtimeParams?: Record<string, string>;
  nodeExpectationOverrides?: Array<{
    nodeId: string;
    expectations: Array<{
      id: string;
      type: "text";
      enabled: boolean;
      title?: string;
      note?: string;
      params: Record<string, unknown>;
      createdAt: string;
    }>;
  }>;
};

type PageAssetsPanelProps = {
  selectedSerial?: string;
  selectedDeviceBusy?: boolean;
  initialTab?: PageAssetsTab;
  initialTargetText?: string;
  initialTargetTaskId?: string;
  initialRuntimeParams?: Record<string, string>;
  graphs?: BusinessGraph[];
  assetsByVersionId?: Record<string, GraphAssetGovernanceSummary>;
  onOpenAssetRecording: () => void;
  onRunStarted?: (runId: string) => void;
  setMessage: (message: string) => void;
};

type PageAssetsTab = "targetTest" | "library";
type DecoratedPageAsset = PageAssetSummary & { graphName?: string; appId?: string; graphVersion?: number; graphVersionId?: string };

export function PageAssetsPanel({
  selectedSerial = "",
  selectedDeviceBusy = false,
  initialTab = "targetTest",
  initialTargetText = "",
  initialTargetTaskId = "",
  initialRuntimeParams,
  graphs: initialGraphs,
  assetsByVersionId: initialAssetsByVersionId,
  onOpenAssetRecording,
  onRunStarted,
  setMessage
}: PageAssetsPanelProps) {
  const [activeTab, setActiveTab] = useState<PageAssetsTab>(initialTab);
  const [graphs, setGraphs] = useState<BusinessGraph[]>(initialGraphs ?? []);
  const [assetsByVersionId, setAssetsByVersionId] = useState<Record<string, GraphAssetGovernanceSummary>>(initialAssetsByVersionId ?? {});
  const [targetText, setTargetText] = useState(initialTargetText);
  const [targetActionMode, setTargetActionMode] = useState<TargetActionMode>(initialTargetTaskId ? "page_task" : "none");
  const [selectedTargetTaskId, setSelectedTargetTaskId] = useState(initialTargetTaskId);
  const [targetVerificationMode, setTargetVerificationMode] = useState<TargetVerificationMode>("arrived");
  const [targetVerificationText, setTargetVerificationText] = useState("");
  const [targetRuntimeParams, setTargetRuntimeParams] = useState<Record<string, string>>(initialRuntimeParams ?? {});
  const [targetRuntimeParamsText, setTargetRuntimeParamsText] = useState("");
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
  const filteredAssets = useMemo(() => {
    const query = targetText.trim().toLowerCase();
    if (!query) {
      return pageAssets;
    }
    return pageAssets.filter((asset) => searchableAssetTexts(asset).some((value) => value.toLowerCase().includes(query)));
  }, [pageAssets, targetText]);
  const selectedTargetAsset = useMemo(() => selectPageAssetTarget(filteredAssets, targetText), [filteredAssets, targetText]);
  const selectedTargetTasks = useMemo(() => (selectedTargetAsset?.tasks ?? []).filter((task) => task.status !== "deprecated"), [selectedTargetAsset]);
  const selectedTargetTask = useMemo(() => selectedTargetTasks.find((task) => task.id === selectedTargetTaskId), [selectedTargetTaskId, selectedTargetTasks]);
  const selectedTargetTaskRuntimeParams = useMemo(
    () => selectedTargetTask ? normalizeRuntimeParamValues(selectedTargetTask.parameterKeys, targetRuntimeParams) : undefined,
    [selectedTargetTask, targetRuntimeParams]
  );
  const selectedLibraryAsset = useMemo(() => pageAssets.find((asset) => asset.id === selectedAssetId), [pageAssets, selectedAssetId]);

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

  async function runTargetPage() {
    const query = targetText.trim();
    if (!query) {
      setMessage("请输入目标页面");
      return;
    }
    if (!selectedSerial) {
      setMessage("请先选择设备");
      return;
    }
    if (selectedDeviceBusy) {
      setMessage("当前设备正在执行任务，请等待结束后再启动目标页面测试");
      return;
    }
    if (!selectedTargetAsset?.graphVersionId) {
      setMessage("没有匹配到可执行的已保存页面资产，请先去资产录制补录页面");
      return;
    }
    const graph = graphs.find((item) => item.activeVersion?.id === selectedTargetAsset.graphVersionId);
    if (!graph) {
      setMessage("页面资产缺少所属图谱，无法规划执行");
      return;
    }
    try {
      setBusy(true);
      const routePreview = await apiFetchJson<RoutePlanPreviewResponse>(`/api/graphs/${encodeURIComponent(selectedTargetAsset.graphVersionId)}/route-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "android",
          targetNodeId: selectedTargetAsset.id,
          deviceSerial: selectedSerial,
          executionProfile: "fast_visual",
          startAppScope: "current_device",
          persist: false
        })
      });
      const blockingMessage = targetPageRouteBlockingMessage(routePreview, selectedTargetAsset.name);
      if (blockingMessage) {
        setMessage(blockingMessage);
        return;
      }
      const response = await apiFetchJson<GraphRunResponse>("/api/graph-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildTargetPageGraphRunRequest({
            selectedSerial,
            graphVersionId: selectedTargetAsset.graphVersionId,
            targetNodeId: selectedTargetAsset.id,
            startNodeId: routePreview.startDetection?.startNodeId,
            overlay: buildTargetPageRuntimeOverlay({
              targetNodeId: selectedTargetAsset.id,
              targetName: selectedTargetAsset.name,
              actionMode: targetActionMode,
              targetTaskId: targetActionMode === "page_task" ? selectedTargetTask?.id : undefined,
              verificationMode: targetVerificationMode,
              verificationText: targetVerificationText,
              runtimeParams: targetActionMode === "page_task" ? selectedTargetTaskRuntimeParams : undefined,
              runtimeParamsText: targetActionMode === "page_task" ? undefined : targetRuntimeParamsText
            })
          })
        )
      });
      const recoveredMessage =
        routePreview.startRecovery?.status === "recovered"
          ? `，已先从“${routePreview.startRecovery.fromNodeName ?? "临时页面"}”返回到“${routePreview.startRecovery.recoveredNodeName ?? "可规划页面"}”`
          : "";
      setMessage(`已启动目标页面执行：${selectedTargetAsset.name}${recoveredMessage}`);
      onRunStarted?.(response.run.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="module-page page-assets-module">
      <div className="page-assets-tabs" role="tablist" aria-label="页面资产库">
        <button className={tabClass(activeTab, "targetTest")} type="button" onClick={() => setActiveTab("targetTest")}>
          目标页面测试
        </button>
        <button className={tabClass(activeTab, "library")} type="button" onClick={() => setActiveTab("library")}>
          已保存页面资产
        </button>
      </div>

      {activeTab === "targetTest" ? (
        <div className="panel page-assets-target-panel">
          <div className="panel-head">
            <div>
              <h2>目标页面测试</h2>
            </div>
            <button className="icon-button" type="button" onClick={refreshPageAssets} disabled={busy}>
              <RefreshCw size={16} />
              刷新
            </button>
          </div>
          <div className="page-assets-target-form">
            <label>
              <span>目标页面</span>
              <input list="page-assets-target-options" value={targetText} onChange={(event) => setTargetText(event.target.value)} placeholder="输入页面名，例如：主页 / 新建公开课 / 班级详情" />
              <datalist id="page-assets-target-options">
                {filteredAssets.slice(0, 20).map((asset) => (
                  <option value={asset.name} key={asset.id}>
                    {assetIdentitySummary(asset)}
                  </option>
                ))}
              </datalist>
            </label>
            <label>
              <span>目标动作</span>
              <select
                value={targetActionMode === "page_task" ? selectedTargetTaskId : "none"}
                onChange={(event) => {
                  const taskId = event.target.value;
                  setSelectedTargetTaskId(taskId === "none" ? "" : taskId);
                  setTargetActionMode(taskId === "none" ? "none" : "page_task");
                }}
              >
                <option value="none">页面到达后不执行动作</option>
                {selectedTargetTasks.map((task) => (
                  <option value={task.id} key={task.id}>
                    执行页面任务：{task.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>目标验证</span>
              <select value={targetVerificationMode} onChange={(event) => setTargetVerificationMode(readTargetVerificationMode(event.target.value))}>
                <option value="arrived">仅验证已到达目标页面</option>
                <option value="text_contains">验证目标页面包含文字</option>
              </select>
            </label>
            {targetVerificationMode === "text_contains" ? (
              <label>
                <span>预期文字</span>
                <input value={targetVerificationText} onChange={(event) => setTargetVerificationText(event.target.value)} placeholder="例如：发布成功 / 新建公开课 / 课堂信息" />
              </label>
            ) : null}
            {targetActionMode === "page_task" && selectedTargetTask ? (
              <div className="target-runtime-params">
                <span className="target-runtime-params-title">运行参数（可选）</span>
                {selectedTargetTask.parameterKeys.length ? (
                  selectedTargetTask.parameterKeys.map((key) => (
                    <label key={key}>
                      <span>{runtimeParamLabel(key)}</span>
                      <input
                        name={`runtime-param-${key}`}
                        value={targetRuntimeParams[key] ?? ""}
                        onChange={(event) => setTargetRuntimeParams((current) => ({ ...current, [key]: event.target.value }))}
                        placeholder={runtimeParamPlaceholder(key)}
                      />
                    </label>
                  ))
                ) : (
                  <small>这个页面任务不需要运行参数。</small>
                )}
              </div>
            ) : (
              <label>
                <span>目标参数</span>
                <input value={targetRuntimeParamsText} onChange={(event) => setTargetRuntimeParamsText(event.target.value)} placeholder="例如：班级四十二号，也支持 className=班级四十二号" />
              </label>
            )}
            <button className="icon-button primary" type="button" onClick={() => void runTargetPage()} disabled={!selectedSerial || selectedDeviceBusy || !selectedTargetAsset || busy}>
              <PlayCircle size={16} />
              规划并执行
            </button>
          </div>
          {targetText.trim() && filteredAssets.length > 0 ? (
            <div className="target-page-candidate">
              <span>当前候选</span>
              <strong>{selectedTargetAsset?.name ?? filteredAssets[0]?.name}</strong>
              <small>{selectedTargetAsset ? assetIdentitySummary(selectedTargetAsset) : filteredAssets[0] ? assetIdentitySummary(filteredAssets[0]) : ""}</small>
            </div>
          ) : null}
          {targetText.trim() && filteredAssets.length === 0 ? (
            <button className="icon-button" type="button" onClick={onOpenAssetRecording}>
              <DatabaseZap size={16} />
              未找到页面资产，去资产录制
            </button>
          ) : null}
        </div>
      ) : (
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
          <div className="page-assets-count">{pageAssets.length} 个页面资产</div>
          <div className="page-assets-library-layout">
            <PageAssetList
              assets={pageAssets}
              busy={busy}
              emptyText="还没有保存过页面资产。请先进入资产录制页保存当前页面。"
              selectedAssetId={selectedAssetId}
              onSelectAsset={setSelectedAssetId}
              onDeletePageAsset={deletePageAsset}
            />
          </div>
          {selectedLibraryAsset ? <PageAssetDetailDrawer asset={selectedLibraryAsset} onClose={() => setSelectedAssetId(undefined)} /> : null}
        </div>
      )}
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

function PageAssetList({
  assets,
  busy,
  emptyText,
  selectedAssetId,
  onSelectAsset,
  onDeletePageAsset
}: {
  assets: DecoratedPageAsset[];
  busy: boolean;
  emptyText: string;
  selectedAssetId?: string;
  onSelectAsset: (assetId: string) => void;
  onDeletePageAsset: (graphVersionId: string | undefined, assetId: string, assetName: string) => void | Promise<void>;
}) {
  if (!assets.length) {
    return <div className="empty">{emptyText}</div>;
  }
  return (
    <div className="page-assets-list">
      {assets.map((asset) => (
        <article className={asset.id === selectedAssetId ? "page-asset-row selected" : "page-asset-row"} key={asset.id}>
          <button className="page-asset-main" type="button" onClick={() => onSelectAsset(asset.id)}>
            <strong>{asset.name}</strong>
            <span>{assetIdentitySummary(asset)}</span>
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

function PageAssetDetailDrawer({ asset, onClose }: { asset: DecoratedPageAsset; onClose: () => void }) {
  const identityTexts = assetIdentityTexts(asset);
  const screenshotRegions = asset.screenshotRegions ?? [];
  const transitions = asset.transitions ?? [];
  const tasks = asset.tasks ?? [];
  const rawTexts = uniqueStrings([...(asset.visibleTexts ?? []), ...(asset.resourceIds ?? []), ...(asset.accessibilityIds ?? []), ...screenshotRegions.flatMap((region) => region.evidenceTexts ?? [])]);
  return (
    <div className="page-asset-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="page-asset-detail-drawer" aria-label={`页面资产详情：${asset.name}`} onClick={(event) => event.stopPropagation()}>
        <div className="page-asset-detail-head">
          <div>
            <h3>{asset.name}</h3>
            <span>{platformLabel(asset.platformScope)} · {asset.elementCount} 个可操作元素</span>
          </div>
          <button className="icon-button compact" type="button" onClick={onClose} aria-label="关闭资产详情">
            <X size={14} />
          </button>
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

          <details className="page-asset-debug">
            <summary>原始采集与调试信息</summary>
            <code>{asset.key}</code>
            <span>{asset.graphName ?? asset.appId ?? "-"}{asset.graphVersion ? ` · v${asset.graphVersion}` : ""}</span>
            <span>{asset.status}</span>
            {rawTexts.length ? <p>{rawTexts.slice(0, 16).join(" · ")}</p> : null}
          </details>
        </div>
      </aside>
    </div>
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

function tabClass(activeTab: PageAssetsTab, tab: PageAssetsTab): string {
  return activeTab === tab ? "page-assets-tab active" : "page-assets-tab";
}

export function selectPageAssetTarget<T extends PageAssetSummary & { graphVersionId?: string }>(assets: T[], query: string): T | undefined {
  const normalizedQuery = normalizeAssetSearchText(query);
  if (!normalizedQuery) {
    return undefined;
  }
  return (
    assets.find((asset) => normalizeAssetSearchText(asset.name) === normalizedQuery) ??
    assets.find((asset) => normalizeAssetSearchText(asset.key) === normalizedQuery) ??
    assets.find((asset) => searchableAssetTexts(asset).some((value) => normalizeAssetSearchText(value).includes(normalizedQuery))) ??
    assets[0]
  );
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

function searchableAssetTexts(asset: PageAssetSummary & { appId?: string }): string[] {
  return uniqueStrings([
    asset.name,
    asset.key,
    asset.appId,
    ...assetIdentityTexts(asset),
    ...(asset.resourceIds ?? []),
    ...(asset.accessibilityIds ?? [])
  ].filter((text): text is string => Boolean(text)));
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

export function buildTargetPageGraphRunRequest(input: {
  selectedSerial: string;
  graphVersionId: string;
  targetNodeId: string;
  startNodeId?: string;
  overlay?: RuntimeOverlay;
}): {
  deviceSerial: string;
  graphVersionId: string;
  targetNodeId: string;
  startStrategy: "keep_current";
  startNodeId?: string;
  executionProfile: "fast_visual";
  startAppScope: "current_device";
  overlay?: RuntimeOverlay;
} {
  return {
    deviceSerial: input.selectedSerial,
    graphVersionId: input.graphVersionId,
    targetNodeId: input.targetNodeId,
    startStrategy: "keep_current",
    startNodeId: input.startNodeId,
    executionProfile: "fast_visual",
    startAppScope: "current_device",
    overlay: input.overlay
  };
}

export function buildTargetPageRuntimeOverlay(input: {
  targetNodeId: string;
  targetName: string;
  actionMode: TargetActionMode;
  targetTaskId?: string;
  verificationMode: TargetVerificationMode;
  verificationText?: string;
  runtimeParams?: Record<string, string>;
  runtimeParamsText?: string;
}): RuntimeOverlay | undefined {
  const explicitRuntimeParams = nonEmptyRuntimeParams(input.runtimeParams);
  const textRuntimeParams = parseRuntimeParams(input.runtimeParamsText);
  const runtimeParams = explicitRuntimeParams || textRuntimeParams
    ? {
        ...(textRuntimeParams ?? {}),
        ...(explicitRuntimeParams ?? {})
      }
    : undefined;
  const targetTaskId = input.actionMode === "page_task" ? input.targetTaskId?.trim() : undefined;
  if (input.actionMode === "none" && input.verificationMode === "arrived" && !runtimeParams) {
    return undefined;
  }
  const expectedText = input.verificationText?.trim();
  if (input.verificationMode !== "text_contains" || !expectedText) {
    return runtimeParams
      ? {
          id: `target-task-${input.targetNodeId}`,
          targetNodeId: input.targetNodeId,
          ...(targetTaskId ? { targetTaskId } : {}),
          note: `目标页面测试：${input.targetName}`,
          runtimeParams
        }
      : targetTaskId
        ? {
            id: `target-task-${input.targetNodeId}`,
            targetNodeId: input.targetNodeId,
            targetTaskId,
            note: `目标页面测试：${input.targetName}`
          }
        : undefined;
  }
  const overlay: RuntimeOverlay = {
    id: `target-task-${input.targetNodeId}`,
    targetNodeId: input.targetNodeId,
    ...(targetTaskId ? { targetTaskId } : {}),
    note: `目标页面测试：${input.targetName}`,
    ...(runtimeParams ? { runtimeParams } : {}),
    nodeExpectationOverrides: [
      {
        nodeId: input.targetNodeId,
        expectations: [
          {
            id: `target-text-${input.targetNodeId}`,
            type: "text",
            enabled: true,
            title: "目标验证",
            note: "目标页面测试临时验证，不写入页面资产库。",
            params: {
              expected: expectedText,
              mode: "contains",
              lang: "eng+chi_sim"
            },
            createdAt: new Date().toISOString()
          }
        ]
      }
    ]
  };
  return overlay;
}

function normalizeRuntimeParamValues(keys: string[], runtimeParams: Record<string, string>): Record<string, string> | undefined {
  if (!keys.length) {
    return undefined;
  }
  const entries = keys.map((key) => [key, runtimeParams[key]?.trim() ?? ""] as const);
  return Object.fromEntries(entries);
}

function nonEmptyRuntimeParams(runtimeParams: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!runtimeParams) {
    return undefined;
  }
  const entries = Object.entries(runtimeParams)
    .map(([key, value]) => [key.trim(), value.trim()] as const)
    .filter(([key, value]) => key && value);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function runtimeParamLabel(key: string): string {
  const labels: Record<string, string> = {
    className: "班级名",
    lessonName: "课堂标题",
    duration: "课堂时长",
    recordClassroom: "录制ClassIn教室",
    recordLive: "录制现场"
  };
  return labels[key] ?? key;
}

function runtimeParamPlaceholder(key: string): string {
  const placeholders: Record<string, string> = {
    className: "例如：班级四十二号",
    lessonName: "例如：自动化课堂测试",
    duration: "例如：45分钟",
    recordClassroom: "on / off",
    recordLive: "on / off"
  };
  return placeholders[key] ?? `请输入 ${key}`;
}

export function parseRuntimeParams(value: string | undefined): Record<string, string> | undefined {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return undefined;
  }
  const entries = normalized
    .split(/[\n,，;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf("=");
      if (separator < 0) {
        return undefined;
      }
      const key = item.slice(0, separator).trim();
      const paramValue = item.slice(separator + 1).trim();
      return key && paramValue ? [key, paramValue] as const : undefined;
    })
    .filter((item): item is readonly [string, string] => Boolean(item));
  if (entries.length) {
    return Object.fromEntries(entries);
  }
  return { className: normalized };
}

function readTargetActionMode(value: string): TargetActionMode {
  return value === "page_task" ? value : "none";
}

function readTargetVerificationMode(value: string): TargetVerificationMode {
  return value === "text_contains" ? value : "arrived";
}

function normalizeAssetSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function targetPageRouteBlockingMessage(routePreview: RoutePlanPreviewResponse, targetName: string): string | undefined {
  const blockingIssue = routePreview.executionPlan?.unresolvedIssues?.find((issue) => issue.severity === "error");
  if (!blockingIssue) {
    return undefined;
  }
  const startNodeName = routePreview.startDetection?.nodeMatch?.node?.name ?? routePreview.startDetection?.startNodeId ?? "当前页面";
  if (blockingIssue.code === "TARGET_NODE_UNREACHABLE") {
    return `已找到目标页面：${targetName}，但当前识别到的页面“${startNodeName}”还没有到该目标的已保存连接边。请先在资产录制里把当前页的可操作元素连接到目标页面。`;
  }
  return `目标页面路径规划存在阻断：${blockingIssue.message ?? blockingIssue.code ?? "未知错误"}`;
}
