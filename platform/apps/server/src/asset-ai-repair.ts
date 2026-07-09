import type { BusinessGraphVersion, BusinessNode, StateMatcher } from "@mobile-automation/graph-core";
import type { AiDiagnosisResult, AssetPatchCandidate } from "./ai-diagnosis.js";

export type AiAssetRepairDecision =
  | {
      action: "apply";
      patch: AssetPatchCandidate;
      validation: AiAssetRepairValidation;
    }
  | {
      action: "skip";
      reason: string;
      validation?: AiAssetRepairValidation;
    };

export type AiAssetRepairValidation = {
  valid: boolean;
  reasons: string[];
};

export type AiAssetRepairApplyResult =
  | {
      status: "applied";
      nodeId: string;
      patchKind: AssetPatchCandidate["kind"];
      targetId: string;
      summary: string;
    }
  | {
      status: "skipped";
      reason: string;
      validation?: AiAssetRepairValidation;
    };

export type AiAssetRepairDiagnosisChoice = {
  diagnosis?: AiDiagnosisResult;
  source: "ai" | "local_graph_evidence";
  rejectedAiDecision?: Extract<AiAssetRepairDecision, { action: "skip" }>;
};

export type AiAssetRepairContext = {
  failedRunId?: string;
  failedTargetLabel?: string;
  transitionId?: string;
  pageTaskId?: string;
  elementId?: string;
  startNodeId?: string;
  targetNodeId?: string;
};

export type AiAssetRepairStorage = {
  getBusinessGraphVersion(id: string): BusinessGraphVersion | undefined;
  updateBusinessNodeMetadata(nodeId: string, metadata: Record<string, unknown>): BusinessNode | undefined;
  updateBusinessNodeDetails?: (
    nodeId: string,
    input: {
      matchers?: StateMatcher[];
      metadata?: Record<string, unknown>;
    }
  ) => BusinessNode | undefined;
};

export type LocalPageMatcherRepairInput = {
  targetNodeId?: string;
  targetNodeName?: string;
  afterMatch?: unknown;
};

const MIN_AUTO_APPLY_CONFIDENCE = 0.85;
const MAX_HISTORY_ITEMS = 30;
const LOCAL_PAGE_MATCHER_REPAIR_CONFIDENCE = 0.88;

const UNSAFE_KEY_PATTERN =
  /(^|[._-])(x|y|left|top|right|bottom|center|coordinate|coordinates|region_center|regioncenter|tap_point|tappoint|click_point|clickpoint|fallback_tap|fallbacktap|absolute|pixel|pixels|screen_bounds|screenbounds|bbox|bounds)([._-]|$)/i;
const UNSAFE_STRING_PATTERN = /\b(region_center|region-center|image-region|image_region|tap_region|tap-region|screen-coordinate|screen coordinate|absolute coordinate)\b/i;
const UNSAFE_LOCATOR_KIND_PATTERN = /^(region_center|coordinate|coordinates|screen_coordinate|image_region|image-region)$/i;

const ALLOWED_CHANGE_KEYS: Record<AssetPatchCandidate["kind"], Set<string>> = {
  page_transition: new Set([
    "id",
    "elementId",
    "action",
    "outcomeType",
    "targetNodeId",
    "targetLabel",
    "availability",
    "platformScope",
    "params",
    "compoundSteps",
    "aiHints",
    "notes",
    "quality"
  ]),
  page_element: new Set([
    "id",
    "label",
    "name",
    "targetText",
    "locator",
    "locatorKind",
    "structuralLocator",
    "visualLocator",
    "semanticArea",
    "elementKind",
    "actions",
    "availability",
    "platformScope",
    "anchorText",
    "role",
    "slot",
    "orderFromRight",
    "dynamicMasks",
    "dynamicRegionId",
    "itemTemplateId",
    "collection",
    "scrollProfile",
    "aiHints",
    "quality"
  ]),
  page_matcher: new Set([
    "matchers",
    "addMatchersDraft",
    "addMatchers",
    "deprioritizeMatchersDraft",
    "deprioritizeMatchers",
    "deprioritizeMatcherIds",
    "visualLocator",
    "ocrHints",
    "semanticAnchors",
    "identityHints",
    "aiHints",
    "quality"
  ]),
  page_task: new Set(["name", "description", "steps", "fields", "params", "aiHints", "quality"])
};

export function decideAiAssetRepair(diagnosis: AiDiagnosisResult, options: { minConfidence?: number } = {}): AiAssetRepairDecision {
  const minConfidence = options.minConfidence ?? MIN_AUTO_APPLY_CONFIDENCE;
  if (diagnosis.classification !== "asset_issue") {
    return { action: "skip", reason: `AI classified failure as ${diagnosis.classification}, not asset_issue.` };
  }
  if (diagnosis.recommendedAction !== "apply_verified_asset_patch" && diagnosis.recommendedAction !== "create_asset_patch") {
    return { action: "skip", reason: `AI recommended ${diagnosis.recommendedAction}, not an auto-repairable asset patch action.` };
  }
  if (diagnosis.recommendedAction === "create_asset_patch") {
    return {
      action: "skip",
      reason: "AI returned create_asset_patch; draft asset patch requires system verification before auto-apply."
    };
  }
  if (!diagnosis.safeToAutoApply) {
    return { action: "skip", reason: "AI did not mark the patch safeToAutoApply." };
  }
  if (diagnosis.confidence < minConfidence) {
    return { action: "skip", reason: `AI confidence ${diagnosis.confidence} is below ${minConfidence}.` };
  }
  if (!diagnosis.assetPatch) {
    return { action: "skip", reason: "AI did not provide an asset patch." };
  }
  const validation = validateAiAssetPatchCandidate(diagnosis.assetPatch);
  if (!validation.valid) {
    return { action: "skip", reason: "AI asset patch did not pass validation.", validation };
  }
  return { action: "apply", patch: diagnosis.assetPatch, validation };
}

export function chooseAssetRepairDiagnosis(input: LocalPageMatcherRepairInput & {
  aiDiagnosis?: AiDiagnosisResult;
  graphVersion?: BusinessGraphVersion;
  context?: AiAssetRepairContext;
}): AiAssetRepairDiagnosisChoice {
  if (!input.aiDiagnosis) {
    return {
      diagnosis: buildLocalPageMatcherRepairDiagnosis(input),
      source: "local_graph_evidence"
    };
  }

  const aiDecision = decideAiAssetRepair(input.aiDiagnosis);
  if (aiDecision.action === "apply") {
    return {
      diagnosis: input.aiDiagnosis,
      source: "ai"
    };
  }

  const verifiedPageElementDiagnosis = buildVerifiedPageElementRepairDiagnosis({
    diagnosis: input.aiDiagnosis,
    graphVersion: input.graphVersion,
    context: input.context
  });
  if (verifiedPageElementDiagnosis) {
    return {
      diagnosis: verifiedPageElementDiagnosis,
      source: "ai"
    };
  }

  if (!canFallbackToLocalGraphEvidence(input.aiDiagnosis, aiDecision)) {
    return {
      diagnosis: input.aiDiagnosis,
      source: "ai"
    };
  }

  const localDiagnosis = buildLocalPageMatcherRepairDiagnosis(input);
  if (localDiagnosis && decideAiAssetRepair(localDiagnosis).action === "apply") {
    return {
      diagnosis: localDiagnosis,
      source: "local_graph_evidence",
      rejectedAiDecision: aiDecision
    };
  }

  return {
    diagnosis: input.aiDiagnosis,
    source: "ai",
    rejectedAiDecision: aiDecision
  };
}

function buildVerifiedPageElementRepairDiagnosis(input: {
  diagnosis: AiDiagnosisResult;
  graphVersion?: BusinessGraphVersion;
  context?: AiAssetRepairContext;
}): AiDiagnosisResult | undefined {
  const patch = input.diagnosis.assetPatch;
  if (
    input.diagnosis.classification !== "asset_issue" ||
    input.diagnosis.recommendedAction !== "create_asset_patch" ||
    input.diagnosis.confidence < MIN_AUTO_APPLY_CONFIDENCE ||
    !patch ||
    patch.kind !== "page_element" ||
    patch.operation !== "update" ||
    !input.graphVersion
  ) {
    return undefined;
  }

  const targetId = resolvePatchTargetId(patch, input.context);
  if (!targetId || !findPageElementPatchTarget(input.graphVersion, targetId, input.context)) {
    return undefined;
  }
  const validation = validateAiAssetPatchCandidate(patch);
  if (!validation.valid || !hasPageElementRelocationEvidence(patch.changes)) {
    return undefined;
  }

  return {
    ...input.diagnosis,
    recommendedAction: "apply_verified_asset_patch",
    safeToAutoApply: true,
    assetPatch: {
      ...patch,
      targetId,
      changes: {
        ...patch.changes,
        quality: {
          ...readRecord(patch.changes.quality),
          status: "system_verified",
          source: "ai_page_element_draft_verified",
          confidence: input.diagnosis.confidence
        }
      }
    }
  };
}

export function validateAiAssetPatchCandidate(patch: AssetPatchCandidate): AiAssetRepairValidation {
  const reasons: string[] = [];
  if (patch.status !== "draft") {
    reasons.push("assetPatch.status must be draft.");
  }
  if (patch.operation !== "update") {
    reasons.push("Only update patches can be auto-applied.");
  }
  if (!isRecord(patch.changes) || !Object.keys(patch.changes).length) {
    reasons.push("assetPatch.changes must be a non-empty object.");
  }
  const allowedKeys = ALLOWED_CHANGE_KEYS[patch.kind];
  for (const key of Object.keys(patch.changes)) {
    if (!allowedKeys.has(key)) {
      reasons.push(`Unsupported ${patch.kind} change key: ${key}.`);
    }
  }
  findUnsafeCoordinates(patch.changes).forEach((item) => reasons.push(item));
  return {
    valid: reasons.length === 0,
    reasons
  };
}

function canFallbackToLocalGraphEvidence(
  diagnosis: AiDiagnosisResult,
  decision: AiAssetRepairDecision
): decision is Extract<AiAssetRepairDecision, { action: "skip" }> {
  return decision.action === "skip" && diagnosis.classification === "asset_issue";
}

export function buildLocalPageMatcherRepairDiagnosis(input: LocalPageMatcherRepairInput): AiDiagnosisResult | undefined {
  const targetId = input.targetNodeId?.trim();
  const targetName = input.targetNodeName?.trim();
  if (!targetId && !targetName) {
    return undefined;
  }
  const afterMatch = readRecord(input.afterMatch);
  const candidate = readRecordArray(afterMatch.candidates).find((item) =>
    Boolean(
      (targetId && stringValue(item.nodeId) === targetId) ||
        (targetName && stringValue(item.nodeName) === targetName)
    )
  );
  if (!candidate) {
    return undefined;
  }

  const matchedWeight = nonNegativeNumberValue(candidate.matchedWeight) ?? 0;
  const score = nonNegativeNumberValue(candidate.score) ?? 0;
  const quality = readRecord(candidate.quality);
  const staleMatcherIds = uniqueStrings([
    ...stringArrayValue(quality.missingCriticalMatcherIds),
    ...stringArrayValue(quality.missingStrongMatcherIds)
  ]);
  const positiveOcrEvidence = readRecordArray(candidate.matcherResults)
    .filter((item) => item.matched === true && stringValue(item.type) === "ocr_text")
    .map((item) => {
      const expected = firstStringValue(item.actual, item.expected);
      if (!expected || expected.length < 2) {
        return undefined;
      }
      return {
        type: "ocr_text",
        expected,
        weight: Math.max(1.4, Math.min(positiveNumberValue(item.weight) ?? 1.8, 2.2)),
        critical: Boolean(targetName && expected === targetName)
      };
    })
    .filter((item): item is { type: "ocr_text"; expected: string; weight: number; critical: boolean } => Boolean(item));

  if ((matchedWeight <= 0 && score < 0.2) || positiveOcrEvidence.length === 0 || staleMatcherIds.length === 0) {
    return undefined;
  }

  const targetLabel = targetName ?? targetId ?? "目标页面";
  return {
    classification: "asset_issue",
    confidence: LOCAL_PAGE_MATCHER_REPAIR_CONFIDENCE,
    summary: `本地运行证据显示已进入“${targetLabel}”，但旧页面识别锚点过期，导致状态被判为 unknown。`,
    reasoning: [
      "graph afterMatch 中存在目标页面候选并命中 OCR 正向证据。",
      "目标页面候选因旧强锚点或关键锚点缺失而低置信。",
      "修复只新增 OCR matcher 并降权过期 matcher，不恢复坐标兜底。"
    ],
    recommendedAction: "apply_verified_asset_patch",
    safeToAutoApply: true,
    assetPatch: {
      kind: "page_matcher",
      operation: "update",
      targetId: targetId ?? targetName,
      summary: `放宽并补强“${targetLabel}”页面识别规则。`,
      changes: {
        addMatchersDraft: dedupeMatcherDrafts(positiveOcrEvidence).slice(0, 4),
        deprioritizeMatchersDraft: staleMatcherIds,
        quality: {
          status: "system_verified",
          source: "local_graph_evidence"
        }
      },
      status: "draft"
    }
  };
}

export function applyVerifiedAiAssetPatch(input: {
  storage: AiAssetRepairStorage;
  graphVersionId: string;
  diagnosis: AiDiagnosisResult;
  context?: AiAssetRepairContext;
  now?: string;
}): AiAssetRepairApplyResult {
  const decision = decideAiAssetRepair(input.diagnosis);
  if (decision.action !== "apply") {
    return {
      status: "skipped",
      reason: decision.reason,
      validation: decision.validation
    };
  }

  const graphVersion = input.storage.getBusinessGraphVersion(input.graphVersionId);
  if (!graphVersion) {
    return { status: "skipped", reason: `Graph version not found: ${input.graphVersionId}.` };
  }
  const targetId = resolvePatchTargetId(decision.patch, input.context);
  if (!targetId) {
    return { status: "skipped", reason: `AI patch for ${decision.patch.kind} requires a target id.` };
  }

  if (decision.patch.kind === "page_transition") {
    return applyCollectionPatch({
      storage: input.storage,
      graphVersion,
      patch: decision.patch,
      context: input.context,
      targetId,
      metadataKey: "assetRecordingPageTransitions",
      findItem: (item) => item.id === targetId || generatedTransitionMatches(item, targetId, input.context),
      confidence: input.diagnosis.confidence,
      now: input.now
    });
  }
  if (decision.patch.kind === "page_element") {
    return applyCollectionPatch({
      storage: input.storage,
      graphVersion,
      patch: decision.patch,
      context: input.context,
      targetId,
      metadataKey: "assetRecordingPageElements",
      fallbackMetadataKey: "assetRecordingManualElements",
      findItem: (item) => item.id === targetId || item.locator === targetId || item.label === targetId || item.name === targetId,
      confidence: input.diagnosis.confidence,
      now: input.now
    });
  }
  if (decision.patch.kind === "page_task") {
    return applyCollectionPatch({
      storage: input.storage,
      graphVersion,
      patch: decision.patch,
      context: input.context,
      targetId,
      metadataKey: "assetRecordingPageTasks",
      findItem: (item) => item.id === targetId,
      confidence: input.diagnosis.confidence,
      now: input.now
    });
  }
  if (decision.patch.kind === "page_matcher") {
    return applyPageMatcherPatch({
      storage: input.storage,
      graphVersion,
      patch: decision.patch,
      context: input.context,
      targetId,
      confidence: input.diagnosis.confidence,
      now: input.now
    });
  }
  return { status: "skipped", reason: `Unsupported AI patch kind: ${decision.patch.kind}.` };
}

function applyCollectionPatch(input: {
  storage: AiAssetRepairStorage;
  graphVersion: BusinessGraphVersion;
  patch: AssetPatchCandidate;
  context?: AiAssetRepairContext;
  targetId: string;
  metadataKey: string;
  fallbackMetadataKey?: string;
  findItem(item: Record<string, unknown>): boolean;
  confidence?: number;
  now?: string;
}): AiAssetRepairApplyResult {
  const target = findMetadataCollectionItem(input.graphVersion, input.metadataKey, input.findItem)
    ?? (input.fallbackMetadataKey ? findMetadataCollectionItem(input.graphVersion, input.fallbackMetadataKey, input.findItem) : undefined);
  if (!target) {
    return { status: "skipped", reason: `AI patch target not found: ${input.patch.kind}:${input.targetId}.` };
  }

  const metadata = { ...(target.node.metadata ?? {}) };
  const collection = readRecordArray(metadata[target.metadataKey]);
  const nextCollection = collection.map((item, index) => index === target.index ? mergePatchIntoAsset(item, input.patch.changes) : item);
  const repairEvidence = {
    ...buildRepairEvidence(input.context, input.confidence),
    targetId: input.targetId
  };
  metadata[target.metadataKey] = nextCollection;
  metadata.aiAssetRepairHistory = appendRepairHistory(metadata.aiAssetRepairHistory, {
    appliedAt: input.now ?? new Date().toISOString(),
    runId: input.context?.failedRunId,
    label: input.context?.failedTargetLabel,
    patchKind: input.patch.kind,
    targetId: input.targetId,
    summary: input.patch.summary,
    confidence: input.confidence,
    evidence: repairEvidence,
    status: "applied"
  });
  const updated = input.storage.updateBusinessNodeMetadata(target.node.id, metadata);
  if (!updated) {
    return { status: "skipped", reason: `Failed updating node metadata: ${target.node.id}.` };
  }
  return {
    status: "applied",
    nodeId: target.node.id,
    patchKind: input.patch.kind,
    targetId: input.targetId,
    summary: input.patch.summary
  };
}

function applyPageMatcherPatch(input: {
  storage: AiAssetRepairStorage;
  graphVersion: BusinessGraphVersion;
  patch: AssetPatchCandidate;
  context?: AiAssetRepairContext;
  targetId: string;
  confidence?: number;
  now?: string;
}): AiAssetRepairApplyResult {
  const node = input.graphVersion.nodes.find((item) => item.id === input.targetId || item.key === input.targetId || item.name === input.targetId);
  if (!node) {
    return { status: "skipped", reason: `AI page matcher patch target node not found: ${input.targetId}.` };
  }
  const metadata = { ...(node.metadata ?? {}) };
  const repairEvidence = {
    ...buildRepairEvidence(input.context, input.confidence),
    targetId: input.targetId,
    targetNodeId: input.context?.targetNodeId ?? input.targetId
  };
  metadata.aiMatcherRepairDraft = {
    ...mergePatchIntoAsset(readRecord(metadata.aiMatcherRepairDraft), input.patch.changes),
    repairEvidence
  };
  metadata.aiAssetRepairHistory = appendRepairHistory(metadata.aiAssetRepairHistory, {
    appliedAt: input.now ?? new Date().toISOString(),
    runId: input.context?.failedRunId,
    label: input.context?.failedTargetLabel,
    patchKind: input.patch.kind,
    targetId: input.targetId,
    summary: input.patch.summary,
    confidence: input.confidence,
    evidence: repairEvidence,
    status: "applied"
  });
  const nextMatchers = buildPatchedPageMatchers(node.matchers, input.patch, {
    context: input.context,
    confidence: input.confidence
  });
  const updated = input.storage.updateBusinessNodeDetails
    ? input.storage.updateBusinessNodeDetails(node.id, { matchers: nextMatchers, metadata })
    : input.storage.updateBusinessNodeMetadata(node.id, metadata);
  if (!updated) {
    return { status: "skipped", reason: `Failed updating node metadata: ${node.id}.` };
  }
  return {
    status: "applied",
    nodeId: node.id,
    patchKind: input.patch.kind,
    targetId: input.targetId,
    summary: input.patch.summary
  };
}

function buildPatchedPageMatchers(
  existing: StateMatcher[],
  patch: AssetPatchCandidate,
  options: {
    context?: AiAssetRepairContext;
    confidence?: number;
  } = {}
): StateMatcher[] {
  const deprioritizedIds = new Set([
    ...stringArrayValue(patch.changes.deprioritizeMatchersDraft),
    ...stringArrayValue(patch.changes.deprioritizeMatchers),
    ...stringArrayValue(patch.changes.deprioritizeMatcherIds)
  ]);
  const base = existing.map((matcher) =>
    deprioritizedIds.has(matcher.id)
      ? {
          ...matcher,
          critical: false,
          weight: Math.min(matcher.weight, 0.4)
        }
      : matcher
  );
  const additions = [
    ...matcherArrayValue(patch.changes.addMatchersDraft, patch, options),
    ...matcherArrayValue(patch.changes.addMatchers, patch, options)
  ];
  if (Array.isArray(patch.changes.matchers)) {
    additions.push(...matcherArrayValue(patch.changes.matchers, patch, options));
  }
  const next = [...base];
  const matcherIndexes = new Map(next.map((matcher, index) => [matcherIdentityKey(matcher), index]));
  for (const matcher of additions) {
    const key = matcherIdentityKey(matcher);
    const existingIndex = matcherIndexes.get(key);
    if (existingIndex !== undefined) {
      next[existingIndex] = mergeMatcherEvidence(next[existingIndex] as StateMatcher, matcher);
      continue;
    }
    matcherIndexes.set(key, next.length);
    next.push(matcher);
  }
  return next;
}

function matcherArrayValue(
  value: unknown,
  patch: AssetPatchCandidate,
  options: {
    context?: AiAssetRepairContext;
    confidence?: number;
  }
): StateMatcher[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => normalizeMatcherDraft(item, patch, index, options))
    .filter((item): item is StateMatcher => Boolean(item));
}

function normalizeMatcherDraft(
  value: unknown,
  patch: AssetPatchCandidate,
  index: number,
  options: {
    context?: AiAssetRepairContext;
    confidence?: number;
  }
): StateMatcher | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const type = stringValue(value.type);
  if (!isSupportedMatcherType(type)) {
    return undefined;
  }
  const matcherValue = firstStringValue(value.value, value.expected, value.text, value.label);
  if (!matcherValue) {
    return undefined;
  }
  const id = stringValue(value.id) || stableAiMatcherId(patch, type, matcherValue, index);
  return {
    id,
    type,
    value: matcherValue,
    weight: positiveNumberValue(value.weight) ?? 1,
    critical: value.critical === true,
    threshold: positiveNumberValue(value.threshold),
    platformScope: supportedPlatformScope(value.platformScope),
    semanticArea: typeof value.semanticArea === "string" ? value.semanticArea as StateMatcher["semanticArea"] : undefined,
    source: buildAiDraftSource(options.context, options.confidence)
  };
}

function mergeMatcherEvidence(existing: StateMatcher, addition: StateMatcher): StateMatcher {
  return {
    ...existing,
    weight: Math.max(existing.weight, addition.weight),
    critical: existing.critical === true || addition.critical === true ? true : existing.critical,
    threshold: existing.threshold ?? addition.threshold,
    platformScope: existing.platformScope ?? addition.platformScope,
    semanticArea: existing.semanticArea ?? addition.semanticArea,
    source: existing.source?.sourceType === "manual_edit"
      ? existing.source
      : addition.source ?? existing.source
  };
}

function buildAiDraftSource(context?: AiAssetRepairContext, confidence?: number): StateMatcher["source"] {
  const source: NonNullable<StateMatcher["source"]> = { sourceType: "ai_draft" };
  if (context?.failedRunId) {
    source.artifactId = context.failedRunId;
  }
  if (typeof confidence === "number" && Number.isFinite(confidence)) {
    source.confidence = confidence;
  }
  return source;
}

function matcherIdentityKey(matcher: StateMatcher): string {
  return [
    matcher.type,
    matcher.value.trim(),
    matcher.semanticArea ?? "",
    matcher.platformScope ?? ""
  ].join("|");
}

function stableAiMatcherId(patch: AssetPatchCandidate, type: string, value: string, index: number): string {
  return `ai_${safeIdPart(patch.targetId ?? patch.kind)}_${safeIdPart(type)}_${safeIdPart(value)}_${index}`;
}

function safeIdPart(value: string): string {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized.slice(0, 48) || "matcher";
}

function isSupportedMatcherType(type: string): type is StateMatcher["type"] {
  return ["text", "ocr_text", "image_region", "semantic_image_region", "custom"].includes(type);
}

function supportedPlatformScope(value: unknown): StateMatcher["platformScope"] | undefined {
  const scope = stringValue(value);
  return ["android", "ios", "mobile-both"].includes(scope) ? scope as StateMatcher["platformScope"] : undefined;
}

function positiveNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function firstStringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function resolvePatchTargetId(patch: AssetPatchCandidate, context?: AiAssetRepairContext): string | undefined {
  if (patch.targetId?.trim()) {
    return patch.targetId.trim();
  }
  if (patch.kind === "page_transition") {
    return transitionAssetIdFromGeneratedEdgeId(context?.transitionId) ?? context?.transitionId;
  }
  if (patch.kind === "page_task") {
    return context?.pageTaskId;
  }
  if (patch.kind === "page_element") {
    return context?.elementId;
  }
  if (patch.kind === "page_matcher") {
    return context?.targetNodeId ?? context?.startNodeId;
  }
  return undefined;
}

function generatedTransitionMatches(item: Record<string, unknown>, generatedEdgeId: string, context?: AiAssetRepairContext): boolean {
  const itemId = stringValue(item.id);
  const assetId = transitionAssetIdFromGeneratedEdgeId(generatedEdgeId);
  if (assetId && itemId === assetId) {
    return true;
  }
  return Boolean(
    context?.targetNodeId &&
      stringValue(item.targetNodeId) === context.targetNodeId &&
      (!context.elementId || stringValue(item.elementId) === context.elementId)
  );
}

function transitionAssetIdFromGeneratedEdgeId(edgeId?: string): string | undefined {
  const marker = ".";
  const prefix = "edge_pagetransition.";
  if (!edgeId?.startsWith(prefix)) {
    return undefined;
  }
  const parts = edgeId.slice(prefix.length).split(marker);
  return parts.length >= 3 ? parts.slice(2).join(marker) : undefined;
}

function findMetadataCollectionItem(
  graphVersion: BusinessGraphVersion,
  metadataKey: string,
  predicate: (item: Record<string, unknown>) => boolean
): { node: BusinessNode; metadataKey: string; index: number; item: Record<string, unknown> } | undefined {
  for (const node of graphVersion.nodes) {
    const collection = readRecordArray(node.metadata?.[metadataKey]);
    const index = collection.findIndex(predicate);
    if (index >= 0) {
      return { node, metadataKey, index, item: collection[index] as Record<string, unknown> };
    }
  }
  return undefined;
}

function findPageElementPatchTarget(
  graphVersion: BusinessGraphVersion,
  targetId: string,
  context?: AiAssetRepairContext
): { node: BusinessNode; metadataKey: string; index: number; item: Record<string, unknown> } | undefined {
  const matches = (item: Record<string, unknown>) =>
    stringValue(item.id) === targetId ||
    stringValue(item.locator) === targetId ||
    stringValue(item.label) === targetId ||
    stringValue(item.name) === targetId;
  const search = (metadataKey: string) => {
    for (const node of graphVersion.nodes) {
      if (context?.startNodeId && node.id !== context.startNodeId) {
        continue;
      }
      const collection = readRecordArray(node.metadata?.[metadataKey]);
      const index = collection.findIndex(matches);
      if (index >= 0) {
        return { node, metadataKey, index, item: collection[index] as Record<string, unknown> };
      }
    }
    return undefined;
  };
  return search("assetRecordingPageElements") ?? search("assetRecordingManualElements");
}

function hasPageElementRelocationEvidence(changes: Record<string, unknown>): boolean {
  const locatorKind = stringValue(changes.locatorKind);
  if (
    [
      "text_locator",
      "visual_locator",
      "structural_locator",
      "collection_item_locator",
      "top_bar_icon_locator",
      "ocr_anchor_offset"
    ].includes(locatorKind)
  ) {
    return true;
  }

  const locator = stringValue(changes.locator);
  if (
    locator.startsWith("text:") ||
    locator.startsWith("top-bar-icon:") ||
    locator.startsWith("resource-id:") ||
    locator.startsWith("accessibility/desc:") ||
    locator.startsWith("runtime-locator:")
  ) {
    return true;
  }

  if (
    stringValue(changes.targetText) ||
    stringValue(changes.anchorText) ||
    stringValue(changes.role) ||
    stringValue(changes.slot)
  ) {
    return true;
  }

  const structuralLocator = readRecord(changes.structuralLocator);
  if (
    stringValue(structuralLocator.role) ||
    stringValue(structuralLocator.text) ||
    stringValue(structuralLocator.anchorText) ||
    stringValue(structuralLocator.resourceId) ||
    stringValue(structuralLocator.contentDesc) ||
    stringValue(structuralLocator.strategy)
  ) {
    return true;
  }

  const visualLocator = readRecord(changes.visualLocator);
  return Boolean(
    stringValue(visualLocator.strategy) ||
      stringValue(visualLocator.expectedIcon) ||
      stringValue(visualLocator.templateHash) ||
      stringValue(visualLocator.cropHash) ||
      stringValue(visualLocator.shape)
  );
}

function mergePatchIntoAsset(asset: Record<string, unknown>, changes: Record<string, unknown>): Record<string, unknown> {
  return {
    ...asset,
    ...changes,
    aiUpdatedAt: new Date().toISOString()
  };
}

function buildRepairEvidence(context?: AiAssetRepairContext, confidence?: number): Record<string, unknown> {
  const evidence: Record<string, unknown> = {};
  if (context?.failedRunId) {
    evidence.runId = context.failedRunId;
  }
  if (context?.failedTargetLabel) {
    evidence.label = context.failedTargetLabel;
  }
  if (context?.transitionId) {
    evidence.transitionId = context.transitionId;
  }
  if (context?.pageTaskId) {
    evidence.pageTaskId = context.pageTaskId;
  }
  if (context?.elementId) {
    evidence.elementId = context.elementId;
  }
  if (context?.startNodeId) {
    evidence.startNodeId = context.startNodeId;
  }
  if (context?.targetNodeId) {
    evidence.targetNodeId = context.targetNodeId;
  }
  if (typeof confidence === "number" && Number.isFinite(confidence)) {
    evidence.confidence = confidence;
  }
  return evidence;
}

function appendRepairHistory(value: unknown, item: Record<string, unknown>): Record<string, unknown>[] {
  return [...readRecordArray(value), item].slice(-MAX_HISTORY_ITEMS);
}

function findUnsafeCoordinates(value: unknown, path: string[] = []): string[] {
  const reasons: string[] = [];
  if (path.some((key) => UNSAFE_KEY_PATTERN.test(key))) {
    reasons.push(`Coordinate-like field is not allowed in AI auto repair: ${path.join(".")}.`);
  }
  if (typeof value === "string") {
    if (UNSAFE_STRING_PATTERN.test(value)) {
      reasons.push(`Coordinate fallback locator is not allowed in AI auto repair: ${path.join(".") || "<root>"}=${value}.`);
    }
    if (path.at(-1) === "locatorKind" && UNSAFE_LOCATOR_KIND_PATTERN.test(value)) {
      reasons.push(`locatorKind ${value} is not allowed in AI auto repair; region_center fallback must not be restored.`);
    }
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => reasons.push(...findUnsafeCoordinates(item, [...path, String(index)])));
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      reasons.push(...findUnsafeCoordinates(item, [...path, key]));
    }
  }
  return Array.from(new Set(reasons));
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function dedupeMatcherDrafts<T extends { type: string; expected: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.type}:${item.expected}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nonNegativeNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
