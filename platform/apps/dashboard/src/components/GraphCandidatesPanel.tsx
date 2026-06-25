import { FolderOpen, GitBranch, Import, PlayCircle, Search, Wand2 } from "lucide-react";
import { Children, useEffect, useState, type ReactNode } from "react";
import type { TestRun } from "@mobile-automation/shared";
import { apiFetchJson } from "../api";

type SourceMatcher = {
  id: string;
  type: string;
  value: string;
  weight: number;
};

type CandidateNode = {
  id: string;
  key: string;
  name: string;
  nodeType: string;
  confidence: number;
  matchers: SourceMatcher[];
  source: {
    filePath?: string;
    line?: number;
    confidence?: number;
  };
};

type CandidateEdge = {
  id: string;
  key: string;
  name: string;
  intent: string;
  fromNodeKey?: string;
  toNodeKey?: string;
  confidence: number;
  source: {
    filePath?: string;
    line?: number;
    confidence?: number;
  };
};

type SourceScanResult = {
  appId: string;
  repoPath: string;
  scannedAt: string;
  summary: {
    scannedFiles: number;
    manifestFiles: number;
    navigationFiles: number;
    layoutFiles: number;
    stringFiles: number;
    sourceFiles: number;
  };
  nodes: CandidateNode[];
  edges: CandidateEdge[];
  warnings: Array<{ code: string; message: string; filePath?: string; line?: number }>;
};

type BusinessGraph = {
  id: string;
  appId: string;
  name: string;
  status: string;
  targetApp?: {
    androidPackageName?: string;
    iosBundleId?: string;
  };
  activeVersionId?: string;
  activeVersion?: {
    id: string;
    version: number;
    nodes: Array<{ id: string; key: string; name: string; nodeType: string }>;
    edges: Array<{ id: string; key: string; name: string; fromNodeId: string; toNodeId: string }>;
  };
};

type GraphNodeSummary = { id: string; key: string; name: string; nodeType: string };

type GraphListResponse = {
  graphs: BusinessGraph[];
};

type ExecutionPlanStep = {
  id: string;
  order: number;
  name: string;
  fromNode: { name: string; key: string };
  toNode: { name: string; key: string };
  action?: { type: string; title?: string; params?: Record<string, unknown> };
  preconditions: Array<{ id: string; type: string; title?: string; params: Record<string, unknown> }>;
  expectations: Array<{ id: string; type: string; title?: string; params: Record<string, unknown> }>;
  issues: Array<{ code: string; message: string; severity: string }>;
};

type RoutePlanResponse = {
  routePlan?: {
    id: string;
    startNodeId?: string;
    targetNodeId: string;
    nodes: Array<{ id: string; key: string; name: string }>;
    edges: Array<{ order: number; edge: { id: string; key: string; name: string } }>;
    assumptions: string[];
    unresolvedIssues: Array<{ code: string; message: string; severity: string }>;
  };
  executionPlan: {
    steps: ExecutionPlanStep[];
    unresolvedIssues: Array<{ code: string; message: string; severity: string }>;
  };
  targetResolution?: {
    status: "resolved" | "ambiguous" | "not_found";
    targetNode?: { id: string; key: string; name: string };
    candidates: Array<{ node: { id: string; key: string; name: string }; score: number; matchedBy: string[]; reasons: string[] }>;
    message?: string;
  };
  startDetection?: {
    source: "device_observation" | "request_start_node" | "default";
    startNodeId?: string;
    inTargetApp?: boolean;
    nodeMatch?: {
      status: "matched" | "multiple_candidates" | "unknown";
      score: number;
      node?: { id: string; key: string; name: string };
      candidates?: Array<{ node: { id: string; key: string; name: string }; score: number }>;
    };
    observation?: {
      packageName?: string;
      activityName?: string;
      componentName?: string;
      uiElementCount?: number;
      ocrTextCount?: number;
    };
  };
};

type ImportResult = {
  graph: {
    id: string;
    name: string;
  };
  version: {
    id: string;
    version: number;
  };
  importedNodeCount: number;
  importedEdgeCount: number;
  skippedEdgeCount: number;
};

type ScanResponse = {
  result: SourceScanResult;
};

type ImportResponse = {
  result: SourceScanResult;
  imported: ImportResult;
};

type GraphRunResponse = {
  run: TestRun;
  routePlanId: string;
  executionPlanId: string;
  graphVersionId: string;
  targetNodeId: string;
};

type GraphQualitySummary = {
  graphVersionId: string;
  analyzedRunCount: number;
  nodes: Array<{
    nodeId: string;
    nodeName?: string;
    runCount: number;
    passedCount: number;
    failedCount: number;
    passRate: number;
    latestRunId?: string;
    latestStatus?: TestRun["status"];
    latestReportUrl?: string;
    latestFailureMessage?: string;
    recoveryAttemptCount?: number;
    recoveredRunCount?: number;
  }>;
  edges: Array<{
    edgeId: string;
    edgeKey?: string;
    toNodeId?: string;
    toNodeName?: string;
    runCount: number;
    passedCount: number;
    failedCount: number;
    passRate: number;
    latestRunId?: string;
    latestStatus?: TestRun["status"];
    latestReportUrl?: string;
    latestFailureMessage?: string;
    recoveryAttemptCount?: number;
    recoveredRunCount?: number;
  }>;
};

type GraphQualityResponse = {
  quality: GraphQualitySummary;
};

type GraphAssetGovernanceSummary = {
  graphVersionId: string;
  runtimeDraftNodes: Array<{
    id: string;
    key: string;
    name: string;
    status: string;
    tags: string[];
    observationCount: number;
    firstObservedAt?: string;
    lastObservedAt?: string;
    visibleTexts: string[];
    resourceIds: string[];
    accessibilityIds: string[];
    artifactIds: string[];
  }>;
  explorationDraftEdges: Array<{
    id: string;
    key: string;
    name: string;
    status: string;
    source: string;
    fromNodeId: string;
    fromNodeName?: string;
    toNodeId: string;
    toNodeName?: string;
    suggestedAction?: string;
    reliabilityScore?: number;
    artifactIds: string[];
  }>;
  routeGapArtifacts: Array<{
    id: string;
    runId?: string;
    graphVersionId: string;
    name: string;
    url: string;
    createdAt: string;
  }>;
};

type GraphAssetsResponse = {
  assets: GraphAssetGovernanceSummary;
};

type GraphAssetsMutationResponse = {
  assets: GraphAssetGovernanceSummary;
  promoted?: {
    nodeIds: string[];
    edgeIds: string[];
  };
};

type CurrentPageResult = {
  status: "matched" | "draft_created" | "draft_reused";
  match: {
    status: string;
    score: number;
    node?: { id: string; key: string; name: string };
  };
  node?: {
    id: string;
    key: string;
    name: string;
    status: string;
  };
  observation?: {
    packageName?: string;
    activityName?: string;
    uiElements?: unknown[];
    ocrTexts?: unknown[];
  };
};

type CurrentPageResponse = {
  result: CurrentPageResult;
  assets: GraphAssetGovernanceSummary;
};

type SourceScanRootsResponse = {
  roots: Array<{ label: string; path: string }>;
  defaults: {
    maxFiles: number;
    maxAllowedFiles: number;
  };
};

type GraphCandidatesPanelProps = {
  setMessage: (message: string) => void;
  selectedSerial?: string;
  selectedDeviceBusy?: boolean;
  onRunStarted?: (runId: string) => void;
};

type PickDirectoryResponse = {
  path?: string;
  cancelled?: boolean;
};

type GraphPanelTab = "nodeTest" | "graphs" | "assets";

export function GraphCandidatesPanel({ setMessage, selectedSerial = "", selectedDeviceBusy = false, onRunStarted }: GraphCandidatesPanelProps) {
  const [appId, setAppId] = useState("classin-android");
  const [repoPath, setRepoPath] = useState("");
  const [maxFiles, setMaxFiles] = useState(20000);
  const [maxAllowedFiles, setMaxAllowedFiles] = useState(100000);
  const [pathBusy, setPathBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SourceScanResult | undefined>();
  const [imported, setImported] = useState<ImportResult | undefined>();
  const [graphs, setGraphs] = useState<BusinessGraph[]>([]);
  const [routePreview, setRoutePreview] = useState<RoutePlanResponse | undefined>();
  const [routeBusy, setRouteBusy] = useState(false);
  const [graphRunBusy, setGraphRunBusy] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState<Record<string, string>>({});
  const [quickGraphId, setQuickGraphId] = useState("");
  const [quickTargetText, setQuickTargetText] = useState("");
  const [activeTab, setActiveTab] = useState<GraphPanelTab>("nodeTest");
  const [lastGraphRun, setLastGraphRun] = useState<GraphRunResponse | undefined>();
  const [qualityByVersionId, setQualityByVersionId] = useState<Record<string, GraphQualitySummary>>({});
  const [assetsByVersionId, setAssetsByVersionId] = useState<Record<string, GraphAssetGovernanceSummary>>({});
  const [currentPageByVersionId, setCurrentPageByVersionId] = useState<Record<string, CurrentPageResult>>({});

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<SourceScanRootsResponse>("/api/source-scan/roots")
      .then((response) => {
        if (cancelled) {
          return;
        }
        setMaxFiles(response.defaults.maxFiles);
        setMaxAllowedFiles(response.defaults.maxAllowedFiles);
        if (!repoPath && response.roots[0]?.path) {
          setRepoPath(response.roots[0].path);
        }
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
    refreshGraphs();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshGraphs() {
    try {
      const response = await apiFetchJson<GraphListResponse>("/api/graphs");
      setGraphs(response.graphs);
      const visibleGraphs = visibleBusinessGraphs(response.graphs);
      void refreshGraphQuality(visibleGraphs);
      void refreshGraphAssets(visibleGraphs);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshGraphQuality(nextGraphs: BusinessGraph[]) {
    const versionIds = nextGraphs.map((graph) => graph.activeVersion?.id).filter((id): id is string => Boolean(id));
    if (versionIds.length === 0) {
      setQualityByVersionId({});
      return;
    }
    try {
      const summaries = await Promise.all(
        versionIds.map(async (versionId) => {
          const response = await apiFetchJson<GraphQualityResponse>(`/api/graphs/${versionId}/quality?limit=120`);
          return response.quality;
        })
      );
      setQualityByVersionId(Object.fromEntries(summaries.map((summary) => [summary.graphVersionId, summary])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshGraphAssets(nextGraphs: BusinessGraph[]) {
    const versionIds = nextGraphs.map((graph) => graph.activeVersion?.id).filter((id): id is string => Boolean(id));
    if (versionIds.length === 0) {
      setAssetsByVersionId({});
      return;
    }
    try {
      const summaries = await Promise.all(
        versionIds.map(async (versionId) => {
          const response = await apiFetchJson<GraphAssetsResponse>(`/api/graphs/${versionId}/assets?limit=120`);
          return response.assets;
        })
      );
      setAssetsByVersionId(Object.fromEntries(summaries.map((summary) => [summary.graphVersionId, summary])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function promoteGraphAssetNode(graphVersionId: string, nodeId: string) {
    try {
      const response = await apiFetchJson<GraphAssetsMutationResponse>(`/api/graphs/${graphVersionId}/assets/nodes/${nodeId}/promote`, {
        method: "POST"
      });
      setAssetsByVersionId((current) => ({ ...current, [response.assets.graphVersionId]: response.assets }));
      setMessage("已晋级草稿节点，后续路径规划会使用 active 节点。");
      await refreshGraphs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function promoteGraphAssetEdge(graphVersionId: string, edgeId: string) {
    try {
      const response = await apiFetchJson<GraphAssetsMutationResponse>(`/api/graphs/${graphVersionId}/assets/edges/${edgeId}/promote`, {
        method: "POST"
      });
      setAssetsByVersionId((current) => ({ ...current, [response.assets.graphVersionId]: response.assets }));
      setMessage("已晋级草稿边，后续 RoutePlanner 会把它纳入路径计算。");
      await refreshGraphs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function autoPromoteGraphAssets(graphVersionId: string) {
    try {
      const response = await apiFetchJson<GraphAssetsMutationResponse>(`/api/graphs/${graphVersionId}/assets/auto-promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minRuntimeObservationCount: 2,
          minExplorationReliabilityScore: 0.75
        })
      });
      setAssetsByVersionId((current) => ({ ...current, [response.assets.graphVersionId]: response.assets }));
      const nodeCount = response.promoted?.nodeIds.length ?? 0;
      const edgeCount = response.promoted?.edgeIds.length ?? 0;
      setMessage(`自动晋级完成：${nodeCount} 个节点，${edgeCount} 条边。`);
      await refreshGraphs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function identifyCurrentPage(graphVersionId: string) {
    if (!selectedSerial) {
      setMessage("请先选择设备，再识别当前页面。");
      return;
    }
    try {
      const response = await apiFetchJson<CurrentPageResponse>(`/api/graphs/${graphVersionId}/current-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceSerial: selectedSerial,
          includeOcr: true
        })
      });
      setAssetsByVersionId((current) => ({ ...current, [response.assets.graphVersionId]: response.assets }));
      setCurrentPageByVersionId((current) => ({ ...current, [response.assets.graphVersionId]: response.result }));
      if (response.result.status === "matched") {
        setMessage(`当前页面已匹配：${response.result.match.node?.name ?? response.result.match.status}`);
      } else {
        setMessage(`当前页面已沉淀为草稿节点：${response.result.node?.name ?? response.result.status}`);
      }
      await refreshGraphs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function selectRepoPath(pathValue: string) {
    setRepoPath(pathValue);
    setResult(undefined);
    setImported(undefined);
  }

  async function pickDirectory() {
    setPathBusy(true);
    try {
      const response = await apiFetchJson<PickDirectoryResponse>("/api/source-scan/pick-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initialPath: repoPath.trim() })
      });
      if (response.cancelled) {
        setMessage("已取消选择源码目录");
        return;
      }
      if (response.path) {
        selectRepoPath(response.path);
        setMessage(`已选择源码目录：${response.path}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPathBusy(false);
    }
  }

  async function scanSource() {
    if (!appId.trim() || !repoPath.trim()) {
      setMessage("请填写 App ID 和源码路径");
      return;
    }
    setBusy(true);
    setImported(undefined);
    try {
      const response = await apiFetchJson<ScanResponse>("/api/source-scan/android", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId: appId.trim(),
          repoPath: repoPath.trim(),
          maxFiles: normalizedMaxFiles(maxFiles, maxAllowedFiles)
        })
      });
      setResult(response.result);
      setMessage(`扫描完成：${response.result.nodes.length} 个候选节点，${response.result.edges.length} 条候选边`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function importDraftGraph() {
    if (!appId.trim() || !repoPath.trim()) {
      setMessage("请填写 App ID 和源码路径");
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetchJson<ImportResponse>("/api/source-scan/android/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId: appId.trim(),
          repoPath: repoPath.trim(),
          maxFiles: normalizedMaxFiles(maxFiles, maxAllowedFiles),
          name: `${appId.trim()} 业务图谱`
        })
      });
      setResult(response.result);
      setImported(response.imported);
      setMessage(`已导入候选池：${response.imported.importedNodeCount} 个节点，${response.imported.importedEdgeCount} 条边`);
      await refreshGraphs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function previewRoute(graph: BusinessGraph) {
    if (!graph.activeVersion?.id) {
      setMessage("该图谱没有 active version，无法规划路径");
      return;
    }
    const targetNodeId = selectedTargetNodeId(graph);
    if (!targetNodeId) {
      setMessage("请先选择目标节点");
      return;
    }
    setRouteBusy(true);
    try {
      const response = await apiFetchJson<RoutePlanResponse>(`/api/graphs/${graph.activeVersion.id}/route-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "android",
          targetNodeId,
          deviceSerial: selectedSerial || undefined,
          persist: false
        })
      });
      setRoutePreview(response);
      const blockingIssue = response.executionPlan.unresolvedIssues.find((issue) => issue.severity === "error");
      setMessage(blockingIssue ? `路径规划存在阻断：${blockingIssue.message}` : previewMessage(response, `已生成 ${response.executionPlan.steps.length} 步执行计划`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRouteBusy(false);
    }
  }

  async function previewQuickTarget() {
    const graph = selectedQuickGraph();
    if (!graph) {
      setMessage("请先选择一个 active 业务图谱");
      return;
    }
    const target = quickTargetText.trim();
    if (!target) {
      setMessage("请输入目标节点名称、key、页面文案或动作意图");
      return;
    }
    await previewRouteByTargetQuery(graph, target);
  }

  async function previewRouteByTargetQuery(graph: BusinessGraph, targetText: string) {
    if (!graph.activeVersion?.id) {
      setMessage("该图谱没有 active version，无法规划路径");
      return;
    }
    setRouteBusy(true);
    try {
      const response = await apiFetchJson<RoutePlanResponse>(`/api/graphs/${graph.activeVersion.id}/route-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "android",
          target: buildTargetQuery(targetText),
          deviceSerial: selectedSerial || undefined,
          persist: false
        })
      });
      setRoutePreview(response);
      const targetNode = response.targetResolution?.targetNode;
      const blockingIssue = response.executionPlan.unresolvedIssues.find((issue) => issue.severity === "error");
      setMessage(blockingIssue ? `路径规划存在阻断：${blockingIssue.message}` : previewMessage(response, `已规划到 ${targetNode?.name ?? targetText}，共 ${response.executionPlan.steps.length} 步`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRouteBusy(false);
    }
  }

  async function runTargetNode(graph: BusinessGraph) {
    if (!selectedSerial) {
      setMessage("请先选择设备");
      return;
    }
    if (selectedDeviceBusy) {
      setMessage("当前设备正在执行任务，请等待结束后再启动图谱执行");
      return;
    }
    const targetNodeId = selectedTargetNodeId(graph);
    if (!targetNodeId) {
      setMessage("请先选择目标节点");
      return;
    }
    setGraphRunBusy(true);
    try {
      const response = await apiFetchJson<GraphRunResponse>("/api/graph-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceSerial: selectedSerial,
          graphId: graph.id,
          targetNodeId,
          startStrategy: "keep_current"
        })
      });
      setLastGraphRun(response);
      setMessage(`已启动目标节点执行：${response.run.id}`);
      onRunStarted?.(response.run.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setGraphRunBusy(false);
    }
  }

  async function runQuickTarget() {
    const graph = selectedQuickGraph();
    if (!graph) {
      setMessage("请先选择一个 active 业务图谱");
      return;
    }
    if (!selectedSerial) {
      setMessage("请先选择设备");
      return;
    }
    if (selectedDeviceBusy) {
      setMessage("当前设备正在执行任务，请等待结束后再启动图谱执行");
      return;
    }
    const target = quickTargetText.trim();
    if (!target) {
      setMessage("请输入目标节点名称、key、页面文案或动作意图");
      return;
    }
    setGraphRunBusy(true);
    try {
      const response = await apiFetchJson<GraphRunResponse>("/api/graph-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceSerial: selectedSerial,
          graphId: graph.id,
          target: buildTargetQuery(target),
          startStrategy: "keep_current"
        })
      });
      setLastGraphRun(response);
      setMessage(`已启动目标节点执行：${response.run.id}`);
      onRunStarted?.(response.run.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setGraphRunBusy(false);
    }
  }

  function selectedQuickGraph(): BusinessGraph | undefined {
    const activeGraphs = visibleBusinessGraphs(graphs);
    return activeGraphs.find((graph) => graph.id === quickGraphId) ?? activeGraphs[0];
  }

  function selectedTargetNodeId(graph: BusinessGraph): string {
    const nodes = executableTargetNodes(graph);
    return selectedTargets[graph.id] || nodes.find((node) => node.key === "classin.teacher.lesson.create")?.id || nodes[0]?.id || "";
  }

  function updateSelectedTarget(graph: BusinessGraph, nodeId: string) {
    setSelectedTargets((current) => ({
      ...current,
      [graph.id]: nodeId
    }));
    setRoutePreview(undefined);
    setLastGraphRun(undefined);
  }

  return (
    <section className="module-page graph-module">
      <div className="graph-tabbar" role="tablist" aria-label="业务图谱模块">
        <button className={graphTabClass(activeTab, "nodeTest")} type="button" role="tab" aria-selected={activeTab === "nodeTest"} onClick={() => setActiveTab("nodeTest")}>
          目标节点测试
        </button>
        <button className={graphTabClass(activeTab, "graphs")} type="button" role="tab" aria-selected={activeTab === "graphs"} onClick={() => setActiveTab("graphs")}>
          图谱信息
        </button>
        <button className={graphTabClass(activeTab, "assets")} type="button" role="tab" aria-selected={activeTab === "assets"} onClick={() => setActiveTab("assets")}>
          候选资产
        </button>
      </div>

      {activeTab === "nodeTest" && (
        <>
          <div className="panel graph-quick-run-panel">
            <div className="graph-quick-heading">
              <strong>输入目标后每次运行都会重新识别当前位置、规划路径并执行</strong>
            </div>
            <div className="graph-quick-form">
              <label>
                <span>业务图谱</span>
                <select value={selectedQuickGraph()?.id ?? ""} onChange={(event) => setQuickGraphId(event.target.value)}>
                  {visibleBusinessGraphs(graphs).map((graph) => (
                    <option key={graph.id} value={graph.id}>
                      {graph.name} · v{graph.activeVersion?.version}
                    </option>
                  ))}
                </select>
              </label>
              <label className="graph-quick-target">
                <span>目标节点</span>
                <input
                  value={quickTargetText}
                  onChange={(event) => {
                    setQuickTargetText(event.target.value);
                    setRoutePreview(undefined);
                    setLastGraphRun(undefined);
                  }}
                  placeholder="例如：新建课堂页 / classin.teacher.lesson.create / 课堂"
                />
              </label>
              <div className="graph-quick-actions">
                <button className="icon-button" type="button" onClick={previewQuickTarget} disabled={routeBusy || !selectedQuickGraph()}>
                  <Wand2 size={16} />
                  确认并规划
                </button>
                <button className="icon-button primary" type="button" onClick={runQuickTarget} disabled={graphRunBusy || !selectedQuickGraph() || !selectedSerial || selectedDeviceBusy}>
                  <PlayCircle size={16} />
                  规划并执行
                </button>
              </div>
            </div>
            <div className="graph-quick-hints">
              <span>{selectedSerial ? `当前设备：${selectedSerial}` : "执行前需要先选择设备"}</span>
              <span>{selectedDeviceBusy ? "设备正在执行任务" : "执行会复用设备锁、视频、截图、异常采集和 HTML 报告"}</span>
            </div>
          </div>

          {routePreview && <GraphRoutePreview response={routePreview} />}

          {lastGraphRun && (
            <div className="panel graph-import-result">
              <PlayCircle size={18} />
              <div>
                <strong>目标节点执行已启动</strong>
                <span>
                  Run {lastGraphRun.run.id} · Route {lastGraphRun.routePlanId} · Target {lastGraphRun.targetNodeId}
                </span>
              </div>
              <a className="icon-button" href={`/api/reports/${lastGraphRun.run.id}/html`} target="_blank" rel="noreferrer">
                报告
              </a>
            </div>
          )}
        </>
      )}

      {activeTab === "graphs" && (
        <GraphRegisteredListView
          graphs={graphs}
          onRefresh={refreshGraphs}
          selectedTargetNodeId={selectedTargetNodeId}
          updateSelectedTarget={updateSelectedTarget}
          qualityByVersionId={qualityByVersionId}
        />
      )}

      {activeTab === "assets" && (
        <>
          <GraphAssetGovernanceView
            graphs={graphs}
            assetsByVersionId={assetsByVersionId}
            onRefresh={refreshGraphs}
            onPromoteNode={promoteGraphAssetNode}
            onPromoteEdge={promoteGraphAssetEdge}
            onAutoPromote={autoPromoteGraphAssets}
            onIdentifyCurrentPage={identifyCurrentPage}
            currentPageByVersionId={currentPageByVersionId}
          />

          <div className="panel graph-scan-panel">
            <div className="graph-workflow-steps" aria-label="源码扫描工作流">
              <span>1 选择源码</span>
              <span>2 扫描候选</span>
              <span>3 导入候选池</span>
              <span>4 自动验证入图</span>
            </div>
            <div className="graph-scan-fields">
              <label>
                <span>App ID</span>
                <input value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="classin-android" />
              </label>
              <label className="graph-path-field">
                <span>源码路径</span>
                <div className="graph-path-input-row">
                  <input
                    value={repoPath}
                    onChange={(event) => {
                      setRepoPath(event.target.value);
                      setResult(undefined);
                      setImported(undefined);
                    }}
                    placeholder="/Users/eeo/StudioProject_classin"
                  />
                  <button className="icon-button graph-browse-button" type="button" onClick={pickDirectory} disabled={pathBusy}>
                    <FolderOpen size={16} />
                    {pathBusy ? "选择中" : "选择目录"}
                  </button>
                </div>
              </label>
              <label className="graph-max-files-field" title="扫描上限用于防止误选超大目录卡死；只统计命中的 Android 相关源码 / XML 文件。">
                <span>扫描上限</span>
                <input
                  type="number"
                  min={100}
                  max={maxAllowedFiles}
                  step={500}
                  value={maxFiles}
                  onChange={(event) => setMaxFiles(normalizedMaxFiles(Number(event.target.value), maxAllowedFiles))}
                />
              </label>
              <div className="graph-actions">
                <button className="icon-button primary" type="button" onClick={scanSource} disabled={busy}>
                  <Search size={16} />
                  扫描预览
                </button>
                <button className="icon-button" type="button" onClick={importDraftGraph} disabled={busy || !result}>
                  <Import size={16} />
                  导入候选池
                </button>
              </div>
            </div>

            <p className="graph-native-picker-note">
              本机使用时直接点“选择目录”选 App 源码根目录；部署到远程服务器时，也可以手动填写服务器上的源码路径。当前扫描器为 Android
              MVP，iOS 源码扫描将复用同一候选模型接入 Info.plist、Storyboard / XIB、SwiftUI / UIKit 路由和 accessibilityIdentifier。
            </p>
          </div>

          {imported && (
            <div className="panel graph-import-result">
              <GitBranch size={18} />
              <div>
                <strong>已保存到候选池，当前不会自动参与正式测试执行</strong>
                <span>
                  已导入 {imported.importedNodeCount} 个候选节点、{imported.importedEdgeCount} 条可解析候选边；跳过 {imported.skippedEdgeCount} 条缺少起点或终点的边。后续会通过真机路径验证、稳定性评分和去重合并决定是否晋级为正式图谱资产。
                </span>
              </div>
            </div>
          )}

          {result ? (
            <GraphScanResultView result={result} />
          ) : (
            <div className="panel graph-empty">选择或填写源码路径后扫描，候选节点和边会在这里预览。</div>
          )}
        </>
      )}
    </section>
  );
}

function executableTargetNodes(graph: BusinessGraph): GraphNodeSummary[] {
  return (graph.activeVersion?.nodes ?? []).filter((node) => node.nodeType !== "root");
}

function visibleBusinessGraphs(graphs: BusinessGraph[]): BusinessGraph[] {
  return graphs.filter((graph) => graph.status !== "deprecated" && Boolean(graph.activeVersion?.id));
}

function buildTargetQuery(value: string) {
  return {
    key: value,
    name: value,
    text: value,
    intent: value,
    maxCandidates: 8
  };
}

function previewMessage(response: RoutePlanResponse, fallback: string): string {
  const matched = response.startDetection?.nodeMatch?.node;
  if (response.startDetection?.source === "device_observation") {
    return matched ? `${fallback}；当前识别为 ${matched.name}` : `${fallback}；当前设备未识别到 active 起点`;
  }
  return fallback;
}

function graphTabClass(activeTab: GraphPanelTab, tab: GraphPanelTab): string {
  return activeTab === tab ? "graph-tab active" : "graph-tab";
}

export function GraphRegisteredListView({
  graphs,
  onRefresh,
  selectedTargetNodeId,
  updateSelectedTarget,
  qualityByVersionId
}: {
  graphs: BusinessGraph[];
  onRefresh?: () => void;
  selectedTargetNodeId: (graph: BusinessGraph) => string;
  updateSelectedTarget: (graph: BusinessGraph, nodeId: string) => void;
  qualityByVersionId: Record<string, GraphQualitySummary>;
}) {
  const visibleGraphs = visibleBusinessGraphs(graphs);
  return (
    <div className="panel graph-active-panel">
      <div className="panel-head">
        <div>
          <h2>已注册业务图谱</h2>
          <p>这里展示 App 级业务图谱的节点、边、目标质量和版本信息；目标执行入口在“节点测试”。</p>
        </div>
        {onRefresh && (
          <button className="icon-button" type="button" onClick={onRefresh}>
            刷新
          </button>
        )}
      </div>
      <div className="graph-active-list">
        {visibleGraphs.length === 0 ? (
          <div className="graph-empty-inline">暂无业务图谱。内置图谱会在服务启动时自动创建。</div>
        ) : (
          visibleGraphs.map((graph) => <GraphRegisteredRow key={graph.id} graph={graph} selectedTargetNodeId={selectedTargetNodeId} updateSelectedTarget={updateSelectedTarget} qualityByVersionId={qualityByVersionId} />)
        )}
      </div>
    </div>
  );
}

function GraphRegisteredRow({
  graph,
  selectedTargetNodeId,
  updateSelectedTarget,
  qualityByVersionId
}: {
  graph: BusinessGraph;
  selectedTargetNodeId: (graph: BusinessGraph) => string;
  updateSelectedTarget: (graph: BusinessGraph, nodeId: string) => void;
  qualityByVersionId: Record<string, GraphQualitySummary>;
}) {
  const nodes = graph.activeVersion?.nodes ?? [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.activeVersion?.edges ?? [];
  return (
    <article className="graph-active-row">
      <div>
        <strong>{graph.name}</strong>
        <span>
          {graph.appId}
          {graph.targetApp?.androidPackageName ? ` · ${graph.targetApp.androidPackageName}` : ""}
        </span>
      </div>
      <div className="graph-badges">
        <span>{graph.status}</span>
        <span>v{graph.activeVersion?.version ?? "-"}</span>
        <span>{nodes.length} 节点</span>
        <span>{edges.length} 边</span>
      </div>
      <div className="graph-info-target">
        <label>
          <span>质量目标节点</span>
          <select value={selectedTargetNodeId(graph)} onChange={(event) => updateSelectedTarget(graph, event.target.value)} disabled={!graph.activeVersion}>
            {executableTargetNodes(graph).map((node) => (
              <option key={node.id} value={node.id}>
                {node.name} · {node.key}
              </option>
            ))}
          </select>
        </label>
      </div>
      <GraphStructurePreview graph={graph} nodesById={nodesById} />
      <GraphTargetQuality graph={graph} targetNodeId={selectedTargetNodeId(graph)} quality={graph.activeVersion?.id ? qualityByVersionId[graph.activeVersion.id] : undefined} />
    </article>
  );
}

function GraphStructurePreview({ graph, nodesById }: { graph: BusinessGraph; nodesById: Map<string, GraphNodeSummary> }) {
  const nodes = graph.activeVersion?.nodes ?? [];
  const edges = graph.activeVersion?.edges ?? [];
  return (
    <div className="graph-structure-preview">
      <section>
        <strong>图谱节点</strong>
        <div className="graph-chip-list">
          {nodes.slice(0, 12).map((node) => (
            <span key={node.id}>
              {node.name} · {node.key}
            </span>
          ))}
          {nodes.length > 12 && <span>还有 {nodes.length - 12} 个节点</span>}
        </div>
      </section>
      <section>
        <strong>图谱边</strong>
        <div className="graph-edge-list">
          {edges.slice(0, 12).map((edge) => {
            const fromNode = nodesById.get(edge.fromNodeId);
            const toNode = nodesById.get(edge.toNodeId);
            return (
              <span key={edge.id}>
                {fromNode?.name ?? edge.fromNodeId} {"->"} {toNode?.name ?? edge.toNodeId} · {edge.key}
              </span>
            );
          })}
          {edges.length > 12 && <span>还有 {edges.length - 12} 条边</span>}
        </div>
      </section>
    </div>
  );
}

export function GraphTargetQuality({ graph, targetNodeId, quality }: { graph: BusinessGraph; targetNodeId: string; quality?: GraphQualitySummary }) {
  if (!graph.activeVersion || !targetNodeId) {
    return null;
  }
  const nodeQuality = quality?.nodes.find((node) => node.nodeId === targetNodeId);
  const incomingEdges = quality?.edges.filter((edge) => edge.toNodeId === targetNodeId) ?? [];
  const latestFailedEdge = incomingEdges.find((edge) => edge.failedCount > 0 && edge.latestFailureMessage);
  const recoveryAttemptCount = nodeQuality?.recoveryAttemptCount ?? 0;
  const recoveredRunCount = nodeQuality?.recoveredRunCount ?? 0;

  if (!nodeQuality) {
    return (
      <div className="graph-target-quality muted">
        <span>该目标暂无历史执行数据</span>
        <span>首次执行后会沉淀节点和路径稳定性</span>
      </div>
    );
  }

  return (
    <div className={`graph-target-quality ${nodeQuality.failedCount > 0 ? "warning" : "success"}`}>
      <div>
        <strong>{formatPercent(nodeQuality.passRate)}</strong>
        <span>
          最近 {nodeQuality.runCount} 次 · 通过 {nodeQuality.passedCount} · 失败 {nodeQuality.failedCount}
          {recoveryAttemptCount > 0 ? ` · 恢复成功 ${recoveredRunCount}/${recoveryAttemptCount}` : ""}
        </span>
      </div>
      <div>
        <span>{latestFailedEdge?.latestFailureMessage ?? `最近状态：${nodeQuality.latestStatus ?? "unknown"}`}</span>
        {nodeQuality.latestReportUrl && (
          <a href={nodeQuality.latestReportUrl} target="_blank" rel="noreferrer">
            查看最近报告
          </a>
        )}
      </div>
    </div>
  );
}

function normalizedMaxFiles(value: number, maxAllowedFiles: number): number {
  if (!Number.isFinite(value)) {
    return 20000;
  }
  return Math.min(maxAllowedFiles, Math.max(100, Math.round(value)));
}

export function GraphRoutePreview({ response }: { response: RoutePlanResponse }) {
  const startNode = response.startDetection?.nodeMatch?.node;
  const observation = response.startDetection?.observation;
  return (
    <div className="panel graph-route-preview">
      <div className="panel-head">
        <h2>执行计划预览</h2>
        <span>{response.executionPlan.steps.length} 步</span>
      </div>
      {response.startDetection && (
        <div className="graph-route-start">
          <span>
            起点来源：
            {response.startDetection.source === "device_observation" ? "当前设备识别" : response.startDetection.source === "request_start_node" ? "指定起点" : "默认起点"}
          </span>
          <span>
            当前节点：
            {startNode ? `${startNode.name} (${startNode.key})` : response.startDetection.nodeMatch ? `未匹配 active 节点（${response.startDetection.nodeMatch.status}）` : "未指定"}
          </span>
          {observation && (
            <span>
              前台：
              {observation.packageName || "未知"}
              {observation.activityName ? ` / ${observation.activityName}` : ""}
            </span>
          )}
        </div>
      )}
      {response.executionPlan.unresolvedIssues.length > 0 && (
        <div className="graph-route-issues">
          {response.executionPlan.unresolvedIssues.map((issue) => (
            <span key={`${issue.code}-${issue.message}`} className={issue.severity === "error" ? "danger" : ""}>
              {issue.code}: {issue.message}
            </span>
          ))}
        </div>
      )}
      <div className="graph-route-step-list graph-route-scroll-region">
        {response.executionPlan.steps.map((step) => (
          <article key={step.id} className="graph-route-step">
            <div className="graph-route-step-main">
              <b>{step.order}</b>
              <div>
                <strong>{step.name}</strong>
                <span>
                  {step.fromNode.name} {"->"} {step.toNode.name}
                </span>
              </div>
              <code>{step.action?.type ?? "blocked"}</code>
            </div>
            <div className="graph-route-expectations">
              <span>前置：{step.preconditions.map(formatExpectation).join("；") || "无"}</span>
              <span>后置：{step.expectations.map(formatExpectation).join("；") || "无"}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function GraphAssetGovernanceView({
  graphs,
  assetsByVersionId,
  onRefresh,
  onPromoteNode,
  onPromoteEdge,
  onAutoPromote,
  onIdentifyCurrentPage,
  currentPageByVersionId
}: {
  graphs: BusinessGraph[];
  assetsByVersionId: Record<string, GraphAssetGovernanceSummary>;
  onRefresh: () => void;
  onPromoteNode: (graphVersionId: string, nodeId: string) => void;
  onPromoteEdge: (graphVersionId: string, edgeId: string) => void;
  onAutoPromote: (graphVersionId: string) => void;
  onIdentifyCurrentPage: (graphVersionId: string) => void;
  currentPageByVersionId: Record<string, CurrentPageResult>;
}) {
  const activeGraphs = visibleBusinessGraphs(graphs);
  const summaries = activeGraphs
    .map((graph) => ({
      graph,
      assets: graph.activeVersion?.id ? assetsByVersionId[graph.activeVersion.id] : undefined
    }))
    .filter((item) => item.graph.activeVersion?.id);
  const totals = summaries.reduce(
    (acc, item) => {
      acc.runtimeNodes += item.assets?.runtimeDraftNodes.length ?? 0;
      acc.explorationEdges += item.assets?.explorationDraftEdges.length ?? 0;
      acc.routeGaps += item.assets?.routeGapArtifacts.length ?? 0;
      return acc;
    },
    { runtimeNodes: 0, explorationEdges: 0, routeGaps: 0 }
  );

  return (
    <div className="panel graph-assets-panel">
      <div className="panel-head">
        <div>
          <h2>运行期候选资产治理</h2>
          <p>这里展示系统执行时沉淀出来但还未进入正式规划的草稿节点、探索边和 route-gap 证据。draft 资产不会被 RoutePlanner 使用，只有晋级为 active 后才会参与路径计算。</p>
        </div>
        <button className="icon-button" type="button" onClick={onRefresh}>
          刷新
        </button>
      </div>
      <div className="graph-asset-summary">
        <div>
          <strong>{totals.runtimeNodes}</strong>
          <span>运行期草稿节点</span>
        </div>
        <div>
          <strong>{totals.explorationEdges}</strong>
          <span>探索草稿边</span>
        </div>
        <div>
          <strong>{totals.routeGaps}</strong>
          <span>route-gap 证据</span>
        </div>
      </div>
      {summaries.length === 0 ? (
        <div className="graph-empty-inline">暂无 active 业务图谱，执行目标节点或导入图谱后会在这里展示候选资产。</div>
      ) : (
        <div className="graph-asset-grid">
          {summaries.map(({ graph, assets }) => (
            <GraphAssetGraphSection
              key={graph.id}
              graph={graph}
              assets={assets}
              onPromoteNode={onPromoteNode}
              onPromoteEdge={onPromoteEdge}
              onAutoPromote={onAutoPromote}
              onIdentifyCurrentPage={onIdentifyCurrentPage}
              currentPage={graph.activeVersion?.id ? currentPageByVersionId[graph.activeVersion.id] : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GraphAssetGraphSection({
  graph,
  assets,
  onPromoteNode,
  onPromoteEdge,
  onAutoPromote,
  onIdentifyCurrentPage,
  currentPage
}: {
  graph: BusinessGraph;
  assets?: GraphAssetGovernanceSummary;
  onPromoteNode: (graphVersionId: string, nodeId: string) => void;
  onPromoteEdge: (graphVersionId: string, edgeId: string) => void;
  onAutoPromote: (graphVersionId: string) => void;
  onIdentifyCurrentPage: (graphVersionId: string) => void;
  currentPage?: CurrentPageResult;
}) {
  const runtimeNodes = assets?.runtimeDraftNodes ?? [];
  const explorationEdges = assets?.explorationDraftEdges ?? [];
  const routeGapArtifacts = assets?.routeGapArtifacts ?? [];
  const graphVersionId = graph.activeVersion?.id ?? assets?.graphVersionId ?? "";
  return (
    <article className="graph-asset-section">
      <div className="graph-asset-section-head">
        <div>
          <strong>{graph.name}</strong>
          <span>
            {graph.appId} · v{graph.activeVersion?.version ?? "-"}
          </span>
        </div>
        <div className="graph-badges">
          <span>{runtimeNodes.length} draft node</span>
          <span>{explorationEdges.length} draft edge</span>
          <span>{routeGapArtifacts.length} gap</span>
        </div>
        <button className="icon-button" type="button" onClick={() => graphVersionId && onAutoPromote(graphVersionId)} disabled={!graphVersionId || (runtimeNodes.length === 0 && explorationEdges.length === 0)}>
          按策略自动晋级
        </button>
        <button className="icon-button" type="button" onClick={() => graphVersionId && onIdentifyCurrentPage(graphVersionId)} disabled={!graphVersionId}>
          识别当前页面
        </button>
      </div>
      {currentPage && <GraphCurrentPageResult result={currentPage} />}
      <div className="graph-asset-columns">
        <GraphAssetColumn title="运行期草稿节点" emptyText="暂无 runtime-discovered 节点">
          {runtimeNodes.map((node) => (
            <article key={node.id} className="graph-asset-card">
              <strong>{node.name}</strong>
              <span>{node.key}</span>
              <div className="graph-badges">
                <span>{node.status}</span>
                <span>观察 {node.observationCount} 次</span>
              </div>
              <p>{node.visibleTexts.slice(0, 4).join(" · ") || node.resourceIds.slice(0, 3).join(" · ") || "暂无文本 / resourceId 摘要"}</p>
              <button className="icon-button compact" type="button" onClick={() => graphVersionId && onPromoteNode(graphVersionId, node.id)} disabled={!graphVersionId}>
                晋级节点
              </button>
            </article>
          ))}
        </GraphAssetColumn>
        <GraphAssetColumn title="探索草稿边" emptyText="暂无 exploration draft edge">
          {explorationEdges.map((edge) => (
            <article key={edge.id} className="graph-asset-card">
              <strong>{edge.name}</strong>
              <span>
                {edge.fromNodeName ?? edge.fromNodeId} {"->"} {edge.toNodeName ?? edge.toNodeId}
              </span>
              <div className="graph-badges">
                <span>{edge.status}</span>
                {edge.reliabilityScore !== undefined && <span>{formatConfidence(edge.reliabilityScore)}</span>}
              </div>
              <p>{edge.suggestedAction ?? edge.key}</p>
              <button className="icon-button compact" type="button" onClick={() => graphVersionId && onPromoteEdge(graphVersionId, edge.id)} disabled={!graphVersionId}>
                晋级边
              </button>
            </article>
          ))}
        </GraphAssetColumn>
        <GraphAssetColumn title="route-gap 证据" emptyText="暂无 route-gap artifact">
          {routeGapArtifacts.map((artifact) => (
            <article key={artifact.id} className="graph-asset-card">
              <strong>{artifact.name}</strong>
              <span>{artifact.runId ?? "unknown run"}</span>
              <div className="graph-badges">
                <span>{formatShortDate(artifact.createdAt)}</span>
              </div>
              <a href={artifact.url} target="_blank" rel="noreferrer">
                查看证据
              </a>
            </article>
          ))}
        </GraphAssetColumn>
      </div>
    </article>
  );
}

function GraphCurrentPageResult({ result }: { result: CurrentPageResult }) {
  const matchedNode = result.match.node;
  const draftNode = result.node;
  const statusText =
    result.status === "matched"
      ? `已匹配 active 节点：${matchedNode?.name ?? result.match.status}`
      : result.status === "draft_reused"
        ? `已复用草稿节点：${draftNode?.name ?? "未知节点"}`
        : `已创建草稿节点：${draftNode?.name ?? "未知节点"}`;
  return (
    <div className={`graph-current-page-result ${result.status === "matched" ? "matched" : "draft"}`}>
      <strong>{statusText}</strong>
      <span>
        识别分数 {formatConfidence(result.match.score || 0)}
        {result.observation?.packageName ? ` · ${result.observation.packageName}` : ""}
        {result.observation?.activityName ? ` / ${result.observation.activityName}` : ""}
      </span>
    </div>
  );
}

function GraphAssetColumn({ title, emptyText, children }: { title: string; emptyText: string; children: ReactNode }) {
  const items = Children.toArray(children);
  return (
    <section className="graph-asset-column">
      <div className="graph-asset-column-head">
        <strong>{title}</strong>
        <span>{items.length}</span>
      </div>
      <div className="graph-asset-list">{items.length > 0 ? items : <div className="graph-empty-inline">{emptyText}</div>}</div>
    </section>
  );
}

function formatExpectation(expectation: { id: string; title?: string; params: Record<string, unknown> }): string {
  const expected = expectation.params.expected ?? expectation.params.resourceId;
  return expectation.title ?? (typeof expected === "string" ? expected : expectation.id);
}

function GraphScanResultView({ result }: { result: SourceScanResult }) {
  return (
    <div className="graph-result-grid">
      <div className="panel graph-summary-card">
        <div className="graph-summary-main">
          <div>
            <strong>{result.nodes.length}</strong>
            <span>候选节点</span>
          </div>
          <div>
            <strong>{result.edges.length}</strong>
            <span>候选边</span>
          </div>
          <div>
            <strong>{result.summary.scannedFiles}</strong>
            <span>扫描文件</span>
          </div>
          <div>
            <strong>{result.warnings.length}</strong>
            <span>警告</span>
          </div>
        </div>
        <div className="graph-file-breakdown">
          <span>Manifest {result.summary.manifestFiles}</span>
          <span>Navigation {result.summary.navigationFiles}</span>
          <span>Layout {result.summary.layoutFiles}</span>
          <span>Strings {result.summary.stringFiles}</span>
          <span>Source {result.summary.sourceFiles}</span>
        </div>
      </div>

      <div className="panel graph-list-card">
        <div className="panel-head">
          <h2>候选节点</h2>
          <span>{result.nodes.length}</span>
        </div>
        <div className="graph-candidate-list">
          {result.nodes.slice(0, 80).map((node) => (
            <article key={node.id} className="graph-candidate-row">
              <div>
                <strong>{node.name}</strong>
                <span>{node.key}</span>
              </div>
              <div className="graph-badges">
                <span>{node.nodeType}</span>
                <span>{formatConfidence(node.confidence)}</span>
              </div>
              <small>{formatSource(node.source)}</small>
              <p>{node.matchers.slice(0, 4).map((matcher) => `${matcher.type}:${matcher.value}`).join(" · ") || "暂无 matcher"}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="panel graph-list-card">
        <div className="panel-head">
          <h2>候选边</h2>
          <span>{result.edges.length}</span>
        </div>
        <div className="graph-candidate-list">
          {result.edges.slice(0, 80).map((edge) => (
            <article key={edge.id} className="graph-candidate-row">
              <div>
                <strong>{edge.name}</strong>
                <span>{edge.key}</span>
              </div>
              <div className="graph-badges">
                <span>{formatConfidence(edge.confidence)}</span>
              </div>
              <small>{`${edge.fromNodeKey || "unknown"} -> ${edge.toNodeKey || "unknown"}`}</small>
              <p>{formatSource(edge.source)}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatSource(source: { filePath?: string; line?: number }): string {
  if (!source.filePath) {
    return "unknown source";
  }
  return source.line ? `${source.filePath}:${source.line}` : source.filePath;
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
