/**
 * @chitragupta/anina — Pratyabhijna internal computations.
 *
 * Temporal decay, relative time formatting, project label extraction,
 * cross-project insight loading, narrative generation, and DB persistence.
 * All pure or side-effect-contained functions operating on passed-in data.
 */

import type { DatabaseManager } from "@chitragupta/smriti";
import type { PratyabhijnaContext, PratyabhijnaConfig } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** ln(2) — precomputed for temporal decay. */
export const LN2 = Math.LN2;

/** Default half-life for vasana recency decay: 7 days in ms. */
export const DEFAULT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** Global vasana project sentinel. */
export const GLOBAL_PROJECT = "__global__";

// ─── Row Types (SQLite result shapes) ────────────────────────────────────────

/** @internal */
export interface PreparedStmt {
	all(...params: unknown[]): unknown[];
	get(...params: unknown[]): unknown;
	run(...params: unknown[]): unknown;
}

/** @internal */
export interface VasanaRow {
	id: number; name: string; description: string;
	valence: "positive" | "negative" | "neutral";
	strength: number; stability: number;
	source_samskaras: string | null; project: string | null;
	created_at: number; updated_at: number;
	last_activated: number | null; activation_count: number;
}

/** @internal */
export interface SamskaraRow {
	id: string; session_id: string;
	pattern_type: string; pattern_content: string;
	observation_count: number; confidence: number;
	pramana_type: string | null; project: string | null;
	created_at: number; updated_at: number;
}

/** @internal */
export interface SessionProjectRow { project: string; }

/** @internal */
export interface PratyabhijnaRow {
	session_id: string; project: string;
	identity_summary: string | null;
	global_vasanas: string | null; project_vasanas: string | null;
	active_samskaras: string | null; cross_project_insights: string | null;
	tool_mastery: string | null; warmup_ms: number | null;
	created_at: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Temporal decay weight: strength * exp(-ln2 * age / halfLife). */
export function decayedScore(strength: number, lastActivated: number | null, now: number, halfLifeMs: number): number {
	if (lastActivated == null || lastActivated <= 0) return strength * 0.1;
	const age = now - lastActivated;
	if (age <= 0) return strength;
	return strength * Math.exp(-LN2 * age / halfLifeMs);
}

/** Format a Unix-ms timestamp as a human-friendly relative string. */
export function relativeTime(ts: number, now: number): string {
	const delta = now - ts;
	if (delta < 60_000) return "just now";
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} minutes ago`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} hours ago`;
	if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)} days ago`;
	return `${Math.floor(delta / 604_800_000)} weeks ago`;
}

/** Extract a short label from a project path. "/Users/foo/Projects/my-app" -> "my-app" */
export function shortProjectLabel(projectPath: string): string {
	const segments = projectPath.replace(/\/+$/, "").split("/");
	return segments[segments.length - 1] || projectPath;
}

// ─── Cross-Project Insights ─────────────────────────────────────────────────

/** Load vasanas from other projects that may be relevant to the current one. */
export function loadCrossProjectInsights(
	prep: (db: ReturnType<DatabaseManager["get"]>, sql: string) => PreparedStmt,
	agentDb: ReturnType<DatabaseManager["get"]>,
	currentProject: string,
	now: number,
	halfLifeMs: number,
	config: PratyabhijnaConfig,
): string[] {
	const projects = prep(agentDb, `
		SELECT DISTINCT project FROM sessions
		WHERE project != ? AND project != ?
		ORDER BY updated_at DESC LIMIT ?
	`).all(currentProject, GLOBAL_PROJECT, config.maxCrossProject) as SessionProjectRow[];

	if (projects.length === 0) return [];
	const insights: string[] = [];

	for (const { project: otherProject } of projects) {
		const otherVasanas = prep(agentDb, `
			SELECT * FROM vasanas
			WHERE project = ?
			ORDER BY strength DESC LIMIT ?
		`).all(otherProject, 3) as VasanaRow[];

		for (const v of otherVasanas) {
			const score = decayedScore(v.strength, v.last_activated, now, halfLifeMs);
			if (score < 0.2) continue;
			insights.push(`In ${shortProjectLabel(otherProject)}: ${v.name.replace(/-/g, " ")}`);
		}
		if (insights.length >= config.maxCrossProject) break;
	}
	return insights.slice(0, config.maxCrossProject);
}

// ─── Narrative Generation ───────────────────────────────────────────────────

/** Generate the zero-LLM identity narrative from a PratyabhijnaContext. */
export function generateNarrative(ctx: PratyabhijnaContext, lastSessionTs?: number, now?: number): string {
	const ts = now ?? Date.now();
	const parts: string[] = [];

	if (lastSessionTs && lastSessionTs > 0) {
		parts.push(`I am Chitragupta. Last session with this project: ${relativeTime(lastSessionTs, ts)}.`);
	} else {
		parts.push("I am Chitragupta. This is my first session with this project.");
	}

	const insights = [...ctx.globalVasanas, ...ctx.projectVasanas]
		.filter(v => v.valence !== "negative")
		.sort((a, b) => b.strength - a.strength)
		.slice(0, 5)
		.map(v => v.tendency.replace(/-/g, " "));
	if (insights.length > 0) parts.push(`I know: ${insights.join("; ")}.`);

	const tools = Object.entries(ctx.toolMastery).sort((a, b) => b[1] - a[1]).slice(0, 5);
	if (tools.length > 0) {
		parts.push(`I'm good at: ${tools.map(([n, r]) => `${n} (${Math.round(r * 100)}%)`).join(", ")}.`);
	}

	const negatives = [...ctx.globalVasanas, ...ctx.projectVasanas]
		.filter(v => v.valence === "negative")
		.sort((a, b) => b.strength - a.strength)
		.slice(0, 3)
		.map(v => v.tendency.replace(/-/g, " "));
	if (negatives.length > 0) parts.push(`I struggle with: ${negatives.join("; ")}.`);

	const prefs = ctx.activeSamskaras.filter(s => s.patternType === "preference").slice(0, 5).map(s => s.patternContent);
	if (prefs.length > 0) parts.push(`User prefers: ${prefs.join("; ")}.`);

	if (ctx.crossProjectInsights.length > 0) parts.push(`Cross-project: ${ctx.crossProjectInsights.join("; ")}.`);

	return parts.join("\n");
}

// ─── DB Persistence ─────────────────────────────────────────────────────────

/** Persist a PratyabhijnaContext to the pratyabhijna_context table. */
export function persistToDb(
	ctx: PratyabhijnaContext,
	prep: (db: ReturnType<DatabaseManager["get"]>, sql: string) => PreparedStmt,
	agentDb: ReturnType<DatabaseManager["get"]>,
): void {
	prep(agentDb, `
		INSERT OR REPLACE INTO pratyabhijna_context
			(session_id, project, identity_summary,
			 global_vasanas, project_vasanas, active_samskaras,
			 cross_project_insights, tool_mastery, warmup_ms, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		ctx.sessionId, ctx.project, ctx.identitySummary,
		JSON.stringify(ctx.globalVasanas), JSON.stringify(ctx.projectVasanas),
		JSON.stringify(ctx.activeSamskaras), JSON.stringify(ctx.crossProjectInsights),
		JSON.stringify(ctx.toolMastery), ctx.warmupMs, ctx.createdAt,
	);
}

/** Load the most recent PratyabhijnaContext for a project from SQLite. */
export function loadPreviousContext(
	project: string,
	prep: (db: ReturnType<DatabaseManager["get"]>, sql: string) => PreparedStmt,
	agentDb: ReturnType<DatabaseManager["get"]>,
): PratyabhijnaContext | null {
	const row = prep(agentDb, `
		SELECT * FROM pratyabhijna_context
		WHERE project = ?
		ORDER BY created_at DESC LIMIT 1
	`).get(project) as PratyabhijnaRow | undefined;
	if (!row) return null;
	return {
		sessionId: row.session_id, project: row.project,
		identitySummary: row.identity_summary ?? "",
		globalVasanas: row.global_vasanas ? JSON.parse(row.global_vasanas) : [],
		projectVasanas: row.project_vasanas ? JSON.parse(row.project_vasanas) : [],
		activeSamskaras: row.active_samskaras ? JSON.parse(row.active_samskaras) : [],
		crossProjectInsights: row.cross_project_insights ? JSON.parse(row.cross_project_insights) : [],
		toolMastery: row.tool_mastery ? JSON.parse(row.tool_mastery) : {},
		warmupMs: row.warmup_ms ?? 0, createdAt: row.created_at,
	};
}
