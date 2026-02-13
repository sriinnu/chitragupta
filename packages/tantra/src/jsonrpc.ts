/**
 * @chitragupta/tantra — JSON-RPC 2.0 helpers.
 *
 * Utility functions for creating, parsing, and validating JSON-RPC 2.0
 * messages used by the MCP protocol.
 */

import type {
	JsonRpcRequest,
	JsonRpcResponse,
	JsonRpcError,
	JsonRpcNotification,
} from "./types.js";

// ─── Standard Error Codes ───────────────────────────────────────────────────

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

// ─── Message Factories ─────────────────────────────────────────────────────

let _autoId = 0;

/**
 * Create a JSON-RPC 2.0 request.
 *
 * @param method - The RPC method name.
 * @param params - Optional parameter object.
 * @param id - Optional request ID; auto-increments if not provided.
 * @returns A well-formed JSON-RPC 2.0 request object.
 */
export function createRequest(
	method: string,
	params?: Record<string, unknown>,
	id?: string | number,
): JsonRpcRequest {
	// Wrap _autoId before exceeding MAX_SAFE_INTEGER to maintain integer precision
	if (_autoId >= Number.MAX_SAFE_INTEGER) _autoId = 0;
	return {
		jsonrpc: "2.0",
		id: id ?? ++_autoId,
		method,
		...(params !== undefined ? { params } : {}),
	};
}

/**
 * Create a JSON-RPC 2.0 success response.
 *
 * @param id - The request ID this response corresponds to.
 * @param result - The result payload.
 * @returns A well-formed JSON-RPC 2.0 response object.
 */
export function createResponse(
	id: string | number,
	result: unknown,
): JsonRpcResponse {
	return {
		jsonrpc: "2.0",
		id,
		result,
	};
}

/**
 * Create a JSON-RPC 2.0 error response.
 *
 * @param id - The request ID this error response corresponds to.
 * @param code - The JSON-RPC error code (e.g., -32601 for method not found).
 * @param message - A human-readable error description.
 * @param data - Optional additional error data.
 * @returns A well-formed JSON-RPC 2.0 error response object.
 */
export function createErrorResponse(
	id: string | number,
	code: number,
	message: string,
	data?: unknown,
): JsonRpcResponse {
	const error: JsonRpcError = { code, message };
	if (data !== undefined) {
		error.data = data;
	}
	return {
		jsonrpc: "2.0",
		id,
		error,
	};
}

/**
 * Create a JSON-RPC 2.0 notification (no id, no response expected).
 *
 * @param method - The RPC method name.
 * @param params - Optional parameter object.
 * @returns A well-formed JSON-RPC 2.0 notification object.
 */
export function createNotification(
	method: string,
	params?: Record<string, unknown>,
): JsonRpcNotification {
	return {
		jsonrpc: "2.0",
		method,
		...(params !== undefined ? { params } : {}),
	};
}

// ─── Type Guards ────────────────────────────────────────────────────────────

/** Union of all JSON-RPC 2.0 message types. */
export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

/**
 * Type guard: check if a raw parsed object has the shape of a JSON-RPC response.
 * A response has "id" and ("result" or "error"), but no "method".
 */
function hasResponseShape(msg: Record<string, unknown>): msg is Record<string, unknown> & JsonRpcResponse {
	return (
		"id" in msg &&
		(typeof msg.id === "string" || typeof msg.id === "number") &&
		(("result" in msg) !== ("error" in msg))
	);
}

/**
 * Type guard: check if a raw parsed object has the shape of a JSON-RPC request.
 * A request has "id" and "method".
 */
function hasRequestShape(msg: Record<string, unknown>): msg is Record<string, unknown> & JsonRpcRequest {
	return (
		"id" in msg &&
		(typeof msg.id === "string" || typeof msg.id === "number") &&
		"method" in msg &&
		typeof msg.method === "string"
	);
}

/**
 * Type guard: check if a raw parsed object has the shape of a JSON-RPC notification.
 * A notification has "method" but no "id".
 */
function hasNotificationShape(msg: Record<string, unknown>): msg is Record<string, unknown> & JsonRpcNotification {
	return (
		!("id" in msg) &&
		"method" in msg &&
		typeof msg.method === "string"
	);
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * Parse a raw string into a JSON-RPC 2.0 message.
 *
 * Uses structural type guards (not double-casts) to narrow the parsed
 * object into the correct discriminated union member.
 *
 * @param data - The raw JSON string to parse.
 * @returns A parsed request, response, or notification, or null if invalid.
 */
export function parseMessage(data: string): JsonRpcMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		return null;
	}

	if (typeof parsed !== "object" || parsed === null) {
		return null;
	}

	const msg = parsed as Record<string, unknown>;

	if (msg.jsonrpc !== "2.0") {
		return null;
	}

	// Response: has "id" and ("result" or "error")
	if (hasResponseShape(msg)) {
		return msg;
	}

	// Request: has "id" and "method"
	if (hasRequestShape(msg)) {
		return msg;
	}

	// Notification: has "method" but no "id"
	if (hasNotificationShape(msg)) {
		return msg;
	}

	return null;
}

// ─── Public Type Guards ─────────────────────────────────────────────────────

/**
 * Type guard: check if a message is a JSON-RPC request (has id + method).
 *
 * @param msg - The message to check.
 * @returns True if the message is a request.
 */
export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
	return "id" in msg && "method" in msg;
}

/**
 * Type guard: check if a message is a JSON-RPC response (has id + result/error).
 *
 * @param msg - The message to check.
 * @returns True if the message is a response.
 */
export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
	return "id" in msg && ("result" in msg || "error" in msg);
}

/**
 * Type guard: check if a message is a JSON-RPC notification (method but no id).
 *
 * @param msg - The message to check.
 * @returns True if the message is a notification.
 */
export function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
	return !("id" in msg) && "method" in msg;
}
