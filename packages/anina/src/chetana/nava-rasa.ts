/**
 * @chitragupta/anina/chetana — Nava Rasa — नव रस — Contextual Emotional Awareness.
 *
 * Nine rasas (aesthetic emotions from Bharata Muni's Natyashastra) tracked
 * on the 8-simplex. Observations produce stimulus vectors mapped via influence
 * matrix + softmax, then EMA-blended with the current state. Each dominant rasa
 * maps to a behavioral adaptation (autonomy, verbosity, confirmations).
 *
 * Math primitives and influence matrix are in nava-rasa-math.ts.
 *
 * @packageDocumentation
 */

import {
	NUM_RASAS, clamp, normalizeToSimplex, observationToRasa,
	stateToArray, arrayToState, ADAPTATION_TABLE,
	SYSTEM_MIN_ALPHA, SYSTEM_MAX_ALPHA, SYSTEM_MIN_TEMPERATURE,
} from "./nava-rasa-math.js";

// Re-export math primitives for consumers
export {
	NUM_RASAS, clamp, normalizeToSimplex, softmax, observationToRasa,
	stateToArray, arrayToState, INFLUENCE_MATRIX, ADAPTATION_TABLE,
} from "./nava-rasa-math.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** The nine rasa labels per Natyashastra. */
export type RasaType =
	| "shringara" | "vira" | "karuna" | "raudra" | "bhayanaka"
	| "bibhatsa" | "adbhuta" | "hasya" | "shanta";

/** All nine rasa labels in canonical order. */
export const RASA_LABELS: readonly RasaType[] = [
	"shringara", "vira", "karuna", "raudra", "bhayanaka",
	"bibhatsa", "adbhuta", "hasya", "shanta",
] as const;

/** A 9-dimensional state vector on the 8-simplex. All values in [0, 1], sum = 1.0. */
export interface RasaState {
	shringara: number;
	vira: number;
	karuna: number;
	raudra: number;
	bhayanaka: number;
	bibhatsa: number;
	adbhuta: number;
	hasya: number;
	shanta: number;
}

/** Observation vector: behavioral signals that drive rasa updates. All [0, 1]. */
export interface RasaObservation {
	userSatisfaction: number;
	confidence: number;
	successRate: number;
	userStruggling: number;
	securityThreat: number;
	highRiskAction: number;
	codeQualityLow: number;
	novelSituation: number;
	benignAnomaly: number;
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
	| "minimal" | "terse" | "normal" | "light"
	| "detailed" | "cautious" | "critical" | "alert";

/** Behavioral adaptation suggested by the current dominant rasa. */
export interface RasaBehavioralAdaptation {
	autonomy: AutonomyLevel;
	verbosity: VerbosityStyle;
	confirmations: boolean;
	source: RasaType;
}

/** Event types emitted by the NavaRasa system. */
export type NavaRasaEventType = "nava_rasa:rasa_shift";

/** Configuration for the NavaRasa system. */
export interface NavaRasaConfig {
	/** Initial rasa state as a 9-element array (normalized). */
	initialState: [number, number, number, number, number, number, number, number, number];
	/** EMA smoothing factor alpha in (0, 1]. Default: 0.3. */
	smoothingAlpha: number;
	/** Softmax temperature. Higher = more uniform. Default: 1.0. */
	softmaxTemperature: number;
	/** Maximum history snapshots. Default: 100. */
	maxHistory: number;
	/** Minimum rasa value to prevent collapse. Default: 1e-6. */
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

// ─── Defaults ────────────────────────────────────────────────────────────────

/** Default NavaRasa configuration: shanta-dominant equilibrium. */
export const DEFAULT_NAVA_RASA_CONFIG: NavaRasaConfig = {
	initialState: [0.05, 0.05, 0.05, 0.02, 0.02, 0.02, 0.05, 0.04, 0.70],
	smoothingAlpha: 0.3,
	softmaxTemperature: 1.0,
	maxHistory: 100,
	simplexFloor: 1e-6,
};

// ─── NavaRasa Class ──────────────────────────────────────────────────────────

/**
 * Contextual emotional awareness system based on Bharata Muni's Natyashastra.
 *
 * Tracks 9 rasas on the 8-simplex via softmax + EMA blending and produces
 * behavioral adaptations guiding the agent's interaction style.
 */
export class NavaRasa {
	private config: NavaRasaConfig;
	private onEvent?: (event: string, data: unknown) => void;
	private rasaState: RasaState;
	private prevDominant: RasaType;
	private history: RasaSnapshot[] = [];

	constructor(config?: Partial<NavaRasaConfig>, onEvent?: (event: string, data: unknown) => void) {
		this.config = { ...DEFAULT_NAVA_RASA_CONFIG, ...config };
		this.onEvent = onEvent;

		this.config.maxHistory = Math.min(this.config.maxHistory, SYSTEM_MAX_NAVA_RASA_HISTORY);
		this.config.smoothingAlpha = clamp(this.config.smoothingAlpha, SYSTEM_MIN_ALPHA, SYSTEM_MAX_ALPHA);
		this.config.softmaxTemperature = Math.max(this.config.softmaxTemperature, SYSTEM_MIN_TEMPERATURE);

		const normalized = normalizeToSimplex([...this.config.initialState], this.config.simplexFloor);
		this.rasaState = arrayToState(normalized);
		this.prevDominant = this.computeDominant();
		this.recordSnapshot();
	}

	/** Update with a new observation. EMA-blends softmax-projected measurement with current state. */
	update(observation: RasaObservation): RasaState {
		const alpha = this.config.smoothingAlpha;
		const measured = observationToRasa(observation, this.config.softmaxTemperature);
		const current = stateToArray(this.rasaState);
		const blended: number[] = new Array(NUM_RASAS);
		for (let i = 0; i < NUM_RASAS; i++) blended[i] = alpha * measured[i] + (1 - alpha) * current[i];
		this.rasaState = arrayToState(normalizeToSimplex(blended, this.config.simplexFloor));
		this.recordSnapshot();
		this.checkShift();
		return this.getState();
	}

	/** Get the current rasa state (frozen copy). */
	getState(): RasaState { return { ...this.rasaState }; }

	/** Get the dominant rasa. */
	getDominant(): RasaType { return this.computeDominant(); }

	/** Get the behavioral adaptation for the current dominant rasa. */
	getAdaptation(): RasaBehavioralAdaptation {
		const dominant = this.computeDominant();
		return { ...ADAPTATION_TABLE[dominant], source: dominant };
	}

	/** Get the recent state history. */
	getHistory(limit?: number): RasaSnapshot[] {
		const n = limit ?? this.history.length;
		return this.history.slice(-n).map((s) => ({ state: { ...s.state }, dominant: s.dominant, timestamp: s.timestamp }));
	}

	/** Reset to the initial state. Clears history. */
	reset(): void {
		const normalized = normalizeToSimplex([...this.config.initialState], this.config.simplexFloor);
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
			history: this.history.map((s) => ({ state: { ...s.state }, dominant: s.dominant, timestamp: s.timestamp })),
		};
	}

	/** Restore from serialized state. */
	static deserialize(
		state: NavaRasaSerializedState,
		config?: Partial<NavaRasaConfig>,
		onEvent?: (event: string, data: unknown) => void,
	): NavaRasa {
		const instance = new NavaRasa(config, onEvent);
		instance.rasaState = { ...state.rasaState };
		instance.prevDominant = state.prevDominant;
		instance.history = state.history.map((s) => ({ state: { ...s.state }, dominant: s.dominant, timestamp: s.timestamp }));
		return instance;
	}

	// ─── Internal ────────────────────────────────────────────────────────

	private computeDominant(): RasaType {
		const values = stateToArray(this.rasaState);
		let maxIdx = 0;
		for (let i = 1; i < NUM_RASAS; i++) { if (values[i] > values[maxIdx]) maxIdx = i; }
		return RASA_LABELS[maxIdx];
	}

	private recordSnapshot(): void {
		this.history.push({ state: { ...this.rasaState }, dominant: this.computeDominant(), timestamp: Date.now() });
		if (this.history.length > this.config.maxHistory) {
			this.history.splice(0, this.history.length - this.config.maxHistory);
		}
	}

	private checkShift(): void {
		const dominant = this.computeDominant();
		if (dominant !== this.prevDominant && this.onEvent) {
			this.onEvent("nava_rasa:rasa_shift", { from: this.prevDominant, to: dominant, state: this.getState() });
		}
		this.prevDominant = dominant;
	}
}
