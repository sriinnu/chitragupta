/**
 * @chitragupta/smriti — Vidhi Engine (Procedural Memory)
 *
 * Vidhi (विधि) — "method, procedure, rule" in Sanskrit.
 *
 * Extracts repeated, successful tool sequences from session data and
 * crystallizes them into reusable, parameterized procedures (Vidhis).
 *
 * Core algorithms:
 *   1. N-gram extraction (2..5) over tool-call sequences per session.
 *   2. Common subsequence discovery across sessions (frequency + success filter).
 *   3. Anti-unification: aligns argument instances across sessions to separate
 *      fixed (literal) from variable (parameter) positions.
 *   4. Thompson Sampling: Beta(alpha, beta) for exploration-exploitation
 *      when multiple Vidhis match.
 *   5. Trigger-phrase detection: verb-object NLU from preceding user messages.
 *   6. SQLite persistence via the vidhis table in agent.db.
 *
 * This module retains the VidhiEngine class (public API) and delegates
 * heavy lifting to vidhi-matching.ts and vidhi-extraction.ts.
 */

import { DatabaseManager } from "./db/index.js";
import type { Vidhi, VidhiStep, VidhiParam } from "./types.js";
import {
	loadSessionSequences,
	extractAndAggregate,
	buildVidhi,
} from "./vidhi-extraction.js";
import { matchVidhi, sampleBeta } from "./vidhi-matching.js";

// ─── Configuration ──────────────────────────────────────────────────────────

/** Engine configuration with two-tier defaults / hard ceilings. */
export interface VidhiConfig {
	/** Minimum distinct sessions an n-gram must appear in. Default: 3. */
	minSessions: number;
	/** Minimum success rate (0-1) for an n-gram to qualify. Default: 0.8. */
	minSuccessRate: number;
	/** Shortest tool sequence to consider. Default: 2. */
	minSequenceLength: number;
	/** Longest tool sequence to consider. Default: 5. */
	maxSequenceLength: number;
	/** Project scope for extraction. */
	project: string;
}

/** Result of an extraction run. */
export interface ExtractionResult {
	/** Vidhis created for the first time. */
	newVidhis: Vidhi[];
	/** Existing Vidhis whose confidence / source sessions were reinforced. */
	reinforced: Vidhi[];
	/** Total distinct n-gram sequences evaluated. */
	totalSequencesAnalyzed: number;
	/** Wall-clock duration of the extraction in milliseconds. */
	durationMs: number;
}

// ─── Internal Types ─────────────────────────────────────────────────────────

/** Database row shape for the vidhis table. */
interface VidhiRow {
	id: string;
	project: string;
	name: string;
	learned_from: string;
	confidence: number;
	steps: string;
	triggers: string;
	success_rate: number;
	success_count: number;
	failure_count: number;
	parameter_schema: string | null;
	created_at: number;
	updated_at: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default configuration values. */
const DEFAULT_CONFIG: Omit<VidhiConfig, "project"> = {
	minSessions: 3,
	minSuccessRate: 0.8,
	minSequenceLength: 2,
	maxSequenceLength: 5,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Safely parse a JSON string, returning a fallback on failure.
 *
 * @param json - JSON string to parse (may be null/undefined).
 * @param fallback - Value to return if parsing fails.
 * @returns Parsed value or fallback.
 */
function safeParse<T>(json: string | null | undefined, fallback: T): T {
	if (!json) return fallback;
	try {
		return JSON.parse(json) as T;
	} catch {
		return fallback;
	}
}

// ─── Vidhi Engine ───────────────────────────────────────────────────────────

/**
 * VidhiEngine — discovers, parameterizes, and tracks procedural memories.
 *
 * Usage:
 *   const engine = new VidhiEngine({ project: "/my/project", minSessions: 3 });
 *   const result = engine.extract();
 *   const match = engine.match("add a new API endpoint");
 *   engine.recordOutcome(match.id, true);
 */
export class VidhiEngine {
	private readonly _config: VidhiConfig;

	constructor(config: Partial<VidhiConfig> & { project: string }) {
		this._config = { ...DEFAULT_CONFIG, ...config };
	}

	// ─── Public API ───────────────────────────────────────────────────

	/**
	 * Extract Vidhis from recent session data.
	 *
	 * Pipeline:
	 *   1. Load tool-call sequences from the turns table.
	 *   2. Extract n-grams of length [min, max] from each session.
	 *   3. Aggregate across sessions, filter by frequency and success.
	 *   4. Anti-unify arguments to find variable positions.
	 *   5. Detect trigger phrases from preceding user messages.
	 *   6. Persist new Vidhis, reinforce existing ones.
	 */
	extract(): ExtractionResult {
		const t0 = Date.now();
		const existing = this.loadAll(this._config.project);
		const existingByKey = new Map<string, Vidhi>();
		for (const v of existing) {
			const key = v.steps.map((s) => s.toolName).join("|");
			existingByKey.set(key, v);
		}

		// 1. Load tool-call sequences per session
		const sessionSequences = loadSessionSequences(this._config);

		// 2-3. Extract and aggregate n-grams
		const aggregates = extractAndAggregate(sessionSequences, this._config);

		const newVidhis: Vidhi[] = [];
		const reinforced: Vidhi[] = [];

		for (const agg of aggregates) {
			const existingVidhi = existingByKey.get(agg.key);

			if (existingVidhi) {
				// Reinforce: merge new source sessions, bump confidence
				const mergedSessions = new Set([
					...existingVidhi.learnedFrom,
					...agg.instances.map((i) => i.sessionId),
				]);
				existingVidhi.learnedFrom = [...mergedSessions];
				existingVidhi.confidence = Math.min(
					1.0,
					existingVidhi.confidence + 0.05 * (mergedSessions.size - existingVidhi.learnedFrom.length),
				);
				existingVidhi.updatedAt = Date.now();
				this.persist(existingVidhi);
				reinforced.push(existingVidhi);
			} else {
				// Create new Vidhi
				const vidhi = buildVidhi(agg, this._config);
				this.persist(vidhi);
				newVidhis.push(vidhi);
			}
		}

		return {
			newVidhis,
			reinforced,
			totalSequencesAnalyzed: aggregates.length,
			durationMs: Date.now() - t0,
		};
	}

	/**
	 * Match a user query to the best Vidhi using trigger phrases.
	 *
	 * Scoring:
	 *   1. Extract verb-object tokens from the query.
	 *   2. Compare against each Vidhi's trigger phrases via Jaccard similarity.
	 *   3. Break ties with Thompson Sampling (sample from Beta distribution).
	 *
	 * @param query - User query to match against known Vidhis.
	 * @returns The best-matching Vidhi, or null if no match exceeds threshold.
	 */
	match(query: string): Vidhi | null {
		const vidhis = this.loadAll(this._config.project);
		return matchVidhi(vidhis, query);
	}

	/**
	 * Record the outcome of executing a Vidhi.
	 * Updates the Thompson Sampling parameters (alpha/beta).
	 *
	 * @param vidhiId - ID of the Vidhi to update.
	 * @param success - Whether the execution was successful.
	 */
	recordOutcome(vidhiId: string, success: boolean): void {
		const vidhi = this.getVidhi(vidhiId);
		if (!vidhi) return;

		if (success) {
			vidhi.successCount += 1;
		} else {
			vidhi.failureCount += 1;
		}

		const alpha = vidhi.successCount + 1;
		const beta = vidhi.failureCount + 1;
		vidhi.successRate = alpha / (alpha + beta);
		vidhi.updatedAt = Date.now();

		this.persist(vidhi);
	}

	/**
	 * Get Vidhis for a project, ranked by Thompson Sampling.
	 * Each call samples from Beta(alpha, beta) to balance exploration and exploitation.
	 *
	 * @param project - Project scope to load Vidhis for.
	 * @param topK - Maximum number of Vidhis to return. Default: 10.
	 * @returns Top-K Vidhis sorted by Thompson Sampling score.
	 */
	getVidhis(project: string, topK = 10): Vidhi[] {
		const vidhis = this.loadAll(project);

		// Sample from Beta distribution for ranking
		const scored = vidhis.map((v) => ({
			vidhi: v,
			score: sampleBeta(v.successCount + 1, v.failureCount + 1),
		}));

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, topK).map((s) => s.vidhi);
	}

	/**
	 * Get a specific Vidhi by its ID.
	 *
	 * @param id - Vidhi ID (FNV-1a hash).
	 * @returns The Vidhi, or null if not found.
	 */
	getVidhi(id: string): Vidhi | null {
		const db = DatabaseManager.instance().get("agent");
		const row = db.prepare("SELECT * FROM vidhis WHERE id = ?").get(id) as VidhiRow | undefined;
		return row ? this._rowToVidhi(row) : null;
	}

	/**
	 * Persist a Vidhi to SQLite (upsert).
	 *
	 * @param vidhi - Vidhi object to save.
	 */
	persist(vidhi: Vidhi): void {
		const db = DatabaseManager.instance().get("agent");
		db.prepare(`
			INSERT OR REPLACE INTO vidhis
				(id, project, name, learned_from, confidence, steps, triggers,
				 success_rate, success_count, failure_count, parameter_schema,
				 created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			vidhi.id,
			vidhi.project,
			vidhi.name,
			JSON.stringify(vidhi.learnedFrom),
			vidhi.confidence,
			JSON.stringify(vidhi.steps),
			JSON.stringify(vidhi.triggers),
			vidhi.successRate,
			vidhi.successCount,
			vidhi.failureCount,
			JSON.stringify(vidhi.parameterSchema),
			vidhi.createdAt,
			vidhi.updatedAt,
		);
	}

	/**
	 * Load all Vidhis for a project from SQLite.
	 *
	 * @param project - Project scope to filter by.
	 * @returns All Vidhis for the project, ordered by success rate descending.
	 */
	loadAll(project: string): Vidhi[] {
		const db = DatabaseManager.instance().get("agent");
		const rows = db.prepare(
			"SELECT * FROM vidhis WHERE project = ? ORDER BY success_rate DESC",
		).all(project) as VidhiRow[];
		return rows.map((r) => this._rowToVidhi(r));
	}

	// ─── Private ──────────────────────────────────────────────────────

	/**
	 * Convert a database row to a Vidhi object.
	 *
	 * @param row - Raw database row from the vidhis table.
	 * @returns Hydrated Vidhi object with parsed JSON fields.
	 */
	private _rowToVidhi(row: VidhiRow): Vidhi {
		return {
			id: row.id,
			project: row.project,
			name: row.name,
			learnedFrom: safeParse<string[]>(row.learned_from, []),
			confidence: row.confidence,
			steps: safeParse<VidhiStep[]>(row.steps, []),
			triggers: safeParse<string[]>(row.triggers, []),
			successRate: row.success_rate,
			successCount: row.success_count,
			failureCount: row.failure_count,
			parameterSchema: safeParse<Record<string, VidhiParam>>(
				row.parameter_schema,
				{},
			),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
