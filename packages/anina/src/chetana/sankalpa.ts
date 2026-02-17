/**
 * @chitragupta/anina/chetana — Sankalpa — संकल्प — Intention / Goal Persistence.
 *
 * The agent's volitional core — a system for extracting, tracking, and
 * persisting user intentions across turns and sessions. In the Vedic
 * tradition, Sankalpa is the solemn resolve, the unwavering intention
 * that precedes action. Here it ensures the agent never forgets what
 * the user actually asked for, even across long multi-tool journeys.
 *
 * ## Lifecycle
 *
 * ```
 * User message → extractFromMessage() → Intention (active)
 *     ↓
 * Tool result → onToolResult() → progress += 0.1 (if keywords match)
 *     ↓
 * End of turn → endTurn() → staleTurns++ → paused → abandoned
 *     ↓
 * Explicit   → achieve() → achieved (progress = 1.0)
 * ```
 *
 * ## Priority Escalation
 *
 * When a user re-mentions an existing goal, `mentionCount` increments.
 * At 3 mentions: normal → high. At 5 mentions: high → critical.
 *
 * ## Events
 *
 * - `chetana:goal_changed` — emitted when an intention's status changes
 * - `chetana:goal_created` — emitted when a new intention is extracted
 *
 * @packageDocumentation
 */

import type { ChetanaConfig, Intention, IntentionPriority } from "./types.js";
import { SYSTEM_MAX_EVIDENCE, SYSTEM_MAX_INTENTIONS } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET = 0x811c9dc5;

/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;

/** Minimum word overlap ratio for deduplication. */
const DEDUP_THRESHOLD = 0.5;

/** Mention count threshold for normal → high escalation. */
const ESCALATION_HIGH = 3;

/** Mention count threshold for high → critical escalation. */
const ESCALATION_CRITICAL = 5;

/** Minimum matching keywords to advance progress from a tool result. */
const KEYWORD_MATCH_THRESHOLD = 2;

/** Progress increment per matching tool result. */
const PROGRESS_INCREMENT = 0.1;

/**
 * Intent signal patterns (case-insensitive).
 *
 * Each pattern is a phrase prefix that signals a user intention.
 * The text after the match (until a sentence boundary) becomes the goal.
 */
const INTENT_PATTERNS: string[] = [
	"i want to ",
	"let's ",
	"let us ",
	"goal is ",
	"we need to ",
	"fix the ",
	"add a ",
	"add an ",
	"implement ",
	"create a ",
	"build a ",
	"write a ",
	"remove ",
	"delete ",
	"update ",
	"change ",
	"make ",
	"refactor ",
];

/** Sentence boundary characters for goal extraction. */
const SENTENCE_BOUNDARIES = new Set([".", "!", "?", ","]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash.
 *
 * Produces a deterministic hex string ID from arbitrary text.
 * Used to create stable intention IDs from goal descriptions.
 */
function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME) >>> 0;
	}
	return hash.toString(16);
}

/**
 * Extract keywords from a goal string.
 *
 * Lowercases, splits on non-alphanumeric boundaries, filters out
 * stop words and tokens shorter than 3 characters.
 */
function extractKeywords(goal: string): Set<string> {
	const stopWords = new Set([
		"the", "a", "an", "is", "are", "was", "were", "be", "been",
		"being", "have", "has", "had", "do", "does", "did", "will",
		"would", "could", "should", "may", "might", "shall", "can",
		"to", "of", "in", "for", "on", "with", "at", "by", "from",
		"and", "or", "but", "not", "this", "that", "it", "its",
	]);

	const words = goal.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
	const keywords = new Set<string>();

	for (const word of words) {
		if (word.length >= 3 && !stopWords.has(word)) {
			keywords.add(word);
		}
	}

	return keywords;
}

/**
 * Compute word overlap ratio between two strings.
 *
 * Returns the fraction of words in the shorter set that appear
 * in the longer set. Used for goal deduplication.
 */
function wordOverlap(a: string, b: string): number {
	const wordsA = extractKeywords(a);
	const wordsB = extractKeywords(b);

	if (wordsA.size === 0 || wordsB.size === 0) return 0;

	const [smaller, larger] = wordsA.size <= wordsB.size
		? [wordsA, wordsB]
		: [wordsB, wordsA];

	let overlap = 0;
	for (const word of smaller) {
		if (larger.has(word)) overlap++;
	}

	return overlap / smaller.size;
}

// ─── SankalpaSystem ──────────────────────────────────────────────────────────

/**
 * Intention persistence and goal tracking for the Chetana consciousness layer.
 *
 * Extracts goals from user messages via pattern matching, tracks progress
 * through keyword overlap with tool results, detects stale/abandoned goals,
 * and escalates priority when the user repeatedly mentions a goal.
 */
export class SankalpaSystem {
	private intentions: Map<string, Intention>;
	private config: ChetanaConfig;
	private onEvent?: (event: string, data: unknown) => void;

	constructor(
		config: ChetanaConfig,
		onEvent?: (event: string, data: unknown) => void,
	) {
		this.config = config;
		this.onEvent = onEvent;
		this.intentions = new Map();
	}

	// ─── Accessors ─────────────────────────────────────────────────────────

	/** Returns all intentions (all statuses). */
	getIntentions(): Intention[] {
		return [...this.intentions.values()];
	}

	/** Returns only active intentions. */
	getActiveIntentions(): Intention[] {
		return [...this.intentions.values()].filter((i) => i.status === "active");
	}

	// ─── Goal Extraction ───────────────────────────────────────────────────

	/**
	 * Extract intentions from a user message.
	 *
	 * Scans for intent signal patterns, extracts goal text until the
	 * next sentence boundary, splits compound goals on " and ",
	 * deduplicates against existing active intentions, and caps at
	 * the configured maximum.
	 *
	 * @returns Newly created intentions (not duplicates).
	 */
	extractFromMessage(message: string): Intention[] {
		const rawGoals = this.matchPatterns(message);
		const created: Intention[] = [];

		for (const goalText of rawGoals) {
			// Split compound goals
			const subGoals = goalText.includes(" and ")
				? goalText.split(" and ").map((s) => s.trim()).filter(Boolean)
				: [goalText.trim()];

			for (const goal of subGoals) {
				if (goal.length === 0) continue;

				// Check for duplicate among active intentions
				const existing = this.findSimilar(goal);
				if (existing) {
					existing.mentionCount++;
					this.escalatePriority(existing);
					continue;
				}

				// Enforce capacity
				this.enforceCapacity();

				const now = Date.now();
				const intention: Intention = {
					id: fnv1a(goal),
					goal,
					priority: "normal",
					status: "active",
					progress: 0,
					createdAt: now,
					lastAdvancedAt: now,
					evidence: [],
					subgoals: [],
					staleTurns: 0,
					mentionCount: 1,
				};

				this.intentions.set(intention.id, intention);
				created.push(intention);

				this.onEvent?.("chetana:goal_created", {
					id: intention.id,
					goal: intention.goal,
				});
			}
		}

		return created;
	}

	// ─── Progress Tracking ─────────────────────────────────────────────────

	/**
	 * Check if a tool result advances any active intention.
	 *
	 * For each active intention, extracts keywords from the goal and
	 * checks if the tool result content contains enough matching keywords.
	 * If so, increments progress and records evidence.
	 */
	onToolResult(toolName: string, resultContent: string): void {
		const contentLower = resultContent.toLowerCase();
		const maxEvidence = Math.min(
			this.config.maxEvidencePerIntention,
			SYSTEM_MAX_EVIDENCE,
		);

		for (const intention of this.intentions.values()) {
			if (intention.status !== "active") continue;

			const keywords = extractKeywords(intention.goal);
			let matchCount = 0;

			for (const keyword of keywords) {
				if (contentLower.includes(keyword)) {
					matchCount++;
				}
			}

			if (matchCount >= KEYWORD_MATCH_THRESHOLD) {
				intention.progress = Math.min(1.0, intention.progress + PROGRESS_INCREMENT);
				intention.lastAdvancedAt = Date.now();
				intention.staleTurns = 0;

				if (intention.evidence.length < maxEvidence) {
					intention.evidence.push(toolName);
				}
			}
		}
	}

	// ─── Turn Lifecycle ────────────────────────────────────────────────────

	/**
	 * Mark end of turn -- increment stale counters and check abandonment.
	 *
	 * - Active intentions with staleTurns >= threshold -> paused
	 * - Paused intentions with staleTurns >= threshold * 2 -> abandoned
	 */
	endTurn(): void {
		const threshold = this.config.goalAbandonmentThreshold;

		for (const intention of this.intentions.values()) {
			if (intention.status === "active") {
				intention.staleTurns++;

				if (intention.staleTurns >= threshold) {
					intention.status = "paused";
					this.onEvent?.("chetana:goal_changed", {
						id: intention.id,
						status: "paused",
					});
				}
			} else if (intention.status === "paused") {
				intention.staleTurns++;

				if (intention.staleTurns >= threshold * 2) {
					intention.status = "abandoned";
					this.onEvent?.("chetana:goal_changed", {
						id: intention.id,
						status: "abandoned",
					});
				}
			}
		}
	}

	// ─── Achievement ───────────────────────────────────────────────────────

	/** Manually mark an intention as achieved. */
	achieve(intentionId: string): void {
		const intention = this.intentions.get(intentionId);
		if (!intention) return;

		intention.status = "achieved";
		intention.progress = 1.0;

		this.onEvent?.("chetana:goal_changed", {
			id: intention.id,
			status: "achieved",
		});
	}

	// ─── Serialization ─────────────────────────────────────────────────────

	/** Serialize all intentions to a plain array. */
	serialize(): Intention[] {
		return [...this.intentions.values()];
	}

	/** Restore from serialized state. */
	static deserialize(
		data: Intention[],
		config: ChetanaConfig,
		onEvent?: (event: string, data: unknown) => void,
	): SankalpaSystem {
		const system = new SankalpaSystem(config, onEvent);

		for (const intention of data) {
			system.intentions.set(intention.id, { ...intention });
		}

		return system;
	}

	// ─── Internal: Pattern Matching ────────────────────────────────────────

	/**
	 * Scan message text for intent signal patterns.
	 *
	 * Returns raw goal strings extracted after each matched pattern,
	 * terminated at the next sentence boundary or end of string.
	 */
	private matchPatterns(message: string): string[] {
		const lower = message.toLowerCase();
		const goals: string[] = [];

		for (const pattern of INTENT_PATTERNS) {
			let searchFrom = 0;

			// Find all occurrences of this pattern in the message
			while (searchFrom < lower.length) {
				const idx = lower.indexOf(pattern, searchFrom);
				if (idx === -1) break;

				const start = idx + pattern.length;
				// Use the original message casing for the extracted goal
				const goalText = this.extractUntilBoundary(message, start);

				if (goalText.length > 0) {
					goals.push(goalText);
				}

				searchFrom = start;
			}
		}

		return goals;
	}

	/**
	 * Extract text from a starting index until the next sentence boundary.
	 */
	private extractUntilBoundary(text: string, start: number): string {
		let end = start;
		while (end < text.length && !SENTENCE_BOUNDARIES.has(text[end])) {
			end++;
		}
		return text.slice(start, end).trim();
	}

	// ─── Internal: Deduplication ───────────────────────────────────────────

	/**
	 * Find an existing active intention that is similar to the given goal.
	 *
	 * Returns the matching intention if word overlap exceeds DEDUP_THRESHOLD,
	 * or null if no similar intention exists.
	 */
	private findSimilar(goal: string): Intention | null {
		for (const intention of this.intentions.values()) {
			if (intention.status !== "active" && intention.status !== "paused") {
				continue;
			}

			if (wordOverlap(goal, intention.goal) >= DEDUP_THRESHOLD) {
				return intention;
			}
		}

		return null;
	}

	// ─── Internal: Priority Escalation ─────────────────────────────────────

	/**
	 * Escalate an intention's priority based on mention count.
	 *
	 * - mentionCount >= 3 and normal -> high
	 * - mentionCount >= 5 and high -> critical
	 */
	private escalatePriority(intention: Intention): void {
		const prevPriority = intention.priority;

		if (intention.mentionCount >= ESCALATION_CRITICAL && intention.priority === "high") {
			intention.priority = "critical";
		} else if (intention.mentionCount >= ESCALATION_HIGH && intention.priority === "normal") {
			intention.priority = "high";
		}

		// Re-activate paused intentions that are being re-mentioned
		if (intention.status === "paused") {
			intention.status = "active";
			intention.staleTurns = 0;
			this.onEvent?.("chetana:goal_changed", {
				id: intention.id,
				status: "active",
			});
		}

		if (intention.priority !== prevPriority) {
			this.onEvent?.("chetana:goal_changed", {
				id: intention.id,
				priority: intention.priority,
			});
		}
	}

	// ─── Internal: Capacity Enforcement ────────────────────────────────────

	/**
	 * Enforce the maximum intentions cap.
	 *
	 * If at capacity, removes the lowest-priority abandoned/paused
	 * intention first, then the oldest abandoned, then the oldest paused.
	 */
	private enforceCapacity(): void {
		const maxIntentions = Math.min(
			this.config.maxIntentions,
			SYSTEM_MAX_INTENTIONS,
		);

		if (this.intentions.size < maxIntentions) return;

		// Priority order for removal: abandoned > paused > active
		// Within same status, remove lowest priority then oldest
		const priorityRank: Record<IntentionPriority, number> = {
			low: 0,
			normal: 1,
			high: 2,
			critical: 3,
		};

		const statusRank: Record<string, number> = {
			abandoned: 0,
			paused: 1,
			achieved: 2,
			active: 3,
		};

		// Find the best candidate for removal
		let victim: Intention | null = null;
		let victimScore = Infinity;

		for (const intention of this.intentions.values()) {
			// Score: lower = more removable
			const score =
				statusRank[intention.status] * 100 +
				priorityRank[intention.priority] * 10 +
				(1 - intention.createdAt / Date.now()) * 1; // older = lower

			if (score < victimScore) {
				victimScore = score;
				victim = intention;
			}
		}

		if (victim) {
			this.intentions.delete(victim.id);
		}
	}
}
