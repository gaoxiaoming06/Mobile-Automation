import { DatabaseSync } from "node:sqlite";
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
import type { ScriptFlowDocument } from "@mobile-automation/script-flow";
import {
  createId,
  nowIso,
  type ActionStep,
  type ArtifactRef,
  type DeviceEvent,
  type MetricSample,
  type ScriptFlow,
  type ScriptFlowVersion,
  type StepResult,
  type TestCase,
  type TestRun
} from "@mobile-automation/shared";
import { artifactRoot, dataRoot } from "./artifacts.js";
import { previewAiModelSettingsUpdate, type AiModelSettingsUpdateInput, type AiModelStoredSettings } from "./ai-model-settings.js";
import type { RuntimeInterceptorRule } from "./runtime-interceptor.js";

const dbPath = path.join(dataRoot, "mobile-automation.sqlite");

type Row = Record<string, unknown>;

type CreateBusinessGraphInput = {
  appId: string;
  targetApp?: GraphTargetApp;
  platformScope: PlatformScope;
  name: string;
  status?: BusinessGraph["status"];
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

export class Storage {
  private readonly db: DatabaseSync;

  constructor() {
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

  createCase(input: { name: string; description?: string; steps: ActionStep[]; targetApp?: TestCase["targetApp"]; tags?: string[] }): TestCase {
    const id = createId("case");
    const now = nowIso();
    const testCase: TestCase = {
      id,
      name: input.name,
      description: input.description,
      platformScope: "android",
      targetApp: input.targetApp,
      tags: input.tags ?? [],
      version: 1,
      steps: input.steps.map((step, index) => ({ ...step, order: index + 1 })),
      createdAt: now,
      updatedAt: now
    };

    const tx = this.db.prepare("BEGIN");
    tx.run();
    try {
      this.db
        .prepare(
          `INSERT INTO test_cases (id, name, description, platform_scope, target_app_json, tags_json, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          testCase.name,
          testCase.description ?? null,
          testCase.platformScope,
          JSON.stringify(testCase.targetApp ?? {}),
          JSON.stringify(testCase.tags),
          testCase.version,
          now,
          now
        );

      const insertStep = this.db.prepare(
        `INSERT INTO steps
          (id, case_id, step_order, type, enabled, title, note, params_json, timing_json, coordinate_json, preconditions_json, expectations_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const step of testCase.steps) {
        insertStep.run(
          step.id,
          id,
          step.order,
          step.type,
          step.enabled ? 1 : 0,
          step.title ?? null,
          step.note ?? null,
          JSON.stringify(step.params ?? {}),
          JSON.stringify(step.timing ?? {}),
          JSON.stringify(step.coordinate ?? {}),
          JSON.stringify(step.preconditions ?? []),
          JSON.stringify(step.expectations ?? []),
          step.createdAt,
          now
        );
      }
      this.db.prepare("COMMIT").run();
    } catch (error) {
      this.db.prepare("ROLLBACK").run();
      throw error;
    }

    return testCase;
  }

  listCases(): TestCase[] {
    const rows = this.db.prepare("SELECT * FROM test_cases ORDER BY updated_at DESC").all() as Row[];
    return rows.map((row) => this.rowToCase(row, true));
  }

  findCaseByName(name: string): TestCase | undefined {
    const row = this.db.prepare("SELECT * FROM test_cases WHERE name = ? ORDER BY updated_at DESC LIMIT 1").get(name) as Row | undefined;
    if (!row) {
      return undefined;
    }
    return this.rowToCase(row, true);
  }

  getCase(id: string): TestCase | undefined {
    const row = this.db.prepare("SELECT * FROM test_cases WHERE id = ?").get(id) as Row | undefined;
    if (!row) {
      return undefined;
    }
    return this.rowToCase(row, true);
  }

  updateCase(id: string, input: { name: string; description?: string; steps: ActionStep[]; targetApp?: TestCase["targetApp"]; tags?: string[] }): TestCase {
    const existing = this.getCase(id);
    if (!existing) {
      throw new Error(`Test case not found: ${id}`);
    }
    const now = nowIso();
    const next: TestCase = {
      ...existing,
      name: input.name,
      description: input.description,
      targetApp: input.targetApp ?? existing.targetApp,
      tags: input.tags ?? existing.tags,
      version: existing.version + 1,
      steps: input.steps.map((step, index) => ({ ...step, order: index + 1 })),
      updatedAt: now
    };

    this.db.prepare("BEGIN").run();
    try {
      this.db
        .prepare("UPDATE test_cases SET name = ?, description = ?, target_app_json = ?, tags_json = ?, version = ?, updated_at = ? WHERE id = ?")
        .run(next.name, next.description ?? null, JSON.stringify(next.targetApp ?? {}), JSON.stringify(next.tags), next.version, now, id);
      this.db.prepare("DELETE FROM steps WHERE case_id = ?").run(id);
      const insertStep = this.db.prepare(
        `INSERT INTO steps
          (id, case_id, step_order, type, enabled, title, note, params_json, timing_json, coordinate_json, preconditions_json, expectations_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const step of next.steps) {
        insertStep.run(
          step.id,
          id,
          step.order,
          step.type,
          step.enabled ? 1 : 0,
          step.title ?? null,
          step.note ?? null,
          JSON.stringify(step.params ?? {}),
          JSON.stringify(step.timing ?? {}),
          JSON.stringify(step.coordinate ?? {}),
          JSON.stringify(step.preconditions ?? []),
          JSON.stringify(step.expectations ?? []),
          step.createdAt,
          now
        );
      }
      this.db.prepare("COMMIT").run();
    } catch (error) {
      this.db.prepare("ROLLBACK").run();
      throw error;
    }

    return next;
  }

  deleteCase(id: string): boolean {
    const result = this.db.prepare("DELETE FROM test_cases WHERE id = ?").run(id);
    return result.changes > 0;
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


  createRun(input: { caseId?: string; caseName: string; deviceSerial: string; configJson: string; caseSnapshotJson: string; steps: ActionStep[] }): TestRun {
    const id = createId("run");
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO runs (id, case_id, case_name, device_serial, status, config_json, case_snapshot_json, started_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.caseId ?? null, input.caseName, input.deviceSerial, "running", input.configJson, input.caseSnapshotJson, now, now);

    const caseSnapshot = JSON.parse(input.caseSnapshotJson) as Record<string, unknown>;
    return {
      id,
      caseId: input.caseId,
      caseName: input.caseName,
      deviceSerial: input.deviceSerial,
      status: "running",
      config: JSON.parse(input.configJson),
      steps: input.steps,
      stepResults: [],
      metrics: [],
      events: [],
      artifacts: [],
      ...scriptFlowSourceSnapshot(caseSnapshot),
      startedAt: now
    };
  }

  updateRunStatus(runId: string, status: TestRun["status"], endedAt?: string): void {
    const isFinalStatus = !["pending", "running", "paused"].includes(status);
    this.db.prepare("UPDATE runs SET status = ?, ended_at = ? WHERE id = ?").run(status, isFinalStatus ? endedAt ?? nowIso() : null, runId);
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
    const caseSnapshot = JSON.parse(String(row.case_snapshot_json)) as Record<string, unknown>;
    return {
      id: String(row.id),
      caseId: stringOrUndefined(row.case_id),
      caseName: String(row.case_name),
      deviceSerial: String(row.device_serial),
      status: row.status as TestRun["status"],
      config: JSON.parse(String(row.config_json)),
      steps: Array.isArray(caseSnapshot.steps) ? caseSnapshot.steps as ActionStep[] : [],
      stepResults,
      metrics,
      events,
      artifacts,
      ...scriptFlowSourceSnapshot(caseSnapshot),
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
      .prepare("SELECT id, status, created_at, ended_at FROM runs WHERE status NOT IN ('pending', 'running', 'paused') ORDER BY created_at ASC")
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

  private rowToCase(row: Row, includeSteps: boolean): TestCase {
    const id = String(row.id);
    return {
      id,
      name: String(row.name),
      description: stringOrUndefined(row.description),
      platformScope: row.platform_scope as TestCase["platformScope"],
      targetApp: JSON.parse(String(row.target_app_json)),
      tags: JSON.parse(String(row.tags_json)),
      version: Number(row.version),
      steps: includeSteps ? this.getSteps(id) : [],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private getSteps(caseId: string): ActionStep[] {
    const rows = this.db.prepare("SELECT * FROM steps WHERE case_id = ? ORDER BY step_order ASC").all(caseId) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      order: Number(row.step_order),
      type: row.type as ActionStep["type"],
      enabled: Boolean(row.enabled),
      title: stringOrUndefined(row.title),
      note: stringOrUndefined(row.note),
      params: JSON.parse(String(row.params_json)),
      timing: JSON.parse(String(row.timing_json)),
      coordinate: JSON.parse(String(row.coordinate_json)),
      preconditions: JSON.parse(String(row.preconditions_json ?? "[]")),
      expectations: JSON.parse(String(row.expectations_json ?? "[]")),
      createdAt: String(row.created_at)
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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS test_cases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        platform_scope TEXT NOT NULL,
        target_app_json TEXT NOT NULL DEFAULT '{}',
        tags_json TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS steps (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
        step_order INTEGER NOT NULL,
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        title TEXT,
        note TEXT,
        params_json TEXT NOT NULL DEFAULT '{}',
        timing_json TEXT NOT NULL DEFAULT '{}',
        coordinate_json TEXT NOT NULL DEFAULT '{}',
        preconditions_json TEXT NOT NULL DEFAULT '[]',
        expectations_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(case_id, step_order)
      );


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


      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        case_id TEXT REFERENCES test_cases(id) ON DELETE SET NULL,
        case_name TEXT NOT NULL,
        device_serial TEXT NOT NULL,
        status TEXT NOT NULL,
        config_json TEXT NOT NULL,
        case_snapshot_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        report_html_path TEXT,
        created_at TEXT NOT NULL
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

      CREATE INDEX IF NOT EXISTS idx_steps_case_order ON steps(case_id, step_order);
      CREATE INDEX IF NOT EXISTS idx_script_flows_app ON script_flows(app_id, platform, status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_script_flow_versions_flow ON script_flow_versions(flow_id, version);
      CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);
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
    baseURL: nonEmptyString(input.baseURL),
    apiKey: nonEmptyString(input.apiKey),
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

function scriptFlowSourceSnapshot(caseSnapshot: Record<string, unknown>): Pick<TestRun, "sourceSnapshot"> {
  const value = caseSnapshot.sourceSnapshot;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.kind !== "script_flow"
    || typeof snapshot.flowId !== "string"
    || typeof snapshot.version !== "number"
    || !snapshot.parsed
    || typeof snapshot.parsed !== "object"
    || Array.isArray(snapshot.parsed)
  ) {
    return {};
  }
  return {
    sourceSnapshot: {
      kind: "script_flow",
      flowId: snapshot.flowId,
      version: snapshot.version,
      ...(typeof snapshot.sourceYaml === "string" ? { sourceYaml: snapshot.sourceYaml } : {}),
      parsed: snapshot.parsed as Record<string, unknown>
    }
  };
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
