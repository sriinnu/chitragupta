/**
 * @chitragupta/anina/chetana — Sankalpa — संकल्प — Intention / Goal Persistence.
 *
 * The agent's volitional core — a system for extracting, tracking, and
 * persisting user intentions across turns and sessions. Sankalpa is the
 * solemn resolve that ensures the agent never forgets what the user asked
 * for, even across long multi-tool journeys.
 *
 * Internal computations (hashing, keyword extraction, pattern matching,
 * escalation, capacity) live in sankalpa-internals.ts.
 *
 * @packageDocumentation
 */

import type { ChetanaConfig, Intention } from "./types.js";
import {
	fnv1a, extractKeywords, matchPatterns, findSimilar,
	escalatePriority, enforceCapacity, maxEvidence,
	KEYWORD_MATCH_THRESHOLD, PROGRESS_INCREMENT,
} from "./sankalpa-internals.js";

// Re-export internals for consumers
export {
	fnv1a, extractKeywords, wordOverlap, extractUntilBoundary,
	matchPatterns, findSimilar, escalatePriority, enforceCapacity,
	DEDUP_THRESHOLD, ESCALATION_HIGH, ESCALATION_CRITICAL,
	KEYWORD_MATCH_THRESHOLD, PROGRESS_INCREMENT, INTENT_PATTERNS,
	SENTENCE_BOUNDARIES,
} from "./sankalpa-internals.js";

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

	constructor(config: ChetanaConfig, onEvent?: (event: string, data: unknown) => void) {
		this.config = config;
		this.onEvent = onEvent;
		this.intentions = new Map();
	}

	/** Returns all intentions (all statuses). */
	getIntentions(): Intention[] { return [...this.intentions.values()]; }

	/** Returns only active intentions. */
	getActiveIntentions(): Intention[] {
		return [...this.intentions.values()].filter((i) => i.status === "active");
	}

	/**
	 * Extract intentions from a user message.
	 * Scans for intent signal patterns, splits compound goals, deduplicates
	 * against existing active intentions, and caps at the configured maximum.
	 * @returns Newly created intentions (not duplicates).
	 */
	extractFromMessage(message: string): Intention[] {
		const rawGoals = matchPatterns(message);
		const created: Intention[] = [];

		for (const goalText of rawGoals) {
			const subGoals = goalText.includes(" and ")
				? goalText.split(" and ").map((s) => s.trim()).filter(Boolean)
				: [goalText.trim()];

			for (const goal of subGoals) {
				if (goal.length === 0) continue;
				const existing = findSimilar(goal, this.intentions);
				if (existing) {
					existing.mentionCount++;
					const changed = escalatePriority(existing);
					if (existing.status === "active" && existing.staleTurns === 0) {
						this.onEvent?.("chetana:goal_changed", { id: existing.id, status: "active" });
					}
					if (changed !== null) {
						this.onEvent?.("chetana:goal_changed", { id: existing.id, priority: existing.priority });
					}
					continue;
				}

				enforceCapacity(this.intentions, this.config);
				const now = Date.now();
				const intention: Intention = {
					id: fnv1a(goal), goal, priority: "normal", status: "active",
					progress: 0, createdAt: now, lastAdvancedAt: now,
					evidence: [], subgoals: [], staleTurns: 0, mentionCount: 1,
				};
				this.intentions.set(intention.id, intention);
				created.push(intention);
				this.onEvent?.("chetana:goal_created", { id: intention.id, goal: intention.goal });
			}
		}
		return created;
	}

	/**
	 * Check if a tool result advances any active intention.
	 * Extracts keywords from each active goal and checks content overlap.
	 */
	onToolResult(toolName: string, resultContent: string): void {
		const contentLower = resultContent.toLowerCase();
		const maxEv = maxEvidence(this.config);

		for (const intention of this.intentions.values()) {
			if (intention.status !== "active") continue;
			const keywords = extractKeywords(intention.goal);
			let matchCount = 0;
			for (const keyword of keywords) { if (contentLower.includes(keyword)) matchCount++; }

			if (matchCount >= KEYWORD_MATCH_THRESHOLD) {
				intention.progress = Math.min(1.0, intention.progress + PROGRESS_INCREMENT);
				intention.lastAdvancedAt = Date.now();
				intention.staleTurns = 0;
				if (intention.evidence.length < maxEv) intention.evidence.push(toolName);
			}
		}
	}

	/** Mark end of turn — increment stale counters and check abandonment. */
	endTurn(): void {
		const threshold = this.config.goalAbandonmentThreshold;
		for (const intention of this.intentions.values()) {
			if (intention.status === "active") {
				intention.staleTurns++;
				if (intention.staleTurns >= threshold) {
					intention.status = "paused";
					this.onEvent?.("chetana:goal_changed", { id: intention.id, status: "paused" });
				}
			} else if (intention.status === "paused") {
				intention.staleTurns++;
				if (intention.staleTurns >= threshold * 2) {
					intention.status = "abandoned";
					this.onEvent?.("chetana:goal_changed", { id: intention.id, status: "abandoned" });
				}
			}
		}
	}

	/** Manually mark an intention as achieved. */
	achieve(intentionId: string): void {
		const intention = this.intentions.get(intentionId);
		if (!intention) return;
		intention.status = "achieved";
		intention.progress = 1.0;
		this.onEvent?.("chetana:goal_changed", { id: intention.id, status: "achieved" });
	}

	/** Serialize all intentions to a plain array. */
	serialize(): Intention[] { return [...this.intentions.values()]; }

	/** Restore from serialized state. */
	static deserialize(
		data: Intention[],
		config: ChetanaConfig,
		onEvent?: (event: string, data: unknown) => void,
	): SankalpaSystem {
		const system = new SankalpaSystem(config, onEvent);
		for (const intention of data) system.intentions.set(intention.id, { ...intention });
		return system;
	}
}
