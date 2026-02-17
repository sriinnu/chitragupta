import { describe, it, expect } from "vitest";
import {
	cosineSimilarity,
	tokenize,
	textMatchScore,
	ALPHA,
	BETA,
	GAMMA,
	STOP_WORDS,
} from "../src/graphrag-scoring.js";

// ─── Constants ───────────────────────────────────────────────────────────────

describe("Scoring constants", () => {
	it("should have weights summing to 1", () => {
		expect(ALPHA + BETA + GAMMA).toBeCloseTo(1.0, 5);
	});

	it("should have ALPHA as the largest weight (cosine similarity)", () => {
		expect(ALPHA).toBeGreaterThan(BETA);
		expect(ALPHA).toBeGreaterThan(GAMMA);
	});
});

// ─── cosineSimilarity ────────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
	it("should return 1 for identical vectors", () => {
		const v = [1, 2, 3, 4, 5];
		expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
	});

	it("should return 0 for orthogonal vectors", () => {
		const a = [1, 0, 0];
		const b = [0, 1, 0];
		expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
	});

	it("should return -1 for opposite vectors", () => {
		const a = [1, 2, 3];
		const b = [-1, -2, -3];
		expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
	});

	it("should return 0 for vectors of different lengths", () => {
		expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
	});

	it("should return 0 for zero vectors", () => {
		expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
		expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
		expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
	});

	it("should be scale-invariant", () => {
		const a = [1, 2, 3];
		const b = [2, 4, 6]; // 2x scale of a
		expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
	});

	it("should handle single-element vectors", () => {
		expect(cosineSimilarity([5], [3])).toBeCloseTo(1.0, 5);
		expect(cosineSimilarity([5], [-3])).toBeCloseTo(-1.0, 5);
	});

	it("should return 0 for empty vectors", () => {
		expect(cosineSimilarity([], [])).toBe(0);
	});

	it("should be symmetric: cos(a,b) = cos(b,a)", () => {
		const a = [1, 3, 5, 7];
		const b = [2, 4, 6, 8];
		expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
	});

	it("should return a value in [-1, 1] range for arbitrary vectors", () => {
		const a = [0.3, -0.7, 0.1, 0.9];
		const b = [-0.2, 0.5, 0.8, -0.4];
		const sim = cosineSimilarity(a, b);
		expect(sim).toBeGreaterThanOrEqual(-1);
		expect(sim).toBeLessThanOrEqual(1);
	});
});

// ─── tokenize ────────────────────────────────────────────────────────────────

describe("tokenize", () => {
	it("should lowercase all tokens", () => {
		const tokens = tokenize("Hello World TypeScript");
		expect(tokens).toContain("hello");
		expect(tokens).toContain("world");
		expect(tokens).toContain("typescript");
	});

	it("should remove stop words", () => {
		const tokens = tokenize("the quick brown fox is a test");
		expect(tokens).not.toContain("the");
		expect(tokens).not.toContain("is");
		expect(tokens).not.toContain("a");
		expect(tokens).toContain("quick");
		expect(tokens).toContain("brown");
		expect(tokens).toContain("fox");
	});

	it("should filter out single-character tokens", () => {
		const tokens = tokenize("I a x go");
		expect(tokens).not.toContain("i");
		expect(tokens).not.toContain("x");
		expect(tokens).toContain("go");
	});

	it("should replace non-alphanumeric characters with spaces", () => {
		const tokens = tokenize("hello-world foo_bar baz.qux");
		expect(tokens).toContain("hello");
		expect(tokens).toContain("world");
		expect(tokens).toContain("foo");
		expect(tokens).toContain("bar");
		expect(tokens).toContain("baz");
		expect(tokens).toContain("qux");
	});

	it("should return empty array for empty string", () => {
		expect(tokenize("")).toEqual([]);
	});

	it("should return empty array for string with only stop words", () => {
		expect(tokenize("the a an is")).toEqual([]);
	});

	it("should handle numeric tokens", () => {
		const tokens = tokenize("version 42 release 2024");
		expect(tokens).toContain("version");
		expect(tokens).toContain("42");
		expect(tokens).toContain("release");
		expect(tokens).toContain("2024");
	});
});

// ─── textMatchScore ──────────────────────────────────────────────────────────

describe("textMatchScore", () => {
	it("should return 0 for empty query", () => {
		expect(textMatchScore("", "some document text")).toBe(0);
	});

	it("should return 0 for empty document", () => {
		expect(textMatchScore("some query", "")).toBe(0);
	});

	it("should return 0 when no terms match", () => {
		expect(textMatchScore("apple banana", "orange grape melon")).toBe(0);
	});

	it("should return positive score when terms match", () => {
		const score = textMatchScore("typescript react", "typescript react project setup");
		expect(score).toBeGreaterThan(0);
	});

	it("should return higher score for full coverage than partial", () => {
		const fullMatch = textMatchScore("typescript react", "typescript react project");
		const partialMatch = textMatchScore("typescript react", "typescript project golang");
		expect(fullMatch).toBeGreaterThan(partialMatch);
	});

	it("should clamp score to maximum 1", () => {
		const score = textMatchScore("test", "test test test test test test test test test");
		expect(score).toBeLessThanOrEqual(1);
	});

	it("should return higher score for higher term frequency", () => {
		const lowTf = textMatchScore("typescript", "typescript is great");
		const highTf = textMatchScore("typescript", "typescript typescript typescript typescript");
		expect(highTf).toBeGreaterThanOrEqual(lowTf);
	});

	it("should be case-insensitive", () => {
		const lower = textMatchScore("typescript", "typescript project");
		const upper = textMatchScore("TypeScript", "TYPESCRIPT PROJECT");
		expect(lower).toBeCloseTo(upper, 5);
	});

	it("should ignore stop words in scoring", () => {
		// Both queries contain stop words that should be filtered
		const score = textMatchScore("the typescript project", "typescript project code");
		expect(score).toBeGreaterThan(0);
	});

	it("should return a value in [0, 1]", () => {
		const score = textMatchScore("graphrag pagerank algorithm", "graphrag uses pagerank for scoring");
		expect(score).toBeGreaterThanOrEqual(0);
		expect(score).toBeLessThanOrEqual(1);
	});
});

// ─── STOP_WORDS ──────────────────────────────────────────────────────────────

describe("STOP_WORDS", () => {
	it("should contain common English stop words", () => {
		expect(STOP_WORDS.has("the")).toBe(true);
		expect(STOP_WORDS.has("and")).toBe(true);
		expect(STOP_WORDS.has("is")).toBe(true);
		expect(STOP_WORDS.has("not")).toBe(true);
	});

	it("should not contain technical terms", () => {
		expect(STOP_WORDS.has("typescript")).toBe(false);
		expect(STOP_WORDS.has("react")).toBe(false);
		expect(STOP_WORDS.has("function")).toBe(false);
	});
});
