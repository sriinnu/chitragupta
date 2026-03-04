/**
 * @chitragupta/smriti — Episodic Developer Memory types.
 *
 * Types for the durable episodic memory system that tags memories with
 * error signatures, tool names, file paths, and auto-recalls them when
 * similar errors recur.
 *
 * @module episodic-types
 */

// ─── Episode ───────────────────────────────────────────────────────────────

/** A stored episodic memory — a developer experience snapshot. */
export interface Episode {
	/** UUID primary key. */
	id: string;
	/** ISO date of when this episode was recorded. */
	createdAt: string;
	/** Project path this episode belongs to. */
	project: string;
	/** Normalized error pattern (e.g., "ERR_MODULE_NOT_FOUND:vitest"). Null if not error-related. */
	errorSignature: string | null;
	/** Tool that was involved (e.g., "bash", "vitest", "tsc"). Null if not tool-related. */
	toolName: string | null;
	/** File being worked on when this episode occurred. Null if not file-specific. */
	filePath: string | null;
	/** What happened — the context and situation. */
	description: string;
	/** The actual fix or resolution. Null if episode is observational only. */
	solution: string | null;
	/** Free-form tags for categorization. */
	tags: string[];
	/** How many times this episode has been recalled by the system. */
	recallCount: number;
	/** ISO timestamp of the last time this episode was recalled. Null if never recalled. */
	lastRecalled: string | null;
}

// ─── Input ─────────────────────────────────────────────────────────────────

/** Input for recording a new episode (id, timestamps, recallCount auto-set). */
export interface EpisodeInput {
	/** Project path scope. */
	project: string;
	/** Normalized error pattern. */
	errorSignature?: string;
	/** Tool name involved. */
	toolName?: string;
	/** File path involved. */
	filePath?: string;
	/** Description of what happened. */
	description: string;
	/** The fix or resolution. */
	solution?: string;
	/** Tags for categorization. */
	tags?: string[];
}

// ─── Query ─────────────────────────────────────────────────────────────────

/** Query parameters for recalling episodes. All fields are optional filters. */
export interface EpisodicQuery {
	/** Match episodes with this error signature. */
	errorSignature?: string;
	/** Match episodes involving this tool. */
	toolName?: string;
	/** Match episodes related to this file path. */
	filePath?: string;
	/** Free-text search across description and solution. */
	text?: string;
	/** Filter to a specific project. */
	project?: string;
	/** Maximum results to return. Default: 10. */
	limit?: number;
}
