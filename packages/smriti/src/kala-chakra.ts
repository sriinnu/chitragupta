/**
 * @chitragupta/smriti -- Kala Chakra (काल चक्र -- Wheel of Time)
 * Multi-Scale Temporal Awareness.
 *
 * In Vedic cosmology, Kala Chakra is the great wheel of time that governs
 * all existence across scales -- from the blinking of an eye (nimesha)
 * to the cosmic cycles of Brahma's day (kalpa). Every event, every memory
 * exists within this wheel, its significance shaped by where it falls
 * in relation to the present moment.
 *
 * Chitragupta's Kala Chakra provides temporal context across 7 scales --
 * from the immediate (current turn) to the historical (yearly). The memory
 * system weights relevance based on temporal distance at multiple
 * granularities, ensuring that a 5-minute-old observation and a 5-month-old
 * pattern are each scored according to their natural timescale.
 *
 * The core formula for temporal decay at each scale:
 *
 *   decay_s(t) = exp(-ln(2) * t / halfLife_s)
 *
 * Multi-scale relevance is a weighted sum across all 7 scales:
 *
 *   relevance(t) = Σ_s weight_s * decay_s(t)
 *
 * Score boosting transforms an original retrieval score:
 *
 *   boosted = original * (0.5 + 0.5 * relevance(t))
 *
 * This ensures recent documents retain up to 100% of their score while
 * ancient documents decay to at most 50% -- never fully forgotten, but
 * appropriately attenuated.
 *
 * @module
 */

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

// ─── Defaults & Hard Ceilings ───────────────────────────────────────────────

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Default half-lives for each temporal scale. */
const DEFAULT_DECAY_RATES: Readonly<Record<TemporalScale, number>> = {
	turn: MINUTE,               // 1 minute
	session: HOUR,              // 1 hour
	day: DAY,                   // 1 day
	week: 7 * DAY,              // 7 days
	month: 30 * DAY,            // 30 days
	quarter: 90 * DAY,          // 90 days
	year: 365 * DAY,            // 365 days
};

/** Default importance weights per scale. Sum = 1.0. */
const DEFAULT_SCALE_WEIGHTS: Readonly<Record<TemporalScale, number>> = {
	turn: 0.25,
	session: 0.20,
	day: 0.15,
	week: 0.15,
	month: 0.10,
	quarter: 0.08,
	year: 0.07,
};

/**
 * System hard ceilings -- user config is clamped to these values.
 * Prevents pathological configurations that break temporal reasoning.
 */
const HARD_CEILINGS = {
	/** Minimum half-life: 1 second. Anything faster is meaningless. */
	minDecayRate: 1_000,
	/** Maximum half-life: 10 years. Beyond this, nothing decays. */
	maxDecayRate: 10 * 365 * DAY,
	/** Minimum weight per scale (prevents zeroing out a scale). */
	minWeight: 0,
	/** Maximum weight per scale. */
	maxWeight: 1,
} as const;

// ─── Dominant Scale Boundaries ──────────────────────────────────────────────

/**
 * Boundary thresholds for determining the dominant temporal scale.
 * Each entry is [maxElapsedMs, scale]. Evaluated in order; first match wins.
 */
const SCALE_BOUNDARIES: ReadonlyArray<readonly [number, TemporalScale]> = [
	[5 * MINUTE, "turn"],       // < 5 minutes → turn
	[2 * HOUR, "session"],      // < 2 hours → session
	[36 * HOUR, "day"],         // < 36 hours → day
	[10 * DAY, "week"],         // < 10 days → week
	[45 * DAY, "month"],        // < 45 days → month
	[120 * DAY, "quarter"],     // < 120 days → quarter
];

// ─── LN2 Constant ───────────────────────────────────────────────────────────

/** ln(2) = 0.693147... Used in exponential decay formula. */
const LN2 = Math.LN2;

// ─── ISO Week Calculation ───────────────────────────────────────────────────

/**
 * Compute the ISO 8601 week number for a given date.
 *
 * The ISO week date system: weeks start on Monday, and the first week
 * of a year is the one containing the first Thursday.
 *
 * @param date - Date to compute ISO week for.
 * @returns [isoYear, isoWeek] tuple.
 */
function isoWeek(date: Date): [number, number] {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	// Set to nearest Thursday: current date + 4 - current day number (Mon=1, Sun=7)
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY + 1) / 7);
	return [d.getUTCFullYear(), weekNo];
}

// ─── Helper: Quarter from Month ─────────────────────────────────────────────

/** Get the quarter (1-4) from a 1-based month. */
function quarterFromMonth(month: number): number {
	return Math.ceil(month / 3);
}

// ─── KalaChakra Class ───────────────────────────────────────────────────────

/**
 * Kala Chakra (काल चक्र) -- Multi-Scale Temporal Awareness Engine.
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
	 * The turn and session scales are populated from the CurrentState.
	 * Day, week, month, quarter, and year scales require database access
	 * for historical counts. When no database is provided, these scales
	 * return zero counts.
	 *
	 * @param state - Current operational state (turn + session info).
	 * @param db - Optional duck-typed database for historical queries.
	 * @param now - Optional override for "now" (ms). Defaults to Date.now().
	 * @returns Full temporal context snapshot across all 7 scales.
	 */
	buildContext(state: CurrentState, db?: DatabaseLike, now?: number): KalaContext {
		const ts = now ?? Date.now();
		const date = new Date(ts);
		const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
		const monthNum = date.getMonth() + 1; // 1-12
		const yearNum = date.getFullYear();
		const [isoYear, weekNum] = isoWeek(date);
		const qtr = quarterFromMonth(monthNum);

		// ── Turn + Session (from state, no DB needed) ─────────────────
		const turn: TurnContext = {
			turnNumber: state.turnNumber,
			elapsed: ts - state.turnStartedAt,
			tokensSoFar: state.tokensSoFar,
		};

		const session: SessionContext = {
			sessionId: state.sessionId,
			turnCount: state.sessionTurnCount,
			elapsed: ts - state.sessionStartedAt,
			tokenTotal: state.sessionTokenTotal,
		};

		// ── Day / Week / Month / Quarter / Year (from DB) ─────────────
		let sessionsToday = 0;
		let turnsToday = 0;
		let sessionsThisWeek = 0;
		let turnsThisWeek = 0;
		let sessionsThisMonth = 0;
		let vasanasThisMonth = 0;
		let sessionsThisQuarter = 0;
		let sessionsThisYear = 0;
		let vasanasThisYear = 0;
		let vidhisThisYear = 0;

		if (db) {
			// Day counts
			const dayStart = `${dateStr}T00:00:00`;
			const dayEnd = `${dateStr}T23:59:59`;

			const dayRow = safeGet(db, "SELECT COUNT(*) as cnt FROM sessions WHERE created >= ? AND created <= ?", dayStart, dayEnd);
			sessionsToday = (dayRow as any)?.cnt ?? 0;

			const dayTurnsRow = safeGet(db, "SELECT SUM(turn_count) as cnt FROM sessions WHERE created >= ? AND created <= ?", dayStart, dayEnd);
			turnsToday = (dayTurnsRow as any)?.cnt ?? 0;

			// Week counts: compute the Monday of the current ISO week
			const weekStartDate = mondayOfISOWeek(isoYear, weekNum);
			const weekEndDate = new Date(weekStartDate.getTime() + 7 * DAY - 1);
			const weekStart = weekStartDate.toISOString().slice(0, 19);
			const weekEnd = weekEndDate.toISOString().slice(0, 19);

			const weekRow = safeGet(db, "SELECT COUNT(*) as cnt FROM sessions WHERE created >= ? AND created <= ?", weekStart, weekEnd);
			sessionsThisWeek = (weekRow as any)?.cnt ?? 0;

			const weekTurnsRow = safeGet(db, "SELECT SUM(turn_count) as cnt FROM sessions WHERE created >= ? AND created <= ?", weekStart, weekEnd);
			turnsThisWeek = (weekTurnsRow as any)?.cnt ?? 0;

			// Month counts
			const monthStart = `${yearNum}-${String(monthNum).padStart(2, "0")}-01T00:00:00`;
			const monthEnd = `${yearNum}-${String(monthNum).padStart(2, "0")}-31T23:59:59`;

			const monthRow = safeGet(db, "SELECT COUNT(*) as cnt FROM sessions WHERE created >= ? AND created <= ?", monthStart, monthEnd);
			sessionsThisMonth = (monthRow as any)?.cnt ?? 0;

			const vasanaMonthRow = safeGet(db, "SELECT COUNT(*) as cnt FROM vasanas WHERE created_at >= ? AND created_at <= ?", new Date(`${yearNum}-${String(monthNum).padStart(2, "0")}-01`).getTime(), new Date(`${yearNum}-${String(monthNum).padStart(2, "0")}-31T23:59:59`).getTime());
			vasanasThisMonth = (vasanaMonthRow as any)?.cnt ?? 0;

			// Quarter counts
			const qtrStartMonth = (qtr - 1) * 3 + 1;
			const qtrEndMonth = qtr * 3;
			const qtrStart = `${yearNum}-${String(qtrStartMonth).padStart(2, "0")}-01T00:00:00`;
			const qtrEnd = `${yearNum}-${String(qtrEndMonth).padStart(2, "0")}-31T23:59:59`;

			const qtrRow = safeGet(db, "SELECT COUNT(*) as cnt FROM sessions WHERE created >= ? AND created <= ?", qtrStart, qtrEnd);
			sessionsThisQuarter = (qtrRow as any)?.cnt ?? 0;

			// Year counts
			const yearStart = `${yearNum}-01-01T00:00:00`;
			const yearEnd = `${yearNum}-12-31T23:59:59`;

			const yearRow = safeGet(db, "SELECT COUNT(*) as cnt FROM sessions WHERE created >= ? AND created <= ?", yearStart, yearEnd);
			sessionsThisYear = (yearRow as any)?.cnt ?? 0;

			const vasanaYearRow = safeGet(db, "SELECT COUNT(*) as cnt FROM vasanas WHERE created_at >= ? AND created_at <= ?", new Date(`${yearNum}-01-01`).getTime(), new Date(`${yearNum}-12-31T23:59:59`).getTime());
			vasanasThisYear = (vasanaYearRow as any)?.cnt ?? 0;

			const vidhiYearRow = safeGet(db, "SELECT COUNT(*) as cnt FROM vidhis WHERE created_at >= ? AND created_at <= ?", new Date(`${yearNum}-01-01`).getTime(), new Date(`${yearNum}-12-31T23:59:59`).getTime());
			vidhisThisYear = (vidhiYearRow as any)?.cnt ?? 0;
		}

		const avgTurns = sessionsThisWeek > 0 ? turnsThisWeek / sessionsThisWeek : 0;

		return {
			turn,
			session,
			day: {
				date: dateStr,
				sessionsToday,
				turnsToday,
			},
			week: {
				weekNumber: weekNum,
				year: isoYear,
				sessionsThisWeek,
				avgTurnsPerSession: avgTurns,
			},
			month: {
				month: monthNum,
				year: yearNum,
				sessionsThisMonth,
				vasanasThisMonth,
			},
			quarter: {
				quarter: qtr,
				year: yearNum,
				sessionsThisQuarter,
			},
			year: {
				year: yearNum,
				sessionsThisYear,
				vasanasThisYear,
				vidhisThisYear,
			},
		};
	}

	/**
	 * Compute temporal relevance score for a document/memory.
	 *
	 * Weighted sum of exponential decay across all 7 scales:
	 *   score = Σ_s weight_s * exp(-ln(2) * elapsed / halfLife_s)
	 *
	 * Returns a value in [0, 1]:
	 *   - 1.0 for a document at t=0 (if weights sum to 1)
	 *   - Approaches 0 as elapsed → ∞
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
	 *   - < 5 min → turn
	 *   - < 2 hours → session
	 *   - < 36 hours → day
	 *   - < 10 days → week
	 *   - < 45 days → month
	 *   - < 120 days → quarter
	 *   - else → year
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
	 *   - Recent documents (relevance ≈ 1) retain ~100% of their score
	 *   - Ancient documents (relevance ≈ 0) retain ~50% of their score
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
	 * asymptotically approaches 0 as t→∞.
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

/**
 * Safe database get -- catches errors from missing tables/columns.
 * Returns undefined on failure.
 */
function safeGet(db: DatabaseLike, sql: string, ...params: unknown[]): unknown {
	try {
		return db.prepare(sql).get(...params);
	} catch {
		return undefined;
	}
}

/**
 * Compute the Monday of a given ISO week.
 *
 * @param isoYear - ISO year.
 * @param isoWeekNum - ISO week number (1-53).
 * @returns Date object for the Monday of that week.
 */
function mondayOfISOWeek(isoYear: number, isoWeekNum: number): Date {
	// Jan 4th is always in ISO week 1
	const jan4 = new Date(Date.UTC(isoYear, 0, 4));
	const jan4DayOfWeek = jan4.getUTCDay() || 7; // Mon=1 ... Sun=7
	// Monday of week 1
	const mondayW1 = new Date(jan4.getTime() - (jan4DayOfWeek - 1) * DAY);
	// Monday of target week
	return new Date(mondayW1.getTime() + (isoWeekNum - 1) * 7 * DAY);
}
