import type { DeviceActionRequest, Platform } from "@mobile-automation/shared";

export type ScrcpyPreviewMode = "scrcpy" | "scrcpy_connecting" | "screenshot";

export type ScrcpyControlMessage = {
  type: "control";
  action: DeviceActionRequest;
  videoWidth: number;
  videoHeight: number;
  leaseId?: string;
  ownerId?: string;
};

const scrcpyDirectActionTypes = new Set<DeviceActionRequest["type"]>(["tap", "long_press", "swipe", "back", "home", "recent_apps"]);

export function buildScrcpyControlMessage(options: {
  action: DeviceActionRequest;
  platform?: Platform;
  previewMode: ScrcpyPreviewMode;
  socketOpen: boolean;
  videoSize: { width: number; height: number };
  controlLease?: { id: string; ownerId: string };
}): ScrcpyControlMessage | null {
  if (
    options.platform !== "android" ||
    options.previewMode !== "scrcpy" ||
    !options.socketOpen ||
    !canUseScrcpyDirectAction(options.action)
  ) {
    return null;
  }

  return {
    type: "control",
    action: options.action,
    videoWidth: sanitizeSize(options.videoSize.width),
    videoHeight: sanitizeSize(options.videoSize.height),
    ...(options.controlLease ? { leaseId: options.controlLease.id, ownerId: options.controlLease.ownerId } : {})
  };
}

function canUseScrcpyDirectAction(action: DeviceActionRequest): boolean {
  if (scrcpyDirectActionTypes.has(action.type)) {
    return true;
  }
  if (action.type === "input_text") {
    return canUseScrcpyTextInjection(action.text);
  }
  return false;
}

function canUseScrcpyTextInjection(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text);
}

function sanitizeSize(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 1;
}
