/**
 * @chitragupta/anina/chetana — Triguna math primitives.
 *
 * ILR transforms, 2x2 matrix operations, observation-to-guna mapping,
 * simplex clamping, and trend computation. All pure functions.
 */

import type { GunaLabel, GunaSnapshot, GunaState, TrigunaObservation, TrendDirection } from "./triguna.js";

// ─── ILR Constants ──────────────────────────────────────────────────────────

const INV_SQRT2 = 1 / Math.sqrt(2);
const INV_SQRT6 = 1 / Math.sqrt(6);

// ─── ILR Transform ──────────────────────────────────────────────────────────

/** Forward ILR: simplex [x1, x2, x3] -> R^2 [y1, y2]. All xi > 0, sum ~ 1. */
export function ilrForward(x1: number, x2: number, x3: number): [number, number] {
	return [INV_SQRT2 * Math.log(x1 / x2), INV_SQRT6 * Math.log((x1 * x2) / (x3 * x3))];
}

/** Inverse ILR: R^2 [y1, y2] -> simplex [x1, x2, x3]. */
export function ilrInverse(y1: number, y2: number): [number, number, number] {
	const z1 = y1 * INV_SQRT2 + y2 * INV_SQRT6;
	const z2 = -y1 * INV_SQRT2 + y2 * INV_SQRT6;
	const z3 = -2 * y2 * INV_SQRT6;
	const e1 = Math.exp(z1), e2 = Math.exp(z2), e3 = Math.exp(z3);
	const total = e1 + e2 + e3;
	return [e1 / total, e2 / total, e3 / total];
}

// ─── 2x2 Matrix Ops ─────────────────────────────────────────────────────────

/** A 2x2 matrix stored as [a, b, c, d] for [[a, b], [c, d]]. */
export type Mat2 = [number, number, number, number];
/** A 2-vector. */
export type Vec2 = [number, number];

/** 2x2 identity matrix. */
export const IDENTITY_2: Mat2 = [1, 0, 0, 1];

/** 2x2 matrix addition. */
export function mat2Add(A: Mat2, B: Mat2): Mat2 {
	return [A[0] + B[0], A[1] + B[1], A[2] + B[2], A[3] + B[3]];
}

/** 2x2 matrix subtraction. */
export function mat2Sub(A: Mat2, B: Mat2): Mat2 {
	return [A[0] - B[0], A[1] - B[1], A[2] - B[2], A[3] - B[3]];
}

/** 2x2 matrix-vector multiply: Ax. */
export function mat2MulVec(A: Mat2, x: Vec2): Vec2 {
	return [A[0] * x[0] + A[1] * x[1], A[2] * x[0] + A[3] * x[1]];
}

/** 2x2 matrix multiply: AB. */
export function mat2Mul(A: Mat2, B: Mat2): Mat2 {
	return [
		A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3],
		A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3],
	];
}

/** 2x2 matrix transpose. */
export function mat2Transpose(A: Mat2): Mat2 {
	return [A[0], A[2], A[1], A[3]];
}

/** 2x2 matrix inverse (returns null if singular). */
export function mat2Inverse(A: Mat2): Mat2 | null {
	const det = A[0] * A[3] - A[1] * A[2];
	if (Math.abs(det) < 1e-15) return null;
	const inv = 1 / det;
	return [A[3] * inv, -A[1] * inv, -A[2] * inv, A[0] * inv];
}

/** Create a 2x2 diagonal matrix. */
export function mat2Diag(d: number): Mat2 {
	return [d, 0, 0, d];
}

/** Subtract two 2-vectors. */
export function vec2Sub(a: Vec2, b: Vec2): Vec2 {
	return [a[0] - b[0], a[1] - b[1]];
}

/** Add two 2-vectors. */
export function vec2Add(a: Vec2, b: Vec2): Vec2 {
	return [a[0] + b[0], a[1] + b[1]];
}

// ─── Observation -> Guna Mapping ────────────────────────────────────────────

/**
 * Influence matrix: maps 6 observation signals to 3 guna affinities.
 * Rows: [sattva, rajas, tamas]. Columns: errorRate, tokenVelocity, loopCount, latency, successRate, userSatisfaction.
 */
const INFLUENCE_MATRIX: [
	[number, number, number, number, number, number],
	[number, number, number, number, number, number],
	[number, number, number, number, number, number],
] = [
	[-0.8, -0.1, -0.2, -0.3,  0.9,  0.8],
	[ 0.0,  0.8,  0.6,  0.1, -0.1, -0.2],
	[ 0.9, -0.1,  0.4,  0.8, -0.7, -0.5],
];

/** Map a TrigunaObservation to a measured guna composition on the simplex. */
export function observationToGuna(obs: TrigunaObservation): [number, number, number] {
	const signals = [obs.errorRate, obs.tokenVelocity, obs.loopCount, obs.latency, obs.successRate, obs.userSatisfaction];
	const affinities: [number, number, number] = [0, 0, 0];
	for (let i = 0; i < 3; i++) {
		let sum = 0;
		for (let j = 0; j < 6; j++) sum += INFLUENCE_MATRIX[i][j] * signals[j];
		affinities[i] = sum;
	}
	const maxAff = Math.max(affinities[0], affinities[1], affinities[2]);
	const e0 = Math.exp(affinities[0] - maxAff);
	const e1 = Math.exp(affinities[1] - maxAff);
	const e2 = Math.exp(affinities[2] - maxAff);
	const total = e0 + e1 + e2;
	return [e0 / total, e1 / total, e2 / total];
}

// ─── Simplex Clamping ───────────────────────────────────────────────────────

/** Ensure all components are >= floor and sum to 1. */
export function clampToSimplex(x1: number, x2: number, x3: number, floor: number): [number, number, number] {
	let s = Math.max(x1, floor), r = Math.max(x2, floor), t = Math.max(x3, floor);
	const sum = s + r + t;
	return [s / sum, r / sum, t / sum];
}

// ─── Trend Computation ──────────────────────────────────────────────────────

/**
 * Compute OLS slope over the guna values in the snapshot window,
 * then classify as rising/falling/stable.
 */
export function computeTrendDirection(
	snapshots: GunaSnapshot[],
	guna: keyof GunaState,
	threshold: number,
): TrendDirection {
	const n = snapshots.length;
	if (n < 2) return "stable";

	const meanX = (n - 1) / 2;
	let meanY = 0;
	for (let i = 0; i < n; i++) meanY += snapshots[i].state[guna];
	meanY /= n;

	let slopeNum = 0, slopeDen = 0;
	for (let i = 0; i < n; i++) {
		const dx = i - meanX, dy = snapshots[i].state[guna] - meanY;
		slopeNum += dx * dy;
		slopeDen += dx * dx;
	}
	if (Math.abs(slopeDen) < 1e-15) return "stable";

	const totalChange = (slopeNum / slopeDen) * (n - 1);
	if (totalChange > threshold) return "rising";
	if (totalChange < -threshold) return "falling";
	return "stable";
}
