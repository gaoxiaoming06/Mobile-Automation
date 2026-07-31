import type {
  LearningAggregate,
  LearningAggregateStatus,
  LearningCandidate
} from "@mobile-automation/shared";
import type { AssetLearningAnalysis } from "./asset-learning-ai.js";
import { nextAggregateStatusAfterAi } from "./learning-lifecycle.js";

export type LearningAggregateUpdate = {
  status: LearningAggregateStatus;
  analysis?: AssetLearningAnalysis;
  assetId?: string;
  lastError?: string;
};

export interface AutomaticAssetLearningRepository {
  listPending(): Promise<LearningAggregate[]>;
  getCandidate(id: string): Promise<LearningCandidate | undefined>;
  update(id: string, update: LearningAggregateUpdate): Promise<void>;
  promote(aggregate: LearningAggregate, analysis?: AssetLearningAnalysis): Promise<void>;
}

export type AutomaticAssetLearningConfig = {
  enabled: boolean;
  intervalMs: number;
};

const DEFAULT_CONFIG: AutomaticAssetLearningConfig = {
  enabled: true,
  intervalMs: 5_000
};

export class AutomaticAssetLearningService {
  private running = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: {
    repository: AutomaticAssetLearningRepository;
    analyze?: (aggregate: LearningAggregate) => Promise<AssetLearningAnalysis>;
    canAnalyze?: () => boolean;
    config?: Partial<AutomaticAssetLearningConfig>;
  }) {}

  start(): void {
    const config = this.config();
    if (!config.enabled) return;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), config.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  schedule(): void {
    void this.runOnce();
  }

  async runOnce(): Promise<void> {
    if (this.running || !this.config().enabled) return;
    this.running = true;
    try {
      const aggregates = await this.deps.repository.listPending();
      for (const aggregate of aggregates) {
        await this.processAggregate(aggregate);
      }
    } catch (error) {
      console.warn("Automatic asset learning pass failed", error);
    } finally {
      this.running = false;
    }
  }

  private async processAggregate(aggregate: LearningAggregate): Promise<void> {
    if (aggregate.status === "ready" && !aggregate.analysisRequired) {
      await this.promoteSafely(aggregate);
      return;
    }
    if (
      aggregate.status !== "awaiting_ai"
      || !this.deps.analyze
      || this.deps.canAnalyze?.() === false
    ) return;
    try {
      const analysis = await this.deps.analyze(aggregate);
      const next = nextAggregateStatusAfterAi(analysis.decision);
      await this.deps.repository.update(aggregate.id, { status: next.status, analysis });
      if (next.status === "ready") {
        await this.promoteSafely(aggregate, analysis);
      }
    } catch (error) {
      await this.deps.repository.update(aggregate.id, {
        status: "analysis_failed",
        lastError: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async promoteSafely(aggregate: LearningAggregate, analysis?: AssetLearningAnalysis): Promise<void> {
    try {
      await this.deps.repository.promote(aggregate, analysis);
    } catch (error) {
      await this.deps.repository.update(aggregate.id, {
        status: "analysis_failed",
        lastError: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private config(): AutomaticAssetLearningConfig {
    return { ...DEFAULT_CONFIG, ...this.deps.config };
  }
}
