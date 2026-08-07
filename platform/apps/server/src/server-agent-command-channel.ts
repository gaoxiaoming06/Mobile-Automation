import { WebSocket } from "ws";
import type { AgentCommandChannelMessage } from "@mobile-automation/shared";
import type { ServerAgentRegistry } from "./server-agent-registry.js";

export type AgentCommandChannelHandle = {
  close(): void;
};

export function attachAgentCommandSocket(input: {
  registry: ServerAgentRegistry;
  agentId: string;
  socket: WebSocket;
  batchSize?: number;
}): AgentCommandChannelHandle {
  const batchSize = input.batchSize ?? 100;
  let closed = false;
  let flushing = false;
  let flushAgain = false;

  const flush = () => {
    if (closed) {
      return;
    }
    if (flushing) {
      flushAgain = true;
      return;
    }
    flushing = true;
    try {
      if (input.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const commands = input.registry.takePendingCommands(input.agentId, batchSize);
      if (commands.length) {
        sendJson(input.socket, { type: "commands", commands });
      }
    } catch (error) {
      sendJson(input.socket, {
        type: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      flushing = false;
      if (flushAgain) {
        flushAgain = false;
        queueMicrotask(flush);
      }
    }
  };

  const unsubscribe = input.registry.subscribeAgentCommands(input.agentId, flush);
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    unsubscribe();
  };
  input.socket.once("close", close);
  input.socket.once("error", close);
  flush();
  return { close };
}

function sendJson(socket: WebSocket, message: AgentCommandChannelMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}
