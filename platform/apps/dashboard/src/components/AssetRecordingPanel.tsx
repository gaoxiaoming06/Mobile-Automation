import { DatabaseZap, RefreshCw, Save, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import type { DeviceInfo } from "@mobile-automation/shared";

export type AssetRecordingSavedAsset = {
  id: string;
  key: string;
  name: string;
  status: string;
  platformScope?: string;
  matcherCount?: number;
  updatedAt?: string;
};

export type AssetRecordingScreenshotRegion = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  semanticArea?: VisualSemanticArea;
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  ignoreRegions?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
};

type VisualSemanticArea = "top" | "content" | "bottom" | "unknown";

export type AssetRecordingCurrentPage = {
  status: "idle" | "matched" | "draft_created" | "draft_reused" | "draft_candidate" | "unknown" | "error";
  assetKind?: "page" | "overlay";
  parentPageId?: string;
  parentPageName?: string;
  overlayType?: string;
  overlayBehavior?: "blocking" | "non_blocking" | "page_state";
  graphVersionId?: string;
  nodeId?: string;
  observation?: unknown;
  match?: unknown;
  pageName?: string;
  visualPageName?: string;
  matchedAssetName?: string;
  matchedAssetKey?: string;
  pageKey?: string;
  aliasText?: string;
  intentTagsText?: string;
  matchScore?: number;
  packageName?: string;
  activityName?: string;
  screenshotUrl?: string;
  screenshotRegions?: AssetRecordingScreenshotRegion[];
  matchedMatchers?: string[];
  missedMatchers?: string[];
  confirmedMatchers?: string[];
  confirmedUiTexts?: string[];
  confirmedOcrTexts?: string[];
  uiTexts?: string[];
  ocrTexts?: string[];
  aiDescription?: string;
  savedAssets?: AssetRecordingSavedAsset[];
  message?: string;
  aiWarnings?: string[];
};

export type AssetRecordingPanelProps = {
  selectedSerial: string;
  selectedDeviceName?: string;
  busy: boolean;
  identifying?: boolean;
  currentPage?: AssetRecordingCurrentPage;
  previewSlot?: ReactNode;
  onPageDraftChange: (patch: Partial<AssetRecordingCurrentPage>) => void;
  onIdentifyCurrentPage: () => void | Promise<void>;
  onAiIdentify?: () => void | Promise<void>;
  aiIdentifying?: boolean;
  onSaveCurrentPageAsset: (mode: "create" | "update") => void | Promise<void>;
  libraryInitialization?: {
    platform: DeviceInfo["platform"];
    targetIdentifier: string;
    defaultName: string;
  };
  onInitializePageAssetLibrary?: (name: string) => void | Promise<void>;
  onResizePointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
};

type AssetEvidenceKind = "matcher" | "页面文字" | "OCR 文字";
type AssetEvidenceItem = {
  kind: AssetEvidenceKind;
  value: string;
};
type RegionBoundEvidence = {
  value: string;
  region?: string;
  prefix?: string;
};
type AssetEvidenceGroup = {
  title: string;
  items: AssetEvidenceItem[];
};
type EditingEvidence = {
  item: AssetEvidenceItem;
  source: "confirmed" | "candidate";
};
type PercentPoint = { x: number; y: number };

const semanticAreaOptions: Array<{ value: VisualSemanticArea; label: string }> = [
  { value: "top", label: "顶部标题栏区域" },
  { value: "content", label: "中间内容区域" },
  { value: "bottom", label: "底部固定区域" },
  { value: "unknown", label: "未知区域" }
];

export type ApplyEditedEvidenceValueInput = {
  item: AssetEvidenceItem;
  nextValue: string;
  confirmedMatchers: string[];
  confirmedUiTexts: string[];
  confirmedOcrTexts: string[];
};

export function AssetRecordingPanel({
  selectedSerial,
  selectedDeviceName,
  busy,
  identifying = false,
  currentPage,
  previewSlot,
  onPageDraftChange,
  onIdentifyCurrentPage,
  onAiIdentify,
  aiIdentifying = false,
  onSaveCurrentPageAsset,
  libraryInitialization,
  onInitializePageAssetLibrary,
  onResizePointerDown
}: AssetRecordingPanelProps) {
  const page = currentPage ?? { status: "idle" as const };
  const savedAssets = page.savedAssets ?? [];
  const screenshotRegions = page.screenshotRegions ?? [];
  const [regionStart, setRegionStart] = useState<{ x: number; y: number }>();
  const [draftRegion, setDraftRegion] = useState<AssetRecordingScreenshotRegion>();
  const [isRenamingPage, setIsRenamingPage] = useState(false);
  const [draftPageName, setDraftPageName] = useState("");
  const [editingEvidence, setEditingEvidence] = useState<EditingEvidence>();
  const [draftEvidenceValue, setDraftEvidenceValue] = useState("");
  const [hiddenCandidateEvidenceKeys, setHiddenCandidateEvidenceKeys] = useState<string[]>([]);
  const [screenshotNaturalSize, setScreenshotNaturalSize] = useState<{ width: number; height: number }>();
  const screenshotImageLayerRef = useRef<HTMLDivElement>(null);
  const hasSavedAsset = savedAssets.some((asset) => asset.id === page.nodeId || asset.key === page.pageKey);
  const saveMode: "create" | "update" = hasSavedAsset ? "update" : "create";
  const canSave = page.status !== "idle" && page.status !== "error";
  const title = page.pageName || page.visualPageName || "未知页面";
  const matchedAssetName = page.matchedAssetName;
  const scoreLabel = page.status === "draft_candidate" || !page.nodeId ? "待建立基准" : `匹配度 ${formatScore(page.matchScore)}`;
  const scoreTitle = page.status === "draft_candidate" || !page.nodeId ? "当前页面还没有保存为页面资产，保存后才会建立可复用的页面匹配基准。" : "当前页面采集信号和页面识别规则的加权匹配度，不是截图相似度。";
  const confirmedMatchers = page.confirmedMatchers ?? [];
  const confirmedUiTexts = page.confirmedUiTexts ?? [];
  const confirmedOcrTexts = page.confirmedOcrTexts ?? [];
  const confirmedEvidence = [
    ...confirmedMatchers.map((value) => evidence("matcher", value)),
    ...confirmedUiTexts.map((value) => evidence("页面文字", value)),
    ...confirmedOcrTexts.map((value) => evidence("OCR 文字", value))
  ];
  const candidateEvidence = [
    ...(page.matchedMatchers ?? []).map((value) => evidence("matcher", value)),
    ...(page.uiTexts ?? []).map((value) => evidence("页面文字", value)),
    ...(page.ocrTexts ?? []).map((value) => evidence("OCR 文字", value))
  ].filter((item) => !isConfirmedEvidence(item, confirmedMatchers, confirmedUiTexts, confirmedOcrTexts) && !hiddenCandidateEvidenceKeys.includes(evidenceKey(item)));
  const candidateEvidenceGroups = groupCandidateEvidence(candidateEvidence);

  function startScreenshotRegion(event: PointerEvent<HTMLDivElement>) {
    if (!page.screenshotUrl) {
      return;
    }
    const point = pointerToPercent(event, screenshotImageLayerRef.current);
    setRegionStart(point);
    setDraftRegion({ id: "draft-region", label: "新重点区域", x: point.x, y: point.y, width: 0, height: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateScreenshotRegion(event: PointerEvent<HTMLDivElement>) {
    if (!regionStart) {
      return;
    }
    const point = pointerToPercent(event, screenshotImageLayerRef.current);
    setDraftRegion(normalizeRegion({ id: "draft-region", label: "新重点区域", x: regionStart.x, y: regionStart.y, width: point.x - regionStart.x, height: point.y - regionStart.y }));
  }

  function finishScreenshotRegion() {
    if (draftRegion && draftRegion.width >= 2 && draftRegion.height >= 2) {
      onPageDraftChange({
        screenshotRegions: [
          ...screenshotRegions,
          {
            ...draftRegion,
            id: `region-${Date.now()}`,
            label: `重点区域 ${screenshotRegions.length + 1}`,
            semanticArea: semanticAreaForRegion(draftRegion),
            coordinateSpace: "screen"
          }
        ]
      });
    }
    setRegionStart(undefined);
    setDraftRegion(undefined);
  }

  function removeScreenshotRegion(regionId: string) {
    onPageDraftChange({
      screenshotRegions: screenshotRegions.filter((region) => region.id !== regionId)
    });
  }

  function updateScreenshotRegionSemanticArea(regionId: string, semanticArea: VisualSemanticArea) {
    onPageDraftChange({
      screenshotRegions: screenshotRegions.map((region) => (region.id === regionId ? applySemanticAreaOverrideToRegion(region, semanticArea) : region))
    });
  }

  function confirmEvidence(item: AssetEvidenceItem) {
    updateEvidence(item, "confirm");
  }

  function removeEvidence(item: AssetEvidenceItem) {
    updateEvidence(item, "remove");
  }

  function startEditEvidence(item: AssetEvidenceItem, source: "confirmed" | "candidate") {
    setEditingEvidence({ item, source });
    setDraftEvidenceValue(evidenceDisplayValue(item));
  }

  function cancelEditEvidence() {
    setEditingEvidence(undefined);
    setDraftEvidenceValue("");
  }

  function confirmEditEvidence() {
    if (!editingEvidence) {
      return;
    }
    const nextValue = draftEvidenceValue.trim();
    if (!nextValue) {
      return;
    }
    const patch = applyEditedEvidenceValue({
      item: editingEvidence.item,
      nextValue,
      confirmedMatchers,
      confirmedUiTexts,
      confirmedOcrTexts
    });
    onPageDraftChange(patch);
    if (editingEvidence.source === "candidate") {
      setHiddenCandidateEvidenceKeys(addUnique(hiddenCandidateEvidenceKeys, evidenceKey(editingEvidence.item)));
    }
    cancelEditEvidence();
  }

  function updateEvidence(item: AssetEvidenceItem, action: "confirm" | "remove") {
    const field = evidenceField(item);
    const currentValues = field === "confirmedMatchers" ? confirmedMatchers : field === "confirmedUiTexts" ? confirmedUiTexts : confirmedOcrTexts;
    const nextValues = action === "confirm" ? addUnique(currentValues, item.value) : currentValues.filter((value) => value !== item.value);
    onPageDraftChange({ [field]: nextValues });
  }

  function startRenamePage() {
    setDraftPageName(title);
    setIsRenamingPage(true);
  }

  function cancelRenamePage() {
    setDraftPageName("");
    setIsRenamingPage(false);
  }

  function confirmRenamePage() {
    const patch = pageNameDraftPatch(draftPageName);
    if (!patch) {
      return;
    }
    onPageDraftChange(patch);
    setIsRenamingPage(false);
  }

  if (libraryInitialization) {
    return (
      <section className="asset-recording-module module-page">
        <div className="asset-preview-column">
          {previewSlot ?? <div className="asset-preview-placeholder">选择设备后显示实时预览</div>}
          {identifying ? <div className="asset-preview-blocker">识别中</div> : null}
        </div>
        <div className="recording-resizer asset-recording-resizer" onPointerDown={onResizePointerDown} role="separator" aria-orientation="vertical" aria-label="调整预览和页面信息区域宽度" title="拖动调整左右区域宽度" />
        <div className="asset-editor-column">
          <form
            className="panel asset-page-card asset-page-card-shell asset-library-initialization"
            onSubmit={(event) => {
              event.preventDefault();
              const name = String(new FormData(event.currentTarget).get("libraryName") ?? "").trim();
              if (name) {
                void onInitializePageAssetLibrary?.(name);
              }
            }}
          >
            <div className="asset-page-title">
              <div className="asset-page-name-display">
                <DatabaseZap size={18} />
                <strong>初始化页面资产库</strong>
              </div>
            </div>
            <div className="asset-facts compact">
              <div><span>平台</span><strong>{assetRecordingPlatformLabel(libraryInitialization.platform)}</strong></div>
              <div><span>App 标识</span><strong>{libraryInitialization.targetIdentifier}</strong></div>
            </div>
            <label className="asset-initialization-name">
              资产库名称
              <input name="libraryName" defaultValue={libraryInitialization.defaultName} required />
            </label>
            <button className="icon-button primary" type="submit" disabled={busy || !onInitializePageAssetLibrary}>
              <DatabaseZap size={16} />
              创建并识别当前页
            </button>
          </form>
        </div>
      </section>
    );
  }

  return (
    <section className="asset-recording-module module-page">
      <div className="asset-preview-column">
        {previewSlot ?? <div className="asset-preview-placeholder">选择设备后显示实时预览</div>}
        {identifying ? <div className="asset-preview-blocker">识别中</div> : null}
      </div>

      <div className="recording-resizer asset-recording-resizer" onPointerDown={onResizePointerDown} role="separator" aria-orientation="vertical" aria-label="调整预览和页面信息区域宽度" title="拖动调整左右区域宽度" />

      <div className="asset-editor-column">
        <div className="panel asset-page-card asset-page-card-shell">
          {page.status === "idle" ? (
            <div className="empty">切到资产校准页后会自动识别当前页面；也可以切换设备或操作页面后等待刷新。</div>
          ) : (
            <>
              <div className="asset-page-title">
                {isRenamingPage ? (
                  <div className="asset-page-name-edit">
                    <input aria-label="新的页面名称" className="asset-page-name-input" value={draftPageName} onChange={(event) => setDraftPageName(event.target.value)} autoFocus />
                    <button className="asset-page-name-action primary" type="button" disabled={busy || !draftPageName.trim()} onClick={() => void confirmRenamePage()}>
                      确认修改
                    </button>
                    <button className="asset-page-name-action" type="button" disabled={busy} onClick={cancelRenamePage}>
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="asset-page-name-display">
                    <strong>{title}</strong>
                    <button className="asset-page-name-action" type="button" disabled={busy} onClick={startRenamePage}>
                      修改名称
                    </button>
                  </div>
                )}
                <div className="asset-title-status">
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="重新识别当前页"
                    title="重新识别当前页"
                    disabled={busy || identifying}
                    onClick={() => void onIdentifyCurrentPage()}
                  >
                    <RefreshCw size={15} />
                  </button>
                  <span className={`asset-status ${page.status}`}>{statusLabel(page.status)}</span>
                  <b title={scoreTitle}>{scoreLabel}</b>
                </div>
              </div>
              {matchedAssetName ? (
                <div className="asset-match-summary">
                  <span>匹配资产/状态</span>
                  <strong>{matchedAssetName}</strong>
                </div>
              ) : null}
              {identifying ? <div className="asset-identifying-banner">识别中：正在识别当前页面，完成后可继续操作。</div> : null}
              {page.status === "error" && page.message ? <div className="asset-identifying-banner asset-warning-banner">{page.message}</div> : null}
              {onAiIdentify ? (
                <div className="asset-ai-identify">
                  <button
                    type="button"
                    className="asset-ai-identify-button"
                    disabled={busy || identifying || aiIdentifying || !page.observation}
                    onClick={() => void onAiIdentify()}
                    title="将当前页面证据交给 AI 生成资产草稿建议（预计 20-60 秒）"
                  >
                    <Sparkles size={15} />
                    <span>{aiIdentifying ? "AI 辅助识别中…" : "AI 辅助识别"}</span>
                  </button>
                  {aiIdentifying ? <span className="asset-ai-identify-hint">AI 正在分析页面证据，预计 20-60 秒…</span> : null}
                </div>
              ) : null}
              {page.aiWarnings?.length ? (
                <div className="asset-identifying-banner asset-warning-banner">AI 提示：{page.aiWarnings.join("；")}</div>
              ) : null}
            </>
          )}

          {page.status !== "idle" ? (
            <>
              <div className="asset-detail-tabs" role="tablist" aria-label="页面资产详情">
                <button className="asset-detail-tab active" type="button" role="tab" aria-selected="true">
                  页面匹配
                </button>
              </div>

              <div className="asset-detail-scroll asset-editor-scroll">
                <div className="asset-detail-section asset-identity-card">
                    <div className="panel-head">
                      <div>
                        <h2>页面身份依据</h2>
                      </div>
                    </div>
                    <div className="asset-screenshot-card">
                      <div className="asset-screenshot-head">
                        <strong>页面截图</strong>
                      </div>
                      {page.screenshotUrl ? (
                        <>
                          <div
                            className="asset-screenshot-frame"
                            onPointerCancel={finishScreenshotRegion}
                            onPointerDown={startScreenshotRegion}
                            onPointerLeave={finishScreenshotRegion}
                            onPointerMove={updateScreenshotRegion}
                            onPointerUp={finishScreenshotRegion}
                          >
                            <div className="asset-screenshot-image-layer" ref={screenshotImageLayerRef} style={screenshotImageLayerStyle(screenshotNaturalSize)}>
                              <img
                                draggable={false}
                                src={page.screenshotUrl}
                                alt="当前页面截图"
                                onLoad={(event) => {
                                  const image = event.currentTarget;
                                  setScreenshotNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
                                }}
                              />
                              {[...screenshotRegions, ...(draftRegion ? [draftRegion] : [])].map((region) => (
                                <span
                                  className={region.id === "draft-region" ? "asset-screenshot-region draft" : "asset-screenshot-region"}
                                  key={region.id}
                                  style={{
                                    left: `${region.x}%`,
                                    top: `${region.y}%`,
                                    width: `${region.width}%`,
                                    height: `${region.height}%`
                                  }}
                                >
                                  <em>{region.label}</em>
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="asset-region-list">
                            <strong>截图重点区域</strong>
                            {screenshotRegions.length ? (
                              screenshotRegions.map((region) => (
                                <span key={region.id}>
                                  {region.label}
                                  <button type="button" onClick={() => removeScreenshotRegion(region.id)}>
                                    移除
                                  </button>
                                  <select
                                    aria-label={`${region.label}语义区域`}
                                    value={region.semanticArea ?? semanticAreaForRegion(region)}
                                    onChange={(event) => updateScreenshotRegionSemanticArea(region.id, readVisualSemanticArea(event.target.value) ?? "unknown")}
                                  >
                                    {semanticAreaOptions.map((option) => (
                                      <option value={option.value} key={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                </span>
                              ))
                            ) : (
                              <small>暂无重点区域；在截图上拖拽即可添加。</small>
                            )}
                          </div>
                        </>
                      ) : (
                        <small>暂未拿到截图证据</small>
                      )}
                    </div>
                    <EvidenceList
                      title="已确认匹配依据"
                      items={confirmedEvidence}
                      actionLabel="移除"
                      emptyText="还没有确认依据；请从候选信息中选择稳定信号。"
                      editingEvidence={editingEvidence}
                      draftEvidenceValue={draftEvidenceValue}
                      onAction={removeEvidence}
                      onCancelEdit={cancelEditEvidence}
                      onConfirmEdit={confirmEditEvidence}
                      onDraftEvidenceValueChange={setDraftEvidenceValue}
                      onEdit={(item) => startEditEvidence(item, "confirmed")}
                    />
                    <EvidenceGroupList
                      title="候选信息"
                      groups={candidateEvidenceGroups}
                      actionLabel="设为依据"
                      emptyText="暂无候选信息"
                      editingEvidence={editingEvidence}
                      draftEvidenceValue={draftEvidenceValue}
                      onAction={confirmEvidence}
                      onCancelEdit={cancelEditEvidence}
                      onConfirmEdit={confirmEditEvidence}
                      onDraftEvidenceValueChange={setDraftEvidenceValue}
                      onEdit={(item) => startEditEvidence(item, "candidate")}
                    />
                    <div className="asset-facts compact">
                      <div>
                        <span>资产 ID</span>
                        <strong>{page.nodeId || "待确认"}</strong>
                      </div>
                      <div>
                        <span>资产版本</span>
                        <strong>{page.graphVersionId || "待确认"}</strong>
                      </div>
                      <div>
                        <span>App 包</span>
                        <strong>{page.packageName || "未知"}</strong>
                      </div>
                      <div>
                        <span>Activity</span>
                        <strong>{page.activityName || "未知"}</strong>
                      </div>
                    </div>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="asset-floating-actions">
          <div>
            <strong>{selectedSerial ? selectedDeviceName || selectedSerial : "未选择设备"}</strong>
            <span>{hasSavedAsset ? "库中已有对应页面资产" : "库中暂无对应页面资产"}</span>
          </div>
          <button className="icon-button primary" type="button" disabled={busy || !selectedSerial || !canSave} onClick={() => void onSaveCurrentPageAsset(saveMode)}>
            {saveMode === "update" ? <DatabaseZap size={16} /> : <Save size={16} />}
            {saveMode === "update" ? "更新页面" : "保存页面"}
          </button>
        </div>
      </div>
    </section>
  );
}

function assetRecordingPlatformLabel(platform: DeviceInfo["platform"]): string {
  if (platform === "ios") return "iOS";
  if (platform === "harmony") return "HarmonyOS";
  return "Android";
}

function pointerToPercent(event: PointerEvent<HTMLDivElement>, imageLayer: HTMLElement | null): { x: number; y: number } {
  const rect = (imageLayer ?? event.currentTarget).getBoundingClientRect();
  return clientPointToImagePercent(event, rect);
}

export function clientPointToImagePercent(
  point: { clientX: number; clientY: number },
  imageRect: { left: number; top: number; width: number; height: number }
): { x: number; y: number } {
  return {
    x: roundPercent(clamp(((point.clientX - imageRect.left) / Math.max(imageRect.width, 1)) * 100)),
    y: roundPercent(clamp(((point.clientY - imageRect.top) / Math.max(imageRect.height, 1)) * 100))
  };
}

function screenshotImageLayerStyle(imageSize?: { width: number; height: number }, maxHeight = 520): { width?: string; aspectRatio?: string } {
  if (!imageSize?.width || !imageSize.height) {
    return {};
  }
  return {
    width: `min(100%, ${(maxHeight * imageSize.width) / imageSize.height}px)`,
    aspectRatio: `${imageSize.width} / ${imageSize.height}`
  };
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeRegion(region: AssetRecordingScreenshotRegion): AssetRecordingScreenshotRegion {
  const x = region.width < 0 ? region.x + region.width : region.x;
  const y = region.height < 0 ? region.y + region.height : region.y;
  const normalized = {
    ...region,
    x: clamp(x),
    y: clamp(y),
    width: clamp(Math.abs(region.width), 0, 100 - clamp(x)),
    height: clamp(Math.abs(region.height), 0, 100 - clamp(y))
  };
  return {
    ...normalized,
    semanticArea: semanticAreaForRegion(normalized),
    coordinateSpace: normalized.coordinateSpace ?? "screen"
  };
}

export function applySemanticAreaOverrideToRegion(region: AssetRecordingScreenshotRegion, semanticArea: VisualSemanticArea): AssetRecordingScreenshotRegion {
  return {
    ...region,
    semanticArea,
    coordinateSpace: region.coordinateSpace ?? "screen"
  };
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function evidence(kind: AssetEvidenceKind, value: string): AssetEvidenceItem {
  return { kind, value };
}

function evidenceKey(item: AssetEvidenceItem): string {
  return `${item.kind}:${item.value}`;
}

function compactEvidenceCandidates(items: AssetEvidenceItem[]): AssetEvidenceItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const display = evidenceDisplayValue(item);
    if (!display) {
      return false;
    }
    const key = `${item.kind}:${display}:${parseRegionBoundEvidence(item.value).region ?? "no-region"}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function evidenceField(item: AssetEvidenceItem): "confirmedMatchers" | "confirmedUiTexts" | "confirmedOcrTexts" {
  if (item.kind === "页面文字") {
    return "confirmedUiTexts";
  }
  if (item.kind === "OCR 文字") {
    return "confirmedOcrTexts";
  }
  return "confirmedMatchers";
}

function isConfirmedEvidence(item: AssetEvidenceItem, matchers: string[], uiTexts: string[], ocrTexts: string[]): boolean {
  if (item.kind === "页面文字") {
    return uiTexts.includes(item.value);
  }
  if (item.kind === "OCR 文字") {
    return ocrTexts.includes(item.value);
  }
  return matchers.includes(item.value);
}

function canEditEvidence(item: AssetEvidenceItem): boolean {
  return item.kind === "OCR 文字" || item.kind === "页面文字";
}

export function applyEditedEvidenceValue({
  item,
  nextValue,
  confirmedMatchers,
  confirmedUiTexts,
  confirmedOcrTexts
}: ApplyEditedEvidenceValueInput): Partial<AssetRecordingCurrentPage> {
  const trimmedValue = nextValue.trim();
  const field = evidenceField(item);
  const storedValue = encodeEditedEvidenceValue(item, trimmedValue);
  const currentValues = field === "confirmedMatchers" ? confirmedMatchers : field === "confirmedUiTexts" ? confirmedUiTexts : confirmedOcrTexts;
  const nextValues = replaceOrAddEvidenceValue(currentValues, item.value, storedValue);
  return { [field]: nextValues };
}

function evidenceDisplayValue(item: AssetEvidenceItem): string {
  if (item.kind !== "OCR 文字" && item.kind !== "页面文字") {
    return item.value;
  }
  return parseRegionBoundEvidence(item.value).value;
}

function encodeEditedEvidenceValue(item: AssetEvidenceItem, nextValue: string): string {
  if (item.kind !== "OCR 文字" && item.kind !== "页面文字") {
    return nextValue;
  }
  const parsed = parseRegionBoundEvidence(item.value);
  if (!parsed.region) {
    return nextValue;
  }
  const prefix = parsed.prefix ?? (item.kind === "OCR 文字" ? "ocr_text" : "text");
  return `${prefix}:${nextValue}@region(${parsed.region})`;
}

function parseRegionBoundEvidence(value: string): RegionBoundEvidence {
  const trimmed = value.trim();
  const match = trimmed.match(/^(?:(text|ocr_text|ocr):)?(.+?)@region\(([^)]+)\)$/);
  if (!match) {
    return { value: trimmed };
  }
  return {
    value: match[2].trim(),
    region: match[3].trim(),
    prefix: match[1]
  };
}

function replaceOrAddEvidenceValue(items: string[], oldValue: string, nextValue: string): string[] {
  if (oldValue === nextValue) {
    return items;
  }
  const existingIndex = items.indexOf(oldValue);
  const withoutNextValue = items.filter((item) => item !== nextValue);
  if (existingIndex < 0) {
    return addUnique(items, nextValue);
  }
  return withoutNextValue.map((item) => (item === oldValue ? nextValue : item));
}

function groupCandidateEvidence(items: AssetEvidenceItem[]): AssetEvidenceGroup[] {
  const generalItems = items.filter((item) => item.kind === "OCR 文字");
  const platformItems = items.filter((item) => item.kind === "页面文字" || item.kind === "matcher");
  return [
    { title: "通用候选", items: generalItems },
    { title: "平台候选", items: platformItems }
  ].filter((group) => group.items.length > 0);
}

function semanticAreaForRegion(region: Pick<AssetRecordingScreenshotRegion, "x" | "y" | "width" | "height">): VisualSemanticArea {
  const centerY = region.y + region.height / 2;
  if (centerY <= 14) {
    return "top";
  }
  if (centerY >= 88) {
    return "bottom";
  }
  return "content";
}

function readVisualSemanticArea(value: FormDataEntryValue | string | null): VisualSemanticArea | undefined {
  return value === "top" ||
    value === "content" ||
    value === "bottom" ||
    value === "unknown"
    ? value
    : undefined;
}

function addUnique(items: string[], item: string): string[] {
  return items.includes(item) ? items : [...items, item];
}

function EvidenceList({
  title,
  items,
  actionLabel,
  emptyText,
  editingEvidence,
  draftEvidenceValue,
  onAction,
  onCancelEdit,
  onConfirmEdit,
  onDraftEvidenceValueChange,
  onEdit
}: {
  title: string;
  items: AssetEvidenceItem[];
  actionLabel: string;
  emptyText: string;
  editingEvidence?: EditingEvidence;
  draftEvidenceValue: string;
  onAction: (item: AssetEvidenceItem) => void;
  onCancelEdit: () => void;
  onConfirmEdit: () => void;
  onDraftEvidenceValueChange: (value: string) => void;
  onEdit: (item: AssetEvidenceItem) => void;
}) {
  return (
    <div className="asset-matcher-section">
      <strong>{title}</strong>
      {items.length ? (
        <div className="asset-chip-list">
          {items.map((item) => (
            <EvidenceChip
              key={evidenceKey(item)}
              actionLabel={actionLabel}
              draftEvidenceValue={draftEvidenceValue}
              editingEvidence={editingEvidence}
              item={item}
              onAction={onAction}
              onCancelEdit={onCancelEdit}
              onConfirmEdit={onConfirmEdit}
              onDraftEvidenceValueChange={onDraftEvidenceValueChange}
              onEdit={onEdit}
            />
          ))}
        </div>
      ) : (
        <small>{emptyText}</small>
      )}
    </div>
  );
}

function EvidenceGroupList({
  title,
  groups,
  actionLabel,
  emptyText,
  editingEvidence,
  draftEvidenceValue,
  onAction,
  onCancelEdit,
  onConfirmEdit,
  onDraftEvidenceValueChange,
  onEdit
}: {
  title: string;
  groups: AssetEvidenceGroup[];
  actionLabel: string;
  emptyText: string;
  editingEvidence?: EditingEvidence;
  draftEvidenceValue: string;
  onAction: (item: AssetEvidenceItem) => void;
  onCancelEdit: () => void;
  onConfirmEdit: () => void;
  onDraftEvidenceValueChange: (value: string) => void;
  onEdit: (item: AssetEvidenceItem) => void;
}) {
  return (
    <div className="asset-matcher-section">
      <strong>{title}</strong>
      {groups.length ? (
        <div className="asset-evidence-groups">
          {groups.map((group) => (
            <div className="asset-evidence-group" key={group.title}>
              <span className="asset-evidence-group-title">{group.title}</span>
              <div className="asset-chip-list">
                {group.items.map((item) => (
                  <EvidenceChip
                    key={evidenceKey(item)}
                    actionLabel={actionLabel}
                    draftEvidenceValue={draftEvidenceValue}
                    editingEvidence={editingEvidence}
                    item={item}
                    onAction={onAction}
                    onCancelEdit={onCancelEdit}
                    onConfirmEdit={onConfirmEdit}
                    onDraftEvidenceValueChange={onDraftEvidenceValueChange}
                    onEdit={onEdit}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <small>{emptyText}</small>
      )}
    </div>
  );
}

function EvidenceChip({
  item,
  actionLabel,
  editingEvidence,
  draftEvidenceValue,
  onAction,
  onCancelEdit,
  onConfirmEdit,
  onDraftEvidenceValueChange,
  onEdit
}: {
  item: AssetEvidenceItem;
  actionLabel: string;
  editingEvidence?: EditingEvidence;
  draftEvidenceValue: string;
  onAction: (item: AssetEvidenceItem) => void;
  onCancelEdit: () => void;
  onConfirmEdit: () => void;
  onDraftEvidenceValueChange: (value: string) => void;
  onEdit: (item: AssetEvidenceItem) => void;
}) {
  const isEditing = editingEvidence ? evidenceKey(editingEvidence.item) === evidenceKey(item) : false;
  const displayValue = evidenceDisplayValue(item);

  if (isEditing) {
    return (
      <span className="asset-chip editing">
        <em>{item.kind}</em>
        <input aria-label={`修正${item.kind}`} className="asset-evidence-edit-input" value={draftEvidenceValue} onChange={(event) => onDraftEvidenceValueChange(event.target.value)} />
        <button className="asset-matcher-action primary" type="button" disabled={!draftEvidenceValue.trim()} onClick={onConfirmEdit}>
          确认
        </button>
        <button className="asset-matcher-action" type="button" onClick={onCancelEdit}>
          取消
        </button>
      </span>
    );
  }

  return (
    <span className="asset-chip">
      <em>{item.kind}</em>
      <span className="asset-evidence-value">{displayValue}</span>
      {canEditEvidence(item) ? (
        <button className="asset-matcher-action" type="button" aria-label={`${editEvidenceActionLabel(item.kind)}：${displayValue}`} onClick={() => onEdit(item)}>
          编辑
        </button>
      ) : null}
      <button className="asset-matcher-action" type="button" onClick={() => onAction(item)}>
        {actionLabel}
      </button>
    </span>
  );
}

function editEvidenceActionLabel(kind: AssetEvidenceKind): string {
  return kind === "OCR 文字" ? "编辑 OCR 文字" : `编辑${kind}`;
}

export function pageNameDraftPatch(value: string): Pick<AssetRecordingCurrentPage, "pageName"> | undefined {
  const pageName = value.trim();
  return pageName ? { pageName } : undefined;
}

function statusLabel(status: AssetRecordingCurrentPage["status"]): string {
  if (status === "matched") {
    return "已匹配";
  }
  if (status === "draft_created") {
    return "新草稿";
  }
  if (status === "draft_reused") {
    return "复用草稿";
  }
  if (status === "draft_candidate") {
    return "待保存";
  }
  if (status === "unknown") {
    return "未知";
  }
  if (status === "error") {
    return "异常";
  }
  return "待识别";
}

function formatScore(score?: number): string {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return "--";
  }
  return `${Math.round(score * 100)}%`;
}
