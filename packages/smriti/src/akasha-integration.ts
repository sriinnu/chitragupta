/**
 * @chitragupta/smriti -- Akasha Integration Layer.
 *
 * Standalone functions for Akasha persistence (SQLite) and GraphRAG integration.
 * These were extracted from the AkashaField class to keep each module under
 * 450 LOC. The class methods `persist()`, `restore()`, `toGraphNodes()`, and
 * `boostResults()` are thin wrappers that delegate to these functions.
 *
 * Also houses all shared types (`TraceType`, `StigmergicTrace`, `AkashaConfig`,
 * `DatabaseLike`) that are re-exported by `akasha.ts`.
 *
 * @module akasha-integration
 */

import { tokenize, jaccardSimilarity } from "./akasha.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** The type of knowledge a stigmergic trace represents. */
export type TraceType =
	| "solution"     // Agent solved a problem
	| "warning"      // Agent encountered a hazard
	| "shortcut"     // Agent found an efficient path
	| "pattern"      // Agent detected a recurring pattern
	| "correction"   // Agent corrected a mistake
	| "preference";  // Agent learned a user preference

/** A stigmergic trace left by an agent in the knowledge graph. */
export interface StigmergicTrace {
	/** Deterministic FNV-1a ID: `aks-<hash>`. */
	id: string;
	/** Which agent left this trace. */
	agentId: string;
	/** The category of knowledge encoded by this trace. */
	traceType: TraceType;
	/** What the trace is about (used for topic matching). */
	topic: string;
	/** The actual knowledge, solution, or observation. */
	content: string;
	/** Pheromone strength [0, 1] -- decays over time. */
	strength: number;
	/** How many agents have reinforced this trace. */
	reinforcements: number;
	/** Arbitrary metadata attached by the leaving agent. */
	metadata: Record<string, unknown>;
	/** Unix timestamp (ms) when the trace was created. */
	createdAt: number;
	/** Unix timestamp (ms) when the trace was last reinforced. */
	lastReinforcedAt: number;
}

/** Configuration for the Akasha shared knowledge field. */
export interface AkashaConfig {
	/** Trace strength halves after this duration (ms). Default: 7 days. */
	decayHalfLife: number;
	/** Traces below this strength are pruned. Default: 0.01. */
	minStrength: number;
	/** Maximum traces per project. Default: 5000. */
	maxTraces: number;
	/** Strength added per reinforcement. Default: 0.15. */
	reinforcementBoost: number;
	/** New trace starting strength. Default: 0.5. */
	initialStrength: number;
	/** Max traces returned per query. Default: 10. */
	topKRetrieval: number;
	/** Boost factor for GraphRAG result boosting. Default: 0.3. */
	traceBoostFactor: number;
	/**
	 * Diminishing returns factor alpha for reinforcement.
	 * boost = reinforcementBoost / (1 + alpha * reinforcements)
	 * Higher alpha = faster diminishing. 0 = flat (legacy). Default: 0.3.
	 */
	diminishingAlpha: number;
	/**
	 * Frequency-weighted decay factor beta.
	 * effectiveHalfLife = baseHalfLife * (1 + beta * ln(1 + reinforcements))
	 * Frequently-reinforced traces decay slower (highway effect). Default: 0.5.
	 */
	frequencyDecayBeta: number;
}

/** Duck-typed database interface -- just needs prepare().run/all/get. */
export interface DatabaseLike {
	prepare(sql: string): {
		run(...params: unknown[]): unknown;
		all(...params: unknown[]): unknown[];
		get(...params: unknown[]): unknown;
	};
	exec(sql: string): void;
}

// ─── Graph Node Shape ────────────────────────────────────────────────────────

/** A graph-compatible node produced from a stigmergic trace. */
export interface AkashaGraphNode {
	/** Trace ID (e.g. `aks-<hash>`). */
	id: string;
	/** Human-readable label: `[traceType] topic`. */
	label: string;
	/** The trace content used for search. */
	content: string;
	/** Always `"akasha"` for stigmergic trace nodes. */
	type: string;
	/** The trace strength, used as node weight. */
	weight: number;
}

/** A search result boosted by stigmergic trace matching. */
export interface BoostedResult {
	/** Original result ID. */
	id: string;
	/** Boosted score: `originalScore * (1 + traceBoost)`. */
	score: number;
	/** Original content (if present). */
	content?: string;
	/** The additive boost factor applied from trace matching. */
	traceBoost: number;
}

/** The result of restoring traces from a database. */
export interface RestoreResult {
	/** Restored trace map keyed by trace ID. */
	traces: Map<string, StigmergicTrace>;
	/** Reinforcement tracking map keyed by trace ID. */
	reinforcedBy: Map<string, Set<string>>;
}

// ─── SQL Constants ───────────────────────────────────────────────────────────

/** SQL to create the akasha_traces table and indexes. */
const CREATE_TABLE_SQL = `
	CREATE TABLE IF NOT EXISTS akasha_traces (
		id TEXT PRIMARY KEY,
		agent_id TEXT NOT NULL,
		trace_type TEXT NOT NULL,
		topic TEXT NOT NULL,
		content TEXT NOT NULL,
		strength REAL NOT NULL,
		reinforcements INTEGER NOT NULL DEFAULT 0,
		metadata TEXT,
		created_at INTEGER NOT NULL,
		last_reinforced_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_akasha_topic ON akasha_traces(topic);
	CREATE INDEX IF NOT EXISTS idx_akasha_strength ON akasha_traces(strength DESC);
`;

/** SQL to upsert a single trace row. */
const UPSERT_SQL = `
	INSERT OR REPLACE INTO akasha_traces
		(id, agent_id, trace_type, topic, content, strength,
		 reinforcements, metadata, created_at, last_reinforced_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/** SQL to ensure the table exists (without indexes -- used for restore). */
const ENSURE_TABLE_SQL = `
	CREATE TABLE IF NOT EXISTS akasha_traces (
		id TEXT PRIMARY KEY,
		agent_id TEXT NOT NULL,
		trace_type TEXT NOT NULL,
		topic TEXT NOT NULL,
		content TEXT NOT NULL,
		strength REAL NOT NULL,
		reinforcements INTEGER NOT NULL DEFAULT 0,
		metadata TEXT,
		created_at INTEGER NOT NULL,
		last_reinforced_at INTEGER NOT NULL
	);
`;

// ─── Safe JSON Parse ─────────────────────────────────────────────────────────

/**
 * Safely parse a JSON string, returning an empty object on failure.
 *
 * @param raw - The raw JSON string (or null) from the database.
 * @returns A parsed object, or `{}` if parsing fails.
 */
export function safeParseJson(raw: string | null): Record<string, unknown> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Persist all traces to a SQLite database.
 *
 * Creates the `akasha_traces` table if it does not exist, then upserts
 * all current traces.
 *
 * @param traces - The in-memory trace map to persist.
 * @param db     - A duck-typed database handle with prepare/exec methods.
 */
export function persistTraces(
	traces: Map<string, StigmergicTrace>,
	db: DatabaseLike,
): void {
	db.exec(CREATE_TABLE_SQL);
	const upsert = db.prepare(UPSERT_SQL);

	for (const trace of traces.values()) {
		upsert.run(
			trace.id,
			trace.agentId,
			trace.traceType,
			trace.topic,
			trace.content,
			trace.strength,
			trace.reinforcements,
			JSON.stringify(trace.metadata),
			trace.createdAt,
			trace.lastReinforcedAt,
		);
	}
}

/**
 * Restore traces from a SQLite database.
 *
 * Loads all rows from the `akasha_traces` table. Traces below the configured
 * `minStrength` are skipped during load.
 *
 * @param db     - A duck-typed database handle with prepare/exec methods.
 * @param config - The Akasha configuration (used for minStrength filtering).
 * @returns An object with the restored trace map and reinforcement tracking.
 */
export function restoreTraces(
	db: DatabaseLike,
	config: AkashaConfig,
): RestoreResult {
	db.exec(ENSURE_TABLE_SQL);

	const rows = db.prepare("SELECT * FROM akasha_traces").all() as Array<{
		id: string;
		agent_id: string;
		trace_type: string;
		topic: string;
		content: string;
		strength: number;
		reinforcements: number;
		metadata: string | null;
		created_at: number;
		last_reinforced_at: number;
	}>;

	const traces = new Map<string, StigmergicTrace>();
	const reinforcedBy = new Map<string, Set<string>>();

	for (const row of rows) {
		if (row.strength < config.minStrength) continue;

		const trace: StigmergicTrace = {
			id: row.id,
			agentId: row.agent_id,
			traceType: row.trace_type as TraceType,
			topic: row.topic,
			content: row.content,
			strength: row.strength,
			reinforcements: row.reinforcements,
			metadata: safeParseJson(row.metadata),
			createdAt: row.created_at,
			lastReinforcedAt: row.last_reinforced_at,
		};

		traces.set(trace.id, trace);
		reinforcedBy.set(trace.id, new Set([trace.agentId]));
	}

	return { traces, reinforcedBy };
}

// ─── GraphRAG Integration ────────────────────────────────────────────────────

/**
 * Convert traces to graph nodes suitable for GraphRAG retrieval.
 *
 * Each trace becomes a node with type `"akasha"`, its strength as weight,
 * and the combined topic + content as searchable text.
 *
 * @param traces      - The in-memory trace map.
 * @param minStrength - Minimum strength threshold for inclusion.
 * @returns An array of graph-compatible node objects.
 */
export function tracesToGraphNodes(
	traces: Map<string, StigmergicTrace>,
	minStrength: number,
): AkashaGraphNode[] {
	const nodes: AkashaGraphNode[] = [];

	for (const trace of traces.values()) {
		if (trace.strength < minStrength) continue;
		nodes.push({
			id: trace.id,
			label: `[${trace.traceType}] ${trace.topic}`,
			content: trace.content,
			type: "akasha",
			weight: trace.strength,
		});
	}

	return nodes;
}

/**
 * Boost graph search results that have matching stigmergic traces.
 *
 * For each result, checks if there is a matching trace (by Jaccard
 * similarity between the query and trace topic/content). If so:
 *   `boostedScore = originalScore * (1 + traceBoostFactor * trace.strength)`
 *
 * @param traces  - The in-memory trace map.
 * @param config  - The Akasha configuration (minStrength, traceBoostFactor).
 * @param results - The original search results with id and score.
 * @param query   - The search query used for topic matching.
 * @returns Results with boosted scores and traceBoost metadata.
 */
export function boostResultsWithTraces(
	traces: Map<string, StigmergicTrace>,
	config: AkashaConfig,
	results: Array<{ id: string; score: number; content?: string }>,
	query: string,
): BoostedResult[] {
	const queryTokens = new Set(tokenize(query));

	// Pre-compute matching traces for the query
	const matchingTraces: Array<{
		trace: StigmergicTrace;
		similarity: number;
	}> = [];

	if (queryTokens.size > 0) {
		for (const trace of traces.values()) {
			if (trace.strength < config.minStrength) continue;
			const traceTokens = new Set([
				...tokenize(trace.topic),
				...tokenize(trace.content),
			]);
			const sim = jaccardSimilarity(queryTokens, traceTokens);
			if (sim > 0) {
				matchingTraces.push({ trace, similarity: sim });
			}
		}
		matchingTraces.sort((a, b) => b.similarity - a.similarity);
	}

	return results.map((result) => {
		let traceBoost = 0;

		if (queryTokens.size > 0 && matchingTraces.length > 0) {
			const resultTokens = result.content
				? new Set(tokenize(result.content))
				: new Set<string>();

			let bestBoost = 0;
			for (const { trace, similarity } of matchingTraces) {
				// Direct ID match (the result IS a trace node)
				if (result.id === trace.id) {
					bestBoost = Math.max(bestBoost, trace.strength);
					break;
				}
				// Content-based match
				if (resultTokens.size > 0) {
					const traceTokens = new Set([
						...tokenize(trace.topic),
						...tokenize(trace.content),
					]);
					const resultSim = jaccardSimilarity(resultTokens, traceTokens);
					if (resultSim > 0.1) {
						bestBoost = Math.max(bestBoost, similarity * trace.strength);
					}
				} else {
					// No content to match -- use query-level similarity
					bestBoost = Math.max(bestBoost, similarity * trace.strength);
				}
			}

			traceBoost = bestBoost * config.traceBoostFactor;
		}

		return {
			...result,
			score: result.score * (1 + traceBoost),
			traceBoost,
		};
	});
}
