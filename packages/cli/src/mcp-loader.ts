/**
 * @chitragupta/cli — MCP Server Loader.
 *
 * Discovers and connects to MCP servers from:
 *   1. ~/.chitragupta/mcp.json (global config)
 *   2. .chitragupta/mcp.json (project config)
 *
 * MCP tools are aggregated and made available to the agent.
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";
import {
	createMcpServerRegistry,
	importRegistryTools,
	type McpServerRegistry,
	type McpRemoteServerConfig,
	type ManagedServerInfo,
	type ChitraguptaToolHandler,
} from "@chitragupta/tantra";

// ─── Config Format ──────────────────────────────────────────────────────────

/**
 * Configuration for a single MCP server entry in the user's mcp.json.
 *
 * Simpler than the full McpRemoteServerConfig — the loader normalizes
 * these into McpRemoteServerConfig before handing them to the registry.
 */
export interface MCPServerConfig {
	/** Unique server identifier. */
	id: string;
	/** Human-readable display name. */
	name: string;
	/** Command to spawn (e.g., "npx", "node", "python"). */
	command: string;
	/** Arguments passed to the command. */
	args?: string[];
	/** Additional environment variables for the spawned process. */
	env?: Record<string, string>;
	/** Whether this server is enabled (default true). */
	enabled?: boolean;
}

/**
 * Shape of the mcp.json config file at both global and project levels.
 */
export interface MCPConfigFile {
	/** Array of MCP server configurations. */
	mcpServers: MCPServerConfig[];
}

// ─── Module State ───────────────────────────────────────────────────────────

/** The singleton registry, created on first startMCPServers() call. */
let _registry: McpServerRegistry | null = null;

/** Track started servers for shutdown. */
const _startedServerIds: Set<string> = new Set();

// ─── Config Loading ─────────────────────────────────────────────────────────

/**
 * Read and merge MCP server configs from both global and project paths.
 *
 * Global config:   ~/.chitragupta/mcp.json
 * Project config:  <cwd>/.chitragupta/mcp.json
 *
 * Project configs override global configs when IDs collide.
 * Disabled servers (enabled === false) are filtered out.
 *
 * @returns Merged array of enabled server configurations.
 */
export function loadMCPConfig(): MCPServerConfig[] {
	const globalPath = path.join(getChitraguptaHome(), "mcp.json");
	const projectPath = path.join(process.cwd(), ".chitragupta", "mcp.json");

	const globalConfigs = readConfigFile(globalPath);
	const projectConfigs = readConfigFile(projectPath);

	// Merge: project overrides global by ID
	const byId = new Map<string, MCPServerConfig>();

	for (const config of globalConfigs) {
		byId.set(config.id, config);
	}
	for (const config of projectConfigs) {
		byId.set(config.id, config);
	}

	// Filter out disabled servers
	return [...byId.values()].filter((c) => c.enabled !== false);
}

/**
 * Read a single mcp.json file and return its server configs.
 * Returns an empty array if the file doesn't exist or is malformed.
 */
function readConfigFile(filePath: string): MCPServerConfig[] {
	try {
		if (!fs.existsSync(filePath)) return [];
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as MCPConfigFile;

		if (!parsed.mcpServers || !Array.isArray(parsed.mcpServers)) {
			return [];
		}

		// Validate each entry has at minimum id, name, command
		return parsed.mcpServers.filter(
			(s) =>
				typeof s.id === "string" &&
				s.id.length > 0 &&
				typeof s.name === "string" &&
				s.name.length > 0 &&
				typeof s.command === "string" &&
				s.command.length > 0,
		);
	} catch {
		return [];
	}
}

// ─── Server Lifecycle ───────────────────────────────────────────────────────

/**
 * Convert a user-facing MCPServerConfig to a tantra McpRemoteServerConfig
 * and start all configured servers via the MCP registry.
 *
 * Creates the singleton registry if not already initialized.
 *
 * @param configs - Array of server configs to start.
 * @returns The MCP server registry with all servers registered.
 */
export async function startMCPServers(
	configs: MCPServerConfig[],
): Promise<McpServerRegistry> {
	if (!_registry) {
		_registry = createMcpServerRegistry();
	}

	const startPromises: Promise<ManagedServerInfo | void>[] = [];

	for (const config of configs) {
		// Convert to tantra's McpRemoteServerConfig format
		const remoteConfig: McpRemoteServerConfig = {
			id: config.id,
			name: config.name,
			transport: "stdio",
			command: config.command,
			args: config.args,
			env: config.env,
			autoRestart: true,
			maxRestarts: 3,
		};

		_startedServerIds.add(config.id);

		startPromises.push(
			_registry.addServer(remoteConfig, true).catch((err) => {
				// Individual server failures shouldn't block others
				const message = err instanceof Error ? err.message : String(err);
				process.stderr.write(
					`  Warning: MCP server "${config.name}" failed to start: ${message}\n`,
				);
			}),
		);
	}

	await Promise.allSettled(startPromises);

	return _registry;
}

// ─── Tool Import ────────────────────────────────────────────────────────────

/**
 * Extract tools from all running MCP servers and return them as
 * ChitraguptaToolHandler-compatible objects.
 *
 * Uses the tantra bridge's `importRegistryTools` to convert MCP tools
 * into the Chitragupta tool format, namespaced to avoid collisions.
 *
 * @param registry - The MCP server registry to import from.
 * @returns Array of Chitragupta-compatible tool handlers.
 */
export function importMCPTools(
	registry: McpServerRegistry,
): ChitraguptaToolHandler[] {
	return importRegistryTools(registry);
}

// ─── Shutdown ───────────────────────────────────────────────────────────────

/**
 * Gracefully stop all MCP servers and dispose the registry.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function shutdownMCPServers(): Promise<void> {
	if (!_registry) return;

	try {
		await _registry.dispose();
	} catch {
		// Best-effort shutdown
	}

	_startedServerIds.clear();
	_registry = null;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Get the current MCP registry, or null if not initialized.
 *
 * Useful for the /mcp slash command and MCP CLI commands to
 * inspect running servers without importing the full loader.
 */
export function getMCPRegistry(): McpServerRegistry | null {
	return _registry;
}

/**
 * Get the list of server IDs that were started by this loader.
 */
export function getStartedServerIds(): ReadonlySet<string> {
	return _startedServerIds;
}
