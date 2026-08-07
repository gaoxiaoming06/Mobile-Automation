import type express from "express";
import type { AgentCommandResultEnvelope } from "@mobile-automation/shared";
import type { ServerAgentRegistry } from "./server-agent-registry.js";

export type ServerAgentApiDeps = {
  registry: ServerAgentRegistry;
};

export function registerServerAgentRoutes(app: express.Express, deps: ServerAgentApiDeps): void {
  app.get("/api/agents", (_req, res) => {
    res.json({ agents: deps.registry.listAgents() });
  });

  app.post("/api/agents/register", (req, res) => {
    try {
      const result = deps.registry.registerAgent(req.body ?? {});
      res.status(201).json(result);
    } catch (error) {
      sendAgentApiError(res, error);
    }
  });

  app.post("/api/agents/:agentId/heartbeat", (req, res) => {
    try {
      res.json(deps.registry.heartbeat(req.params.agentId, req.body ?? {}));
    } catch (error) {
      sendAgentApiError(res, error);
    }
  });

  app.get("/api/agents/:agentId/commands", (req, res) => {
    try {
      res.json({ commands: deps.registry.takePendingCommands(req.params.agentId, req.query.limit) });
    } catch (error) {
      sendAgentApiError(res, error);
    }
  });

  app.post("/api/agents/:agentId/commands/:requestId/result", (req, res) => {
    try {
      const result = deps.registry.completeCommand(
        req.params.agentId,
        req.params.requestId,
        commandResultBody(req.body)
      );
      res.json({ accepted: true, result });
    } catch (error) {
      sendAgentApiError(res, error);
    }
  });

  app.post("/api/local-sessions/pairing-codes", (req, res) => {
    try {
      res.status(201).json({ pairing: deps.registry.createPairingCode(req.body ?? {}) });
    } catch (error) {
      sendAgentApiError(res, error);
    }
  });

  app.get("/api/agent-devices", (req, res) => {
    try {
      res.json({
        devices: deps.registry.listVisibleDevices({
          sessionId: singleQueryValue(req.query.sessionId),
          includeOffline: readBooleanQuery(req.query.includeOffline, false)
        })
      });
    } catch (error) {
      sendAgentApiError(res, error);
    }
  });

  app.get("/api/agent-devices/:deviceKey/leases", (req, res) => {
    try {
      res.json({ leases: deps.registry.listDeviceLeases(req.params.deviceKey) });
    } catch (error) {
      sendAgentApiError(res, error);
    }
  });

  app.post("/api/agent-devices/:deviceKey/leases", (req, res) => {
    try {
      res.status(201).json({
        lease: deps.registry.acquireDeviceLease({
          ...recordValue(req.body),
          deviceKey: req.params.deviceKey
        })
      });
    } catch (error) {
      sendAgentApiError(res, error);
    }
  });

  app.delete("/api/agent-devices/:deviceKey/leases/:leaseId", (req, res) => {
    try {
      res.json({
        released: deps.registry.releaseDeviceLease({
          deviceKey: req.params.deviceKey,
          leaseId: req.params.leaseId,
          ownerId: recordValue(req.body)?.ownerId
        })
      });
    } catch (error) {
      sendAgentApiError(res, error);
    }
  });

  app.get("/api/agent-devices/:deviceKey/info", async (req, res) => {
    try {
      const result = await deps.registry.sendCommand(req.params.deviceKey, "getDeviceInfo");
      res.json({ result });
    } catch (error) {
      sendAgentApiError(res, error);
    }
  });

  app.get("/api/agent-devices/:deviceKey/screenshot", async (req, res) => {
    try {
      const result = await deps.registry.sendCommand(req.params.deviceKey, "screenshot");
      const dataBase64 = result.dataBase64 ?? stringFromResult(result.result, "dataBase64")
        ?? stringFromResult(result.result, "imageBase64")
        ?? stringFromResult(result.result, "pngBase64");
      if (!dataBase64) {
        throw new Error("Agent screenshot response did not include dataBase64");
      }
      res.setHeader("Content-Type", result.contentType ?? "image/png");
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.send(Buffer.from(dataBase64, "base64"));
    } catch (error) {
      sendAgentApiError(res, error);
    }
  });

  app.get("/api/agent-devices/:deviceKey/ui-hierarchy", async (req, res) => {
    try {
      const result = await deps.registry.sendCommand(req.params.deviceKey, "dumpUiHierarchy");
      const xml = typeof result.result === "string" ? result.result : stringFromResult(result.result, "uiHierarchyXml") ?? stringFromResult(result.result, "xml");
      if (!xml) {
        throw new Error("Agent UI hierarchy response did not include uiHierarchyXml");
      }
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.send(xml);
    } catch (error) {
      sendAgentApiError(res, error);
    }
  });
}

function commandResultBody(body: unknown): AgentCommandResultEnvelope {
  const input = recordValue(body);
  if (!input) {
    throw new Error("command result body is required");
  }
  return {
    ok: input.ok === true,
    result: input.result,
    error: typeof input.error === "string" ? input.error : undefined,
    dataBase64: typeof input.dataBase64 === "string" ? input.dataBase64 : undefined,
    contentType: typeof input.contentType === "string" ? input.contentType : undefined
  };
}

function stringFromResult(result: unknown, key: string): string | undefined {
  const record = recordValue(result);
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function singleQueryValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function readBooleanQuery(value: unknown, fallback: boolean): boolean {
  const raw = singleQueryValue(value);
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return fallback;
}

function sendAgentApiError(res: express.Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.includes("not found") || message.includes("not belong") ? 404 : 400;
  res.status(status).json({ error: message });
}
