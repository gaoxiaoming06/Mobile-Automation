# Server

Planned Node.js + TypeScript backend.

Responsibilities:

- REST API.
- WebSocket events.
- Device orchestration and locks.
- Driver integration.
- Recorder and runner coordination.
- Metrics, events, artifacts, and reports.

## AI Diagnosis

AI diagnosis is disabled by default. When enabled, it only runs after an automation run has already failed; normal PageStateFlow planning and device actions remain rule-driven.

It can be configured from Dashboard -> System Settings -> AI Diagnosis. Saved dashboard settings take effect on the next failed run without restarting the server and override environment defaults. Environment variables remain a fallback when no dashboard settings have been saved.

Environment variables:

- `AI_DIAGNOSIS_ENABLED=true`
- `AI_MODEL_BASE_URL` or `MIDSCENE_MODEL_BASE_URL`
- `AI_MODEL_API_KEY` or `MIDSCENE_MODEL_API_KEY` or `OPENAI_API_KEY`
- `AI_MODEL_NAME` or `MIDSCENE_MODEL_NAME`
- `AI_DIAGNOSIS_TIMEOUT_MS` defaults to `30000`

The model endpoint is expected to be OpenAI-compatible at `/chat/completions`. Diagnosis evidence is redacted before being sent, and the result is stored as an `ai-diagnosis-*.json` run artifact plus an `ai_diagnosis` event in the report.
