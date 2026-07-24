import type { BusinessGraphVersion } from "@mobile-automation/graph-core";
import type { AssetCompositeCase, MetaFunction, ParameterDataRecord, ParameterProfile, Platform } from "@mobile-automation/shared";
import {
  resolveFreeComposition,
  type FreeCompositionPageAbilityAsset,
  type FreeCompositionPageAsset,
  type FreeCompositionPageTaskAsset,
  type FreeCompositionPageTransitionAsset,
  type ResolveFreeCompositionInput
} from "./free-composition.js";
import {
  createFreeCompositionSession,
  markFreeCompositionSessionExecutionStarted,
  previewFreeCompositionSession,
  selectFreeCompositionCandidate,
  syncFreeCompositionSessionExecution,
  type FreeCompositionSession
} from "./free-composition-session.js";
import type { AssetCompositeExecution } from "./asset-composite-execution.js";
import type { AssetCompositeExecutionPlan } from "./asset-composition.js";

type Clock = () => string;

export class FreeCompositionSessionRegistry {
  private readonly sessions = new Map<string, FreeCompositionSession>();

  constructor(private readonly now: Clock = () => new Date().toISOString()) {}

  create(input: {
    appId: string;
    platform: Platform;
    prompt: string;
    metaFunctions: MetaFunction[];
    compositeCases: AssetCompositeCase[];
    pageTasks?: FreeCompositionPageTaskAsset[];
    pageTransitions?: FreeCompositionPageTransitionAsset[];
    pageAssets?: FreeCompositionPageAsset[];
    pageAbilities?: FreeCompositionPageAbilityAsset[];
    currentPageDetectionAttempted?: ResolveFreeCompositionInput["currentPageDetectionAttempted"];
    currentPage?: ResolveFreeCompositionInput["currentPage"];
    currentPageDetectionFailure?: ResolveFreeCompositionInput["currentPageDetectionFailure"];
  }): FreeCompositionSession {
    const resolution = resolveFreeComposition(input.prompt, {
      appId: input.appId,
      platform: input.platform,
      metaFunctions: input.metaFunctions,
      compositeCases: input.compositeCases,
      pageTasks: input.pageTasks,
      pageTransitions: input.pageTransitions,
      pageAssets: input.pageAssets,
      pageAbilities: input.pageAbilities,
      currentPageDetectionAttempted: input.currentPageDetectionAttempted,
      currentPage: input.currentPage,
      currentPageDetectionFailure: input.currentPageDetectionFailure
    });
    return this.save(createFreeCompositionSession({
      appId: input.appId,
      platform: input.platform,
      prompt: input.prompt,
      resolution,
      now: this.now()
    }));
  }

  get(id: string): FreeCompositionSession | undefined {
    return this.sessions.get(id);
  }

  list(filter: { appId?: string; platform?: Platform } = {}): FreeCompositionSession[] {
    return [...this.sessions.values()]
      .filter((session) => !filter.appId || session.appId === filter.appId)
      .filter((session) => !filter.platform || session.platform === filter.platform)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  selectAndPreview(input: {
    sessionId: string;
    candidateId: string;
    parameterProfileId?: string;
    metaFunctions: MetaFunction[];
    compositeCases: AssetCompositeCase[];
    parameterProfile?: ParameterProfile;
    parameterDataRecords?: ParameterDataRecord[];
    graphVersion: BusinessGraphVersion;
    runtimeOverrides?: Record<string, string | number | boolean>;
  }): { session: FreeCompositionSession; plan: AssetCompositeExecutionPlan } {
    const session = this.requireSession(input.sessionId);
    const selected = selectFreeCompositionCandidate({
      session,
      candidateId: input.candidateId,
      parameterProfileId: input.parameterProfileId,
      metaFunctions: input.metaFunctions,
      compositeCases: input.compositeCases,
      now: this.now()
    });
    const preview = previewFreeCompositionSession({
      session: selected,
      metaFunctions: input.metaFunctions,
      parameterProfile: input.parameterProfile,
      parameterDataRecords: input.parameterDataRecords ?? [],
      graphVersion: input.graphVersion,
      runtimeOverrides: input.runtimeOverrides,
      now: this.now()
    });
    return {
      plan: preview.plan,
      session: this.save(preview.session)
    };
  }

  markExecutionStarted(sessionId: string, executionId: string, input: { riskConfirmed?: boolean } = {}): FreeCompositionSession {
    return this.save(markFreeCompositionSessionExecutionStarted(this.requireSession(sessionId), {
      executionId,
      riskConfirmed: input.riskConfirmed,
      now: this.now()
    }));
  }

  syncExecution(sessionId: string, execution: AssetCompositeExecution | undefined): FreeCompositionSession {
    return this.save(syncFreeCompositionSessionExecution(this.requireSession(sessionId), execution, {
      now: this.now()
    }));
  }

  private requireSession(id: string): FreeCompositionSession {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error("AI资产用例会话不存在。");
    }
    return session;
  }

  private save(session: FreeCompositionSession): FreeCompositionSession {
    this.sessions.set(session.id, session);
    return session;
  }
}
