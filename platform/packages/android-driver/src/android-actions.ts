import {
  type DeviceActionRequest,
  type DeviceActionResult,
  type DriverChannel,
  type SemanticDeviceActionRequest,
  type SemanticElementLocator
} from "@mobile-automation/shared";
import {
  assertAmStartSucceeded,
  escapeInputText,
  escapeShellSingleQuoted,
  isForegroundComponentForPackage,
  isPmClearSuccess,
  parseFocusedComponent,
  pickLauncherComponent
} from "./android-parsers.js";

export type ExecTextOptions = {
  timeoutMs?: number;
};

export type AndroidShellExecutor = (serial: string, args: string[], options?: ExecTextOptions) => Promise<string>;

type AndroidActionExecutorOptions = {
  shell: AndroidShellExecutor;
  sleep?: (ms: number) => Promise<void>;
  semanticBackend?: AndroidActionBackend;
};

const adbKeyboardIme = "com.android.adbkeyboard/.AdbIME";
const CLEAR_TEXT_DELETE_KEYEVENT_COUNT = 40;

export type AndroidActionBackend = {
  channel: Extract<DriverChannel, "uiautomator2" | "appium">;
  tapElement?(serial: string, locator: SemanticElementLocator): Promise<DeviceActionResult>;
  inputTextToElement?(
    serial: string,
    locator: SemanticElementLocator,
    text: string,
    options?: {
      clearFirst?: boolean;
    }
  ): Promise<DeviceActionResult>;
  scrollUntilVisible?(
    serial: string,
    locator: SemanticElementLocator,
    options?: {
      direction?: "up" | "down" | "left" | "right";
      maxSwipes?: number;
      intervalMs?: number;
    }
  ): Promise<DeviceActionResult>;
};

type AndroidHttpActionBackendOptions = {
  channel: Extract<DriverChannel, "uiautomator2" | "appium">;
  endpoint: string;
  sessionId?: string;
  fetch?: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
};

export class AndroidHttpActionBackend implements AndroidActionBackend {
  readonly channel: Extract<DriverChannel, "uiautomator2" | "appium">;
  private readonly endpoint: string;
  private readonly sessionId?: string;
  private readonly fetchImpl: NonNullable<AndroidHttpActionBackendOptions["fetch"]>;

  constructor(options: AndroidHttpActionBackendOptions) {
    this.channel = options.channel;
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.sessionId = options.sessionId;
    this.fetchImpl =
      options.fetch ??
      (async (url, init) => {
        const response = await fetch(url, init);
        return {
          ok: response.ok,
          status: response.status,
          text: () => response.text()
        };
      });
  }

  tapElement(serial: string, locator: SemanticElementLocator): Promise<DeviceActionResult> {
    return this.post("tap-element", {
      serial,
      locator
    });
  }

  inputTextToElement(
    serial: string,
    locator: SemanticElementLocator,
    text: string,
    options?: {
      clearFirst?: boolean;
    }
  ): Promise<DeviceActionResult> {
    return this.post("input-text-to-element", {
      serial,
      locator,
      text,
      clearFirst: options?.clearFirst
    });
  }

  scrollUntilVisible(
    serial: string,
    locator: SemanticElementLocator,
    options?: {
      direction?: "up" | "down" | "left" | "right";
      maxSwipes?: number;
      intervalMs?: number;
    }
  ): Promise<DeviceActionResult> {
    return this.post("scroll-until-visible", {
      serial,
      locator,
      ...options
    });
  }

  private async post(action: string, body: Record<string, unknown>): Promise<DeviceActionResult> {
    const url = this.actionUrl(action);
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${this.channel} action backend failed (${response.status}): ${text}`);
    }
    return {
      driverChannel: this.channel,
      details: {
        endpoint: url,
        ...(parseBackendResponseDetails(text) ?? {})
      }
    };
  }

  private actionUrl(action: string): string {
    if (this.sessionId) {
      return `${this.endpoint}/session/${encodeURIComponent(this.sessionId)}/mobile-automation/${action}`;
    }
    return `${this.endpoint}/mobile-automation/${action}`;
  }
}

export function createAndroidActionBackendFromEnv(env: Record<string, string | undefined> = process.env): AndroidActionBackend | undefined {
  const backend = env.ANDROID_ACTION_BACKEND;
  if (backend !== "uiautomator2" && backend !== "appium") {
    return undefined;
  }
  const endpoint = backend === "appium" ? env.APPIUM_SERVER_URL : env.UIAUTOMATOR2_SERVER_URL;
  if (!endpoint) {
    return undefined;
  }
  return new AndroidHttpActionBackend({
    channel: backend,
    endpoint,
    sessionId: backend === "appium" ? env.APPIUM_SESSION_ID : undefined
  });
}

export class AndroidActionExecutor {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: AndroidActionExecutorOptions) {
    this.sleep = options.sleep ?? sleep;
  }

  async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult> {
    if (action.type === "wait") {
      await this.sleep(action.durationMs);
      return adbInputResult();
    }
    if (action.type === "tap") {
      await this.shell(serial, ["input", "tap", String(action.x), String(action.y)]);
      return adbInputResult();
    }
    if (action.type === "long_press") {
      const duration = String(action.durationMs ?? 800);
      await this.shell(serial, ["input", "swipe", String(action.x), String(action.y), String(action.x), String(action.y), duration]);
      return adbInputResult();
    }
    if (action.type === "swipe") {
      const duration = String(action.durationMs ?? 450);
      await this.shell(serial, [
        "input",
        "swipe",
        String(action.startX),
        String(action.startY),
        String(action.endX),
        String(action.endY),
        duration
      ]);
      return adbInputResult();
    }
    if (action.type === "hide_keyboard") {
      await this.shell(serial, ["input", "keyevent", "111"]);
      return adbInputResult();
    }
    if (action.type === "back") {
      await this.shell(serial, ["input", "keyevent", "4"]);
      return adbInputResult();
    }
    if (action.type === "home") {
      await this.shell(serial, ["input", "keyevent", "3"]);
      return adbInputResult();
    }
    if (action.type === "recent_apps") {
      await this.shell(serial, ["input", "keyevent", "KEYCODE_APP_SWITCH"]);
      return adbInputResult();
    }
    if (action.type === "unlock") {
      await this.shell(serial, ["input", "keyevent", "KEYCODE_WAKEUP"]);
      await this.shell(serial, ["wm", "dismiss-keyguard"]).catch(() => undefined);
      await this.shell(serial, ["input", "keyevent", "82"]).catch(() => undefined);
      return adbInputResult();
    }
    if (action.type === "input_text") {
      await this.inputText(serial, action.text);
      return adbInputResult();
    }
    if (action.type === "input_keyevents") {
      await this.inputTextWithKeyEvents(serial, action.text, action.intervalMs);
      return {
        ...adbInputResult(),
        details: {
          inputMethod: "keyevent"
        }
      };
    }
    if (action.type === "clear_text") {
      if (await this.clearTextWithAdbKeyboard(serial)) {
        await this.clearTextWithSelectAllDelete(serial);
        return adbInputResult();
      }
      await this.clearTextWithSelectAllDelete(serial);
      return adbInputResult();
    }
    if (action.type === "launch_app") {
      await this.launchApp(serial, action.packageName);
      return adbInputResult();
    }
    if (action.type === "close_app") {
      await this.shell(serial, ["am", "force-stop", action.packageName]);
      return adbInputResult();
    }
    if (action.type === "screenshot") {
      return adbInputResult();
    }
    return adbInputResult();
  }

  async performSemanticAction(serial: string, action: SemanticDeviceActionRequest): Promise<DeviceActionResult> {
    const backend = this.options.semanticBackend;
    if (action.type === "tap_on_element") {
      if (backend?.tapElement) {
        return backend.tapElement(serial, action.locator);
      }
      if (!action.fallbackTap) {
        throw new Error("tap_on_element fallbackTap is required when semantic backend is unavailable");
      }
      await this.performAction(serial, {
        type: "tap",
        x: action.fallbackTap.x,
        y: action.fallbackTap.y
      });
      return semanticFallbackResult(action.type, backend);
    }
    if (action.type === "input_text_to_element") {
      if (backend?.inputTextToElement) {
        return backend.inputTextToElement(serial, action.locator, action.text, {
          clearFirst: action.clearFirst
        });
      }
      if (!action.fallbackTap) {
        throw new Error("input_text_to_element fallbackTap is required when semantic backend is unavailable");
      }
      await this.performAction(serial, {
        type: "tap",
        x: action.fallbackTap.x,
        y: action.fallbackTap.y
      });
      if (action.clearFirst !== false) {
        await this.performAction(serial, { type: "clear_text" });
      }
      await this.performAction(serial, { type: "input_text", text: action.text });
      return semanticFallbackResult(action.type, backend);
    }
    if (action.type === "scroll_until_visible") {
      if (backend?.scrollUntilVisible) {
        return backend.scrollUntilVisible(serial, action.locator, {
          direction: action.direction,
          maxSwipes: action.maxSwipes,
          intervalMs: action.intervalMs
        });
      }
      if (!action.fallbackSwipe) {
        throw new Error("scroll_until_visible fallbackSwipe is required when semantic backend is unavailable");
      }
      await this.performAction(serial, action.fallbackSwipe);
      return semanticFallbackResult(action.type, backend);
    }
    throw new Error(`Unsupported semantic Android action: ${(action as { type?: string }).type ?? "unknown"}`);
  }

  async clearAppData(serial: string, packageName: string): Promise<void> {
    const output = await this.shell(serial, ["pm", "clear", packageName]);
    if (!isPmClearSuccess(output)) {
      throw new Error(output.trim() || `pm clear failed for ${packageName}`);
    }
  }

  private async inputText(serial: string, text: string): Promise<void> {
    if (await this.hasAdbKeyboard(serial)) {
      await this.inputTextWithAdbKeyboard(serial, text);
      return;
    }

    const shouldPreferClipboard = /[^\x20-\x7e]/.test(text);
    if (shouldPreferClipboard) {
      await this.pasteText(serial, text).catch(async () => {
        await this.shell(serial, ["input", "text", escapeInputText(text)]);
      });
      return;
    }

    try {
      await this.shell(serial, ["input", "text", escapeInputText(text)]);
    } catch (error) {
      await this.pasteText(serial, text).catch(() => {
        throw error;
      });
    }
  }

  private async pasteText(serial: string, text: string): Promise<void> {
    const escaped = escapeShellSingleQuoted(text);
    await this.shell(serial, ["sh", "-c", `cmd clipboard set text 'mobile-automation' '${escaped}'`], { timeoutMs: 5000 });
    await this.shell(serial, ["input", "keyevent", "KEYCODE_PASTE"], { timeoutMs: 5000 });
  }

  private async inputTextWithKeyEvents(serial: string, text: string, intervalMs = 35): Promise<void> {
    for (const char of text) {
      const keyCode = keyCodeForTextChar(char);
      if (!keyCode) {
        throw new Error(`Character cannot be typed through Android keyevents: ${JSON.stringify(char)}`);
      }
      await this.shell(serial, ["input", "keyevent", keyCode], { timeoutMs: 5000 });
      if (intervalMs > 0) {
        await this.sleep(intervalMs);
      }
    }
  }

  private async hasAdbKeyboard(serial: string): Promise<boolean> {
    const imeList = await this.shell(serial, ["ime", "list", "-s"], { timeoutMs: 5000 }).catch(() => "");
    return imeList.split(/\r?\n/).map((line) => line.trim()).includes(adbKeyboardIme);
  }

  private async inputTextWithAdbKeyboard(serial: string, text: string): Promise<void> {
    const originalIme = (await this.shell(serial, ["settings", "get", "secure", "default_input_method"], { timeoutMs: 5000 }).catch(() => "")).trim();
    const shouldRestoreIme = originalIme && originalIme !== "null" && originalIme !== adbKeyboardIme;
    if (shouldRestoreIme) {
      await this.shell(serial, ["ime", "set", adbKeyboardIme], { timeoutMs: 5000 });
      await this.sleep(250);
    }
    try {
      await this.shell(serial, ["am", "broadcast", "-a", "ADB_INPUT_TEXT", "--es", "msg", text], { timeoutMs: 5000 });
      await this.sleep(150);
    } finally {
      if (shouldRestoreIme) {
        await this.shell(serial, ["ime", "set", originalIme], { timeoutMs: 5000 }).catch(() => undefined);
      }
    }
  }

  private async clearTextWithAdbKeyboard(serial: string): Promise<boolean> {
    if (!(await this.hasAdbKeyboard(serial))) {
      return false;
    }
    const originalIme = (await this.shell(serial, ["settings", "get", "secure", "default_input_method"], { timeoutMs: 5000 }).catch(() => "")).trim();
    const shouldRestoreIme = originalIme && originalIme !== "null" && originalIme !== adbKeyboardIme;
    if (shouldRestoreIme) {
      await this.shell(serial, ["ime", "set", adbKeyboardIme], { timeoutMs: 5000 });
      await this.sleep(250);
    }
    try {
      await this.shell(serial, ["am", "broadcast", "-a", "ADB_CLEAR_TEXT"], { timeoutMs: 5000 });
      await this.sleep(150);
      return true;
    } catch {
      return false;
    } finally {
      if (shouldRestoreIme) {
        await this.shell(serial, ["ime", "set", originalIme], { timeoutMs: 5000 }).catch(() => undefined);
      }
    }
  }

  private async clearTextWithSelectAllDelete(serial: string): Promise<void> {
    await this.shell(serial, ["input", "keyevent", "KEYCODE_MOVE_END"]).catch(() => undefined);
    await this.shell(serial, ["input", "keyevent", "KEYCODE_CTRL_A"]).catch(() => undefined);
    await this.shell(serial, ["input", "keyevent", "KEYCODE_DEL"]);
    for (let index = 0; index < CLEAR_TEXT_DELETE_KEYEVENT_COUNT; index += 1) {
      await this.shell(serial, ["input", "keyevent", "KEYCODE_DEL"]);
    }
  }

  private async launchApp(serial: string, packageName: string): Promise<void> {
    const launcherActivities = await this.shell(serial, [
      "cmd",
      "package",
      "query-activities",
      "--brief",
      "-a",
      "android.intent.action.MAIN",
      "-c",
      "android.intent.category.LAUNCHER",
      packageName
    ]).catch(() => "");

    const component = pickLauncherComponent(launcherActivities, packageName);
    if (component) {
      assertAmStartSucceeded(await this.shell(serial, ["am", "start", "-n", component]));
      await this.waitForForegroundPackage(serial, packageName);
      return;
    }

    const resolvedActivity = await this.shell(serial, [
      "cmd",
      "package",
      "resolve-activity",
      "--brief",
      "-a",
      "android.intent.action.MAIN",
      "-c",
      "android.intent.category.LAUNCHER",
      packageName
    ]).catch(() => "");
    const resolvedComponent = pickLauncherComponent(resolvedActivity, packageName);
    if (resolvedComponent) {
      assertAmStartSucceeded(await this.shell(serial, ["am", "start", "-n", resolvedComponent]));
      await this.waitForForegroundPackage(serial, packageName);
      return;
    }

    const output = await this.shell(serial, [
      "am",
      "start",
      "-a",
      "android.intent.action.MAIN",
      "-c",
      "android.intent.category.LAUNCHER",
      "-p",
      packageName
    ]);
    assertAmStartSucceeded(output);
    await this.waitForForegroundPackage(serial, packageName);
  }

  private async waitForForegroundPackage(serial: string, packageName: string): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const activityState = await this.shell(serial, ["dumpsys", "activity", "activities"], { timeoutMs: 5000 }).catch(() => "");
      const resumedComponent = parseFocusedComponent(activityState);
      if (isForegroundComponentForPackage(resumedComponent, packageName)) {
        return;
      }

      const windowState = await this.shell(serial, ["dumpsys", "window", "windows"], { timeoutMs: 5000 }).catch(() => "");
      const focusedComponent = parseFocusedComponent(windowState);
      if (isForegroundComponentForPackage(focusedComponent, packageName)) {
        return;
      }

      await this.sleep(500);
    }
    throw new Error(`launch_app did not bring ${packageName} to foreground`);
  }

  private shell(serial: string, args: string[], options?: ExecTextOptions): Promise<string> {
    return this.options.shell(serial, args, options);
  }
}

function adbInputResult(): DeviceActionResult {
  return {
    driverChannel: "adb_input"
  };
}

function keyCodeForTextChar(char: string): string | undefined {
  if (/^[0-9]$/.test(char)) {
    return `KEYCODE_${char}`;
  }
  if (/^[a-zA-Z]$/.test(char)) {
    return `KEYCODE_${char.toUpperCase()}`;
  }
  if (char === " ") {
    return "KEYCODE_SPACE";
  }
  if (char === ".") {
    return "KEYCODE_PERIOD";
  }
  if (char === ",") {
    return "KEYCODE_COMMA";
  }
  if (char === "-") {
    return "KEYCODE_MINUS";
  }
  if (char === "\n") {
    return "KEYCODE_ENTER";
  }
  return undefined;
}

function semanticFallbackResult(action: SemanticDeviceActionRequest["type"], backend: AndroidActionBackend | undefined): DeviceActionResult {
  return {
    driverChannel: "adb_input",
    fallbackReason: backend ? "semantic_backend_action_unsupported" : "semantic_backend_unavailable",
    details: {
      requestedChannel: backend?.channel ?? "uiautomator2",
      semanticAction: action
    }
  };
}

function parseBackendResponseDetails(text: string): Record<string, unknown> | undefined {
  if (!text.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const value = "value" in parsed ? (parsed as { value?: unknown }).value : undefined;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {
      responseText: text
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
