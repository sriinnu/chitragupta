/**
 * @chitragupta/smriti — Periodic Monthly Consolidation
 *
 * Monthly consolidation logic: queries sessions, vasanas, vidhis,
 * samskaras within a calendar month and generates a Markdown report.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseManager } from "./db/index.js";
import type { ConsolidationStats, ConsolidationReport, ConsolidationLogEntry } from "./periodic-consolidation.js";

// ─── Internal Row Shapes ────────────────────────────────────────────────────

interface SessionRow { id: string; title: string; turn_count: number; cost: number; tokens: number; created_at: number }
interface TurnRow { tool_calls: string | null }
interface VasanaRow { name: string; description: string; strength: number; valence: string; stability: number }
interface SamskaraRow { id: string; pattern_type: string; pattern_content: string; confidence: number; observation_count: number }
interface VidhiRow { name: string; steps: string; success_rate: number; learned_from: string }
interface NodeCountRow { cnt: number }
interface EdgeCountRow { cnt: number }

// ─── Utilities ──────────────────────────────────────────────────────────────

/** Escape pipe characters for Markdown table cells. */
function esc(s: string): string { return s.replace(/\|/g, "\\|").replace(/\n/g, " "); }

/** Truncate a string, appending ellipsis. */
function truncate(s: string, max: number): string { return s.length <= max ? s : s.slice(0, max - 3) + "..."; }

/** Parse a JSON array string and return its length. */
function countJsonArray(json: string | null): number {
	if (!json) return 0;
	try { const arr = JSON.parse(json); return Array.isArray(arr) ? arr.length : 0; } catch { return 0; }
}

// ─── Recommendations Generator ──────────────────────────────────────────────

/** Generate actionable recommendations based on consolidation data. */
function generateRecommendations(
	stats: ConsolidationStats, vasanas: VasanaRow[], vidhis: VidhiRow[],
	samskaras: SamskaraRow[], tools: Set<string>,
): string[] {
	const recs: string[] = [];

	if (stats.sessions > 0 && stats.cost > 0) {
		const cps = stats.cost / stats.sessions;
		if (cps > 1.0) recs.push(`Average cost per session is $${cps.toFixed(2)} — consider using lighter models for routine tasks.`);
	}
	if (stats.turns > 0 && stats.tokens > 0) {
		const tpt = Math.round(stats.tokens / stats.turns);
		if (tpt > 5000) recs.push(`High token usage per turn (${tpt.toLocaleString()} avg) — review context window usage and compaction settings.`);
	}

	const negVas = vasanas.filter((v) => v.valence === "negative");
	if (negVas.length > 0) recs.push(`${negVas.length} negative vasana(s) detected: ${negVas.map((v) => v.name).join(", ")}. Investigate root causes.`);

	const weakVidhis = vidhis.filter((v) => v.success_rate < 0.5);
	if (weakVidhis.length > 0) recs.push(`${weakVidhis.length} vidhi(s) with sub-50% success rate — consider refining or deprecating: ${weakVidhis.map((v) => v.name).join(", ")}.`);

	const strongSam = samskaras.filter((s) => s.confidence > 0.8 && s.observation_count >= 5);
	if (strongSam.length > 0) recs.push(`${strongSam.length} high-confidence samskara(s) may be ready for vasana crystallization.`);

	if (tools.size > 0 && stats.sessions >= 5) {
		if (tools.size / stats.sessions < 1.5) recs.push("Low tool diversity — explore additional tools to improve efficiency.");
	}

	if (recs.length === 0) recs.push("All metrics within healthy ranges. Keep up the momentum.");
	return recs;
}

// ─── Markdown Builder ───────────────────────────────────────────────────────

/** Build Markdown content for a monthly report. */
function buildMonthlyMarkdown(
	project: string, period: string, stats: ConsolidationStats,
	vasanas: VasanaRow[], vidhis: VidhiRow[], samskaras: SamskaraRow[],
	tools: Set<string>, newNodes: number, newEdges: number, recommendations: string[],
): string {
	const lines: string[] = [];
	lines.push(`# Monthly Consolidation — ${project} — ${period}`, `> Generated: ${new Date().toISOString()}`, "");
	lines.push("## Summary");
	lines.push(`- **Sessions**: ${stats.sessions}`, `- **Turns**: ${stats.turns}`);
	lines.push(`- **Tools Used**: ${tools.size > 0 ? [...tools].sort().join(", ") : "none"}`);
	lines.push(`- **Total Tokens**: ${stats.tokens.toLocaleString()}`, `- **Estimated Cost**: $${stats.cost.toFixed(4)}`, "");

	lines.push("## Vasanas Crystallized");
	if (vasanas.length === 0) { lines.push("_No vasanas crystallized this month._"); }
	else {
		lines.push("| Tendency | Strength | Valence | Stability |", "|----------|----------|---------|-----------|");
		for (const v of vasanas) lines.push(`| ${esc(v.name)} | ${v.strength.toFixed(2)} | ${v.valence} | ${v.stability.toFixed(2)} |`);
	}
	lines.push("");

	lines.push("## Vidhis Extracted");
	if (vidhis.length === 0) { lines.push("_No vidhis extracted this month._"); }
	else {
		lines.push("| Procedure | Steps | Success Rate | Sessions |", "|-----------|-------|--------------|----------|");
		for (const v of vidhis) lines.push(`| ${esc(v.name)} | ${countJsonArray(v.steps)} | ${v.success_rate.toFixed(2)} | ${countJsonArray(v.learned_from)} |`);
	}
	lines.push("");

	lines.push("## Top Samskaras");
	if (samskaras.length === 0) { lines.push("_No active samskaras this month._"); }
	else {
		lines.push("| Pattern | Type | Confidence | Observations |", "|---------|------|------------|--------------|");
		for (const s of samskaras) lines.push(`| ${esc(truncate(s.pattern_content, 60))} | ${s.pattern_type} | ${s.confidence.toFixed(2)} | ${s.observation_count} |`);
	}
	lines.push("");

	lines.push("## Knowledge Graph Growth", `- New nodes: ${newNodes}`, `- New edges: ${newEdges}`, "");
	lines.push("## Recommendations");
	for (const rec of recommendations) lines.push(`- ${rec}`);
	lines.push("");
	return lines.join("\n");
}

// ─── Monthly Report Builder ─────────────────────────────────────────────────

/** Build a monthly consolidation report for a calendar month. */
export async function buildMonthlyReport(
	project: string, home: string, baseDir: string,
	year: number, month: number,
	writeReport: (filePath: string, content: string) => void,
	indexIntoFts: (agentDb: ReturnType<DatabaseManager["get"]>, content: string) => void,
	logConsolidation: (agentDb: ReturnType<DatabaseManager["get"]>, entry: Omit<ConsolidationLogEntry, "id">) => void,
	getReportPath: (type: "monthly" | "yearly", period: string) => string,
): Promise<ConsolidationReport> {
	const t0 = Date.now();
	const period = `${year}-${String(month).padStart(2, "0")}`;
	const start = new Date(Date.UTC(year, month - 1, 1));
	const end = new Date(Date.UTC(year, month, 1));
	const startMs = start.getTime();
	const endMs = end.getTime();

	const dbm = DatabaseManager.instance(home);
	const agentDb = dbm.get("agent");
	const graphDb = dbm.get("graph");

	const sessions = agentDb
		.prepare(`SELECT id, title, turn_count, cost, tokens, created_at FROM sessions WHERE project = ? AND created_at >= ? AND created_at < ? ORDER BY created_at ASC`)
		.all(project, startMs, endMs) as SessionRow[];

	const sessionIds = sessions.map((s) => s.id);
	const totalTurns = sessions.reduce((sum, s) => sum + s.turn_count, 0);
	const totalTokens = sessions.reduce((sum, s) => sum + (s.tokens ?? 0), 0);
	const totalCost = sessions.reduce((sum, s) => sum + (s.cost ?? 0), 0);

	const toolSet = new Set<string>();
	if (sessionIds.length > 0) {
		const ph = sessionIds.map(() => "?").join(",");
		const turns = agentDb.prepare(`SELECT tool_calls FROM turns WHERE session_id IN (${ph}) AND tool_calls IS NOT NULL`).all(...sessionIds) as TurnRow[];
		for (const turn of turns) {
			if (!turn.tool_calls) continue;
			try { for (const c of JSON.parse(turn.tool_calls) as Array<{ name?: string }>) { if (c.name) toolSet.add(c.name); } } catch { /* skip */ }
		}
	}

	const vasanas = agentDb.prepare(`SELECT name, description, strength, valence, stability FROM vasanas WHERE (project = ? OR project IS NULL) AND created_at >= ? AND created_at < ? ORDER BY strength DESC`).all(project, startMs, endMs) as VasanaRow[];
	const vidhis = agentDb.prepare(`SELECT name, steps, success_rate, learned_from FROM vidhis WHERE project = ? AND created_at >= ? AND created_at < ? ORDER BY success_rate DESC`).all(project, startMs, endMs) as VidhiRow[];
	const samskaras = agentDb.prepare(`SELECT id, pattern_type, pattern_content, confidence, observation_count FROM samskaras WHERE (project = ? OR project IS NULL) AND updated_at >= ? AND updated_at < ? ORDER BY confidence DESC LIMIT 20`).all(project, startMs, endMs) as SamskaraRow[];

	const newNodes = (graphDb.prepare(`SELECT COUNT(*) AS cnt FROM nodes WHERE created_at >= ? AND created_at < ?`).get(startMs, endMs) as NodeCountRow | undefined)?.cnt ?? 0;
	const newEdges = (graphDb.prepare(`SELECT COUNT(*) AS cnt FROM edges WHERE recorded_at >= ? AND recorded_at < ?`).get(startMs, endMs) as EdgeCountRow | undefined)?.cnt ?? 0;

	const stats: ConsolidationStats = { sessions: sessions.length, turns: totalTurns, tokens: totalTokens, cost: totalCost, vasanasCreated: vasanas.length, vidhisCreated: vidhis.length, samskarasActive: samskaras.length };
	const recommendations = generateRecommendations(stats, vasanas, vidhis, samskaras, toolSet);
	const markdown = buildMonthlyMarkdown(project, period, stats, vasanas, vidhis, samskaras, toolSet, newNodes, newEdges, recommendations);

	const filePath = getReportPath("monthly", period);
	writeReport(filePath, markdown);

	try { const { indexConsolidationSummary } = await import("./consolidation-indexer.js"); await indexConsolidationSummary("monthly", period, markdown, project); } catch { /* best-effort */ }
	indexIntoFts(agentDb, markdown);

	const durationMs = Date.now() - t0;
	logConsolidation(agentDb, { project, cycleType: "monthly", cycleId: `monthly-${period}`, vasanasCreated: vasanas.length, vidhisCreated: vidhis.length, samskarasProcessed: samskaras.length, sessionsProcessed: sessions.length, status: "success", createdAt: Date.now() });

	return { type: "monthly", period, project, filePath, markdown, stats, durationMs };
}
