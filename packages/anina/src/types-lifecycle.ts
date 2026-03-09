/**
 * @chitragupta/anina — Nidra (sleep cycle) and Pratyabhijna (self-recognition) types.
 *
 * Extracted from types.ts to keep file sizes under 450 LOC.
 *
 * @module types-lifecycle
 */

// ─── Phase 1: Nidra (Sleep Cycle) Types ────────────────────────────────────

/** The three consciousness states of the Nidra daemon. */
export type NidraState = "LISTENING" | "DREAMING" | "DEEP_SLEEP";

/** The five phases of the Swapna (dream) consolidation cycle. */
export type SwapnaPhase = "REPLAY" | "RECOMBINE" | "CRYSTALLIZE" | "PROCEDURALIZE" | "COMPRESS";

/** Configuration for the Nidra daemon. */
export interface NidraConfig {
	/** Heartbeat interval per state (ms). */
	heartbeatMs: {
		LISTENING: number;
		DREAMING: number;
		DEEP_SLEEP: number;
	};
	/** Idle timeout before transitioning LISTENING → DREAMING (ms). */
	idleTimeoutMs: number;
	/** Dream duration before transitioning DREAMING → DEEP_SLEEP (ms). */
	dreamDurationMs: number;
	/** Deep sleep duration before returning to LISTENING (ms). */
	deepSleepDurationMs: number;
	/** Whether to auto-start the daemon. */
	autoStart: boolean;
	/** Project path for scoping consolidation. */
	project?: string;
	/** Consecutive idle DREAMING cycles before forcing DEEP_SLEEP. Default: 5. */
	consecutiveIdleDreamThreshold: number;
	/** Sessions processed since last DEEP_SLEEP before forcing DEEP_SLEEP. Default: 20. */
	sessionCountThreshold: number;
}

/** Default Nidra configuration. */
export const DEFAULT_NIDRA_CONFIG: NidraConfig = {
	heartbeatMs: {
		LISTENING: 30_000,   // 30s
		DREAMING: 120_000,   // 2min
		DEEP_SLEEP: 300_000, // 5min
	},
	idleTimeoutMs: 300_000,        // 5min idle → start dreaming
	dreamDurationMs: 600_000,      // 10min dreaming → deep sleep
	deepSleepDurationMs: 1_800_000, // 30min deep sleep → wake
	autoStart: false,
	consecutiveIdleDreamThreshold: 5,
	sessionCountThreshold: 20,
};

/** Snapshot of Nidra daemon state. */
export interface NidraSnapshot {
	state: NidraState;
	lastStateChange: number;
	lastHeartbeat: number;
	lastConsolidationStart?: number;
	lastConsolidationEnd?: number;
	consolidationPhase?: SwapnaPhase;
	consolidationProgress: number;
	uptime: number;
	/** Consecutive DREAMING cycles where no new sessions were seen. */
	consecutiveIdleDreamCycles: number;
	/** Sessions processed since the last DEEP_SLEEP entry. */
	sessionsProcessedSinceDeepSleep: number;
	/** Total notifySession() calls since the last DEEP_SLEEP entry. */
	sessionNotificationsSinceDeepSleep: number;
	/** Session IDs pending multi-session consolidation in next DEEP_SLEEP. */
	pendingSessionIds: readonly string[];
}

// ─── Phase 1: Pratyabhijna (Self-Recognition) Types ────────────────────────

/** The identity context reconstructed at session start. */
export interface PratyabhijnaContext {
	/** Session ID this context was built for. */
	sessionId: string;
	/** Project this context pertains to. */
	project: string;
	/** The self-recognition narrative. */
	identitySummary: string;
	/** Top global vasanas loaded. */
	globalVasanas: Array<{ tendency: string; strength: number; valence: string }>;
	/** Top project-specific vasanas. */
	projectVasanas: Array<{ tendency: string; strength: number; valence: string }>;
	/** Active samskaras for this project. */
	activeSamskaras: Array<{ patternType: string; patternContent: string; confidence: number }>;
	/** Cross-project insights. */
	crossProjectInsights: string[];
	/** Tool mastery scores from Atma-Darshana. */
	toolMastery: Record<string, number>;
	/** How long the recognition took (ms). */
	warmupMs: number;
	/** Unix timestamp. */
	createdAt: number;
}

/** Configuration for Pratyabhijna self-recognition. */
export interface PratyabhijnaConfig {
	/** Number of top vasanas to load per scope. */
	topK: number;
	/** Maximum samskaras to include. */
	maxSamskaras: number;
	/** Maximum cross-project sessions to consider. */
	maxCrossProject: number;
	/** Target warmup time (ms) — will truncate if exceeding. */
	warmupBudgetMs: number;
}

/** Default Pratyabhijna config. */
export const DEFAULT_PRATYABHIJNA_CONFIG: PratyabhijnaConfig = {
	topK: 10,
	maxSamskaras: 20,
	maxCrossProject: 5,
	warmupBudgetMs: 30,
};
