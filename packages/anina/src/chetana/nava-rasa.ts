/**
 * @chitragupta/anina/chetana — Nava Rasa — नव रस — Contextual Emotional Awareness.
 *
 * In Bharata Muni's Natyashastra (Ch. 6), the nine rasas (रस) represent
 * the fundamental aesthetic emotions that color every human experience.
 * Just as a natya (dramatic performance) shifts between rasas to convey
 * meaning, the agent's interaction style adapts to the emotional context
 * of each situation.
 *
 * ## The Nine Rasas (8-simplex)
 *
 * | Rasa       | Sanskrit  | Meaning     | Trigger                           |
 * |------------|-----------|-------------|-----------------------------------|
 * | Shringara  | शृंगार    | Delight     | Strong user alignment, positive   |
 * | Vira       | वीर       | Heroism     | High confidence, autonomous exec  |
 * | Karuna     | करुण      | Compassion  | User struggling, gentler guidance |
 * | Raudra     | रौद्र     | Fury        | Threat detected, security lock    |
 * | Bhayanaka  | भयानक     | Fear        | High-risk action, confirm first   |
 * | Bibhatsa   | बीभत्स    | Disgust     | Bad code/input, flag issues       |
 * | Adbhuta    | अद्भुत    | Wonder      | Novel situation, explore carefully |
 * | Hasya      | हास्य     | Humor       | Benign anomaly, lighten tone      |
 * | Shanta     | शान्त     | Peace       | Equilibrium, idle, tasks done     |
 *
 * The nine rasas always sum to 1.0 — they live on the 8-simplex Delta^8.
 *
 * ## Update Model
 *
 * Observations (behavioral signals) produce a raw stimulus vector in R^9.
 * We apply softmax projection to map onto the 8-simplex, then blend with
 * the previous state via Exponential Moving Average (EMA) to prevent
 * jarring emotional whiplash. The smoothing factor alpha controls how
 * quickly the agent shifts between rasas.
 *
 * ## Behavioral Adaptation
 *
 * Each rasa maps to a structured behavioral adaptation:
 * autonomy level, verbosity style, and whether confirmations are required.
 * The ChetanaController can query the current adaptation to tune the
 * agent's interaction pattern.
 *
 * @packageDocumentation
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** The nine rasa labels per Natyashastra. */
export type RasaType =
	| "shringara"
	| "vira"
	| "karuna"
	| "raudra"
	| "bhayanaka"
	| "bibhatsa"
	| "adbhuta"
	| "hasya"
	| "shanta";

/** All nine rasa labels in canonical order. */
export const RASA_LABELS: readonly RasaType[] = [
	"shringara",
	"vira",
	"karuna",
	"raudra",
	"bhayanaka",
	"bibhatsa",
	"adbhuta",
	"hasya",
	"shanta",
] as const;

/** The number of rasas (dimension of the simplex + 1). */
const NUM_RASAS = 9;

/**
 * A 9-dimensional state vector on the 8-simplex.
 * All values in [0, 1], sum = 1.0.
 */
export interface RasaState {
	/** Delight — strong user alignment, positive engagement [0, 1]. */
	shringara: number;
	/** Heroism — high confidence, autonomous execution [0, 1]. */
	vira: number;
	/** Compassion — user struggling, gentler guidance [0, 1]. */
	karuna: number;
	/** Fury — threat detected, security protocols [0, 1]. */
	raudra: number;
	/** Fear — high-risk action, request confirmation [0, 1]. */
	bhayanaka: number;
	/** Disgust — bad code/input, flag issues [0, 1]. */
	bibhatsa: number;
	/** Wonder — novel situation, explore carefully [0, 1]. */
	adbhuta: number;
	/** Humor — benign anomaly, lighten tone [0, 1]. */
	hasya: number;
	/** Peace — equilibrium, idle, all tasks complete [0, 1]. */
	shanta: number;
	// Invariant: sum of all 9 values ≈ 1.0
}

/**
 * Observation vector: behavioral signals that drive rasa updates.
 * All values in [0, 1].
 */
export interface RasaObservation {
	/** User satisfaction signal [0, 1]. High → shringara. */
	userSatisfaction: number;
	/** Agent confidence in current actions [0, 1]. High + successRate → vira. */
	confidence: number;
	/** Tool/action success rate [0, 1]. High + confidence → vira. */
	successRate: number;
	/** User is struggling or confused [0, 1]. High → karuna. */
	userStruggling: number;
	/** Security threat detected [0, 1]. High → raudra. */
	securityThreat: number;
	/** Current action is high-risk [0, 1]. High → bhayanaka. */
	highRiskAction: number;
	/** Code quality of input/context is low [0, 1]. High → bibhatsa. */
	codeQualityLow: number;
	/** Situation is novel or unprecedented [0, 1]. High → adbhuta. */
	novelSituation: number;
	/** Benign anomaly or amusing incongruity [0, 1]. High → hasya. */
	benignAnomaly: number;
	/** All tasks complete, low activity [0, 1]. High → shanta. */
	allTasksComplete: number;
}

/** A timestamped snapshot of the rasa state. */
export interface RasaSnapshot {
	state: RasaState;
	dominant: RasaType;
	timestamp: number;
}

/** Autonomy level for behavioral adaptation. */
export type AutonomyLevel = "none" | "low" | "medium" | "high" | "full";

/** Verbosity style for behavioral adaptation. */
export type VerbosityStyle =
	| "minimal"
	| "terse"
	| "normal"
	| "light"
	| "detailed"
	| "cautious"
	| "critical"
	| "alert";

/**
 * Behavioral adaptation suggested by the current dominant rasa.
 * Guides the agent's interaction style.
 */
export interface RasaBehavioralAdaptation {
	/** How much autonomy the agent should exercise. */
	autonomy: AutonomyLevel;
	/** How verbose the agent should be. */
	verbosity: VerbosityStyle;
	/** Whether to request explicit user confirmation before acting. */
	confirmations: boolean;
	/** The rasa that produced this adaptation. */
	source: RasaType;
}

/** Event types emitted by the NavaRasa system. */
export type NavaRasaEventType = "nava_rasa:rasa_shift";

/** Configuration for the NavaRasa system. */
export interface NavaRasaConfig {
	/**
	 * Initial rasa state as a 9-element array in canonical order.
	 * Need not sum to 1.0 — will be normalized.
	 * Default: shanta-dominant equilibrium.
	 */
	initialState: [number, number, number, number, number, number, number, number, number];

	/**
	 * EMA smoothing factor alpha in (0, 1].
	 * Lower = smoother (slower transitions), higher = more responsive.
	 * Default: 0.3.
	 */
	smoothingAlpha: number;

	/**
	 * Temperature parameter for softmax projection.
	 * Higher = more uniform distribution, lower = sharper peaks.
	 * Default: 1.0.
	 */
	softmaxTemperature: number;

	/**
	 * Maximum history snapshots to retain.
	 * Default: 100.
	 */
	maxHistory: number;

	/**
	 * Minimum rasa value to prevent numerical collapse.
	 * Default: 1e-6.
	 */
	simplexFloor: number;
}

/** Serializable state for persistence. */
export interface NavaRasaSerializedState {
	rasaState: RasaState;
	prevDominant: RasaType;
	history: RasaSnapshot[];
}

// ─── System Ceilings ─────────────────────────────────────────────────────────

/** Absolute system ceiling: maximum history snapshots. */
export const SYSTEM_MAX_NAVA_RASA_HISTORY = 1000;

/** Absolute system ceiling: minimum smoothing alpha. */
const SYSTEM_MIN_ALPHA = 0.01;

/** Absolute system ceiling: maximum smoothing alpha. */
const SYSTEM_MAX_ALPHA = 1.0;

/** Absolute system ceiling: minimum softmax temperature. */
const SYSTEM_MIN_TEMPERATURE = 0.01;

// ─── Defaults ────────────────────────────────────────────────────────────────

/** Default NavaRasa configuration: shanta-dominant equilibrium. */
export const DEFAULT_NAVA_RASA_CONFIG: NavaRasaConfig = {
	// Default: shanta dominant, with slight shringara/vira presence
	initialState: [0.05, 0.05, 0.05, 0.02, 0.02, 0.02, 0.05, 0.04, 0.70],
	smoothingAlpha: 0.3,
	softmaxTemperature: 1.0,
	maxHistory: 100,
	simplexFloor: 1e-6,
};

// ─── Influence Matrix ────────────────────────────────────────────────────────

/**
 * Influence matrix: maps 10 observation signals to 9 rasa affinities.
 *
 * Each row is a rasa (in canonical order).
 * Each column is an observation signal:
 *   [userSatisfaction, confidence, successRate, userStruggling,
 *    securityThreat, highRiskAction, codeQualityLow, novelSituation,
 *    benignAnomaly, allTasksComplete]
 *
 * Positive = observation pushes rasa up, negative = inhibits.
 *
 * The matrix encodes the Natyashastra-inspired mapping:
 * - Shringara rises with satisfaction + success, falls with threats
 * - Vira rises with confidence + success, falls with struggle
 * - Karuna rises with user struggle, falls with satisfaction
 * - Raudra rises with security threat, falls with peace
 * - Bhayanaka rises with high-risk, falls with success
 * - Bibhatsa rises with low code quality, falls with satisfaction
 * - Adbhuta rises with novelty, falls with completion
 * - Hasya rises with benign anomaly, falls with threats
 * - Shanta rises with completion + satisfaction, falls with threats/risk
 */
const INFLUENCE_MATRIX: number[][] = [
	// shringara:  satisfaction + success boost, threats inhibit
	[ 0.9,  0.3,  0.4, -0.3, -0.5, -0.2, -0.3,  0.1,  0.1,  0.2],
	// vira:       confidence + success boost, struggle inhibits
	[ 0.2,  0.9,  0.8, -0.4, -0.1,  0.2, -0.1,  0.2, -0.1,  0.0],
	// karuna:     struggle boosts, satisfaction inhibits
	[-0.2, -0.3, -0.3,  0.9,  0.0,  0.1,  0.2,  0.0,  0.0, -0.1],
	// raudra:     security threat dominates, peace inhibits
	[-0.3, -0.1,  0.0,  0.1,  0.9,  0.3, -0.1, -0.1, -0.3, -0.5],
	// bhayanaka:  high risk + threat, success inhibits
	[-0.2, -0.3, -0.4,  0.2,  0.4,  0.9,  0.1,  0.1, -0.2, -0.3],
	// bibhatsa:   low quality boosts, satisfaction inhibits
	[-0.3, -0.1, -0.2,  0.1,  0.1,  0.1,  0.9,  0.0, -0.1, -0.1],
	// adbhuta:    novelty boosts, completion inhibits
	[ 0.1,  0.0,  0.0,  0.0, -0.1,  0.1,  0.0,  0.9,  0.2, -0.4],
	// hasya:      benign anomaly boosts, threats inhibit
	[ 0.2,  0.0,  0.0,  0.0, -0.4, -0.2, -0.1,  0.2,  0.9, -0.1],
	// shanta:     completion + satisfaction, threats/risk inhibit
	[ 0.3,  0.2,  0.3, -0.2, -0.6, -0.5, -0.2, -0.2,  0.0,  0.9],
];

// ─── Behavioral Adaptation Table ─────────────────────────────────────────────

/**
 * Maps each rasa to its behavioral adaptation.
 * These guide the agent's interaction pattern based on emotional context.
 */
const ADAPTATION_TABLE: Record<RasaType, Omit<RasaBehavioralAdaptation, "source">> = {
	shringara: { autonomy: "high",   verbosity: "normal",   confirmations: false },
	vira:      { autonomy: "full",   verbosity: "terse",    confirmations: false },
	karuna:    { autonomy: "low",    verbosity: "detailed", confirmations: true  },
	raudra:    { autonomy: "none",   verbosity: "alert",    confirmations: true  },
	bhayanaka: { autonomy: "low",    verbosity: "cautious", confirmations: true  },
	bibhatsa:  { autonomy: "medium", verbosity: "critical", confirmations: false },
	adbhuta:   { autonomy: "medium", verbosity: "detailed", confirmations: false },
	hasya:     { autonomy: "medium", verbosity: "light",    confirmations: false },
	shanta:    { autonomy: "high",   verbosity: "minimal",  confirmations: false },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Clamp a number to [min, max]. */
function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Normalize a 9-element array onto the 8-simplex.
 * All values clamped to >= floor, then divided by sum.
 */
function normalizeToSimplex(values: number[], floor: number): number[] {
	const clamped = values.map((v) => Math.max(v, floor));
	const sum = clamped.reduce((acc, v) => acc + v, 0);
	return clamped.map((v) => v / sum);
}

/**
 * Softmax projection of a raw affinity vector onto the simplex.
 *
 * Uses the log-sum-exp trick for numerical stability:
 *   softmax(x_i) = exp((x_i - max(x)) / T) / sum(exp((x_j - max(x)) / T))
 *
 * @param affinities Raw affinity scores in R^9.
 * @param temperature Softmax temperature (higher = more uniform).
 * @returns Probability distribution on the 8-simplex.
 */
function softmax(affinities: number[], temperature: number): number[] {
	const t = Math.max(temperature, SYSTEM_MIN_TEMPERATURE);
	const maxAff = Math.max(...affinities);
	const exps = affinities.map((a) => Math.exp((a - maxAff) / t));
	const sum = exps.reduce((acc, e) => acc + e, 0);
	return exps.map((e) => e / sum);
}

/**
 * Map a RasaObservation to a measured rasa composition on the simplex.
 *
 * 1. Extract the 10 observation signals into a vector.
 * 2. Multiply by the 9x10 influence matrix to get raw affinities.
 * 3. Apply softmax to project onto the 8-simplex.
 */
function observationToRasa(obs: RasaObservation, temperature: number): number[] {
	const signals = [
		obs.userSatisfaction,
		obs.confidence,
		obs.successRate,
		obs.userStruggling,
		obs.securityThreat,
		obs.highRiskAction,
		obs.codeQualityLow,
		obs.novelSituation,
		obs.benignAnomaly,
		obs.allTasksComplete,
	];

	// Matrix-vector product: affinities[i] = sum_j INFLUENCE_MATRIX[i][j] * signals[j]
	const affinities: number[] = new Array(NUM_RASAS);
	for (let i = 0; i < NUM_RASAS; i++) {
		let sum = 0;
		for (let j = 0; j < 10; j++) {
			sum += INFLUENCE_MATRIX[i][j] * signals[j];
		}
		affinities[i] = sum;
	}

	return softmax(affinities, temperature);
}

/**
 * Convert a RasaState to a number array in canonical order.
 */
function stateToArray(state: RasaState): number[] {
	return [
		state.shringara,
		state.vira,
		state.karuna,
		state.raudra,
		state.bhayanaka,
		state.bibhatsa,
		state.adbhuta,
		state.hasya,
		state.shanta,
	];
}

/**
 * Convert a number array (canonical order) to a RasaState.
 */
function arrayToState(values: number[]): RasaState {
	return {
		shringara: values[0],
		vira: values[1],
		karuna: values[2],
		raudra: values[3],
		bhayanaka: values[4],
		bibhatsa: values[5],
		adbhuta: values[6],
		hasya: values[7],
		shanta: values[8],
	};
}

// ─── NavaRasa Class ──────────────────────────────────────────────────────────

/**
 * Contextual emotional awareness system based on Bharata Muni's Natyashastra.
 *
 * Tracks 9 emotional modes (rasas) as a composition on the 8-simplex,
 * updates via softmax-projected observations smoothed by EMA, and produces
 * behavioral adaptations that guide the agent's interaction style.
 *
 * Designed to be lightweight — a matrix-vector multiply, a softmax, and
 * an EMA blend per update. Zero allocations in the hot path beyond the
 * returned state copy.
 */
export class NavaRasa {
	private config: NavaRasaConfig;
	private onEvent?: (event: string, data: unknown) => void;

	/** Current rasa state on the 8-simplex. */
	private rasaState: RasaState;

	/** Previous dominant rasa (for shift detection). */
	private prevDominant: RasaType;

	/** Ring buffer of recent rasa snapshots. */
	private history: RasaSnapshot[] = [];

	constructor(
		config?: Partial<NavaRasaConfig>,
		onEvent?: (event: string, data: unknown) => void,
	) {
		this.config = { ...DEFAULT_NAVA_RASA_CONFIG, ...config };
		this.onEvent = onEvent;

		// Clamp configurable values to system ceilings
		this.config.maxHistory = Math.min(
			this.config.maxHistory,
			SYSTEM_MAX_NAVA_RASA_HISTORY,
		);
		this.config.smoothingAlpha = clamp(
			this.config.smoothingAlpha,
			SYSTEM_MIN_ALPHA,
			SYSTEM_MAX_ALPHA,
		);
		this.config.softmaxTemperature = Math.max(
			this.config.softmaxTemperature,
			SYSTEM_MIN_TEMPERATURE,
		);

		// Initialize the 8-simplex state from config
		const normalized = normalizeToSimplex(
			[...this.config.initialState],
			this.config.simplexFloor,
		);
		this.rasaState = arrayToState(normalized);

		// Initial dominant
		this.prevDominant = this.computeDominant();

		// Record initial snapshot
		this.recordSnapshot();
	}

	// ─── Public API ──────────────────────────────────────────────────────

	/**
	 * Update the NavaRasa state with a new observation.
	 *
	 * 1. Map observation signals to a rasa distribution via influence matrix + softmax.
	 * 2. EMA-blend with current state: new = alpha * measured + (1 - alpha) * current.
	 * 3. Re-normalize to the simplex.
	 * 4. Check for dominant rasa shift and emit event if changed.
	 *
	 * @param observation Behavioral signals from the current interaction.
	 * @returns The updated rasa state (frozen copy).
	 */
	update(observation: RasaObservation): RasaState {
		const alpha = this.config.smoothingAlpha;
		const floor = this.config.simplexFloor;

		// 1. Map observation to a rasa distribution on the simplex
		const measured = observationToRasa(observation, this.config.softmaxTemperature);

		// 2. EMA blend: new_i = alpha * measured_i + (1 - alpha) * current_i
		const current = stateToArray(this.rasaState);
		const blended: number[] = new Array(NUM_RASAS);
		for (let i = 0; i < NUM_RASAS; i++) {
			blended[i] = alpha * measured[i] + (1 - alpha) * current[i];
		}

		// 3. Re-normalize to the simplex (EMA preserves sum ≈ 1, but clamp for safety)
		const normalized = normalizeToSimplex(blended, floor);
		this.rasaState = arrayToState(normalized);

		// 4. Record and check for shift
		this.recordSnapshot();
		this.checkShift();

		return this.getState();
	}

	/** Get the current rasa state (frozen copy). */
	getState(): RasaState {
		return { ...this.rasaState };
	}

	/** Get the dominant rasa — the one with the highest weight. */
	getDominant(): RasaType {
		return this.computeDominant();
	}

	/**
	 * Get the behavioral adaptation suggested by the current dominant rasa.
	 *
	 * Returns a structured recommendation for autonomy level, verbosity
	 * style, and whether confirmations should be required.
	 */
	getAdaptation(): RasaBehavioralAdaptation {
		const dominant = this.computeDominant();
		const base = ADAPTATION_TABLE[dominant];
		return {
			...base,
			source: dominant,
		};
	}

	/** Get the recent state history. */
	getHistory(limit?: number): RasaSnapshot[] {
		const n = limit ?? this.history.length;
		return this.history.slice(-n).map((snap) => ({
			state: { ...snap.state },
			dominant: snap.dominant,
			timestamp: snap.timestamp,
		}));
	}

	/** Reset to the initial state. Clears history. */
	reset(): void {
		const normalized = normalizeToSimplex(
			[...this.config.initialState],
			this.config.simplexFloor,
		);
		this.rasaState = arrayToState(normalized);
		this.history = [];
		this.prevDominant = this.computeDominant();
		this.recordSnapshot();
	}

	// ─── Serialization ──────────────────────────────────────────────────

	/** Serialize the NavaRasa state for persistence. */
	serialize(): NavaRasaSerializedState {
		return {
			rasaState: { ...this.rasaState },
			prevDominant: this.prevDominant,
			history: this.history.map((snap) => ({
				state: { ...snap.state },
				dominant: snap.dominant,
				timestamp: snap.timestamp,
			})),
		};
	}

	/** Restore a NavaRasa from serialized state. */
	static deserialize(
		state: NavaRasaSerializedState,
		config?: Partial<NavaRasaConfig>,
		onEvent?: (event: string, data: unknown) => void,
	): NavaRasa {
		const instance = new NavaRasa(config, onEvent);

		instance.rasaState = { ...state.rasaState };
		instance.prevDominant = state.prevDominant;
		instance.history = state.history.map((snap) => ({
			state: { ...snap.state },
			dominant: snap.dominant,
			timestamp: snap.timestamp,
		}));

		return instance;
	}

	// ─── Internal ────────────────────────────────────────────────────────

	/** Determine which rasa currently dominates (highest weight). */
	private computeDominant(): RasaType {
		const values = stateToArray(this.rasaState);
		let maxIdx = 0;
		let maxVal = values[0];

		for (let i = 1; i < NUM_RASAS; i++) {
			if (values[i] > maxVal) {
				maxVal = values[i];
				maxIdx = i;
			}
		}

		return RASA_LABELS[maxIdx];
	}

	/** Record a snapshot into the history ring buffer. */
	private recordSnapshot(): void {
		this.history.push({
			state: { ...this.rasaState },
			dominant: this.computeDominant(),
			timestamp: Date.now(),
		});

		// Trim to maxHistory
		if (this.history.length > this.config.maxHistory) {
			this.history.splice(0, this.history.length - this.config.maxHistory);
		}
	}

	/** Check for dominant rasa shift and emit event if changed. */
	private checkShift(): void {
		const dominant = this.computeDominant();

		if (dominant !== this.prevDominant && this.onEvent) {
			this.onEvent("nava_rasa:rasa_shift", {
				from: this.prevDominant,
				to: dominant,
				state: this.getState(),
			});
		}

		this.prevDominant = dominant;
	}
}
