# Server

Node.js + TypeScript backend for Device Agent relay, PageAsset recognition, ScriptFlow execution, AI draft/repair, trial learning, artifacts, metrics, and reports.

The server owns REST/WebSocket APIs, SQLite-backed storage, artifact cleanup, OCR sidecars, ScriptFlow planning, run orchestration, and HTML report serving. Device-specific work runs behind the Agent command channel; the server does not require direct USB access to devices.

## AI model

The AI model is optional and is used for page draft assistance and ScriptFlow draft generation. It never executes device actions directly.

Configure it in Dashboard -> System Settings -> AI Model, or with environment variables:

- `AI_MODEL_ENABLED=true`
- `AI_MODEL_BASE_URL`
- `AI_MODEL_API_KEY`
- `AI_MODEL_NAME`
- `AI_MODEL_TIMEOUT_MS`, default `30000`

The endpoint must provide an OpenAI-compatible `/chat/completions` API.
