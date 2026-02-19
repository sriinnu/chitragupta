/**
 * @chitragupta/smriti -- Kala Chakra (काल चक्र -- Wheel of Time)
 * Multi-Scale Temporal Awareness Engine.
 *
 * Provides temporal context across 7 scales (turn -> year) and computes
 * relevance scores via weighted exponential decay:
 *   decay_s(t) = exp(-ln(2) * t / halfLife_s)
 *   relevance(t) = Sigma_s weight_s * decay_s(t)
 *   boosted = original * (0.5 + 0.5 * relevance(t))
 *
 * Constants, temporal context builders, and DB query helpers live in
 * temporal-context.ts; this file owns the KalaChakra class and types.
 *
 * @module
 */

import {
	buildTemporalContext,
	DAY,
	HOUR,
	MINUTE,
	DEFAULT_DECAY_RATES,
	DEFAULT_SCALE_WEIGHTS,
	HARD_CEILINGS,
	SCALE_BOUNDARIES,
} from "./temporal-context.js";

// Re-export temporal-context utilities so downstream consumers
// that import from kala-chakra.ts still find everything.
export {
	buildTemporalContext,
	isoWeek,
	quarterFromMonth,
	mondayOfISOWeek,
	safeGet,
	DEFAULT_DECAY_RATES,
	DEFAULT_SCALE_WEIGHTS,
	HARD_CEILINGS,
	SCALE_BOUNDARIES,
} from "./temporal-context.js";
export type { TemporalCounts } from "./temporal-context.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** The 7 temporal scales from micro to macro. */
export type TemporalScale = "turn" | "session" | "day" | "week" | "month" | "quarter" | "year";

/** All 7 scales in order from finest to coarsest. */
export const TEMPORAL_SCALES: readonly TemporalScale[] = [
	"turn", "session", "day", "week", "month", "quarter", "year",
] as const;

/** Temporal context snapshot at all 7 scales. */
export interface KalaContext {
	turn: TurnContext;
	session: SessionContext;
	day: DayContext;
	week: WeekContext;
	month: MonthContext;
	quarter: QuarterContext;
	year: YearContext;
}

/** Context for the current turn (finest granularity). */
export interface TurnContext {
	/** Current turn number within the session. */
	turnNumber: number;
	/** Milliseconds since this turn started. */
	elapsed: number;
	/** Tokens consumed so far in this turn. */
	tokensSoFar: number;
}

/** Context for the current session. */
export interface SessionContext {
	/** Active session identifier. */
	sessionId: string;
	/** Total turns in this session so far. */
	turnCount: number;
	/** Milliseconds since the session started. */
	elapsed: number;
	/** Total tokens consumed across the session. */
	tokenTotal: number;
}

/** Context for the current day. */
export interface DayContext {
	/** Current date in YYYY-MM-DD format. */
	date: string;
	/** Number of sessions started today. */
	sessionsToday: number;
	/** Number of turns across all sessions today. */
	turnsToday: number;
}

/** Context for the current ISO week. */
export interface WeekContext {
	/** ISO 8601 week number (1-53). */
	weekNumber: number;
	/** ISO year for the week. */
	year: number;
	/** Sessions started this week. */
	sessionsThisWeek: number;
	/** Average turns per session this week. */
	avgTurnsPerSession: number;
}

/** Context for the current month. */
export interface MonthContext {
	/** Month number (1-12). */
	month: number;
	/** Year. */
	year: number;
	/** Sessions started this month. */
	sessionsThisMonth: number;
	/** Vasanas crystallized this month. */
	vasanasThisMonth: number;
}

/** Context for the current quarter. */
export interface QuarterContext {
	/** Quarter number (1-4). */
	quarter: number;
	/** Year. */
	year: number;
	/** Sessions started this quarter. */
	sessionsThisQuarter: number;
}

/** Context for the current year. */
export interface YearContext {
	/** Year. */
	year: number;
	/** Sessions started this year. */
	sessionsThisYear: number;
	/** Vasanas crystallized this year. */
	vasanasThisYear: number;
	/** Vidhis (procedures) learned this year. */
	vidhisThisYear: number;
}

// ─── Current State ──────────────────────────────────────────────────────────

/**
 * Snapshot of the agent's current operational state.
 * Fed into buildContext() to populate the turn and session scales.
 */
export interface CurrentState {
	/** Current turn number within the session. */
	turnNumber: number;
	/** Unix timestamp (ms) when the current turn started. */
	turnStartedAt: number;
	/** Tokens consumed so far in this turn. */
	tokensSoFar: number;
	/** Active session identifier. */
	sessionId: string;
	/** Unix timestamp (ms) when the session started. */
	sessionStartedAt: number;
	/** Total turns in this session so far. */
	sessionTurnCount: number;
	/** Total tokens consumed across the session. */
	sessionTokenTotal: number;
}

// ─── Database Interface ─────────────────────────────────────────────────────

/**
 * Duck-typed database interface for querying historical counts.
 * Only requires prepare().get() with parameter binding.
 */
export interface DatabaseLike {
	prepare(sql: string): {
		get(...params: unknown[]): unknown;
	};
}

// ─── Configuration ──────────────────────────────────────────────────────────

/** Configuration for the Kala Chakra temporal engine. */
export interface KalaChakraConfig {
	/** Half-life in milliseconds per scale. Controls how fast relevance decays. */
	decayRates: Record<TemporalScale, number>;
	/** Importance weight per scale. Should sum to 1.0 for normalized relevance. */
	scaleWeights: Record<TemporalScale, number>;
}

// ─── LN2 Constant ───────────────────────────────────────────────────────────

/** ln(2) = 0.693147... Used in exponential decay formula. */
const LN2 = Math.LN2;

// ─── KalaChakra Class ───────────────────────────────────────────────────────

/**
 * Kala Chakra -- Multi-Scale Temporal Awareness Engine.
 *
 * Provides temporal context across 7 granularities and computes
 * relevance scores that respect the natural timescale of each memory.
 *
 * @example
 * ```ts
 * const kala = new KalaChakra();
 *
 * // Recent document (5 minutes ago) gets high relevance
 * kala.relevanceScore(Date.now() - 300_000); // ~0.95
 *
 * // Old document (90 days ago) gets low relevance
 * kala.relevanceScore(Date.now() - 90 * 86_400_000); // ~0.12
 *
 * // Boost a search score with temporal awareness
 * kala.boostScore(0.8, Date.now() - 300_000); // ~0.78
 * kala.boostScore(0.8, Date.now() - 90 * 86_400_000); // ~0.45
 * ```
 */
export class KalaChakra {
	private readonly _decayRates: Record<TemporalScale, number>;
	private readonly _scaleWeights: Record<TemporalScale, number>;

	constructor(config?: Partial<KalaChakraConfig>) {
		// Merge with defaults, then clamp to hard ceilings
		this._decayRates = { ...DEFAULT_DECAY_RATES };
		this._scaleWeights = { ...DEFAULT_SCALE_WEIGHTS };

		if (config?.decayRates) {
			for (const scale of TEMPORAL_SCALES) {
				if (config.decayRates[scale] !== undefined) {
					this._decayRates[scale] = clamp(
						config.decayRates[scale],
						HARD_CEILINGS.minDecayRate,
						HARD_CEILINGS.maxDecayRate,
					);
				}
			}
		}

		if (config?.scaleWeights) {
			for (const scale of TEMPORAL_SCALES) {
				if (config.scaleWeights[scale] !== undefined) {
					this._scaleWeights[scale] = clamp(
						config.scaleWeights[scale],
						HARD_CEILINGS.minWeight,
						HARD_CEILINGS.maxWeight,
					);
				}
			}
		}
	}

	// ─── Core Methods ─────────────────────────────────────────────────────

	/**
	 * Build full temporal context from current state + optional database.
	 *
	 * Delegates to the standalone buildTemporalContext() function in
	 * temporal-context.ts for the actual context construction.
	 *
	 * @param state - Current operational state (turn + session info).
	 * @param db - Optional duck-typed database for historical queries.
	 * @param now - Optional override for "now" (ms). Defaults to Date.now().
	 * @returns Full temporal context snapshot across all 7 scales.
	 */
	buildContext(state: CurrentState, db?: DatabaseLike, now?: number): KalaContext {
		return buildTemporalContext(state, db, now);
	}

	/**
	 * Compute temporal relevance score for a document/memory.
	 *
	 * Weighted sum of exponential decay across all 7 scales:
	 *   score = Sigma_s weight_s * exp(-ln(2) * elapsed / halfLife_s)
	 *
	 * Returns a value in [0, 1]:
	 *   - 1.0 for a document at t=0 (if weights sum to 1)
	 *   - Approaches 0 as elapsed -> infinity
	 *
	 * @param documentTimestamp - Unix timestamp (ms) of the document.
	 * @param now - Optional override for "now" (ms). Defaults to Date.now().
	 * @returns Temporal relevance score in [0, 1].
	 */
	relevanceScore(documentTimestamp: number, now?: number): number {
		const ts = now ?? Date.now();
		const elapsed = Math.max(0, ts - documentTimestamp);

		let score = 0;
		for (const scale of TEMPORAL_SCALES) {
			score += this._scaleWeights[scale] * this._decayForScale(elapsed, scale);
		}

		return score;
	}

	/**
	 * Compute temporal relevance for a specific scale only.
	 *
	 * When a scale is provided, returns only that scale's weighted decay.
	 * When no scale is provided, returns the full multi-scale relevance
	 * (equivalent to relevanceScore).
	 *
	 * @param documentTimestamp - Unix timestamp (ms) of the document.
	 * @param scale - Optional specific scale to evaluate.
	 * @param now - Optional override for "now" (ms). Defaults to Date.now().
	 * @returns Temporal relevance score.
	 */
	multiScaleRelevance(documentTimestamp: number, scale?: TemporalScale, now?: number): number {
		const ts = now ?? Date.now();
		const elapsed = Math.max(0, ts - documentTimestamp);

		if (scale) {
			return this._scaleWeights[scale] * this._decayForScale(elapsed, scale);
		}

		return this.relevanceScore(documentTimestamp, ts);
	}

	/**
	 * Get the dominant temporal scale for a given time distance.
	 *
	 * Returns the most natural scale to reason about the elapsed time:
	 *   - < 5 min -> turn
	 *   - < 2 hours -> session
	 *   - < 36 hours -> day
	 *   - < 10 days -> week
	 *   - < 45 days -> month
	 *   - < 120 days -> quarter
	 *   - else -> year
	 *
	 * @param elapsedMs - Time distance in milliseconds.
	 * @returns The dominant temporal scale.
	 */
	dominantScale(elapsedMs: number): TemporalScale {
		const abs = Math.abs(elapsedMs);
		for (const [threshold, scale] of SCALE_BOUNDARIES) {
			if (abs < threshold) return scale;
		}
		return "year";
	}

	/**
	 * Boost a search score based on temporal relevance.
	 *
	 * Formula: boosted = original * (0.5 + 0.5 * relevance)
	 *
	 * This ensures:
	 *   - Recent documents (relevance ~ 1) retain ~100% of their score
	 *   - Ancient documents (relevance ~ 0) retain ~50% of their score
	 *   - Documents are never fully suppressed by age alone
	 *
	 * @param originalScore - The pre-boost retrieval score.
	 * @param documentTimestamp - Unix timestamp (ms) of the document.
	 * @param now - Optional override for "now" (ms). Defaults to Date.now().
	 * @returns Temporally-boosted score.
	 */
	boostScore(originalScore: number, documentTimestamp: number, now?: number): number {
		const rel = this.relevanceScore(documentTimestamp, now);
		return originalScore * (0.5 + 0.5 * rel);
	}

	/**
	 * Get the decay factor for a specific temporal scale.
	 *
	 * Formula: exp(-ln(2) * elapsed / halfLife)
	 *
	 * At t=0 the factor is 1.0, at t=halfLife it is 0.5, and it
	 * asymptotically approaches 0 as t -> infinity.
	 *
	 * @param elapsedMs - Time distance in milliseconds.
	 * @param scale - The temporal scale to use for half-life.
	 * @returns Decay factor in [0, 1].
	 */
	decayFactor(elapsedMs: number, scale: TemporalScale): number {
		return this._decayForScale(Math.max(0, elapsedMs), scale);
	}

	// ─── Serialization ────────────────────────────────────────────────────

	/**
	 * Serialize the Kala Chakra configuration for persistence.
	 *
	 * @returns A plain object suitable for JSON serialization.
	 */
	serialize(): { decayRates: Record<TemporalScale, number>; scaleWeights: Record<TemporalScale, number> } {
		return {
			decayRates: { ...this._decayRates },
			scaleWeights: { ...this._scaleWeights },
		};
	}

	/**
	 * Restore configuration from a previously serialized object.
	 *
	 * @param data - Previously serialized state from `serialize()`.
	 */
	restore(data: { decayRates?: Record<TemporalScale, number>; scaleWeights?: Record<TemporalScale, number> }): void {
		if (!data || typeof data !== "object") return;

		if (data.decayRates && typeof data.decayRates === "object") {
			for (const scale of TEMPORAL_SCALES) {
				if (typeof data.decayRates[scale] === "number") {
					this._decayRates[scale] = clamp(
						data.decayRates[scale],
						HARD_CEILINGS.minDecayRate,
						HARD_CEILINGS.maxDecayRate,
					);
				}
			}
		}

		if (data.scaleWeights && typeof data.scaleWeights === "object") {
			for (const scale of TEMPORAL_SCALES) {
				if (typeof data.scaleWeights[scale] === "number") {
					this._scaleWeights[scale] = clamp(
						data.scaleWeights[scale],
						HARD_CEILINGS.minWeight,
						HARD_CEILINGS.maxWeight,
					);
				}
			}
		}
	}

	// ─── Accessors ────────────────────────────────────────────────────────

	/** Get current decay rates (read-only copy). */
	get decayRates(): Readonly<Record<TemporalScale, number>> {
		return { ...this._decayRates };
	}

	/** Get current scale weights (read-only copy). */
	get scaleWeights(): Readonly<Record<TemporalScale, number>> {
		return { ...this._scaleWeights };
	}

	// ─── Private ──────────────────────────────────────────────────────────

	/** Compute exponential decay for a given elapsed time and scale. */
	private _decayForScale(elapsedMs: number, scale: TemporalScale): number {
		const halfLife = this._decayRates[scale];
		if (halfLife <= 0) return 0;
		return Math.exp(-LN2 * elapsedMs / halfLife);
	}
}

// ─── Helper Functions ───────────────────────────────────────────────────────

/** Clamp a value between min and max. */
function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
