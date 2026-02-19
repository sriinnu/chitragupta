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
import {
	getExtractorStrategy,
	extractFromUserTurn,
	extractFromCodingAssistant,
	extractFromDiscussionAssistant,
	extractTopic,
	deduplicateEvents,
	generateNarrative,
} from "./event-extractor-strategies.js";

// Re-export strategy function for external consumers
export { getExtractorStrategy } from "./event-extractor-strategies.js";

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
 * - AND the domain signal score >= 2 (strong enough signal)
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
	if (topDomain && topScore >= 2) {
		return topDomain;
	}

	return coreType;
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
