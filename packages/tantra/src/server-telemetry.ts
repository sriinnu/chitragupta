/**
 * @chitragupta/tantra — Server telemetry (ring buffer + trace helpers).
 *
 * Extracted from server.ts to keep it under 450 LOC.
 * Manages the in-memory ring buffer of recent tool calls and
 * provides trace ID extraction from MCP request metadata.
 *
 * @module
 */

import type { ToolCallRecord } from "./types.js";
import { generateTraceId, generateSpanId } from "@chitragupta/core";
import { formatToolFooter } from "@chitragupta/ui/tool-formatter";

/** Maximum number of recent calls retained in the ring buffer. */
const MAX_RECENT_CALLS = 50;

/**
 * In-memory ring buffer for recent tool call records.
 *
 * Used by the `chitragupta://tools/recent` MCP resource and
 * the `_meta` trace propagation in tool responses.
 */
export class ToolCallRingBuffer {
	private readonly _calls: ToolCallRecord[] = [];

	/** Push a record, evicting the oldest if the buffer is full. */
	record(entry: ToolCallRecord): void {
		this._calls.push(entry);
		if (this._calls.length > MAX_RECENT_CALLS) {
			this._calls.shift();
		}
	}

	/** Return a snapshot of all records (oldest first). */
	getAll(): ToolCallRecord[] {
		return [...this._calls];
	}

	/** Current number of records. */
	get size(): number {
		return this._calls.length;
	}
}

/**
 * Extract or generate trace context from MCP request params.
 *
 * If the client sent `_meta.trace_id` (32-char hex), it is reused.
 * Otherwise, a fresh trace ID is generated. A span ID is always generated.
 *
 * @param params - The raw JSON-RPC request params.
 * @returns Tuple of [traceId, spanId].
 */
export function resolveTraceContext(
	params?: Record<string, unknown>,
): [traceId: string, spanId: string] {
	const meta = params?._meta as Record<string, unknown> | undefined;
	const traceId = (typeof meta?.trace_id === "string" && meta.trace_id.length === 32)
		? meta.trace_id
		: generateTraceId();
	return [traceId, generateSpanId()];
}

/**
 * Build the public `_meta` object for MCP tool responses.
 *
 * @param traceId - 32-char hex trace identifier.
 * @param spanId - 16-char hex span identifier.
 * @param executionMs - Wall-clock execution time.
 */
export function buildResponseMeta(
	traceId: string,
	spanId: string,
	executionMs: number,
): Record<string, unknown> {
	return {
		trace_id: traceId,
		span_id: spanId,
		execution_ms: Math.round(executionMs * 100) / 100,
		sandbox: { isolated: false, method: "process" },
	};
}

/**
 * Append a rich formatted footer to the last text content block.
 * Includes tool name, execution time, output size, and optional metadata.
 */
export function appendToolFooter(
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
