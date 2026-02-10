/**
 * @chitragupta/anina/chetana — Atma-Darshana — आत्मदर्शन — Self-Model / Metacognition.
 *
 * The agent's mirror — a statistical self-portrait built from observed
 * tool outcomes, calibration measurements, and behavioral fingerprints.
 * Like the Upanishadic injunction "Atmanam Viddhi" (know thyself), this
 * module turns the agent's gaze inward: how skilled am I with each tool?
 * Am I overconfident or well-calibrated? Am I improving or stagnating?
 *
 * ## Core Mechanisms
 *
 * | Component          | Method                                   |
 * |--------------------|------------------------------------------|
 * | Tool Mastery       | Wilson score CI + sliding trend detection |
 * | Calibration        | predicted/actual ratio over sliding window|
 * | Learning Velocity  | derivative of average success rate        |
 * | Style Fingerprint  | normalized behavioral dimensions [0, 1]  |
 * | Known Limitations  | auto-discovered from failure patterns     |
 *
 * ## Events
 *
 * - `chetana:self_updated` — emitted after every tool result recording
 *
 * @packageDocumentation
 */

import type {
	ChetanaConfig,
	ChetanaState,
	SelfModel,
	ToolMastery,
} from "./types.js";
import {
	SYSTEM_MAX_CALIBRATION_WINDOW,
	SYSTEM_MAX_LIMITATIONS,
} from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Z-value for 95% Wilson score confidence interval. */
const WILSON_Z = 1.96;

/** Number of past invocations to compare against for trend detection. */
const TREND_LOOKBACK = 10;

/** Threshold (absolute) for trend change detection. */
const TREND_THRESHOLD = 0.05;

/** Consecutive failures before auto-recording a limitation. */
const FAILURE_STREAK_LIMIT = 3;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Clamp a number to [min, max]. */
function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Wilson score confidence interval for a binomial proportion.
 *
 * Given n trials with observed success rate p, returns [lower, upper]
 * bounds at the 95% confidence level. When n = 0, returns [0, 1]
 * (maximum uncertainty).
 */
function wilsonInterval(n: number, p: number): [number, number] {
	if (n === 0) return [0, 1];

	const z = WILSON_Z;
	const z2 = z * z;
	const denom = 1 + z2 / n;
	const center = p + z2 / (2 * n);
	const spread = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));

	return [
		Math.max(0, (center - spread) / denom),
		Math.min(1, (center + spread) / denom),
	];
}

// ─── AtmaDarshana ────────────────────────────────────────────────────────────

/**
 * Self-model and metacognition engine for the Chetana consciousness layer.
 *
 * Maintains a statistically rigorous view of the agent's own capabilities:
 * per-tool mastery with Wilson score CIs, predicted-vs-actual calibration,
 * learning velocity, known limitations, and a behavioral style fingerprint.
 */
export class AtmaDarshana {
	private model: SelfModel;
	private config: ChetanaConfig;
	private calibrationHistory: Array<{ predicted: number; actual: boolean }>;
	private onEvent?: (event: string, data: unknown) => void;

	/**
	 * Per-tool history of success rates at each invocation, used
	 * for trend detection (compare current vs TREND_LOOKBACK ago).
	 */
	private successRateHistory: Map<string, number[]> = new Map();

	/**
	 * Per-tool consecutive failure counter for auto-limitation detection.
	 */
	private consecutiveFailures: Map<string, number> = new Map();

	/** Total tool calls across all tools (for style fingerprint). */
	private totalToolCalls: number = 0;

	/** Set of unique tools ever called (for style fingerprint). */
	private uniqueToolsSeen: Set<string> = new Set();

	/**
	 * Per-tool: [turnsSinceError, turnsSinceRecovery] pairs for
	 * computing error_recovery_speed in the style fingerprint.
	 */
	private recoveryTracking: Map<string, { errorTurn: number; recoveryTurns: number[] }> = new Map();

	/** Monotonic turn counter for recovery tracking. */
	private turnCounter: number = 0;

	constructor(
		config: ChetanaConfig,
		onEvent?: (event: string, data: unknown) => void,
	) {
		this.config = config;
		this.onEvent = onEvent;
		this.calibrationHistory = [];

		this.model = {
			toolMastery: new Map(),
			knownLimitations: [],
			calibration: 1.0,
			learningVelocity: 0,
			styleFingerprint: new Map([
				["exploration_vs_exploitation", 0.5],
				["tool_density", 0],
				["error_recovery_speed", 1.0],
			]),
		};
	}

	// ─── Accessors ─────────────────────────────────────────────────────────

	/** Returns a frozen snapshot of the current self-model. */
	getModel(): Readonly<SelfModel> {
		return this.model;
	}

	// ─── Tool Result Recording ─────────────────────────────────────────────

	/**
	 * Record a tool execution result for mastery tracking.
	 *
	 * Updates success rate, latency, Wilson CI, trend, calibration,
	 * learning velocity, style fingerprint, and auto-detects limitations.
	 */
	recordToolResult(
		toolName: string,
		success: boolean,
		latencyMs: number,
		predictedSuccess?: number,
	): void {
		this.turnCounter++;
		this.totalToolCalls++;
		this.uniqueToolsSeen.add(toolName);

		// --- Get or create mastery entry ---
		let mastery = this.model.toolMastery.get(toolName);
		if (!mastery) {
			mastery = {
				successRate: 0,
				avgLatency: 0,
				confidenceInterval: [0, 1],
				lastImproved: Date.now(),
				trend: "stable",
				totalInvocations: 0,
				successes: 0,
			};
			this.model.toolMastery.set(toolName, mastery);
		}

		// --- Update core stats ---
		mastery.totalInvocations++;
		if (success) mastery.successes++;
		mastery.successRate = mastery.successes / mastery.totalInvocations;
		mastery.avgLatency = mastery.avgLatency
			+ (latencyMs - mastery.avgLatency) / mastery.totalInvocations;

		// --- Wilson score CI ---
		mastery.confidenceInterval = wilsonInterval(
			mastery.totalInvocations,
			mastery.successRate,
		);

		// --- Trend detection ---
		this.updateTrend(toolName, mastery);

		// --- Calibration ---
		if (predictedSuccess !== undefined) {
			this.recordCalibration(predictedSuccess, success);
		}

		// --- Consecutive failure tracking ---
		this.updateFailureStreak(toolName, success);

		// --- Recovery tracking ---
		this.updateRecoveryTracking(toolName, success);

		// --- Learning velocity ---
		this.recomputeLearningVelocity();

		// --- Style fingerprint ---
		this.recomputeStyleFingerprint();

		// --- Emit event ---
		this.onEvent?.("chetana:self_updated", {
			calibration: this.model.calibration,
			velocity: this.model.learningVelocity,
			topTool: this.getTopTool(),
		});
	}

	// ─── Limitation Management ─────────────────────────────────────────────

	/** Mark a tool as disabled (adds to known limitations). */
	markToolDisabled(toolName: string, reason: string): void {
		this.addLimitation(`Tool ${toolName} unreliable: ${reason}`);
	}

	/** Record a context recovery event. */
	markContextRecovery(): void {
		this.addLimitation(
			"Context loss detected — may lose track of earlier conversation",
		);
	}

	// ─── Self-Assessment ───────────────────────────────────────────────────

	/**
	 * Get a natural language self-assessment.
	 *
	 * Produces a concise (<200 chars) summary covering calibration,
	 * learning velocity, top tools, weak tools, and limitations.
	 */
	getSelfAssessment(): string {
		const cal = this.model.calibration;
		const vel = this.model.learningVelocity;

		// Sort tools by success rate descending
		const tools = [...this.model.toolMastery.entries()]
			.sort((a, b) => b[1].successRate - a[1].successRate);

		const topTools = tools.slice(0, 3)
			.map(([name, m]) => `${name} (${Math.round(m.successRate * 100)}%)`)
			.join(", ");

		const weakTools = tools
			.filter(([, m]) => m.successRate < 0.7 && m.totalInvocations > 0)
			.slice(-1)
			.map(([name, m]) => `${name} (${Math.round(m.successRate * 100)}%)`);

		const calLabel = cal === Infinity
			? "overconfident"
			: cal > 1.1
				? "slightly overconfident"
				: cal < 0.9
					? "underconfident"
					: "well-calibrated";

		const velLabel = vel > 0.001
			? "improving"
			: vel < -0.001
				? "declining"
				: "steady";

		const limCount = this.model.knownLimitations.length;

		let report = `${calLabel} (${cal === Infinity ? "Inf" : cal.toFixed(2)}), ${velLabel} (v:${vel >= 0 ? "+" : ""}${vel.toFixed(3)}).`;
		if (topTools) report += ` Strong: ${topTools}.`;
		if (weakTools.length > 0) report += ` Weak: ${weakTools[0]}.`;
		if (limCount > 0) report += ` ${limCount} limitation${limCount > 1 ? "s" : ""} noted.`;

		// Trim to 200 chars if needed
		if (report.length > 200) {
			report = report.slice(0, 197) + "...";
		}

		return report;
	}

	// ─── Serialization ─────────────────────────────────────────────────────

	/** Serialize to plain object for persistence. */
	serialize(): ChetanaState["selfModel"] {
		return {
			toolMastery: [...this.model.toolMastery.entries()],
			knownLimitations: [...this.model.knownLimitations],
			calibration: this.model.calibration,
			learningVelocity: this.model.learningVelocity,
			styleFingerprint: [...this.model.styleFingerprint.entries()],
		};
	}

	/** Restore from serialized state. */
	static deserialize(
		data: ChetanaState["selfModel"],
		config: ChetanaConfig,
		onEvent?: (event: string, data: unknown) => void,
	): AtmaDarshana {
		const instance = new AtmaDarshana(config, onEvent);

		instance.model.toolMastery = new Map(data.toolMastery);
		instance.model.knownLimitations = [...data.knownLimitations];
		instance.model.calibration = data.calibration;
		instance.model.learningVelocity = data.learningVelocity;
		instance.model.styleFingerprint = new Map(data.styleFingerprint);

		// Reconstruct derived counters from mastery data
		for (const [name, mastery] of instance.model.toolMastery) {
			instance.uniqueToolsSeen.add(name);
			instance.totalToolCalls += mastery.totalInvocations;

			// Seed history from current success rate so trend detection works
			const history: number[] = [];
			for (let i = 0; i < Math.min(mastery.totalInvocations, TREND_LOOKBACK + 1); i++) {
				history.push(mastery.successRate);
			}
			instance.successRateHistory.set(name, history);
		}

		return instance;
	}

	// ─── Internal: Trend ───────────────────────────────────────────────────

	/**
	 * Update trend for a tool by comparing current success rate to
	 * the rate recorded TREND_LOOKBACK invocations ago.
	 */
	private updateTrend(toolName: string, mastery: ToolMastery): void {
		let history = this.successRateHistory.get(toolName);
		if (!history) {
			history = [];
			this.successRateHistory.set(toolName, history);
		}

		history.push(mastery.successRate);

		// Compare to TREND_LOOKBACK entries ago
		if (history.length > TREND_LOOKBACK) {
			const pastRate = history[history.length - TREND_LOOKBACK - 1];
			const delta = mastery.successRate - pastRate;

			const prevTrend = mastery.trend;
			if (delta > TREND_THRESHOLD) {
				mastery.trend = "improving";
			} else if (delta < -TREND_THRESHOLD) {
				mastery.trend = "declining";
			} else {
				mastery.trend = "stable";
			}

			if (mastery.trend === "improving" && prevTrend !== "improving") {
				mastery.lastImproved = Date.now();
			}
		}
	}

	// ─── Internal: Calibration ─────────────────────────────────────────────

	/**
	 * Record a predicted-vs-actual calibration entry and recompute
	 * the calibration ratio.
	 */
	private recordCalibration(predicted: number, actual: boolean): void {
		const maxWindow = Math.min(
			this.config.calibrationWindow,
			SYSTEM_MAX_CALIBRATION_WINDOW,
		);

		this.calibrationHistory.push({ predicted, actual });

		// Trim to window size
		while (this.calibrationHistory.length > maxWindow) {
			this.calibrationHistory.shift();
		}

		// Compute calibration = avgPredicted / avgActual
		const len = this.calibrationHistory.length;
		let sumPredicted = 0;
		let sumActual = 0;

		for (const entry of this.calibrationHistory) {
			sumPredicted += entry.predicted;
			sumActual += entry.actual ? 1 : 0;
		}

		const avgPredicted = sumPredicted / len;
		const avgActual = sumActual / len;

		this.model.calibration = avgActual === 0
			? Infinity
			: avgPredicted / avgActual;
	}

	// ─── Internal: Failure Streaks ─────────────────────────────────────────

	/**
	 * Track consecutive failures per tool. When the streak reaches
	 * FAILURE_STREAK_LIMIT, auto-add a known limitation.
	 */
	private updateFailureStreak(toolName: string, success: boolean): void {
		if (success) {
			this.consecutiveFailures.set(toolName, 0);
			return;
		}

		const count = (this.consecutiveFailures.get(toolName) ?? 0) + 1;
		this.consecutiveFailures.set(toolName, count);

		if (count >= FAILURE_STREAK_LIMIT) {
			this.addLimitation(
				`Tool ${toolName} unreliable: ${count} consecutive failures`,
			);
		}
	}

	// ─── Internal: Recovery Tracking ───────────────────────────────────────

	/**
	 * Track error-to-recovery distance for computing error_recovery_speed
	 * in the style fingerprint.
	 */
	private updateRecoveryTracking(toolName: string, success: boolean): void {
		let tracking = this.recoveryTracking.get(toolName);
		if (!tracking) {
			tracking = { errorTurn: -1, recoveryTurns: [] };
			this.recoveryTracking.set(toolName, tracking);
		}

		if (!success) {
			// Record the turn at which the error happened
			tracking.errorTurn = this.turnCounter;
		} else if (tracking.errorTurn >= 0) {
			// Recovery: compute distance from last error
			const distance = this.turnCounter - tracking.errorTurn;
			tracking.recoveryTurns.push(distance);
			tracking.errorTurn = -1; // reset
		}
	}

	// ─── Internal: Learning Velocity ───────────────────────────────────────

	/**
	 * Learning velocity = (currentAvgSuccessRate - avgSuccessRate10TurnsAgo) / 10.
	 *
	 * Positive values indicate the agent is improving overall,
	 * negative values indicate declining performance.
	 */
	private recomputeLearningVelocity(): void {
		const tools = [...this.model.toolMastery.values()];
		if (tools.length === 0) {
			this.model.learningVelocity = 0;
			return;
		}

		// Current average success rate across all tools
		const currentAvg = tools.reduce((sum, t) => sum + t.successRate, 0) / tools.length;

		// Gather historical rates from TREND_LOOKBACK entries ago
		let pastSum = 0;
		let pastCount = 0;

		for (const [, history] of this.successRateHistory) {
			if (history.length > TREND_LOOKBACK) {
				pastSum += history[history.length - TREND_LOOKBACK - 1];
				pastCount++;
			}
		}

		if (pastCount === 0) {
			this.model.learningVelocity = 0;
			return;
		}

		const pastAvg = pastSum / pastCount;
		this.model.learningVelocity = (currentAvg - pastAvg) / TREND_LOOKBACK;
	}

	// ─── Internal: Style Fingerprint ───────────────────────────────────────

	/**
	 * Recompute the behavioral style fingerprint.
	 *
	 * - `exploration_vs_exploitation`: ratio of unique tools to total calls
	 * - `tool_density`: inverse of total calls (normalized, higher = fewer calls)
	 * - `error_recovery_speed`: inverse of average recovery distance (normalized)
	 */
	private recomputeStyleFingerprint(): void {
		const fp = this.model.styleFingerprint;

		// Exploration: ratio of unique tools / total calls
		// More unique tools relative to total = more exploratory
		if (this.totalToolCalls > 0) {
			fp.set(
				"exploration_vs_exploitation",
				clamp(this.uniqueToolsSeen.size / this.totalToolCalls, 0, 1),
			);
		}

		// Tool density: higher value = more tool calls per turn
		// Normalized via sigmoid-like: 1 - 1/(1 + calls/turns)
		if (this.turnCounter > 0) {
			const density = this.totalToolCalls / this.turnCounter;
			fp.set("tool_density", clamp(1 - 1 / (1 + density), 0, 1));
		}

		// Error recovery speed: lower average distance = faster recovery
		// Normalized: 1 / (1 + avgDistance)
		let totalDistance = 0;
		let distanceCount = 0;
		for (const [, tracking] of this.recoveryTracking) {
			for (const d of tracking.recoveryTurns) {
				totalDistance += d;
				distanceCount++;
			}
		}

		if (distanceCount > 0) {
			const avgDistance = totalDistance / distanceCount;
			fp.set("error_recovery_speed", clamp(1 / (1 + avgDistance), 0, 1));
		}
	}

	// ─── Internal: Limitations ─────────────────────────────────────────────

	/**
	 * Add a limitation string, deduplicating and capping at the
	 * configured maximum (clamped by the system ceiling).
	 */
	private addLimitation(limitation: string): void {
		const maxLimitations = Math.min(
			this.config.maxLimitations,
			SYSTEM_MAX_LIMITATIONS,
		);

		// Deduplicate
		if (this.model.knownLimitations.includes(limitation)) return;

		this.model.knownLimitations.push(limitation);

		// Cap: remove oldest entries beyond the limit
		while (this.model.knownLimitations.length > maxLimitations) {
			this.model.knownLimitations.shift();
		}
	}

	// ─── Internal: Top Tool ────────────────────────────────────────────────

	/** Get the name of the tool with highest success rate. */
	private getTopTool(): string | null {
		let best: string | null = null;
		let bestRate = -1;

		for (const [name, mastery] of this.model.toolMastery) {
			if (mastery.successRate > bestRate) {
				bestRate = mastery.successRate;
				best = name;
			}
		}

		return best;
	}
}
