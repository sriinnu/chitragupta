/**
 * Takumi Bridge — Protocol Types.
 *
 * Defines the structured communication protocol between Chitragupta (brain)
 * and Takumi (coding agent). Communication happens via NDJSON over stdio
 * when spawning Takumi as a child process.
 *
 * @module
 */

// ─── Spawn Configuration ───────────────────────────────────────────────────

/** Options for spawning and communicating with Takumi. */
export interface TakumiBridgeOptions {
	/** Binary name or path to the Takumi CLI (default: "takumi"). */
	command?: string;
	/** Extra CLI arguments to pass. */
	args?: string[];
	/** Working directory for the child process. */
	cwd: string;
	/** Timeout in milliseconds for the entire task (default: 120_000). */
	timeout?: number;
	/** Project root path (may differ from cwd for monorepos). */
	projectPath?: string;
}

// ─── Context Injection ─────────────────────────────────────────────────────

/** Memory/context payload injected from Chitragupta into Takumi. */
export interface TakumiContext {
	/** Tree-sitter repo map summary (from netra). */
	repoMap?: string;
	/** Episodic memory hints — past error patterns, solutions. */
	episodicHints?: string[];
	/** Recent architectural decisions from Akasha. */
	recentDecisions?: string[];
	/** Relevant file contents keyed by path. */
	fileContext?: Record<string, string>;
}

// ─── Request / Response ────────────────────────────────────────────────────

/** Structured request sent to Takumi over NDJSON. */
export interface TakumiRequest {
	/** Discriminator — always "task" for now. */
	type: "task";
	/** The coding task description. */
	task: string;
	/** Optional context to inject before execution. */
	context?: TakumiContext;
}

/** Structured result returned by Takumi over NDJSON. */
export interface TakumiResponse {
	/** Discriminator — always "result". */
	type: "result";
	/** Files modified during the task. */
	filesModified: string[];
	/** Test results, if tests were run. */
	testsRun?: { passed: number; failed: number; total: number };
	/** Git diff summary of changes. */
	diffSummary?: string;
	/** Human-readable output / summary. */
	output: string;
	/** Process exit code (0 = success). */
	exitCode: number;
}

/** Streaming event emitted by Takumi during execution. */
export interface TakumiEvent {
	/** Event type discriminator. */
	type: "progress" | "tool_call" | "error";
	/** Event payload — human-readable string. */
	data: string;
}

// ─── Bridge Status ─────────────────────────────────────────────────────────

/** Detection result for Takumi availability and mode. */
export interface TakumiBridgeStatus {
	/** Communication mode: rpc (NDJSON), cli (text), or unavailable. */
	mode: "rpc" | "cli" | "unavailable";
	/** The resolved command used for detection. */
	command: string;
	/** Takumi version string, if detected. */
	version?: string;
}
