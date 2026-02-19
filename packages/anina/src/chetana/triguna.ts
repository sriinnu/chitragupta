/**
 * @chitragupta/anina/chetana — Triguna — त्रिगुण — Health Monitor.
 *
 * Simplex-constrained Kalman filter tracking three fundamental qualities
 * (sattva, rajas, tamas) using ILR coordinates for predict/update.
 */

import {
	ilrForward, ilrInverse, clampToSimplex, observationToGuna,
	computeTrendDirection,
	mat2Add, mat2Sub, mat2Mul, mat2MulVec, mat2Transpose, mat2Inverse,
	mat2Diag, vec2Sub, vec2Add, IDENTITY_2,
	type Mat2, type Vec2,
} from "./triguna-math.js";

// Re-export math primitives for consumers
export { ilrForward, ilrInverse } from "./triguna-math.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** The three fundamental qualities on the 2-simplex. */
export interface GunaState {
	sattva: number;
	rajas: number;
	tamas: number;
}

/** Observation vector for a single update. All values in [0, 1]. */
export interface TrigunaObservation {
	errorRate: number;
	tokenVelocity: number;
	loopCount: number;
	latency: number;
	successRate: number;
	userSatisfaction: number;
}

/** A timestamped snapshot of the guna state. */
export interface GunaSnapshot {
	state: GunaState;
	timestamp: number;
	dominant: GunaLabel;
}

/** Per-guna directional trend. */
export interface GunaTrend {
	sattva: TrendDirection;
	rajas: TrendDirection;
	tamas: TrendDirection;
}

/** Trend direction for a single guna. */
export type TrendDirection = "rising" | "falling" | "stable";

/** Label for the three gunas. */
export type GunaLabel = "sattva" | "rajas" | "tamas";

/** Triguna behavioral event types. */
export type TrigunaEventType =
	| "triguna:sattva_dominant"
	| "triguna:rajas_alert"
	| "triguna:tamas_alert"
	| "triguna:guna_shift";

/** Configuration for the Triguna health monitor. */
export interface TrigunaConfig {
	initialState: [number, number, number];
	processNoise: number;
	measurementNoise: number;
	sattvaThreshold: number;
	rajasThreshold: number;
	tamasThreshold: number;
	maxHistory: number;
	simplexFloor: number;
	trendWindow: number;
	trendThreshold: number;
}

/** System ceiling: maximum history snapshots. */
export const SYSTEM_MAX_TRIGUNA_HISTORY = 1000;

/** Default Triguna configuration. */
export const DEFAULT_TRIGUNA_CONFIG: TrigunaConfig = {
	initialState: [0.6, 0.3, 0.1],
	processNoise: 0.01,
	measurementNoise: 0.1,
	sattvaThreshold: 0.7,
	rajasThreshold: 0.5,
	tamasThreshold: 0.4,
	maxHistory: 100,
	simplexFloor: 1e-6,
	trendWindow: 5,
	trendThreshold: 0.05,
};

// ─── Serialization Types ─────────────────────────────────────────────────────

/** Serializable state for the Triguna system. */
export interface TrigunaSerializedState {
	gunaState: GunaState;
	xHat: [number, number];
	P: [number, number, number, number];
	prevDominant: GunaLabel;
	history: GunaSnapshot[];
}

// ─── Triguna Class ───────────────────────────────────────────────────────────

/**
 * Simplex-constrained Kalman filter for system health monitoring.
 *
 * Tracks the three gunas (sattva, rajas, tamas) as a composition on
 * the 2-simplex, using ILR coordinates for Kalman updates and mapping
 * back to the simplex after each step.
 */
export class Triguna {
	private config: TrigunaConfig;
	private onEvent?: (event: string, data: unknown) => void;
	private xHat: Vec2;
	private P: Mat2;
	private Q: Mat2;
	private R: Mat2;
	private gunaState: GunaState;
	private prevDominant: GunaLabel;
	private history: GunaSnapshot[] = [];

	constructor(config?: Partial<TrigunaConfig>, onEvent?: (event: string, data: unknown) => void) {
		this.config = { ...DEFAULT_TRIGUNA_CONFIG, ...config };
		this.onEvent = onEvent;
		this.config.maxHistory = Math.min(this.config.maxHistory, SYSTEM_MAX_TRIGUNA_HISTORY);

		const [s, r, t] = clampToSimplex(
			this.config.initialState[0], this.config.initialState[1],
			this.config.initialState[2], this.config.simplexFloor,
		);
		this.gunaState = { sattva: s, rajas: r, tamas: t };
		this.xHat = ilrForward(s, r, t);
		this.P = IDENTITY_2;
		this.Q = mat2Diag(this.config.processNoise);
		this.R = mat2Diag(this.config.measurementNoise);
		this.prevDominant = this.computeDominant();
		this.recordSnapshot();
	}

	/** Update the Triguna state with a new observation. Runs one Kalman predict/update cycle. */
	update(observation: TrigunaObservation): GunaState {
		const [zS, zR, zT] = observationToGuna(observation);
		const [mS, mR, mT] = clampToSimplex(zS, zR, zT, this.config.simplexFloor);
		const zIlr = ilrForward(mS, mR, mT);

		// Kalman predict (random walk: F = I)
		const xPred = this.xHat;
		const pPred = mat2Add(this.P, this.Q);

		// Kalman update (H = I, direct observation in ILR)
		const innovation = vec2Sub(zIlr, xPred);
		const S = mat2Add(pPred, this.R);
		const sInv = mat2Inverse(S);
		if (sInv === null) return this.getState();
		const K = mat2Mul(pPred, sInv);

		this.xHat = vec2Add(xPred, mat2MulVec(K, innovation));

		// Joseph form for numerical stability
		const ImKH = mat2Sub(IDENTITY_2, K);
		this.P = mat2Add(
			mat2Mul(mat2Mul(ImKH, pPred), mat2Transpose(ImKH)),
			mat2Mul(mat2Mul(K, this.R), mat2Transpose(K)),
		);

		// Map back to simplex
		const [newS, newR, newT] = ilrInverse(this.xHat[0], this.xHat[1]);
		const [cs, cr, ct] = clampToSimplex(newS, newR, newT, this.config.simplexFloor);
		this.gunaState = { sattva: cs, rajas: cr, tamas: ct };

		this.recordSnapshot();
		this.checkThresholds();
		return this.getState();
	}

	/** Get the current guna state (frozen copy). */
	getState(): GunaState { return { ...this.gunaState }; }

	/** Get the dominant guna. */
	getDominant(): GunaLabel { return this.computeDominant(); }

	/** Get the recent state history. */
	getHistory(limit?: number): GunaSnapshot[] {
		const n = limit ?? this.history.length;
		return this.history.slice(-n).map((snap) => ({
			state: { ...snap.state }, timestamp: snap.timestamp, dominant: snap.dominant,
		}));
	}

	/** Compute the directional trend for each guna over the recent window. */
	getTrend(): GunaTrend {
		const recent = this.history.slice(-this.config.trendWindow);
		if (recent.length < 2) return { sattva: "stable", rajas: "stable", tamas: "stable" };
		return {
			sattva: computeTrendDirection(recent, "sattva", this.config.trendThreshold),
			rajas: computeTrendDirection(recent, "rajas", this.config.trendThreshold),
			tamas: computeTrendDirection(recent, "tamas", this.config.trendThreshold),
		};
	}

	/** Reset to initial state. Clears history. */
	reset(): void {
		const [s, r, t] = clampToSimplex(
			this.config.initialState[0], this.config.initialState[1],
			this.config.initialState[2], this.config.simplexFloor,
		);
		this.gunaState = { sattva: s, rajas: r, tamas: t };
		this.xHat = ilrForward(s, r, t);
		this.P = IDENTITY_2;
		this.history = [];
		this.prevDominant = this.computeDominant();
		this.recordSnapshot();
	}

	/** Serialize the Triguna state for persistence. */
	serialize(): TrigunaSerializedState {
		return {
			gunaState: { ...this.gunaState },
			xHat: [...this.xHat],
			P: [...this.P],
			prevDominant: this.prevDominant,
			history: this.history.map((snap) => ({ state: { ...snap.state }, timestamp: snap.timestamp, dominant: snap.dominant })),
		};
	}

	/** Restore a Triguna from serialized state. */
	static deserialize(
		state: TrigunaSerializedState,
		config?: Partial<TrigunaConfig>,
		onEvent?: (event: string, data: unknown) => void,
	): Triguna {
		const instance = new Triguna(config, onEvent);
		instance.gunaState = { ...state.gunaState };
		instance.xHat = [state.xHat[0], state.xHat[1]];
		instance.P = [state.P[0], state.P[1], state.P[2], state.P[3]];
		instance.prevDominant = state.prevDominant;
		instance.history = state.history.map((snap) => ({ state: { ...snap.state }, timestamp: snap.timestamp, dominant: snap.dominant }));
		return instance;
	}

	private computeDominant(): GunaLabel {
		const { sattva, rajas, tamas } = this.gunaState;
		if (sattva >= rajas && sattva >= tamas) return "sattva";
		if (rajas >= sattva && rajas >= tamas) return "rajas";
		return "tamas";
	}

	private recordSnapshot(): void {
		this.history.push({ state: { ...this.gunaState }, timestamp: Date.now(), dominant: this.computeDominant() });
		if (this.history.length > this.config.maxHistory) {
			this.history.splice(0, this.history.length - this.config.maxHistory);
		}
	}

	private checkThresholds(): void {
		const { sattva, rajas, tamas } = this.gunaState;
		const dominant = this.computeDominant();
		if (dominant !== this.prevDominant && this.onEvent) {
			this.onEvent("triguna:guna_shift", { from: this.prevDominant, to: dominant, state: this.getState() });
		}
		if (sattva > this.config.sattvaThreshold && this.onEvent) {
			this.onEvent("triguna:sattva_dominant", { sattva, message: "System healthy — clarity and balance prevail" });
		}
		if (rajas > this.config.rajasThreshold && this.onEvent) {
			this.onEvent("triguna:rajas_alert", { rajas, message: "System hyperactive — consider reducing parallelism" });
		}
		if (tamas > this.config.tamasThreshold && this.onEvent) {
			this.onEvent("triguna:tamas_alert", { tamas, message: "System degraded — suggest recovery actions" });
		}
		this.prevDominant = dominant;
	}
}
