/**
 * Agent sub-agent spawning utilities.
 *
 * Handles spawn(), delegate(), delegateParallel(), removeChild(), and
 * pruneChildren() -- the sub-agent lifecycle within the agent tree.
 */

import type { AgentProfile, CostBreakdown } from "@chitragupta/core";
import type { ContentPart } from "@chitragupta/swara";

import type {
  AgentMessage,
  SpawnConfig,
} from "./types.js";
import { MAX_AGENT_DEPTH } from "./types.js";

// ─── Sub-Agent Prompt Host Interface ────────────────────────────────────────

/**
 * Minimal interface for building sub-agent prompts.
 * The real Agent class satisfies this interface.
 */
export interface SubAgentPromptHost {
  readonly purpose: string;
  readonly depth: number;
  getLineagePath(): string;
  buildDefaultSystemPrompt(profile: AgentProfile): string;
  getProfile(): AgentProfile;
}

// ─── Sub-Agent Prompt Builder ───────────────────────────────────────────────

/**
 * Build a system prompt for a sub-agent, including lineage context.
 */
export function buildSubAgentPrompt(
  host: SubAgentPromptHost,
  spawnConfig: SpawnConfig,
): string {
  const profile = spawnConfig.profile ?? host.getProfile();
  const base = host.buildDefaultSystemPrompt(profile);

  const lineagePath = host.getLineagePath();
  const context = [
    base,
    "",
    "--- Sub-Agent Context ---",
    `You are a sub-agent with purpose: "${spawnConfig.purpose}".`,
    `Lineage: ${lineagePath} > ${spawnConfig.purpose}`,
    `Depth: ${host.depth + 1} (max: ${MAX_AGENT_DEPTH})`,
    `Parent agent: "${host.purpose}" [${host.getProfile().id}]`,
    "",
    "You have access to the same tools as your parent.",
    "Focus on your specific purpose and return clear, actionable results.",
  ];

  return context.join("\n");
}

// ─── Cost Summation ─────────────────────────────────────────────────────────

/**
 * Sum costs from a child agent's messages.
 */
export function sumChildCosts(messages: readonly AgentMessage[]): CostBreakdown | null {
  let total: CostBreakdown | null = null;

  for (const msg of messages) {
    if (msg.cost) {
      if (!total) {
        total = { ...msg.cost };
      } else {
        total.input += msg.cost.input;
        total.output += msg.cost.output;
        total.total += msg.cost.total;
        if (msg.cost.cacheRead) total.cacheRead = (total.cacheRead ?? 0) + msg.cost.cacheRead;
        if (msg.cost.cacheWrite) total.cacheWrite = (total.cacheWrite ?? 0) + msg.cost.cacheWrite;
      }
    }
  }

  return total;
}

// ─── Message Extraction Helpers ─────────────────────────────────────────────

/**
 * Extract plain text content from an AgentMessage.
 */
export function extractTextFromMessage(msg: AgentMessage): string {
  const texts: string[] = [];
  for (const part of msg.content) {
    if (part.type === "text") {
      texts.push(part.text);
    }
  }
  return texts.join("\n");
}

/**
 * Extract tool call data from an AgentMessage for memory recording.
 * Pairs tool_call parts with their corresponding tool_result parts
 * from the conversation history.
 */
export function extractToolCallsFromMessage(
  msg: AgentMessage,
  allMessages: readonly AgentMessage[],
): Array<{ name: string; input: string; result: string; isError?: boolean }> {
  const calls: Array<{ name: string; input: string; result: string; isError?: boolean }> = [];

  for (const part of msg.content) {
    if (part.type === "tool_call") {
      // Find the matching tool_result in subsequent messages
      let resultContent = "";
      let isError = false;

      for (const m of allMessages) {
        for (const p of m.content) {
          if (p.type === "tool_result" && p.toolCallId === part.id) {
            resultContent = p.content;
            isError = p.isError ?? false;
          }
        }
      }

      calls.push({
        name: part.name,
        input: part.arguments,
        result: resultContent,
        isError: isError || undefined,
      });
    }
  }

  return calls;
}

/**
 * Find the last assistant message in a conversation history.
 */
export function findLastAssistantMessage(messages: readonly AgentMessage[]): AgentMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      return messages[i];
    }
  }
  return undefined;
}

/**
 * Merge consecutive text parts into a single text content part.
 */
export function mergeTextParts(parts: ContentPart[]): ContentPart[] {
  const merged: ContentPart[] = [];
  let pendingText = "";

  for (const part of parts) {
    if (part.type === "text") {
      pendingText += part.text;
    } else {
      if (pendingText) {
        merged.push({ type: "text", text: pendingText });
        pendingText = "";
      }
      merged.push(part);
    }
  }

  if (pendingText) {
    merged.push({ type: "text", text: pendingText });
  }

  return merged;
}
