/**
 * Context compaction algorithms.
 *
 * Provides the compaction logic used by ContextManager:
 * - Tool-call detail collapsing (soft tier)
 * - Heuristic smart extraction (medium/hard tiers)
 * - Tool pattern summarization
 * - LLM-powered summarization via Ollama
 * - Text extraction and token estimation helpers
 */

import type { ContentPart, ToolCallContent, ToolResultContent } from "@chitragupta/swara";
import type { AgentState, AgentMessage } from "./types.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Rough estimate: 1 token ~ 4 chars. */
const CHARS_PER_TOKEN = 4;

/** Per-message overhead: role tag, delimiters, whitespace (~4 tokens). */
const PER_MESSAGE_OVERHEAD = 4;

/**
 * Provider overhead -- accounts for hidden formatting tokens added by the
 * provider (special tokens, message separators, etc.).
 */
const PROVIDER_OVERHEAD_TOKENS = 100;

/**
 * Multiplier applied to JSON-serialised tool schemas to account for token
 * encoding overhead (keys, punctuation, etc. tokenise inefficiently).
 */
const TOOL_SCHEMA_OVERHEAD_FACTOR = 1.15;

/** Default Ollama endpoint. */
export const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";

/** Configurable Ollama summarisation settings. */
export interface OllamaSummaryConfig {
  model?: string;
  timeoutMs?: number;
}

const DEFAULT_OLLAMA_CONFIG: Required<OllamaSummaryConfig> = {
  model: "llama3",
  timeoutMs: 60_000,
};

let _ollamaConfig = { ...DEFAULT_OLLAMA_CONFIG };

/** Update Ollama summarisation configuration at runtime. */
export function configureOllamaSummary(config: OllamaSummaryConfig): void {
  _ollamaConfig = { ...DEFAULT_OLLAMA_CONFIG, ...config };
}

// ─── Token Estimation ───────────────────────────────────────────────────────

/**
 * Estimate the token count for a set of content parts.
 */
export function estimatePartTokens(parts: ContentPart[]): number {
  let chars = 0;
  for (const part of parts) {
    switch (part.type) {
      case "text":
      case "thinking":
        chars += part.text.length;
        break;
      case "tool_call":
        chars += part.name.length + part.arguments.length;
        break;
      case "tool_result":
        chars += part.content.length;
        break;
      case "image":
        chars += 4000;
        break;
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Estimate total token usage for the entire agent state context.
 */
export function estimateTotalTokens(state: AgentState): number {
  let total = 0;

  total += Math.ceil(state.systemPrompt.length / CHARS_PER_TOKEN);

  for (const msg of state.messages) {
    total += estimatePartTokens(msg.content);
    total += PER_MESSAGE_OVERHEAD;
  }

  for (const tool of state.tools) {
    const def = tool.definition;
    const schemaJson = JSON.stringify(def.inputSchema);
    const rawChars = def.name.length + def.description.length + schemaJson.length;
    total += Math.ceil((rawChars * TOOL_SCHEMA_OVERHEAD_FACTOR) / CHARS_PER_TOKEN);
  }

  total += PROVIDER_OVERHEAD_TOKENS;
  return total;
}

// ─── Text Extraction ────────────────────────────────────────────────────────

/**
 * Extract plain text from content parts for summarization.
 */
export function extractText(parts: ContentPart[]): string {
  const texts: string[] = [];
  for (const part of parts) {
    switch (part.type) {
      case "text":
        texts.push(part.text);
        break;
      case "thinking":
        texts.push(`[thinking] ${part.text}`);
        break;
      case "tool_call":
        texts.push(`[called tool: ${part.name}]`);
        break;
      case "tool_result":
        texts.push(`[tool result: ${part.content.slice(0, 200)}]`);
        break;
    }
  }
  return texts.join("\n");
}

// ─── Smart Heuristic Extraction ─────────────────────────────────────────────

/** Patterns that indicate a key decision or action statement. */
const DECISION_PREFIXES = [
  "i'll", "i will", "let's", "the fix is", "the issue is", "the problem is",
  "we need to", "we should", "the solution is", "i've", "i have",
  "decision:", "plan:", "approach:",
];

/** Regex that matches file-system paths. */
const FILE_PATH_RE = /(?:\/[\w.@-]+){2,}|[\w.@-]+(?:\/[\w.@-]+)+/g;

/** Regex that matches fenced code blocks. */
const CODE_BLOCK_RE = /```[\s\S]*?```/g;

/**
 * Improved heuristic fallback that extracts meaningful content from a block
 * of text rather than blindly slicing at a character limit.
 */
export function smartExtract(text: string, maxChars: number): string {
  const parts: string[] = [];
  let budget = maxChars;

  const addPart = (s: string): void => {
    if (budget <= 0) return;
    const piece = s.length > budget ? s.slice(0, budget) + "..." : s;
    parts.push(piece);
    budget -= piece.length;
  };

  const lines = text.split("\n");
  for (const line of lines) {
    const lower = line.trim().toLowerCase();
    if (DECISION_PREFIXES.some((p) => lower.startsWith(p))) {
      addPart(line.trim());
    }
  }

  const paths = [...new Set(text.match(FILE_PATH_RE) ?? [])];
  if (paths.length > 0) {
    addPart(`[paths: ${paths.join(", ")}]`);
  }

  const codeBlocks = text.match(CODE_BLOCK_RE) ?? [];
  for (const block of codeBlocks) {
    addPart(block.length > 500 ? block.slice(0, 500) + "\n```" : block);
  }

  const sentences = text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);
  if (sentences.length > 0) {
    addPart(sentences[0]!);
    if (sentences.length > 1) {
      addPart(sentences[sentences.length - 1]!);
    }
  }

  if (parts.length === 0) {
    return text.length > maxChars ? text.slice(0, maxChars) + "..." : text;
  }

  return parts.join("\n");
}

// ─── Tool-Call Detail Collapsing ────────────────────────────────────────────

/**
 * Collapse tool call arguments and tool results into short summaries while
 * keeping the surrounding text content intact.
 */
export function collapseToolDetails(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((msg) => {
    const hasToolParts = msg.content.some(
      (p) => p.type === "tool_call" || p.type === "tool_result",
    );
    if (!hasToolParts) return msg;

    const newContent: ContentPart[] = msg.content.map((part) => {
      if (part.type === "tool_call") {
        const tc = part as ToolCallContent;
        return { type: "tool_call" as const, id: tc.id, name: tc.name, arguments: "{}" };
      }
      if (part.type === "tool_result") {
        const tr = part as ToolResultContent;
        const snippet = tr.content.length > 100 ? tr.content.slice(0, 100) + "..." : tr.content;
        return {
          type: "tool_result" as const, toolCallId: tr.toolCallId,
          content: snippet, ...(tr.isError ? { isError: true } : {}),
        };
      }
      return part;
    });

    return { ...msg, content: newContent };
  });
}

// ─── Tool Pattern Summarization ─────────────────────────────────────────────

/**
 * Scan messages for tool_call / tool_result parts and return a human-readable
 * summary of what tools were used and on what resources.
 */
export function summariseToolPatterns(messages: AgentMessage[]): string {
  const reads: string[] = [];
  const writes: string[] = [];
  const commands: string[] = [];
  const otherTools = new Map<string, number>();

  for (const msg of messages) {
    for (const part of msg.content) {
      if (part.type !== "tool_call") continue;
      const tc = part as ToolCallContent;
      const name = tc.name.toLowerCase();
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.arguments) as Record<string, unknown>; } catch { /* Malformed JSON from model response — use empty args */ }

      if (name.includes("read") || name.includes("glob") || name.includes("grep")) {
        const target = (args["file_path"] ?? args["path"] ?? args["pattern"] ?? "") as string;
        if (target) reads.push(target);
      } else if (name.includes("write") || name.includes("edit")) {
        const target = (args["file_path"] ?? args["path"] ?? "") as string;
        if (target) writes.push(target);
      } else if (name.includes("bash") || name.includes("exec") || name.includes("command")) {
        const cmd = (args["command"] ?? "") as string;
        if (cmd) commands.push(cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd);
      } else {
        otherTools.set(tc.name, (otherTools.get(tc.name) ?? 0) + 1);
      }
    }
  }

  const sections: string[] = [];
  if (reads.length > 0) sections.push(`Files read: ${[...new Set(reads)].join(", ")}`);
  if (writes.length > 0) sections.push(`Files written/edited: ${[...new Set(writes)].join(", ")}`);
  if (commands.length > 0) sections.push(`Commands run: ${commands.join("; ")}`);
  if (otherTools.size > 0) {
    const entries = [...otherTools.entries()].map(([n, c]) => `${n}(x${c})`);
    sections.push(`Other tools: ${entries.join(", ")}`);
  }
  return sections.length > 0 ? sections.join("\n") : "";
}

// ─── Ollama Interaction ─────────────────────────────────────────────────────

interface OllamaGenerateResponse {
  response: string;
  done: boolean;
}

/**
 * Check whether an Ollama instance is reachable at the given endpoint.
 */
export async function isOllamaAvailable(endpoint: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${endpoint}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    // Silently skip: Ollama not reachable (not installed, not running, network error)
    return false;
  }
}

/**
 * Call Ollama /api/generate with a prompt and return the generated text.
 */
export async function ollamaGenerate(endpoint: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), _ollamaConfig.timeoutMs);

  try {
    const res = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: _ollamaConfig.model, prompt, stream: false }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`Ollama returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as OllamaGenerateResponse;
    return data.response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the prompt for LLM-powered summarisation.
 */
export function buildSummarisationPrompt(olderText: string, toolSummary: string): string {
  return [
    "You are a conversation summariser for an AI coding assistant.",
    "Your job is to produce a concise summary of the conversation history below.",
    "",
    "IMPORTANT RULES:",
    "- Preserve key decisions and their reasoning.",
    "- Preserve all code changes (what was changed and why).",
    "- Keep exact file paths, function names, class names, and other technical specifics.",
    "- Summarise tool call patterns: which files were read/written, which commands were run.",
    "- Note any unresolved issues, pending tasks, or open questions.",
    "- Do NOT include conversational fluff or pleasantries.",
    "- Keep the summary under 2000 words.",
    "",
    toolSummary ? `TOOL USAGE SUMMARY:\n${toolSummary}\n` : "",
    "CONVERSATION HISTORY:",
    "---",
    olderText,
    "---",
    "",
    "Produce a structured summary now:",
  ].join("\n");
}
