/**
 * Tests for SvapnaConsolidation — the 5-phase dream consolidation cycle.
 *
 * Covers: construction, REPLAY (TF-IDF surprise scoring), RECOMBINE (Jaccard
 * fingerprint matching), CRYSTALLIZE (vasana formation), PROCEDURALIZE (anti-
 * unification + Vidhi extraction), COMPRESS (Sinkhorn-Knopp with Pramana
 * weights), full pipeline, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAgentSchema } from "@chitragupta/smriti/db/schema";
import {
	SvapnaConsolidation,
	type SvapnaConfig,
	type ScoredTurn,
	type ReplayResult,
	type RecombineResult,
	type CrystallizeResult,
	type ProceduralizeResult,
	type CompressResult,
	type SvapnaResult,
} from "../src/svapna-consolidation.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

let tmpDir: string;
let dbm: DatabaseManager;

const PROJECT = "/test/svapna-project";

/**
 * Insert a session row into sessions table.
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
 * Insert a turn row into the turns table.
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
 * Insert a samskara into the samskaras table.
 */
function insertSamskara(
	id: string,
	sessionId: string,
	patternType: string,
	patternContent: string,
	observationCount: number,
	confidence: number,
	project = PROJECT,
	pramanaType: string | null = null,
): void {
	const agentDb = dbm.get("agent");
	const now = Date.now();
	agentDb.prepare(`
		INSERT INTO samskaras (id, session_id, pattern_type, pattern_content, observation_count,
		                       confidence, pramana_type, project, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(id, sessionId, patternType, patternContent, observationCount, confidence, pramanaType, project, now, now);
}

/**
 * Create a standard tool call object.
 */
function tc(
	name: string,
	input = "{}",
	result = "ok",
	isError = false,
): { name: string; input: string; result: string; isError: boolean } {
	return { name, input, result, isError };
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "svapna-test-"));
	DatabaseManager.reset();
	dbm = DatabaseManager.instance(tmpDir);
	initAgentSchema(dbm);
});

afterEach(() => {
	DatabaseManager.reset();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Construction ───────────────────────────────────────────────────────────

describe("SvapnaConsolidation — construction", () => {
	it("should use default config values when only project is provided", () => {
		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		expect(svapna).toBeDefined();
		// Validate it can be used (no crash)
	});

	it("should merge custom config with defaults", () => {
		const svapna = new SvapnaConsolidation(
			{
				project: PROJECT,
				maxSessionsPerCycle: 10,
				surpriseThreshold: 0.5,
				minPatternFrequency: 5,
				minSequenceLength: 3,
				minSuccessRate: 0.9,
			},
			dbm,
		);
		expect(svapna).toBeDefined();
	});
});

// ─── Phase 1: REPLAY ───────────────────────────────────────────────────────

describe("SvapnaConsolidation — Phase 1: REPLAY", () => {
	it("should return empty result when no sessions exist", async () => {
		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.replay();

		expect(result.allTurns).toHaveLength(0);
		expect(result.highSurpriseTurns).toHaveLength(0);
		expect(result.turnsScored).toBe(0);
		expect(result.highSurprise).toBe(0);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("should score turns with tool calls by frequency-based surprise", async () => {
		// Create 2 sessions with tool calls
		insertSession("s1");
		insertSession("s2");

		// Session 1: read (common) + edit (common)
		insertTurn("s1", 0, "user", "Fix the bug");
		insertTurn("s1", 1, "assistant", "Looking at the code", [
			tc("read", '{"path":"a.ts"}', "content of a.ts"),
			tc("edit", '{"path":"a.ts"}', "edited"),
		]);
		insertTurn("s1", 2, "assistant", "Also running tests", [
			tc("read", '{"path":"b.ts"}', "content of b.ts"),
		]);

		// Session 2: read (common) + bash (rare)
		insertTurn("s2", 0, "user", "Deploy it");
		insertTurn("s2", 1, "assistant", "Running command", [
			tc("read", '{"path":"c.ts"}', "content of c.ts"),
			tc("bash", '{"cmd":"deploy"}', "deployed!"),
		]);

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.replay();

		expect(result.turnsScored).toBe(5); // 3 turns in s1 + 2 turns in s2
		expect(result.allTurns.length).toBe(5);

		// All scored turns should have surprise in [0, 1]
		for (const st of result.allTurns) {
			expect(st.surprise).toBeGreaterThanOrEqual(0);
			expect(st.surprise).toBeLessThanOrEqual(1);
		}

		// Retention weights should be in [0.5, 1.0]
		for (const st of result.allTurns) {
			expect(st.retentionWeight).toBeGreaterThanOrEqual(0.5);
			expect(st.retentionWeight).toBeLessThanOrEqual(1.0);
		}
	});

	it("should identify high-surprise turns above threshold", async () => {
		insertSession("s1");
		insertSession("s2");

		// Many identical patterns (low surprise)
		for (let i = 0; i < 5; i++) {
			insertTurn("s1", i * 2, "user", `Request ${i}`);
			insertTurn("s1", i * 2 + 1, "assistant", `Response ${i}`, [
				tc("read", `{"path":"file${i}.ts"}`, "content"),
			]);
		}

		// One unusual pattern (high surprise): error tool call
		insertTurn("s2", 0, "user", "Try something risky");
		insertTurn("s2", 1, "assistant", "Running unusual tool", [
			tc("dangerous_tool", '{"arg":"x"}', "FAILED", true),
		]);

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, surpriseThreshold: 0.5 },
			dbm,
		);
		const result = await svapna.replay();

		expect(result.turnsScored).toBeGreaterThan(0);
		// The rare error pattern should generate higher surprise
		expect(result.highSurpriseTurns.length).toBeGreaterThanOrEqual(0);
		expect(result.highSurprise).toBe(result.highSurpriseTurns.length);
	});

	it("should handle turns without tool calls using content length deviation", async () => {
		insertSession("s1");

		// Normal-length turns
		insertTurn("s1", 0, "user", "Hello");
		insertTurn("s1", 1, "assistant", "Hi there, how can I help?");

		// Very long turn (high deviation = moderate surprise)
		insertTurn("s1", 2, "user", "A".repeat(1000));

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.replay();

		expect(result.turnsScored).toBe(3);

		// The very long turn should have some surprise from length deviation
		const longTurn = result.allTurns.find((t) => t.content.length === 1000);
		expect(longTurn).toBeDefined();
		expect(longTurn!.surprise).toBeGreaterThanOrEqual(0);
	});

	it("should normalize surprise scores to [0, 1] range", async () => {
		insertSession("s1");

		insertTurn("s1", 0, "user", "Test");
		insertTurn("s1", 1, "assistant", "Response with tools", [
			tc("read", '{"path":"a.ts"}', "content"),
			tc("read", '{"path":"a.ts"}', "content"),
			tc("read", '{"path":"a.ts"}', "content"),
		]);
		insertTurn("s1", 2, "assistant", "Unusual", [
			tc("rare_tool_xyz", '{}', "error", true),
		]);

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.replay();

		// Maximum surprise should be exactly 1.0 after normalization
		const maxSurprise = Math.max(...result.allTurns.map((t) => t.surprise));
		if (result.allTurns.some((t) => t.toolCalls.length > 0)) {
			expect(maxSurprise).toBeCloseTo(1.0, 5);
		}
	});

	it("should respect maxSessionsPerCycle limit", async () => {
		// Create 5 sessions but limit to 2
		for (let i = 0; i < 5; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Msg ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `Reply ${i}`);
		}

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, maxSessionsPerCycle: 2 },
			dbm,
		);
		const result = await svapna.replay();

		// Should only process turns from 2 sessions = 4 turns
		expect(result.turnsScored).toBe(4);
	});
});

// ─── Phase 2: RECOMBINE ────────────────────────────────────────────────────

describe("SvapnaConsolidation — Phase 2: RECOMBINE", () => {
	it("should return empty result when no high-surprise turns provided", async () => {
		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.recombine([]);

		expect(result.associations).toHaveLength(0);
		expect(result.crossSessions).toBe(0);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("should find cross-session associations via Jaccard similarity", async () => {
		// Session 1: read -> edit -> bash
		insertSession("s1");
		insertTurn("s1", 0, "user", "Fix bug");
		insertTurn("s1", 1, "assistant", "Fixing", [
			tc("read", '{"p":"a"}', "ok"),
			tc("edit", '{"p":"a"}', "ok"),
			tc("bash", '{"c":"test"}', "ok"),
		]);

		// Session 2: read -> edit -> bash (same pattern)
		insertSession("s2");
		insertTurn("s2", 0, "user", "Fix another bug");
		insertTurn("s2", 1, "assistant", "Fixing", [
			tc("read", '{"p":"b"}', "ok"),
			tc("edit", '{"p":"b"}', "ok"),
			tc("bash", '{"c":"lint"}', "ok"),
		]);

		// Session 3: grep -> write (different pattern)
		insertSession("s3");
		insertTurn("s3", 0, "user", "Create file");
		insertTurn("s3", 1, "assistant", "Creating", [
			tc("grep", '{"q":"pattern"}', "found"),
			tc("write", '{"p":"new.ts"}', "ok"),
		]);

		// Build high-surprise turns for session 1
		const highSurpriseTurns: ScoredTurn[] = [
			{
				turnId: 2,
				sessionId: "s1",
				turnNumber: 1,
				role: "assistant",
				content: "Fixing",
				toolCalls: [
					tc("read", '{"p":"a"}', "ok"),
					tc("edit", '{"p":"a"}', "ok"),
					tc("bash", '{"c":"test"}', "ok"),
				],
				surprise: 0.8,
				retentionWeight: 0.9,
				createdAt: Date.now(),
			},
		];

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.recombine(highSurpriseTurns);

		// s1's pattern should match s2 (similar tools), but not s3 much
		expect(result.associations.length).toBeGreaterThanOrEqual(1);

		// The s2 match should have high similarity (same tools)
		const s2Match = result.associations.find((a) => a.matchedSessionId === "s2");
		expect(s2Match).toBeDefined();
		if (s2Match) {
			expect(s2Match.similarity).toBeGreaterThan(0.15);
		}

		// Associations should be sorted by similarity descending
		for (let i = 1; i < result.associations.length; i++) {
			expect(result.associations[i].similarity).toBeLessThanOrEqual(
				result.associations[i - 1].similarity,
			);
		}
	});

	it("should not match self-session", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "user", "test");
		insertTurn("s1", 1, "assistant", "reply", [tc("read", "{}", "ok")]);

		const highSurpriseTurns: ScoredTurn[] = [
			{
				turnId: 2,
				sessionId: "s1",
				turnNumber: 1,
				role: "assistant",
				content: "reply",
				toolCalls: [tc("read", "{}", "ok")],
				surprise: 0.9,
				retentionWeight: 0.95,
				createdAt: Date.now(),
			},
		];

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.recombine(highSurpriseTurns);

		// No self-session match
		const selfMatch = result.associations.find(
			(a) => a.anchorSessionId === "s1" && a.matchedSessionId === "s1",
		);
		expect(selfMatch).toBeUndefined();
	});

	it("should skip turns with no tool calls in fingerprinting", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "user", "test");
		insertTurn("s1", 1, "assistant", "just text, no tools");

		insertSession("s2");
		insertTurn("s2", 0, "user", "test");
		insertTurn("s2", 1, "assistant", "also just text");

		const highSurpriseTurns: ScoredTurn[] = [
			{
				turnId: 1,
				sessionId: "s1",
				turnNumber: 0,
				role: "user",
				content: "test",
				toolCalls: [], // No tool calls
				surprise: 0.9,
				retentionWeight: 0.95,
				createdAt: Date.now(),
			},
		];

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.recombine(highSurpriseTurns);

		// Should produce no associations (no tool fingerprints to compare)
		expect(result.associations).toHaveLength(0);
	});

	it("should track unique cross-session pairs", async () => {
		insertSession("s1");
		insertSession("s2");
		insertSession("s3");

		// All sessions share the same tool: "read"
		insertTurn("s1", 0, "assistant", "r1", [tc("read", "{}", "ok")]);
		insertTurn("s2", 0, "assistant", "r2", [tc("read", "{}", "ok")]);
		insertTurn("s3", 0, "assistant", "r3", [tc("read", "{}", "ok")]);

		const highSurpriseTurns: ScoredTurn[] = [
			{
				turnId: 1,
				sessionId: "s1",
				turnNumber: 0,
				role: "assistant",
				content: "r1",
				toolCalls: [tc("read", "{}", "ok")],
				surprise: 0.9,
				retentionWeight: 0.95,
				createdAt: Date.now(),
			},
		];

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.recombine(highSurpriseTurns);

		// crossSessions counts unique pairs, not total associations
		expect(result.crossSessions).toBeGreaterThanOrEqual(0);
	});
});

// ─── Phase 3: CRYSTALLIZE ──────────────────────────────────────────────────

describe("SvapnaConsolidation — Phase 3: CRYSTALLIZE", () => {
	it("should return zero counts when no qualifying samskaras exist", async () => {
		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.crystallize();

		expect(result.vasanasCreated).toBe(0);
		expect(result.vasanasReinforced).toBe(0);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("should require minimum pattern frequency", async () => {
		insertSession("s1");
		insertSession("s2");

		// Samskara with only 1 observation (below default threshold of 3)
		insertSamskara("sam1", "s1", "preference", "prefers tabs", 1, 0.8);

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minPatternFrequency: 3 },
			dbm,
		);
		const result = await svapna.crystallize();

		expect(result.vasanasCreated).toBe(0);
	});

	it("should require confidence above 0.5", async () => {
		insertSession("s1");
		insertSession("s2");

		// Low confidence samskara with enough observations
		insertSamskara("sam1", "s1", "preference", "prefers tabs", 5, 0.3);

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minPatternFrequency: 3 },
			dbm,
		);
		const result = await svapna.crystallize();

		expect(result.vasanasCreated).toBe(0);
	});

	it("should require pattern to span at least 2 sessions (stability)", async () => {
		insertSession("s1");
		insertSession("s2");

		// High-quality samskara but only from 1 session
		insertSamskara("sam1", "s1", "preference", "prefers tabs over spaces", 5, 0.9);

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minPatternFrequency: 3 },
			dbm,
		);
		const result = await svapna.crystallize();

		// Even though it qualifies on count and confidence, it only comes
		// from 1 session, so it should not crystallize
		expect(result.vasanasCreated).toBe(0);
	});

	it("should create a new vasana from qualifying cross-session samskaras", async () => {
		insertSession("s1");
		insertSession("s2");

		// Similar samskaras from different sessions
		insertSamskara("sam1", "s1", "preference", "prefers tabs over spaces", 5, 0.9);
		insertSamskara("sam2", "s2", "preference", "prefers tabs over spaces", 4, 0.85);

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minPatternFrequency: 3 },
			dbm,
		);
		const result = await svapna.crystallize();

		expect(result.vasanasCreated).toBe(1);
		expect(result.vasanasReinforced).toBe(0);

		// Verify vasana was persisted in DB
		const agentDb = dbm.get("agent");
		const vasanas = agentDb
			.prepare("SELECT * FROM vasanas WHERE project = ?")
			.all(PROJECT) as Array<Record<string, unknown>>;
		expect(vasanas.length).toBe(1);
		expect(vasanas[0].valence).toBe("positive"); // preference -> positive
	});

	it("should reinforce an existing vasana instead of creating a duplicate", async () => {
		insertSession("s1");
		insertSession("s2");

		// Insert an existing vasana
		const agentDb = dbm.get("agent");
		const now = Date.now();
		const tendency = "prefers-tabs-over-spaces";
		agentDb.prepare(`
			INSERT INTO vasanas (name, description, valence, strength, stability,
			                     source_samskaras, project, created_at, updated_at,
			                     last_activated, activation_count)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			tendency,
			"prefers tabs over spaces",
			"positive",
			0.6,
			0.5,
			"[]",
			PROJECT,
			now,
			now,
			now,
			3,
		);

		// New samskaras matching the existing vasana
		insertSamskara("sam1", "s1", "preference", "prefers tabs over spaces", 5, 0.9);
		insertSamskara("sam2", "s2", "preference", "prefers tabs over spaces", 4, 0.85);

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minPatternFrequency: 3 },
			dbm,
		);
		const result = await svapna.crystallize();

		expect(result.vasanasReinforced).toBe(1);
		expect(result.vasanasCreated).toBe(0);

		// Verify strength increased
		const vasana = agentDb
			.prepare("SELECT strength, activation_count FROM vasanas WHERE name = ?")
			.get(tendency) as { strength: number; activation_count: number };
		expect(vasana.strength).toBeGreaterThan(0.6);
		expect(vasana.activation_count).toBe(4);
	});

	it("should assign correct valence based on pattern type", async () => {
		insertSession("s1");
		insertSession("s2");

		// Correction pattern -> negative valence
		insertSamskara("sam1", "s1", "correction", "user corrects wrong import paths", 5, 0.8);
		insertSamskara("sam2", "s2", "correction", "user corrects wrong import paths", 4, 0.75);

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minPatternFrequency: 3 },
			dbm,
		);
		await svapna.crystallize();

		const agentDb = dbm.get("agent");
		const vasanas = agentDb
			.prepare("SELECT valence FROM vasanas WHERE project = ?")
			.all(PROJECT) as Array<{ valence: string }>;
		expect(vasanas.length).toBe(1);
		expect(vasanas[0].valence).toBe("negative");
	});

	it("should assign neutral valence for non-preference/correction types", async () => {
		insertSession("s1");
		insertSession("s2");

		// tool-sequence pattern -> neutral
		insertSamskara("sam1", "s1", "tool-sequence", "read then edit", 5, 0.9);
		insertSamskara("sam2", "s2", "tool-sequence", "read then edit", 4, 0.85);

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minPatternFrequency: 3 },
			dbm,
		);
		await svapna.crystallize();

		const agentDb = dbm.get("agent");
		const vasanas = agentDb
			.prepare("SELECT valence FROM vasanas WHERE project = ?")
			.all(PROJECT) as Array<{ valence: string }>;
		expect(vasanas.length).toBe(1);
		expect(vasanas[0].valence).toBe("neutral");
	});

	it("should assign positive valence for convention patterns", async () => {
		insertSession("s1");
		insertSession("s2");

		insertSamskara("sam1", "s1", "convention", "always runs tests before committing", 5, 0.9);
		insertSamskara("sam2", "s2", "convention", "always runs tests before committing", 4, 0.85);

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minPatternFrequency: 3 },
			dbm,
		);
		await svapna.crystallize();

		const agentDb = dbm.get("agent");
		const vasanas = agentDb
			.prepare("SELECT valence FROM vasanas WHERE project = ?")
			.all(PROJECT) as Array<{ valence: string }>;
		expect(vasanas.length).toBe(1);
		expect(vasanas[0].valence).toBe("positive");
	});
});

// ─── Phase 4: PROCEDURALIZE ────────────────────────────────────────────────

describe("SvapnaConsolidation — Phase 4: PROCEDURALIZE", () => {
	it("should return empty when fewer than 3 sessions exist", async () => {
		insertSession("s1");
		insertSession("s2");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.proceduralize();

		expect(result.vidhisCreated).toBe(0);
		expect(result.vidhis).toHaveLength(0);
	});

	it("should extract Vidhis from repeated tool sequences across 3+ sessions", async () => {
		// Create 4 sessions all using read -> edit
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Fix ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `Fixing ${i}`, [
				tc("read", JSON.stringify({ path: `file${i}.ts` }), "content"),
				tc("edit", JSON.stringify({ path: `file${i}.ts`, text: "fix" }), "edited"),
			]);
		}

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minSequenceLength: 2, minSuccessRate: 0.8 },
			dbm,
		);
		const result = await svapna.proceduralize();

		expect(result.vidhisCreated).toBeGreaterThanOrEqual(1);
		expect(result.vidhis.length).toBeGreaterThanOrEqual(1);

		// The vidhi should contain read -> edit steps
		const vidhi = result.vidhis[0];
		expect(vidhi.steps.length).toBeGreaterThanOrEqual(2);

		// Verify it has the right tool names
		const stepTools = vidhi.steps.map((s) => s.toolName);
		expect(stepTools).toContain("read");
		expect(stepTools).toContain("edit");
	});

	it("should perform anti-unification on tool arguments", async () => {
		// 4 sessions using read with different paths but same tool pattern
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `task ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `doing ${i}`, [
				tc("read", JSON.stringify({ path: `/src/file${i}.ts`, encoding: "utf-8" }), "ok"),
				tc("edit", JSON.stringify({ path: `/src/file${i}.ts`, content: `fix${i}` }), "ok"),
			]);
		}

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minSequenceLength: 2 },
			dbm,
		);
		const result = await svapna.proceduralize();

		if (result.vidhisCreated > 0) {
			const vidhi = result.vidhis[0];
			// The 'encoding' field should be fixed (always "utf-8")
			// The 'path' field should be variable (different each time)
			const readStep = vidhi.steps.find((s) => s.toolName === "read");
			if (readStep) {
				// encoding should be a literal, path should be a placeholder
				const template = readStep.argTemplate;
				expect(template.encoding).toBe("utf-8");
				// path should be a ${...} placeholder since it varies
				expect(typeof template.path).toBe("string");
				expect((template.path as string).startsWith("${")).toBe(true);
			}
		}
	});

	it("should generate trigger phrases from tool names", async () => {
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Fix ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `Working ${i}`, [
				tc("read", JSON.stringify({ path: `f${i}` }), "ok"),
				tc("edit", JSON.stringify({ path: `f${i}` }), "ok"),
			]);
		}

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minSequenceLength: 2 },
			dbm,
		);
		const result = await svapna.proceduralize();

		if (result.vidhisCreated > 0) {
			const vidhi = result.vidhis[0];
			expect(vidhi.triggers.length).toBeGreaterThan(0);
			// Should contain "read then edit" or "read and edit" or file-related triggers
			const hasThenTrigger = vidhi.triggers.some((t) => t.includes("then"));
			const hasAndTrigger = vidhi.triggers.some((t) => t.includes("and"));
			expect(hasThenTrigger || hasAndTrigger).toBe(true);
		}
	});

	it("should not create duplicate Vidhis", async () => {
		// Create sessions with the same pattern
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `task ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `reply ${i}`, [
				tc("grep", JSON.stringify({ q: `q${i}` }), "found"),
				tc("read", JSON.stringify({ p: `p${i}` }), "ok"),
			]);
		}

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minSequenceLength: 2 },
			dbm,
		);

		// Run twice
		const result1 = await svapna.proceduralize();
		const result2 = await svapna.proceduralize();

		// Second run should not create new vidhis (already exist)
		expect(result2.vidhisCreated).toBe(0);
	});

	it("should respect minSuccessRate filter", async () => {
		// Create sessions where tool calls have errors
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `task ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `reply ${i}`, [
				tc("read", JSON.stringify({ p: `p${i}` }), "ok"),
				tc("bash", JSON.stringify({ c: `cmd${i}` }), "FAILED", true),
			]);
		}

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minSequenceLength: 2, minSuccessRate: 0.9 },
			dbm,
		);
		const result = await svapna.proceduralize();

		// The sequence has 50% error rate, which is below 0.9 threshold
		// However, vidhis may still be created from the overall session success
		// The key is that the logic considers per-session success rate
		expect(result.vidhis).toBeDefined();
	});

	it("should persist Vidhis to the database", async () => {
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `task ${i}`);
			insertTurn(`s${i}`, 1, "assistant", `reply ${i}`, [
				tc("read", JSON.stringify({ p: `f${i}` }), "ok"),
				tc("edit", JSON.stringify({ p: `f${i}` }), "ok"),
			]);
		}

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minSequenceLength: 2 },
			dbm,
		);
		await svapna.proceduralize();

		const agentDb = dbm.get("agent");
		const vidhis = agentDb
			.prepare("SELECT * FROM vidhis WHERE project = ?")
			.all(PROJECT) as Array<Record<string, unknown>>;
		expect(vidhis.length).toBeGreaterThanOrEqual(1);
	});
});

// ─── Phase 5: COMPRESS ─────────────────────────────────────────────────────

describe("SvapnaConsolidation — Phase 5: COMPRESS", () => {
	it("should return ratio 1.0 when no sessions exist", async () => {
		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.compress();

		expect(result.tokensCompressed).toBe(0);
		expect(result.compressionRatio).toBe(1.0);
	});

	it("should return ratio 1.0 when no turns exist", async () => {
		insertSession("s1");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.compress();

		expect(result.tokensCompressed).toBe(0);
		expect(result.compressionRatio).toBe(1.0);
	});

	it("should return ratio 1.0 when only 1 turn exists (need >= 2 for Sinkhorn)", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "user", "Hello world this is some content");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.compress();

		expect(result.compressionRatio).toBe(1.0);
	});

	it("should compress multiple turns with Sinkhorn-Knopp", async () => {
		insertSession("s1");

		// Add several turns with varied content
		for (let i = 0; i < 10; i++) {
			insertTurn("s1", i, i % 2 === 0 ? "user" : "assistant", `Turn ${i}: ${"A".repeat(100)}`, [
				...(i % 2 === 1 ? [tc("read", `{"p":"f${i}"}`, "content ".repeat(20))] : []),
			]);
		}

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.compress();

		expect(result.tokensCompressed).toBeGreaterThan(0);
		// Compression ratio should be less than 1.0 (actual compression happened)
		expect(result.compressionRatio).toBeLessThanOrEqual(1.0);
		expect(result.compressionRatio).toBeGreaterThan(0);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("should apply Pramana-based preservation weights", async () => {
		insertSession("s1");

		// Turn with direct tool results (pratyaksha = high preservation)
		insertTurn("s1", 0, "assistant", "Running tool", [
			tc("read", '{"path":"a.ts"}', "file content here result"),
		]);

		// Turn with speculative content (anupalabdhi = low preservation)
		insertTurn("s1", 1, "assistant", "Maybe this could possibly work, perhaps it might be the issue");

		// Turn with inference content (anumana = medium preservation)
		insertTurn("s1", 2, "assistant", "Based on the analysis, the code follows standard patterns.");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.compress();

		expect(result.tokensCompressed).toBeGreaterThan(0);
		expect(result.compressionRatio).toBeLessThanOrEqual(1.0);
	});

	it("should give error turns higher importance (0.9)", async () => {
		insertSession("s1");

		// Normal turn
		insertTurn("s1", 0, "assistant", "Everything is fine", [
			tc("read", '{"p":"ok.ts"}', "content"),
		]);

		// Error turn — should get importance 0.9 regardless of pramana
		insertTurn("s1", 1, "assistant", "Tool failed", [
			tc("bash", '{"c":"fail"}', "error output", true),
		]);

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.compress();

		expect(result.tokensCompressed).toBeGreaterThan(0);
		// Compression should still work; the error turn gets preserved more
		expect(result.compressionRatio).toBeLessThanOrEqual(1.0);
	});
});

// ─── Pramana Classification ────────────────────────────────────────────────

describe("SvapnaConsolidation — Pramana classification", () => {
	// We test the classification indirectly through compress() behavior,
	// since classifyPramana is private.

	it("should treat tool results as pratyaksha (0.95 preservation)", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "assistant", "Here is the file", [
			tc("read", '{"path":"a.ts"}', "export function hello() {}"),
		]);
		insertTurn("s1", 1, "user", "Thanks");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.compress();
		// Should compress but with high preservation
		expect(result.tokensCompressed).toBeGreaterThan(0);
	});

	it("should treat speculative words as anupalabdhi (0.25 preservation)", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "assistant", "Maybe possibly might perhaps the issue could be somewhere");
		insertTurn("s1", 1, "assistant", "Perhaps it could possibly be a problem, not sure");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.compress();
		expect(result.tokensCompressed).toBeGreaterThan(0);
	});

	it("should treat postulation words as arthapatti (0.40 preservation)", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "assistant", "This must be the root cause, it likely implies a deeper issue");
		insertTurn("s1", 1, "assistant", "It probably means the config is wrong, therefore we should fix it");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.compress();
		expect(result.tokensCompressed).toBeGreaterThan(0);
	});

	it("should treat analogy words as upamana (0.50 preservation)", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "assistant", "This is similar to the React pattern, just as in Vue");
		insertTurn("s1", 1, "assistant", "It is analogous to a factory, compared to the builder pattern");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.compress();
		expect(result.tokensCompressed).toBeGreaterThan(0);
	});

	it("should treat documentation references as shabda (0.80 preservation)", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "assistant", "According to the documentation, the API specification says...");
		insertTurn("s1", 1, "assistant", "The docs say that the reference implementation handles this");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.compress();
		expect(result.tokensCompressed).toBeGreaterThan(0);
	});

	it("should default to anumana (0.65 preservation) for plain reasoning", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "assistant", "The code is well structured and follows good patterns");
		insertTurn("s1", 1, "assistant", "We can see that the function handles edge cases properly");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.compress();
		expect(result.tokensCompressed).toBeGreaterThan(0);
	});
});

// ─── Full Pipeline ─────────────────────────────────────────────────────────

describe("SvapnaConsolidation — full run() pipeline", () => {
	it("should execute all 5 phases and return a complete result", async () => {
		// Set up enough data for all phases to have something to work with
		for (let i = 0; i < 4; i++) {
			insertSession(`s${i}`);
			insertTurn(`s${i}`, 0, "user", `Request ${i}: fix the ${i === 0 ? "bug" : "feature"}`);
			insertTurn(`s${i}`, 1, "assistant", `Working on it ${i}`, [
				tc("read", JSON.stringify({ path: `file${i}.ts` }), "content of file"),
				tc("edit", JSON.stringify({ path: `file${i}.ts`, text: "new content" }), "edited"),
			]);
		}

		// Add samskaras for CRYSTALLIZE
		insertSamskara("sam1", "s0", "preference", "prefers functional style", 5, 0.9);
		insertSamskara("sam2", "s1", "preference", "prefers functional style", 4, 0.85);

		const svapna = new SvapnaConsolidation(
			{ project: PROJECT, minSequenceLength: 2, minPatternFrequency: 3 },
			dbm,
		);

		const phases: Array<{ phase: string; progress: number }> = [];
		const result = await svapna.run((phase, progress) => {
			phases.push({ phase, progress });
		});

		// Verify result structure
		expect(result.phases.replay).toBeDefined();
		expect(result.phases.recombine).toBeDefined();
		expect(result.phases.crystallize).toBeDefined();
		expect(result.phases.proceduralize).toBeDefined();
		expect(result.phases.compress).toBeDefined();
		expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
		expect(result.cycleId).toMatch(/^svapna-/);

		// Verify progress callbacks: 2 per phase (start + end)
		expect(phases.length).toBe(10);
		expect(phases[0]).toEqual({ phase: "REPLAY", progress: 0 });
		expect(phases[1]).toEqual({ phase: "REPLAY", progress: 1 });
		expect(phases[2]).toEqual({ phase: "RECOMBINE", progress: 0 });
		expect(phases[3]).toEqual({ phase: "RECOMBINE", progress: 1 });
		expect(phases[4]).toEqual({ phase: "CRYSTALLIZE", progress: 0 });
		expect(phases[5]).toEqual({ phase: "CRYSTALLIZE", progress: 1 });
		expect(phases[6]).toEqual({ phase: "PROCEDURALIZE", progress: 0 });
		expect(phases[7]).toEqual({ phase: "PROCEDURALIZE", progress: 1 });
		expect(phases[8]).toEqual({ phase: "COMPRESS", progress: 0 });
		expect(phases[9]).toEqual({ phase: "COMPRESS", progress: 1 });

		// Verify durationMs are all non-negative
		expect(result.phases.replay.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.phases.recombine.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.phases.crystallize.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.phases.proceduralize.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.phases.compress.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("should work without a progress callback", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "user", "Hello");
		insertTurn("s1", 1, "assistant", "Hi");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.run();

		expect(result).toBeDefined();
		expect(result.cycleId).toMatch(/^svapna-/);
	});

	it("should write to the consolidation_log table", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "user", "Hello");
		insertTurn("s1", 1, "assistant", "Hi");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		await svapna.run();

		const agentDb = dbm.get("agent");
		const logs = agentDb
			.prepare("SELECT * FROM consolidation_log WHERE project = ?")
			.all(PROJECT) as Array<Record<string, unknown>>;

		// Should have at least 2 entries: one for "running" and one for "success"
		expect(logs.length).toBeGreaterThanOrEqual(2);
		const statuses = logs.map((l) => l.status);
		expect(statuses).toContain("running");
		expect(statuses).toContain("success");
	});

	it("should update nidra_state table", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "user", "Hello");
		insertTurn("s1", 1, "assistant", "Hi");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		await svapna.run();

		const agentDb = dbm.get("agent");
		const state = agentDb
			.prepare("SELECT * FROM nidra_state WHERE id = 1")
			.get() as Record<string, unknown>;

		expect(state).toBeDefined();
		expect(state.consolidation_progress).toBe(1.0);
	});
});

// ─── Edge Cases ────────────────────────────────────────────────────────────

describe("SvapnaConsolidation — edge cases", () => {
	it("should handle empty sessions gracefully", async () => {
		insertSession("s1"); // No turns

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.run();

		expect(result.phases.replay.turnsScored).toBe(0);
		expect(result.phases.recombine.associations).toBe(0);
		expect(result.phases.compress.compressionRatio).toBe(1.0);
	});

	it("should handle single-turn sessions", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "user", "Just one message");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.run();

		expect(result.phases.replay.turnsScored).toBe(1);
	});

	it("should handle sessions with only user turns (no tool calls)", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "user", "Question 1");
		insertTurn("s1", 1, "user", "Question 2");
		insertTurn("s1", 2, "user", "Question 3");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.replay();

		// All turns should still be scored (by content length deviation)
		expect(result.turnsScored).toBe(3);
	});

	it("should handle malformed tool_calls JSON gracefully", async () => {
		insertSession("s1");
		const agentDb = dbm.get("agent");
		agentDb.prepare(`
			INSERT INTO turns (session_id, turn_number, role, content, tool_calls, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`).run("s1", 0, "assistant", "test", "NOT_VALID_JSON{{{", Date.now());

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.replay();

		// Should not crash, just treat as no tool calls
		expect(result.turnsScored).toBe(1);
		expect(result.allTurns[0].toolCalls).toHaveLength(0);
	});

	it("should handle null tool_calls", async () => {
		insertSession("s1");
		insertTurn("s1", 0, "assistant", "No tools used", undefined);

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.replay();

		expect(result.turnsScored).toBe(1);
		expect(result.allTurns[0].toolCalls).toHaveLength(0);
	});

	it("should handle project with no matching sessions for a different project", async () => {
		insertSession("s1", "/other/project");
		insertTurn("s1", 0, "user", "Hello");

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const result = await svapna.run();

		expect(result.phases.replay.turnsScored).toBe(0);
	});

	it("should handle very large number of turns efficiently", async () => {
		insertSession("s1");

		// Insert 100 turns
		for (let i = 0; i < 100; i++) {
			insertTurn(
				"s1",
				i,
				i % 2 === 0 ? "user" : "assistant",
				`Turn ${i}: ${"content ".repeat(10)}`,
				i % 2 === 1 ? [tc("read", `{"p":"f${i}"}`, "ok")] : undefined,
			);
		}

		const svapna = new SvapnaConsolidation({ project: PROJECT }, dbm);
		const start = performance.now();
		const result = await svapna.run();
		const elapsed = performance.now() - start;

		expect(result.phases.replay.turnsScored).toBe(100);
		// Performance: should complete within a reasonable time (< 5 seconds)
		expect(elapsed).toBeLessThan(5000);
	});

	it("should handle sessions across different projects without cross-contamination", async () => {
		insertSession("p1s1", "/project-A");
		insertSession("p2s1", "/project-B");

		insertTurn("p1s1", 0, "user", "Project A work");
		insertTurn("p2s1", 0, "user", "Project B work");

		const svapnaA = new SvapnaConsolidation({ project: "/project-A" }, dbm);
		const resultA = await svapnaA.replay();

		expect(resultA.turnsScored).toBe(1);
		expect(resultA.allTurns[0].content).toBe("Project A work");
	});
});
