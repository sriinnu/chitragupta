/**
 * @chitragupta/tantra — Autonomous MCP Manager types and constants.
 *
 * Type definitions and default configuration values for the
 * autonomous MCP manager, circuit breaker, and quarantine systems.
 * Extracted from mcp-autonomous.ts to keep files under 450 LOC.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Configuration for the autonomous MCP manager. */
export interface AutonomousMcpConfig {
	/** Interval between auto-discovery scans in ms (default: 60000). */
	discoveryIntervalMs?: number;
	/** Directories to watch for MCP server configs. */
	discoveryDirectories?: string[];
	/** Minimum health score before traffic reduction [0, 1] (default: 0.5). */
	healthThreshold?: number;
	/** Max crashes in crashWindowMs before quarantine (default: 3). */
	quarantineMaxCrashes?: number;
	/** Time window for crash counting in ms (default: 300000 = 5 min). */
	quarantineCrashWindowMs?: number;
	/** Duration of quarantine in ms (default: 600000 = 10 min). */
	quarantineDurationMs?: number;
	/** Circuit breaker failure threshold (default: 5). */
	circuitBreakerFailureThreshold?: number;
	/** Circuit breaker failure window in ms (default: 60000). */
	circuitBreakerWindowMs?: number;
	/** Circuit breaker cooldown before half-open in ms (default: 30000). */
	circuitBreakerCooldownMs?: number;
}

/** Callback interface for generating skills from discovered tools. */
export interface SkillGeneratorCallback {
	/** Generate and register skills from the given tool definitions. */
	generateAndRegister(
		tools: Array<{
			name: string;
			description: string;
			inputSchema: Record<string, unknown>;
		}>,
	): void;
}

/** Information about a quarantined server. */
export interface QuarantineInfo {
	/** Server ID. */
	serverId: string;
	/** Reason for quarantine. */
	reason: string;
	/** When the quarantine was imposed. */
	quarantinedAt: number;
	/** When the server may be released. */
	releaseAt: number;
	/** Crash timestamps within the window. */
	crashTimestamps: number[];
	/** Whether an automatic recovery attempt is currently in flight. */
	restartPending?: boolean;
	/** Number of automatic recovery attempts made since quarantining. */
	restartAttempts?: number;
	/** When the most recent automatic recovery attempt started. */
	lastRestartAttemptAt?: number;
}

/** Circuit breaker state for a single server. */
export interface CircuitBreakerState {
	/** Server ID. */
	serverId: string;
	/** Current circuit state. */
	state: "closed" | "open" | "half-open";
	/** Number of failures in the current window. */
	failureCount: number;
	/** Timestamps of recent failures (within window). */
	failureTimestamps: number[];
	/** When the circuit was last opened. */
	openedAt: number | null;
	/** When the circuit will transition to half-open. */
	halfOpenAt: number | null;
	/** Number of successful probes while half-open. */
	probeSuccesses: number;
}

/** Health report for all managed servers. */
export interface McpHealthReport {
	/** Overall system health [0, 1]. */
	overallHealth: number;
	/** Per-server health details. */
	servers: Array<{
		serverId: string;
		health: number;
		circuitState: "closed" | "open" | "half-open";
		quarantined: boolean;
		uptime: number;
		successRate: number;
		averageLatency: number;
	}>;
	/** Total number of quarantined servers. */
	quarantinedCount: number;
	/** Total number of servers with open circuit breakers. */
	openCircuitCount: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const DEFAULT_DISCOVERY_INTERVAL_MS = 60_000;
export const DEFAULT_HEALTH_THRESHOLD = 0.5;
export const DEFAULT_QUARANTINE_MAX_CRASHES = 3;
export const DEFAULT_QUARANTINE_CRASH_WINDOW_MS = 5 * 60 * 1000;
export const DEFAULT_QUARANTINE_DURATION_MS = 10 * 60 * 1000;
export const DEFAULT_CB_FAILURE_THRESHOLD = 5;
export const DEFAULT_CB_WINDOW_MS = 60_000;
export const DEFAULT_CB_COOLDOWN_MS = 30_000;
