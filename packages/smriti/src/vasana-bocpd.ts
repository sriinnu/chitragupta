/**
 * @chitragupta/smriti -- Vasana BOCPD (Bayesian Online Change-Point Detection)
 *
 * Extracted from vasana-engine.ts to keep files under 450 LOC.
 * Contains the core BOCPD algorithm (Adams & MacKay 2007, arxiv 0710.3742),
 * configuration types, math utilities, and FNV-1a hashing.
 *
 * All BOCPD computations use log-domain arithmetic to prevent underflow.
 * @module
 */

// ─── FNV-1a ─────────────────────────────────────────────────────────────────

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32-bit hash, returned as zero-padded hex string.
 * Used to generate deterministic short IDs for vasana clustering.
 */
export function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = (Math.imul(hash, FNV_PRIME)) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

// ─── Configuration ──────────────────────────────────────────────────────────

/** All fields have sensible defaults; two-tier clamped by hard ceilings. */
export interface VasanaConfig {
	/** Expected run length for hazard function H(tau)=1/lambda. Default: 50. */
	lambda: number;
	/** P(r=0) threshold to trigger change-point. Default: 0.3. */
	changePointThreshold: number;
	/** Consecutive stable sessions before crystallization. Default: 5. */
	stabilityWindow: number;
	/** Sliding window size (sessions). Default: 20. */
	windowSize: number;
	/** Holdout train fraction. Default: 0.7. */
	holdoutTrainRatio: number;
	/** Min predictive accuracy to crystallize. Default: 0.6. */
	accuracyThreshold: number;
	/** Temporal decay half-life (ms). Default: 30 days. */
	decayHalfLifeMs: number;
	/** Projects needed to promote to global. Default: 3. */
	promotionMinProjects: number;
	/** Max run-length entries (prune tail). Default: 200. */
	maxRunLength: number;
	/** Normal-Gamma prior: mu_0. Default: 0. */
	priorMu: number;
	/** Normal-Gamma prior: kappa_0. Default: 1. */
	priorKappa: number;
	/** Normal-Gamma prior: alpha_0. Default: 1. */
	priorAlpha: number;
	/**
	 * Anomaly revert window -- observations to wait before confirming a regime shift.
	 * If the signal reverts within this window, it's classified as an anomaly (one-off)
	 * rather than a genuine change-point. Default: 3.
	 */
	anomalyRevertWindow: number;
	/**
	 * Anomaly confirmation threshold -- ratio of high-P(r=0) observations in the
	 * revert window needed to confirm a genuine change-point.
	 * If < this fraction of revert-window observations are change-points,
	 * classify as anomaly instead. Default: 0.5.
	 */
	anomalyConfirmRatio: number;
}

/** Classification of a detected deviation. */
export type DeviationType = "change-point" | "anomaly" | "stable";

/** Default BOCPD configuration with sensible priors. */
export const DEFAULT_VASANA_CONFIG: VasanaConfig = {
	lambda: 50, changePointThreshold: 0.3, stabilityWindow: 5,
	windowSize: 20, holdoutTrainRatio: 0.7, accuracyThreshold: 0.6,
	decayHalfLifeMs: 30 * 86_400_000, promotionMinProjects: 3,
	maxRunLength: 200, priorMu: 0, priorKappa: 1, priorAlpha: 1,
	anomalyRevertWindow: 3, anomalyConfirmRatio: 0.5,
};

/** Hard ceilings to prevent unreasonable config values. */
export const HARD_CEILINGS: Partial<VasanaConfig> = {
	windowSize: 500, maxRunLength: 2000, stabilityWindow: 100,
};

// ─── BOCPD Internal Types ───────────────────────────────────────────────────

/** Normal-Gamma sufficient statistics for online Student-t predictive. */
export interface SuffStats {
	mu: number;
	kappa: number;
	alpha: number;
	beta: number;
}

/** Per-feature run-length distribution + statistics. */
export interface BOCPDState {
	/** log P(r_t = r | x_{1:t}), normalized. */
	logR: number[];
	/** Sufficient stats per run length. */
	stats: SuffStats[];
	/** Consecutive sessions without change-point. */
	stableCount: number;
	/** Total observations processed. */
	totalObs: number;
	/**
	 * Recent P(r=0) values for anomaly/change-point discrimination.
	 * A sliding window of the last `anomalyRevertWindow` observations'
	 * change-point probabilities. If high, it's a regime shift.
	 * If only one or two spike and then revert, it's an anomaly.
	 */
	recentCpProbs: number[];
}

/** Serialized BOCPD state for SQLite persistence. */
export interface SerializedBOCPDState {
	features: Record<string, BOCPDState>;
	observations: Record<string, number[]>;
}

// ─── Math Utilities ─────────────────────────────────────────────────────────

/** Numerically stable log-sum-exp. */
export function logsumexp(xs: number[]): number {
	if (xs.length === 0) return -Infinity;
	const m = Math.max(...xs);
	if (m === -Infinity) return -Infinity;
	let s = 0;
	for (let i = 0; i < xs.length; i++) s += Math.exp(xs[i] - m);
	return m + Math.log(s);
}

/** Log-Gamma via Lanczos approximation (g=7, 9 coefficients). */
export function lgamma(z: number): number {
	const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
		771.32342877765313, -176.61502916214059, 12.507343278686905,
		-0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
	if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
	z -= 1;
	let x = c[0];
	for (let i = 1; i < 9; i++) x += c[i] / (z + i);
	const t = z + 7.5;
	return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Log-PDF of Student-t(x | nu, mu, sigma). */
export function logStudentT(x: number, nu: number, mu: number, sigma: number): number {
	// Guard: sigma must be positive; clamp to epsilon to prevent NaN from division by zero
	const safeSigma = sigma > 1e-15 ? sigma : 1e-15;
	const z = (x - mu) / safeSigma;
	return lgamma((nu + 1) / 2) - lgamma(nu / 2)
		- 0.5 * Math.log(nu * Math.PI * safeSigma * safeSigma)
		- ((nu + 1) / 2) * Math.log(1 + z * z / nu);
}

// ─── Core BOCPD Functions ───────────────────────────────────────────────────

/**
 * Initialize a fresh BOCPD state with P(r=0) = 1 and prior sufficient stats.
 */
export function initBOCPD(cfg: VasanaConfig): BOCPDState {
	return {
		logR: [0], // P(r=0) = 1
		stats: [{ mu: cfg.priorMu, kappa: cfg.priorKappa,
			alpha: cfg.priorAlpha, beta: cfg.priorAlpha }],
		stableCount: 0, totalObs: 0, recentCpProbs: [],
	};
}

/**
 * Online BOCPD update for one observation on one feature dimension.
 *
 * 1. Predictive P(x_t | r) via Student-t with Normal-Gamma sufficient stats
 * 2. Growth: P(r_t=r+1) = P(x|r) * P(r) * (1-H)
 * 3. Change-point: P(r_t=0) = sum_r P(x|r) * P(r) * H
 * 4. Normalize, update sufficient stats, prune low-probability tails
 */
export function updateBOCPD(st: BOCPDState, x: number, cfg: VasanaConfig): void {
	const logH = -Math.log(cfg.lambda);
	const log1H = Math.log(1 - 1 / cfg.lambda);
	const n = st.logR.length;

	// Predictive probabilities
	const lpp = new Array<number>(n);
	for (let r = 0; r < n; r++) {
		const s = st.stats[r];
		lpp[r] = logStudentT(x, 2 * s.alpha, s.mu, Math.sqrt(s.beta * (s.kappa + 1) / (s.alpha * s.kappa)));
	}

	// Growth + change-point
	const cpTerms = new Array<number>(n);
	const newLR = new Array<number>(n + 1);
	for (let r = 0; r < n; r++) {
		newLR[r + 1] = lpp[r] + st.logR[r] + log1H;
		cpTerms[r] = lpp[r] + st.logR[r] + logH;
	}
	newLR[0] = logsumexp(cpTerms);

	// Normalize
	const logZ = logsumexp(newLR);
	for (let i = 0; i <= n; i++) newLR[i] -= logZ;

	// Update sufficient statistics (Normal-Gamma conjugate update)
	const newS = new Array<SuffStats>(n + 1);
	newS[0] = { mu: cfg.priorMu, kappa: cfg.priorKappa,
		alpha: cfg.priorAlpha, beta: cfg.priorAlpha };
	for (let r = 0; r < n; r++) {
		const p = st.stats[r];
		const k = p.kappa + 1;
		const dx = x - p.mu;
		newS[r + 1] = { mu: (p.kappa * p.mu + x) / k, kappa: k,
			alpha: p.alpha + 0.5, beta: p.beta + 0.5 * p.kappa * dx * dx / k };
	}

	// Prune to maxRunLength
	if (newLR.length > cfg.maxRunLength) {
		const idx = newLR.map((lp, i) => ({ lp, i })).sort((a, b) => b.lp - a.lp);
		const keep = new Set(idx.slice(0, cfg.maxRunLength).map(e => e.i));
		const pR: number[] = [], pS: SuffStats[] = [];
		for (let i = 0; i <= n; i++) if (keep.has(i)) { pR.push(newLR[i]); pS.push(newS[i]); }
		const norm = logsumexp(pR);
		for (let i = 0; i < pR.length; i++) pR[i] -= norm;
		st.logR = pR; st.stats = pS;
	} else {
		st.logR = newLR; st.stats = newS;
	}
	st.totalObs++;

	// Track recent P(r=0) for anomaly/change-point discrimination
	const cpProb = st.logR.length > 0 ? Math.exp(st.logR[0]) : 0;
	if (!st.recentCpProbs) st.recentCpProbs = [];
	st.recentCpProbs.push(cpProb);
	if (st.recentCpProbs.length > cfg.anomalyRevertWindow) {
		st.recentCpProbs.shift();
	}
}

/**
 * Serialize BOCPD engine state (all features + observations) to a plain object.
 */
export function serializeBOCPD(
	states: Map<string, BOCPDState>,
	obs: Map<string, number[]>,
): SerializedBOCPDState {
	return {
		features: Object.fromEntries(states),
		observations: Object.fromEntries(obs),
	};
}

/**
 * Deserialize BOCPD state from a plain object back into Maps.
 * Returns null-ish maps on parse failure (caller should clear).
 */
export function deserializeBOCPD(
	raw: SerializedBOCPDState,
): { states: Map<string, BOCPDState>; obs: Map<string, number[]> } {
	return {
		states: new Map(Object.entries(raw.features)),
		obs: new Map(
			Object.entries(raw.observations).map(([k, v]) => [k, Array.isArray(v) ? v : []]),
		),
	};
}
