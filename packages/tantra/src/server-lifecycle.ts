/**
 * @chitragupta/tantra — Server Lifecycle Manager.
 *
 * Controls the birth, health, death, and rebirth of MCP servers.
 * Enforces a strict state machine, manages health check loops,
 * and handles auto-restart with exponential backoff.
 */

import { McpClient } from "./client.js";
import type { JsonRpcNotification } from "./types.js";
import type {
	McpRemoteServerConfig, ManagedServerInfo, ServerState,
	ServerStats, HealthCheckConfig,
} from "./registry-types.js";
import {
	VALID_TRANSITIONS, DEFAULT_HEALTH_CONFIG, DEFAULT_TIMEOUT,
	DEFAULT_MAX_RESTARTS, MAX_RESTART_BACKOFF,
} from "./registry-types.js";
import {
	McpError, McpNotFoundError, McpTimeoutError,
	McpProtocolError, McpServerCrashedError,
} from "./mcp-errors.js";
import { createLogger } from "@chitragupta/core";

const log = createLogger("tantra:lifecycle");

/** Callback invoked when a managed server changes state. */
export type StateChangeCallback = (
	serverId: string, from: ServerState, to: ServerState, info: ManagedServerInfo,
) => void;

/** Callback invoked when a server's tool list changes. */
export type ToolsChangedCallback = (serverId: string, info: ManagedServerInfo) => void;

/** Create a fresh ServerStats with all counters zeroed. */
function createStats(): ServerStats {
	return {
		startedAt: null, uptime: 0, totalCalls: 0, totalErrors: 0,
		averageLatency: 0, lastCallAt: null, lastHealthCheck: null,
		consecutiveFailures: 0,
	};
}

/** Create a fresh ManagedServerInfo from a config. */
function createManagedInfo(config: McpRemoteServerConfig): ManagedServerInfo {
	return {
		config, state: "idle", client: null, serverInfo: null,
		tools: [], resources: [], prompts: [],
		stats: createStats(), restartCount: 0,
	};
}

/**
 * Validate that a config has the required fields for its transport.
 * @throws {McpProtocolError} If required fields are missing.
 */
function validateConfig(config: McpRemoteServerConfig): void {
	if (!config.id || typeof config.id !== "string")
		throw new McpProtocolError("Server config must have a non-empty 'id'");
	if (!config.name || typeof config.name !== "string")
		throw new McpProtocolError("Server config must have a non-empty 'name'");
	if (config.transport === "stdio" && !config.command)
		throw new McpProtocolError(`Server "${config.id}": stdio transport requires 'command'`);
	if (config.transport === "sse" && !config.url)
		throw new McpProtocolError(`Server "${config.id}": SSE transport requires 'url'`);
	if (config.transport !== "stdio" && config.transport !== "sse")
		throw new McpProtocolError(`Server "${config.id}": unknown transport "${config.transport}"`);
}

/**
 * Manages the lifecycle of remote MCP servers -- start, health check,
 * restart, and stop. Enforces the state machine defined in
 * VALID_TRANSITIONS and provides hooks for state and tool changes.
 */
export class ServerLifecycleManager {
	private _servers: Map<string, ManagedServerInfo> = new Map();
	private _healthIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
	private _restartTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private _stateListeners: StateChangeCallback[] = [];
	private _toolsListeners: ToolsChangedCallback[] = [];
	private _disposed = false;

	/**
	 * Start a server: validate config, connect, discover capabilities,
	 * and begin health monitoring.
	 */
	async start(config: McpRemoteServerConfig): Promise<ManagedServerInfo> {
		this._assertNotDisposed();
		validateConfig(config);

		let info = this._servers.get(config.id);
		if (!info) {
			info = createManagedInfo(config);
			this._servers.set(config.id, info);
		}

		if (info.state === "stopped") this._transition(info, "idle");
		if (info.state !== "idle") {
			throw new McpProtocolError(
				`Server "${config.id}" cannot start from state "${info.state}"`,
			);
		}

		this._transition(info, "starting");
		await this._doStartFromStarting(info);
		return info;
	}

	/**
	 * Stop a managed server: disconnect client, clear health checks,
	 * and transition to "stopped".
	 */
	async stop(serverId: string): Promise<void> {
		this._assertNotDisposed();
		const info = this._requireServer(serverId);
		this._clearRestartTimer(serverId);

		if (info.state === "stopped") return;
		if (info.state === "idle") {
			info.state = "stopped";
			this._emitStateChange(info, "idle", "stopped");
			return;
		}

		await this._doStop(info);
	}

	/** Restart a managed server: stop then start. */
	async restart(serverId: string): Promise<void> {
		this._assertNotDisposed();
		const info = this._requireServer(serverId);

		if (info.state === "error") {
			this._transition(info, "restarting");
			this._transition(info, "starting");
		} else if (info.state === "ready") {
			await this._doStop(info);
			this._transition(info, "idle");
			this._transition(info, "starting");
		} else {
			throw new McpProtocolError(
				`Server "${serverId}" cannot restart from state "${info.state}"`,
			);
		}

		await this._doStartFromStarting(info);
	}

	/** Get the managed info for a server. */
	getInfo(serverId: string): ManagedServerInfo | undefined {
		return this._servers.get(serverId);
	}

	/** Get all managed server infos. */
	getAllInfo(): ManagedServerInfo[] {
		return [...this._servers.values()];
	}

	/** Register a callback for server state changes. */
	onStateChange(callback: StateChangeCallback): void {
		this._stateListeners.push(callback);
	}

	/** Register a callback for server tool list changes. */
	onToolsChanged(callback: ToolsChangedCallback): void {
		this._toolsListeners.push(callback);
	}

	/** Dispose: stop all servers, clear intervals/timers. */
	async dispose(): Promise<void> {
		if (this._disposed) return;
		this._disposed = true;

		for (const [, interval] of this._healthIntervals) clearInterval(interval);
		this._healthIntervals.clear();
		for (const [, timer] of this._restartTimers) clearTimeout(timer);
		this._restartTimers.clear();

		const stops: Promise<void>[] = [];
		for (const [, info] of this._servers) {
			if (info.client && info.state !== "stopped") {
				stops.push(info.client.disconnect().catch((e) => { log.debug("server disconnect failed during shutdown", { serverId: info.config.id, error: String(e) }); }));
			}
			info.state = "stopped";
			info.client = null;
		}

		await Promise.all(stops);
		this._stateListeners = [];
		this._toolsListeners = [];
	}

	// ─── Internal: Start Flow ────────────────────────────────────────────

	/** Execute the start flow from "starting" state onward. */
	private async _doStartFromStarting(info: ManagedServerInfo): Promise<void> {
		const config = info.config;
		const timeout = config.timeout ?? DEFAULT_TIMEOUT;

		try {
			const client = new McpClient({
				transport: config.transport,
				serverCommand: config.command,
				serverArgs: config.args,
				serverUrl: config.url,
				timeout,
			});
			info.client = client;

			// Connect with timeout race
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => reject(new McpTimeoutError(
					`Server "${config.id}" connection timed out after ${timeout}ms`, timeout,
				)), timeout);
			});
			info.serverInfo = await Promise.race([client.connect(), timeoutPromise]);

			// Discover capabilities
			const [tools, resources, prompts] = await Promise.all([
				client.listTools().catch(() => []),
				client.listResources().catch(() => []),
				client.listPrompts().catch(() => []),
			]);

			// Apply tool filter
			if (config.toolFilter && config.toolFilter.length > 0) {
				const filterSet = new Set(config.toolFilter);
				info.tools = tools.filter((t) => filterSet.has(t.name));
			} else {
				info.tools = tools;
			}
			info.resources = resources;
			info.prompts = prompts;

			// Listen for tool list changes
			client.onNotification((n: JsonRpcNotification) => {
				if (n.method === "notifications/tools/list_changed") {
					this._handleToolsChanged(info).catch((e) => { log.debug("tools-changed handler failed", { serverId: info.config.id, error: String(e) }); });
				}
			});

			info.stats.startedAt = Date.now();
			info.stats.consecutiveFailures = 0;
			this._transition(info, "ready");
			this._startHealthCheck(info);
		} catch (err) {
			info.lastError = err instanceof Error ? err : new McpError(String(err));
			if (info.state === "starting") this._transition(info, "error");
			if (config.autoRestart !== false) this._scheduleRestart(info);
			throw err;
		}
	}

	// ─── Internal: Stop Flow ─────────────────────────────────────────────

	/** Execute the stop flow: current -> stopping -> stopped. */
	private async _doStop(info: ManagedServerInfo): Promise<void> {
		this._clearHealthCheck(info.config.id);
		const prev = info.state;

		if (prev === "ready" || prev === "error") {
			this._transition(info, "stopping");
		} else if (prev === "restarting") {
			this._transition(info, "stopped");
			await this._disconnectClient(info);
			return;
		} else if (prev === "starting") {
			this._transition(info, "error");
			this._transition(info, "stopping");
		}

		await this._disconnectClient(info);
		if (info.state === "stopping") this._transition(info, "stopped");
	}

	/** Disconnect and null-out the client reference. */
	private async _disconnectClient(info: ManagedServerInfo): Promise<void> {
		if (info.client) {
			try { await info.client.disconnect(); } catch { /* best-effort */ }
			info.client = null;
		}
	}

	// ─── Internal: Health Check ──────────────────────────────────────────

	/** Start the periodic health check loop for a server. */
	private _startHealthCheck(info: ManagedServerInfo): void {
		const hc = this._getHealthConfig(info.config);
		const sid = info.config.id;
		this._clearHealthCheck(sid);

		const interval = setInterval(async () => {
			if (info.state !== "ready" || !info.client) {
				this._clearHealthCheck(sid);
				return;
			}
			try {
				const check = info.client.listTools();
				const tout = new Promise<never>((_, rej) => {
					setTimeout(() => rej(new McpTimeoutError(
						`Health check timed out for "${sid}"`, hc.timeout,
					)), hc.timeout);
				});
				await Promise.race([check, tout]);
				info.stats.consecutiveFailures = 0;
				info.stats.lastHealthCheck = Date.now();
			} catch (err) {
				info.stats.consecutiveFailures++;
				info.stats.lastHealthCheck = Date.now();
				if (info.stats.consecutiveFailures >= hc.maxFailures && info.state === "ready") {
					info.lastError = err instanceof Error ? err : new McpError(String(err));
					this._transition(info, "error");
					this._clearHealthCheck(sid);
					if (info.config.autoRestart !== false) this._scheduleRestart(info);
				}
			}
		}, hc.interval);

		this._healthIntervals.set(sid, interval);
	}

	/** Clear the health check interval for a server. */
	private _clearHealthCheck(serverId: string): void {
		const i = this._healthIntervals.get(serverId);
		if (i) { clearInterval(i); this._healthIntervals.delete(serverId); }
	}

	// ─── Internal: Auto-Restart ──────────────────────────────────────────

	/**
	 * Schedule auto-restart with exponential backoff.
	 * delay = min(restartDelay * 2^restartCount, 60000)
	 */
	private _scheduleRestart(info: ManagedServerInfo): void {
		const maxRestarts = info.config.maxRestarts ?? DEFAULT_MAX_RESTARTS;
		const sid = info.config.id;

		if (info.restartCount >= maxRestarts) {
			info.lastError = new McpServerCrashedError(
				`Server "${sid}" exceeded max restarts (${maxRestarts})`, sid,
			);
			if (info.state === "error") this._transition(info, "stopped");
			return;
		}

		const hc = this._getHealthConfig(info.config);
		const delay = Math.min(hc.restartDelay * Math.pow(2, info.restartCount), MAX_RESTART_BACKOFF);
		this._clearRestartTimer(sid);

		const timer = setTimeout(async () => {
			this._restartTimers.delete(sid);
			if (this._disposed) return;
			try {
				info.restartCount++;
				if (info.state === "error") this._transition(info, "restarting");
				await this._disconnectClient(info);
				if (info.state === "restarting") this._transition(info, "starting");
				await this._doStartFromStarting(info);
			} catch {
				// _doStartFromStarting handles error transition and schedules next restart
			}
		}, delay);

		this._restartTimers.set(sid, timer);
	}

	/** Clear a pending restart timer. */
	private _clearRestartTimer(serverId: string): void {
		const t = this._restartTimers.get(serverId);
		if (t) { clearTimeout(t); this._restartTimers.delete(serverId); }
	}

	// ─── Internal: Tool Change Handling ──────────────────────────────────

	/** Refresh tool list from server on tools/list_changed notification. */
	private async _handleToolsChanged(info: ManagedServerInfo): Promise<void> {
		if (info.state !== "ready" || !info.client) return;
		try {
			const tools = await info.client.listTools();
			const { toolFilter } = info.config;
			if (toolFilter && toolFilter.length > 0) {
				const set = new Set(toolFilter);
				info.tools = tools.filter((t) => set.has(t.name));
			} else {
				info.tools = tools;
			}
			for (const l of this._toolsListeners) {
				try { l(info.config.id, info); } catch { /* listener safety */ }
			}
		} catch { /* best-effort refresh */ }
	}

	// ─── Internal: State Machine ─────────────────────────────────────────

	/**
	 * Transition to a new state. Throws on invalid transitions.
	 * @throws {McpProtocolError} If the transition violates the state machine.
	 */
	private _transition(info: ManagedServerInfo, to: ServerState): void {
		const from = info.state;
		if (!VALID_TRANSITIONS[from].includes(to)) {
			throw new McpProtocolError(
				`Invalid state transition for "${info.config.id}": ${from} -> ${to}`,
			);
		}
		info.state = to;
		if (to === "ready" && info.stats.startedAt) info.stats.uptime = 0;
		this._emitStateChange(info, from, to);
	}

	/** Emit state change to all listeners. */
	private _emitStateChange(info: ManagedServerInfo, from: ServerState, to: ServerState): void {
		for (const l of this._stateListeners) {
			try { l(info.config.id, from, to, info); } catch { /* listener safety */ }
		}
	}

	/** Get health config for a server, falling back to defaults. */
	private _getHealthConfig(config: McpRemoteServerConfig): HealthCheckConfig {
		return {
			interval: config.health?.interval ?? DEFAULT_HEALTH_CONFIG.interval,
			timeout: config.health?.timeout ?? DEFAULT_HEALTH_CONFIG.timeout,
			maxFailures: config.health?.maxFailures ?? DEFAULT_HEALTH_CONFIG.maxFailures,
			restartDelay: config.health?.restartDelay ?? DEFAULT_HEALTH_CONFIG.restartDelay,
		};
	}

	/** Require a server to be managed, throwing if not found. */
	private _requireServer(serverId: string): ManagedServerInfo {
		const info = this._servers.get(serverId);
		if (!info) throw new McpNotFoundError(`Server "${serverId}" is not managed`);
		return info;
	}

	/** Assert that the manager has not been disposed. */
	private _assertNotDisposed(): void {
		if (this._disposed) throw new McpError("ServerLifecycleManager has been disposed");
	}
}
