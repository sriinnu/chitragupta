/**
 * @chitragupta/anina/chetana — Bhava — भाव — Affect / Emotional State Machine.
 *
 * The agent's affective core — a four-dimensional emotional state that
 * evolves in response to tool outcomes, user corrections, and temporal
 * decay. Like the rasas (रस) of Bharata's Natyashastra, Bhava captures
 * the agent's felt sense of an interaction: elation after a streak of
 * successes, frustration from repeated errors, heightened arousal when
 * complexity spikes.
 *
 * ## Dimensions
 *
 * | Dimension   | Range   | Neutral | Driven by                     |
 * |-------------|---------|---------|-------------------------------|
 * | Valence     | [-1, 1] | 0       | EMA of success/failure ratio  |
 * | Arousal     | [0, 1]  | 0.3     | Errors, sub-agent spawns      |
 * | Confidence  | [0, 1]  | 0.5     | External success rate data    |
 * | Frustration | [0, 1]  | 0       | Errors + user corrections     |
 *
 * ## Temporal Decay
 *
 * Every turn, each dimension drifts toward its neutral value at a rate
 * of `config.affectDecayRate`. Confidence is exempt — it is updated
 * only via explicit external signal (LearningLoop success rates).
 *
 * ## Events
 *
 * - `chetana:frustrated` — frustration crosses the alert threshold upward
 * - `chetana:confident` — confidence crosses the autonomy threshold upward
 *
 * @packageDocumentation
 */

import type { AffectiveState, ChetanaConfig, CognitivePriors } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default sliding window size for valence EMA. */
const VALENCE_WINDOW_SIZE = 20;

/** Arousal spike on tool error. */
const AROUSAL_ERROR_SPIKE = 0.2;

/** Arousal spike on sub-agent spawn. */
const AROUSAL_SPAWN_SPIKE = 0.1;

/** Default base arousal (calm equilibrium). */
const DEFAULT_BASE_AROUSAL = 0.3;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Clamp a number to [min, max]. */
function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

// ─── BhavaSystem ─────────────────────────────────────────────────────────────

/**
 * Affective state machine for the Chetana consciousness layer.
 *
 * Tracks the agent's emotional dimensions and emits events when
 * salient thresholds are crossed. Designed to be lightweight —
 * a few arithmetic ops per turn, zero allocations in the hot path.
 */
export class BhavaSystem {
	private state: AffectiveState;
	private config: ChetanaConfig;
	private turnCount: number = 0;
	private recentOutcomes: boolean[] = [];
	private baseArousal: number;
	private onEvent?: (event: string, data: unknown) => void;

	/** Previous frustration — used for threshold crossing detection. */
	private prevFrustration: number = 0;

	/** Previous confidence — used for threshold crossing detection. */
	private prevConfidence: number = 0.5;

	constructor(
		config: ChetanaConfig,
		onEvent?: (event: string, data: unknown) => void,
		priors?: CognitivePriors,
	) {
		this.config = config;
		this.onEvent = onEvent;
		this.baseArousal = priors?.baseArousal ?? DEFAULT_BASE_AROUSAL;

		this.state = {
			valence: 0,
			arousal: this.baseArousal,
			confidence: 0.5,
			frustration: 0,
		};
	}

	// ─── Accessors ─────────────────────────────────────────────────────────

	/** Returns a frozen snapshot of the current affective state. */
	getState(): Readonly<AffectiveState> {
		return this.state;
	}

	// ─── Event Handlers ────────────────────────────────────────────────────

	/**
	 * Called after each tool execution to update affect.
	 *
	 * - Successes reduce frustration and push valence positive.
	 * - Errors increase frustration + arousal and push valence negative.
	 * - User corrections carry the heaviest frustration penalty.
	 */
	onToolResult(toolName: string, isError: boolean, isUserCorrection: boolean): void {
		this.prevFrustration = this.state.frustration;

		// --- Frustration ---
		if (isUserCorrection) {
			this.state.frustration += this.config.frustrationPerCorrection;
		} else if (isError) {
			this.state.frustration += this.config.frustrationPerError;
		} else {
			this.state.frustration -= this.config.frustrationDecayPerSuccess;
		}
		this.state.frustration = clamp(this.state.frustration, 0, 1);

		// --- Arousal ---
		if (isError) {
			this.state.arousal = clamp(this.state.arousal + AROUSAL_ERROR_SPIKE, 0, 1);
		}

		// --- Valence (sliding window) ---
		this.recentOutcomes.push(!isError);
		if (this.recentOutcomes.length > VALENCE_WINDOW_SIZE) {
			this.recentOutcomes.shift();
		}
		this.recomputeValence();

		// --- Threshold events ---
		this.checkFrustrationThreshold();
	}

	/**
	 * Called when a sub-agent is spawned.
	 * Arousal spikes — spawning sub-agents means complexity is escalating.
	 */
	onSubAgentSpawn(): void {
		this.state.arousal = clamp(this.state.arousal + AROUSAL_SPAWN_SPIKE, 0, 1);
	}

	/**
	 * Called at the end of each turn to apply temporal decay.
	 *
	 * All dimensions drift toward their neutral equilibrium:
	 * - Valence -> 0
	 * - Arousal -> baseArousal
	 * - Frustration -> 0
	 * - Confidence is NOT decayed (externally driven).
	 */
	decayTurn(): void {
		this.turnCount++;
		const rate = this.config.affectDecayRate;

		// Valence decays toward 0
		this.state.valence *= (1 - rate);

		// Arousal decays toward baseArousal
		this.state.arousal = this.state.arousal + (this.baseArousal - this.state.arousal) * rate;

		// Frustration decays toward 0
		this.state.frustration *= (1 - rate);

		// Clamp all ranges
		this.state.valence = clamp(this.state.valence, -1, 1);
		this.state.arousal = clamp(this.state.arousal, 0, 1);
		this.state.frustration = clamp(this.state.frustration, 0, 1);
	}

	/**
	 * Update confidence from external success rate data.
	 *
	 * Confidence is the only dimension not subject to temporal decay —
	 * it reflects objective capability, not transient emotional state.
	 */
	updateConfidence(successRate: number): void {
		this.prevConfidence = this.state.confidence;
		this.state.confidence = clamp(successRate, 0, 1);
		this.checkConfidenceThreshold();
	}

	// ─── Serialization ─────────────────────────────────────────────────────

	/** Serialize the current affective state to a plain object. */
	serialize(): AffectiveState {
		return { ...this.state };
	}

	/**
	 * Restore a BhavaSystem from a previously serialized state.
	 * The sliding window and turn counter are reset — only the
	 * four-dimensional state vector is preserved.
	 */
	static deserialize(
		state: AffectiveState,
		config: ChetanaConfig,
		onEvent?: (event: string, data: unknown) => void,
		priors?: CognitivePriors,
	): BhavaSystem {
		const system = new BhavaSystem(config, onEvent, priors);
		system.state = { ...state };
		system.prevFrustration = state.frustration;
		system.prevConfidence = state.confidence;
		return system;
	}

	// ─── Internal ──────────────────────────────────────────────────────────

	/**
	 * Recompute valence as an EMA over the sliding window.
	 *
	 * Valence = (successes - failures) / total, mapped to [-1, +1].
	 * An empty window yields valence 0 (neutral).
	 */
	private recomputeValence(): void {
		const total = this.recentOutcomes.length;
		if (total === 0) {
			this.state.valence = 0;
			return;
		}

		const successes = this.recentOutcomes.filter(Boolean).length;
		const failures = total - successes;

		// Maps to [-1, +1]: all successes = +1, all failures = -1
		this.state.valence = clamp((successes - failures) / total, -1, 1);
	}

	/**
	 * Emit `chetana:frustrated` when frustration crosses the alert
	 * threshold from below.
	 */
	private checkFrustrationThreshold(): void {
		const threshold = this.config.frustrationAlertThreshold;
		if (
			this.state.frustration >= threshold &&
			this.prevFrustration < threshold &&
			this.onEvent
		) {
			this.onEvent("chetana:frustrated", { frustration: this.state.frustration });
		}
	}

	/**
	 * Emit `chetana:confident` when confidence crosses the autonomy
	 * threshold from below.
	 */
	private checkConfidenceThreshold(): void {
		const threshold = this.config.confidenceAutonomyThreshold;
		if (
			this.state.confidence >= threshold &&
			this.prevConfidence < threshold &&
			this.onEvent
		) {
			this.onEvent("chetana:confident", { confidence: this.state.confidence });
		}
	}
}
