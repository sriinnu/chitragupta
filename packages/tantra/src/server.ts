/**
 * @chitragupta/tantra — MCP Server.
 *
 * Exposes tools, resources, and prompts via the Model Context Protocol.
 * Supports stdio and SSE transports.
 */

import type {
	JsonRpcRequest,
	JsonRpcResponse,
	JsonRpcNotification,
	McpServerConfig,
	McpToolHandler,
	McpResourceHandler,
	McpPromptHandler,
	ServerInfo,
	ServerCapabilities,
} from "./types.js";
import {
	createResponse,
	createErrorResponse,
	METHOD_NOT_FOUND,
	INVALID_PARAMS,
	INTERNAL_ERROR,
	isRequest,
} from "./jsonrpc.js";
import { StdioServerTransport } from "./transport/stdio.js";
import { SSEServerTransport } from "./transport/sse.js";
import { formatToolFooter } from "@chitragupta/ui/tool-formatter";

type AnyMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

/**
 * MCP Server -- serves tools, resources, and prompts over JSON-RPC 2.0.
 *
 * Supports stdio and SSE transports. Registers tool, resource, and prompt
 * handlers that are invoked when the corresponding MCP methods are called.
 *
 * @example
 * ```ts
 * const server = new McpServer({ name: "my-server", version: "1.0.0", transport: "stdio" });
 * server.registerTool({ definition: { name: "greet", ... }, execute: async (args) => ... });
 * await server.start();
 * ```
 */
export class McpServer {
	private _config: McpServerConfig;
	private _tools: Map<string, McpToolHandler> = new Map();
	private _resources: Map<string, McpResourceHandler> = new Map();
	private _prompts: Map<string, McpPromptHandler> = new Map();
	private _stdioTransport: StdioServerTransport | null = null;
	private _sseTransport: SSEServerTransport | null = null;
	private _initialized = false;

	constructor(config: McpServerConfig) {
		this._config = config;

		// Register initial handlers
		if (config.tools) {
			for (const tool of config.tools) {
				this._tools.set(tool.definition.name, tool);
			}
		}
		if (config.resources) {
			for (const resource of config.resources) {
				const key = "uri" in resource.definition
					? resource.definition.uri
					: resource.definition.uriTemplate;
				this._resources.set(key, resource);
			}
		}
		if (config.prompts) {
			for (const prompt of config.prompts) {
				this._prompts.set(prompt.definition.name, prompt);
			}
		}
	}

	// ─── Tool Management ──────────────────────────────────────────────────

	/**
	 * Register a new tool handler.
	 *
	 * @param handler - The tool handler with definition and execute function.
	 */
	registerTool(handler: McpToolHandler): void {
		this._tools.set(handler.definition.name, handler);
	}

	/**
	 * Unregister a tool by name.
	 *
	 * @param name - The name of the tool to remove.
	 */
	unregisterTool(name: string): void {
		this._tools.delete(name);
	}

	// ─── Resource Management ──────────────────────────────────────────────

	/**
	 * Register a new resource handler.
	 *
	 * @param handler - The resource handler with definition and read function.
	 */
	registerResource(handler: McpResourceHandler): void {
		const key = "uri" in handler.definition
			? handler.definition.uri
			: handler.definition.uriTemplate;
		this._resources.set(key, handler);
	}

	// ─── Prompt Management ────────────────────────────────────────────────

	/**
	 * Register a new prompt handler.
	 *
	 * @param handler - The prompt handler with definition and get function.
	 */
	registerPrompt(handler: McpPromptHandler): void {
		this._prompts.set(handler.definition.name, handler);
	}

	// ─── Lifecycle ────────────────────────────────────────────────────────

	/**
	 * Start serving. Transport is determined by config.
	 */
	async start(): Promise<void> {
		if (this._config.transport === "stdio") {
			this._stdioTransport = new StdioServerTransport();
			this._stdioTransport.onMessage((msg) => {
				this._onMessage(msg).catch((_err) => {
					// MCP errors are caught to prevent transport disruption. Errors are reported via JSON-RPC error responses.
				});
			});
			this._stdioTransport.start();
		} else if (this._config.transport === "sse") {
			this._sseTransport = new SSEServerTransport();
			this._sseTransport.onMessage((msg) => {
				this._onMessage(msg).catch((_err) => {
					// MCP errors are caught to prevent transport disruption. Errors are reported via JSON-RPC error responses.
				});
			});
			const ssePort = this._config.ssePort ?? 3001;
			await this._sseTransport.start(ssePort);
		}
	}

	/**
	 * Stop the server.
	 */
	async stop(): Promise<void> {
		if (this._stdioTransport) {
			this._stdioTransport.stop();
			this._stdioTransport = null;
		}
		if (this._sseTransport) {
			await this._sseTransport.stop();
			this._sseTransport = null;
		}
		this._initialized = false;
	}

	// ─── Internal Message Handling ────────────────────────────────────────

	/**
	 * Handle an incoming message from any transport.
	 */
	private async _onMessage(msg: AnyMessage): Promise<void> {
		if (!isRequest(msg)) {
			// We only process requests on the server side
			return;
		}

		const response = await this._handleRequest(msg);
		this._sendResponse(response);
	}

	/**
	 * Route a JSON-RPC request to the appropriate handler.
	 */
	private async _handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
		try {
			switch (request.method) {
				case "initialize":
					return this._handleInitialize(request.id, request.params);
				case "tools/list":
					return this._handleToolsList(request.id);
				case "tools/call":
					return await this._handleToolsCall(request.id, request.params);
				case "resources/list":
					return this._handleResourcesList(request.id);
				case "resources/read":
					return await this._handleResourcesRead(request.id, request.params);
				case "prompts/list":
					return this._handlePromptsList(request.id);
				case "prompts/get":
					return await this._handlePromptsGet(request.id, request.params);
				case "ping":
					return createResponse(request.id, {});
				default:
					return createErrorResponse(
						request.id,
						METHOD_NOT_FOUND,
						`Method not found: ${request.method}`,
					);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return createErrorResponse(request.id, INTERNAL_ERROR, message);
		}
	}

	/**
	 * Handle "initialize" — return server info and capabilities.
	 */
	private _handleInitialize(
		id: string | number,
		_params?: Record<string, unknown>,
	): JsonRpcResponse {
		this._initialized = true;

		const capabilities: ServerCapabilities = {};
		if (this._tools.size > 0) {
			capabilities.tools = { listChanged: true };
		}
		if (this._resources.size > 0) {
			capabilities.resources = { subscribe: false, listChanged: true };
		}
		if (this._prompts.size > 0) {
			capabilities.prompts = { listChanged: true };
		}

		const info: ServerInfo = {
			name: this._config.name,
			version: this._config.version,
			capabilities,
		};

		return createResponse(id, {
			protocolVersion: "2024-11-05",
			serverInfo: info,
			capabilities,
		});
	}

	/**
	 * Handle "tools/list" — return all tool definitions.
	 */
	private _handleToolsList(id: string | number): JsonRpcResponse {
		const tools = Array.from(this._tools.values()).map((h) => h.definition);
		return createResponse(id, { tools });
	}

	/**
	 * Handle "tools/call" — execute a tool.
	 */
	private async _handleToolsCall(
		id: string | number,
		params?: Record<string, unknown>,
	): Promise<JsonRpcResponse> {
		if (!params || typeof params.name !== "string") {
			return createErrorResponse(id, INVALID_PARAMS, "Missing required param: name");
		}

		const toolName = params.name as string;
		const handler = this._tools.get(toolName);

		if (!handler) {
			return createErrorResponse(
				id,
				INVALID_PARAMS,
				`Unknown tool: ${toolName}`,
			);
		}

		const args = (params.arguments as Record<string, unknown>) ?? {};

		const t0 = performance.now();
		try {
			const result = await handler.execute(args);
			const elapsed = performance.now() - t0;

			// Append rich formatted footer to the last text content block
			if (result.content && Array.isArray(result.content) && result.content.length > 0) {
				const last = result.content[result.content.length - 1];
				if (last && last.type === "text") {
					const outputBytes = new TextEncoder().encode(last.text).length;
					const footer = formatToolFooter({
						toolName,
						elapsedMs: elapsed,
						outputBytes,
						metadata: result._metadata,
						isError: result.isError,
					});
					last.text += `\n\n${footer}`;
				}
			}

			// Strip internal metadata before sending over wire
			delete result._metadata;

			return createResponse(id, result);
		} catch (err) {
			const elapsed = performance.now() - t0;
			const message = err instanceof Error ? err.message : String(err);
			const errorText = message;
			const outputBytes = new TextEncoder().encode(errorText).length;
			const footer = formatToolFooter({
				toolName,
				elapsedMs: elapsed,
				outputBytes,
				isError: true,
			});
			return createResponse(id, {
				content: [{ type: "text", text: `${errorText}\n\n${footer}` }],
				isError: true,
			});
		}
	}

	/**
	 * Handle "resources/list" — return all resources.
	 */
	private _handleResourcesList(id: string | number): JsonRpcResponse {
		const resources = Array.from(this._resources.values()).map((h) => h.definition);
		return createResponse(id, { resources });
	}

	/**
	 * Handle "resources/read" — read a resource by URI.
	 */
	private async _handleResourcesRead(
		id: string | number,
		params?: Record<string, unknown>,
	): Promise<JsonRpcResponse> {
		if (!params || typeof params.uri !== "string") {
			return createErrorResponse(id, INVALID_PARAMS, "Missing required param: uri");
		}

		const uri = params.uri as string;

		// Try exact match first
		let handler = this._resources.get(uri);

		// If no exact match, try matching templates
		if (!handler) {
			for (const [, h] of this._resources) {
				if ("uriTemplate" in h.definition) {
					// Simple template matching (just checks prefix)
					const template = h.definition.uriTemplate;
					const prefix = template.split("{")[0];
					if (prefix && uri.startsWith(prefix)) {
						handler = h;
						break;
					}
				}
			}
		}

		if (!handler) {
			return createErrorResponse(id, INVALID_PARAMS, `Unknown resource: ${uri}`);
		}

		try {
			const content = await handler.read(uri);
			return createResponse(id, { contents: content });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return createErrorResponse(id, INTERNAL_ERROR, message);
		}
	}

	/**
	 * Handle "prompts/list" — return all prompts.
	 */
	private _handlePromptsList(id: string | number): JsonRpcResponse {
		const prompts = Array.from(this._prompts.values()).map((h) => h.definition);
		return createResponse(id, { prompts });
	}

	/**
	 * Handle "prompts/get" — get a prompt by name.
	 */
	private async _handlePromptsGet(
		id: string | number,
		params?: Record<string, unknown>,
	): Promise<JsonRpcResponse> {
		if (!params || typeof params.name !== "string") {
			return createErrorResponse(id, INVALID_PARAMS, "Missing required param: name");
		}

		const promptName = params.name as string;
		const handler = this._prompts.get(promptName);

		if (!handler) {
			return createErrorResponse(id, INVALID_PARAMS, `Unknown prompt: ${promptName}`);
		}

		const args = (params.arguments as Record<string, string>) ?? {};

		try {
			const contentItems = await handler.get(args);
			// MCP spec: each message.content is a single object, not an array.
			// Map each content item to its own message.
			const messages = contentItems.map((item) => ({
				role: "user" as const,
				content: item,
			}));
			return createResponse(id, {
				description: handler.definition.description,
				messages,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return createErrorResponse(id, INTERNAL_ERROR, message);
		}
	}

	/**
	 * Send a response via the active transport.
	 */
	private _sendResponse(response: JsonRpcResponse): void {
		if (this._stdioTransport) {
			this._stdioTransport.send(response);
		} else if (this._sseTransport) {
			this._sseTransport.broadcast(response);
		}
	}
}
