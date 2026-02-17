/**
 * @chitragupta/smriti — Signal extraction, importance scoring, and delta generation.
 *
 * Extracts signals from session content (identity, projects, tasks, flow)
 * using either LLM-based extraction (Ollama) or keyword pattern matching.
 * Also handles session delta extraction and markdown generation.
 */

import type {
  Session,
  StreamSignals,
  SessionDelta,
} from "./types.js";
import { estimateTokens } from "./streams.js";

// ─── Ollama Configuration ────────────────────────────────────────────────────

export let OLLAMA_ENDPOINT = process.env.OLLAMA_HOST ?? "http://localhost:11434";
let GENERATION_MODEL = "llama3.2";

/**
 * Configure the Ollama endpoint and/or generation model for signal extraction.
 */
export function configureCompactorSignals(options: {
  ollamaEndpoint?: string;
  generationModel?: string;
}): void {
  if (options.ollamaEndpoint) {
    OLLAMA_ENDPOINT = options.ollamaEndpoint;
  }
  if (options.generationModel) {
    GENERATION_MODEL = options.generationModel;
  }
}

// ─── Signal Extraction Patterns ──────────────────────────────────────────────

const IDENTITY_PATTERNS = [
  /\b(?:i prefer|my preference|i like|i don'?t like|i always|i never|i am|my name|call me|i use|my style)\b/i,
  /\b(?:correct(?:ion|ed)?|actually,? i|no,? i meant|i meant)\b/i,
  /\b(?:my (?:favorite|preferred|default)|i (?:typically|usually|generally))\b/i,
  /\b(?:please (?:always|never|remember)|going forward,? (?:always|never))\b/i,
];

const PROJECT_PATTERNS = [
  /\b(?:decid(?:e|ed|ing)|decision|chose|chosen|pick(?:ed)?|going with|let'?s go with)\b/i,
  /\b(?:stack|architecture|design|framework|library|database|api|schema|deploy)\b/i,
  /\b(?:project|repo(?:sitory)?|codebase|monorepo|package|workspace)\b/i,
  /\b(?:refactor|migrate|upgrade|switch(?:ing)? to|moving to)\b/i,
  /\b(?:implemented|built|created|set up|configured|initialized)\b/i,
];

const TASK_PATTERNS = [
  /\b(?:todo|to-do|to do|task|action item|need to|should|must|have to)\b/i,
  /\b(?:done|completed?|finished|resolved|closed|fixed|shipped)\b/i,
  /\b(?:blocked|blocker|waiting|pending|depends on|prerequisite)\b/i,
  /\b(?:next step|follow[- ]?up|reminder|don'?t forget)\b/i,
  /\b(?:add|implement|create|build|write|update|fix|debug|test|deploy)\b/i,
];

const FLOW_PATTERNS = [
  /\b(?:currently|right now|at the moment|working on|looking at)\b/i,
  /\b(?:wondering|thinking about|considering|exploring|investigating)\b/i,
  /\b(?:confused|stuck|not sure|help me|how do i|what (?:is|are|does))\b/i,
  /\b(?:open question|unresolved|unsure|tbd|unclear)\b/i,
];

// ─── Keyword Signal Extraction ───────────────────────────────────────────────

/**
 * Extract signals from session content using keyword matching.
 * This is the fallback when Ollama is not available.
 */
export function keywordExtractSignals(session: Session): StreamSignals {
  const signals: StreamSignals = {
    identity: [],
    projects: [],
    tasks: [],
    flow: [],
  };

  for (const turn of session.turns) {
    const content = turn.content;
    const sentences = content.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 10);

    for (const sentence of sentences) {
      let matched = false;

      for (const pattern of IDENTITY_PATTERNS) {
        if (pattern.test(sentence)) {
          signals.identity.push(sentence.slice(0, 200));
          matched = true;
          break;
        }
      }
      if (matched) continue;

      for (const pattern of PROJECT_PATTERNS) {
        if (pattern.test(sentence)) {
          signals.projects.push(sentence.slice(0, 200));
          matched = true;
          break;
        }
      }
      if (matched) continue;

      for (const pattern of TASK_PATTERNS) {
        if (pattern.test(sentence)) {
          signals.tasks.push(sentence.slice(0, 200));
          matched = true;
          break;
        }
      }
      if (matched) continue;

      for (const pattern of FLOW_PATTERNS) {
        if (pattern.test(sentence)) {
          signals.flow.push(sentence.slice(0, 200));
          break;
        }
      }
    }
  }

  return signals;
}

// ─── LLM Signal Extraction ───────────────────────────────────────────────────

/**
 * Extract signals from session content using Ollama LLM.
 * Falls back to keyword extraction on failure.
 */
export async function llmExtractSignals(session: Session): Promise<StreamSignals> {
  const turnTexts: string[] = [];
  for (const turn of session.turns) {
    const prefix = turn.role === "user" ? "USER" : "ASSISTANT";
    turnTexts.push(`${prefix}: ${turn.content.slice(0, 500)}`);
  }
  const sessionText = turnTexts.join("\n\n").slice(0, 6000);

  const prompt = `Analyze this conversation and extract signals into 4 categories. Return ONLY valid JSON.

Categories:
1. "identity" - User preferences, corrections, personal facts, style preferences
2. "projects" - Decisions, stack/architecture changes, project context
3. "tasks" - New TODOs, completed tasks, blockers, action items
4. "flow" - Current topic, mood, open questions, ephemeral context

Return JSON: {"identity": ["signal1", ...], "projects": ["signal1", ...], "tasks": ["signal1", ...], "flow": ["signal1", ...]}

Each signal should be a brief phrase (not full sentences).

Conversation:
${sessionText}

JSON:`;

  try {
    const response = await fetch(`${OLLAMA_ENDPOINT}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GENERATION_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 2048 },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = (await response.json()) as { response: string };
    const text = data.response.trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in LLM response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    return {
      identity: Array.isArray(parsed.identity)
        ? parsed.identity.filter((s): s is string => typeof s === "string")
        : [],
      projects: Array.isArray(parsed.projects)
        ? parsed.projects.filter((s): s is string => typeof s === "string")
        : [],
      tasks: Array.isArray(parsed.tasks)
        ? parsed.tasks.filter((s): s is string => typeof s === "string")
        : [],
      flow: Array.isArray(parsed.flow)
        ? parsed.flow.filter((s): s is string => typeof s === "string")
        : [],
    };
  } catch {
    return keywordExtractSignals(session);
  }
}

// ─── Delta Extraction ────────────────────────────────────────────────────────

/**
 * Extract a compressed session delta from the full session.
 * This is NOT the full transcript -- just key points, decisions, artifacts, and tags.
 */
export function extractDelta(session: Session, signals: StreamSignals): SessionDelta {
  const keyPoints: string[] = [];
  const decisions: string[] = [];
  const artifacts: string[] = [];
  const openThreads: string[] = [];

  for (const s of signals.identity) { keyPoints.push(s); }
  for (const s of signals.flow.slice(0, 5)) { keyPoints.push(s); }
  for (const s of signals.projects) { decisions.push(s); }

  for (const turn of session.turns) {
    if (turn.toolCalls) {
      for (const tc of turn.toolCalls) {
        if (tc.name.includes("write") || tc.name.includes("create") || tc.name.includes("edit")) {
          const pathMatch = tc.input.match(/["']?([/\\][\w./\\-]+)["']?/);
          if (pathMatch) {
            artifacts.push(`${tc.name}: ${pathMatch[1]}`);
          } else {
            artifacts.push(`${tc.name}: ${tc.input.slice(0, 100)}`);
          }
        }
      }
    }
  }

  for (const s of signals.flow) {
    if (/\?|wondering|unsure|tbd|unclear|open question|unresolved/i.test(s)) {
      openThreads.push(s);
    }
  }

  let originalText = "";
  for (const turn of session.turns) { originalText += turn.content; }

  const delta: SessionDelta = {
    sessionId: session.meta.id,
    title: session.meta.title,
    timestamp: new Date().toISOString(),
    keyPoints: [...new Set(keyPoints)].slice(0, 20),
    decisions: [...new Set(decisions)].slice(0, 15),
    artifacts: [...new Set(artifacts)].slice(0, 20),
    tags: [...new Set([...session.meta.tags])],
    openThreads: [...new Set(openThreads)].slice(0, 10),
    originalTokens: estimateTokens(originalText),
    deltaTokens: 0,
  };

  const deltaText = [
    ...delta.keyPoints, ...delta.decisions, ...delta.artifacts, ...delta.openThreads,
  ].join("\n");
  delta.deltaTokens = estimateTokens(deltaText);

  return delta;
}

/**
 * Write a session delta as a compressed .md file content.
 */
export function writeDeltaMarkdown(delta: SessionDelta): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`session_id: ${delta.sessionId}`);
  lines.push(`title: "${delta.title.replace(/"/g, '\\"')}"`);
  lines.push(`timestamp: ${delta.timestamp}`);
  lines.push(`original_tokens: ${delta.originalTokens}`);
  lines.push(`delta_tokens: ${delta.deltaTokens}`);
  lines.push(`compression_ratio: ${delta.originalTokens > 0 ? (delta.deltaTokens / delta.originalTokens).toFixed(3) : "0"}`);
  if (delta.tags.length > 0) {
    lines.push("tags:");
    for (const tag of delta.tags) { lines.push(`  - ${tag}`); }
  } else {
    lines.push("tags: []");
  }
  lines.push("---");
  lines.push("");

  if (delta.keyPoints.length > 0) {
    lines.push("## Key Points");
    lines.push("");
    for (const point of delta.keyPoints) { lines.push(`- ${point}`); }
    lines.push("");
  }

  if (delta.decisions.length > 0) {
    lines.push("## Decisions");
    lines.push("");
    for (const decision of delta.decisions) { lines.push(`- ${decision}`); }
    lines.push("");
  }

  if (delta.artifacts.length > 0) {
    lines.push("## Artifacts");
    lines.push("");
    for (const artifact of delta.artifacts) { lines.push(`- ${artifact}`); }
    lines.push("");
  }

  if (delta.openThreads.length > 0) {
    lines.push("## Open Threads");
    lines.push("");
    for (const thread of delta.openThreads) { lines.push(`- ${thread}`); }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(`*Compressed from ${delta.originalTokens} tokens to ${delta.deltaTokens} tokens*`);
  lines.push("");

  return lines.join("\n");
}
