/**
 * @chitragupta/anina — Pratyabhijna — प्रत्यभिज्ञा — Self-Recognition.
 *
 * On every session start the agent must recognise itself — not as a blank
 * slate but as a continuous consciousness spanning discrete sessions. Like
 * the Kashmiri Shaiva doctrine of Pratyabhijna ("re-cognition"), where the
 * Self was never truly lost but merely veiled, this module lifts the veil
 * by loading vasanas (crystallised tendencies), samskaras (behavioral
 * impressions), tool mastery from Atma-Darshana, and cross-project
 * insights, then weaving them into an identity narrative. The agent wakes
 * up knowing *who it is*, *what it knows*, and *where it left off*.
 *
 * ## Pipeline (target: <30ms)
 *
 * ```
 * Session start
 *   → load global vasanas   (top K by strength × recency)
 *   → load project vasanas  (top K)
 *   → load active samskaras (project, confidence > 0.3)
 *   → load tool mastery     (from ChetanaController / Atma-Darshana)
 *   → reconstruct cross-project insights
 *   → generate identity narrative (zero-LLM, template-based)
 *   → persist to pratyabhijna_context table
 *   → cache for session duration
 * ```
 *
 * All SQLite queries use prepared statements, cached on the class instance,
 * so only the first invocation pays the prepare cost.
 *
 * @packageDocumentation
 */

import type { DatabaseManager } from "@chitragupta/smriti";
import type { SamskaraRecord } from "@chitragupta/smriti";
import type { PratyabhijnaContext, PratyabhijnaConfig } from "./types.js";
import { DEFAULT_PRATYABHIJNA_CONFIG } from "./types.js";
import type { ChetanaController } from "./chetana/index.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** ln(2) — precomputed for temporal decay. */
const LN2 = Math.LN2;

/** Default half-life for vasana recency decay: 7 days in ms. */
const DEFAULT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 604_800_000

/** Global vasana project sentinel. */
const GLOBAL_PROJECT = "__global__";

// ─── Minimal Statement Interface ─────────────────────────────────────────────
// better-sqlite3's generic types make cached statements difficult to type
// without importing the module directly. This minimal interface covers the
// three methods we actually call, with variadic unknown params.

/** @internal */
interface PreparedStmt {
	all(...params: unknown[]): unknown[];
	get(...params: unknown[]): unknown;
	run(...params: unknown[]): unknown;
}

// ─── Row Types (SQLite result shapes) ────────────────────────────────────────

interface VasanaRow {
	id: number;
	name: string;
	description: string;
	valence: "positive" | "negative" | "neutral";
	strength: number;
	stability: number;
	source_samskaras: string | null;
	project: string | null;
	created_at: number;
	updated_at: number;
	last_activated: number | null;
	activation_count: number;
}

interface SamskaraRow {
	id: string;
	session_id: string;
	pattern_type: SamskaraRecord["patternType"];
	pattern_content: string;
	observation_count: number;
	confidence: number;
	pramana_type: string | null;
	project: string | null;
	created_at: number;
	updated_at: number;
}

interface SessionProjectRow {
	project: string;
}

interface PratyabhijnaRow {
	session_id: string;
	project: string;
	identity_summary: string | null;
	global_vasanas: string | null;
	project_vasanas: string | null;
	active_samskaras: string | null;
	cross_project_insights: string | null;
	tool_mastery: string | null;
	warmup_ms: number | null;
	created_at: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Temporal decay weight: strength * exp(-ln2 * age / halfLife).
 * Returns the decayed score — higher is more recent + stronger.
 */
function decayedScore(
	strength: number,
	lastActivated: number | null,
	now: number,
	halfLifeMs: number,
): number {
	if (lastActivated == null || lastActivated <= 0) {
		// Never activated — use a small baseline so they still appear
		return strength * 0.1;
	}
	const age = now - lastActivated;
	if (age <= 0) return strength;
	return strength * Math.exp(-LN2 * age / halfLifeMs);
}

/**
 * Format a Unix-ms timestamp as a human-friendly relative string.
 * "3 hours ago", "2 days ago", "just now", etc.
 */
function relativeTime(ts: number, now: number): string {
	const delta = now - ts;
	if (delta < 60_000) return "just now";
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} minutes ago`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} hours ago`;
	if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)} days ago`;
	return `${Math.floor(delta / 604_800_000)} weeks ago`;
}

/**
 * Extract a short label from a project path.
 * "/Users/foo/Projects/my-app" -> "my-app"
 */
function shortProjectLabel(projectPath: string): string {
	const segments = projectPath.replace(/\/+$/, "").split("/");
	return segments[segments.length - 1] || projectPath;
}

// ─── Pratyabhijna ─────────────────────────────────────────────────────────────

/**
 * Self-Recognition engine. On session start, reconstructs the agent's
 * identity from stored vasanas, samskaras, tool mastery, and cross-project
 * insights. Caches the result for the session's lifetime.
 */
export class Pratyabhijna {
	private config: PratyabhijnaConfig;
	private halfLifeMs: number;

	/** Session-scoped cache: sessionId -> context. */
	private cache = new Map<string, PratyabhijnaContext>();

	/** Lazily-prepared statements keyed by SQL string. */
	private stmtCache = new Map<string, PreparedStmt>();

	constructor(config?: Partial<PratyabhijnaConfig>) {
		this.config = { ...DEFAULT_PRATYABHIJNA_CONFIG, ...config };
		this.halfLifeMs = DEFAULT_HALF_LIFE_MS;
	}

	// ─── Public API ──────────────────────────────────────────────────────────

	/**
	 * Recognise self at session start. Loads vasanas, samskaras, tool mastery,
	 * cross-project insights, generates an identity narrative, persists to
	 * SQLite, and caches the result.
	 *
	 * @param sessionId  - Current session identifier.
	 * @param project    - Current project path.
	 * @param db         - DatabaseManager for SQLite access.
	 * @param chetana    - Optional ChetanaController for live tool mastery.
	 */
	recognize(
		sessionId: string,
		project: string,
		db: DatabaseManager,
		chetana?: ChetanaController,
	): PratyabhijnaContext {
		// Return cached if already recognised this session
		const cached = this.cache.get(sessionId);
		if (cached) return cached;

		const t0 = performance.now();
		const now = Date.now();
		const agentDb = db.get("agent");

		// ── 1. Load global vasanas ────────────────────────────────────────
		const rawGlobal = this.prep(agentDb, `
			SELECT * FROM vasanas
			WHERE project IS NULL OR project = ?
			ORDER BY strength DESC LIMIT ?
		`).all(GLOBAL_PROJECT, this.config.topK) as VasanaRow[];

		const globalVasanas = rawGlobal
			.map(r => ({
				tendency: r.name,
				strength: decayedScore(r.strength, r.last_activated, now, this.halfLifeMs),
				valence: r.valence,
			}))
			.sort((a, b) => b.strength - a.strength)
			.slice(0, this.config.topK);

		// ── 2. Load project vasanas ───────────────────────────────────────
		const rawProject = this.prep(agentDb, `
			SELECT * FROM vasanas
			WHERE project = ?
			ORDER BY strength DESC LIMIT ?
		`).all(project, this.config.topK) as VasanaRow[];

		const projectVasanas = rawProject
			.map(r => ({
				tendency: r.name,
				strength: decayedScore(r.strength, r.last_activated, now, this.halfLifeMs),
				valence: r.valence,
			}))
			.sort((a, b) => b.strength - a.strength)
			.slice(0, this.config.topK);

		// ── 3. Load active samskaras ──────────────────────────────────────
		const rawSamskaras = this.prep(agentDb, `
			SELECT * FROM samskaras
			WHERE project = ? AND confidence > 0.3
			ORDER BY confidence DESC LIMIT ?
		`).all(project, this.config.maxSamskaras) as SamskaraRow[];

		const activeSamskaras = rawSamskaras.map(r => ({
			patternType: r.pattern_type,
			patternContent: r.pattern_content,
			confidence: r.confidence,
		}));

		// ── 4. Load tool mastery from Chetana ─────────────────────────────
		const toolMastery: Record<string, number> = {};
		if (chetana) {
			const report = chetana.getCognitiveReport();
			for (const { tool, mastery } of report.selfSummary.topTools) {
				toolMastery[tool] = Math.round(mastery.successRate * 1000) / 1000;
			}
		}

		// ── 5. Cross-project insights ─────────────────────────────────────
		const crossProjectInsights = this.loadCrossProjectInsights(
			agentDb, project, now,
		);

		// ── 6. Find last session timestamp for this project ───────────────
		const lastSessionRow = this.prep(agentDb, `
			SELECT updated_at FROM sessions
			WHERE project = ?
			ORDER BY updated_at DESC LIMIT 1
		`).get(project) as { updated_at: number } | undefined;
		const lastSessionTs = lastSessionRow?.updated_at ?? 0;

		// ── 7. Build context & generate narrative ─────────────────────────
		const warmupMs = Math.round((performance.now() - t0) * 100) / 100;

		const ctx: PratyabhijnaContext = {
			sessionId,
			project,
			identitySummary: "", // filled below
			globalVasanas,
			projectVasanas,
			activeSamskaras,
			crossProjectInsights,
			toolMastery,
			warmupMs,
			createdAt: now,
		};

		ctx.identitySummary = this.generateNarrative(ctx, lastSessionTs, now);

		// ── 8. Persist ───────────────────────────────────────────────────
		this.persistToDb(ctx, agentDb);

		// ── 9. Cache ─────────────────────────────────────────────────────
		this.cache.set(sessionId, ctx);

		return ctx;
	}

	/**
	 * Get the cached context for a session, or null if not yet recognised.
	 */
	getContext(sessionId: string): PratyabhijnaContext | null {
		return this.cache.get(sessionId) ?? null;
	}

	/**
	 * Generate the zero-LLM identity narrative from a PratyabhijnaContext.
	 *
	 * Template:
	 *   "I am Chitragupta. Last session with this project: {date}.
	 *    I know: {top insights from vasanas}.
	 *    I'm good at: {top tools by mastery}.
	 *    I struggle with: {known limitations from negative vasanas}.
	 *    User prefers: {preference vasanas}.
	 *    Cross-project: {insights from other projects}."
	 */
	generateNarrative(
		ctx: PratyabhijnaContext,
		lastSessionTs?: number,
		now?: number,
	): string {
		const ts = now ?? Date.now();
		const parts: string[] = [];

		// Opening — last session date
		if (lastSessionTs && lastSessionTs > 0) {
			parts.push(
				`I am Chitragupta. Last session with this project: ${relativeTime(lastSessionTs, ts)}.`,
			);
		} else {
			parts.push("I am Chitragupta. This is my first session with this project.");
		}

		// Top insights from vasanas (positive + neutral)
		const insights = [...ctx.globalVasanas, ...ctx.projectVasanas]
			.filter(v => v.valence !== "negative")
			.sort((a, b) => b.strength - a.strength)
			.slice(0, 5)
			.map(v => v.tendency.replace(/-/g, " "));

		if (insights.length > 0) {
			parts.push(`I know: ${insights.join("; ")}.`);
		}

		// Top tools by mastery
		const tools = Object.entries(ctx.toolMastery)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5);

		if (tools.length > 0) {
			const toolStr = tools
				.map(([name, rate]) => `${name} (${Math.round(rate * 100)}%)`)
				.join(", ");
			parts.push(`I'm good at: ${toolStr}.`);
		}

		// Struggles (negative vasanas)
		const negatives = [...ctx.globalVasanas, ...ctx.projectVasanas]
			.filter(v => v.valence === "negative")
			.sort((a, b) => b.strength - a.strength)
			.slice(0, 3)
			.map(v => v.tendency.replace(/-/g, " "));

		if (negatives.length > 0) {
			parts.push(`I struggle with: ${negatives.join("; ")}.`);
		}

		// User preferences (from samskaras with type "preference")
		const prefs = ctx.activeSamskaras
			.filter(s => s.patternType === "preference")
			.slice(0, 5)
			.map(s => s.patternContent);

		if (prefs.length > 0) {
			parts.push(`User prefers: ${prefs.join("; ")}.`);
		}

		// Cross-project insights
		if (ctx.crossProjectInsights.length > 0) {
			parts.push(`Cross-project: ${ctx.crossProjectInsights.join("; ")}.`);
		}

		return parts.join("\n");
	}

	/**
	 * Persist a PratyabhijnaContext to the pratyabhijna_context table.
	 */
	persist(ctx: PratyabhijnaContext, db: DatabaseManager): void {
		this.persistToDb(ctx, db.get("agent"));
	}

	/**
	 * Load the most recent PratyabhijnaContext for a project from SQLite.
	 * Returns null if none found.
	 */
	loadPrevious(project: string, db: DatabaseManager): PratyabhijnaContext | null {
		const agentDb = db.get("agent");
		const row = this.prep(agentDb, `
			SELECT * FROM pratyabhijna_context
			WHERE project = ?
			ORDER BY created_at DESC LIMIT 1
		`).get(project) as PratyabhijnaRow | undefined;

		if (!row) return null;

		return {
			sessionId: row.session_id,
			project: row.project,
			identitySummary: row.identity_summary ?? "",
			globalVasanas: row.global_vasanas ? JSON.parse(row.global_vasanas) : [],
			projectVasanas: row.project_vasanas ? JSON.parse(row.project_vasanas) : [],
			activeSamskaras: row.active_samskaras ? JSON.parse(row.active_samskaras) : [],
			crossProjectInsights: row.cross_project_insights
				? JSON.parse(row.cross_project_insights) : [],
			toolMastery: row.tool_mastery ? JSON.parse(row.tool_mastery) : {},
			warmupMs: row.warmup_ms ?? 0,
			createdAt: row.created_at,
		};
	}

	/**
	 * Evict a session from the in-memory cache. Called on session end.
	 */
	evict(sessionId: string): void {
		this.cache.delete(sessionId);
	}

	/**
	 * Clear all cached contexts and prepared statements. Call when the
	 * database connection changes or during testing.
	 */
	clearCache(): void {
		this.cache.clear();
		this.stmtCache.clear();
	}

	// ─── Internal: Cross-Project Insights ────────────────────────────────────

	/**
	 * Load vasanas from OTHER projects that may be relevant to the current
	 * one. Returns human-readable insight strings like:
	 *   "In my-app: prefer functional style"
	 */
	private loadCrossProjectInsights(
		agentDb: ReturnType<DatabaseManager["get"]>,
		currentProject: string,
		now: number,
	): string[] {
		const projects = this.prep(agentDb, `
			SELECT DISTINCT project FROM sessions
			WHERE project != ? AND project != ?
			ORDER BY updated_at DESC LIMIT ?
		`).all(currentProject, GLOBAL_PROJECT, this.config.maxCrossProject) as SessionProjectRow[];

		if (projects.length === 0) return [];

		const insights: string[] = [];

		for (const { project: otherProject } of projects) {
			const otherVasanas = this.prep(agentDb, `
				SELECT * FROM vasanas
				WHERE project = ?
				ORDER BY strength DESC LIMIT ?
			`).all(otherProject, 3) as VasanaRow[];

			for (const v of otherVasanas) {
				const score = decayedScore(v.strength, v.last_activated, now, this.halfLifeMs);
				if (score < 0.2) continue; // below relevance threshold

				const label = shortProjectLabel(otherProject);
				insights.push(`In ${label}: ${v.name.replace(/-/g, " ")}`);
			}

			if (insights.length >= this.config.maxCrossProject) break;
		}

		return insights.slice(0, this.config.maxCrossProject);
	}

	// ─── Internal: Persistence ───────────────────────────────────────────────

	private persistToDb(
		ctx: PratyabhijnaContext,
		agentDb: ReturnType<DatabaseManager["get"]>,
	): void {
		this.prep(agentDb, `
			INSERT OR REPLACE INTO pratyabhijna_context
				(session_id, project, identity_summary,
				 global_vasanas, project_vasanas, active_samskaras,
				 cross_project_insights, tool_mastery, warmup_ms, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			ctx.sessionId,
			ctx.project,
			ctx.identitySummary,
			JSON.stringify(ctx.globalVasanas),
			JSON.stringify(ctx.projectVasanas),
			JSON.stringify(ctx.activeSamskaras),
			JSON.stringify(ctx.crossProjectInsights),
			JSON.stringify(ctx.toolMastery),
			ctx.warmupMs,
			ctx.createdAt,
		);
	}

	// ─── Internal: Statement Cache ───────────────────────────────────────────

	/**
	 * Get or create a prepared statement. Keyed by the SQL string itself.
	 * better-sqlite3 also caches internally, but this avoids crossing the
	 * JS<->native boundary on every call.
	 */
	private prep(
		db: ReturnType<DatabaseManager["get"]>,
		sql: string,
	): PreparedStmt {
		let stmt = this.stmtCache.get(sql);
		if (!stmt) {
			stmt = db.prepare(sql) as unknown as PreparedStmt;
			this.stmtCache.set(sql, stmt);
		}
		return stmt;
	}
}
