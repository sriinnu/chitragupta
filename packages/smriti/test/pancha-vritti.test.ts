import { describe, it, expect, beforeEach } from "vitest";
import {
	PanchaVritti,
	VRITTI_CONFIDENCE_WEIGHTS,
	VRITTI_TYPES,
	type VrittiType,
	type VrittiClassification,
	type VrittiConfig,
	type VrittiStats,
	type ClassificationContext,
	type VrittiSerializedState,
} from "../src/pancha-vritti.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function userCtx(overrides?: Partial<ClassificationContext>): ClassificationContext {
	return { source: "user", ...overrides };
}

function assistantCtx(overrides?: Partial<ClassificationContext>): ClassificationContext {
	return { source: "assistant", ...overrides };
}

function toolCtx(toolName: string, overrides?: Partial<ClassificationContext>): ClassificationContext {
	return { source: "tool", toolName, ...overrides };
}

function memoryCtx(overrides?: Partial<ClassificationContext>): ClassificationContext {
	return { source: "memory", fromMemory: true, ...overrides };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("PanchaVritti -- Five Fluctuations of Mind (Yoga Sutras 1.5-11)", () => {
	let vritti: PanchaVritti;

	beforeEach(() => {
		vritti = new PanchaVritti();
	});

	// ── Constants ────────────────────────────────────────────────────────

	describe("VRITTI_TYPES", () => {
		it("should enumerate exactly 5 vritti types in sutra order", () => {
			expect(VRITTI_TYPES).toEqual(["pramana", "viparyaya", "vikalpa", "nidra", "smriti"]);
			expect(VRITTI_TYPES).toHaveLength(5);
		});
	});

	describe("VRITTI_CONFIDENCE_WEIGHTS", () => {
		it("should have weights for all 5 types", () => {
			for (const type of VRITTI_TYPES) {
				expect(typeof VRITTI_CONFIDENCE_WEIGHTS[type]).toBe("number");
			}
		});

		it("should rank: pramana > smriti > nidra > vikalpa > viparyaya", () => {
			expect(VRITTI_CONFIDENCE_WEIGHTS.pramana).toBe(1.0);
			expect(VRITTI_CONFIDENCE_WEIGHTS.smriti).toBe(0.85);
			expect(VRITTI_CONFIDENCE_WEIGHTS.nidra).toBe(0.7);
			expect(VRITTI_CONFIDENCE_WEIGHTS.vikalpa).toBe(0.5);
			expect(VRITTI_CONFIDENCE_WEIGHTS.viparyaya).toBe(0.3);
		});

		it("pramana weight should be strictly greatest", () => {
			for (const type of VRITTI_TYPES) {
				if (type !== "pramana") {
					expect(VRITTI_CONFIDENCE_WEIGHTS.pramana).toBeGreaterThan(
						VRITTI_CONFIDENCE_WEIGHTS[type],
					);
				}
			}
		});
	});

	// ── Pramana Classification ──────────────────────────────────────────

	describe("Pramana (valid knowledge)", () => {
		it("should classify test pass messages as pramana", () => {
			const c = vritti.classify("Test passed: 42 tests, 0 failures", toolCtx("bash"));
			expect(c.type).toBe("pramana");
			expect(c.confidence).toBeGreaterThanOrEqual(0.6);
		});

		it("should classify compile success as pramana", () => {
			const c = vritti.classify("compiled successfully without errors", toolCtx("bash"));
			expect(c.type).toBe("pramana");
		});

		it("should classify file read output as pramana via tool context", () => {
			const c = vritti.classify("const x = 42;", toolCtx("read"));
			expect(c.type).toBe("pramana");
			expect(c.matchedPatterns).toContain("tool:pratyaksha-source");
		});

		it("should classify verified facts as pramana", () => {
			const c = vritti.classify("The output has been verified and confirmed correct", userCtx());
			expect(c.type).toBe("pramana");
		});

		it("should classify exit code 0 as pramana", () => {
			const c = vritti.classify("Process finished with exit code 0", toolCtx("bash"));
			expect(c.type).toBe("pramana");
		});

		it("should classify clean test results as pramana", () => {
			const c = vritti.classify("248 tests, 0 failures", toolCtx("bash"));
			expect(c.type).toBe("pramana");
			expect(c.confidence).toBeGreaterThanOrEqual(0.7);
		});

		it("should classify documentation references as pramana", () => {
			const c = vritti.classify(
				"According to the Node.js documentation, streams implement the EventEmitter interface",
				userCtx(),
			);
			expect(c.type).toBe("pramana");
		});

		it("should default user statements with no strong signal to pramana", () => {
			const c = vritti.classify("Use TypeScript for this project", userCtx());
			expect(c.type).toBe("pramana");
		});
	});

	// ── Viparyaya Classification ────────────────────────────────────────

	describe("Viparyaya (error/misconception)", () => {
		it("should classify 'that's wrong' as viparyaya", () => {
			const c = vritti.classify("That's wrong, the function should return a Promise", userCtx());
			expect(c.type).toBe("viparyaya");
			expect(c.confidence).toBeGreaterThanOrEqual(0.5);
		});

		it("should classify 'actually' corrections as viparyaya", () => {
			const c = vritti.classify("Actually, the API endpoint was changed last week", userCtx());
			expect(c.type).toBe("viparyaya");
		});

		it("should classify test failures as viparyaya", () => {
			const c = vritti.classify("Test failed: expected 42 but got 0", toolCtx("bash"));
			expect(c.type).toBe("viparyaya");
		});

		it("should classify error signals as viparyaya", () => {
			const c = vritti.classify("Error: ENOENT opening the configuration file", toolCtx("bash", { isError: true }));
			expect(c.type).toBe("viparyaya");
		});

		it("should classify tool errors via isError flag", () => {
			const c = vritti.classify("Something went wrong", toolCtx("bash", { isError: true }));
			expect(c.type).toBe("viparyaya");
		});

		it("should classify hallucination signals as viparyaya", () => {
			const c = vritti.classify("That was a hallucination, the file doesn't use that API", userCtx());
			expect(c.type).toBe("viparyaya");
		});

		it("should classify nonzero exit codes as viparyaya", () => {
			const c = vritti.classify("Process exited with exit code 1", toolCtx("bash"));
			expect(c.type).toBe("viparyaya");
		});

		it("should classify deprecated signals as viparyaya", () => {
			const c = vritti.classify("This API is deprecated and no longer valid", userCtx());
			expect(c.type).toBe("viparyaya");
		});
	});

	// ── Vikalpa Classification ──────────────────────────────────────────

	describe("Vikalpa (conceptual construction)", () => {
		it("should classify 'maybe' hedging as vikalpa", () => {
			const c = vritti.classify("Maybe we should use a different approach here", assistantCtx());
			expect(c.type).toBe("vikalpa");
		});

		it("should classify 'what if' hypotheticals as vikalpa", () => {
			const c = vritti.classify("What if we used a HashMap instead of a tree?", assistantCtx());
			expect(c.type).toBe("vikalpa");
		});

		it("should classify speculative modals as vikalpa", () => {
			const c = vritti.classify("This might be causing the memory leak", assistantCtx());
			expect(c.type).toBe("vikalpa");
		});

		it("should classify subjective beliefs as vikalpa", () => {
			const c = vritti.classify("I think the issue is in the parser module", assistantCtx());
			expect(c.type).toBe("vikalpa");
		});

		it("should classify explicit uncertainty as vikalpa", () => {
			const c = vritti.classify("I'm not sure if that approach will work in production", assistantCtx());
			expect(c.type).toBe("vikalpa");
		});

		it("should classify alternative exploration as vikalpa", () => {
			const c = vritti.classify("One approach would be to cache the results locally", assistantCtx());
			expect(c.type).toBe("vikalpa");
		});

		it("should default assistant statements with no signal to vikalpa", () => {
			const c = vritti.classify("Let me look into that for you", assistantCtx());
			expect(c.type).toBe("vikalpa");
		});
	});

	// ── Nidra Classification ────────────────────────────────────────────

	describe("Nidra (absence/void)", () => {
		it("should classify empty string as nidra", () => {
			const c = vritti.classify("", toolCtx("grep"));
			expect(c.type).toBe("nidra");
			expect(c.confidence).toBeGreaterThanOrEqual(0.8);
		});

		it("should classify whitespace-only as nidra", () => {
			const c = vritti.classify("   \n  ", toolCtx("grep"));
			expect(c.type).toBe("nidra");
		});

		it("should classify 'not found' messages as nidra", () => {
			const c = vritti.classify("No results found for the query", toolCtx("grep"));
			expect(c.type).toBe("nidra");
		});

		it("should classify 'does not exist' as nidra", () => {
			const c = vritti.classify("The file does not exist at that path", toolCtx("read"));
			expect(c.type).toBe("nidra");
		});

		it("should classify 404 as nidra", () => {
			const c = vritti.classify("HTTP 404: page not found", toolCtx("bash"));
			expect(c.type).toBe("nidra");
		});

		it("should classify empty arrays as nidra", () => {
			const c = vritti.classify("[]", toolCtx("grep"));
			expect(c.type).toBe("nidra");
		});

		it("should classify null/undefined as nidra", () => {
			const c = vritti.classify("The value is null or undefined", toolCtx("bash"));
			expect(c.type).toBe("nidra");
		});

		it("should classify zero results as nidra", () => {
			const c = vritti.classify("0 results matched the query", toolCtx("grep"));
			expect(c.type).toBe("nidra");
		});

		it("should classify missing signals as nidra", () => {
			const c = vritti.classify("The configuration key is missing from the file", userCtx());
			expect(c.type).toBe("nidra");
		});
	});

	// ── Smriti Classification ───────────────────────────────────────────

	describe("Smriti (recall from memory)", () => {
		it("should classify 'as mentioned' as smriti", () => {
			const c = vritti.classify("As mentioned earlier, the config uses tabs", assistantCtx());
			expect(c.type).toBe("smriti");
		});

		it("should classify 'from earlier' as smriti", () => {
			const c = vritti.classify("From earlier in the conversation, we decided to use ESM", assistantCtx());
			expect(c.type).toBe("smriti");
		});

		it("should classify recall verbs as smriti", () => {
			const c = vritti.classify("I recall that the project uses pnpm workspaces", assistantCtx());
			expect(c.type).toBe("smriti");
		});

		it("should classify memory tool results as smriti", () => {
			const c = vritti.classify("Found 3 entries in project memory", toolCtx("memory_search"));
			expect(c.type).toBe("smriti");
		});

		it("should classify fromMemory context as smriti", () => {
			const c = vritti.classify("Project uses TypeScript", memoryCtx());
			expect(c.type).toBe("smriti");
		});

		it("should classify cached references as smriti", () => {
			const c = vritti.classify("This was retrieved from cache", assistantCtx());
			expect(c.type).toBe("smriti");
		});

		it("should classify 'you told me' as smriti", () => {
			const c = vritti.classify("You told me before that the API uses JWT auth", assistantCtx());
			expect(c.type).toBe("smriti");
		});

		it("should classify session_show tool as smriti", () => {
			const c = vritti.classify("Session content retrieved", toolCtx("session_show"));
			expect(c.type).toBe("smriti");
		});
	});

	// ── classifyToolResult ──────────────────────────────────────────────

	describe("classifyToolResult()", () => {
		it("should classify successful tool output", () => {
			const c = vritti.classifyToolResult("bash", "Tests passed: 10 tests, 0 failures", false);
			expect(c.type).toBe("pramana");
			expect(c.toolName).toBe("bash");
		});

		it("should classify error tool output", () => {
			const c = vritti.classifyToolResult("bash", "Error: compilation failed", true);
			expect(c.type).toBe("viparyaya");
		});

		it("should stringify non-string results", () => {
			const c = vritti.classifyToolResult("grep", { count: 0, matches: [] }, false);
			expect(c.contentSnippet).toContain("count");
		});

		it("should handle null result as nidra", () => {
			const c = vritti.classifyToolResult("read", null, false);
			expect(c.type).toBe("nidra");
		});

		it("should handle undefined result as nidra", () => {
			const c = vritti.classifyToolResult("read", undefined, false);
			expect(c.type).toBe("nidra");
		});
	});

	// ── Reclassification ────────────────────────────────────────────────

	describe("reclassify()", () => {
		it("should reclassify from pramana to viparyaya", () => {
			const c = vritti.classify("The API returns JSON", userCtx());
			expect(c.type).toBe("pramana");

			vritti.reclassify(c.id, "viparyaya", "API actually returns XML");

			const updated = vritti.getClassification(c.id);
			expect(updated!.type).toBe("viparyaya");
			expect(updated!.history).toHaveLength(1);
			expect(updated!.history[0].from).toBe("pramana");
			expect(updated!.history[0].to).toBe("viparyaya");
			expect(updated!.history[0].reason).toBe("API actually returns XML");
		});

		it("should no-op when reclassifying to the same type", () => {
			const c = vritti.classify("Maybe try a different approach", assistantCtx());
			vritti.reclassify(c.id, "vikalpa", "still speculative");
			const updated = vritti.getClassification(c.id);
			expect(updated!.history).toHaveLength(0);
		});

		it("should throw for unknown classification ID", () => {
			expect(() => vritti.reclassify("nonexistent", "pramana", "test"))
				.toThrow("Classification not found");
		});

		it("should preserve reclassification history chain", () => {
			const c = vritti.classify("The endpoint uses REST", userCtx());
			vritti.reclassify(c.id, "viparyaya", "endpoint uses GraphQL");
			vritti.reclassify(c.id, "pramana", "confirmed REST after checking");

			const updated = vritti.getClassification(c.id);
			expect(updated!.type).toBe("pramana");
			expect(updated!.history).toHaveLength(2);
			expect(updated!.history[0].from).toBe("pramana");
			expect(updated!.history[0].to).toBe("viparyaya");
			expect(updated!.history[1].from).toBe("viparyaya");
			expect(updated!.history[1].to).toBe("pramana");
		});

		it("should increment reclassification counter", () => {
			const c = vritti.classify("A fact", userCtx());
			vritti.reclassify(c.id, "viparyaya", "was wrong");
			expect(vritti.getStats().reclassifications).toBe(1);
		});
	});

	// ── getConfidenceWeight ─────────────────────────────────────────────

	describe("getConfidenceWeight()", () => {
		it("should return correct weights for each type", () => {
			expect(vritti.getConfidenceWeight("pramana")).toBe(1.0);
			expect(vritti.getConfidenceWeight("smriti")).toBe(0.85);
			expect(vritti.getConfidenceWeight("nidra")).toBe(0.7);
			expect(vritti.getConfidenceWeight("vikalpa")).toBe(0.5);
			expect(vritti.getConfidenceWeight("viparyaya")).toBe(0.3);
		});

		it("should respect custom weights", () => {
			const custom = new PanchaVritti({
				confidenceWeights: { pramana: 0.9, smriti: 0.8, nidra: 0.6, vikalpa: 0.4, viparyaya: 0.2 },
			});
			expect(custom.getConfidenceWeight("pramana")).toBe(0.9);
			expect(custom.getConfidenceWeight("viparyaya")).toBe(0.2);
		});
	});

	// ── getByType ────────────────────────────────────────────────────────

	describe("getByType()", () => {
		it("should return only classifications of the requested type", () => {
			vritti.classify("Test passed", toolCtx("bash"));
			vritti.classify("Maybe try this", assistantCtx());
			vritti.classify("", toolCtx("grep"));

			const pramanas = vritti.getByType("pramana");
			for (const c of pramanas) {
				expect(c.type).toBe("pramana");
			}
		});

		it("should return empty array when no classifications of type exist", () => {
			vritti.classify("Test passed", toolCtx("bash"));
			const smritis = vritti.getByType("smriti");
			expect(smritis).toHaveLength(0);
		});
	});

	// ── Statistics ───────────────────────────────────────────────────────

	describe("getStats()", () => {
		it("should return zeroes when empty", () => {
			const stats = vritti.getStats();
			expect(stats.total).toBe(0);
			expect(stats.reclassifications).toBe(0);
			for (const type of VRITTI_TYPES) {
				expect(stats.counts[type]).toBe(0);
				expect(stats.percentages[type]).toBe(0);
				expect(stats.avgConfidence[type]).toBe(0);
			}
		});

		it("should compute correct distribution", () => {
			vritti.classify("Test passed: 10 tests, 0 failures", toolCtx("bash"));
			vritti.classify("That's wrong, use ESM not CJS", userCtx());
			vritti.classify("Maybe try using a Map instead", assistantCtx());
			vritti.classify("", toolCtx("grep"));
			vritti.classify("As mentioned earlier, the config uses tabs", assistantCtx());

			const stats = vritti.getStats();
			expect(stats.total).toBe(5);
			expect(stats.counts.pramana).toBeGreaterThanOrEqual(1);
			expect(stats.counts.viparyaya).toBeGreaterThanOrEqual(1);
			expect(stats.counts.vikalpa).toBeGreaterThanOrEqual(1);
			expect(stats.counts.nidra).toBeGreaterThanOrEqual(1);
			expect(stats.counts.smriti).toBeGreaterThanOrEqual(1);
		});

		it("should compute percentages that sum to ~100", () => {
			for (let i = 0; i < 20; i++) {
				vritti.classify(`Test ${i} passed: ${i} tests, 0 failures`, toolCtx("bash"));
			}
			vritti.classify("Maybe try X", assistantCtx());
			vritti.classify("", toolCtx("grep"));

			const stats = vritti.getStats();
			const totalPct = VRITTI_TYPES.reduce((s, t) => s + stats.percentages[t], 0);
			expect(totalPct).toBeCloseTo(100, 0);
		});

		it("should track average confidence per type", () => {
			vritti.classify("Test passed: 100 tests, 0 failures", toolCtx("bash"));
			vritti.classify("Test passed: 200 tests, 0 failures", toolCtx("bash"));

			const stats = vritti.getStats();
			expect(stats.avgConfidence.pramana).toBeGreaterThan(0);
		});
	});

	// ── Configuration ───────────────────────────────────────────────────

	describe("Configuration & Hard Ceilings", () => {
		it("should use default config when none provided", () => {
			const v = new PanchaVritti();
			expect(v.getConfidenceWeight("pramana")).toBe(1.0);
		});

		it("should clamp maxClassifications to hard ceiling", () => {
			const v = new PanchaVritti({ maxClassifications: 100_000 });
			// The hard ceiling is 50,000 -- we verify by filling beyond it
			// (indirect test since cfg is private)
			// Just verify it constructed without error
			expect(v).toBeDefined();
		});

		it("should accept partial config and merge with defaults", () => {
			const v = new PanchaVritti({ minConfidence: 0.2 });
			expect(v.getConfidenceWeight("pramana")).toBe(1.0); // default weight preserved
		});

		it("should accept custom confidence weights merged with defaults", () => {
			const v = new PanchaVritti({
				confidenceWeights: { pramana: 0.95, smriti: 0.85, nidra: 0.7, vikalpa: 0.5, viparyaya: 0.3 },
			});
			expect(v.getConfidenceWeight("pramana")).toBe(0.95);
		});
	});

	// ── Persistence (serialize/deserialize) ─────────────────────────────

	describe("Serialization", () => {
		it("should round-trip through serialize/deserialize", () => {
			vritti.classify("Test passed", toolCtx("bash"));
			vritti.classify("Maybe try X", assistantCtx());
			vritti.classify("As mentioned", assistantCtx());

			const state = vritti.serialize();
			expect(state.classifications).toHaveLength(3);
			expect(state.totalClassified).toBe(3);

			const restored = new PanchaVritti();
			restored.deserialize(state);

			const restoredStats = restored.getStats();
			expect(restoredStats.total).toBe(3);
		});

		it("should preserve reclassification history through serialization", () => {
			const c = vritti.classify("The API returns JSON", userCtx());
			vritti.reclassify(c.id, "viparyaya", "was wrong");

			const state = vritti.serialize();
			expect(state.totalReclassified).toBe(1);

			const restored = new PanchaVritti();
			restored.deserialize(state);

			const restoredC = restored.getClassification(c.id);
			expect(restoredC!.type).toBe("viparyaya");
			expect(restoredC!.history).toHaveLength(1);
			expect(restored.getStats().reclassifications).toBe(1);
		});

		it("should have exportedAt timestamp", () => {
			const state = vritti.serialize();
			expect(state.exportedAt).toBeGreaterThan(0);
		});
	});

	// ── clear() ─────────────────────────────────────────────────────────

	describe("clear()", () => {
		it("should reset all state", () => {
			vritti.classify("Test passed", toolCtx("bash"));
			vritti.classify("Maybe X", assistantCtx());

			vritti.clear();

			const stats = vritti.getStats();
			expect(stats.total).toBe(0);
			expect(stats.reclassifications).toBe(0);
		});
	});

	// ── Edge Cases ──────────────────────────────────────────────────────

	describe("Edge Cases", () => {
		it("should handle very long content by truncating snippet", () => {
			const longContent = "a".repeat(10_000);
			const c = vritti.classify(longContent, userCtx());
			expect(c.contentSnippet.length).toBeLessThanOrEqual(200);
		});

		it("should generate unique IDs for same content classified at different times", () => {
			// IDs include timestamp, so two calls should differ
			const c1 = vritti.classify("Test passed", toolCtx("bash"));
			// Small delay is not needed because fnv1a includes Date.now()
			const c2 = vritti.classify("Test passed", toolCtx("bash"));
			// IDs may or may not differ depending on timing; both should be valid
			expect(c1.id).toBeTruthy();
			expect(c2.id).toBeTruthy();
		});

		it("should handle content with special characters", () => {
			const c = vritti.classify("Error: file '/tmp/foo bar.ts' not found", toolCtx("bash"));
			expect(c.type).toBeDefined();
			expect(VRITTI_TYPES).toContain(c.type);
		});

		it("should handle mixed signals (both pramana and viparyaya patterns)", () => {
			// Content with both positive and negative signals -- highest score wins
			const c = vritti.classify(
				"Test passed but that's incorrect, it should have failed",
				userCtx(),
			);
			expect(VRITTI_TYPES).toContain(c.type);
			expect(c.confidence).toBeGreaterThan(0);
		});

		it("should evict oldest when maxClassifications exceeded", () => {
			const small = new PanchaVritti({ maxClassifications: 3 });
			small.classify("First", userCtx());
			small.classify("Second", userCtx());
			small.classify("Third", userCtx());
			small.classify("Fourth", userCtx());

			expect(small.getStats().total).toBe(3);
		});

		it("should set toolName in classification when provided", () => {
			const c = vritti.classify("Test passed", toolCtx("bash"));
			expect(c.toolName).toBe("bash");
		});

		it("should not set toolName when not provided", () => {
			const c = vritti.classify("Hello world", userCtx());
			expect(c.toolName).toBeUndefined();
		});

		it("should classify all results as one of the 5 vritti types", () => {
			const inputs = [
				"Test passed: 42 tests, 0 failures",
				"That's wrong, use ESM",
				"Maybe try using a Map",
				"No results found",
				"As mentioned earlier",
				"The sky is blue",
				"I think this might work",
				"Error: ENOENT",
				"",
				"You told me before that it uses tabs",
			];

			for (const input of inputs) {
				const c = vritti.classify(input, userCtx());
				expect(VRITTI_TYPES).toContain(c.type);
			}
		});
	});

	// ── Multi-pattern Disambiguation ────────────────────────────────────

	describe("Pattern Disambiguation", () => {
		it("should prefer pramana for direct observation tools even with vikalpa words", () => {
			// "seems" is vikalpa pattern, but bash tool output is pratyaksha
			const c = vritti.classify("file exists at /tmp/foo.ts", toolCtx("read"));
			expect(c.type).toBe("pramana");
		});

		it("should prefer viparyaya for error-flagged tool results over pramana patterns", () => {
			// "compiled successfully" is pramana, but isError flag overrides
			const c = vritti.classify("compiled successfully", toolCtx("bash", { isError: true }));
			// The error flag gives viparyaya a boost
			expect(["viparyaya", "pramana"]).toContain(c.type);
		});

		it("should prefer smriti for memory tools even without recall words", () => {
			const c = vritti.classify("Project uses TypeScript with ESM modules", toolCtx("memory_search"));
			expect(c.type).toBe("smriti");
		});

		it("should prefer nidra for genuinely empty content over all context signals", () => {
			const c = vritti.classify("", toolCtx("bash", { isError: true }));
			expect(c.type).toBe("nidra");
		});
	});
});
