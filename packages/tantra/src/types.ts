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

/**
 * Supported MCP transports.
 *
 * `sse` is the legacy two-endpoint HTTP+SSE transport.
 * `streamable-http` is the newer single-endpoint MCP transport.
 */
export type McpTransport = "stdio" | "sse" | "streamable-http";

export interface McpAuthContext {
	keyId?: string;
	tenantId?: string;
	scopes: string[];
}

export interface McpAuthResult {
	authenticated: boolean;
	keyId?: string;
	tenantId?: string;
	scopes?: string[];
	error?: string;
}

export interface McpMethodAuthorization {
	allowed: boolean;
	requiredScope?: string;
	error?: string;
}

export interface McpRateLimitConfig {
	maxRequests: number;
	windowMs: number;
	exemptMethods?: string[];
}

/** Client-side bearer token config for SSE/HTTP MCP transports. */
export interface McpClientAuthConfig {
	token: string;
	headerName?: string;
	queryParam?: string;
}

/** Backward-compatible alias for older registry/client transport auth references. */
export type McpTransportAuthConfig = McpClientAuthConfig;

/** Server-side bridge auth + scope policy for SSE/HTTP MCP transports. */
export interface McpServerAuthConfig {
	required?: boolean;
	headerName?: string;
	bearerPrefix?: string;
	queryParam?: string;
	allowQueryToken?: boolean;
	validateToken(token: string): McpAuthResult;
	authorizeMethod?: (method: string, context: McpAuthContext) => McpMethodAuthorization;
	rateLimit?: McpRateLimitConfig;
}

// ─── MCP Server Config ─────────────────────────────────────────────────────

export interface McpServerConfig {
	name: string;
	version: string;
	transport: McpTransport;
	/** Port for the legacy HTTP+SSE transport. Defaults to 3001. */
	ssePort?: number;
	/** Host/interface for the legacy HTTP+SSE transport. Defaults to `127.0.0.1`. */
	sseHost?: string;
	/**
	 * Explicit allow-list for browser `Origin` headers on the legacy HTTP+SSE transport.
	 * Defaults to loopback origins only.
	 */
	sseAllowedOrigins?: string[];
	/** Port for the streamable HTTP transport. Defaults to 3001. */
	streamableHttpPort?: number;
	/** Host/interface for the streamable HTTP transport. Defaults to `127.0.0.1`. */
	streamableHttpHost?: string;
	/** Explicit allow-list for browser `Origin` headers on the streamable HTTP transport. */
	streamableHttpAllowedOrigins?: string[];
	/** Optional transport auth for SSE/HTTP exposure. Ignored for stdio. */
	auth?: McpServerAuthConfig;
	tools?: McpToolHandler[];
	resources?: McpResourceHandler[];
	prompts?: McpPromptHandler[];
	/**
	 * Optional fallback for missing tool names.
	 *
	 * Called when a `tools/call` request arrives for an unknown tool name.
	 * If a handler is returned, it is executed as the resolved tool.
	 */
	onToolNotFound?: (
		toolName: string,
		args: Record<string, unknown>,
	) => McpToolHandler | undefined | Promise<McpToolHandler | undefined>;
	/** Hook called after every tool execution. Use for session recording, analytics, etc. */
	onToolCall?: (info: { tool: string; args: Record<string, unknown>; result: McpToolResult; elapsedMs: number }) => void | Promise<void>;
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
	/** Optional transport auth for SSE/HTTP connections. Ignored for stdio. */
	auth?: McpClientAuthConfig;
}

// ─── Connection State ───────────────────────────────────────────────────────

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

// ─── Typed Tool Response Schemas ────────────────────────────────────────────

/** Typed response for the `vasana_tendencies` tool. */
export interface VasanaTendencyResult {
	tendency: string;
	valence: string;
	strength: number;
	stability: number;
	predictiveAccuracy: number;
	reinforcementCount: number;
	description: string;
}

/** Typed response for the `health_status` tool. */
export interface HealthStatusResult {
	state: { sattva: number; rajas: number; tamas: number };
	dominant: string;
	trend: { sattva: string; rajas: string; tamas: string };
	alerts: string[];
	history: Array<{
		timestamp: number;
		state: { sattva: number; rajas: number; tamas: number };
		dominant: string;
	}>;
}

/** Typed response for the `mesh_status` tool. */
export interface MeshStatusResult {
	running: boolean;
	actorCount: number;
	gossipAlive: number;
	peersConnected: number;
	nodeId: string | null;
}

// ─── OS Integration Surface Types ───────────────────────────────────────────

/** Public execution metadata included in MCP tool responses via `_meta`. */
export interface ToolExecutionMeta {
	/** 32-char hex trace identifier. */
	trace_id: string;
	/** 16-char hex span identifier. */
	span_id: string;
	/** Wall-clock execution time in milliseconds. */
	execution_ms: number;
	/** Sandbox/isolation metadata for the execution environment. */
	sandbox: {
		isolated: boolean;
		method: "worktree" | "docker" | "process" | "wasm";
		container_id?: string;
		policy?: "read-only" | "read-write" | "unrestricted";
	};
}

/** Recent tool call record for the in-memory ring buffer. */
export interface ToolCallRecord {
	/** Tool name that was invoked. */
	toolName: string;
	/** 32-char hex trace identifier. */
	traceId: string;
	/** 16-char hex span identifier. */
	spanId: string;
	/** Wall-clock execution time in milliseconds. */
	durationMs: number;
	/** Whether the tool call resulted in an error. */
	isError: boolean;
	/** Unix epoch timestamp (ms) of the call. */
	timestamp: number;
}

// ─── Realtime Event Re-exports ──────────────────────────────────────────────

export type {
	ChitraguptaEvent,
	ChitraguptaEventBase,
	ChitraguptaEventType,
} from "@chitragupta/sutra";

// ─── Tool Result Type Re-exports ────────────────────────────────────────────

export type {
	SessionListResult,
	SessionShowResult,
	MemorySearchResult,
	RecallResult,
	ContextResult,
	HandoverResult,
	HandoverSinceResult,
	MemoryChangesSinceResult,
	DayShowResult,
	DayListResult,
	DaySearchResult,
	SyncStatusResult,
	AtmanReportResult,
	ConsolidateResult,
	VidhisResult,
} from "./tool-result-types.js";
