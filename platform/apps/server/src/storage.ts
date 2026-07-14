import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ActionPolicy,
  BusinessGraph,
  BusinessGraphVersion,
  BusinessNode,
  GraphTargetApp,
  OperationEdge,
  PlatformScope,
  RoutePlan,
  StateMatcher
} from "@mobile-automation/graph-core";
import type { CandidateEdge, CandidateNode, SourceScanResult } from "@mobile-automation/source-scanner";
import {
  createId,
  nowIso,
  type ActionStep,
  type ArtifactRef,
  type AssetCompositeCase,
  type AssetCompositeCaseStep,
  type DeviceEvent,
  type MetaFunction,
  type MetaFunctionStep,
  type MetricSample,
  type ParameterDataRecord,
  type ParameterProfile,
  type StepResult,
  type StructuredFlow,
  type StructuredFlowStep,
  type TestCase,
  type TestRun
} from "@mobile-automation/shared";
import { artifactRoot, dataRoot } from "./artifacts.js";
import { previewAiDiagnosisSettingsUpdate, type AiDiagnosisSettingsUpdateInput, type AiDiagnosisStoredSettings } from "./ai-diagnosis.js";
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

type CreateOperationEdgeInput = Omit<OperationEdge, "id" | "status" | "preconditions" | "actionPolicies" | "expectations"> & {
  id?: string;
  status?: OperationEdge["status"];
  preconditions?: OperationEdge["preconditions"];
  actionPolicies?: ActionPolicy[];
  expectations?: OperationEdge["expectations"];
};

type ImportSourceScanInput = {
  graphId?: string;
  appId: string;
  targetApp?: GraphTargetApp;
  name?: string;
  scanResult: SourceScanResult;
};

type CreateStructuredFlowInput = Omit<StructuredFlow, "id" | "version" | "createdAt" | "updatedAt" | "steps" | "tags" | "status" | "startStrategy"> & {
  startStrategy?: StructuredFlow["startStrategy"];
  tags?: string[];
  status?: StructuredFlow["status"];
  steps: StructuredFlowStep[];
};

export type CreateParameterProfileInput = Omit<ParameterProfile, "id" | "version" | "createdAt" | "updatedAt" | "status"> & {
  status?: ParameterProfile["status"];
};

export type CreateParameterDataRecordInput = Omit<ParameterDataRecord, "id" | "version" | "createdAt" | "updatedAt" | "status"> & {
  status?: ParameterDataRecord["status"];
};

export type CreateMetaFunctionInput = Omit<MetaFunction, "id" | "version" | "createdAt" | "updatedAt" | "status" | "steps"> & {
  status?: MetaFunction["status"];
  steps: MetaFunctionStep[];
};

export type CreateAssetCompositeCaseInput = Omit<AssetCompositeCase, "id" | "version" | "createdAt" | "updatedAt" | "status" | "steps"> & {
  status?: AssetCompositeCase["status"];
  steps: AssetCompositeCaseStep[];
};

type RuntimeInterceptorRuleFilter = {
  enabledOnly?: boolean;
  platform?: "android" | "ios";
  appPackageName?: string;
  iosBundleId?: string;
  flowId?: string;
  stepId?: string;
};

const AI_DIAGNOSIS_SETTINGS_KEY = "ai_diagnosis";

export type ImportedSourceScanGraph = {
  graph: BusinessGraph;
  version: BusinessGraphVersion;
  importedNodeCount: number;
  importedEdgeCount: number;
  skippedEdgeCount: number;
};

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

  createStructuredFlow(input: CreateStructuredFlowInput): StructuredFlow {
    const id = createId("flow");
    const now = nowIso();
    const flow: StructuredFlow = {
      id,
      name: input.name,
      description: input.description,
      appId: input.appId,
      appName: input.appName,
      platform: input.platform,
      targetApp: input.targetApp,
      appVersion: input.appVersion,
      startState: input.startState,
      endState: input.endState,
      role: input.role,
      startStrategy: input.startStrategy ?? "restart_app",
      tags: input.tags ?? [],
      status: input.status ?? "draft",
      version: 1,
      steps: normalizeStructuredFlowSteps(input.steps),
      createdAt: now,
      updatedAt: now
    };

    this.db.prepare("BEGIN").run();
    try {
      this.db
        .prepare(
          `INSERT INTO structured_flows
            (id, name, description, app_id, app_name, platform, target_app_json, app_version_json, start_state_json, end_state_json, role, start_strategy, tags_json, status, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          flow.id,
          flow.name,
          flow.description ?? null,
          flow.appId ?? null,
          flow.appName,
          flow.platform,
          JSON.stringify(flow.targetApp),
          JSON.stringify(flow.appVersion),
          JSON.stringify(flow.startState),
          JSON.stringify(flow.endState),
          flow.role ?? null,
          flow.startStrategy,
          JSON.stringify(flow.tags),
          flow.status,
          flow.version,
          flow.createdAt,
          flow.updatedAt
        );
      this.insertStructuredFlowSteps(flow.id, flow.steps, now);
      this.db.prepare("COMMIT").run();
    } catch (error) {
      this.db.prepare("ROLLBACK").run();
      throw error;
    }

    return flow;
  }

  listStructuredFlows(): StructuredFlow[] {
    const rows = this.db.prepare("SELECT * FROM structured_flows ORDER BY updated_at DESC").all() as Row[];
    return rows.map((row) => this.rowToStructuredFlow(row, true));
  }

  getStructuredFlow(id: string): StructuredFlow | undefined {
    const row = this.db.prepare("SELECT * FROM structured_flows WHERE id = ?").get(id) as Row | undefined;
    return row ? this.rowToStructuredFlow(row, true) : undefined;
  }

  updateStructuredFlow(id: string, input: CreateStructuredFlowInput): StructuredFlow {
    const existing = this.getStructuredFlow(id);
    if (!existing) {
      throw new Error(`Structured flow not found: ${id}`);
    }
    const now = nowIso();
    const next: StructuredFlow = {
      ...existing,
      name: input.name,
      description: input.description,
      appId: input.appId,
      appName: input.appName,
      platform: input.platform,
      targetApp: input.targetApp,
      appVersion: input.appVersion,
      startState: input.startState,
      endState: input.endState,
      role: input.role,
      startStrategy: input.startStrategy ?? existing.startStrategy,
      tags: input.tags ?? [],
      status: input.status ?? existing.status,
      version: existing.version + 1,
      steps: normalizeStructuredFlowSteps(input.steps),
      updatedAt: now
    };

    this.db.prepare("BEGIN").run();
    try {
      this.db
        .prepare(
          `UPDATE structured_flows
           SET name = ?, description = ?, app_id = ?, app_name = ?, platform = ?, target_app_json = ?, app_version_json = ?, start_state_json = ?, end_state_json = ?, role = ?, start_strategy = ?, tags_json = ?, status = ?, version = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          next.name,
          next.description ?? null,
          next.appId ?? null,
          next.appName,
          next.platform,
          JSON.stringify(next.targetApp),
          JSON.stringify(next.appVersion),
          JSON.stringify(next.startState),
          JSON.stringify(next.endState),
          next.role ?? null,
          next.startStrategy,
          JSON.stringify(next.tags),
          next.status,
          next.version,
          next.updatedAt,
          id
        );
      this.db.prepare("DELETE FROM structured_flow_steps WHERE flow_id = ?").run(id);
      this.insertStructuredFlowSteps(id, next.steps, now);
      this.db.prepare("COMMIT").run();
    } catch (error) {
      this.db.prepare("ROLLBACK").run();
      throw error;
    }

    return next;
  }

  deleteStructuredFlow(id: string): boolean {
    const result = this.db.prepare("DELETE FROM structured_flows WHERE id = ?").run(id);
    return result.changes > 0;
  }

  createParameterProfile(input: CreateParameterProfileInput): ParameterProfile {
    const now = nowIso();
    const profile: ParameterProfile = {
      id: createId("parameter_profile"),
      appId: input.appId,
      platform: input.platform,
      name: input.name,
      description: input.description,
      environment: input.environment,
      bindings: input.bindings ?? [],
      values: input.values,
      status: input.status ?? "active",
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    this.db.prepare(
      `INSERT INTO asset_parameter_profiles
        (id, app_id, platform, name, description, environment, bindings_json, values_json, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      profile.id,
      profile.appId,
      profile.platform,
      profile.name,
      profile.description ?? null,
      profile.environment ?? null,
      JSON.stringify(profile.bindings),
      JSON.stringify(profile.values),
      profile.status,
      profile.version,
      profile.createdAt,
      profile.updatedAt
    );
    return profile;
  }

  listParameterProfiles(filter: { appId?: string; platform?: ParameterProfile["platform"] } = {}): ParameterProfile[] {
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
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM asset_parameter_profiles${where} ORDER BY updated_at DESC`).all(...values) as Row[];
    return rows.map(rowToParameterProfile);
  }

  getParameterProfile(id: string): ParameterProfile | undefined {
    const row = this.db.prepare("SELECT * FROM asset_parameter_profiles WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToParameterProfile(row) : undefined;
  }

  updateParameterProfile(id: string, input: CreateParameterProfileInput): ParameterProfile {
    const existing = this.getParameterProfile(id);
    if (!existing) {
      throw new Error(`Parameter profile not found: ${id}`);
    }
    const next: ParameterProfile = {
      ...existing,
      appId: input.appId,
      platform: input.platform,
      name: input.name,
      description: input.description,
      environment: input.environment,
      bindings: input.bindings ?? [],
      values: input.values,
      status: input.status ?? existing.status,
      version: existing.version + 1,
      updatedAt: nowIso()
    };
    this.db.prepare(
      `UPDATE asset_parameter_profiles
       SET app_id = ?, platform = ?, name = ?, description = ?, environment = ?, bindings_json = ?, values_json = ?, status = ?, version = ?, updated_at = ?
       WHERE id = ?`
    ).run(next.appId, next.platform, next.name, next.description ?? null, next.environment ?? null, JSON.stringify(next.bindings), JSON.stringify(next.values), next.status, next.version, next.updatedAt, id);
    return next;
  }

  deleteParameterProfile(id: string): boolean {
    return this.db.prepare("DELETE FROM asset_parameter_profiles WHERE id = ?").run(id).changes > 0;
  }

  createParameterDataRecord(input: CreateParameterDataRecordInput): ParameterDataRecord {
    const now = nowIso();
    const record: ParameterDataRecord = {
      id: createId("parameter_data_record"),
      appId: input.appId,
      platform: input.platform,
      domainKey: input.domainKey,
      name: input.name,
      description: input.description,
      environment: input.environment,
      values: input.values,
      status: input.status ?? "active",
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    this.db.prepare(
      `INSERT INTO asset_parameter_data_records
        (id, app_id, platform, domain_key, name, description, environment, values_json, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.appId,
      record.platform,
      record.domainKey,
      record.name,
      record.description ?? null,
      record.environment ?? null,
      JSON.stringify(record.values),
      record.status,
      record.version,
      record.createdAt,
      record.updatedAt
    );
    return record;
  }

  listParameterDataRecords(filter: { appId?: string; platform?: ParameterDataRecord["platform"]; domainKey?: string } = {}): ParameterDataRecord[] {
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
    if (filter.domainKey) {
      clauses.push("domain_key = ?");
      values.push(filter.domainKey);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM asset_parameter_data_records${where} ORDER BY domain_key ASC, updated_at DESC`).all(...values) as Row[];
    return rows.map(rowToParameterDataRecord);
  }

  getParameterDataRecord(id: string): ParameterDataRecord | undefined {
    const row = this.db.prepare("SELECT * FROM asset_parameter_data_records WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToParameterDataRecord(row) : undefined;
  }

  updateParameterDataRecord(id: string, input: CreateParameterDataRecordInput): ParameterDataRecord {
    const existing = this.getParameterDataRecord(id);
    if (!existing) {
      throw new Error(`Parameter data record not found: ${id}`);
    }
    const next: ParameterDataRecord = {
      ...existing,
      appId: input.appId,
      platform: input.platform,
      domainKey: input.domainKey,
      name: input.name,
      description: input.description,
      environment: input.environment,
      values: input.values,
      status: input.status ?? existing.status,
      version: existing.version + 1,
      updatedAt: nowIso()
    };
    this.db.prepare(
      `UPDATE asset_parameter_data_records
       SET app_id = ?, platform = ?, domain_key = ?, name = ?, description = ?, environment = ?, values_json = ?, status = ?, version = ?, updated_at = ?
       WHERE id = ?`
    ).run(next.appId, next.platform, next.domainKey, next.name, next.description ?? null, next.environment ?? null, JSON.stringify(next.values), next.status, next.version, next.updatedAt, id);
    return next;
  }

  deleteParameterDataRecord(id: string): boolean {
    return this.db.prepare("DELETE FROM asset_parameter_data_records WHERE id = ?").run(id).changes > 0;
  }

  createMetaFunction(input: CreateMetaFunctionInput): MetaFunction {
    const now = nowIso();
    const metaFunction: MetaFunction = {
      id: createId("meta_function"),
      appId: input.appId,
      platform: input.platform,
      name: input.name,
      description: input.description,
      parameters: input.parameters,
      steps: normalizeOrderedSteps(input.steps),
      status: input.status ?? "draft",
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    this.db.prepare(
      `INSERT INTO asset_meta_functions
        (id, app_id, platform, name, description, parameters_json, steps_json, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(metaFunction.id, metaFunction.appId, metaFunction.platform, metaFunction.name, metaFunction.description ?? null, JSON.stringify(metaFunction.parameters), JSON.stringify(metaFunction.steps), metaFunction.status, metaFunction.version, metaFunction.createdAt, metaFunction.updatedAt);
    return metaFunction;
  }

  listMetaFunctions(filter: { appId?: string; platform?: MetaFunction["platform"] } = {}): MetaFunction[] {
    const { where, values } = appPlatformWhere(filter);
    const rows = this.db.prepare(`SELECT * FROM asset_meta_functions${where} ORDER BY updated_at DESC`).all(...values) as Row[];
    return rows.map(rowToMetaFunction);
  }

  getMetaFunction(id: string): MetaFunction | undefined {
    const row = this.db.prepare("SELECT * FROM asset_meta_functions WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToMetaFunction(row) : undefined;
  }

  updateMetaFunction(id: string, input: CreateMetaFunctionInput): MetaFunction {
    const existing = this.getMetaFunction(id);
    if (!existing) {
      throw new Error(`Meta function not found: ${id}`);
    }
    const next: MetaFunction = {
      ...existing,
      appId: input.appId,
      platform: input.platform,
      name: input.name,
      description: input.description,
      parameters: input.parameters,
      steps: normalizeOrderedSteps(input.steps),
      status: input.status ?? existing.status,
      version: existing.version + 1,
      updatedAt: nowIso()
    };
    this.db.prepare(
      `UPDATE asset_meta_functions
       SET app_id = ?, platform = ?, name = ?, description = ?, parameters_json = ?, steps_json = ?, status = ?, version = ?, updated_at = ?
       WHERE id = ?`
    ).run(next.appId, next.platform, next.name, next.description ?? null, JSON.stringify(next.parameters), JSON.stringify(next.steps), next.status, next.version, next.updatedAt, id);
    return next;
  }

  deleteMetaFunction(id: string): boolean {
    return this.db.prepare("DELETE FROM asset_meta_functions WHERE id = ?").run(id).changes > 0;
  }

  createAssetCompositeCase(input: CreateAssetCompositeCaseInput): AssetCompositeCase {
    const now = nowIso();
    const compositeCase: AssetCompositeCase = {
      id: createId("asset_composite_case"),
      appId: input.appId,
      platform: input.platform,
      name: input.name,
      description: input.description,
      parameterProfileId: input.parameterProfileId,
      runMode: input.runMode,
      repeatCount: input.repeatCount,
      stopOnFailure: input.stopOnFailure,
      steps: normalizeOrderedSteps(input.steps),
      status: input.status ?? "draft",
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    this.db.prepare(
      `INSERT INTO asset_composite_cases
        (id, app_id, platform, name, description, parameter_profile_id, run_mode, repeat_count, stop_on_failure, steps_json, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(compositeCase.id, compositeCase.appId, compositeCase.platform, compositeCase.name, compositeCase.description ?? null, compositeCase.parameterProfileId ?? null, compositeCase.runMode, compositeCase.repeatCount, compositeCase.stopOnFailure ? 1 : 0, JSON.stringify(compositeCase.steps), compositeCase.status, compositeCase.version, compositeCase.createdAt, compositeCase.updatedAt);
    return compositeCase;
  }

  listAssetCompositeCases(filter: { appId?: string; platform?: AssetCompositeCase["platform"] } = {}): AssetCompositeCase[] {
    const { where, values } = appPlatformWhere(filter);
    const rows = this.db.prepare(`SELECT * FROM asset_composite_cases${where} ORDER BY updated_at DESC`).all(...values) as Row[];
    return rows.map(rowToAssetCompositeCase);
  }

  getAssetCompositeCase(id: string): AssetCompositeCase | undefined {
    const row = this.db.prepare("SELECT * FROM asset_composite_cases WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToAssetCompositeCase(row) : undefined;
  }

  updateAssetCompositeCase(id: string, input: CreateAssetCompositeCaseInput): AssetCompositeCase {
    const existing = this.getAssetCompositeCase(id);
    if (!existing) {
      throw new Error(`Asset composite case not found: ${id}`);
    }
    const next: AssetCompositeCase = {
      ...existing,
      appId: input.appId,
      platform: input.platform,
      name: input.name,
      description: input.description,
      parameterProfileId: input.parameterProfileId,
      runMode: input.runMode,
      repeatCount: input.repeatCount,
      stopOnFailure: input.stopOnFailure,
      steps: normalizeOrderedSteps(input.steps),
      status: input.status ?? existing.status,
      version: existing.version + 1,
      updatedAt: nowIso()
    };
    this.db.prepare(
      `UPDATE asset_composite_cases
       SET app_id = ?, platform = ?, name = ?, description = ?, parameter_profile_id = ?, run_mode = ?, repeat_count = ?, stop_on_failure = ?, steps_json = ?, status = ?, version = ?, updated_at = ?
       WHERE id = ?`
    ).run(next.appId, next.platform, next.name, next.description ?? null, next.parameterProfileId ?? null, next.runMode, next.repeatCount, next.stopOnFailure ? 1 : 0, JSON.stringify(next.steps), next.status, next.version, next.updatedAt, id);
    return next;
  }

  deleteAssetCompositeCase(id: string): boolean {
    return this.db.prepare("DELETE FROM asset_composite_cases WHERE id = ?").run(id).changes > 0;
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

  getAiDiagnosisSettings(): AiDiagnosisStoredSettings | undefined {
    const row = this.db.prepare("SELECT value_json, updated_at FROM app_settings WHERE setting_key = ?").get(AI_DIAGNOSIS_SETTINGS_KEY) as Row | undefined;
    if (!row) {
      return undefined;
    }
    const parsed = parseJsonObject(String(row.value_json));
    return normalizeAiDiagnosisSettings({ ...parsed, updatedAt: String(row.updated_at) });
  }

  updateAiDiagnosisSettings(input: AiDiagnosisSettingsUpdateInput): AiDiagnosisStoredSettings {
    const existing = this.getAiDiagnosisSettings();
    const now = nowIso();
    const next = normalizeAiDiagnosisSettings({
      ...previewAiDiagnosisSettingsUpdate(existing, input),
      updatedAt: now
    });
    this.db
      .prepare(
        `INSERT INTO app_settings (setting_key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(AI_DIAGNOSIS_SETTINGS_KEY, JSON.stringify(stripUndefined({ ...next, updatedAt: undefined })), now);
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
      edges: [],
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

  createOperationEdge(input: CreateOperationEdgeInput): OperationEdge {
    const id = input.id ?? createId("edge");
    const edge: OperationEdge = {
      id,
      graphVersionId: input.graphVersionId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      key: input.key,
      name: input.name,
      intent: input.intent,
      status: input.status ?? "draft",
      source: input.source,
      preconditions: input.preconditions ?? [],
      actionPolicies: input.actionPolicies ?? [],
      expectations: input.expectations ?? [],
      failurePolicy: input.failurePolicy,
      platformScope: input.platformScope,
      reliabilityScore: input.reliabilityScore
    };
    this.db.prepare("BEGIN").run();
    try {
      this.db
        .prepare(
          `INSERT INTO operation_edges
            (id, graph_version_id, from_node_id, to_node_id, edge_key, name, intent, status, source, failure_policy_json, platform_scope, reliability_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          edge.id,
          edge.graphVersionId,
          edge.fromNodeId,
          edge.toNodeId,
          edge.key,
          edge.name,
          edge.intent,
          edge.status,
          edge.source,
          JSON.stringify(edge.failurePolicy ?? {}),
          edge.platformScope ?? null,
          edge.reliabilityScore ?? null
        );
      this.insertEdgeExpectations("edge_preconditions", edge.id, edge.preconditions);
      this.insertActionPolicies(edge.id, edge.actionPolicies);
      this.insertEdgeExpectations("edge_expectations", edge.id, edge.expectations);
      this.db.prepare("COMMIT").run();
    } catch (error) {
      this.db.prepare("ROLLBACK").run();
      throw error;
    }
    return edge;
  }

  findOperationEdgeByKey(graphVersionId: string, key: string): OperationEdge | undefined {
    const row = this.db.prepare("SELECT * FROM operation_edges WHERE graph_version_id = ? AND edge_key = ?").get(graphVersionId, key) as Row | undefined;
    if (!row) {
      return undefined;
    }
    return this.operationEdgeFromRow(row);
  }

  listOperationEdges(graphVersionId: string): OperationEdge[] {
    return this.getOperationEdges(graphVersionId);
  }

  updateOperationEdgeStatus(edgeId: string, status: OperationEdge["status"]): OperationEdge | undefined {
    this.db.prepare("UPDATE operation_edges SET status = ? WHERE id = ?").run(status, edgeId);
    const row = this.db.prepare("SELECT * FROM operation_edges WHERE id = ?").get(edgeId) as Row | undefined;
    return row ? this.operationEdgeFromRow(row) : undefined;
  }

  getBusinessGraphVersion(id: string): BusinessGraphVersion | undefined {
    const row = this.db.prepare("SELECT * FROM business_graph_versions WHERE id = ?").get(id) as Row | undefined;
    return row ? this.rowToBusinessGraphVersion(row) : undefined;
  }

  getActiveBusinessGraphVersion(graphId: string): BusinessGraphVersion | undefined {
    const graph = this.getBusinessGraph(graphId);
    if (!graph?.activeVersionId) {
      return undefined;
    }
    return this.getBusinessGraphVersion(graph.activeVersionId);
  }

  importSourceScanGraph(input: ImportSourceScanInput): ImportedSourceScanGraph {
    const graph =
      (input.graphId ? this.getBusinessGraph(input.graphId) : undefined) ??
      this.createBusinessGraph({
        appId: input.appId,
        targetApp: input.targetApp ?? input.scanResult.targetApp,
        platformScope: input.scanResult.platform,
        name: input.name?.trim() || `${input.appId} 业务图谱`,
        status: "draft"
      });
    const version = this.createBusinessGraphVersion({
      graphId: graph.id,
      sourceSummary: [
        `source_scan:${input.scanResult.repoPath}`,
        `nodes:${input.scanResult.nodes.length}`,
        `edges:${input.scanResult.edges.length}`
      ],
      status: "draft"
    });
    const nodeIdsByKey = new Map<string, string>();
    for (const candidate of input.scanResult.nodes) {
      const node = this.createBusinessNode(candidateNodeToInput(version.id, candidate));
      nodeIdsByKey.set(candidate.key, node.id);
    }

    let importedEdgeCount = 0;
    let skippedEdgeCount = 0;
    for (const candidate of input.scanResult.edges) {
      const fromNodeId = candidate.fromNodeKey ? nodeIdsByKey.get(candidate.fromNodeKey) : undefined;
      const toNodeId = candidate.toNodeKey ? nodeIdsByKey.get(candidate.toNodeKey) : undefined;
      if (!fromNodeId || !toNodeId) {
        skippedEdgeCount += 1;
        continue;
      }
      this.createOperationEdge(candidateEdgeToInput(version.id, candidate, fromNodeId, toNodeId));
      importedEdgeCount += 1;
    }

    return {
      graph,
      version: this.getBusinessGraphVersion(version.id) ?? version,
      importedNodeCount: input.scanResult.nodes.length,
      importedEdgeCount,
      skippedEdgeCount
    };
  }

  saveRoutePlan(plan: RoutePlan): void {
    this.db.prepare("BEGIN").run();
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO route_plans
            (id, graph_version_id, app_id, target_node_id, start_node_id, strategy, assumptions_json, unresolved_issues_json, snapshot_json, plan_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          plan.id,
          plan.graphVersionId,
          plan.appId,
          plan.targetNodeId,
          plan.startNodeId,
          plan.strategy,
          JSON.stringify(plan.assumptions),
          JSON.stringify(plan.unresolvedIssues),
          JSON.stringify(plan.snapshot),
          JSON.stringify(plan),
          plan.snapshot.createdAt
        );
      this.db.prepare("DELETE FROM route_plan_edges WHERE route_plan_id = ?").run(plan.id);
      const insertEdge = this.db.prepare(
        `INSERT INTO route_plan_edges (id, route_plan_id, edge_order, edge_id, from_node_id, to_node_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const routeEdge of plan.edges) {
        insertEdge.run(createId("route_edge"), plan.id, routeEdge.order, routeEdge.edge.id, routeEdge.fromNode.id, routeEdge.toNode.id);
      }
      this.db.prepare("COMMIT").run();
    } catch (error) {
      this.db.prepare("ROLLBACK").run();
      throw error;
    }
  }

  getRoutePlan(id: string): RoutePlan | undefined {
    const row = this.db.prepare("SELECT plan_json FROM route_plans WHERE id = ?").get(id) as Row | undefined;
    return row ? (JSON.parse(String(row.plan_json)) as RoutePlan) : undefined;
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
    return {
      id: String(row.id),
      caseId: stringOrUndefined(row.case_id),
      caseName: String(row.case_name),
      deviceSerial: String(row.device_serial),
      status: row.status as TestRun["status"],
      config: JSON.parse(String(row.config_json)),
      steps: JSON.parse(String(row.case_snapshot_json)).steps ?? [],
      stepResults,
      metrics,
      events,
      artifacts,
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

  private rowToStructuredFlow(row: Row, includeSteps: boolean): StructuredFlow {
    const id = String(row.id);
    return {
      id,
      name: String(row.name),
      description: stringOrUndefined(row.description),
      appId: stringOrUndefined(row.app_id),
      appName: String(row.app_name),
      platform: row.platform as StructuredFlow["platform"],
      targetApp: JSON.parse(String(row.target_app_json ?? "{}")),
      appVersion: JSON.parse(String(row.app_version_json ?? "{}")),
      startState: JSON.parse(String(row.start_state_json ?? "{}")),
      endState: JSON.parse(String(row.end_state_json ?? "{}")),
      role: stringOrUndefined(row.role),
      startStrategy: row.start_strategy as StructuredFlow["startStrategy"],
      tags: JSON.parse(String(row.tags_json ?? "[]")),
      status: row.status as StructuredFlow["status"],
      version: Number(row.version),
      steps: includeSteps ? this.getStructuredFlowSteps(id) : [],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private getStructuredFlowSteps(flowId: string): StructuredFlowStep[] {
    const rows = this.db.prepare("SELECT * FROM structured_flow_steps WHERE flow_id = ? ORDER BY step_order ASC").all(flowId) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      order: Number(row.step_order),
      title: String(row.title),
      enabled: Boolean(row.enabled),
      beforeState: JSON.parse(String(row.before_state_json ?? "{}")),
      action: JSON.parse(String(row.action_json ?? "{}")),
      afterExpectations: JSON.parse(String(row.after_expectations_json ?? "[]")),
      systemGuards: JSON.parse(String(row.system_guards_json ?? "[]")),
      timing: JSON.parse(String(row.timing_json ?? "{}")),
      source: JSON.parse(String(row.source_json ?? "{}")),
      artifacts: JSON.parse(String(row.artifacts_json ?? "{}")),
      createdAt: String(row.created_at)
    }));
  }

  private insertStructuredFlowSteps(flowId: string, steps: StructuredFlowStep[], updatedAt: string): void {
    const insertStep = this.db.prepare(
      `INSERT INTO structured_flow_steps
        (id, flow_id, step_order, title, enabled, before_state_json, action_json, after_expectations_json, system_guards_json, timing_json, source_json, artifacts_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const step of steps) {
      insertStep.run(
        step.id,
        flowId,
        step.order,
        step.title,
        step.enabled ? 1 : 0,
        JSON.stringify(step.beforeState),
        JSON.stringify(step.action),
        JSON.stringify(step.afterExpectations),
        JSON.stringify(step.systemGuards),
        JSON.stringify(step.timing ?? {}),
        JSON.stringify(step.source ?? {}),
        JSON.stringify(step.artifacts ?? {}),
        step.createdAt,
        updatedAt
      );
    }
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
      edges: this.getOperationEdges(id),
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

  private getOperationEdges(graphVersionId: string): OperationEdge[] {
    const rows = this.db.prepare("SELECT * FROM operation_edges WHERE graph_version_id = ? ORDER BY edge_key ASC").all(graphVersionId) as Row[];
    return rows.map((row) => this.operationEdgeFromRow(row));
  }

  private operationEdgeFromRow(row: Row): OperationEdge {
    const edgeId = String(row.id);
    return {
      id: edgeId,
      graphVersionId: String(row.graph_version_id),
      fromNodeId: String(row.from_node_id),
      toNodeId: String(row.to_node_id),
      key: String(row.edge_key),
      name: String(row.name),
      intent: String(row.intent),
      status: row.status as OperationEdge["status"],
      source: row.source as OperationEdge["source"],
      preconditions: this.getEdgeExpectations("edge_preconditions", edgeId),
      actionPolicies: this.getActionPolicies(edgeId),
      expectations: this.getEdgeExpectations("edge_expectations", edgeId),
      failurePolicy: JSON.parse(String(row.failure_policy_json ?? "{}")),
      platformScope: platformScopeOrUndefined(row.platform_scope),
      reliabilityScore: numberOrUndefined(row.reliability_score)
    };
  }

  private getActionPolicies(edgeId: string): ActionPolicy[] {
    const rows = this.db.prepare("SELECT * FROM edge_action_policies WHERE edge_id = ? ORDER BY priority ASC").all(edgeId) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      priority: Number(row.priority),
      action: JSON.parse(String(row.action_json)),
      fallback: Boolean(row.fallback),
      source: JSON.parse(String(row.source_json ?? "{}")),
      reliabilityHint: reliabilityHintOrUndefined(row.reliability_hint)
    }));
  }

  private getEdgeExpectations(tableName: "edge_preconditions" | "edge_expectations", edgeId: string): OperationEdge["expectations"] {
    const rows = this.db.prepare(`SELECT expectation_json FROM ${tableName} WHERE edge_id = ? ORDER BY expectation_order ASC`).all(edgeId) as Row[];
    return rows.map((row) => JSON.parse(String(row.expectation_json)));
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

  private insertActionPolicies(edgeId: string, policies: ActionPolicy[]): void {
    const insert = this.db.prepare(
      `INSERT INTO edge_action_policies (id, edge_id, priority, action_json, fallback, source_json, reliability_hint)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const policy of policies) {
      insert.run(
        policy.id,
        edgeId,
        policy.priority,
        JSON.stringify(policy.action),
        policy.fallback ? 1 : 0,
        JSON.stringify(policy.source ?? {}),
        policy.reliabilityHint ?? null
      );
    }
  }

  private insertEdgeExpectations(tableName: "edge_preconditions" | "edge_expectations", edgeId: string, expectations: OperationEdge["expectations"]): void {
    const insert = this.db.prepare(`INSERT INTO ${tableName} (id, edge_id, expectation_order, expectation_json) VALUES (?, ?, ?, ?)`);
    for (const [index, expectation] of expectations.entries()) {
      insert.run(createId("edge_expectation"), edgeId, index + 1, JSON.stringify(expectation));
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

      CREATE TABLE IF NOT EXISTS structured_flows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        app_id TEXT,
        app_name TEXT NOT NULL,
        platform TEXT NOT NULL,
        target_app_json TEXT NOT NULL DEFAULT '{}',
        app_version_json TEXT NOT NULL DEFAULT '{}',
        start_state_json TEXT NOT NULL DEFAULT '{}',
        end_state_json TEXT NOT NULL DEFAULT '{}',
        role TEXT,
        start_strategy TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS structured_flow_steps (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL REFERENCES structured_flows(id) ON DELETE CASCADE,
        step_order INTEGER NOT NULL,
        title TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        before_state_json TEXT NOT NULL DEFAULT '{}',
        action_json TEXT NOT NULL DEFAULT '{}',
        after_expectations_json TEXT NOT NULL DEFAULT '[]',
        system_guards_json TEXT NOT NULL DEFAULT '[]',
        timing_json TEXT NOT NULL DEFAULT '{}',
        source_json TEXT NOT NULL DEFAULT '{}',
        artifacts_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(flow_id, step_order)
      );

      CREATE TABLE IF NOT EXISTS asset_parameter_profiles (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        environment TEXT,
        bindings_json TEXT NOT NULL DEFAULT '[]',
        values_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS asset_parameter_data_records (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        domain_key TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        environment TEXT,
        values_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS asset_meta_functions (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        parameters_json TEXT NOT NULL DEFAULT '[]',
        steps_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS asset_composite_cases (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        parameter_profile_id TEXT REFERENCES asset_parameter_profiles(id) ON DELETE SET NULL,
        run_mode TEXT NOT NULL DEFAULT 'once',
        repeat_count INTEGER NOT NULL DEFAULT 1,
        stop_on_failure INTEGER NOT NULL DEFAULT 1,
        steps_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
      CREATE INDEX IF NOT EXISTS idx_structured_flows_app ON structured_flows(app_id, platform, updated_at);
      CREATE INDEX IF NOT EXISTS idx_structured_flow_steps_flow_order ON structured_flow_steps(flow_id, step_order);
      CREATE INDEX IF NOT EXISTS idx_asset_parameter_profiles_app ON asset_parameter_profiles(app_id, platform, updated_at);
      CREATE INDEX IF NOT EXISTS idx_asset_parameter_data_records_app_domain ON asset_parameter_data_records(app_id, platform, domain_key, updated_at);
      CREATE INDEX IF NOT EXISTS idx_asset_meta_functions_app ON asset_meta_functions(app_id, platform, updated_at);
      CREATE INDEX IF NOT EXISTS idx_asset_composite_cases_app ON asset_composite_cases(app_id, platform, updated_at);
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

      CREATE TABLE IF NOT EXISTS operation_edges (
        id TEXT PRIMARY KEY,
        graph_version_id TEXT NOT NULL REFERENCES business_graph_versions(id) ON DELETE CASCADE,
        from_node_id TEXT NOT NULL REFERENCES business_nodes(id) ON DELETE CASCADE,
        to_node_id TEXT NOT NULL REFERENCES business_nodes(id) ON DELETE CASCADE,
        edge_key TEXT NOT NULL,
        name TEXT NOT NULL,
        intent TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        failure_policy_json TEXT NOT NULL DEFAULT '{}',
        platform_scope TEXT,
        reliability_score REAL,
        UNIQUE(graph_version_id, edge_key)
      );

      CREATE TABLE IF NOT EXISTS edge_preconditions (
        id TEXT PRIMARY KEY,
        edge_id TEXT NOT NULL REFERENCES operation_edges(id) ON DELETE CASCADE,
        expectation_order INTEGER NOT NULL,
        expectation_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edge_action_policies (
        id TEXT PRIMARY KEY,
        edge_id TEXT NOT NULL REFERENCES operation_edges(id) ON DELETE CASCADE,
        priority INTEGER NOT NULL,
        action_json TEXT NOT NULL,
        fallback INTEGER NOT NULL DEFAULT 0,
        source_json TEXT NOT NULL DEFAULT '{}',
        reliability_hint TEXT
      );

      CREATE TABLE IF NOT EXISTS edge_expectations (
        id TEXT PRIMARY KEY,
        edge_id TEXT NOT NULL REFERENCES operation_edges(id) ON DELETE CASCADE,
        expectation_order INTEGER NOT NULL,
        expectation_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS graph_asset_sources (
        id TEXT PRIMARY KEY,
        graph_version_id TEXT NOT NULL REFERENCES business_graph_versions(id) ON DELETE CASCADE,
        asset_type TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        source_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS route_plans (
        id TEXT PRIMARY KEY,
        graph_version_id TEXT NOT NULL REFERENCES business_graph_versions(id) ON DELETE CASCADE,
        app_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        start_node_id TEXT NOT NULL,
        strategy TEXT NOT NULL,
        assumptions_json TEXT NOT NULL DEFAULT '[]',
        unresolved_issues_json TEXT NOT NULL DEFAULT '[]',
        snapshot_json TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS route_plan_edges (
        id TEXT PRIMARY KEY,
        route_plan_id TEXT NOT NULL REFERENCES route_plans(id) ON DELETE CASCADE,
        edge_order INTEGER NOT NULL,
        edge_id TEXT NOT NULL,
        from_node_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_business_graphs_app ON business_graphs(app_id);
      CREATE INDEX IF NOT EXISTS idx_graph_versions_graph ON business_graph_versions(graph_id, version);
      CREATE INDEX IF NOT EXISTS idx_business_nodes_version ON business_nodes(graph_version_id, status);
      CREATE INDEX IF NOT EXISTS idx_operation_edges_version_from ON operation_edges(graph_version_id, from_node_id, status);
      CREATE INDEX IF NOT EXISTS idx_route_plans_graph_version ON route_plans(graph_version_id, created_at);
    `);
    this.migrateArtifactsTableIfNeeded();
    this.migrateStepExpectationColumnsIfNeeded();
    this.migrateBusinessGraphColumnsIfNeeded();
    this.migrateStateMatcherColumnsIfNeeded();
    this.migrateParameterProfileColumnsIfNeeded();
  }

  private migrateBusinessGraphColumnsIfNeeded(): void {
    this.addColumnIfMissing("business_graphs", "target_app_json", "TEXT NOT NULL DEFAULT '{}'");
  }

  private migrateParameterProfileColumnsIfNeeded(): void {
    this.addColumnIfMissing("asset_parameter_profiles", "bindings_json", "TEXT NOT NULL DEFAULT '[]'");
  }

  private migrateStateMatcherColumnsIfNeeded(): void {
    this.addColumnIfMissing("state_matchers", "critical", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("state_matchers", "threshold", "REAL");
    this.addColumnIfMissing("state_matchers", "region_json", "TEXT");
    this.addColumnIfMissing("state_matchers", "ignore_regions_json", "TEXT");
    this.addColumnIfMissing("state_matchers", "platform_scope", "TEXT");
    this.addColumnIfMissing("state_matchers", "source_json", "TEXT NOT NULL DEFAULT '{}'");
  }

  private migrateStepExpectationColumnsIfNeeded(): void {
    this.addColumnIfMissing("steps", "preconditions_json", "TEXT NOT NULL DEFAULT '[]'");
    this.addColumnIfMissing("steps", "expectations_json", "TEXT NOT NULL DEFAULT '[]'");
    this.addColumnIfMissing("step_results", "expectation_results_json", "TEXT NOT NULL DEFAULT '[]'");
    this.addColumnIfMissing("step_results", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
  }

  private addColumnIfMissing(tableName: string, columnName: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Row[];
    const hasColumn = columns.some((row) => row.name === columnName);
    if (!hasColumn) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  private migrateArtifactsTableIfNeeded(): void {
    const foreignKeys = this.db.prepare("PRAGMA foreign_key_list(artifacts)").all() as Row[];
    const hasStepResultForeignKey = foreignKeys.some((row) => row.table === "step_results");
    if (!hasStepResultForeignKey) {
      return;
    }

    this.db.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE artifacts RENAME TO artifacts_legacy;

      CREATE TABLE artifacts (
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

      INSERT INTO artifacts (id, run_id, step_result_id, type, name, path, url, mime_type, size_bytes, created_at, deleted_at)
      SELECT id, run_id, step_result_id, type, name, path, url, mime_type, size_bytes, created_at, deleted_at
      FROM artifacts_legacy;

      DROP TABLE artifacts_legacy;
      CREATE INDEX IF NOT EXISTS idx_artifacts_run_type ON artifacts(run_id, type);
      PRAGMA foreign_keys = ON;
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

function normalizeAiDiagnosisSettings(input: Record<string, unknown>): AiDiagnosisStoredSettings {
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

function normalizeOrderedSteps<T extends { order: number }>(steps: T[]): T[] {
  return [...steps]
    .sort((left, right) => left.order - right.order)
    .map((step, index) => ({ ...step, order: index + 1 }));
}

function appPlatformWhere(filter: { appId?: string; platform?: string }): { where: string; values: string[] } {
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
  return {
    where: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    values
  };
}

function rowToParameterProfile(row: Row): ParameterProfile {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    platform: String(row.platform) as ParameterProfile["platform"],
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    environment: row.environment ? String(row.environment) : undefined,
    bindings: JSON.parse(String(row.bindings_json ?? "[]")) as ParameterProfile["bindings"],
    values: JSON.parse(String(row.values_json ?? "{}")) as ParameterProfile["values"],
    status: String(row.status) as ParameterProfile["status"],
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToParameterDataRecord(row: Row): ParameterDataRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    platform: String(row.platform) as ParameterDataRecord["platform"],
    domainKey: String(row.domain_key),
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    environment: row.environment ? String(row.environment) : undefined,
    values: JSON.parse(String(row.values_json ?? "{}")) as ParameterDataRecord["values"],
    status: String(row.status) as ParameterDataRecord["status"],
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToMetaFunction(row: Row): MetaFunction {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    platform: String(row.platform) as MetaFunction["platform"],
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    parameters: JSON.parse(String(row.parameters_json ?? "[]")) as MetaFunction["parameters"],
    steps: JSON.parse(String(row.steps_json ?? "[]")) as MetaFunction["steps"],
    status: String(row.status) as MetaFunction["status"],
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToAssetCompositeCase(row: Row): AssetCompositeCase {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    platform: String(row.platform) as AssetCompositeCase["platform"],
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    parameterProfileId: row.parameter_profile_id ? String(row.parameter_profile_id) : undefined,
    runMode: String(row.run_mode) as AssetCompositeCase["runMode"],
    repeatCount: Number(row.repeat_count),
    stopOnFailure: Number(row.stop_on_failure) === 1,
    steps: JSON.parse(String(row.steps_json ?? "[]")) as AssetCompositeCase["steps"],
    status: String(row.status) as AssetCompositeCase["status"],
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
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

function reliabilityHintOrUndefined(value: unknown): ActionPolicy["reliabilityHint"] | undefined {
  return value === "high" || value === "medium" || value === "low" ? value : undefined;
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

function candidateNodeToInput(graphVersionId: string, candidate: CandidateNode): CreateBusinessNodeInput {
  return {
    id: createId("node"),
    graphVersionId,
    key: candidate.key,
    name: candidate.name,
    nodeType: candidate.nodeType,
    status: "draft",
    tags: ["source_scan"],
    matchers: candidate.matchers.map((matcher) => ({
      ...matcher,
      id: createId("matcher")
    })),
    defaultExpectations: [],
    platformScope: candidate.platformScope,
    metadata: {
      ...candidate.metadata,
      candidateId: candidate.id,
      candidateKey: candidate.key,
      confidence: candidate.confidence,
      source: candidate.source
    }
  };
}

function candidateEdgeToInput(graphVersionId: string, candidate: CandidateEdge, fromNodeId: string, toNodeId: string): CreateOperationEdgeInput {
  return {
    id: createId("edge"),
    graphVersionId,
    fromNodeId,
    toNodeId,
    key: candidate.key,
    name: candidate.name,
    intent: candidate.intent,
    status: "draft",
    source: "source_scan",
    actionPolicies: candidate.actionPolicies.map((policy) => ({
      ...policy,
      id: createId("action_policy")
    })),
    preconditions: [],
    expectations: [],
    platformScope: candidate.platformScope,
    reliabilityScore: candidate.confidence,
    failurePolicy: {
      recoverTo: "replan"
    }
  };
}

function normalizeStructuredFlowSteps(steps: StructuredFlowStep[]): StructuredFlowStep[] {
  return steps.map((step, index) => ({
    ...step,
    order: index + 1,
    action: {
      ...step.action,
      order: index + 1
    }
  }));
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
