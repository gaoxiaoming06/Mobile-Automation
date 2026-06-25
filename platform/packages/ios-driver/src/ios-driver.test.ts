import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultIosCapabilities } from "@mobile-automation/shared";
import { IosDriver, iosWdaEnvKey, parseDevicectlDisplays, parseXctraceDevices, wdaEndpointFor } from "./index.js";

const wdaEnvKeys = [
  "IOS_WDA_URL",
  "IOS_WDA_DEFAULT_URL",
  "IOS_WDA_AUTODETECT",
  "IOS_WDA_URL_00008020_000260113E04002E",
  "IOS_WDA_URL_IOS_DEVICE"
];

afterEach(() => {
  for (const key of wdaEnvKeys) {
    delete process.env[key];
  }
  vi.unstubAllGlobals();
});

describe("iOS capabilities", () => {
  it("requires WDA before enabling control actions", () => {
    const previewOnly = defaultIosCapabilities({ screenshot: true, control: false });

    expect(previewOnly.preview).toBe(true);
    expect(previewOnly.screenshot).toBe(true);
    expect(previewOnly.tap).toBe(false);
    expect(previewOnly.swipe).toBe(false);
  });

  it("enables direct actions when WDA is configured", () => {
    const controlled = defaultIosCapabilities({ screenshot: true, control: true });

    expect(controlled.tap).toBe(true);
    expect(controlled.swipe).toBe(true);
    expect(controlled.home).toBe(true);
    expect(controlled.recentApps).toBe(false);
  });
});

describe("xctrace device parsing", () => {
  it("keeps physical iOS devices and filters the host Mac", () => {
    const devices = parseXctraceDevices(`
== Devices ==
eeo's MacBook Pro (6D29AF3B-0292-5F9F-9CCC-C47FB98FB70D)

== Devices Offline ==
iOS组-iphoneXSMax (18.7.9) (00008020-000260113E04002E)

== Simulators ==
iPhone 16 Simulator (18.5) (91A54FC7-AD26-4AC2-A998-A0D6B445116A)
`);

    expect(devices).toEqual([
      {
        name: "iOS组-iphoneXSMax",
        osVersion: "18.7.9",
        serial: "00008020-000260113E04002E",
        status: "offline"
      }
    ]);
  });

  it("accepts named online iPhone and iPad devices", () => {
    const devices = parseXctraceDevices(`
== Devices ==
Alice's iPhone (18.5) (00008110-001C195E34A8001E)
QA iPad (18.4) (00008030-001D2D0C3610802E)
`);

    expect(devices.map((device) => device.name)).toEqual(["Alice's iPhone", "QA iPad"]);
    expect(devices.every((device) => device.status === "online")).toBe(true);
  });
});

describe("devicectl display parsing", () => {
  it("extracts primary display resolution and orientation", () => {
    const display = parseDevicectlDisplays(`{
      "result": {
        "displays": [
          {
            "nativeSize": [1242, 2688],
            "primary": true
          }
        ],
        "orientation": {
          "currentDeviceOrientation": "portrait"
        }
      }
    }`);

    expect(display).toEqual({
      resolution: { width: 1242, height: 2688 },
      orientation: "portrait"
    });
  });
});

describe("iOS WDA endpoint resolution", () => {
  it("sanitizes UDID-specific environment variable names", () => {
    expect(iosWdaEnvKey("00008020-000260113E04002E")).toBe("IOS_WDA_URL_00008020_000260113E04002E");
  });

  it("prefers device-specific WDA URL over the global URL", () => {
    process.env.IOS_WDA_URL = "http://localhost:8100";
    process.env.IOS_WDA_URL_00008020_000260113E04002E = "http://localhost:8200";

    expect(wdaEndpointFor("00008020-000260113E04002E")).toEqual({
      url: "http://localhost:8200",
      configuredBy: "env"
    });
  });

  it("auto-detects the common localhost WDA port unless disabled", () => {
    expect(wdaEndpointFor("ios-device")).toEqual({
      url: "http://localhost:8100",
      configuredBy: "auto"
    });

    process.env.IOS_WDA_AUTODETECT = "0";
    expect(wdaEndpointFor("ios-device")).toBeUndefined();
  });
});

describe("iOS fallback actions", () => {
  it("treats Android-style back as a no-op", async () => {
    const driver = new IosDriver();

    await expect(driver.performAction("ios-device", { type: "back" })).resolves.toBeUndefined();
  });

  it("does not emit placeholder text for unsupported log collection", async () => {
    const driver = new IosDriver();

    await expect(driver.collectLogs("ios-device")).resolves.toBe("");
  });
});

describe("iOS WDA actions", () => {
  it("creates a WDA session and sends tap commands", async () => {
    process.env.IOS_WDA_URL = "http://localhost:8100";
    const requests: Array<{ pathname: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = new URL(String(input));
        requests.push({
          pathname: url.pathname,
          body: init?.body ? JSON.parse(String(init.body)) : undefined
        });
        if (url.pathname === "/session") {
          return new Response(JSON.stringify({ value: { sessionId: "session-1" } }), { status: 200 });
        }
        return new Response(JSON.stringify({ value: {} }), { status: 200 });
      })
    );

    const driver = new IosDriver();
    await driver.performAction("ios-device", { type: "tap", x: 12, y: 34 });

    expect(requests).toEqual([
      { pathname: "/status", body: undefined },
      { pathname: "/session", body: { capabilities: {} } },
      { pathname: "/session/session-1/wda/tap/0", body: { x: 12, y: 34 } }
    ]);
  });
});
