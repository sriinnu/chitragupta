/**
 * @chitragupta/anina — Buddhi (Decision Framework) Tests.
 *
 * Tests the Nyaya syllogism-based decision logging framework: recording
 * decisions, outcome tracking, persistence roundtrip, pattern analysis,
 * listing/filtering, and human-readable explanation generation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAgentSchema } from "@chitragupta/smriti/db/schema";
import { Buddhi } from "../src/buddhi.js";
import type {
	NyayaReasoning,
	Decision,
	DecisionCategory,
	RecordDecisionParams,
	Alternative,
	DecisionOutcome,
} from "../src/buddhi.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

let tmpDir: string;
let dbm: DatabaseManager;

function freshDb(): DatabaseManager {
	DatabaseManager.reset();
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "buddhi-test-"));
	dbm = DatabaseManager.instance(tmpDir);
	initAgentSchema(dbm);
	return dbm;
}

/** Create a valid NyayaReasoning for testing. */
function validReasoning(overrides?: Partial<NyayaReasoning>): NyayaReasoning {
	return {
		thesis: "We should use grep for searching.",
		reason: "Grep is faster than manual file traversal for pattern matching.",
		example: "In general, specialized search tools outperform generic traversal. E.g., ripgrep processes 10GB/s.",
		application: "This codebase has 500+ files; grep will find matches in <100ms.",
		conclusion: "Therefore, we should use grep for searching this codebase.",
		...overrides,
	};
}

/** Create valid record-decision params for testing. */
function validParams(overrides?: Partial<RecordDecisionParams>): RecordDecisionParams {
	return {
		sessionId: "sess-1",
		project: "/test/project",
		category: "tool-selection",
		description: "Use grep for code search",
		reasoning: validReasoning(),
		confidence: 0.85,
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Buddhi — Decision Framework", () => {
	beforeEach(() => {
		freshDb();
	});

	afterEach(() => {
		DatabaseManager.reset();
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ── 1. Decision Recording ───────────────────────────────────────────

	describe("recordDecision()", () => {
		it("should record a decision and return it with generated id and timestamp", () => {
			const buddhi = new Buddhi();
			const before = Date.now();
			const decision = buddhi.recordDecision(validParams(), dbm);

			expect(decision.id).toBeTruthy();
			expect(decision.id.startsWith("bud-")).toBe(true);
			expect(decision.timestamp).toBeGreaterThanOrEqual(before);
			expect(decision.timestamp).toBeLessThanOrEqual(Date.now());
			expect(decision.sessionId).toBe("sess-1");
			expect(decision.project).toBe("/test/project");
			expect(decision.category).toBe("tool-selection");
			expect(decision.description).toBe("Use grep for code search");
			expect(decision.confidence).toBe(0.85);
			expect(decision.alternatives).toEqual([]);
			expect(decision.outcome).toBeUndefined();
			expect(decision.metadata).toEqual({});
		});

		it("should record a decision with alternatives", () => {
			const buddhi = new Buddhi();
			const alts: Alternative[] = [
				{ description: "Use find + cat", reason_rejected: "Too slow for large codebases" },
				{ description: "Use IDE search", reason_rejected: "Not available in CLI context" },
			];
			const decision = buddhi.recordDecision(
				validParams({ alternatives: alts }),
				dbm,
			);

			expect(decision.alternatives.length).toBe(2);
			expect(decision.alternatives[0].description).toBe("Use find + cat");
			expect(decision.alternatives[1].reason_rejected).toBe("Not available in CLI context");
		});

		it("should record a decision with metadata", () => {
			const buddhi = new Buddhi();
			const meta = { fileCount: 523, toolVersion: "1.2.0" };
			const decision = buddhi.recordDecision(
				validParams({ metadata: meta }),
				dbm,
			);

			expect(decision.metadata).toEqual(meta);
		});

		it("should generate unique IDs for different decisions", () => {
			const buddhi = new Buddhi();
			const d1 = buddhi.recordDecision(
				validParams({ description: "Decision one" }),
				dbm,
			);
			const d2 = buddhi.recordDecision(
				validParams({ description: "Decision two" }),
				dbm,
			);

			expect(d1.id).not.toBe(d2.id);
		});

		it("should record decisions for all valid categories", () => {
			const buddhi = new Buddhi();
			const categories: DecisionCategory[] = [
				"architecture",
				"tool-selection",
				"model-routing",
				"error-recovery",
				"refactoring",
				"security",
			];

			for (const cat of categories) {
				const decision = buddhi.recordDecision(
					validParams({ category: cat, description: `Decision: ${cat}` }),
					dbm,
				);
				expect(decision.category).toBe(cat);
			}
		});

		it("should throw for invalid category", () => {
			const buddhi = new Buddhi();
			expect(() =>
				buddhi.recordDecision(
					validParams({ category: "invalid" as DecisionCategory }),
					dbm,
				),
			).toThrow("Invalid decision category");
		});

		it("should throw for confidence < 0", () => {
			const buddhi = new Buddhi();
			expect(() =>
				buddhi.recordDecision(validParams({ confidence: -0.1 }), dbm),
			).toThrow("Confidence must be in [0, 1]");
		});

		it("should throw for confidence > 1", () => {
			const buddhi = new Buddhi();
			expect(() =>
				buddhi.recordDecision(validParams({ confidence: 1.5 }), dbm),
			).toThrow("Confidence must be in [0, 1]");
		});

		it("should accept boundary confidence values 0 and 1", () => {
			const buddhi = new Buddhi();
			const d0 = buddhi.recordDecision(validParams({ confidence: 0, description: "low" }), dbm);
			const d1 = buddhi.recordDecision(validParams({ confidence: 1, description: "high" }), dbm);
			expect(d0.confidence).toBe(0);
			expect(d1.confidence).toBe(1);
		});

		it("should preserve full Nyaya reasoning", () => {
			const buddhi = new Buddhi();
			const reasoning = validReasoning();
			const decision = buddhi.recordDecision(
				validParams({ reasoning }),
				dbm,
			);

			expect(decision.reasoning.thesis).toBe(reasoning.thesis);
			expect(decision.reasoning.reason).toBe(reasoning.reason);
			expect(decision.reasoning.example).toBe(reasoning.example);
			expect(decision.reasoning.application).toBe(reasoning.application);
			expect(decision.reasoning.conclusion).toBe(reasoning.conclusion);
		});
	});

	// ── 2. Nyaya Reasoning Validation ───────────────────────────────────

	describe("Nyaya reasoning validation", () => {
		it("should throw when thesis is empty", () => {
			const buddhi = new Buddhi();
			expect(() =>
				buddhi.recordDecision(
					validParams({ reasoning: validReasoning({ thesis: "" }) }),
					dbm,
				),
			).toThrow("Nyaya reasoning incomplete: missing Pratijña (thesis)");
		});

		it("should throw when reason is empty", () => {
			const buddhi = new Buddhi();
			expect(() =>
				buddhi.recordDecision(
					validParams({ reasoning: validReasoning({ reason: "" }) }),
					dbm,
				),
			).toThrow("Nyaya reasoning incomplete: missing Hetu (reason)");
		});

		it("should throw when example is empty", () => {
			const buddhi = new Buddhi();
			expect(() =>
				buddhi.recordDecision(
					validParams({ reasoning: validReasoning({ example: "" }) }),
					dbm,
				),
			).toThrow("Nyaya reasoning incomplete: missing Udaharana (example)");
		});

		it("should throw when application is empty", () => {
			const buddhi = new Buddhi();
			expect(() =>
				buddhi.recordDecision(
					validParams({ reasoning: validReasoning({ application: "" }) }),
					dbm,
				),
			).toThrow("Nyaya reasoning incomplete: missing Upanaya (application)");
		});

		it("should throw when conclusion is empty", () => {
			const buddhi = new Buddhi();
			expect(() =>
				buddhi.recordDecision(
					validParams({ reasoning: validReasoning({ conclusion: "" }) }),
					dbm,
				),
			).toThrow("Nyaya reasoning incomplete: missing Nigamana (conclusion)");
		});

		it("should throw when a reasoning field is whitespace-only", () => {
			const buddhi = new Buddhi();
			expect(() =>
				buddhi.recordDecision(
					validParams({ reasoning: validReasoning({ thesis: "   \t\n  " }) }),
					dbm,
				),
			).toThrow("Nyaya reasoning incomplete: missing Pratijña (thesis)");
		});
	});

	// ── 3. Outcome Tracking ─────────────────────────────────────────────

	describe("recordOutcome()", () => {
		it("should record a successful outcome", () => {
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision(validParams(), dbm);

			const outcome: DecisionOutcome = {
				success: true,
				feedback: "Grep found the pattern in 12ms.",
				timestamp: Date.now(),
			};

			buddhi.recordOutcome(decision.id, outcome, dbm);

			const loaded = buddhi.getDecision(decision.id, dbm);
			expect(loaded).not.toBeNull();
			expect(loaded!.outcome).toBeDefined();
			expect(loaded!.outcome!.success).toBe(true);
			expect(loaded!.outcome!.feedback).toBe("Grep found the pattern in 12ms.");
		});

		it("should record a failure outcome", () => {
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision(validParams(), dbm);

			const outcome: DecisionOutcome = {
				success: false,
				feedback: "Pattern was too complex for grep.",
				timestamp: Date.now(),
			};

			buddhi.recordOutcome(decision.id, outcome, dbm);

			const loaded = buddhi.getDecision(decision.id, dbm);
			expect(loaded!.outcome!.success).toBe(false);
		});

		it("should record an outcome without feedback", () => {
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision(validParams(), dbm);

			const outcome: DecisionOutcome = {
				success: true,
				timestamp: Date.now(),
			};

			buddhi.recordOutcome(decision.id, outcome, dbm);

			const loaded = buddhi.getDecision(decision.id, dbm);
			expect(loaded!.outcome!.success).toBe(true);
			expect(loaded!.outcome!.feedback).toBeUndefined();
		});

		it("should throw when recording outcome for non-existent decision", () => {
			const buddhi = new Buddhi();
			const outcome: DecisionOutcome = {
				success: true,
				timestamp: Date.now(),
			};

			expect(() =>
				buddhi.recordOutcome("nonexistent-id", outcome, dbm),
			).toThrow("Decision not found: nonexistent-id");
		});

		it("should overwrite a previous outcome", () => {
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision(validParams(), dbm);

			buddhi.recordOutcome(decision.id, {
				success: false,
				feedback: "Failed initially",
				timestamp: Date.now(),
			}, dbm);

			buddhi.recordOutcome(decision.id, {
				success: true,
				feedback: "Succeeded on retry",
				timestamp: Date.now(),
			}, dbm);

			const loaded = buddhi.getDecision(decision.id, dbm);
			expect(loaded!.outcome!.success).toBe(true);
			expect(loaded!.outcome!.feedback).toBe("Succeeded on retry");
		});
	});

	// ── 4. Persistence Roundtrip ────────────────────────────────────────

	describe("persistence roundtrip", () => {
		it("should persist and reload a decision via getDecision()", () => {
			const buddhi = new Buddhi();
			const alts: Alternative[] = [
				{ description: "Alternative A", reason_rejected: "Too slow" },
			];
			const meta = { key: "value", count: 42 };
			const decision = buddhi.recordDecision(
				validParams({ alternatives: alts, metadata: meta }),
				dbm,
			);

			// Clear caches and re-create to force DB read
			buddhi.clearCache();
			DatabaseManager.reset();
			dbm = DatabaseManager.instance(tmpDir);

			const buddhi2 = new Buddhi();
			const loaded = buddhi2.getDecision(decision.id, dbm);

			expect(loaded).not.toBeNull();
			expect(loaded!.id).toBe(decision.id);
			expect(loaded!.sessionId).toBe("sess-1");
			expect(loaded!.project).toBe("/test/project");
			expect(loaded!.category).toBe("tool-selection");
			expect(loaded!.description).toBe("Use grep for code search");
			expect(loaded!.confidence).toBe(0.85);
			expect(loaded!.reasoning.thesis).toBe(decision.reasoning.thesis);
			expect(loaded!.reasoning.reason).toBe(decision.reasoning.reason);
			expect(loaded!.reasoning.example).toBe(decision.reasoning.example);
			expect(loaded!.reasoning.application).toBe(decision.reasoning.application);
			expect(loaded!.reasoning.conclusion).toBe(decision.reasoning.conclusion);
			expect(loaded!.alternatives).toEqual(alts);
			expect(loaded!.metadata).toEqual(meta);
			expect(loaded!.outcome).toBeUndefined();
		});

		it("should persist and reload a decision with outcome", () => {
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision(validParams(), dbm);
			const ts = Date.now();

			buddhi.recordOutcome(decision.id, {
				success: true,
				feedback: "Worked perfectly",
				timestamp: ts,
			}, dbm);

			// Force fresh DB read
			buddhi.clearCache();
			DatabaseManager.reset();
			dbm = DatabaseManager.instance(tmpDir);

			const buddhi2 = new Buddhi();
			const loaded = buddhi2.getDecision(decision.id, dbm);

			expect(loaded!.outcome).toBeDefined();
			expect(loaded!.outcome!.success).toBe(true);
			expect(loaded!.outcome!.feedback).toBe("Worked perfectly");
			expect(loaded!.outcome!.timestamp).toBe(ts);
		});

		it("should return null for non-existent decision", () => {
			const buddhi = new Buddhi();
			const loaded = buddhi.getDecision("bud-nonexistent", dbm);
			expect(loaded).toBeNull();
		});

		it("should handle empty alternatives in roundtrip", () => {
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision(validParams(), dbm);

			buddhi.clearCache();
			DatabaseManager.reset();
			dbm = DatabaseManager.instance(tmpDir);

			const buddhi2 = new Buddhi();
			const loaded = buddhi2.getDecision(decision.id, dbm);
			expect(loaded!.alternatives).toEqual([]);
		});

		it("should handle empty metadata in roundtrip", () => {
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision(validParams(), dbm);

			buddhi.clearCache();
			DatabaseManager.reset();
			dbm = DatabaseManager.instance(tmpDir);

			const buddhi2 = new Buddhi();
			const loaded = buddhi2.getDecision(decision.id, dbm);
			expect(loaded!.metadata).toEqual({});
		});
	});

	// ── 5. Listing and Filtering ────────────────────────────────────────

	describe("listDecisions()", () => {
		it("should list all decisions when no filter applied", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams({ description: "D1" }), dbm);
			buddhi.recordDecision(validParams({ description: "D2" }), dbm);
			buddhi.recordDecision(validParams({ description: "D3" }), dbm);

			const list = buddhi.listDecisions({}, dbm);
			expect(list.length).toBe(3);
		});

		it("should filter by project", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams({ project: "/proj-a", description: "A" }), dbm);
			buddhi.recordDecision(validParams({ project: "/proj-b", description: "B" }), dbm);
			buddhi.recordDecision(validParams({ project: "/proj-a", description: "A2" }), dbm);

			const list = buddhi.listDecisions({ project: "/proj-a" }, dbm);
			expect(list.length).toBe(2);
			expect(list.every(d => d.project === "/proj-a")).toBe(true);
		});

		it("should filter by category", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams({ category: "architecture", description: "Arch" }), dbm);
			buddhi.recordDecision(validParams({ category: "security", description: "Sec" }), dbm);
			buddhi.recordDecision(validParams({ category: "architecture", description: "Arch2" }), dbm);

			const list = buddhi.listDecisions({ category: "architecture" }, dbm);
			expect(list.length).toBe(2);
			expect(list.every(d => d.category === "architecture")).toBe(true);
		});

		it("should filter by date range", () => {
			const buddhi = new Buddhi();
			const now = Date.now();

			buddhi.recordDecision(validParams({ description: "D1" }), dbm);

			const list = buddhi.listDecisions({
				fromDate: now - 1000,
				toDate: now + 5000,
			}, dbm);
			expect(list.length).toBe(1);
		});

		it("should respect limit parameter", () => {
			const buddhi = new Buddhi();
			for (let i = 0; i < 10; i++) {
				buddhi.recordDecision(validParams({ description: `D${i}` }), dbm);
			}

			const list = buddhi.listDecisions({ limit: 3 }, dbm);
			expect(list.length).toBe(3);
		});

		it("should return results ordered by newest first", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams({ description: "First" }), dbm);
			buddhi.recordDecision(validParams({ description: "Second" }), dbm);
			buddhi.recordDecision(validParams({ description: "Third" }), dbm);

			const list = buddhi.listDecisions({}, dbm);
			// Newest first
			for (let i = 0; i < list.length - 1; i++) {
				expect(list[i].timestamp).toBeGreaterThanOrEqual(list[i + 1].timestamp);
			}
		});

		it("should combine multiple filters", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams({
				project: "/proj-a",
				category: "architecture",
				description: "Match",
			}), dbm);
			buddhi.recordDecision(validParams({
				project: "/proj-a",
				category: "security",
				description: "NoMatch-Cat",
			}), dbm);
			buddhi.recordDecision(validParams({
				project: "/proj-b",
				category: "architecture",
				description: "NoMatch-Proj",
			}), dbm);

			const list = buddhi.listDecisions({
				project: "/proj-a",
				category: "architecture",
			}, dbm);
			expect(list.length).toBe(1);
			expect(list[0].description).toBe("Match");
		});

		it("should return empty array when no decisions match", () => {
			const buddhi = new Buddhi();
			const list = buddhi.listDecisions({ project: "/nonexistent" }, dbm);
			expect(list).toEqual([]);
		});

		it("should default limit to 100", () => {
			const buddhi = new Buddhi();
			// Record only 3 — verify we get 3 (not capped)
			for (let i = 0; i < 3; i++) {
				buddhi.recordDecision(validParams({ description: `D${i}` }), dbm);
			}

			const list = buddhi.listDecisions({}, dbm);
			expect(list.length).toBe(3);
		});
	});

	// ── 6. Explain Decision ─────────────────────────────────────────────

	describe("explainDecision()", () => {
		it("should generate human-readable explanation with Nyaya format", () => {
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision(validParams(), dbm);

			const explanation = buddhi.explainDecision(decision.id, dbm);
			expect(explanation).not.toBeNull();
			expect(explanation).toContain("Decision: Use grep for code search");
			expect(explanation).toContain("Category: tool-selection");
			expect(explanation).toContain("Confidence: 85%");
			expect(explanation).toContain("Pratijña (Thesis):");
			expect(explanation).toContain("Hetu (Reason):");
			expect(explanation).toContain("Udaharana (Example):");
			expect(explanation).toContain("Upanaya (Application):");
			expect(explanation).toContain("Nigamana (Conclusion):");
		});

		it("should include alternatives in explanation", () => {
			const buddhi = new Buddhi();
			const alts: Alternative[] = [
				{ description: "Use find", reason_rejected: "Too slow" },
			];
			const decision = buddhi.recordDecision(
				validParams({ alternatives: alts }),
				dbm,
			);

			const explanation = buddhi.explainDecision(decision.id, dbm)!;
			expect(explanation).toContain("Alternatives considered: 1");
			expect(explanation).toContain("Use find: Too slow");
		});

		it("should show pending outcome when no outcome recorded", () => {
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision(validParams(), dbm);

			const explanation = buddhi.explainDecision(decision.id, dbm)!;
			expect(explanation).toContain("Outcome: Pending");
		});

		it("should show success outcome", () => {
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision(validParams(), dbm);
			buddhi.recordOutcome(decision.id, {
				success: true,
				feedback: "Worked great",
				timestamp: Date.now(),
			}, dbm);

			const explanation = buddhi.explainDecision(decision.id, dbm)!;
			expect(explanation).toContain("Outcome: Success");
			expect(explanation).toContain("Feedback: Worked great");
		});

		it("should show failure outcome", () => {
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision(validParams(), dbm);
			buddhi.recordOutcome(decision.id, {
				success: false,
				feedback: "Pattern not found",
				timestamp: Date.now(),
			}, dbm);

			const explanation = buddhi.explainDecision(decision.id, dbm)!;
			expect(explanation).toContain("Outcome: Failure");
			expect(explanation).toContain("Feedback: Pattern not found");
		});

		it("should return null for non-existent decision", () => {
			const buddhi = new Buddhi();
			const explanation = buddhi.explainDecision("bud-nonexistent", dbm);
			expect(explanation).toBeNull();
		});

		it("should not include alternatives section when none exist", () => {
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision(validParams(), dbm);

			const explanation = buddhi.explainDecision(decision.id, dbm)!;
			expect(explanation).not.toContain("Alternatives considered:");
		});

		it("should include the actual reasoning text", () => {
			const buddhi = new Buddhi();
			const reasoning = validReasoning();
			const decision = buddhi.recordDecision(
				validParams({ reasoning }),
				dbm,
			);

			const explanation = buddhi.explainDecision(decision.id, dbm)!;
			expect(explanation).toContain(reasoning.thesis);
			expect(explanation).toContain(reasoning.reason);
			expect(explanation).toContain(reasoning.example);
			expect(explanation).toContain(reasoning.application);
			expect(explanation).toContain(reasoning.conclusion);
		});
	});

	// ── 7. Decision Patterns ────────────────────────────────────────────

	describe("getDecisionPatterns()", () => {
		it("should group decisions by category", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams({ category: "tool-selection", description: "T1" }), dbm);
			buddhi.recordDecision(validParams({ category: "tool-selection", description: "T2" }), dbm);
			buddhi.recordDecision(validParams({ category: "architecture", description: "A1" }), dbm);

			const patterns = buddhi.getDecisionPatterns("/test/project", dbm);
			expect(patterns.length).toBe(2);

			const toolPattern = patterns.find(p => p.category === "tool-selection");
			expect(toolPattern).toBeDefined();
			expect(toolPattern!.count).toBe(2);

			const archPattern = patterns.find(p => p.category === "architecture");
			expect(archPattern).toBeDefined();
			expect(archPattern!.count).toBe(1);
		});

		it("should compute average confidence", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams({
				category: "architecture",
				description: "A1",
				confidence: 0.8,
			}), dbm);
			buddhi.recordDecision(validParams({
				category: "architecture",
				description: "A2",
				confidence: 0.6,
			}), dbm);

			const patterns = buddhi.getDecisionPatterns("/test/project", dbm);
			const archPattern = patterns.find(p => p.category === "architecture");
			expect(archPattern!.avgConfidence).toBeCloseTo(0.7, 1);
		});

		it("should compute success rate from outcomes", () => {
			const buddhi = new Buddhi();
			const d1 = buddhi.recordDecision(validParams({ category: "security", description: "S1" }), dbm);
			const d2 = buddhi.recordDecision(validParams({ category: "security", description: "S2" }), dbm);
			const d3 = buddhi.recordDecision(validParams({ category: "security", description: "S3" }), dbm);

			buddhi.recordOutcome(d1.id, { success: true, timestamp: Date.now() }, dbm);
			buddhi.recordOutcome(d2.id, { success: true, timestamp: Date.now() }, dbm);
			buddhi.recordOutcome(d3.id, { success: false, timestamp: Date.now() }, dbm);

			const patterns = buddhi.getDecisionPatterns("/test/project", dbm);
			const secPattern = patterns.find(p => p.category === "security");
			expect(secPattern!.successRate).toBeCloseTo(0.667, 1);
		});

		it("should return 0 success rate when no outcomes recorded", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams({ description: "NoOutcome" }), dbm);

			const patterns = buddhi.getDecisionPatterns("/test/project", dbm);
			expect(patterns[0].successRate).toBe(0);
		});

		it("should sort by count descending", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams({ category: "security", description: "S1" }), dbm);
			buddhi.recordDecision(validParams({ category: "architecture", description: "A1" }), dbm);
			buddhi.recordDecision(validParams({ category: "architecture", description: "A2" }), dbm);
			buddhi.recordDecision(validParams({ category: "architecture", description: "A3" }), dbm);

			const patterns = buddhi.getDecisionPatterns("/test/project", dbm);
			expect(patterns[0].category).toBe("architecture");
			expect(patterns[0].count).toBe(3);
			expect(patterns[1].category).toBe("security");
			expect(patterns[1].count).toBe(1);
		});

		it("should scope patterns to the given project", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams({ project: "/proj-a", description: "A" }), dbm);
			buddhi.recordDecision(validParams({ project: "/proj-b", description: "B" }), dbm);

			const patternsA = buddhi.getDecisionPatterns("/proj-a", dbm);
			const patternsB = buddhi.getDecisionPatterns("/proj-b", dbm);

			expect(patternsA.length).toBe(1);
			expect(patternsB.length).toBe(1);
		});

		it("should return empty array when no decisions for project", () => {
			const buddhi = new Buddhi();
			const patterns = buddhi.getDecisionPatterns("/nonexistent", dbm);
			expect(patterns).toEqual([]);
		});

		it("should include representative description", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams({
				category: "tool-selection",
				description: "Use grep for search",
			}), dbm);

			const patterns = buddhi.getDecisionPatterns("/test/project", dbm);
			expect(patterns[0].representative).toBeTruthy();
		});
	});

	// ── 8. Success Rate ─────────────────────────────────────────────────

	describe("getSuccessRate()", () => {
		it("should compute success rate across all projects", () => {
			const buddhi = new Buddhi();
			const d1 = buddhi.recordDecision(validParams({
				project: "/proj-a",
				description: "D1",
			}), dbm);
			const d2 = buddhi.recordDecision(validParams({
				project: "/proj-b",
				description: "D2",
			}), dbm);

			buddhi.recordOutcome(d1.id, { success: true, timestamp: Date.now() }, dbm);
			buddhi.recordOutcome(d2.id, { success: false, timestamp: Date.now() }, dbm);

			const rate = buddhi.getSuccessRate("tool-selection", dbm);
			expect(rate).toBe(0.5);
		});

		it("should return 0 when no outcomes recorded", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams({ description: "NoOutcome" }), dbm);

			const rate = buddhi.getSuccessRate("tool-selection", dbm);
			expect(rate).toBe(0);
		});

		it("should return 0 when no decisions exist for category", () => {
			const buddhi = new Buddhi();
			const rate = buddhi.getSuccessRate("security", dbm);
			expect(rate).toBe(0);
		});

		it("should return 1 when all outcomes are successful", () => {
			const buddhi = new Buddhi();
			const d1 = buddhi.recordDecision(validParams({ description: "D1" }), dbm);
			const d2 = buddhi.recordDecision(validParams({ description: "D2" }), dbm);

			buddhi.recordOutcome(d1.id, { success: true, timestamp: Date.now() }, dbm);
			buddhi.recordOutcome(d2.id, { success: true, timestamp: Date.now() }, dbm);

			const rate = buddhi.getSuccessRate("tool-selection", dbm);
			expect(rate).toBe(1);
		});

		it("should only consider decisions with outcomes", () => {
			const buddhi = new Buddhi();
			const d1 = buddhi.recordDecision(validParams({ description: "WithOutcome" }), dbm);
			buddhi.recordDecision(validParams({ description: "NoOutcome" }), dbm);

			buddhi.recordOutcome(d1.id, { success: true, timestamp: Date.now() }, dbm);

			const rate = buddhi.getSuccessRate("tool-selection", dbm);
			// Only 1 with outcome, and it succeeded
			expect(rate).toBe(1);
		});
	});

	// ── 9. Schema Initialization ────────────────────────────────────────

	describe("schema initialization", () => {
		it("should auto-create the decisions table on first operation", () => {
			const buddhi = new Buddhi();
			// The table should be created on first recordDecision
			const decision = buddhi.recordDecision(validParams(), dbm);
			expect(decision).toBeTruthy();

			// Verify directly in SQLite
			const row = dbm.get("agent")
				.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='decisions'")
				.get() as { name: string } | undefined;
			expect(row).toBeDefined();
			expect(row!.name).toBe("decisions");
		});

		it("should create indices on project and category", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams(), dbm);

			const indices = dbm.get("agent")
				.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='decisions'")
				.all() as Array<{ name: string }>;

			const indexNames = indices.map(i => i.name);
			expect(indexNames).toContain("idx_decisions_project");
			expect(indexNames).toContain("idx_decisions_category");
		});

		it("should be idempotent — safe to initialize multiple times", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams({ description: "First" }), dbm);
			buddhi.clearCache();
			// Second initialization should not throw or corrupt data
			buddhi.recordDecision(validParams({ description: "Second" }), dbm);

			const list = buddhi.listDecisions({}, dbm);
			expect(list.length).toBe(2);
		});
	});

	// ── 10. clearCache() ────────────────────────────────────────────────

	describe("clearCache()", () => {
		it("should clear statement cache and allow re-initialization", () => {
			const buddhi = new Buddhi();
			buddhi.recordDecision(validParams(), dbm);
			buddhi.clearCache();

			// After clearing, need fresh DB connection
			DatabaseManager.reset();
			dbm = DatabaseManager.instance(tmpDir);

			// Should work fine after clearing cache
			const list = buddhi.listDecisions({}, dbm);
			expect(list.length).toBe(1);
		});
	});

	// ── 11. Edge Cases ──────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should handle special characters in description", () => {
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision(
				validParams({ description: "Fix SQL 'injection' with \"quotes\" & <brackets>" }),
				dbm,
			);

			const loaded = buddhi.getDecision(decision.id, dbm);
			expect(loaded!.description).toBe("Fix SQL 'injection' with \"quotes\" & <brackets>");
		});

		it("should handle unicode in reasoning", () => {
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision(
				validParams({
					reasoning: validReasoning({
						thesis: "We should implement बुद्धि framework.",
						conclusion: "Therefore, बुद्धि is the right choice.",
					}),
				}),
				dbm,
			);

			const loaded = buddhi.getDecision(decision.id, dbm);
			expect(loaded!.reasoning.thesis).toContain("बुद्धि");
			expect(loaded!.reasoning.conclusion).toContain("बुद्धि");
		});

		it("should handle many decisions without performance degradation", () => {
			const buddhi = new Buddhi();
			const t0 = performance.now();

			for (let i = 0; i < 100; i++) {
				buddhi.recordDecision(
					validParams({ description: `Decision #${i}` }),
					dbm,
				);
			}

			const elapsed = performance.now() - t0;
			// 100 inserts should complete in under 5 seconds even on slow CI
			expect(elapsed).toBeLessThan(5000);

			const list = buddhi.listDecisions({ limit: 100 }, dbm);
			expect(list.length).toBe(100);
		});

		it("should handle complex nested metadata", () => {
			const buddhi = new Buddhi();
			const meta = {
				files: ["a.ts", "b.ts"],
				metrics: { linesChanged: 42, coverage: 0.95 },
				nested: { deep: { value: true } },
			};

			const decision = buddhi.recordDecision(
				validParams({ metadata: meta }),
				dbm,
			);

			const loaded = buddhi.getDecision(decision.id, dbm);
			expect(loaded!.metadata).toEqual(meta);
		});

		it("should handle many alternatives", () => {
			const buddhi = new Buddhi();
			const alts: Alternative[] = Array.from({ length: 10 }, (_, i) => ({
				description: `Alt ${i}`,
				reason_rejected: `Reason ${i}`,
			}));

			const decision = buddhi.recordDecision(
				validParams({ alternatives: alts }),
				dbm,
			);

			const loaded = buddhi.getDecision(decision.id, dbm);
			expect(loaded!.alternatives.length).toBe(10);
		});
	});
});
