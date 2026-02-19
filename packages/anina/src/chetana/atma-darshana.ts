/**
 * @chitragupta/anina/chetana — Atma-Darshana — आत्मदर्शन — Self-Model / Metacognition.
 *
 * The agent's mirror — a statistical self-portrait built from observed tool
 * outcomes, calibration measurements, and behavioral fingerprints. Per-tool
 * mastery via Wilson score CI, predicted/actual calibration, learning velocity,
 * style fingerprint, and auto-discovered limitations.
 *
 * Internal computations are in atma-darshana-internals.ts.
 *
 * @packageDocumentation
 */

import type { ChetanaConfig, ChetanaState, SelfModel, ToolMastery } from "./types.js";
import {
	wilsonInterval, updateTrend, recordCalibration as recordCalibrationFn,
	updateFailureStreak, updateRecoveryTracking, recomputeLearningVelocity,
	recomputeStyleFingerprint, addLimitation as addLimitationFn, getTopTool,
	TREND_LOOKBACK,
	type RecoveryTrackingEntry,
} from "./atma-darshana-internals.js";

// Re-export internals for consumers
export { wilsonInterval, WILSON_Z, TREND_LOOKBACK, TREND_THRESHOLD, FAILURE_STREAK_LIMIT } from "./atma-darshana-internals.js";

// ─── AtmaDarshana ────────────────────────────────────────────────────────────

/**
 * Self-model and metacognition engine for the Chetana consciousness layer.
 *
 * Maintains per-tool mastery with Wilson score CIs, predicted-vs-actual
 * calibration, learning velocity, known limitations, and a behavioral
 * style fingerprint.
 */
export class AtmaDarshana {
	private model: SelfModel;
	private config: ChetanaConfig;
	private calibrationHistory: Array<{ predicted: number; actual: boolean }>;
	private onEvent?: (event: string, data: unknown) => void;
	private successRateHistory: Map<string, number[]> = new Map();
	private consecutiveFailures: Map<string, number> = new Map();
	private totalToolCalls: number = 0;
	private uniqueToolsSeen: Set<string> = new Set();
	private recoveryTracking: Map<string, RecoveryTrackingEntry> = new Map();
	private turnCounter: number = 0;

	constructor(config: ChetanaConfig, onEvent?: (event: string, data: unknown) => void) {
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

	/** Returns a frozen snapshot of the current self-model. */
	getModel(): Readonly<SelfModel> { return this.model; }

	/**
	 * Record a tool execution result.
	 * Updates mastery, Wilson CI, trend, calibration, velocity, fingerprint, limitations.
	 */
	recordToolResult(toolName: string, success: boolean, latencyMs: number, predictedSuccess?: number): void {
		this.turnCounter++;
		this.totalToolCalls++;
		this.uniqueToolsSeen.add(toolName);

		let mastery = this.model.toolMastery.get(toolName);
		if (!mastery) {
			mastery = {
				successRate: 0, avgLatency: 0, confidenceInterval: [0, 1],
				lastImproved: Date.now(), trend: "stable", totalInvocations: 0, successes: 0,
			};
			this.model.toolMastery.set(toolName, mastery);
		}

		mastery.totalInvocations++;
		if (success) mastery.successes++;
		mastery.successRate = mastery.successes / mastery.totalInvocations;
		mastery.avgLatency = mastery.avgLatency + (latencyMs - mastery.avgLatency) / mastery.totalInvocations;
		mastery.confidenceInterval = wilsonInterval(mastery.totalInvocations, mastery.successRate);

		updateTrend(toolName, mastery, this.successRateHistory);

		if (predictedSuccess !== undefined) {
			this.model.calibration = recordCalibrationFn(
				predictedSuccess, success, this.calibrationHistory, this.config,
			);
		}

		const limitation = updateFailureStreak(toolName, success, this.consecutiveFailures);
		if (limitation) addLimitationFn(limitation, this.model.knownLimitations, this.config);

		updateRecoveryTracking(toolName, success, this.turnCounter, this.recoveryTracking);
		this.model.learningVelocity = recomputeLearningVelocity(this.model.toolMastery, this.successRateHistory);
		recomputeStyleFingerprint(
			this.model.styleFingerprint, this.totalToolCalls,
			this.uniqueToolsSeen, this.turnCounter, this.recoveryTracking,
		);

		this.onEvent?.("chetana:self_updated", {
			calibration: this.model.calibration,
			velocity: this.model.learningVelocity,
			topTool: getTopTool(this.model.toolMastery),
		});
	}

	/** Mark a tool as disabled (adds to known limitations). */
	markToolDisabled(toolName: string, reason: string): void {
		addLimitationFn(`Tool ${toolName} unreliable: ${reason}`, this.model.knownLimitations, this.config);
	}

	/** Record a context recovery event. */
	markContextRecovery(): void {
		addLimitationFn("Context loss detected — may lose track of earlier conversation", this.model.knownLimitations, this.config);
	}

	/** Get a natural language self-assessment (<200 chars). */
	getSelfAssessment(): string {
		const cal = this.model.calibration;
		const vel = this.model.learningVelocity;
		const tools = [...this.model.toolMastery.entries()].sort((a, b) => b[1].successRate - a[1].successRate);
		const topTools = tools.slice(0, 3).map(([n, m]) => `${n} (${Math.round(m.successRate * 100)}%)`).join(", ");
		const weakTools = tools.filter(([, m]) => m.successRate < 0.7 && m.totalInvocations > 0).slice(-1)
			.map(([n, m]) => `${n} (${Math.round(m.successRate * 100)}%)`);

		const calLabel = cal === Infinity ? "overconfident" : cal > 1.1 ? "slightly overconfident" : cal < 0.9 ? "underconfident" : "well-calibrated";
		const velLabel = vel > 0.001 ? "improving" : vel < -0.001 ? "declining" : "steady";
		const limCount = this.model.knownLimitations.length;

		let report = `${calLabel} (${cal === Infinity ? "Inf" : cal.toFixed(2)}), ${velLabel} (v:${vel >= 0 ? "+" : ""}${vel.toFixed(3)}).`;
		if (topTools) report += ` Strong: ${topTools}.`;
		if (weakTools.length > 0) report += ` Weak: ${weakTools[0]}.`;
		if (limCount > 0) report += ` ${limCount} limitation${limCount > 1 ? "s" : ""} noted.`;
		return report.length > 200 ? report.slice(0, 197) + "..." : report;
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

		for (const [name, mastery] of instance.model.toolMastery) {
			instance.uniqueToolsSeen.add(name);
			instance.totalToolCalls += mastery.totalInvocations;
			const history: number[] = [];
			for (let i = 0; i < Math.min(mastery.totalInvocations, TREND_LOOKBACK + 1); i++) history.push(mastery.successRate);
			instance.successRateHistory.set(name, history);
		}
		return instance;
	}
}
