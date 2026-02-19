/**
 * @chitragupta/anina/chetana — Nava Rasa math primitives.
 *
 * Influence matrix, softmax projection, simplex normalization, observation
 * mapping, state<->array conversion, behavioral adaptation table, and
 * system ceiling constants. All pure functions.
 */

import type {
	RasaType, RasaState, RasaObservation, RasaBehavioralAdaptation,
} from "./nava-rasa.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Number of rasas (dimension of the simplex + 1). */
export const NUM_RASAS = 9;

/** Minimum smoothing alpha. */
export const SYSTEM_MIN_ALPHA = 0.01;

/** Maximum smoothing alpha. */
export const SYSTEM_MAX_ALPHA = 1.0;

/** Minimum softmax temperature. */
export const SYSTEM_MIN_TEMPERATURE = 0.01;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Clamp a number to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Normalize a 9-element array onto the 8-simplex.
 * All values clamped to >= floor, then divided by sum.
 */
export function normalizeToSimplex(values: number[], floor: number): number[] {
	const clamped = values.map((v) => Math.max(v, floor));
	const sum = clamped.reduce((acc, v) => acc + v, 0);
	return clamped.map((v) => v / sum);
}

/**
 * Softmax projection of a raw affinity vector onto the simplex.
 * Uses log-sum-exp trick for numerical stability.
 */
export function softmax(affinities: number[], temperature: number): number[] {
	const t = Math.max(temperature, SYSTEM_MIN_TEMPERATURE);
	const maxAff = Math.max(...affinities);
	const exps = affinities.map((a) => Math.exp((a - maxAff) / t));
	const sum = exps.reduce((acc, e) => acc + e, 0);
	return exps.map((e) => e / sum);
}

// ─── Influence Matrix ───────────────────────────────────────────────────────

/**
 * Influence matrix: maps 10 observation signals to 9 rasa affinities.
 * Rows: rasas in canonical order. Columns: observation signals.
 *
 * [userSatisfaction, confidence, successRate, userStruggling,
 *  securityThreat, highRiskAction, codeQualityLow, novelSituation,
 *  benignAnomaly, allTasksComplete]
 */
export const INFLUENCE_MATRIX: readonly number[][] = [
	// shringara: satisfaction + success boost, threats inhibit
	[ 0.9,  0.3,  0.4, -0.3, -0.5, -0.2, -0.3,  0.1,  0.1,  0.2],
	// vira: confidence + success boost, struggle inhibits
	[ 0.2,  0.9,  0.8, -0.4, -0.1,  0.2, -0.1,  0.2, -0.1,  0.0],
	// karuna: struggle boosts, satisfaction inhibits
	[-0.2, -0.3, -0.3,  0.9,  0.0,  0.1,  0.2,  0.0,  0.0, -0.1],
	// raudra: security threat dominates, peace inhibits
	[-0.3, -0.1,  0.0,  0.1,  0.9,  0.3, -0.1, -0.1, -0.3, -0.5],
	// bhayanaka: high risk + threat, success inhibits
	[-0.2, -0.3, -0.4,  0.2,  0.4,  0.9,  0.1,  0.1, -0.2, -0.3],
	// bibhatsa: low quality boosts, satisfaction inhibits
	[-0.3, -0.1, -0.2,  0.1,  0.1,  0.1,  0.9,  0.0, -0.1, -0.1],
	// adbhuta: novelty boosts, completion inhibits
	[ 0.1,  0.0,  0.0,  0.0, -0.1,  0.1,  0.0,  0.9,  0.2, -0.4],
	// hasya: benign anomaly boosts, threats inhibit
	[ 0.2,  0.0,  0.0,  0.0, -0.4, -0.2, -0.1,  0.2,  0.9, -0.1],
	// shanta: completion + satisfaction, threats/risk inhibit
	[ 0.3,  0.2,  0.3, -0.2, -0.6, -0.5, -0.2, -0.2,  0.0,  0.9],
];

// ─── Observation Mapping ────────────────────────────────────────────────────

/**
 * Map a RasaObservation to a measured rasa composition on the simplex.
 * Matrix-vector multiply + softmax projection.
 */
export function observationToRasa(obs: RasaObservation, temperature: number): number[] {
	const signals = [
		obs.userSatisfaction, obs.confidence, obs.successRate, obs.userStruggling,
		obs.securityThreat, obs.highRiskAction, obs.codeQualityLow,
		obs.novelSituation, obs.benignAnomaly, obs.allTasksComplete,
	];
	const affinities: number[] = new Array(NUM_RASAS);
	for (let i = 0; i < NUM_RASAS; i++) {
		let sum = 0;
		for (let j = 0; j < 10; j++) sum += INFLUENCE_MATRIX[i][j] * signals[j];
		affinities[i] = sum;
	}
	return softmax(affinities, temperature);
}

// ─── State Conversion ───────────────────────────────────────────────────────

/** Convert a RasaState to a number array in canonical order. */
export function stateToArray(state: RasaState): number[] {
	return [
		state.shringara, state.vira, state.karuna, state.raudra,
		state.bhayanaka, state.bibhatsa, state.adbhuta, state.hasya, state.shanta,
	];
}

/** Convert a number array (canonical order) to a RasaState. */
export function arrayToState(values: number[]): RasaState {
	return {
		shringara: values[0], vira: values[1], karuna: values[2],
		raudra: values[3], bhayanaka: values[4], bibhatsa: values[5],
		adbhuta: values[6], hasya: values[7], shanta: values[8],
	};
}

// ─── Behavioral Adaptation Table ────────────────────────────────────────────

/** Maps each rasa to its behavioral adaptation. */
export const ADAPTATION_TABLE: Record<RasaType, Omit<RasaBehavioralAdaptation, "source">> = {
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
