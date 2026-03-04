/**
 * @chitragupta/smriti — Swapna Consolidation (Dream Cycle)
 *
 * In Yoga Nidra, swapna is the dream state where the mind
 * reorganizes experience into lasting knowledge. This module orchestrates
 * the 5-phase consolidation cycle:
 *
 *   1. REPLAY       — Hippocampal replay: re-traverse recent turns, score surprise
 *   2. RECOMBINE    — Dream association: cross-session structural similarity
 *   3. CRYSTALLIZE  — Vasana formation: aggregate samskaras into stable tendencies
 *   4. PROCEDURALIZE — Vidhi extraction: learn parameterized tool sequences
 *   5. COMPRESS     — Sushupti: Sinkhorn-Knopp weighted by epistemological source
 *
 * Types, defaults, and constants are in `swapna-types.ts`.
 * Performance target: full cycle < 20 seconds for 50 sessions.
 */

import { DatabaseManager } from "./db/index.js";
import type { SessionToolCall, PramanaType, ConsolidationLogEntry } from "./types.js";
import { sinkhornAccelerated } from "./sinkhorn-accelerated.js";
import type { SessionChunk } from "./sinkhorn-accelerated.js";
import { estimateTokens } from "./graphrag-scoring.js";
import { swapnaReplay, swapnaRecombine, parseToolCalls } from "./swapna-extraction.js";
import { swapnaCrystallize } from "./swapna-rules.js";
import { swapnaProceduralize } from "./swapna-vidhi.js";
import { swapnaExtractSamskaras } from "./swapna-samskara.js";
import { DEFAULT_CONFIG, PRAMANA_PRESERVATION } from "./swapna-types.js";
import type {
	SwapnaConfig,
	ScoredTurn,
	ReplayResult,
	RecombineResult,
	CrystallizeResult,
	ProceduralizeResult,
	CompressResult,
	SwapnaResult,
} from "./swapna-types.js";

// Re-export for backward compatibility
export type {
	SwapnaConfig,
	ScoredTurn,
	ReplayResult,
	CrossSessionAssociation,
	RecombineResult,
	CrystallizeResult,
	ProceduralizeResult,
	CompressResult,
	SwapnaResult,
} from "./swapna-types.js";

// ─── SwapnaConsolidation ────────────────────────────────────────────────────

/**
 * Swapna Consolidation — the 5-phase dream cycle orchestrator.
 *
 * @example
 * ```ts
 * const swapna = new SwapnaConsolidation({ project: '/home/user/my-project' });
 * const result = await swapna.run((phase, progress) => {
 *   console.log(`${phase}: ${(progress * 100).toFixed(0)}%`);
 * });
 * ```
 */
export class SwapnaConsolidation {
	private config: SwapnaConfig;
	private db: DatabaseManager;
	private cycleId: string;
	private lastSamskarasProcessed = 0;

	/**
	 * Create a new Swapna consolidation cycle.
	 *
	 * @param config - Partial configuration; unset fields use defaults.
	 * @param db - Optional DatabaseManager instance (uses singleton if omitted).
	 */
	constructor(config: Partial<SwapnaConfig> & { project: string }, db?: DatabaseManager) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.db = db ?? DatabaseManager.instance();
		this.cycleId = `swapna-${new Date().toISOString()}`;
	}

	// ── Full Cycle ───────────────────────────────────────────────────────

	/**
	 * Run the complete 5-phase consolidation cycle.
	 *
	 * @param onProgress - Progress callback (phase, progress).
	 * @returns The consolidated result with metrics for each phase.
	 */
	async run(onProgress?: (phase: string, progress: number) => void): Promise<SwapnaResult> {
		const cycleStart = performance.now();
		const report = onProgress ?? (() => {});
		this.lastSamskarasProcessed = 0;

		this.logCycle("running");

		try {
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

			const result: SwapnaResult = {
				phases: {
					replay: { turnsScored: replayResult.turnsScored, highSurprise: replayResult.highSurprise, durationMs: replayResult.durationMs },
					recombine: { associations: recombineResult.associations.length, crossSessions: recombineResult.crossSessions, durationMs: recombineResult.durationMs },
					crystallize: { vasanasCreated: crystallizeResult.vasanasCreated, vasanasReinforced: crystallizeResult.vasanasReinforced, durationMs: crystallizeResult.durationMs },
					proceduralize: { vidhisCreated: proceduralizeResult.vidhisCreated, durationMs: proceduralizeResult.durationMs },
					compress: { tokensCompressed: compressResult.tokensCompressed, compressionRatio: compressResult.compressionRatio, durationMs: compressResult.durationMs },
				},
				totalDurationMs,
				cycleId: this.cycleId,
			};

			this.logCycle("success", result);
			return result;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.logCycle("failed");
			throw new Error(`Swapna cycle ${this.cycleId} failed: ${msg}`, { cause: err });
		}
	}

	// ── Phase Delegates ─────────────────────────────────────────────────

	/** Phase 1: Hippocampal replay — score turns by surprise. */
	async replay(): Promise<ReplayResult> {
		return swapnaReplay(this.db, this.config);
	}

	/** Phase 2: Dream association — cross-session fingerprint matching. */
	async recombine(highSurpriseTurns: ScoredTurn[]): Promise<RecombineResult> {
		return swapnaRecombine(this.db, this.config, highSurpriseTurns);
	}

	/** Phase 3: Vasana formation — aggregate samskaras into tendencies. */
	async crystallize(): Promise<CrystallizeResult> {
		const extraction = await swapnaExtractSamskaras(this.db, this.config);
		this.lastSamskarasProcessed = extraction.samskarasProcessed;
		return swapnaCrystallize(this.db, this.config);
	}

	/** Phase 4: Vidhi extraction — learn parameterized tool sequences. */
	async proceduralize(): Promise<ProceduralizeResult> {
		return swapnaProceduralize(this.db, this.config);
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
			// Skip system context and noise — these produce garbage rules
			if (this.isNoiseTurn(turn.content)) continue;

			const tokens = estimateTokens(turn.content);
			totalOriginalTokens += tokens;
			const calls = parseToolCalls(turn.tool_calls);
			const pramana = this.classifyPramana(turn.content, calls);
			const preservation = PRAMANA_PRESERVATION[pramana];
			const age = now - turn.created_at;
			const recency = Math.max(0, 1 - age / maxAge);

			chunks.push({
				id: `turn-${turn.id}`, recency, relevance: preservation,
				importance: calls.some((tc) => tc.isError) ? 0.9 : preservation,
				tokenCount: tokens,
			});
		}

		if (chunks.length < 2) {
			return { tokensCompressed: totalOriginalTokens, compressionRatio: 1.0, durationMs: performance.now() - start };
		}

		// Build Pramana-weighted affinity matrix and compress
		const { compressedTotal } = this.applyCompression(chunks, turns, totalOriginalTokens);
		const compressionRatio = totalOriginalTokens > 0 ? compressedTotal / totalOriginalTokens : 1.0;
		return { tokensCompressed: totalOriginalTokens, compressionRatio, durationMs: performance.now() - start };
	}

	// ─── Private Helpers ──────────────────────────────────────────────────

	/** Build affinity matrix, run Sinkhorn, compute budgets, and write compressed content. */
	private applyCompression(
		chunks: SessionChunk[],
		turns: Array<{ id: number; session_id: string; content: string; tool_calls: string | null; created_at: number }>,
		totalOriginalTokens: number,
	): { compressedTotal: number } {
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

		const agentDb = this.db.get("agent");
		const updateStmt = agentDb.prepare(`UPDATE turns SET content = ? WHERE id = ?`);
		const insertRuleStmt = agentDb.prepare(
			`INSERT INTO consolidation_rules
			 (project, category, rule_text, source_sessions, confidence, created_at, updated_at)
			 VALUES (?, 'abstraction', ?, ?, ?, ?, ?)`,
		);

		const compressBatch = agentDb.transaction(() => {
			for (let i = 0; i < n; i++) {
				const budget = budgetTotal > 0 ? Math.floor((rawBudgets[i] / budgetTotal) * targetTokens) : Math.floor(targetTokens / n);
				const turnTokens = chunks[i].tokenCount;
				const allocated = Math.min(budget, turnTokens);
				compressedTotal += allocated;

				if (turnTokens > 20 && allocated < turnTokens * 0.6) {
					const turn = turns[i];
					const gist = this.generateGist(turn.content, allocated);
					const cueAnchors = this.extractCueAnchors(turn.content);

					updateStmt.run(gist, turn.id);
					insertRuleStmt.run(this.config.project, gist, JSON.stringify([turn.session_id]), chunks[i].relevance, Date.now(), Date.now());

					if (cueAnchors.length > 0) {
						try {
							const graphDb = this.db.get("graph");
							const upsertNode = graphDb.prepare(
								`INSERT OR REPLACE INTO nodes (id, type, label, content, metadata) VALUES (?, 'concept', ?, ?, ?)`,
							);
							for (const cue of cueAnchors) {
								upsertNode.run(`cue-${turn.id}-${cue.slice(0, 20)}`, cue, gist.slice(0, 200), JSON.stringify({ source: `turn:${turn.id}`, cycle: this.cycleId }));
							}
						} catch {
							// GraphRAG cue anchors are best-effort
						}
					}
				}
			}
		});

		try { compressBatch(); } catch { /* Compression write-back is best-effort */ }
		return { compressedTotal };
	}

	/** Generate a compressed gist (abstraction) of turn content. */
	private generateGist(content: string, tokenBudget: number): string {
		const sentences = content.split(/(?<=[.!?\n])\s+/).filter((s) => s.trim().length > 0);
		if (sentences.length <= 2) return content;

		const kept: string[] = [sentences[0]];
		const signalPattern = /\b(error|decided|created|modified|fixed|found|returned|result|output)\b/i;
		for (let i = 1; i < sentences.length - 1; i++) {
			if (signalPattern.test(sentences[i])) kept.push(sentences[i]);
		}
		kept.push(sentences[sentences.length - 1]);

		let gist = kept.join(" ");
		const words = gist.split(/\s+/);
		const wordBudget = Math.max(5, Math.floor(tokenBudget * 0.75));
		if (words.length > wordBudget) gist = words.slice(0, wordBudget).join(" ") + "...";

		return `[compressed] ${gist}`;
	}

	/** Extract cue anchors (trigger phrases) from turn content. */
	private extractCueAnchors(content: string): string[] {
		const anchors: string[] = [];
		const lower = content.toLowerCase();

		const voPattern = /\b(create|fix|refactor|implement|add|remove|update|debug|test|deploy|configure)\s+(\w+(?:\s+\w+)?)\b/gi;
		let match: RegExpExecArray | null;
		while ((match = voPattern.exec(lower)) !== null) anchors.push(match[0].trim());

		const pathPattern = /[\w\-]+\.(?:ts|js|py|rs|go|java|tsx|jsx|json|yaml|toml)\b/gi;
		while ((match = pathPattern.exec(content)) !== null) anchors.push(match[0]);

		return [...new Set(anchors)].slice(0, 5);
	}

	/**
	 * Detect noise turns that should be excluded from consolidation.
	 * System context, compressed prompts, and meta-turns produce garbage rules.
	 */
	private isNoiseTurn(content: string): boolean {
		if (content.startsWith("[system:context]")) return true;
		if (content.startsWith("[compressed] [system:context]")) return true;
		if (/^\[tool:chitragupta_record_conversation\] recorded \d+/.test(content)) return true;
		return false;
	}

	/** Classify epistemological source (Pramana) of a turn's content. */
	private classifyPramana(content: string, calls: SessionToolCall[]): PramanaType {
		if (calls.length > 0 && calls.some((tc) => !tc.isError && tc.result.length > 0)) return "pratyaksha";

		const lower = content.toLowerCase();
		if (/\b(?:maybe|possibly|might|perhaps|could be|not sure|unsure)\b/.test(lower)) return "anupalabdhi";
		if (/\b(?:must be|likely|probably|implies|therefore)\b/.test(lower)) return "arthapatti";
		if (/\b(?:similar to|like|analogous|compared to|just as)\b/.test(lower)) return "upamana";
		if (/\b(?:according to|documentation|docs say|reference|specification)\b/.test(lower)) return "shabda";

		return "anumana";
	}

	/** Write an entry to the consolidation_log table for audit trail. */
	private logCycle(status: ConsolidationLogEntry["status"], result?: SwapnaResult): void {
		const agentDb = this.db.get("agent");

		agentDb
			.prepare(
				`INSERT INTO consolidation_log
				 (project, cycle_type, cycle_id, phase, phase_duration_ms,
				  vasanas_created, vidhis_created, samskaras_processed,
				  sessions_processed, status, created_at)
				 VALUES (?, 'swapna', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				this.config.project, this.cycleId,
				result ? "ALL" : null, result?.totalDurationMs ?? null,
				result?.phases.crystallize.vasanasCreated ?? 0,
				result?.phases.proceduralize.vidhisCreated ?? 0,
				this.lastSamskarasProcessed, result?.phases.replay.turnsScored ?? 0,
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
