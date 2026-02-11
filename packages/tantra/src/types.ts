/**
 * @chitragupta/tantra — MCP (Model Context Protocol) types.
 *
 * Defines JSON-RPC 2.0, MCP server/client configuration, tools,
 * resources, prompts, and transport types.
 */

// ─── JSON-RPC 2.0 ──────────────────────────────────────────────────────────

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: string | number;
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: string | number;
	result?: unknown;
	error?: JsonRpcError;
}

export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

export interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
}

// ─── MCP Server Info ────────────────────────────────────────────────────────

export interface ServerInfo {
	name: string;
	version: string;
	capabilities: ServerCapabilities;
}

export interface ServerCapabilities {
	tools?: { listChanged?: boolean };
	resources?: { subscribe?: boolean; listChanged?: boolean };
	prompts?: { listChanged?: boolean };
}

// ─── MCP Tools ──────────────────────────────────────────────────────────────

export interface McpTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface McpToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

export interface McpToolResult {
	content: McpContent[];
	isError?: boolean;
	/** Internal — tool metadata for formatting. Stripped before sending over wire. */
	_metadata?: Record<string, unknown>;
}

export type McpContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string }
	| { type: "resource"; uri: string; text?: string; mimeType?: string };

// ─── MCP Resources ─────────────────────────────────────────────────────────

export interface McpResource {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

export interface McpResourceTemplate {
	uriTemplate: string;
	name: string;
	description?: string;
	mimeType?: string;
}

// ─── MCP Prompts ────────────────────────────────────────────────────────────

export interface McpPrompt {
	name: string;
	description?: string;
	arguments?: McpPromptArgument[];
}

export interface McpPromptArgument {
	name: string;
	description?: string;
	required?: boolean;
}

// ─── Transport ──────────────────────────────────────────────────────────────

export type McpTransport = "stdio" | "sse";

// ─── MCP Server Config ─────────────────────────────────────────────────────

export interface McpServerConfig {
	name: string;
	version: string;
	transport: McpTransport;
	/** Port for the SSE transport. Defaults to 3001. */
	ssePort?: number;
	tools?: McpToolHandler[];
	resources?: McpResourceHandler[];
	prompts?: McpPromptHandler[];
}

export interface McpToolHandler {
	definition: McpTool;
	execute(args: Record<string, unknown>): Promise<McpToolResult>;
}

export interface McpResourceHandler {
	definition: McpResource | McpResourceTemplate;
	read(uri: string): Promise<McpContent[]>;
}

export interface McpPromptHandler {
	definition: McpPrompt;
	get(args: Record<string, string>): Promise<McpContent[]>;
}

// ─── MCP Client Config ─────────────────────────────────────────────────────

export interface McpClientConfig {
	serverCommand?: string;
	serverArgs?: string[];
	serverUrl?: string;
	transport: McpTransport;
	timeout?: number;
}

// ─── Connection State ───────────────────────────────────────────────────────

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";
