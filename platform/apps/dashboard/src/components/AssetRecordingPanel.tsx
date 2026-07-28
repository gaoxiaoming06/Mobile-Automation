import { DatabaseZap, RefreshCw, Save, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent, PointerEvent, ReactNode } from "react";
import { AI_LOCATOR_KIND_LABELS, aiElementSuggestionToDraft, type AiElementSuggestion } from "../ai-page-draft-merge";

export type AssetRecordingPageElement = {
  id?: string;
  label: string;
  locator: string;
  locatorKind?: AssetRecordingLocatorKind;
  semanticArea?: VisualSemanticArea;
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  previewCrop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  viewport?: {
    width: number;
    height: number;
  };
  source?: "manual" | "candidate";
  scrollProfile?: AssetRecordingScrollProfile;
  targetText?: string;
  tapPointPercent?: {
    x: number;
    y: number;
  };
  quality?: AssetRecordingPageElementQuality;
  visualLocator?: Record<string, unknown>;
  dynamicMasks?: AssetRecordingDynamicMask[];
  structuralLocator?: Record<string, unknown>;
  dynamicRegionId?: string;
  itemTemplateId?: string;
};

export type AssetRecordingLocatorKind = "text_locator" | "visual_locator" | "structural_locator" | "collection_item_locator" | "top_bar_icon_locator" | "ocr_anchor_offset";

export type AssetRecordingDynamicMask = {
  kind: "avatar" | "text" | "image" | "number" | "custom";
  label?: string;
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  reason?: string;
};

export type AssetRecordingPageElementQuality = {
  status: "pass" | "needs_review" | "fail";
  score: number;
  warnings: Array<{
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
  }>;
  candidates: Array<Record<string, unknown>>;
  evidence: Record<string, unknown>;
};

export type AssetRecordingScrollProfile = {
  containerKind: "list" | "grid_list" | "tab_bar" | "carousel" | "scroll_area";
  direction: "vertical" | "horizontal";
  columns?: number;
  targetKind: "item_text" | "ocr_text" | "semantic_label" | "nth_item" | "image_region";
  targetQuery?: string;
  candidateItemHeightPercent?: number;
  clickSafePoint?: {
    xPercent: number;
    yPercent: number;
  };
  scrollStepPercent?: number;
  failureStrategy?: "none" | "try_next_candidate" | "back_and_try_next_candidate";
};

export type AssetRecordingSavedAsset = {
  id: string;
  key: string;
  name: string;
  status: string;
  platformScope?: string;
  matcherCount?: number;
  elementCount?: number;
  updatedAt?: string;
};

export type AssetRecordingPageElementDraft = {
  elementId?: string;
  sourceNodeId?: string;
  locator: string;
  semanticArea?: VisualSemanticArea;
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  elementLabel: string;
  targetText?: string;
  tapPointPercent?: {
    x: number;
    y: number;
  };
  anchorOffsetPercent?: {
    x: number;
    y: number;
  };
  scrollProfile?: AssetRecordingScrollProfile;
  quality?: AssetRecordingPageElementQuality;
  visualLocator?: Record<string, unknown>;
  locatorKind?: AssetRecordingLocatorKind;
  dynamicMasks?: AssetRecordingDynamicMask[];
  structuralLocator?: Record<string, unknown>;
  dynamicRegion?: Record<string, unknown>;
  itemTemplate?: Record<string, unknown>;
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
  targetRef?: string;
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
  elements?: AssetRecordingPageElement[];
  aiDescription?: string;
  savedAssets?: AssetRecordingSavedAsset[];
  message?: string;
  aiElementSuggestions?: AiElementSuggestion[];
  aiWarnings?: string[];
};

export type AssetRecordingPanelProps = {
  selectedSerial: string;
  selectedDeviceName?: string;
  busy: boolean;
  identifying?: boolean;
  initialDetailTab?: AssetDetailTab;
  currentPage?: AssetRecordingCurrentPage;
  previewSlot?: ReactNode;
  onPageDraftChange: (patch: Partial<AssetRecordingCurrentPage>) => void;
  onIdentifyCurrentPage: () => void | Promise<void>;
  onAiIdentify?: () => void | Promise<void>;
  aiIdentifying?: boolean;
  onSaveCurrentPageAsset: (mode: "create" | "update") => void | Promise<void>;
  onSavePageElement?: (draft: AssetRecordingPageElementDraft) => boolean | void | Promise<boolean | void>;
  pageElementSaveError?: string;
  onDeletePageElement?: (element: AssetRecordingPageElement) => void | Promise<void>;
  libraryInitialization?: {
    platform: "android" | "ios";
    targetIdentifier: string;
    defaultName: string;
  };
  onInitializePageAssetLibrary?: (name: string) => void | Promise<void>;
  onResizePointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
};

type AssetDetailTab = "match" | "actions";
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
type ManualElementSeed = {
  label?: string;
  targetText?: string;
  locatorKind?: AssetRecordingLocatorKind;
};
type PercentPoint = { x: number; y: number };
type RegionResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type EditableRegionOperation =
  | { type: "draw"; start: PercentPoint; region: AssetRecordingScreenshotRegion }
  | { type: "move"; start: PercentPoint; region: AssetRecordingScreenshotRegion }
  | { type: "resize"; handle: RegionResizeHandle; start: PercentPoint; region: AssetRecordingScreenshotRegion };

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
  initialDetailTab = "match",
  currentPage,
  previewSlot,
  onPageDraftChange,
  onIdentifyCurrentPage,
  onAiIdentify,
  aiIdentifying = false,
  onSaveCurrentPageAsset,
  onSavePageElement,
  pageElementSaveError,
  onDeletePageElement,
  libraryInitialization,
  onInitializePageAssetLibrary,
  onResizePointerDown
}: AssetRecordingPanelProps) {
  const page = currentPage ?? { status: "idle" as const };
  const elements = page.elements ?? [];
  const savedManualElements = elements.filter((element) => element.source === "manual");
  const savedAssets = page.savedAssets ?? [];
  const screenshotRegions = page.screenshotRegions ?? [];
  const [regionStart, setRegionStart] = useState<{ x: number; y: number }>();
  const [draftRegion, setDraftRegion] = useState<AssetRecordingScreenshotRegion>();
  const [activeDetailTab, setActiveDetailTab] = useState<AssetDetailTab>(initialDetailTab);
  const visibleDetailTab = activeDetailTab;
  const [isRenamingPage, setIsRenamingPage] = useState(false);
  const [draftPageName, setDraftPageName] = useState("");
  const [editingEvidence, setEditingEvidence] = useState<EditingEvidence>();
  const [draftEvidenceValue, setDraftEvidenceValue] = useState("");
  const [hiddenCandidateEvidenceKeys, setHiddenCandidateEvidenceKeys] = useState<string[]>([]);
  const [screenshotNaturalSize, setScreenshotNaturalSize] = useState<{ width: number; height: number }>();
  const [manualLocatorKind, setManualLocatorKind] = useState<AssetRecordingLocatorKind>("visual_locator");
  const [manualSemanticAreaOverride, setManualSemanticAreaOverride] = useState<VisualSemanticArea>("content");
  const [manualElementSeed, setManualElementSeed] = useState<ManualElementSeed>();
  const [manualActionEdit, setManualActionEdit] = useState<EditableRegionOperation>();
  const [manualActionRegion, setManualActionRegion] = useState<AssetRecordingScreenshotRegion>();
  const [manualActionNaturalSize, setManualActionNaturalSize] = useState<{ width: number; height: number }>();
  const [isAddingPageElement, setIsAddingPageElement] = useState(false);
  const [editingPageElement, setEditingPageElement] = useState<AssetRecordingPageElement>();
  const screenshotImageLayerRef = useRef<HTMLDivElement>(null);
  const manualActionImageLayerRef = useRef<HTMLDivElement>(null);
  const hasSavedAsset = savedAssets.some((asset) => asset.id === page.nodeId || asset.key === page.targetRef);
  const saveMode: "create" | "update" = hasSavedAsset ? "update" : "create";
  const canSave = page.status !== "idle" && page.status !== "error";
  const title = page.pageName || page.visualPageName || "未知页面";
  const showPageElementForm = isAddingPageElement || Boolean(editingPageElement);
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

  function startManualActionRegion(event: PointerEvent<HTMLDivElement>) {
    if (!page.screenshotUrl) {
      return;
    }
    const point = pointerToPercent(event, manualActionImageLayerRef.current);
    const region = { id: "manual-action-region", label: "动作区域", x: point.x, y: point.y, width: 0, height: 0, coordinateSpace: "screen" as const };
    setManualActionEdit({ type: "draw", start: point, region });
    setManualActionRegion(region);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startMoveManualActionRegion(event: PointerEvent<HTMLSpanElement>) {
    if (!manualActionRegion) {
      return;
    }
    event.stopPropagation();
    const point = pointerToPercent(event as unknown as PointerEvent<HTMLDivElement>, manualActionImageLayerRef.current);
    setManualActionEdit({ type: "move", start: point, region: manualActionRegion });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startResizeManualActionRegion(handle: RegionResizeHandle, event: PointerEvent<HTMLSpanElement>) {
    if (!manualActionRegion) {
      return;
    }
    event.stopPropagation();
    const point = pointerToPercent(event as unknown as PointerEvent<HTMLDivElement>, manualActionImageLayerRef.current);
    setManualActionEdit({ type: "resize", handle, start: point, region: manualActionRegion });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateManualActionRegion(event: PointerEvent<HTMLDivElement>) {
    if (!manualActionEdit) {
      return;
    }
    const point = pointerToPercent(event, manualActionImageLayerRef.current);
    setManualActionRegion(updateEditableScreenshotRegion(manualActionEdit, point));
  }

  function finishManualActionRegion() {
    setManualActionEdit(undefined);
  }

  function startAddPageElement() {
    setEditingPageElement(undefined);
    setManualElementSeed(undefined);
    setManualLocatorKind("visual_locator");
    setManualSemanticAreaOverride("content");
    setManualActionRegion(undefined);
    setIsAddingPageElement(true);
  }

  function startPageElementFromEvidence(item: AssetEvidenceItem) {
    const label = evidenceDisplayValue(item);
    const region = evidenceRegionToScreenshotRegion(parseRegionBoundEvidence(item.value).region, label);
    if (!region) {
      return;
    }
    setEditingPageElement(undefined);
    setManualElementSeed({
      label,
      targetText: label,
      locatorKind: item.kind === "OCR 文字" ? "text_locator" : "visual_locator"
    });
    setManualLocatorKind(item.kind === "OCR 文字" ? "text_locator" : "visual_locator");
    setManualSemanticAreaOverride(region.semanticArea ?? semanticAreaForRegion(region));
    setManualActionRegion(region);
    setManualActionEdit(undefined);
    setIsAddingPageElement(true);
    setActiveDetailTab("actions");
  }

  function startEditPageElement(element: AssetRecordingPageElement) {
    setEditingPageElement(element);
    setManualElementSeed(undefined);
    const nextLocatorKind = element.locatorKind ?? locatorKindFromLocator(element.locator) ?? "visual_locator";
    setManualLocatorKind(nextLocatorKind);
    setManualSemanticAreaOverride(element.semanticArea ?? semanticAreaForLocator(element.locator) ?? defaultSemanticAreaForLocatorKind(nextLocatorKind));
    setManualActionRegion(
      element.region
        ? {
            id: "manual-action-region",
            label: "动作区域",
            ...element.region,
            semanticArea: element.semanticArea,
            coordinateSpace: element.coordinateSpace ?? "screen"
          }
        : undefined
    );
    setIsAddingPageElement(true);
  }

  function cancelManualPageElementEdit() {
    setEditingPageElement(undefined);
    setManualElementSeed(undefined);
    setManualActionRegion(undefined);
    setManualActionEdit(undefined);
    setManualLocatorKind("visual_locator");
    setManualSemanticAreaOverride("content");
    setIsAddingPageElement(false);
  }

  async function submitManualPageElement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const region = manualActionRegion ?? defaultRegionForLocatorKind(manualLocatorKind);
    if ((!region || region.width < 1 || region.height < 1) && locatorKindNeedsMarkedRegion(manualLocatorKind)) {
      return;
    }
    const form = new FormData(event.currentTarget);
    const draft = manualOperationDraftFromForm(form, {
      sourceNodeId: page.nodeId,
      ...(region ? { region } : {})
    });
    const saved = await onSavePageElement?.(draft);
    if (saved === false) {
      return;
    }
    setEditingPageElement(undefined);
    setManualElementSeed(undefined);
    setManualActionRegion(undefined);
    setManualActionEdit(undefined);
    setManualSemanticAreaOverride("content");
    setIsAddingPageElement(false);
  }

  function renderManualPageElementEditor() {
    const manualRegionRequired = locatorKindNeedsMarkedRegion(manualLocatorKind);
    const manualSemanticArea = manualActionRegion?.semanticArea ??
      (manualActionRegion ? semanticAreaForRegion(manualActionRegion) : manualSemanticAreaOverride);
    return (
      <div className="asset-manual-action-card">
        <div className="asset-manual-action-head">
          <div>
            <strong>{editingPageElement ? "编辑公共定位器" : "新增公共定位器"}</strong>
          </div>
          <button className="asset-page-name-action" type="button" disabled={busy} onClick={cancelManualPageElementEdit}>
            取消
          </button>
        </div>
        <div className="asset-manual-action-layout">
          <div className="asset-manual-action-region-pane">
            {page.screenshotUrl ? (
              <div
                className="asset-manual-action-frame"
                onPointerCancel={finishManualActionRegion}
                onPointerDown={startManualActionRegion}
                onPointerMove={updateManualActionRegion}
                onPointerUp={finishManualActionRegion}
              >
                <div className="asset-manual-action-image-layer" ref={manualActionImageLayerRef} style={screenshotImageLayerStyle(manualActionNaturalSize, 680)}>
                  <img
                    draggable={false}
                    src={page.screenshotUrl}
                    alt="当前页面操作标注截图"
                    onLoad={(event) => {
                      const image = event.currentTarget;
                      setManualActionNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
                    }}
                  />
                  {manualActionRegion ? (
                    <span
                      className="asset-manual-action-region"
                      onPointerDown={startMoveManualActionRegion}
                      style={{
                        left: `${manualActionRegion.x}%`,
                        top: `${manualActionRegion.y}%`,
                        width: `${manualActionRegion.width}%`,
                        height: `${manualActionRegion.height}%`
                      }}
                    >
                      <em>定位区域</em>
                      {regionResizeHandles.map((handle) => (
                        <span
                          aria-label={`调整动作区域 ${handle}`}
                          className={`asset-manual-action-handle ${handle}`}
                          key={handle}
                          onPointerDown={(event) => startResizeManualActionRegion(handle, event)}
                        />
                      ))}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="empty">识别当前页面后，先在截图上圈选操作区域，再在右侧选择动作方式。</div>
            )}
          </div>
          <div className="asset-manual-action-fields-pane">
            <form className="asset-element-actions asset-operation-editor asset-manual-action-form" key={editingPageElement?.id ?? editingPageElement?.locator ?? "new-page-element"} onSubmit={submitManualPageElement}>
              {editingPageElement?.id ? <input type="hidden" name="elementId" value={editingPageElement.id} /> : null}
              <label>
                定位方式
                <select
                  name="locatorKind"
                  value={manualLocatorKind}
                  onChange={(event) => {
                    const nextLocatorKind = readLocatorKind(event.target.value) ?? "visual_locator";
                    setManualLocatorKind(nextLocatorKind);
                    if (!manualActionRegion) {
                      setManualSemanticAreaOverride(defaultSemanticAreaForLocatorKind(nextLocatorKind));
                    }
                  }}
                >
                  <option value="visual_locator">视觉重定位</option>
                  <option value="text_locator">文字重定位</option>
                  <option value="structural_locator">结构型入口</option>
                  <option value="collection_item_locator">动态列表项</option>
                  <option value="top_bar_icon_locator">顶部栏图标</option>
                  <option value="ocr_anchor_offset">OCR 锚点偏移</option>
                </select>
              </label>
              <LocatorStrategyFields locatorKind={manualLocatorKind} element={editingPageElement ?? manualElementSeed} />
              <label>
                区域语义
                <select
                  aria-label="动作区域语义"
                  name="semanticArea"
                  disabled={!manualActionRegion && manualRegionRequired}
                  value={manualSemanticArea}
                  onChange={(event) => {
                    const nextSemanticArea = readVisualSemanticArea(event.target.value) ?? "unknown";
                    if (!manualActionRegion) {
                      setManualSemanticAreaOverride(nextSemanticArea);
                      return;
                    }
                    setManualActionRegion(applySemanticAreaOverrideToRegion(manualActionRegion, nextSemanticArea));
                  }}
                >
                  {semanticAreaOptions.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                定位器名称
                <input name="elementLabel" placeholder="例如：右上加号菜单 / 搜索按钮 / 班级列表" defaultValue={editingPageElement?.label ?? manualElementSeed?.label ?? "公共定位器"} />
              </label>
              <label>
                执行识别文字
                <input name="targetText" placeholder="可选，例如：学习方案" defaultValue={editingPageElement?.targetText ?? manualElementSeed?.targetText ?? ""} />
              </label>
              <label>
                动态区域处理
                <select name="dynamicMaskPreset" defaultValue={editingPageElement?.dynamicMasks?.length ? "avatar_text" : "none"}>
                  <option value="none">无动态 mask</option>
                  <option value="avatar_text">头像/昵称不参与强识别</option>
                </select>
              </label>
              {manualLocatorKind === "collection_item_locator" ? (
                <div className="asset-operation-inline-fields">
                  <label>
                    动态区域名
                    <input name="dynamicRegionLabel" placeholder="例如：班级列表" defaultValue="班级列表" />
                  </label>
                  <label>
                    列表模板名
                    <input name="itemTemplateLabel" placeholder="例如：班级卡片" defaultValue="班级卡片" />
                  </label>
                  <label>
                    参数名
                    <input name="parameterName" placeholder="例如：className" defaultValue="className" />
                  </label>
                </div>
              ) : null}
              {manualActionRegion && manualLocatorKind !== "collection_item_locator" ? (
                <div className="asset-operation-inline-fields">
                  <label>
                    点击点 X%
                    <input name="tapPointXPercent" type="number" min="0" max="100" step="0.1" defaultValue={editingPageElement?.tapPointPercent?.x ?? 50} />
                  </label>
                  <label>
                    点击点 Y%
                    <input name="tapPointYPercent" type="number" min="0" max="100" step="0.1" defaultValue={editingPageElement?.tapPointPercent?.y ?? 50} />
                  </label>
                </div>
              ) : null}
              {manualLocatorKind === "collection_item_locator" ? (
                <ScrollContainerEditor
                  profile={
                    editingPageElement?.scrollProfile ??
                    { containerKind: "grid_list", direction: "vertical", columns: 2, targetKind: "item_text", targetQuery: "{{className}}", failureStrategy: "try_next_candidate" }
                  }
                />
              ) : null}
              {pageElementSaveError ? (
                <div className="asset-form-error" role="alert">
                  {pageElementSaveError}
                </div>
              ) : null}
              <button type="submit" disabled={(!manualActionRegion && manualRegionRequired) || !onSavePageElement}>
                保存公共定位器
              </button>
            </form>
          </div>
        </div>
      </div>
    );
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
              <div><span>平台</span><strong>{libraryInitialization.platform === "android" ? "Android" : "iOS"}</strong></div>
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
            <div className="empty">切到资产录制页后会自动识别当前页面；也可以切换设备或操作页面后等待刷新。</div>
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
                <button className={detailTabClass(visibleDetailTab, "match")} type="button" role="tab" aria-selected={visibleDetailTab === "match"} onClick={() => setActiveDetailTab("match")}>
                  页面匹配
                </button>
                <button className={detailTabClass(visibleDetailTab, "actions")} type="button" role="tab" aria-selected={visibleDetailTab === "actions"} onClick={() => setActiveDetailTab("actions")}>
                  公共定位器
                </button>
              </div>

              <div className="asset-detail-scroll asset-editor-scroll">
                {visibleDetailTab === "match" ? (
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
                ) : null}

                {visibleDetailTab === "actions" ? (
                  <div className="asset-detail-section asset-elements-card">
                    {page.aiElementSuggestions?.length ? (
                      <section className="asset-ai-suggestions">
                        <div className="asset-action-summary">
                          <strong>AI 元素建议</strong>
                          <span>{page.aiElementSuggestions.length} 项，确认后保存为公共定位器</span>
                        </div>
                        <div className="asset-element-list">
                          {page.aiElementSuggestions.map((suggestion, index) => (
                            <div className="asset-saved-action-item" key={`ai-suggestion-${index}`}>
                              <div className="asset-element-row">
                                <div className="asset-element-summary">
                                  <strong>
                                    {suggestion.elementLabel}
                                    <span className={`asset-locator-kind-chip asset-locator-kind-${suggestion.locatorKind}`}>
                                      {AI_LOCATOR_KIND_LABELS[suggestion.locatorKind] ?? suggestion.locatorKind}
                                    </span>
                                    {suggestion.degradedFrom ? (
                                      <span className="asset-locator-kind-chip asset-locator-kind-degraded">
                                        由{AI_LOCATOR_KIND_LABELS[suggestion.degradedFrom] ?? suggestion.degradedFrom}降级
                                      </span>
                                    ) : null}
                                  </strong>
                                  <span>
                                    {suggestion.locator || "待生成定位证据"}
                                    {typeof suggestion.confidence === "number" ? ` · 置信度 ${Math.round(suggestion.confidence * 100)}%` : ""}
                                  </span>
                                  {suggestion.needsManualCompletion ? (
                                    <span className="asset-warning-text">证据不足，需人工补充：{suggestion.completionReason ?? "请人工完成录制"}</span>
                                  ) : null}
                                  {suggestion.riskNotes.length ? <span className="asset-warning-text">{suggestion.riskNotes.join("；")}</span> : null}
                                </div>
                                <button
                                  type="button"
                                  disabled={busy || !onSavePageElement || !page.nodeId || Boolean(suggestion.needsManualCompletion)}
                                  title={suggestion.needsManualCompletion ? suggestion.completionReason : undefined}
                                  onClick={() => void onSavePageElement?.(aiElementSuggestionToDraft(suggestion, page.nodeId))}
                                >
                                  {suggestion.needsManualCompletion ? "待人工补充" : "保存该元素"}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}
                    <section className="asset-saved-actions">
                      <div className="asset-action-summary">
                        <strong>已录入公共定位器</strong>
                        <span>{savedManualElements.length} 个定位器</span>
                      </div>
                      <PageElementHealthPanel elements={savedManualElements} />
                      {savedManualElements.length ? (
                        <div className="asset-element-list">
                          {savedManualElements.map((element, index) => (
                            <div className="asset-saved-action-item" key={`manual-${element.id ?? element.locator}-${index}`}>
                              <div className="asset-element-row asset-saved-action-row asset-saved-action-main">
                                <div className="asset-element-summary">
                                  <OperationRegionPreview element={element} screenshotUrl={page.screenshotUrl} />
                                  <div className="asset-operation-preview-info">
                                    <strong>{element.label}</strong>
                                    <ElementLocatorSummary element={element} />
                                    <small>{locatorKindLabel(element.locatorKind)} · {semanticAreaLabel(element.semanticArea ?? "unknown")}</small>
                                    <PageElementQualitySummary quality={element.quality} />
                                    <RawAssetDebug element={element} />
                                  </div>
                                </div>
                                <div className="asset-saved-action-controls">
                                  <button className="asset-action-button edit" type="button" disabled={busy} onClick={() => startEditPageElement(element)}>
                                    编辑
                                  </button>
                                  <button className="asset-action-button delete" type="button" disabled={busy || !element.id || !onDeletePageElement} onClick={() => void onDeletePageElement?.(element)}>
                                    删除
                                  </button>
                                </div>
                              </div>
                              {editingPageElement === element ? renderManualPageElementEditor() : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty">暂无公共定位器。临时动作可直接写在 ScriptFlow 中，无需预先录入。</div>
                      )}
                    </section>
                    <button className="asset-add-element-button" type="button" disabled={busy} onClick={startAddPageElement}>
                      + 添加公共定位器
                    </button>
                    {showPageElementForm && !editingPageElement ? renderManualPageElementEditor() : null}
                  </div>
                ) : null}

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

const regionResizeHandles: RegionResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

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

const defaultTopBarIconRegion = { x: 78, y: 0, width: 20, height: 12, semanticArea: "top" as const };

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

export function updateEditableScreenshotRegion(operation: EditableRegionOperation, point: PercentPoint): AssetRecordingScreenshotRegion {
  if (operation.type === "draw") {
    return normalizeRegion({
      ...operation.region,
      x: operation.start.x,
      y: operation.start.y,
      width: point.x - operation.start.x,
      height: point.y - operation.start.y
    });
  }
  if (operation.type === "move") {
    const deltaX = point.x - operation.start.x;
    const deltaY = point.y - operation.start.y;
    const moved = {
      ...operation.region,
      x: roundPercent(clamp(operation.region.x + deltaX, 0, 100 - operation.region.width)),
      y: roundPercent(clamp(operation.region.y + deltaY, 0, 100 - operation.region.height))
    };
    return {
      ...moved,
      semanticArea: semanticAreaForRegion(moved),
      coordinateSpace: moved.coordinateSpace ?? "screen"
    };
  }
  return resizeEditableRegion(operation.region, operation.handle, point);
}

function resizeEditableRegion(region: AssetRecordingScreenshotRegion, handle: RegionResizeHandle, point: PercentPoint): AssetRecordingScreenshotRegion {
  const minSize = 1;
  let left = region.x;
  let top = region.y;
  let right = region.x + region.width;
  let bottom = region.y + region.height;
  if (handle.includes("w")) {
    left = clamp(point.x, 0, right - minSize);
  }
  if (handle.includes("e")) {
    right = clamp(point.x, left + minSize, 100);
  }
  if (handle.includes("n")) {
    top = clamp(point.y, 0, bottom - minSize);
  }
  if (handle.includes("s")) {
    bottom = clamp(point.y, top + minSize, 100);
  }
  const resized = {
    ...region,
    x: roundPercent(left),
    y: roundPercent(top),
    width: roundPercent(right - left),
    height: roundPercent(bottom - top)
  };
  return {
    ...resized,
    semanticArea: semanticAreaForRegion(resized),
    coordinateSpace: resized.coordinateSpace ?? "screen"
  };
}

function PageElementHealthPanel({ elements }: { elements: AssetRecordingPageElement[] }) {
  const passedCount = elements.filter((element) => element.quality?.status === "pass").length;
  const reviewCount = elements.filter((element) => element.quality?.status === "needs_review").length;
  const failedCount = elements.filter((element) => element.quality?.status === "fail").length;
  return (
    <div className="asset-locator-workbench-panel">
      <div className="asset-locator-workbench-head">
        <div>
          <strong>公共定位器</strong>
          <span>只保存可跨脚本复用的视觉或文字目标；具体动作与流程由 ScriptFlow 定义。</span>
        </div>
      </div>
      <div className="asset-page-health-panel">
        <div>
          <span>定位器</span>
          <strong>{elements.length}</strong>
        </div>
        <div>
          <span>已校验</span>
          <strong>{passedCount}</strong>
        </div>
        <div>
          <span>需复核</span>
          <strong>{reviewCount + failedCount}</strong>
        </div>
      </div>
    </div>
  );
}

function ElementLocatorSummary({ element }: { element: AssetRecordingPageElement }) {
  const summary = pageElementLocatorStrategySummary(element);
  return (
    <div className="asset-locator-summary">
      <div className="asset-locator-title-row">
        <strong>策略：{summary.strategyLabel}</strong>
      </div>
      <div className="asset-locator-instruction-list">
        <div>
          <span>语义目标</span>
          <strong>{summary.findInstruction}</strong>
        </div>
        <div>
          <span>当前截图</span>
          <strong>{summary.previewStatusLabel}</strong>
        </div>
        <div>
          <span>执行动作</span>
          <strong>{summary.executionInstruction}</strong>
        </div>
      </div>
      <small className="asset-locator-click-point">点击点：{summary.clickPointLabel}</small>
      <details className="asset-locator-preview-details">
        <summary>定位预览</summary>
        <div>
          <strong>{summary.previewDetail}</strong>
          <span>识别区域：{summary.regionLabel}</span>
          <span>使用证据：{summary.evidenceLabel}</span>
        </div>
      </details>
    </div>
  );
}

function RawAssetDebug({ element }: { element: AssetRecordingPageElement }) {
  return (
    <details className="asset-raw-debug">
      <summary>原始资产 / 高级调试</summary>
      <pre>{JSON.stringify(rawAssetDebugPayload(element), undefined, 2)}</pre>
    </details>
  );
}

function LocatorStrategyFields({
  locatorKind,
  element
}: {
  locatorKind: AssetRecordingLocatorKind;
  element?: Partial<AssetRecordingPageElement> & ManualElementSeed;
}) {
  if (locatorKind === "top_bar_icon_locator") {
    return (
      <div className="asset-strategy-fields">
        <div>
          <strong>顶部栏图标策略</strong>
          <span>按当前截图中的顶部图标候选重定位，点击点由运行时结果计算。</span>
        </div>
        <div className="asset-operation-inline-fields">
          <label>
            图标语义
            <input name="topBarIconRole" placeholder="例如：search / add / more" defaultValue={topBarIconRoleFromElement(element)} />
          </label>
          <label>
            顶部栏位置
            <select name="topBarIconSlot" defaultValue={topBarIconSlotFromElement(element)}>
              <option value="right">右侧操作区</option>
              <option value="left">左侧返回区</option>
            </select>
          </label>
          <label>
            右侧顺序
            <input name="topBarIconOrderFromRight" type="number" min="1" step="1" defaultValue={topBarIconOrderFromRight(element) ?? 1} />
          </label>
        </div>
      </div>
    );
  }
  if (locatorKind === "text_locator") {
    return (
      <div className="asset-strategy-fields">
        <strong>OCR 文字策略</strong>
        <span>运行时先在当前截图中找匹配文字，再按文字框或相邻区域计算点击点。</span>
      </div>
    );
  }
  if (locatorKind === "structural_locator") {
    return (
      <div className="asset-strategy-fields">
        <strong>结构上下文策略</strong>
        <span>用圈选区域内的稳定文本、图标、相邻关系描述入口，不把头像/昵称等动态内容作为强识别。</span>
      </div>
    );
  }
  if (locatorKind === "collection_item_locator") {
    return (
      <div className="asset-strategy-fields">
        <strong>列表模板策略</strong>
        <span>先定位列表区域，再按参数找到目标 item，最后点击 item 内动作区域。</span>
      </div>
    );
  }
  if (locatorKind === "ocr_anchor_offset") {
    return (
      <div className="asset-strategy-fields">
        <strong>OCR 锚点偏移策略</strong>
        <span>先找稳定锚点文字，再按相对方向和偏移定位目标区域。</span>
      </div>
    );
  }
  return (
    <div className="asset-strategy-fields">
      <strong>视觉模板策略</strong>
      <span>保留圈选 crop、动态 mask 和搜索范围，运行时按视觉模板重新找候选。</span>
    </div>
  );
}

function OperationRegionPreview({ element, screenshotUrl }: { element: AssetRecordingPageElement; screenshotUrl?: string }) {
  if (screenshotUrl && element.region) {
    const frame = operationPreviewFrame(element.region, element.previewCrop, element.viewport);
    return (
      <div className="asset-operation-preview" aria-label={`${element.label} 当前操作区域`}>
        <div className="asset-operation-preview-stage" style={{ aspectRatio: frame.aspectRatio }}>
          <img className="asset-operation-preview-image" draggable={false} src={screenshotUrl} alt={`${element.label} 当前操作区域`} style={frame.imageStyle} />
          <span className="asset-operation-preview-region" style={frame.regionStyle} />
        </div>
        <b>当前操作区域</b>
      </div>
    );
  }
  if (isRuntimeLocatedElement(element)) {
    return (
      <div className="asset-operation-preview runtime" aria-label={`${element.label} 运行时定位`}>
        <b>运行时定位</b>
        <small>{runtimeLocatorSummary(element)}</small>
      </div>
    );
  }
  return <small className="asset-operation-preview-missing">未采集到控件位置</small>;
}

function isRuntimeLocatedElement(element: AssetRecordingPageElement): boolean {
  return element.coordinateSpace === "runtime" ||
    element.locator.startsWith("runtime-locator:") ||
    element.locator.startsWith("top-bar-icon:") ||
    element.locator.startsWith("ocr-anchor:") ||
    element.locatorKind === "structural_locator" ||
    element.locatorKind === "top_bar_icon_locator" ||
    element.locatorKind === "ocr_anchor_offset";
}

function runtimeLocatorSummary(element: AssetRecordingPageElement): string {
  if (element.locatorKind === "top_bar_icon_locator" || element.locator.startsWith("top-bar-icon:")) {
    return topBarIconRoleFromElement(element) || "顶部栏图标";
  }
  const role = typeof element.structuralLocator?.role === "string" ? element.structuralLocator.role : undefined;
  if (element.targetText && role) {
    return `${element.targetText} · ${role}`;
  }
  return element.targetText ?? role ?? "运行时按 OCR / 结构证据重定位";
}

function runtimeLocatorSummaryForWorkbench(element: AssetRecordingPageElement): string {
  if (isRuntimeLocatedElement(element)) {
    return runtimeLocatorSummary(element);
  }
  if (element.locatorKind === "text_locator" && element.targetText) {
    return `运行时按文字 "${element.targetText}" 重定位`;
  }
  if (element.locatorKind === "collection_item_locator") {
    return element.scrollProfile?.targetQuery ? `按列表模板查找 ${element.scrollProfile.targetQuery}` : "按动态列表模板查找目标 item";
  }
  return "按 OCR / 视觉 crop / 上下文证据重定位";
}

function locatorKindLabel(kind?: AssetRecordingLocatorKind): string {
  if (kind === "text_locator") {
    return "文字重定位";
  }
  if (kind === "top_bar_icon_locator") {
    return "顶部栏图标";
  }
  if (kind === "ocr_anchor_offset") {
    return "OCR 锚点偏移";
  }
  if (kind === "structural_locator") {
    return "结构上下文";
  }
  if (kind === "collection_item_locator") {
    return "列表模板";
  }
  return "视觉重定位";
}

function pageElementLocatorStrategySummary(element: AssetRecordingPageElement): {
  strategyLabel: string;
  regionLabel: string;
  evidenceLabel: string;
  previewStatusLabel: string;
  previewDetail: string;
  findInstruction: string;
  executionInstruction: string;
  clickPointLabel: string;
} {
  const locatorKind = element.locatorKind ?? locatorKindFromLocator(element.locator) ?? "visual_locator";
  const candidateCount = element.quality?.candidates?.length ?? 0;
  return {
    strategyLabel: locatorKindLabel(locatorKind),
    regionLabel: semanticAreaLabel(element.semanticArea ?? semanticAreaForLocator(element.locator) ?? "unknown"),
    evidenceLabel: locatorEvidenceLabel(locatorKind),
    previewStatusLabel: pageElementPreviewStatusLabel(element),
    previewDetail: candidateCount ? `当前记录了 ${candidateCount} 个候选，执行时会重新在实时截图里计算。` : "暂无候选详情，执行时会按定位方式重新查找。",
    findInstruction: pageElementFindInstruction(element, locatorKind),
    executionInstruction: pageElementExecutionInstruction(element),
    clickPointLabel: pageElementClickPointInstruction(element)
  };
}

function pageElementFindInstruction(element: AssetRecordingPageElement, locatorKind: AssetRecordingLocatorKind): string {
  if (locatorKind === "top_bar_icon_locator" || element.locator.startsWith("top-bar-icon:")) {
    const slotLabel = topBarIconSlotFromElement(element) === "left" ? "左侧" : "右侧";
    const order = topBarIconOrderFromRight(element);
    const orderLabel = order ? `第 ${order} 个 ` : "";
    const role = topBarIconRoleFromElement(element) || element.label || "目标";
    return `找顶部栏${slotLabel}${orderLabel}${role} 图标`;
  }
  if (locatorKind === "text_locator") {
    return `找文字 "${element.targetText || element.label}"`;
  }
  if (locatorKind === "collection_item_locator") {
    return `在列表里找 "${element.scrollProfile?.targetQuery || element.label}"`;
  }
  if (locatorKind === "ocr_anchor_offset") {
    return `先找锚点 "${element.targetText || element.label}"，再按相对位置找目标`;
  }
  if (locatorKind === "structural_locator") {
    return `按稳定文字、图标和相邻关系找 "${element.label}"`;
  }
  return `按视觉特征重新找 "${element.label}"`;
}

function pageElementExecutionInstruction(element: AssetRecordingPageElement): string {
  return element.locatorKind === "collection_item_locator"
    ? "运行时查找列表项，具体动作由 ScriptFlow 决定"
    : "运行时重新定位，具体动作由 ScriptFlow 决定";
}

function pageElementClickPointInstruction(element: AssetRecordingPageElement): string {
  if (isRuntimeLocatedElement(element)) {
    return "运行时计算";
  }
  if (element.tapPointPercent) {
    return "由重定位候选内安全点计算";
  }
  return "由 OCR / 视觉 / 结构候选计算";
}

function locatorEvidenceLabel(locatorKind: AssetRecordingLocatorKind): string {
  if (locatorKind === "top_bar_icon_locator") {
    return "图标候选 + 顶部栏约束";
  }
  if (locatorKind === "text_locator") {
    return "OCR 文字";
  }
  if (locatorKind === "structural_locator") {
    return "OCR / 结构上下文";
  }
  if (locatorKind === "collection_item_locator") {
    return "动态区域 / 列表模板";
  }
  if (locatorKind === "ocr_anchor_offset") {
    return "OCR 锚点 + 相对偏移";
  }
  return "视觉 crop / 模板";
}

function pageElementPreviewStatusLabel(element: AssetRecordingPageElement): string {
  if (!element.quality) {
    return isRuntimeLocatedElement(element) ? "等待当前截图预览" : "未校验";
  }
  if (element.quality.status === "pass") {
    return "当前截图可定位";
  }
  if (element.quality.status === "needs_review") {
    return "多候选，建议复核";
  }
  return "当前截图找不到";
}

function rawAssetDebugPayload(element: AssetRecordingPageElement): Record<string, unknown> {
  return {
    label: element.label,
    locatorKind: element.locatorKind,
    locator: element.locator,
    role: topBarIconRoleFromElement(element) || undefined,
    semanticArea: element.semanticArea,
    coordinateSpace: element.coordinateSpace,
    targetText: element.targetText,
    tapPointPercent: element.tapPointPercent,
    structuralLocator: element.structuralLocator,
    visualLocator: element.visualLocator,
    dynamicMasks: element.dynamicMasks,
    dynamicRegionId: element.dynamicRegionId,
    itemTemplateId: element.itemTemplateId
  };
}

function locatorKindFromLocator(locator: string): AssetRecordingLocatorKind | undefined {
  if (locator.startsWith("top-bar-icon:")) {
    return "top_bar_icon_locator";
  }
  if (locator.startsWith("ocr-anchor:")) {
    return "ocr_anchor_offset";
  }
  if (locator.startsWith("text:")) {
    return "text_locator";
  }
  if (locator.startsWith("runtime-locator:")) {
    return "structural_locator";
  }
  return undefined;
}

function topBarIconRoleFromElement(element?: Partial<AssetRecordingPageElement> & ManualElementSeed): string {
  const structuralRole = typeof element?.structuralLocator?.role === "string" ? element.structuralLocator.role : undefined;
  const locatorRole = typeof element?.locator === "string" && element.locator.startsWith("top-bar-icon:")
    ? element.locator.replace(/^top-bar-icon:\s*/, "").trim()
    : undefined;
  return structuralRole || locatorRole || iconRoleFromText(element?.targetText || element?.label || "");
}

function topBarIconSlotFromElement(element?: Partial<AssetRecordingPageElement>): "left" | "right" {
  return element?.structuralLocator?.slot === "left" ? "left" : "right";
}

function topBarIconOrderFromRight(element?: Partial<AssetRecordingPageElement>): number | undefined {
  const value = element?.structuralLocator?.orderFromRight;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function iconRoleFromText(value: string): string {
  const text = value.trim().toLowerCase();
  if (!text) {
    return "";
  }
  const knownRoles: Array<[string, string]> = [
    ["搜索", "search"],
    ["search", "search"],
    ["添加", "add"],
    ["add", "add"],
    ["加号", "add"],
    ["更多", "more"],
    ["more", "more"],
    ["返回", "back"],
    ["back", "back"],
    ["关闭", "close"],
    ["close", "close"]
  ];
  return knownRoles.find(([keyword]) => text.includes(keyword))?.[1] ?? slugForAsset(text);
}

function locatorKindNeedsMarkedRegion(locatorKind: AssetRecordingLocatorKind): boolean {
  return locatorKind !== "top_bar_icon_locator" && locatorKind !== "text_locator";
}

function defaultRegionForLocatorKind(locatorKind: AssetRecordingLocatorKind): Pick<AssetRecordingScreenshotRegion, "x" | "y" | "width" | "height" | "semanticArea"> | undefined {
  return locatorKind === "top_bar_icon_locator" ? defaultTopBarIconRegion : undefined;
}

function defaultSemanticAreaForLocatorKind(locatorKind: AssetRecordingLocatorKind): VisualSemanticArea {
  if (locatorKind === "top_bar_icon_locator") {
    return "top";
  }
  if (locatorKind === "text_locator") {
    return "content";
  }
  return "unknown";
}

function summarizeV2ElementQuality(elements: AssetRecordingPageElement[]): { reviewCount: number } {
  return {
    reviewCount: elements.filter((element) => element.quality?.status === "needs_review" || element.quality?.status === "fail").length
  };
}

export function operationPreviewFrame(
  region: NonNullable<AssetRecordingPageElement["region"]>,
  crop?: AssetRecordingPageElement["previewCrop"],
  viewport?: AssetRecordingPageElement["viewport"]
) {
  const previewCrop = crop ?? autoPreviewCrop(region, viewport);
  const cropX = clamp(previewCrop.x);
  const cropY = clamp(previewCrop.y);
  const cropWidth = clamp(previewCrop.width, 1, 100 - cropX);
  const cropHeight = clamp(previewCrop.height, 1, 100 - cropY);
  const frameWidth = viewport?.width ? (cropWidth / 100) * viewport.width : cropWidth;
  const frameHeight = viewport?.height ? (cropHeight / 100) * viewport.height : cropHeight;
  return {
    aspectRatio: `${formatStyleNumber(frameWidth)} / ${formatStyleNumber(frameHeight)}`,
    imageStyle: {
      left: `${formatStyleNumber((-cropX / cropWidth) * 100)}%`,
      top: `${formatStyleNumber((-cropY / cropHeight) * 100)}%`,
      width: `${formatStyleNumber((100 / cropWidth) * 100)}%`,
      height: `${formatStyleNumber((100 / cropHeight) * 100)}%`
    },
    regionStyle: {
      left: `${formatStyleNumber(((region.x - cropX) / cropWidth) * 100)}%`,
      top: `${formatStyleNumber(((region.y - cropY) / cropHeight) * 100)}%`,
      width: `${formatStyleNumber((region.width / cropWidth) * 100)}%`,
      height: `${formatStyleNumber((region.height / cropHeight) * 100)}%`
    }
  };
}

function autoPreviewCrop(
  region: NonNullable<AssetRecordingPageElement["region"]>,
  viewport?: AssetRecordingPageElement["viewport"]
): NonNullable<AssetRecordingPageElement["previewCrop"]> {
  const minWidth = 38;
  const minHeight = 17;
  const width = Math.min(100, Math.max(minWidth, region.width * 3));
  const height = Math.min(100, Math.max(minHeight, region.height * 3));
  const x = clamp(region.x + region.width / 2 - width / 2, 0, 100 - width);
  const y = clamp(region.y + region.height / 2 - height / 2, 0, 100 - height);
  if (!viewport?.width || !viewport.height) {
    return { x, y, width, height };
  }
  return { x, y, width, height };
}

function formatStyleNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function PageElementQualitySummary({ quality }: { quality?: AssetRecordingPageElementQuality }) {
  if (!quality) {
    return null;
  }
  const firstWarning = quality.warnings.find((warning) => warning.severity === "error" || warning.severity === "warning");
  return (
    <div className={`asset-element-quality ${quality.status}`}>
      <span>定位质量</span>
      <strong>{pageElementQualityStatusLabel(quality.status)} · {Math.round(quality.score * 100)}%</strong>
      {firstWarning ? <small>{firstWarning.message}</small> : null}
    </div>
  );
}

function ScrollContainerEditor({ profile }: { profile?: AssetRecordingScrollProfile }) {
  return (
    <fieldset className="asset-scroll-editor">
      <legend>动态列表定位</legend>
      <label>
        容器类型
        <select name="containerKind" defaultValue={profile?.containerKind ?? "grid_list"}>
          <option value="list">单列列表</option>
          <option value="grid_list">两列网格列表</option>
          <option value="tab_bar">横向 TabBar</option>
          <option value="carousel">横向卡片 / 轮播</option>
          <option value="scroll_area">普通滚动区域</option>
        </select>
      </label>
      <label>
        滚动方向
        <select name="scrollDirection" defaultValue={profile?.direction ?? "vertical"}>
          <option value="vertical">纵向</option>
          <option value="horizontal">横向</option>
        </select>
      </label>
      <label>
        布局列数
        <input name="layoutColumns" type="number" min="1" max="6" defaultValue={profile?.columns ?? 2} />
      </label>
      <label>
        候选高度占容器百分比
        <input name="candidateItemHeightPercent" type="number" min="1" max="100" step="0.1" defaultValue={profile?.candidateItemHeightPercent ?? ""} placeholder="例如：24.5" />
      </label>
      <label>
        点击安全点 X%
        <input name="clickSafeXPercent" type="number" min="0" max="100" step="0.1" defaultValue={profile?.clickSafePoint?.xPercent ?? 50} />
      </label>
      <label>
        点击安全点 Y%
        <input name="clickSafeYPercent" type="number" min="0" max="100" step="0.1" defaultValue={profile?.clickSafePoint?.yPercent ?? 28} />
      </label>
      <label>
        滑动步长%
        <input name="scrollStepPercent" type="number" min="10" max="100" step="1" defaultValue={profile?.scrollStepPercent ?? 65} />
      </label>
      <label>
        失败策略
        <select name="candidateFailureStrategy" defaultValue={profile?.failureStrategy ?? "try_next_candidate"}>
          <option value="try_next_candidate">尝试下一个候选</option>
          <option value="back_and_try_next_candidate">返回后尝试下一个候选</option>
          <option value="none">不自动重试</option>
        </select>
      </label>
      <label>
        目标匹配
        <select name="targetKind" defaultValue={profile?.targetKind ?? "item_text"}>
          <option value="item_text">item 文案</option>
          <option value="ocr_text">OCR 文案</option>
          <option value="semantic_label">语义名称</option>
          <option value="nth_item">第 N 个 item</option>
          <option value="image_region">图像区域</option>
        </select>
      </label>
      <label className="asset-operation-target">
        目标 item 文案 / OCR / 语义名
        <input name="targetQuery" defaultValue={profile?.targetQuery ?? ""} placeholder="例如：{{className}} / 班级四十一号" />
      </label>
    </fieldset>
  );
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function detailTabClass(activeTab: AssetDetailTab, tab: AssetDetailTab): string {
  return activeTab === tab ? "asset-detail-tab active" : "asset-detail-tab";
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

function evidenceRegionToScreenshotRegion(regionText: string | undefined, label: string): AssetRecordingScreenshotRegion | undefined {
  if (!regionText) {
    return undefined;
  }
  const [x, y, width, height] = regionText.split(",").map((part) => Number(part.trim()));
  if (![x, y, width, height].every(Number.isFinite)) {
    return undefined;
  }
  const region = {
    id: "manual-action-region",
    label,
    x: roundPercent(clamp(x)),
    y: roundPercent(clamp(y)),
    width: roundPercent(clamp(width, 0, 100 - clamp(x))),
    height: roundPercent(clamp(height, 0, 100 - clamp(y))),
    coordinateSpace: "screen" as const
  };
  return {
    ...region,
    semanticArea: semanticAreaForRegion(region)
  };
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

function readFormString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveInteger(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export function manualOperationDraftFromForm(
  input: FormData | Record<string, FormDataEntryValue | string | undefined>,
  context: { sourceNodeId?: string; region?: Pick<AssetRecordingScreenshotRegion, "x" | "y" | "width" | "height" | "semanticArea"> }
): AssetRecordingPageElementDraft {
  const get = (name: string) => (input instanceof FormData ? input.get(name) : input[name] ?? null);
  const elementLabel = readFormString(get("elementLabel")) ?? "公共定位器";
  const tapPointPercent = readTapPointPercent(input);
  const locatorKind = readLocatorKind(get("locatorKind")) ?? "visual_locator";
  const targetText = readFormString(get("targetText"));
  const dynamicMasks = context.region ? dynamicMasksForPreset(get("dynamicMaskPreset"), context.region) : undefined;
  const semanticArea = readVisualSemanticArea(get("semanticArea")) ??
    context.region?.semanticArea ??
    (context.region ? semanticAreaForRegion(context.region) : defaultSemanticAreaForLocatorKind(locatorKind));
  if (locatorKind === "top_bar_icon_locator") {
    const region = context.region ?? defaultTopBarIconRegion;
    const role = readFormString(get("topBarIconRole")) ?? (iconRoleFromText(elementLabel) || "unknown");
    const slot = readTopBarIconSlot(get("topBarIconSlot"));
    const orderFromRight = readPositiveInteger(get("topBarIconOrderFromRight"));
    return {
      elementId: readFormString(get("elementId")),
      sourceNodeId: context.sourceNodeId,
      locator: `top-bar-icon:${role}`,
      semanticArea: "top",
      coordinateSpace: "runtime",
      elementLabel,
      locatorKind,
      ...(targetText ? { targetText } : {}),
      structuralLocator: {
        kind: "top_bar_icon",
        role,
        slot,
        ...(orderFromRight ? { orderFromRight } : {}),
        regionConstraint: { semanticArea: "top", region }
      },
      visualLocator: {
        strategy: "top_bar_icon_shape",
        role,
        slot,
        ...(orderFromRight ? { orderFromRight } : {}),
        searchRegion: region,
        candidates: [
          {
            source: "manual_top_bar_icon",
            label: elementLabel,
            role,
            slot,
            score: 0.85,
            region,
            semanticArea: "top"
          }
        ]
      }
    };
  }
  if (locatorKind === "text_locator") {
    const textTarget = targetText || elementLabel;
    return {
      elementId: readFormString(get("elementId")),
      sourceNodeId: context.sourceNodeId,
      locator: `text:${textTarget}`,
      semanticArea,
      coordinateSpace: "runtime",
      elementLabel,
      locatorKind,
      targetText: textTarget,
      structuralLocator: {
        kind: "ocr_text",
        role: "text_target",
        text: textTarget,
        semanticArea,
        ...(context.region ? { regionConstraint: { semanticArea, region: context.region } } : {})
      },
      ...(context.region
        ? {
            visualLocator: {
              strategy: "ocr_text",
              targetText: textTarget,
              searchRegion: context.region
            }
          }
        : {})
    };
  }
  if (!context.region) {
    throw new Error("marked region is required for this locator kind");
  }
  const structuralLocator = locatorKind === "structural_locator" ? structuralLocatorForRegion(context.region, elementLabel) : undefined;
  const collectionModel = locatorKind === "collection_item_locator"
    ? collectionModelFromForm(input, context.region, elementLabel, context.sourceNodeId)
    : undefined;
  return {
    elementId: readFormString(get("elementId")),
    sourceNodeId: context.sourceNodeId,
    locator: imageRegionLocator(context.region),
    semanticArea,
    coordinateSpace: "screen",
    elementLabel,
    locatorKind,
    ...(targetText ? { targetText } : {}),
    ...(tapPointPercent ? { tapPointPercent } : {}),
    ...(dynamicMasks?.length ? { dynamicMasks } : {}),
    ...(structuralLocator ? { structuralLocator } : {}),
    ...(collectionModel ? {
      dynamicRegion: collectionModel.dynamicRegion,
      itemTemplate: collectionModel.itemTemplate
    } : {}),
    ...(locatorKind === "collection_item_locator" ? { scrollProfile: readScrollProfile(input) } : {})
  };
}

function readLocatorKind(value: FormDataEntryValue | null): AssetRecordingLocatorKind | undefined {
  return value === "text_locator" ||
    value === "visual_locator" ||
    value === "structural_locator" ||
    value === "collection_item_locator" ||
    value === "top_bar_icon_locator" ||
    value === "ocr_anchor_offset"
    ? value
    : undefined;
}

function readTopBarIconSlot(value: FormDataEntryValue | null): "left" | "right" {
  return value === "left" ? "left" : "right";
}

function structuralLocatorForRegion(
  region: Pick<AssetRecordingScreenshotRegion, "x" | "y" | "width" | "height" | "semanticArea">,
  label: string
): Record<string, unknown> {
  return {
    kind: "marked_row",
    role: "list_item",
    label,
    indexHint: {
      semanticArea: region.semanticArea ?? semanticAreaForRegion(region),
      order: 0
    },
    stableAnchors: [
      {
        kind: "row_bounds",
        region: { x: region.x, y: region.y, width: region.width, height: region.height }
      }
    ]
  };
}

function dynamicMasksForPreset(
  value: FormDataEntryValue | null,
  region: Pick<AssetRecordingScreenshotRegion, "x" | "y" | "width" | "height">
): AssetRecordingDynamicMask[] | undefined {
  if (value !== "avatar_text") {
    return undefined;
  }
  return [
    {
      kind: "avatar",
      label: "头像",
      region: {
        x: roundRegion(region.x + region.width * 0.02),
        y: roundRegion(region.y + region.height * 0.1),
        width: roundRegion(region.width * 0.16),
        height: roundRegion(region.height * 0.8)
      },
      reason: "personalized_visual"
    },
    {
      kind: "text",
      label: "动态文本",
      region: {
        x: roundRegion(region.x + region.width * 0.2),
        y: roundRegion(region.y + region.height * 0.1),
        width: roundRegion(region.width * 0.5),
        height: roundRegion(region.height * 0.8)
      },
      reason: "personalized_text"
    }
  ];
}

function collectionModelFromForm(
  input: FormData | Record<string, FormDataEntryValue | string | undefined>,
  region: Pick<AssetRecordingScreenshotRegion, "x" | "y" | "width" | "height">,
  elementLabel: string,
  sourceNodeId: string | undefined
): {
  dynamicRegion: Record<string, unknown>;
  itemTemplate: Record<string, unknown>;
} {
  const get = (name: string) => (input instanceof FormData ? input.get(name) : input[name] ?? null);
  const dynamicRegionLabel = readFormString(get("dynamicRegionLabel")) ?? elementLabel;
  const itemTemplateLabel = readFormString(get("itemTemplateLabel")) ?? `${dynamicRegionLabel}项`;
  const parameterName = readFormString(get("parameterName")) ?? "itemText";
  const baseSlug = slugForAsset(`${sourceNodeId ?? "page"}-${dynamicRegionLabel}`);
  const itemTemplateId = `item_template_${baseSlug}`;
  return {
    dynamicRegion: {
      id: `dynamic_region_${baseSlug}`,
      label: dynamicRegionLabel,
      kind: "grid",
      region: { x: region.x, y: region.y, width: region.width, height: region.height },
      itemTemplateId,
      dynamicFieldRules: [
        { name: parameterName, source: "ocr_text", role: "title" }
      ]
    },
    itemTemplate: {
      id: itemTemplateId,
      label: itemTemplateLabel,
      region: { x: region.x, y: region.y, width: roundRegion(region.width / 2), height: roundRegion(region.height / 3) },
      actionArea: { x: region.x, y: region.y, width: roundRegion(region.width / 2), height: roundRegion(region.height / 3) },
      dynamicFields: [
        { name: parameterName, role: "title" }
      ],
      stableStructure: {
        source: "manual_marked_collection"
      }
    }
  };
}

function slugForAsset(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

function roundRegion(value: number): number {
  return Math.round(value * 100) / 100;
}

function readTapPointPercent(input: FormData | Record<string, FormDataEntryValue | string | undefined>): { x: number; y: number } | undefined {
  const get = (name: string) => (input instanceof FormData ? input.get(name) : input[name] ?? null);
  const x = readPercentNumber(get("tapPointXPercent"));
  const y = readPercentNumber(get("tapPointYPercent"));
  if (x === undefined || y === undefined) {
    return undefined;
  }
  return { x, y };
}

function imageRegionLocator(region: Pick<AssetRecordingScreenshotRegion, "x" | "y" | "width" | "height">): string {
  return `image-region:${formatRegionNumber(region.x)},${formatRegionNumber(region.y)},${formatRegionNumber(region.width)},${formatRegionNumber(region.height)}`;
}

function semanticAreaForLocator(locator: string): VisualSemanticArea | undefined {
  if (!locator.startsWith("image-region:")) {
    return undefined;
  }
  const parts = locator
    .replace(/^image-region:\s*/, "")
    .split(",")
    .map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  const [x, y, width, height] = parts;
  return semanticAreaForRegion({ x, y, width, height });
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

function semanticAreaLabel(area: VisualSemanticArea): string {
  if (area === "top") {
    return "顶部标题栏区域";
  }
  if (area === "bottom") {
    return "底部固定区域";
  }
  if (area === "content") {
    return "中间内容区域";
  }
  return "未知区域";
}

function formatRegionNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function pageElementQualityStatusLabel(status: AssetRecordingPageElementQuality["status"]): string {
  if (status === "pass") {
    return "通过";
  }
  if (status === "fail") {
    return "不可用";
  }
  return "建议复核";
}

function readScrollProfile(input: FormData | Record<string, FormDataEntryValue | string | undefined>): AssetRecordingScrollProfile {
  const get = (name: string) => (input instanceof FormData ? input.get(name) : input[name] ?? null);
  return {
    containerKind: readScrollContainerKind(get("containerKind"), true),
    direction: readScrollDirection(get("scrollDirection")),
    columns: readColumns(get("layoutColumns")) ?? 2,
    targetKind: readScrollTargetKind(get("targetKind"), true, false),
    targetQuery: readFormString(get("targetQuery")),
    ...readCandidateProfile(input, true)
  };
}

function readScrollContainerKind(value: FormDataEntryValue | null, preferGrid = false): AssetRecordingScrollProfile["containerKind"] {
  return value === "grid_list" || value === "tab_bar" || value === "carousel" || value === "scroll_area" ? value : preferGrid ? "grid_list" : "list";
}

function readScrollDirection(value: FormDataEntryValue | null): AssetRecordingScrollProfile["direction"] {
  return value === "horizontal" ? "horizontal" : "vertical";
}

function readScrollTargetKind(value: FormDataEntryValue | null, preferNth = false, preferImage = false): AssetRecordingScrollProfile["targetKind"] {
  return value === "item_text" || value === "ocr_text" || value === "semantic_label" || value === "nth_item" || value === "image_region" ? value : preferNth ? "nth_item" : preferImage ? "image_region" : "item_text";
}

function readColumns(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 1) {
    return undefined;
  }
  return Math.min(6, Math.floor(numberValue));
}

function readCandidateProfile(input: FormData | Record<string, FormDataEntryValue | string | undefined>, includeGridDefaults: boolean): Pick<AssetRecordingScrollProfile, "candidateItemHeightPercent" | "clickSafePoint" | "scrollStepPercent" | "failureStrategy"> {
  const get = (name: string) => (input instanceof FormData ? input.get(name) : input[name] ?? null);
  return {
    ...(includeGridDefaults ? { candidateItemHeightPercent: readPercentNumber(get("candidateItemHeightPercent")) } : {}),
    ...(includeGridDefaults ? {
      clickSafePoint: {
        xPercent: readPercentNumber(get("clickSafeXPercent")) ?? 50,
        yPercent: readPercentNumber(get("clickSafeYPercent")) ?? 28
      }
    } : {}),
    scrollStepPercent: readPercentNumber(get("scrollStepPercent")) ?? 65,
    failureStrategy: readCandidateFailureStrategy(get("candidateFailureStrategy"))
  };
}

function readPercentNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, numberValue));
}

function readCandidateFailureStrategy(value: FormDataEntryValue | null): NonNullable<AssetRecordingScrollProfile["failureStrategy"]> {
  return value === "none" || value === "back_and_try_next_candidate" ? value : "try_next_candidate";
}

function readVisualSemanticArea(value: FormDataEntryValue | string | null): VisualSemanticArea | undefined {
  return value === "top" ||
    value === "content" ||
    value === "bottom" ||
    value === "unknown"
    ? value
    : undefined;
}

function transitionStatusLabel(status: string): string {
  if (status === "active") {
    return "可用于路径规划";
  }
  if (status === "draft") {
    return "待完善";
  }
  if (status === "deprecated") {
    return "已废弃";
  }
  if (status === "rejected") {
    return "已拒绝";
  }
  return status;
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
