/**
 * @chitragupta/smriti — Swapna Consolidation types.
 *
 * Extracted from swapna-consolidation.ts to stay within 450 LOC limit.
 * Contains all type definitions, default configuration, and constants
 * for the 5-phase dream consolidation cycle.
 *
 * @packageDocumentation
 */

import type { SessionToolCall, PramanaType } from "./types.js";
import type { PackedSummaryResult } from "./pakt-compression.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Configuration for the Swapna consolidation cycle. */
export interface SwapnaConfig {
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
	/** Optional explicit session scope. When set, Swapna uses exactly these sessions. */
	sessionIds?: string[];
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
	summaryText?: string;
	packedSummaryText?: string;
	compression?: PackedSummaryResult;
}

/** Full result of a Swapna consolidation cycle. */
export interface SwapnaResult {
	phases: {
		replay: { turnsScored: number; highSurprise: number; durationMs: number };
		recombine: { associations: number; crossSessions: number; durationMs: number };
		crystallize: { vasanasCreated: number; vasanasReinforced: number; durationMs: number };
		proceduralize: { vidhisCreated: number; durationMs: number };
		compress: { tokensCompressed: number; compressionRatio: number; durationMs: number };
	};
	totalDurationMs: number;
	cycleId: string;
	sourceSessionIds: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default configuration values. */
export const DEFAULT_CONFIG: SwapnaConfig = {
	maxSessionsPerCycle: 50,
	surpriseThreshold: 0.7,
	minPatternFrequency: 3,
	minSequenceLength: 2,
	minSuccessRate: 0.8,
	project: "",
	sessionIds: undefined,
};

/** Pramana compression weights — higher = resists compression more. */
export const PRAMANA_PRESERVATION: Record<PramanaType, number> = {
	pratyaksha: 0.95,
	shabda: 0.80,
	anumana: 0.65,
	upamana: 0.50,
	arthapatti: 0.40,
	anupalabdhi: 0.25,
};
