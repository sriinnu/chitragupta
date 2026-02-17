/**
 * @chitragupta/dharma — Punya: Agent karma and reputation tracking.
 * Named after the Sanskrit word for "merit/virtue" — the accumulated
 * moral weight of an agent's actions that determines its trust level.
 */

import { randomUUID } from "node:crypto";

// ─── Types ─────────────────────────────────────────────────────────────────

export type KarmaEventType =
	| "task_success"
	| "task_failure"
	| "task_timeout"
	| "peer_review_positive"
	| "peer_review_negative"
	| "tool_misuse"
	| "policy_violation"
	| "helpful_response"
	| "creative_solution"
	| "collaboration";

export interface KarmaEvent {
	id: string;
	agentId: string;
	type: KarmaEventType;
	delta: number;
	reason: string;
	timestamp: number;
}

export type TrustLevel = "untrusted" | "novice" | "trusted" | "veteran" | "elite";

export interface KarmaScore {
	agentId: string;
	/** Net karma: positive + negative (negative values are negative). */
	total: number;
	/** Sum of all positive deltas. */
	positive: number;
	/** Sum of all negative deltas (stored as a negative number). */
	negative: number;
	/** Total number of events recorded. */
	eventCount: number;
	/** Computed trust level based on total karma. */
	trustLevel: TrustLevel;
}

// ─── Default Karma Deltas ──────────────────────────────────────────────────

const KARMA_DELTAS: Record<KarmaEventType, number> = {
	task_success: 3,
	task_failure: -2,
	task_timeout: -1,
	peer_review_positive: 5,
	peer_review_negative: -3,
	tool_misuse: -5,
	policy_violation: -10,
	helpful_response: 2,
	creative_solution: 4,
	collaboration: 3,
};

// ─── Trust Level Computation ───────────────────────────────────────────────

/**
 * Maps total karma to a trust level using tiered thresholds.
 * The boundaries form a geometric-ish progression rewarding consistency:
 *   <0 untrusted, 0-9 novice, 10-49 trusted, 50-149 veteran, 150+ elite.
 */
function computeTrustLevel(total: number): TrustLevel {
	if (total < 0) return "untrusted";
	if (total < 10) return "novice";
	if (total < 50) return "trusted";
	if (total < 150) return "veteran";
	return "elite";
}

// ─── Serialization Format ──────────────────────────────────────────────────

interface SerializedKarma {
	version: 1;
	events: Record<string, KarmaEvent[]>;
}

// ─── Karma Tracker ─────────────────────────────────────────────────────────

/**
 * Tracks agent karma (reputation) through discrete events. Each event
 * carries a signed delta that accumulates into a total score per agent.
 * Trust levels are derived from the net score, gating what the agent
 * is allowed to do (e.g. untrusted agents get tighter policy checks).
 *
 * Supports persistence via serialize/deserialize for session continuity.
 *
 * @example
 * ```ts
 * const karma = new KarmaTracker();
 * karma.record("agent-1", "task_success", "Completed file refactor");
 * karma.record("agent-1", "policy_violation", "Tried to delete .env");
 * const score = karma.getScore("agent-1");
 * // score.total === -7, score.trustLevel === "untrusted"
 * ```
 */
export class KarmaTracker {
	/** agentId -> ordered list of karma events. */
	private events = new Map<string, KarmaEvent[]>();
	private readonly maxEventsPerAgent: number;

	constructor(config?: { maxEventsPerAgent?: number }) {
		this.maxEventsPerAgent = config?.maxEventsPerAgent ?? 1000;
	}

	// ─── Recording ───────────────────────────────────────────────────────

	/**
	 * Record a karma event for an agent. Uses the default delta for the
	 * event type unless a custom delta is provided.
	 *
	 * If the agent's event history exceeds maxEventsPerAgent, the oldest
	 * event is evicted (FIFO) to bound memory usage.
	 *
	 * @returns The created KarmaEvent.
	 */
	record(
		agentId: string,
		type: KarmaEventType,
		reason: string,
		customDelta?: number,
	): KarmaEvent {
		const event: KarmaEvent = {
			id: randomUUID(),
			agentId,
			type,
			delta: customDelta ?? KARMA_DELTAS[type],
			reason,
			timestamp: Date.now(),
		};

		let agentEvents = this.events.get(agentId);
		if (!agentEvents) {
			agentEvents = [];
			this.events.set(agentId, agentEvents);
		}

		agentEvents.push(event);

		// FIFO eviction when over capacity
		while (agentEvents.length > this.maxEventsPerAgent) {
			agentEvents.shift();
		}

		return event;
	}

	// ─── Scoring ─────────────────────────────────────────────────────────

	/** Compute the current karma score for an agent. */
	getScore(agentId: string): KarmaScore {
		const agentEvents = this.events.get(agentId) ?? [];

		let positive = 0;
		let negative = 0;

		for (const event of agentEvents) {
			if (event.delta >= 0) {
				positive += event.delta;
			} else {
				negative += event.delta;
			}
		}

		const total = positive + negative;

		return {
			agentId,
			total,
			positive,
			negative,
			eventCount: agentEvents.length,
			trustLevel: computeTrustLevel(total),
		};
	}

	/**
	 * Get all agent scores sorted by total karma descending.
	 * Useful for dashboards and multi-agent comparison.
	 */
	getLeaderboard(): KarmaScore[] {
		const scores: KarmaScore[] = [];
		for (const agentId of this.events.keys()) {
			scores.push(this.getScore(agentId));
		}
		scores.sort((a, b) => b.total - a.total);
		return scores;
	}

	// ─── History ─────────────────────────────────────────────────────────

	/** Get the full event history for an agent, ordered chronologically. */
	getHistory(agentId: string): KarmaEvent[] {
		return [...(this.events.get(agentId) ?? [])];
	}

	// ─── Mutation ────────────────────────────────────────────────────────

	/** Reset all karma for an agent, clearing their entire history. */
	reset(agentId: string): void {
		this.events.delete(agentId);
	}

	// ─── Persistence ─────────────────────────────────────────────────────

	/**
	 * Serialize all karma data to a JSON string for persistence.
	 * The format is versioned for forward compatibility.
	 */
	serialize(): string {
		const data: SerializedKarma = {
			version: 1,
			events: Object.fromEntries(this.events),
		};
		return JSON.stringify(data);
	}

	/**
	 * Restore karma state from a JSON string previously produced by serialize().
	 * Replaces all current state. Invalid data throws.
	 *
	 * @throws If the JSON is malformed or the version is unsupported.
	 */
	deserialize(json: string): void {
		const data = JSON.parse(json) as SerializedKarma;

		if (data.version !== 1) {
			throw new Error(`Unsupported karma serialization version: ${data.version}`);
		}

		this.events.clear();
		for (const [agentId, events] of Object.entries(data.events)) {
			// Enforce capacity on deserialized data
			const bounded = events.length > this.maxEventsPerAgent
				? events.slice(events.length - this.maxEventsPerAgent)
				: events;
			this.events.set(agentId, bounded);
		}
	}
}
