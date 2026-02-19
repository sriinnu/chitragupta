/**
 * @chitragupta/smriti — Svapna Consolidation (Dream Cycle)
 *
 * In Yoga Nidra, svapna (स्वप्न) is the dream state where the mind
 * reorganizes experience into lasting knowledge. This module orchestrates
 * the 5-phase consolidation cycle:
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
import type { SessionToolCall, PramanaType, ConsolidationLogEntry } from "./types.js";
import { sinkhornAccelerated } from "./sinkhorn-accelerated.js";
import type { SessionChunk } from "./sinkhorn-accelerated.js";
import { estimateTokens } from "./graphrag-scoring.js";
import { svapnaReplay, svapnaRecombine, parseToolCalls } from "./svapna-extraction.js";
import { svapnaCrystallize } from "./svapna-rules.js";
import { svapnaProceduralize } from "./svapna-vidhi.js";

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
	turnId: number;
	sessionId: string;
	turnNumber: number;
	role: "user" | "assistant";
	content: string;
	toolCalls: SessionToolCall[];
	/** Information-theoretic surprise: -log P(outcome | context). */
	surprise: number;
	/** Retention weight: higher surprise = higher weight. */
	retentionWeight: number;
	createdAt: number;
}

/** Result of the REPLAY phase. */
export interface ReplayResult {
	allTurns: ScoredTurn[];
	highSurpriseTurns: ScoredTurn[];
	turnsScored: number;
	highSurprise: number;
	durationMs: number;
}

/** A cross-session association discovered in the RECOMBINE phase. */
export interface CrossSessionAssociation {
	anchorTurnId: number;
	anchorSessionId: string;
	matchedSessionId: string;
	similarity: number;
	anchorFingerprint: string;
	matchedFingerprint: string;
}

/** Result of the RECOMBINE phase. */
export interface RecombineResult {
	associations: CrossSessionAssociation[];
	crossSessions: number;
	durationMs: number;
}

/** Result of the CRYSTALLIZE phase. */
export interface CrystallizeResult {
	vasanasCreated: number;
	vasanasReinforced: number;
	durationMs: number;
}

/** Result of the PROCEDURALIZE phase. */
export interface ProceduralizeResult {
	vidhisCreated: number;
	vidhis: import("./types.js").Vidhi[];
	durationMs: number;
}

/** Result of the COMPRESS phase. */
export interface CompressResult {
	tokensCompressed: number;
	compressionRatio: number;
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
	pratyaksha: 0.95,
	shabda: 0.80,
	anumana: 0.65,
	upamana: 0.50,
	arthapatti: 0.40,
	anupalabdhi: 0.25,
};

// ─── SvapnaConsolidation ────────────────────────────────────────────────────

/**
 * Svapna Consolidation — the 5-phase dream cycle orchestrator.
 *
 * @example
 * ```ts
 * const svapna = new SvapnaConsolidation({ project: '/home/user/my-project' });
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
	 * @param onProgress - Progress callback (phase, progress).
	 * @returns The consolidated result with metrics for each phase.
	 */
	async run(
		onProgress?: (phase: string, progress: number) => void,
	): Promise<SvapnaResult> {
		const cycleStart = performance.now();
		const report = onProgress ?? (() => {});

		this.logCycle("running");

		report("REPLAY", 0);
		const replayResult = await this.replay();
		report("REPLAY", 1);

		report("RECOMBINE", 0);
		const recombineResult = await this.recombine(replayResult.highSurpriseTurns);
		report("RECOMBINE", 1);

		report("CRYSTALLIZE", 0);
		const crystallizeResult = await this.crystallize();
		report("CRYSTALLIZE", 1);

		report("PROCEDURALIZE", 0);
		const proceduralizeResult = await this.proceduralize();
		report("PROCEDURALIZE", 1);

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

	// ── Phase Delegates ─────────────────────────────────────────────────

	/** Phase 1: Hippocampal replay — score turns by surprise. */
	async replay(): Promise<ReplayResult> {
		return svapnaReplay(this.db, this.config);
	}

	/** Phase 2: Dream association — cross-session fingerprint matching. */
	async recombine(highSurpriseTurns: ScoredTurn[]): Promise<RecombineResult> {
		return svapnaRecombine(this.db, this.config, highSurpriseTurns);
	}

	/** Phase 3: Vasana formation — aggregate samskaras into tendencies. */
	async crystallize(): Promise<CrystallizeResult> {
		return svapnaCrystallize(this.db, this.config);
	}

	/** Phase 4: Vidhi extraction — learn parameterized tool sequences. */
	async proceduralize(): Promise<ProceduralizeResult> {
		return svapnaProceduralize(this.db, this.config);
	}

	// ── Phase 5: COMPRESS (Sushupti) ─────────────────────────────────────

	/**
	 * Phase 5: Compress session content using Sinkhorn-Knopp weighted by
	 * epistemological source (Pramana type). Direct observations resist
	 * compression; speculative content is compressed aggressively.
	 */
	async compress(): Promise<CompressResult> {
		const start = performance.now();
		const agentDb = this.db.get("agent");

		const sessions = agentDb
			.prepare(`SELECT id FROM sessions WHERE project = ? ORDER BY updated_at DESC LIMIT ?`)
			.all(this.config.project, this.config.maxSessionsPerCycle) as Array<{ id: string }>;

		if (sessions.length === 0) {
			return { tokensCompressed: 0, compressionRatio: 1.0, durationMs: performance.now() - start };
		}

		const sessionIds = sessions.map((s) => s.id);
		const placeholders = sessionIds.map(() => "?").join(",");

		const turns = agentDb
			.prepare(
				`SELECT id, session_id, content, tool_calls, created_at
				 FROM turns WHERE session_id IN (${placeholders}) ORDER BY created_at ASC`,
			)
			.all(...sessionIds) as Array<{
				id: number; session_id: string; content: string;
				tool_calls: string | null; created_at: number;
			}>;

		if (turns.length === 0) {
			return { tokensCompressed: 0, compressionRatio: 1.0, durationMs: performance.now() - start };
		}

		// Build session chunks with Pramana-weighted importance
		const chunks: SessionChunk[] = [];
		const now = Date.now();
		const maxAge = 30 * 24 * 60 * 60 * 1000;
		let totalOriginalTokens = 0;

		for (const turn of turns) {
			const tokens = estimateTokens(turn.content);
			totalOriginalTokens += tokens;

			const calls = parseToolCalls(turn.tool_calls);
			const pramana = this.classifyPramana(turn.content, calls);
			const preservation = PRAMANA_PRESERVATION[pramana];
			const age = now - turn.created_at;
			const recency = Math.max(0, 1 - age / maxAge);

			chunks.push({
				id: `turn-${turn.id}`, recency,
				relevance: preservation,
				importance: calls.some((tc) => tc.isError) ? 0.9 : preservation,
				tokenCount: tokens,
			});
		}

		if (chunks.length < 2) {
			return { tokensCompressed: totalOriginalTokens, compressionRatio: 1.0, durationMs: performance.now() - start };
		}

		// Build Pramana-weighted affinity matrix
		const n = chunks.length;
		const affinity: number[][] = [];

		for (let i = 0; i < n; i++) {
			const row: number[] = new Array(n);
			for (let j = 0; j < n; j++) {
				const preservationAff = (chunks[i].relevance + chunks[j].relevance) / 2;
				const recencyAff = Math.min(chunks[i].recency, chunks[j].recency);
				const importanceAff = Math.max(chunks[i].importance, chunks[j].importance);
				row[j] = Math.max(0.40 * preservationAff + 0.35 * recencyAff + 0.25 * importanceAff, 1e-6);
			}
			affinity.push(row);
		}

		const { result: dsMatrix } = sinkhornAccelerated(affinity, { maxIterations: 150, epsilon: 1e-6 });

		// Compute compression budgets from doubly stochastic matrix
		let budgetTotal = 0;
		const rawBudgets: number[] = new Array(n);

		for (let i = 0; i < n; i++) {
			let rowSum = 0;
			for (let j = 0; j < n; j++) rowSum += dsMatrix[i][j];
			rawBudgets[i] = rowSum * chunks[i].relevance;
			budgetTotal += rawBudgets[i];
		}

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

		const compressionRatio = totalOriginalTokens > 0 ? compressedTotal / totalOriginalTokens : 1.0;

		return { tokensCompressed: totalOriginalTokens, compressionRatio, durationMs: performance.now() - start };
	}

	// ── Private Helpers ──────────────────────────────────────────────────

	/** Classify epistemological source (Pramana) of a turn's content. */
	private classifyPramana(content: string, calls: SessionToolCall[]): PramanaType {
		if (calls.length > 0 && calls.some((tc) => !tc.isError && tc.result.length > 0)) {
			return "pratyaksha";
		}

		const lower = content.toLowerCase();

		if (/\b(?:maybe|possibly|might|perhaps|could be|not sure|unsure)\b/.test(lower)) return "anupalabdhi";
		if (/\b(?:must be|likely|probably|implies|therefore)\b/.test(lower)) return "arthapatti";
		if (/\b(?:similar to|like|analogous|compared to|just as)\b/.test(lower)) return "upamana";
		if (/\b(?:according to|documentation|docs say|reference|specification)\b/.test(lower)) return "shabda";

		return "anumana";
	}

	/** Write an entry to the consolidation_log table for audit trail. */
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
				this.config.project, this.cycleId,
				result ? "ALL" : null, result?.totalDurationMs ?? null,
				result?.phases.crystallize.vasanasCreated ?? 0,
				result?.phases.proceduralize.vidhisCreated ?? 0,
				0, result?.phases.replay.turnsScored ?? 0,
				status, Date.now(),
			);

		agentDb
			.prepare(
				`UPDATE nidra_state SET consolidation_phase = ?, consolidation_progress = ?, updated_at = ?
				 WHERE id = 1`,
			)
			.run(
				status === "running" ? "REPLAY" : null,
				status === "success" ? 1.0 : 0.0,
				Date.now(),
			);
	}
}
