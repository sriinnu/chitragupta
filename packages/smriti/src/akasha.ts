/**
 * @chitragupta/smriti -- Akasha (आकाश) -- Shared Knowledge Field.
 *
 * Implements **stigmergy**: indirect communication through the environment.
 * Agents leave "traces" (pheromones) in the knowledge graph. Other agents
 * pick up those traces, reinforcing effective collective knowledge without
 * direct agent-to-agent communication.
 *
 * Temporal decay: `strength *= exp(-ln(2) * elapsed / halfLife)`
 * Topic matching: Jaccard similarity * trace strength.
 *
 * @module akasha
 */

import {
	persistTraces,
	restoreTraces,
	tracesToGraphNodes,
	boostResultsWithTraces,
} from "./akasha-integration.js";
import type {
	StigmergicTrace,
	TraceType,
	AkashaConfig,
	DatabaseLike,
	AkashaGraphNode,
	BoostedResult,
} from "./akasha-integration.js";

// Re-export types so consumers can import from akasha.ts
export type { StigmergicTrace, TraceType, AkashaConfig, DatabaseLike };

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
 * Exported for use by `akasha-integration.ts` standalone functions.
 */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * Compute Jaccard similarity between two token sets.
 * Returns |intersection| / |union|, or 1 if both sets are empty.
 * Exported for use by `akasha-integration.ts` standalone functions.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 1;
	let intersection = 0;
	for (const token of a) {
		if (b.has(token)) intersection++;
	}
	const union = a.size + b.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

// ─── Defaults & Hard Ceilings ────────────────────────────────────────────────

const DAY_MS = 86_400_000;

const DEFAULT_CONFIG: AkashaConfig = {
	decayHalfLife: 7 * DAY_MS,
	minStrength: 0.01,
	maxTraces: 5000,
	reinforcementBoost: 0.15,
	initialStrength: 0.5,
	topKRetrieval: 10,
	traceBoostFactor: 0.3,
	diminishingAlpha: 0.3,
	frequencyDecayBeta: 0.5,
};

/** System hard ceilings -- user config is clamped to these values. */
const HARD_CEILINGS = {
	maxTraces: 50_000,
	minDecayHalfLife: 3_600_000,
	maxContentSize: 10_000,
} as const;

// ─── AkashaField ─────────────────────────────────────────────────────────────

/**
 * Akasha -- Shared Knowledge Field with Stigmergic Traces.
 *
 * Provides a collective intelligence layer where agents leave traces
 * (pheromones) that decay over time and are reinforced when other agents
 * find them useful, creating emergent "highways" of collective knowledge.
 */
export class AkashaField {
	private readonly config: AkashaConfig;
	private readonly traces: Map<string, StigmergicTrace> = new Map();
	/** Tracks which agents reinforced which traces (prevents self/duplicate). */
	private readonly reinforcedBy: Map<string, Set<string>> = new Map();

	constructor(config?: Partial<AkashaConfig>) {
		this.config = {
			...DEFAULT_CONFIG,
			...config,
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
	 * @param agentId  - Which agent is leaving this trace.
	 * @param type     - The category of knowledge.
	 * @param topic    - What the trace is about (used for matching).
	 * @param content  - The actual knowledge or solution.
	 * @param metadata - Optional metadata for the trace.
	 * @returns The created StigmergicTrace.
	 */
	leave(
		agentId: string, type: TraceType, topic: string,
		content: string, metadata?: Record<string, unknown>,
	): StigmergicTrace {
		const truncatedContent = content.length > HARD_CEILINGS.maxContentSize
			? content.slice(0, HARD_CEILINGS.maxContentSize) : content;
		const id = `aks-${fnv1a(agentId + ":" + type + ":" + topic + ":" + truncatedContent)}`;
		const now = Date.now();

		const trace: StigmergicTrace = {
			id, agentId, traceType: type, topic,
			content: truncatedContent,
			strength: this.config.initialStrength,
			reinforcements: 0,
			metadata: metadata ?? {},
			createdAt: now, lastReinforcedAt: now,
		};

		this.traces.set(id, trace);
		this.reinforcedBy.set(id, new Set([agentId]));
		if (this.traces.size > this.config.maxTraces) this.evictWeakest();
		return trace;
	}

	/**
	 * Reinforce an existing trace -- another agent found it useful.
	 *
	 * @param traceId - The trace to reinforce.
	 * @param agentId - The agent reinforcing it.
	 * @returns The updated trace, or null if not found / already reinforced.
	 */
	reinforce(traceId: string, agentId: string): StigmergicTrace | null {
		const trace = this.traces.get(traceId);
		if (!trace) return null;
		const agents = this.reinforcedBy.get(traceId);
		if (agents?.has(agentId)) return null;

		const alpha = this.config.diminishingAlpha;
		const effectiveBoost = this.config.reinforcementBoost / (1 + alpha * trace.reinforcements);
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
	 * Find relevant traces by Jaccard similarity on topic/content tokens.
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
			if (trace.strength < minStr) continue;
			if (opts?.type && trace.traceType !== opts.type) continue;
			const traceTokens = new Set([...tokenize(trace.topic), ...tokenize(trace.content)]);
			const similarity = jaccardSimilarity(queryTokens, traceTokens);
			if (similarity <= 0) continue;
			scored.push({ trace, score: similarity * trace.strength });
		}

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, limit).map((s) => s.trace);
	}

	/**
	 * Get the strongest traces overall -- the "highways" of collective knowledge.
	 *
	 * @param limit - Maximum number of traces to return.
	 * @returns Traces sorted by strength descending.
	 */
	strongest(limit?: number): StigmergicTrace[] {
		const all = [...this.traces.values()];
		all.sort((a, b) => b.strength - a.strength);
		return all.slice(0, limit ?? this.config.topKRetrieval);
	}

	/**
	 * Get traces left by a specific agent.
	 *
	 * @param agentId - The agent whose traces to retrieve.
	 * @param limit   - Maximum results.
	 * @returns Traces by the agent, sorted by creation time descending.
	 */
	byAgent(agentId: string, limit?: number): StigmergicTrace[] {
		const results: StigmergicTrace[] = [];
		for (const trace of this.traces.values()) {
			if (trace.agentId === agentId) results.push(trace);
		}
		results.sort((a, b) => b.createdAt - a.createdAt);
		return results.slice(0, limit ?? this.config.topKRetrieval);
	}

	// ─── Decay & Maintenance ─────────────────────────────────────────────

	/**
	 * Apply temporal decay to all traces. Traces that fall below `minStrength`
	 * after decay are pruned automatically.
	 *
	 * @returns Counts of decayed and pruned traces.
	 */
	decay(): { decayed: number; pruned: number } {
		const now = Date.now();
		const baseHalfLife = this.config.decayHalfLife;
		const beta = this.config.frequencyDecayBeta;
		let decayed = 0;
		const toPrune: string[] = [];

		for (const [id, trace] of this.traces) {
			const elapsed = now - trace.lastReinforcedAt;
			if (elapsed <= 0) continue;
			const effectiveHalfLife = baseHalfLife * (1 + beta * Math.log(1 + trace.reinforcements));
			const factor = Math.exp(-Math.LN2 * elapsed / effectiveHalfLife);
			const newStrength = trace.strength * factor;

			if (Math.abs(newStrength - trace.strength) > 1e-10) {
				trace.strength = newStrength;
				decayed++;
			}
			if (trace.strength < this.config.minStrength) toPrune.push(id);
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
			if (trace.strength < this.config.minStrength) toPrune.push(id);
		}
		for (const id of toPrune) {
			this.traces.delete(id);
			this.reinforcedBy.delete(id);
		}
		return toPrune.length;
	}

	// ─── Persistence (delegated to akasha-integration) ───────────────────

	/**
	 * Persist all traces to a SQLite database.
	 *
	 * @param db - A duck-typed database handle with prepare/exec methods.
	 */
	persist(db: DatabaseLike): void {
		persistTraces(this.traces, db);
	}

	/**
	 * Restore traces from a SQLite database.
	 *
	 * @param db - A duck-typed database handle with prepare/exec methods.
	 */
	restore(db: DatabaseLike): void {
		const result = restoreTraces(db, this.config);
		this.traces.clear();
		this.reinforcedBy.clear();
		for (const [k, v] of result.traces) this.traces.set(k, v);
		for (const [k, v] of result.reinforcedBy) this.reinforcedBy.set(k, v);
	}

	// ─── GraphRAG (delegated to akasha-integration) ──────────────────────

	/**
	 * Register traces as graph nodes suitable for GraphRAG retrieval.
	 *
	 * @returns An array of graph-compatible node objects.
	 */
	toGraphNodes(): AkashaGraphNode[] {
		return tracesToGraphNodes(this.traces, this.config.minStrength);
	}

	/**
	 * Boost graph search results that have matching stigmergic traces.
	 *
	 * @param results - The original search results with id and score.
	 * @param query   - The search query used for topic matching.
	 * @returns Results with boosted scores and traceBoost metadata.
	 */
	boostResults(
		results: Array<{ id: string; score: number; content?: string }>,
		query: string,
	): BoostedResult[] {
		return boostResultsWithTraces(this.traces, this.config, results, query);
	}

	// ─── Stats ───────────────────────────────────────────────────────────

	/**
	 * Return statistics about the current state of the Akasha field.
	 *
	 * @returns Total/active counts, per-type breakdown, average strength,
	 *          strongest topic, and total reinforcements.
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
			solution: 0, warning: 0, shortcut: 0,
			pattern: 0, correction: 0, preference: 0,
		};
		let totalStrength = 0;
		let activeCount = 0;
		let totalReinforcements = 0;
		let strongestTrace: StigmergicTrace | null = null;

		for (const trace of this.traces.values()) {
			byType[trace.traceType]++;
			totalStrength += trace.strength;
			totalReinforcements += trace.reinforcements;
			if (trace.strength >= this.config.minStrength) activeCount++;
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

	/** Evict the weakest trace. Ties broken by oldest createdAt. */
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

		if (!weakestId && this.traces.size > 0) {
			weakestId = this.traces.keys().next().value!;
		}
		if (weakestId) {
			this.traces.delete(weakestId);
			this.reinforcedBy.delete(weakestId);
		}
	}
}
