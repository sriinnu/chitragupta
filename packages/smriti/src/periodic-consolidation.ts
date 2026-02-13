/**
 * PeriodicConsolidation — Monthly and yearly consolidation reports.
 *
 * Generates human-readable Markdown reports aggregating session data,
 * vasanas, vidhis, and samskaras over calendar periods. Reports are
 * stored under `<chitraguptaHome>/consolidated/<projHash>/` and indexed
 * into FTS5 for full-text searchability.
 *
 * Monthly runs on the 1st of each month; yearly runs on Jan 1.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { getChitraguptaHome } from "@chitragupta/core";
import { DatabaseManager } from "./db/index.js";
import type {
	Vasana,
	SamskaraRecord,
	Vidhi,
	ConsolidationLogEntry,
} from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Configuration for the PeriodicConsolidation engine. */
export interface PeriodicConfig {
	/** Project identifier (path or slug). */
	project: string;
	/** Override the Chitragupta home directory (defaults to getChitraguptaHome()). */
	chitraguptaHome?: string;
}

/** Aggregated statistics emitted by a consolidation run. */
export interface ConsolidationStats {
	sessions: number;
	turns: number;
	tokens: number;
	cost: number;
	vasanasCreated: number;
	vidhisCreated: number;
	samskarasActive: number;
}

/** The result of a monthly or yearly consolidation run. */
export interface ConsolidationReport {
	type: "monthly" | "yearly";
	/** Period identifier: 'YYYY-MM' for monthly, 'YYYY' for yearly. */
	period: string;
	project: string;
	/** Absolute path to the generated Markdown file. */
	filePath: string;
	/** The full Markdown content of the report. */
	markdown: string;
	stats: ConsolidationStats;
	/** Wall-clock duration of the consolidation run in milliseconds. */
	durationMs: number;
}

/** Descriptor for a persisted report file. */
export interface ReportEntry {
	type: "monthly" | "yearly";
	period: string;
	path: string;
}

// ─── FNV-1a Project Hash ────────────────────────────────────────────────────

/**
 * Compute a 4-character hexadecimal hash of a project name.
 * Uses the FNV-1a algorithm for fast, low-collision hashing.
 *
 * @param project - The project identifier to hash.
 * @returns A 4-char hex string suitable for directory naming.
 */
function projectHash(project: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < project.length; i++) {
		h ^= project.charCodeAt(i);
		h = (h * 0x01000193) >>> 0;
	}
	return (h >>> 0).toString(16).slice(0, 4);
}

// ─── Internal Row Shapes ────────────────────────────────────────────────────

interface SessionRow {
	id: string;
	title: string;
	turn_count: number;
	cost: number;
	tokens: number;
	created_at: number;
}

interface TurnRow {
	tool_calls: string | null;
}

interface VasanaRow {
	name: string;
	description: string;
	strength: number;
	valence: string;
	stability: number;
}

interface SamskaraRow {
	id: string;
	pattern_type: string;
	pattern_content: string;
	confidence: number;
	observation_count: number;
}

interface VidhiRow {
	name: string;
	steps: string;
	success_rate: number;
	learned_from: string;
}

interface NodeCountRow {
	cnt: number;
}

interface EdgeCountRow {
	cnt: number;
}

// ─── PeriodicConsolidation ──────────────────────────────────────────────────

/**
 * Engine for generating monthly and yearly consolidation reports.
 *
 * Reports aggregate session statistics, crystallized vasanas,
 * procedural vidhis, and behavioral samskaras into Markdown documents
 * stored under a project-specific directory tree.
 *
 * @example
 * ```ts
 * const pc = new PeriodicConsolidation({ project: "my-app" });
 * const report = await pc.monthly(2026, 1);
 * console.log(report.filePath);
 * ```
 */
export class PeriodicConsolidation {
	private readonly _project: string;
	private readonly _home: string;
	private readonly _hash: string;
	private readonly _baseDir: string;

	constructor(config: PeriodicConfig) {
		this._project = config.project;
		this._home = config.chitraguptaHome ?? getChitraguptaHome();
		this._hash = projectHash(this._project);
		this._baseDir = path.join(this._home, "consolidated", this._hash);
	}

	// ── Public API ────────────────────────────────────────────────────────

	/**
	 * Run monthly consolidation for a specific calendar month.
	 *
	 * Queries all sessions created within [year-month-01, year-month+1-01),
	 * aggregates statistics, collects vasanas/vidhis/samskaras created in
	 * that window, generates a Markdown report, indexes it into FTS5, and
	 * logs the run to the consolidation_log table.
	 *
	 * @param year  - The calendar year (e.g. 2026).
	 * @param month - The calendar month (1-12).
	 * @returns The consolidation report with stats and file path.
	 */
	async monthly(year: number, month: number): Promise<ConsolidationReport> {
		const t0 = Date.now();
		const period = `${year}-${String(month).padStart(2, "0")}`;
		const { startMs, endMs } = this._monthRange(year, month);

		const dbm = DatabaseManager.instance(this._home);
		const agentDb = dbm.get("agent");
		const graphDb = dbm.get("graph");

		// ── Aggregate session data ────────────────────────────────────────
		const sessions = agentDb
			.prepare(
				`SELECT id, title, turn_count, cost, tokens, created_at
				 FROM sessions
				 WHERE project = ? AND created_at >= ? AND created_at < ?
				 ORDER BY created_at ASC`,
			)
			.all(this._project, startMs, endMs) as SessionRow[];

		const sessionIds = sessions.map((s) => s.id);
		const totalTurns = sessions.reduce((sum, s) => sum + s.turn_count, 0);
		const totalTokens = sessions.reduce((sum, s) => sum + (s.tokens ?? 0), 0);
		const totalCost = sessions.reduce((sum, s) => sum + (s.cost ?? 0), 0);

		// ── Tool usage ────────────────────────────────────────────────────
		const toolSet = new Set<string>();
		if (sessionIds.length > 0) {
			const placeholders = sessionIds.map(() => "?").join(",");
			const turns = agentDb
				.prepare(
					`SELECT tool_calls FROM turns
					 WHERE session_id IN (${placeholders}) AND tool_calls IS NOT NULL`,
				)
				.all(...sessionIds) as TurnRow[];

			for (const turn of turns) {
				if (!turn.tool_calls) continue;
				try {
					const calls = JSON.parse(turn.tool_calls) as Array<{ name?: string }>;
					for (const call of calls) {
						if (call.name) toolSet.add(call.name);
					}
				} catch {
					// Malformed JSON — skip
				}
			}
		}

		// ── Vasanas crystallized this month ────────────────────────────────
		const vasanas = agentDb
			.prepare(
				`SELECT name, description, strength, valence, stability
				 FROM vasanas
				 WHERE (project = ? OR project IS NULL)
				   AND created_at >= ? AND created_at < ?
				 ORDER BY strength DESC`,
			)
			.all(this._project, startMs, endMs) as VasanaRow[];

		// ── Vidhis extracted this month ────────────────────────────────────
		const vidhis = agentDb
			.prepare(
				`SELECT name, steps, success_rate, learned_from
				 FROM vidhis
				 WHERE project = ?
				   AND created_at >= ? AND created_at < ?
				 ORDER BY success_rate DESC`,
			)
			.all(this._project, startMs, endMs) as VidhiRow[];

		// ── Top samskaras by confidence ────────────────────────────────────
		const samskaras = agentDb
			.prepare(
				`SELECT id, pattern_type, pattern_content, confidence, observation_count
				 FROM samskaras
				 WHERE (project = ? OR project IS NULL)
				   AND updated_at >= ? AND updated_at < ?
				 ORDER BY confidence DESC
				 LIMIT 20`,
			)
			.all(this._project, startMs, endMs) as SamskaraRow[];

		// ── Knowledge graph growth ────────────────────────────────────────
		const newNodes = (
			graphDb
				.prepare(
					`SELECT COUNT(*) AS cnt FROM nodes
					 WHERE created_at >= ? AND created_at < ?`,
				)
				.get(startMs, endMs) as NodeCountRow | undefined
		)?.cnt ?? 0;

		const newEdges = (
			graphDb
				.prepare(
					`SELECT COUNT(*) AS cnt FROM edges
					 WHERE recorded_at >= ? AND recorded_at < ?`,
				)
				.get(startMs, endMs) as EdgeCountRow | undefined
		)?.cnt ?? 0;

		// ── Build report ──────────────────────────────────────────────────
		const stats: ConsolidationStats = {
			sessions: sessions.length,
			turns: totalTurns,
			tokens: totalTokens,
			cost: totalCost,
			vasanasCreated: vasanas.length,
			vidhisCreated: vidhis.length,
			samskarasActive: samskaras.length,
		};

		const recommendations = this._generateRecommendations(
			stats, vasanas, vidhis, samskaras, toolSet,
		);

		const markdown = this._buildMonthlyMarkdown(
			period, stats, vasanas, vidhis, samskaras,
			toolSet, newNodes, newEdges, recommendations,
		);

		const filePath = this.getReportPath("monthly", period);
		this._writeReport(filePath, markdown);

		// ── Vector-index for hierarchical temporal search ──────────────────
		try {
			const { indexConsolidationSummary } = await import("./consolidation-indexer.js");
			await indexConsolidationSummary("monthly", period, markdown, this._project);
		} catch { /* best-effort */ }

		// ── Index into FTS5 ───────────────────────────────────────────────
		this._indexIntoFts(agentDb, markdown);

		// ── Log to consolidation_log ──────────────────────────────────────
		const durationMs = Date.now() - t0;
		this._logConsolidation(agentDb, {
			project: this._project,
			cycleType: "monthly",
			cycleId: `monthly-${period}`,
			vasanasCreated: vasanas.length,
			vidhisCreated: vidhis.length,
			samskarasProcessed: samskaras.length,
			sessionsProcessed: sessions.length,
			status: "success",
			createdAt: Date.now(),
		});

		return {
			type: "monthly",
			period,
			project: this._project,
			filePath,
			markdown,
			stats,
			durationMs,
		};
	}

	/**
	 * Run yearly consolidation for a specific calendar year.
	 *
	 * Reads all 12 monthly reports (generating any missing ones), aggregates
	 * annual statistics, identifies trends and growth areas, generates a
	 * yearly Markdown report, VACUUMs the SQLite databases, and logs the run.
	 *
	 * @param year - The calendar year (e.g. 2026).
	 * @returns The consolidation report with stats and file path.
	 */
	async yearly(year: number): Promise<ConsolidationReport> {
		const t0 = Date.now();
		const period = String(year);
		const { startMs, endMs } = this._yearRange(year);

		const dbm = DatabaseManager.instance(this._home);
		const agentDb = dbm.get("agent");
		const graphDb = dbm.get("graph");

		// ── Read or generate monthly reports ──────────────────────────────
		const monthlyReports: ConsolidationReport[] = [];
		for (let m = 1; m <= 12; m++) {
			const mp = `${year}-${String(m).padStart(2, "0")}`;
			const mPath = this.getReportPath("monthly", mp);
			if (!fs.existsSync(mPath)) {
				// Generate if within range and there is data
				const { startMs: ms, endMs: me } = this._monthRange(year, m);
				if (me <= Date.now()) {
					const count = (
						agentDb
							.prepare(
								`SELECT COUNT(*) AS cnt FROM sessions
								 WHERE project = ? AND created_at >= ? AND created_at < ?`,
							)
							.get(this._project, ms, me) as NodeCountRow | undefined
					)?.cnt ?? 0;

					if (count > 0) {
						monthlyReports.push(await this.monthly(year, m));
						continue;
					}
				}
			} else {
				// Read existing report content
				const content = fs.readFileSync(mPath, "utf-8");
				monthlyReports.push({
					type: "monthly",
					period: mp,
					project: this._project,
					filePath: mPath,
					markdown: content,
					stats: this._extractStatsFromMarkdown(content),
					durationMs: 0,
				});
			}
		}

		// ── Aggregate annual stats ────────────────────────────────────────
		const annualStats: ConsolidationStats = {
			sessions: 0,
			turns: 0,
			tokens: 0,
			cost: 0,
			vasanasCreated: 0,
			vidhisCreated: 0,
			samskarasActive: 0,
		};

		for (const r of monthlyReports) {
			annualStats.sessions += r.stats.sessions;
			annualStats.turns += r.stats.turns;
			annualStats.tokens += r.stats.tokens;
			annualStats.cost += r.stats.cost;
			annualStats.vasanasCreated += r.stats.vasanasCreated;
			annualStats.vidhisCreated += r.stats.vidhisCreated;
			annualStats.samskarasActive += r.stats.samskarasActive;
		}

		// ── Compute year-wide data ────────────────────────────────────────
		const allVasanas = agentDb
			.prepare(
				`SELECT name, description, strength, valence, stability
				 FROM vasanas
				 WHERE (project = ? OR project IS NULL)
				   AND created_at >= ? AND created_at < ?
				 ORDER BY strength DESC`,
			)
			.all(this._project, startMs, endMs) as VasanaRow[];

		const allVidhis = agentDb
			.prepare(
				`SELECT name, steps, success_rate, learned_from
				 FROM vidhis
				 WHERE project = ?
				   AND created_at >= ? AND created_at < ?
				 ORDER BY success_rate DESC`,
			)
			.all(this._project, startMs, endMs) as VidhiRow[];

		const allSamskaras = agentDb
			.prepare(
				`SELECT id, pattern_type, pattern_content, confidence, observation_count
				 FROM samskaras
				 WHERE (project = ? OR project IS NULL)
				   AND updated_at >= ? AND updated_at < ?
				 ORDER BY confidence DESC
				 LIMIT 30`,
			)
			.all(this._project, startMs, endMs) as SamskaraRow[];

		// ── Graph growth for the year ─────────────────────────────────────
		const yearNodes = (
			graphDb
				.prepare(
					`SELECT COUNT(*) AS cnt FROM nodes
					 WHERE created_at >= ? AND created_at < ?`,
				)
				.get(startMs, endMs) as NodeCountRow | undefined
		)?.cnt ?? 0;

		const yearEdges = (
			graphDb
				.prepare(
					`SELECT COUNT(*) AS cnt FROM edges
					 WHERE recorded_at >= ? AND recorded_at < ?`,
				)
				.get(startMs, endMs) as EdgeCountRow | undefined
		)?.cnt ?? 0;

		// ── Previous year comparison ──────────────────────────────────────
		let prevYearStats: ConsolidationStats | null = null;
		const prevPath = this.getReportPath("yearly", String(year - 1));
		if (fs.existsSync(prevPath)) {
			const prevContent = fs.readFileSync(prevPath, "utf-8");
			prevYearStats = this._extractStatsFromMarkdown(prevContent);
		}

		// ── Trend analysis ────────────────────────────────────────────────
		const trends = this._analyzeTrends(monthlyReports);

		// ── Build yearly markdown ─────────────────────────────────────────
		const markdown = this._buildYearlyMarkdown(
			period, annualStats, allVasanas, allVidhis, allSamskaras,
			yearNodes, yearEdges, monthlyReports, trends, prevYearStats,
		);

		const filePath = this.getReportPath("yearly", period);
		this._writeReport(filePath, markdown);

		// ── Vector-index for hierarchical temporal search ──────────────────
		try {
			const { indexConsolidationSummary } = await import("./consolidation-indexer.js");
			await indexConsolidationSummary("yearly", period, markdown, this._project);
		} catch { /* best-effort */ }

		// ── Index into FTS5 ───────────────────────────────────────────────
		this._indexIntoFts(agentDb, markdown);

		// ── VACUUM databases ──────────────────────────────────────────────
		dbm.vacuum("agent");
		dbm.vacuum("graph");
		dbm.vacuum("vectors");

		// ── Log ───────────────────────────────────────────────────────────
		const durationMs = Date.now() - t0;
		this._logConsolidation(agentDb, {
			project: this._project,
			cycleType: "yearly",
			cycleId: `yearly-${period}`,
			vasanasCreated: allVasanas.length,
			vidhisCreated: allVidhis.length,
			samskarasProcessed: allSamskaras.length,
			sessionsProcessed: annualStats.sessions,
			status: "success",
			createdAt: Date.now(),
		});

		return {
			type: "yearly",
			period,
			project: this._project,
			filePath,
			markdown,
			stats: annualStats,
			durationMs,
		};
	}

	/**
	 * Check whether a monthly report already exists on disk.
	 *
	 * @param year  - Calendar year.
	 * @param month - Calendar month (1-12).
	 */
	hasMonthlyReport(year: number, month: number): boolean {
		const period = `${year}-${String(month).padStart(2, "0")}`;
		return fs.existsSync(this.getReportPath("monthly", period));
	}

	/**
	 * Check whether a yearly report already exists on disk.
	 *
	 * @param year - Calendar year.
	 */
	hasYearlyReport(year: number): boolean {
		return fs.existsSync(this.getReportPath("yearly", String(year)));
	}

	/**
	 * Get the absolute file path for a report.
	 *
	 * @param type   - 'monthly' or 'yearly'.
	 * @param period - 'YYYY-MM' for monthly, 'YYYY' for yearly.
	 * @returns Absolute path to the report Markdown file.
	 */
	getReportPath(type: "monthly" | "yearly", period: string): string {
		const filename = `${period}.md`;
		return path.join(this._baseDir, type, filename);
	}

	/**
	 * List all existing reports for this project.
	 *
	 * @returns Array of report descriptors sorted by period.
	 */
	listReports(): ReportEntry[] {
		const reports: ReportEntry[] = [];

		for (const type of ["monthly", "yearly"] as const) {
			const dir = path.join(this._baseDir, type);
			if (!fs.existsSync(dir)) continue;

			const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
			for (const file of files) {
				reports.push({
					type,
					period: file.replace(/\.md$/, ""),
					path: path.join(dir, file),
				});
			}
		}

		return reports;
	}

	// ── Private Helpers ───────────────────────────────────────────────────

	/**
	 * Compute the Unix epoch ms range [start, end) for a calendar month.
	 */
	private _monthRange(year: number, month: number): { startMs: number; endMs: number } {
		const start = new Date(Date.UTC(year, month - 1, 1));
		const end = new Date(Date.UTC(year, month, 1)); // First day of next month
		return { startMs: start.getTime(), endMs: end.getTime() };
	}

	/**
	 * Compute the Unix epoch ms range [start, end) for a calendar year.
	 */
	private _yearRange(year: number): { startMs: number; endMs: number } {
		const start = new Date(Date.UTC(year, 0, 1));
		const end = new Date(Date.UTC(year + 1, 0, 1));
		return { startMs: start.getTime(), endMs: end.getTime() };
	}

	/**
	 * Write a Markdown report to disk, creating parent directories as needed.
	 */
	private _writeReport(filePath: string, content: string): void {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, "utf-8");
		fs.chmodSync(filePath, 0o600);
	}

	/**
	 * Index report text into the FTS5 virtual table for full-text search.
	 *
	 * Inserts the report content as a synthetic turn so it surfaces in
	 * memory search queries.
	 */
	private _indexIntoFts(
		agentDb: ReturnType<DatabaseManager["get"]>,
		content: string,
	): void {
		try {
			agentDb
				.prepare("INSERT INTO turns_fts(content) VALUES (?)")
				.run(content);
		} catch {
			// FTS table may not exist in test environments — non-fatal
		}
	}

	/**
	 * Log a consolidation run to the consolidation_log table.
	 */
	private _logConsolidation(
		agentDb: ReturnType<DatabaseManager["get"]>,
		entry: Omit<ConsolidationLogEntry, "id">,
	): void {
		try {
			agentDb
				.prepare(
					`INSERT INTO consolidation_log
					 (project, cycle_type, cycle_id, vasanas_created, vidhis_created,
					  samskaras_processed, sessions_processed, status, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					entry.project,
					entry.cycleType,
					entry.cycleId,
					entry.vasanasCreated,
					entry.vidhisCreated,
					entry.samskarasProcessed,
					entry.sessionsProcessed,
					entry.status,
					entry.createdAt,
				);
		} catch {
			// Non-fatal — table may not exist in testing
		}
	}

	/**
	 * Extract stats from a previously generated Markdown report.
	 * Parses the Summary section for key numbers.
	 */
	private _extractStatsFromMarkdown(md: string): ConsolidationStats {
		const stats: ConsolidationStats = {
			sessions: 0,
			turns: 0,
			tokens: 0,
			cost: 0,
			vasanasCreated: 0,
			vidhisCreated: 0,
			samskarasActive: 0,
		};

		const num = (pattern: RegExp): number => {
			const match = md.match(pattern);
			if (!match) return 0;
			return parseFloat(match[1].replace(/,/g, "")) || 0;
		};

		stats.sessions = num(/\*\*Sessions\*\*:\s*([\d,]+)/);
		stats.turns = num(/\*\*Turns\*\*:\s*([\d,]+)/);
		stats.tokens = num(/\*\*Total Tokens\*\*:\s*([\d,]+)/);
		stats.cost = num(/\*\*Estimated Cost\*\*:\s*\$?([\d,.]+)/);

		// Count table rows in vasanas/vidhis/samskaras sections
		const vasanaSection = md.match(/## Vasanas Crystallized\n[\s\S]*?(?=\n##|$)/);
		if (vasanaSection) {
			stats.vasanasCreated = (vasanaSection[0].match(/^\|(?!\s*-)[^|]+\|/gm) || []).length - 1;
			if (stats.vasanasCreated < 0) stats.vasanasCreated = 0;
		}

		const vidhiSection = md.match(/## Vidhis Extracted\n[\s\S]*?(?=\n##|$)/);
		if (vidhiSection) {
			stats.vidhisCreated = (vidhiSection[0].match(/^\|(?!\s*-)[^|]+\|/gm) || []).length - 1;
			if (stats.vidhisCreated < 0) stats.vidhisCreated = 0;
		}

		const samskaraSection = md.match(/## Top Samskaras\n[\s\S]*?(?=\n##|$)/);
		if (samskaraSection) {
			stats.samskarasActive = (samskaraSection[0].match(/^\|(?!\s*-)[^|]+\|/gm) || []).length - 1;
			if (stats.samskarasActive < 0) stats.samskarasActive = 0;
		}

		return stats;
	}

	/**
	 * Generate actionable recommendations based on consolidation data.
	 */
	private _generateRecommendations(
		stats: ConsolidationStats,
		vasanas: VasanaRow[],
		vidhis: VidhiRow[],
		samskaras: SamskaraRow[],
		tools: Set<string>,
	): string[] {
		const recs: string[] = [];

		// Cost efficiency
		if (stats.sessions > 0 && stats.cost > 0) {
			const costPerSession = stats.cost / stats.sessions;
			if (costPerSession > 1.0) {
				recs.push(
					`Average cost per session is $${costPerSession.toFixed(2)} — consider using lighter models for routine tasks.`,
				);
			}
		}

		// Token usage
		if (stats.turns > 0 && stats.tokens > 0) {
			const tokensPerTurn = Math.round(stats.tokens / stats.turns);
			if (tokensPerTurn > 5000) {
				recs.push(
					`High token usage per turn (${tokensPerTurn.toLocaleString()} avg) — review context window usage and compaction settings.`,
				);
			}
		}

		// Negative vasanas
		const negativeVasanas = vasanas.filter((v) => v.valence === "negative");
		if (negativeVasanas.length > 0) {
			recs.push(
				`${negativeVasanas.length} negative vasana(s) detected: ${negativeVasanas.map((v) => v.name).join(", ")}. Investigate root causes.`,
			);
		}

		// Low-confidence vidhis
		const weakVidhis = vidhis.filter((v) => v.success_rate < 0.5);
		if (weakVidhis.length > 0) {
			recs.push(
				`${weakVidhis.length} vidhi(s) with sub-50% success rate — consider refining or deprecating: ${weakVidhis.map((v) => v.name).join(", ")}.`,
			);
		}

		// High-confidence samskaras not yet crystallized
		const strongSamskaras = samskaras.filter((s) => s.confidence > 0.8 && s.observation_count >= 5);
		if (strongSamskaras.length > 0) {
			recs.push(
				`${strongSamskaras.length} high-confidence samskara(s) may be ready for vasana crystallization.`,
			);
		}

		// Tool diversity
		if (tools.size > 0 && stats.sessions >= 5) {
			const toolsPerSession = tools.size / stats.sessions;
			if (toolsPerSession < 1.5) {
				recs.push(
					"Low tool diversity — explore additional tools to improve efficiency.",
				);
			}
		}

		if (recs.length === 0) {
			recs.push("All metrics within healthy ranges. Keep up the momentum.");
		}

		return recs;
	}

	/**
	 * Analyze trends across monthly reports within a year.
	 */
	private _analyzeTrends(
		reports: ConsolidationReport[],
	): string[] {
		const trends: string[] = [];
		if (reports.length < 2) return trends;

		// Session volume trend
		const sessionCounts = reports.map((r) => r.stats.sessions);
		const firstHalf = sessionCounts.slice(0, Math.floor(sessionCounts.length / 2));
		const secondHalf = sessionCounts.slice(Math.floor(sessionCounts.length / 2));
		const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / (firstHalf.length || 1);
		const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / (secondHalf.length || 1);

		if (avgSecond > avgFirst * 1.3) {
			trends.push("Session volume increased significantly in the second half of the year.");
		} else if (avgSecond < avgFirst * 0.7) {
			trends.push("Session volume decreased notably in the second half of the year.");
		}

		// Cost trend
		const costs = reports.map((r) => r.stats.cost);
		const totalCostFirstHalf = costs.slice(0, Math.floor(costs.length / 2)).reduce((a, b) => a + b, 0);
		const totalCostSecondHalf = costs.slice(Math.floor(costs.length / 2)).reduce((a, b) => a + b, 0);
		if (totalCostSecondHalf > 0 && totalCostFirstHalf > 0) {
			if (totalCostSecondHalf < totalCostFirstHalf * 0.8) {
				trends.push("Cost efficiency improved over the year — spending decreased while activity continued.");
			} else if (totalCostSecondHalf > totalCostFirstHalf * 1.5) {
				trends.push("Spending increased substantially — review model selection and caching strategies.");
			}
		}

		// Vasana/vidhi growth
		const totalVasanas = reports.reduce((s, r) => s + r.stats.vasanasCreated, 0);
		const totalVidhis = reports.reduce((s, r) => s + r.stats.vidhisCreated, 0);
		if (totalVasanas > 10) {
			trends.push(`Strong behavioral crystallization: ${totalVasanas} vasanas formed across the year.`);
		}
		if (totalVidhis > 5) {
			trends.push(`Active procedural learning: ${totalVidhis} vidhis extracted from repeated patterns.`);
		}

		if (trends.length === 0) {
			trends.push("Steady, consistent usage throughout the year with no significant inflection points.");
		}

		return trends;
	}

	// ── Markdown Builders ─────────────────────────────────────────────────

	/**
	 * Build the Markdown content for a monthly report.
	 */
	private _buildMonthlyMarkdown(
		period: string,
		stats: ConsolidationStats,
		vasanas: VasanaRow[],
		vidhis: VidhiRow[],
		samskaras: SamskaraRow[],
		tools: Set<string>,
		newNodes: number,
		newEdges: number,
		recommendations: string[],
	): string {
		const lines: string[] = [];
		const now = new Date().toISOString();

		lines.push(`# Monthly Consolidation — ${this._project} — ${period}`);
		lines.push(`> Generated: ${now}`);
		lines.push("");
		lines.push("## Summary");
		lines.push(`- **Sessions**: ${stats.sessions}`);
		lines.push(`- **Turns**: ${stats.turns}`);
		lines.push(`- **Tools Used**: ${tools.size > 0 ? [...tools].sort().join(", ") : "none"}`);
		lines.push(`- **Total Tokens**: ${stats.tokens.toLocaleString()}`);
		lines.push(`- **Estimated Cost**: $${stats.cost.toFixed(4)}`);
		lines.push("");

		// Vasanas
		lines.push("## Vasanas Crystallized");
		if (vasanas.length === 0) {
			lines.push("_No vasanas crystallized this month._");
		} else {
			lines.push("| Tendency | Strength | Valence | Stability |");
			lines.push("|----------|----------|---------|-----------|");
			for (const v of vasanas) {
				lines.push(
					`| ${this._esc(v.name)} | ${v.strength.toFixed(2)} | ${v.valence} | ${v.stability.toFixed(2)} |`,
				);
			}
		}
		lines.push("");

		// Vidhis
		lines.push("## Vidhis Extracted");
		if (vidhis.length === 0) {
			lines.push("_No vidhis extracted this month._");
		} else {
			lines.push("| Procedure | Steps | Success Rate | Sessions |");
			lines.push("|-----------|-------|--------------|----------|");
			for (const v of vidhis) {
				const stepCount = this._countSteps(v.steps);
				const sessionCount = this._countJsonArray(v.learned_from);
				lines.push(
					`| ${this._esc(v.name)} | ${stepCount} | ${v.success_rate.toFixed(2)} | ${sessionCount} |`,
				);
			}
		}
		lines.push("");

		// Samskaras
		lines.push("## Top Samskaras");
		if (samskaras.length === 0) {
			lines.push("_No active samskaras this month._");
		} else {
			lines.push("| Pattern | Type | Confidence | Observations |");
			lines.push("|---------|------|------------|--------------|");
			for (const s of samskaras) {
				lines.push(
					`| ${this._esc(this._truncate(s.pattern_content, 60))} | ${s.pattern_type} | ${s.confidence.toFixed(2)} | ${s.observation_count} |`,
				);
			}
		}
		lines.push("");

		// Knowledge graph
		lines.push("## Knowledge Graph Growth");
		lines.push(`- New nodes: ${newNodes}`);
		lines.push(`- New edges: ${newEdges}`);
		lines.push("");

		// Recommendations
		lines.push("## Recommendations");
		for (const rec of recommendations) {
			lines.push(`- ${rec}`);
		}
		lines.push("");

		return lines.join("\n");
	}

	/**
	 * Build the Markdown content for a yearly report.
	 */
	private _buildYearlyMarkdown(
		period: string,
		stats: ConsolidationStats,
		vasanas: VasanaRow[],
		vidhis: VidhiRow[],
		samskaras: SamskaraRow[],
		yearNodes: number,
		yearEdges: number,
		monthlyReports: ConsolidationReport[],
		trends: string[],
		prevYearStats: ConsolidationStats | null,
	): string {
		const lines: string[] = [];
		const now = new Date().toISOString();

		lines.push(`# Yearly Consolidation — ${this._project} — ${period}`);
		lines.push(`> Generated: ${now}`);
		lines.push("");

		// Annual Summary
		lines.push("## Annual Summary");
		lines.push(`- **Sessions**: ${stats.sessions}`);
		lines.push(`- **Turns**: ${stats.turns}`);
		lines.push(`- **Total Tokens**: ${stats.tokens.toLocaleString()}`);
		lines.push(`- **Estimated Cost**: $${stats.cost.toFixed(4)}`);
		lines.push(`- **Vasanas Crystallized**: ${stats.vasanasCreated}`);
		lines.push(`- **Vidhis Extracted**: ${stats.vidhisCreated}`);
		lines.push(`- **Samskaras Active**: ${stats.samskarasActive}`);
		lines.push("");

		// Year-over-year comparison
		if (prevYearStats) {
			lines.push("## Year-over-Year Comparison");
			lines.push("| Metric | Previous Year | This Year | Change |");
			lines.push("|--------|---------------|-----------|--------|");

			const yoy = (label: string, prev: number, curr: number): string => {
				const delta = curr - prev;
				const pct = prev > 0 ? ((delta / prev) * 100).toFixed(1) : "N/A";
				const sign = delta >= 0 ? "+" : "";
				return `| ${label} | ${prev} | ${curr} | ${sign}${typeof pct === "string" && pct !== "N/A" ? pct + "%" : pct} |`;
			};

			lines.push(yoy("Sessions", prevYearStats.sessions, stats.sessions));
			lines.push(yoy("Turns", prevYearStats.turns, stats.turns));
			lines.push(yoy("Tokens", prevYearStats.tokens, stats.tokens));
			lines.push(yoy("Vasanas", prevYearStats.vasanasCreated, stats.vasanasCreated));
			lines.push(yoy("Vidhis", prevYearStats.vidhisCreated, stats.vidhisCreated));
			lines.push("");
		}

		// Monthly breakdown
		if (monthlyReports.length > 0) {
			lines.push("## Monthly Breakdown");
			lines.push("| Month | Sessions | Turns | Tokens | Cost |");
			lines.push("|-------|----------|-------|--------|------|");
			for (const r of monthlyReports) {
				lines.push(
					`| ${r.period} | ${r.stats.sessions} | ${r.stats.turns} | ${r.stats.tokens.toLocaleString()} | $${r.stats.cost.toFixed(4)} |`,
				);
			}
			lines.push("");
		}

		// Trends
		lines.push("## Trends");
		for (const t of trends) {
			lines.push(`- ${t}`);
		}
		lines.push("");

		// Top vasanas of the year
		lines.push("## Top Vasanas of the Year");
		if (vasanas.length === 0) {
			lines.push("_No vasanas crystallized this year._");
		} else {
			lines.push("| Tendency | Strength | Valence | Stability |");
			lines.push("|----------|----------|---------|-----------|");
			for (const v of vasanas.slice(0, 15)) {
				lines.push(
					`| ${this._esc(v.name)} | ${v.strength.toFixed(2)} | ${v.valence} | ${v.stability.toFixed(2)} |`,
				);
			}
		}
		lines.push("");

		// Top vidhis
		lines.push("## Top Vidhis of the Year");
		if (vidhis.length === 0) {
			lines.push("_No vidhis extracted this year._");
		} else {
			lines.push("| Procedure | Steps | Success Rate | Sessions |");
			lines.push("|-----------|-------|--------------|----------|");
			for (const v of vidhis.slice(0, 15)) {
				const stepCount = this._countSteps(v.steps);
				const sessionCount = this._countJsonArray(v.learned_from);
				lines.push(
					`| ${this._esc(v.name)} | ${stepCount} | ${v.success_rate.toFixed(2)} | ${sessionCount} |`,
				);
			}
		}
		lines.push("");

		// Top samskaras
		lines.push("## Top Samskaras of the Year");
		if (samskaras.length === 0) {
			lines.push("_No active samskaras this year._");
		} else {
			lines.push("| Pattern | Type | Confidence | Observations |");
			lines.push("|---------|------|------------|--------------|");
			for (const s of samskaras.slice(0, 20)) {
				lines.push(
					`| ${this._esc(this._truncate(s.pattern_content, 60))} | ${s.pattern_type} | ${s.confidence.toFixed(2)} | ${s.observation_count} |`,
				);
			}
		}
		lines.push("");

		// Knowledge graph
		lines.push("## Knowledge Graph Growth");
		lines.push(`- New nodes: ${yearNodes}`);
		lines.push(`- New edges: ${yearEdges}`);
		lines.push("");

		// Database maintenance
		lines.push("## Database Maintenance");
		lines.push("- VACUUM executed on agent.db, graph.db, vectors.db");
		lines.push("");

		return lines.join("\n");
	}

	// ── Utility ───────────────────────────────────────────────────────────

	/** Escape pipe characters for Markdown table cells. */
	private _esc(s: string): string {
		return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
	}

	/** Truncate a string to a maximum length, appending ellipsis. */
	private _truncate(s: string, max: number): string {
		if (s.length <= max) return s;
		return s.slice(0, max - 3) + "...";
	}

	/** Parse a JSON array string and return its length, or 0 on failure. */
	private _countJsonArray(json: string | null): number {
		if (!json) return 0;
		try {
			const arr = JSON.parse(json);
			return Array.isArray(arr) ? arr.length : 0;
		} catch {
			return 0;
		}
	}

	/** Parse a steps JSON and return the count. */
	private _countSteps(json: string | null): number {
		return this._countJsonArray(json);
	}
}
