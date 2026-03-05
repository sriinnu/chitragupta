/**
 * Natasha — The Watcher: Type Definitions
 *
 * Named after Natasha Romanoff (Black Widow), played by Scarlett Johansson —
 * the master spy who observes everything from the shadows, misses nothing,
 * and sees patterns others can't. Natasha watches the temporal pulse of the
 * system and surfaces trends, regressions, and velocity signals.
 *
 * Research basis:
 * - Zep/Graphiti (ArXiv 2501.13956): Bitemporal facts with event + ingestion time
 * - TG-RAG (ArXiv 2510.13590): Hierarchical time summaries
 * - MemoTime (ArXiv 2510.13614): Operator-aware temporal reasoning
 *
 * @module natasha-types
 */

// ─── Time Windows ───────────────────────────────────────────────────────────

/** Temporal window for trend analysis. */
export type TrendWindow = "hour" | "day" | "week" | "month";

/** All trend windows in order from finest to coarsest. */
export const TREND_WINDOWS: readonly TrendWindow[] = [
	"hour", "day", "week", "month",
] as const;

// ─── Trend Signals ──────────────────────────────────────────────────────────

/** Direction of a trend: rising, falling, or stable. */
export type TrendDirection = "rising" | "falling" | "stable";

/** A detected trend in entity mention frequency. */
export interface TrendSignal {
	/** The entity or topic being tracked. */
	entity: string;
	/** The time window over which the trend was detected. */
	window: TrendWindow;
	/** Direction of the trend. */
	direction: TrendDirection;
	/** Percentage change in frequency between current and previous period. */
	changePercent: number;
	/** Absolute count in the current period. */
	currentCount: number;
	/** Absolute count in the previous period. */
	previousCount: number;
	/** Confidence in the trend (0-1), based on sample size. */
	confidence: number;
	/** When this trend was detected (ISO timestamp). */
	detectedAt: string;
}

// ─── Regression Alerts ──────────────────────────────────────────────────────

/** Severity of a regression alert. */
export type RegressionSeverity = "info" | "warning" | "critical";

/** A detected regression — a previously fixed error recurring. */
export interface RegressionAlert {
	/** The normalized error signature that recurred. */
	errorSignature: string;
	/** A human-readable description of the error. */
	description: string;
	/** How many times this error occurred in the current period. */
	currentOccurrences: number;
	/** How many times this error occurred in the previous period. */
	previousOccurrences: number;
	/** Severity based on frequency delta. */
	severity: RegressionSeverity;
	/** When the error was last seen before the current recurrence. */
	lastSeenBefore: string;
	/** When this regression was detected (ISO timestamp). */
	detectedAt: string;
	/** The original fix (if recorded as an episodic solution). */
	knownFix?: string;
}

// ─── Velocity Metrics ───────────────────────────────────────────────────────

/** Coding velocity metrics for a time window. */
export interface VelocityMetrics {
	/** Time window these metrics cover. */
	window: TrendWindow;
	/** Start of the period (ISO timestamp). */
	periodStart: string;
	/** End of the period (ISO timestamp). */
	periodEnd: string;
	/** Number of sessions in this period. */
	sessionCount: number;
	/** Total turns across all sessions. */
	totalTurns: number;
	/** Average turns per session. */
	avgTurnsPerSession: number;
	/** Number of tool calls recorded. */
	toolCallCount: number;
	/** Files changed (from coding agent results). */
	filesChanged: number;
	/** Test pass rate (0-1) if tests were run. */
	testPassRate: number | null;
	/** Velocity compared to previous period (-1 to 1, 0 = same). */
	velocityDelta: number;
}

// ─── Natasha Configuration ───────────────────────────────────────────────────

/** Configuration for the Natasha temporal trending engine. */
export interface NatashaConfig {
	/** Minimum count threshold for a trend to be considered significant. */
	minCountThreshold: number;
	/** Minimum change percentage to flag as a trend. */
	minChangePercent: number;
	/** Number of recurrences before a regression is flagged as critical. */
	criticalRegressionThreshold: number;
	/** Maximum number of trends to return per window. */
	maxTrendsPerWindow: number;
}

/** Default Natasha configuration. */
export const DEFAULT_NATASHA_CONFIG: Readonly<NatashaConfig> = {
	minCountThreshold: 2,
	minChangePercent: 25,
	criticalRegressionThreshold: 3,
	maxTrendsPerWindow: 10,
} as const;

// ─── Database Types ─────────────────────────────────────────────────────────

/** Duck-typed database interface for Natasha queries. */
export interface NatashaDb {
	prepare(sql: string): {
		all(...params: unknown[]): unknown[];
		get(...params: unknown[]): unknown;
	};
}

/** Row shape for session count queries. */
export interface SessionCountRow {
	cnt: number;
}

/** Row shape for entity mention queries. */
export interface EntityMentionRow {
	entity: string;
	cnt: number;
}

/** Row shape for error frequency queries. */
export interface ErrorFrequencyRow {
	error_signature: string;
	description: string;
	solution: string | null;
	cnt: number;
	last_seen: string;
}

/** Row shape for tool call count queries. */
export interface ToolCallRow {
	cnt: number;
}

/** Row shape for file change count queries. */
export interface FileChangeRow {
	cnt: number;
}
