/**
 * Types, interfaces, and default configuration for the DaemonManager.
 * Extracted from daemon-manager.ts for maintainability.
 *
 * @module daemon-manager-types
 */

import type { ChitraguptaDaemonConfig, DaemonState } from "./chitragupta-daemon.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Health status of the daemon. */
export type DaemonHealth = "healthy" | "degraded" | "crashed" | "stopped";

/** Configuration for the DaemonManager. */
export interface DaemonManagerConfig {
	/** ChitraguptaDaemon configuration. */
	daemon?: Partial<ChitraguptaDaemonConfig>;
	/** Max errors in the window before marking as degraded. Default: 5. */
	errorBudget: number;
	/** Error window duration in ms. Default: 60_000 (1 minute). */
	errorWindowMs: number;
	/** Initial restart delay in ms. Default: 1_000 (1 second). */
	initialRestartDelayMs: number;
	/** Maximum restart delay in ms (cap for exponential backoff). Default: 60_000. */
	maxRestartDelayMs: number;
	/** Max consecutive restart attempts before giving up. Default: 10. */
	maxRestartAttempts: number;
	/** Skill discovery scan interval in ms. Default: 300_000 (5 minutes). */
	skillScanIntervalMs: number;
	/** Whether to enable skill auto-discovery. Default: true. */
	enableSkillSync: boolean;
	/** Directories to scan for skills. Default: []. */
	skillScanPaths: string[];
	/** Whether to auto-approve safe (low-risk, no errors) skills. Default: true. */
	autoApproveSafe: boolean;
}

/** Snapshot of the DaemonManager state. */
export interface DaemonManagerState {
	/** Current health status. */
	health: DaemonHealth;
	/** Underlying daemon state (null if not running). */
	daemon: DaemonState | null;
	/** Total restart count since creation. */
	restartCount: number;
	/** Errors in the current window. */
	errorsInWindow: number;
	/** Time of the last health change. */
	lastHealthChange: string;
	/** Next scheduled skill scan (ISO). */
	nextSkillScan: string | null;
	/** Skills pending approval count. */
	pendingApprovalCount: number;
}

/** Health change event. */
export interface HealthEvent {
	readonly from: DaemonHealth;
	readonly to: DaemonHealth;
	readonly reason: string;
	readonly timestamp: string;
	readonly restartCount: number;
}

/** Skill sync event. */
export interface SkillSyncEvent {
	readonly type: "scan-start" | "scan-complete" | "skill-discovered" | "skill-auto-approved" | "scan-error";
	readonly detail: string;
	readonly timestamp: string;
}

/** Minimal interface for Samiti — avoids hard dependency on @chitragupta/sutra. */
export interface SamitiBroadcaster {
	broadcast(
		channel: string,
		message: {
			sender: string;
			severity: "info" | "warning" | "critical";
			category: string;
			content: string;
			data?: unknown;
		},
	): unknown;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default configuration values for DaemonManager. */
export const DEFAULT_MANAGER_CONFIG: DaemonManagerConfig = {
	errorBudget: 5,
	errorWindowMs: 60_000,
	initialRestartDelayMs: 1_000,
	maxRestartDelayMs: 60_000,
	maxRestartAttempts: 10,
	skillScanIntervalMs: 300_000,
	enableSkillSync: true,
	skillScanPaths: [],
	autoApproveSafe: true,
};
