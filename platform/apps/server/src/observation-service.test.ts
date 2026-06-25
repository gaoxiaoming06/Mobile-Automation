import { describe, expect, it } from "vitest";
import { defaultAndroidCapabilities, nowIso, type DeviceActionRequest, type DeviceActionResult, type DeviceInfo, type MetricSample, type ToolStatus } from "@mobile-automation/shared";
import type { AutomationDeviceDriver, MobileVideoRecording } from "./mobile-driver.js";
import type { OcrInput, OcrLayoutResult, OcrResult, OcrService } from "./ocr.js";
import { ObservationService } from "./observation-service.js";

const hierarchy = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="进入课堂" resource-id="com.demo:id/join_class" class="android.widget.Button" package="com.demo" content-desc="进入课堂按钮" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[120,200][360,280]" />
  </node>
</hierarchy>`;

describe("ObservationService", () => {
  it("collects foreground state, screenshot metadata, UI tree elements, and OCR boxes", async () => {
    const service = new ObservationService(new FakeDriver(), new FakeOcrService());

    const observation = await service.collect("device-1");

    expect(observation.platform).toBe("android");
    expect(observation.packageName).toBe("com.demo");
    expect(observation.activityName).toBe("com.demo.HomeActivity");
    expect(observation.componentName).toBe("com.demo/com.demo.HomeActivity");
    expect(observation.resolution).toEqual({ width: 1080, height: 2400 });
    expect(observation.screenshot).toEqual(expect.objectContaining({ sizeBytes: expect.any(Number), width: 1080, height: 2400 }));
    expect(observation.uiElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "com.demo:id/join_class",
          text: "进入课堂",
          accessibilityId: "进入课堂按钮",
          bounds: {
            x: 120,
            y: 200,
            width: 240,
            height: 80
          }
        })
      ])
    );
    expect(observation.ocrTexts).toEqual([
      {
        text: "全部班级",
        confidence: 0.97,
        source: "ocr",
        region: {
          x: 10,
          y: 20,
          width: 120,
          height: 40
        }
      }
    ]);
  });

  it("can skip expensive OCR collection", async () => {
    const service = new ObservationService(new FakeDriver(), new ThrowingOcrService());

    const observation = await service.collect("device-1", { includeOcr: false });

    expect(observation.ocrTexts).toEqual([]);
    expect(observation.uiElements).toHaveLength(2);
  });

  it("continues collecting screenshot and OCR when Android UI hierarchy dump fails", async () => {
    const service = new ObservationService(new FailingUiTreeDriver(), new FakeOcrService());

    const observation = await service.collect("device-1");

    expect(observation.platform).toBe("android");
    expect(observation.packageName).toBe("com.demo");
    expect(observation.screenshot).toEqual(expect.objectContaining({ sizeBytes: expect.any(Number), width: 1080, height: 2400 }));
    expect(observation.uiElements).toEqual([]);
    expect(observation.ocrTexts).toEqual([expect.objectContaining({ text: "全部班级" })]);
    expect(observation.raw?.uiHierarchyError).toContain("uiautomator dump failed");
  });
});

class FakeDriver implements AutomationDeviceDriver {
  private readonly device: DeviceInfo = {
    id: "device-1",
    serial: "device-1",
    platform: "android",
    name: "Mock Android",
    resolution: {
      width: 1080,
      height: 2400
    },
    orientation: "portrait",
    status: "online",
    capabilities: defaultAndroidCapabilities(),
    lastSeenAt: nowIso()
  };

  async getToolStatus(): Promise<ToolStatus[]> {
    return [];
  }

  async listDevices(): Promise<DeviceInfo[]> {
    return [this.device];
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    return this.device;
  }

  async screenshot(): Promise<Buffer> {
    return Buffer.from("png");
  }

  async getForegroundApp(): Promise<{ packageName?: string; activityName?: string; componentName?: string }> {
    return {
      packageName: "com.demo",
      activityName: "com.demo.HomeActivity",
      componentName: "com.demo/com.demo.HomeActivity"
    };
  }

  async dumpUiHierarchy(): Promise<string> {
    return hierarchy;
  }

  async performAction(_serial: string, _action: DeviceActionRequest): Promise<DeviceActionResult> {
    return { driverChannel: "mock" };
  }

  async clearAppData(): Promise<void> {
    return undefined;
  }

  async collectLogs(): Promise<string> {
    return "";
  }

  async samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample> {
    return {
      id: "metric-1",
      runId,
      stepResultId,
      deviceSerial: serial,
      sampledAt: nowIso()
    };
  }

  async startVideoRecording(_serial: string, _runId: string, _localDir: string): Promise<MobileVideoRecording> {
    return {
      id: "recording-1",
      serial: "device-1",
      localPath: "/tmp/video.mp4",
      startedAt: nowIso()
    };
  }

  async stopVideoRecording(_recording: MobileVideoRecording, _keep: boolean): Promise<string | undefined> {
    return undefined;
  }
}

class FailingUiTreeDriver extends FakeDriver {
  override async dumpUiHierarchy(): Promise<string> {
    throw new Error("uiautomator dump failed");
  }
}

class FakeOcrService implements OcrService {
  async recognize(_input: OcrInput): Promise<OcrResult> {
    return {
      text: "全部班级",
      engine: "fake",
      lang: "chi_sim"
    };
  }

  async locateText(_input: OcrInput): Promise<OcrLayoutResult> {
    return {
      text: "全部班级",
      engine: "fake",
      lang: "chi_sim",
      width: 1080,
      height: 2400,
      boxes: [
        {
          text: "全部班级",
          confidence: 0.97,
          x: 10,
          y: 20,
          width: 120,
          height: 40
        }
      ]
    };
  }
}

class ThrowingOcrService implements OcrService {
  async recognize(_input: OcrInput): Promise<OcrResult> {
    throw new Error("OCR should not be called");
  }
}
