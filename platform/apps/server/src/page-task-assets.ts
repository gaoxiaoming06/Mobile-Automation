import type { BusinessNode } from "@mobile-automation/graph-core";
import { nowIso } from "@mobile-automation/shared";

export type PageTaskFieldType = "text_input" | "picker_select" | "toggle_set" | "subpage_edit" | "submit" | "tap" | "wait";

export type PageTaskAssetStep = {
  id?: string;
  order: number;
  elementId?: string;
  fieldType: PageTaskFieldType;
  label?: string;
  valueParamKey?: string;
  desiredStateParamKey?: string;
  text?: string;
};

export type PageTaskAsset = {
  id: string;
  name: string;
  status: "active" | "draft" | "deprecated";
  steps: PageTaskAssetStep[];
  createdAt: string;
  updatedAt: string;
};

export type PageTaskAssetStorage = {
  findBusinessNodeById(graphVersionId: string, nodeId: string): BusinessNode | undefined;
  updateBusinessNodeDetails(
    nodeId: string,
    input: {
      metadata?: Record<string, unknown>;
    }
  ): BusinessNode | undefined;
};

export type PersistPageTaskAssetInput = {
  graphVersionId: string;
  storage: PageTaskAssetStorage;
  sourceNodeId: string;
  taskId?: string;
  name: string;
  status?: "active" | "draft" | "deprecated";
  steps: PageTaskAssetStep[];
};

export type PersistPageTaskAssetResult = {
  status: "saved" | "skipped";
  task?: PageTaskAsset;
  reason?: string;
};

export type DeletePageTaskAssetInput = {
  graphVersionId: string;
  storage: PageTaskAssetStorage;
  sourceNodeId: string;
  taskId: string;
};

export type DeletePageTaskAssetResult = {
  status: "deleted" | "skipped";
  reason?: string;
};

export function persistPageTaskAsset(input: PersistPageTaskAssetInput): PersistPageTaskAssetResult {
  const sourceNode = input.storage.findBusinessNodeById(input.graphVersionId, input.sourceNodeId);
  if (!isConfirmedPageAsset(sourceNode)) {
    return { status: "skipped", reason: "source_page_asset_missing" };
  }
  const name = input.name.trim();
  if (!name) {
    return { status: "skipped", reason: "task_name_missing" };
  }
  const steps = normalizeTaskSteps(input.steps);
  if (!steps.length) {
    return { status: "skipped", reason: "task_steps_missing" };
  }
  const now = nowIso();
  const existingTasks = readPageTasks(sourceNode.metadata?.assetRecordingPageTasks);
  const existing = input.taskId ? existingTasks.find((task) => task.id === input.taskId) : undefined;
  const task: PageTaskAsset = {
    id: existing?.id ?? input.taskId ?? `page_task_${slug(name).slice(0, 64) || "task"}`,
    name,
    status: input.status ?? existing?.status ?? "active",
    steps,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  const nextTasks = [...existingTasks.filter((item) => item.id !== task.id), task];
  input.storage.updateBusinessNodeDetails(sourceNode.id, {
    metadata: {
      ...(sourceNode.metadata ?? {}),
      assetRecordingPageTasks: nextTasks,
      updatedAt: now
    }
  });
  return { status: "saved", task };
}

export function deletePageTaskAsset(input: DeletePageTaskAssetInput): DeletePageTaskAssetResult {
  const sourceNode = input.storage.findBusinessNodeById(input.graphVersionId, input.sourceNodeId);
  if (!isConfirmedPageAsset(sourceNode)) {
    return { status: "skipped", reason: "source_page_asset_missing" };
  }
  const existingTasks = readPageTasks(sourceNode.metadata?.assetRecordingPageTasks);
  const nextTasks = existingTasks.filter((task) => task.id !== input.taskId);
  if (nextTasks.length === existingTasks.length) {
    return { status: "skipped", reason: "task_not_found" };
  }
  input.storage.updateBusinessNodeDetails(sourceNode.id, {
    metadata: {
      ...(sourceNode.metadata ?? {}),
      assetRecordingPageTasks: nextTasks,
      updatedAt: nowIso()
    }
  });
  return { status: "deleted" };
}

function normalizeTaskSteps(steps: PageTaskAssetStep[]): PageTaskAssetStep[] {
  return steps
    .map((step, index) => ({
      id: step.id?.trim() || undefined,
      order: Math.max(1, Math.floor(step.order || index + 1)),
      elementId: step.elementId?.trim() || undefined,
      fieldType: readFieldType(step.fieldType),
      label: step.label?.trim() || undefined,
      valueParamKey: step.valueParamKey?.trim() || undefined,
      desiredStateParamKey: step.desiredStateParamKey?.trim() || undefined,
      text: step.text?.trim() || undefined
    }))
    .filter((step) => step.fieldType === "wait" || Boolean(step.elementId))
    .sort((left, right) => left.order - right.order)
    .map((step, index) => ({
      ...step,
      id: step.id ?? `task_step_${index + 1}`,
      order: index + 1
    }));
}

function readFieldType(value: unknown): PageTaskFieldType {
  return value === "text_input" ||
    value === "picker_select" ||
    value === "toggle_set" ||
    value === "subpage_edit" ||
    value === "submit" ||
    value === "tap" ||
    value === "wait"
    ? value
    : "tap";
}

function readPageTasks(value: unknown): PageTaskAsset[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is PageTaskAsset => Boolean(item) && typeof item === "object" && typeof (item as PageTaskAsset).id === "string");
}

function isConfirmedPageAsset(node: BusinessNode | undefined): node is BusinessNode {
  if (!node || node.status === "deprecated") {
    return false;
  }
  return Boolean(node.metadata?.assetRecordingConfirmed) || node.tags.includes("page-asset") || node.tags.includes("asset-recording");
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, ".")
    .replace(/^\.+|\.+$/g, "") || "unknown";
}
