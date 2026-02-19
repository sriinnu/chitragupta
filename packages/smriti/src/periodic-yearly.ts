/**
 * @chitragupta/smriti — Periodic Yearly Consolidation
 *
 * Yearly consolidation logic: reads/generates all 12 monthly reports,
 * aggregates annual statistics, identifies trends, and generates a
 * comprehensive yearly Markdown report.
 */

import fs from "node:fs";
import { DatabaseManager } from "./db/index.js";
import type { ConsolidationStats, ConsolidationReport, ConsolidationLogEntry } from "./periodic-consolidation.js";

// ─── Internal Row Shapes ────────────────────────────────────────────────────

interface VasanaRow { name: string; description: string; strength: number; valence: string; stability: number }
interface SamskaraRow { id: string; pattern_type: string; pattern_content: string; confidence: number; observation_count: number }
interface VidhiRow { name: string; steps: string; success_rate: number; learned_from: string }
interface NodeCountRow { cnt: number }
interface EdgeCountRow { cnt: number }

// ─── Utilities ──────────────────────────────────────────────────────────────

function esc(s: string): string { return s.replace(/\|/g, "\\|").replace(/\n/g, " "); }
function truncate(s: string, max: number): string { return s.length <= max ? s : s.slice(0, max - 3) + "..."; }
function countJsonArray(json: string | null): number {
	if (!json) return 0;
	try { const arr = JSON.parse(json); return Array.isArray(arr) ? arr.length : 0; } catch { return 0; }
}

// ─── Trend Analysis ─────────────────────────────────────────────────────────

/** Analyze trends across monthly reports within a year. */
function analyzeTrends(reports: ConsolidationReport[]): string[] {
	const trends: string[] = [];
	if (reports.length < 2) return trends;

	const sessionCounts = reports.map((r) => r.stats.sessions);
	const half = Math.floor(sessionCounts.length / 2);
	const avgFirst = sessionCounts.slice(0, half).reduce((a, b) => a + b, 0) / (half || 1);
	const avgSecond = sessionCounts.slice(half).reduce((a, b) => a + b, 0) / ((sessionCounts.length - half) || 1);

	if (avgSecond > avgFirst * 1.3) trends.push("Session volume increased significantly in the second half of the year.");
	else if (avgSecond < avgFirst * 0.7) trends.push("Session volume decreased notably in the second half of the year.");

	const costs = reports.map((r) => r.stats.cost);
	const costFirst = costs.slice(0, half).reduce((a, b) => a + b, 0);
	const costSecond = costs.slice(half).reduce((a, b) => a + b, 0);
	if (costSecond > 0 && costFirst > 0) {
		if (costSecond < costFirst * 0.8) trends.push("Cost efficiency improved over the year — spending decreased while activity continued.");
		else if (costSecond > costFirst * 1.5) trends.push("Spending increased substantially — review model selection and caching strategies.");
	}

	const totalVasanas = reports.reduce((s, r) => s + r.stats.vasanasCreated, 0);
	const totalVidhis = reports.reduce((s, r) => s + r.stats.vidhisCreated, 0);
	if (totalVasanas > 10) trends.push(`Strong behavioral crystallization: ${totalVasanas} vasanas formed across the year.`);
	if (totalVidhis > 5) trends.push(`Active procedural learning: ${totalVidhis} vidhis extracted from repeated patterns.`);

	if (trends.length === 0) trends.push("Steady, consistent usage throughout the year with no significant inflection points.");
	return trends;
}

// ─── Yearly Markdown Builder ────────────────────────────────────────────────

/** Build Markdown content for a yearly report. */
function buildYearlyMarkdown(
	project: string, period: string, stats: ConsolidationStats,
	vasanas: VasanaRow[], vidhis: VidhiRow[], samskaras: SamskaraRow[],
	yearNodes: number, yearEdges: number, monthlyReports: ConsolidationReport[],
	trends: string[], prevYearStats: ConsolidationStats | null,
): string {
	const lines: string[] = [];
	lines.push(`# Yearly Consolidation — ${project} — ${period}`, `> Generated: ${new Date().toISOString()}`, "");

	lines.push("## Annual Summary");
	lines.push(`- **Sessions**: ${stats.sessions}`, `- **Turns**: ${stats.turns}`);
	lines.push(`- **Total Tokens**: ${stats.tokens.toLocaleString()}`, `- **Estimated Cost**: $${stats.cost.toFixed(4)}`);
	lines.push(`- **Vasanas Crystallized**: ${stats.vasanasCreated}`, `- **Vidhis Extracted**: ${stats.vidhisCreated}`);
	lines.push(`- **Samskaras Active**: ${stats.samskarasActive}`, "");

	if (prevYearStats) {
		lines.push("## Year-over-Year Comparison");
		lines.push("| Metric | Previous Year | This Year | Change |", "|--------|---------------|-----------|--------|");
		const yoy = (label: string, prev: number, curr: number): string => {
			const d = curr - prev;
			const pct = prev > 0 ? ((d / prev) * 100).toFixed(1) : "N/A";
			return `| ${label} | ${prev} | ${curr} | ${d >= 0 ? "+" : ""}${pct !== "N/A" ? pct + "%" : pct} |`;
		};
		lines.push(yoy("Sessions", prevYearStats.sessions, stats.sessions));
		lines.push(yoy("Turns", prevYearStats.turns, stats.turns));
		lines.push(yoy("Tokens", prevYearStats.tokens, stats.tokens));
		lines.push(yoy("Vasanas", prevYearStats.vasanasCreated, stats.vasanasCreated));
		lines.push(yoy("Vidhis", prevYearStats.vidhisCreated, stats.vidhisCreated));
		lines.push("");
	}

	if (monthlyReports.length > 0) {
		lines.push("## Monthly Breakdown");
		lines.push("| Month | Sessions | Turns | Tokens | Cost |", "|-------|----------|-------|--------|------|");
		for (const r of monthlyReports) lines.push(`| ${r.period} | ${r.stats.sessions} | ${r.stats.turns} | ${r.stats.tokens.toLocaleString()} | $${r.stats.cost.toFixed(4)} |`);
		lines.push("");
	}

	lines.push("## Trends");
	for (const t of trends) lines.push(`- ${t}`);
	lines.push("");

	lines.push("## Top Vasanas of the Year");
	if (vasanas.length === 0) { lines.push("_No vasanas crystallized this year._"); }
	else {
		lines.push("| Tendency | Strength | Valence | Stability |", "|----------|----------|---------|-----------|");
		for (const v of vasanas.slice(0, 15)) lines.push(`| ${esc(v.name)} | ${v.strength.toFixed(2)} | ${v.valence} | ${v.stability.toFixed(2)} |`);
	}
	lines.push("");

	lines.push("## Top Vidhis of the Year");
	if (vidhis.length === 0) { lines.push("_No vidhis extracted this year._"); }
	else {
		lines.push("| Procedure | Steps | Success Rate | Sessions |", "|-----------|-------|--------------|----------|");
		for (const v of vidhis.slice(0, 15)) lines.push(`| ${esc(v.name)} | ${countJsonArray(v.steps)} | ${v.success_rate.toFixed(2)} | ${countJsonArray(v.learned_from)} |`);
	}
	lines.push("");

	lines.push("## Top Samskaras of the Year");
	if (samskaras.length === 0) { lines.push("_No active samskaras this year._"); }
	else {
		lines.push("| Pattern | Type | Confidence | Observations |", "|---------|------|------------|--------------|");
		for (const s of samskaras.slice(0, 20)) lines.push(`| ${esc(truncate(s.pattern_content, 60))} | ${s.pattern_type} | ${s.confidence.toFixed(2)} | ${s.observation_count} |`);
	}
	lines.push("");

	lines.push("## Knowledge Graph Growth", `- New nodes: ${yearNodes}`, `- New edges: ${yearEdges}`, "");
	lines.push("## Database Maintenance", "- VACUUM executed on agent.db, graph.db, vectors.db", "");
	return lines.join("\n");
}

// ─── Yearly Report Builder ──────────────────────────────────────────────────

/** Build a yearly consolidation report for a calendar year. */
export async function buildYearlyReport(
	project: string, home: string, baseDir: string, year: number,
	monthlyFn: (year: number, month: number) => Promise<ConsolidationReport>,
	extractStatsFromMarkdown: (md: string) => ConsolidationStats,
	writeReport: (filePath: string, content: string) => void,
	indexIntoFts: (agentDb: ReturnType<DatabaseManager["get"]>, content: string) => void,
	logConsolidation: (agentDb: ReturnType<DatabaseManager["get"]>, entry: Omit<ConsolidationLogEntry, "id">) => void,
	getReportPath: (type: "monthly" | "yearly", period: string) => string,
): Promise<ConsolidationReport> {
	const t0 = Date.now();
	const period = String(year);
	const startMs = new Date(Date.UTC(year, 0, 1)).getTime();
	const endMs = new Date(Date.UTC(year + 1, 0, 1)).getTime();

	const dbm = DatabaseManager.instance(home);
	const agentDb = dbm.get("agent");
	const graphDb = dbm.get("graph");

	// Read or generate all monthly reports
	const monthlyReports: ConsolidationReport[] = [];
	for (let m = 1; m <= 12; m++) {
		const mp = `${year}-${String(m).padStart(2, "0")}`;
		const mPath = getReportPath("monthly", mp);
		if (!fs.existsSync(mPath)) {
			const ms = new Date(Date.UTC(year, m - 1, 1)).getTime();
			const me = new Date(Date.UTC(year, m, 1)).getTime();
			if (me <= Date.now()) {
				const cnt = (agentDb.prepare(`SELECT COUNT(*) AS cnt FROM sessions WHERE project = ? AND created_at >= ? AND created_at < ?`).get(project, ms, me) as NodeCountRow | undefined)?.cnt ?? 0;
				if (cnt > 0) { monthlyReports.push(await monthlyFn(year, m)); continue; }
			}
		} else {
			const content = fs.readFileSync(mPath, "utf-8");
			monthlyReports.push({ type: "monthly", period: mp, project, filePath: mPath, markdown: content, stats: extractStatsFromMarkdown(content), durationMs: 0 });
		}
	}

	// Aggregate annual stats
	const annualStats: ConsolidationStats = { sessions: 0, turns: 0, tokens: 0, cost: 0, vasanasCreated: 0, vidhisCreated: 0, samskarasActive: 0 };
	for (const r of monthlyReports) {
		annualStats.sessions += r.stats.sessions; annualStats.turns += r.stats.turns;
		annualStats.tokens += r.stats.tokens; annualStats.cost += r.stats.cost;
		annualStats.vasanasCreated += r.stats.vasanasCreated; annualStats.vidhisCreated += r.stats.vidhisCreated;
		annualStats.samskarasActive += r.stats.samskarasActive;
	}

	const allVasanas = agentDb.prepare(`SELECT name, description, strength, valence, stability FROM vasanas WHERE (project = ? OR project IS NULL) AND created_at >= ? AND created_at < ? ORDER BY strength DESC`).all(project, startMs, endMs) as VasanaRow[];
	const allVidhis = agentDb.prepare(`SELECT name, steps, success_rate, learned_from FROM vidhis WHERE project = ? AND created_at >= ? AND created_at < ? ORDER BY success_rate DESC`).all(project, startMs, endMs) as VidhiRow[];
	const allSamskaras = agentDb.prepare(`SELECT id, pattern_type, pattern_content, confidence, observation_count FROM samskaras WHERE (project = ? OR project IS NULL) AND updated_at >= ? AND updated_at < ? ORDER BY confidence DESC LIMIT 30`).all(project, startMs, endMs) as SamskaraRow[];

	const yearNodes = (graphDb.prepare(`SELECT COUNT(*) AS cnt FROM nodes WHERE created_at >= ? AND created_at < ?`).get(startMs, endMs) as NodeCountRow | undefined)?.cnt ?? 0;
	const yearEdges = (graphDb.prepare(`SELECT COUNT(*) AS cnt FROM edges WHERE recorded_at >= ? AND recorded_at < ?`).get(startMs, endMs) as EdgeCountRow | undefined)?.cnt ?? 0;

	let prevYearStats: ConsolidationStats | null = null;
	const prevPath = getReportPath("yearly", String(year - 1));
	if (fs.existsSync(prevPath)) prevYearStats = extractStatsFromMarkdown(fs.readFileSync(prevPath, "utf-8"));

	const trends = analyzeTrends(monthlyReports);
	const markdown = buildYearlyMarkdown(project, period, annualStats, allVasanas, allVidhis, allSamskaras, yearNodes, yearEdges, monthlyReports, trends, prevYearStats);

	const filePath = getReportPath("yearly", period);
	writeReport(filePath, markdown);

	try { const { indexConsolidationSummary } = await import("./consolidation-indexer.js"); await indexConsolidationSummary("yearly", period, markdown, project); } catch { /* best-effort */ }
	indexIntoFts(agentDb, markdown);

	dbm.vacuum("agent"); dbm.vacuum("graph"); dbm.vacuum("vectors");

	const durationMs = Date.now() - t0;
	logConsolidation(agentDb, { project, cycleType: "yearly", cycleId: `yearly-${period}`, vasanasCreated: allVasanas.length, vidhisCreated: allVidhis.length, samskarasProcessed: allSamskaras.length, sessionsProcessed: annualStats.sessions, status: "success", createdAt: Date.now() });

	return { type: "yearly", period, project, filePath, markdown, stats: annualStats, durationMs };
}
