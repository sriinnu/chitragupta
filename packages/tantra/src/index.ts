// @chitragupta/tantra — MCP Server & Client + Pluggable Registry

/** MCP protocol types (Tool, Resource, Prompt, and JSON-RPC primitives). */
export * from "./types.js";
/** JSON-RPC 2.0 message creation, parsing, and standard error codes. */
export {
	createRequest,
	createResponse,
	createErrorResponse,
	createNotification,
	parseMessage,
	isRequest,
	isResponse,
	isNotification,
	PARSE_ERROR,
	INVALID_REQUEST,
	METHOD_NOT_FOUND,
	INVALID_PARAMS,
	INTERNAL_ERROR,
	type JsonRpcMessage,
} from "./jsonrpc.js";
/** Stdio-based transport for MCP server and client communication. */
export { StdioServerTransport, StdioClientTransport } from "./transport/stdio.js";
/** SSE-based transport for MCP server and client over HTTP. */
export { SSEServerTransport, SSEClientTransport } from "./transport/sse.js";
/** MCP server that exposes tools, resources, and prompts over JSON-RPC. */
export { McpServer } from "./server.js";
/** MCP client that connects to remote servers and invokes their tools. */
export { McpClient } from "./client.js";
/** Bidirectional bridge between Chitragupta tool format and MCP tool format. */
export {
	chitraguptaToolToMcp,
	mcpToolToChitragupta,
	exposeChitraguptaTools,
	importMcpTools,
	importRegistryTools,
	type ChitraguptaToolHandler,
	type ChitraguptaToolDefinition,
	type ChitraguptaToolContext,
	type ChitraguptaToolResult,
} from "./bridge.js";

// ─── Pluggable MCP Architecture ───────────────────────────────────────────
/** Typed MCP error hierarchy for transport, protocol, health, and timeout failures. */
export {
	McpError,
	McpNotFoundError,
	McpHealthError,
	McpTimeoutError,
	McpTransportError,
	McpProtocolError,
	McpServerCrashedError,
} from "./mcp-errors.js";
export {
	type ServerState,
	VALID_TRANSITIONS,
	type McpRemoteServerConfig,
	type HealthCheckConfig,
	type ManagedServerInfo,
	type ServerStats,
	type RegistryEvent,
	type RegistryEventListener,
	DEFAULT_HEALTH_CONFIG,
	DEFAULT_TIMEOUT,
	DEFAULT_MAX_RESTARTS,
	MAX_RESTART_BACKOFF,
} from "./registry-types.js";
/** Lifecycle manager for MCP servers with state transitions and health checks. */
export {
	ServerLifecycleManager,
	type StateChangeCallback,
	type ToolsChangedCallback,
} from "./server-lifecycle.js";
/** Aggregate tools and resources across multiple MCP servers with namespacing. */
export {
	CapabilityAggregator,
	type NamespacedTool,
	type NamespacedResource,
	type ToolCallRoute,
	type ToolSearchResult,
} from "./capability-aggregator.js";
/** Registry for managing multiple MCP server connections with filtering. */
export {
	createMcpServerRegistry,
	type McpServerRegistry,
	type ServerFilter,
} from "./server-registry.js";
/** Auto-discover MCP servers from Claude, Cursor, and custom config files. */
export {
	ServerDiscovery,
	type McpConfigSource,
	type DiscoverAllOptions,
	type DiscoveryEvent,
	type DiscoveryCallback,
} from "./server-discovery.js";

/** Self-healing MCP manager with circuit breaker, auto-restart, and quarantine. */
export { AutonomousMcpManager } from "./mcp-autonomous.js";
export type {
	AutonomousMcpConfig,
	SkillGeneratorCallback,
	QuarantineInfo,
	CircuitBreakerState,
	McpHealthReport,
} from "./mcp-autonomous.js";

/** Typed result interfaces for MCP tool responses. */
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

/** Realtime event types re-exported from sutra for consumer convenience. */
export type {
	ChitraguptaEvent,
	ChitraguptaEventBase,
	ChitraguptaEventType,
} from "@chitragupta/sutra";
