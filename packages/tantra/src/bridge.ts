/**
 * @chitragupta/tantra — Bridge between Chitragupta tools and MCP.
 *
 * Converts between Chitragupta's ToolHandler format and MCP's tool format,
 * enabling bidirectional interop with the MCP ecosystem.
 */

import type {
	McpToolHandler,
	McpToolResult,
	McpTool,
	McpContent,
	McpServerConfig,
	McpClientConfig,
} from "./types.js";
import { McpServer } from "./server.js";
import { McpClient } from "./client.js";
import type { McpServerRegistry } from "./server-registry.js";

// ─── Chitragupta Tool Types (mirrored to avoid circular deps) ─────────────────

/**
 * Mirrors @chitragupta/anina ToolDefinition / ToolHandler / ToolResult / ToolContext
 * to avoid a hard dependency on @chitragupta/anina.
 */
export interface ChitraguptaToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface ChitraguptaToolContext {
	sessionId: string;
	workingDirectory: string;
	signal?: AbortSignal;
}

export interface ChitraguptaToolResult {
	content: string;
	isError?: boolean;
	metadata?: Record<string, unknown>;
}

export interface ChitraguptaToolHandler {
	definition: ChitraguptaToolDefinition;
	execute(args: Record<string, unknown>, context: ChitraguptaToolContext): Promise<ChitraguptaToolResult>;
}

// ─── Chitragupta → MCP ────────────────────────────────────────────────────────

/**
 * Convert a Chitragupta ToolHandler into an MCP McpToolHandler.
 *
 * Chitragupta tools return a single text string. MCP tools return an array
 * of content objects. This adapter wraps the text result as MCP text content.
 *
 * @param toolHandler - The Chitragupta tool handler to convert.
 * @returns An MCP-compatible tool handler.
 */
export function chitraguptaToolToMcp(toolHandler: ChitraguptaToolHandler): McpToolHandler {
	return {
		definition: {
			name: toolHandler.definition.name,
			description: toolHandler.definition.description,
			inputSchema: toolHandler.definition.inputSchema,
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			// Use a synthetic context for MCP-originated calls
			const context: ChitraguptaToolContext = {
				sessionId: "mcp-session",
				workingDirectory: process.cwd(),
			};

			try {
				const result = await toolHandler.execute(args, context);
				return {
					content: [{ type: "text", text: result.content }],
					isError: result.isError,
					_metadata: result.metadata,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}
		},
	};
}

// ─── MCP → Chitragupta ────────────────────────────────────────────────────────

/**
 * Convert an MCP tool into a Chitragupta-compatible ToolHandler.
 *
 * The returned handler calls the MCP server via the provided client to
 * execute the tool. MCP content arrays are collapsed into a single text string.
 *
 * @param mcpTool - The MCP tool definition.
 * @param client - The connected MCP client used to invoke the tool.
 * @returns A Chitragupta-compatible tool handler.
 */
export function mcpToolToChitragupta(
	mcpTool: McpTool,
	client: McpClient,
): ChitraguptaToolHandler {
	return {
		definition: {
			name: mcpTool.name,
			description: mcpTool.description,
			inputSchema: mcpTool.inputSchema,
		},
		async execute(
			args: Record<string, unknown>,
			_context: ChitraguptaToolContext,
		): Promise<ChitraguptaToolResult> {
			try {
				const result = await client.callTool(mcpTool.name, args);

				// Collapse MCP content array into a single string
				const text = result.content
					.map((c: McpContent) => {
						if (c.type === "text") return c.text;
						if (c.type === "resource") return c.text ?? `[resource: ${c.uri}]`;
						if (c.type === "image") return `[image: ${c.mimeType}]`;
						return "";
					})
					.join("\n");

				return {
					content: text,
					isError: result.isError,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: message,
					isError: true,
				};
			}
		},
	};
}

// ─── High-Level Helpers ────────────────────────────────────────────────────

/**
 * Create an MCP server that exposes a set of Chitragupta tools.
 *
 * This is a convenience wrapper: pass in Chitragupta tool handlers and server
 * config, and get back a ready-to-start McpServer.
 *
 * @param tools - Array of Chitragupta tool handlers to expose.
 * @param serverConfig - Server configuration (name, version, transport, etc.).
 * @returns A configured McpServer ready to call `.start()`.
 */
export function exposeChitraguptaTools(
	tools: ChitraguptaToolHandler[],
	serverConfig: Omit<McpServerConfig, "tools">,
): McpServer {
	const mcpTools = tools.map(chitraguptaToolToMcp);

	const config: McpServerConfig = {
		...serverConfig,
		tools: mcpTools,
	};

	return new McpServer(config);
}

/**
 * Connect to an MCP server and import all of its tools as Chitragupta-compatible
 * ToolHandler objects.
 *
 * The caller is responsible for disconnecting the client when done.
 *
 * @param clientConfig - Client configuration (transport, server command/URL, etc.).
 * @returns An object with `tools` (array of Chitragupta handlers) and `client` (for cleanup).
 */
export async function importMcpTools(
	clientConfig: McpClientConfig,
): Promise<{ tools: ChitraguptaToolHandler[]; client: McpClient }> {
	const client = new McpClient(clientConfig);
	await client.connect();

	const mcpTools = await client.listTools();
	const tools = mcpTools.map((t) => mcpToolToChitragupta(t, client));

	return { tools, client };
}

// ─── Registry Integration ──────────────────────────────────────────────────

/**
 * Import all tools from all "ready" servers in an MCP server registry
 * as Chitragupta-compatible ToolHandler objects.
 *
 * Each tool is routed through the registry's aggregator, so the tool call
 * is dispatched to the correct server. Tool names are namespaced as
 * "serverName.toolName" to avoid collisions.
 *
 * @param registry - The MCP server registry to import tools from.
 * @returns Array of Chitragupta tool handlers for all available MCP tools.
 */
export function importRegistryTools(
	registry: McpServerRegistry,
): ChitraguptaToolHandler[] {
	const aggregatedTools = registry.getAggregatedTools();

	return aggregatedTools.map((nsTool) => {
		return {
			definition: {
				name: nsTool.tool.name,
				description: nsTool.tool.description,
				inputSchema: nsTool.tool.inputSchema,
			},
			async execute(
				args: Record<string, unknown>,
				_context: ChitraguptaToolContext,
			): Promise<ChitraguptaToolResult> {
				// Route the call through the aggregator
				const route = registry.routeToolCall(nsTool.namespacedName, args);
				if (!route) {
					return {
						content: `Tool "${nsTool.namespacedName}" is no longer available`,
						isError: true,
					};
				}

				// Find the server and call the tool via its client
				const server = registry.getServer(route.serverId);
				if (!server || !server.client || server.state !== "ready") {
					return {
						content: `Server "${route.serverId}" is not available (state: ${server?.state ?? "unknown"})`,
						isError: true,
					};
				}

				try {
					const result = await server.client.callTool(route.toolName, route.args);

					// Collapse MCP content array into a single string
					const text = result.content
						.map((c: McpContent) => {
							if (c.type === "text") return c.text;
							if (c.type === "resource") return c.text ?? `[resource: ${c.uri}]`;
							if (c.type === "image") return `[image: ${c.mimeType}]`;
							return "";
						})
						.join("\n");

					return {
						content: text,
						isError: result.isError,
					};
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					return {
						content: message,
						isError: true,
					};
				}
			},
		};
	});
}
