import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import screenStreamer from 'libscreenstreamer.so';

const DOMAIN = 0x4d4153;
const TAG = 'ScreenStreamer';
const DEVICE_PORT = 28282;
const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 15;
const BITRATE = 1200000;

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    hilog.info(DOMAIN, TAG, 'Ability created');
  }

  onDestroy(): void {
    screenStreamer.stop();
    hilog.info(DOMAIN, TAG, 'Ability destroyed');
  }

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    super.onNewWant(want, launchParam);
    this.ensureStreamerStarted('new want');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'loadContent failed: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, TAG, 'UI loaded');
    });

    this.ensureStreamerStarted('window stage');
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, TAG, 'Window stage destroyed');
  }

  onForeground(): void {
    this.ensureStreamerStarted('foreground');
    hilog.info(DOMAIN, TAG, 'Ability foreground');
  }

  onBackground(): void {
    hilog.info(DOMAIN, TAG, 'Ability background');
  }

  private ensureStreamerStarted(reason: string): void {
    try {
      const started = screenStreamer.start(DEVICE_PORT, WIDTH, HEIGHT, FPS, BITRATE);
      hilog.info(DOMAIN, TAG, 'streamer start result: %{public}s (%{public}s)', String(started), reason);
    } catch (error) {
      hilog.error(DOMAIN, TAG, 'streamer start failed: %{public}s', JSON.stringify(error));
    }
  }
}
