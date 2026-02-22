/**
 * @chitragupta/tantra — Autonomous MCP Manager.
 *
 * Self-healing, self-discovering, self-integrating MCP server management.
 * Circuit breaking, quarantining, health scoring, load-balanced routing.
 */

import { McpError } from "./mcp-errors.js";
import type { McpServerRegistry } from "./server-registry.js";
import { ServerDiscovery } from "./server-discovery.js";
import type { McpRemoteServerConfig, ManagedServerInfo, RegistryEvent } from "./registry-types.js";

// Re-export types for public API
export type {
	AutonomousMcpConfig,
	SkillGeneratorCallback,
	QuarantineInfo,
	CircuitBreakerState,
	McpHealthReport,
} from "./mcp-autonomous-types.js";
import type {
	AutonomousMcpConfig,
	SkillGeneratorCallback,
	QuarantineInfo,
	McpHealthReport,
} from "./mcp-autonomous-types.js";
import {
	DEFAULT_DISCOVERY_INTERVAL_MS,
	DEFAULT_HEALTH_THRESHOLD,
	DEFAULT_QUARANTINE_MAX_CRASHES,
	DEFAULT_QUARANTINE_CRASH_WINDOW_MS,
	DEFAULT_QUARANTINE_DURATION_MS,
	DEFAULT_CB_FAILURE_THRESHOLD,
	DEFAULT_CB_WINDOW_MS,
	DEFAULT_CB_COOLDOWN_MS,
} from "./mcp-autonomous-types.js";
import { CircuitBreaker } from "./mcp-circuit-breaker.js";
import {
	type ManagerInternals,
	handleRegistryEvent,
	handleDiscoveryEvent,
	integrateServer,
	updateHealthScore,
	refreshHealthScore,
	pruneExpiredQuarantines,
} from "./mcp-autonomous-internals.js";
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

	// ─── Internal State Access ───────────────────────────────────────

	/** Build the internal state object for delegated operations. */
	private get internals(): ManagerInternals {
		return {
			registry: this.registry,
			circuitBreaker: this.circuitBreaker,
			healthScores: this.healthScores,
			quarantine: this.quarantine,
			crashTimestamps: this.crashTimestamps,
			knownServerIds: this.knownServerIds,
			skillCallback: this.skillCallback,
			config: this.config,
			running: this.running,
		};
	}

	// ─── Private: Delegated to mcp-autonomous-internals.ts ──────────

	private handleRegistryEvent(event: RegistryEvent): void {
		handleRegistryEvent(event, this.internals);
	}

	private async handleDiscoveryEvent(
		event: { type: string; config?: McpRemoteServerConfig },
	): Promise<void> {
		await handleDiscoveryEvent(event, this.internals);
	}

	private async integrateServer(config: McpRemoteServerConfig): Promise<void> {
		await integrateServer(config, this.internals);
	}

	private updateHealthScore(server: ManagedServerInfo): void {
		updateHealthScore(server, this.internals);
	}

	private refreshHealthScore(serverId: string): void {
		refreshHealthScore(serverId, this.internals);
	}

	private pruneExpiredQuarantines(): void {
		pruneExpiredQuarantines(this.internals);
	}
}
