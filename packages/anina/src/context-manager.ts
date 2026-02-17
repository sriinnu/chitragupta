/**
 * ContextManager -- builds and compacts the LLM context from agent state.
 *
 * Responsible for converting AgentState into a Context object that can be
 * sent to a provider, and for compacting the message history when it grows
 * too large for the model's context window.
 *
 * Supports three compaction tiers:
 *   - Soft   (60-75% full): collapse tool call details, keep summaries
 *   - Medium (75-90% full): summarize old turns, keep last 10 intact
 *   - Hard   (>90% full):   full LLM summarization, keep last 5 intact
 *
 * When an Ollama endpoint is reachable the Hard tier uses LLM-powered
 * summarization; otherwise it falls back to an improved heuristic
 * extraction that preserves decisions, file paths, and code snippets.
 */

import type { Context, Message } from "@chitragupta/swara";
import type { AgentState, AgentMessage } from "./types.js";

import {
  estimateTotalTokens,
  extractText,
  smartExtract,
  collapseToolDetails,
  summariseToolPatterns,
  isOllamaAvailable,
  ollamaGenerate,
  buildSummarisationPrompt,
  DEFAULT_OLLAMA_ENDPOINT,
} from "./context-compaction.js";

// ─── Compaction Configuration ────────────────────────────────────────────────

/** Configurable compaction thresholds and retention limits. */
export interface CompactionConfig {
	keepRecent?: number;
	softThreshold?: number;
	mediumThreshold?: number;
	hardThreshold?: number;
	mediumKeep?: number;
	hardKeep?: number;
}

export const DEFAULT_COMPACTION_CONFIG: Required<CompactionConfig> = {
	keepRecent: 20,
	softThreshold: 0.60,
	mediumThreshold: 0.75,
	hardThreshold: 0.90,
	mediumKeep: 10,
	hardKeep: 5,
};

// ─── Compaction tier enum ───────────────────────────────────────────────────

export type CompactionTier = "none" | "soft" | "medium" | "hard";

// ─── Helpers: role mapping ──────────────────────────────────────────────────

/**
 * Convert an AgentMessage role to a swara Message role.
 */
function toMessageRole(role: AgentMessage["role"]): Message["role"] {
  if (role === "tool_result") return "user";
  if (role === "system") return "system";
  return role;
}

/**
 * Convert an array of AgentMessages to swara Messages.
 */
function toMessages(agentMessages: AgentMessage[]): Message[] {
  return agentMessages.map((msg) => ({
    role: toMessageRole(msg.role),
    content: msg.content,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// ContextManager
// ═══════════════════════════════════════════════════════════════════════════

export class ContextManager {
  private config: Required<CompactionConfig>;

  constructor(config: CompactionConfig = {}) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * Build a Context object from the current AgentState.
   */
  buildContext(state: AgentState): Context {
    const messages = toMessages(state.messages);
    const tools = state.tools.map((t) => t.definition);

    return {
      messages,
      systemPrompt: state.systemPrompt || undefined,
      tools: tools.length > 0 ? tools : undefined,
    };
  }

  /**
   * Check if the context is getting too large and should be compacted.
   */
  shouldCompact(state: AgentState, modelContextWindow: number, threshold = 0.8): boolean {
    const estimated = estimateTotalTokens(state);
    return estimated > modelContextWindow * threshold;
  }

  /**
   * Determine which compaction tier is appropriate given the current
   * context utilisation.
   */
  getCompactionTier(state: AgentState, modelContextWindow: number): CompactionTier {
    const usage = estimateTotalTokens(state) / modelContextWindow;
    if (usage > this.config.hardThreshold) return "hard";
    if (usage > this.config.mediumThreshold) return "medium";
    if (usage > this.config.softThreshold) return "soft";
    return "none";
  }

  /**
   * Compact the agent state by summarizing older messages.
   * Returns a new AgentState with the compacted messages array.
   */
  compact(state: AgentState): AgentState {
    const { messages } = state;

    if (messages.length <= this.config.keepRecent) {
      return state;
    }

    const olderMessages = messages.slice(0, messages.length - this.config.keepRecent);
    const recentMessages = messages.slice(messages.length - this.config.keepRecent);
    const summaryMessage = this.buildHeuristicSummary(olderMessages);

    return { ...state, messages: [summaryMessage, ...recentMessages] };
  }

  /**
   * Tiered compaction -- picks the right strategy based on how full the
   * context window is.
   */
  compactTiered(state: AgentState, modelContextWindow: number): AgentState {
    const tier = this.getCompactionTier(state, modelContextWindow);

    switch (tier) {
      case "none":
        return state;
      case "soft":
        return this.compactSoft(state);
      case "medium":
        return this.compactMedium(state);
      case "hard":
        return this.compactHard(state);
    }
  }

  /**
   * LLM-powered compaction using a local Ollama instance.
   * Falls back to the improved heuristic extraction if Ollama is unavailable.
   */
  async compactWithLLM(
    state: AgentState,
    ollamaEndpoint: string = DEFAULT_OLLAMA_ENDPOINT,
  ): Promise<AgentState> {
    const { messages } = state;
    const keep = this.config.hardKeep;

    if (messages.length <= keep) {
      return state;
    }

    const olderMessages = messages.slice(0, messages.length - keep);
    const recentMessages = messages.slice(messages.length - keep);

    const available = await isOllamaAvailable(ollamaEndpoint);
    if (available) {
      try {
        const summaryMessage = await this.buildLLMSummary(olderMessages, ollamaEndpoint);
        return { ...state, messages: [summaryMessage, ...recentMessages] };
      } catch {
        // Fall through to heuristic fallback
      }
    }

    const summaryMessage = this.buildHeuristicSummary(olderMessages);
    return { ...state, messages: [summaryMessage, ...recentMessages] };
  }

  // ─── Tier implementations ───────────────────────────────────────────────

  private compactSoft(state: AgentState): AgentState {
    return { ...state, messages: collapseToolDetails(state.messages) };
  }

  private compactMedium(state: AgentState): AgentState {
    const { messages } = state;
    if (messages.length <= this.config.mediumKeep) return state;

    const olderMessages = messages.slice(0, messages.length - this.config.mediumKeep);
    const recentMessages = messages.slice(messages.length - this.config.mediumKeep);
    const summaryMessage = this.buildHeuristicSummary(olderMessages);

    return { ...state, messages: [summaryMessage, ...recentMessages] };
  }

  private compactHard(state: AgentState): AgentState {
    const { messages } = state;
    if (messages.length <= this.config.hardKeep) return state;

    const olderMessages = messages.slice(0, messages.length - this.config.hardKeep);
    const recentMessages = messages.slice(messages.length - this.config.hardKeep);
    const summaryMessage = this.buildHeuristicSummary(olderMessages);

    return { ...state, messages: [summaryMessage, ...recentMessages] };
  }

  // ─── Summary builders ───────────────────────────────────────────────────

  private buildHeuristicSummary(olderMessages: AgentMessage[]): AgentMessage {
    const summaryParts: string[] = [];
    summaryParts.push("=== Conversation Summary (compacted) ===");
    summaryParts.push(`${olderMessages.length} earlier messages were compacted.`);
    summaryParts.push("");

    const toolSummary = summariseToolPatterns(olderMessages);
    if (toolSummary) {
      summaryParts.push("--- Tool Usage ---");
      summaryParts.push(toolSummary);
      summaryParts.push("");
    }

    summaryParts.push("--- Key Content ---");
    for (const msg of olderMessages) {
      const text = extractText(msg.content);
      if (text.trim()) {
        const extracted = smartExtract(text, 600);
        summaryParts.push(`[${msg.role}] ${extracted}`);
      }
    }

    return {
      id: crypto.randomUUID(),
      role: "system",
      content: [{ type: "text", text: summaryParts.join("\n") }],
      timestamp: Date.now(),
    };
  }

  private async buildLLMSummary(
    olderMessages: AgentMessage[],
    ollamaEndpoint: string,
  ): Promise<AgentMessage> {
    const textChunks: string[] = [];
    for (const msg of olderMessages) {
      const text = extractText(msg.content);
      if (text.trim()) {
        textChunks.push(`[${msg.role}] ${text}`);
      }
    }

    const toolSummary = summariseToolPatterns(olderMessages);
    const olderText = textChunks.join("\n\n");

    const maxInputChars = 24_000;
    const truncatedText = olderText.length > maxInputChars
      ? olderText.slice(0, maxInputChars) + "\n... (truncated)"
      : olderText;

    const prompt = buildSummarisationPrompt(truncatedText, toolSummary);
    const summary = await ollamaGenerate(ollamaEndpoint, prompt);

    const parts: string[] = [
      "=== Conversation Summary (LLM-compacted) ===",
      `${olderMessages.length} earlier messages were summarised by an LLM.`,
      "",
      summary,
    ];

    return {
      id: crypto.randomUUID(),
      role: "system",
      content: [{ type: "text", text: parts.join("\n") }],
      timestamp: Date.now(),
    };
  }
}
