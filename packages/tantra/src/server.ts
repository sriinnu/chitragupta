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
	ToolCallRecord,
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
import type { ToolRegistry } from "./tool-registry.js";
import {
	handleResourcesList,
	handleResourcesRead,
	handlePromptsList,
	handlePromptsGet,
} from "./server-handlers.js";
import {
	ToolCallRingBuffer,
	resolveTraceContext,
	buildResponseMeta,
} from "./server-telemetry.js";

type AnyMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

/** MCP Server — tools, resources, and prompts over JSON-RPC 2.0 (stdio / SSE). */
export class McpServer {
	private _config: McpServerConfig;
	private _tools: Map<string, McpToolHandler> = new Map();
	private _resources: Map<string, McpResourceHandler> = new Map();
	private _prompts: Map<string, McpPromptHandler> = new Map();
	private _stdioTransport: StdioServerTransport | null = null;
	private _sseTransport: SSEServerTransport | null = null;
	private _initialized = false;
	/** Attached dynamic tool registry (optional). */
	private _registry: ToolRegistry | null = null;
	/** Unsubscribe function for registry change events. */
	private _registryUnsub: (() => void) | null = null;
	/** In-memory ring buffer of recent tool calls for the OS integration surface. */
	private _ringBuffer = new ToolCallRingBuffer();

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

	/** Register a new tool handler. */
	registerTool(handler: McpToolHandler): void { this._tools.set(handler.definition.name, handler); }

	/** Unregister a tool by name. */
	unregisterTool(name: string): void { this._tools.delete(name); }

	// ─── Dynamic Registry ────────────────────────────────────────────────

	/**
	 * Attach a dynamic ToolRegistry to this server.
	 *
	 * All currently-enabled tools in the registry are merged into the
	 * server's tool map. The server subscribes to registry change events
	 * so that tools registered/unregistered/enabled/disabled at runtime
	 * are reflected in MCP `tools/list` responses automatically.
	 *
	 * Existing hardcoded tools (registered via config or `registerTool`)
	 * are preserved. If a registry tool collides with a hardcoded tool,
	 * the hardcoded tool wins and the registry tool is skipped.
	 *
	 * @param registry - The ToolRegistry instance to attach.
	 */
	attachRegistry(registry: ToolRegistry): void {
		// Detach any previously attached registry
		if (this._registryUnsub) {
			this._registryUnsub();
		}
		this._registry = registry;

		// Sync current registry tools into the server (skip collisions)
		for (const handler of registry.listTools()) {
			const name = handler.definition.name;
			if (!this._tools.has(name)) {
				this._tools.set(name, handler);
			}
		}

		// Subscribe to live changes
		this._registryUnsub = registry.onChange((event) => {
			switch (event.type) {
				case "tool:registered": {
					const handler = registry.getTool(event.toolName);
					if (handler && !this._tools.has(event.toolName)) {
						this._tools.set(event.toolName, handler);
						this._notifyToolsChanged();
					}
					break;
				}
				case "tool:unregistered":
					this._tools.delete(event.toolName);
					this._notifyToolsChanged();
					break;
				case "tool:enabled": {
					const handler = registry.getTool(event.toolName);
					if (handler) {
						this._tools.set(event.toolName, handler);
						this._notifyToolsChanged();
					}
					break;
				}
				case "tool:disabled":
					this._tools.delete(event.toolName);
					this._notifyToolsChanged();
					break;
				case "plugin:registered":
					for (const toolName of event.toolNames) {
						const handler = registry.getTool(toolName);
						if (handler && !this._tools.has(toolName)) {
							this._tools.set(toolName, handler);
						}
					}
					this._notifyToolsChanged();
					break;
				case "plugin:unregistered":
					for (const toolName of event.toolNames) {
						this._tools.delete(toolName);
					}
					this._notifyToolsChanged();
					break;
			}
		});
	}

	/**
	 * Send a `notifications/tools/list_changed` notification to connected clients.
	 */
	private _notifyToolsChanged(): void {
		if (this._initialized) {
			this.sendNotification({
				jsonrpc: "2.0",
				method: "notifications/tools/list_changed",
			});
		}
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

	// ─── Telemetry ───────────────────────────────────────────────────────

	/** Return a snapshot of the recent tool call ring buffer. */
	getRecentCalls(): ToolCallRecord[] {
		return this._ringBuffer.getAll();
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
					return handleResourcesList(request.id, this._resources);
				case "resources/read":
					return await handleResourcesRead(request.id, request.params, this._resources);
				case "prompts/list":
					return handlePromptsList(request.id, this._prompts);
				case "prompts/get":
					return await handlePromptsGet(request.id, request.params, this._prompts);
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
	 * Handle "tools/call" — execute a tool with trace propagation.
	 *
	 * Extracts or generates trace/span IDs, records execution to the ring
	 * buffer, and includes `_meta` with trace + sandbox info in the response.
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
			return createErrorResponse(id, INVALID_PARAMS, `Unknown tool: ${toolName}`);
		}

		const args = (params.arguments as Record<string, unknown>) ?? {};
		const [traceId, spanId] = resolveTraceContext(params);

		const t0 = performance.now();
		try {
			const result = await handler.execute(args);
			const elapsed = performance.now() - t0;

			this._appendFooter(result.content, toolName, elapsed, result._metadata, result.isError);
			delete result._metadata;

			this._ringBuffer.record({ toolName, traceId, spanId, durationMs: elapsed, isError: !!result.isError, timestamp: Date.now() });

			if (this._config.onToolCall) {
				try { await this._config.onToolCall({ tool: toolName, args, result, elapsedMs: elapsed }); } catch { /* best-effort */ }
			}

			return createResponse(id, { ...result, _meta: buildResponseMeta(traceId, spanId, elapsed) });
		} catch (err) {
			const elapsed = performance.now() - t0;
			const message = err instanceof Error ? err.message : String(err);
			const outputBytes = new TextEncoder().encode(message).length;
			const footer = formatToolFooter({ toolName, elapsedMs: elapsed, outputBytes, isError: true });

			this._ringBuffer.record({ toolName, traceId, spanId, durationMs: elapsed, isError: true, timestamp: Date.now() });

			return createResponse(id, {
				content: [{ type: "text", text: `${message}\n\n${footer}` }],
				isError: true,
				_meta: buildResponseMeta(traceId, spanId, elapsed),
			});
		}
	}

	/** Append a rich formatted footer to the last text content block. */
	private _appendFooter(
		content: Array<{ type: string; text?: string }> | undefined,
		toolName: string,
		elapsedMs: number,
		metadata?: Record<string, unknown>,
		isError?: boolean,
	): void {
		if (!content?.length) return;
		const last = content[content.length - 1];
		if (last?.type === "text" && typeof last.text === "string") {
			const outputBytes = new TextEncoder().encode(last.text).length;
			const footer = formatToolFooter({ toolName, elapsedMs, outputBytes, metadata, isError });
			last.text += `\n\n${footer}`;
		}
	}

	/** Send a one-way JSON-RPC notification (no `id`, no response expected). */
	sendNotification(notification: JsonRpcNotification): void {
		if (this._stdioTransport) {
			this._stdioTransport.send(notification as unknown as JsonRpcResponse);
		} else if (this._sseTransport) {
			this._sseTransport.broadcast(notification as unknown as JsonRpcResponse);
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
