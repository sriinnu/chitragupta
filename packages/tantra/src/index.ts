// @chitragupta/tantra — MCP Server & Client + Pluggable Registry
export * from "./types.js";
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
export { StdioServerTransport, StdioClientTransport } from "./transport/stdio.js";
export { SSEServerTransport, SSEClientTransport } from "./transport/sse.js";
export { McpServer } from "./server.js";
export { McpClient } from "./client.js";
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
export {
	ServerLifecycleManager,
	type StateChangeCallback,
	type ToolsChangedCallback,
} from "./server-lifecycle.js";
export {
	CapabilityAggregator,
	type NamespacedTool,
	type NamespacedResource,
	type ToolCallRoute,
	type ToolSearchResult,
} from "./capability-aggregator.js";
export {
	createMcpServerRegistry,
	type McpServerRegistry,
	type ServerFilter,
} from "./server-registry.js";
export {
	ServerDiscovery,
	type McpConfigSource,
	type DiscoverAllOptions,
	type DiscoveryEvent,
	type DiscoveryCallback,
} from "./server-discovery.js";

// Autonomous MCP management (self-healing, discovery, circuit breaker)
export { AutonomousMcpManager } from "./mcp-autonomous.js";
export type {
	AutonomousMcpConfig,
	SkillGeneratorCallback,
	QuarantineInfo,
	CircuitBreakerState,
	McpHealthReport,
} from "./mcp-autonomous.js";
