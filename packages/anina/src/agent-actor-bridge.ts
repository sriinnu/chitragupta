/**
 * Agent-Actor Bridge — connects Agent instances to the Sutra P2P actor mesh.
 *
 * Wraps an Agent as an ActorBehavior so it can receive messages via the mesh
 * and translate them into Agent method calls (prompt, steer, abort, status).
 *
 * Named convention: Setu (सेतु — bridge) — the bridge between the agent's
 * inner world and the mesh's outer world.
 */

import { createLogger } from "@chitragupta/core";
import type { MeshActorBehavior, MeshActorContextCompat, MeshEnvelopeCompat } from "./types.js";

const log = createLogger("anina:agent-actor-bridge");

/** Minimal handle for an agent in the mesh. Only `id` is required at spawn time. */
export interface AgentBehaviorHandle {
  readonly id: string;
  prompt?(text: string): Promise<{ content: readonly unknown[] }>;
  steer?(text: string): void;
  abort?(): void;
  getStatus?(): string;
  getMessages?(): readonly unknown[];
  delegate?(config: Record<string, unknown> & { purpose: string }, text: string): Promise<{ agentId: string; response: { content: readonly unknown[] }; status: string }>;
}

// ─── Message Protocol ───────────────────────────────────────────────────────

/** Messages the bridge understands when received via the mesh. */
export type AgentMeshMessage =
  | { type: "prompt"; text: string }
  | { type: "steer"; text: string }
  | { type: "abort" }
  | { type: "status" }
  | { type: "delegate"; purpose: string; text: string }
  | { type: "ping" };

/** Replies sent back through the mesh. */
export type AgentMeshReply =
  | { type: "prompt:result"; agentId: string; text: string; status: string }
  | { type: "prompt:error"; agentId: string; error: string }
  | { type: "status:result"; agentId: string; status: string; messageCount: number }
  | { type: "delegate:result"; agentId: string; childId: string; text: string; status: string }
  | { type: "delegate:error"; agentId: string; error: string }
  | { type: "pong"; agentId: string; timestamp: number }
  | { type: "error"; agentId: string; error: string };

// ─── Bridge ─────────────────────────────────────────────────────────────────

/**
 * Create an ActorBehavior that wraps an Agent instance.
 *
 * The behavior translates incoming MeshEnvelope messages into Agent method
 * calls and sends replies back through the mesh.
 *
 * @param agent - The Agent instance to wrap.
 * @returns An ActorBehavior suitable for ActorSystem.spawn().
 */
export function createAgentBehavior(agent: AgentBehaviorHandle): MeshActorBehavior {
  return async (envelope: MeshEnvelopeCompat, ctx: MeshActorContextCompat): Promise<void> => {
    const msg = envelope.payload as AgentMeshMessage;
    if (!msg || typeof msg !== "object" || !("type" in msg)) {
      ctx.reply({ type: "error", agentId: agent.id, error: "Invalid message format" } satisfies AgentMeshReply);
      return;
    }

    try {
      switch (msg.type) {
        case "prompt": {
          if (!agent.prompt) {
            ctx.reply({ type: "prompt:error", agentId: agent.id, error: "Agent does not support prompt" } satisfies AgentMeshReply);
            break;
          }
          log.debug("mesh:prompt received", { agentId: agent.id, from: envelope.from });
          const result = await agent.prompt(msg.text);
          const text = result.content
            .filter((p): p is { type: "text"; text: string } => typeof p === "object" && p !== null && (p as { type?: string }).type === "text")
            .map((p) => p.text)
            .join("");
          ctx.reply({
            type: "prompt:result",
            agentId: agent.id,
            text,
            status: agent.getStatus?.() ?? "unknown",
          } satisfies AgentMeshReply);
          break;
        }

        case "steer": {
          agent.steer?.(msg.text);
          if (envelope.type === "ask") {
            ctx.reply({ type: "status:result", agentId: agent.id, status: agent.getStatus?.() ?? "unknown", messageCount: agent.getMessages?.().length ?? 0 } satisfies AgentMeshReply);
          }
          break;
        }

        case "abort": {
          agent.abort?.();
          if (envelope.type === "ask") {
            ctx.reply({ type: "status:result", agentId: agent.id, status: "aborted", messageCount: agent.getMessages?.().length ?? 0 } satisfies AgentMeshReply);
          }
          break;
        }

        case "status": {
          ctx.reply({
            type: "status:result",
            agentId: agent.id,
            status: agent.getStatus?.() ?? "unknown",
            messageCount: agent.getMessages?.().length ?? 0,
          } satisfies AgentMeshReply);
          break;
        }

        case "delegate": {
          if (!agent.delegate) {
            ctx.reply({ type: "delegate:error", agentId: agent.id, error: "Agent does not support delegate" } satisfies AgentMeshReply);
            break;
          }
          log.debug("mesh:delegate received", { agentId: agent.id, purpose: msg.purpose, from: envelope.from });
          const result = await agent.delegate({ purpose: msg.purpose }, msg.text);
          const text = result.response.content
            .filter((p): p is { type: "text"; text: string } => typeof p === "object" && p !== null && (p as { type?: string }).type === "text")
            .map((p) => p.text)
            .join("");
          ctx.reply({
            type: "delegate:result",
            agentId: agent.id,
            childId: result.agentId,
            text,
            status: result.status,
          } satisfies AgentMeshReply);
          break;
        }

        case "ping": {
          ctx.reply({
            type: "pong",
            agentId: agent.id,
            timestamp: Date.now(),
          } satisfies AgentMeshReply);
          break;
        }

        default: {
          ctx.reply({
            type: "error",
            agentId: agent.id,
            error: `Unknown message type: ${(msg as { type: string }).type}`,
          } satisfies AgentMeshReply);
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("agent-actor-bridge error", { agentId: agent.id, messageType: msg.type, error });

      if (msg.type === "prompt") {
        ctx.reply({ type: "prompt:error", agentId: agent.id, error } satisfies AgentMeshReply);
      } else if (msg.type === "delegate") {
        ctx.reply({ type: "delegate:error", agentId: agent.id, error } satisfies AgentMeshReply);
      } else {
        ctx.reply({ type: "error", agentId: agent.id, error } satisfies AgentMeshReply);
      }
    }
  };
}

/**
 * Helper to check if a payload is a valid AgentMeshMessage.
 */
export function isAgentMeshMessage(payload: unknown): payload is AgentMeshMessage {
  if (!payload || typeof payload !== "object" || !("type" in payload)) return false;
  const msg = payload as { type: string };
  return ["prompt", "steer", "abort", "status", "delegate", "ping"].includes(msg.type);
}
