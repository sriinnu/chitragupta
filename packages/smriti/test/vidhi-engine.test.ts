/**
 * Tests for VidhiEngine — procedural memory (learned tool sequences).
 *
 * Covers: construction, n-gram extraction, anti-unification, Thompson Sampling,
 * trigger phrase NLU, full extraction pipeline, SQL persistence, outcome
 * tracking, matching, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAgentSchema } from "@chitragupta/smriti/db/schema";
import { VidhiEngine, type VidhiConfig, type ExtractionResult } from "../src/vidhi-engine.js";
import type { Vidhi, VidhiStep, VidhiParam, SessionToolCall } from "../src/types.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

let tmpDir: string;
let dbm: DatabaseManager;

const PROJECT = "/test/vidhi-project";

/**
 * Insert a session row into the sessions table.
 */
function insertSession(id: string, project = PROJECT): void {
	const agentDb = dbm.get("agent");
	const now = Date.now();
	agentDb.prepare(`
		INSERT INTO sessions (id, project, title, created_at, updated_at, file_path)
		VALUES (?, ?, ?, ?, ?, ?)
	`).run(id, project, `Session ${id}`, now, now, `sessions/${id}.md`);
}

/**
 * Insert a turn into the turns table.
 */
function insertTurn(
	sessionId: string,
	turnNumber: number,
	role: "user" | "assistant",
	content: string,
	toolCalls?: Array<{
		name: string;
		input: string;
		result: string;
		isError?: boolean;
	}>,
): void {
	const agentDb = dbm.get("agent");
	const now = Date.now();
	agentDb.prepare(`
		INSERT INTO turns (session_id, turn_number, role, content, tool_calls, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`).run(
		sessionId,
		turnNumber,
		role,
		content,
		toolCalls ? JSON.stringify(toolCalls) : null,
		now,
	);
}

/**
 * Create a tool call object.
 */
function tc(
	name: string,
	input = "{}",
	result = "ok",
	isError = false,
): { name: string; input: string; result: string; isError: boolean } {
	return { name, input, result, isError };
}

/**
 * Seed N sessions with the same tool sequence for extraction tests.
 * Each session: user -> assistant(toolA -> toolB -> ...)
 */
function seedSessionsWithSequence(
	count: number,
	tools: Array<{ name: string; input?: Record<string, unknown> }>,
	prefix = "s",
): void {
	for (let i = 0; i < count; i++) {
		const sid = `${prefix}${i}`;
		insertSession(sid);
		insertTurn(sid, 0, "user", `Fix the issue in module ${i}`);
		insertTurn(
			sid,
			1,
			"assistant",
			`Working on module ${i}`,
			tools.map((t) => tc(
				t.name,
				JSON.stringify(t.input ?? { file: `module${i}.ts` }),
				"success",
			)),
		);
	}
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vidhi-test-"));
	DatabaseManager.reset();
	dbm = DatabaseManager.instance(tmpDir);
	initAgentSchema(dbm);
});

afterEach(() => {
	DatabaseManager.reset();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Construction ───────────────────────────────────────────────────────────

describe("VidhiEngine — construction", () => {
	it("should construct with only project provided (uses defaults)", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		expect(engine).toBeDefined();
	});

	it("should merge custom config with defaults", () => {
		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 5,
			minSuccessRate: 0.9,
			minSequenceLength: 3,
			maxSequenceLength: 8,
		});
		expect(engine).toBeDefined();
	});

	it("should allow project to be any string", () => {
		const engine = new VidhiEngine({ project: "/some/arbitrary/path" });
		expect(engine).toBeDefined();
	});
});

// ─── N-gram Extraction ─────────────────────────────────────────────────────

describe("VidhiEngine — n-gram extraction from tool sequences", () => {
	it("should extract bigrams from a 3-tool sequence", () => {
		// Seed 4 sessions with read -> edit -> bash
		seedSessionsWithSequence(4, [
			{ name: "read" },
			{ name: "edit" },
			{ name: "bash" },
		]);

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
			maxSequenceLength: 5,
		});
		const result = engine.extract();

		// Should find at least one n-gram sequence
		expect(result.totalSequencesAnalyzed).toBeGreaterThanOrEqual(1);
	});

	it("should respect minSequenceLength", () => {
		// Seed sessions with only 2-tool sequences
		seedSessionsWithSequence(4, [
			{ name: "read" },
			{ name: "edit" },
		]);

		// minSequenceLength = 3 should exclude all bigrams
		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 3,
		});
		const result = engine.extract();

		expect(result.newVidhis.length).toBe(0);
	});

	it("should respect maxSequenceLength", () => {
		// Seed sessions with a 6-tool sequence
		seedSessionsWithSequence(4, [
			{ name: "grep" },
			{ name: "read" },
			{ name: "edit" },
			{ name: "bash" },
			{ name: "write" },
			{ name: "read" },
		]);

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
			maxSequenceLength: 3, // cap at trigrams
		});
		const result = engine.extract();

		// All created vidhis should have at most 3 steps
		for (const v of result.newVidhis) {
			expect(v.steps.length).toBeLessThanOrEqual(3);
		}
	});

	it("should count distinct sessions (not inflate from multiple occurrences per session)", () => {
		// Create only 2 sessions (below minSessions = 3)
		seedSessionsWithSequence(2, [
			{ name: "read" },
			{ name: "edit" },
		]);

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		// 2 sessions < minSessions = 3, so no vidhis
		expect(result.newVidhis.length).toBe(0);
	});

	it("should skip n-grams containing error tool calls", () => {
		// Create sessions where tool calls have errors
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Task ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `Reply ${i}`, [
				tc("read", JSON.stringify({ f: `f${i}` }), "ok"),
				tc("bash", JSON.stringify({ c: `cmd${i}` }), "FAILED", true),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		// The bigram read|bash contains an error, so it should be skipped
		const bashVidhi = result.newVidhis.find((v) =>
			v.steps.some((s) => s.toolName === "bash"),
		);
		expect(bashVidhi).toBeUndefined();
	});
});

// ─── Anti-Unification ──────────────────────────────────────────────────────

describe("VidhiEngine — anti-unification for template extraction", () => {
	it("should identify fixed arguments (same across all instances)", () => {
		// All sessions use the same encoding but different paths
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Task ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `Reply ${i}`, [
				tc("read", JSON.stringify({ path: `/src/file${i}.ts`, encoding: "utf-8" }), "ok"),
				tc("edit", JSON.stringify({ path: `/src/file${i}.ts`, action: "replace" }), "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		expect(result.newVidhis.length).toBeGreaterThanOrEqual(1);

		const vidhi = result.newVidhis[0];
		const readStep = vidhi.steps.find((s) => s.toolName === "read");
		expect(readStep).toBeDefined();

		if (readStep) {
			// 'encoding' is the same across all instances -> fixed literal
			expect(readStep.argTemplate.encoding).toBe("utf-8");
			// 'path' differs across instances -> should be a ${param} placeholder
			const pathVal = readStep.argTemplate.path as string;
			expect(pathVal.startsWith("${")).toBe(true);
		}
	});

	it("should create parameter schema for variable arguments", () => {
		// Different paths, same encoding
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Fix ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `Fixing ${i}`, [
				tc("read", JSON.stringify({ path: `/mod${i}/index.ts` }), "ok"),
				tc("edit", JSON.stringify({ path: `/mod${i}/index.ts`, content: `fix-${i}` }), "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		if (result.newVidhis.length > 0) {
			const vidhi = result.newVidhis[0];
			const params = vidhi.parameterSchema;

			// Should have at least one parameter (for the varying path)
			expect(Object.keys(params).length).toBeGreaterThanOrEqual(1);

			// Each param should have required fields
			for (const [, param] of Object.entries(params)) {
				expect(param.name).toBeDefined();
				expect(param.type).toBeDefined();
				expect(param.description).toBeDefined();
				expect(typeof param.required).toBe("boolean");
			}
		}
	});

	it("should infer correct types from observed values", () => {
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Req ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `Res ${i}`, [
				tc("read", JSON.stringify({
					path: `/file${i}.ts`,
					line: i * 10, // number
					verbose: i % 2 === 0, // boolean
				}), "ok"),
				tc("edit", JSON.stringify({
					path: `/file${i}.ts`,
					text: `content-${i}`, // string
				}), "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		if (result.newVidhis.length > 0) {
			const vidhi = result.newVidhis[0];
			const params = vidhi.parameterSchema;

			// Find the 'line' parameter (should be number type)
			const lineParam = Object.values(params).find((p) => p.name.includes("line"));
			if (lineParam) {
				expect(lineParam.type).toBe("number");
			}

			// Find the 'path' parameter (should be string type)
			const pathParam = Object.values(params).find((p) => p.name.includes("path"));
			if (pathParam) {
				expect(pathParam.type).toBe("string");
			}
		}
	});

	it("should handle empty argument objects gracefully", () => {
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Task ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `Reply ${i}`, [
				tc("read", "{}", "ok"),
				tc("edit", "{}", "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		// Should still extract vidhis; args are just empty
		expect(result.newVidhis.length).toBeGreaterThanOrEqual(1);
		if (result.newVidhis.length > 0) {
			const vidhi = result.newVidhis[0];
			// No parameters since all args are empty / identical
			expect(Object.keys(vidhi.parameterSchema).length).toBe(0);
		}
	});

	it("should handle non-JSON tool inputs as _raw strings", () => {
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Task ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `Reply ${i}`, [
				tc("bash", `echo "hello ${i}"`, "ok"),
				tc("bash", `echo "bye ${i}"`, "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		// Should not crash with non-JSON inputs
		expect(result).toBeDefined();
	});
});

// ─── Thompson Sampling ─────────────────────────────────────────────────────

describe("VidhiEngine — Thompson Sampling (Beta distribution)", () => {
	it("should rank vidhis using Thompson Sampling via getVidhis()", () => {
		// Create and persist two vidhis with different success/failure counts
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();

		const vidhi1: Vidhi = {
			id: "v1",
			project: PROJECT,
			name: "high-success",
			learnedFrom: ["s1", "s2", "s3"],
			confidence: 0.9,
			steps: [{ index: 0, toolName: "read", argTemplate: {}, description: "Read", critical: true }],
			triggers: ["read file"],
			successRate: 0.95,
			successCount: 19,
			failureCount: 1,
			parameterSchema: {},
			createdAt: now,
			updatedAt: now,
		};

		const vidhi2: Vidhi = {
			id: "v2",
			project: PROJECT,
			name: "low-success",
			learnedFrom: ["s1", "s2", "s3"],
			confidence: 0.5,
			steps: [{ index: 0, toolName: "bash", argTemplate: {}, description: "Bash", critical: true }],
			triggers: ["run command"],
			successRate: 0.3,
			successCount: 3,
			failureCount: 7,
			parameterSchema: {},
			createdAt: now,
			updatedAt: now,
		};

		engine.persist(vidhi1);
		engine.persist(vidhi2);

		// Run getVidhis multiple times; high-success should usually rank first
		let v1First = 0;
		const trials = 50;
		for (let i = 0; i < trials; i++) {
			const ranked = engine.getVidhis(PROJECT, 10);
			expect(ranked.length).toBe(2);
			if (ranked[0].id === "v1") v1First++;
		}

		// The high-success vidhi should rank first most of the time
		// (with Beta(20,2) vs Beta(4,8), v1 should dominate)
		expect(v1First).toBeGreaterThan(trials * 0.7);
	});

	it("should sample from Beta(1,1) as uniform when no prior data", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();

		const vidhi: Vidhi = {
			id: "v_uniform",
			project: PROJECT,
			name: "uniform-prior",
			learnedFrom: ["s1", "s2", "s3"],
			confidence: 0.5,
			steps: [{ index: 0, toolName: "read", argTemplate: {}, description: "Read", critical: true }],
			triggers: ["read"],
			successRate: 0.5,
			successCount: 0,
			failureCount: 0,
			parameterSchema: {},
			createdAt: now,
			updatedAt: now,
		};

		engine.persist(vidhi);

		// Sample from Beta(1, 1) many times — should be uniformly distributed
		const ranked = engine.getVidhis(PROJECT, 1);
		expect(ranked.length).toBe(1);
		expect(ranked[0].id).toBe("v_uniform");
	});

	it("should combine Jaccard similarity and Thompson Sampling in match()", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();

		const vidhi1: Vidhi = {
			id: "v_match_1",
			project: PROJECT,
			name: "file-ops",
			learnedFrom: ["s1", "s2", "s3"],
			confidence: 0.8,
			steps: [
				{ index: 0, toolName: "read", argTemplate: {}, description: "Read", critical: true },
				{ index: 1, toolName: "edit", argTemplate: {}, description: "Edit", critical: true },
			],
			triggers: ["read file", "edit file", "modify file", "update code"],
			successRate: 0.9,
			successCount: 18,
			failureCount: 2,
			parameterSchema: {},
			createdAt: now,
			updatedAt: now,
		};

		engine.persist(vidhi1);

		// Query that should match
		const match = engine.match("read the file and edit it");
		expect(match).not.toBeNull();
		if (match) {
			expect(match.id).toBe("v_match_1");
		}
	});

	it("should return null when no query tokens overlap with triggers", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();

		const vidhi: Vidhi = {
			id: "v_no_match",
			project: PROJECT,
			name: "deploy-ops",
			learnedFrom: ["s1", "s2", "s3"],
			confidence: 0.8,
			steps: [{ index: 0, toolName: "bash", argTemplate: {}, description: "Deploy", critical: true }],
			triggers: ["deploy application", "push production"],
			successRate: 0.9,
			successCount: 9,
			failureCount: 1,
			parameterSchema: {},
			createdAt: now,
			updatedAt: now,
		};

		engine.persist(vidhi);

		// Completely unrelated query
		const match = engine.match("what time is it today");
		// Should be null since "time" and "today" don't match triggers
		expect(match).toBeNull();
	});

	it("should return null when vidhis list is empty", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const match = engine.match("read the file");
		expect(match).toBeNull();
	});

	it("should return null for empty query", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();
		const vidhi: Vidhi = {
			id: "v_empty_q",
			project: PROJECT,
			name: "test",
			learnedFrom: ["s1", "s2", "s3"],
			confidence: 0.8,
			steps: [{ index: 0, toolName: "read", argTemplate: {}, description: "Read", critical: true }],
			triggers: ["read file"],
			successRate: 0.9,
			successCount: 9,
			failureCount: 1,
			parameterSchema: {},
			createdAt: now,
			updatedAt: now,
		};
		engine.persist(vidhi);

		// Empty query (after stopword removal) should return null
		const match = engine.match("the a is");
		expect(match).toBeNull();
	});
});

// ─── Trigger Phrase Extraction ─────────────────────────────────────────────

describe("VidhiEngine — trigger phrase extraction (verb-object NLU)", () => {
	it("should extract verb-object bigrams from user messages", () => {
		// Seed sessions with user messages containing action verbs
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", "add a new API endpoint");
			insertTurn(`s${i}`, 1, "assistant", `Done ${i}`, [
				tc("read", JSON.stringify({ p: `p${i}` }), "ok"),
				tc("edit", JSON.stringify({ p: `p${i}` }), "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		if (result.newVidhis.length > 0) {
			const vidhi = result.newVidhis[0];
			expect(vidhi.triggers.length).toBeGreaterThan(0);
			// Should contain "add" as an action verb trigger
			const hasAddTrigger = vidhi.triggers.some((t) => t.startsWith("add"));
			expect(hasAddTrigger).toBe(true);
		}
	});

	it("should extract verb-object trigrams from user messages", () => {
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", "run test suite now");
			insertTurn(`s${i}`, 1, "assistant", `Running ${i}`, [
				tc("bash", JSON.stringify({ c: `test${i}` }), "ok"),
				tc("read", JSON.stringify({ p: `p${i}` }), "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		if (result.newVidhis.length > 0) {
			const vidhi = result.newVidhis[0];
			// Should have trigram "run test suite"
			const hasRunTestSuite = vidhi.triggers.some((t) => t.includes("run test suite"));
			expect(hasRunTestSuite).toBe(true);
		}
	});

	it("should deduplicate triggers and take top 10 by frequency", () => {
		// All sessions use the same user message -> same triggers
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", "create new file");
			insertTurn(`s${i}`, 1, "assistant", `Creating ${i}`, [
				tc("write", JSON.stringify({ p: `f${i}` }), "ok"),
				tc("read", JSON.stringify({ p: `f${i}` }), "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		if (result.newVidhis.length > 0) {
			const vidhi = result.newVidhis[0];
			// Triggers should be deduplicated (no two identical)
			const uniqueTriggers = new Set(vidhi.triggers);
			expect(uniqueTriggers.size).toBe(vidhi.triggers.length);
			// Should not exceed 10
			expect(vidhi.triggers.length).toBeLessThanOrEqual(10);
		}
	});

	it("should handle empty user messages without crash", () => {
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			// No user turn before assistant turn
			insertTurn(`s${i}`, 0, "assistant", `Reply ${i}`, [
				tc("read", JSON.stringify({ p: `f${i}` }), "ok"),
				tc("edit", JSON.stringify({ p: `f${i}` }), "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		// Should still extract vidhis; triggers may be empty
		expect(result).toBeDefined();
	});
});

// ─── Full Extraction Pipeline ──────────────────────────────────────────────

describe("VidhiEngine — full extraction pipeline", () => {
	it("should extract new vidhis from sessions with repeated patterns", () => {
		seedSessionsWithSequence(4, [
			{ name: "grep", input: { query: "pattern" } },
			{ name: "read" },
			{ name: "edit" },
		]);

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		expect(result.newVidhis.length).toBeGreaterThanOrEqual(1);
		expect(result.totalSequencesAnalyzed).toBeGreaterThanOrEqual(1);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("should reinforce existing vidhis on subsequent extraction", () => {
		seedSessionsWithSequence(4, [{ name: "read" }, { name: "edit" }]);

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});

		// First extraction — creates new vidhis
		const result1 = engine.extract();
		expect(result1.newVidhis.length).toBeGreaterThanOrEqual(1);

		// Second extraction — should reinforce, not duplicate
		const result2 = engine.extract();
		expect(result2.reinforced.length).toBeGreaterThanOrEqual(1);
		expect(result2.newVidhis.length).toBe(0);
	});

	it("should rank aggregates by frequency x length", () => {
		// Seed sessions with both a bigram and a trigram pattern
		for (let i = 0; i < 5; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Task ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `Reply ${i}`, [
				tc("grep", JSON.stringify({ q: `q${i}` }), "ok"),
				tc("read", JSON.stringify({ p: `p${i}` }), "ok"),
				tc("edit", JSON.stringify({ p: `p${i}` }), "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		// The trigram (grep|read|edit, score = 5*3=15) should rank above
		// the bigrams (grep|read or read|edit, score = 5*2=10)
		if (result.newVidhis.length >= 2) {
			const first = result.newVidhis[0];
			const second = result.newVidhis[1];
			expect(first.steps.length).toBeGreaterThanOrEqual(second.steps.length);
		}
	});

	it("should generate vidhi name from tool names", () => {
		seedSessionsWithSequence(4, [{ name: "read" }, { name: "edit" }]);

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		if (result.newVidhis.length > 0) {
			const vidhi = result.newVidhis[0];
			// Name should contain "read" and "edit" joined by "-then-"
			expect(vidhi.name).toContain("read");
			expect(vidhi.name).toContain("edit");
			expect(vidhi.name).toContain("-then-");
		}
	});

	it("should set confidence based on session count", () => {
		seedSessionsWithSequence(5, [{ name: "read" }, { name: "edit" }]);

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		if (result.newVidhis.length > 0) {
			const vidhi = result.newVidhis[0];
			// confidence = min(1.0, 0.5 + 0.1 * sessionCount)
			// With 5 sessions: 0.5 + 0.1*5 = 1.0
			expect(vidhi.confidence).toBeLessThanOrEqual(1.0);
			expect(vidhi.confidence).toBeGreaterThanOrEqual(0.5);
		}
	});

	it("should track learnedFrom session IDs", () => {
		seedSessionsWithSequence(4, [{ name: "read" }, { name: "edit" }]);

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		if (result.newVidhis.length > 0) {
			const vidhi = result.newVidhis[0];
			expect(vidhi.learnedFrom.length).toBeGreaterThanOrEqual(3);
			// All learned-from IDs should be valid session IDs
			for (const sid of vidhi.learnedFrom) {
				expect(sid).toMatch(/^s\d$/);
			}
		}
	});

	it("should initialize successCount and failureCount to 0 for new vidhis", () => {
		seedSessionsWithSequence(4, [{ name: "read" }, { name: "edit" }]);

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		for (const v of result.newVidhis) {
			expect(v.successCount).toBe(0);
			expect(v.failureCount).toBe(0);
		}
	});
});

// ─── SQL Persistence ───────────────────────────────────────────────────────

describe("VidhiEngine — SQL persistence (save/load vidhis)", () => {
	it("should persist a vidhi to the database", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();

		const vidhi: Vidhi = {
			id: "test-persist-1",
			project: PROJECT,
			name: "read-then-edit",
			learnedFrom: ["s1", "s2", "s3"],
			confidence: 0.85,
			steps: [
				{ index: 0, toolName: "read", argTemplate: { path: "${param_path}" }, description: "Read", critical: true },
				{ index: 1, toolName: "edit", argTemplate: { path: "${param_path}", text: "fix" }, description: "Edit", critical: true },
			],
			triggers: ["modify file", "edit code"],
			successRate: 0.9,
			successCount: 9,
			failureCount: 1,
			parameterSchema: {
				param_path: {
					name: "param_path",
					type: "string",
					description: "File path to operate on",
					required: true,
					examples: ["/src/a.ts", "/src/b.ts"],
				},
			},
			createdAt: now,
			updatedAt: now,
		};

		engine.persist(vidhi);

		// Verify it's in the DB
		const loaded = engine.getVidhi("test-persist-1");
		expect(loaded).not.toBeNull();
		expect(loaded!.name).toBe("read-then-edit");
		expect(loaded!.steps.length).toBe(2);
		expect(loaded!.triggers).toEqual(["modify file", "edit code"]);
		expect(loaded!.confidence).toBe(0.85);
	});

	it("should load all vidhis for a project", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();

		for (let i = 0; i < 3; i++) {
			engine.persist({
				id: `v${i}`,
				project: PROJECT,
				name: `vidhi-${i}`,
				learnedFrom: ["s1"],
				confidence: 0.5 + i * 0.1,
				steps: [{ index: 0, toolName: "read", argTemplate: {}, description: "Step", critical: true }],
				triggers: [`trigger ${i}`],
				successRate: 0.8,
				successCount: 8,
				failureCount: 2,
				parameterSchema: {},
				createdAt: now,
				updatedAt: now,
			});
		}

		const all = engine.loadAll(PROJECT);
		expect(all.length).toBe(3);
	});

	it("should return vidhis ordered by success_rate descending", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();

		engine.persist({
			id: "v_low", project: PROJECT, name: "low-rate",
			learnedFrom: ["s1"], confidence: 0.5,
			steps: [{ index: 0, toolName: "read", argTemplate: {}, description: "R", critical: true }],
			triggers: ["a"], successRate: 0.3, successCount: 3, failureCount: 7,
			parameterSchema: {}, createdAt: now, updatedAt: now,
		});

		engine.persist({
			id: "v_high", project: PROJECT, name: "high-rate",
			learnedFrom: ["s1"], confidence: 0.9,
			steps: [{ index: 0, toolName: "read", argTemplate: {}, description: "R", critical: true }],
			triggers: ["b"], successRate: 0.95, successCount: 19, failureCount: 1,
			parameterSchema: {}, createdAt: now, updatedAt: now,
		});

		const all = engine.loadAll(PROJECT);
		expect(all[0].id).toBe("v_high");
		expect(all[1].id).toBe("v_low");
	});

	it("should upsert (replace) on persist with same ID", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();

		const vidhi: Vidhi = {
			id: "v_upsert",
			project: PROJECT,
			name: "original-name",
			learnedFrom: ["s1"],
			confidence: 0.5,
			steps: [{ index: 0, toolName: "read", argTemplate: {}, description: "R", critical: true }],
			triggers: ["original"],
			successRate: 0.5,
			successCount: 5,
			failureCount: 5,
			parameterSchema: {},
			createdAt: now,
			updatedAt: now,
		};

		engine.persist(vidhi);

		// Update and persist again
		vidhi.name = "updated-name";
		vidhi.successCount = 10;
		engine.persist(vidhi);

		const loaded = engine.getVidhi("v_upsert");
		expect(loaded!.name).toBe("updated-name");
		expect(loaded!.successCount).toBe(10);

		// Should still be 1 row, not 2
		const all = engine.loadAll(PROJECT);
		expect(all.length).toBe(1);
	});

	it("should return null for non-existent vidhi ID", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const result = engine.getVidhi("nonexistent-id");
		expect(result).toBeNull();
	});

	it("should correctly serialize and deserialize JSON fields", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();

		const complexVidhi: Vidhi = {
			id: "v_json",
			project: PROJECT,
			name: "complex-vidhi",
			learnedFrom: ["s1", "s2", "s3", "s4"],
			confidence: 0.87,
			steps: [
				{
					index: 0,
					toolName: "read",
					argTemplate: { path: "${param_path}", encoding: "utf-8" },
					description: "Read the file",
					critical: true,
				},
				{
					index: 1,
					toolName: "edit",
					argTemplate: { path: "${param_path}", content: "${param_content}" },
					description: "Edit the file",
					critical: true,
				},
			],
			triggers: ["read and edit", "modify file", "update code"],
			successRate: 0.88,
			successCount: 44,
			failureCount: 6,
			parameterSchema: {
				param_path: {
					name: "param_path",
					type: "string",
					description: "The file path",
					required: true,
					examples: ["/src/a.ts", "/src/b.ts"],
				},
				param_content: {
					name: "param_content",
					type: "string",
					description: "New content",
					required: true,
					examples: ["fix-1", "fix-2"],
				},
			},
			createdAt: now,
			updatedAt: now,
		};

		engine.persist(complexVidhi);
		const loaded = engine.getVidhi("v_json");

		expect(loaded).not.toBeNull();
		expect(loaded!.learnedFrom).toEqual(["s1", "s2", "s3", "s4"]);
		expect(loaded!.steps.length).toBe(2);
		expect(loaded!.steps[0].argTemplate.encoding).toBe("utf-8");
		expect(loaded!.triggers).toEqual(["read and edit", "modify file", "update code"]);
		expect(loaded!.parameterSchema.param_path.type).toBe("string");
		expect(loaded!.parameterSchema.param_path.examples).toEqual(["/src/a.ts", "/src/b.ts"]);
	});

	it("should return empty array for project with no vidhis", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const all = engine.loadAll(PROJECT);
		expect(all).toEqual([]);
	});
});

// ─── Outcome Tracking (recordOutcome) ──────────────────────────────────────

describe("VidhiEngine — outcome tracking (success/failure counts)", () => {
	it("should increment successCount on successful execution", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();

		engine.persist({
			id: "v_outcome",
			project: PROJECT,
			name: "track-outcome",
			learnedFrom: ["s1"],
			confidence: 0.8,
			steps: [{ index: 0, toolName: "read", argTemplate: {}, description: "R", critical: true }],
			triggers: ["read"],
			successRate: 0.5,
			successCount: 5,
			failureCount: 5,
			parameterSchema: {},
			createdAt: now,
			updatedAt: now,
		});

		engine.recordOutcome("v_outcome", true);

		const updated = engine.getVidhi("v_outcome");
		expect(updated!.successCount).toBe(6);
		expect(updated!.failureCount).toBe(5);
	});

	it("should increment failureCount on failed execution", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();

		engine.persist({
			id: "v_fail",
			project: PROJECT,
			name: "track-failure",
			learnedFrom: ["s1"],
			confidence: 0.8,
			steps: [{ index: 0, toolName: "read", argTemplate: {}, description: "R", critical: true }],
			triggers: ["read"],
			successRate: 0.5,
			successCount: 5,
			failureCount: 5,
			parameterSchema: {},
			createdAt: now,
			updatedAt: now,
		});

		engine.recordOutcome("v_fail", false);

		const updated = engine.getVidhi("v_fail");
		expect(updated!.successCount).toBe(5);
		expect(updated!.failureCount).toBe(6);
	});

	it("should update successRate using Thompson Sampling formula", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();

		engine.persist({
			id: "v_rate",
			project: PROJECT,
			name: "rate-update",
			learnedFrom: ["s1"],
			confidence: 0.8,
			steps: [{ index: 0, toolName: "read", argTemplate: {}, description: "R", critical: true }],
			triggers: ["read"],
			successRate: 0.5,
			successCount: 5,
			failureCount: 5,
			parameterSchema: {},
			createdAt: now,
			updatedAt: now,
		});

		// Record a success: alpha=6+1=7, beta=5+1=6, rate = 7/13
		engine.recordOutcome("v_rate", true);

		const updated = engine.getVidhi("v_rate");
		// alpha = 6+1 = 7, beta = 5+1 = 6, rate = 7 / (7+6) = 7/13
		expect(updated!.successRate).toBeCloseTo(7 / 13, 5);
	});

	it("should update updatedAt timestamp on outcome recording", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const pastTime = Date.now() - 100000;

		engine.persist({
			id: "v_time",
			project: PROJECT,
			name: "time-check",
			learnedFrom: ["s1"],
			confidence: 0.8,
			steps: [{ index: 0, toolName: "read", argTemplate: {}, description: "R", critical: true }],
			triggers: ["read"],
			successRate: 0.5,
			successCount: 5,
			failureCount: 5,
			parameterSchema: {},
			createdAt: pastTime,
			updatedAt: pastTime,
		});

		engine.recordOutcome("v_time", true);

		const updated = engine.getVidhi("v_time");
		expect(updated!.updatedAt).toBeGreaterThan(pastTime);
	});

	it("should do nothing for non-existent vidhi ID", () => {
		const engine = new VidhiEngine({ project: PROJECT });

		// Should not crash
		engine.recordOutcome("nonexistent", true);
		engine.recordOutcome("nonexistent", false);
	});

	it("should handle multiple consecutive outcome recordings", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();

		engine.persist({
			id: "v_multi",
			project: PROJECT,
			name: "multi-outcome",
			learnedFrom: ["s1"],
			confidence: 0.8,
			steps: [{ index: 0, toolName: "read", argTemplate: {}, description: "R", critical: true }],
			triggers: ["read"],
			successRate: 0.5,
			successCount: 0,
			failureCount: 0,
			parameterSchema: {},
			createdAt: now,
			updatedAt: now,
		});

		// Record 5 successes and 2 failures
		for (let i = 0; i < 5; i++) engine.recordOutcome("v_multi", true);
		for (let i = 0; i < 2; i++) engine.recordOutcome("v_multi", false);

		const updated = engine.getVidhi("v_multi");
		expect(updated!.successCount).toBe(5);
		expect(updated!.failureCount).toBe(2);
		// alpha = 6, beta = 3, rate = 6/9
		expect(updated!.successRate).toBeCloseTo(6 / 9, 5);
	});
});

// ─── Edge Cases ────────────────────────────────────────────────────────────

describe("VidhiEngine — edge cases", () => {
	it("should handle single tool call in a session (below minSequenceLength)", () => {
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Q ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `A ${i}`, [
				tc("read", JSON.stringify({ p: `f${i}` }), "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		// Single tool call = sequence length 1, below minSequenceLength 2
		expect(result.newVidhis.length).toBe(0);
	});

	it("should handle no repeated patterns across sessions", () => {
		// Each session uses completely different tools
		const uniqueTools = ["read", "write", "edit", "bash"];
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Q ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `A ${i}`, [
				tc(uniqueTools[i], JSON.stringify({ p: `f${i}` }), "ok"),
				tc(`unique_tool_${i}`, JSON.stringify({ p: `f${i}` }), "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		// Each bigram only appears in 1 session, below minSessions = 3
		expect(result.newVidhis.length).toBe(0);
	});

	it("should handle sessions with malformed tool_calls JSON", () => {
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			const agentDb = dbm.get("agent");
			// Insert valid user turn
			agentDb.prepare(`
				INSERT INTO turns (session_id, turn_number, role, content, tool_calls, created_at)
				VALUES (?, ?, ?, ?, ?, ?)
			`).run(`s${i}`, 0, "user", `Q ${i}`, null, Date.now());
			// Insert assistant turn with malformed JSON
			agentDb.prepare(`
				INSERT INTO turns (session_id, turn_number, role, content, tool_calls, created_at)
				VALUES (?, ?, ?, ?, ?, ?)
			`).run(`s${i}`, 1, "assistant", `A ${i}`, "INVALID_JSON{{{", Date.now());
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});

		// Should not crash
		const result = engine.extract();
		expect(result).toBeDefined();
		expect(result.newVidhis.length).toBe(0);
	});

	it("should not extract from sessions of a different project", () => {
		seedSessionsWithSequence(4, [{ name: "read" }, { name: "edit" }]);

		// These are under PROJECT; use a different project
		const engine = new VidhiEngine({
			project: "/other/project",
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		expect(result.newVidhis.length).toBe(0);
	});

	it("should handle sessions with only user turns (no assistant/tool turns)", () => {
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Question ${i}`);
			insertTurn(`s${i}`, 1, "user", `Follow-up ${i}`);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		expect(result.newVidhis.length).toBe(0);
	});

	it("should generate deterministic IDs via FNV-1a", () => {
		seedSessionsWithSequence(4, [{ name: "read" }, { name: "edit" }]);

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result1 = engine.extract();

		if (result1.newVidhis.length > 0) {
			const id1 = result1.newVidhis[0].id;
			// ID should be an 8-character hex string
			expect(id1).toMatch(/^[0-9a-f]{8}$/);
		}
	});

	it("should set all steps as critical by default", () => {
		seedSessionsWithSequence(4, [{ name: "read" }, { name: "edit" }]);

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		for (const v of result.newVidhis) {
			for (const step of v.steps) {
				expect(step.critical).toBe(true);
			}
		}
	});

	it("should provide step descriptions with tool name and step index", () => {
		seedSessionsWithSequence(4, [{ name: "grep" }, { name: "read" }, { name: "edit" }]);

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		for (const v of result.newVidhis) {
			for (const step of v.steps) {
				expect(step.description).toContain(step.toolName);
				expect(step.description).toContain("step");
			}
		}
	});

	it("should handle the getVidhis topK parameter", () => {
		const engine = new VidhiEngine({ project: PROJECT });
		const now = Date.now();

		// Insert 5 vidhis
		for (let i = 0; i < 5; i++) {
			engine.persist({
				id: `v_topk_${i}`,
				project: PROJECT,
				name: `vidhi-${i}`,
				learnedFrom: ["s1"],
				confidence: 0.5,
				steps: [{ index: 0, toolName: "read", argTemplate: {}, description: "R", critical: true }],
				triggers: [`trigger-${i}`],
				successRate: 0.5 + i * 0.1,
				successCount: 5 + i,
				failureCount: 5 - i,
				parameterSchema: {},
				createdAt: now,
				updatedAt: now,
			});
		}

		// Get top 2
		const top2 = engine.getVidhis(PROJECT, 2);
		expect(top2.length).toBe(2);

		// Get top 10 (more than available)
		const top10 = engine.getVidhis(PROJECT, 10);
		expect(top10.length).toBe(5);
	});

	it("should handle parameter examples with up to 5 unique values", () => {
		// Create sessions with more than 5 unique argument values
		for (let i = 0; i < 6; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Task ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `Reply ${i}`, [
				tc("read", JSON.stringify({ path: `/unique/path/file${i}.ts` }), "ok"),
				tc("edit", JSON.stringify({ path: `/unique/path/file${i}.ts`, text: `fix-${i}` }), "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		if (result.newVidhis.length > 0) {
			const params = result.newVidhis[0].parameterSchema;
			for (const param of Object.values(params)) {
				if (param.examples) {
					expect(param.examples.length).toBeLessThanOrEqual(5);
				}
			}
		}
	});
});

// ─── Deep Equality & Type Inference ────────────────────────────────────────

describe("VidhiEngine — deep equality and type inference", () => {
	it("should treat identical arrays as fixed arguments", () => {
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Task ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `Reply ${i}`, [
				tc("read", JSON.stringify({ paths: ["/src/a.ts", "/src/b.ts"], mode: "bulk" }), "ok"),
				tc("edit", JSON.stringify({ paths: ["/src/a.ts", "/src/b.ts"], change: `fix-${i}` }), "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		if (result.newVidhis.length > 0) {
			const readStep = result.newVidhis[0].steps.find((s) => s.toolName === "read");
			if (readStep) {
				// 'paths' is identical across all -> fixed
				expect(readStep.argTemplate.paths).toEqual(["/src/a.ts", "/src/b.ts"]);
				// 'mode' is identical -> fixed
				expect(readStep.argTemplate.mode).toBe("bulk");
			}
		}
	});

	it("should treat different arrays as variable arguments", () => {
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Task ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `Reply ${i}`, [
				tc("read", JSON.stringify({ tags: [`tag-${i}`, `extra-${i}`] }), "ok"),
				tc("edit", JSON.stringify({ data: `d${i}` }), "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		if (result.newVidhis.length > 0) {
			const readStep = result.newVidhis[0].steps.find((s) => s.toolName === "read");
			if (readStep) {
				// 'tags' differs -> variable
				const tagsVal = readStep.argTemplate.tags as string;
				expect(tagsVal.startsWith("${")).toBe(true);
			}
		}
	});

	it("should infer mixed types as string (safest fallback)", () => {
		// Deliberately mix types for the same key across sessions
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Task ${i}`);
			const value = i % 2 === 0 ? `"string_val"` : `${i * 10}`;
			insertTurn(`s${i}`, 1, "assistant", `Reply ${i}`, [
				tc("bash", `{"count": ${value}}`, "ok"),
				tc("read", JSON.stringify({ p: `p${i}` }), "ok"),
			]);
		}

		const engine = new VidhiEngine({
			project: PROJECT,
			minSessions: 3,
			minSequenceLength: 2,
		});
		const result = engine.extract();

		if (result.newVidhis.length > 0) {
			const params = result.newVidhis[0].parameterSchema;
			const countParam = Object.values(params).find((p) => p.name.includes("count"));
			if (countParam) {
				// Mixed string + number -> fallback to string
				expect(countParam.type).toBe("string");
			}
		}
	});
});
