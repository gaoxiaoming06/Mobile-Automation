export type DevicePlatform = "android" | "ios" | "harmony";
export type ScriptPlatform = DevicePlatform | "flutter" | "mobile";

export type ScriptFlowAuthoringContract = {
  version: 1;
  scriptPlatforms: ScriptPlatform[];
  devicePlatforms: DevicePlatform[];
  actions: string[];
  targetTypes: Array<"text" | "icon" | "visual" | "control">;
  unsupportedTargets: string[];
  executionContract: string[];
  examples: Array<{ title: string; yaml: string }>;
};

export function scriptFlowAuthoringContract(): ScriptFlowAuthoringContract {
  return {
    version: 1,
    scriptPlatforms: ["android", "ios", "harmony", "flutter", "mobile"],
    devicePlatforms: ["android", "ios", "harmony"],
    actions: [
      "launchApp",
      "tap",
      "inputText",
      "clearText",
      "selectText",
      "swipe",
      "scrollUntilVisible",
      "reachPage",
      "waitForPage",
      "assertPage",
      "assertText",
      "runFlow",
      "repeat",
      "when"
    ],
    targetTypes: ["text", "icon", "visual", "control"],
    unsupportedTargets: ["semantic", "coordinate", "resourceId", "accessibilityId", "platformPrivateSelector"],
    executionContract: [
      "ScriptFlow YAML 只写 app.id，不写 app.platform。",
      "生成和列表使用 scriptPlatform；真实执行使用 devicePlatform。",
      "AI 输出必须经过 ScriptFlow v1 schema 校验。",
      "执行前必须 preview 并使用 planDigest。",
      "图标或图片目标必须使用 icon 或 visual，不能退化为 OCR 文本。",
      "MCP 不接受坐标和平台私有元素标识作为目标身份。"
    ],
    examples: [
      {
        title: "点击可见文字",
        yaml: "steps:\n  - id: open-growth\n    role: business\n    tap:\n      target: { text: 成长, area: bottomBar, match: exact }\n      search: { mode: visibleOnly }"
      },
      {
        title: "点击视觉图标",
        yaml: "steps:\n  - id: open-sort\n    role: business\n    tap:\n      target:\n        visual: { kind: icon, query: 排序图标 }\n      search: { mode: visibleOnly }"
      }
    ]
  };
}

export function isDevicePlatform(value: unknown): value is DevicePlatform {
  return value === "android" || value === "ios" || value === "harmony";
}

export function isScriptPlatform(value: unknown): value is ScriptPlatform {
  return isDevicePlatform(value) || value === "flutter" || value === "mobile";
}
