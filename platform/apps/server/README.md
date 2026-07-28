# Server

Node.js + TypeScript backend for device orchestration, PageAsset recognition, ScriptFlow execution, artifacts, metrics and reports.

## AI model

The AI model is optional and is used for page draft assistance and ScriptFlow draft generation. It never executes device actions directly.

Configure it in Dashboard -> System Settings -> AI Model, or with environment variables:

- `AI_MODEL_ENABLED=true`
- `AI_MODEL_BASE_URL`
- `AI_MODEL_API_KEY`
- `AI_MODEL_NAME`
- `AI_MODEL_TIMEOUT_MS`, default `30000`

The endpoint must provide an OpenAI-compatible `/chat/completions` API.
