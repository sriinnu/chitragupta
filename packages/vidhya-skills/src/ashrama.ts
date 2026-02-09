/**
 * Ashrama (आश्रम) — Lifecycle State Machine with Hysteresis
 *
 * Manages skill lifecycle stages with hysteresis-based transitions to prevent oscillation.
 * Stages follow the Vedic lifecycle concept:
 * - Brahmacharya (ब्रह्मचर्य): Student — newly learned, untrusted
 * - Grihastha (गृहस्थ): Householder — active, trusted, primary worker
 * - Vanaprastha (वानप्रस्थ): Forest dweller — deprecated, low health, backup only
 * - Sannyasa (संन्यास): Renunciate — archived, dormant, manual resurrect only
 *
 * @module ashrama
 */

import type {
	AshramamStage,
	AshramamState,
	AshramamTransition,
	AshramamHysteresis,
} from "./types-v2.js";
import {
	ASHRAMA_ORDER,
	DEFAULT_HYSTERESIS,
	HYSTERESIS_CEILINGS,
} from "./types-v2.js";

/**
 * Creates an initial Ashrama state for a new skill.
 *
 * @param stage - Starting stage (default: brahmacharya)
 * @returns Fresh state object
 */
export function createInitialState(
	stage: AshramamStage = "brahmacharya"
): AshramamState {
	const now = new Date().toISOString();
	return {
		stage,
		enteredAt: now,
		history: [
			{
				from: stage,
				to: stage,
				timestamp: now,
				reason: "initial creation",
				healthAtTransition: 0,
			},
		],
		lastEvaluatedAt: now,
		consecutiveDaysInactive: 0,
	};
}

/**
 * Finite State Automaton for Ashrama lifecycle management.
 *
 * Implements hysteresis-based transitions with configurable thresholds
 * to prevent rapid oscillation between stages.
 */
export class AshramamMachine {
	private readonly config: AshramamHysteresis;

	/**
	 * Creates a new Ashrama state machine.
	 *
	 * @param config - Hysteresis configuration (clamped against ceilings)
	 */
	constructor(config?: Partial<AshramamHysteresis>) {
		// Utility for clamping values
		const clamp = (v: number, lo: number, hi: number): number =>
			Math.max(lo, Math.min(hi, v));

		// Merge and clamp config
		const merged = { ...DEFAULT_HYSTERESIS, ...config };
		this.config = {
			promotionThreshold: clamp(
				merged.promotionThreshold,
				0,
				HYSTERESIS_CEILINGS.promotionThreshold
			),
			demotionThreshold: clamp(
				merged.demotionThreshold,
				0,
				HYSTERESIS_CEILINGS.demotionThreshold
			),
			minObservations: clamp(
				merged.minObservations,
				1,
				HYSTERESIS_CEILINGS.minObservations
			),
			archivalDays: clamp(
				merged.archivalDays,
				1,
				HYSTERESIS_CEILINGS.archivalDays
			),
		};

		// Enforce hysteresis gap
		if (
			this.config.promotionThreshold <= this.config.demotionThreshold
		) {
			throw new Error(
				"Hysteresis gap violation: promotionThreshold must be > demotionThreshold"
			);
		}
	}

	/**
	 * Checks if a transition is valid per state machine rules.
	 *
	 * Valid transitions:
	 * - brahmacharya → grihastha (promote)
	 * - grihastha → vanaprastha (deprecate)
	 * - grihastha → brahmacharya (quarantine)
	 * - vanaprastha → grihastha (restore)
	 * - vanaprastha → sannyasa (archive)
	 * - sannyasa → brahmacharya (resurrect)
	 *
	 * @param state - Current state
	 * @param to - Target stage
	 * @returns Validation result with reason
	 */
	canTransition(
		state: AshramamState,
		to: AshramamStage
	): { allowed: boolean; reason: string } {
		const { stage: from } = state;

		if (from === to) {
			return { allowed: false, reason: "already in target stage" };
		}

		// Valid transition map
		const validTransitions: Record<AshramamStage, AshramamStage[]> = {
			brahmacharya: ["grihastha"],
			grihastha: ["vanaprastha", "brahmacharya"],
			vanaprastha: ["grihastha", "sannyasa"],
			sannyasa: ["brahmacharya"],
		};

		if (validTransitions[from].includes(to)) {
			return { allowed: true, reason: "valid transition" };
		}

		return {
			allowed: false,
			reason: `invalid transition from ${from} to ${to}`,
		};
	}

	/**
	 * Evaluates state and applies automatic transitions based on metrics.
	 *
	 * Hysteresis rules:
	 * - brahmacharya → grihastha: health ≥ promotionThreshold, trust ≥ 0.5, observations ≥ min
	 * - grihastha → vanaprastha: health < demotionThreshold, observations ≥ min
	 * - vanaprastha → grihastha: health ≥ promotionThreshold (restore)
	 * - vanaprastha → sannyasa: inactive ≥ archivalDays
	 *
	 * @param state - Current state
	 * @param healthScore - Health metric (0-1)
	 * @param trustScore - Trust metric (0-1)
	 * @param observations - Number of execution observations
	 * @returns Updated state (new object if transitioned)
	 */
	evaluate(
		state: AshramamState,
		healthScore: number,
		trustScore: number,
		observations: number
	): AshramamState {
		const { stage } = state;
		let newStage: AshramamStage | null = null;
		let reason = "";

		switch (stage) {
			case "brahmacharya":
				if (
					observations >= this.config.minObservations &&
					healthScore >= this.config.promotionThreshold &&
					trustScore >= 0.5
				) {
					newStage = "grihastha";
					reason = `promoted: health=${healthScore.toFixed(2)}, trust=${trustScore.toFixed(2)}, obs=${observations}`;
				}
				break;

			case "grihastha":
				if (
					healthScore < this.config.demotionThreshold &&
					observations >= this.config.minObservations
				) {
					newStage = "vanaprastha";
					reason = `deprecated: health=${healthScore.toFixed(2)} below demotion threshold`;
				}
				break;

			case "vanaprastha":
				if (healthScore >= this.config.promotionThreshold) {
					newStage = "grihastha";
					reason = `restored: health=${healthScore.toFixed(2)} recovered`;
				} else if (
					state.consecutiveDaysInactive >= this.config.archivalDays
				) {
					newStage = "sannyasa";
					reason = `archived: inactive for ${state.consecutiveDaysInactive} days`;
				}
				break;

			case "sannyasa":
				// No automatic transitions from sannyasa
				break;
		}

		if (newStage) {
			return this.transition(state, newStage, reason, healthScore);
		}

		// No transition, but update evaluation timestamp
		return {
			...state,
			lastEvaluatedAt: new Date().toISOString(),
		};
	}

	/**
	 * Performs a manual transition with validation.
	 *
	 * @param state - Current state
	 * @param to - Target stage
	 * @param reason - Human-readable reason
	 * @param healthScore - Health score at time of transition (default: 0)
	 * @returns New state with transition recorded
	 * @throws If transition is invalid
	 */
	transition(
		state: AshramamState,
		to: AshramamStage,
		reason: string,
		healthScore: number = 0
	): AshramamState {
		const validation = this.canTransition(state, to);
		if (!validation.allowed) {
			throw new Error(
				`Transition not allowed: ${validation.reason}`
			);
		}

		const now = new Date().toISOString();
		const newTransition: AshramamTransition = {
			from: state.stage,
			to,
			timestamp: now,
			reason,
			healthAtTransition: healthScore,
		};

		return {
			stage: to,
			enteredAt: now,
			history: [...state.history, newTransition],
			lastEvaluatedAt: now,
			// Reset inactivity on promotion
			consecutiveDaysInactive:
				to === "grihastha" ? 0 : state.consecutiveDaysInactive,
		};
	}

	/**
	 * Records an inactive day (e.g., no executions in 24h).
	 *
	 * @param state - Current state
	 * @returns Updated state with incremented counter
	 */
	recordInactiveDay(state: AshramamState): AshramamState {
		return {
			...state,
			consecutiveDaysInactive: state.consecutiveDaysInactive + 1,
			lastEvaluatedAt: new Date().toISOString(),
		};
	}

	/**
	 * Records activity (execution, match, etc.).
	 *
	 * @param state - Current state
	 * @returns Updated state with reset inactivity counter
	 */
	recordActivity(state: AshramamState): AshramamState {
		return {
			...state,
			consecutiveDaysInactive: 0,
			lastEvaluatedAt: new Date().toISOString(),
		};
	}

	/**
	 * Checks if a stage allows matching in TVM.
	 *
	 * @param stage - Stage to check
	 * @returns True for grihastha and vanaprastha
	 */
	isMatchable(stage: AshramamStage): boolean {
		return stage === "grihastha" || stage === "vanaprastha";
	}

	/**
	 * Checks if a stage allows execution.
	 *
	 * @param stage - Stage to check
	 * @returns True for grihastha and vanaprastha
	 */
	isExecutable(stage: AshramamStage): boolean {
		return stage === "grihastha" || stage === "vanaprastha";
	}

	/**
	 * Gets the matching weight multiplier for a stage.
	 *
	 * Used in TVM scoring to prioritize active skills.
	 *
	 * @param stage - Stage to check
	 * @returns 1.0 for grihastha, 0.5 for vanaprastha, 0.0 otherwise
	 */
	getMatchWeight(stage: AshramamStage): number {
		switch (stage) {
			case "grihastha":
				return 1.0;
			case "vanaprastha":
				return 0.5;
			default:
				return 0.0;
		}
	}

	/**
	 * Retrieves transition history.
	 *
	 * @param state - Current state
	 * @returns Array of transitions (oldest first)
	 */
	getHistory(state: AshramamState): AshramamTransition[] {
		return [...state.history];
	}

	/**
	 * Gets the configured hysteresis parameters.
	 *
	 * @returns Clamped configuration
	 */
	getConfig(): AshramamHysteresis {
		return { ...this.config };
	}
}
