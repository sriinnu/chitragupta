/**
 * @chitragupta/tantra — MCP Server Registry.
 *
 * The central registry that ties the lifecycle manager and capability
 * aggregator together. Provides CRUD operations for managing remote
 * MCP servers, event emission for state changes, and persistence
 * for server configurations across sessions.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { ServerLifecycleManager } from "./server-lifecycle.js";
import {
	CapabilityAggregator,
	type NamespacedTool,
	type NamespacedResource,
	type ToolCallRoute,
	type ToolSearchResult,
} from "./capability-aggregator.js";
import type {
	McpRemoteServerConfig,
	ManagedServerInfo,
	ServerState,
	RegistryEvent,
	RegistryEventListener,
} from "./registry-types.js";
import { McpNotFoundError } from "./mcp-errors.js";
import { createLogger } from "@chitragupta/core";

const log = createLogger("tantra:registry");

// ─── Filter ────────────────────────────────────────────────────────────────

/**
 * Filter criteria for listing managed servers.
 */
export interface ServerFilter {
	/** Only include servers in one of these states. */
	states?: ServerState[];
	/** Only include servers that have at least one of these tags. */
	tags?: string[];
}

// ─── Registry Interface ────────────────────────────────────────────────────

/**
 * The public interface for the MCP server registry. Manages the full
 * lifecycle of remote MCP servers, aggregates their capabilities,
 * and persists configuration across sessions.
 */
export interface McpServerRegistry {
	// ── CRUD ──

	/**
	 * Add a server configuration to the registry. If autoStart is true
	 * (the default), the server will be started immediately.
	 *
	 * @param config - The server configuration.
	 * @param autoStart - Whether to start the server immediately (default true).
	 * @returns The managed server info.
	 */
	addServer(
		config: McpRemoteServerConfig,
		autoStart?: boolean,
	): Promise<ManagedServerInfo>;

	/**
	 * Remove a server from the registry. Stops the server if it is running.
	 *
	 * @param serverId - The server's unique identifier.
	 */
	removeServer(serverId: string): Promise<void>;

	/**
	 * Get the managed server info for a specific server.
	 *
	 * @param serverId - The server's unique identifier.
	 * @returns The managed server info, or undefined if not found.
	 */
	getServer(serverId: string): ManagedServerInfo | undefined;

	/**
	 * List all managed servers, optionally filtered by state or tags.
	 *
	 * @param filter - Optional filter criteria.
	 * @returns Array of managed server info objects.
	 */
	listServers(filter?: ServerFilter): ManagedServerInfo[];

	// ── Lifecycle ──

	/**
	 * Start a server that is currently idle or stopped.
	 *
	 * @param serverId - The server's unique identifier.
	 */
	startServer(serverId: string): Promise<ManagedServerInfo>;

	/**
	 * Stop a running server.
	 *
	 * @param serverId - The server's unique identifier.
	 */
	stopServer(serverId: string): Promise<void>;

	/**
	 * Restart a server (stop then start).
	 *
	 * @param serverId - The server's unique identifier.
	 */
	restartServer(serverId: string): Promise<void>;

	// ── Aggregation ──

	/**
	 * Get all tools from all "ready" servers, namespaced to avoid collisions.
	 *
	 * @returns Array of namespaced tool entries.
	 */
	getAggregatedTools(): NamespacedTool[];

	/**
	 * Get all resources from all "ready" servers.
	 *
	 * @returns Array of namespaced resource entries.
	 */
	getAggregatedResources(): NamespacedResource[];

	/**
	 * Route a namespaced tool call to its owning server.
	 *
	 * @param namespacedName - The namespaced tool name.
	 * @param args - The call arguments.
	 * @returns Route information, or null if not found.
	 */
	routeToolCall(
		namespacedName: string,
		args: Record<string, unknown>,
	): ToolCallRoute | null;

	/**
	 * Fuzzy-search across all available tools.
	 *
	 * @param query - The search query.
	 * @param limit - Maximum results (default 10).
	 * @returns Ranked search results.
	 */
	findTools(query: string, limit?: number): ToolSearchResult[];

	/**
	 * Get total tool count across all ready servers.
	 */
	getToolCount(): number;

	// ── Events ──

	/**
	 * Subscribe to registry events (state changes, tool updates, errors).
	 *
	 * @param listener - The event listener callback.
	 * @returns A cleanup function to unsubscribe.
	 */
	onEvent(listener: RegistryEventListener): () => void;

	// ── Persistence ──

	/**
	 * Save all server configurations to a JSON file.
	 *
	 * @param filePath - The file path to write.
	 */
	saveConfig(filePath: string): Promise<void>;

	/**
	 * Load server configurations from a JSON file and register them.
	 * Optionally auto-starts all loaded servers.
	 *
	 * @param filePath - The file path to read.
	 * @param autoStart - Whether to start servers after loading (default false).
	 */
	loadConfig(filePath: string, autoStart?: boolean): Promise<void>;

	// ── Cleanup ──

	/**
	 * Dispose the registry: stop all servers and release all resources.
	 */
	dispose(): Promise<void>;
}

// ─── Factory ───────────────────────────────────────────────────────────────

/**
 * Create a new MCP server registry.
 *
 * Follows the factory pattern used by @chitragupta/core's createPluginRegistry().
 *
 * @returns A fully initialized {@link McpServerRegistry} instance.
 *
 * @example
 * ```ts
 * const registry = createMcpServerRegistry();
 * await registry.addServer({ id: "fs", name: "filesystem", transport: "stdio", command: "mcp-fs" });
 * const tools = registry.getAggregatedTools();
 * await registry.dispose();
 * ```
 */
export function createMcpServerRegistry(): McpServerRegistry {
	const lifecycle = new ServerLifecycleManager();
	const aggregator = new CapabilityAggregator();
	const configs: Map<string, McpRemoteServerConfig> = new Map();
	const listeners: Set<RegistryEventListener> = new Set();

	/**
	 * Emit a registry event to all subscribed listeners.
	 */
	function emit(event: RegistryEvent): void {
		for (const listener of listeners) {
			try {
				listener(event);
			} catch {
				// Listener errors must not break the registry
			}
		}
	}

	// ── Wire lifecycle state changes to aggregator and events ──

	lifecycle.onStateChange((serverId, from, to, info) => {
		emit({ type: "server:state-changed", serverId, from, to });

		if (to === "ready") {
			// Server became ready — add/update its capabilities in the aggregator
			aggregator.addServer(
				serverId,
				info.config.name,
				info.tools,
				info.resources,
				info.prompts,
			);
			emit({ type: "server:tools-changed", serverId, tools: info.tools });
			emit({ type: "registry:tools-updated", totalTools: aggregator.getToolCount() });
		} else if (to === "error") {
			emit({ type: "server:error", serverId, error: info.lastError ?? new Error("Unknown error") });
		} else if (to === "stopped" || to === "stopping") {
			// Server going away — remove from aggregator
			aggregator.removeServer(serverId);
			emit({ type: "registry:tools-updated", totalTools: aggregator.getToolCount() });
		}
	});

	lifecycle.onToolsChanged((serverId, info) => {
		aggregator.updateServerTools(serverId, info.tools);
		emit({ type: "server:tools-changed", serverId, tools: info.tools });
		emit({ type: "registry:tools-updated", totalTools: aggregator.getToolCount() });
	});

	// ── Registry Implementation ──

	const registry: McpServerRegistry = {
		async addServer(
			config: McpRemoteServerConfig,
			autoStart: boolean = true,
		): Promise<ManagedServerInfo> {
			configs.set(config.id, config);
			emit({ type: "server:added", serverId: config.id });

			if (autoStart) {
				return lifecycle.start(config);
			}

			// Just register without starting — create a placeholder info
			const info = lifecycle.getInfo(config.id);
			if (info) return info;

			// Start to register, then it will be in idle if not autoStart
			// We need to at least make the lifecycle aware of this config
			return lifecycle.start(config).catch((e) => {
				log.debug("server registration start failed", { serverId: config.id, error: String(e) });
				const managed = lifecycle.getInfo(config.id);
				if (managed) return managed;
				throw new McpNotFoundError(`Failed to register server "${config.id}"`);
			});
		},

		async removeServer(serverId: string): Promise<void> {
			// Stop if running
			const info = lifecycle.getInfo(serverId);
			if (info && info.state !== "stopped") {
				await lifecycle.stop(serverId);
			}

			// Remove from aggregator and configs
			aggregator.removeServer(serverId);
			configs.delete(serverId);

			emit({ type: "server:removed", serverId });
			emit({ type: "registry:tools-updated", totalTools: aggregator.getToolCount() });
		},

		getServer(serverId: string): ManagedServerInfo | undefined {
			return lifecycle.getInfo(serverId);
		},

		listServers(filter?: ServerFilter): ManagedServerInfo[] {
			let servers = lifecycle.getAllInfo();

			if (filter?.states && filter.states.length > 0) {
				const stateSet = new Set(filter.states);
				servers = servers.filter((s) => stateSet.has(s.state));
			}

			if (filter?.tags && filter.tags.length > 0) {
				const tagSet = new Set(filter.tags);
				servers = servers.filter((s) => {
					if (!s.config.tags) return false;
					return s.config.tags.some((t) => tagSet.has(t));
				});
			}

			return servers;
		},

		async startServer(serverId: string): Promise<ManagedServerInfo> {
			const config = configs.get(serverId);
			if (!config) {
				throw new McpNotFoundError(`No configuration found for server "${serverId}"`);
			}
			return lifecycle.start(config);
		},

		async stopServer(serverId: string): Promise<void> {
			return lifecycle.stop(serverId);
		},

		async restartServer(serverId: string): Promise<void> {
			return lifecycle.restart(serverId);
		},

		getAggregatedTools(): NamespacedTool[] {
			return aggregator.getAllTools();
		},

		getAggregatedResources(): NamespacedResource[] {
			return aggregator.getAllResources();
		},

		routeToolCall(
			namespacedName: string,
			args: Record<string, unknown>,
		): ToolCallRoute | null {
			return aggregator.routeToolCall(namespacedName, args);
		},

		findTools(query: string, limit?: number): ToolSearchResult[] {
			return aggregator.findTools(query, limit);
		},

		getToolCount(): number {
			return aggregator.getToolCount();
		},

		onEvent(listener: RegistryEventListener): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		async saveConfig(filePath: string): Promise<void> {
			const configArray = [...configs.values()];
			const data = JSON.stringify({ mcpServers: configArray }, null, "\t");

			// Ensure the directory exists
			const dir = dirname(filePath);
			await mkdir(dir, { recursive: true });
			await writeFile(filePath, data, "utf-8");
		},

		async loadConfig(filePath: string, autoStart: boolean = false): Promise<void> {
			const raw = await readFile(filePath, "utf-8");
			const parsed = JSON.parse(raw) as { mcpServers?: McpRemoteServerConfig[] };

			if (!parsed.mcpServers || !Array.isArray(parsed.mcpServers)) {
				return;
			}

			const startPromises: Promise<unknown>[] = [];

			for (const config of parsed.mcpServers) {
				if (!config.id || configs.has(config.id)) continue;

				configs.set(config.id, config);
				emit({ type: "server:added", serverId: config.id });

				if (autoStart) {
					startPromises.push(
						lifecycle.start(config).catch(() => {
							// Individual server failures shouldn't block loading others
						}),
					);
				}
			}

			if (startPromises.length > 0) {
				await Promise.all(startPromises);
			}
		},

		async dispose(): Promise<void> {
			await lifecycle.dispose();
			listeners.clear();
			configs.clear();
		},
	};

	return registry;
}
