import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	cosineSimilarity,
	getEmbedding,
	configureRecallScoring,
	summarizeSession,
	extractIndexText,
	resetOllamaAvailability,
} from "../src/recall-scoring.js";
import type { Session } from "../src/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		meta: {
			id: "sess-1",
			title: "Test Session Title",
			created: "2026-01-01T00:00:00Z",
			updated: "2026-01-01T01:00:00Z",
			agent: "chitragupta",
			model: "claude-3",
			project: "/tmp/project",
			parent: null,
			branch: null,
			tags: ["typescript", "testing"],
			totalCost: 0.05,
			totalTokens: 500,
			...overrides.meta,
		},
		turns: overrides.turns ?? [],
	};
}

function makeTurn(
	turnNumber: number,
	role: "user" | "assistant",
	content: string,
	toolCalls?: Array<{ name: string; input: string; result: string; isError?: boolean }>,
) {
	return { turnNumber, role: role as "user" | "assistant", content, toolCalls };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("recall-scoring.ts", () => {
	describe("cosineSimilarity", () => {
		it("should return 1.0 for identical vectors", () => {
			const v = [1, 2, 3, 4, 5];
			expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
		});

		it("should return 0.0 for orthogonal vectors", () => {
			const a = [1, 0, 0];
			const b = [0, 1, 0];
			expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
		});

		it("should return -1.0 for opposite vectors", () => {
			const a = [1, 0, 0];
			const b = [-1, 0, 0];
			expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
		});

		it("should return 0 for different length vectors", () => {
			expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
		});

		it("should return 0 for empty vectors", () => {
			expect(cosineSimilarity([], [])).toBe(0);
		});

		it("should return 0 for zero vectors", () => {
			expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
		});

		it("should compute correctly for known vectors [1,2,3] vs [4,5,6]", () => {
			// dot = 4+10+18 = 32
			// |a| = sqrt(1+4+9) = sqrt(14)
			// |b| = sqrt(16+25+36) = sqrt(77)
			// cos = 32 / (sqrt(14) * sqrt(77))
			const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
			expect(cosineSimilarity([1, 2, 3], [4, 5, 6])).toBeCloseTo(expected, 5);
		});

		it("should handle single-element vectors", () => {
			expect(cosineSimilarity([5], [3])).toBeCloseTo(1.0, 5);
			expect(cosineSimilarity([5], [-3])).toBeCloseTo(-1.0, 5);
		});
	});

	describe("getEmbedding", () => {
		let originalFetch: typeof globalThis.fetch;

		beforeEach(() => {
			originalFetch = globalThis.fetch;
			resetOllamaAvailability();
			// Point to an invalid endpoint so Ollama check fails
			configureRecallScoring({ ollamaEndpoint: "http://localhost:99999" });
		});

		afterEach(() => {
			globalThis.fetch = originalFetch;
			resetOllamaAvailability();
			configureRecallScoring({ ollamaEndpoint: "http://localhost:11434" });
		});

		it("should return a 384-dim vector on fallback", async () => {
			globalThis.fetch = vi.fn().mockRejectedValue(new Error("no connection"));
			const vec = await getEmbedding("hello world");
			expect(vec).toHaveLength(384);
		});

		it("should produce deterministic fallback vectors (same text = same vector)", async () => {
			globalThis.fetch = vi.fn().mockRejectedValue(new Error("no connection"));
			const v1 = await getEmbedding("test input");
			resetOllamaAvailability();
			const v2 = await getEmbedding("test input");
			expect(v1).toEqual(v2);
		});

		it("should produce normalized fallback vectors (magnitude ~1)", async () => {
			globalThis.fetch = vi.fn().mockRejectedValue(new Error("no connection"));
			const vec = await getEmbedding("some meaningful text content");
			const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
			expect(magnitude).toBeCloseTo(1.0, 3);
		});

		it("should produce different fallback vectors for different texts", async () => {
			globalThis.fetch = vi.fn().mockRejectedValue(new Error("no connection"));
			const v1 = await getEmbedding("typescript programming");
			resetOllamaAvailability();
			const v2 = await getEmbedding("chocolate cake recipe");
			// They should NOT be identical
			const identical = v1.every((val, idx) => val === v2[idx]);
			expect(identical).toBe(false);
		});
	});

	describe("configureRecallScoring", () => {
		afterEach(() => {
			resetOllamaAvailability();
			configureRecallScoring({ ollamaEndpoint: "http://localhost:11434" });
		});

		it("should not throw when called with valid options", () => {
			expect(() => configureRecallScoring({
				ollamaEndpoint: "http://custom:9999",
				embeddingModel: "mxbai-embed-large",
			})).not.toThrow();
		});

		it("should accept empty options", () => {
			expect(() => configureRecallScoring({})).not.toThrow();
		});
	});

	describe("summarizeSession", () => {
		it("should return user turn content joined by ' | '", () => {
			const session = makeSession({
				turns: [
					makeTurn(1, "user", "First question"),
					makeTurn(2, "assistant", "First answer"),
					makeTurn(3, "user", "Second question"),
				],
			});
			const summary = summarizeSession(session);
			expect(summary).toContain("First question");
			expect(summary).toContain("Second question");
			expect(summary).toContain(" | ");
		});

		it("should skip assistant turns", () => {
			const session = makeSession({
				turns: [
					makeTurn(1, "assistant", "I am an assistant response only"),
				],
			});
			const summary = summarizeSession(session);
			expect(summary).toBe("");
		});

		it("should truncate individual turns to 200 chars", () => {
			const longContent = "A".repeat(300);
			const session = makeSession({
				turns: [makeTurn(1, "user", longContent)],
			});
			const summary = summarizeSession(session);
			expect(summary.length).toBeLessThanOrEqual(200);
		});

		it("should cap total at 500 chars", () => {
			const turns = Array.from({ length: 10 }, (_, i) =>
				makeTurn(i + 1, "user", "A".repeat(190)),
			);
			const session = makeSession({ turns });
			const summary = summarizeSession(session);
			expect(summary.length).toBeLessThanOrEqual(500);
		});

		it("should return empty string for a session with no turns", () => {
			const session = makeSession({ turns: [] });
			const summary = summarizeSession(session);
			expect(summary).toBe("");
		});
	});

	describe("extractIndexText", () => {
		it("should include title twice", () => {
			const session = makeSession({ turns: [] });
			const text = extractIndexText(session);
			// Title appears twice in the output
			const firstIdx = text.indexOf("Test Session Title");
			const secondIdx = text.indexOf("Test Session Title", firstIdx + 1);
			expect(firstIdx).toBeGreaterThanOrEqual(0);
			expect(secondIdx).toBeGreaterThan(firstIdx);
		});

		it("should include tags", () => {
			const session = makeSession({ turns: [] });
			const text = extractIndexText(session);
			expect(text).toContain("typescript");
			expect(text).toContain("testing");
		});

		it("should include turn content", () => {
			const session = makeSession({
				turns: [
					makeTurn(1, "user", "Hello there"),
					makeTurn(2, "assistant", "Hi back"),
				],
			});
			const text = extractIndexText(session);
			expect(text).toContain("Hello there");
			expect(text).toContain("Hi back");
		});

		it("should truncate individual turn content to 1000 chars", () => {
			const longContent = "W".repeat(2000);
			const session = makeSession({
				turns: [makeTurn(1, "user", longContent)],
			});
			const text = extractIndexText(session);
			// The text should not contain the full 2000 chars of W
			const wCount = (text.match(/W/g) || []).length;
			expect(wCount).toBeLessThanOrEqual(1000);
		});

		it("should include tool call names and inputs", () => {
			const session = makeSession({
				turns: [
					makeTurn(1, "assistant", "Running tools", [
						{ name: "read_file", input: "/src/index.ts", result: "content" },
						{ name: "search", input: "query string", result: "results" },
					]),
				],
			});
			const text = extractIndexText(session);
			expect(text).toContain("read_file");
			expect(text).toContain("search");
			expect(text).toContain("/src/index.ts");
			expect(text).toContain("query string");
		});

		it("should cap total at 8000 chars", () => {
			const turns = Array.from({ length: 20 }, (_, i) =>
				makeTurn(i + 1, "user", "X".repeat(999)),
			);
			const session = makeSession({ turns });
			const text = extractIndexText(session);
			expect(text.length).toBeLessThanOrEqual(8000);
		});
	});

	describe("resetOllamaAvailability", () => {
		it("should not throw", () => {
			expect(() => resetOllamaAvailability()).not.toThrow();
		});
	});
});
