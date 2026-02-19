/**
 * @chitragupta/smriti — Event Extraction Strategy Helpers
 *
 * Internal extraction functions used by {@link extractEventChain}.
 * Split from event-extractor.ts for file size compliance.
 *
 * @module event-extractor-strategies
 */

import type { SessionTurn, SessionMeta } from "./types.js";
import type { SessionEvent, SessionType, ExtendedSessionType } from "./event-extractor.js";

// ─── Domain Extractor Map ───────────────────────────────────────────────────

/**
 * Maps extended session types to which core extractor strategy to use.
 * This avoids duplicating extraction logic — new types reuse existing extractors.
 */
const DOMAIN_EXTRACTOR_MAP: Record<ExtendedSessionType, "coding" | "discussion" | "mixed" | "personal"> = {
	planning: "discussion",
	learning: "discussion",
	creative: "discussion",
	operational: "mixed",
	research: "discussion",
	health: "personal",
	social: "personal",
	finance: "personal",
	reflection: "discussion",
	security: "mixed",
};

/**
 * Get the core extractor strategy for any session type.
 * Extended types are mapped to their closest core extractor.
 */
export function getExtractorStrategy(sessionType: SessionType): "coding" | "discussion" | "mixed" | "personal" {
	if (sessionType === "coding" || sessionType === "discussion" || sessionType === "mixed" || sessionType === "personal") {
		return sessionType;
	}
	return DOMAIN_EXTRACTOR_MAP[sessionType];
}

// ─── User Turn Extraction ───────────────────────────────────────────────────

/** Extract events from a user turn (facts, preferences, questions, decisions). */
export function extractFromUserTurn(
	turn: SessionTurn,
	timestamp: number,
	sessionId: string,
	provider: string,
): SessionEvent[] {
	const events: SessionEvent[] = [];
	const content = turn.content.trim();

	// Tool call from user (MCP recording format)
	const toolMatch = content.match(/\[tool:(\w+)\]\s*(.*)/s);
	if (toolMatch) {
		events.push({
			type: "action",
			summary: `Used ${toolMatch[1]}`,
			timestamp,
			sessionId,
			provider,
			tool: toolMatch[1],
			turnNumber: turn.turnNumber,
		});
		return events;
	}

	// Fact/preference detection
	const factPatterns: Array<{ pattern: RegExp; type: SessionEvent["type"] }> = [
		{ pattern: /(?:i live in|i'm from|i am from|based in)\s+(.+)/i, type: "fact" },
		{ pattern: /(?:my name is|i'm called|call me)\s+(.+)/i, type: "fact" },
		{ pattern: /(?:i work at|i work for|my company)\s+(.+)/i, type: "fact" },
		{ pattern: /(?:always use|never use|i prefer|i use)\s+(.+)/i, type: "preference" },
		{ pattern: /(?:remember that|don't forget|note that)\s+(.+)/i, type: "fact" },
	];

	for (const { pattern, type } of factPatterns) {
		const match = content.match(pattern);
		if (match) {
			events.push({
				type,
				summary: match[0].trim().slice(0, 200),
				timestamp,
				sessionId,
				provider,
				turnNumber: turn.turnNumber,
			});
		}
	}

	// Questions (user asking something)
	if (content.endsWith("?") || /^(how|what|why|where|when|can|do|is|should)\b/i.test(content)) {
		events.push({
			type: "question",
			summary: content.split("\n")[0].slice(0, 200),
			timestamp,
			sessionId,
			provider,
			turnNumber: turn.turnNumber,
		});
	}
	// Short statements that aren't questions — often decisions or directives
	else if (content.length < 300 && !toolMatch) {
		events.push({
			type: "decision",
			summary: content.split("\n")[0].slice(0, 200),
			timestamp,
			sessionId,
			provider,
			turnNumber: turn.turnNumber,
		});
	}

	return events;
}

// ─── Coding Assistant Extraction ────────────────────────────────────────────

/** Extract events from a coding assistant turn (tool results, files, errors, commits). */
export function extractFromCodingAssistant(
	turn: SessionTurn,
	timestamp: number,
	sessionId: string,
	provider: string,
): SessionEvent[] {
	const events: SessionEvent[] = [];
	const content = turn.content;

	// Tool results
	const toolResultMatch = content.match(/\[(\w+)\s*→\s*(\d+(?:\.\d+)?m?s)\]\s*(.*)/);
	if (toolResultMatch) {
		const resultPreview = toolResultMatch[3].slice(0, 150);
		events.push({
			type: "action",
			summary: `${toolResultMatch[1]}: ${resultPreview}`,
			timestamp,
			sessionId,
			provider,
			tool: toolResultMatch[1],
			turnNumber: turn.turnNumber,
		});
	}

	// File modifications
	const filePatterns = content.matchAll(/(?:(?:File|Modified|Created|Edited|Deleted)[:\s]+)([^\n,]+\.\w+)/gi);
	const files: string[] = [];
	for (const match of filePatterns) {
		files.push(match[1].trim());
	}
	if (files.length > 0) {
		events.push({
			type: "action",
			summary: `Modified ${files.length} file(s): ${files.slice(0, 3).join(", ")}${files.length > 3 ? "..." : ""}`,
			timestamp,
			sessionId,
			provider,
			files,
			turnNumber: turn.turnNumber,
		});
	}

	// Errors
	const errorMatch = content.match(/(?:Error|Failed|error|FAIL)[:\s]+(.+)/);
	if (errorMatch) {
		events.push({
			type: "error",
			summary: errorMatch[0].slice(0, 200),
			timestamp,
			sessionId,
			provider,
			turnNumber: turn.turnNumber,
		});
	}

	// Commits
	const commitMatch = content.match(/(?:commit|committed|pushed)[:\s]+([a-f0-9]{7,})/i);
	if (commitMatch) {
		events.push({
			type: "commit",
			summary: `Committed ${commitMatch[1]}`,
			timestamp,
			sessionId,
			provider,
			turnNumber: turn.turnNumber,
		});
	}

	// If nothing extracted but turn is short — it's likely a decision/summary
	if (events.length === 0 && content.length < 300 && content.length > 10) {
		events.push({
			type: "decision",
			summary: content.split("\n")[0].slice(0, 200),
			timestamp,
			sessionId,
			provider,
			turnNumber: turn.turnNumber,
		});
	}

	return events;
}

// ─── Discussion Assistant Extraction ────────────────────────────────────────

/** Extract events from a discussion assistant turn (topics, options, conclusions). */
export function extractFromDiscussionAssistant(
	turn: SessionTurn,
	timestamp: number,
	sessionId: string,
	provider: string,
): SessionEvent[] {
	const events: SessionEvent[] = [];
	const content = turn.content;
	const lines = content.split("\n").filter((l) => l.trim());

	// For discussions: first meaningful line is the opening (the "I'll do X" / thesis)
	if (lines.length > 0) {
		const firstLine = lines[0].replace(/^#+\s*/, "").trim();
		if (firstLine.length > 10) {
			events.push({
				type: "topic",
				summary: firstLine.slice(0, 200),
				timestamp,
				sessionId,
				provider,
				turnNumber: turn.turnNumber,
			});
		}
	}

	// Options/choices presented (numbered lists, Option A/B/C)
	const optionLines = lines.filter((l) =>
		/^(?:\d+\.|[-*]|\*\*Option|Option [A-C])/i.test(l.trim()),
	);
	if (optionLines.length >= 2) {
		const summary = optionLines
			.slice(0, 4)
			.map((l) => l.trim().slice(0, 100))
			.join("; ");
		events.push({
			type: "decision",
			summary: `Options: ${summary}`,
			timestamp,
			sessionId,
			provider,
			turnNumber: turn.turnNumber,
		});
	}

	// Conclusions / summary lines (often at the end)
	const lastLines = lines.slice(-3);
	for (const line of lastLines) {
		const trimmed = line.trim();
		if (/^(?:So|In summary|The (?:key|main|bottom)|To summarize|Overall)/i.test(trimmed)) {
			events.push({
				type: "decision",
				summary: trimmed.slice(0, 200),
				timestamp,
				sessionId,
				provider,
				turnNumber: turn.turnNumber,
			});
			break;
		}
	}

	return events;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract a topic from user message content. */
export function extractTopic(content: string): string | null {
	const firstLine = content.split("\n")[0].trim();
	if (firstLine.length < 5 || firstLine.length > 200) return null;

	// Remove common prefixes
	const cleaned = firstLine
		.replace(/^(?:hey|hi|hello|ok|okay|so|well|please|pls|can you|could you)\s+/i, "")
		.trim();

	return cleaned.length > 5 ? cleaned.slice(0, 100) : null;
}

/** Deduplicate events with similar summaries. */
export function deduplicateEvents(events: SessionEvent[]): SessionEvent[] {
	const seen = new Set<string>();
	return events.filter((event) => {
		// Normalize: lowercase, remove punctuation, trim
		const key = `${event.type}:${event.summary.toLowerCase().replace(/[^\w\s]/g, "").trim().slice(0, 50)}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Human-readable labels for extended session types. */
const DOMAIN_LABELS: Record<ExtendedSessionType, string> = {
	planning: "Planning",
	learning: "Learning",
	creative: "Creative",
	operational: "Operations",
	research: "Research",
	health: "Health",
	social: "Social",
	finance: "Finance",
	reflection: "Reflection",
	security: "Security",
};

/** Generate a brief narrative summary from events. */
export function generateNarrative(
	sessionType: SessionType,
	events: SessionEvent[],
	meta: SessionMeta,
	provider: string,
): string {
	const time = new Date(meta.created).toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

	const parts: string[] = [];
	parts.push(`${time} via ${provider}`);

	// For extended types, prefix with domain label
	const strategy = getExtractorStrategy(sessionType);
	if (sessionType !== strategy) {
		parts.push(`[${DOMAIN_LABELS[sessionType as ExtendedSessionType]}]`);
	}

	if (strategy === "coding") {
		const actions = events.filter((e) => e.type === "action");
		const errors = events.filter((e) => e.type === "error");
		const commits = events.filter((e) => e.type === "commit");
		const decisions = events.filter((e) => e.type === "decision");

		if (decisions.length > 0) parts.push(decisions[0].summary);
		parts.push(`${actions.length} actions`);
		if (errors.length > 0) parts.push(`${errors.length} errors`);
		if (commits.length > 0) parts.push(`${commits.length} commits`);
	} else if (strategy === "discussion") {
		const topics = events.filter((e) => e.type === "topic");
		const decisions = events.filter((e) => e.type === "decision");

		if (topics.length > 0) parts.push(`Discussed: ${topics.map((t) => t.summary).slice(0, 3).join(", ")}`);
		if (decisions.length > 0) parts.push(`${decisions.length} decisions`);
	} else if (strategy === "personal") {
		const facts = events.filter((e) => e.type === "fact" || e.type === "preference");
		if (facts.length > 0) parts.push(facts.map((f) => f.summary).join("; "));
	} else {
		parts.push(`${events.length} events`);
	}

	return parts.join(" — ");
}
