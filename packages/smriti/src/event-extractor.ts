/**
 * @chitragupta/smriti — Event Chain Extractor
 *
 * Processes raw session turns into meaningful event chains.
 * The "nervous system" that converts raw recordings into
 * structured, recallable knowledge.
 *
 * Session types (core):
 *   - coding:     Heavy tool use, file edits → compress to outcomes
 *   - discussion:  Mostly text dialogue → keep topics, options, decisions
 *   - mixed:      Both tools and discussion → segment and compress each
 *   - personal:   Short, fact-like → keep everything
 *
 * Session types (extended — personal AI assistant domains):
 *   - planning:     Task/project planning, goal setting, scheduling
 *   - learning:     Research, study, tutorials, knowledge acquisition
 *   - creative:     Writing, brainstorming, design, ideation
 *   - operational:  System ops, deployment, monitoring, configuration
 *   - research:     Deep analysis, comparison, investigation
 *   - health:       Wellness, fitness, medical, nutrition tracking
 *   - social:       Relationships, messaging, people management
 *   - finance:      Budgets, transactions, investments, expenses
 *   - reflection:   Journaling, retrospective, self-assessment
 *   - security:     Threat assessment, vulnerability, access control
 */

import type { SessionTurn, SessionMeta } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Core session types (backward compatible). */
export type CoreSessionType = "coding" | "discussion" | "mixed" | "personal";

/** Extended session types for personal AI assistant domains. */
export type ExtendedSessionType =
	| "planning"
	| "learning"
	| "creative"
	| "operational"
	| "research"
	| "health"
	| "social"
	| "finance"
	| "reflection"
	| "security";

/** All detected session types — core + extended domains. */
export type SessionType = CoreSessionType | ExtendedSessionType;

/** A discrete event extracted from session turns. */
export interface SessionEvent {
	/** Event type. */
	type: "problem" | "decision" | "action" | "error" | "fact" | "commit" | "question" | "topic" | "preference";
	/** Human-readable summary of the event. */
	summary: string;
	/** Timestamp (epoch ms) when the event occurred. */
	timestamp: number;
	/** Session ID this event came from. */
	sessionId: string;
	/** The provider that generated this event. */
	provider?: string;
	/** Related file paths (if any). */
	files?: string[];
	/** Related tool name (if any). */
	tool?: string;
	/** Original turn number for reference. */
	turnNumber?: number;
}

/** Result of extracting events from a session. */
export interface EventChain {
	/** Detected session type. */
	sessionType: SessionType;
	/** Ordered list of extracted events. */
	events: SessionEvent[];
	/** Brief narrative summary of the session. */
	narrative: string;
	/** Topics discussed (for discussion/mixed sessions). */
	topics: string[];
	/** Session metadata. */
	meta: SessionMeta;
}

// ─── Domain Signal Patterns ─────────────────────────────────────────────────

/**
 * Content signal patterns for extended session types.
 * Each entry maps a domain to keyword/phrase groups that indicate that type.
 * Matching is case-insensitive against the combined user turn content.
 *
 * IMPORTANT: Patterns must be specific enough to avoid false positives.
 * Avoid single common words (e.g., "text", "design", "call") that appear
 * in normal programming discussions.
 */
const DOMAIN_SIGNALS: Record<ExtendedSessionType, RegExp[]> = {
	planning: [
		/\b(?:plan for|roadmap|milestone|timeline|schedule|deadline|sprint|backlog|prioriti[sz]e)\b/i,
		/\b(?:next steps|action items|todo list|to-do list|project plan|gantt|kanban)\b/i,
		/\b(?:due date|estimated time|target date|delivery date|eta for)\b/i,
	],
	learning: [
		/\b(?:teach me|learn about|learn how|tutorial|take a course|study for)\b/i,
		/\b(?:explain to me|help me understand|walkthrough|lesson on)\b/i,
		/\b(?:what is a|what are the|concept of|fundamentals of|theory behind)\b/i,
	],
	creative: [
		/\b(?:write a|draft a|compose a|brainstorm|ideate|creative writing|story about|poem|essay|blog post)\b/i,
		/\b(?:sketch a|mockup|wireframe|logo for|brand identity)\b/i,
		/\b(?:name suggestions|tagline|slogan|elevator pitch)\b/i,
	],
	operational: [
		/\b(?:deploy to|release to|rollback|rollout|uptime|downtime|incident)\b/i,
		/\b(?:docker|kubernetes|k8s|nginx|systemd|terraform|ansible)\b/i,
		/\b(?:infrastructure|ci\/cd pipeline|staging|production environment)\b/i,
	],
	research: [
		/\b(?:research on|investigate|deep dive|literature review|state of the art|sota)\b/i,
		/\b(?:arxiv|paper on|survey of|systematic review|meta-analysis)\b/i,
		/\b(?:pros and cons|tradeoffs? between|trade-offs? between|compare .+ vs)\b/i,
	],
	health: [
		/\b(?:health|wellness|fitness|exercise routine|workout|diet plan|nutrition|calories)\b/i,
		/\b(?:sleep schedule|meditation|mindfulness|mental health|therapy session)\b/i,
		/\b(?:doctor appointment|symptoms of|medicine|prescription|blood pressure)\b/i,
	],
	social: [
		/\b(?:send a message|reply to|draft an email|write an email|schedule a meeting)\b/i,
		/\b(?:birthday|anniversary|gift for|party for|event planning|gathering)\b/i,
		/\b(?:my friend|my family|my colleague|my partner|my wife|my husband)\b/i,
	],
	finance: [
		/\b(?:budget for|monthly expenses|income|salary|payment for|invoice)\b/i,
		/\b(?:invest in|stock|portfolio|crypto|savings account|retirement|tax return)\b/i,
		/\b(?:how much does|subscription|billing|net worth|financial)\b/i,
	],
	reflection: [
		/\b(?:reflect on|journal entry|diary entry|retrospective|look back on)\b/i,
		/\b(?:what went well|what could improve|lessons learned|takeaways from)\b/i,
		/\b(?:grateful for|gratitude|how am i doing|self-assessment)\b/i,
	],
	security: [
		/\b(?:security audit|vulnerability|exploit|threat model|attack vector|data breach)\b/i,
		/\b(?:encrypt|decrypt|ssl certificate|tls|oauth|authentication flow)\b/i,
		/\b(?:access control|firewall rule|security compliance|penetration test|pentest)\b/i,
	],
};

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

// ─── Session Type Detection ─────────────────────────────────────────────────

/**
 * Score content against domain signal patterns.
 * Returns a map of extended type → number of distinct pattern groups that matched.
 *
 * We count distinct groups (not raw occurrences) to prevent a single common
 * word from inflating scores. A domain needs multiple independent signals.
 */
function scoreDomainSignals(turns: SessionTurn[]): Map<ExtendedSessionType, number> {
	const scores = new Map<ExtendedSessionType, number>();

	// Collect all user content
	const userContent = turns
		.filter(t => t.role === "user")
		.map(t => t.content)
		.join(" ");

	for (const [domain, patterns] of Object.entries(DOMAIN_SIGNALS) as Array<[ExtendedSessionType, RegExp[]]>) {
		let groupsMatched = 0;
		for (const pattern of patterns) {
			if (new RegExp(pattern.source, "i").test(userContent)) {
				groupsMatched++;
			}
		}
		if (groupsMatched > 0) scores.set(domain, groupsMatched);
	}

	return scores;
}

/**
 * Detect session type from turns content analysis.
 *
 * Detection strategy (two-phase):
 * 1. Structural analysis — tool ratio and message length (core types)
 * 2. Content signal scoring — keyword patterns for extended domains
 *
 * Extended domains only win when:
 * - The structural type would be "discussion", "mixed", or "personal"
 * - AND the domain signal score >= 3 (strong enough signal)
 *
 * "coding" sessions are never overridden — heavy tool use always means coding.
 */
export function detectSessionType(turns: SessionTurn[]): SessionType {
	if (turns.length === 0) return "personal";

	let toolTurns = 0;
	let textTurns = 0;
	let totalUserLength = 0;
	let userTurnCount = 0;

	for (const turn of turns) {
		const hasToolCall = /\[tool:\w+\]/.test(turn.content) ||
			(turn.toolCalls && turn.toolCalls.length > 0);

		if (hasToolCall) {
			toolTurns++;
		} else {
			textTurns++;
		}

		if (turn.role === "user") {
			totalUserLength += turn.content.length;
			userTurnCount++;
		}
	}

	const avgUserLength = userTurnCount > 0 ? totalUserLength / userTurnCount : 0;
	const toolRatio = turns.length > 0 ? toolTurns / turns.length : 0;

	// Phase 1: Structural classification (core types)
	let coreType: CoreSessionType;

	if (turns.length <= 4 && avgUserLength < 100) {
		coreType = "personal";
	} else if (toolRatio > 0.6) {
		coreType = "coding";
	} else if (toolRatio < 0.15) {
		coreType = "discussion";
	} else {
		coreType = "mixed";
	}

	// Coding sessions are never overridden — tool-heavy sessions are always coding
	if (coreType === "coding") return "coding";

	// Phase 2: Content signal scoring for extended types
	const domainScores = scoreDomainSignals(turns);

	if (domainScores.size === 0) return coreType;

	// Find the top-scoring domain
	let topDomain: ExtendedSessionType | null = null;
	let topScore = 0;
	for (const [domain, score] of domainScores) {
		if (score > topScore) {
			topScore = score;
			topDomain = domain;
		}
	}

	// Domain signal must be strong enough to override core classification.
	// Require at least 2 distinct pattern groups to match (out of 3 per domain).
	// This prevents a single matching phrase from mis-classifying the session.
	if (topDomain && topScore >= 2) {
		return topDomain;
	}

	return coreType;
}

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

// ─── Event Extraction ───────────────────────────────────────────────────────

/**
 * Extract an event chain from a session.
 *
 * @param meta - Session metadata.
 * @param turns - Session turns with timestamps.
 * @returns EventChain with typed events and narrative.
 */
export function extractEventChain(
	meta: SessionMeta,
	turns: Array<SessionTurn & { createdAt: number }>,
): EventChain {
	const sessionType = detectSessionType(turns);
	const provider = meta.provider ?? (meta.metadata?.provider as string) ?? meta.agent ?? "unknown";
	const events: SessionEvent[] = [];
	const topics: string[] = [];

	// Resolve which extractor strategy to use (extended types → core extractor)
	const strategy = getExtractorStrategy(sessionType);

	for (let i = 0; i < turns.length; i++) {
		const turn = turns[i];
		const timestamp = turn.createdAt;

		if (turn.role === "user") {
			// User turns are always valuable — extract intent
			const userEvents = extractFromUserTurn(turn, timestamp, meta.id, provider);
			events.push(...userEvents);

			// Extract topics from user questions
			const topic = extractTopic(turn.content);
			if (topic && !topics.includes(topic)) {
				topics.push(topic);
			}
		} else if (turn.role === "assistant") {
			// Assistant turns: extract based on extractor strategy
			switch (strategy) {
				case "coding":
					events.push(...extractFromCodingAssistant(turn, timestamp, meta.id, provider));
					break;
				case "discussion":
					events.push(...extractFromDiscussionAssistant(turn, timestamp, meta.id, provider));
					break;
				case "mixed":
					// Try both extractors, take what sticks
					events.push(...extractFromCodingAssistant(turn, timestamp, meta.id, provider));
					events.push(...extractFromDiscussionAssistant(turn, timestamp, meta.id, provider));
					break;
				case "personal":
					// Keep short assistant responses fully
					if (turn.content.length < 500) {
						events.push({
							type: "action",
							summary: turn.content.split("\n")[0].slice(0, 200),
							timestamp,
							sessionId: meta.id,
							provider,
							turnNumber: turn.turnNumber,
						});
					}
					break;
			}
		}
	}

	// Deduplicate events with similar summaries
	const deduped = deduplicateEvents(events);

	// Sort by timestamp
	deduped.sort((a, b) => a.timestamp - b.timestamp);

	// Generate narrative
	const narrative = generateNarrative(sessionType, deduped, meta, provider);

	return { sessionType, events: deduped, narrative, topics, meta };
}

// ─── User Turn Extraction ───────────────────────────────────────────────────

function extractFromUserTurn(
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

function extractFromCodingAssistant(
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

function extractFromDiscussionAssistant(
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

/**
 * Extract a topic from user message content.
 */
function extractTopic(content: string): string | null {
	const firstLine = content.split("\n")[0].trim();
	if (firstLine.length < 5 || firstLine.length > 200) return null;

	// Remove common prefixes
	const cleaned = firstLine
		.replace(/^(?:hey|hi|hello|ok|okay|so|well|please|pls|can you|could you)\s+/i, "")
		.trim();

	return cleaned.length > 5 ? cleaned.slice(0, 100) : null;
}

/**
 * Deduplicate events with similar summaries.
 */
function deduplicateEvents(events: SessionEvent[]): SessionEvent[] {
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

/**
 * Generate a brief narrative summary from events.
 */
function generateNarrative(
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
