import type { DeviceActionRequest, DeviceActionResult } from "@mobile-automation/shared";
import type { HarmonyShellExecutor } from "./harmony-discovery.js";
import { parseLaunchAbility } from "./harmony-parsers.js";

type HarmonyActionExecutorOptions = {
  shell: HarmonyShellExecutor;
  sleep?: (ms: number) => Promise<void>;
  abilityName?: (bundleName: string, serial: string) => string | Promise<string | undefined> | undefined;
};

const LAUNCH_SETTLE_MS = 4500;
const HARMONY_KEYCODE_A = "2017";
const HARMONY_KEYCODE_DEL = "2055";
const HARMONY_KEYCODE_CTRL_LEFT = "2072";
const HARMONY_KEYCODE_MOVE_END = "2082";
const CLEAR_TEXT_DELETE_KEYEVENT_COUNT = 40;

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
    if (action.type === "unlock") {
      await this.shell(serial, ["power-shell", "wakeup"]).catch(async () => {
        await this.shell(serial, ["uitest", "uiInput", "keyEvent", "Power"]);
      });
      return hdcInputResult();
    }
    if (action.type === "input_text" || action.type === "input_keyevents") {
      await this.shell(serial, ["uitest", "uiInput", "text", action.text]);
      return hdcInputResult();
    }
    if (action.type === "clear_text") {
      await this.clearText(serial);
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

  private async clearText(serial: string): Promise<void> {
    await this.shell(serial, ["uitest", "uiInput", "keyEvent", HARMONY_KEYCODE_MOVE_END]).catch(() => undefined);
    await this.shell(serial, ["uitest", "uiInput", "keyEvent", HARMONY_KEYCODE_CTRL_LEFT, HARMONY_KEYCODE_A]).catch(() => undefined);
    await this.shell(serial, ["uitest", "uiInput", "keyEvent", HARMONY_KEYCODE_DEL]);
    for (let index = 0; index < CLEAR_TEXT_DELETE_KEYEVENT_COUNT; index += 1) {
      await this.shell(serial, ["uitest", "uiInput", "keyEvent", HARMONY_KEYCODE_DEL]);
    }
  }

  private async launchApp(serial: string, bundleName: string): Promise<void> {
    const abilityName = await this.resolveAbilityName(serial, bundleName);
    const args = abilityName
      ? ["aa", "start", "-a", abilityName, "-b", bundleName]
      : ["aa", "start", "-b", bundleName];
    const output = await this.shell(serial, args, { timeoutMs: 15000 });
    throwIfLaunchFailed(output);
    await this.sleep(LAUNCH_SETTLE_MS);
  }

  private async resolveAbilityName(serial: string, bundleName: string): Promise<string | undefined> {
    const configuredAbilityName = await this.options.abilityName?.(bundleName, serial);
    if (configuredAbilityName?.trim()) {
      return configuredAbilityName.trim();
    }
    const bundleDump = await this.shell(serial, ["bm", "dump", "-n", bundleName], { timeoutMs: 10000 }).catch(() => "");
    return parseLaunchAbility(bundleDump);
  }

  private shell(serial: string, args: string[], options?: { timeoutMs?: number }): Promise<string> {
    return this.options.shell(serial, args, options);
  }
}

function throwIfLaunchFailed(output: string): void {
  const normalized = output.toLowerCase();
  if (normalized.includes("failed to start ability") || normalized.includes("error code:")) {
    throw new Error(output.trim() || "failed to start ability");
  }
}

function hdcInputResult(): DeviceActionResult {
  return { driverChannel: "hdc_input" };
}
