import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  BusinessGraph,
  BusinessGraphVersion,
  BusinessNode,
  GraphTargetApp,
  PlatformScope,
  StateMatcher
} from "@mobile-automation/graph-core";
import { parseScriptFlow, type ScriptFlowDocument, type ScriptParameterValue, type ScriptStep, type ScriptTarget } from "@mobile-automation/script-flow";
import {
  createId,
  nowIso,
  type ActionStep,
  type ArtifactRef,
  type DeviceEvent,
  type FlowVerification,
  type FlowVerificationStatus,
  type InteractionAsset,
  type LearningAggregate,
  type LearningAggregateStatus,
  type LearningCandidate,
  type LearningCandidateStatus,
  type LearningObservation,
  type LearningSession,
  type MetricSample,
  type NavigationEntry,
  type ScriptFlow,
  type ScriptFlowVersion,
  type StepResult,
  type TemporaryTest,
  type TestRun
} from "@mobile-automation/shared";
import { artifactRoot, dataRoot } from "./artifacts.js";
import {
  ASSET_LEARNING_MODE,
  shouldCollectAssetLearning,
  type AssetLearningMode
} from "./asset-learning-mode.js";
import { previewAiModelSettingsUpdate, type AiModelSettingsUpdateInput, type AiModelStoredSettings } from "./ai-model-settings.js";
import {
  derivePageNavigationSegments,
  type PageNavigationSegmentSnapshot
} from "./page-navigation.js";
import type { RuntimeInterceptorRule } from "./runtime-interceptor.js";
import { scriptFlowSourceHash } from "./script-flow-verification.js";
import { learningAggregateReadiness, requiresAiLearningAnalysis } from "./learning-lifecycle.js";
import { interactionCandidatesFromTrial } from "./trial-interaction-learning.js";
import { navigationCandidatesFromTrial } from "./trial-navigation-learning.js";
import { pageCandidatesFromTrial } from "./trial-page-learning.js";
import {
  classifyInteractionAssetStepOutcome,
  nextInteractionAssetHealth,
  type InteractionAssetHealth
} from "./interaction-asset-health.js";

const dbPath = path.join(dataRoot, "mobile-automation.sqlite");

type Row = Record<string, unknown>;

type CreateBusinessGraphInput = {
  appId: string;
  targetApp?: GraphTargetApp;
  platformScope: PlatformScope;
  name: string;
  status?: BusinessGraph["status"];
};

export type CreatePageAssetLibraryInput = {
  appId: string;
  name: string;
  targetApp: GraphTargetApp;
};

type UpdateBusinessGraphProfileInput = {
  appId?: string;
  targetApp?: GraphTargetApp;
  platformScope?: PlatformScope;
  name?: string;
  status?: BusinessGraph["status"];
};

type CreateBusinessGraphVersionInput = {
  graphId: string;
  sourceSummary?: string[];
  status?: BusinessGraphVersion["status"];
};

type CreateBusinessNodeInput = Omit<BusinessNode, "id" | "tags" | "status" | "matchers" | "defaultExpectations"> & {
  id?: string;
  tags?: string[];
  status?: BusinessNode["status"];
  matchers?: StateMatcher[];
  defaultExpectations?: BusinessNode["defaultExpectations"];
};

export type CreateScriptFlowInput = {
  sourceYaml: string;
  document: ScriptFlowDocument;
  status?: ScriptFlow["status"];
};

export type CreateFlowVerificationInput = Omit<FlowVerification, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
};

export type RecordTemporaryTestInput = {
  prompt: string;
  sourceYaml: string;
  document: ScriptFlowDocument;
  parameterValues: Record<string, ScriptParameterValue>;
  runId: string;
};

export type CreateLearningCandidateInput = Omit<LearningCandidate, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

type RuntimeInterceptorRuleFilter = {
  enabledOnly?: boolean;
  platform?: "android" | "ios";
  appPackageName?: string;
  iosBundleId?: string;
  flowId?: string;
  stepId?: string;
};

const AI_MODEL_SETTINGS_KEY = "ai_model";

export type StoredRunForCleanup = {
  id: string;
  status: TestRun["status"];
  createdAt: string;
  endedAt?: string;
};

export type StorageOptions = {
  assetLearningMode?: AssetLearningMode;
};

export class Storage {
  private readonly db: DatabaseSync;
  private readonly assetLearningMode: AssetLearningMode;

  constructor(options: StorageOptions = {}) {
    this.assetLearningMode = options.assetLearningMode ?? ASSET_LEARNING_MODE;
    mkdirSync(dataRoot, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.init();
  }

  close(): void {
    this.db.close();
  }

  async ensureDirs(): Promise<void> {
    await mkdir(dataRoot, { recursive: true });
    await mkdir(artifactRoot, { recursive: true });
  }

  createScriptFlow(input: CreateScriptFlowInput): ScriptFlow {
    const now = nowIso();
    const flow = scriptFlowFromInput(createId("script_flow"), 1, now, now, input);
    this.db.prepare("BEGIN").run();
    try {
      this.db.prepare(
        `INSERT INTO script_flows
          (id, app_id, platform, name, description, source_yaml, parsed_json, status, version, tags_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        flow.id,
        flow.appId,
        flow.platform,
        flow.name,
        flow.description ?? null,
        flow.sourceYaml,
        JSON.stringify(flow.parsed),
        flow.status,
        flow.version,
        JSON.stringify(flow.tags),
        flow.createdAt,
        flow.updatedAt
      );
      this.insertScriptFlowVersion(flow);
      this.replacePageNavigationSegments(flow, input.document);
      this.db.prepare("COMMIT").run();
    } catch (error) {
      this.db.prepare("ROLLBACK").run();
      throw error;
    }
    return flow;
  }

  listScriptFlows(filter: { appId?: string; platform?: ScriptFlow["platform"]; status?: ScriptFlow["status"] } = {}): ScriptFlow[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (filter.appId) {
      clauses.push("app_id = ?");
      values.push(filter.appId);
    }
    if (filter.platform) {
      clauses.push("platform = ?");
      values.push(filter.platform);
    }
    if (filter.status) {
      clauses.push("status = ?");
      values.push(filter.status);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM script_flows${where} ORDER BY updated_at DESC`).all(...values) as Row[];
    return rows.map(rowToScriptFlow);
  }

  getScriptFlow(id: string): ScriptFlow | undefined {
    const row = this.db.prepare("SELECT * FROM script_flows WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToScriptFlow(row) : undefined;
  }

  updateScriptFlow(id: string, input: CreateScriptFlowInput): ScriptFlow {
    const existing = this.getScriptFlow(id);
    if (!existing) {
      throw new Error(`ScriptFlow not found: ${id}`);
    }
    const next = scriptFlowFromInput(id, existing.version + 1, existing.createdAt, nowIso(), {
      ...input,
      status: input.status ?? existing.status
    });
    this.db.prepare("BEGIN").run();
    try {
      this.db.prepare(
        `UPDATE script_flows
         SET app_id = ?, platform = ?, name = ?, description = ?, source_yaml = ?, parsed_json = ?, status = ?, version = ?, tags_json = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        next.appId,
        next.platform,
        next.name,
        next.description ?? null,
        next.sourceYaml,
        JSON.stringify(next.parsed),
        next.status,
        next.version,
        JSON.stringify(next.tags),
        next.updatedAt,
        next.id
      );
      this.insertScriptFlowVersion(next);
      this.replacePageNavigationSegments(next, input.document);
      this.db.prepare("COMMIT").run();
    } catch (error) {
      this.db.prepare("ROLLBACK").run();
      throw error;
    }
    return next;
  }

  listScriptFlowVersions(flowId: string): ScriptFlowVersion[] {
    const rows = this.db.prepare(
      "SELECT * FROM script_flow_versions WHERE flow_id = ? ORDER BY version DESC"
    ).all(flowId) as Row[];
    return rows.map(rowToScriptFlowVersion);
  }

  deleteScriptFlow(id: string): boolean {
    return this.db.prepare("DELETE FROM script_flows WHERE id = ?").run(id).changes > 0;
  }

  recordTemporaryTest(input: RecordTemporaryTestInput): TemporaryTest {
    const now = nowIso();
    const sourceHash = createHash("sha256").update(input.sourceYaml).digest("hex");
    this.db.prepare(
      `INSERT INTO temporary_tests
        (id, source_hash, app_id, platform, kind, purpose, name, prompt, source_yaml, parsed_json,
         parameter_values_json, last_run_id, run_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(app_id, platform, source_hash) DO UPDATE SET
         kind = excluded.kind,
         purpose = excluded.purpose,
         name = excluded.name,
         prompt = excluded.prompt,
         source_yaml = excluded.source_yaml,
         parsed_json = excluded.parsed_json,
         parameter_values_json = excluded.parameter_values_json,
         last_run_id = excluded.last_run_id,
         run_count = temporary_tests.run_count + 1,
         updated_at = excluded.updated_at`
    ).run(
      createId("temporary_test"),
      sourceHash,
      input.document.app.id,
      input.document.app.platform,
      input.document.kind,
      input.document.purpose ?? "business",
      input.document.name,
      input.prompt,
      input.sourceYaml,
      JSON.stringify(input.document),
      JSON.stringify(input.parameterValues),
      input.runId,
      now,
      now
    );
    const row = this.db.prepare(
      `SELECT temporary_tests.*, runs.status AS last_run_status
       FROM temporary_tests
       LEFT JOIN runs ON runs.id = temporary_tests.last_run_id
       WHERE temporary_tests.app_id = ? AND temporary_tests.platform = ? AND temporary_tests.source_hash = ?`
    ).get(input.document.app.id, input.document.app.platform, sourceHash) as Row;
    return rowToTemporaryTest(row);
  }

  listTemporaryTests(filter: {
    appId?: string;
    platform?: ScriptFlow["platform"];
    limit?: number;
  } = {}): TemporaryTest[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (filter.appId) {
      clauses.push("temporary_tests.app_id = ?");
      values.push(filter.appId);
    }
    if (filter.platform) {
      clauses.push("temporary_tests.platform = ?");
      values.push(filter.platform);
    }
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    values.push(limit);
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(
      `SELECT temporary_tests.*, runs.status AS last_run_status
       FROM temporary_tests
       LEFT JOIN runs ON runs.id = temporary_tests.last_run_id
       ${where}
       ORDER BY temporary_tests.updated_at DESC
       LIMIT ?`
    ).all(...values) as Row[];
    return rows.map(rowToTemporaryTest);
  }

  listPageNavigationSegments(filter: {
    appId: string;
    platform: ScriptFlow["platform"];
  }): PageNavigationSegmentSnapshot[] {
    const rows = this.db.prepare(
      `SELECT * FROM script_navigation_segments
       WHERE app_id = ? AND platform = ?
       ORDER BY from_page ASC, to_page ASC, flow_id ASC, segment_order ASC`
    ).all(filter.appId, filter.platform) as Row[];
    const flowSegments = rows.map(rowToPageNavigationSegment);
    const learnedSegments = this.listNavigationEntries(filter)
      .filter((entry) => entry.status === "active" && entry.from.kind === "page")
      .map((entry) => navigationEntryToSegment(entry, filter.platform));
    return [...flowSegments, ...learnedSegments]
      .sort((left, right) => left.fromPage.localeCompare(right.fromPage)
        || left.toPage.localeCompare(right.toPage)
        || left.id.localeCompare(right.id));
  }

  createFlowVerification(input: CreateFlowVerificationInput): FlowVerification {
    const verification: FlowVerification = {
      ...input,
      id: input.id ?? createId("flow_verification"),
      createdAt: input.createdAt ?? nowIso()
    };
    this.db.prepare(
      `INSERT INTO flow_verifications
        (id, flow_id, flow_version, source_hash, app_id, platform, app_version, run_id, status, coverage_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      verification.id,
      verification.flowId ?? null,
      verification.flowVersion ?? null,
      verification.sourceHash,
      verification.appId,
      verification.platform,
      verification.appVersion ?? null,
      verification.runId,
      verification.status,
      JSON.stringify(verification.coverage),
      verification.createdAt
    );
    return verification;
  }

  findLatestFlowVerification(filter: {
    sourceHash: string;
    appId: string;
    platform: ScriptFlow["platform"];
    appVersion?: string;
    status?: FlowVerificationStatus;
  }): FlowVerification | undefined {
    const clauses = ["source_hash = ?", "app_id = ?", "platform = ?"];
    const values: Array<string> = [filter.sourceHash, filter.appId, filter.platform];
    if (filter.appVersion) {
      clauses.push("app_version = ?");
      values.push(filter.appVersion);
    }
    if (filter.status) {
      clauses.push("status = ?");
      values.push(filter.status);
    }
    const row = this.db.prepare(
      `SELECT * FROM flow_verifications WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT 1`
    ).get(...values) as Row | undefined;
    return row ? rowToFlowVerification(row) : undefined;
  }

  listFlowVerificationsForRun(runId: string): FlowVerification[] {
    const rows = this.db.prepare(
      "SELECT * FROM flow_verifications WHERE run_id = ? ORDER BY created_at DESC"
    ).all(runId) as Row[];
    return rows.map(rowToFlowVerification);
  }

  updateFlowVerificationStatus(id: string, status: FlowVerificationStatus): FlowVerification | undefined {
    this.db.prepare("UPDATE flow_verifications SET status = ? WHERE id = ?").run(status, id);
    const row = this.db.prepare("SELECT * FROM flow_verifications WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToFlowVerification(row) : undefined;
  }

  getLearningSessionForRun(runId: string): LearningSession | undefined {
    const row = this.db.prepare("SELECT * FROM learning_sessions WHERE run_id = ?").get(runId) as Row | undefined;
    return row ? rowToLearningSession(row) : undefined;
  }

  getLearningSession(id: string): LearningSession | undefined {
    const row = this.db.prepare("SELECT * FROM learning_sessions WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToLearningSession(row) : undefined;
  }

  createLearningCandidate(input: CreateLearningCandidateInput): LearningCandidate {
    if (!this.getLearningSession(input.sessionId)) {
      throw new Error(`Learning session not found: ${input.sessionId}`);
    }
    const now = nowIso();
    const candidate: LearningCandidate = {
      ...input,
      id: input.id ?? createId("learning_candidate"),
      createdAt: now,
      updatedAt: now
    };
    this.db.prepare(
      `INSERT INTO learning_candidates
        (id, session_id, kind, stable_key, source_step_id, confidence, status, payload_json,
         evidence_artifact_ids_json, validation_issues_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      candidate.id,
      candidate.sessionId,
      candidate.kind,
      candidate.stableKey ?? null,
      candidate.sourceStepId ?? null,
      candidate.confidence,
      candidate.status,
      JSON.stringify(candidate.payload),
      JSON.stringify(candidate.evidenceArtifactIds),
      JSON.stringify(candidate.validationIssues),
      candidate.createdAt,
      candidate.updatedAt
    );
    this.refreshLearningSummary(candidate.sessionId);
    return candidate;
  }

  listLearningCandidates(sessionId: string): LearningCandidate[] {
    const rows = this.db.prepare(
      "SELECT * FROM learning_candidates WHERE session_id = ? ORDER BY created_at ASC, id ASC"
    ).all(sessionId) as Row[];
    return rows.map(rowToLearningCandidate);
  }

  getLearningCandidate(id: string): LearningCandidate | undefined {
    const row = this.db.prepare("SELECT * FROM learning_candidates WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToLearningCandidate(row) : undefined;
  }

  listLearningAggregates(filter: {
    appId?: string;
    platform?: ScriptFlow["platform"];
    status?: LearningAggregateStatus;
  } = {}): LearningAggregate[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (filter.appId) {
      clauses.push("app_id = ?");
      values.push(filter.appId);
    }
    if (filter.platform) {
      clauses.push("platform = ?");
      values.push(filter.platform);
    }
    if (filter.status) {
      clauses.push("status = ?");
      values.push(filter.status);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(
      `SELECT * FROM learning_aggregates${where} ORDER BY updated_at DESC, id ASC`
    ).all(...values) as Row[];
    return rows.map(rowToLearningAggregate);
  }

  getLearningAggregate(id: string): LearningAggregate | undefined {
    const row = this.db.prepare("SELECT * FROM learning_aggregates WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToLearningAggregate(row) : undefined;
  }

  listLearningObservations(aggregateId: string): LearningObservation[] {
    const rows = this.db.prepare(
      "SELECT * FROM learning_observations WHERE aggregate_id = ? ORDER BY created_at ASC, id ASC"
    ).all(aggregateId) as Row[];
    return rows.map(rowToLearningObservation);
  }

  updateLearningAggregate(input: {
    id: string;
    status: LearningAggregateStatus;
    analysis?: Record<string, unknown>;
    assetId?: string;
    lastError?: string;
  }): LearningAggregate | undefined {
    const current = this.getLearningAggregate(input.id);
    if (!current) return undefined;
    this.db.prepare(
      `UPDATE learning_aggregates
       SET status = ?, analysis_json = ?, asset_id = ?, last_error = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      input.status,
      input.analysis === undefined ? current.analysis ? JSON.stringify(current.analysis) : null : JSON.stringify(input.analysis),
      input.assetId ?? current.assetId ?? null,
      input.lastError ?? null,
      nowIso(),
      input.id
    );
    return this.getLearningAggregate(input.id);
  }

  promoteLearningAggregate(
    id: string,
    analysis?: Record<string, unknown>
  ): LearningAggregate {
    const aggregate = this.getLearningAggregate(id);
    if (!aggregate) throw new Error(`Learning aggregate not found: ${id}`);
    if (aggregate.status !== "ready") {
      throw new Error(`Learning aggregate ${id} is not ready for promotion`);
    }
    if (aggregate.analysisRequired && analysis?.decision !== "approve") {
      throw new Error(`Learning aggregate ${id} requires an approved AI proposal`);
    }
    const candidate = this.getLearningCandidate(aggregate.representativeCandidateId);
    if (!candidate) throw new Error(`Representative learning candidate not found: ${aggregate.representativeCandidateId}`);
    if (candidate.kind === "page") {
      const pageId = this.promotePageLearningAggregate(aggregate, candidate, analysis);
      const promoted = this.updateLearningAggregate({
        id,
        status: "active",
        ...(analysis ? { analysis } : {}),
        assetId: pageId
      });
      if (!promoted) throw new Error(`Learning aggregate not found after promotion: ${id}`);
      return promoted;
    }
    const accepted = this.acceptLearningSession(candidate.sessionId, [candidate.id]);
    const assetId = candidate.kind === "interaction"
      ? accepted.assets[0]?.id
      : accepted.navigationEntries[0]?.id;
    if (!assetId) throw new Error(`Learning aggregate ${id} did not produce an asset`);
    if (candidate.kind === "interaction") {
      this.db.prepare(
        `UPDATE interaction_asset_health
         SET status = 'active', consecutive_locator_failures = 0, last_error = NULL, updated_at = ?
         WHERE asset_id = ?`
      ).run(nowIso(), assetId);
    }
    const promoted = this.updateLearningAggregate({
      id,
      status: "active",
      ...(analysis ? { analysis } : {}),
      assetId
    });
    if (!promoted) throw new Error(`Learning aggregate not found after promotion: ${id}`);
    return promoted;
  }

  private promotePageLearningAggregate(
    aggregate: LearningAggregate,
    candidate: LearningCandidate,
    analysis: Record<string, unknown> | undefined
  ): string {
    const proposal = approvedPageLearningProposal(analysis);
    let graph = this.findBusinessGraphByAppId(aggregate.appId);
    if (!graph) {
      graph = this.createPageAssetLibrary({
        appId: aggregate.appId,
        name: `${aggregate.appId} 页面资产库`,
        targetApp: {
          productId: aggregate.appId,
          productName: aggregate.appId,
          profiles: [{
            id: `${aggregate.platform}:${aggregate.appId}`,
            platform: aggregate.platform,
            displayName: `${aggregate.appId} ${aggregate.platform}`,
            ...(aggregate.platform === "android"
              ? { androidPackageName: aggregate.appId }
              : aggregate.platform === "ios"
                ? { iosBundleId: aggregate.appId }
                : aggregate.platform === "harmony"
                  ? { harmonyBundleName: aggregate.appId }
                  : { flutterAppId: aggregate.appId }),
            isPrimary: true
          }]
        }
      });
    }
    let version = this.getActiveBusinessGraphVersion(graph.id);
    if (!version) {
      const created = this.createBusinessGraphVersion({
        graphId: graph.id,
        sourceSummary: ["自动学习页面资产"],
        status: "active"
      });
      this.setActiveBusinessGraphVersion(graph.id, created.id);
      version = this.getBusinessGraphVersion(created.id);
    }
    if (!version) throw new Error(`Page asset library has no active version: ${graph.id}`);

    const existing = version.nodes.find((node) =>
      node.nodeType === "page"
      && node.status === "active"
      && node.metadata?.assetRecordingConfirmed === true
      && (node.key === proposal.key || normalizeLearningText(node.name) === normalizeLearningText(proposal.name))
    );
    if (existing) return existing.id;

    const proposedTexts = new Set(proposal.stableTexts.map(normalizeLearningText));
    const conflict = version.nodes.find((node) => {
      if (node.nodeType !== "page" || node.status !== "active" || node.metadata?.assetRecordingConfirmed !== true) return false;
      const existingTexts = new Set(node.matchers
        .filter((matcher) => matcher.type === "ocr_text")
        .map((matcher) => normalizeLearningText(matcher.value)));
      return [...proposedTexts].filter((text) => existingTexts.has(text)).length >= 2;
    });
    if (conflict) {
      throw new Error(`Page identity conflicts with existing asset: ${conflict.name}`);
    }

    const observations = this.listLearningObservations(aggregate.id);
    const platformScope = aggregate.platform === "android" || aggregate.platform === "ios"
      ? aggregate.platform
      : undefined;
    const node = this.createBusinessNode({
      graphVersionId: version.id,
      key: proposal.key,
      name: proposal.name,
      nodeType: "page",
      tags: ["automatic-learning"],
      status: "active",
      ...(platformScope ? { platformScope } : {}),
      matchers: proposal.stableTexts.map((text) => ({
        id: createId("matcher"),
        type: "ocr_text" as const,
        value: text,
        weight: 2,
        critical: true,
        ...(platformScope ? { platformScope } : {}),
        source: { sourceType: "ai_draft" as const }
      })),
      defaultExpectations: [],
      metadata: {
        assetRecordingConfirmed: true,
        automaticLearning: true,
        learningAggregateId: aggregate.id,
        representativeCandidateId: candidate.id,
        evidenceRunIds: observations.map((item) => item.runId),
        evidenceArtifactIds: uniqueStrings(observations.flatMap((item) => item.evidenceArtifactIds)),
        learnedAt: nowIso(),
        aiAnalysis: analysis
      }
    });
    return node.id;
  }

  updateLearningCandidateStatus(id: string, status: LearningCandidateStatus): LearningCandidate | undefined {
    const current = this.db.prepare("SELECT session_id FROM learning_candidates WHERE id = ?").get(id) as Row | undefined;
    if (!current) return undefined;
    this.db.prepare("UPDATE learning_candidates SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
    this.refreshLearningSummary(String(current.session_id));
    const row = this.db.prepare("SELECT * FROM learning_candidates WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToLearningCandidate(row) : undefined;
  }

  deleteLearningSession(id: string): boolean {
    return this.db.prepare("DELETE FROM learning_sessions WHERE id = ?").run(id).changes > 0;
  }

  listInteractionAssets(filter: { appId: string; platform?: ScriptFlow["platform"] }): InteractionAsset[] {
    const rows = filter.platform
      ? this.db.prepare(
        "SELECT * FROM interaction_assets WHERE app_id = ? AND platform_scope IN (?, 'mobile-both') ORDER BY updated_at DESC"
      ).all(filter.appId, filter.platform) as Row[]
      : this.db.prepare(
        "SELECT * FROM interaction_assets WHERE app_id = ? ORDER BY updated_at DESC"
      ).all(filter.appId) as Row[];
    return rows.map(rowToInteractionAsset);
  }

  getInteractionAssetHealth(assetId: string): (InteractionAssetHealth & {
    lastRunId?: string;
    lastError?: string;
    updatedAt: string;
  }) | undefined {
    const row = this.db.prepare("SELECT * FROM interaction_asset_health WHERE asset_id = ?").get(assetId) as Row | undefined;
    if (!row) return undefined;
    return {
      status: String(row.status) as InteractionAssetHealth["status"],
      consecutiveLocatorFailures: Number(row.consecutive_locator_failures),
      successfulRunCount: Number(row.successful_run_count),
      lastRunId: stringOrUndefined(row.last_run_id),
      lastError: stringOrUndefined(row.last_error),
      updatedAt: String(row.updated_at)
    };
  }

  listNavigationEntries(filter: { appId: string; platform?: ScriptFlow["platform"] }): NavigationEntry[] {
    const rows = filter.platform
      ? this.db.prepare(
        "SELECT * FROM navigation_entries WHERE app_id = ? AND platform_scope IN (?, 'mobile-both') ORDER BY updated_at DESC"
      ).all(filter.appId, filter.platform) as Row[]
      : this.db.prepare(
        "SELECT * FROM navigation_entries WHERE app_id = ? ORDER BY updated_at DESC"
      ).all(filter.appId) as Row[];
    return rows.map(rowToNavigationEntry);
  }

  acceptLearningSession(sessionId: string, candidateIds: string[]): {
    session: LearningSession;
    assets: InteractionAsset[];
    navigationEntries: NavigationEntry[];
  } {
    const session = this.getLearningSession(sessionId);
    if (!session) throw new Error(`Learning session not found: ${sessionId}`);
    if (!["ready", "accepted"].includes(session.status) || !session.executionPassed || !["verified", "human_confirmed"].includes(session.outcomeStatus)) {
      throw new Error("Learning session is not ready for acceptance");
    }
    const selectedIds = [...new Set(candidateIds)];
    if (selectedIds.length === 0) throw new Error("At least one learning candidate must be selected");
    const candidates = this.listLearningCandidates(sessionId).filter((candidate) => selectedIds.includes(candidate.id));
    if (candidates.length !== selectedIds.length) throw new Error("Learning candidate not found in this session");
    const unsupported = candidates.find((candidate) => candidate.kind !== "interaction" && candidate.kind !== "navigation");
    if (unsupported) throw new Error(`Learning candidate ${unsupported.id} cannot be accepted as a reusable asset`);
    const drafts = candidates
      .filter((candidate) => candidate.kind === "interaction")
      .map((candidate) => interactionAssetFromCandidate(session, candidate));
    const navigationDrafts = candidates
      .filter((candidate) => candidate.kind === "navigation")
      .map((candidate) => navigationEntryFromCandidate(session, candidate));
    const acceptedIds: string[] = [];
    const acceptedNavigationIds: string[] = [];
    const now = nowIso();

    this.db.prepare("BEGIN").run();
    try {
      for (const draft of drafts) {
        const existingRow = this.db.prepare(
          `SELECT * FROM interaction_assets
           WHERE app_id = ? AND platform_scope = ? AND owner_kind = ? AND owner_key = ? AND asset_key = ?`
        ).get(draft.appId, draft.platformScope, draft.owner.kind, draft.owner.key, draft.key) as Row | undefined;
        const asset = existingRow
          ? mergeInteractionAsset(rowToInteractionAsset(existingRow), draft, now)
          : { ...draft, id: createId("interaction_asset"), version: 1, createdAt: now, updatedAt: now };
        if (existingRow) {
          this.db.prepare(
            `UPDATE interaction_assets SET name = ?, aliases_json = ?, supported_actions_json = ?,
             semantic_contract_json = ?, locator_variants_json = ?, status = ?, version = ?, provenance_json = ?, updated_at = ?
             WHERE id = ?`
          ).run(
            asset.name,
            JSON.stringify(asset.aliases),
            JSON.stringify(asset.supportedActions),
            JSON.stringify(asset.semanticContract),
            JSON.stringify(asset.locatorVariants),
            asset.status,
            asset.version,
            JSON.stringify(asset.provenance),
            asset.updatedAt,
            asset.id
          );
        } else {
          this.db.prepare(
            `INSERT INTO interaction_assets
              (id, asset_key, app_id, platform_scope, owner_kind, owner_key, name, aliases_json,
               supported_actions_json, semantic_contract_json, locator_variants_json, status, version,
               provenance_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            asset.id,
            asset.key,
            asset.appId,
            asset.platformScope,
            asset.owner.kind,
            asset.owner.key,
            asset.name,
            JSON.stringify(asset.aliases),
            JSON.stringify(asset.supportedActions),
            JSON.stringify(asset.semanticContract),
            JSON.stringify(asset.locatorVariants),
            asset.status,
            asset.version,
            JSON.stringify(asset.provenance),
            asset.createdAt,
            asset.updatedAt
          );
        }
        this.db.prepare(
          `INSERT INTO interaction_asset_versions (id, asset_id, version, snapshot_json, created_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(createId("interaction_asset_version"), asset.id, asset.version, JSON.stringify(asset), now);
        acceptedIds.push(asset.id);
      }
      for (const draft of navigationDrafts) {
        const existingRow = this.db.prepare(
          `SELECT * FROM navigation_entries
           WHERE app_id = ? AND platform_scope = ? AND entry_key = ?`
        ).get(draft.appId, draft.platformScope, draft.key) as Row | undefined;
        const entry = existingRow
          ? mergeNavigationEntry(rowToNavigationEntry(existingRow), draft, now)
          : { ...draft, id: createId("navigation_entry"), version: 1, createdAt: now, updatedAt: now };
        if (existingRow) {
          this.db.prepare(
            `UPDATE navigation_entries SET from_kind = ?, from_key = ?, from_role = ?, to_page = ?, name = ?,
             action_json = ?, confidence = ?, status = ?, version = ?, provenance_json = ?, updated_at = ?
             WHERE id = ?`
          ).run(
            entry.from.kind,
            entry.from.key,
            entry.from.kind === "session" ? entry.from.role ?? null : null,
            entry.toPage,
            entry.name,
            JSON.stringify(entry.action),
            entry.confidence,
            entry.status,
            entry.version,
            JSON.stringify(entry.provenance),
            entry.updatedAt,
            entry.id
          );
        } else {
          this.db.prepare(
            `INSERT INTO navigation_entries
              (id, entry_key, app_id, platform_scope, from_kind, from_key, from_role, to_page, name,
               action_json, confidence, status, version, provenance_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            entry.id,
            entry.key,
            entry.appId,
            entry.platformScope,
            entry.from.kind,
            entry.from.key,
            entry.from.kind === "session" ? entry.from.role ?? null : null,
            entry.toPage,
            entry.name,
            JSON.stringify(entry.action),
            entry.confidence,
            entry.status,
            entry.version,
            JSON.stringify(entry.provenance),
            entry.createdAt,
            entry.updatedAt
          );
        }
        this.db.prepare(
          `INSERT INTO navigation_entry_versions (id, entry_id, version, snapshot_json, created_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(createId("navigation_entry_version"), entry.id, entry.version, JSON.stringify(entry), now);
        acceptedNavigationIds.push(entry.id);
      }
      const placeholders = selectedIds.map(() => "?").join(", ");
      this.db.prepare(
        `UPDATE learning_candidates SET status = 'accepted', updated_at = ? WHERE session_id = ? AND id IN (${placeholders})`
      ).run(now, sessionId, ...selectedIds);
      const verification = this.listFlowVerificationsForRun(session.runId).find((item) => item.status === "verified");
      if (verification) {
        this.db.prepare("UPDATE flow_verifications SET coverage_json = ? WHERE id = ?").run(
          JSON.stringify({
            ...verification.coverage,
            interactionAssetIds: uniqueStrings([...verification.coverage.interactionAssetIds, ...acceptedIds])
          }),
          verification.id
        );
      }
      this.db.prepare("UPDATE learning_sessions SET status = 'accepted', updated_at = ? WHERE id = ?").run(now, sessionId);
      this.db.prepare("COMMIT").run();
    } catch (error) {
      this.db.prepare("ROLLBACK").run();
      throw error;
    }
    const acceptedSession = this.getLearningSession(sessionId);
    if (!acceptedSession) throw new Error(`Learning session not found: ${sessionId}`);
    const assets = acceptedIds.flatMap((id) => {
      const row = this.db.prepare("SELECT * FROM interaction_assets WHERE id = ?").get(id) as Row | undefined;
      return row ? [rowToInteractionAsset(row)] : [];
    });
    const navigationEntries = acceptedNavigationIds.flatMap((id) => {
      const row = this.db.prepare("SELECT * FROM navigation_entries WHERE id = ?").get(id) as Row | undefined;
      return row ? [rowToNavigationEntry(row)] : [];
    });
    return { session: acceptedSession, assets, navigationEntries };
  }

  reviewTrialOutcome(runId: string, decision: "confirmed" | "rejected"): {
    session: LearningSession;
    verification?: FlowVerification;
  } {
    const current = this.getLearningSessionForRun(runId);
    if (!current) throw new Error(`Learning session not found for run: ${runId}`);
    if (!current.executionPassed || current.status !== "needs_outcome_review") {
      throw new Error("Trial outcome is not awaiting review");
    }
    const verification = this.listFlowVerificationsForRun(runId)[0];
    const now = nowIso();
    this.db.prepare("BEGIN").run();
    try {
      this.db.prepare(
        "UPDATE learning_sessions SET outcome_status = ?, status = ?, updated_at = ? WHERE id = ?"
      ).run(
        decision === "confirmed" ? "human_confirmed" : "rejected",
        decision === "confirmed" ? "ready" : "rejected",
        now,
        current.id
      );
      if (verification) {
        this.db.prepare("UPDATE flow_verifications SET status = ?, coverage_json = ? WHERE id = ?").run(
          decision === "confirmed" ? "verified" : "invalidated",
          JSON.stringify({
            ...verification.coverage,
            humanConfirmedOutcome: decision === "confirmed"
          }),
          verification.id
        );
      }
      this.db.prepare("COMMIT").run();
    } catch (error) {
      this.db.prepare("ROLLBACK").run();
      throw error;
    }
    if (decision === "confirmed") {
      this.refreshPageNavigationIndex();
      this.aggregateLearningSession(current.id);
    }
    const session = this.getLearningSessionForRun(runId);
    if (!session) throw new Error(`Learning session not found for run: ${runId}`);
    const updatedVerification = verification
      ? this.listFlowVerificationsForRun(runId).find((item) => item.id === verification.id)
      : undefined;
    return { session, ...(updatedVerification ? { verification: updatedVerification } : {}) };
  }


  createRuntimeInterceptorRule(input: Omit<RuntimeInterceptorRule, "id" | "createdAt" | "updatedAt"> & { id?: string }): RuntimeInterceptorRule {
    const now = nowIso();
    const rule: RuntimeInterceptorRule = {
      ...input,
      id: input.id ?? createId("runtime_rule"),
      enabled: input.enabled ?? true,
      matchers: input.matchers ?? (input.text ? [{ type: "text", value: input.text }] : []),
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO runtime_interceptor_rules
          (id, name, enabled, platform_scope, app_package_name, ios_bundle_id, flow_id, step_id, text, matchers_json, action_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        rule.id,
        rule.name,
        rule.enabled === false ? 0 : 1,
        rule.platformScope ?? null,
        rule.appPackageName ?? null,
        rule.iosBundleId ?? null,
        rule.flowId ?? null,
        rule.stepId ?? null,
        rule.text ?? null,
        JSON.stringify(rule.matchers ?? []),
        JSON.stringify(rule.action),
        rule.createdAt ?? now,
        rule.updatedAt ?? now
      );
    return rule;
  }

  listRuntimeInterceptorRules(filter: RuntimeInterceptorRuleFilter = {}): RuntimeInterceptorRule[] {
    const rows = this.db.prepare("SELECT * FROM runtime_interceptor_rules ORDER BY updated_at DESC, created_at DESC").all() as Row[];
    return rows.map(runtimeInterceptorRuleFromRow).filter((rule) => runtimeInterceptorRuleMatchesFilter(rule, filter));
  }

  updateRuntimeInterceptorRule(
    id: string,
    patch: Partial<Omit<RuntimeInterceptorRule, "id" | "createdAt" | "updatedAt">>
  ): RuntimeInterceptorRule | undefined {
    const existing = this.listRuntimeInterceptorRules().find((rule) => rule.id === id);
    if (!existing) {
      return undefined;
    }
    const now = nowIso();
    const next: RuntimeInterceptorRule = {
      ...existing,
      ...patch,
      matchers: patch.matchers ?? existing.matchers,
      action: patch.action ?? existing.action,
      updatedAt: now
    };
    this.db
      .prepare(
        `UPDATE runtime_interceptor_rules
         SET name = ?, enabled = ?, platform_scope = ?, app_package_name = ?, ios_bundle_id = ?, flow_id = ?, step_id = ?, text = ?, matchers_json = ?, action_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.name,
        next.enabled === false ? 0 : 1,
        next.platformScope ?? null,
        next.appPackageName ?? null,
        next.iosBundleId ?? null,
        next.flowId ?? null,
        next.stepId ?? null,
        next.text ?? null,
        JSON.stringify(next.matchers ?? []),
        JSON.stringify(next.action),
        next.updatedAt ?? now,
        id
      );
    return next;
  }

  deleteRuntimeInterceptorRule(id: string): boolean {
    const result = this.db.prepare("DELETE FROM runtime_interceptor_rules WHERE id = ?").run(id);
    return result.changes > 0;
  }

  getAiModelSettings(): AiModelStoredSettings | undefined {
    const row = this.db.prepare("SELECT value_json, updated_at FROM app_settings WHERE setting_key = ?").get(AI_MODEL_SETTINGS_KEY) as Row | undefined;
    if (!row) {
      return undefined;
    }
    const parsed = parseJsonObject(String(row.value_json));
    return normalizeAiModelSettings({ ...parsed, updatedAt: String(row.updated_at) });
  }

  updateAiModelSettings(input: AiModelSettingsUpdateInput): AiModelStoredSettings {
    const existing = this.getAiModelSettings();
    const now = nowIso();
    const next = normalizeAiModelSettings({
      ...previewAiModelSettingsUpdate(existing, input),
      updatedAt: now
    });
    this.db
      .prepare(
        `INSERT INTO app_settings (setting_key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(AI_MODEL_SETTINGS_KEY, JSON.stringify(stripUndefined({ ...next, updatedAt: undefined })), now);
    return next;
  }

  createBusinessGraph(input: CreateBusinessGraphInput): BusinessGraph {
    const id = createId("graph");
    const now = nowIso();
    const graph: BusinessGraph = {
      id,
      appId: input.appId,
      targetApp: input.targetApp,
      platformScope: input.platformScope,
      name: input.name,
      status: input.status ?? "draft",
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO business_graphs (id, app_id, target_app_json, platform_scope, name, status, active_version_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(graph.id, graph.appId, JSON.stringify(graph.targetApp ?? {}), graph.platformScope, graph.name, graph.status, null, graph.createdAt, graph.updatedAt);
    return graph;
  }

  createPageAssetLibrary(input: CreatePageAssetLibraryInput): BusinessGraph {
    const graphId = createId("graph");
    const versionId = createId("graph_version");
    const now = nowIso();
    this.db.prepare("BEGIN").run();
    try {
      this.db
        .prepare(
          `INSERT INTO business_graphs (id, app_id, target_app_json, platform_scope, name, status, active_version_id, created_at, updated_at)
           VALUES (?, ?, ?, 'mobile-both', ?, 'active', ?, ?, ?)`
        )
        .run(graphId, input.appId, JSON.stringify(input.targetApp), input.name, versionId, now, now);
      this.db
        .prepare(
          `INSERT INTO business_graph_versions (id, graph_id, version, source_summary_json, status, created_at)
           VALUES (?, ?, 1, ?, 'active', ?)`
        )
        .run(versionId, graphId, JSON.stringify(["页面资产库初始化"]), now);
      this.db.prepare("COMMIT").run();
    } catch (error) {
      this.db.prepare("ROLLBACK").run();
      throw error;
    }
    return this.getBusinessGraph(graphId) as BusinessGraph;
  }

  listBusinessGraphs(): BusinessGraph[] {
    const rows = this.db.prepare("SELECT * FROM business_graphs ORDER BY updated_at DESC").all() as Row[];
    return rows.map(graphFromRow);
  }

  findBusinessGraphByAppId(appId: string): BusinessGraph | undefined {
    const row = this.db.prepare("SELECT * FROM business_graphs WHERE app_id = ? ORDER BY updated_at DESC LIMIT 1").get(appId) as Row | undefined;
    return row ? graphFromRow(row) : undefined;
  }

  getBusinessGraph(id: string): BusinessGraph | undefined {
    const row = this.db.prepare("SELECT * FROM business_graphs WHERE id = ?").get(id) as Row | undefined;
    return row ? graphFromRow(row) : undefined;
  }

  updateBusinessGraphProfile(id: string, input: UpdateBusinessGraphProfileInput): BusinessGraph | undefined {
    const existing = this.getBusinessGraph(id);
    if (!existing) {
      return undefined;
    }
    const next: BusinessGraph = {
      ...existing,
      appId: input.appId ?? existing.appId,
      targetApp: input.targetApp ?? existing.targetApp,
      platformScope: input.platformScope ?? existing.platformScope,
      name: input.name ?? existing.name,
      status: input.status ?? existing.status,
      updatedAt: nowIso()
    };
    this.db
      .prepare("UPDATE business_graphs SET app_id = ?, target_app_json = ?, platform_scope = ?, name = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(next.appId, JSON.stringify(next.targetApp ?? {}), next.platformScope, next.name, next.status, next.updatedAt, id);
    return this.getBusinessGraph(id) ?? next;
  }

  createBusinessGraphVersion(input: CreateBusinessGraphVersionInput): BusinessGraphVersion {
    const graph = this.getBusinessGraph(input.graphId);
    if (!graph) {
      throw new Error(`Business graph not found: ${input.graphId}`);
    }
    const id = createId("graph_version");
    const now = nowIso();
    const versionRow = this.db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM business_graph_versions WHERE graph_id = ?").get(input.graphId) as
      | Row
      | undefined;
    const version = Number(versionRow?.next_version ?? 1);
    const graphVersion: BusinessGraphVersion = {
      id,
      graphId: input.graphId,
      version,
      sourceSummary: input.sourceSummary ?? [],
      status: input.status ?? "draft",
      nodes: [],
      createdAt: now
    };
    this.db
      .prepare(
        `INSERT INTO business_graph_versions (id, graph_id, version, source_summary_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(graphVersion.id, graphVersion.graphId, graphVersion.version, JSON.stringify(graphVersion.sourceSummary), graphVersion.status, graphVersion.createdAt);
    return graphVersion;
  }

  setActiveBusinessGraphVersion(graphId: string, versionId: string): BusinessGraph {
    const graph = this.getBusinessGraph(graphId);
    if (!graph) {
      throw new Error(`Business graph not found: ${graphId}`);
    }
    const version = this.db.prepare("SELECT * FROM business_graph_versions WHERE id = ? AND graph_id = ?").get(versionId, graphId) as Row | undefined;
    if (!version) {
      throw new Error(`Business graph version not found: ${versionId}`);
    }
    const now = nowIso();
    this.db.prepare("BEGIN").run();
    try {
      this.db.prepare("UPDATE business_graph_versions SET status = 'archived' WHERE graph_id = ? AND status = 'active' AND id <> ?").run(graphId, versionId);
      this.db.prepare("UPDATE business_graph_versions SET status = 'active' WHERE id = ?").run(versionId);
      this.db.prepare("UPDATE business_graphs SET status = 'active', active_version_id = ?, updated_at = ? WHERE id = ?").run(versionId, now, graphId);
      this.db.prepare("COMMIT").run();
    } catch (error) {
      this.db.prepare("ROLLBACK").run();
      throw error;
    }
    return this.getBusinessGraph(graphId) ?? graph;
  }

  createBusinessNode(input: CreateBusinessNodeInput): BusinessNode {
    const id = input.id ?? createId("node");
    const node: BusinessNode = {
      id,
      graphVersionId: input.graphVersionId,
      key: input.key,
      name: input.name,
      nodeType: input.nodeType,
      tags: input.tags ?? [],
      status: input.status ?? "draft",
      matchers: input.matchers ?? [],
      defaultExpectations: input.defaultExpectations ?? [],
      platformScope: input.platformScope,
      metadata: input.metadata
    };
    const now = nowIso();
    this.db.prepare("BEGIN").run();
    try {
      this.db
        .prepare(
          `INSERT INTO business_nodes
            (id, graph_version_id, node_key, name, node_type, tags_json, status, platform_scope, metadata_json, default_expectations_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          node.id,
          node.graphVersionId,
          node.key,
          node.name,
          node.nodeType,
          JSON.stringify(node.tags),
          node.status,
          node.platformScope ?? null,
          JSON.stringify(node.metadata ?? {}),
          JSON.stringify(node.defaultExpectations),
          now
        );
      this.insertStateMatchers(node.id, node.matchers);
      this.db.prepare("COMMIT").run();
    } catch (error) {
      this.db.prepare("ROLLBACK").run();
      throw error;
    }
    return node;
  }

  findBusinessNodeByKey(graphVersionId: string, key: string): BusinessNode | undefined {
    const row = this.db.prepare("SELECT * FROM business_nodes WHERE graph_version_id = ? AND node_key = ?").get(graphVersionId, key) as Row | undefined;
    return row ? this.businessNodeFromRow(row) : undefined;
  }

  findBusinessNodeById(graphVersionId: string, nodeId: string): BusinessNode | undefined {
    const row = this.db.prepare("SELECT * FROM business_nodes WHERE graph_version_id = ? AND id = ?").get(graphVersionId, nodeId) as Row | undefined;
    return row ? this.businessNodeFromRow(row) : undefined;
  }

  updateBusinessNodeDetails(
    nodeId: string,
    input: {
      key?: string;
      name?: string;
      nodeType?: BusinessNode["nodeType"];
      tags?: string[];
      matchers?: StateMatcher[];
      metadata?: Record<string, unknown>;
      status?: BusinessNode["status"];
      platformScope?: BusinessNode["platformScope"];
    }
  ): BusinessNode | undefined {
    const currentRow = this.db.prepare("SELECT * FROM business_nodes WHERE id = ?").get(nodeId) as Row | undefined;
    if (!currentRow) {
      return undefined;
    }
    const current = this.businessNodeFromRow(currentRow);
    this.db.prepare("BEGIN").run();
    try {
      this.db
        .prepare("UPDATE business_nodes SET node_key = ?, name = ?, node_type = ?, tags_json = ?, metadata_json = ?, status = ?, platform_scope = ? WHERE id = ?")
        .run(
          input.key ?? current.key,
          input.name ?? current.name,
          input.nodeType ?? current.nodeType,
          JSON.stringify(input.tags ?? current.tags),
          JSON.stringify(input.metadata ?? current.metadata ?? {}),
          input.status ?? current.status,
          input.platformScope ?? current.platformScope ?? null,
          nodeId
        );
      if (input.matchers) {
        this.db.prepare("DELETE FROM state_matchers WHERE node_id = ?").run(nodeId);
        this.insertStateMatchers(nodeId, input.matchers);
      }
      this.db.prepare("COMMIT").run();
    } catch (error) {
      this.db.prepare("ROLLBACK").run();
      throw error;
    }
    const row = this.db.prepare("SELECT * FROM business_nodes WHERE id = ?").get(nodeId) as Row | undefined;
    return row ? this.businessNodeFromRow(row) : undefined;
  }

  updateBusinessNodeMetadata(nodeId: string, metadata: Record<string, unknown>): BusinessNode | undefined {
    this.db.prepare("UPDATE business_nodes SET metadata_json = ? WHERE id = ?").run(JSON.stringify(metadata), nodeId);
    const row = this.db.prepare("SELECT * FROM business_nodes WHERE id = ?").get(nodeId) as Row | undefined;
    return row ? this.businessNodeFromRow(row) : undefined;
  }

  updateBusinessNodeStatus(nodeId: string, status: BusinessNode["status"]): BusinessNode | undefined {
    this.db.prepare("UPDATE business_nodes SET status = ? WHERE id = ?").run(status, nodeId);
    const row = this.db.prepare("SELECT * FROM business_nodes WHERE id = ?").get(nodeId) as Row | undefined;
    return row ? this.businessNodeFromRow(row) : undefined;
  }


  getBusinessGraphVersion(id: string): BusinessGraphVersion | undefined {
    const row = this.db.prepare("SELECT * FROM business_graph_versions WHERE id = ?").get(id) as Row | undefined;
    return row ? this.rowToBusinessGraphVersion(row) : undefined;
  }

  getBusinessGraphVersionSummary(id: string): Pick<BusinessGraphVersion, "id" | "graphId" | "version" | "status" | "createdAt"> | undefined {
    const row = this.db.prepare("SELECT * FROM business_graph_versions WHERE id = ?").get(id) as Row | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: String(row.id),
      graphId: String(row.graph_id),
      version: Number(row.version),
      status: row.status as BusinessGraphVersion["status"],
      createdAt: String(row.created_at)
    };
  }

  getActiveBusinessGraphVersion(graphId: string): BusinessGraphVersion | undefined {
    const graph = this.getBusinessGraph(graphId);
    if (!graph?.activeVersionId) {
      return undefined;
    }
    return this.getBusinessGraphVersion(graph.activeVersionId);
  }


  createRun(input: { id?: string; caseName: string; deviceSerial: string; configJson: string; runSnapshotJson: string; steps: ActionStep[] }): TestRun {
    const id = input.id ?? createId("run");
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO runs (id, case_name, device_serial, status, config_json, run_snapshot_json, started_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.caseName, input.deviceSerial, "running", input.configJson, input.runSnapshotJson, now, now);

    const runSnapshot = JSON.parse(input.runSnapshotJson) as Record<string, unknown>;
    return {
      id,
      caseName: input.caseName,
      deviceSerial: input.deviceSerial,
      status: "running",
      config: JSON.parse(input.configJson),
      steps: input.steps,
      stepResults: [],
      metrics: [],
      events: [],
      artifacts: [],
      ...scriptFlowSourceSnapshot(runSnapshot),
      startedAt: now
    };
  }

  updateRunStatus(runId: string, status: TestRun["status"], endedAt?: string): void {
    const isFinalStatus = !["pending", "running", "paused"].includes(status);
    this.db.prepare("UPDATE runs SET status = ?, ended_at = ? WHERE id = ?").run(status, isFinalStatus ? endedAt ?? nowIso() : null, runId);
    if (status === "passed") {
      this.recordPassedTrialVerification(runId);
    }
    if (status === "passed" || status === "failed") {
      this.recordInteractionAssetHealth(runId);
    }
    if (isFinalStatus && shouldCollectAssetLearning(this.assetLearningMode)) {
      this.recordTrialLearningSession(runId, status);
    }
  }

  updateRunReport(runId: string, relativePath: string): void {
    this.db.prepare("UPDATE runs SET report_html_path = ? WHERE id = ?").run(relativePath, runId);
  }

  addStepResult(result: StepResult): void {
    this.db
      .prepare(
        `INSERT INTO step_results
          (id, run_id, iteration_index, step_id, step_order, type, status, started_at, ended_at, duration_ms, error_code, error_message, after_screenshot_artifact_id, expectation_results_json, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        result.id,
        result.runId,
        result.iterationIndex,
        result.stepId,
        result.stepOrder,
        result.type,
        result.status,
        result.startedAt,
        result.endedAt ?? null,
        result.durationMs ?? null,
        result.errorCode ?? null,
        result.errorMessage ?? null,
        result.afterScreenshotId ?? null,
        JSON.stringify(result.expectationResults ?? []),
        JSON.stringify(result.metadata ?? {})
      );
  }

  addArtifact(artifact: ArtifactRef): void {
    this.db
      .prepare(
        `INSERT INTO artifacts
          (id, run_id, step_result_id, type, name, path, url, mime_type, size_bytes, created_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        artifact.id,
        artifact.runId ?? null,
        artifact.stepResultId ?? null,
        artifact.type,
        artifact.name,
        artifact.path,
        artifact.url,
        artifact.mimeType ?? null,
        artifact.sizeBytes ?? null,
        artifact.createdAt,
        artifact.deletedAt ?? null
      );
  }

  getArtifact(id: string): ArtifactRef | undefined {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as Row | undefined;
    return row ? artifactFromRow(row) : undefined;
  }

  addMetricSample(sample: MetricSample): void {
    this.db
      .prepare(
        `INSERT INTO metric_samples
          (id, run_id, step_result_id, device_serial, sampled_at, cpu_percent, memory_used_kb, memory_total_kb, battery_level, battery_temperature_c, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sample.id,
        sample.runId,
        sample.stepResultId ?? null,
        sample.deviceSerial,
        sample.sampledAt,
        sample.cpuPercent ?? null,
        sample.memoryUsedKb ?? null,
        sample.memoryTotalKb ?? null,
        sample.batteryLevel ?? null,
        sample.batteryTemperatureC ?? null,
        JSON.stringify(sample.raw ?? {})
      );
  }

  addDeviceEvent(event: DeviceEvent): void {
    this.db
      .prepare(
        `INSERT INTO device_events
          (id, run_id, step_result_id, device_serial, type, severity, occurred_at, summary, detail, artifact_ids_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.runId,
        event.stepResultId ?? null,
        event.deviceSerial,
        event.type,
        event.severity,
        event.occurredAt,
        event.summary,
        event.detail ?? null,
        JSON.stringify(event.artifactIds)
      );
  }

  getRun(id: string): TestRun | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
    if (!row) {
      return undefined;
    }
    const artifacts = this.getRunArtifacts(id);
    const metrics = this.getMetricSamples(id);
    const events = this.getDeviceEvents(id);
    const stepResults = this.getStepResults(id).map((result) => ({
      ...result,
      artifacts: artifacts.filter((artifact) => artifact.stepResultId === result.id)
    }));
    const runSnapshot = JSON.parse(String(row.run_snapshot_json)) as Record<string, unknown>;
    return {
      id: String(row.id),
      caseName: String(row.case_name),
      deviceSerial: String(row.device_serial),
      status: row.status as TestRun["status"],
      config: JSON.parse(String(row.config_json)),
      steps: Array.isArray(runSnapshot.steps) ? runSnapshot.steps as ActionStep[] : [],
      stepResults,
      metrics,
      events,
      artifacts,
      ...scriptFlowSourceSnapshot(runSnapshot),
      startedAt: String(row.started_at),
      endedAt: stringOrUndefined(row.ended_at),
      reportHtmlPath: stringOrUndefined(row.report_html_path)
    };
  }

  listRuns(limit = 30, offset = 0): TestRun[] {
    const rows = this.db.prepare("SELECT id FROM runs ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Row[];
    return rows.map((row) => this.getRun(String(row.id))).filter((run): run is TestRun => Boolean(run));
  }

  listRunIdsByStatus(status: TestRun["status"]): string[] {
    const rows = this.db.prepare("SELECT id FROM runs WHERE status = ? ORDER BY created_at ASC").all(status) as Row[];
    return rows.map((row) => String(row.id));
  }

  listRunsForCleanup(): StoredRunForCleanup[] {
    const rows = this.db
      .prepare(
        `SELECT runs.id, runs.status, runs.created_at, runs.ended_at
         FROM runs
         WHERE runs.status NOT IN ('pending', 'running', 'paused')
           AND NOT EXISTS (
             SELECT 1 FROM learning_observations observation
             JOIN learning_aggregates aggregate ON aggregate.id = observation.aggregate_id
             WHERE observation.run_id = runs.id
               AND aggregate.status IN ('collecting', 'awaiting_ai', 'ready', 'analysis_failed')
           )
         ORDER BY runs.created_at ASC`
      )
      .all() as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      status: row.status as TestRun["status"],
      createdAt: String(row.created_at),
      endedAt: stringOrUndefined(row.ended_at)
    }));
  }

  async writeArtifact(relativePath: string, bytes: Buffer | string): Promise<{ absolutePath: string; sizeBytes: number }> {
    const absolutePath = path.join(artifactRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
    return {
      absolutePath,
      sizeBytes: Buffer.byteLength(bytes)
    };
  }

  async deleteRunArtifacts(runId: string): Promise<void> {
    await rm(path.join(artifactRoot, "runs", runId), { recursive: true, force: true });
  }

  async deleteRun(runId: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
    if (result.changes <= 0) {
      return false;
    }
    await this.deleteRunArtifacts(runId);
    return true;
  }

  private getRunArtifacts(runId: string): ArtifactRef[] {
    const rows = this.db.prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at ASC").all(runId) as Row[];
    return rows.map(artifactFromRow);
  }

  private getStepResults(runId: string): StepResult[] {
    const rows = this.db.prepare("SELECT * FROM step_results WHERE run_id = ? ORDER BY iteration_index ASC, step_order ASC").all(runId) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      runId: String(row.run_id),
      iterationIndex: Number(row.iteration_index),
      stepId: String(row.step_id),
      stepOrder: Number(row.step_order),
      type: row.type as StepResult["type"],
      status: row.status as StepResult["status"],
      startedAt: String(row.started_at),
      endedAt: stringOrUndefined(row.ended_at),
      durationMs: numberOrUndefined(row.duration_ms),
      errorCode: stringOrUndefined(row.error_code),
      errorMessage: stringOrUndefined(row.error_message),
      afterScreenshotId: stringOrUndefined(row.after_screenshot_artifact_id),
      artifacts: [],
      expectationResults: JSON.parse(String(row.expectation_results_json ?? "[]")),
      metadata: JSON.parse(String(row.metadata_json ?? "{}"))
    }));
  }

  private getMetricSamples(runId: string): MetricSample[] {
    const rows = this.db.prepare("SELECT * FROM metric_samples WHERE run_id = ? ORDER BY sampled_at ASC").all(runId) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      runId: String(row.run_id),
      stepResultId: stringOrUndefined(row.step_result_id),
      deviceSerial: String(row.device_serial),
      sampledAt: String(row.sampled_at),
      cpuPercent: numberOrUndefined(row.cpu_percent),
      memoryUsedKb: numberOrUndefined(row.memory_used_kb),
      memoryTotalKb: numberOrUndefined(row.memory_total_kb),
      batteryLevel: numberOrUndefined(row.battery_level),
      batteryTemperatureC: numberOrUndefined(row.battery_temperature_c),
      raw: JSON.parse(String(row.raw_json))
    }));
  }

  private recordInteractionAssetHealth(runId: string): void {
    const rows = this.db.prepare(
      `SELECT status, error_code, error_message, metadata_json
       FROM step_results WHERE run_id = ? ORDER BY iteration_index ASC, step_order ASC`
    ).all(runId) as Row[];
    const outcomes = new Map<string, {
      outcome: "passed" | "locator_failed" | "ignored_failure";
      error?: string;
    }>();
    for (const row of rows) {
      const metadata = parseJsonObject(String(row.metadata_json ?? "{}"));
      const assetId = nonEmptyString(metadata.interactionAssetId);
      if (!assetId) continue;
      const outcome = classifyInteractionAssetStepOutcome({
        status: String(row.status),
        errorCode: stringOrUndefined(row.error_code),
        errorMessage: stringOrUndefined(row.error_message)
      });
      const previous = outcomes.get(assetId);
      if (previous?.outcome === "passed") continue;
      if (outcome === "passed" || outcome === "locator_failed" || !previous) {
        outcomes.set(assetId, {
          outcome,
          error: outcome === "locator_failed" ? stringOrUndefined(row.error_message) : undefined
        });
      }
    }

    const runRow = this.db.prepare("SELECT device_serial FROM runs WHERE id = ?").get(runId) as Row | undefined;
    for (const [assetId, result] of outcomes) {
      if (result.outcome === "ignored_failure") continue;
      const assetRow = this.db.prepare("SELECT id, name, status FROM interaction_assets WHERE id = ?").get(assetId) as Row | undefined;
      if (!assetRow) continue;
      const existing = this.getInteractionAssetHealth(assetId);
      const current: InteractionAssetHealth = existing ?? {
        status: String(assetRow.status) === "degraded" ? "degraded" : "active",
        consecutiveLocatorFailures: 0,
        successfulRunCount: 0
      };
      const next = nextInteractionAssetHealth(current, result.outcome);
      const updatedAt = nowIso();
      this.db.prepare(
        `INSERT INTO interaction_asset_health
          (asset_id, status, consecutive_locator_failures, successful_run_count, last_run_id, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET
           status = excluded.status,
           consecutive_locator_failures = excluded.consecutive_locator_failures,
           successful_run_count = excluded.successful_run_count,
           last_run_id = excluded.last_run_id,
           last_error = excluded.last_error,
           updated_at = excluded.updated_at`
      ).run(
        assetId,
        next.status,
        next.consecutiveLocatorFailures,
        next.successfulRunCount,
        runId,
        result.error ?? null,
        updatedAt
      );
      if (current.status !== "degraded" && next.status === "degraded") {
        this.db.prepare("UPDATE interaction_assets SET status = 'degraded', updated_at = ? WHERE id = ?").run(updatedAt, assetId);
        this.db.prepare("UPDATE learning_aggregates SET status = 'degraded', last_error = ?, updated_at = ? WHERE asset_id = ?").run(
          result.error ?? "连续三次未能定位目标",
          updatedAt,
          assetId
        );
        if (runRow) {
          this.addDeviceEvent({
            id: createId("event"),
            runId,
            deviceSerial: String(runRow.device_serial),
            type: "interaction_asset_degraded",
            severity: "warning",
            occurredAt: updatedAt,
            summary: `定位资产“${String(assetRow.name)}”已自动停用`,
            detail: "该定位资产已连续三次无法找到目标，后续测试将不再复用它，需要通过新的成功执行重新学习该操作。",
            artifactIds: []
          });
        }
      }
    }
  }

  private getDeviceEvents(runId: string): DeviceEvent[] {
    const rows = this.db.prepare("SELECT * FROM device_events WHERE run_id = ? ORDER BY occurred_at ASC").all(runId) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      runId: String(row.run_id),
      stepResultId: stringOrUndefined(row.step_result_id),
      deviceSerial: String(row.device_serial),
      type: row.type as DeviceEvent["type"],
      severity: row.severity as DeviceEvent["severity"],
      occurredAt: String(row.occurred_at),
      summary: String(row.summary),
      detail: stringOrUndefined(row.detail),
      artifactIds: JSON.parse(String(row.artifact_ids_json))
    }));
  }

  private insertScriptFlowVersion(flow: ScriptFlow): void {
    this.db.prepare(
      `INSERT INTO script_flow_versions (id, flow_id, version, source_yaml, parsed_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      createId("script_flow_version"),
      flow.id,
      flow.version,
      flow.sourceYaml,
      JSON.stringify(flow.parsed),
      flow.updatedAt
    );
  }

  private recordPassedTrialVerification(runId: string): void {
    const row = this.db.prepare("SELECT run_snapshot_json FROM runs WHERE id = ?").get(runId) as Row | undefined;
    if (!row) return;
    const runSnapshot = JSON.parse(String(row.run_snapshot_json)) as Record<string, unknown>;
    const sourceSnapshot = scriptFlowSourceSnapshot(runSnapshot).sourceSnapshot;
    if (
      sourceSnapshot?.executionPurpose !== "trial"
      || !sourceSnapshot.sourceHash
      || !sourceSnapshot.verificationAssessment
    ) {
      return;
    }
    const existing = this.db.prepare(
      "SELECT id FROM flow_verifications WHERE run_id = ? AND source_hash = ? LIMIT 1"
    ).get(runId, sourceSnapshot.sourceHash) as Row | undefined;
    if (existing) return;

    const app = sourceSnapshot.parsed.app;
    if (!app || typeof app !== "object" || Array.isArray(app)) return;
    const appRecord = app as Record<string, unknown>;
    if (typeof appRecord.id !== "string" || typeof appRecord.platform !== "string") return;
    const storedFlow = this.db.prepare("SELECT id FROM script_flows WHERE id = ?").get(sourceSnapshot.flowId) as Row | undefined;
    const totalSteps = Array.isArray(runSnapshot.steps) ? runSnapshot.steps.length : 0;

    const verificationStatus = sourceSnapshot.verificationAssessment.unresolvedOutcome ? "provisional" : "verified";
    this.createFlowVerification({
      ...(storedFlow ? { flowId: sourceSnapshot.flowId, flowVersion: sourceSnapshot.version } : {}),
      sourceHash: sourceSnapshot.sourceHash,
      appId: appRecord.id,
      platform: appRecord.platform as ScriptFlow["platform"],
      runId,
      status: verificationStatus,
      coverage: {
        totalSteps,
        verifiedSteps: totalSteps,
        interactionAssetIds: uniqueStrings(
          (sourceSnapshot.interactionAssets ?? []).map((binding) => binding.assetId)
        ),
        pageAssetIds: [],
        humanConfirmedOutcome: false
      }
    });
    if (verificationStatus === "verified") this.refreshPageNavigationIndex();
  }

  private recordTrialLearningSession(runId: string, runStatus: TestRun["status"]): void {
    const row = this.db.prepare("SELECT run_snapshot_json FROM runs WHERE id = ?").get(runId) as Row | undefined;
    if (!row || this.getLearningSessionForRun(runId)) return;
    const runSnapshot = JSON.parse(String(row.run_snapshot_json)) as Record<string, unknown>;
    const sourceSnapshot = scriptFlowSourceSnapshot(runSnapshot).sourceSnapshot;
    const isTrial = sourceSnapshot?.executionPurpose === "trial";
    const isVerifiedNormal = sourceSnapshot?.executionPurpose === "normal"
      && sourceSnapshot.verificationAssessment?.status === "verified";
    if (
      (!isTrial && !isVerifiedNormal)
      || !sourceSnapshot.sourceHash
      || !sourceSnapshot.verificationAssessment
      || (isVerifiedNormal && runStatus !== "passed")
    ) {
      return;
    }
    const app = sourceSnapshot.parsed.app;
    if (!app || typeof app !== "object" || Array.isArray(app)) return;
    const appRecord = app as Record<string, unknown>;
    if (typeof appRecord.id !== "string" || typeof appRecord.platform !== "string") return;

    const executionPassed = runStatus === "passed";
    const unresolvedOutcome = isTrial && sourceSnapshot.verificationAssessment.unresolvedOutcome;
    const now = nowIso();
    const summary = {
      pageCandidates: 0,
      interactionCandidates: 0,
      navigationCandidates: 0,
      testCandidates: executionPassed && isTrial ? 1 : 0,
      issues: executionPassed
        ? unresolvedOutcome ? ["试运行没有自动结果判定，需要确认业务结果"] : []
        : ["试运行未通过，不能从本次执行学习资产"]
    };
    const sessionId = createId("learning_session");
    this.db.prepare(
      `INSERT INTO learning_sessions
        (id, run_id, app_id, platform, source_hash, execution_passed, outcome_status, status,
         summary_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      runId,
      appRecord.id,
      appRecord.platform,
      sourceSnapshot.sourceHash,
      executionPassed ? 1 : 0,
      executionPassed && !unresolvedOutcome ? "verified" : "unverified",
      executionPassed ? unresolvedOutcome ? "needs_outcome_review" : "ready" : "invalid",
      JSON.stringify(summary),
      now,
      now
    );
    if (executionPassed) {
      const run = this.getRun(runId);
      if (run) {
        for (const candidate of pageCandidatesFromTrial(run)) {
          this.createLearningCandidate({ sessionId, ...candidate });
        }
        for (const candidate of interactionCandidatesFromTrial(run)) {
          this.createLearningCandidate({ sessionId, ...candidate });
        }
        for (const candidate of navigationCandidatesFromTrial(run)) {
          this.createLearningCandidate({ sessionId, ...candidate });
        }
      }
      if (!unresolvedOutcome) this.aggregateLearningSession(sessionId);
    }
  }

  private aggregateLearningSession(sessionId: string): void {
    const session = this.getLearningSession(sessionId);
    if (
      !session
      || !session.executionPassed
      || !["verified", "human_confirmed"].includes(session.outcomeStatus)
    ) return;
    for (const candidate of this.listLearningCandidates(sessionId)) {
      if (
        !candidate.stableKey
        || candidate.kind === "test"
        || !["validated", "needs_review"].includes(candidate.status)
      ) continue;
      this.aggregateLearningCandidate(session, candidate);
    }
  }

  private aggregateLearningCandidate(session: LearningSession, candidate: LearningCandidate): void {
    if (!candidate.stableKey || candidate.kind === "test") return;
    const now = nowIso();
    let row = this.db.prepare(
      `SELECT * FROM learning_aggregates
       WHERE app_id = ? AND platform = ? AND kind = ? AND stable_key = ?`
    ).get(session.appId, session.platform, candidate.kind, candidate.stableKey) as Row | undefined;
    const aggregateId = row ? String(row.id) : createId("learning_aggregate");
    if (!row) {
      this.db.prepare(
        `INSERT INTO learning_aggregates
          (id, app_id, platform, kind, stable_key, representative_candidate_id, status,
           successful_run_count, distinct_evidence_count, analysis_required, analysis_json,
           asset_id, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'collecting', 0, 0, ?, NULL, NULL, NULL, ?, ?)`
      ).run(
        aggregateId,
        session.appId,
        session.platform,
        candidate.kind,
        candidate.stableKey,
        candidate.id,
        requiresAiLearningAnalysis(candidate) ? 1 : 0,
        now,
        now
      );
      row = this.db.prepare("SELECT * FROM learning_aggregates WHERE id = ?").get(aggregateId) as Row;
    }

    if (String(row.status) === "degraded") {
      this.db.prepare("DELETE FROM learning_observations WHERE aggregate_id = ?").run(aggregateId);
      this.db.prepare(
        `UPDATE learning_aggregates
         SET status = 'collecting', successful_run_count = 0, distinct_evidence_count = 0,
             analysis_json = NULL, last_error = NULL, updated_at = ?
         WHERE id = ?`
      ).run(now, aggregateId);
      row = this.db.prepare("SELECT * FROM learning_aggregates WHERE id = ?").get(aggregateId) as Row;
    }

    const evidenceFingerprint = learningEvidenceFingerprint(candidate);
    this.db.prepare(
      `INSERT OR IGNORE INTO learning_observations
        (id, aggregate_id, session_id, candidate_id, run_id, evidence_fingerprint,
         evidence_artifact_ids_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId("learning_observation"),
      aggregateId,
      session.id,
      candidate.id,
      session.runId,
      evidenceFingerprint,
      JSON.stringify(candidate.evidenceArtifactIds),
      now
    );

    const counts = this.db.prepare(
      `SELECT COUNT(DISTINCT run_id) AS successful_runs,
              COUNT(DISTINCT evidence_fingerprint) AS distinct_evidence
       FROM learning_observations WHERE aggregate_id = ?`
    ).get(aggregateId) as Row;
    const current = rowToLearningAggregate(
      this.db.prepare("SELECT * FROM learning_aggregates WHERE id = ?").get(aggregateId) as Row
    );
    const successfulRunCount = Number(counts.successful_runs);
    const distinctEvidenceCount = Number(counts.distinct_evidence);
    const readiness = learningAggregateReadiness({ candidate, successfulRunCount, distinctEvidenceCount });
    const status = ["active", "degraded", "rejected"].includes(current.status)
      ? current.status
      : readiness.status;
    this.db.prepare(
      `UPDATE learning_aggregates
       SET representative_candidate_id = ?, status = ?, successful_run_count = ?,
           distinct_evidence_count = ?, analysis_required = ?, last_error = NULL, updated_at = ?
       WHERE id = ?`
    ).run(
      candidate.id,
      status,
      successfulRunCount,
      distinctEvidenceCount,
      requiresAiLearningAnalysis(candidate) ? 1 : 0,
      now,
      aggregateId
    );
  }

  private refreshLearningSummary(sessionId: string): void {
    const session = this.getLearningSession(sessionId);
    if (!session) return;
    const rows = this.db.prepare(
      `SELECT kind, COUNT(*) AS total FROM learning_candidates
       WHERE session_id = ? AND status NOT IN ('rejected', 'superseded') GROUP BY kind`
    ).all(sessionId) as Row[];
    const counts = new Map(rows.map((row) => [String(row.kind), Number(row.total)]));
    this.db.prepare("UPDATE learning_sessions SET summary_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify({
        ...session.summary,
        pageCandidates: counts.get("page") ?? 0,
        interactionCandidates: counts.get("interaction") ?? 0,
        navigationCandidates: counts.get("navigation") ?? 0,
        testCandidates: Math.max(session.summary.testCandidates, counts.get("test") ?? 0)
      }),
      nowIso(),
      sessionId
    );
  }

  private rowToBusinessGraphVersion(row: Row): BusinessGraphVersion {
    const id = String(row.id);
    return {
      id,
      graphId: String(row.graph_id),
      version: Number(row.version),
      sourceSummary: JSON.parse(String(row.source_summary_json ?? "[]")),
      status: row.status as BusinessGraphVersion["status"],
      nodes: this.getBusinessNodes(id),
      createdAt: String(row.created_at)
    };
  }

  private getBusinessNodes(graphVersionId: string): BusinessNode[] {
    const rows = this.db.prepare("SELECT * FROM business_nodes WHERE graph_version_id = ? ORDER BY created_at ASC, node_key ASC").all(graphVersionId) as Row[];
    return rows.map((row) => this.businessNodeFromRow(row));
  }

  private businessNodeFromRow(row: Row): BusinessNode {
    const nodeId = String(row.id);
    return {
      id: nodeId,
      graphVersionId: String(row.graph_version_id),
      key: String(row.node_key),
      name: String(row.name),
      nodeType: row.node_type as BusinessNode["nodeType"],
      tags: JSON.parse(String(row.tags_json ?? "[]")),
      status: row.status as BusinessNode["status"],
      matchers: this.getStateMatchers(nodeId),
      defaultExpectations: JSON.parse(String(row.default_expectations_json ?? "[]")),
      platformScope: platformScopeOrUndefined(row.platform_scope),
      metadata: JSON.parse(String(row.metadata_json ?? "{}"))
    };
  }

  private getStateMatchers(nodeId: string): StateMatcher[] {
    const rows = this.db.prepare("SELECT * FROM state_matchers WHERE node_id = ? ORDER BY weight DESC, id ASC").all(nodeId) as Row[];
    return rows.map(matcherFromRow);
  }


  private insertStateMatchers(nodeId: string, matchers: StateMatcher[]): void {
    const insert = this.db.prepare(
      `INSERT INTO state_matchers (id, node_id, type, value, weight, critical, threshold, region_json, ignore_regions_json, platform_scope, source_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const matcher of matchers) {
      insert.run(
        matcher.id,
        nodeId,
        matcher.type,
        matcher.value,
        matcher.weight,
        matcher.critical ? 1 : 0,
        matcher.threshold ?? null,
        JSON.stringify(matcher.region ?? null),
        JSON.stringify(matcher.ignoreRegions ?? null),
        matcher.platformScope ?? null,
        JSON.stringify(matcher.source ?? {})
      );
    }
  }


  private init(): void {
    this.deleteLegacyCaseSchema();
    this.deleteLegacyInteractionAssetIdentity();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS script_flows (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        source_yaml TEXT NOT NULL,
        parsed_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        version INTEGER NOT NULL DEFAULT 1,
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS script_flow_versions (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL REFERENCES script_flows(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        source_yaml TEXT NOT NULL,
        parsed_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(flow_id, version)
      );

      CREATE TABLE IF NOT EXISTS script_navigation_segments (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        from_page TEXT NOT NULL,
        to_page TEXT NOT NULL,
        flow_id TEXT NOT NULL REFERENCES script_flows(id) ON DELETE CASCADE,
        flow_version INTEGER NOT NULL,
        flow_name TEXT NOT NULL,
        segment_order INTEGER NOT NULL,
        parameters_json TEXT NOT NULL DEFAULT '{}',
        step_ids_json TEXT NOT NULL DEFAULT '[]',
        steps_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS temporary_tests (
        id TEXT PRIMARY KEY,
        source_hash TEXT NOT NULL,
        app_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        kind TEXT NOT NULL,
        purpose TEXT NOT NULL,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        source_yaml TEXT NOT NULL,
        parsed_json TEXT NOT NULL,
        parameter_values_json TEXT NOT NULL DEFAULT '{}',
        last_run_id TEXT NOT NULL,
        run_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(app_id, platform, source_hash)
      );


      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        case_name TEXT NOT NULL,
        device_serial TEXT NOT NULL,
        status TEXT NOT NULL,
        config_json TEXT NOT NULL,
        run_snapshot_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        report_html_path TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flow_verifications (
        id TEXT PRIMARY KEY,
        flow_id TEXT REFERENCES script_flows(id) ON DELETE SET NULL,
        flow_version INTEGER,
        source_hash TEXT NOT NULL,
        app_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        app_version TEXT,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        coverage_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS learning_sessions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
        app_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        execution_passed INTEGER NOT NULL,
        outcome_status TEXT NOT NULL,
        status TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS learning_candidates (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        stable_key TEXT,
        source_step_id TEXT,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        evidence_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
        validation_issues_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS learning_aggregates (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        kind TEXT NOT NULL,
        stable_key TEXT NOT NULL,
        representative_candidate_id TEXT NOT NULL,
        status TEXT NOT NULL,
        successful_run_count INTEGER NOT NULL DEFAULT 0,
        distinct_evidence_count INTEGER NOT NULL DEFAULT 0,
        analysis_required INTEGER NOT NULL DEFAULT 0,
        analysis_json TEXT,
        asset_id TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(app_id, platform, kind, stable_key)
      );

      CREATE TABLE IF NOT EXISTS learning_observations (
        id TEXT PRIMARY KEY,
        aggregate_id TEXT NOT NULL REFERENCES learning_aggregates(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        evidence_fingerprint TEXT NOT NULL,
        evidence_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        UNIQUE(aggregate_id, run_id)
      );

      CREATE TABLE IF NOT EXISTS interaction_assets (
        id TEXT PRIMARY KEY,
        asset_key TEXT NOT NULL,
        app_id TEXT NOT NULL,
        platform_scope TEXT NOT NULL,
        owner_kind TEXT NOT NULL,
        owner_key TEXT NOT NULL,
        name TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        supported_actions_json TEXT NOT NULL DEFAULT '[]',
        semantic_contract_json TEXT NOT NULL DEFAULT '{}',
        locator_variants_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        version INTEGER NOT NULL,
        provenance_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(app_id, platform_scope, owner_kind, owner_key, asset_key)
      );

      CREATE TABLE IF NOT EXISTS interaction_asset_versions (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES interaction_assets(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(asset_id, version)
      );

      CREATE TABLE IF NOT EXISTS interaction_asset_health (
        asset_id TEXT PRIMARY KEY REFERENCES interaction_assets(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        consecutive_locator_failures INTEGER NOT NULL DEFAULT 0,
        successful_run_count INTEGER NOT NULL DEFAULT 0,
        last_run_id TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS navigation_entries (
        id TEXT PRIMARY KEY,
        entry_key TEXT NOT NULL,
        app_id TEXT NOT NULL,
        platform_scope TEXT NOT NULL,
        from_kind TEXT NOT NULL,
        from_key TEXT NOT NULL,
        from_role TEXT,
        to_page TEXT NOT NULL,
        name TEXT NOT NULL,
        action_json TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        version INTEGER NOT NULL,
        provenance_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(app_id, platform_scope, entry_key)
      );

      CREATE TABLE IF NOT EXISTS navigation_entry_versions (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES navigation_entries(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(entry_id, version)
      );

      CREATE TABLE IF NOT EXISTS step_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        iteration_index INTEGER NOT NULL,
        step_id TEXT NOT NULL,
        step_order INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_ms INTEGER,
        error_code TEXT,
        error_message TEXT,
        after_screenshot_artifact_id TEXT,
        expectation_results_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
        step_result_id TEXT,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        url TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS metric_samples (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        step_result_id TEXT,
        device_serial TEXT NOT NULL,
        sampled_at TEXT NOT NULL,
        cpu_percent REAL,
        memory_used_kb INTEGER,
        memory_total_kb INTEGER,
        battery_level REAL,
        battery_temperature_c REAL,
        raw_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS device_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        step_result_id TEXT,
        device_serial TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT,
        artifact_ids_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS runtime_interceptor_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        platform_scope TEXT,
        app_package_name TEXT,
        ios_bundle_id TEXT,
        flow_id TEXT,
        step_id TEXT,
        text TEXT,
        matchers_json TEXT NOT NULL DEFAULT '[]',
        action_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        setting_key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_script_flows_app ON script_flows(app_id, platform, status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_script_flow_versions_flow ON script_flow_versions(flow_id, version);
      CREATE INDEX IF NOT EXISTS idx_script_navigation_route ON script_navigation_segments(app_id, platform, from_page, to_page);
      CREATE INDEX IF NOT EXISTS idx_script_navigation_flow ON script_navigation_segments(flow_id, flow_version);
      CREATE INDEX IF NOT EXISTS idx_temporary_tests_app ON temporary_tests(app_id, platform, updated_at);
      CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);
      CREATE INDEX IF NOT EXISTS idx_flow_verifications_source ON flow_verifications(source_hash, app_id, platform, app_version, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_flow_verifications_run ON flow_verifications(run_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_learning_sessions_source ON learning_sessions(source_hash, app_id, platform, status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_learning_candidates_session ON learning_candidates(session_id, kind, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_learning_aggregates_state ON learning_aggregates(status, analysis_required, updated_at);
      CREATE INDEX IF NOT EXISTS idx_learning_observations_aggregate ON learning_observations(aggregate_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_interaction_assets_owner ON interaction_assets(app_id, owner_kind, owner_key, status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_interaction_asset_versions_asset ON interaction_asset_versions(asset_id, version);
      CREATE INDEX IF NOT EXISTS idx_interaction_asset_health_status ON interaction_asset_health(status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_navigation_entries_route ON navigation_entries(app_id, platform_scope, from_kind, from_key, to_page, status);
      CREATE INDEX IF NOT EXISTS idx_navigation_entry_versions_entry ON navigation_entry_versions(entry_id, version);
      CREATE INDEX IF NOT EXISTS idx_step_results_run ON step_results(run_id, iteration_index, step_order);
      CREATE INDEX IF NOT EXISTS idx_artifacts_run_type ON artifacts(run_id, type);
      CREATE INDEX IF NOT EXISTS idx_metric_samples_run_time ON metric_samples(run_id, sampled_at);
      CREATE INDEX IF NOT EXISTS idx_device_events_run_time ON device_events(run_id, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_runtime_interceptor_rules_scope ON runtime_interceptor_rules(enabled, platform_scope, app_package_name, flow_id, updated_at);

      CREATE TABLE IF NOT EXISTS business_graphs (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        target_app_json TEXT NOT NULL DEFAULT '{}',
        platform_scope TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        active_version_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS business_graph_versions (
        id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL REFERENCES business_graphs(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        source_summary_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(graph_id, version)
      );

      CREATE TABLE IF NOT EXISTS business_nodes (
        id TEXT PRIMARY KEY,
        graph_version_id TEXT NOT NULL REFERENCES business_graph_versions(id) ON DELETE CASCADE,
        node_key TEXT NOT NULL,
        name TEXT NOT NULL,
        node_type TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        platform_scope TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        default_expectations_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        UNIQUE(graph_version_id, node_key)
      );

      CREATE TABLE IF NOT EXISTS state_matchers (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL REFERENCES business_nodes(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        weight REAL NOT NULL,
        critical INTEGER NOT NULL DEFAULT 0,
        threshold REAL,
        region_json TEXT,
        ignore_regions_json TEXT,
        platform_scope TEXT,
        source_json TEXT NOT NULL DEFAULT '{}'
      );


      CREATE INDEX IF NOT EXISTS idx_business_graphs_app ON business_graphs(app_id);
      CREATE INDEX IF NOT EXISTS idx_graph_versions_graph ON business_graph_versions(graph_id, version);
      CREATE INDEX IF NOT EXISTS idx_business_nodes_version ON business_nodes(graph_version_id, status);
    `);
    this.migrateLearningEvidenceSchema();
    this.refreshPageNavigationIndex();
    this.sanitizeAiModelSettings();
  }

  private replacePageNavigationSegments(flow: ScriptFlow, document: ScriptFlowDocument): void {
    this.db.prepare("DELETE FROM script_navigation_segments WHERE flow_id = ?").run(flow.id);
    if (flow.status !== "active" || !this.isFlowVerified(flow)) return;
    const insert = this.db.prepare(
      `INSERT INTO script_navigation_segments
        (id, app_id, platform, from_page, to_page, flow_id, flow_version, flow_name, segment_order,
         parameters_json, step_ids_json, steps_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const segments = derivePageNavigationSegments({
      flowId: flow.id,
      flowVersion: flow.version,
      document
    });
    segments.forEach((segment, index) => {
      insert.run(
        segment.id,
        segment.appId,
        segment.platform,
        segment.fromPage,
        segment.toPage,
        segment.flowId,
        segment.flowVersion,
        segment.flowName,
        index + 1,
        JSON.stringify(segment.parameters),
        JSON.stringify(segment.stepIds),
        JSON.stringify(segment.steps),
        flow.updatedAt
      );
    });
  }

  private refreshPageNavigationIndex(): void {
    const activeFlows = this.listScriptFlows({ status: "active" }).filter((flow) => this.isFlowVerified(flow));
    const activeIds = new Set(activeFlows.map((flow) => flow.id));
    const indexedRows = this.db.prepare(
      "SELECT flow_id, MAX(flow_version) AS flow_version FROM script_navigation_segments GROUP BY flow_id"
    ).all() as Row[];
    const indexedVersions = new Map(indexedRows.map((row) => [String(row.flow_id), Number(row.flow_version)]));
    for (const flowId of indexedVersions.keys()) {
      if (!activeIds.has(flowId)) {
        this.db.prepare("DELETE FROM script_navigation_segments WHERE flow_id = ?").run(flowId);
      }
    }
    for (const flow of activeFlows) {
      if (indexedVersions.get(flow.id) === flow.version) continue;
      try {
        this.replacePageNavigationSegments(flow, parseScriptFlow(flow.sourceYaml));
      } catch {
        this.db.prepare("DELETE FROM script_navigation_segments WHERE flow_id = ?").run(flow.id);
      }
    }
  }

  private isFlowVerified(flow: ScriptFlow): boolean {
    return Boolean(this.findLatestFlowVerification({
      sourceHash: scriptFlowSourceHash(flow.sourceYaml),
      appId: flow.appId,
      platform: flow.platform,
      status: "verified"
    }));
  }

  private sanitizeAiModelSettings(): void {
    const row = this.db.prepare("SELECT value_json FROM app_settings WHERE setting_key = ?").get(AI_MODEL_SETTINGS_KEY) as Row | undefined;
    if (!row) return;
    const normalized = normalizeAiModelSettings(parseJsonObject(String(row.value_json)));
    const valueJson = JSON.stringify(stripUndefined({ ...normalized, updatedAt: undefined }));
    if (valueJson !== String(row.value_json)) {
      this.db.prepare("UPDATE app_settings SET value_json = ? WHERE setting_key = ?").run(valueJson, AI_MODEL_SETTINGS_KEY);
    }
  }

  private deleteLegacyCaseSchema(): void {
    const legacyTable = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('test_cases', 'steps') LIMIT 1"
    ).get() as Row | undefined;
    const runsTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get() as Row | undefined;
    const legacyRunColumns = runsTable
      ? (this.db.prepare("PRAGMA table_info(runs)").all() as Row[]).some((row) => row.name === "case_id" || row.name === "case_snapshot_json")
      : false;
    if (!legacyTable && !legacyRunColumns) {
      return;
    }
    this.db.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS artifacts;
      DROP TABLE IF EXISTS metric_samples;
      DROP TABLE IF EXISTS device_events;
      DROP TABLE IF EXISTS step_results;
      DROP TABLE IF EXISTS runs;
      DROP TABLE IF EXISTS steps;
      DROP TABLE IF EXISTS test_cases;
      PRAGMA foreign_keys = ON;
    `);
  }

  private deleteLegacyInteractionAssetIdentity(): void {
    const row = this.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'interaction_assets'"
    ).get() as Row | undefined;
    if (!row) return;
    const schema = String(row.sql ?? "").replace(/\s+/g, " ").toLowerCase();
    if (schema.includes("unique(app_id, platform_scope, owner_kind, owner_key, asset_key)")) return;
    this.db.exec(`
      DROP TABLE IF EXISTS interaction_asset_versions;
      DROP TABLE IF EXISTS interaction_assets;
    `);
  }

  private migrateLearningEvidenceSchema(): void {
    const aggregateSchema = this.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'learning_aggregates'"
    ).get() as Row | undefined;
    const observationSchema = this.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'learning_observations'"
    ).get() as Row | undefined;
    const hasRunBoundEvidence = /REFERENCES\s+(?:learning_candidates|learning_sessions|runs)/i.test(
      `${String(aggregateSchema?.sql ?? "")} ${String(observationSchema?.sql ?? "")}`
    );
    if (!hasRunBoundEvidence) return;
    this.db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      ALTER TABLE learning_observations RENAME TO learning_observations_legacy;
      ALTER TABLE learning_aggregates RENAME TO learning_aggregates_legacy;
      CREATE TABLE learning_aggregates (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        kind TEXT NOT NULL,
        stable_key TEXT NOT NULL,
        representative_candidate_id TEXT NOT NULL,
        status TEXT NOT NULL,
        successful_run_count INTEGER NOT NULL DEFAULT 0,
        distinct_evidence_count INTEGER NOT NULL DEFAULT 0,
        analysis_required INTEGER NOT NULL DEFAULT 0,
        analysis_json TEXT,
        asset_id TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(app_id, platform, kind, stable_key)
      );
      INSERT INTO learning_aggregates SELECT * FROM learning_aggregates_legacy;
      CREATE TABLE learning_observations (
        id TEXT PRIMARY KEY,
        aggregate_id TEXT NOT NULL REFERENCES learning_aggregates(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        evidence_fingerprint TEXT NOT NULL,
        evidence_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        UNIQUE(aggregate_id, run_id)
      );
      INSERT INTO learning_observations SELECT * FROM learning_observations_legacy;
      DROP TABLE learning_observations_legacy;
      DROP TABLE learning_aggregates_legacy;
      COMMIT;
      PRAGMA foreign_keys = ON;
      CREATE INDEX IF NOT EXISTS idx_learning_aggregates_state ON learning_aggregates(status, analysis_required, updated_at);
      CREATE INDEX IF NOT EXISTS idx_learning_observations_aggregate ON learning_observations(aggregate_id, created_at);
    `);
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function platformScopeOrUndefined(value: unknown): PlatformScope | undefined {
  return value === "android" || value === "ios" || value === "mobile-both" ? value : undefined;
}

function runtimeInterceptorRuleFromRow(row: Row): RuntimeInterceptorRule {
  const action = JSON.parse(String(row.action_json ?? "{}")) as RuntimeInterceptorRule["action"];
  return {
    id: String(row.id),
    name: String(row.name),
    enabled: Boolean(row.enabled),
    platformScope: platformScopeOrUndefined(row.platform_scope),
    appPackageName: stringOrUndefined(row.app_package_name),
    iosBundleId: stringOrUndefined(row.ios_bundle_id),
    flowId: stringOrUndefined(row.flow_id),
    stepId: stringOrUndefined(row.step_id),
    text: stringOrUndefined(row.text),
    matchers: JSON.parse(String(row.matchers_json ?? "[]")),
    action,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToPageNavigationSegment(row: Row): PageNavigationSegmentSnapshot {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    platform: String(row.platform) as PageNavigationSegmentSnapshot["platform"],
    fromPage: String(row.from_page),
    toPage: String(row.to_page),
    flowId: String(row.flow_id),
    flowVersion: Number(row.flow_version),
    flowName: String(row.flow_name),
    parameters: JSON.parse(String(row.parameters_json ?? "{}")),
    stepIds: JSON.parse(String(row.step_ids_json ?? "[]")),
    steps: JSON.parse(String(row.steps_json ?? "[]"))
  };
}

function runtimeInterceptorRuleMatchesFilter(rule: RuntimeInterceptorRule, filter: RuntimeInterceptorRuleFilter): boolean {
  if (filter.enabledOnly && rule.enabled === false) {
    return false;
  }
  if (filter.platform && rule.platformScope && rule.platformScope !== "mobile-both" && rule.platformScope !== filter.platform) {
    return false;
  }
  if (filter.appPackageName && rule.appPackageName && rule.appPackageName !== filter.appPackageName) {
    return false;
  }
  if (filter.iosBundleId && rule.iosBundleId && rule.iosBundleId !== filter.iosBundleId) {
    return false;
  }
  if (filter.flowId && rule.flowId && rule.flowId !== filter.flowId) {
    return false;
  }
  if (filter.stepId && rule.stepId && rule.stepId !== filter.stepId) {
    return false;
  }
  return true;
}

function normalizeAiModelSettings(input: Record<string, unknown>): AiModelStoredSettings {
  return stripUndefined({
    enabled: Boolean(input.enabled),
    model: nonEmptyString(input.model),
    timeoutMs: positiveInteger(input.timeoutMs),
    updatedAt: nonEmptyString(input.updatedAt)
  });
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}


function scriptFlowFromInput(
  id: string,
  version: number,
  createdAt: string,
  updatedAt: string,
  input: CreateScriptFlowInput
): ScriptFlow {
  return {
    id,
    appId: input.document.app.id,
    platform: input.document.app.platform,
    name: input.document.name,
    description: input.document.description,
    sourceYaml: input.sourceYaml,
    parsed: input.document as unknown as Record<string, unknown>,
    status: input.status ?? "draft",
    version,
    tags: input.document.tags,
    createdAt,
    updatedAt
  };
}

function rowToScriptFlow(row: Row): ScriptFlow {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    platform: row.platform as ScriptFlow["platform"],
    name: String(row.name),
    description: stringOrUndefined(row.description),
    sourceYaml: String(row.source_yaml),
    parsed: JSON.parse(String(row.parsed_json)) as Record<string, unknown>,
    status: row.status as ScriptFlow["status"],
    version: Number(row.version),
    tags: JSON.parse(String(row.tags_json ?? "[]")) as string[],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToTemporaryTest(row: Row): TemporaryTest {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    platform: row.platform as TemporaryTest["platform"],
    kind: row.kind === "scenario" ? "scenario" : "case",
    purpose: temporaryTestPurpose(row.purpose),
    name: String(row.name),
    prompt: String(row.prompt),
    sourceYaml: String(row.source_yaml),
    parsed: JSON.parse(String(row.parsed_json ?? "{}")) as Record<string, unknown>,
    parameterValues: JSON.parse(String(row.parameter_values_json ?? "{}")) as TemporaryTest["parameterValues"],
    lastRunId: String(row.last_run_id),
    ...(stringOrUndefined(row.last_run_status) ? { lastRunStatus: row.last_run_status as TestRun["status"] } : {}),
    runCount: Number(row.run_count),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function temporaryTestPurpose(value: unknown): TemporaryTest["purpose"] {
  return value === "navigation" || value === "fixture" || value === "recovery" ? value : "business";
}

function rowToScriptFlowVersion(row: Row): ScriptFlowVersion {
  return {
    id: String(row.id),
    flowId: String(row.flow_id),
    version: Number(row.version),
    sourceYaml: String(row.source_yaml),
    parsed: JSON.parse(String(row.parsed_json)) as Record<string, unknown>,
    createdAt: String(row.created_at)
  };
}

function rowToFlowVerification(row: Row): FlowVerification {
  return {
    id: String(row.id),
    ...(stringOrUndefined(row.flow_id) ? { flowId: String(row.flow_id) } : {}),
    ...(row.flow_version === null || row.flow_version === undefined ? {} : { flowVersion: Number(row.flow_version) }),
    sourceHash: String(row.source_hash),
    appId: String(row.app_id),
    platform: row.platform as ScriptFlow["platform"],
    ...(stringOrUndefined(row.app_version) ? { appVersion: String(row.app_version) } : {}),
    runId: String(row.run_id),
    status: row.status as FlowVerification["status"],
    coverage: JSON.parse(String(row.coverage_json)) as FlowVerification["coverage"],
    createdAt: String(row.created_at)
  };
}

function rowToLearningSession(row: Row): LearningSession {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    appId: String(row.app_id),
    platform: row.platform as LearningSession["platform"],
    sourceHash: String(row.source_hash),
    executionPassed: Boolean(row.execution_passed),
    outcomeStatus: row.outcome_status as LearningSession["outcomeStatus"],
    status: row.status as LearningSession["status"],
    summary: JSON.parse(String(row.summary_json)) as LearningSession["summary"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToLearningCandidate(row: Row): LearningCandidate {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    kind: row.kind as LearningCandidate["kind"],
    ...(stringOrUndefined(row.stable_key) ? { stableKey: String(row.stable_key) } : {}),
    ...(stringOrUndefined(row.source_step_id) ? { sourceStepId: String(row.source_step_id) } : {}),
    confidence: Number(row.confidence),
    status: row.status as LearningCandidate["status"],
    payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    evidenceArtifactIds: JSON.parse(String(row.evidence_artifact_ids_json ?? "[]")) as string[],
    validationIssues: JSON.parse(String(row.validation_issues_json ?? "[]")) as string[],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToLearningAggregate(row: Row): LearningAggregate {
  const analysis = row.analysis_json
    ? JSON.parse(String(row.analysis_json)) as Record<string, unknown>
    : undefined;
  return {
    id: String(row.id),
    appId: String(row.app_id),
    platform: row.platform as LearningAggregate["platform"],
    kind: row.kind as LearningAggregate["kind"],
    stableKey: String(row.stable_key),
    representativeCandidateId: String(row.representative_candidate_id),
    status: row.status as LearningAggregate["status"],
    successfulRunCount: Number(row.successful_run_count),
    distinctEvidenceCount: Number(row.distinct_evidence_count),
    analysisRequired: Boolean(row.analysis_required),
    ...(analysis ? { analysis } : {}),
    ...(stringOrUndefined(row.asset_id) ? { assetId: String(row.asset_id) } : {}),
    ...(stringOrUndefined(row.last_error) ? { lastError: String(row.last_error) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToLearningObservation(row: Row): LearningObservation {
  return {
    id: String(row.id),
    aggregateId: String(row.aggregate_id),
    sessionId: String(row.session_id),
    candidateId: String(row.candidate_id),
    runId: String(row.run_id),
    evidenceFingerprint: String(row.evidence_fingerprint),
    evidenceArtifactIds: JSON.parse(String(row.evidence_artifact_ids_json ?? "[]")) as string[],
    createdAt: String(row.created_at)
  };
}

function learningEvidenceFingerprint(candidate: LearningCandidate): string {
  const evidence = [...new Set(candidate.evidenceArtifactIds)].sort();
  const fingerprintSource = evidence.length > 0
    ? evidence.join("\n")
    : JSON.stringify({ sourceStepId: candidate.sourceStepId, payload: candidate.payload });
  return createHash("sha256").update(fingerprintSource).digest("hex");
}

function approvedPageLearningProposal(analysis: Record<string, unknown> | undefined): {
  key: string;
  name: string;
  stableTexts: string[];
} {
  if (!analysis || analysis.decision !== "approve") {
    throw new Error("Page learning requires an approved AI proposal");
  }
  const confidence = typeof analysis.confidence === "number" ? analysis.confidence : 0;
  const validationIssues = Array.isArray(analysis.validationIssues) ? analysis.validationIssues : [];
  const stableTexts = uniqueStrings(
    Array.isArray(analysis.stableTexts)
      ? analysis.stableTexts.flatMap((value) => nonEmptyString(value) ? [nonEmptyString(value)!] : [])
      : []
  );
  if (confidence < 0.9 || validationIssues.length > 0 || stableTexts.length < 2) {
    throw new Error("Page learning proposal does not meet deterministic publication rules");
  }
  const name = nonEmptyString(analysis.canonicalName);
  if (!name) throw new Error("Page learning proposal has no canonical name");
  const proposedKey = nonEmptyString(analysis.canonicalKey)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const key = proposedKey || `learned-page-${createHash("sha256").update(stableTexts.join("\n")).digest("hex").slice(0, 12)}`;
  return { key, name, stableTexts };
}

function normalizeLearningText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, "");
}

function rowToInteractionAsset(row: Row): InteractionAsset {
  return {
    id: String(row.id),
    key: String(row.asset_key),
    appId: String(row.app_id),
    platformScope: row.platform_scope as InteractionAsset["platformScope"],
    owner: { kind: row.owner_kind as InteractionAsset["owner"]["kind"], key: String(row.owner_key) },
    name: String(row.name),
    aliases: JSON.parse(String(row.aliases_json ?? "[]")) as string[],
    supportedActions: JSON.parse(String(row.supported_actions_json ?? "[]")) as InteractionAsset["supportedActions"],
    semanticContract: JSON.parse(String(row.semantic_contract_json ?? "{}")) as InteractionAsset["semanticContract"],
    locatorVariants: JSON.parse(String(row.locator_variants_json ?? "[]")) as InteractionAsset["locatorVariants"],
    status: row.status as InteractionAsset["status"],
    version: Number(row.version),
    provenance: JSON.parse(String(row.provenance_json ?? "{}")) as InteractionAsset["provenance"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToNavigationEntry(row: Row): NavigationEntry {
  const fromKind = row.from_kind === "session" ? "session" : "page";
  const from = fromKind === "session"
    ? {
      kind: "session" as const,
      key: row.from_key === "unauthenticated" ? "unauthenticated" as const : "authenticated" as const,
      ...(stringOrUndefined(row.from_role) ? { role: String(row.from_role) } : {})
    }
    : { kind: "page" as const, key: String(row.from_key) };
  return {
    id: String(row.id),
    key: String(row.entry_key),
    appId: String(row.app_id),
    platformScope: row.platform_scope as NavigationEntry["platformScope"],
    from,
    toPage: String(row.to_page),
    name: String(row.name),
    action: JSON.parse(String(row.action_json ?? "{}")) as NavigationEntry["action"],
    confidence: Number(row.confidence),
    status: row.status as NavigationEntry["status"],
    version: Number(row.version),
    provenance: JSON.parse(String(row.provenance_json ?? "{}")) as NavigationEntry["provenance"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function navigationEntryToSegment(entry: NavigationEntry, platform: ScriptFlow["platform"]): PageNavigationSegmentSnapshot {
  if (entry.from.kind !== "page") throw new Error(`Navigation entry ${entry.id} is not page-scoped`);
  const step: ScriptStep = {
    id: `navigate-with-${entry.id}`,
    name: entry.name,
    onPage: entry.from.key,
    expectPage: entry.toPage,
    risk: "interaction",
    tap: {
      target: entry.action.target as ScriptTarget,
      ...(entry.action.search ? { search: entry.action.search } : {})
    }
  };
  return {
    id: `navigation:${entry.id}:v${entry.version}`,
    appId: entry.appId,
    platform,
    fromPage: entry.from.key,
    toPage: entry.toPage,
    flowId: `navigation-entry:${entry.id}`,
    flowVersion: entry.version,
    flowName: entry.name,
    parameters: {},
    stepIds: [step.id],
    steps: [step]
  };
}

type InteractionAssetDraft = Omit<InteractionAsset, "id" | "version" | "createdAt" | "updatedAt">;
type NavigationEntryDraft = Omit<NavigationEntry, "id" | "version" | "createdAt" | "updatedAt">;

function interactionAssetFromCandidate(session: LearningSession, candidate: LearningCandidate): InteractionAssetDraft {
  if (candidate.kind !== "interaction" || !candidate.stableKey) {
    throw new Error(`Learning candidate ${candidate.id} is not an interaction candidate`);
  }
  if (["accepted", "rejected", "superseded"].includes(candidate.status)) {
    throw new Error(`Learning candidate ${candidate.id} cannot be accepted from status ${candidate.status}`);
  }
  if (containsForbiddenLocatorField(candidate.payload)) {
    throw new Error(`Learning candidate ${candidate.id} contains coordinate or region data`);
  }
  const owner = plainRecord(candidate.payload.owner);
  const ownerKind = owner?.kind;
  const ownerKey = nonEmptyString(owner?.key);
  if ((ownerKind !== "page" && ownerKind !== "component" && ownerKind !== "overlay") || !ownerKey) {
    throw new Error(`Learning candidate ${candidate.id} has no valid owner`);
  }
  const action = nonEmptyString(candidate.payload.supportedAction);
  if (action !== "tap" && action !== "inputText" && action !== "clearText" && action !== "selectText") {
    throw new Error(`Learning candidate ${candidate.id} has no supported action`);
  }
  const rawContract = plainRecord(candidate.payload.semanticContract);
  const semanticContract = readSemanticContract(rawContract);
  if (!semanticContract.text && !semanticContract.semantic && !semanticContract.icon && !semanticContract.control) {
    throw new Error(`Learning candidate ${candidate.id} has no semantic target`);
  }
  const evidence = plainRecord(candidate.payload.locatorEvidence);
  const strategy = nonEmptyString(evidence?.strategy);
  if (!strategy) throw new Error(`Learning candidate ${candidate.id} has no locator strategy`);
  const selectedText = nonEmptyString(evidence?.selectedText);
  const name = nonEmptyString(candidate.payload.name)
    ?? semanticContract.text
    ?? semanticContract.semantic
    ?? semanticContract.icon
    ?? semanticContract.control
    ?? candidate.stableKey;
  return {
    key: candidate.stableKey,
    appId: session.appId,
    platformScope: session.platform,
    owner: { kind: ownerKind, key: ownerKey },
    name,
    aliases: [name],
    supportedActions: [action],
    semanticContract,
    locatorVariants: [{
      platform: session.platform,
      strategy,
      descriptor: {
        semanticContract,
        ...(selectedText ? { selectedText } : {})
      },
      confidence: candidate.confidence
    }],
    status: "active",
    provenance: {
      runIds: [session.runId],
      stepIds: candidate.sourceStepId ? [candidate.sourceStepId] : [],
      artifactIds: candidate.evidenceArtifactIds
    }
  };
}

function mergeInteractionAsset(existing: InteractionAsset, draft: InteractionAssetDraft, now: string): InteractionAsset {
  const variants = [...existing.locatorVariants];
  for (const variant of draft.locatorVariants) {
    if (!variants.some((item) => JSON.stringify(item) === JSON.stringify(variant))) variants.push(variant);
  }
  return {
    ...existing,
    name: draft.name,
    aliases: uniqueStrings([...existing.aliases, ...draft.aliases]),
    supportedActions: uniqueStrings([...existing.supportedActions, ...draft.supportedActions]) as InteractionAsset["supportedActions"],
    semanticContract: { ...existing.semanticContract, ...draft.semanticContract },
    locatorVariants: variants,
    status: "active",
    version: existing.version + 1,
    provenance: {
      runIds: uniqueStrings([...existing.provenance.runIds, ...draft.provenance.runIds]),
      stepIds: uniqueStrings([...existing.provenance.stepIds, ...draft.provenance.stepIds]),
      artifactIds: uniqueStrings([...existing.provenance.artifactIds, ...draft.provenance.artifactIds])
    },
    updatedAt: now
  };
}

function navigationEntryFromCandidate(session: LearningSession, candidate: LearningCandidate): NavigationEntryDraft {
  if (candidate.kind !== "navigation" || !candidate.stableKey) {
    throw new Error(`Learning candidate ${candidate.id} is not a navigation candidate`);
  }
  if (["accepted", "rejected", "superseded"].includes(candidate.status)) {
    throw new Error(`Learning candidate ${candidate.id} cannot be accepted from status ${candidate.status}`);
  }
  if (containsForbiddenLocatorField(candidate.payload)) {
    throw new Error(`Learning candidate ${candidate.id} contains coordinate or region data`);
  }
  const rawFrom = plainRecord(candidate.payload.from);
  const fromKind = rawFrom?.kind;
  const fromKey = nonEmptyString(rawFrom?.key);
  if ((fromKind !== "page" && fromKind !== "session") || !fromKey) {
    throw new Error(`Learning candidate ${candidate.id} has no valid navigation source`);
  }
  const from = fromKind === "page"
    ? { kind: "page" as const, key: fromKey }
    : {
      kind: "session" as const,
      key: fromKey === "authenticated" ? "authenticated" as const : fromKey === "unauthenticated" ? "unauthenticated" as const : undefined,
      ...(nonEmptyString(rawFrom?.role) ? { role: nonEmptyString(rawFrom?.role) } : {})
    };
  if (from.kind === "session" && !from.key) {
    throw new Error(`Learning candidate ${candidate.id} has an invalid session scope`);
  }
  const toPage = nonEmptyString(candidate.payload.toPage);
  const rawAction = plainRecord(candidate.payload.action);
  if (!toPage || rawAction?.kind !== "tap") {
    throw new Error(`Learning candidate ${candidate.id} has no valid target page or action`);
  }
  const target = readNavigationTarget(plainRecord(rawAction.target));
  if (!target.text && !target.semantic && !target.icon && !target.control) {
    throw new Error(`Learning candidate ${candidate.id} has no semantic navigation target`);
  }
  const search = readNavigationSearch(plainRecord(rawAction.search));
  return {
    key: candidate.stableKey,
    appId: session.appId,
    platformScope: session.platform,
    from: from as NavigationEntry["from"],
    toPage,
    name: nonEmptyString(candidate.payload.name) ?? `${fromKey} -> ${toPage}`,
    action: { kind: "tap", target, ...(search ? { search } : {}) },
    confidence: Math.max(0, Math.min(1, candidate.confidence)),
    status: "active",
    provenance: {
      runIds: [session.runId],
      stepIds: candidate.sourceStepId ? [candidate.sourceStepId] : [],
      artifactIds: candidate.evidenceArtifactIds
    }
  };
}

function mergeNavigationEntry(existing: NavigationEntry, draft: NavigationEntryDraft, now: string): NavigationEntry {
  return {
    ...existing,
    from: draft.from,
    toPage: draft.toPage,
    name: draft.name,
    action: draft.action,
    confidence: Math.max(existing.confidence, draft.confidence),
    status: "active",
    version: existing.version + 1,
    provenance: {
      runIds: uniqueStrings([...existing.provenance.runIds, ...draft.provenance.runIds]),
      stepIds: uniqueStrings([...existing.provenance.stepIds, ...draft.provenance.stepIds]),
      artifactIds: uniqueStrings([...existing.provenance.artifactIds, ...draft.provenance.artifactIds])
    },
    updatedAt: now
  };
}

function readNavigationTarget(value: Record<string, unknown> | undefined): NavigationEntry["action"]["target"] {
  if (!value) return {};
  const allowed = ["text", "semantic", "icon", "control", "area", "position", "nearText", "match"] as const;
  return Object.fromEntries(allowed.flatMap((key) => {
    const item = nonEmptyString(value[key]);
    return item ? [[key, item]] : [];
  }));
}

function readNavigationSearch(value: Record<string, unknown> | undefined): NavigationEntry["action"]["search"] | undefined {
  if (!value) return undefined;
  const mode = value.mode === "auto" || value.mode === "visibleOnly" || value.mode === "scroll" ? value.mode : undefined;
  const direction = value.direction === "up" || value.direction === "down" ? value.direction : undefined;
  const maxSwipes = typeof value.maxSwipes === "number" && Number.isInteger(value.maxSwipes)
    ? Math.max(1, Math.min(20, value.maxSwipes))
    : undefined;
  const search: NonNullable<NavigationEntry["action"]["search"]> = {
    ...(mode ? { mode } : {}),
    ...(direction ? { direction } : {}),
    ...(maxSwipes ? { maxSwipes } : {})
  };
  return Object.keys(search).length ? search : undefined;
}

function readSemanticContract(value: Record<string, unknown> | undefined): InteractionAsset["semanticContract"] {
  if (!value) return {};
  const allowed = ["text", "semantic", "icon", "control", "area", "position", "nearText"] as const;
  return Object.fromEntries(allowed.flatMap((key) => {
    const item = nonEmptyString(value[key]);
    return item ? [[key, item]] : [];
  })) as InteractionAsset["semanticContract"];
}

function containsForbiddenLocatorField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenLocatorField);
  const object = plainRecord(value);
  if (!object) return false;
  return Object.entries(object).some(([key, item]) =>
    /^(x|y|coordinate|coordinates|region|bounds|rect|point)$/i.test(key) || containsForbiddenLocatorField(item)
  );
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function scriptFlowSourceSnapshot(runSnapshot: Record<string, unknown>): Pick<TestRun, "sourceSnapshot"> {
  const value = runSnapshot.sourceSnapshot;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.kind !== "script_flow"
    || typeof snapshot.flowId !== "string"
    || typeof snapshot.version !== "number"
    || typeof snapshot.planDigest !== "string"
    || !Array.isArray(snapshot.dependencies)
    || !snapshot.parsed
    || typeof snapshot.parsed !== "object"
    || Array.isArray(snapshot.parsed)
  ) {
    return {};
  }
  const interactionAssets = interactionAssetSnapshotRefs(snapshot.interactionAssets);
  return {
    sourceSnapshot: {
      kind: "script_flow",
      flowId: snapshot.flowId,
      version: snapshot.version,
      planDigest: snapshot.planDigest,
      ...(snapshot.executionPurpose === "trial" || snapshot.executionPurpose === "normal"
        ? { executionPurpose: snapshot.executionPurpose }
        : {}),
      ...(typeof snapshot.sourceHash === "string" ? { sourceHash: snapshot.sourceHash } : {}),
      ...(isVerificationAssessment(snapshot.verificationAssessment)
        ? { verificationAssessment: snapshot.verificationAssessment }
        : {}),
      ...(interactionAssets.length ? { interactionAssets } : {}),
      dependencies: snapshot.dependencies as NonNullable<TestRun["sourceSnapshot"]>["dependencies"],
      ...(typeof snapshot.sourceYaml === "string" ? { sourceYaml: snapshot.sourceYaml } : {}),
      parsed: snapshot.parsed as Record<string, unknown>
    }
  };
}

function interactionAssetSnapshotRefs(
  value: unknown
): NonNullable<NonNullable<TestRun["sourceSnapshot"]>["interactionAssets"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = plainRecord(item);
    if (
      !record
      || typeof record.stepId !== "string"
      || typeof record.assetId !== "string"
      || typeof record.key !== "string"
      || typeof record.version !== "number"
      || !Number.isInteger(record.version)
      || record.version < 1
    ) return [];
    return [{
      stepId: record.stepId,
      assetId: record.assetId,
      key: record.key,
      version: record.version
    }];
  });
}

function isVerificationAssessment(value: unknown): value is NonNullable<TestRun["sourceSnapshot"]>["verificationAssessment"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const assessment = value as Record<string, unknown>;
  return (assessment.status === "verified" || assessment.status === "needs_trial" || assessment.status === "blocked")
    && typeof assessment.sourceHash === "string"
    && Array.isArray(assessment.reasons)
    && Array.isArray(assessment.unresolvedStepIds)
    && typeof assessment.unresolvedOutcome === "boolean";
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}


function graphFromRow(row: Row): BusinessGraph {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    targetApp: JSON.parse(String(row.target_app_json ?? "{}")) as GraphTargetApp,
    platformScope: platformScopeOrUndefined(row.platform_scope) ?? "mobile-both",
    name: String(row.name),
    status: row.status as BusinessGraph["status"],
    activeVersionId: stringOrUndefined(row.active_version_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}


function matcherFromRow(row: Row): StateMatcher {
  const region = row.region_json ? JSON.parse(String(row.region_json)) : undefined;
  const ignoreRegions = row.ignore_regions_json ? JSON.parse(String(row.ignore_regions_json)) : undefined;
  const source = row.source_json ? JSON.parse(String(row.source_json)) : undefined;
  return {
    id: String(row.id),
    type: row.type as StateMatcher["type"],
    value: String(row.value),
    weight: Number(row.weight),
    critical: Boolean(row.critical),
    threshold: numberOrUndefined(row.threshold),
    region: region ?? undefined,
    ignoreRegions: Array.isArray(ignoreRegions) ? ignoreRegions : undefined,
    platformScope: platformScopeOrUndefined(row.platform_scope),
    source: source && Object.keys(source).length > 0 ? source : undefined
  };
}

function artifactFromRow(row: Row): ArtifactRef {
  return {
    id: String(row.id),
    runId: stringOrUndefined(row.run_id),
    stepResultId: stringOrUndefined(row.step_result_id),
    type: row.type as ArtifactRef["type"],
    name: String(row.name),
    path: String(row.path),
    url: String(row.url),
    mimeType: stringOrUndefined(row.mime_type),
    sizeBytes: numberOrUndefined(row.size_bytes),
    createdAt: String(row.created_at),
    deletedAt: stringOrUndefined(row.deleted_at)
  };
}
