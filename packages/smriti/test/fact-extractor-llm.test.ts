/**
 * Tests for fact-extractor-llm.ts — LLM fallback for low-confidence sentences.
 */

import { describe, it, expect, vi } from "vitest";
import { extractFactsWithFallback } from "../src/fact-extractor-llm.js";
import type { FactExtractorLLMProvider } from "../src/fact-extractor-llm.js";
import type { ExtractedFact } from "../src/fact-extractor.js";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeFact(
	category: ExtractedFact["category"],
	fact: string,
	confidence: number,
	method: "pattern" | "vector" = "pattern",
): ExtractedFact {
	return { category, fact, source: fact, confidence, method };
}

function makeLLMProvider(
	results: Array<{ value: string; type: string; confidence: number }>,
): FactExtractorLLMProvider {
	return {
		extractFacts: vi.fn().mockResolvedValue(results),
	};
}

// ─── extractFactsWithFallback ─────────────────────────────────────────────────

describe("extractFactsWithFallback", () => {
	describe("no LLM provider", () => {
		it("returns existingFacts unchanged when no llm is provided", async () => {
			const facts = [makeFact("identity", "Name: Alice", 0.9)];
			const result = await extractFactsWithFallback("my name is Alice", facts);
			expect(result).toBe(facts); // same reference
		});

		it("returns empty array unchanged", async () => {
			const result = await extractFactsWithFallback("hello world", []);
			expect(result).toEqual([]);
		});
	});

	describe("with LLM provider — no low confidence sentences", () => {
		it("skips LLM when all sentences have high-confidence facts", async () => {
			const llm = makeLLMProvider([]);
			// source must appear in the raw sentence for isLowConfidence to find a match
			const facts: ExtractedFact[] = [{
				category: "location", fact: "Lives in Vienna",
				source: "live in Vienna", // substring of the sentence
				confidence: 0.9, method: "pattern",
			}];
			const result = await extractFactsWithFallback("I live in Vienna.", facts, llm);
			expect((llm.extractFacts as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
			expect(result).toEqual(facts);
		});
	});

	describe("with LLM provider — low confidence sentences", () => {
		it("calls LLM for sentences with low-confidence facts", async () => {
			const llm = makeLLMProvider([
				{ value: "Berlin", type: "location", confidence: 0.8 },
			]);
			const facts = [makeFact("location", "Lives in somewhere", 0.3)]; // low conf
			const result = await extractFactsWithFallback(
				"I relocated to Berlin recently.",
				facts,
				llm,
				0.6,
			);
			expect((llm.extractFacts as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
			// Result should include the LLM fact
			const llmFact = result.find((f) => f.fact === "Berlin");
			expect(llmFact).toBeDefined();
			expect(llmFact!.confidence).toBeLessThan(0.95); // trust discount applied
		});

		it("applies 0.9 LLM trust discount to confidence", async () => {
			const llm = makeLLMProvider([
				{ value: "Paris", type: "location", confidence: 1.0 },
			]);
			const result = await extractFactsWithFallback(
				"Je vis à Paris maintenant.",
				[makeFact("personal", "something", 0.2)],
				llm,
			);
			const paris = result.find((f) => f.fact === "Paris");
			expect(paris?.confidence).toBe(0.9); // 1.0 * 0.9 = 0.9, capped at 0.95
		});

		it("caps LLM confidence at 0.95", async () => {
			const llm = makeLLMProvider([
				{ value: "high-conf fact", type: "instruction", confidence: 1.0 },
			]);
			const result = await extractFactsWithFallback(
				"Always remember this important rule.",
				[makeFact("personal", "low", 0.1)],
				llm,
			);
			const fact = result.find((f) => f.fact === "high-conf fact");
			expect(fact?.confidence).toBeLessThanOrEqual(0.95);
		});

		it("filters out LLM results with zero confidence", async () => {
			const llm = makeLLMProvider([
				{ value: "", type: "personal", confidence: 0.0 },
				{ value: "valid", type: "identity", confidence: 0.7 },
			]);
			const result = await extractFactsWithFallback(
				"Some sentence without matching facts here.",
				[],
				llm,
			);
			expect(result.find((f) => f.fact === "valid")).toBeDefined();
			// Empty value should be filtered
			expect(result.find((f) => f.fact === "")).toBeUndefined();
		});
	});

	describe("type mapping", () => {
		const cases: Array<[string, ExtractedFact["category"]]> = [
			["identity", "identity"],
			["name", "identity"],
			["person", "identity"],
			["location", "location"],
			["place", "location"],
			["city", "location"],
			["work", "work"],
			["job", "work"],
			["company", "work"],
			["preference", "preference"],
			["tool", "preference"],
			["tech", "preference"],
			["relationship", "relationship"],
			["colleague", "relationship"],
			["friend", "relationship"],
			["instruction", "instruction"],
			["rule", "instruction"],
			["always", "instruction"],
			["unknown-type", "personal"],
		];

		for (const [type, expectedCategory] of cases) {
			it(`maps type "${type}" → category "${expectedCategory}"`, async () => {
				const llm = makeLLMProvider([{ value: "test value", type, confidence: 0.7 }]);
				const result = await extractFactsWithFallback(
					"Some text without matching facts present here.",
					[],
					llm,
				);
				const fact = result.find((f) => f.fact === "test value");
				expect(fact?.category).toBe(expectedCategory);
			});
		}
	});

	describe("deduplication", () => {
		it("keeps existing fact when LLM returns a near-duplicate (Jaccard > 0.8)", async () => {
			const existing = [makeFact("identity", "Name Alice Smith", 0.9)];
			const llm = makeLLMProvider([
				{ value: "Name Alice Smith", type: "identity", confidence: 0.95 },
			]);
			const result = await extractFactsWithFallback(
				"Some new sentence with low-confidence match.",
				existing,
				llm,
			);
			const alices = result.filter((f) => f.fact === "Name Alice Smith");
			expect(alices.length).toBe(1); // deduped
		});

		it("upgrades confidence when LLM has higher score for same fact", async () => {
			const existing = [makeFact("identity", "Name Alice Smith", 0.5)];
			const llm = makeLLMProvider([
				{ value: "Name Alice Smith", type: "identity", confidence: 0.9 },
			]);
			const result = await extractFactsWithFallback(
				"Some new sentence with low-confidence match.",
				existing,
				llm,
			);
			const alice = result.find((f) => f.fact === "Name Alice Smith");
			// LLM 0.9 * 0.9 discount = 0.81, which is > 0.5, so it should be upgraded
			expect(alice!.confidence).toBeGreaterThan(0.5);
		});

		it("keeps distinct facts when Jaccard similarity is below threshold", async () => {
			const existing = [makeFact("identity", "Name Alice Smith", 0.9)];
			const llm = makeLLMProvider([
				{ value: "Bob Johnson developer", type: "work", confidence: 0.8 },
			]);
			const result = await extractFactsWithFallback(
				"Bob Johnson is a developer in our team here.",
				existing,
				llm,
			);
			expect(result.length).toBe(2); // both kept
		});
	});

	describe("LLM failure handling", () => {
		it("returns existingFacts unchanged when LLM throws", async () => {
			const llm: FactExtractorLLMProvider = {
				extractFacts: vi.fn().mockRejectedValue(new Error("LLM timeout")),
			};
			const facts = [makeFact("identity", "Name: Alice", 0.9)];
			// Force a low-conf sentence so LLM would be called
			const lowFacts = [makeFact("personal", "something", 0.1)];
			const result = await extractFactsWithFallback(
				"Some sentence with no matching facts here.",
				lowFacts,
				llm,
			);
			expect(result).toEqual(lowFacts);
		});
	});
});
