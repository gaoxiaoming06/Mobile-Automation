# ClassIn 鸿蒙设备执行 MVP 实现方案

> **对于智能体：** 必需子技能：使用 superpowers:subagent-driven-development (推荐) 或 superpowers:executing-plans 来逐个任务执行此方案。步骤使用复选框 (`- [ ]`) 语法进行进度追踪。

**目标：** 在不重做脚本生成、资产生成、用例管理链路的前提下，让 `app.id = "classin"` 的现有脚本能够连接鸿蒙设备，并按脚本执行点击、滑动、输入、返回、启动应用、截图和页面等待。

**架构：** 保持 ClassIn 作为产品级目标 App，脚本、资产、用例、页面状态继续挂在 `classin` 下面；执行到具体设备时，通过运行时身份解析把 `classin` 转成 Android 包名、iOS bundleId 或鸿蒙 bundleId。新增 `@mobile-automation/harmony-driver` 使用 `hdc`、`uitest`、`aa`、`bm`、`hilog` 适配鸿蒙设备能力，并在 `MobileDriver` 中按 `device.platform` 分发。

**技术栈：** TypeScript、pnpm workspace、Vitest、Node `child_process`、OpenHarmony `hdc`、OpenHarmony UITest CLI、OpenHarmony `aa`/`bm`/`hilog`。

---

## 设计结论

这次改动聚焦执行层，不改脚本生成主链路。

业务模型：

```ts
const targetApp = "classin";

const runtimeAppIdentity = {
  android: { packageName: "cn.eeo.classin" },
  ios: { bundleId: process.env.CLASSIN_IOS_BUNDLE_ID },
  harmony: {
    bundleId: process.env.CLASSIN_HARMONY_BUNDLE_ID,
    abilityName: process.env.CLASSIN_HARMONY_ABILITY_NAME
  }
};
```

原则：

- 脚本、资产、用例、页面状态继续以 `classin` 为产品级 appId。
- Android 的 `cn.eeo.classin`、iOS bundleId、鸿蒙 bundleId 只在运行时解析。
- `waitForPage` / `assertPage` 继续依赖截图、OCR、视觉/文本 matcher；鸿蒙不需要提供 Android `uiautomator` XML 才能执行这些步骤。
- 现有 `DeviceActionRequest` 的 `launch_app` / `close_app` 参数名仍叫 `packageName`，iOS driver 已把它当 bundleId 使用；MVP 不做全仓重命名，先在执行入口把 `classin` 解析成当前平台 runtime id，再放入这个字段。
- Android 专属能力保持 Android-only：scrcpy、uiautomator 元素快照、Android App Monitor、稳定性探索、logcat 事件解析。

官方命令依据：

- `hdc list targets` 用于发现设备，`hdc file recv` 用于从设备取回截图文件。
- `uitest screenCap` 用于截图，`uitest dumpLayout` 可作为后续控件树能力，不纳入本 MVP。
- `uitest uiInput` 支持 click、longClick、swipe、text、keyEvent 等输入动作。
- `aa start -a <abilityName> -b <bundleName>` 启动 ability，`aa force-stop <bundleName>` 停止进程。
- `bm clean -d -n <bundleName>` 清理应用数据目录。

## 文件结构

新增文件：

- `platform/packages/harmony-driver/package.json`：鸿蒙 driver 包定义。
- `platform/packages/harmony-driver/tsconfig.json`：鸿蒙 driver TypeScript 配置。
- `platform/packages/harmony-driver/src/hdc.ts`：封装 `hdc` 命令执行、超时、stdout/stderr 错误。
- `platform/packages/harmony-driver/src/harmony-actions.ts`：把通用 `DeviceActionRequest` 转成 `uitest` / `aa` / `bm` 命令。
- `platform/packages/harmony-driver/src/harmony-discovery.ts`：解析 `hdc list targets`，生成 `DeviceInfo`。
- `platform/packages/harmony-driver/src/harmony-parsers.ts`：解析前台 bundle、设备列表、版本信息。
- `platform/packages/harmony-driver/src/index.ts`：导出 `HarmonyDriver`。
- `platform/packages/harmony-driver/src/harmony-actions.test.ts`：动作命令映射测试。
- `platform/packages/harmony-driver/src/harmony-discovery.test.ts`：设备发现解析测试。
- `platform/apps/server/src/target-app-runtime.ts`：ClassIn 产品 appId 与平台 runtime id 的解析器。
- `platform/apps/server/src/target-app-runtime.test.ts`：runtime app identity 解析测试。

修改文件：

- `platform/packages/shared/src/index.ts`：`Platform` 增加 `harmony`，增加鸿蒙能力默认值，`DriverChannel` 增加 `hdc_input`。
- `platform/packages/shared/src/index.test.ts`：覆盖鸿蒙能力默认值。
- `platform/packages/graph-core/src/index.ts`：让 `Observation.platform`、`PlatformScope` 通过 shared `Platform` 自动包含鸿蒙。
- `platform/apps/server/src/mobile-driver.ts`：引入 `HarmonyDriver`，把二选一分发改成 switch 分发。
- `platform/apps/server/src/mobile-driver.test.ts`：覆盖鸿蒙分发不会落到 Android。
- `platform/apps/server/src/script-flow-runner.ts`：平台校验支持鸿蒙，启动 App 时把 `classin` 解析为 runtime id。
- `platform/apps/server/src/script-flow-runner.test.ts`：覆盖鸿蒙脚本、`flutter` 脚本和 ClassIn runtime id。
- `platform/apps/server/src/observation-service.ts`：前台 App 快照增加 `bundleId`，保留 Android UI tree 只在 Android 收集。
- `platform/apps/server/src/observation-service.test.ts`：覆盖鸿蒙截图/OCR 观测。
- `platform/apps/server/src/page-state-service.ts`：页面匹配前的 outside-app 判断改成 runtime identity 判断。
- `platform/apps/server/src/page-state-service.test.ts`：覆盖鸿蒙 bundleId 与 `classin` 的匹配。
- `platform/apps/dashboard/src/components/PreviewPanel.tsx`：平台显示增加 HarmonyOS。
- `platform/apps/dashboard/src/components/PageAssetsPanel.tsx`：资产平台显示增加 HarmonyOS。
- `platform/apps/dashboard/src/components/AssetRecordingPanel.tsx`：录制初始化平台类型增加 harmony。
- `platform/apps/dashboard/src/components/RuntimeInterceptorPanel.tsx`：平台 scope 类型增加 harmony。
- `platform/apps/dashboard/src/hooks/useDeviceList.ts`：设备选择逻辑允许 HarmonyOS 设备自然出现。
- `platform/apps/dashboard/src/*.test.ts`：补充 UI 平台文案和选择逻辑测试。

## 任务 1: shared 与 graph-core 支持 harmony 平台

**文件：**

- 修改：`platform/packages/shared/src/index.ts`
- 修改：`platform/packages/shared/src/index.test.ts`
- 修改：`platform/packages/graph-core/src/index.ts`

- [ ] **步骤 1: 编写 shared 失败测试**

在 `platform/packages/shared/src/index.test.ts` 增加：

```ts
import { defaultHarmonyCapabilities } from "./index.js";

describe("platform capabilities", () => {
  it("describes HarmonyOS MVP execution capabilities", () => {
    expect(defaultHarmonyCapabilities()).toMatchObject({
      preview: true,
      tap: true,
      longPress: true,
      swipe: true,
      back: true,
      home: true,
      recentApps: false,
      textInput: true,
      screenshot: true,
      launchApp: true,
      closeApp: true,
      recordVideo: false,
      metrics: {
        cpu: false,
        memory: false,
        fps: false,
        network: false,
        battery: false,
        temperature: false
      },
      events: {
        crash: false,
        anr: false,
        logs: true
      }
    });
  });
});
```

- [ ] **步骤 2: 运行测试验证失败**

运行：

```bash
pnpm --filter @mobile-automation/shared typecheck
pnpm vitest run platform/packages/shared/src/index.test.ts
```

预期：`defaultHarmonyCapabilities` 还不存在，测试失败。

- [ ] **步骤 3: 修改 shared 类型与能力默认值**

在 `platform/packages/shared/src/index.ts` 修改：

```ts
export type Platform = "android" | "ios" | "harmony";
```

在 `defaultIosCapabilities()` 附近增加：

```ts
export function defaultHarmonyCapabilities(): DeviceCapabilities {
  return {
    preview: true,
    tap: true,
    longPress: true,
    swipe: true,
    back: true,
    home: true,
    recentApps: false,
    textInput: true,
    screenshot: true,
    launchApp: true,
    closeApp: true,
    recordVideo: false,
    metrics: {
      cpu: false,
      memory: false,
      fps: false,
      network: false,
      battery: false,
      temperature: false
    },
    events: {
      crash: false,
      anr: false,
      logs: true
    }
  };
}
```

把 `RuntimeFlow.targetApp` 扩展为：

```ts
targetApp?: {
  androidPackageName?: string;
  iosBundleId?: string;
  harmonyBundleId?: string;
};
```

把 `DriverChannel` 扩展为：

```ts
export type DriverChannel =
  | "adb_input"
  | "uiautomator2"
  | "appium"
  | "scrcpy_control"
  | "hdc_input"
  | "mock";
```

- [ ] **步骤 4: 确认 graph-core 类型自然包含 harmony**

`platform/packages/graph-core/src/index.ts` 已经通过 shared `Platform` 定义：

```ts
export type PlatformScope = Platform | "mobile-both";
```

此文件不需要手写 `"harmony"`，只需要确认 `GraphTargetProfilePlatform` 没有重复语义。保留当前定义：

```ts
export type GraphTargetProfilePlatform = Platform | "harmony" | "flutter";
```

TypeScript 会把重复的 `"harmony"` 合并，不影响运行。

- [ ] **步骤 5: 运行验证**

运行：

```bash
pnpm --filter @mobile-automation/shared typecheck
pnpm --filter @mobile-automation/graph-core typecheck
pnpm vitest run platform/packages/shared/src/index.test.ts
```

预期：全部通过。

- [ ] **步骤 6: 提交代码**

```bash
git add platform/packages/shared/src/index.ts platform/packages/shared/src/index.test.ts platform/packages/graph-core/src/index.ts
git commit -m "feat: add harmony platform primitives"
```

## 任务 2: 增加 ClassIn runtime app identity 解析器

**文件：**

- 创建：`platform/apps/server/src/target-app-runtime.ts`
- 创建：`platform/apps/server/src/target-app-runtime.test.ts`

- [ ] **步骤 1: 编写失败测试**

创建 `platform/apps/server/src/target-app-runtime.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  appIdentifierFromObservation,
  isObservationInsideTargetApp,
  resolveRuntimeAppIdentifier
} from "./target-app-runtime.js";

describe("target app runtime identity", () => {
  it("maps ClassIn to the Android package by default", () => {
    expect(resolveRuntimeAppIdentifier({
      appId: "classin",
      platform: "android",
      env: {}
    })).toBe("cn.eeo.classin");
  });

  it("maps ClassIn to configured iOS bundleId", () => {
    expect(resolveRuntimeAppIdentifier({
      appId: "classin",
      platform: "ios",
      env: { CLASSIN_IOS_BUNDLE_ID: "com.eeo.classin.ios" }
    })).toBe("com.eeo.classin.ios");
  });

  it("maps ClassIn to configured HarmonyOS bundleId", () => {
    expect(resolveRuntimeAppIdentifier({
      appId: "classin",
      platform: "harmony",
      env: { CLASSIN_HARMONY_BUNDLE_ID: "com.eeo.classin.harmony" }
    })).toBe("com.eeo.classin.harmony");
  });

  it("throws a clear error when HarmonyOS ClassIn bundleId is not configured", () => {
    expect(() => resolveRuntimeAppIdentifier({
      appId: "classin",
      platform: "harmony",
      env: {}
    })).toThrow("CLASSIN_HARMONY_BUNDLE_ID is required");
  });

  it("keeps non-ClassIn app ids unchanged", () => {
    expect(resolveRuntimeAppIdentifier({
      appId: "com.demo.notes",
      platform: "harmony",
      env: {}
    })).toBe("com.demo.notes");
  });

  it("reads the runtime app id from HarmonyOS observation bundleId", () => {
    expect(appIdentifierFromObservation({
      platform: "harmony",
      bundleId: "com.eeo.classin.harmony",
      capturedAt: "2026-08-04T00:00:00.000Z",
      uiElements: [],
      ocrTexts: []
    })).toBe("com.eeo.classin.harmony");
  });

  it("matches ClassIn observation by configured runtime id", () => {
    expect(isObservationInsideTargetApp({
      appId: "classin",
      platform: "harmony",
      env: { CLASSIN_HARMONY_BUNDLE_ID: "com.eeo.classin.harmony" },
      observation: {
        platform: "harmony",
        bundleId: "com.eeo.classin.harmony",
        capturedAt: "2026-08-04T00:00:00.000Z",
        uiElements: [],
        ocrTexts: []
      }
    })).toEqual({
      inside: true,
      expectedAppIdentifier: "com.eeo.classin.harmony",
      actualAppIdentifier: "com.eeo.classin.harmony"
    });
  });
});
```

- [ ] **步骤 2: 运行测试验证失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/target-app-runtime.test.ts
```

预期：找不到 `target-app-runtime.js`，测试失败。

- [ ] **步骤 3: 实现 runtime identity 解析器**

创建 `platform/apps/server/src/target-app-runtime.ts`：

```ts
import type { Observation } from "@mobile-automation/graph-core";
import type { Platform } from "@mobile-automation/shared";

const CLASSIN_APP_ID = "classin";
const DEFAULT_CLASSIN_ANDROID_PACKAGE = "cn.eeo.classin";

export type RuntimeAppEnv = Pick<
  NodeJS.ProcessEnv,
  "CLASSIN_ANDROID_PACKAGE" | "CLASSIN_IOS_BUNDLE_ID" | "CLASSIN_HARMONY_BUNDLE_ID" | "CLASSIN_HARMONY_ABILITY_NAME"
>;

export type ResolveRuntimeAppIdentifierInput = {
  appId: string;
  platform: Platform;
  env?: RuntimeAppEnv;
};

export type ObservationTargetAppMatch = {
  inside: boolean;
  expectedAppIdentifier: string;
  actualAppIdentifier?: string;
};

export function resolveRuntimeAppIdentifier(input: ResolveRuntimeAppIdentifierInput): string {
  const appId = input.appId.trim();
  if (!appId) {
    throw new Error("appId is required");
  }
  if (appId !== CLASSIN_APP_ID) {
    return appId;
  }
  const env = input.env ?? process.env;
  if (input.platform === "android") {
    return nonBlank(env.CLASSIN_ANDROID_PACKAGE) ?? DEFAULT_CLASSIN_ANDROID_PACKAGE;
  }
  if (input.platform === "ios") {
    return requiredEnv(env.CLASSIN_IOS_BUNDLE_ID, "CLASSIN_IOS_BUNDLE_ID");
  }
  return requiredEnv(env.CLASSIN_HARMONY_BUNDLE_ID, "CLASSIN_HARMONY_BUNDLE_ID");
}

export function resolveHarmonyAbilityName(env: RuntimeAppEnv = process.env): string | undefined {
  return nonBlank(env.CLASSIN_HARMONY_ABILITY_NAME);
}

export function appIdentifierFromObservation(observation: Pick<Observation, "platform" | "packageName" | "bundleId">): string | undefined {
  if (observation.platform === "android") {
    return nonBlank(observation.packageName);
  }
  return nonBlank(observation.bundleId) ?? nonBlank(observation.packageName);
}

export function isObservationInsideTargetApp(input: {
  appId: string;
  platform: Platform;
  observation: Pick<Observation, "platform" | "packageName" | "bundleId">;
  env?: RuntimeAppEnv;
}): ObservationTargetAppMatch {
  const expectedAppIdentifier = resolveRuntimeAppIdentifier({
    appId: input.appId,
    platform: input.platform,
    env: input.env
  });
  const actualAppIdentifier = appIdentifierFromObservation(input.observation);
  return {
    inside: !actualAppIdentifier || actualAppIdentifier === expectedAppIdentifier,
    expectedAppIdentifier,
    actualAppIdentifier
  };
}

function requiredEnv(value: string | undefined, name: string): string {
  const normalized = nonBlank(value);
  if (!normalized) {
    throw new Error(`${name} is required to resolve ClassIn runtime app identity`);
  }
  return normalized;
}

function nonBlank(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
```

- [ ] **步骤 4: 运行验证**

运行：

```bash
pnpm --filter @mobile-automation/server typecheck
pnpm vitest run platform/apps/server/src/target-app-runtime.test.ts
```

预期：全部通过。

- [ ] **步骤 5: 提交代码**

```bash
git add platform/apps/server/src/target-app-runtime.ts platform/apps/server/src/target-app-runtime.test.ts
git commit -m "feat: resolve ClassIn runtime app identity"
```

## 任务 3: 新增 harmony-driver 包

**文件：**

- 创建：`platform/packages/harmony-driver/package.json`
- 创建：`platform/packages/harmony-driver/tsconfig.json`
- 创建：`platform/packages/harmony-driver/src/hdc.ts`
- 创建：`platform/packages/harmony-driver/src/harmony-parsers.ts`
- 创建：`platform/packages/harmony-driver/src/harmony-discovery.ts`
- 创建：`platform/packages/harmony-driver/src/harmony-actions.ts`
- 创建：`platform/packages/harmony-driver/src/index.ts`
- 创建：`platform/packages/harmony-driver/src/harmony-actions.test.ts`
- 创建：`platform/packages/harmony-driver/src/harmony-discovery.test.ts`

- [ ] **步骤 1: 创建包定义**

创建 `platform/packages/harmony-driver/package.json`：

```json
{
  "name": "@mobile-automation/harmony-driver",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@mobile-automation/shared": "workspace:*"
  }
}
```

创建 `platform/packages/harmony-driver/tsconfig.json`：

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **步骤 2: 编写动作映射失败测试**

创建 `platform/packages/harmony-driver/src/harmony-actions.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { HarmonyActionExecutor } from "./harmony-actions.js";

describe("HarmonyActionExecutor", () => {
  it("maps tap to uitest click", async () => {
    const calls: string[][] = [];
    const executor = new HarmonyActionExecutor({
      shell: async (_serial, args) => {
        calls.push(args);
        return "";
      },
      sleep: async () => undefined
    });

    await executor.performAction("SERIAL", { type: "tap", x: 12, y: 34 });

    expect(calls).toEqual([["uitest", "uiInput", "click", "12", "34"]]);
  });

  it("maps swipe to uitest swipe", async () => {
    const calls: string[][] = [];
    const executor = new HarmonyActionExecutor({
      shell: async (_serial, args) => {
        calls.push(args);
        return "";
      },
      sleep: async () => undefined
    });

    await executor.performAction("SERIAL", {
      type: "swipe",
      startX: 1,
      startY: 2,
      endX: 30,
      endY: 40,
      durationMs: 500
    });

    expect(calls).toEqual([["uitest", "uiInput", "swipe", "1", "2", "30", "40", "500"]]);
  });

  it("maps launch app to aa start with ability when provided", async () => {
    const calls: string[][] = [];
    const executor = new HarmonyActionExecutor({
      shell: async (_serial, args) => {
        calls.push(args);
        return "start ability successfully.";
      },
      sleep: async () => undefined,
      abilityName: () => "EntryAbility"
    });

    await executor.performAction("SERIAL", { type: "launch_app", packageName: "com.eeo.classin.harmony" });

    expect(calls).toEqual([["aa", "start", "-a", "EntryAbility", "-b", "com.eeo.classin.harmony"]]);
  });

  it("clears data with bm clean", async () => {
    const calls: string[][] = [];
    const executor = new HarmonyActionExecutor({
      shell: async (_serial, args) => {
        calls.push(args);
        return "clean bundle data files successfully.";
      },
      sleep: async () => undefined
    });

    await executor.clearAppData("SERIAL", "com.eeo.classin.harmony");

    expect(calls).toEqual([["bm", "clean", "-d", "-n", "com.eeo.classin.harmony"]]);
  });
});
```

- [ ] **步骤 3: 编写设备发现失败测试**

创建 `platform/packages/harmony-driver/src/harmony-discovery.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { HarmonyDeviceDiscovery } from "./harmony-discovery.js";

describe("HarmonyDeviceDiscovery", () => {
  it("lists online devices from hdc targets", async () => {
    const discovery = new HarmonyDeviceDiscovery({
      listTargets: async () => "ABC123\nDEF456\tdevice\n",
      shell: async (_serial, args) => {
        if (args.join(" ") === "param get const.product.model") return "MatePad";
        if (args.join(" ") === "param get const.product.manufacturer") return "HUAWEI";
        if (args.join(" ") === "param get const.ohos.apiversion") return "15";
        return "";
      }
    });

    await expect(discovery.listDevices()).resolves.toMatchObject([
      {
        id: "ABC123",
        serial: "ABC123",
        platform: "harmony",
        name: "MatePad",
        model: "MatePad",
        manufacturer: "HUAWEI",
        osVersion: "15",
        status: "online"
      },
      {
        id: "DEF456",
        serial: "DEF456",
        platform: "harmony",
        status: "online"
      }
    ]);
  });
});
```

- [ ] **步骤 4: 运行测试验证失败**

运行：

```bash
pnpm vitest run platform/packages/harmony-driver/src/harmony-actions.test.ts platform/packages/harmony-driver/src/harmony-discovery.test.ts
```

预期：实现文件还不存在，测试失败。

- [ ] **步骤 5: 实现 hdc 命令封装**

创建 `platform/packages/harmony-driver/src/hdc.ts`：

```ts
import { execFile } from "node:child_process";

export type ExecTextOptions = {
  timeoutMs?: number;
  maxBuffer?: number;
};

export function hdcText(args: string[], options: ExecTextOptions = {}): Promise<string> {
  return execText("hdc", args, options);
}

export function hdcShell(serial: string, args: string[], options: ExecTextOptions = {}): Promise<string> {
  return hdcText(["-t", serial, "shell", ...args], options);
}

export function hdcFileRecv(serial: string, remotePath: string, localPath: string, options: ExecTextOptions = {}): Promise<string> {
  return hdcText(["-t", serial, "file", "recv", remotePath, localPath], options);
}

export function commandVersion(command: string, args: string[]): Promise<{ available: boolean; version?: string; path?: string }> {
  return execText(command, args, { timeoutMs: 5000 })
    .then((output) => ({
      available: true,
      version: firstLine(output)
    }))
    .catch(() => ({ available: false }));
}

function execText(command: string, args: string[], options: ExecTextOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: "utf8",
      timeout: options.timeoutMs ?? 15000,
      maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = [stderr, stdout, error.message].filter(Boolean).join("\n").trim();
        reject(new Error(detail || `${command} ${args.join(" ")} failed`));
        return;
      }
      resolve(stdout);
    });
  });
}

function firstLine(output: string): string | undefined {
  return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}
```

- [ ] **步骤 6: 实现 parser 与设备发现**

创建 `platform/packages/harmony-driver/src/harmony-parsers.ts`：

```ts
export function parseHdcTargets(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.toLowerCase().includes("empty"))
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean);
}

export function parseForegroundBundle(output: string): { bundleId?: string; abilityName?: string } {
  const bundleId = firstMatch(output, [
    /\bbundleName\s*[:=]\s*([A-Za-z0-9_.-]+)/,
    /\bbundle\s*[:=]\s*([A-Za-z0-9_.-]+)/,
    /\bBundleName\s*[:=]\s*([A-Za-z0-9_.-]+)/
  ]);
  const abilityName = firstMatch(output, [
    /\babilityName\s*[:=]\s*([A-Za-z0-9_.-]+)/,
    /\bAbilityName\s*[:=]\s*([A-Za-z0-9_.-]+)/
  ]);
  return { bundleId, abilityName };
}

function firstMatch(output: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[1]) return match[1];
  }
  return undefined;
}
```

创建 `platform/packages/harmony-driver/src/harmony-discovery.ts`：

```ts
import { defaultHarmonyCapabilities, nowIso, type DeviceInfo } from "@mobile-automation/shared";
import { parseHdcTargets } from "./harmony-parsers.js";

export type HarmonyShellExecutor = (serial: string, args: string[], options?: { timeoutMs?: number }) => Promise<string>;

type HarmonyDeviceDiscoveryOptions = {
  listTargets: () => Promise<string>;
  shell: HarmonyShellExecutor;
};

export class HarmonyDeviceDiscovery {
  constructor(private readonly options: HarmonyDeviceDiscoveryOptions) {}

  async listDevices(): Promise<DeviceInfo[]> {
    const serials = parseHdcTargets(await this.options.listTargets());
    return Promise.all(serials.map((serial) => this.getDeviceInfo(serial)));
  }

  async getDeviceInfo(serial: string): Promise<DeviceInfo> {
    const [model, manufacturer, osVersion] = await Promise.all([
      this.shell(serial, ["param", "get", "const.product.model"]).catch(() => ""),
      this.shell(serial, ["param", "get", "const.product.manufacturer"]).catch(() => ""),
      this.shell(serial, ["param", "get", "const.ohos.apiversion"]).catch(() => "")
    ]);
    const normalizedModel = model.trim();
    return {
      id: serial,
      serial,
      platform: "harmony",
      name: normalizedModel || serial,
      model: normalizedModel || undefined,
      manufacturer: manufacturer.trim() || undefined,
      osVersion: osVersion.trim() || undefined,
      status: "online",
      capabilities: defaultHarmonyCapabilities(),
      lastSeenAt: nowIso()
    };
  }

  private shell(serial: string, args: string[], options?: { timeoutMs?: number }): Promise<string> {
    return this.options.shell(serial, args, options);
  }
}
```

- [ ] **步骤 7: 实现动作执行器**

创建 `platform/packages/harmony-driver/src/harmony-actions.ts`：

```ts
import type { DeviceActionRequest, DeviceActionResult } from "@mobile-automation/shared";
import type { HarmonyShellExecutor } from "./harmony-discovery.js";

type HarmonyActionExecutorOptions = {
  shell: HarmonyShellExecutor;
  sleep?: (ms: number) => Promise<void>;
  abilityName?: (bundleName: string) => string | undefined;
};

export class HarmonyActionExecutor {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: HarmonyActionExecutorOptions) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult> {
    if (action.type === "wait") {
      await this.sleep(action.durationMs);
      return hdcInputResult();
    }
    if (action.type === "tap") {
      await this.shell(serial, ["uitest", "uiInput", "click", String(action.x), String(action.y)]);
      return hdcInputResult();
    }
    if (action.type === "long_press") {
      await this.shell(serial, ["uitest", "uiInput", "longClick", String(action.x), String(action.y)]);
      return hdcInputResult();
    }
    if (action.type === "swipe") {
      await this.shell(serial, [
        "uitest",
        "uiInput",
        "swipe",
        String(action.startX),
        String(action.startY),
        String(action.endX),
        String(action.endY),
        String(action.durationMs ?? 450)
      ]);
      return hdcInputResult();
    }
    if (action.type === "back") {
      await this.shell(serial, ["uitest", "uiInput", "keyEvent", "Back"]);
      return hdcInputResult();
    }
    if (action.type === "home") {
      await this.shell(serial, ["uitest", "uiInput", "keyEvent", "Home"]);
      return hdcInputResult();
    }
    if (action.type === "input_text" || action.type === "input_keyevents") {
      await this.shell(serial, ["uitest", "uiInput", "text", action.text]);
      return hdcInputResult();
    }
    if (action.type === "launch_app") {
      await this.launchApp(serial, action.packageName);
      return hdcInputResult();
    }
    if (action.type === "close_app") {
      await this.shell(serial, ["aa", "force-stop", action.packageName]);
      return hdcInputResult();
    }
    if (action.type === "screenshot") {
      return hdcInputResult();
    }
    throw new Error(`HarmonyOS action is not supported yet: ${action.type}`);
  }

  async clearAppData(serial: string, bundleName: string): Promise<void> {
    await this.shell(serial, ["bm", "clean", "-d", "-n", bundleName], { timeoutMs: 15000 });
  }

  private async launchApp(serial: string, bundleName: string): Promise<void> {
    const abilityName = this.options.abilityName?.(bundleName);
    const args = abilityName
      ? ["aa", "start", "-a", abilityName, "-b", bundleName]
      : ["aa", "start", "-b", bundleName];
    await this.shell(serial, args, { timeoutMs: 15000 });
  }

  private shell(serial: string, args: string[], options?: { timeoutMs?: number }): Promise<string> {
    return this.options.shell(serial, args, options);
  }
}

function hdcInputResult(): DeviceActionResult {
  return { driverChannel: "hdc_input" };
}
```

- [ ] **步骤 8: 实现 HarmonyDriver**

创建 `platform/packages/harmony-driver/src/index.ts`：

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  DeviceActionRequest,
  DeviceActionResult,
  DeviceInfo,
  InstalledAppInfo,
  MetricSample,
  ToolStatus
} from "@mobile-automation/shared";
import { nowIso } from "@mobile-automation/shared";
import { HarmonyActionExecutor } from "./harmony-actions.js";
import { HarmonyDeviceDiscovery } from "./harmony-discovery.js";
import { hdcFileRecv, hdcShell, hdcText, commandVersion } from "./hdc.js";
import { parseForegroundBundle } from "./harmony-parsers.js";

type HarmonyDriverOptions = {
  abilityName?: (bundleName: string) => string | undefined;
};

export class HarmonyDriver {
  private readonly actions: HarmonyActionExecutor;
  private readonly discovery: HarmonyDeviceDiscovery;

  constructor(options: HarmonyDriverOptions = {}) {
    this.actions = new HarmonyActionExecutor({
      shell: (serial, args, shellOptions) => this.shell(serial, args, shellOptions),
      abilityName: options.abilityName
    });
    this.discovery = new HarmonyDeviceDiscovery({
      listTargets: () => hdcText(["list", "targets"], { timeoutMs: 10000 }),
      shell: (serial, args, shellOptions) => this.shell(serial, args, shellOptions)
    });
  }

  async getToolStatus(): Promise<ToolStatus[]> {
    return [
      {
        name: "hdc",
        ...(await commandVersion("hdc", ["version"]))
      }
    ];
  }

  async listDevices(): Promise<DeviceInfo[]> {
    return this.discovery.listDevices();
  }

  async getDeviceInfo(serial: string): Promise<DeviceInfo> {
    return this.discovery.getDeviceInfo(serial);
  }

  async screenshot(serial: string): Promise<Buffer> {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-harmony-screenshot-"));
    const localPath = path.join(tmpDir, `${serial}.png`);
    const remotePath = `/data/local/tmp/mobile_automation_${Date.now()}.png`;
    try {
      await this.shell(serial, ["uitest", "screenCap", "-p", remotePath], { timeoutMs: 15000 });
      await hdcFileRecv(serial, remotePath, localPath, { timeoutMs: 15000, maxBuffer: 8 * 1024 * 1024 });
      return await readFile(localPath);
    } finally {
      await this.shell(serial, ["rm", "-f", remotePath], { timeoutMs: 5000 }).catch(() => undefined);
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async getForegroundApp(serial: string): Promise<{ bundleId?: string; abilityName?: string; packageName?: string }> {
    const output = await this.shell(serial, ["aa", "dump", "-a"], { timeoutMs: 8000 }).catch(() => "");
    return parseForegroundBundle(output);
  }

  async getInstalledAppInfo(serial: string, bundleName: string): Promise<InstalledAppInfo> {
    const output = await this.shell(serial, ["bm", "dump", "-n", bundleName], { timeoutMs: 10000 }).catch(() => "");
    return {
      bundleId: bundleName,
      displayVersion: parseVersion(output) ?? "unknown"
    };
  }

  async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult> {
    if (action.type === "screenshot") {
      await this.screenshot(serial);
      return { driverChannel: "hdc_input" };
    }
    return this.actions.performAction(serial, action);
  }

  async clearAppData(serial: string, bundleName: string): Promise<void> {
    await this.actions.clearAppData(serial, bundleName);
  }

  async collectLogs(serial: string, lines = 400): Promise<string> {
    return this.shell(serial, ["hilog", "-x", "-t", String(lines)], { timeoutMs: 12000 }).catch(() => "");
  }

  async samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample> {
    return {
      id: `metric_${Date.now()}`,
      runId,
      stepResultId,
      deviceSerial: serial,
      sampledAt: nowIso(),
      cpuPercent: undefined,
      memoryMb: undefined,
      fps: undefined,
      networkRxKb: undefined,
      networkTxKb: undefined,
      batteryLevel: undefined,
      temperatureCelsius: undefined
    };
  }

  private shell(serial: string, args: string[], options?: { timeoutMs?: number; maxBuffer?: number }): Promise<string> {
    return hdcShell(serial, args, options);
  }
}

function parseVersion(output: string): string | undefined {
  return output.match(/\bversionName\s*[:=]\s*([^\s]+)/)?.[1]
    ?? output.match(/\bversion\s*[:=]\s*([^\s]+)/)?.[1];
}
```

- [ ] **步骤 9: 运行验证**

运行：

```bash
pnpm --filter @mobile-automation/harmony-driver typecheck
pnpm vitest run platform/packages/harmony-driver/src/harmony-actions.test.ts platform/packages/harmony-driver/src/harmony-discovery.test.ts
```

预期：全部通过。

- [ ] **步骤 10: 提交代码**

```bash
git add platform/packages/harmony-driver
git commit -m "feat: add harmony device driver"
```

## 任务 4: MobileDriver 三平台分发

**文件：**

- 修改：`platform/apps/server/src/mobile-driver.ts`
- 修改：`platform/apps/server/src/mobile-driver.test.ts`

- [ ] **步骤 1: 编写失败测试**

在 `platform/apps/server/src/mobile-driver.test.ts` 增加：

```ts
it("routes HarmonyOS device actions to harmony driver", async () => {
  const android = fakeDriver("android");
  const ios = fakeDriver("ios");
  const harmony = fakeDriver("harmony");
  harmony.listDevices = async () => [{
    id: "HARMONY",
    serial: "HARMONY",
    platform: "harmony",
    status: "online",
    capabilities: defaultHarmonyCapabilities(),
    lastSeenAt: nowIso()
  }];

  const driver = new MobileDriver(android, ios, harmony);
  await driver.listDevices();
  await driver.performAction("HARMONY", { type: "tap", x: 1, y: 2 });

  expect(harmony.performedActions).toEqual([{ type: "tap", x: 1, y: 2 }]);
  expect(android.performedActions).toEqual([]);
  expect(ios.performedActions).toEqual([]);
});
```

测试文件里的 fake driver 需要扩展到第三个平台：

```ts
function fakeDriver(platform: DeviceInfo["platform"]) {
  return {
    performedActions: [] as DeviceActionRequest[],
    async getToolStatus() { return []; },
    async listDevices() { return []; },
    async getDeviceInfo(serial: string) {
      return {
        id: serial,
        serial,
        platform,
        status: "online",
        capabilities: platform === "harmony" ? defaultHarmonyCapabilities() : defaultAndroidCapabilities(),
        lastSeenAt: nowIso()
      };
    },
    async screenshot() { return Buffer.from([]); },
    async performAction(_serial: string, action: DeviceActionRequest) {
      this.performedActions.push(action);
      return { driverChannel: platform === "harmony" ? "hdc_input" : "mock" };
    },
    async clearAppData() { return undefined; },
    async collectLogs() { return ""; },
    async samplePerformance(serial: string, runId: string) {
      return { id: "metric", runId, deviceSerial: serial, sampledAt: nowIso() };
    },
    async startVideoRecording() {
      throw new Error("recording unsupported in fake driver");
    },
    async stopVideoRecording() {
      return undefined;
    }
  };
}
```

- [ ] **步骤 2: 运行测试验证失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/mobile-driver.test.ts
```

预期：`MobileDriver` 构造函数还不接收 harmony driver，测试失败。

- [ ] **步骤 3: 修改 MobileDriver 构造和分发**

在 `platform/apps/server/src/mobile-driver.ts` 增加导入：

```ts
import { HarmonyDriver } from "@mobile-automation/harmony-driver";
import { resolveHarmonyAbilityName } from "./target-app-runtime.js";
```

修改 `AutomationDeviceDriver.getForegroundApp` 类型：

```ts
getForegroundApp?(serial: string): Promise<{
  packageName?: string;
  bundleId?: string;
  activityName?: string;
  abilityName?: string;
  componentName?: string;
}>;
```

修改构造函数：

```ts
constructor(
  private readonly android = new AndroidDriver(),
  private readonly ios = new IosDriver(),
  private readonly harmony = new HarmonyDriver({ abilityName: () => resolveHarmonyAbilityName() })
) {}
```

新增私有方法：

```ts
private async driverFor(serial: string): Promise<AutomationDeviceDriver> {
  const platform = await this.resolvePlatform(serial);
  switch (platform) {
    case "android":
      return this.android;
    case "ios":
      return this.ios;
    case "harmony":
      return this.harmony;
  }
}
```

把二选一分发替换成 switch，例如：

```ts
async listDevices(): Promise<DeviceInfo[]> {
  const [androidDevices, iosDevices, harmonyDevices] = await Promise.all([
    this.android.listDevices(),
    this.ios.listDevices(),
    this.harmony.listDevices()
  ]);
  const devices = [...androidDevices, ...iosDevices, ...harmonyDevices];
  for (const device of devices) {
    this.platformCache.set(device.serial, device.platform);
  }
  return devices;
}

async getDeviceInfo(serial: string): Promise<DeviceInfo> {
  return (await this.driverFor(serial)).getDeviceInfo(serial);
}

async screenshot(serial: string): Promise<Buffer> {
  return (await this.driverFor(serial)).screenshot(serial);
}

async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult | void> {
  return (await this.driverFor(serial)).performAction(serial, action);
}
```

保留 Android-only 方法：

```ts
async dumpUiHierarchy(serial: string): Promise<string> {
  const platform = await this.resolvePlatform(serial);
  if (platform !== "android") {
    throw new Error(`${platform} UI hierarchy locator is not supported yet`);
  }
  return this.android.dumpUiHierarchy(serial);
}

async performSemanticAction(serial: string, action: SemanticDeviceActionRequest): Promise<DeviceActionResult | void> {
  const platform = await this.resolvePlatform(serial);
  if (platform !== "android") {
    throw new Error(`${platform} semantic action backend is not supported yet`);
  }
  return this.android.performSemanticAction(serial, action);
}
```

视频录制：

```ts
async startVideoRecording(serial: string, runId: string, localDir: string): Promise<MobileVideoRecording> {
  const platform = await this.resolvePlatform(serial);
  if (platform === "android") return this.android.startVideoRecording(serial, runId, localDir);
  if (platform === "ios") return this.ios.startVideoRecording(serial, runId, localDir);
  throw new Error("HarmonyOS video recording is not supported yet");
}
```

- [ ] **步骤 4: 运行验证**

运行：

```bash
pnpm --filter @mobile-automation/server typecheck
pnpm vitest run platform/apps/server/src/mobile-driver.test.ts
```

预期：全部通过。

- [ ] **步骤 5: 提交代码**

```bash
git add platform/apps/server/src/mobile-driver.ts platform/apps/server/src/mobile-driver.test.ts
git commit -m "feat: route mobile driver calls to harmony"
```

## 任务 5: 脚本执行入口解析 ClassIn runtime id

**文件：**

- 修改：`platform/apps/server/src/script-flow-runner.ts`
- 修改：`platform/apps/server/src/script-flow-runner.test.ts`

- [ ] **步骤 1: 编写失败测试**

在 `platform/apps/server/src/script-flow-runner.test.ts` 增加：

```ts
it("allows a HarmonyOS script to run on a HarmonyOS device", async () => {
  const backend = new CapturingBackend();
  const runner = new ScriptFlowRunner({
    backend,
    driver: deviceInfoDriver("harmony"),
    pageCatalog: emptyPageCatalog()
  });

  await runner.start({
    deviceSerial: "HARMONY",
    flowId: "flow_1",
    flow: scriptFlow({
      app: { id: "classin", platform: "harmony" },
      steps: [{ id: "launch", action: "launchApp", input: {} }]
    }),
    mode: "once",
    env: { CLASSIN_HARMONY_BUNDLE_ID: "com.eeo.classin.harmony" }
  });

  expect(backend.input?.startAppPackageName).toBe("com.eeo.classin.harmony");
  expect(backend.input?.steps[0]?.params.packageName).toBe("com.eeo.classin.harmony");
});

it("keeps flutter scripts runnable on HarmonyOS devices", async () => {
  const backend = new CapturingBackend();
  const runner = new ScriptFlowRunner({
    backend,
    driver: deviceInfoDriver("harmony"),
    pageCatalog: emptyPageCatalog()
  });

  await runner.start({
    deviceSerial: "HARMONY",
    flowId: "flow_1",
    flow: scriptFlow({
      app: { id: "classin", platform: "flutter" },
      steps: []
    }),
    mode: "once",
    env: { CLASSIN_HARMONY_BUNDLE_ID: "com.eeo.classin.harmony" }
  });

  expect(backend.input?.sourceSnapshot?.parsed).toBeTruthy();
});
```

如果 `StartScriptFlowRunInput` 当前没有 `env` 字段，测试先通过依赖注入方式传 `process.env` 会不稳定；本任务需要在 input 上增加可选 `env?: RuntimeAppEnv` 方便测试和运行时配置。

- [ ] **步骤 2: 运行测试验证失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/script-flow-runner.test.ts
```

预期：`platformCanRun` 类型不接受 harmony 设备，或启动包名仍为 `classin`。

- [ ] **步骤 3: 修改平台判断**

在 `platform/apps/server/src/script-flow-runner.ts` 导入：

```ts
import type { Platform } from "@mobile-automation/shared";
import { resolveRuntimeAppIdentifier, type RuntimeAppEnv } from "./target-app-runtime.js";
```

修改输入类型：

```ts
export type StartScriptFlowRunInput = {
  // 保留现有字段
  env?: RuntimeAppEnv;
};
```

修改 `platformCanRun`：

```ts
function platformCanRun(script: ScriptFlowDocument["app"]["platform"], device: Platform): boolean {
  return script === device || script === "flutter";
}
```

- [ ] **步骤 4: 在 start 中解析 runtime app id**

在读取 device 后增加：

```ts
const runtimeAppIdentifier = resolveRuntimeAppIdentifier({
  appId: input.flow.app.id,
  platform: device.platform,
  env: input.env
});
```

构造 `stepContext` 时增加：

```ts
runtimeAppIdentifier,
```

修改 `toActionStep` 的 context 类型：

```ts
context: {
  flowId: string;
  scriptVersion: number;
  appId: string;
  runtimeAppIdentifier: string;
  platform: PageAssetPlatform;
  scriptParameters: Record<string, ScriptParameterValue>;
  resolutionParameters: Record<string, ScriptParameterValue>;
}
```

调用 `resolveAction` 时传入 runtime id：

```ts
const resolved = this.resolveAction(
  step,
  context.appId,
  context.runtimeAppIdentifier,
  context.platform,
  context.resolutionParameters,
  interactionAsset
);
```

修改 `resolveAction` 签名：

```ts
private resolveAction(
  step: ScriptExecutionPlanStep,
  appId: string,
  runtimeAppIdentifier: string,
  platform: PageAssetPlatform,
  parameters: Record<string, ScriptParameterValue>,
  interactionAsset?: InteractionAsset
)
```

修改 launchApp 分支：

```ts
if (step.action === "launchApp") {
  const explicitAppId = stringInput(step.input, "appId");
  return {
    type: "launch_app",
    params: {
      packageName: explicitAppId && explicitAppId !== appId ? explicitAppId : runtimeAppIdentifier,
      restartBeforeLaunch: true
    }
  };
}
```

修改 backend.start 参数：

```ts
startAppPackageName: runtimeAppIdentifier,
```

- [ ] **步骤 5: 运行验证**

运行：

```bash
CLASSIN_HARMONY_BUNDLE_ID=com.eeo.classin.harmony pnpm --filter @mobile-automation/server typecheck
CLASSIN_HARMONY_BUNDLE_ID=com.eeo.classin.harmony pnpm vitest run platform/apps/server/src/script-flow-runner.test.ts
```

预期：全部通过。

- [ ] **步骤 6: 提交代码**

```bash
git add platform/apps/server/src/script-flow-runner.ts platform/apps/server/src/script-flow-runner.test.ts
git commit -m "feat: resolve ClassIn app id for script execution"
```

## 任务 6: Observation 与 PageState 使用 runtime identity

**文件：**

- 修改：`platform/apps/server/src/observation-service.ts`
- 修改：`platform/apps/server/src/observation-service.test.ts`
- 修改：`platform/apps/server/src/page-state-service.ts`
- 修改：`platform/apps/server/src/page-state-service.test.ts`

- [ ] **步骤 1: 编写 observation 失败测试**

在 `platform/apps/server/src/observation-service.test.ts` 增加：

```ts
it("collects HarmonyOS bundle id without requiring Android UI hierarchy", async () => {
  const service = new ObservationService(
    fakeDriver({
      platform: "harmony",
      foreground: { bundleId: "com.eeo.classin.harmony", abilityName: "EntryAbility" },
      screenshot: minimalPng()
    }),
    fakeOcr([{ text: "登录", confidence: 0.98 }])
  );

  const observation = await service.collect("HARMONY", { includeUiTree: true, includeOcr: true });

  expect(observation.platform).toBe("harmony");
  expect(observation.bundleId).toBe("com.eeo.classin.harmony");
  expect(observation.activityName).toBeUndefined();
  expect(observation.uiElements).toEqual([]);
  expect(observation.ocrTexts.map((item) => item.text)).toEqual(["登录"]);
});
```

- [ ] **步骤 2: 编写 page-state 失败测试**

在 `platform/apps/server/src/page-state-service.test.ts` 增加：

```ts
it("treats configured HarmonyOS ClassIn bundle as inside the ClassIn app", async () => {
  const service = new DefaultPageStateService(
    catalogWithPage({
      id: "login",
      appId: "classin",
      platformScope: "harmony",
      matchers: [{ id: "m1", type: "ocr_text", value: "登录", weight: 1, critical: true }]
    }),
    observationCollector({
      platform: "harmony",
      bundleId: "com.eeo.classin.harmony",
      ocrTexts: [{ text: "登录", source: "ocr" }]
    }),
    undefined,
    { CLASSIN_HARMONY_BUNDLE_ID: "com.eeo.classin.harmony" }
  );

  const result = await service.verifyExpectedPage({
    serial: "HARMONY",
    appId: "classin",
    platform: "harmony",
    pageId: "login"
  });

  expect(result.status).toBe("matched");
});
```

如果 `DefaultPageStateService` 当前构造函数没有 env 参数，需要新增第四个可选参数 `env?: RuntimeAppEnv`。

- [ ] **步骤 3: 运行测试验证失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/observation-service.test.ts platform/apps/server/src/page-state-service.test.ts
```

预期：`ObservationService` 不写入 bundleId，`PageStateService` 仍用 `packageName !== input.appId` 判断。

- [ ] **步骤 4: 修改 ObservationService**

在 `platform/apps/server/src/observation-service.ts` 修改前台快照类型：

```ts
type ForegroundAppSnapshot = {
  packageName?: string;
  bundleId?: string;
  activityName?: string;
  abilityName?: string;
  componentName?: string;
};
```

返回 observation 时增加：

```ts
bundleId: foreground.bundleId,
activityName: foreground.activityName ?? foreground.abilityName,
```

更新 raw：

```ts
raw: {
  device_ready: true,
  foreground_package: foreground.packageName,
  foreground_bundle_id: foreground.bundleId,
  foreground_ability: foreground.abilityName,
  device,
  uiHierarchyXml: rawUiHierarchy,
  uiHierarchyError,
  screenshotBase64: screenshot?.toString("base64")
}
```

保留当前逻辑：

```ts
const uiTreePromise = includeUiTree && device.platform === "android"
  ? this.collectUiTree(serial)
  : Promise.resolve(emptyUiTree());
```

这条判断是合理的 Android-only 能力，不需要扩展到鸿蒙。

- [ ] **步骤 5: 修改 PageStateService**

在 `platform/apps/server/src/page-state-service.ts` 导入：

```ts
import { isObservationInsideTargetApp, type RuntimeAppEnv } from "./target-app-runtime.js";
```

修改构造函数：

```ts
constructor(
  private readonly catalog: PageAssetCatalog,
  private readonly observations: PageObservationCollector,
  private readonly baselineReader?: PageMatcherBaselineReader,
  private readonly env?: RuntimeAppEnv
) {}
```

替换 outside-app 判断：

```ts
const appMatch = isObservationInsideTargetApp({
  appId: input.appId,
  platform: input.platform === "flutter" ? observation.platform : input.platform,
  observation,
  env: this.env
});
if (!appMatch.inside) {
  return {
    status: "outside_app",
    candidates: [],
    observation,
    actualAppId: appMatch.actualAppIdentifier
  };
}
```

如果 `input.platform === "flutter"` 且 `observation.platform` 是设备真实平台，使用设备真实平台解析 runtime id；这样跨平台脚本仍按当前设备判断。

- [ ] **步骤 6: 运行验证**

运行：

```bash
CLASSIN_HARMONY_BUNDLE_ID=com.eeo.classin.harmony pnpm --filter @mobile-automation/server typecheck
CLASSIN_HARMONY_BUNDLE_ID=com.eeo.classin.harmony pnpm vitest run platform/apps/server/src/observation-service.test.ts platform/apps/server/src/page-state-service.test.ts
```

预期：全部通过。

- [ ] **步骤 7: 提交代码**

```bash
git add platform/apps/server/src/observation-service.ts platform/apps/server/src/observation-service.test.ts platform/apps/server/src/page-state-service.ts platform/apps/server/src/page-state-service.test.ts
git commit -m "feat: match ClassIn pages by runtime app identity"
```

## 任务 7: Dashboard 最小鸿蒙可见性

**文件：**

- 修改：`platform/apps/dashboard/src/components/PreviewPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/PageAssetsPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/AssetRecordingPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/RuntimeInterceptorPanel.tsx`
- 修改：`platform/apps/dashboard/src/hooks/useDeviceList.ts`
- 修改：`platform/apps/dashboard/src/App.tsx`
- 修改：相关 dashboard 测试文件

- [ ] **步骤 1: 编写平台文案测试**

在 dashboard 测试中增加一个纯函数测试。若当前没有平台 label helper，先在 `PreviewPanel.tsx` 附近提取：

```ts
export function devicePlatformLabel(platform: DeviceInfo["platform"]): string {
  if (platform === "ios") return "iOS";
  if (platform === "harmony") return "HarmonyOS";
  return "Android";
}
```

测试：

```ts
it("labels HarmonyOS devices explicitly", () => {
  expect(devicePlatformLabel("harmony")).toBe("HarmonyOS");
  expect(devicePlatformLabel("android")).toBe("Android");
  expect(devicePlatformLabel("ios")).toBe("iOS");
});
```

- [ ] **步骤 2: 运行测试验证失败**

运行：

```bash
pnpm vitest run platform/apps/dashboard/src/components/PreviewPanel.test.ts platform/apps/dashboard/src/components/PageAssetsPanel.test.ts
```

预期：label helper 不存在或 HarmonyOS 被显示成 Android。

- [ ] **步骤 3: 更新设备展示和截图预览策略**

修改 `PreviewPanel.tsx` 中所有非 iOS 默认 Android 的表达式：

```ts
const platform = selectedDevice ? devicePlatformLabel(selectedDevice.platform) : "Device";
```

scrcpy 控制保留：

```ts
const canUseScrcpy = selectedDevice?.platform === "android";
```

HarmonyOS 设备使用现有 screenshot fallback，不引入新的视频流。

- [ ] **步骤 4: 更新资产/录制/拦截面板类型**

把这些类型从：

```ts
"android" | "ios" | "mobile-both"
```

扩展为：

```ts
"android" | "ios" | "harmony" | "mobile-both"
```

平台文案：

```ts
function platformLabel(platform: "android" | "ios" | "harmony" | "mobile-both"): string {
  if (platform === "mobile-both") return "Android / iOS / HarmonyOS";
  if (platform === "ios") return "iOS";
  if (platform === "harmony") return "HarmonyOS";
  return "Android";
}
```

`App.tsx` 中 page asset target profile 查找增加：

```ts
if (observation.platform === "harmony") {
  return {
    platform: "harmony",
    appId: "classin",
    harmonyBundleName: observation.bundleId
  };
}
```

- [ ] **步骤 5: 运行验证**

运行：

```bash
pnpm --filter @mobile-automation/dashboard typecheck
pnpm vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/PageAssetsPanel.test.ts platform/apps/dashboard/src/hooks/useDeviceList.test.ts
```

预期：全部通过。

- [ ] **步骤 6: 提交代码**

```bash
git add platform/apps/dashboard/src
git commit -m "feat: show harmony devices in dashboard"
```

## 任务 8: 端到端验证和文档收口

**文件：**

- 修改：`README.md`
- 修改：`docs/adr/001-android-first-mvp.md`
- 修改：`docs/adr/006-incremental-ios-support.md`
- 创建：`docs/adr/007-harmony-device-execution-mvp.md`

- [ ] **步骤 1: 记录鸿蒙执行层 ADR**

创建 `docs/adr/007-harmony-device-execution-mvp.md`：

```md
# ADR 007: HarmonyOS Device Execution MVP

## Status

Accepted

## Context

Mobile Automation stores ClassIn scripts, page assets, interaction assets, and cases under the product-level app id `classin`.
Android, iOS, and HarmonyOS use different runtime app identifiers.

## Decision

HarmonyOS support is implemented as a device execution adapter.
The script generation and asset generation chain remains shared.
At runtime, `classin` is resolved to the current platform identifier:

- Android: package name, defaulting to `cn.eeo.classin`.
- iOS: bundleId from `CLASSIN_IOS_BUNDLE_ID`.
- HarmonyOS: bundleId from `CLASSIN_HARMONY_BUNDLE_ID`, with optional ability name from `CLASSIN_HARMONY_ABILITY_NAME`.

HarmonyOS device control uses `hdc`, `uitest`, `aa`, `bm`, and `hilog`.
Android-only features remain isolated behind Android platform checks.

## Consequences

`waitForPage` and `assertPage` continue to use screenshot and OCR matching.
HarmonyOS does not need an Android UI hierarchy dump to run the MVP flow.
Element snapshot, scrcpy preview, Android App Monitor, and stability exploration remain Android-specific.
```

- [ ] **步骤 2: 更新 README 运行说明**

在 `README.md` 的设备准备部分增加：

````md
### HarmonyOS device execution

Install `hdc` and make sure the target device is visible:

```bash
hdc list targets
```

Configure the ClassIn HarmonyOS runtime identity before running scripts:

```bash
export CLASSIN_HARMONY_BUNDLE_ID=com.eeo.classin.harmony
export CLASSIN_HARMONY_ABILITY_NAME=EntryAbility
```

`CLASSIN_HARMONY_ABILITY_NAME` is optional when the bundle can be launched by bundle name alone.
````

- [ ] **步骤 3: 运行单元和类型验证**

使用 Node 22+ 环境运行：

```bash
node -v
pnpm -r typecheck
CLASSIN_HARMONY_BUNDLE_ID=com.eeo.classin.harmony pnpm test
```

预期：

```text
Node version is >= 22.7.0
typecheck passes
vitest passes
```

当前本机 shell 如果仍是 Node 18，会在 `node:sqlite` 上失败；这不是鸿蒙实现本身的问题，执行前需要切到 Node 22+。

- [ ] **步骤 4: 运行鸿蒙设备 smoke test**

连接鸿蒙设备后运行：

```bash
export HARMONY_SERIAL="$(hdc list targets | sed -n '1p' | awk '{print $1}')"
export CLASSIN_HARMONY_BUNDLE_ID=com.eeo.classin.harmony
export CLASSIN_HARMONY_ABILITY_NAME=EntryAbility

hdc -t "$HARMONY_SERIAL" shell uitest screenCap -p /data/local/tmp/mobile_automation_probe.png
hdc -t "$HARMONY_SERIAL" file recv /data/local/tmp/mobile_automation_probe.png /tmp/mobile_automation_probe.png
hdc -t "$HARMONY_SERIAL" shell uitest uiInput click 100 100
hdc -t "$HARMONY_SERIAL" shell aa start -a "$CLASSIN_HARMONY_ABILITY_NAME" -b "$CLASSIN_HARMONY_BUNDLE_ID"
hdc -t "$HARMONY_SERIAL" shell aa force-stop "$CLASSIN_HARMONY_BUNDLE_ID"
```

预期：

```text
截图文件写入 /tmp/mobile_automation_probe.png
点击命令返回成功
ClassIn 鸿蒙包可以启动和停止
```

- [ ] **步骤 5: 运行项目内脚本 smoke test**

启动服务：

```bash
export CLASSIN_HARMONY_BUNDLE_ID=com.eeo.classin.harmony
export CLASSIN_HARMONY_ABILITY_NAME=EntryAbility
pnpm dev
```

在 Dashboard 中选择 HarmonyOS 设备，执行一个只包含以下步骤的 ClassIn 脚本：

```yaml
app:
  id: classin
  platform: harmony
steps:
  - id: launch
    action: launchApp
  - id: wait_login
    action: waitForPage
    input:
      pageId: login
```

预期：

```text
设备列表出现 HarmonyOS 设备
脚本启动 ClassIn 鸿蒙包
执行记录中 launch_app 使用 com.eeo.classin.harmony
waitForPage 通过截图/OCR 进入 PageStateService
```

- [ ] **步骤 6: 提交文档**

```bash
git add README.md docs/adr/001-android-first-mvp.md docs/adr/006-incremental-ios-support.md docs/adr/007-harmony-device-execution-mvp.md
git commit -m "docs: describe harmony execution MVP"
```

## 验收标准

- `Platform`、`DeviceInfo.platform`、`Observation.platform` 支持 `"harmony"`。
- `MobileDriver` 不再把非 iOS 设备默认路由到 Android。
- `@mobile-automation/harmony-driver` 能发现设备、截图、点击、长按、滑动、输入、返回、Home、启动 App、停止 App、清理数据、采集 hilog 文本。
- `app.id = "classin"` 在 HarmonyOS 上执行时解析为 `CLASSIN_HARMONY_BUNDLE_ID`。
- `waitForPage` / `assertPage` 在 HarmonyOS 上继续使用截图/OCR/page matcher，不依赖 Android UI hierarchy。
- Dashboard 能显示 HarmonyOS 设备，不把 HarmonyOS 标成 Android。
- Android/iOS 现有测试通过；HarmonyOS 新增单元测试通过。

## 风险和边界

- `CLASSIN_HARMONY_BUNDLE_ID` 必须由运行环境提供；代码在缺失时抛出明确错误。
- `CLASSIN_HARMONY_ABILITY_NAME` 取决于 ClassIn 鸿蒙包是否支持仅按 bundle 启动；如果设备上 `aa start -b <bundleName>` 失败，需要配置 abilityName。
- 鸿蒙 UI 控件树 `uitest dumpLayout` 不纳入 MVP；脚本应优先使用截图、OCR、视觉和文本匹配。
- Android App Monitor、scrcpy、uiautomator 元素快照、稳定性探索保持 Android-only。
- 当前本机 shell 是 Node 18 时，`pnpm test` 会因为 `node:sqlite` 失败；完整验证需要 Node 22+。

## 执行顺序

1. 任务 1：平台基础类型。
2. 任务 2：ClassIn runtime identity。
3. 任务 3：Harmony driver。
4. 任务 4：MobileDriver 三平台分发。
5. 任务 5：脚本执行入口接 runtime id。
6. 任务 6：Observation/PageState 接 runtime identity。
7. 任务 7：Dashboard 最小可见性。
8. 任务 8：端到端验证和文档。

每个任务完成后单独提交，避免把平台基础、driver、server 路由和 UI 展示混在一个大提交里。
