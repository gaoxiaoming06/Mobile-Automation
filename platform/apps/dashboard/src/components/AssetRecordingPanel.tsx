import { DatabaseZap, Save } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent, PointerEvent, ReactNode } from "react";
import { aiElementSuggestionToDraft, type AiElementSuggestion } from "../ai-page-draft-merge";

export type AssetRecordingPageElement = {
  id?: string;
  label: string;
  locator: string;
  locatorKind?: AssetRecordingLocatorKind;
  semanticArea?: VisualSemanticArea;
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  action: string;
  abilityType?: AssetRecordingAbilityType;
  actionKind?: "tap" | "scroll" | "long_press" | "input" | "unknown";
  availability?: "visible" | "after_scroll" | "conditional";
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
  outcomeType?: AssetRecordingElementOutcomeType;
  outcomeLabel?: string;
  targetNodeId?: string;
  targetLabel?: string;
  targetText?: string;
  tapPointPercent?: {
    x: number;
    y: number;
  };
  compoundSteps?: AssetRecordingCompoundStepDraft[];
  quality?: AssetRecordingPageElementQuality;
  visualLocator?: Record<string, unknown>;
  dynamicMasks?: AssetRecordingDynamicMask[];
  structuralLocator?: Record<string, unknown>;
  dynamicRegionId?: string;
  itemTemplateId?: string;
  transitionKind?: "static" | "parameterized";
  parameterMapping?: Record<string, string>;
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
  afterFoundAction: "tap_item" | "tap_child" | "verify_visible";
  candidateItemHeightPercent?: number;
  clickSafePoint?: {
    xPercent: number;
    yPercent: number;
  };
  scrollStepPercent?: number;
  failureStrategy?: "none" | "try_next_candidate" | "back_and_try_next_candidate";
};

export type AssetRecordingPageTransition = {
  id: string;
  name: string;
  status: string;
  source?: string;
  actionSummary?: string;
  targetName?: string;
  targetKey?: string;
  expectationSummary?: string;
  reliabilityScore?: number;
  actionLocator?: string;
  actionKind?: "tap" | "scroll" | "long_press" | "input" | "unknown";
};

export type AssetRecordingPageTaskFieldType = "text_input" | "picker_select" | "toggle_set" | "subpage_edit" | "submit" | "tap" | "wait";

export type AssetRecordingPageTaskStep = {
  id?: string;
  order: number;
  elementId?: string;
  fieldType: AssetRecordingPageTaskFieldType;
  label?: string;
  valueParamKey?: string;
  desiredStateParamKey?: string;
  text?: string;
};

export type AssetRecordingPageTask = {
  id: string;
  name: string;
  status: "active" | "draft" | "deprecated";
  steps: AssetRecordingPageTaskStep[];
  createdAt?: string;
  updatedAt?: string;
};

export type AssetRecordingPageTaskDraft = {
  sourceNodeId?: string;
  taskId?: string;
  name: string;
  status?: "active" | "draft" | "deprecated";
  steps: AssetRecordingPageTaskStep[];
};

export type AssetRecordingPageTaskTransitionDraft = {
  sourceNodeId?: string;
  targetNodeId: string;
  taskId: string;
  taskName?: string;
};

export type AssetRecordingAutoExploreCandidate = {
  id: string;
  label: string;
  actionKind: "tap" | "scroll" | "long_press" | "input";
  locator: string;
  semanticArea?: VisualSemanticArea;
  source?: "manual_element" | "ocr_text";
  riskLevel?: "safe" | "dangerous";
  status?: "ready" | "skipped";
  skipReason?: string;
  targetNodeName?: string;
  outcomeType?: string;
};

export type AssetRecordingAutoExplorePlanStep = {
  id: string;
  depth: number;
  sourceNodeName: string;
  candidateLabel: string;
  targetNodeName?: string;
};

export type AssetRecordingAutoExploreResult = {
  candidateId?: string;
  candidateLabel?: string;
  status: "passed" | "skipped" | "failed";
  resultType: "existing_page" | "new_page_candidate" | "local_state_change" | "no_change" | "dangerous_skipped" | "failed";
  targetNodeName?: string;
  message?: string;
};

export type AssetRecordingAutoExploreReport = {
  status: "ready" | "blocked";
  version: "v1" | "v2";
  sourceNodeName?: string;
  message?: string;
  candidates: AssetRecordingAutoExploreCandidate[];
  plan: {
    version: "v1" | "v2";
    maxDepth: number;
    maxActions: number;
    steps: AssetRecordingAutoExplorePlanStep[];
  };
  results: AssetRecordingAutoExploreResult[];
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

export type AssetRecordingOperationTransitionDraft = {
  sourceNodeId?: string;
  targetNodeId?: string;
  abilityType?: AssetRecordingAbilityType;
  actionKind: "tap" | "scroll" | "long_press" | "input";
  availability: "visible" | "after_scroll" | "conditional";
  outcomeType: AssetRecordingElementOutcomeType;
  locator: string;
  semanticArea?: VisualSemanticArea;
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  elementLabel: string;
  targetText?: string;
  targetLabel?: string;
  tapPointPercent?: {
    x: number;
    y: number;
  };
  scrollProfile?: AssetRecordingScrollProfile;
  compoundSteps?: AssetRecordingCompoundStepDraft[];
  quality?: AssetRecordingPageElementQuality;
  visualLocator?: Record<string, unknown>;
  locatorKind?: AssetRecordingLocatorKind;
  dynamicMasks?: AssetRecordingDynamicMask[];
  structuralLocator?: Record<string, unknown>;
  dynamicRegion?: Record<string, unknown>;
  itemTemplate?: Record<string, unknown>;
  transitionKind?: "static" | "parameterized";
  parameterMapping?: Record<string, string>;
};

export type AssetRecordingElementOutcomeType = "navigate" | "compound_navigation" | "show_inline_state" | "local_state_change" | "no_visible_change";
export type AssetRecordingAbilityType = "fixed_tap" | "scroll_candidate" | "grid_candidate" | "conditional_tap";

export type AssetRecordingPageElementDraft = {
  elementId?: string;
  sourceNodeId?: string;
  abilityType?: AssetRecordingAbilityType;
  actionKind: "tap" | "scroll" | "long_press" | "input";
  availability: "visible" | "after_scroll" | "conditional";
  locator: string;
  semanticArea?: VisualSemanticArea;
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  elementLabel: string;
  targetText?: string;
  outcomeType?: AssetRecordingElementOutcomeType;
  outcomeLabel?: string;
  targetNodeId?: string;
  targetLabel?: string;
  tapPointPercent?: {
    x: number;
    y: number;
  };
  scrollProfile?: AssetRecordingScrollProfile;
  compoundSteps?: AssetRecordingCompoundStepDraft[];
  quality?: AssetRecordingPageElementQuality;
  visualLocator?: Record<string, unknown>;
  locatorKind?: AssetRecordingLocatorKind;
  dynamicMasks?: AssetRecordingDynamicMask[];
  structuralLocator?: Record<string, unknown>;
  dynamicRegion?: Record<string, unknown>;
  itemTemplate?: Record<string, unknown>;
  transitionKind?: "static" | "parameterized";
  parameterMapping?: Record<string, string>;
};

export type AssetRecordingCompoundStepDraft = {
  type: "wait_until_state" | "tap_on_text";
  text: string;
  label?: string;
  timeoutMs?: number;
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
  closeAction?: string;
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
  transitions?: AssetRecordingPageTransition[];
  tasks?: AssetRecordingPageTask[];
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
  onDeletePageElement?: (element: AssetRecordingPageElement) => void | Promise<void>;
  onSavePageTask?: (draft: AssetRecordingPageTaskDraft) => void | Promise<void>;
  onDeletePageTask?: (task: AssetRecordingPageTask) => void | Promise<void>;
  autoExploreReport?: AssetRecordingAutoExploreReport;
  onPreviewAutoExplore?: (options: { maxDepth: number; maxCandidates: number; maxActions: number }) => void | Promise<void>;
  onRunAutoExplore?: (options: { maxDepth: number; maxCandidates: number; maxActions: number }) => void | Promise<void>;
  onResizePointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
};

type AssetDetailTab = "workbench" | "match" | "actions" | "transitions" | "tasks" | "explorer";
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
type AssetOperationGroup = {
  title: string;
  items: AssetRecordingPageElement[];
};
type EditingEvidence = {
  item: AssetEvidenceItem;
  source: "confirmed" | "candidate";
};
type OperationOutcomeFields = {
  requiresTargetPage: boolean;
  targetLabel: string;
  targetPlaceholder: string;
  resultLabel: string;
  resultPlaceholder: string;
};
type ManualActionKind = "tap" | "scroll" | "long_press" | "input";
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
  initialDetailTab = "workbench",
  currentPage,
  previewSlot,
  onPageDraftChange,
  onIdentifyCurrentPage,
  onAiIdentify,
  aiIdentifying = false,
  onSaveCurrentPageAsset,
  onSavePageElement,
  onDeletePageElement,
  onSavePageTask,
  onDeletePageTask,
  autoExploreReport,
  onPreviewAutoExplore,
  onRunAutoExplore,
  onResizePointerDown
}: AssetRecordingPanelProps) {
  const page = currentPage ?? { status: "idle" as const };
  const elements = page.elements ?? [];
  const transitions = page.transitions ?? [];
  const tasks = page.tasks ?? [];
  const savedManualElements = elements.filter((element) => element.source === "manual");
  const savedAssets = page.savedAssets ?? [];
  const screenshotRegions = page.screenshotRegions ?? [];
  const [regionStart, setRegionStart] = useState<{ x: number; y: number }>();
  const [draftRegion, setDraftRegion] = useState<AssetRecordingScreenshotRegion>();
  const [activeDetailTab, setActiveDetailTab] = useState<AssetDetailTab>(initialDetailTab);
  const [isRenamingPage, setIsRenamingPage] = useState(false);
  const [draftPageName, setDraftPageName] = useState("");
  const [editingEvidence, setEditingEvidence] = useState<EditingEvidence>();
  const [draftEvidenceValue, setDraftEvidenceValue] = useState("");
  const [hiddenCandidateEvidenceKeys, setHiddenCandidateEvidenceKeys] = useState<string[]>([]);
  const [screenshotNaturalSize, setScreenshotNaturalSize] = useState<{ width: number; height: number }>();
  const [manualAbilityType, setManualAbilityType] = useState<AssetRecordingAbilityType>("fixed_tap");
  const [manualActionKind, setManualActionKind] = useState<ManualActionKind>("tap");
  const [manualOutcomeType, setManualOutcomeType] = useState<AssetRecordingElementOutcomeType>("navigate");
  const [manualTargetQuery, setManualTargetQuery] = useState("");
  const [manualLocatorKind, setManualLocatorKind] = useState<AssetRecordingLocatorKind>("visual_locator");
  const [manualSemanticAreaOverride, setManualSemanticAreaOverride] = useState<VisualSemanticArea>("content");
  const [manualElementSeed, setManualElementSeed] = useState<ManualElementSeed>();
  const [manualActionEdit, setManualActionEdit] = useState<EditableRegionOperation>();
  const [manualActionRegion, setManualActionRegion] = useState<AssetRecordingScreenshotRegion>();
  const [manualActionNaturalSize, setManualActionNaturalSize] = useState<{ width: number; height: number }>();
  const [isAddingPageElement, setIsAddingPageElement] = useState(false);
  const [editingPageElement, setEditingPageElement] = useState<AssetRecordingPageElement>();
  const [isAddingPageTask, setIsAddingPageTask] = useState(false);
  const [editingPageTask, setEditingPageTask] = useState<AssetRecordingPageTask>();
  const [autoExploreDepth, setAutoExploreDepth] = useState(1);
  const [autoExploreMaxCandidates, setAutoExploreMaxCandidates] = useState(8);
  const screenshotImageLayerRef = useRef<HTMLDivElement>(null);
  const manualActionImageLayerRef = useRef<HTMLDivElement>(null);
  const hasSavedAsset = savedAssets.some((asset) => asset.id === page.nodeId || asset.key === page.targetRef);
  const saveMode: "create" | "update" = hasSavedAsset ? "update" : "create";
  const canSave = page.status !== "idle" && page.status !== "error";
  const showPageElementForm = isAddingPageElement || Boolean(editingPageElement);
  const showPageTaskForm = isAddingPageTask || Boolean(editingPageTask);
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
  const manualOutcomeFields = operationOutcomeFields(manualOutcomeType);
  const filteredManualTargetAssets = savedAssets.filter((asset) => matchesTargetAsset(asset, manualTargetQuery)).slice(0, 20);
  const autoExploreOptions = {
    maxDepth: autoExploreDepth,
    maxCandidates: autoExploreMaxCandidates,
    maxActions: autoExploreMaxCandidates
  };

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
    setManualAbilityType("fixed_tap");
    setManualActionKind("tap");
    setManualOutcomeType("navigate");
    setManualTargetQuery("");
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
    setManualAbilityType("fixed_tap");
    setManualActionKind("tap");
    setManualOutcomeType("navigate");
    setManualTargetQuery("");
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
    setManualAbilityType(element.abilityType ?? abilityTypeFromElement(element));
    const actionKind = normalizeActionKind(element);
    setManualActionKind(actionKind === "unknown" ? "tap" : actionKind);
    setManualOutcomeType(element.outcomeType ?? "navigate");
    setManualTargetQuery(element.targetLabel ?? "");
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
    setManualOutcomeType("navigate");
    setManualTargetQuery("");
    setManualLocatorKind("visual_locator");
    setManualSemanticAreaOverride("content");
    setManualAbilityType("fixed_tap");
    setIsAddingPageElement(false);
  }

  async function submitManualPageElement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const region = manualActionRegion ?? defaultRegionForLocatorKind(manualLocatorKind);
    if ((!region || region.width < 1 || region.height < 1) && locatorKindNeedsMarkedRegion(manualLocatorKind, manualAbilityType)) {
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

  function startAddPageTask() {
    setEditingPageTask(undefined);
    setIsAddingPageTask(true);
  }

  function startEditPageTask(task: AssetRecordingPageTask) {
    setEditingPageTask(task);
    setIsAddingPageTask(true);
  }

  function cancelPageTaskEdit() {
    setEditingPageTask(undefined);
    setIsAddingPageTask(false);
  }

  function submitPageTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = pageTaskDraftFromForm(new FormData(event.currentTarget), {
      sourceNodeId: page.nodeId,
      task: editingPageTask,
      elements: savedManualElements
    });
    if (!draft.steps.length) {
      return;
    }
    void onSavePageTask?.(draft);
    setEditingPageTask(undefined);
    setIsAddingPageTask(false);
  }

  function renderManualPageElementEditor() {
    const manualRegionRequired = locatorKindNeedsMarkedRegion(manualLocatorKind, manualAbilityType);
    const manualSemanticArea = manualActionRegion?.semanticArea ??
      (manualActionRegion ? semanticAreaForRegion(manualActionRegion) : manualSemanticAreaOverride);
    return (
      <div className="asset-manual-action-card">
        <div className="asset-manual-action-head">
          <div>
            <strong>{editingPageElement ? "编辑可操作元素" : "待编辑可操作元素"}</strong>
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
                      <em>{manualActionLabel(manualActionKind)}</em>
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
                能力类型
                <select name="abilityType" value={manualAbilityType} onChange={(event) => setManualAbilityType(readAbilityType(event.target.value))}>
                  <option value="fixed_tap">固定点击能力</option>
                  <option value="scroll_candidate">滚动查找目标</option>
                  <option value="grid_candidate">网格候选入口</option>
                  <option value="conditional_tap">条件点击能力</option>
                </select>
              </label>
              <label>
                动作方式
                <select name="actionKind" value={manualActionKind} onChange={(event) => setManualActionKind(readActionKind(event.target.value))}>
                  <option value="tap">点击</option>
                  <option value="scroll">滑动</option>
                  <option value="long_press">长按</option>
                  <option value="input">输入</option>
                </select>
              </label>
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
                动作名称
                <input name="elementLabel" placeholder="例如：搜索按钮 / 列表区域" defaultValue={editingPageElement?.label ?? manualElementSeed?.label ?? manualActionLabel(manualActionKind)} />
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
              {manualAbilityType === "grid_candidate" ? (
                <div className="asset-operation-inline-fields">
                  <label>
                    动态区域名
                    <input name="dynamicRegionLabel" placeholder="例如：班级列表" defaultValue={editingPageElement?.targetLabel ? `${editingPageElement.targetLabel}列表` : "班级列表"} />
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
              {manualActionRegion && manualAbilityType !== "grid_candidate" ? (
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
              <label>
                出现条件
                <select name="availability" defaultValue={editingPageElement?.availability ?? "visible"}>
                  <option value="visible">当前可见</option>
                  <option value="after_scroll">滚动后出现</option>
                  <option value="conditional">条件出现</option>
                </select>
              </label>
              <label>
                结果类型
                <select name="outcomeType" value={manualOutcomeType} onChange={(event) => setManualOutcomeType(readElementOutcomeType(event.target.value) ?? "navigate")}>
                  <option value="navigate">跳转页面</option>
                  <option value="compound_navigation">复合跳转</option>
                  <option value="show_inline_state">出现页面内状态</option>
                  <option value="local_state_change">页面局部变化</option>
                  <option value="no_visible_change">无明显变化</option>
                </select>
              </label>
              {manualOutcomeFields.requiresTargetPage ? (
                <label>
                  {manualOutcomeFields.targetLabel}
                  <input value={manualTargetQuery} onChange={(event) => setManualTargetQuery(event.target.value)} placeholder={manualOutcomeFields.targetPlaceholder} />
                  <select className="asset-operation-target-options" name="targetNodeId" defaultValue={editingPageElement?.targetNodeId ?? ""} key={`${editingPageElement?.id ?? "new"}-${manualTargetQuery || "all-targets"}`}>
                    <option value="">暂不绑定目标页面</option>
                    {filteredManualTargetAssets.map((asset) => (
                      <option value={asset.id} key={asset.id}>{asset.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <input name="targetNodeId" type="hidden" value="" />
              )}
              {manualAbilityType === "conditional_tap" ? <ConditionClickEditor /> : null}
              {manualOutcomeType === "compound_navigation" ? <CompoundNavigationEditor /> : null}
              <label className="asset-operation-target">
                {manualOutcomeFields.resultLabel}
                <input name="targetLabel" placeholder={manualOutcomeFields.resultPlaceholder} defaultValue={editingPageElement?.targetLabel ?? ""} />
              </label>
              <label className="asset-operation-target">
                结果说明
                <input name="outcomeLabel" placeholder="例如：弹出更多菜单 / 进入新建公开课 / 确认后弹窗消失" defaultValue={editingPageElement?.outcomeLabel ?? ""} />
              </label>
              {manualActionKind === "scroll" || manualAbilityType === "grid_candidate" || manualAbilityType === "scroll_candidate" ? (
                <ScrollContainerEditor
                  abilityType={manualAbilityType}
                  profile={
                    editingPageElement?.scrollProfile ??
                    (manualAbilityType === "grid_candidate"
                      ? { containerKind: "grid_list", direction: "vertical", columns: 2, targetKind: "item_text", targetQuery: "{{className}}", afterFoundAction: "tap_item", failureStrategy: "try_next_candidate" }
                      : manualAbilityType === "scroll_candidate"
                        ? { containerKind: "list", direction: "vertical", targetKind: "image_region", targetQuery: manualActionRegion ? imageRegionLocator(manualActionRegion) : undefined, afterFoundAction: "tap_child", failureStrategy: "try_next_candidate" }
                      : { containerKind: "scroll_area", direction: "vertical", targetKind: "ocr_text", afterFoundAction: "verify_visible" })
                  }
                />
              ) : null}
              <button type="submit" disabled={(!manualActionRegion && manualRegionRequired) || !onSavePageElement}>
                保存可操作元素
              </button>
            </form>
          </div>
        </div>
      </div>
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
                    className="secondary"
                    disabled={busy || identifying || aiIdentifying || !page.observation}
                    onClick={() => void onAiIdentify()}
                    title="将当前页面证据交给 AI 生成资产草稿建议（预计 20-60 秒）"
                  >
                    {aiIdentifying ? "AI 识别中…" : "AI 识别本页"}
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
                <button className={detailTabClass(activeDetailTab, "workbench")} type="button" role="tab" aria-selected={activeDetailTab === "workbench"} onClick={() => setActiveDetailTab("workbench")}>
                  v2 候选录入
                </button>
                <button className={detailTabClass(activeDetailTab, "match")} type="button" role="tab" aria-selected={activeDetailTab === "match"} onClick={() => setActiveDetailTab("match")}>
                  页面匹配
                </button>
                <button className={detailTabClass(activeDetailTab, "actions")} type="button" role="tab" aria-selected={activeDetailTab === "actions"} onClick={() => setActiveDetailTab("actions")}>
                  页面能力
                </button>
                <button className={detailTabClass(activeDetailTab, "transitions")} type="button" role="tab" aria-selected={activeDetailTab === "transitions"} onClick={() => setActiveDetailTab("transitions")}>
                  连接边
                </button>
                <button className={detailTabClass(activeDetailTab, "tasks")} type="button" role="tab" aria-selected={activeDetailTab === "tasks"} onClick={() => setActiveDetailTab("tasks")}>
                  页面任务
                </button>
                <button className={detailTabClass(activeDetailTab, "explorer")} type="button" role="tab" aria-selected={activeDetailTab === "explorer"} onClick={() => setActiveDetailTab("explorer")}>
                  自动探索
                </button>
              </div>

              <div className="asset-detail-scroll asset-editor-scroll">
                {activeDetailTab === "workbench" ? (
                  <V2AssetWorkbench
                    page={page}
                    savedManualElements={savedManualElements}
                    transitions={transitions}
                    tasks={tasks}
                    candidateEvidence={candidateEvidence}
                    confirmedEvidenceCount={confirmedEvidence.length}
                    candidateEvidenceCount={candidateEvidence.length}
                    onConfirmEvidence={confirmEvidence}
                    onStartElementFromEvidence={startPageElementFromEvidence}
                    onOpenTab={setActiveDetailTab}
                  />
                ) : null}

                {activeDetailTab === "match" ? (
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

                {activeDetailTab === "actions" ? (
                  <div className="asset-detail-section asset-elements-card">
                    {page.aiElementSuggestions?.length ? (
                      <section className="asset-ai-suggestions">
                        <div className="asset-action-summary">
                          <strong>AI 元素建议</strong>
                          <span>{page.aiElementSuggestions.length} 项，确认后保存为正式元素</span>
                        </div>
                        <div className="asset-element-list">
                          {page.aiElementSuggestions.map((suggestion, index) => (
                            <div className="asset-saved-action-item" key={`ai-suggestion-${index}`}>
                              <div className="asset-element-row">
                                <div className="asset-element-summary">
                                  <strong>{suggestion.elementLabel}</strong>
                                  <span>
                                    {suggestion.abilityType} · {suggestion.locator}
                                    {typeof suggestion.confidence === "number" ? ` · 置信度 ${Math.round(suggestion.confidence * 100)}%` : ""}
                                  </span>
                                  {suggestion.riskNotes.length ? <span className="asset-warning-text">{suggestion.riskNotes.join("；")}</span> : null}
                                </div>
                                <button
                                  type="button"
                                  disabled={busy || !onSavePageElement || !page.nodeId}
                                  onClick={() => void onSavePageElement?.(aiElementSuggestionToDraft(suggestion, page.nodeId))}
                                >
                                  保存该元素
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}
                    <section className="asset-saved-actions">
                      <div className="asset-action-summary">
                        <strong>已录入可操作元素</strong>
                        <span>{savedManualElements.length} 个元素</span>
                      </div>
                      <PageElementHealthPanel elements={savedManualElements} transitions={transitions} />
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
                                    <small>{abilityTypeLabel(element.abilityType ?? abilityTypeFromElement(element))} · {operationKindLabel(normalizeActionKind(element))} · {availabilityLabel(element.availability)}</small>
                                    <PageElementQualitySummary quality={element.quality} />
                                    <CompoundStepsSummary steps={element.compoundSteps} />
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
                        <div className="empty">暂无可操作元素；点击下方按钮后会新增一个编辑态条目。</div>
                      )}
                    </section>
                    <button className="asset-add-element-button" type="button" disabled={busy} onClick={startAddPageElement}>
                      + 添加可操作元素
                    </button>
                    {showPageElementForm && !editingPageElement ? renderManualPageElementEditor() : null}
                  </div>
                ) : null}

                {activeDetailTab === "transitions" ? (
                  <div className="asset-detail-section asset-transition-connection-card">
                    <section className="asset-saved-actions">
                      <div className="asset-action-summary">
                        <strong>已录入连接边</strong>
                        <span>{transitions.length} 条</span>
                      </div>
                      {transitions.length ? (
                        <div className="asset-transition-list">
                          {transitions.map((transition) => (
                            <div className="asset-transition-row" key={transition.id}>
                              <div>
                                <strong>{transition.name}</strong>
                                <span>{transition.actionSummary || transition.actionLocator || "未记录动作说明"}</span>
                                <small>{transition.targetName ? `目标：${transition.targetName}` : "目标待确认"}</small>
                              </div>
                              <div className="asset-transition-meta">
                                <code>{transitionStatusLabel(transition.status)}</code>
                                {typeof transition.reliabilityScore === "number" ? <code>可靠度 {Math.round(transition.reliabilityScore * 100)}%</code> : null}
                                <small>由页面能力生成</small>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty">暂无连接边；请在页面能力或页面任务中配置跳转结果，保存后系统会派生连接边。</div>
                      )}
                    </section>
                  </div>
                ) : null}

                {activeDetailTab === "tasks" ? (
                  <div className="asset-detail-section asset-page-task-card">
                    <section className="asset-saved-actions">
                      <div className="asset-action-summary">
                        <strong>页面任务</strong>
                        <span>{tasks.filter((task) => task.status !== "deprecated").length} 个任务</span>
                      </div>
                      <p className="asset-page-task-hint">一期可执行：输入文本、点击、选择器、开关、进入子页面、提交、等待文字。</p>
                      {tasks.filter((task) => task.status !== "deprecated").length ? (
                        <div className="asset-element-list">
                          {tasks.filter((task) => task.status !== "deprecated").map((task) => (
                            <div className="asset-saved-action-item" key={task.id}>
                              <div className="asset-element-row asset-saved-action-row asset-saved-action-main">
                                <div className="asset-operation-preview-info">
                                  <strong>{task.name}</strong>
                                  <span>{task.steps.length} 个步骤</span>
                                  <small>{task.steps.map((step) => pageTaskStepSummary(step, savedManualElements)).join(" → ")}</small>
                                </div>
                                <div className="asset-saved-action-controls">
                                  <button className="asset-action-button edit" type="button" disabled={busy} onClick={() => startEditPageTask(task)}>
                                    编辑
                                  </button>
                                  <button className="asset-action-button delete" type="button" disabled={busy || !onDeletePageTask} onClick={() => void onDeletePageTask?.(task)}>
                                    删除
                                  </button>
                                </div>
                              </div>
                              {editingPageTask === task ? (
                                <PageTaskEditor
                                  busy={busy}
                                  elements={savedManualElements}
                                  task={editingPageTask}
                                  onCancel={cancelPageTaskEdit}
                                  onSubmit={submitPageTask}
                                />
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty">暂无页面任务；先在“页面能力”录入输入框、按钮等元素，再把它们编排成页内任务。</div>
                      )}
                    </section>
                    <button className="asset-add-element-button" type="button" disabled={busy || !savedManualElements.length} onClick={startAddPageTask}>
                      + 添加页面任务
                    </button>
                    {showPageTaskForm && !editingPageTask ? (
                      <PageTaskEditor
                        busy={busy}
                        elements={savedManualElements}
                        task={editingPageTask}
                        onCancel={cancelPageTaskEdit}
                        onSubmit={submitPageTask}
                      />
                    ) : null}
                  </div>
                ) : null}

                {activeDetailTab === "explorer" ? (
                  <div className="asset-detail-section asset-auto-explorer-card">
                    <section className="asset-saved-actions">
                      <div className="asset-action-summary">
                        <strong>自动探索</strong>
                        <span>{autoExploreReport?.status === "ready" ? `${autoExploreReport.candidates.filter((candidate) => candidate.status !== "skipped").length} 个安全候选` : "未生成"}</span>
                      </div>
                      <div className="asset-auto-explorer-controls">
                        <label>
                          深度
                          <select value={autoExploreDepth} onChange={(event) => setAutoExploreDepth(Number(event.target.value))}>
                            <option value={1}>V1 当前页一跳</option>
                            <option value={2}>V2 两层探索</option>
                          </select>
                        </label>
                        <label>
                          候选上限
                          <input
                            min={1}
                            max={20}
                            type="number"
                            value={autoExploreMaxCandidates}
                            onChange={(event) => setAutoExploreMaxCandidates(Math.min(20, Math.max(1, Number(event.target.value) || 1)))}
                          />
                        </label>
                        <button className="asset-action-button edit" type="button" disabled={busy || !onPreviewAutoExplore} onClick={() => void onPreviewAutoExplore?.(autoExploreOptions)}>
                          预览候选
                        </button>
                        <button className="asset-action-button" type="button" disabled={busy || !onRunAutoExplore} onClick={() => void onRunAutoExplore?.(autoExploreOptions)}>
                          开始探索
                        </button>
                      </div>
                    </section>
                    <AutoExploreReportView report={autoExploreReport} />
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

function V2AssetWorkbench({
  page,
  savedManualElements,
  transitions,
  tasks,
  candidateEvidence,
  confirmedEvidenceCount,
  candidateEvidenceCount,
  onConfirmEvidence,
  onStartElementFromEvidence,
  onOpenTab
}: {
  page: AssetRecordingCurrentPage;
  savedManualElements: AssetRecordingPageElement[];
  transitions: AssetRecordingPageTransition[];
  tasks: AssetRecordingPageTask[];
  candidateEvidence: AssetEvidenceItem[];
  confirmedEvidenceCount: number;
  candidateEvidenceCount: number;
  onConfirmEvidence: (item: AssetEvidenceItem) => void;
  onStartElementFromEvidence: (item: AssetEvidenceItem) => void;
  onOpenTab: (tab: AssetDetailTab) => void;
}) {
  const activeTasks = tasks.filter((task) => task.status !== "deprecated");
  const readyTransitions = transitions.filter((transition) => transition.status !== "deprecated");
  const pageName = page.pageName || page.visualPageName || "当前页面";
  const qualitySummary = summarizeV2ElementQuality(savedManualElements);
  const visibleCandidates = compactEvidenceCandidates(candidateEvidence).slice(0, 8);

  return (
    <div className="asset-detail-section asset-v2-workbench">
      <section className="asset-v2-hero">
        <div>
          <strong>v2 候选录入</strong>
          <p>先选候选，再确认语义。这里不是旧的先手动画框流程，只有带 OCR/视觉/结构证据的候选才能进入正式资产。</p>
        </div>
        <span>{pageName}</span>
      </section>

      <section className="asset-v2-flow" aria-label="v2 资产录入流程">
        {[
          ["选候选", "从 OCR 带区域文字、视觉 crop、结构上下文或已有元素开始。"],
          ["定语义", "确认它是页面身份、按钮、输入框、列表项模板、连接边还是页面任务。"],
          ["验定位", "保存前检查唯一性、动态内容、重复候选和运行时重定位证据。"],
          ["进巡检", "通过后进入资产驱动巡检；失败证据会回到这里修复。"]
        ].map(([title, description], index) => (
          <div className="asset-v2-flow-step" key={title}>
            <code>{index + 1}</code>
            <strong>{title}</strong>
            <span>{description}</span>
          </div>
        ))}
      </section>

      <section className="asset-v2-rule-strip">
        <strong>执行规则</strong>
        <span>region_center 不直接执行</span>
        <span>OCR / 视觉 / 结构重定位成功才允许点击</span>
        <span>头像、昵称、数量、时间等动态内容必须 mask 或参数化</span>
      </section>

      <section className="asset-v2-card asset-v2-candidate-pool">
        <div className="asset-v2-card-head">
          <strong>候选池</strong>
          <span>{visibleCandidates.length ? `${visibleCandidates.length} 个可处理候选` : "等待候选"}</span>
        </div>
        {visibleCandidates.length ? (
          <div className="asset-v2-evidence-grid">
            {visibleCandidates.map((item) => {
              const displayText = evidenceDisplayValue(item);
              const hasRegion = Boolean(parseRegionBoundEvidence(item.value).region);
              return (
                <div className="asset-v2-evidence-card" key={evidenceKey(item)}>
                  <div>
                    <strong>{displayText}</strong>
                    <span>{item.kind} · {hasRegion ? "带截图区域" : "无区域证据"}</span>
                  </div>
                  <div className="asset-v2-evidence-actions">
                    <button type="button" onClick={() => onConfirmEvidence(item)}>直接录为页面身份</button>
                    <button type="button" disabled={!hasRegion} onClick={() => onStartElementFromEvidence(item)}>
                      {hasRegion ? "录为可操作元素" : "缺少区域，先刷新候选"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty">当前没有候选。先确保设备预览正常、OCR 服务可用，再刷新当前页面。</div>
        )}
      </section>

      <div className="asset-v2-grid">
        <section className="asset-v2-card">
          <div className="asset-v2-card-head">
            <strong>当前页录入状态</strong>
            <span>{page.status === "matched" ? "已匹配" : statusLabel(page.status)}</span>
          </div>
          <div className="asset-v2-metrics">
            <div>
              <b>{confirmedEvidenceCount}</b>
              <span>已确认身份依据</span>
            </div>
            <div>
              <b>{candidateEvidenceCount}</b>
              <span>候选身份信号</span>
            </div>
            <div>
              <b>{savedManualElements.length}</b>
              <span>{savedManualElements.length} 个可操作元素</span>
            </div>
            <div>
              <b>{readyTransitions.length}</b>
              <span>{readyTransitions.length} 条连接边</span>
            </div>
            <div>
              <b>{activeTasks.length}</b>
              <span>{activeTasks.length} 个页面任务</span>
            </div>
            <div>
              <b>{qualitySummary.reviewCount}</b>
              <span>建议复核</span>
            </div>
          </div>
        </section>

        <section className="asset-v2-card">
          <div className="asset-v2-card-head">
            <strong>资产分层</strong>
            <span>v2 schema</span>
          </div>
          <div className="asset-v2-layer-list">
            <div>
              <strong>页面身份</strong>
              <span>用稳定 OCR/视觉锚点识别当前页面，过滤调试浮层和系统栏污染。</span>
            </div>
            <div>
              <strong>PageElement</strong>
              <span>保存语义、动作方式、定位证据和质量结果，不把固定坐标当主定位。</span>
            </div>
            <div>
              <strong>PageTransition</strong>
              <span>描述元素执行后的目标页面或局部状态，用于路径规划和资产巡检。</span>
            </div>
            <div>
              <strong>DynamicRegion / ListTemplate</strong>
              <span>把列表、卡片、Tab、滚动区域参数化，执行时按目标参数找 item。</span>
            </div>
            <div>
              <strong>PageTask</strong>
              <span>把输入、勾选、提交、等待结果编排成页面内可复用任务。</span>
            </div>
          </div>
        </section>
      </div>

      <section className="asset-v2-card">
        <div className="asset-v2-card-head">
          <strong>已录入资产</strong>
          <span>从已有录入读取</span>
        </div>
        <div className="asset-v2-candidate-list">
          {savedManualElements.slice(0, 4).map((element) => (
            <div className="asset-v2-candidate-row" key={element.id ?? element.locator}>
              <div>
                <strong>{element.label}</strong>
                <span>{locatorKindLabel(element.locatorKind)} · {operationKindLabel(normalizeActionKind(element))} · {semanticAreaLabel(element.semanticArea ?? semanticAreaForLocator(element.locator) ?? "unknown")}</span>
                <small>{runtimeLocatorSummaryForWorkbench(element)}</small>
              </div>
              <code>{element.quality ? pageElementQualityStatusLabel(element.quality.status) : "待校验"}</code>
            </div>
          ))}
          {readyTransitions.slice(0, 3).map((transition) => (
            <div className="asset-v2-candidate-row" key={transition.id}>
              <div>
                <strong>{transition.name}</strong>
                <span>PageTransition · {operationKindLabel(transition.actionKind ?? "unknown")}</span>
                <small>{transition.targetName ? `目标：${transition.targetName}` : "目标待确认"}</small>
              </div>
              <code>{transitionStatusLabel(transition.status)}</code>
            </div>
          ))}
          {!savedManualElements.length && !readyTransitions.length ? <div className="empty">当前页还没有可展示的 v2 候选资产。</div> : null}
        </div>
      </section>

      <section className="asset-v2-card">
        <div className="asset-v2-card-head">
          <strong>推荐下一步</strong>
          <span>按缺口处理</span>
        </div>
        <div className="asset-v2-next-actions">
          <button type="button" onClick={() => onOpenTab("actions")}>打开详情编辑</button>
          <button type="button" onClick={() => onOpenTab("transitions")}>从已录入元素补连接边</button>
          <button type="button" onClick={() => onOpenTab("tasks")}>把元素编入页面任务</button>
          <button type="button" onClick={() => onOpenTab("match")}>查看页面身份证据</button>
        </div>
      </section>
    </div>
  );
}

function AutoExploreReportView({ report }: { report?: AssetRecordingAutoExploreReport }) {
  if (!report) {
    return <div className="empty">还没有自动探索报告。</div>;
  }
  if (report.status === "blocked") {
    return <div className="empty">{report.message || "当前页面暂不能自动探索。"}</div>;
  }
  return (
    <div className="asset-auto-explorer-report">
      <section className="asset-saved-actions">
        <div className="asset-action-summary">
          <strong>候选操作</strong>
          <span>{report.version.toUpperCase()}</span>
        </div>
        {report.candidates.length ? (
          <div className="asset-auto-explorer-list">
            {report.candidates.map((candidate) => (
              <div className={`asset-auto-explorer-row ${candidate.status === "skipped" ? "skipped" : "ready"}`} key={candidate.id}>
                <div>
                  <strong>{candidate.label}</strong>
                  <span>{operationKindLabel(candidate.actionKind)} · {semanticAreaLabel(candidate.semanticArea ?? "unknown")} · {candidateSourceLabel(candidate.source)}</span>
                  <small>{candidate.locator}</small>
                </div>
                <code>{candidate.status === "skipped" ? "已跳过" : candidate.targetNodeName ? `目标 ${candidate.targetNodeName}` : "待观察"}</code>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">当前页暂无可探索候选。</div>
        )}
      </section>
      <section className="asset-saved-actions">
        <div className="asset-action-summary">
          <strong>探索计划</strong>
          <span>{report.plan.steps.length} 步</span>
        </div>
        {report.plan.steps.length ? (
          <div className="asset-auto-explorer-list">
            {report.plan.steps.map((step) => (
              <div className="asset-auto-explorer-row" key={step.id}>
                <div>
                  <strong>{step.sourceNodeName} / {step.candidateLabel}</strong>
                  <span>深度 {step.depth}{step.targetNodeName ? ` · 预计到 ${step.targetNodeName}` : ""}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">暂无可执行计划。</div>
        )}
      </section>
      {report.results.length ? (
        <section className="asset-saved-actions">
          <div className="asset-action-summary">
            <strong>执行结果</strong>
            <span>{report.results.length} 条</span>
          </div>
          <div className="asset-auto-explorer-list">
            {report.results.map((result, index) => (
              <div className={`asset-auto-explorer-row ${result.status}`} key={`${result.candidateId ?? index}-${result.resultType}`}>
                <div>
                  <strong>{result.candidateLabel ?? "候选动作"}</strong>
                  <span>{exploreResultTypeLabel(result.resultType)}{result.targetNodeName ? ` · ${result.targetNodeName}` : ""}</span>
                  {result.message ? <small>{result.message}</small> : null}
                </div>
                <code>{exploreResultStatusLabel(result.status)}</code>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
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

function PageElementHealthPanel({ elements, transitions }: { elements: AssetRecordingPageElement[]; transitions: AssetRecordingPageTransition[] }) {
  const legacyCount = elements.filter(isLegacyMarkedRegionElement).length;
  const v2Count = elements.length - legacyCount;
  const reviewCount = elements.filter((element) => element.quality?.status === "needs_review").length;
  const failedCount = elements.filter((element) => element.quality?.status === "fail").length;
  const actionableTransitions = transitions.filter((transition) => transition.status === "active").length;
  return (
    <div className="asset-locator-workbench-panel">
      <div className="asset-locator-workbench-head">
        <div>
          <strong>定位策略工作台</strong>
          <span>保存的是定位策略，不是固定坐标；执行时必须在当前截图上重定位成功后才点击。</span>
        </div>
      </div>
      <div className="asset-page-health-panel">
        <div>
          <span>页面能力</span>
          <strong>{elements.length}</strong>
        </div>
        <div>
          <span>语义定位</span>
          <strong>{v2Count}</strong>
        </div>
        <div>
          <span>旧版圈选</span>
          <strong>{legacyCount}</strong>
        </div>
        <div>
          <span>需复核</span>
          <strong>{reviewCount + failedCount}</strong>
        </div>
        <div>
          <span>可执行边</span>
          <strong>{actionableTransitions}</strong>
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
        <em className={summary.assetClass === "v2" ? "v2" : "legacy"}>{summary.assetLabel}</em>
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
  if (element.locatorKind === "collection_item_locator" || element.abilityType === "grid_candidate") {
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
  assetClass: "v2" | "legacy";
  assetLabel: string;
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
  const isLegacy = isLegacyMarkedRegionElement(element);
  const candidateCount = element.quality?.candidates?.length ?? 0;
  return {
    assetClass: isLegacy ? "legacy" : "v2",
    assetLabel: isLegacy ? "旧版圈选" : "语义定位",
    strategyLabel: locatorKindLabel(locatorKind),
    regionLabel: semanticAreaLabel(element.semanticArea ?? semanticAreaForLocator(element.locator) ?? "unknown"),
    evidenceLabel: locatorEvidenceLabel(locatorKind),
    previewStatusLabel: pageElementPreviewStatusLabel(element),
    previewDetail: candidateCount ? `当前记录了 ${candidateCount} 个候选，执行时会重新在实时截图里计算。` : "暂无候选详情，执行时会按定位方式重新查找。",
    findInstruction: pageElementFindInstruction(element, locatorKind, isLegacy),
    executionInstruction: pageElementExecutionInstruction(element),
    clickPointLabel: pageElementClickPointInstruction(element, isLegacy)
  };
}

function pageElementFindInstruction(element: AssetRecordingPageElement, locatorKind: AssetRecordingLocatorKind, isLegacy: boolean): string {
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
  if (locatorKind === "collection_item_locator" || element.abilityType === "grid_candidate") {
    return `在列表里找 "${element.scrollProfile?.targetQuery || element.targetLabel || element.label}"`;
  }
  if (locatorKind === "ocr_anchor_offset") {
    return `先找锚点 "${element.targetText || element.label}"，再按相对位置找目标`;
  }
  if (locatorKind === "structural_locator") {
    return `按稳定文字、图标和相邻关系找 "${element.label}"`;
  }
  if (isLegacy) {
    return `按旧版圈选截图重新匹配 "${element.label}"`;
  }
  return `按视觉特征重新找 "${element.label}"`;
}

function pageElementExecutionInstruction(element: AssetRecordingPageElement): string {
  const actionKind = normalizeActionKind(element);
  if (actionKind === "input") {
    return "运行时重新找到目标后再输入";
  }
  if (actionKind === "scroll") {
    return "运行时重新找到区域后再滑动";
  }
  if (actionKind === "long_press") {
    return "运行时重新找到目标后再长按";
  }
  return "运行时重新找到目标后再点击";
}

function pageElementClickPointInstruction(element: AssetRecordingPageElement, isLegacy: boolean): string {
  if (isRuntimeLocatedElement(element)) {
    return "运行时计算";
  }
  if (isLegacy) {
    return "旧版圈选中心仅用于诊断，建议迁移为语义定位";
  }
  if (element.tapPointPercent) {
    return "由重定位候选内安全点计算";
  }
  return "由 OCR / 视觉 / 结构候选计算";
}

function isLegacyMarkedRegionElement(element: AssetRecordingPageElement): boolean {
  return (!element.locatorKind || element.locatorKind === "visual_locator") &&
    element.locator.startsWith("image-region:") &&
    !element.visualLocator &&
    !element.quality &&
    !element.structuralLocator;
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

function locatorKindNeedsMarkedRegion(locatorKind: AssetRecordingLocatorKind, _abilityType: AssetRecordingAbilityType): boolean {
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

function CompoundStepsSummary({ steps }: { steps?: AssetRecordingCompoundStepDraft[] }) {
  if (!steps?.length) {
    return null;
  }
  return (
    <small>
      复合步骤：{steps.map((step) => step.label || `${step.type}:${step.text}`).join(" → ")}
    </small>
  );
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

function ConditionClickEditor() {
  return (
    <fieldset className="asset-scroll-editor">
      <legend>执行条件</legend>
      <label className="asset-operation-target">
        条件说明
        <input name="conditionLabel" placeholder="例如：右下角 add 按钮可见" />
      </label>
    </fieldset>
  );
}

function CompoundNavigationEditor() {
  return (
    <fieldset className="asset-scroll-editor">
      <legend>复合步骤</legend>
      <label className="asset-operation-target">
        等待出现
        <input name="compoundWaitText" placeholder="例如：添加好友" />
      </label>
      <label className="asset-operation-target">
        再点击文字
        <input name="compoundTapText" placeholder="例如：添加好友" />
      </label>
      <label className="asset-operation-target">
        等待超时 ms
        <input name="compoundTimeoutMs" type="number" min="200" step="100" placeholder="3000" />
      </label>
    </fieldset>
  );
}

function ScrollContainerEditor({ abilityType, profile }: { abilityType?: AssetRecordingAbilityType; profile?: AssetRecordingScrollProfile }) {
  const isGridCandidate = abilityType === "grid_candidate";
  return (
    <fieldset className="asset-scroll-editor">
      <legend>{isGridCandidate ? "网格候选入口" : "滚动容器"}</legend>
      <label>
        容器类型
        <select name="containerKind" defaultValue={profile?.containerKind ?? (isGridCandidate ? "grid_list" : "list")}>
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
        <input name="layoutColumns" type="number" min="1" max="6" defaultValue={profile?.columns ?? (isGridCandidate ? 2 : 1)} />
      </label>
      {isGridCandidate ? (
        <>
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
        </>
      ) : null}
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
        <input name="targetQuery" defaultValue={profile?.targetQuery ?? ""} placeholder={isGridCandidate ? "例如：{{className}} / 班级四十一号" : "例如：班级四十一号 / 我是学生 / 第 3 个"} />
      </label>
      <label>
        找到后动作
        <select name="afterFoundAction" defaultValue={profile?.afterFoundAction ?? (isGridCandidate ? "tap_item" : "tap_item")}>
          <option value="tap_item">点击列表项</option>
          <option value="tap_child">点击 item 内控件</option>
          <option value="verify_visible">只验证出现</option>
        </select>
      </label>
    </fieldset>
  );
}

function PageTaskEditor({
  busy,
  elements,
  task,
  onCancel,
  onSubmit
}: {
  busy: boolean;
  elements: AssetRecordingPageElement[];
  task?: AssetRecordingPageTask;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const sortedSteps = (task?.steps ?? []).slice().sort((left, right) => left.order - right.order);
  const rowCount = Math.max(3, Math.min(8, Math.max(sortedSteps.length + 1, elements.length || 1)));
  const rows = Array.from({ length: rowCount }, (_, index) => sortedSteps[index]);
  return (
    <form className="asset-element-actions asset-operation-editor asset-page-task-editor" onSubmit={onSubmit}>
      {task?.id ? <input type="hidden" name="taskId" value={task.id} /> : null}
      <label>
        任务名称
        <input name="taskName" defaultValue={task?.name ?? ""} placeholder="例如：创建课堂 / 发布公开课" />
      </label>
      <label>
        任务状态
        <select name="taskStatus" defaultValue={task?.status ?? "active"}>
          <option value="active">可执行</option>
          <option value="draft">草稿</option>
        </select>
      </label>
      <div className="asset-page-task-step-list">
        {rows.map((step, index) => (
          <div className="asset-page-task-step" key={step?.id ?? `new-step-${index}`}>
            {step?.id ? <input type="hidden" name={`step_${index}_id`} value={step.id} /> : null}
            <strong>步骤 {index + 1}</strong>
            <label>
              页面元素
              <select name={`step_${index}_elementId`} defaultValue={step?.elementId ?? ""}>
                <option value="">不使用元素</option>
                {elements.map((element) => (
                  <option value={element.id ?? ""} key={element.id ?? element.locator} disabled={!element.id}>
                    {element.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              字段类型
              <select name={`step_${index}_fieldType`} defaultValue={step?.fieldType ?? "tap"}>
                <option value="tap">点击</option>
                <option value="text_input">输入文本</option>
                <option value="picker_select">选择器</option>
                <option value="toggle_set">开关/勾选</option>
                <option value="subpage_edit">进入子页面编辑</option>
                <option value="submit">提交</option>
                <option value="wait">等待文字</option>
              </select>
            </label>
            <label>
              步骤名称
              <input name={`step_${index}_label`} defaultValue={step?.label ?? ""} placeholder="例如：输入课堂标题" />
            </label>
            <label>
              参数 key
              <input name={`step_${index}_valueParamKey`} defaultValue={step?.valueParamKey ?? ""} placeholder="例如：lessonName" />
            </label>
            <label>
              期望状态 key
              <input name={`step_${index}_desiredStateParamKey`} defaultValue={step?.desiredStateParamKey ?? ""} placeholder="例如：recordClassroom" />
            </label>
            <label>
              固定文字 / 等待文字
              <input name={`step_${index}_text`} defaultValue={step?.text ?? ""} placeholder="例如：发布成功" />
            </label>
          </div>
        ))}
      </div>
      <div className="asset-page-task-editor-actions">
        <button type="submit" disabled={busy || !elements.length}>
          保存页面任务
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

export function operationOutcomeFields(outcomeType: AssetRecordingElementOutcomeType): OperationOutcomeFields {
  if (outcomeType === "navigate") {
    return {
      requiresTargetPage: true,
      targetLabel: "目标页面",
      targetPlaceholder: "搜索已保存页面",
      resultLabel: "目标页面补充说明",
      resultPlaceholder: "例如：进入新建公开课页面"
    };
  }
  if (outcomeType === "compound_navigation") {
    return {
      requiresTargetPage: true,
      targetLabel: "最终目标页面",
      targetPlaceholder: "搜索最终到达的已保存页面",
      resultLabel: "复合步骤说明",
      resultPlaceholder: "例如：先点右上角更多，再点添加好友进入添加好友页"
    };
  }
  if (outcomeType === "show_inline_state") {
    return {
      requiresTargetPage: false,
      targetLabel: "出现内容",
      targetPlaceholder: "例如：出现添加好友、加入班级、扫一扫菜单",
      resultLabel: "出现内容",
      resultPlaceholder: "例如：出现添加好友、加入班级、扫一扫菜单"
    };
  }
  if (outcomeType === "no_visible_change") {
    return {
      requiresTargetPage: false,
      targetLabel: "执行结果",
      targetPlaceholder: "例如：无明显变化，仅触发后台刷新",
      resultLabel: "执行结果",
      resultPlaceholder: "例如：无明显变化，仅触发后台刷新"
    };
  }
  return {
    requiresTargetPage: false,
    targetLabel: "变化描述",
    targetPlaceholder: "例如：出现添加好友/加入班级菜单",
    resultLabel: "变化描述",
    resultPlaceholder: "例如：右上角展开更多操作菜单"
  };
}

function readElementOutcomeType(value: FormDataEntryValue | null): AssetRecordingElementOutcomeType | undefined {
  if (value === "navigate" || value === "compound_navigation" || value === "show_inline_state" || value === "local_state_change" || value === "no_visible_change") {
    return value;
  }
  return undefined;
}

function matchesTargetAsset(asset: AssetRecordingSavedAsset, query: string): boolean {
  const keyword = query.trim().toLowerCase();
  if (!keyword) {
    return true;
  }
  return [asset.name, asset.key, asset.platformScope]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(keyword));
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

function groupOperationCandidates(items: AssetRecordingPageElement[]): AssetOperationGroup[] {
  const conditionalItems = items.filter((item) => item.availability === "after_scroll" || item.availability === "conditional");
  const tapItems = items.filter((item) => !conditionalItems.includes(item) && normalizeActionKind(item) !== "scroll");
  const scrollItems = items.filter((item) => !conditionalItems.includes(item) && normalizeActionKind(item) === "scroll");
  return [
    { title: "点击候选", items: tapItems },
    { title: "滑动候选", items: scrollItems },
    { title: "条件候选", items: conditionalItems }
  ].filter((group) => group.items.length > 0);
}

function findTransitionForElement(transitions: AssetRecordingPageTransition[], element: AssetRecordingPageElement): AssetRecordingPageTransition | undefined {
  return transitions.find((transition) => transition.actionLocator === element.locator && (!transition.actionKind || transition.actionKind === normalizeActionKind(element)));
}

function normalizeActionKind(item: AssetRecordingPageElement): NonNullable<AssetRecordingPageElement["actionKind"]> {
  if (item.actionKind) {
    return item.actionKind;
  }
  if (/scroll|swipe|滑动/i.test(item.action)) {
    return "scroll";
  }
  if (/long/i.test(item.action)) {
    return "long_press";
  }
  return "tap";
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

export function pageTaskDraftFromForm(
  input: FormData | Record<string, FormDataEntryValue | string | undefined>,
  context: {
    sourceNodeId?: string;
    task?: AssetRecordingPageTask;
    elements: AssetRecordingPageElement[];
  }
): AssetRecordingPageTaskDraft {
  const get = (name: string) => (input instanceof FormData ? input.get(name) : input[name] ?? null);
  const steps: AssetRecordingPageTaskStep[] = [];
  const knownElementIds = new Set(context.elements.map((element) => element.id).filter((id): id is string => Boolean(id)));
  for (let index = 0; index < 12; index += 1) {
    const fieldType = readPageTaskFieldType(get(`step_${index}_fieldType`));
    const elementId = readFormString(get(`step_${index}_elementId`));
    const valueParamKey = readFormString(get(`step_${index}_valueParamKey`));
    const desiredStateParamKey = readFormString(get(`step_${index}_desiredStateParamKey`));
    const text = readFormString(get(`step_${index}_text`));
    const label = readFormString(get(`step_${index}_label`));
    if (fieldType !== "wait" && (!elementId || !knownElementIds.has(elementId))) {
      continue;
    }
    if (fieldType === "wait" && !text && !valueParamKey) {
      continue;
    }
    steps.push({
      id: readFormString(get(`step_${index}_id`)),
      order: steps.length + 1,
      elementId,
      fieldType,
      label,
      valueParamKey,
      desiredStateParamKey,
      text
    });
  }
  return {
    sourceNodeId: context.sourceNodeId,
    taskId: readFormString(get("taskId")) ?? context.task?.id,
    name: readFormString(get("taskName")) ?? context.task?.name ?? "页面任务",
    status: readPageTaskStatus(get("taskStatus")),
    steps
  };
}

export function operationTransitionDraftFromForm(
  input: FormData | Record<string, FormDataEntryValue | string | undefined>,
  context: {
    sourceNodeId?: string;
    locator: string;
    elementLabel: string;
    targetText?: string;
    abilityType?: AssetRecordingAbilityType;
    semanticArea?: VisualSemanticArea;
    coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
    scrollProfile?: AssetRecordingScrollProfile;
  }
): AssetRecordingOperationTransitionDraft {
  const get = (name: string) => (input instanceof FormData ? input.get(name) : input[name] ?? null);
  const actionKind = readActionKind(get("actionKind"));
  const outcomeType = readElementOutcomeType(get("outcomeType")) ?? "navigate";
  const abilityType = readAbilityTypeOptional(get("abilityType")) ?? context.abilityType;
  const semanticArea = readVisualSemanticArea(get("semanticArea")) ?? context.semanticArea ?? semanticAreaForLocator(context.locator);
  const scrollProfile = actionKind === "scroll" || abilityType === "grid_candidate" ? readScrollProfile(input, abilityType) : context.scrollProfile;
  const tapPointPercent = readTapPointPercent(input);
  const targetText = readFormString(get("targetText")) ?? context.targetText;
  const targetLabel = readFormString(get("targetLabel"));
  return {
    sourceNodeId: context.sourceNodeId,
    targetNodeId: outcomeType === "navigate" || outcomeType === "compound_navigation" ? readFormString(get("targetNodeId")) : undefined,
    ...(abilityType && abilityType !== "fixed_tap" ? { abilityType } : {}),
    actionKind,
    availability: readAvailability(get("availability")),
    outcomeType,
    locator: context.locator,
    semanticArea,
    coordinateSpace: context.coordinateSpace ?? (context.locator.startsWith("image-region:") ? "screen" : undefined),
    elementLabel: context.elementLabel,
    ...(targetText ? { targetText } : {}),
    ...(targetLabel ? { targetLabel } : {}),
    ...(tapPointPercent ? { tapPointPercent } : {}),
    ...(outcomeType === "compound_navigation" ? { compoundSteps: readCompoundSteps(input) } : {}),
    ...(scrollProfile ? { scrollProfile } : {})
  };
}

export function manualOperationDraftFromForm(
  input: FormData | Record<string, FormDataEntryValue | string | undefined>,
  context: { sourceNodeId?: string; region?: Pick<AssetRecordingScreenshotRegion, "x" | "y" | "width" | "height" | "semanticArea"> }
): AssetRecordingPageElementDraft {
  const get = (name: string) => (input instanceof FormData ? input.get(name) : input[name] ?? null);
  const abilityType = readAbilityType(get("abilityType"));
  const actionKind = readActionKind(get("actionKind"));
  const elementLabel = readFormString(get("elementLabel")) ?? manualActionLabel(actionKind);
  const tapPointPercent = readTapPointPercent(input);
  const locatorKind = readLocatorKind(get("locatorKind")) ?? (abilityType === "grid_candidate" ? "collection_item_locator" : "visual_locator");
  const targetText = readFormString(get("targetText"));
  const outcomeType = readElementOutcomeType(get("outcomeType"));
  const outcomeLabel = readFormString(get("outcomeLabel"));
  const targetNodeId = readFormString(get("targetNodeId"));
  const targetLabel = readFormString(get("targetLabel"));
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
      ...(abilityType === "fixed_tap" ? {} : { abilityType }),
      actionKind,
      availability: readAvailability(get("availability")),
      locator: `top-bar-icon:${role}`,
      semanticArea: "top",
      coordinateSpace: "runtime",
      elementLabel,
      locatorKind,
      ...(targetText ? { targetText } : {}),
      ...(outcomeType ? { outcomeType } : {}),
      ...(outcomeLabel ? { outcomeLabel } : {}),
      ...(targetNodeId ? { targetNodeId } : {}),
      ...(targetLabel ? { targetLabel } : {}),
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
        searchRegion: region
      },
      ...(outcomeType === "compound_navigation" ? { compoundSteps: readCompoundSteps(input) } : {})
    };
  }
  if (locatorKind === "text_locator") {
    const textTarget = targetText || elementLabel;
    return {
      elementId: readFormString(get("elementId")),
      sourceNodeId: context.sourceNodeId,
      ...(abilityType === "fixed_tap" ? {} : { abilityType }),
      actionKind,
      availability: readAvailability(get("availability")),
      locator: `text:${textTarget}`,
      semanticArea,
      coordinateSpace: "runtime",
      elementLabel,
      locatorKind,
      targetText: textTarget,
      ...(outcomeType ? { outcomeType } : {}),
      ...(outcomeLabel ? { outcomeLabel } : {}),
      ...(targetNodeId ? { targetNodeId } : {}),
      ...(targetLabel ? { targetLabel } : {}),
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
        : {}),
      ...(outcomeType === "compound_navigation" ? { compoundSteps: readCompoundSteps(input) } : {})
    };
  }
  if (!context.region) {
    throw new Error("marked region is required for this locator kind");
  }
  const structuralLocator = locatorKind === "structural_locator" ? structuralLocatorForRegion(context.region, elementLabel) : undefined;
  const collectionModel = locatorKind === "collection_item_locator" || abilityType === "grid_candidate"
    ? collectionModelFromForm(input, context.region, elementLabel, context.sourceNodeId)
    : undefined;
  return {
    elementId: readFormString(get("elementId")),
    sourceNodeId: context.sourceNodeId,
    ...(abilityType === "fixed_tap" ? {} : { abilityType }),
    actionKind,
    availability: readAvailability(get("availability")),
    locator: imageRegionLocator(context.region),
    semanticArea,
    coordinateSpace: "screen",
    elementLabel,
    locatorKind,
    ...(targetText ? { targetText } : {}),
    ...(outcomeType ? { outcomeType } : {}),
    ...(outcomeLabel ? { outcomeLabel } : {}),
    ...(targetNodeId ? { targetNodeId } : {}),
    ...(targetLabel ? { targetLabel } : {}),
    ...(tapPointPercent ? { tapPointPercent } : {}),
    ...(dynamicMasks?.length ? { dynamicMasks } : {}),
    ...(structuralLocator ? { structuralLocator } : {}),
    ...(collectionModel ? {
      dynamicRegion: collectionModel.dynamicRegion,
      itemTemplate: collectionModel.itemTemplate,
      transitionKind: "parameterized" as const,
      parameterMapping: collectionModel.parameterMapping
    } : {}),
    ...(outcomeType === "compound_navigation" ? { compoundSteps: readCompoundSteps(input) } : {}),
    ...(actionKind === "scroll" || abilityType === "grid_candidate" ? { scrollProfile: readScrollProfile(input, abilityType) } : {})
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
  parameterMapping: Record<string, string>;
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
    },
    parameterMapping: {
      [parameterName]: "dynamicRegion.item.titleText"
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

function readCompoundSteps(input: FormData | Record<string, FormDataEntryValue | string | undefined>): AssetRecordingCompoundStepDraft[] {
  const get = (name: string) => (input instanceof FormData ? input.get(name) : input[name] ?? null);
  const waitText = readFormString(get("compoundWaitText"));
  const tapText = readFormString(get("compoundTapText"));
  const timeoutMs = readPositiveInteger(get("compoundTimeoutMs"));
  const steps: AssetRecordingCompoundStepDraft[] = [];
  if (waitText) {
    steps.push({
      type: "wait_until_state",
      text: waitText,
      label: `等待 ${waitText} 出现`,
      ...(timeoutMs ? { timeoutMs } : {})
    });
  }
  if (tapText) {
    steps.push({
      type: "tap_on_text",
      text: tapText,
      label: `点击 ${tapText}`,
      ...(timeoutMs ? { timeoutMs } : {})
    });
  }
  return steps;
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

function abilityTypeFromElement(element: AssetRecordingPageElement): AssetRecordingAbilityType {
  if (element.abilityType === "scroll_candidate") {
    return "scroll_candidate";
  }
  if (element.scrollProfile?.containerKind === "grid_list" || element.scrollProfile?.failureStrategy === "try_next_candidate" || element.scrollProfile?.failureStrategy === "back_and_try_next_candidate") {
    return "grid_candidate";
  }
  if (element.availability === "conditional") {
    return "conditional_tap";
  }
  return "fixed_tap";
}

function abilityTypeLabel(abilityType: AssetRecordingAbilityType): string {
  if (abilityType === "grid_candidate") {
    return "网格候选入口";
  }
  if (abilityType === "scroll_candidate") {
    return "滚动查找目标";
  }
  if (abilityType === "conditional_tap") {
    return "条件点击能力";
  }
  return "固定点击能力";
}

function manualActionLabel(actionKind: ManualActionKind): string {
  if (actionKind === "scroll") {
    return "滑动区域";
  }
  if (actionKind === "long_press") {
    return "长按区域";
  }
  if (actionKind === "input") {
    return "输入区域";
  }
  return "点击区域";
}

function operationKindLabel(actionKind: NonNullable<AssetRecordingPageElement["actionKind"]>): string {
  if (actionKind === "scroll") {
    return "滑动";
  }
  if (actionKind === "long_press") {
    return "长按";
  }
  if (actionKind === "input") {
    return "输入";
  }
  return "点击";
}

function candidateSourceLabel(source: AssetRecordingAutoExploreCandidate["source"]): string {
  if (source === "manual_element") {
    return "已录入能力";
  }
  if (source === "ocr_text") {
    return "OCR 候选";
  }
  return "候选";
}

function exploreResultTypeLabel(type: AssetRecordingAutoExploreResult["resultType"]): string {
  if (type === "existing_page") {
    return "到达已保存页面";
  }
  if (type === "new_page_candidate") {
    return "新页面候选";
  }
  if (type === "local_state_change") {
    return "页面局部变化";
  }
  if (type === "no_change") {
    return "无明显变化";
  }
  if (type === "dangerous_skipped") {
    return "安全跳过";
  }
  return "失败";
}

function exploreResultStatusLabel(status: AssetRecordingAutoExploreResult["status"]): string {
  if (status === "passed") {
    return "已观察";
  }
  if (status === "skipped") {
    return "已跳过";
  }
  return "失败";
}

function availabilityLabel(availability: AssetRecordingPageElement["availability"]): string {
  if (availability === "after_scroll") {
    return "滚动后出现";
  }
  if (availability === "conditional") {
    return "条件出现";
  }
  return "当前可见";
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

function readScrollProfile(input: FormData | Record<string, FormDataEntryValue | string | undefined>, abilityType?: AssetRecordingAbilityType): AssetRecordingScrollProfile {
  const get = (name: string) => (input instanceof FormData ? input.get(name) : input[name] ?? null);
  const isGridCandidate = abilityType === "grid_candidate";
  const isScrollCandidate = abilityType === "scroll_candidate";
  return {
    containerKind: readScrollContainerKind(get("containerKind"), isGridCandidate),
    direction: readScrollDirection(get("scrollDirection")),
    columns: readColumns(get("layoutColumns")) ?? (isGridCandidate ? 2 : undefined),
    targetKind: readScrollTargetKind(get("targetKind"), isGridCandidate, isScrollCandidate),
    targetQuery: readFormString(get("targetQuery")),
    afterFoundAction: readAfterFoundAction(get("afterFoundAction")),
    ...(isGridCandidate || isScrollCandidate ? readCandidateProfile(input, isGridCandidate) : {})
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

function readAfterFoundAction(value: FormDataEntryValue | null): AssetRecordingScrollProfile["afterFoundAction"] {
  return value === "tap_child" || value === "verify_visible" ? value : "tap_item";
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

function readAbilityType(value: FormDataEntryValue | null): AssetRecordingAbilityType {
  return value === "scroll_candidate" || value === "grid_candidate" || value === "conditional_tap" ? value : "fixed_tap";
}

function readAbilityTypeOptional(value: FormDataEntryValue | null): AssetRecordingAbilityType | undefined {
  return value === "scroll_candidate" || value === "grid_candidate" || value === "conditional_tap" || value === "fixed_tap" ? value : undefined;
}

function readActionKind(value: FormDataEntryValue | null): AssetRecordingOperationTransitionDraft["actionKind"] {
  return value === "scroll" || value === "long_press" || value === "input" ? value : "tap";
}

function readAvailability(value: FormDataEntryValue | null): AssetRecordingOperationTransitionDraft["availability"] {
  return value === "after_scroll" || value === "conditional" ? value : "visible";
}

function readPageTaskFieldType(value: FormDataEntryValue | null): AssetRecordingPageTaskFieldType {
  return value === "text_input" ||
    value === "picker_select" ||
    value === "toggle_set" ||
    value === "subpage_edit" ||
    value === "submit" ||
    value === "wait"
    ? value
    : "tap";
}

function readPageTaskStatus(value: FormDataEntryValue | null): AssetRecordingPageTask["status"] {
  return value === "draft" || value === "deprecated" ? value : "active";
}

function pageTaskStepSummary(step: AssetRecordingPageTaskStep, elements: AssetRecordingPageElement[]): string {
  const element = step.elementId ? elements.find((item) => item.id === step.elementId) : undefined;
  const label = step.label ?? element?.label ?? pageTaskFieldTypeLabel(step.fieldType);
  return step.valueParamKey ? `${label}(${step.valueParamKey})` : label;
}

function pageTaskFieldTypeLabel(fieldType: AssetRecordingPageTaskFieldType): string {
  if (fieldType === "text_input") {
    return "输入文本";
  }
  if (fieldType === "picker_select") {
    return "选择器";
  }
  if (fieldType === "toggle_set") {
    return "开关/勾选";
  }
  if (fieldType === "subpage_edit") {
    return "进入子页面编辑";
  }
  if (fieldType === "submit") {
    return "提交";
  }
  if (fieldType === "wait") {
    return "等待文字";
  }
  return "点击";
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
