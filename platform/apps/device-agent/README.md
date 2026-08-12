# Device Agent

Local Node.js process that connects physical Android, iOS, and HarmonyOS devices to a Mobile Automation server.

The agent discovers devices with the platform drivers, reports tool health and capabilities, receives server commands, and executes screenshots, UI hierarchy dumps, actions, app lifecycle, logs, metrics, Android realtime stream startup, and the opt-in experimental HarmonyOS stream bridge. Public devices use `DEVICE_AGENT_SHARED=1`; private local devices can be attached to one browser session with a pairing code.

## Start

```bash
DEVICE_AGENT_SERVER_URL=http://127.0.0.1:4010 \
DEVICE_AGENT_ID=my-macbook \
DEVICE_AGENT_SHARED=1 \
pnpm agent
```

For local HTTPS development and LAN browser access, use the root script:

```bash
pnpm agent:https
```

That script connects to `https://127.0.0.1:4010`, sets `DEVICE_AGENT_SHARED=1`, and disables certificate verification for the local self-signed certificate.

HarmonyOS dashboard preview currently uses screenshots. To test the experimental HarmonyOS stream bridge directly, start the Agent with `HARMONY_STREAM_ENABLED=1`.

For private local use on a host without this repository, open **系统设置 > 设备接入** in the dashboard, generate a private command, then run the generated command:

```bash
curl -kfsSL https://<server>/agent/install.sh?server=https%3A%2F%2F<server> | bash -s -- --agent-id "$(hostname)" --pairing-code <code> --insecure-tls
```

For public sharing, copy the public-device-pool command from the same settings panel or start from source with `DEVICE_AGENT_SHARED=1`. The packaged command starts a local control service at `http://127.0.0.1:17611`; keep the terminal open, then use the settings panel to switch mode, reconnect, update, or disconnect the managed Agent runtime.
