/**
 * @chitragupta/smriti -- Temporal Context Builders
 *
 * Extracted from kala-chakra.ts: standalone functions for temporal context
 * construction, period-boundary detection, and database-backed count queries.
 *
 * These utilities support the KalaChakra engine by computing ISO week numbers,
 * quarter boundaries, and querying historical session/vasana/vidhi counts
 * across day, week, month, quarter, and year scales.
 *
 * @module
 */

import type {
	TemporalScale,
	KalaContext,
	TurnContext,
	SessionContext,
	CurrentState,
	DatabaseLike,
} from "./kala-chakra.js";

// ─── Time Constants ─────────────────────────────────────────────────────────

/** One minute in milliseconds. */
export const MINUTE = 60_000;

/** One hour in milliseconds. */
export const HOUR = 3_600_000;

/** One day in milliseconds. */
export const DAY = 86_400_000;

// ─── Defaults & Hard Ceilings ───────────────────────────────────────────────

/** Default half-lives for each temporal scale. */
export const DEFAULT_DECAY_RATES: Readonly<Record<TemporalScale, number>> = {
	turn: MINUTE,               // 1 minute
	session: HOUR,              // 1 hour
	day: DAY,                   // 1 day
	week: 7 * DAY,              // 7 days
	month: 30 * DAY,            // 30 days
	quarter: 90 * DAY,          // 90 days
	year: 365 * DAY,            // 365 days
};

/** Default importance weights per scale. Sum = 1.0. */
export const DEFAULT_SCALE_WEIGHTS: Readonly<Record<TemporalScale, number>> = {
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
export const HARD_CEILINGS = {
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
export const SCALE_BOUNDARIES: ReadonlyArray<readonly [number, TemporalScale]> = [
	[5 * MINUTE, "turn"],       // < 5 minutes -> turn
	[2 * HOUR, "session"],      // < 2 hours -> session
	[36 * HOUR, "day"],         // < 36 hours -> day
	[10 * DAY, "week"],         // < 10 days -> week
	[45 * DAY, "month"],        // < 45 days -> month
	[120 * DAY, "quarter"],     // < 120 days -> quarter
];

// ─── Temporal Count Results ─────────────────────────────────────────────────

/** Aggregated historical counts across day/week/month/quarter/year scales. */
export interface TemporalCounts {
	/** Sessions started today. */
	sessionsToday: number;
	/** Turns across all sessions today. */
	turnsToday: number;
	/** Sessions started this ISO week. */
	sessionsThisWeek: number;
	/** Turns across all sessions this ISO week. */
	turnsThisWeek: number;
	/** Sessions started this month. */
	sessionsThisMonth: number;
	/** Vasanas crystallized this month. */
	vasanasThisMonth: number;
	/** Sessions started this quarter. */
	sessionsThisQuarter: number;
	/** Sessions started this year. */
	sessionsThisYear: number;
	/** Vasanas crystallized this year. */
	vasanasThisYear: number;
	/** Vidhis (procedures) learned this year. */
	vidhisThisYear: number;
}

/** Row shape returned by COUNT(*)/SUM(*) aggregate queries. */
interface CountRow {
	cnt: number;
}

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
export function isoWeek(date: Date): [number, number] {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	// Set to nearest Thursday: current date + 4 - current day number (Mon=1, Sun=7)
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY + 1) / 7);
	return [d.getUTCFullYear(), weekNo];
}

// ─── Helper: Quarter from Month ─────────────────────────────────────────────

/**
 * Get the quarter (1-4) from a 1-based month number.
 *
 * @param month - Month number (1-12).
 * @returns Quarter number (1-4).
 */
export function quarterFromMonth(month: number): number {
	return Math.ceil(month / 3);
}

// ─── Monday of ISO Week ─────────────────────────────────────────────────────

/**
 * Compute the Monday of a given ISO week.
 *
 * @param isoYear - ISO year.
 * @param isoWeekNum - ISO week number (1-53).
 * @returns Date object for the Monday of that week.
 */
export function mondayOfISOWeek(isoYear: number, isoWeekNum: number): Date {
	// Jan 4th is always in ISO week 1
	const jan4 = new Date(Date.UTC(isoYear, 0, 4));
	const jan4DayOfWeek = jan4.getUTCDay() || 7; // Mon=1 ... Sun=7
	// Monday of week 1
	const mondayW1 = new Date(jan4.getTime() - (jan4DayOfWeek - 1) * DAY);
	// Monday of target week
	return new Date(mondayW1.getTime() + (isoWeekNum - 1) * 7 * DAY);
}

// ─── Safe Database Access ───────────────────────────────────────────────────

/**
 * Safe database get -- catches errors from missing tables/columns.
 * Returns undefined on failure.
 *
 * @param db - Duck-typed database handle.
 * @param sql - SQL query string.
 * @param params - Bind parameters for the query.
 * @returns Query result or undefined if the query fails.
 */
export function safeGet(db: DatabaseLike, sql: string, ...params: unknown[]): unknown {
	try {
		return db.prepare(sql).get(...params);
	} catch {
		return undefined;
	}
}

// ─── Query Temporal Counts ──────────────────────────────────────────────────

/**
 * Query historical session, vasana, and vidhi counts from the database
 * across day, week, month, quarter, and year scales.
 *
 * All queries are wrapped in safeGet to handle missing tables gracefully.
 * Returns zero counts when queries fail or the database lacks the expected tables.
 *
 * @param db - Duck-typed database handle.
 * @param dateStr - Current date in YYYY-MM-DD format.
 * @param isoYear - ISO year for week computation.
 * @param weekNum - ISO week number.
 * @param monthNum - Month number (1-12).
 * @param yearNum - Calendar year.
 * @param qtr - Quarter number (1-4).
 * @returns Aggregated temporal counts.
 */
export function queryTemporalCounts(
	db: DatabaseLike,
	dateStr: string,
	isoYear: number,
	weekNum: number,
	monthNum: number,
	yearNum: number,
	qtr: number,
): TemporalCounts {
	// Day counts
	const dayStart = `${dateStr}T00:00:00`;
	const dayEnd = `${dateStr}T23:59:59`;

	const dayRow = safeGet(db, "SELECT COUNT(*) as cnt FROM sessions WHERE created >= ? AND created <= ?", dayStart, dayEnd);
	const sessionsToday = (dayRow as CountRow | undefined)?.cnt ?? 0;

	const dayTurnsRow = safeGet(db, "SELECT SUM(turn_count) as cnt FROM sessions WHERE created >= ? AND created <= ?", dayStart, dayEnd);
	const turnsToday = (dayTurnsRow as CountRow | undefined)?.cnt ?? 0;

	// Week counts: compute the Monday of the current ISO week
	const weekStartDate = mondayOfISOWeek(isoYear, weekNum);
	const weekEndDate = new Date(weekStartDate.getTime() + 7 * DAY - 1);
	const weekStart = weekStartDate.toISOString().slice(0, 19);
	const weekEnd = weekEndDate.toISOString().slice(0, 19);

	const weekRow = safeGet(db, "SELECT COUNT(*) as cnt FROM sessions WHERE created >= ? AND created <= ?", weekStart, weekEnd);
	const sessionsThisWeek = (weekRow as CountRow | undefined)?.cnt ?? 0;

	const weekTurnsRow = safeGet(db, "SELECT SUM(turn_count) as cnt FROM sessions WHERE created >= ? AND created <= ?", weekStart, weekEnd);
	const turnsThisWeek = (weekTurnsRow as CountRow | undefined)?.cnt ?? 0;

	// Month counts
	const monthStart = `${yearNum}-${String(monthNum).padStart(2, "0")}-01T00:00:00`;
	const monthEnd = `${yearNum}-${String(monthNum).padStart(2, "0")}-31T23:59:59`;

	const monthRow = safeGet(db, "SELECT COUNT(*) as cnt FROM sessions WHERE created >= ? AND created <= ?", monthStart, monthEnd);
	const sessionsThisMonth = (monthRow as CountRow | undefined)?.cnt ?? 0;

	const vasanaMonthRow = safeGet(db, "SELECT COUNT(*) as cnt FROM vasanas WHERE created_at >= ? AND created_at <= ?", new Date(`${yearNum}-${String(monthNum).padStart(2, "0")}-01`).getTime(), new Date(`${yearNum}-${String(monthNum).padStart(2, "0")}-31T23:59:59`).getTime());
	const vasanasThisMonth = (vasanaMonthRow as CountRow | undefined)?.cnt ?? 0;

	// Quarter counts
	const qtrStartMonth = (qtr - 1) * 3 + 1;
	const qtrEndMonth = qtr * 3;
	const qtrStart = `${yearNum}-${String(qtrStartMonth).padStart(2, "0")}-01T00:00:00`;
	const qtrEnd = `${yearNum}-${String(qtrEndMonth).padStart(2, "0")}-31T23:59:59`;

	const qtrRow = safeGet(db, "SELECT COUNT(*) as cnt FROM sessions WHERE created >= ? AND created <= ?", qtrStart, qtrEnd);
	const sessionsThisQuarter = (qtrRow as CountRow | undefined)?.cnt ?? 0;

	// Year counts
	const yearStart = `${yearNum}-01-01T00:00:00`;
	const yearEnd = `${yearNum}-12-31T23:59:59`;

	const yearRow = safeGet(db, "SELECT COUNT(*) as cnt FROM sessions WHERE created >= ? AND created <= ?", yearStart, yearEnd);
	const sessionsThisYear = (yearRow as CountRow | undefined)?.cnt ?? 0;

	const vasanaYearRow = safeGet(db, "SELECT COUNT(*) as cnt FROM vasanas WHERE created_at >= ? AND created_at <= ?", new Date(`${yearNum}-01-01`).getTime(), new Date(`${yearNum}-12-31T23:59:59`).getTime());
	const vasanasThisYear = (vasanaYearRow as CountRow | undefined)?.cnt ?? 0;

	const vidhiYearRow = safeGet(db, "SELECT COUNT(*) as cnt FROM vidhis WHERE created_at >= ? AND created_at <= ?", new Date(`${yearNum}-01-01`).getTime(), new Date(`${yearNum}-12-31T23:59:59`).getTime());
	const vidhisThisYear = (vidhiYearRow as CountRow | undefined)?.cnt ?? 0;

	return {
		sessionsToday,
		turnsToday,
		sessionsThisWeek,
		turnsThisWeek,
		sessionsThisMonth,
		vasanasThisMonth,
		sessionsThisQuarter,
		sessionsThisYear,
		vasanasThisYear,
		vidhisThisYear,
	};
}

// ─── Build Full Temporal Context ────────────────────────────────────────────

/**
 * Build the full 7-scale temporal context from current state and optional database.
 *
 * Turn and session scales are populated from the CurrentState parameter.
 * Day, week, month, quarter, and year scales require database access
 * for historical counts. When no database is provided, these scales
 * return zero counts.
 *
 * @param state - Current operational state (turn + session info).
 * @param db - Optional duck-typed database for historical queries.
 * @param now - Optional override for "now" (ms). Defaults to Date.now().
 * @returns Full temporal context snapshot across all 7 scales.
 */
export function buildTemporalContext(state: CurrentState, db?: DatabaseLike, now?: number): KalaContext {
	const ts = now ?? Date.now();
	const date = new Date(ts);
	const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
	const monthNum = date.getMonth() + 1; // 1-12
	const yearNum = date.getFullYear();
	const [isoYear, weekNum] = isoWeek(date);
	const qtr = quarterFromMonth(monthNum);

	// Turn + Session (from state, no DB needed)
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

	// Day / Week / Month / Quarter / Year (from DB)
	let counts: TemporalCounts = {
		sessionsToday: 0,
		turnsToday: 0,
		sessionsThisWeek: 0,
		turnsThisWeek: 0,
		sessionsThisMonth: 0,
		vasanasThisMonth: 0,
		sessionsThisQuarter: 0,
		sessionsThisYear: 0,
		vasanasThisYear: 0,
		vidhisThisYear: 0,
	};

	if (db) {
		counts = queryTemporalCounts(db, dateStr, isoYear, weekNum, monthNum, yearNum, qtr);
	}

	const avgTurns = counts.sessionsThisWeek > 0 ? counts.turnsThisWeek / counts.sessionsThisWeek : 0;

	return {
		turn,
		session,
		day: {
			date: dateStr,
			sessionsToday: counts.sessionsToday,
			turnsToday: counts.turnsToday,
		},
		week: {
			weekNumber: weekNum,
			year: isoYear,
			sessionsThisWeek: counts.sessionsThisWeek,
			avgTurnsPerSession: avgTurns,
		},
		month: {
			month: monthNum,
			year: yearNum,
			sessionsThisMonth: counts.sessionsThisMonth,
			vasanasThisMonth: counts.vasanasThisMonth,
		},
		quarter: {
			quarter: qtr,
			year: yearNum,
			sessionsThisQuarter: counts.sessionsThisQuarter,
		},
		year: {
			year: yearNum,
			sessionsThisYear: counts.sessionsThisYear,
			vasanasThisYear: counts.vasanasThisYear,
			vidhisThisYear: counts.vidhisThisYear,
		},
	};
}
