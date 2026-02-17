/**
 * @chitragupta/tantra — MCP Client.
 *
 * Connects to an MCP server to discover and invoke tools, resources, and prompts.
 * Supports stdio and SSE transports.
 */

import type {
	JsonRpcRequest,
	JsonRpcResponse,
	JsonRpcNotification,
	McpClientConfig,
	McpTool,
	McpToolResult,
	McpResource,
	McpPrompt,
	McpContent,
	ServerInfo,
	ConnectionState,
} from "./types.js";
import { createRequest, isResponse } from "./jsonrpc.js";
import { StdioClientTransport } from "./transport/stdio.js";
import { SSEClientTransport } from "./transport/sse.js";

type AnyMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

interface PendingRequest {
	resolve: (result: unknown) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * MCP Client -- connects to an MCP server and provides access to its
 * tools, resources, and prompts.
 *
 * Supports stdio and SSE transports. Performs an initialize handshake on
 * connect, then provides async methods to discover and invoke server
 * capabilities.
 *
 * @example
 * ```ts
 * const client = new McpClient({ transport: "stdio", serverCommand: "node", serverArgs: ["server.js"] });
 * const info = await client.connect();
 * const tools = await client.listTools();
 * await client.disconnect();
 * ```
 */
export class McpClient {
	private _config: McpClientConfig;
	private _state: ConnectionState = "disconnected";
	private _serverInfo: ServerInfo | null = null;
	private _stdioTransport: StdioClientTransport | null = null;
	private _sseTransport: SSEClientTransport | null = null;
	private _pending: Map<string | number, PendingRequest> = new Map();
	private _notificationHandlers: Array<(n: JsonRpcNotification) => void> = [];
	private _idCounter = 0;
	private _timeout: number;

	constructor(config: McpClientConfig) {
		this._config = config;
		this._timeout = config.timeout ?? 30_000;
	}

	// ─── Connection ───────────────────────────────────────────────────────

	/**
	 * Connect to the MCP server and perform the initialize handshake.
	 *
	 * @returns The server info (name, version, capabilities) on success.
	 * @throws If the connection or handshake fails.
	 */
	async connect(): Promise<ServerInfo> {
		this._state = "connecting";

		try {
			if (this._config.transport === "stdio") {
				await this._connectStdio();
			} else if (this._config.transport === "sse") {
				await this._connectSSE();
			}

			// Perform MCP initialize handshake
			const result = await this._sendRequest("initialize", {
				protocolVersion: "2024-11-05",
				clientInfo: {
					name: "chitragupta-mcp-client",
					version: "0.1.0",
				},
				capabilities: {},
			}) as Record<string, unknown>;

			this._serverInfo = {
				name: (result.serverInfo as Record<string, unknown>)?.name as string ?? "unknown",
				version: (result.serverInfo as Record<string, unknown>)?.version as string ?? "0.0.0",
				capabilities: (result.capabilities as ServerInfo["capabilities"]) ?? {},
			};

			// Send initialized notification
			this._sendNotification("notifications/initialized", {});

			this._state = "connected";
			return this._serverInfo;
		} catch (err) {
			this._state = "error";
			throw err;
		}
	}

	/**
	 * Disconnect from the MCP server.
	 */
	async disconnect(): Promise<void> {
		// Reject all pending requests
		for (const [, pending] of this._pending) {
			clearTimeout(pending.timer);
			pending.reject(new Error("Client disconnected"));
		}
		this._pending.clear();

		if (this._stdioTransport) {
			this._stdioTransport.disconnect();
			this._stdioTransport = null;
		}
		if (this._sseTransport) {
			this._sseTransport.disconnect();
			this._sseTransport = null;
		}

		this._state = "disconnected";
		this._serverInfo = null;
	}

	// ─── Discovery ────────────────────────────────────────────────────────

	/**
	 * List all tools available on the MCP server.
	 *
	 * @returns Array of tool definitions.
	 */
	async listTools(): Promise<McpTool[]> {
		const result = await this._sendRequest("tools/list") as Record<string, unknown> | undefined;
		const tools = (result as Record<string, unknown>)?.tools;
		return Array.isArray(tools) ? tools as McpTool[] : [];
	}

	/**
	 * List all resources available on the MCP server.
	 *
	 * @returns Array of resource definitions.
	 */
	async listResources(): Promise<McpResource[]> {
		const result = await this._sendRequest("resources/list") as Record<string, unknown> | undefined;
		const resources = (result as Record<string, unknown>)?.resources;
		return Array.isArray(resources) ? resources as McpResource[] : [];
	}

	/**
	 * List all prompts available on the MCP server.
	 *
	 * @returns Array of prompt definitions.
	 */
	async listPrompts(): Promise<McpPrompt[]> {
		const result = await this._sendRequest("prompts/list") as Record<string, unknown> | undefined;
		const prompts = (result as Record<string, unknown>)?.prompts;
		return Array.isArray(prompts) ? prompts as McpPrompt[] : [];
	}

	// ─── Execution ────────────────────────────────────────────────────────

	/**
	 * Call a tool on the MCP server.
	 *
	 * @param name - The tool name.
	 * @param args - The tool arguments.
	 * @returns The tool result with content array and optional error flag.
	 */
	async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
		const result = await this._sendRequest("tools/call", { name, arguments: args }) as Record<string, unknown> | undefined;
		// Validate the response shape — MCP servers may return unexpected formats
		const content = (result as Record<string, unknown>)?.content;
		return {
			content: Array.isArray(content) ? content as McpContent[] : [],
			isError: (result as Record<string, unknown>)?.isError === true,
		};
	}

	/**
	 * Read a resource from the MCP server.
	 *
	 * @param uri - The resource URI.
	 * @returns Array of content objects.
	 */
	async readResource(uri: string): Promise<McpContent[]> {
		const result = await this._sendRequest("resources/read", { uri }) as Record<string, unknown> | undefined;
		const contents = (result as Record<string, unknown>)?.contents;
		return Array.isArray(contents) ? contents as McpContent[] : [];
	}

	/**
	 * Get a prompt from the MCP server.
	 *
	 * @param name - The prompt name.
	 * @param args - Optional prompt arguments.
	 * @returns Array of content objects from the first message.
	 */
	async getPrompt(name: string, args?: Record<string, string>): Promise<McpContent[]> {
		const params: Record<string, unknown> = { name };
		if (args) {
			params.arguments = args;
		}
		const result = await this._sendRequest("prompts/get", params) as Record<string, unknown> | undefined;
		const messages = (result as Record<string, unknown>)?.messages;
		if (Array.isArray(messages) && messages.length > 0) {
			const content = (messages[0] as Record<string, unknown>)?.content;
			return Array.isArray(content) ? content as McpContent[] : [];
		}
		return [];
	}

	// ─── State ────────────────────────────────────────────────────────────

	/**
	 * Get the current connection state.
	 *
	 * @returns One of "disconnected", "connecting", "connected", or "error".
	 */
	getState(): ConnectionState {
		return this._state;
	}

	/**
	 * Get the server info (available after connect).
	 *
	 * @returns The server info, or null if not yet connected.
	 */
	getServerInfo(): ServerInfo | null {
		return this._serverInfo;
	}

	// ─── Notifications ───────────────────────────────────────────────────

	/**
	 * Register a handler for server notifications (e.g., tools/list_changed).
	 *
	 * @param handler - Callback invoked for each notification from the server.
	 */
	onNotification(handler: (n: JsonRpcNotification) => void): void {
		this._notificationHandlers.push(handler);
	}

	// ─── Internal ─────────────────────────────────────────────────────────

	/**
	 * Connect via stdio transport — spawns the server process.
	 */
	private async _connectStdio(): Promise<void> {
		if (!this._config.serverCommand) {
			throw new Error("McpClient: serverCommand is required for stdio transport");
		}

		this._stdioTransport = new StdioClientTransport();
		this._stdioTransport.onMessage((msg) => this._onMessage(msg));
		this._stdioTransport.connect(
			this._config.serverCommand,
			this._config.serverArgs ?? [],
		);
	}

	/**
	 * Connect via SSE transport.
	 */
	private async _connectSSE(): Promise<void> {
		if (!this._config.serverUrl) {
			throw new Error("McpClient: serverUrl is required for SSE transport");
		}

		this._sseTransport = new SSEClientTransport();
		this._sseTransport.onMessage((msg) => this._onMessage(msg));
		await this._sseTransport.connect(this._config.serverUrl);
	}

	/**
	 * Handle an incoming message (match it to a pending request).
	 */
	private _onMessage(msg: AnyMessage): void {
		if (!isResponse(msg)) {
			// Handle server notifications
			if ("method" in msg && (msg as JsonRpcNotification).method) {
				this._notificationHandlers.forEach((h) => h(msg as JsonRpcNotification));
			}
			return;
		}

		const pending = this._pending.get(msg.id);
		if (!pending) return;

		this._pending.delete(msg.id);
		clearTimeout(pending.timer);

		if (msg.error) {
			pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
		} else {
			pending.resolve(msg.result);
		}
	}

	/**
	 * Send a JSON-RPC request and return a promise for the result.
	 */
	private _sendRequest(
		method: string,
		params?: Record<string, unknown>,
	): Promise<unknown> {
		const id = this._nextId();
		const request = createRequest(method, params, id);

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this._pending.delete(id);
				reject(new Error(`McpClient: request timed out after ${this._timeout}ms: ${method}`));
			}, this._timeout);

			this._pending.set(id, { resolve, reject, timer });

			try {
				if (this._stdioTransport) {
					this._stdioTransport.send(request);
				} else if (this._sseTransport) {
					this._sseTransport.send(request).catch((err) => {
						this._pending.delete(id);
						clearTimeout(timer);
						reject(err);
					});
				} else {
					clearTimeout(timer);
					this._pending.delete(id);
					reject(new Error("McpClient: no transport connected"));
				}
			} catch (err) {
				this._pending.delete(id);
				clearTimeout(timer);
				reject(err);
			}
		});
	}

	/**
	 * Send a notification (no response expected).
	 */
	private _sendNotification(method: string, params?: Record<string, unknown>): void {
		const notification = {
			jsonrpc: "2.0" as const,
			method,
			...(params !== undefined ? { params } : {}),
		};

		if (this._stdioTransport) {
			this._stdioTransport.send(notification);
		} else if (this._sseTransport) {
			this._sseTransport.send(notification).catch(() => {
				// Notifications are fire-and-forget
			});
		}
	}

	/**
	 * Generate the next request ID.
	 */
	private _nextId(): number {
		return ++this._idCounter;
	}
}
