/**
 * @chitragupta/anina — Chetana Math Primitives Tests.
 *
 * Direct unit tests for the extracted pure math functions in
 * triguna-math.ts and nava-rasa-math.ts.
 */

import { describe, it, expect } from "vitest";

// ── Triguna math ────────────────────────────────────────────────────────────
import {
	ilrForward, ilrInverse, clampToSimplex, observationToGuna, computeTrendDirection,
	mat2Add, mat2Sub, mat2MulVec, mat2Mul, mat2Transpose, mat2Inverse,
	mat2Diag, vec2Sub, vec2Add, IDENTITY_2,
	type Mat2,
} from "../src/chetana/triguna-math.js";
import type { GunaSnapshot, GunaState } from "../src/chetana/triguna.js";

// ── Nava Rasa math ──────────────────────────────────────────────────────────
import {
	NUM_RASAS, clamp, normalizeToSimplex, softmax,
	observationToRasa, stateToArray, arrayToState,
	ADAPTATION_TABLE, INFLUENCE_MATRIX,
	SYSTEM_MIN_ALPHA, SYSTEM_MAX_ALPHA, SYSTEM_MIN_TEMPERATURE,
} from "../src/chetana/nava-rasa-math.js";
import type { RasaState, RasaObservation } from "../src/chetana/nava-rasa.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Sum of array elements. */
function arraySum(arr: number[]): number {
	return arr.reduce((a, b) => a + b, 0);
}

/** Create a balanced RasaObservation with all fields at 0.5. */
function balancedRasaObs(overrides?: Partial<RasaObservation>): RasaObservation {
	return {
		userSatisfaction: 0.5, confidence: 0.5, successRate: 0.5,
		userStruggling: 0, securityThreat: 0, highRiskAction: 0,
		codeQualityLow: 0, novelSituation: 0, benignAnomaly: 0, allTasksComplete: 0,
		...overrides,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// Triguna Math
// ═══════════════════════════════════════════════════════════════════════════════

describe("triguna-math — ILR round-trip", () => {
	it("should round-trip through forward+inverse", () => {
		const [y1, y2] = ilrForward(0.5, 0.3, 0.2);
		const [x1, x2, x3] = ilrInverse(y1, y2);
		expect(x1).toBeCloseTo(0.5, 5);
		expect(x2).toBeCloseTo(0.3, 5);
		expect(x3).toBeCloseTo(0.2, 5);
	});

	it("should round-trip for uniform distribution", () => {
		const third = 1 / 3;
		const [y1, y2] = ilrForward(third, third, third);
		expect(y1).toBeCloseTo(0, 10);
		expect(y2).toBeCloseTo(0, 10);
		const [x1, x2, x3] = ilrInverse(y1, y2);
		expect(x1).toBeCloseTo(third, 5);
		expect(x2).toBeCloseTo(third, 5);
		expect(x3).toBeCloseTo(third, 5);
	});

	it("should produce non-zero ILR for skewed input", () => {
		const [y1, y2] = ilrForward(0.8, 0.1, 0.1);
		expect(Math.abs(y1)).toBeGreaterThan(0);
		expect(Math.abs(y2)).toBeGreaterThan(0);
	});
});

describe("triguna-math — 2x2 matrix operations", () => {
	it("mat2Add should add element-wise", () => {
		const result = mat2Add([1, 2, 3, 4], [5, 6, 7, 8]);
		expect(result).toEqual([6, 8, 10, 12]);
	});

	it("mat2Sub should subtract element-wise", () => {
		const result = mat2Sub([5, 6, 7, 8], [1, 2, 3, 4]);
		expect(result).toEqual([4, 4, 4, 4]);
	});

	it("mat2MulVec should multiply matrix by vector", () => {
		const result = mat2MulVec([1, 2, 3, 4], [5, 6]);
		expect(result[0]).toBe(17); // 1*5 + 2*6
		expect(result[1]).toBe(39); // 3*5 + 4*6
	});

	it("mat2Mul should multiply two matrices", () => {
		const A: Mat2 = [1, 2, 3, 4];
		const result = mat2Mul(A, IDENTITY_2);
		expect(result).toEqual(A);
	});

	it("mat2Transpose should swap off-diagonal elements", () => {
		expect(mat2Transpose([1, 2, 3, 4])).toEqual([1, 3, 2, 4]);
	});

	it("mat2Inverse should invert a non-singular matrix", () => {
		const A: Mat2 = [2, 1, 1, 1];
		const inv = mat2Inverse(A);
		expect(inv).not.toBeNull();
		// A * A^-1 = I
		const product = mat2Mul(A, inv!);
		expect(product[0]).toBeCloseTo(1, 10);
		expect(product[1]).toBeCloseTo(0, 10);
		expect(product[2]).toBeCloseTo(0, 10);
		expect(product[3]).toBeCloseTo(1, 10);
	});

	it("mat2Inverse should return null for singular matrix", () => {
		expect(mat2Inverse([1, 2, 2, 4])).toBeNull();
	});

	it("mat2Diag should create diagonal matrix", () => {
		expect(mat2Diag(3)).toEqual([3, 0, 0, 3]);
	});

	it("vec2Sub should subtract vectors", () => {
		expect(vec2Sub([5, 3], [1, 2])).toEqual([4, 1]);
	});

	it("vec2Add should add vectors", () => {
		expect(vec2Add([1, 2], [3, 4])).toEqual([4, 6]);
	});

	it("IDENTITY_2 should be the identity matrix", () => {
		expect(IDENTITY_2).toEqual([1, 0, 0, 1]);
	});
});

describe("triguna-math — observationToGuna", () => {
	it("should output values summing to 1.0", () => {
		const [s, r, t] = observationToGuna({
			errorRate: 0.1, tokenVelocity: 0.5, loopCount: 0.2,
			latency: 0.3, successRate: 0.8, userSatisfaction: 0.7,
		});
		expect(s + r + t).toBeCloseTo(1.0, 10);
	});

	it("should favor sattva for high success + satisfaction", () => {
		const [s, r, t] = observationToGuna({
			errorRate: 0, tokenVelocity: 0.3, loopCount: 0,
			latency: 0, successRate: 1.0, userSatisfaction: 1.0,
		});
		expect(s).toBeGreaterThan(r);
		expect(s).toBeGreaterThan(t);
	});

	it("should favor tamas for high error + latency", () => {
		const [s, r, t] = observationToGuna({
			errorRate: 1.0, tokenVelocity: 0, loopCount: 0.5,
			latency: 1.0, successRate: 0, userSatisfaction: 0,
		});
		expect(t).toBeGreaterThan(s);
	});
});

describe("triguna-math — clampToSimplex", () => {
	it("should enforce floor and normalize to sum=1", () => {
		// Floor is pre-normalization: clamp(0.001, 0.05)→0.05 then normalize
		const [a, b, c] = clampToSimplex(0.001, 0.001, 0.998, 0.05);
		expect(a).toBeGreaterThan(0);
		expect(b).toBeGreaterThan(0);
		expect(a + b + c).toBeCloseTo(1.0, 10);
		// Both small inputs should be equal after clamping+normalization
		expect(a).toBeCloseTo(b, 10);
	});

	it("should preserve proportions when already above floor", () => {
		const [a, b, c] = clampToSimplex(0.5, 0.3, 0.2, 0.01);
		expect(a + b + c).toBeCloseTo(1.0, 10);
		expect(a).toBeGreaterThan(b);
		expect(b).toBeGreaterThan(c);
	});
});

describe("triguna-math — computeTrendDirection", () => {
	it("should detect rising trend", () => {
		const snapshots: GunaSnapshot[] = Array.from({ length: 10 }, (_, i) => ({
			state: { sattva: 0.3 + i * 0.05, rajas: 0.35 - i * 0.025, tamas: 0.35 - i * 0.025 },
			timestamp: i * 1000, dominant: "sattva" as const,
		}));
		expect(computeTrendDirection(snapshots, "sattva", 0.05)).toBe("rising");
	});

	it("should detect falling trend", () => {
		const snapshots: GunaSnapshot[] = Array.from({ length: 10 }, (_, i) => ({
			state: { sattva: 0.7 - i * 0.05, rajas: 0.15 + i * 0.025, tamas: 0.15 + i * 0.025 },
			timestamp: i * 1000, dominant: "sattva" as const,
		}));
		expect(computeTrendDirection(snapshots, "sattva", 0.05)).toBe("falling");
	});

	it("should return stable for flat data", () => {
		const snapshots: GunaSnapshot[] = Array.from({ length: 10 }, (_, i) => ({
			state: { sattva: 0.33, rajas: 0.34, tamas: 0.33 },
			timestamp: i * 1000, dominant: "rajas" as const,
		}));
		expect(computeTrendDirection(snapshots, "sattva", 0.05)).toBe("stable");
	});

	it("should return stable with fewer than 2 snapshots", () => {
		expect(computeTrendDirection([], "sattva", 0.05)).toBe("stable");
		expect(computeTrendDirection(
			[{ state: { sattva: 0.5, rajas: 0.25, tamas: 0.25 }, timestamp: 0, dominant: "sattva" }],
			"sattva", 0.05,
		)).toBe("stable");
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Nava Rasa Math
// ═══════════════════════════════════════════════════════════════════════════════

describe("nava-rasa-math — clamp", () => {
	it("should clamp below min", () => {
		expect(clamp(-1, 0, 1)).toBe(0);
	});

	it("should clamp above max", () => {
		expect(clamp(5, 0, 1)).toBe(1);
	});

	it("should pass through values in range", () => {
		expect(clamp(0.5, 0, 1)).toBe(0.5);
	});
});

describe("nava-rasa-math — normalizeToSimplex", () => {
	it("should produce values summing to 1.0", () => {
		const result = normalizeToSimplex([1, 2, 3, 4, 5, 6, 7, 8, 9], 0.01);
		expect(arraySum(result)).toBeCloseTo(1.0, 10);
	});

	it("should enforce floor on negative values", () => {
		const result = normalizeToSimplex([-1, -2, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 0.01);
		for (const v of result) expect(v).toBeGreaterThanOrEqual(0);
		expect(arraySum(result)).toBeCloseTo(1.0, 10);
	});
});

describe("nava-rasa-math — softmax", () => {
	it("should produce equal output for uniform input", () => {
		const result = softmax(new Array(9).fill(0), 1.0);
		const expected = 1 / 9;
		for (const v of result) expect(v).toBeCloseTo(expected, 5);
	});

	it("should concentrate on dominant value", () => {
		const affinities = [10, 0, 0, 0, 0, 0, 0, 0, 0];
		const result = softmax(affinities, 1.0);
		expect(result[0]).toBeGreaterThan(0.9);
		expect(arraySum(result)).toBeCloseTo(1.0, 10);
	});

	it("should flatten distribution with higher temperature", () => {
		const affinities = [5, 0, 0, 0, 0, 0, 0, 0, 0];
		const sharpResult = softmax(affinities, 0.5);
		const flatResult = softmax(affinities, 5.0);
		// Higher temperature → more uniform → first element closer to 1/9
		expect(flatResult[0]).toBeLessThan(sharpResult[0]);
	});
});

describe("nava-rasa-math — observationToRasa", () => {
	it("should produce 9 values summing to 1.0", () => {
		const result = observationToRasa(balancedRasaObs(), 1.0);
		expect(result).toHaveLength(NUM_RASAS);
		expect(arraySum(result)).toBeCloseTo(1.0, 10);
	});

	it("should favor raudra on high security threat with low other signals", () => {
		const result = observationToRasa({
			userSatisfaction: 0, confidence: 0, successRate: 0,
			userStruggling: 0, securityThreat: 1.0, highRiskAction: 0.5,
			codeQualityLow: 0, novelSituation: 0, benignAnomaly: 0, allTasksComplete: 0,
		}, 1.0);
		// raudra is index 3 — should dominate when threat is high and positives are zero
		const raudra = result[3];
		const maxOther = Math.max(...result.filter((_, i) => i !== 3));
		expect(raudra).toBeGreaterThan(maxOther);
	});

	it("should favor shanta on all tasks complete + satisfaction", () => {
		const result = observationToRasa(balancedRasaObs({
			allTasksComplete: 1.0, userSatisfaction: 1.0, successRate: 0.9,
			securityThreat: 0, highRiskAction: 0,
		}), 1.0);
		// shanta is index 8, shringara is index 0 — both should be high
		const shanta = result[8];
		expect(shanta).toBeGreaterThan(0.1);
	});
});

describe("nava-rasa-math — stateToArray / arrayToState", () => {
	const sampleState: RasaState = {
		shringara: 0.2, vira: 0.15, karuna: 0.1, raudra: 0.05,
		bhayanaka: 0.05, bibhatsa: 0.05, adbhuta: 0.1, hasya: 0.1, shanta: 0.2,
	};

	it("should convert state to 9-element array", () => {
		const arr = stateToArray(sampleState);
		expect(arr).toHaveLength(9);
		expect(arr[0]).toBe(0.2);  // shringara
		expect(arr[8]).toBe(0.2);  // shanta
	});

	it("should convert array back to state", () => {
		const arr = stateToArray(sampleState);
		const state = arrayToState(arr);
		expect(state.shringara).toBe(sampleState.shringara);
		expect(state.vira).toBe(sampleState.vira);
		expect(state.shanta).toBe(sampleState.shanta);
	});

	it("should round-trip perfectly", () => {
		const arr = stateToArray(sampleState);
		const restored = arrayToState(arr);
		const arr2 = stateToArray(restored);
		for (let i = 0; i < 9; i++) expect(arr2[i]).toBe(arr[i]);
	});
});

describe("nava-rasa-math — ADAPTATION_TABLE", () => {
	it("should have entries for all 9 rasas", () => {
		const rasas = ["shringara", "vira", "karuna", "raudra", "bhayanaka", "bibhatsa", "adbhuta", "hasya", "shanta"] as const;
		for (const rasa of rasas) {
			expect(ADAPTATION_TABLE[rasa]).toBeDefined();
			expect(ADAPTATION_TABLE[rasa].autonomy).toBeDefined();
			expect(ADAPTATION_TABLE[rasa].verbosity).toBeDefined();
			expect(typeof ADAPTATION_TABLE[rasa].confirmations).toBe("boolean");
		}
	});

	it("should require confirmations for threatening rasas", () => {
		expect(ADAPTATION_TABLE.raudra.confirmations).toBe(true);
		expect(ADAPTATION_TABLE.bhayanaka.confirmations).toBe(true);
		expect(ADAPTATION_TABLE.karuna.confirmations).toBe(true);
	});

	it("should grant full autonomy to vira", () => {
		expect(ADAPTATION_TABLE.vira.autonomy).toBe("full");
	});
});

describe("nava-rasa-math — INFLUENCE_MATRIX", () => {
	it("should have 9 rows (one per rasa)", () => {
		expect(INFLUENCE_MATRIX).toHaveLength(NUM_RASAS);
	});

	it("should have 10 columns per row (one per observation signal)", () => {
		for (const row of INFLUENCE_MATRIX) expect(row).toHaveLength(10);
	});
});

describe("nava-rasa-math — constants", () => {
	it("should export expected constant values", () => {
		expect(NUM_RASAS).toBe(9);
		expect(SYSTEM_MIN_ALPHA).toBe(0.01);
		expect(SYSTEM_MAX_ALPHA).toBe(1.0);
		expect(SYSTEM_MIN_TEMPERATURE).toBe(0.01);
	});
});
