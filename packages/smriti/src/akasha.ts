/**
 * @chitragupta/smriti -- Akasha (आकाश -- Ether/Space) -- Shared Knowledge Field.
 *
 * In Vedic cosmology, Akasha is the all-pervading ether through which all
 * information flows -- the substratum of sound (shabda) and, by extension,
 * all knowledge. Every mantra, every thought, every event leaves its imprint
 * in this field. Rishis who could "hear" Akasha were said to perceive the
 * Vedas directly.
 *
 * In Chitragupta, Akasha implements **stigmergy**: indirect communication
 * through the environment. When Agent A solves a problem, it leaves a
 * "trace" (like a pheromone) in the knowledge graph. Later, Agent B
 * encountering a similar problem picks up that trace, amplifying effective
 * collective knowledge without any direct agent-to-agent communication.
 *
 * This is inspired by ant colony optimization -- ants leave pheromone trails
 * that other ants follow, creating emergent intelligent behavior from simple
 * individual rules. The traces decay over time (evaporation) and strengthen
 * with reinforcement (multiple agents confirming the same insight).
 *
 * Formula for temporal decay:
 *   strength *= exp(-ln(2) * elapsed / halfLife)
 *
 * Topic matching uses Jaccard similarity:
 *   similarity = |intersection(queryTokens, traceTokens)| / |union(queryTokens, traceTokens)|
 *   score = similarity * trace.strength
 */

// ─── Stop Words ──────────────────────────────────────────────────────────────

/** Common English stop words, filtered during tokenization. */
const STOP_WORDS = new Set([
	"a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
	"of", "with", "by", "from", "is", "it", "its", "this", "that", "was",
	"are", "be", "been", "being", "have", "has", "had", "do", "does", "did",
	"will", "would", "could", "should", "not", "no", "so", "if", "then",
	"than", "too", "very", "can", "just", "about", "into", "over", "after",
]);

// ─── FNV-1a Hash ─────────────────────────────────────────────────────────────

/** FNV-1a offset basis for 32-bit. */
const FNV_OFFSET = 0x811c9dc5;
/** FNV-1a prime for 32-bit. */
const FNV_PRIME = 0x01000193;

/**
 * Compute a 32-bit FNV-1a hash of the input string, returned as a
 * zero-padded hex string.
 */
function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = (Math.imul(hash, FNV_PRIME)) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

// ─── Tokenization ────────────────────────────────────────────────────────────

/**
 * Tokenize text into lowercase terms, stripping punctuation and stop words.
 * Split on whitespace + punctuation, lowercase, filter stopwords & short tokens.
 */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * Compute Jaccard similarity between two token sets.
 * Returns |intersection| / |union|, or 1 if both sets are empty
 * (identity: two empty token sets are maximally similar for knowledge matching).
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 1;
	let intersection = 0;
	for (const token of a) {
		if (b.has(token)) intersection++;
	}
	const union = a.size + b.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

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
	 * Diminishing returns factor α for reinforcement.
	 * boost = reinforcementBoost / (1 + α × reinforcements)
	 * Higher α = faster diminishing. 0 = flat (legacy). Default: 0.3.
	 */
	diminishingAlpha: number;
	/**
	 * Frequency-weighted decay factor β.
	 * effectiveHalfLife = baseHalfLife × (1 + β × ln(1 + reinforcements))
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

// ─── Defaults & Hard Ceilings ────────────────────────────────────────────────

const DAY_MS = 86_400_000;

const DEFAULT_CONFIG: AkashaConfig = {
	decayHalfLife: 7 * DAY_MS,    // 7 days
	minStrength: 0.01,
	maxTraces: 5000,
	reinforcementBoost: 0.15,
	initialStrength: 0.5,
	topKRetrieval: 10,
	traceBoostFactor: 0.3,
	diminishingAlpha: 0.3,
	frequencyDecayBeta: 0.5,
};

/**
 * System hard ceilings -- user config is clamped to these values.
 * These exist to prevent runaway resource usage.
 */
const HARD_CEILINGS = {
	maxTraces: 50_000,
	minDecayHalfLife: 3_600_000,  // 1 hour minimum
	maxContentSize: 10_000,       // 10KB per trace content
} as const;

// ─── AkashaField ─────────────────────────────────────────────────────────────

/**
 * Akasha (आकाश) -- Shared Knowledge Field with Stigmergic Traces.
 *
 * Provides a collective intelligence layer where agents leave traces
 * (pheromones) in the knowledge graph. These traces decay over time
 * and are reinforced when other agents find them useful, creating
 * emergent "highways" of collective knowledge.
 *
 * @example
 * ```ts
 * const field = new AkashaField();
 *
 * // Agent A solves a problem
 * field.leave("agent-a", "solution", "typescript generics", "Use conditional types for...");
 *
 * // Agent B queries for related knowledge
 * const traces = field.query("generics typescript");
 * // -> Returns Agent A's trace, boosted by relevance
 *
 * // Agent B found it useful -- reinforce
 * field.reinforce(traces[0].id, "agent-b");
 * ```
 */
export class AkashaField {
	private readonly config: AkashaConfig;
	private readonly traces: Map<string, StigmergicTrace> = new Map();
	/** Tracks which agents have reinforced which traces to prevent self-reinforcement. */
	private readonly reinforcedBy: Map<string, Set<string>> = new Map();

	constructor(config?: Partial<AkashaConfig>) {
		this.config = {
			...DEFAULT_CONFIG,
			...config,
			// Clamp to hard ceilings
			maxTraces: Math.min(
				config?.maxTraces ?? DEFAULT_CONFIG.maxTraces,
				HARD_CEILINGS.maxTraces,
			),
			decayHalfLife: Math.max(
				config?.decayHalfLife ?? DEFAULT_CONFIG.decayHalfLife,
				HARD_CEILINGS.minDecayHalfLife,
			),
		};
	}

	// ─── Leaving Traces ─────────────────────────────────────────────────

	/**
	 * Agent leaves a stigmergic trace after solving or discovering something.
	 *
	 * The trace is stored in-memory and assigned a deterministic FNV-1a ID
	 * based on (agentId, type, topic, content). If the maxTraces limit is
	 * reached, the weakest trace is evicted.
	 *
	 * @param agentId  - Which agent is leaving this trace.
	 * @param type     - The category of knowledge.
	 * @param topic    - What the trace is about (used for matching).
	 * @param content  - The actual knowledge or solution.
	 * @param metadata - Optional metadata for the trace.
	 * @returns The created StigmergicTrace.
	 */
	leave(
		agentId: string,
		type: TraceType,
		topic: string,
		content: string,
		metadata?: Record<string, unknown>,
	): StigmergicTrace {
		// Enforce content size ceiling
		const truncatedContent = content.length > HARD_CEILINGS.maxContentSize
			? content.slice(0, HARD_CEILINGS.maxContentSize)
			: content;

		// Deterministic ID from inputs
		const id = `aks-${fnv1a(agentId + ":" + type + ":" + topic + ":" + truncatedContent)}`;

		const now = Date.now();
		const trace: StigmergicTrace = {
			id,
			agentId,
			traceType: type,
			topic,
			content: truncatedContent,
			strength: this.config.initialStrength,
			reinforcements: 0,
			metadata: metadata ?? {},
			createdAt: now,
			lastReinforcedAt: now,
		};

		this.traces.set(id, trace);
		this.reinforcedBy.set(id, new Set([agentId]));

		// Enforce max traces -- evict the weakest if over limit
		if (this.traces.size > this.config.maxTraces) {
			this.evictWeakest();
		}

		return trace;
	}

	/**
	 * Reinforce an existing trace -- another agent found it useful.
	 *
	 * Strength is increased by `reinforcementBoost` (clamped to 1.0).
	 * An agent cannot reinforce its own trace or reinforce the same trace twice.
	 *
	 * @param traceId - The trace to reinforce.
	 * @param agentId - The agent reinforcing it.
	 * @returns The updated trace, or null if not found / already reinforced.
	 */
	reinforce(traceId: string, agentId: string): StigmergicTrace | null {
		const trace = this.traces.get(traceId);
		if (!trace) return null;

		// Prevent self-reinforcement and duplicate reinforcement
		const agents = this.reinforcedBy.get(traceId);
		if (agents?.has(agentId)) return null;

		// Diminishing returns: boost = base / (1 + α × n)
		// First reinforcement gets full boost, subsequent ones get progressively less.
		// This prevents traces from being "spammed" to max strength.
		const α = this.config.diminishingAlpha;
		const effectiveBoost = this.config.reinforcementBoost / (1 + α * trace.reinforcements);
		trace.strength = Math.min(1.0, trace.strength + effectiveBoost);
		trace.reinforcements++;
		trace.lastReinforcedAt = Date.now();

		if (!agents) {
			this.reinforcedBy.set(traceId, new Set([agentId]));
		} else {
			agents.add(agentId);
		}

		return trace;
	}

	// ─── Following Traces ────────────────────────────────────────────────

	/**
	 * Find relevant traces for a given query/topic using Jaccard similarity.
	 *
	 * Scores each trace as: `jaccardSimilarity(queryTokens, traceTokens) * trace.strength`
	 * and returns the top K results sorted by score descending.
	 *
	 * @param topic - The query to match against trace topics and content.
	 * @param opts  - Optional filters: type, minStrength, limit.
	 * @returns Matching traces sorted by relevance score.
	 */
	query(
		topic: string,
		opts?: { type?: TraceType; minStrength?: number; limit?: number },
	): StigmergicTrace[] {
		const queryTokens = new Set(tokenize(topic));
		if (queryTokens.size === 0) return [];

		const minStr = opts?.minStrength ?? this.config.minStrength;
		const limit = opts?.limit ?? this.config.topKRetrieval;

		const scored: Array<{ trace: StigmergicTrace; score: number }> = [];

		for (const trace of this.traces.values()) {
			// Filter by strength
			if (trace.strength < minStr) continue;
			// Filter by type
			if (opts?.type && trace.traceType !== opts.type) continue;

			const traceTokens = new Set([
				...tokenize(trace.topic),
				...tokenize(trace.content),
			]);

			const similarity = jaccardSimilarity(queryTokens, traceTokens);
			if (similarity <= 0) continue;

			const score = similarity * trace.strength;
			scored.push({ trace, score });
		}

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, limit).map((s) => s.trace);
	}

	/**
	 * Get the strongest traces overall -- the "highways" of collective knowledge.
	 *
	 * @param limit - Maximum number of traces to return. Defaults to topKRetrieval.
	 * @returns Traces sorted by strength descending.
	 */
	strongest(limit?: number): StigmergicTrace[] {
		const maxResults = limit ?? this.config.topKRetrieval;
		const all = [...this.traces.values()];
		all.sort((a, b) => b.strength - a.strength);
		return all.slice(0, maxResults);
	}

	/**
	 * Get traces left by a specific agent.
	 *
	 * @param agentId - The agent whose traces to retrieve.
	 * @param limit   - Maximum results. Defaults to topKRetrieval.
	 * @returns Traces by the agent, sorted by creation time descending.
	 */
	byAgent(agentId: string, limit?: number): StigmergicTrace[] {
		const maxResults = limit ?? this.config.topKRetrieval;
		const results: StigmergicTrace[] = [];

		for (const trace of this.traces.values()) {
			if (trace.agentId === agentId) {
				results.push(trace);
			}
		}

		results.sort((a, b) => b.createdAt - a.createdAt);
		return results.slice(0, maxResults);
	}

	// ─── Decay & Maintenance ─────────────────────────────────────────────

	/**
	 * Apply temporal decay to all traces.
	 *
	 * Formula: `strength *= exp(-ln(2) * elapsed / halfLife)`
	 *
	 * Traces that fall below `minStrength` after decay are pruned automatically.
	 *
	 * @returns Counts of decayed and pruned traces.
	 */
	decay(): { decayed: number; pruned: number } {
		const now = Date.now();
		const baseHalfLife = this.config.decayHalfLife;
		const β = this.config.frequencyDecayBeta;
		let decayed = 0;
		const toPrune: string[] = [];

		for (const [id, trace] of this.traces) {
			const elapsed = now - trace.lastReinforcedAt;
			if (elapsed <= 0) continue;

			// Frequency-weighted decay: more reinforced traces decay slower
			// effectiveHalfLife = baseHalfLife × (1 + β × ln(1 + reinforcements))
			// A trace reinforced 10 times gets ~1.7× the half-life (with β=0.5)
			const effectiveHalfLife = baseHalfLife * (1 + β * Math.log(1 + trace.reinforcements));
			const factor = Math.exp(-Math.LN2 * elapsed / effectiveHalfLife);
			const newStrength = trace.strength * factor;

			if (Math.abs(newStrength - trace.strength) > 1e-10) {
				trace.strength = newStrength;
				decayed++;
			}

			if (trace.strength < this.config.minStrength) {
				toPrune.push(id);
			}
		}

		for (const id of toPrune) {
			this.traces.delete(id);
			this.reinforcedBy.delete(id);
		}

		return { decayed, pruned: toPrune.length };
	}

	/**
	 * Remove traces below the minStrength threshold.
	 *
	 * @returns The number of traces pruned.
	 */
	prune(): number {
		const toPrune: string[] = [];

		for (const [id, trace] of this.traces) {
			if (trace.strength < this.config.minStrength) {
				toPrune.push(id);
			}
		}

		for (const id of toPrune) {
			this.traces.delete(id);
			this.reinforcedBy.delete(id);
		}

		return toPrune.length;
	}

	// ─── Persistence ─────────────────────────────────────────────────────

	/**
	 * Persist all traces to a SQLite database.
	 *
	 * Creates the `akasha_traces` table if it does not exist, then upserts
	 * all current traces. Uses duck-typed DatabaseLike (no hard import of
	 * DatabaseManager).
	 *
	 * @param db - A duck-typed database handle with prepare/exec methods.
	 */
	persist(db: DatabaseLike): void {
		db.exec(`
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
		`);

		const upsert = db.prepare(`
			INSERT OR REPLACE INTO akasha_traces
				(id, agent_id, trace_type, topic, content, strength, reinforcements, metadata, created_at, last_reinforced_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		for (const trace of this.traces.values()) {
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
	 * Loads all rows from the `akasha_traces` table. Existing in-memory
	 * traces are replaced. Traces below minStrength are skipped during load.
	 *
	 * @param db - A duck-typed database handle with prepare/exec methods.
	 */
	restore(db: DatabaseLike): void {
		// Ensure table exists (in case restore is called on a fresh DB)
		db.exec(`
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
		`);

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

		this.traces.clear();
		this.reinforcedBy.clear();

		for (const row of rows) {
			if (row.strength < this.config.minStrength) continue;

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

			this.traces.set(trace.id, trace);
			this.reinforcedBy.set(trace.id, new Set([trace.agentId]));
		}
	}

	// ─── GraphRAG Integration ────────────────────────────────────────────

	/**
	 * Register traces as graph nodes suitable for GraphRAG retrieval.
	 *
	 * Each trace becomes a node with type "akasha", its strength as weight,
	 * and the combined topic + content as searchable text.
	 *
	 * @returns An array of graph-compatible node objects.
	 */
	toGraphNodes(): Array<{
		id: string;
		label: string;
		content: string;
		type: string;
		weight: number;
	}> {
		const nodes: Array<{
			id: string;
			label: string;
			content: string;
			type: string;
			weight: number;
		}> = [];

		for (const trace of this.traces.values()) {
			if (trace.strength < this.config.minStrength) continue;
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
	 *
	 *   `boostedScore = originalScore * (1 + traceBoostFactor * trace.strength)`
	 *
	 * where traceBoostFactor defaults to 0.3 (30% max boost for strength=1.0).
	 *
	 * @param results - The original search results with id and score.
	 * @param query   - The search query used for topic matching.
	 * @returns Results with boosted scores and traceBoost metadata.
	 */
	boostResults(
		results: Array<{ id: string; score: number; content?: string }>,
		query: string,
	): Array<{ id: string; score: number; content?: string; traceBoost: number }> {
		const queryTokens = new Set(tokenize(query));

		// Pre-compute matching traces for the query
		const matchingTraces: Array<{ trace: StigmergicTrace; similarity: number }> = [];
		if (queryTokens.size > 0) {
			for (const trace of this.traces.values()) {
				if (trace.strength < this.config.minStrength) continue;
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
				// Check if this result's content matches any trace
				const resultTokens = result.content
					? new Set(tokenize(result.content))
					: new Set<string>();

				// Find the best matching trace for this specific result
				let bestBoost = 0;
				for (const { trace, similarity } of matchingTraces) {
					// Direct ID match (the result IS a trace node)
					if (result.id === trace.id) {
						bestBoost = Math.max(bestBoost, trace.strength);
						break;
					}

					// Content-based match: check if the result content overlaps with the trace
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

				traceBoost = bestBoost * this.config.traceBoostFactor;
			}

			return {
				...result,
				score: result.score * (1 + traceBoost),
				traceBoost,
			};
		});
	}

	// ─── Stats ───────────────────────────────────────────────────────────

	/**
	 * Return statistics about the current state of the Akasha field.
	 *
	 * @returns An object with total/active counts, per-type breakdown,
	 *          average strength, strongest topic, and total reinforcements.
	 */
	stats(): {
		totalTraces: number;
		activeTraces: number;
		byType: Record<TraceType, number>;
		avgStrength: number;
		strongestTopic: string | null;
		totalReinforcements: number;
	} {
		const byType: Record<TraceType, number> = {
			solution: 0,
			warning: 0,
			shortcut: 0,
			pattern: 0,
			correction: 0,
			preference: 0,
		};

		let totalStrength = 0;
		let activeCount = 0;
		let totalReinforcements = 0;
		let strongestTrace: StigmergicTrace | null = null;

		for (const trace of this.traces.values()) {
			byType[trace.traceType]++;
			totalStrength += trace.strength;
			totalReinforcements += trace.reinforcements;

			if (trace.strength >= this.config.minStrength) {
				activeCount++;
			}

			if (!strongestTrace || trace.strength > strongestTrace.strength) {
				strongestTrace = trace;
			}
		}

		return {
			totalTraces: this.traces.size,
			activeTraces: activeCount,
			byType,
			avgStrength: this.traces.size > 0 ? totalStrength / this.traces.size : 0,
			strongestTopic: strongestTrace?.topic ?? null,
			totalReinforcements,
		};
	}

	// ─── Internal Helpers ────────────────────────────────────────────────

	/**
	 * Evict the weakest trace to make room for a new one.
	 * If two traces have equal strength, the older one is evicted.
	 */
	private evictWeakest(): void {
		let weakestId: string | null = null;
		let weakestStrength = Infinity;
		let weakestCreatedAt = Infinity;

		for (const [id, trace] of this.traces) {
			if (
				trace.strength < weakestStrength ||
				(trace.strength === weakestStrength && trace.createdAt < weakestCreatedAt)
			) {
				weakestId = id;
				weakestStrength = trace.strength;
				weakestCreatedAt = trace.createdAt;
			}
		}

		if (weakestId) {
			this.traces.delete(weakestId);
			this.reinforcedBy.delete(weakestId);
		}
	}
}

// ─── Private Helpers ─────────────────────────────────────────────────────────

/** Safely parse a JSON string, returning an empty object on failure. */
function safeParseJson(raw: string | null): Record<string, unknown> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}
