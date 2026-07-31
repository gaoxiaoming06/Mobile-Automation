import { readFile } from "node:fs/promises";
import type { LearningAggregate, LearningCandidate } from "@mobile-automation/shared";
import { artifactFilePath } from "./artifacts.js";
import {
  ASSET_LEARNING_DEVELOPER_INSTRUCTIONS,
  buildAssetLearningPrompt,
  parseAssetLearningResponse,
  type AssetLearningAnalysis,
  type AssetLearningSample
} from "./asset-learning-ai.js";
import { runAiJsonRequest } from "./ai-client.js";
import type { AiModelConfig } from "./ai-model-settings.js";
import {
  AutomaticAssetLearningService,
  type AutomaticAssetLearningRepository,
  type LearningAggregateUpdate
} from "./automatic-asset-learning.js";
import type { OcrService } from "./ocr.js";
import type { Storage } from "./storage.js";

const MAX_ANALYSIS_SAMPLES = 5;

export function createAutomaticAssetLearningService(input: {
  storage: Storage;
  ocr: OcrService;
  getAiConfig: () => AiModelConfig;
  env?: NodeJS.ProcessEnv;
}): AutomaticAssetLearningService {
  const repository = new StorageAutomaticAssetLearningRepository(input.storage);
  return new AutomaticAssetLearningService({
    repository,
    canAnalyze: () => input.getAiConfig().enabled,
    analyze: (aggregate) => analyzeLearningAggregate({
      aggregate,
      storage: input.storage,
      ocr: input.ocr,
      config: input.getAiConfig()
    }),
    config: readAutomaticAssetLearningConfig(input.env)
  });
}

export class StorageAutomaticAssetLearningRepository implements AutomaticAssetLearningRepository {
  constructor(private readonly storage: Storage) {}

  async listPending(): Promise<LearningAggregate[]> {
    return [
      ...this.storage.listLearningAggregates({ status: "ready" }),
      ...this.storage.listLearningAggregates({ status: "awaiting_ai" })
    ];
  }

  async getCandidate(id: string): Promise<LearningCandidate | undefined> {
    return this.storage.getLearningCandidate(id);
  }

  async update(id: string, update: LearningAggregateUpdate): Promise<void> {
    this.storage.updateLearningAggregate({
      id,
      status: update.status,
      ...(update.analysis ? { analysis: update.analysis as unknown as Record<string, unknown> } : {}),
      ...(update.assetId ? { assetId: update.assetId } : {}),
      ...(update.lastError ? { lastError: update.lastError } : {})
    });
  }

  async promote(aggregate: LearningAggregate, analysis?: AssetLearningAnalysis): Promise<void> {
    this.storage.promoteLearningAggregate(
      aggregate.id,
      analysis as unknown as Record<string, unknown> | undefined
    );
  }
}

export async function analyzeLearningAggregate(input: {
  aggregate: LearningAggregate;
  storage: Pick<Storage, "getLearningCandidate" | "listLearningObservations" | "getArtifact">;
  ocr: OcrService;
  config: AiModelConfig;
}): Promise<AssetLearningAnalysis> {
  if (!input.config.enabled) throw new Error(`AI asset learning is disabled: ${input.config.reason}`);
  const candidate = input.storage.getLearningCandidate(input.aggregate.representativeCandidateId);
  if (!candidate) throw new Error(`Learning candidate not found: ${input.aggregate.representativeCandidateId}`);
  const observations = input.storage.listLearningObservations(input.aggregate.id).slice(-MAX_ANALYSIS_SAMPLES);
  const samples: AssetLearningSample[] = [];
  for (const observation of observations) {
    const artifact = observation.evidenceArtifactIds
      .map((id) => input.storage.getArtifact(id))
      .find((item) => item?.type === "screenshot");
    if (!artifact) continue;
    const image = await readFile(artifactFilePath(artifact.path)).catch(() => undefined);
    if (!image) continue;
    const recognized = await input.ocr.recognize({ image });
    samples.push({
      runId: observation.runId,
      artifactId: artifact.id,
      ocrTexts: uniqueOcrLines(recognized.text)
    });
  }
  if (samples.length < 2) {
    throw new Error("Not enough readable screenshot samples for AI asset learning");
  }
  const latestArtifact = input.storage.getArtifact(samples.at(-1)!.artifactId);
  const latestImage = latestArtifact
    ? await readFile(artifactFilePath(latestArtifact.path)).catch(() => undefined)
    : undefined;
  const result = await runAiJsonRequest(input.config, {
    developerInstructions: ASSET_LEARNING_DEVELOPER_INSTRUCTIONS,
    userContent: buildAssetLearningPrompt({
      kind: input.aggregate.kind,
      stableKey: input.aggregate.stableKey,
      payload: candidate.payload,
      samples
    }),
    ...(latestImage ? { imagePngBase64: latestImage.toString("base64") } : {}),
    effort: "low"
  });
  return parseAssetLearningResponse(result.content, { kind: input.aggregate.kind, samples });
}

function readAutomaticAssetLearningConfig(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  intervalMs: number;
} {
  const interval = Number(env.ASSET_LEARNING_INTERVAL_MS ?? 5_000);
  return {
    enabled: env.ASSET_LEARNING_ENABLED !== "0",
    intervalMs: Number.isFinite(interval) && interval >= 1_000 ? interval : 5_000
  };
}

function uniqueOcrLines(value: string): string[] {
  return [...new Set(value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean))]
    .slice(0, 160);
}
