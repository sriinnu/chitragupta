import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "../src/recall-scoring.js";

describe("cosineSimilarity", () => {
	it("should return 1 for identical vectors", () => {
		const v = [1, 2, 3, 4, 5];
		expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
	});

	it("should return -1 for opposite vectors", () => {
		const a = [1, 0, 0];
		const b = [-1, 0, 0];
		expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
	});

	it("should return 0 for orthogonal vectors", () => {
		const a = [1, 0, 0];
		const b = [0, 1, 0];
		expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
	});

	it("should return 0 for empty vectors", () => {
		expect(cosineSimilarity([], [])).toBe(0);
	});

	it("should return 0 for mismatched length vectors", () => {
		const a = [1, 2, 3];
		const b = [1, 2];
		expect(cosineSimilarity(a, b)).toBe(0);
	});

	it("should return 0 for zero vectors", () => {
		const a = [0, 0, 0];
		const b = [1, 2, 3];
		expect(cosineSimilarity(a, b)).toBe(0);
	});

	it("should compute correct similarity for known vectors", () => {
		const a = [1, 2, 3];
		const b = [4, 5, 6];
		// dot = 4 + 10 + 18 = 32
		// |a| = sqrt(14), |b| = sqrt(77)
		// cos = 32 / (sqrt(14) * sqrt(77))
		const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
		expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 5);
	});

	it("should handle negative components", () => {
		const a = [1, -1, 1];
		const b = [-1, 1, -1];
		// dot = -1 -1 -1 = -3
		// |a| = sqrt(3), |b| = sqrt(3)
		// cos = -3/3 = -1
		expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
	});

	it("should return a value between -1 and 1 for random vectors", () => {
		const a = [0.5, 0.3, -0.2, 0.8, 0.1];
		const b = [0.1, -0.4, 0.6, 0.2, -0.9];
		const result = cosineSimilarity(a, b);
		expect(result).toBeGreaterThanOrEqual(-1);
		expect(result).toBeLessThanOrEqual(1);
	});

	it("should be symmetric: sim(a,b) === sim(b,a)", () => {
		const a = [3, 7, 2, 5];
		const b = [1, 4, 8, 3];
		expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
	});
});
