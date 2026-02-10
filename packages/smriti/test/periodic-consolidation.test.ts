/**
 * @chitragupta/smriti — PeriodicConsolidation Tests.
 *
 * Tests monthly and yearly consolidation report generation, trend analysis,
 * consolidation audit log entries, and report formatting (Markdown output).
 * Uses real SQLite databases in a temp directory for full round-trip testing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAllSchemas } from "@chitragupta/smriti/db/schema";
import { PeriodicConsolidation } from "../src/periodic-consolidation.js";
import type {
	PeriodicConfig,
	ConsolidationReport,
	ConsolidationStats,
} from "../src/periodic-consolidation.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

let tmpDir: string;
let dbm: DatabaseManager;

const PROJECT = "/test/my-project";

function freshEnv(): { tmpDir: string; dbm: DatabaseManager } {
	DatabaseManager.reset();
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "periodic-consol-test-"));
	dbm = DatabaseManager.instance(tmpDir);
	initAllSchemas(dbm);
	return { tmpDir, dbm };
}

/**
 * Insert a session row into agent.db with specified timestamps.
 */
function insertSession(
	db: DatabaseManager,
	opts: {
		id: string;
		project: string;
		title?: string;
		turnCount?: number;
		cost?: number;
		tokens?: number;
		createdAt: number;
		updatedAt?: number;
	},
): void {
	const agentDb = db.get("agent");
	agentDb
		.prepare(
			`INSERT INTO sessions
				(id, project, title, created_at, updated_at, turn_count, cost, tokens, file_path)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			opts.id,
			opts.project,
			opts.title ?? "Test Session",
			opts.createdAt,
			opts.updatedAt ?? opts.createdAt,
			opts.turnCount ?? 5,
			opts.cost ?? 0.5,
			opts.tokens ?? 1000,
			`sessions/${opts.id}.md`,
		);
}

/**
 * Insert a turn row into agent.db.
 */
function insertTurn(
	db: DatabaseManager,
	opts: {
		sessionId: string;
		turnNumber: number;
		role?: string;
		content?: string;
		toolCalls?: string;
		createdAt: number;
	},
): void {
	const agentDb = db.get("agent");
	agentDb
		.prepare(
			`INSERT INTO turns
				(session_id, turn_number, role, content, tool_calls, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.run(
			opts.sessionId,
			opts.turnNumber,
			opts.role ?? "assistant",
			opts.content ?? "test content",
			opts.toolCalls ?? null,
			opts.createdAt,
		);
}

/**
 * Insert a vasana row into agent.db.
 */
function insertVasana(
	db: DatabaseManager,
	opts: {
		name: string;
		description?: string;
		valence?: string;
		strength?: number;
		stability?: number;
		project?: string | null;
		createdAt: number;
	},
): void {
	const agentDb = db.get("agent");
	agentDb
		.prepare(
			`INSERT INTO vasanas
				(name, description, valence, strength, stability, project, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			opts.name,
			opts.description ?? `${opts.name} desc`,
			opts.valence ?? "positive",
			opts.strength ?? 0.8,
			opts.stability ?? 0.5,
			opts.project === undefined ? PROJECT : opts.project,
			opts.createdAt,
			opts.createdAt,
		);
}

/**
 * Insert a vidhi row into agent.db.
 */
function insertVidhi(
	db: DatabaseManager,
	opts: {
		id: string;
		name: string;
		project?: string;
		successRate?: number;
		steps?: string;
		learnedFrom?: string;
		createdAt: number;
	},
): void {
	const agentDb = db.get("agent");
	agentDb
		.prepare(
			`INSERT INTO vidhis
				(id, project, name, learned_from, confidence, steps, triggers,
				 success_rate, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			opts.id,
			opts.project ?? PROJECT,
			opts.name,
			opts.learnedFrom ?? '["s1","s2"]',
			0.8,
			opts.steps ?? '[{"index":0,"toolName":"grep"},{"index":1,"toolName":"edit"}]',
			'["test","run"]',
			opts.successRate ?? 0.85,
			opts.createdAt,
			opts.createdAt,
		);
}

/**
 * Insert a samskara row into agent.db.
 */
function insertSamskara(
	db: DatabaseManager,
	opts: {
		id: string;
		patternType?: string;
		patternContent: string;
		confidence?: number;
		observationCount?: number;
		project?: string | null;
		createdAt: number;
		updatedAt?: number;
	},
): void {
	const agentDb = db.get("agent");
	agentDb
		.prepare(
			`INSERT INTO samskaras
				(id, session_id, pattern_type, pattern_content, observation_count,
				 confidence, project, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			opts.id,
			"test-session",
			opts.patternType ?? "preference",
			opts.patternContent,
			opts.observationCount ?? 3,
			opts.confidence ?? 0.75,
			opts.project === undefined ? PROJECT : opts.project,
			opts.createdAt,
			opts.updatedAt ?? opts.createdAt,
		);
}

/**
 * Insert a graph node into graph.db.
 */
function insertNode(
	db: DatabaseManager,
	opts: { id: string; createdAt: number },
): void {
	const graphDb = db.get("graph");
	graphDb
		.prepare(
			`INSERT INTO nodes (id, type, label, content, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.run(opts.id, "concept", opts.id, "", opts.createdAt, opts.createdAt);
}

/**
 * Insert a graph edge into graph.db.
 */
function insertEdge(
	db: DatabaseManager,
	opts: { source: string; target: string; recordedAt: number },
): void {
	const graphDb = db.get("graph");
	graphDb
		.prepare(
			`INSERT INTO edges (source, target, relationship, weight, recorded_at)
			VALUES (?, ?, ?, ?, ?)`,
		)
		.run(opts.source, opts.target, "related_to", 1.0, opts.recordedAt);
}

/**
 * Compute Unix ms for a specific UTC date.
 */
function utcMs(year: number, month: number, day: number): number {
	return Date.UTC(year, month - 1, day);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("PeriodicConsolidation", () => {
	beforeEach(() => {
		freshEnv();
	});

	afterEach(() => {
		DatabaseManager.reset();
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ── 1. Construction ──────────────────────────────────────────────────

	describe("construction", () => {
		it("should construct with minimal config", () => {
			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			expect(pc).toBeInstanceOf(PeriodicConsolidation);
		});

		it("should construct with custom chitraguptaHome", () => {
			const customDir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-custom-"));
			try {
				// Need to init DB schemas at this custom dir too
				DatabaseManager.reset();
				const customDbm = DatabaseManager.instance(customDir);
				initAllSchemas(customDbm);
				DatabaseManager.reset();

				const pc = new PeriodicConsolidation({
					project: PROJECT,
					chitraguptaHome: customDir,
				});
				expect(pc).toBeInstanceOf(PeriodicConsolidation);
			} finally {
				fs.rmSync(customDir, { recursive: true, force: true });
			}
		});

		it("should generate a deterministic report path based on project hash", () => {
			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const reportPath = pc.getReportPath("monthly", "2026-01");
			expect(reportPath).toContain("consolidated");
			expect(reportPath).toContain("monthly");
			expect(reportPath).toContain("2026-01.md");
		});

		it("should produce same hash for the same project", () => {
			const pc1 = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const pc2 = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			expect(pc1.getReportPath("monthly", "2026-01")).toBe(
				pc2.getReportPath("monthly", "2026-01"),
			);
		});
	});

	// ── 2. Monthly report generation ─────────────────────────────────────

	describe("monthly report generation", () => {
		it("should generate a monthly report with session data", async () => {
			const janStart = utcMs(2025, 1, 1);
			const janMid = utcMs(2025, 1, 15);

			insertSession(dbm, {
				id: "s1",
				project: PROJECT,
				turnCount: 10,
				cost: 0.5,
				tokens: 2000,
				createdAt: janMid,
			});
			insertSession(dbm, {
				id: "s2",
				project: PROJECT,
				turnCount: 8,
				cost: 0.3,
				tokens: 1500,
				createdAt: janMid + 1000,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.type).toBe("monthly");
			expect(report.period).toBe("2025-01");
			expect(report.project).toBe(PROJECT);
			expect(report.stats.sessions).toBe(2);
			expect(report.stats.turns).toBe(18);
			expect(report.stats.tokens).toBe(3500);
			expect(report.stats.cost).toBeCloseTo(0.8, 2);
			expect(report.durationMs).toBeGreaterThanOrEqual(0);
		});

		it("should include tool usage in report", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, {
				id: "s1",
				project: PROJECT,
				createdAt: janMid,
			});
			insertTurn(dbm, {
				sessionId: "s1",
				turnNumber: 1,
				toolCalls: JSON.stringify([
					{ name: "grep" },
					{ name: "edit" },
					{ name: "grep" },
				]),
				createdAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.markdown).toContain("grep");
			expect(report.markdown).toContain("edit");
		});

		it("should include vasanas crystallized this month", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });
			insertVasana(dbm, {
				name: "prefer-functional",
				strength: 0.9,
				valence: "positive",
				createdAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.stats.vasanasCreated).toBe(1);
			expect(report.markdown).toContain("prefer-functional");
		});

		it("should include vidhis extracted this month", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });
			insertVidhi(dbm, {
				id: "v1",
				name: "run-test-suite",
				successRate: 0.9,
				createdAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.stats.vidhisCreated).toBe(1);
			expect(report.markdown).toContain("run-test-suite");
		});

		it("should include top samskaras", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });
			insertSamskara(dbm, {
				id: "sk1",
				patternContent: "tabs over spaces",
				confidence: 0.85,
				createdAt: janMid,
				updatedAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.stats.samskarasActive).toBe(1);
			expect(report.markdown).toContain("tabs over spaces");
		});

		it("should include knowledge graph growth", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });
			insertNode(dbm, { id: "n1", createdAt: janMid });
			insertNode(dbm, { id: "n2", createdAt: janMid });
			insertEdge(dbm, { source: "n1", target: "n2", recordedAt: janMid });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.markdown).toContain("New nodes: 2");
			expect(report.markdown).toContain("New edges: 1");
		});

		it("should write the report file to disk", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(fs.existsSync(report.filePath)).toBe(true);
			const content = fs.readFileSync(report.filePath, "utf-8");
			expect(content).toBe(report.markdown);
		});

		it("should handle months with no data", async () => {
			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 3);

			expect(report.stats.sessions).toBe(0);
			expect(report.stats.turns).toBe(0);
			expect(report.stats.tokens).toBe(0);
			expect(report.stats.cost).toBe(0);
			expect(report.markdown).toContain("_No vasanas crystallized this month._");
			expect(report.markdown).toContain("_No vidhis extracted this month._");
			expect(report.markdown).toContain("_No active samskaras this month._");
		});

		it("should not include sessions from other months", async () => {
			const janMid = utcMs(2025, 1, 15);
			const febMid = utcMs(2025, 2, 15);

			insertSession(dbm, { id: "jan-session", project: PROJECT, createdAt: janMid, turnCount: 5 });
			insertSession(dbm, { id: "feb-session", project: PROJECT, createdAt: febMid, turnCount: 10 });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const janReport = await pc.monthly(2025, 1);

			expect(janReport.stats.sessions).toBe(1);
			expect(janReport.stats.turns).toBe(5);
		});

		it("should not include sessions from other projects", async () => {
			const janMid = utcMs(2025, 1, 15);

			insertSession(dbm, { id: "my-session", project: PROJECT, createdAt: janMid, turnCount: 5 });
			insertSession(dbm, { id: "other-session", project: "/other/project", createdAt: janMid, turnCount: 10 });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.stats.sessions).toBe(1);
			expect(report.stats.turns).toBe(5);
		});
	});

	// ── 3. Yearly report generation ──────────────────────────────────────

	describe("yearly report generation", () => {
		it("should generate a yearly report aggregating monthly data", async () => {
			// Insert sessions across multiple months
			for (let m = 1; m <= 3; m++) {
				const mid = utcMs(2025, m, 15);
				insertSession(dbm, {
					id: `s-${m}`,
					project: PROJECT,
					turnCount: 10,
					cost: 0.5,
					tokens: 1000,
					createdAt: mid,
				});
			}

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.yearly(2025);

			expect(report.type).toBe("yearly");
			expect(report.period).toBe("2025");
			expect(report.project).toBe(PROJECT);
			expect(report.stats.sessions).toBe(3);
			expect(report.stats.turns).toBe(30);
			expect(report.stats.tokens).toBe(3000);
		});

		it("should include monthly breakdown table", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, {
				id: "s1",
				project: PROJECT,
				turnCount: 10,
				cost: 0.5,
				tokens: 1000,
				createdAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.yearly(2025);

			expect(report.markdown).toContain("Monthly Breakdown");
			expect(report.markdown).toContain("2025-01");
		});

		it("should include year-over-year comparison when previous year exists", async () => {
			// First generate a yearly report for the previous year
			const prevMid = utcMs(2024, 6, 15);
			insertSession(dbm, {
				id: "s-prev",
				project: PROJECT,
				turnCount: 20,
				cost: 1.0,
				tokens: 5000,
				createdAt: prevMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			await pc.yearly(2024);

			// Now generate current year
			const currMid = utcMs(2025, 3, 15);
			insertSession(dbm, {
				id: "s-curr",
				project: PROJECT,
				turnCount: 30,
				cost: 1.5,
				tokens: 7000,
				createdAt: currMid,
			});

			// Reset DB manager because the yearly() call uses its own instance
			DatabaseManager.reset();
			dbm = DatabaseManager.instance(tmpDir);

			const report = await pc.yearly(2025);

			expect(report.markdown).toContain("Year-over-Year Comparison");
			expect(report.markdown).toContain("Previous Year");
			expect(report.markdown).toContain("This Year");
		});

		it("should include trends section", async () => {
			// Insert sessions across enough months for trend detection
			for (let m = 1; m <= 6; m++) {
				const mid = utcMs(2025, m, 15);
				insertSession(dbm, {
					id: `s-${m}`,
					project: PROJECT,
					turnCount: m * 5, // increasing activity
					cost: 0.5,
					tokens: 1000,
					createdAt: mid,
				});
			}

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.yearly(2025);

			expect(report.markdown).toContain("Trends");
		});

		it("should write the yearly report file to disk", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.yearly(2025);

			expect(fs.existsSync(report.filePath)).toBe(true);
			const content = fs.readFileSync(report.filePath, "utf-8");
			expect(content).toBe(report.markdown);
		});

		it("should include database maintenance note", async () => {
			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.yearly(2025);

			expect(report.markdown).toContain("Database Maintenance");
			expect(report.markdown).toContain("VACUUM");
		});

		it("should handle year with no data", async () => {
			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.yearly(2025);

			expect(report.stats.sessions).toBe(0);
			expect(report.stats.turns).toBe(0);
		});
	});

	// ── 4. Trend analysis ────────────────────────────────────────────────

	describe("trend analysis", () => {
		it("should detect increasing session volume", async () => {
			// First half: low sessions, second half: high sessions
			for (let m = 1; m <= 3; m++) {
				const mid = utcMs(2025, m, 15);
				insertSession(dbm, {
					id: `s-early-${m}`,
					project: PROJECT,
					turnCount: 1,
					cost: 0.1,
					tokens: 100,
					createdAt: mid,
				});
			}
			for (let m = 4; m <= 6; m++) {
				const mid = utcMs(2025, m, 15);
				// Insert multiple sessions per month for higher volume
				for (let j = 0; j < 5; j++) {
					insertSession(dbm, {
						id: `s-late-${m}-${j}`,
						project: PROJECT,
						turnCount: 5,
						cost: 0.5,
						tokens: 500,
						createdAt: mid + j * 1000,
					});
				}
			}

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.yearly(2025);

			expect(report.markdown).toContain("Session volume increased");
		});

		it("should detect decreased session volume", async () => {
			// First half: many sessions, second half: few sessions
			for (let m = 1; m <= 3; m++) {
				const mid = utcMs(2025, m, 15);
				for (let j = 0; j < 5; j++) {
					insertSession(dbm, {
						id: `s-early-${m}-${j}`,
						project: PROJECT,
						turnCount: 5,
						cost: 0.5,
						tokens: 500,
						createdAt: mid + j * 1000,
					});
				}
			}
			for (let m = 4; m <= 6; m++) {
				const mid = utcMs(2025, m, 15);
				insertSession(dbm, {
					id: `s-late-${m}`,
					project: PROJECT,
					turnCount: 1,
					cost: 0.1,
					tokens: 100,
					createdAt: mid,
				});
			}

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.yearly(2025);

			expect(report.markdown).toContain("Session volume decreased");
		});

		it("should detect strong vasana crystallization", async () => {
			// Insert >10 vasanas across months
			for (let m = 1; m <= 6; m++) {
				const mid = utcMs(2025, m, 15);
				insertSession(dbm, { id: `s-${m}`, project: PROJECT, createdAt: mid });
				for (let v = 0; v < 3; v++) {
					insertVasana(dbm, {
						name: `vasana-${m}-${v}`,
						strength: 0.8,
						createdAt: mid,
					});
				}
			}

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.yearly(2025);

			expect(report.markdown).toContain("Strong behavioral crystallization");
		});

		it("should show steady usage message when no inflection points", async () => {
			// Two months with same session count
			for (let m = 1; m <= 2; m++) {
				const mid = utcMs(2025, m, 15);
				insertSession(dbm, {
					id: `s-${m}`,
					project: PROJECT,
					turnCount: 5,
					cost: 0.5,
					tokens: 1000,
					createdAt: mid,
				});
			}

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.yearly(2025);

			expect(report.markdown).toContain("Steady, consistent usage");
		});
	});

	// ── 5. Consolidation audit log entries ────────────────────────────────

	describe("consolidation audit log", () => {
		it("should log monthly consolidation to consolidation_log table", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			await pc.monthly(2025, 1);

			const logs = dbm
				.get("agent")
				.prepare("SELECT * FROM consolidation_log WHERE cycle_type = ?")
				.all("monthly") as any[];

			expect(logs.length).toBe(1);
			expect(logs[0].project).toBe(PROJECT);
			expect(logs[0].cycle_id).toBe("monthly-2025-01");
			expect(logs[0].status).toBe("success");
			expect(logs[0].sessions_processed).toBe(1);
		});

		it("should log yearly consolidation to consolidation_log table", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			await pc.yearly(2025);

			const logs = dbm
				.get("agent")
				.prepare("SELECT * FROM consolidation_log WHERE cycle_type = ?")
				.all("yearly") as any[];

			expect(logs.length).toBe(1);
			expect(logs[0].project).toBe(PROJECT);
			expect(logs[0].cycle_id).toBe("yearly-2025");
			expect(logs[0].status).toBe("success");
		});

		it("should record vasanas and vidhis counts in log", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });
			insertVasana(dbm, { name: "v1", createdAt: janMid });
			insertVasana(dbm, { name: "v2", createdAt: janMid });
			insertVidhi(dbm, { id: "vidhi1", name: "proc1", createdAt: janMid });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			await pc.monthly(2025, 1);

			const log = dbm
				.get("agent")
				.prepare("SELECT * FROM consolidation_log WHERE cycle_type = 'monthly'")
				.get() as any;

			expect(log.vasanas_created).toBe(2);
			expect(log.vidhis_created).toBe(1);
		});
	});

	// ── 6. Report formatting (Markdown output) ──────────────────────────

	describe("report formatting (Markdown)", () => {
		it("should have correct monthly report title", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.markdown).toMatch(/^# Monthly Consolidation/);
			expect(report.markdown).toContain(PROJECT);
			expect(report.markdown).toContain("2025-01");
		});

		it("should have correct yearly report title", async () => {
			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.yearly(2025);

			expect(report.markdown).toMatch(/^# Yearly Consolidation/);
			expect(report.markdown).toContain(PROJECT);
			expect(report.markdown).toContain("2025");
		});

		it("should include Generated timestamp", async () => {
			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 6);

			expect(report.markdown).toContain("> Generated:");
		});

		it("should include Summary section with stats", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, {
				id: "s1",
				project: PROJECT,
				turnCount: 10,
				cost: 1.2345,
				tokens: 5000,
				createdAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.markdown).toContain("## Summary");
			expect(report.markdown).toContain("**Sessions**: 1");
			expect(report.markdown).toContain("**Turns**: 10");
			expect(report.markdown).toContain("**Total Tokens**:");
			expect(report.markdown).toContain("**Estimated Cost**:");
		});

		it("should format vasanas as Markdown table", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });
			insertVasana(dbm, {
				name: "prefer-tabs",
				strength: 0.85,
				valence: "positive",
				stability: 0.6,
				createdAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.markdown).toContain("## Vasanas Crystallized");
			expect(report.markdown).toContain("| Tendency | Strength | Valence | Stability |");
			expect(report.markdown).toContain("prefer-tabs");
			expect(report.markdown).toContain("positive");
		});

		it("should format vidhis as Markdown table", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });
			insertVidhi(dbm, {
				id: "v1",
				name: "run-tests",
				successRate: 0.92,
				createdAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.markdown).toContain("## Vidhis Extracted");
			expect(report.markdown).toContain("| Procedure | Steps | Success Rate | Sessions |");
			expect(report.markdown).toContain("run-tests");
		});

		it("should format samskaras as Markdown table", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });
			insertSamskara(dbm, {
				id: "sk1",
				patternContent: "always commit before push",
				patternType: "convention",
				confidence: 0.9,
				observationCount: 7,
				createdAt: janMid,
				updatedAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.markdown).toContain("## Top Samskaras");
			expect(report.markdown).toContain("| Pattern | Type | Confidence | Observations |");
			expect(report.markdown).toContain("always commit before push");
			expect(report.markdown).toContain("convention");
		});

		it("should include Recommendations section", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.markdown).toContain("## Recommendations");
		});

		it("should escape pipe characters in table cells", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });
			insertVasana(dbm, {
				name: "a|b",
				description: "test|desc",
				createdAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			// Pipe should be escaped in the table
			expect(report.markdown).toContain("a\\|b");
		});

		it("should truncate long samskara content", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });
			const longContent = "x".repeat(100);
			insertSamskara(dbm, {
				id: "sk1",
				patternContent: longContent,
				createdAt: janMid,
				updatedAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			// Should be truncated to 60 chars with ellipsis
			expect(report.markdown).toContain("...");
			// Full 100 chars should NOT appear
			expect(report.markdown).not.toContain(longContent);
		});
	});

	// ── 7. Edge cases ────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should handle single session month", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, {
				id: "only-one",
				project: PROJECT,
				turnCount: 3,
				cost: 0.1,
				tokens: 500,
				createdAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.stats.sessions).toBe(1);
			expect(report.stats.turns).toBe(3);
		});

		it("should handle malformed tool_calls JSON gracefully", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });
			insertTurn(dbm, {
				sessionId: "s1",
				turnNumber: 1,
				toolCalls: "not valid json{{{",
				createdAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});

			// Should not throw
			const report = await pc.monthly(2025, 1);
			expect(report.stats.sessions).toBe(1);
		});

		it("should handle boundary dates correctly (start of month)", async () => {
			// Session at exactly midnight Jan 1
			const janStart = utcMs(2025, 1, 1);
			insertSession(dbm, { id: "s-start", project: PROJECT, createdAt: janStart });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.stats.sessions).toBe(1);
		});

		it("should handle boundary dates correctly (end of month excluded)", async () => {
			// Session at exactly midnight Feb 1 should NOT be in January
			const febStart = utcMs(2025, 2, 1);
			insertSession(dbm, { id: "s-feb", project: PROJECT, createdAt: febStart });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.stats.sessions).toBe(0);
		});

		it("should pad single-digit months to 2 digits in period", async () => {
			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 3);
			expect(report.period).toBe("2025-03");
		});

		it("hasMonthlyReport() should return false before generation", () => {
			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			expect(pc.hasMonthlyReport(2025, 1)).toBe(false);
		});

		it("hasMonthlyReport() should return true after generation", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			await pc.monthly(2025, 1);
			expect(pc.hasMonthlyReport(2025, 1)).toBe(true);
		});

		it("hasYearlyReport() should return false before generation", () => {
			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			expect(pc.hasYearlyReport(2025)).toBe(false);
		});

		it("hasYearlyReport() should return true after generation", async () => {
			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			await pc.yearly(2025);
			expect(pc.hasYearlyReport(2025)).toBe(true);
		});

		it("listReports() should return empty array initially", () => {
			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			expect(pc.listReports()).toEqual([]);
		});

		it("listReports() should return generated reports", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			await pc.monthly(2025, 1);

			const reports = pc.listReports();
			expect(reports.length).toBe(1);
			expect(reports[0].type).toBe("monthly");
			expect(reports[0].period).toBe("2025-01");
		});
	});

	// ── 8. Recommendations ──────────────────────────────────────────────

	describe("recommendations", () => {
		it("should recommend lighter models for high cost per session", async () => {
			const janMid = utcMs(2025, 1, 15);
			// Single session with cost > $1
			insertSession(dbm, {
				id: "expensive",
				project: PROJECT,
				cost: 2.5,
				createdAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.markdown).toContain("lighter models");
		});

		it("should flag negative vasanas", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });
			insertVasana(dbm, {
				name: "over-engineering",
				valence: "negative",
				strength: 0.7,
				createdAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.markdown).toContain("negative vasana");
			expect(report.markdown).toContain("over-engineering");
		});

		it("should flag low-success-rate vidhis", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });
			insertVidhi(dbm, {
				id: "v1",
				name: "flaky-procedure",
				successRate: 0.3,
				createdAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.markdown).toContain("sub-50% success rate");
			expect(report.markdown).toContain("flaky-procedure");
		});

		it("should suggest vasana crystallization for strong samskaras", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });
			insertSamskara(dbm, {
				id: "sk1",
				patternContent: "always use TypeScript strict mode",
				confidence: 0.9,
				observationCount: 10,
				createdAt: janMid,
				updatedAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.markdown).toContain("vasana crystallization");
		});

		it("should show healthy message when all metrics are fine", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, {
				id: "s1",
				project: PROJECT,
				turnCount: 5,
				cost: 0.2,
				tokens: 500,
				createdAt: janMid,
			});

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			expect(report.markdown).toContain("healthy ranges");
		});
	});

	// ── 9. File permissions ──────────────────────────────────────────────

	describe("file permissions", () => {
		it("should create report files with 0o600 permissions", async () => {
			const janMid = utcMs(2025, 1, 15);
			insertSession(dbm, { id: "s1", project: PROJECT, createdAt: janMid });

			const pc = new PeriodicConsolidation({
				project: PROJECT,
				chitraguptaHome: tmpDir,
			});
			const report = await pc.monthly(2025, 1);

			const stats = fs.statSync(report.filePath);
			// 0o600 = owner read+write only
			const mode = stats.mode & 0o777;
			expect(mode).toBe(0o600);
		});
	});
});
