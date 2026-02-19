/**
 * @chitragupta/anina/chetana — AtmaDarshana internal computations.
 *
 * Wilson score CI, trend detection, calibration tracking, failure
 * streak monitoring, recovery tracking, learning velocity, style
 * fingerprint, and limitation management. All pure or side-effect-free
 * functions operating on passed-in data structures.
 */

import type { ChetanaConfig, SelfModel, ToolMastery } from "./types.js";
import { SYSTEM_MAX_CALIBRATION_WINDOW, SYSTEM_MAX_LIMITATIONS } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Z-value for 95% Wilson score confidence interval. */
export const WILSON_Z = 1.96;

/** Number of past invocations to compare against for trend detection. */
export const TREND_LOOKBACK = 10;

/** Threshold (absolute) for trend change detection. */
export const TREND_THRESHOLD = 0.05;

/** Consecutive failures before auto-recording a limitation. */
export const FAILURE_STREAK_LIMIT = 3;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Clamp a number to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Wilson score confidence interval for a binomial proportion.
 * When n = 0, returns [0, 1] (maximum uncertainty).
 */
export function wilsonInterval(n: number, p: number): [number, number] {
	if (n === 0) return [0, 1];
	const z2 = WILSON_Z * WILSON_Z;
	const denom = 1 + z2 / n;
	const center = p + z2 / (2 * n);
	const spread = WILSON_Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
	return [Math.max(0, (center - spread) / denom), Math.min(1, (center + spread) / denom)];
}

// ─── Trend Detection ─────────────────────────────────────────────────────────

/**
 * Update trend for a tool by comparing current success rate to the rate
 * recorded TREND_LOOKBACK invocations ago.
 */
export function updateTrend(
	toolName: string,
	mastery: ToolMastery,
	successRateHistory: Map<string, number[]>,
): void {
	let history = successRateHistory.get(toolName);
	if (!history) { history = []; successRateHistory.set(toolName, history); }
	history.push(mastery.successRate);

	if (history.length > TREND_LOOKBACK) {
		const pastRate = history[history.length - TREND_LOOKBACK - 1];
		const delta = mastery.successRate - pastRate;
		const prevTrend = mastery.trend;
		if (delta > TREND_THRESHOLD) mastery.trend = "improving";
		else if (delta < -TREND_THRESHOLD) mastery.trend = "declining";
		else mastery.trend = "stable";
		if (mastery.trend === "improving" && prevTrend !== "improving") mastery.lastImproved = Date.now();
	}
}

// ─── Calibration ─────────────────────────────────────────────────────────────

/** Record a predicted-vs-actual calibration entry and recompute the ratio. */
export function recordCalibration(
	predicted: number,
	actual: boolean,
	calibrationHistory: Array<{ predicted: number; actual: boolean }>,
	config: ChetanaConfig,
): number {
	const maxWindow = Math.min(config.calibrationWindow, SYSTEM_MAX_CALIBRATION_WINDOW);
	calibrationHistory.push({ predicted, actual });
	while (calibrationHistory.length > maxWindow) calibrationHistory.shift();

	const len = calibrationHistory.length;
	let sumPredicted = 0, sumActual = 0;
	for (const entry of calibrationHistory) {
		sumPredicted += entry.predicted;
		sumActual += entry.actual ? 1 : 0;
	}
	const avgPredicted = sumPredicted / len;
	const avgActual = sumActual / len;
	return avgActual === 0 ? Infinity : avgPredicted / avgActual;
}

// ─── Failure Streak ──────────────────────────────────────────────────────────

/**
 * Track consecutive failures per tool.
 * Returns a limitation string when the streak reaches FAILURE_STREAK_LIMIT, or null.
 */
export function updateFailureStreak(
	toolName: string,
	success: boolean,
	consecutiveFailures: Map<string, number>,
): string | null {
	if (success) { consecutiveFailures.set(toolName, 0); return null; }
	const count = (consecutiveFailures.get(toolName) ?? 0) + 1;
	consecutiveFailures.set(toolName, count);
	if (count >= FAILURE_STREAK_LIMIT) {
		return `Tool ${toolName} unreliable: ${count} consecutive failures`;
	}
	return null;
}

// ─── Recovery Tracking ───────────────────────────────────────────────────────

/** Per-tool error-to-recovery tracking state. */
export interface RecoveryTrackingEntry {
	errorTurn: number;
	recoveryTurns: number[];
}

/** Track error-to-recovery distance for computing error_recovery_speed. */
export function updateRecoveryTracking(
	toolName: string,
	success: boolean,
	turnCounter: number,
	recoveryTracking: Map<string, RecoveryTrackingEntry>,
): void {
	let tracking = recoveryTracking.get(toolName);
	if (!tracking) { tracking = { errorTurn: -1, recoveryTurns: [] }; recoveryTracking.set(toolName, tracking); }
	if (!success) { tracking.errorTurn = turnCounter; }
	else if (tracking.errorTurn >= 0) {
		tracking.recoveryTurns.push(turnCounter - tracking.errorTurn);
		tracking.errorTurn = -1;
	}
}

// ─── Learning Velocity ───────────────────────────────────────────────────────

/**
 * Compute learning velocity = (currentAvgSuccessRate - avgSuccessRate10TurnsAgo) / 10.
 */
export function recomputeLearningVelocity(
	toolMastery: Map<string, ToolMastery>,
	successRateHistory: Map<string, number[]>,
): number {
	const tools = [...toolMastery.values()];
	if (tools.length === 0) return 0;
	const currentAvg = tools.reduce((sum, t) => sum + t.successRate, 0) / tools.length;
	let pastSum = 0, pastCount = 0;
	for (const [, history] of successRateHistory) {
		if (history.length > TREND_LOOKBACK) {
			pastSum += history[history.length - TREND_LOOKBACK - 1];
			pastCount++;
		}
	}
	if (pastCount === 0) return 0;
	return (currentAvg - pastSum / pastCount) / TREND_LOOKBACK;
}

// ─── Style Fingerprint ───────────────────────────────────────────────────────

/** Recompute the behavioral style fingerprint. */
export function recomputeStyleFingerprint(
	fp: Map<string, number>,
	totalToolCalls: number,
	uniqueToolsSeen: Set<string>,
	turnCounter: number,
	recoveryTracking: Map<string, RecoveryTrackingEntry>,
): void {
	if (totalToolCalls > 0) fp.set("exploration_vs_exploitation", clamp(uniqueToolsSeen.size / totalToolCalls, 0, 1));
	if (turnCounter > 0) {
		const density = totalToolCalls / turnCounter;
		fp.set("tool_density", clamp(1 - 1 / (1 + density), 0, 1));
	}
	let totalDistance = 0, distanceCount = 0;
	for (const [, tracking] of recoveryTracking) {
		for (const d of tracking.recoveryTurns) { totalDistance += d; distanceCount++; }
	}
	if (distanceCount > 0) fp.set("error_recovery_speed", clamp(1 / (1 + totalDistance / distanceCount), 0, 1));
}

// ─── Limitation Management ───────────────────────────────────────────────────

/** Add a limitation string, deduplicating and capping at the configured maximum. */
export function addLimitation(
	limitation: string,
	knownLimitations: string[],
	config: ChetanaConfig,
): void {
	const max = Math.min(config.maxLimitations, SYSTEM_MAX_LIMITATIONS);
	if (knownLimitations.includes(limitation)) return;
	knownLimitations.push(limitation);
	while (knownLimitations.length > max) knownLimitations.shift();
}

// ─── Top Tool ────────────────────────────────────────────────────────────────

/** Get the name of the tool with highest success rate. */
export function getTopTool(toolMastery: Map<string, ToolMastery>): string | null {
	let best: string | null = null, bestRate = -1;
	for (const [name, m] of toolMastery) { if (m.successRate > bestRate) { bestRate = m.successRate; best = name; } }
	return best;
}
