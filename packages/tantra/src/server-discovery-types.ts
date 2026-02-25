/**
 * @chitragupta/tantra -- Server discovery types.
 *
 * Extracted from server-discovery.ts for maintainability.
 * Contains type definitions used by ServerDiscovery and its consumers.
 *
 * @module server-discovery-types
 */

import type { McpRemoteServerConfig } from "./registry-types.js";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * A configuration object that contains an `mcpServers` array,
 * typically loaded from a project or workspace config file.
 */
export interface McpConfigSource {
	/** Array of MCP server configurations. */
	mcpServers?: McpRemoteServerConfig[];
}

/**
 * Options for the combined discovery scan.
 */
export interface DiscoverAllOptions {
	/** Explicit config objects to scan. */
	configs?: McpConfigSource[];
	/** Directories to scan for *.json server config files. */
	directories?: string[];
	/** Root paths to scan for node_modules with MCP server packages. */
	nodeModulesRoots?: string[];
}

/**
 * Event emitted when a config file changes in a watched directory.
 */
export interface DiscoveryEvent {
	/** The type of file change. */
	type: "added" | "changed" | "removed";
	/** The file path that changed. */
	filePath: string;
	/** The parsed config, if available (not present for "removed"). */
	config?: McpRemoteServerConfig;
}

/**
 * Callback for directory watch events.
 */
export type DiscoveryCallback = (event: DiscoveryEvent) => void;
