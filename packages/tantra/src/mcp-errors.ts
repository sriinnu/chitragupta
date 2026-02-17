/**
 * @chitragupta/tantra — Custom error hierarchy for MCP operations.
 *
 * All MCP-specific errors extend McpError, providing structured error
 * codes and semantic subtypes for transport failures, timeouts,
 * protocol violations, and server crashes.
 */

/**
 * Base error class for all MCP operations.
 * Carries an optional numeric code aligned with JSON-RPC error codes.
 */
export class McpError extends Error {
	constructor(message: string, public readonly code?: number) {
		super(message);
		this.name = "McpError";
	}
}

/**
 * Thrown when a requested MCP server, tool, resource, or prompt
 * cannot be found in the registry.
 */
export class McpNotFoundError extends McpError {
	constructor(message: string) {
		super(message, -32001);
		this.name = "McpNotFoundError";
	}
}

/**
 * Thrown when a health check fails or a server is deemed unhealthy
 * after exceeding the consecutive failure threshold.
 */
export class McpHealthError extends McpError {
	constructor(message: string) {
		super(message, -32002);
		this.name = "McpHealthError";
	}
}

/**
 * Thrown when an operation exceeds its configured timeout duration.
 */
export class McpTimeoutError extends McpError {
	constructor(message: string, public readonly timeoutMs: number) {
		super(message, -32003);
		this.name = "McpTimeoutError";
	}
}

/**
 * Thrown when the underlying transport (stdio pipe, SSE connection)
 * encounters a failure during communication.
 */
export class McpTransportError extends McpError {
	constructor(message: string) {
		super(message, -32004);
		this.name = "McpTransportError";
	}
}

/**
 * Thrown when the MCP protocol contract is violated — for example,
 * an invalid state transition or malformed handshake response.
 */
export class McpProtocolError extends McpError {
	constructor(message: string) {
		super(message, -32005);
		this.name = "McpProtocolError";
	}
}

/**
 * Thrown when an MCP server process exits unexpectedly or becomes
 * unresponsive beyond recovery thresholds.
 */
export class McpServerCrashedError extends McpError {
	constructor(message: string, public readonly serverId: string) {
		super(message, -32006);
		this.name = "McpServerCrashedError";
	}
}
