/**
 * PeriodicConsolidation — Monthly and yearly consolidation reports.
 *
 * Generates human-readable Markdown reports aggregating session data,
 * vasanas, vidhis, and samskaras over calendar periods. Reports are
 * stored under `<chitraguptaHome>/consolidated/<projHash>/`.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { getChitraguptaHome } from "@chitragupta/core";
import { DatabaseManager } from "./db/index.js";
import type { ConsolidationLogEntry } from "./types.js";
import { buildMonthlyReport } from "./periodic-monthly.js";
import { buildYearlyReport } from "./periodic-yearly.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Configuration for the PeriodicConsolidation engine. */
export interface PeriodicConfig {
	/** Project identifier (path or slug). */
	project: string;
	/** Override the Chitragupta home directory. */
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

/** Result of a monthly or yearly consolidation run. */
export interface ConsolidationReport {
	type: "monthly" | "yearly";
	/** Period identifier: 'YYYY-MM' for monthly, 'YYYY' for yearly. */
	period: string;
	project: string;
	/** Absolute path to the generated Markdown file. */
	filePath: string;
	/** Full Markdown content of the report. */
	markdown: string;
	stats: ConsolidationStats;
	/** Wall-clock duration in milliseconds. */
	durationMs: number;
}

/** Descriptor for a persisted report file. */
export interface ReportEntry {
	type: "monthly" | "yearly";
	period: string;
	path: string;
}

/** Re-export ConsolidationLogEntry for split modules. */
export type { ConsolidationLogEntry };

// ─── FNV-1a Project Hash ────────────────────────────────────────────────────

/** Compute a 4-character hex hash of a project name using FNV-1a. */
function projectHash(project: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < project.length; i++) {
		h ^= project.charCodeAt(i);
		h = (h * 0x01000193) >>> 0;
	}
	return (h >>> 0).toString(16).slice(0, 4);
}

// ─── PeriodicConsolidation ──────────────────────────────────────────────────

/**
 * Engine for generating monthly and yearly consolidation reports.
 *
 * @example
 * ```ts
 * const pc = new PeriodicConsolidation({ project: "my-app" });
 * const report = await pc.monthly(2026, 1);
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

	/** Run monthly consolidation for a specific calendar month. */
	async monthly(year: number, month: number): Promise<ConsolidationReport> {
		return buildMonthlyReport(
			this._project, this._home, this._baseDir, year, month,
			this._writeReport.bind(this), this._indexIntoFts.bind(this),
			this._logConsolidation.bind(this), this.getReportPath.bind(this),
		);
	}

	/** Run yearly consolidation for a specific calendar year. */
	async yearly(year: number): Promise<ConsolidationReport> {
		return buildYearlyReport(
			this._project, this._home, this._baseDir, year,
			this.monthly.bind(this), this._extractStatsFromMarkdown.bind(this),
			this._writeReport.bind(this), this._indexIntoFts.bind(this),
			this._logConsolidation.bind(this), this.getReportPath.bind(this),
		);
	}

	/** Check whether a monthly report exists on disk. */
	hasMonthlyReport(year: number, month: number): boolean {
		const period = `${year}-${String(month).padStart(2, "0")}`;
		return fs.existsSync(this.getReportPath("monthly", period));
	}

	/** Check whether a yearly report exists on disk. */
	hasYearlyReport(year: number): boolean {
		return fs.existsSync(this.getReportPath("yearly", String(year)));
	}

	/** Get the absolute file path for a report. */
	getReportPath(type: "monthly" | "yearly", period: string): string {
		return path.join(this._baseDir, type, `${period}.md`);
	}

	/** List all existing reports for this project. */
	listReports(): ReportEntry[] {
		const reports: ReportEntry[] = [];
		for (const type of ["monthly", "yearly"] as const) {
			const dir = path.join(this._baseDir, type);
			if (!fs.existsSync(dir)) continue;
			const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
			for (const file of files) {
				reports.push({ type, period: file.replace(/\.md$/, ""), path: path.join(dir, file) });
			}
		}
		return reports;
	}

	// ── Private Helpers ───────────────────────────────────────────────────

	/** Write a Markdown report to disk, creating parent dirs as needed. */
	private _writeReport(filePath: string, content: string): void {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, "utf-8");
		fs.chmodSync(filePath, 0o600);
	}

	/** Index report text into FTS5 for full-text search. */
	private _indexIntoFts(agentDb: ReturnType<DatabaseManager["get"]>, content: string): void {
		try { agentDb.prepare("INSERT INTO turns_fts(content) VALUES (?)").run(content); } catch { /* non-fatal */ }
	}

	/** Log a consolidation run to the consolidation_log table. */
	private _logConsolidation(agentDb: ReturnType<DatabaseManager["get"]>, entry: Omit<ConsolidationLogEntry, "id">): void {
		try {
			agentDb.prepare(
				`INSERT INTO consolidation_log (project, cycle_type, cycle_id, vasanas_created, vidhis_created, samskaras_processed, sessions_processed, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(entry.project, entry.cycleType, entry.cycleId, entry.vasanasCreated, entry.vidhisCreated, entry.samskarasProcessed, entry.sessionsProcessed, entry.status, entry.createdAt);
		} catch { /* non-fatal */ }
	}

	/** Extract stats from a previously generated Markdown report. */
	private _extractStatsFromMarkdown(md: string): ConsolidationStats {
		const stats: ConsolidationStats = { sessions: 0, turns: 0, tokens: 0, cost: 0, vasanasCreated: 0, vidhisCreated: 0, samskarasActive: 0 };

		const num = (pattern: RegExp): number => {
			const match = md.match(pattern);
			return match ? (parseFloat(match[1].replace(/,/g, "")) || 0) : 0;
		};

		stats.sessions = num(/\*\*Sessions\*\*:\s*([\d,]+)/);
		stats.turns = num(/\*\*Turns\*\*:\s*([\d,]+)/);
		stats.tokens = num(/\*\*Total Tokens\*\*:\s*([\d,]+)/);
		stats.cost = num(/\*\*Estimated Cost\*\*:\s*\$?([\d,.]+)/);

		const countTableRows = (sectionName: string): number => {
			const section = md.match(new RegExp(`## ${sectionName}\\n[\\s\\S]*?(?=\\n##|$)`));
			if (!section) return 0;
			const rows = (section[0].match(/^\|(?!\s*-)[^|]+\|/gm) || []).length - 1;
			return rows < 0 ? 0 : rows;
		};

		stats.vasanasCreated = countTableRows("Vasanas Crystallized");
		stats.vidhisCreated = countTableRows("Vidhis Extracted");
		stats.samskarasActive = countTableRows("Top Samskaras");

		return stats;
	}
}
