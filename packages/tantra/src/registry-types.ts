/**
 * @chitragupta/tantra — Types for the pluggable MCP server registry.
 *
 * Defines the state machine, configuration, statistics, and event
 * types that govern how remote MCP servers are managed, monitored,
 * and aggregated within Chitragupta.
 */

import type { McpTool, McpResource, McpPrompt } from "./types.js";
import type { McpClient } from "./client.js";
import type { ServerInfo } from "./types.js";

// ─── Server State Machine ──────────────────────────────────────────────────

/**
 * Lifecycle states for a managed MCP server.
 *
 * Modeled after the stages of a yajna (fire ritual):
 * - idle: the altar is prepared
 * - starting: the fire is being kindled
 * - ready: the flames are steady, offerings accepted
 * - error: the fire falters
 * - restarting: rekindling from embers
 * - stopping: the ritual concludes
 * - stopped: the fire is extinguished
 */
export type ServerState =
	| "idle"
	| "starting"
	| "ready"
	| "error"
	| "restarting"
	| "stopping"
	| "stopped";

/**
 * Valid state transitions — enforced by the lifecycle manager.
 * Any transition not listed here is illegal and will throw.
 */
export const VALID_TRANSITIONS: Record<ServerState, ServerState[]> = {
	idle: ["starting"],
	starting: ["ready", "error"],
	ready: ["stopping", "error"],
	error: ["restarting", "stopping", "stopped"],
	restarting: ["starting", "stopped"],
	stopping: ["stopped"],
	stopped: ["idle"],
};

// ─── Server Configuration ──────────────────────────────────────────────────

/**
 * Configuration for a remote MCP server that the registry manages.
 */
export interface McpRemoteServerConfig {
	/** Unique server identifier. */
	id: string;
	/** Human-readable display name. */
	name: string;
	/** Transport type for communication. */
	transport: "stdio" | "sse";
	/** Command to spawn (stdio transport). */
	command?: string;
	/** Command arguments (stdio transport). */
	args?: string[];
	/** Environment variables for the spawned process. */
	env?: Record<string, string>;
	/** Server URL (SSE transport). */
	url?: string;
	/** Connection timeout in milliseconds (default 30000). */
	timeout?: number;
	/** Health check configuration. */
	health?: HealthCheckConfig;
	/** Whether to auto-restart on crash or health failure. */
	autoRestart?: boolean;
	/** Maximum number of restart attempts before giving up (default 5). */
	maxRestarts?: number;
	/** Metadata tags for filtering and discovery. */
	tags?: string[];
	/** Only import tools whose names match this list. Empty means all. */
	toolFilter?: string[];
}

/**
 * Health check configuration for a managed MCP server.
 */
export interface HealthCheckConfig {
	/** Interval between health checks in ms (default 30000). */
	interval: number;
	/** Timeout for each individual health check in ms (default 5000). */
	timeout: number;
	/** Consecutive failures before marking server unhealthy (default 3). */
	maxFailures: number;
	/** Base delay before first restart attempt in ms (default 1000). */
	restartDelay: number;
}

// ─── Managed Server Info ───────────────────────────────────────────────────

/**
 * Runtime information for a server under the registry's management.
 * Combines configuration, live state, client reference, discovered
 * capabilities, and operational statistics.
 */
export interface ManagedServerInfo {
	/** The server's configuration. */
	config: McpRemoteServerConfig;
	/** Current lifecycle state. */
	state: ServerState;
	/** The MCP client connected to this server, or null if not connected. */
	client: McpClient | null;
	/** Server info returned during the initialize handshake. */
	serverInfo: ServerInfo | null;
	/** Tools discovered from this server. */
	tools: McpTool[];
	/** Resources discovered from this server. */
	resources: McpResource[];
	/** Prompts discovered from this server. */
	prompts: McpPrompt[];
	/** Operational statistics. */
	stats: ServerStats;
	/** The most recent error, if any. */
	lastError?: Error;
	/** Number of times this server has been restarted. */
	restartCount: number;
}

/**
 * Operational statistics for a managed MCP server.
 */
export interface ServerStats {
	/** Timestamp when the server was started, or null if never started. */
	startedAt: number | null;
	/** Current uptime in milliseconds. */
	uptime: number;
	/** Total number of tool calls routed to this server. */
	totalCalls: number;
	/** Total number of errors from tool calls. */
	totalErrors: number;
	/** Average latency of tool calls in milliseconds. */
	averageLatency: number;
	/** Timestamp of the last tool call, or null if no calls made. */
	lastCallAt: number | null;
	/** Timestamp of the last health check, or null. */
	lastHealthCheck: number | null;
	/** Current count of consecutive health check failures. */
	consecutiveFailures: number;
}

// ─── Registry Events ───────────────────────────────────────────────────────

/**
 * Discriminated union of events emitted by the MCP server registry.
 * Consumers subscribe via a callback pattern.
 */
export type RegistryEvent =
	| { type: "server:added"; serverId: string }
	| { type: "server:removed"; serverId: string }
	| { type: "server:state-changed"; serverId: string; from: ServerState; to: ServerState }
	| { type: "server:tools-changed"; serverId: string; tools: McpTool[] }
	| { type: "server:error"; serverId: string; error: Error }
	| { type: "server:health-ok"; serverId: string }
	| { type: "server:health-fail"; serverId: string; failures: number }
	| { type: "registry:tools-updated"; totalTools: number };

/**
 * Callback type for registry event listeners.
 */
export type RegistryEventListener = (event: RegistryEvent) => void;

// ─── Default Constants ─────────────────────────────────────────────────────

/** Default health check configuration values. */
export const DEFAULT_HEALTH_CONFIG: HealthCheckConfig = {
	interval: 30_000,
	timeout: 5_000,
	maxFailures: 3,
	restartDelay: 1_000,
};

/** Default connection timeout in milliseconds. */
export const DEFAULT_TIMEOUT = 30_000;

/** Default maximum restart attempts. */
export const DEFAULT_MAX_RESTARTS = 5;

/** Maximum backoff delay for restarts (60 seconds). */
export const MAX_RESTART_BACKOFF = 60_000;
