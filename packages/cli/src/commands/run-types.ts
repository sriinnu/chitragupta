/**
 * @chitragupta/cli -- Types for the `chitragupta run` command.
 *
 * Defines configuration, options, and result interfaces for the
 * standalone CLI task runner that makes chitragupta usable as an
 * independent agentic system without Vaayu.
 */

import type { SessionMeta } from "@chitragupta/smriti/types";

// ─── Run Options ─────────────────────────────────────────────────────────────

/** CLI-level options parsed from `chitragupta run` arguments. */
export interface RunOptions {
	/** The task description to execute. */
	task: string;
	/** Session ID to resume from a previous checkpoint. */
	resumeId?: string;
	/** Show a plan without executing anything. */
	dryRun: boolean;
	/** Override the default model. */
	model?: string;
	/** Override the project path (default: cwd). */
	project?: string;
	/** Override the AI provider. */
	provider?: string;
	/** Maximum number of agent loop iterations. Default: 20. */
	maxTurns?: number;
}

// ─── Run Configuration ───────────────────────────────────────────────────────

/** Resolved configuration for a run invocation after merging defaults. */
export interface RunConfig {
	/** The task description. */
	task: string;
	/** Absolute path to the project directory. */
	projectPath: string;
	/** Resolved model ID. */
	model: string;
	/** Resolved provider ID. */
	provider: string;
	/** Whether this is a dry-run (plan only). */
	dryRun: boolean;
	/** Session ID to resume, or undefined for a fresh run. */
	resumeId?: string;
	/** Max agent loop iterations. */
	maxTurns: number;
}

// ─── Run Result ──────────────────────────────────────────────────────────────

/** Result of a completed `chitragupta run` execution. */
export interface RunResult {
	/** Whether the run completed successfully. */
	success: boolean;
	/** The session that was created or resumed. */
	session: SessionMeta;
	/** Number of agent turns executed. */
	turnsExecuted: number;
	/** Wall-clock duration in milliseconds. */
	durationMs: number;
	/** Total cost incurred (USD). */
	totalCost: number;
	/** Final output message from the agent. */
	output: string;
	/** Error message if the run failed. */
	error?: string;
}
