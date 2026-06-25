# iOS Driver

Incremental iOS driver for the Mobile Automation platform.

## Current Scope

- Tool status detection for `idevice_id`, `ideviceinfo`, `idevicescreenshot`, `ideviceimagemounter`, `xcrun`, and reachable WebDriverAgent endpoints.
- Physical device discovery from `idevice_id --list` and `xcrun xctrace list devices`.
- Host Mac and simulator entries are filtered out of the dashboard device list.
- Screenshot preview for online, trusted, unlocked iOS physical devices through `idevicescreenshot`.
- Battery level sampling through `ideviceinfo`.
- WDA-backed actions when an endpoint is reachable:
  - tap
  - long press
  - swipe
  - home
  - input text
  - launch app
  - close app

## Setup

```bash
brew install libimobiledevice
idevice_id --list
```

The device must be trusted and available to the host. Screenshot capture may require the device to be unlocked and developer services to be available.
If `idevicescreenshot` reports that the `screenshotr` service is unavailable, mount the matching iOS Developer Disk Image for the device OS version or use WDA screenshot fallback.

For control, run WebDriverAgent for the target device. The driver tries the common local endpoint by default:

```bash
curl http://localhost:8100/status
```

If WDA is reachable there, the dashboard enables iOS tap/swipe/home/input controls automatically.

Set a global endpoint when WDA is exposed on a different URL:

```bash
export IOS_WDA_URL=http://localhost:8100
```

or a UDID-specific endpoint:

```bash
export IOS_WDA_URL_00008020_000260113E04002E=http://localhost:8100
```

Non-alphanumeric UDID characters are converted to underscores and uppercased for the environment variable name.

Automatic localhost detection can be disabled when a deployment should only trust explicit configuration:

```bash
export IOS_WDA_AUTODETECT=0
```

## Known Gaps

- Native iOS video recording is not implemented yet.
- Crash, ANR-equivalent, and full log collection are not implemented yet.
- Back action is not exposed because iOS has no universal system back command.
- Simulators are intentionally not listed in the physical device dashboard path yet.
