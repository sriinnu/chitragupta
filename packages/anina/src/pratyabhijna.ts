/**
 * @chitragupta/anina — Pratyabhijna — प्रत्यभिज्ञा — Self-Recognition.
 *
 * On every session start the agent must recognise itself — loading vasanas,
 * samskaras, tool mastery, and cross-project insights, then weaving them
 * into an identity narrative. The agent wakes knowing who it is, what it
 * knows, and where it left off.
 *
 * Internal computations (temporal decay, narrative generation, cross-project
 * insights, DB persistence) live in pratyabhijna-internals.ts.
 *
 * @packageDocumentation
 */

import type { DatabaseManager } from "@chitragupta/smriti";
import type { PratyabhijnaContext, PratyabhijnaConfig } from "./types.js";
import { DEFAULT_PRATYABHIJNA_CONFIG } from "./types.js";
import type { ChetanaController } from "./chetana/index.js";
import {
	decayedScore, GLOBAL_PROJECT, DEFAULT_HALF_LIFE_MS,
	loadCrossProjectInsights, generateNarrative as genNarrative,
	persistToDb, loadPreviousContext,
	type PreparedStmt, type VasanaRow, type SamskaraRow,
} from "./pratyabhijna-internals.js";

// Re-export internals for consumers
export {
	decayedScore, relativeTime, shortProjectLabel,
	GLOBAL_PROJECT, DEFAULT_HALF_LIFE_MS,
	generateNarrative, loadCrossProjectInsights,
} from "./pratyabhijna-internals.js";

// ─── Pratyabhijna ─────────────────────────────────────────────────────────────

/**
 * Self-Recognition engine. On session start, reconstructs the agent's
 * identity from stored vasanas, samskaras, tool mastery, and cross-project
 * insights. Caches the result for the session's lifetime.
 */
export class Pratyabhijna {
	private config: PratyabhijnaConfig;
	private halfLifeMs: number;
	private cache = new Map<string, PratyabhijnaContext>();
	private stmtCache = new Map<string, PreparedStmt>();

	constructor(config?: Partial<PratyabhijnaConfig>) {
		this.config = { ...DEFAULT_PRATYABHIJNA_CONFIG, ...config };
		this.halfLifeMs = DEFAULT_HALF_LIFE_MS;
	}

	/**
	 * Recognise self at session start. Loads vasanas, samskaras, tool mastery,
	 * cross-project insights, generates an identity narrative, persists, and caches.
	 */
	recognize(sessionId: string, project: string, db: DatabaseManager, chetana?: ChetanaController): PratyabhijnaContext {
		const cached = this.cache.get(sessionId);
		if (cached) return cached;

		const t0 = performance.now();
		const now = Date.now();
		const agentDb = db.get("agent");

		// 1. Load global vasanas
		const rawGlobal = this.prep(agentDb, `
			SELECT * FROM vasanas WHERE project IS NULL OR project = ?
			ORDER BY strength DESC LIMIT ?
		`).all(GLOBAL_PROJECT, this.config.topK) as VasanaRow[];
		const globalVasanas = rawGlobal
			.map(r => ({ tendency: r.name, strength: decayedScore(r.strength, r.last_activated, now, this.halfLifeMs), valence: r.valence }))
			.sort((a, b) => b.strength - a.strength).slice(0, this.config.topK);

		// 2. Load project vasanas
		const rawProject = this.prep(agentDb, `
			SELECT * FROM vasanas WHERE project = ?
			ORDER BY strength DESC LIMIT ?
		`).all(project, this.config.topK) as VasanaRow[];
		const projectVasanas = rawProject
			.map(r => ({ tendency: r.name, strength: decayedScore(r.strength, r.last_activated, now, this.halfLifeMs), valence: r.valence }))
			.sort((a, b) => b.strength - a.strength).slice(0, this.config.topK);

		// 3. Load active samskaras
		const rawSamskaras = this.prep(agentDb, `
			SELECT * FROM samskaras WHERE project = ? AND confidence > 0.3
			ORDER BY confidence DESC LIMIT ?
		`).all(project, this.config.maxSamskaras) as SamskaraRow[];
		const activeSamskaras = rawSamskaras.map(r => ({
			patternType: r.pattern_type, patternContent: r.pattern_content, confidence: r.confidence,
		}));

		// 4. Load tool mastery from Chetana
		const toolMastery: Record<string, number> = {};
		if (chetana) {
			const report = chetana.getCognitiveReport();
			for (const { tool, mastery } of report.selfSummary.topTools) {
				toolMastery[tool] = Math.round(mastery.successRate * 1000) / 1000;
			}
		}

		// 5. Cross-project insights
		const crossProjectInsights = loadCrossProjectInsights(
			this.prep.bind(this), agentDb, project, now, this.halfLifeMs, this.config,
		);

		// 6. Last session timestamp
		const lastSessionRow = this.prep(agentDb, `
			SELECT updated_at FROM sessions WHERE project = ? ORDER BY updated_at DESC LIMIT 1
		`).get(project) as { updated_at: number } | undefined;
		const lastSessionTs = lastSessionRow?.updated_at ?? 0;

		// 7. Build context & narrative
		const warmupMs = Math.round((performance.now() - t0) * 100) / 100;
		const ctx: PratyabhijnaContext = {
			sessionId, project, identitySummary: "",
			globalVasanas, projectVasanas, activeSamskaras,
			crossProjectInsights, toolMastery, warmupMs, createdAt: now,
		};
		ctx.identitySummary = this.generateNarrative(ctx, lastSessionTs, now);

		// 8. Persist & cache
		persistToDb(ctx, this.prep.bind(this), agentDb);
		this.cache.set(sessionId, ctx);
		return ctx;
	}

	/** Get the cached context for a session, or null if not yet recognised. */
	getContext(sessionId: string): PratyabhijnaContext | null {
		return this.cache.get(sessionId) ?? null;
	}

	/** Generate the zero-LLM identity narrative. */
	generateNarrative(ctx: PratyabhijnaContext, lastSessionTs?: number, now?: number): string {
		return genNarrative(ctx, lastSessionTs, now);
	}

	/** Persist a PratyabhijnaContext to the pratyabhijna_context table. */
	persist(ctx: PratyabhijnaContext, db: DatabaseManager): void {
		persistToDb(ctx, this.prep.bind(this), db.get("agent"));
	}

	/** Load the most recent PratyabhijnaContext for a project from SQLite. */
	loadPrevious(project: string, db: DatabaseManager): PratyabhijnaContext | null {
		return loadPreviousContext(project, this.prep.bind(this), db.get("agent"));
	}

	/** Evict a session from the in-memory cache. */
	evict(sessionId: string): void { this.cache.delete(sessionId); }

	/** Clear all cached contexts and prepared statements. */
	clearCache(): void { this.cache.clear(); this.stmtCache.clear(); }

	/** Get or create a prepared statement, keyed by SQL string. */
	private prep(db: ReturnType<DatabaseManager["get"]>, sql: string): PreparedStmt {
		let stmt = this.stmtCache.get(sql);
		if (!stmt) { stmt = db.prepare(sql) as unknown as PreparedStmt; this.stmtCache.set(sql, stmt); }
		return stmt;
	}
}
