/**
 * @chitragupta/smriti — Svapna Consolidation (Dream Cycle)
 *
 * In Yoga Nidra, svapna (स्वप्न) is the dream state where the mind
 * reorganizes experience into lasting knowledge. This module implements
 * the 5-phase consolidation cycle that runs during the Nidra daemon's
 * DREAMING state, distilling raw session experience into patterns,
 * procedures, and compressed knowledge.
 *
 * The 5 phases mirror stages of sleep consolidation in neuroscience:
 *
 *   1. REPLAY       — Hippocampal replay: re-traverse recent turns, score surprise
 *   2. RECOMBINE    — Dream association: cross-session structural similarity
 *   3. CRYSTALLIZE  — Vasana formation: aggregate samskaras into stable tendencies
 *   4. PROCEDURALIZE — Vidhi extraction: learn parameterized tool sequences
 *   5. COMPRESS     — Sushupti: Sinkhorn-Knopp weighted by epistemological source
 *
 * Performance target: full cycle < 20 seconds for 50 sessions.
 */

import { DatabaseManager } from "./db/index.js";
import type {
	SessionTurn,
	SessionToolCall,
	SamskaraRecord,
	Vasana,
	Vidhi,
	VidhiStep,
	VidhiParam,
	ConsolidationLogEntry,
	PramanaType,
} from "./types.js";
import { sinkhornAccelerated } from "./sinkhorn-accelerated.js";
import type { SessionChunk } from "./sinkhorn-accelerated.js";
import { estimateTokens } from "./graphrag-scoring.js";

// ─── FNV-1a Hash ────────────────────────────────────────────────────────────

/** FNV-1a offset basis for 32-bit. */
const FNV_OFFSET = 0x811c9dc5;
/** FNV-1a prime for 32-bit. */
const FNV_PRIME = 0x01000193;

/**
 * Compute a 32-bit FNV-1a hash, returned as a zero-padded hex string.
 *
 * @param input - The string to hash.
 * @returns An 8-character hex string.
 */
function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = (Math.imul(hash, FNV_PRIME)) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

// ─── Types ──────────────────────────────────────────────────────────────────

/** Configuration for the Svapna consolidation cycle. */
export interface SvapnaConfig {
	/** Maximum sessions to process per cycle. Default: 50. */
	maxSessionsPerCycle: number;
	/** Surprise threshold in [0, 1]. Turns above this are "high surprise". Default: 0.7. */
	surpriseThreshold: number;
	/** Minimum observation count for a pattern to become a vasana candidate. Default: 3. */
	minPatternFrequency: number;
	/** Minimum n-gram length for tool sequence extraction. Default: 2. */
	minSequenceLength: number;
	/** Minimum success rate for a tool sequence to become a Vidhi. Default: 0.8. */
	minSuccessRate: number;
	/** Project scope for this consolidation cycle. */
	project: string;
}

/** A turn scored with surprise value during the REPLAY phase. */
export interface ScoredTurn {
	/** Turn row id from the database. */
	turnId: number;
	/** Parent session ID. */
	sessionId: string;
	/** Turn number within the session. */
	turnNumber: number;
	/** Role: user or assistant. */
	role: "user" | "assistant";
	/** Raw text content. */
	content: string;
	/** Parsed tool calls, if any. */
	toolCalls: SessionToolCall[];
	/** Information-theoretic surprise: -log P(outcome | context). */
	surprise: number;
	/** Retention weight: higher surprise = higher weight. */
	retentionWeight: number;
	/** Created-at timestamp (epoch ms). */
	createdAt: number;
}

/** Result of the REPLAY phase. */
export interface ReplayResult {
	/** All scored turns. */
	allTurns: ScoredTurn[];
	/** Turns that passed the surprise threshold (top fraction). */
	highSurpriseTurns: ScoredTurn[];
	/** Total turns scored. */
	turnsScored: number;
	/** Count of high-surprise turns. */
	highSurprise: number;
	/** Phase duration in ms. */
	durationMs: number;
}

/** A cross-session association discovered in the RECOMBINE phase. */
export interface CrossSessionAssociation {
	/** The high-surprise turn that anchored this association. */
	anchorTurnId: number;
	/** Session ID of the anchor turn. */
	anchorSessionId: string;
	/** Session ID of the matched turn. */
	matchedSessionId: string;
	/** Jaccard similarity of tool-call fingerprints. */
	similarity: number;
	/** Tool call sequence fingerprint of the anchor. */
	anchorFingerprint: string;
	/** Tool call sequence fingerprint of the match. */
	matchedFingerprint: string;
}

/** Result of the RECOMBINE phase. */
export interface RecombineResult {
	/** All discovered associations. */
	associations: CrossSessionAssociation[];
	/** Number of unique cross-session pairs. */
	crossSessions: number;
	/** Phase duration in ms. */
	durationMs: number;
}

/** Result of the CRYSTALLIZE phase. */
export interface CrystallizeResult {
	/** Number of new vasanas created. */
	vasanasCreated: number;
	/** Number of existing vasanas reinforced. */
	vasanasReinforced: number;
	/** Phase duration in ms. */
	durationMs: number;
}

/** Result of the PROCEDURALIZE phase. */
export interface ProceduralizeResult {
	/** Number of new vidhis created. */
	vidhisCreated: number;
	/** The vidhi candidates that were persisted. */
	vidhis: Vidhi[];
	/** Phase duration in ms. */
	durationMs: number;
}

/** Result of the COMPRESS phase. */
export interface CompressResult {
	/** Total tokens processed. */
	tokensCompressed: number;
	/** Compression ratio: output / input. Lower = more compression. */
	compressionRatio: number;
	/** Phase duration in ms. */
	durationMs: number;
}

/** Full result of a Svapna consolidation cycle. */
export interface SvapnaResult {
	phases: {
		replay: { turnsScored: number; highSurprise: number; durationMs: number };
		recombine: { associations: number; crossSessions: number; durationMs: number };
		crystallize: { vasanasCreated: number; vasanasReinforced: number; durationMs: number };
		proceduralize: { vidhisCreated: number; durationMs: number };
		compress: { tokensCompressed: number; compressionRatio: number; durationMs: number };
	};
	totalDurationMs: number;
	cycleId: string;
}

/** Default configuration values. */
const DEFAULT_CONFIG: SvapnaConfig = {
	maxSessionsPerCycle: 50,
	surpriseThreshold: 0.7,
	minPatternFrequency: 3,
	minSequenceLength: 2,
	minSuccessRate: 0.8,
	project: "",
};

/** Pramana compression weights — higher = resists compression more. */
const PRAMANA_PRESERVATION: Record<PramanaType, number> = {
	pratyaksha: 0.95,    // Direct observation — near-immutable
	shabda: 0.80,        // Documented testimony
	anumana: 0.65,       // Inference
	upamana: 0.50,       // Analogy
	arthapatti: 0.40,    // Postulation
	anupalabdhi: 0.25,   // Non-apprehension / speculation — compress aggressively
};

// ─── Utility: Tool Call Fingerprinting ──────────────────────────────────────

/**
 * Build a fingerprint of a tool call sequence using FNV-1a hashing.
 *
 * The fingerprint captures the ordered set of tool names, producing a
 * compact representation suitable for Jaccard comparison. We hash
 * consecutive pairs (bigrams) to capture dependency structure.
 *
 * @param toolNames - Ordered list of tool names from a turn or window.
 * @returns A set of bigram hashes forming the fingerprint.
 */
function buildToolFingerprint(toolNames: string[]): Set<string> {
	const fingerprint = new Set<string>();
	if (toolNames.length === 0) return fingerprint;

	// Unigrams: individual tool names
	for (const name of toolNames) {
		fingerprint.add(fnv1a(`u:${name}`));
	}

	// Bigrams: consecutive tool pairs for dependency structure
	for (let i = 0; i < toolNames.length - 1; i++) {
		fingerprint.add(fnv1a(`b:${toolNames[i]}:${toolNames[i + 1]}`));
	}

	return fingerprint;
}

/**
 * Compute Jaccard similarity between two fingerprint sets.
 *
 * J(A, B) = |A intersect B| / |A union B|
 *
 * @param a - First fingerprint set.
 * @param b - Second fingerprint set.
 * @returns Similarity in [0, 1].
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 0;

	let intersection = 0;
	const smaller = a.size <= b.size ? a : b;
	const larger = a.size <= b.size ? b : a;

	for (const elem of smaller) {
		if (larger.has(elem)) intersection++;
	}

	const union = a.size + b.size - intersection;
	return union > 0 ? intersection / union : 0;
}

/**
 * Parse tool calls from a JSON string stored in the turns table.
 * Returns an empty array on parse failure.
 */
function parseToolCalls(json: string | null): SessionToolCall[] {
	if (!json) return [];
	try {
		const parsed = JSON.parse(json);
		if (!Array.isArray(parsed)) return [];
		return parsed as SessionToolCall[];
	} catch {
		return [];
	}
}

/**
 * Extract tool names from a list of tool calls.
 */
function toolNames(calls: SessionToolCall[]): string[] {
	return calls.map((tc) => tc.name);
}

/**
 * Compute the success ratio from a list of tool calls.
 * A tool call is "successful" if isError is falsy.
 *
 * @returns Success ratio in [0, 1], or 1.0 if no tool calls.
 */
function toolSuccessRate(calls: SessionToolCall[]): number {
	if (calls.length === 0) return 1.0;
	const successes = calls.filter((tc) => !tc.isError).length;
	return successes / calls.length;
}

// ─── Utility: N-gram Extraction ──────────────────────────────────────────────

/**
 * Extract all n-grams of sizes [minN, maxN] from a string sequence.
 *
 * @param sequence - Ordered elements.
 * @param minN - Minimum n-gram size.
 * @param maxN - Maximum n-gram size.
 * @returns Map from n-gram string key to occurrence count.
 */
function extractNgrams(
	sequence: string[],
	minN: number,
	maxN: number,
): Map<string, number> {
	const counts = new Map<string, number>();
	const effectiveMax = Math.min(maxN, sequence.length);

	for (let n = minN; n <= effectiveMax; n++) {
		for (let i = 0; i <= sequence.length - n; i++) {
			const key = sequence.slice(i, i + n).join(" -> ");
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}

	return counts;
}

// ─── Utility: Anti-Unification ──────────────────────────────────────────────

/**
 * Anti-unification for argument values across multiple invocations of
 * the same tool at the same position in a sequence.
 *
 * Given an array of argument strings, detects which positions are
 * "variable" (differ across instances) vs "fixed" (identical).
 *
 * @param argSets - Array of argument JSON objects (one per occurrence).
 * @returns Template with ${param_N} placeholders and parameter schema.
 */
function antiUnify(
	argSets: Array<Record<string, unknown>>,
): { template: Record<string, unknown>; params: Record<string, VidhiParam> } {
	if (argSets.length === 0) {
		return { template: {}, params: {} };
	}

	const template: Record<string, unknown> = {};
	const params: Record<string, VidhiParam> = {};

	// Collect all keys across all arg sets
	const allKeys = new Set<string>();
	for (const args of argSets) {
		for (const key of Object.keys(args)) {
			allKeys.add(key);
		}
	}

	for (const key of allKeys) {
		const values = argSets
			.filter((a) => key in a)
			.map((a) => a[key]);

		// Check if all values are identical
		const firstStr = JSON.stringify(values[0]);
		const allSame = values.every((v) => JSON.stringify(v) === firstStr);

		if (allSame && values.length === argSets.length) {
			// Fixed position — use the constant value
			template[key] = values[0];
		} else {
			// Variable position — create a parameter placeholder
			const paramName = `param_${key}`;
			template[key] = `\${${paramName}}`;

			// Infer type from observed values
			const types = new Set(values.map((v) => typeof v));
			let inferredType: VidhiParam["type"] = "string";
			if (types.size === 1) {
				const t = [...types][0];
				if (t === "number") inferredType = "number";
				else if (t === "boolean") inferredType = "boolean";
				else if (t === "object") {
					inferredType = Array.isArray(values[0]) ? "array" : "object";
				}
			}

			params[paramName] = {
				name: paramName,
				type: inferredType,
				description: `Variable argument '${key}' — differs across invocations.`,
				required: values.length === argSets.length,
				examples: values.slice(0, 3),
			};
		}
	}

	return { template, params };
}

// ─── SvapnaConsolidation ────────────────────────────────────────────────────

/**
 * Svapna Consolidation — the 5-phase dream cycle.
 *
 * Runs during the Nidra daemon's DREAMING state to distill recent session
 * experience into patterns (samskaras), behavioral tendencies (vasanas),
 * procedural memory (vidhis), and compressed knowledge.
 *
 * Each phase can be run independently for testing, or the full cycle
 * can be executed via `run()` with progress reporting.
 *
 * @example
 * ```ts
 * const svapna = new SvapnaConsolidation({
 *   project: '/home/user/my-project',
 *   maxSessionsPerCycle: 30,
 * });
 * const result = await svapna.run((phase, progress) => {
 *   console.log(`${phase}: ${(progress * 100).toFixed(0)}%`);
 * });
 * ```
 */
export class SvapnaConsolidation {
	private config: SvapnaConfig;
	private db: DatabaseManager;
	private cycleId: string;

	/**
	 * Create a new Svapna consolidation cycle.
	 *
	 * @param config - Partial configuration; unset fields use defaults.
	 * @param db - Optional DatabaseManager instance (uses singleton if omitted).
	 */
	constructor(config: Partial<SvapnaConfig> & { project: string }, db?: DatabaseManager) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.db = db ?? DatabaseManager.instance();
		this.cycleId = `svapna-${new Date().toISOString()}`;
	}

	// ── Full Cycle ───────────────────────────────────────────────────────

	/**
	 * Run the complete 5-phase consolidation cycle.
	 *
	 * Reports progress via the callback: phase name and a fractional
	 * progress value in [0, 1]. The callback is invoked at least once
	 * per phase.
	 *
	 * @param onProgress - Progress callback (phase, progress).
	 * @returns The consolidated result with metrics for each phase.
	 */
	async run(
		onProgress?: (phase: string, progress: number) => void,
	): Promise<SvapnaResult> {
		const cycleStart = performance.now();
		const report = onProgress ?? (() => {});

		this.logCycle("running");

		// Phase 1: REPLAY
		report("REPLAY", 0);
		const replayResult = await this.replay();
		report("REPLAY", 1);

		// Phase 2: RECOMBINE
		report("RECOMBINE", 0);
		const recombineResult = await this.recombine(replayResult.highSurpriseTurns);
		report("RECOMBINE", 1);

		// Phase 3: CRYSTALLIZE
		report("CRYSTALLIZE", 0);
		const crystallizeResult = await this.crystallize();
		report("CRYSTALLIZE", 1);

		// Phase 4: PROCEDURALIZE
		report("PROCEDURALIZE", 0);
		const proceduralizeResult = await this.proceduralize();
		report("PROCEDURALIZE", 1);

		// Phase 5: COMPRESS
		report("COMPRESS", 0);
		const compressResult = await this.compress();
		report("COMPRESS", 1);

		const totalDurationMs = performance.now() - cycleStart;

		const result: SvapnaResult = {
			phases: {
				replay: {
					turnsScored: replayResult.turnsScored,
					highSurprise: replayResult.highSurprise,
					durationMs: replayResult.durationMs,
				},
				recombine: {
					associations: recombineResult.associations.length,
					crossSessions: recombineResult.crossSessions,
					durationMs: recombineResult.durationMs,
				},
				crystallize: {
					vasanasCreated: crystallizeResult.vasanasCreated,
					vasanasReinforced: crystallizeResult.vasanasReinforced,
					durationMs: crystallizeResult.durationMs,
				},
				proceduralize: {
					vidhisCreated: proceduralizeResult.vidhisCreated,
					durationMs: proceduralizeResult.durationMs,
				},
				compress: {
					tokensCompressed: compressResult.tokensCompressed,
					compressionRatio: compressResult.compressionRatio,
					durationMs: compressResult.durationMs,
				},
			},
			totalDurationMs,
			cycleId: this.cycleId,
		};

		this.logCycle("success", result);
		return result;
	}

	// ── Phase 1: REPLAY (Hippocampal Replay) ─────────────────────────────

	/**
	 * Phase 1: Re-traverse recent session turns and score each by surprise.
	 *
	 * Surprise is computed as the negative log probability of the observed
	 * outcome given the context:
	 *
	 *     surprise(t) = -log P(outcome_t | context_t)
	 *
	 * P is estimated from the historical frequency of tool-result patterns:
	 * how often the same tool produced the same result class (success/error)
	 * across all recorded turns.
	 *
	 * High-surprise turns (top fraction defined by surpriseThreshold) get
	 * boosted retention weight for downstream phases.
	 *
	 * @returns Scored turns with surprise values and the high-surprise subset.
	 */
	async replay(): Promise<ReplayResult> {
		const start = performance.now();
		const agentDb = this.db.get("agent");

		// Step 1: Fetch recent session IDs for this project
		const sessions = agentDb
			.prepare(
				`SELECT id FROM sessions
				 WHERE project = ?
				 ORDER BY updated_at DESC
				 LIMIT ?`,
			)
			.all(this.config.project, this.config.maxSessionsPerCycle) as Array<{ id: string }>;

		if (sessions.length === 0) {
			return {
				allTurns: [],
				highSurpriseTurns: [],
				turnsScored: 0,
				highSurprise: 0,
				durationMs: performance.now() - start,
			};
		}

		const sessionIds = sessions.map((s) => s.id);
		const placeholders = sessionIds.map(() => "?").join(",");

		// Step 2: Fetch all turns from these sessions
		const turns = agentDb
			.prepare(
				`SELECT id, session_id, turn_number, role, content, tool_calls, created_at
				 FROM turns
				 WHERE session_id IN (${placeholders})
				 ORDER BY created_at ASC`,
			)
			.all(...sessionIds) as Array<{
				id: number;
				session_id: string;
				turn_number: number;
				role: string;
				content: string;
				tool_calls: string | null;
				created_at: number;
			}>;

		// Step 3: Build historical frequency table for tool-result patterns.
		// Pattern key: "toolName:resultClass" where resultClass is "ok" or "err".
		const patternCounts = new Map<string, number>();
		let totalPatterns = 0;

		for (const turn of turns) {
			const calls = parseToolCalls(turn.tool_calls);
			for (const tc of calls) {
				const resultClass = tc.isError ? "err" : "ok";
				const key = `${tc.name}:${resultClass}`;
				patternCounts.set(key, (patternCounts.get(key) ?? 0) + 1);
				totalPatterns++;
			}
		}

		// Step 4: Score each turn with surprise
		const scoredTurns: ScoredTurn[] = [];

		for (const turn of turns) {
			const calls = parseToolCalls(turn.tool_calls);
			let surprise = 0;

			if (calls.length > 0) {
				// Average surprise across tool calls in this turn
				let totalSurprise = 0;
				for (const tc of calls) {
					const resultClass = tc.isError ? "err" : "ok";
					const key = `${tc.name}:${resultClass}`;
					const count = patternCounts.get(key) ?? 0;
					// P(outcome | context) estimated as frequency ratio
					const p = totalPatterns > 0 ? count / totalPatterns : 0.5;
					// Clamp to avoid log(0) — minimum probability 1e-6
					const clampedP = Math.max(p, 1e-6);
					totalSurprise += -Math.log(clampedP);
				}
				surprise = totalSurprise / calls.length;
			} else {
				// For turns without tool calls, use content length as a proxy.
				// Unusually long or short turns get moderate surprise.
				const avgLen = turns.reduce((s, t) => s + t.content.length, 0) / turns.length;
				const deviation = Math.abs(turn.content.length - avgLen) / Math.max(avgLen, 1);
				surprise = Math.min(deviation, 5); // Cap at 5 nats
			}

			scoredTurns.push({
				turnId: turn.id,
				sessionId: turn.session_id,
				turnNumber: turn.turn_number,
				role: turn.role as "user" | "assistant",
				content: turn.content,
				toolCalls: calls,
				surprise,
				retentionWeight: 1.0, // Will be normalized below
				createdAt: turn.created_at,
			});
		}

		// Step 5: Normalize surprise scores to [0, 1] and compute retention weights
		if (scoredTurns.length > 0) {
			let maxSurprise = 0;
			for (const st of scoredTurns) {
				if (st.surprise > maxSurprise) maxSurprise = st.surprise;
			}

			if (maxSurprise > 0) {
				for (const st of scoredTurns) {
					st.surprise = st.surprise / maxSurprise; // Normalize to [0, 1]
					// Retention weight: sigmoid-like boost for high-surprise turns
					st.retentionWeight = 0.5 + 0.5 * st.surprise;
				}
			}
		}

		// Step 6: Select high-surprise turns (above threshold)
		const highSurpriseTurns = scoredTurns.filter(
			(st) => st.surprise >= this.config.surpriseThreshold,
		);

		return {
			allTurns: scoredTurns,
			highSurpriseTurns,
			turnsScored: scoredTurns.length,
			highSurprise: highSurpriseTurns.length,
			durationMs: performance.now() - start,
		};
	}

	// ── Phase 2: RECOMBINE (Dream Association) ───────────────────────────

	/**
	 * Phase 2: For each high-surprise turn, find structurally similar
	 * patterns from OTHER sessions using tool-call fingerprint matching.
	 *
	 * Instead of full graph isomorphism (NP-hard), we use a Jaccard
	 * similarity over hash-based fingerprints of tool call sequences.
	 * This provides O(n * m) comparison where n = high-surprise turns
	 * and m = number of sessions.
	 *
	 * Cross-pollination: identifies analogous patterns that arose in
	 * different contexts, enabling transfer of procedural knowledge.
	 *
	 * @param highSurpriseTurns - The high-surprise turns from Phase 1.
	 * @returns Cross-session associations ordered by similarity.
	 */
	async recombine(highSurpriseTurns: ScoredTurn[]): Promise<RecombineResult> {
		const start = performance.now();

		if (highSurpriseTurns.length === 0) {
			return {
				associations: [],
				crossSessions: 0,
				durationMs: performance.now() - start,
			};
		}

		const agentDb = this.db.get("agent");

		// Build per-session fingerprints from all turns (not just high-surprise)
		const sessionFingerprints = new Map<string, { fingerprint: Set<string>; fingerprintStr: string }>();

		const sessions = agentDb
			.prepare(
				`SELECT id FROM sessions
				 WHERE project = ?
				 ORDER BY updated_at DESC
				 LIMIT ?`,
			)
			.all(this.config.project, this.config.maxSessionsPerCycle) as Array<{ id: string }>;

		for (const session of sessions) {
			const turns = agentDb
				.prepare(
					`SELECT tool_calls FROM turns
					 WHERE session_id = ? AND tool_calls IS NOT NULL
					 ORDER BY turn_number ASC`,
				)
				.all(session.id) as Array<{ tool_calls: string }>;

			const allToolNames: string[] = [];
			for (const turn of turns) {
				const calls = parseToolCalls(turn.tool_calls);
				allToolNames.push(...toolNames(calls));
			}

			if (allToolNames.length > 0) {
				const fp = buildToolFingerprint(allToolNames);
				sessionFingerprints.set(session.id, {
					fingerprint: fp,
					fingerprintStr: [...fp].sort().join(","),
				});
			}
		}

		// For each high-surprise turn, build its local fingerprint and compare
		// against all OTHER sessions' fingerprints
		const associations: CrossSessionAssociation[] = [];
		const crossSessionPairs = new Set<string>();

		const MIN_SIMILARITY = 0.15; // Floor for meaningful structural similarity

		for (const st of highSurpriseTurns) {
			const turnToolNames = toolNames(st.toolCalls);
			if (turnToolNames.length === 0) continue;

			const turnFp = buildToolFingerprint(turnToolNames);
			const turnFpStr = [...turnFp].sort().join(",");

			for (const [sessionId, sessionFp] of sessionFingerprints) {
				// Skip self-session
				if (sessionId === st.sessionId) continue;

				const sim = jaccardSimilarity(turnFp, sessionFp.fingerprint);
				if (sim >= MIN_SIMILARITY) {
					associations.push({
						anchorTurnId: st.turnId,
						anchorSessionId: st.sessionId,
						matchedSessionId: sessionId,
						similarity: sim,
						anchorFingerprint: turnFpStr,
						matchedFingerprint: sessionFp.fingerprintStr,
					});

					// Track unique cross-session pairs
					const pairKey = [st.sessionId, sessionId].sort().join(":");
					crossSessionPairs.add(pairKey);
				}
			}
		}

		// Sort by similarity descending
		associations.sort((a, b) => b.similarity - a.similarity);

		return {
			associations,
			crossSessions: crossSessionPairs.size,
			durationMs: performance.now() - start,
		};
	}

	// ── Phase 3: CRYSTALLIZE (Vasana Formation) ──────────────────────────

	/**
	 * Phase 3: Aggregate samskaras by pattern type and content similarity,
	 * checking whether patterns are stable enough to crystallize into vasanas.
	 *
	 * A samskara becomes a vasana candidate when:
	 *   1. Observation count >= minPatternFrequency
	 *   2. Confidence > 0.5 (above noise floor)
	 *   3. Consistent across at least 2 sessions (stability heuristic)
	 *
	 * Qualifying samskaras are either used to create new vasanas or to
	 * reinforce existing ones. The actual BOCPD change-point detection
	 * is handled by VasanaEngine (not duplicated here).
	 *
	 * @returns Counts of created and reinforced vasanas.
	 */
	async crystallize(): Promise<CrystallizeResult> {
		const start = performance.now();
		const agentDb = this.db.get("agent");
		let vasanasCreated = 0;
		let vasanasReinforced = 0;

		// Step 1: Fetch qualifying samskaras
		const samskaras = agentDb
			.prepare(
				`SELECT id, session_id, pattern_type, pattern_content,
				        observation_count, confidence, pramana_type, project
				 FROM samskaras
				 WHERE (project = ? OR project IS NULL)
				   AND observation_count >= ?
				   AND confidence > 0.5
				 ORDER BY confidence DESC`,
			)
			.all(this.config.project, this.config.minPatternFrequency) as Array<{
				id: string;
				session_id: string;
				pattern_type: string;
				pattern_content: string;
				observation_count: number;
				confidence: number;
				pramana_type: string | null;
				project: string | null;
			}>;

		if (samskaras.length === 0) {
			return { vasanasCreated: 0, vasanasReinforced: 0, durationMs: performance.now() - start };
		}

		// Step 2: Group samskaras by pattern_type + content similarity
		// Use a simple clustering: for each samskara, check if it matches
		// an existing cluster center (bigram Dice > 0.7)
		interface Cluster {
			representative: string; // pattern_content of center
			samskaraIds: string[];
			totalObservations: number;
			maxConfidence: number;
			patternType: string;
			sessionIds: Set<string>;
		}

		const clusters: Cluster[] = [];

		for (const sam of samskaras) {
			let merged = false;
			for (const cluster of clusters) {
				if (
					cluster.patternType === sam.pattern_type &&
					this.textSimilarity(sam.pattern_content, cluster.representative) > 0.7
				) {
					cluster.samskaraIds.push(sam.id);
					cluster.totalObservations += sam.observation_count;
					cluster.maxConfidence = Math.max(cluster.maxConfidence, sam.confidence);
					cluster.sessionIds.add(sam.session_id);
					merged = true;
					break;
				}
			}

			if (!merged) {
				clusters.push({
					representative: sam.pattern_content,
					samskaraIds: [sam.id],
					totalObservations: sam.observation_count,
					maxConfidence: sam.confidence,
					patternType: sam.pattern_type,
					sessionIds: new Set([sam.session_id]),
				});
			}
		}

		// Step 3: For each qualifying cluster, create or reinforce a vasana
		const now = Date.now();

		for (const cluster of clusters) {
			// Stability heuristic: pattern must span at least 2 sessions
			if (cluster.sessionIds.size < 2) continue;

			const tendency = this.slugify(cluster.representative);
			const vasanaId = fnv1a(`${tendency}:${this.config.project}`);

			// Check if this vasana already exists
			const existing = agentDb
				.prepare("SELECT id, strength, activation_count FROM vasanas WHERE name = ? AND (project = ? OR project IS NULL)")
				.get(tendency, this.config.project) as { id: number; strength: number; activation_count: number } | undefined;

			if (existing) {
				// Reinforce: boost strength, update activation
				const newStrength = Math.min(1.0, existing.strength + 0.1);
				agentDb
					.prepare(
						`UPDATE vasanas
						 SET strength = ?, last_activated = ?, activation_count = ?, updated_at = ?,
						     source_samskaras = ?
						 WHERE id = ?`,
					)
					.run(
						newStrength,
						now,
						existing.activation_count + 1,
						now,
						JSON.stringify(cluster.samskaraIds),
						existing.id,
					);
				vasanasReinforced++;
			} else {
				// Determine valence from pattern type
				let valence: "positive" | "negative" | "neutral" = "neutral";
				if (cluster.patternType === "correction") valence = "negative";
				else if (cluster.patternType === "preference" || cluster.patternType === "convention") {
					valence = "positive";
				}

				agentDb
					.prepare(
						`INSERT INTO vasanas (name, description, valence, strength, stability,
						 source_samskaras, project, created_at, updated_at, last_activated, activation_count)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					)
					.run(
						tendency,
						cluster.representative,
						valence,
						Math.min(1.0, cluster.maxConfidence),
						cluster.sessionIds.size / this.config.maxSessionsPerCycle, // Simple stability proxy
						JSON.stringify(cluster.samskaraIds),
						this.config.project,
						now,
						now,
						now,
						1,
					);
				vasanasCreated++;
			}
		}

		return {
			vasanasCreated,
			vasanasReinforced,
			durationMs: performance.now() - start,
		};
	}

	// ── Phase 4: PROCEDURALIZE (Vidhi Extraction) ────────────────────────

	/**
	 * Phase 4: Extract common tool sequences as parameterized procedures (Vidhis).
	 *
	 * Algorithm:
	 *   1. For each session, extract the ordered tool-call sequence.
	 *   2. Compute n-grams of sizes [minSequenceLength, 6].
	 *   3. Find n-grams appearing in >= 3 sessions with success rate > minSuccessRate.
	 *   4. Anti-unify arguments: variable positions become ${param} placeholders,
	 *      fixed positions become constants.
	 *   5. Build VidhiStep[] with argTemplate and parameter schema.
	 *
	 * @returns Newly created Vidhi candidates.
	 */
	async proceduralize(): Promise<ProceduralizeResult> {
		const start = performance.now();
		const agentDb = this.db.get("agent");
		const createdVidhis: Vidhi[] = [];

		// Step 1: Fetch all sessions and their tool sequences
		const sessions = agentDb
			.prepare(
				`SELECT id FROM sessions
				 WHERE project = ?
				 ORDER BY updated_at DESC
				 LIMIT ?`,
			)
			.all(this.config.project, this.config.maxSessionsPerCycle) as Array<{ id: string }>;

		if (sessions.length < 3) {
			return { vidhisCreated: 0, vidhis: [], durationMs: performance.now() - start };
		}

		// Per-session tool sequence: {sessionId, toolNames[], toolCalls[][]}
		interface SessionToolData {
			sessionId: string;
			names: string[];
			calls: SessionToolCall[][];
			successRate: number;
		}

		const sessionToolData: SessionToolData[] = [];

		for (const session of sessions) {
			const turns = agentDb
				.prepare(
					`SELECT tool_calls FROM turns
					 WHERE session_id = ? AND tool_calls IS NOT NULL
					 ORDER BY turn_number ASC`,
				)
				.all(session.id) as Array<{ tool_calls: string }>;

			const names: string[] = [];
			const calls: SessionToolCall[][] = [];
			let totalCalls = 0;
			let errorCalls = 0;

			for (const turn of turns) {
				const parsed = parseToolCalls(turn.tool_calls);
				for (const tc of parsed) {
					names.push(tc.name);
					calls.push([tc]);
					totalCalls++;
					if (tc.isError) errorCalls++;
				}
			}

			if (names.length >= this.config.minSequenceLength) {
				sessionToolData.push({
					sessionId: session.id,
					names,
					calls,
					successRate: totalCalls > 0 ? (totalCalls - errorCalls) / totalCalls : 1.0,
				});
			}
		}

		// Step 2: Extract n-grams across sessions and count session occurrences
		const maxNgramLen = 6;
		// ngramKey -> { sessionIds, perSessionArgs }
		const ngramIndex = new Map<string, {
			sessionIds: Set<string>;
			toolNames: string[];
			argSets: Array<Array<Record<string, unknown>>>; // per position, per occurrence
			successRates: number[];
		}>();

		for (const sd of sessionToolData) {
			const ngrams = extractNgrams(sd.names, this.config.minSequenceLength, maxNgramLen);

			for (const [ngramKey] of ngrams) {
				if (!ngramIndex.has(ngramKey)) {
					ngramIndex.set(ngramKey, {
						sessionIds: new Set(),
						toolNames: ngramKey.split(" -> "),
						argSets: [],
						successRates: [],
					});
				}

				const entry = ngramIndex.get(ngramKey)!;
				entry.sessionIds.add(sd.sessionId);
				entry.successRates.push(sd.successRate);

				// Extract argument values for anti-unification
				const ngramToolNames = ngramKey.split(" -> ");
				const startIdx = this.findSubsequenceStart(sd.names, ngramToolNames);
				if (startIdx >= 0) {
					const args: Array<Record<string, unknown>> = [];
					for (let i = 0; i < ngramToolNames.length; i++) {
						if (startIdx + i >= sd.calls.length) break; // Bounds check
						const callGroup = sd.calls[startIdx + i];
						if (callGroup && callGroup.length > 0) {
							try {
								const parsed = JSON.parse(callGroup[0].input);
								args.push(typeof parsed === "object" && parsed !== null ? parsed : { _raw: callGroup[0].input });
							} catch {
								args.push({ _raw: callGroup[0].input });
							}
						} else {
							args.push({});
						}
					}
					entry.argSets.push(args);
				}
			}
		}

		// Step 3: Filter to qualifying sequences (>= 3 sessions, high success rate)
		const now = Date.now();

		for (const [ngramKey, entry] of ngramIndex) {
			if (entry.sessionIds.size < 3) continue;

			const avgSuccess = entry.successRates.reduce((s, r) => s + r, 0) / entry.successRates.length;
			if (avgSuccess < this.config.minSuccessRate) continue;

			// Step 4: Anti-unify arguments for each step position
			const steps: VidhiStep[] = [];
			const allParams: Record<string, VidhiParam> = {};

			for (let pos = 0; pos < entry.toolNames.length; pos++) {
				// Collect args at this position across all occurrences
				const posArgs: Array<Record<string, unknown>> = [];
				for (const argSet of entry.argSets) {
					if (argSet[pos]) posArgs.push(argSet[pos]);
				}

				const { template, params } = antiUnify(posArgs);

				// Merge params into the global schema and update template references
				for (const [pName, pDef] of Object.entries(params)) {
					const qualifiedName = `step${pos}_${pName}`;
					allParams[qualifiedName] = { ...pDef, name: qualifiedName };
					// Replace all template values referencing the unqualified param
					const oldRef = `\${${pName}}`;
					const newRef = `\${${qualifiedName}}`;
					for (const key of Object.keys(template)) {
						if (template[key] === oldRef) {
							template[key] = newRef;
						}
					}
				}

				steps.push({
					index: pos,
					toolName: entry.toolNames[pos],
					argTemplate: template,
					description: `Invoke ${entry.toolNames[pos]}`,
					critical: pos === 0, // First step is critical by default
				});
			}

			// Step 5: Build the Vidhi
			const vidhiName = this.slugify(ngramKey.replace(/ -> /g, "-then-"));
			const vidhiId = fnv1a(`${vidhiName}:${this.config.project}`);

			// Check if this vidhi already exists
			const existing = agentDb
				.prepare("SELECT id FROM vidhis WHERE id = ?")
				.get(vidhiId) as { id: string } | undefined;

			if (existing) continue; // Don't duplicate

			const vidhi: Vidhi = {
				id: vidhiId,
				project: this.config.project,
				name: vidhiName,
				learnedFrom: [...entry.sessionIds],
				confidence: Math.min(1.0, avgSuccess * (entry.sessionIds.size / sessions.length)),
				steps,
				triggers: this.generateTriggers(entry.toolNames),
				successRate: avgSuccess,
				successCount: Math.round(avgSuccess * entry.sessionIds.size),
				failureCount: Math.round((1 - avgSuccess) * entry.sessionIds.size),
				parameterSchema: allParams,
				createdAt: now,
				updatedAt: now,
			};

			// Persist to database
			agentDb
				.prepare(
					`INSERT OR IGNORE INTO vidhis
					 (id, project, name, learned_from, confidence, steps, triggers,
					  success_rate, success_count, failure_count, parameter_schema,
					  created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
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

			createdVidhis.push(vidhi);
		}

		return {
			vidhisCreated: createdVidhis.length,
			vidhis: createdVidhis,
			durationMs: performance.now() - start,
		};
	}

	// ── Phase 5: COMPRESS (Sushupti) ─────────────────────────────────────

	/**
	 * Phase 5: Compress session content using the accelerated Sinkhorn-Knopp
	 * solver, weighted by epistemological source (Pramana type).
	 *
	 * Direct observations (pratyaksha) resist compression, while speculative
	 * content (vikalpa/anupalabdhi) is compressed aggressively. The mixing
	 * matrix produced by Sinkhorn-Knopp distributes token budgets across
	 * content chunks proportional to their epistemic weight.
	 *
	 * @returns Compression metrics.
	 */
	async compress(): Promise<CompressResult> {
		const start = performance.now();
		const agentDb = this.db.get("agent");

		// Fetch recent turns with their content
		const sessions = agentDb
			.prepare(
				`SELECT id FROM sessions
				 WHERE project = ?
				 ORDER BY updated_at DESC
				 LIMIT ?`,
			)
			.all(this.config.project, this.config.maxSessionsPerCycle) as Array<{ id: string }>;

		if (sessions.length === 0) {
			return { tokensCompressed: 0, compressionRatio: 1.0, durationMs: performance.now() - start };
		}

		const sessionIds = sessions.map((s) => s.id);
		const placeholders = sessionIds.map(() => "?").join(",");

		const turns = agentDb
			.prepare(
				`SELECT id, session_id, content, tool_calls, created_at
				 FROM turns
				 WHERE session_id IN (${placeholders})
				 ORDER BY created_at ASC`,
			)
			.all(...sessionIds) as Array<{
				id: number;
				session_id: string;
				content: string;
				tool_calls: string | null;
				created_at: number;
			}>;

		if (turns.length === 0) {
			return { tokensCompressed: 0, compressionRatio: 1.0, durationMs: performance.now() - start };
		}

		// Build session chunks with Pramana-weighted importance
		const chunks: SessionChunk[] = [];
		const now = Date.now();
		const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

		let totalOriginalTokens = 0;

		for (const turn of turns) {
			const tokens = estimateTokens(turn.content);
			totalOriginalTokens += tokens;

			// Classify pramana type from tool calls
			const calls = parseToolCalls(turn.tool_calls);
			const pramana = this.classifyPramana(turn.content, calls);
			const preservation = PRAMANA_PRESERVATION[pramana];

			// Recency: exponential decay from creation time
			const age = now - turn.created_at;
			const recency = Math.max(0, 1 - age / maxAge);

			chunks.push({
				id: `turn-${turn.id}`,
				recency,
				relevance: preservation, // Use pramana preservation as relevance proxy
				importance: calls.some((tc) => tc.isError) ? 0.9 : preservation,
				tokenCount: tokens,
			});
		}

		if (chunks.length < 2) {
			return {
				tokensCompressed: totalOriginalTokens,
				compressionRatio: 1.0,
				durationMs: performance.now() - start,
			};
		}

		// Build the affinity matrix weighted by Pramana preservation
		const n = chunks.length;
		const affinity: number[][] = [];

		for (let i = 0; i < n; i++) {
			const row: number[] = new Array(n);
			for (let j = 0; j < n; j++) {
				// Pramana-weighted affinity: high-preservation content
				// should cluster together and resist compression
				const preservationAff = (chunks[i].relevance + chunks[j].relevance) / 2;
				const recencyAff = Math.min(chunks[i].recency, chunks[j].recency);
				const importanceAff = Math.max(chunks[i].importance, chunks[j].importance);

				row[j] = 0.40 * preservationAff + 0.35 * recencyAff + 0.25 * importanceAff;

				// Ensure strictly positive
				if (row[j] < 1e-6) row[j] = 1e-6;
			}
			affinity.push(row);
		}

		// Run accelerated Sinkhorn-Knopp
		const { result: dsMatrix, converged } = sinkhornAccelerated(affinity, {
			maxIterations: 150,
			epsilon: 1e-6,
		});

		// Compute compression budgets from the doubly stochastic matrix.
		// High-preservation (pratyaksha) chunks get more budget; speculative
		// (anupalabdhi) chunks get less.
		let budgetTotal = 0;
		const rawBudgets: number[] = new Array(n);

		for (let i = 0; i < n; i++) {
			let rowSum = 0;
			for (let j = 0; j < n; j++) rowSum += dsMatrix[i][j];
			rawBudgets[i] = rowSum * chunks[i].relevance;
			budgetTotal += rawBudgets[i];
		}

		// Normalize: target 70% of original tokens (30% compression)
		const targetTokens = Math.floor(totalOriginalTokens * 0.7);
		let compressedTotal = 0;

		if (budgetTotal > 0) {
			for (let i = 0; i < n; i++) {
				const budget = Math.floor((rawBudgets[i] / budgetTotal) * targetTokens);
				compressedTotal += Math.min(budget, chunks[i].tokenCount);
			}
		} else {
			compressedTotal = targetTokens;
		}

		const compressionRatio = totalOriginalTokens > 0
			? compressedTotal / totalOriginalTokens
			: 1.0;

		return {
			tokensCompressed: totalOriginalTokens,
			compressionRatio,
			durationMs: performance.now() - start,
		};
	}

	// ── Private Helpers ──────────────────────────────────────────────────

	/**
	 * Classify the epistemological source (Pramana) of a turn's content.
	 *
	 * Heuristic classification:
	 *   - pratyaksha: Direct tool execution with results (observed fact)
	 *   - shabda: User-provided documentation or explicit statements
	 *   - anumana: Assistant reasoning without tool evidence
	 *   - upamana: Content containing analogies or comparisons
	 *   - arthapatti: Content with postulations ("must be", "likely")
	 *   - anupalabdhi: Speculative content ("maybe", "possibly", "might")
	 */
	private classifyPramana(content: string, calls: SessionToolCall[]): PramanaType {
		// Direct tool results = pratyaksha (direct perception)
		if (calls.length > 0 && calls.some((tc) => !tc.isError && tc.result.length > 0)) {
			return "pratyaksha";
		}

		const lower = content.toLowerCase();

		// Speculative indicators = anupalabdhi
		if (/\b(?:maybe|possibly|might|perhaps|could be|not sure|unsure)\b/.test(lower)) {
			return "anupalabdhi";
		}

		// Postulation indicators = arthapatti
		if (/\b(?:must be|likely|probably|implies|therefore)\b/.test(lower)) {
			return "arthapatti";
		}

		// Analogy indicators = upamana
		if (/\b(?:similar to|like|analogous|compared to|just as)\b/.test(lower)) {
			return "upamana";
		}

		// Documentation/reference = shabda
		if (/\b(?:according to|documentation|docs say|reference|specification)\b/.test(lower)) {
			return "shabda";
		}

		// Default: inference from reasoning
		return "anumana";
	}

	/**
	 * Bigram-based Dice coefficient for text similarity.
	 *
	 * @param a - First string.
	 * @param b - Second string.
	 * @returns Similarity in [0, 1].
	 */
	private textSimilarity(a: string, b: string): number {
		const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
		const na = normalize(a);
		const nb = normalize(b);

		if (na === nb) return 1.0;
		if (na.length < 2 || nb.length < 2) return 0.0;

		const bigrams = (s: string): Map<string, number> => {
			const map = new Map<string, number>();
			for (let i = 0; i < s.length - 1; i++) {
				const bg = s.substring(i, i + 2);
				map.set(bg, (map.get(bg) ?? 0) + 1);
			}
			return map;
		};

		const bga = bigrams(na);
		const bgb = bigrams(nb);

		let intersection = 0;
		for (const [bg, count] of bga) {
			intersection += Math.min(count, bgb.get(bg) ?? 0);
		}

		return (2 * intersection) / (na.length - 1 + nb.length - 1);
	}

	/**
	 * Convert a descriptive string into a URL-safe slug.
	 *
	 * @param text - The text to slugify.
	 * @returns A lowercase slug using hyphens.
	 */
	private slugify(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "")
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 80); // Cap slug length
	}

	/**
	 * Find the first occurrence of a subsequence within a sequence.
	 *
	 * @returns Starting index, or -1 if not found.
	 */
	private findSubsequenceStart(sequence: string[], sub: string[]): number {
		if (sub.length > sequence.length) return -1;

		outer:
		for (let i = 0; i <= sequence.length - sub.length; i++) {
			for (let j = 0; j < sub.length; j++) {
				if (sequence[i + j] !== sub[j]) continue outer;
			}
			return i;
		}

		return -1;
	}

	/**
	 * Generate NLU trigger phrases from a tool name sequence.
	 *
	 * Produces human-readable phrases that might invoke this procedure:
	 * ["read", "edit"] -> ["read then edit", "read and edit", "modify file"]
	 */
	private generateTriggers(tools: string[]): string[] {
		const triggers: string[] = [];

		// Direct sequence description
		triggers.push(tools.join(" then "));
		triggers.push(tools.join(" and "));

		// Tool-specific trigger generation
		const toolSet = new Set(tools);
		if (toolSet.has("read") && toolSet.has("edit")) {
			triggers.push("modify file");
			triggers.push("update file");
		}
		if (toolSet.has("grep") || toolSet.has("find")) {
			triggers.push("search codebase");
			triggers.push("find in code");
		}
		if (toolSet.has("bash")) {
			triggers.push("run command");
			triggers.push("execute");
		}
		if (toolSet.has("write")) {
			triggers.push("create file");
			triggers.push("write file");
		}

		return triggers;
	}

	/**
	 * Write an entry to the consolidation_log table for audit trail.
	 */
	private logCycle(
		status: ConsolidationLogEntry["status"],
		result?: SvapnaResult,
	): void {
		const agentDb = this.db.get("agent");

		agentDb
			.prepare(
				`INSERT INTO consolidation_log
				 (project, cycle_type, cycle_id, phase, phase_duration_ms,
				  vasanas_created, vidhis_created, samskaras_processed,
				  sessions_processed, status, created_at)
				 VALUES (?, 'svapna', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				this.config.project,
				this.cycleId,
				result ? "ALL" : null,
				result?.totalDurationMs ?? null,
				result?.phases.crystallize.vasanasCreated ?? 0,
				result?.phases.proceduralize.vidhisCreated ?? 0,
				0, // samskaras_processed tracked separately
				result?.phases.replay.turnsScored ?? 0,
				status,
				Date.now(),
			);

		// Also update nidra_state with current phase info
		agentDb
			.prepare(
				`UPDATE nidra_state
				 SET consolidation_phase = ?,
				     consolidation_progress = ?,
				     updated_at = ?
				 WHERE id = 1`,
			)
			.run(
				status === "running" ? "REPLAY" : null,
				status === "success" ? 1.0 : 0.0,
				Date.now(),
			);
	}
}
