/**
 * @chitragupta/anina — Pratyabhijna (Self-Recognition) Tests.
 *
 * Tests the identity reconstruction pipeline that runs on every session
 * start: loading vasanas, samskaras, tool mastery, cross-project insights,
 * generating an identity narrative, persisting to SQLite, and caching.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAgentSchema } from "@chitragupta/smriti/db/schema";
import { Pratyabhijna } from "../src/pratyabhijna.js";
import { DEFAULT_PRATYABHIJNA_CONFIG } from "../src/types.js";
import type { PratyabhijnaConfig, PratyabhijnaContext } from "../src/types.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

let tmpDir: string;
let dbm: DatabaseManager;

function freshDb(): DatabaseManager {
	DatabaseManager.reset();
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pratyabhijna-test-"));
	dbm = DatabaseManager.instance(tmpDir);
	initAgentSchema(dbm);
	return dbm;
}

/** Insert a vasana row into agent.db. */
function insertVasana(
	db: DatabaseManager,
	opts: {
		name: string;
		description?: string;
		valence?: "positive" | "negative" | "neutral";
		strength?: number;
		stability?: number;
		project?: string | null;
		lastActivated?: number | null;
		activationCount?: number;
		createdAt?: number;
	},
): void {
	const agentDb = db.get("agent");
	const now = Date.now();
	agentDb
		.prepare(
			`INSERT INTO vasanas
				(name, description, valence, strength, stability, source_samskaras,
				 project, created_at, updated_at, last_activated, activation_count)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			opts.name,
			opts.description ?? `${opts.name} description`,
			opts.valence ?? "positive",
			opts.strength ?? 0.8,
			opts.stability ?? 0.5,
			null,
			opts.project === undefined ? null : opts.project,
			opts.createdAt ?? now,
			now,
			opts.lastActivated === undefined ? now : opts.lastActivated,
			opts.activationCount ?? 1,
		);
}

/** Insert a samskara row into agent.db. */
function insertSamskara(
	db: DatabaseManager,
	opts: {
		id: string;
		sessionId?: string;
		patternType?: "tool-sequence" | "preference" | "decision" | "correction" | "convention";
		patternContent: string;
		confidence?: number;
		project?: string | null;
		observationCount?: number;
	},
): void {
	const agentDb = db.get("agent");
	const now = Date.now();
	agentDb
		.prepare(
			`INSERT INTO samskaras
				(id, session_id, pattern_type, pattern_content, observation_count,
				 confidence, pramana_type, project, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			opts.id,
			opts.sessionId ?? "session-1",
			opts.patternType ?? "preference",
			opts.patternContent,
			opts.observationCount ?? 1,
			opts.confidence ?? 0.7,
			null,
			opts.project === undefined ? "/test/project" : opts.project,
			now,
			now,
		);
}

/** Insert a session row into agent.db. */
function insertSession(
	db: DatabaseManager,
	opts: {
		id: string;
		project: string;
		title?: string;
		updatedAt?: number;
	},
): void {
	const agentDb = db.get("agent");
	const now = Date.now();
	agentDb
		.prepare(
			`INSERT INTO sessions
				(id, project, title, created_at, updated_at, turn_count, file_path)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			opts.id,
			opts.project,
			opts.title ?? "Test Session",
			now,
			opts.updatedAt ?? now,
			0,
			`sessions/${opts.id}.md`,
		);
}

/** Create a mock ChetanaController with getCognitiveReport(). */
function mockChetana(tools: Array<{ tool: string; successRate: number }>) {
	return {
		getCognitiveReport: () => ({
			affect: { valence: 0, arousal: 0.3, confidence: 0.5, frustration: 0 },
			topConcepts: [],
			topTools: [],
			selfSummary: {
				calibration: 0.5,
				learningVelocity: 0,
				topTools: tools.map((t) => ({
					tool: t.tool,
					mastery: {
						successRate: t.successRate,
						totalCalls: 10,
						wilsonLowerBound: t.successRate * 0.9,
					},
				})),
				limitations: [],
				style: new Map<string, number>(),
			},
			intentions: [],
		}),
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Pratyabhijna — Self-Recognition", () => {
	beforeEach(() => {
		freshDb();
	});

	afterEach(() => {
		DatabaseManager.reset();
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ── 1. Construction ──────────────────────────────────────────────────

	describe("construction", () => {
		it("should construct with default config", () => {
			const p = new Pratyabhijna();
			expect(p).toBeInstanceOf(Pratyabhijna);
		});

		it("should construct with custom config", () => {
			const custom: Partial<PratyabhijnaConfig> = {
				topK: 5,
				maxSamskaras: 10,
				maxCrossProject: 3,
				warmupBudgetMs: 50,
			};
			const p = new Pratyabhijna(custom);
			expect(p).toBeInstanceOf(Pratyabhijna);
		});

		it("should merge custom config with defaults", () => {
			const p = new Pratyabhijna({ topK: 3 });
			// Verify it works with the custom topK (only loads 3 vasanas)
			insertVasana(dbm, { name: "v1", strength: 0.9 });
			insertVasana(dbm, { name: "v2", strength: 0.8 });
			insertVasana(dbm, { name: "v3", strength: 0.7 });
			insertVasana(dbm, { name: "v4", strength: 0.6 });
			insertSession(dbm, { id: "s1", project: "/test/project" });

			const ctx = p.recognize("s1", "/test/project", dbm);
			// Global vasanas should be capped at topK=3
			expect(ctx.globalVasanas.length).toBeLessThanOrEqual(3);
		});
	});

	// ── 2. Full recognize() pipeline ─────────────────────────────────────

	describe("recognize() — full pipeline", () => {
		it("should load global vasanas sorted by decayed score", () => {
			const p = new Pratyabhijna();
			const now = Date.now();
			// Recent vasana — high score
			insertVasana(dbm, {
				name: "recent-vasana",
				strength: 0.8,
				lastActivated: now - 1000, // 1 second ago
			});
			// Old vasana — should decay
			insertVasana(dbm, {
				name: "old-vasana",
				strength: 0.8,
				lastActivated: now - 30 * 24 * 60 * 60 * 1000, // 30 days ago
			});
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.globalVasanas.length).toBe(2);
			// Recent should have higher decayed score
			expect(ctx.globalVasanas[0].tendency).toBe("recent-vasana");
			expect(ctx.globalVasanas[0].strength).toBeGreaterThan(ctx.globalVasanas[1].strength);
		});

		it("should load project-specific vasanas", () => {
			const p = new Pratyabhijna();
			insertVasana(dbm, {
				name: "project-specific",
				strength: 0.9,
				project: "/test/project",
				lastActivated: Date.now(),
			});
			insertVasana(dbm, {
				name: "other-project",
				strength: 0.9,
				project: "/other/project",
				lastActivated: Date.now(),
			});
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.projectVasanas.length).toBe(1);
			expect(ctx.projectVasanas[0].tendency).toBe("project-specific");
		});

		it("should load active samskaras with confidence > 0.3", () => {
			const p = new Pratyabhijna();
			insertSamskara(dbm, {
				id: "s1",
				patternContent: "tabs over spaces",
				confidence: 0.8,
				project: "/test/project",
			});
			insertSamskara(dbm, {
				id: "s2",
				patternContent: "low confidence",
				confidence: 0.2, // below 0.3 threshold
				project: "/test/project",
			});
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.activeSamskaras.length).toBe(1);
			expect(ctx.activeSamskaras[0].patternContent).toBe("tabs over spaces");
		});

		it("should load tool mastery from ChetanaController", () => {
			const p = new Pratyabhijna();
			const chetana = mockChetana([
				{ tool: "grep", successRate: 0.95 },
				{ tool: "edit", successRate: 0.88 },
			]);
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize(
				"sess-1",
				"/test/project",
				dbm,
				chetana as any,
			);
			expect(ctx.toolMastery["grep"]).toBe(0.95);
			expect(ctx.toolMastery["edit"]).toBe(0.88);
		});

		it("should load cross-project insights from other projects", () => {
			const p = new Pratyabhijna();
			const now = Date.now();

			// Insert sessions for another project
			insertSession(dbm, { id: "other-sess", project: "/other/cool-app", updatedAt: now });

			// Insert vasanas for that other project
			insertVasana(dbm, {
				name: "prefer-functional-style",
				strength: 0.9,
				project: "/other/cool-app",
				lastActivated: now,
			});

			// Insert session for current project
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.crossProjectInsights.length).toBeGreaterThan(0);
			expect(ctx.crossProjectInsights[0]).toContain("cool-app");
			expect(ctx.crossProjectInsights[0]).toContain("prefer functional style");
		});

		it("should generate identity narrative", () => {
			const p = new Pratyabhijna();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.identitySummary).toContain("Chitragupta");
		});

		it("should persist to pratyabhijna_context table", () => {
			const p = new Pratyabhijna();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			p.recognize("sess-1", "/test/project", dbm);

			const row = dbm
				.get("agent")
				.prepare("SELECT * FROM pratyabhijna_context WHERE session_id = ?")
				.get("sess-1") as any;

			expect(row).toBeTruthy();
			expect(row.session_id).toBe("sess-1");
			expect(row.project).toBe("/test/project");
			expect(row.identity_summary).toContain("Chitragupta");
		});

		it("should record warmup time", () => {
			const p = new Pratyabhijna();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.warmupMs).toBeGreaterThanOrEqual(0);
			expect(typeof ctx.warmupMs).toBe("number");
		});

		it("should set createdAt timestamp", () => {
			const p = new Pratyabhijna();
			const before = Date.now();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.createdAt).toBeGreaterThanOrEqual(before);
			expect(ctx.createdAt).toBeLessThanOrEqual(Date.now());
		});
	});

	// ── 3. Session cache ─────────────────────────────────────────────────

	describe("session cache", () => {
		it("should cache the result on first recognize()", () => {
			const p = new Pratyabhijna();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx1 = p.recognize("sess-1", "/test/project", dbm);
			const ctx2 = p.recognize("sess-1", "/test/project", dbm);
			// Same reference — second call returns cached result
			expect(ctx1).toBe(ctx2);
		});

		it("should return different contexts for different sessions", () => {
			const p = new Pratyabhijna();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });
			insertSession(dbm, { id: "sess-2", project: "/test/project" });

			const ctx1 = p.recognize("sess-1", "/test/project", dbm);
			const ctx2 = p.recognize("sess-2", "/test/project", dbm);
			expect(ctx1).not.toBe(ctx2);
			expect(ctx1.sessionId).toBe("sess-1");
			expect(ctx2.sessionId).toBe("sess-2");
		});

		it("should return cached context via getContext()", () => {
			const p = new Pratyabhijna();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			expect(p.getContext("sess-1")).toBeNull();
			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(p.getContext("sess-1")).toBe(ctx);
		});

		it("should return null for unrecognized session from getContext()", () => {
			const p = new Pratyabhijna();
			expect(p.getContext("nonexistent")).toBeNull();
		});
	});

	// ── 4. generateNarrative() ───────────────────────────────────────────

	describe("generateNarrative()", () => {
		it("should include 'first session' when no last session timestamp", () => {
			const p = new Pratyabhijna();
			const ctx: PratyabhijnaContext = {
				sessionId: "s1",
				project: "/test",
				identitySummary: "",
				globalVasanas: [],
				projectVasanas: [],
				activeSamskaras: [],
				crossProjectInsights: [],
				toolMastery: {},
				warmupMs: 0,
				createdAt: Date.now(),
			};

			const narrative = p.generateNarrative(ctx, 0, Date.now());
			expect(narrative).toContain("first session");
		});

		it("should include relative time for previous session", () => {
			const p = new Pratyabhijna();
			const now = Date.now();
			const ctx: PratyabhijnaContext = {
				sessionId: "s1",
				project: "/test",
				identitySummary: "",
				globalVasanas: [],
				projectVasanas: [],
				activeSamskaras: [],
				crossProjectInsights: [],
				toolMastery: {},
				warmupMs: 0,
				createdAt: now,
			};

			// 2 hours ago
			const lastSession = now - 2 * 3_600_000;
			const narrative = p.generateNarrative(ctx, lastSession, now);
			expect(narrative).toContain("2 hours ago");
		});

		it("should list top insights from positive/neutral vasanas", () => {
			const p = new Pratyabhijna();
			const ctx: PratyabhijnaContext = {
				sessionId: "s1",
				project: "/test",
				identitySummary: "",
				globalVasanas: [
					{ tendency: "prefer-functional-style", strength: 0.9, valence: "positive" },
				],
				projectVasanas: [
					{ tendency: "test-before-commit", strength: 0.8, valence: "neutral" },
				],
				activeSamskaras: [],
				crossProjectInsights: [],
				toolMastery: {},
				warmupMs: 0,
				createdAt: Date.now(),
			};

			const narrative = p.generateNarrative(ctx, 0, Date.now());
			expect(narrative).toContain("I know:");
			expect(narrative).toContain("prefer functional style");
			expect(narrative).toContain("test before commit");
		});

		it("should list tool mastery", () => {
			const p = new Pratyabhijna();
			const ctx: PratyabhijnaContext = {
				sessionId: "s1",
				project: "/test",
				identitySummary: "",
				globalVasanas: [],
				projectVasanas: [],
				activeSamskaras: [],
				crossProjectInsights: [],
				toolMastery: { grep: 0.95, edit: 0.8 },
				warmupMs: 0,
				createdAt: Date.now(),
			};

			const narrative = p.generateNarrative(ctx, 0, Date.now());
			expect(narrative).toContain("I'm good at:");
			expect(narrative).toContain("grep (95%)");
			expect(narrative).toContain("edit (80%)");
		});

		it("should list struggles from negative vasanas", () => {
			const p = new Pratyabhijna();
			const ctx: PratyabhijnaContext = {
				sessionId: "s1",
				project: "/test",
				identitySummary: "",
				globalVasanas: [
					{ tendency: "over-engineering", strength: 0.7, valence: "negative" },
				],
				projectVasanas: [],
				activeSamskaras: [],
				crossProjectInsights: [],
				toolMastery: {},
				warmupMs: 0,
				createdAt: Date.now(),
			};

			const narrative = p.generateNarrative(ctx, 0, Date.now());
			expect(narrative).toContain("I struggle with:");
			expect(narrative).toContain("over engineering");
		});

		it("should list user preferences from preference samskaras", () => {
			const p = new Pratyabhijna();
			const ctx: PratyabhijnaContext = {
				sessionId: "s1",
				project: "/test",
				identitySummary: "",
				globalVasanas: [],
				projectVasanas: [],
				activeSamskaras: [
					{ patternType: "preference", patternContent: "tabs over spaces", confidence: 0.9 },
					{ patternType: "decision", patternContent: "some decision", confidence: 0.8 },
				],
				crossProjectInsights: [],
				toolMastery: {},
				warmupMs: 0,
				createdAt: Date.now(),
			};

			const narrative = p.generateNarrative(ctx, 0, Date.now());
			expect(narrative).toContain("User prefers:");
			expect(narrative).toContain("tabs over spaces");
			expect(narrative).not.toContain("some decision");
		});

		it("should include cross-project insights", () => {
			const p = new Pratyabhijna();
			const ctx: PratyabhijnaContext = {
				sessionId: "s1",
				project: "/test",
				identitySummary: "",
				globalVasanas: [],
				projectVasanas: [],
				activeSamskaras: [],
				crossProjectInsights: ["In my-app: prefer functional style"],
				toolMastery: {},
				warmupMs: 0,
				createdAt: Date.now(),
			};

			const narrative = p.generateNarrative(ctx, 0, Date.now());
			expect(narrative).toContain("Cross-project:");
			expect(narrative).toContain("In my-app: prefer functional style");
		});

		it("should not include empty sections", () => {
			const p = new Pratyabhijna();
			const ctx: PratyabhijnaContext = {
				sessionId: "s1",
				project: "/test",
				identitySummary: "",
				globalVasanas: [],
				projectVasanas: [],
				activeSamskaras: [],
				crossProjectInsights: [],
				toolMastery: {},
				warmupMs: 0,
				createdAt: Date.now(),
			};

			const narrative = p.generateNarrative(ctx, 0, Date.now());
			expect(narrative).toContain("Chitragupta");
			expect(narrative).not.toContain("I know:");
			expect(narrative).not.toContain("I'm good at:");
			expect(narrative).not.toContain("I struggle with:");
			expect(narrative).not.toContain("User prefers:");
			expect(narrative).not.toContain("Cross-project:");
		});
	});

	// ── 5. persist() / loadPrevious() — SQLite roundtrip ─────────────────

	describe("persist() / loadPrevious() — SQLite roundtrip", () => {
		it("should persist and reload a context", () => {
			const p = new Pratyabhijna();
			const ctx: PratyabhijnaContext = {
				sessionId: "sess-persist",
				project: "/roundtrip/test",
				identitySummary: "I am Chitragupta. This is a test.",
				globalVasanas: [{ tendency: "prefer-tabs", strength: 0.9, valence: "positive" }],
				projectVasanas: [{ tendency: "test-first", strength: 0.7, valence: "neutral" }],
				activeSamskaras: [
					{ patternType: "preference", patternContent: "dark theme", confidence: 0.85 },
				],
				crossProjectInsights: ["In my-app: use TypeScript"],
				toolMastery: { grep: 0.95, edit: 0.88 },
				warmupMs: 12.5,
				createdAt: Date.now(),
			};

			p.persist(ctx, dbm);
			const loaded = p.loadPrevious("/roundtrip/test", dbm);

			expect(loaded).not.toBeNull();
			expect(loaded!.sessionId).toBe("sess-persist");
			expect(loaded!.project).toBe("/roundtrip/test");
			expect(loaded!.identitySummary).toBe("I am Chitragupta. This is a test.");
			expect(loaded!.globalVasanas).toEqual([{ tendency: "prefer-tabs", strength: 0.9, valence: "positive" }]);
			expect(loaded!.projectVasanas).toEqual([{ tendency: "test-first", strength: 0.7, valence: "neutral" }]);
			expect(loaded!.activeSamskaras).toEqual([
				{ patternType: "preference", patternContent: "dark theme", confidence: 0.85 },
			]);
			expect(loaded!.crossProjectInsights).toEqual(["In my-app: use TypeScript"]);
			expect(loaded!.toolMastery).toEqual({ grep: 0.95, edit: 0.88 });
			expect(loaded!.warmupMs).toBeCloseTo(12.5, 1);
		});

		it("should return null when no previous context exists", () => {
			const p = new Pratyabhijna();
			const loaded = p.loadPrevious("/nonexistent/project", dbm);
			expect(loaded).toBeNull();
		});

		it("should load the most recent context when multiple exist", () => {
			const p = new Pratyabhijna();
			const now = Date.now();

			// First context — older
			const ctx1: PratyabhijnaContext = {
				sessionId: "sess-old",
				project: "/multi/test",
				identitySummary: "Old identity",
				globalVasanas: [],
				projectVasanas: [],
				activeSamskaras: [],
				crossProjectInsights: [],
				toolMastery: {},
				warmupMs: 0,
				createdAt: now - 10000,
			};
			p.persist(ctx1, dbm);

			// Second context — newer
			const ctx2: PratyabhijnaContext = {
				sessionId: "sess-new",
				project: "/multi/test",
				identitySummary: "New identity",
				globalVasanas: [],
				projectVasanas: [],
				activeSamskaras: [],
				crossProjectInsights: [],
				toolMastery: {},
				warmupMs: 0,
				createdAt: now,
			};
			p.persist(ctx2, dbm);

			const loaded = p.loadPrevious("/multi/test", dbm);
			expect(loaded).not.toBeNull();
			expect(loaded!.sessionId).toBe("sess-new");
			expect(loaded!.identitySummary).toBe("New identity");
		});

		it("should handle empty JSON arrays in loaded context", () => {
			const p = new Pratyabhijna();
			const ctx: PratyabhijnaContext = {
				sessionId: "sess-empty",
				project: "/empty/test",
				identitySummary: "",
				globalVasanas: [],
				projectVasanas: [],
				activeSamskaras: [],
				crossProjectInsights: [],
				toolMastery: {},
				warmupMs: 0,
				createdAt: Date.now(),
			};

			p.persist(ctx, dbm);
			const loaded = p.loadPrevious("/empty/test", dbm);
			expect(loaded).not.toBeNull();
			expect(loaded!.globalVasanas).toEqual([]);
			expect(loaded!.projectVasanas).toEqual([]);
			expect(loaded!.activeSamskaras).toEqual([]);
			expect(loaded!.crossProjectInsights).toEqual([]);
			expect(loaded!.toolMastery).toEqual({});
		});
	});

	// ── 6. evict() ───────────────────────────────────────────────────────

	describe("evict()", () => {
		it("should remove a session from cache", () => {
			const p = new Pratyabhijna();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			p.recognize("sess-1", "/test/project", dbm);
			expect(p.getContext("sess-1")).not.toBeNull();

			p.evict("sess-1");
			expect(p.getContext("sess-1")).toBeNull();
		});

		it("should be safe to evict a non-existent session", () => {
			const p = new Pratyabhijna();
			expect(() => p.evict("nonexistent")).not.toThrow();
		});

		it("should not affect other cached sessions", () => {
			const p = new Pratyabhijna();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });
			insertSession(dbm, { id: "sess-2", project: "/test/project" });

			p.recognize("sess-1", "/test/project", dbm);
			p.recognize("sess-2", "/test/project", dbm);

			p.evict("sess-1");
			expect(p.getContext("sess-1")).toBeNull();
			expect(p.getContext("sess-2")).not.toBeNull();
		});
	});

	// ── 7. clearCache() ─────────────────────────────────────────────────

	describe("clearCache()", () => {
		it("should clear all cached contexts", () => {
			const p = new Pratyabhijna();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });
			insertSession(dbm, { id: "sess-2", project: "/test/project" });

			p.recognize("sess-1", "/test/project", dbm);
			p.recognize("sess-2", "/test/project", dbm);

			p.clearCache();
			expect(p.getContext("sess-1")).toBeNull();
			expect(p.getContext("sess-2")).toBeNull();
		});

		it("should allow re-recognition after cache clear", () => {
			const p = new Pratyabhijna();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx1 = p.recognize("sess-1", "/test/project", dbm);
			p.clearCache();

			// Need to re-initialize the statement cache, so create a fresh DB manager
			DatabaseManager.reset();
			dbm = DatabaseManager.instance(tmpDir);

			const ctx2 = p.recognize("sess-1", "/test/project", dbm);
			// Different references but same data
			expect(ctx2).not.toBe(ctx1);
			expect(ctx2.sessionId).toBe("sess-1");
		});
	});

	// ── 8. Temporal decay scoring ────────────────────────────────────────

	describe("temporal decay scoring", () => {
		it("should apply full strength for very recent activations", () => {
			const p = new Pratyabhijna();
			const now = Date.now();
			insertVasana(dbm, {
				name: "very-recent",
				strength: 1.0,
				lastActivated: now - 100, // 100ms ago
			});
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			// With very recent activation, decayed score should be close to full strength
			expect(ctx.globalVasanas[0].strength).toBeGreaterThan(0.99);
		});

		it("should halve strength after one half-life (7 days)", () => {
			const p = new Pratyabhijna();
			const now = Date.now();
			const sevenDays = 7 * 24 * 60 * 60 * 1000;
			insertVasana(dbm, {
				name: "week-old",
				strength: 1.0,
				lastActivated: now - sevenDays,
			});
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			// After exactly one half-life, strength should be approximately 0.5
			expect(ctx.globalVasanas[0].strength).toBeCloseTo(0.5, 1);
		});

		it("should use baseline for never-activated vasanas", () => {
			const p = new Pratyabhijna();
			insertVasana(dbm, {
				name: "never-activated",
				strength: 1.0,
				lastActivated: null,
			});
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			// Never-activated should use 0.1 * strength baseline
			expect(ctx.globalVasanas[0].strength).toBeCloseTo(0.1, 2);
		});

		it("should use baseline for zero lastActivated", () => {
			const p = new Pratyabhijna();
			insertVasana(dbm, {
				name: "zero-activated",
				strength: 0.8,
				lastActivated: 0,
			});
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			// lastActivated = 0 treated as never-activated
			expect(ctx.globalVasanas[0].strength).toBeCloseTo(0.08, 2);
		});

		it("should rank vasanas by decayed score, not raw strength", () => {
			const p = new Pratyabhijna();
			const now = Date.now();
			const sevenDays = 7 * 24 * 60 * 60 * 1000;

			// High strength but old
			insertVasana(dbm, {
				name: "high-old",
				strength: 1.0,
				lastActivated: now - 4 * sevenDays, // 4 half-lives ago
			});
			// Lower strength but recent
			insertVasana(dbm, {
				name: "low-recent",
				strength: 0.5,
				lastActivated: now - 1000,
			});
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			// Recent vasana should rank higher despite lower raw strength
			expect(ctx.globalVasanas[0].tendency).toBe("low-recent");
		});
	});

	// ── 9. Cross-project insight loading ─────────────────────────────────

	describe("cross-project insights", () => {
		it("should not include current project in insights", () => {
			const p = new Pratyabhijna();
			const now = Date.now();
			insertSession(dbm, { id: "sess-1", project: "/test/project", updatedAt: now });
			insertVasana(dbm, {
				name: "current-project-vasana",
				strength: 0.9,
				project: "/test/project",
				lastActivated: now,
			});

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			// Cross-project insights should not reference the current project
			for (const insight of ctx.crossProjectInsights) {
				expect(insight).not.toContain("In project:");
			}
		});

		it("should not include __global__ project in insights", () => {
			const p = new Pratyabhijna();
			const now = Date.now();
			insertSession(dbm, { id: "global-sess", project: "__global__", updatedAt: now });
			insertVasana(dbm, {
				name: "global-vasana",
				strength: 0.9,
				project: "__global__",
				lastActivated: now,
			});
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			for (const insight of ctx.crossProjectInsights) {
				expect(insight).not.toContain("__global__");
			}
		});

		it("should extract short project label from full path", () => {
			const p = new Pratyabhijna();
			const now = Date.now();
			insertSession(dbm, {
				id: "other-sess",
				project: "/Users/dev/Projects/awesome-lib",
				updatedAt: now,
			});
			insertVasana(dbm, {
				name: "modular-design",
				strength: 0.9,
				project: "/Users/dev/Projects/awesome-lib",
				lastActivated: now,
			});
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.crossProjectInsights.length).toBeGreaterThan(0);
			expect(ctx.crossProjectInsights[0]).toContain("In awesome-lib:");
		});

		it("should filter out low-score cross-project vasanas", () => {
			const p = new Pratyabhijna();
			const now = Date.now();
			const halfLifeMs = 7 * 24 * 60 * 60 * 1000;

			insertSession(dbm, {
				id: "other-sess",
				project: "/other/project",
				updatedAt: now,
			});
			// Very old vasana — decayed score should be below 0.2 threshold
			insertVasana(dbm, {
				name: "ancient-vasana",
				strength: 0.3,
				project: "/other/project",
				lastActivated: now - 20 * halfLifeMs, // 20 half-lives ago
			});
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			// The ancient vasana should be filtered out
			expect(ctx.crossProjectInsights.length).toBe(0);
		});

		it("should limit cross-project insights to maxCrossProject config", () => {
			const p = new Pratyabhijna({ maxCrossProject: 2 });
			const now = Date.now();

			// Create many other projects
			for (let i = 0; i < 5; i++) {
				const proj = `/other/project-${i}`;
				insertSession(dbm, { id: `other-sess-${i}`, project: proj, updatedAt: now - i * 1000 });
				insertVasana(dbm, {
					name: `vasana-${i}`,
					strength: 0.9,
					project: proj,
					lastActivated: now,
				});
			}
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.crossProjectInsights.length).toBeLessThanOrEqual(2);
		});

		it("should return empty insights when no other projects exist", () => {
			const p = new Pratyabhijna();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.crossProjectInsights).toEqual([]);
		});
	});

	// ── 10. Edge cases ───────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should handle empty vasanas gracefully", () => {
			const p = new Pratyabhijna();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.globalVasanas).toEqual([]);
			expect(ctx.projectVasanas).toEqual([]);
		});

		it("should handle no samskaras gracefully", () => {
			const p = new Pratyabhijna();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.activeSamskaras).toEqual([]);
		});

		it("should handle no ChetanaController (undefined)", () => {
			const p = new Pratyabhijna();
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm, undefined);
			expect(ctx.toolMastery).toEqual({});
		});

		it("should handle no sessions for lastSessionTs", () => {
			const p = new Pratyabhijna();
			// Don't insert any session for this project

			// But we do need a session to satisfy foreign key-like logic.
			// The recognize call doesn't require an existing session row.
			const ctx = p.recognize("brand-new-session", "/brand-new-project", dbm);
			expect(ctx.identitySummary).toContain("first session");
		});

		it("should work with the __global__ project sentinel for vasanas", () => {
			const p = new Pratyabhijna();
			insertVasana(dbm, {
				name: "global-tendency",
				strength: 0.85,
				project: "__global__",
				lastActivated: Date.now(),
			});
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.globalVasanas.length).toBe(1);
			expect(ctx.globalVasanas[0].tendency).toBe("global-tendency");
		});

		it("should cap vasanas at topK", () => {
			const p = new Pratyabhijna({ topK: 2 });
			for (let i = 0; i < 5; i++) {
				insertVasana(dbm, {
					name: `vasana-${i}`,
					strength: 0.9 - i * 0.1,
					lastActivated: Date.now(),
				});
			}
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.globalVasanas.length).toBeLessThanOrEqual(2);
		});

		it("should cap samskaras at maxSamskaras", () => {
			const p = new Pratyabhijna({ maxSamskaras: 2 });
			for (let i = 0; i < 5; i++) {
				insertSamskara(dbm, {
					id: `s-${i}`,
					patternContent: `pattern ${i}`,
					confidence: 0.9 - i * 0.1,
					project: "/test/project",
				});
			}
			insertSession(dbm, { id: "sess-1", project: "/test/project" });

			const ctx = p.recognize("sess-1", "/test/project", dbm);
			expect(ctx.activeSamskaras.length).toBeLessThanOrEqual(2);
		});

		it("should recognize multiple sessions independently", () => {
			const p = new Pratyabhijna();
			insertVasana(dbm, { name: "test-vasana", strength: 0.9, lastActivated: Date.now() });
			insertSession(dbm, { id: "sess-1", project: "/project-a" });
			insertSession(dbm, { id: "sess-2", project: "/project-b" });

			const ctx1 = p.recognize("sess-1", "/project-a", dbm);
			const ctx2 = p.recognize("sess-2", "/project-b", dbm);

			expect(ctx1.project).toBe("/project-a");
			expect(ctx2.project).toBe("/project-b");
			expect(ctx1.sessionId).toBe("sess-1");
			expect(ctx2.sessionId).toBe("sess-2");
		});
	});
});
