/**
 * @chitragupta/daemon — JSON-RPC 2.0 protocol types and NDJSON framing.
 *
 * Minimal, self-contained — no dependency on tantra/MCP.
 * Wire format: newline-delimited JSON (one message per line).
 *
 * @module
 */

/** JSON-RPC 2.0 request (client → daemon). */
export interface RpcRequest {
	jsonrpc: "2.0";
	id: string | number;
	method: string;
	params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 response (daemon → client). */
export interface RpcResponse {
	jsonrpc: "2.0";
	id: string | number;
	result?: unknown;
	error?: RpcError;
}

/** JSON-RPC 2.0 notification (no id, no response expected). */
export interface RpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 error object. */
export interface RpcError {
	code: number;
	message: string;
	data?: unknown;
}

/** Union of all message types on the wire. */
export type RpcMessage = RpcRequest | RpcResponse | RpcNotification;

/** Standard JSON-RPC error codes. */
export const ErrorCode = {
	ParseError: -32700,
	InvalidRequest: -32600,
	MethodNotFound: -32601,
	InvalidParams: -32602,
	InternalError: -32603,
} as const;

/** Create a JSON-RPC request. */
export function createRequest(method: string, params?: Record<string, unknown>, id?: string | number): RpcRequest {
	return { jsonrpc: "2.0", id: id ?? crypto.randomUUID(), method, params };
}

/** Create a success response. */
export function createResponse(id: string | number, result: unknown): RpcResponse {
	return { jsonrpc: "2.0", id, result };
}

/** Create an error response. */
export function createErrorResponse(id: string | number, code: number, message: string, data?: unknown): RpcResponse {
	return { jsonrpc: "2.0", id, error: { code, message, data } };
}

/** Type guard: is this a request (has id + method)? */
export function isRequest(msg: RpcMessage): msg is RpcRequest {
	return "method" in msg && "id" in msg;
}

/** Type guard: is this a notification (has method, no id)? */
export function isNotification(msg: RpcMessage): msg is RpcNotification {
	return "method" in msg && !("id" in msg);
}

/** Parse a single JSON line into an RPC message. Returns null on invalid JSON. */
export function parseMessage(line: string): RpcMessage | null {
	try {
		const parsed = JSON.parse(line) as Record<string, unknown>;
		if (parsed.jsonrpc !== "2.0") return null;
		return parsed as unknown as RpcMessage;
	} catch {
		return null;
	}
}

/** Serialize an RPC message to NDJSON (with trailing newline). */
export function serialize(msg: RpcMessage): string {
	return JSON.stringify(msg) + "\n";
}
