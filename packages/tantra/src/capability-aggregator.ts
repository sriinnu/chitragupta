/**
 * @chitragupta/tantra — Capability Aggregator.
 *
 * Aggregates tools, resources, and prompts from multiple MCP servers
 * into a unified namespace. Handles namespacing to prevent collisions,
 * routing calls to the correct server, and fuzzy search across all
 * available capabilities.
 */

import type { McpTool, McpResource, McpPrompt } from "./types.js";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * A tool with its server origin tracked for routing.
 */
export interface NamespacedTool {
	/** The full namespaced name: "serverName.toolName". */
	namespacedName: string;
	/** The original tool name on the server. */
	originalName: string;
	/** The server ID that owns this tool. */
	serverId: string;
	/** The server's human-readable name. */
	serverName: string;
	/** The MCP tool definition. */
	tool: McpTool;
}

/**
 * A resource with its server origin tracked for routing.
 */
export interface NamespacedResource {
	/** The full namespaced URI: "serverName://originalUri". */
	namespacedUri: string;
	/** The original resource URI on the server. */
	originalUri: string;
	/** The server ID that owns this resource. */
	serverId: string;
	/** The server's human-readable name. */
	serverName: string;
	/** The MCP resource definition. */
	resource: McpResource;
}

/**
 * Result of routing a namespaced tool call back to its origin.
 */
export interface ToolCallRoute {
	/** The server ID to route the call to. */
	serverId: string;
	/** The original (un-namespaced) tool name. */
	toolName: string;
	/** The call arguments (passed through unchanged). */
	args: Record<string, unknown>;
}

/**
 * A ranked search result from fuzzy matching.
 */
export interface ToolSearchResult {
	/** The namespaced tool entry. */
	tool: NamespacedTool;
	/** Relevance score (0 to 1, higher is better). */
	score: number;
}

// ─── Internal: Server Entry ────────────────────────────────────────────────

interface ServerEntry {
	serverId: string;
	serverName: string;
	tools: McpTool[];
	resources: McpResource[];
	prompts: McpPrompt[];
}

// ─── Aggregator ────────────────────────────────────────────────────────────

/**
 * Aggregates capabilities from multiple MCP servers into a unified,
 * namespaced view. Tools become "serverName.toolName" to avoid
 * collisions when multiple servers expose identically-named tools.
 *
 * @example
 * ```ts
 * const agg = new CapabilityAggregator();
 * agg.addServer("fs-1", "filesystem", tools);
 * agg.addServer("git-1", "git", gitTools);
 * const all = agg.getAllTools(); // filesystem.read_file, git.status, etc.
 * const route = agg.routeToolCall("git.status", {});
 * ```
 */
export class CapabilityAggregator {
	private _servers: Map<string, ServerEntry> = new Map();

	// ─── Server Management ─────────────────────────────────────────────

	/**
	 * Register a server's capabilities in the aggregator.
	 *
	 * @param serverId - The server's unique identifier.
	 * @param serverName - Human-readable name used for namespacing.
	 * @param tools - Tools discovered from the server.
	 * @param resources - Resources discovered from the server.
	 * @param prompts - Prompts discovered from the server.
	 */
	addServer(
		serverId: string,
		serverName: string,
		tools: McpTool[],
		resources: McpResource[] = [],
		prompts: McpPrompt[] = [],
	): void {
		this._servers.set(serverId, {
			serverId,
			serverName: this._sanitizeName(serverName),
			tools,
			resources,
			prompts,
		});
	}

	/**
	 * Remove a server and all its capabilities from the aggregator.
	 *
	 * @param serverId - The server's unique identifier.
	 */
	removeServer(serverId: string): void {
		this._servers.delete(serverId);
	}

	/**
	 * Update the tool list for an already-registered server.
	 * Used when a server emits `notifications/tools/list_changed`.
	 *
	 * @param serverId - The server's unique identifier.
	 * @param tools - The new tool list from the server.
	 */
	updateServerTools(serverId: string, tools: McpTool[]): void {
		const entry = this._servers.get(serverId);
		if (entry) {
			entry.tools = tools;
		}
	}

	// ─── Queries ───────────────────────────────────────────────────────

	/**
	 * Get all tools from all servers, namespaced as "serverName.toolName".
	 *
	 * @returns Array of namespaced tool entries.
	 */
	getAllTools(): NamespacedTool[] {
		const result: NamespacedTool[] = [];

		for (const entry of this._servers.values()) {
			for (const tool of entry.tools) {
				result.push({
					namespacedName: `${entry.serverName}.${tool.name}`,
					originalName: tool.name,
					serverId: entry.serverId,
					serverName: entry.serverName,
					tool: {
						...tool,
						name: `${entry.serverName}.${tool.name}`,
						description: `[${entry.serverName}] ${tool.description}`,
					},
				});
			}
		}

		return result;
	}

	/**
	 * Get all resources from all servers, with namespaced URIs.
	 *
	 * @returns Array of namespaced resource entries.
	 */
	getAllResources(): NamespacedResource[] {
		const result: NamespacedResource[] = [];

		for (const entry of this._servers.values()) {
			for (const resource of entry.resources) {
				result.push({
					namespacedUri: `${entry.serverName}://${resource.uri}`,
					originalUri: resource.uri,
					serverId: entry.serverId,
					serverName: entry.serverName,
					resource: {
						...resource,
						name: `${entry.serverName}.${resource.name}`,
					},
				});
			}
		}

		return result;
	}

	/**
	 * Route a namespaced tool call back to its owning server.
	 *
	 * Accepts either "serverName.toolName" or just "toolName" (which will
	 * match the first server that has a tool with that name).
	 *
	 * @param namespacedName - The namespaced (or plain) tool name.
	 * @param args - The arguments for the tool call.
	 * @returns The route information, or null if no matching tool is found.
	 */
	routeToolCall(
		namespacedName: string,
		args: Record<string, unknown>,
	): ToolCallRoute | null {
		const dotIndex = namespacedName.indexOf(".");

		// Namespaced: "serverName.toolName"
		if (dotIndex > 0) {
			const serverName = namespacedName.slice(0, dotIndex);
			const toolName = namespacedName.slice(dotIndex + 1);

			for (const entry of this._servers.values()) {
				if (entry.serverName === serverName) {
					const found = entry.tools.find((t) => t.name === toolName);
					if (found) {
						return { serverId: entry.serverId, toolName, args };
					}
				}
			}
		}

		// Fallback: search all servers for a tool with the exact name
		for (const entry of this._servers.values()) {
			const found = entry.tools.find((t) => t.name === namespacedName);
			if (found) {
				return { serverId: entry.serverId, toolName: namespacedName, args };
			}
		}

		return null;
	}

	/**
	 * Fuzzy-search across all tool names and descriptions.
	 *
	 * Scoring heuristic:
	 * - Exact name match: 1.0
	 * - Name starts with query: 0.9
	 * - Name contains query: 0.7
	 * - Description contains query: 0.4
	 * - Partial character overlap: proportional (0.1 - 0.3)
	 *
	 * @param query - The search query (case-insensitive).
	 * @param limit - Maximum number of results to return (default 10).
	 * @returns Array of tool search results sorted by score descending.
	 */
	findTools(query: string, limit: number = 10): ToolSearchResult[] {
		if (!query) return [];

		const lowerQuery = query.toLowerCase();
		const allTools = this.getAllTools();
		const results: ToolSearchResult[] = [];

		for (const nsTool of allTools) {
			const lowerName = nsTool.namespacedName.toLowerCase();
			const lowerOriginal = nsTool.originalName.toLowerCase();
			const lowerDesc = nsTool.tool.description.toLowerCase();

			let score = 0;

			// Exact match on original name
			if (lowerOriginal === lowerQuery) {
				score = 1.0;
			}
			// Exact match on namespaced name
			else if (lowerName === lowerQuery) {
				score = 1.0;
			}
			// Name starts with query
			else if (lowerOriginal.startsWith(lowerQuery) || lowerName.startsWith(lowerQuery)) {
				score = 0.9;
			}
			// Name contains query
			else if (lowerOriginal.includes(lowerQuery) || lowerName.includes(lowerQuery)) {
				score = 0.7;
			}
			// Description contains query
			else if (lowerDesc.includes(lowerQuery)) {
				score = 0.4;
			}
			// Character overlap scoring
			else {
				const overlap = this._charOverlap(lowerQuery, lowerOriginal + " " + lowerDesc);
				if (overlap > 0.5) {
					score = 0.1 + (overlap * 0.2);
				}
			}

			if (score > 0) {
				results.push({ tool: nsTool, score });
			}
		}

		// Sort by score descending, then alphabetically for ties
		results.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.tool.namespacedName.localeCompare(b.tool.namespacedName);
		});

		return results.slice(0, limit);
	}

	/**
	 * Get the total number of tools across all registered servers.
	 *
	 * @returns Total tool count.
	 */
	getToolCount(): number {
		let count = 0;
		for (const entry of this._servers.values()) {
			count += entry.tools.length;
		}
		return count;
	}

	/**
	 * Get the number of registered servers.
	 *
	 * @returns Server count.
	 */
	getServerCount(): number {
		return this._servers.size;
	}

	// ─── Internal Helpers ──────────────────────────────────────────────

	/**
	 * Sanitize a server name for use as a namespace prefix.
	 * Replaces non-alphanumeric characters (except hyphens and underscores)
	 * with underscores.
	 */
	private _sanitizeName(name: string): string {
		return name.replace(/[^a-zA-Z0-9_-]/g, "_");
	}

	/**
	 * Compute the character overlap ratio between a query and a target string.
	 * Returns a value between 0 and 1.
	 */
	private _charOverlap(query: string, target: string): number {
		if (query.length === 0) return 0;

		const queryChars = new Set(query.split(""));
		const targetChars = new Set(target.split(""));
		let matches = 0;

		for (const ch of queryChars) {
			if (targetChars.has(ch)) {
				matches++;
			}
		}

		return matches / queryChars.size;
	}
}
