/**
 * Natasha — The Watcher: Temporal Trending Engine
 *
 * Named after Natasha Romanoff (Black Widow), played by Scarlett Johansson —
 * the master spy who observes everything from the shadows. She sees patterns
 * others can't, tracks targets across time, and never misses a regression.
 *
 * Three capabilities:
 * 1. **Trending Detection** — Track entity mention frequency across time
 *    windows. Entities trending up get boosted in recall results.
 * 2. **Regression Detection** — Compare error signature frequency between
 *    periods. If a fixed error recurs, emit a warning Akasha trace.
 * 3. **Velocity Tracking** — Measure coding velocity (sessions, turns,
 *    tool calls, files changed) per window and detect slowdowns.
 *
 * Research basis:
 * - Zep/Graphiti (ArXiv 2501.13956): Bitemporal KG, 18.5% accuracy gain
 * - TG-RAG (ArXiv 2510.13590): Hierarchical time summaries
 * - MemoTime (ArXiv 2510.13614): Operator-aware temporal reasoning
 * - MemWeaver (ArXiv 2601.18204): Three-tier memory, 95% context reduction
 *
 * @module natasha-observer
 */

import type {
	TrendWindow,
	TrendSignal,
	TrendDirection,
	RegressionAlert,
	RegressionSeverity,
	VelocityMetrics,
	NatashaConfig,
	NatashaDb,
	SessionCountRow,
	EntityMentionRow,
	ErrorFrequencyRow,
} from "./natasha-types.js";
import { DEFAULT_NATASHA_CONFIG, TREND_WINDOWS } from "./natasha-types.js";

// ─── Time Constants ─────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

/** Map trend windows to milliseconds. */
const WINDOW_MS: Readonly<Record<TrendWindow, number>> = {
	hour: HOUR_MS,
	day: DAY_MS,
	week: WEEK_MS,
	month: MONTH_MS,
};

// ─── Morgan Observer ────────────────────────────────────────────────────────

/**
 * Temporal trending engine that observes patterns across session history.
 *
 * @example
 * ```ts
 * const natasha = new NatashaObserver(db);
 * const trends = natasha.detectTrends("day");
 * const regressions = natasha.detectRegressions("week");
 * const velocity = natasha.measureVelocity("day");
 * ```
 */
export class NatashaObserver {
	private readonly db: NatashaDb;
	private readonly config: NatashaConfig;

	constructor(db: NatashaDb, config?: Partial<NatashaConfig>) {
		this.db = db;
		this.config = { ...DEFAULT_NATASHA_CONFIG, ...config };
	}

	// ─── Trending Detection ──────────────────────────────────────────────

	/**
	 * Detect trending entities in a given time window.
	 *
	 * Compares entity mention frequency between the current period and
	 * the equivalent previous period. Returns entities with significant
	 * changes in frequency.
	 *
	 * @param window - Time window to analyze.
	 * @param now - Optional override for "now" (ms). Defaults to Date.now().
	 * @returns Array of trend signals, sorted by absolute change descending.
	 */
	detectTrends(window: TrendWindow, now?: number): TrendSignal[] {
		const ts = now ?? Date.now();
		const windowMs = WINDOW_MS[window];
		const currentStart = new Date(ts - windowMs).toISOString();
		const currentEnd = new Date(ts).toISOString();
		const prevStart = new Date(ts - 2 * windowMs).toISOString();
		const prevEnd = currentStart;

		const current = this.queryEntityMentions(currentStart, currentEnd);
		const previous = this.queryEntityMentions(prevStart, prevEnd);

		const prevMap = new Map(previous.map((r) => [r.entity, r.cnt]));
		const signals: TrendSignal[] = [];

		for (const entry of current) {
			const prevCount = prevMap.get(entry.entity) ?? 0;
			const change = computeChange(entry.cnt, prevCount);
			const direction = classifyDirection(change, this.config.minChangePercent);

			if (
				direction !== "stable" &&
				entry.cnt >= this.config.minCountThreshold
			) {
				signals.push({
					entity: entry.entity,
					window,
					direction,
					changePercent: change,
					currentCount: entry.cnt,
					previousCount: prevCount,
					confidence: computeConfidence(entry.cnt, prevCount),
					detectedAt: new Date(ts).toISOString(),
				});
			}
		}

		// Also check entities that disappeared (were in prev, not in current)
		for (const prev of previous) {
			if (!current.some((c) => c.entity === prev.entity)) {
				if (prev.cnt >= this.config.minCountThreshold) {
					signals.push({
						entity: prev.entity,
						window,
						direction: "falling",
						changePercent: -100,
						currentCount: 0,
						previousCount: prev.cnt,
						confidence: computeConfidence(0, prev.cnt),
						detectedAt: new Date(ts).toISOString(),
					});
				}
			}
		}

		signals.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
		return signals.slice(0, this.config.maxTrendsPerWindow);
	}

	/**
	 * Detect trends across all windows simultaneously.
	 *
	 * @param now - Optional override for "now" (ms).
	 * @returns Map of window to trend signals.
	 */
	detectAllTrends(now?: number): Map<TrendWindow, TrendSignal[]> {
		const result = new Map<TrendWindow, TrendSignal[]>();
		for (const window of TREND_WINDOWS) {
			result.set(window, this.detectTrends(window, now));
		}
		return result;
	}

	// ─── Regression Detection ────────────────────────────────────────────

	/**
	 * Detect error regressions — previously fixed errors that are recurring.
	 *
	 * Compares error signature frequency between current and previous period.
	 * An error that was absent in the previous period but appears in the
	 * current period is a regression. Severity is based on occurrence count.
	 *
	 * @param window - Time window to analyze.
	 * @param now - Optional override for "now" (ms).
	 * @returns Array of regression alerts, sorted by severity descending.
	 */
	detectRegressions(window: TrendWindow, now?: number): RegressionAlert[] {
		const ts = now ?? Date.now();
		const windowMs = WINDOW_MS[window];
		const currentStart = new Date(ts - windowMs).toISOString();
		const currentEnd = new Date(ts).toISOString();
		const prevStart = new Date(ts - 2 * windowMs).toISOString();
		const prevEnd = currentStart;

		const current = this.queryErrorFrequency(currentStart, currentEnd);
		const previous = this.queryErrorFrequency(prevStart, prevEnd);

		const prevMap = new Map(previous.map((r) => [r.error_signature, r]));
		const alerts: RegressionAlert[] = [];

		for (const entry of current) {
			const prevEntry = prevMap.get(entry.error_signature);
			const prevCount = prevEntry?.cnt ?? 0;

			// Regression: error was absent or declining, now recurring
			if (prevCount === 0 || entry.cnt > prevCount * 1.5) {
				alerts.push({
					errorSignature: entry.error_signature,
					description: entry.description,
					currentOccurrences: entry.cnt,
					previousOccurrences: prevCount,
					severity: classifySeverity(
						entry.cnt,
						this.config.criticalRegressionThreshold,
					),
					lastSeenBefore: entry.last_seen,
					detectedAt: new Date(ts).toISOString(),
					knownFix: entry.solution ?? undefined,
				});
			}
		}

		const severityRank: Record<RegressionSeverity, number> = {
			critical: 3,
			warning: 2,
			info: 1,
		};
		alerts.sort(
			(a, b) => severityRank[b.severity] - severityRank[a.severity],
		);
		return alerts;
	}

	// ─── Velocity Tracking ───────────────────────────────────────────────

	/**
	 * Measure coding velocity for a time window.
	 *
	 * Tracks sessions, turns, tool calls, and files changed in the current
	 * period vs the previous period. Returns a velocity delta indicating
	 * whether productivity is increasing or decreasing.
	 *
	 * @param window - Time window to measure.
	 * @param now - Optional override for "now" (ms).
	 * @returns Velocity metrics with delta comparison.
	 */
	measureVelocity(window: TrendWindow, now?: number): VelocityMetrics {
		const ts = now ?? Date.now();
		const windowMs = WINDOW_MS[window];
		const currentStart = new Date(ts - windowMs).toISOString();
		const currentEnd = new Date(ts).toISOString();
		const prevStart = new Date(ts - 2 * windowMs).toISOString();
		const prevEnd = currentStart;

		const currentSessions = this.querySessionCount(currentStart, currentEnd);
		const prevSessions = this.querySessionCount(prevStart, prevEnd);

		const currentTurns = this.queryTurnCount(currentStart, currentEnd);
		const prevTurns = this.queryTurnCount(prevStart, prevEnd);

		const avgTurns = currentSessions > 0
			? currentTurns / currentSessions
			: 0;

		// Composite velocity: weighted combination of session and turn deltas
		const sessionDelta = normalizedDelta(currentSessions, prevSessions);
		const turnDelta = normalizedDelta(currentTurns, prevTurns);
		const velocityDelta = 0.4 * sessionDelta + 0.6 * turnDelta;

		return {
			window,
			periodStart: currentStart,
			periodEnd: currentEnd,
			sessionCount: currentSessions,
			totalTurns: currentTurns,
			avgTurnsPerSession: Math.round(avgTurns * 10) / 10,
			toolCallCount: 0,
			filesChanged: 0,
			testPassRate: null,
			velocityDelta: Math.round(velocityDelta * 1000) / 1000,
		};
	}

	// ─── Summary ─────────────────────────────────────────────────────────

	/**
	 * Generate a comprehensive temporal summary across all windows.
	 *
	 * @param now - Optional override for "now" (ms).
	 * @returns Summary object with trends, regressions, and velocity.
	 */
	observe(now?: number): NatashaSummary {
		const trends = this.detectAllTrends(now);
		const regressions = this.detectRegressions("day", now);
		const velocity = this.measureVelocity("day", now);

		return {
			trends: Object.fromEntries(trends) as Record<TrendWindow, TrendSignal[]>,
			regressions,
			velocity,
			observedAt: new Date(now ?? Date.now()).toISOString(),
		};
	}

	// ─── Database Queries ────────────────────────────────────────────────

	/** Query entity mentions from memory entries within a time range. */
	private queryEntityMentions(start: string, end: string): EntityMentionRow[] {
		try {
			return this.db.prepare(`
				SELECT content AS entity, COUNT(*) AS cnt
				FROM memory
				WHERE scope = 'project'
				  AND updated_at >= ? AND updated_at <= ?
				GROUP BY content
				HAVING cnt >= 1
				ORDER BY cnt DESC
				LIMIT 50
			`).all(start, end) as EntityMentionRow[];
		} catch {
			return [];
		}
	}

	/** Query error frequencies from episodes within a time range. */
	private queryErrorFrequency(start: string, end: string): ErrorFrequencyRow[] {
		try {
			return this.db.prepare(`
				SELECT error_signature, description, solution,
				       COUNT(*) AS cnt, MAX(created_at) AS last_seen
				FROM episodes
				WHERE error_signature IS NOT NULL
				  AND created_at >= ? AND created_at <= ?
				GROUP BY error_signature
				ORDER BY cnt DESC
				LIMIT 20
			`).all(start, end) as ErrorFrequencyRow[];
		} catch {
			return [];
		}
	}

	/** Query session count within a time range. */
	private querySessionCount(start: string, end: string): number {
		try {
			const row = this.db.prepare(
				`SELECT COUNT(*) AS cnt FROM sessions WHERE created >= ? AND created <= ?`,
			).get(start, end) as SessionCountRow | undefined;
			return row?.cnt ?? 0;
		} catch {
			return 0;
		}
	}

	/** Query total turn count within a time range. */
	private queryTurnCount(start: string, end: string): number {
		try {
			const row = this.db.prepare(
				`SELECT COALESCE(SUM(turn_count), 0) AS cnt FROM sessions WHERE created >= ? AND created <= ?`,
			).get(start, end) as SessionCountRow | undefined;
			return row?.cnt ?? 0;
		} catch {
			return 0;
		}
	}
}

// ─── Summary Type ───────────────────────────────────────────────────────────

/** Complete temporal observation summary. */
export interface NatashaSummary {
	/** Trends by time window. */
	trends: Record<TrendWindow, TrendSignal[]>;
	/** Detected error regressions (daily window). */
	regressions: RegressionAlert[];
	/** Velocity metrics (daily window). */
	velocity: VelocityMetrics;
	/** When this observation was made (ISO timestamp). */
	observedAt: string;
}

// ─── Pure Functions ─────────────────────────────────────────────────────────

/** Compute percentage change between two counts. */
function computeChange(current: number, previous: number): number {
	if (previous === 0) return current > 0 ? 100 : 0;
	return Math.round(((current - previous) / previous) * 100);
}

/** Classify a percentage change into a trend direction. */
function classifyDirection(
	changePercent: number,
	threshold: number,
): TrendDirection {
	if (changePercent >= threshold) return "rising";
	if (changePercent <= -threshold) return "falling";
	return "stable";
}

/** Compute confidence based on sample sizes. */
function computeConfidence(current: number, previous: number): number {
	const total = current + previous;
	if (total === 0) return 0;
	// Confidence grows with sample size, capped at 1.0
	return Math.min(1, total / 20);
}

/** Classify regression severity based on occurrence count. */
function classifySeverity(
	count: number,
	criticalThreshold: number,
): RegressionSeverity {
	if (count >= criticalThreshold) return "critical";
	if (count >= 2) return "warning";
	return "info";
}

/** Compute normalized delta between two values (-1 to 1). */
function normalizedDelta(current: number, previous: number): number {
	const sum = current + previous;
	if (sum === 0) return 0;
	return (current - previous) / sum;
}
