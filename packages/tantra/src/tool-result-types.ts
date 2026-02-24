/**
 * Typed result interfaces for every MCP tool response.
 *
 * These types define the shape of `_metadata.typed` payloads
 * attached to tool results. Available to in-process hooks
 * (session recording, analytics) but stripped before MCP wire.
 *
 * Existing types (VasanaTendencyResult, HealthStatusResult, MeshStatusResult)
 * remain in `types.ts` — this file adds coverage for the remaining tools.
 *
 * @module tool-result-types
 */

// ─── Session Tools ───────────────────────────────────────────────────────────

/** Typed response for `chitragupta_session_list`. */
export interface SessionListResult {
	sessions: Array<{
		id: string;
		title: string;
		agent: string;
		model: string;
		created: string;
		turnCount?: number;
	}>;
}

/** Typed response for `chitragupta_session_show`. */
export interface SessionShowResult {
	meta: {
		id: string;
		title: string;
		agent: string;
		model: string;
		created: string;
		turnCount: number;
	};
	turns: Array<{
		turnNumber: number;
		role: string;
		contentPreview: string;
		toolCalls?: string[];
	}>;
}

// ─── Memory Tools ────────────────────────────────────────────────────────────

/** Typed response for `chitragupta_memory_search`. */
export interface MemorySearchResult {
	query: string;
	results: Array<{
		text: string;
		score: number;
		source: string;
	}>;
}

/** Typed response for `chitragupta_recall`. */
export interface RecallResult {
	query: string;
	results: Array<{
		score: number;
		answer: string;
		source: string;
		sessionId?: string;
	}>;
}

/** Typed response for `chitragupta_context`. */
export interface ContextResult {
	project: string;
	itemCount: number;
}

// ─── Handover Tools ──────────────────────────────────────────────────────────

/** Typed response for `chitragupta_handover`. */
export interface HandoverResult {
	sessionId: string;
	cursor: number;
	filesModified: string[];
	filesRead: string[];
	decisions: string[];
	errors: string[];
	commands: string[];
}

/** Typed response for `chitragupta_handover_since` (incremental). */
export interface HandoverSinceResult {
	sessionId: string;
	previousCursor: number;
	newCursor: number;
	turnsAdded: number;
	filesModified: string[];
	filesRead: string[];
	decisions: string[];
	errors: string[];
}

/** Typed response for `chitragupta_memory_changes_since`. */
export interface MemoryChangesSinceResult {
	since: string;
	newSessions: Array<{ id: string; title: string }>;
	updatedSessions: Array<{ id: string }>;
	newTurns: number;
}

// ─── Day File Tools ──────────────────────────────────────────────────────────

/** Typed response for `chitragupta_day_show`. */
export interface DayShowResult {
	date: string;
	hasContent: boolean;
}

/** Typed response for `chitragupta_day_list`. */
export interface DayListResult {
	dates: string[];
	count: number;
}

/** Typed response for `chitragupta_day_search`. */
export interface DaySearchResult {
	query: string;
	matchCount: number;
}

// ─── Sync Tools ──────────────────────────────────────────────────────────────

/** Typed response for `chitragupta_sync_status`. */
export interface SyncStatusResult {
	home: string;
	daysCount: number;
	memoryCount: number;
	lastExportAt: string | null;
	lastImportAt: string | null;
}

// ─── Introspection Tools ─────────────────────────────────────────────────────

/** Typed response for `atman_report`. */
export interface AtmanReportResult {
	hasChetana: boolean;
	hasTriguna: boolean;
	hasSoul: boolean;
}

// ─── Consolidation Tools ─────────────────────────────────────────────────────

/** Typed response for `chitragupta_consolidate`. */
export interface ConsolidateResult {
	sessionsAnalyzed: number;
	newRules: number;
	reinforced: number;
}

/** Typed response for `chitragupta_vidhis`. */
export interface VidhisResult {
	count: number;
	query?: string;
}
