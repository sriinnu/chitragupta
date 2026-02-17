/**
 * @chitragupta/tantra — Autonomous MCP Manager.
 *
 * Self-healing, self-discovering, self-integrating MCP server management.
 *
 * Key features:
 * - Health scoring per server with soft circuit breakers
 * - Circuit breaker pattern (closed / open / half-open)
 * - Auto-discovery loop scanning for new MCP configs
 * - Quarantine for persistently failing servers
 * - Load balancing across servers providing the same tools
 * - Skill generation callback for newly discovered tools
 */

import { McpError } from "./mcp-errors.js";
import type { McpServerRegistry } from "./server-registry.js";
import { ServerDiscovery } from "./server-discovery.js";
import type {
	McpRemoteServerConfig,
	ManagedServerInfo,
	RegistryEvent,
} from "./registry-types.js";

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

const DEFAULT_DISCOVERY_INTERVAL_MS = 60_000;
const DEFAULT_HEALTH_THRESHOLD = 0.5;
const DEFAULT_QUARANTINE_MAX_CRASHES = 3;
const DEFAULT_QUARANTINE_CRASH_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_QUARANTINE_DURATION_MS = 10 * 60 * 1000;
const DEFAULT_CB_FAILURE_THRESHOLD = 5;
const DEFAULT_CB_WINDOW_MS = 60_000;
const DEFAULT_CB_COOLDOWN_MS = 30_000;

// ─── Circuit Breaker ────────────────────────────────────────────────────────

/**
 * Per-server circuit breaker implementation with time-windowed failure
 * tracking and three-state transitions.
 *
 * State transitions:
 * ```
 * Closed -> Open:     when failureCount > threshold within window
 * Open -> Half-Open:  after cooldown period
 * Half-Open -> Closed: on successful probe
 * Half-Open -> Open:   on failed probe
 * ```
 */
class CircuitBreaker {
	private readonly states = new Map<string, CircuitBreakerState>();
	private readonly failureThreshold: number;
	private readonly windowMs: number;
	private readonly cooldownMs: number;

	constructor(
		failureThreshold: number,
		windowMs: number,
		cooldownMs: number,
	) {
		this.failureThreshold = failureThreshold;
		this.windowMs = windowMs;
		this.cooldownMs = cooldownMs;
	}

	/**
	 * Get the current state of a server's circuit breaker.
	 * Creates a default "closed" state if none exists.
	 * Handles time-based transitions (open -> half-open).
	 */
	getState(serverId: string): CircuitBreakerState {
		let state = this.states.get(serverId);
		if (!state) {
			state = {
				serverId,
				state: "closed",
				failureCount: 0,
				failureTimestamps: [],
				openedAt: null,
				halfOpenAt: null,
				probeSuccesses: 0,
			};
			this.states.set(serverId, state);
		}

		// Time-based transition: open -> half-open
		if (
			state.state === "open" &&
			state.halfOpenAt !== null &&
			Date.now() >= state.halfOpenAt
		) {
			state.state = "half-open";
			state.probeSuccesses = 0;
		}

		return state;
	}

	/**
	 * Record a failure for a server. May trip the circuit open.
	 */
	recordFailure(serverId: string): void {
		const state = this.getState(serverId);
		const now = Date.now();

		if (state.state === "half-open") {
			// Failed probe — go back to open
			state.state = "open";
			state.openedAt = now;
			state.halfOpenAt = now + this.cooldownMs;
			return;
		}

		if (state.state === "open") return; // Already open

		// Closed state: add failure and prune old ones
		state.failureTimestamps.push(now);
		state.failureTimestamps = state.failureTimestamps.filter(
			(t) => now - t <= this.windowMs,
		);
		state.failureCount = state.failureTimestamps.length;

		if (state.failureCount >= this.failureThreshold) {
			state.state = "open";
			state.openedAt = now;
			state.halfOpenAt = now + this.cooldownMs;
		}
	}

	/**
	 * Record a success for a server. May close the circuit from half-open.
	 */
	recordSuccess(serverId: string): void {
		const state = this.getState(serverId);

		if (state.state === "half-open") {
			// Successful probe — close the circuit
			state.state = "closed";
			state.failureCount = 0;
			state.failureTimestamps = [];
			state.openedAt = null;
			state.halfOpenAt = null;
			state.probeSuccesses = 0;
			return;
		}

		if (state.state === "closed") {
			// Prune old failures in closed state
			const now = Date.now();
			state.failureTimestamps = state.failureTimestamps.filter(
				(t) => now - t <= this.windowMs,
			);
			state.failureCount = state.failureTimestamps.length;
		}
	}

	/**
	 * Check if a call is allowed through the circuit breaker.
	 * - Closed: allowed
	 * - Open: blocked
	 * - Half-Open: allowed (one probe)
	 */
	allowCall(serverId: string): boolean {
		const state = this.getState(serverId);
		return state.state !== "open";
	}

	/** Remove state for a server. */
	remove(serverId: string): void {
		this.states.delete(serverId);
	}

	/** Get all circuit breaker states. */
	getAllStates(): CircuitBreakerState[] {
		// Refresh time-based transitions
		for (const serverId of this.states.keys()) {
			this.getState(serverId);
		}
		return [...this.states.values()];
	}
}

// ─── Autonomous MCP Manager ────────────────────────────────────────────────

/**
 * Autonomous MCP manager that self-heals, auto-discovers, and integrates
 * new MCP servers. Provides circuit breaking, quarantining, health scoring,
 * and load-balanced routing.
 *
 * @example
 * ```ts
 * const registry = createMcpServerRegistry();
 * const manager = new AutonomousMcpManager(registry);
 *
 * manager.setSkillGenerator({
 *   generateAndRegister(tools) { // register skills },
 * });
 *
 * manager.start({
 *   discoveryDirectories: [".chitragupta/mcp"],
 *   discoveryIntervalMs: 30_000,
 * });
 *
 * const report = manager.getHealthReport();
 * manager.stop();
 * ```
 */
export class AutonomousMcpManager {
	private readonly registry: McpServerRegistry;
	private readonly discovery: ServerDiscovery;
	private readonly circuitBreaker: CircuitBreaker;
	private readonly healthScores: Map<string, number>;
	private readonly quarantine: Map<string, QuarantineInfo>;
	private readonly crashTimestamps: Map<string, number[]>;
	private readonly knownServerIds: Set<string>;

	private skillCallback?: SkillGeneratorCallback;
	private discoveryInterval?: ReturnType<typeof setInterval>;
	private directoryCleanups: Array<() => void> = [];
	private registryCleanup?: () => void;
	private config: Required<AutonomousMcpConfig>;
	private running = false;

	constructor(registry: McpServerRegistry) {
		this.registry = registry;
		this.discovery = new ServerDiscovery();
		this.healthScores = new Map();
		this.quarantine = new Map();
		this.crashTimestamps = new Map();
		this.knownServerIds = new Set();

		// Default config; overridden by start()
		this.config = {
			discoveryIntervalMs: DEFAULT_DISCOVERY_INTERVAL_MS,
			discoveryDirectories: [],
			healthThreshold: DEFAULT_HEALTH_THRESHOLD,
			quarantineMaxCrashes: DEFAULT_QUARANTINE_MAX_CRASHES,
			quarantineCrashWindowMs: DEFAULT_QUARANTINE_CRASH_WINDOW_MS,
			quarantineDurationMs: DEFAULT_QUARANTINE_DURATION_MS,
			circuitBreakerFailureThreshold: DEFAULT_CB_FAILURE_THRESHOLD,
			circuitBreakerWindowMs: DEFAULT_CB_WINDOW_MS,
			circuitBreakerCooldownMs: DEFAULT_CB_COOLDOWN_MS,
		};

		this.circuitBreaker = new CircuitBreaker(
			this.config.circuitBreakerFailureThreshold,
			this.config.circuitBreakerWindowMs,
			this.config.circuitBreakerCooldownMs,
		);
	}

	/**
	 * Set the skill generator callback. When new MCP servers connect,
	 * their tools will be passed to this callback for skill registration.
	 */
	setSkillGenerator(callback: SkillGeneratorCallback): void {
		this.skillCallback = callback;
	}

	/**
	 * Start the autonomous management loop: registry event monitoring,
	 * periodic discovery, and directory watching.
	 */
	start(config?: AutonomousMcpConfig): void {
		if (this.running) return;
		this.running = true;

		this.config = {
			discoveryIntervalMs: config?.discoveryIntervalMs ?? DEFAULT_DISCOVERY_INTERVAL_MS,
			discoveryDirectories: config?.discoveryDirectories ?? [],
			healthThreshold: config?.healthThreshold ?? DEFAULT_HEALTH_THRESHOLD,
			quarantineMaxCrashes: config?.quarantineMaxCrashes ?? DEFAULT_QUARANTINE_MAX_CRASHES,
			quarantineCrashWindowMs: config?.quarantineCrashWindowMs ?? DEFAULT_QUARANTINE_CRASH_WINDOW_MS,
			quarantineDurationMs: config?.quarantineDurationMs ?? DEFAULT_QUARANTINE_DURATION_MS,
			circuitBreakerFailureThreshold: config?.circuitBreakerFailureThreshold ?? DEFAULT_CB_FAILURE_THRESHOLD,
			circuitBreakerWindowMs: config?.circuitBreakerWindowMs ?? DEFAULT_CB_WINDOW_MS,
			circuitBreakerCooldownMs: config?.circuitBreakerCooldownMs ?? DEFAULT_CB_COOLDOWN_MS,
		};

		// Subscribe to registry events for health tracking
		this.registryCleanup = this.registry.onEvent((event) => {
			this.handleRegistryEvent(event);
		});

		// Initialize health for existing servers
		for (const server of this.registry.listServers()) {
			this.knownServerIds.add(server.config.id);
			this.updateHealthScore(server);
		}

		// Clear any pre-existing discovery interval (defense-in-depth)
		if (this.discoveryInterval) {
			clearInterval(this.discoveryInterval);
			this.discoveryInterval = undefined;
		}

		// Start periodic discovery
		this.discoveryInterval = setInterval(() => {
			this.rediscover().catch(() => {
				// Best-effort discovery; failures are non-fatal
			});
		}, this.config.discoveryIntervalMs);

		// Watch configured directories
		for (const dir of this.config.discoveryDirectories) {
			const cleanup = this.discovery.watchDirectory(dir, (event) => {
				this.handleDiscoveryEvent(event).catch(() => {
					// Best-effort event handling
				});
			});
			this.directoryCleanups.push(cleanup);
		}
	}

	/**
	 * Stop the autonomous management loop. Clears all intervals,
	 * stops directory watching, and unsubscribes from registry events.
	 */
	stop(): void {
		this.running = false;

		if (this.discoveryInterval) {
			clearInterval(this.discoveryInterval);
			this.discoveryInterval = undefined;
		}

		for (const cleanup of this.directoryCleanups) {
			cleanup();
		}
		this.directoryCleanups = [];

		if (this.registryCleanup) {
			this.registryCleanup();
			this.registryCleanup = undefined;
		}

		this.discovery.stopWatching();
	}

	// ─── Health & Reporting ─────────────────────────────────────────────

	/**
	 * Get a comprehensive health report for all managed servers.
	 */
	getHealthReport(): McpHealthReport {
		this.pruneExpiredQuarantines();
		const servers = this.registry.listServers();

		let totalHealth = 0;
		let openCircuits = 0;
		const serverReports: McpHealthReport["servers"] = [];

		for (const server of servers) {
			const health = this.healthScores.get(server.config.id) ?? 1.0;
			const cbState = this.circuitBreaker.getState(server.config.id);
			const quarantined = this.quarantine.has(server.config.id);

			if (cbState.state === "open") openCircuits++;

			const successRate = server.stats.totalCalls > 0
				? 1 - (server.stats.totalErrors / server.stats.totalCalls)
				: 1.0;

			serverReports.push({
				serverId: server.config.id,
				health,
				circuitState: cbState.state,
				quarantined,
				uptime: server.stats.uptime,
				successRate,
				averageLatency: server.stats.averageLatency,
			});

			totalHealth += health;
		}

		const overallHealth = servers.length > 0
			? totalHealth / servers.length
			: 1.0;

		return {
			overallHealth,
			servers: serverReports,
			quarantinedCount: this.quarantine.size,
			openCircuitCount: openCircuits,
		};
	}

	// ─── Discovery ──────────────────────────────────────────────────────

	/**
	 * Force a re-discovery of all MCP servers from configured directories.
	 * New servers are automatically started, connected, and skill-generated.
	 */
	async rediscover(): Promise<void> {
		if (!this.running) return;

		const discovered = await this.discovery.discoverAll({
			directories: this.config.discoveryDirectories,
		});

		for (const config of discovered) {
			if (this.knownServerIds.has(config.id)) continue;
			if (this.quarantine.has(config.id)) continue;

			await this.integrateServer(config);
		}
	}

	// ─── Quarantine Management ──────────────────────────────────────────

	/**
	 * Get all currently quarantined servers.
	 */
	getQuarantined(): QuarantineInfo[] {
		this.pruneExpiredQuarantines();
		return [...this.quarantine.values()];
	}

	/**
	 * Manually release a server from quarantine and attempt to restart it.
	 */
	releaseFromQuarantine(serverId: string): void {
		this.quarantine.delete(serverId);
		this.crashTimestamps.delete(serverId);

		// Attempt to restart the server
		this.registry.startServer(serverId).catch(() => {
			// If restart fails, it will go through normal error handling
		});
	}

	// ─── Circuit Breaker Access ─────────────────────────────────────────

	/**
	 * Record a successful tool call for a server.
	 * Updates circuit breaker and health score.
	 */
	recordCallSuccess(serverId: string): void {
		this.circuitBreaker.recordSuccess(serverId);
		this.refreshHealthScore(serverId);
	}

	/**
	 * Record a failed tool call for a server.
	 * Updates circuit breaker and health score.
	 */
	recordCallFailure(serverId: string): void {
		this.circuitBreaker.recordFailure(serverId);
		this.refreshHealthScore(serverId);
	}

	/**
	 * Check if a call to a server is allowed (circuit breaker check).
	 */
	isCallAllowed(serverId: string): boolean {
		return this.circuitBreaker.allowCall(serverId);
	}

	/**
	 * Get all circuit breaker states.
	 */
	getCircuitBreakerStates(): CircuitBreakerState[] {
		return this.circuitBreaker.getAllStates();
	}

	// ─── Load Balancing ─────────────────────────────────────────────────

	/**
	 * Select the best server for a tool call when multiple servers
	 * provide the same tool. Uses health-score-based selection with
	 * round-robin for similarly-scored servers.
	 *
	 * @param serverIds - Array of server IDs that can handle the call.
	 * @returns The best server ID, or null if none are available.
	 */
	selectServer(serverIds: string[]): string | null {
		if (serverIds.length === 0) return null;

		this.pruneExpiredQuarantines();

		// Filter out quarantined and open-circuit servers
		const eligible = serverIds.filter((id) => {
			if (this.quarantine.has(id)) return false;
			const cbState = this.circuitBreaker.getState(id);
			return cbState.state !== "open";
		});

		if (eligible.length === 0) return null;
		if (eligible.length === 1) return eligible[0];

		// Sort by health score (descending)
		const scored = eligible.map((id) => ({
			id,
			health: this.healthScores.get(id) ?? 1.0,
			isHalfOpen: this.circuitBreaker.getState(id).state === "half-open",
		}));
		scored.sort((a, b) => b.health - a.health);

		// If a server is in half-open, route one probe there
		const halfOpenServer = scored.find((s) => s.isHalfOpen);
		if (halfOpenServer) return halfOpenServer.id;

		// If top servers have similar scores (within 0.1), use round-robin
		const topScore = scored[0].health;
		const similar = scored.filter(
			(s) => topScore - s.health <= 0.1,
		);

		if (similar.length > 1) {
			// Simple round-robin using timestamp modulo
			const idx = Date.now() % similar.length;
			return similar[idx].id;
		}

		return scored[0].id;
	}

	// ─── Internal: Event Handling ───────────────────────────────────────

	/**
	 * Handle registry events for health tracking and crash detection.
	 */
	private handleRegistryEvent(event: RegistryEvent): void {
		switch (event.type) {
			case "server:state-changed": {
				const server = this.registry.getServer(event.serverId);
				if (server) this.updateHealthScore(server);

				// Track crashes (transition to error state)
				if (event.to === "error") {
					this.recordCrash(event.serverId);
				}

				// Generate skills when a server becomes ready
				if (event.to === "ready" && server && this.skillCallback) {
					this.generateSkills(server);
				}
				break;
			}
			case "server:error": {
				this.circuitBreaker.recordFailure(event.serverId);
				this.refreshHealthScore(event.serverId);
				break;
			}
			case "server:health-ok": {
				this.circuitBreaker.recordSuccess(event.serverId);
				this.refreshHealthScore(event.serverId);
				break;
			}
			case "server:health-fail": {
				this.circuitBreaker.recordFailure(event.serverId);
				this.refreshHealthScore(event.serverId);
				break;
			}
			case "server:added": {
				this.knownServerIds.add(event.serverId);
				break;
			}
			case "server:removed": {
				this.knownServerIds.delete(event.serverId);
				this.healthScores.delete(event.serverId);
				this.circuitBreaker.remove(event.serverId);
				this.crashTimestamps.delete(event.serverId);
				break;
			}
		}
	}

	/**
	 * Handle discovery events (file watch changes).
	 */
	private async handleDiscoveryEvent(
		event: { type: string; config?: McpRemoteServerConfig },
	): Promise<void> {
		if (!event.config) return;

		if (event.type === "removed") {
			// Graceful shutdown
			if (this.knownServerIds.has(event.config.id)) {
				await this.registry.removeServer(event.config.id);
			}
		} else {
			// Added or changed — (re)integrate
			if (!this.knownServerIds.has(event.config.id)) {
				await this.integrateServer(event.config);
			}
		}
	}

	// ─── Internal: Server Integration ───────────────────────────────────

	/**
	 * Integrate a newly discovered server: add to registry, start it,
	 * and generate skills from its tools.
	 */
	private async integrateServer(config: McpRemoteServerConfig): Promise<void> {
		try {
			const info = await this.registry.addServer(config, true);
			this.knownServerIds.add(config.id);
			this.updateHealthScore(info);

			if (this.skillCallback && info.tools.length > 0) {
				this.generateSkills(info);
			}
		} catch {
			// Server failed to start; normal lifecycle handling will manage retries
		}
	}

	/**
	 * Generate skills from a server's tools via the callback.
	 */
	private generateSkills(server: ManagedServerInfo): void {
		if (!this.skillCallback || server.tools.length === 0) return;

		const toolDefs = server.tools.map((t) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema,
		}));

		try {
			this.skillCallback.generateAndRegister(toolDefs);
		} catch {
			// Skill generation failures should not break server management
		}
	}

	// ─── Internal: Health Scoring ───────────────────────────────────────

	/**
	 * Compute and store health score for a server.
	 *
	 * ```
	 * health = uptimeScore * 0.4 + successRate * 0.3 + latencyScore * 0.3
	 * ```
	 *
	 * - uptimeScore: hours of uptime, capped at 24h -> [0, 1]
	 * - successRate: 1 - (errors / totalCalls), or 1.0 if no calls
	 * - latencyScore: inverse normalized latency (lower is better)
	 */
	private updateHealthScore(server: ManagedServerInfo): void {
		const stats = server.stats;

		// Uptime score: hours running, max 24h = 1.0
		const uptimeHours = stats.uptime / (1000 * 60 * 60);
		const uptimeScore = Math.min(1, uptimeHours / 24);

		// Success rate
		const successRate = stats.totalCalls > 0
			? 1 - (stats.totalErrors / stats.totalCalls)
			: 1.0;

		// Latency score: inverse sigmoid — low latency = high score
		// 100ms -> ~0.95, 1s -> ~0.73, 5s -> ~0.27
		const latencyScore = stats.averageLatency > 0
			? 1 / (1 + stats.averageLatency / 1000)
			: 1.0;

		const health =
			uptimeScore * 0.4 +
			successRate * 0.3 +
			latencyScore * 0.3;

		this.healthScores.set(server.config.id, Math.max(0, Math.min(1, health)));
	}

	/**
	 * Refresh health score from registry data.
	 */
	private refreshHealthScore(serverId: string): void {
		const server = this.registry.getServer(serverId);
		if (server) this.updateHealthScore(server);
	}

	// ─── Internal: Crash & Quarantine ───────────────────────────────────

	/**
	 * Record a server crash. If too many crashes occur within the window,
	 * quarantine the server.
	 */
	private recordCrash(serverId: string): void {
		const now = Date.now();
		const timestamps = this.crashTimestamps.get(serverId) ?? [];
		timestamps.push(now);

		// Prune timestamps outside the window
		const cutoff = now - this.config.quarantineCrashWindowMs;
		const recent = timestamps.filter((t) => t >= cutoff);
		this.crashTimestamps.set(serverId, recent);

		if (recent.length >= this.config.quarantineMaxCrashes) {
			this.quarantineServer(
				serverId,
				`${recent.length} crashes in ${this.config.quarantineCrashWindowMs / 1000}s window`,
				recent,
			);
		}
	}

	/**
	 * Place a server in quarantine: stop it and prevent re-use until
	 * the quarantine period expires.
	 */
	private quarantineServer(
		serverId: string,
		reason: string,
		crashTimestamps: number[],
	): void {
		const now = Date.now();
		this.quarantine.set(serverId, {
			serverId,
			reason,
			quarantinedAt: now,
			releaseAt: now + this.config.quarantineDurationMs,
			crashTimestamps,
		});

		// Stop the server
		this.registry.stopServer(serverId).catch(() => {
			// Best-effort stop
		});
	}

	/**
	 * Remove quarantines that have expired.
	 */
	private pruneExpiredQuarantines(): void {
		const now = Date.now();
		for (const [serverId, info] of this.quarantine) {
			if (info.releaseAt <= now) {
				this.quarantine.delete(serverId);
				this.crashTimestamps.delete(serverId);
			}
		}
	}
}
