/**
 * EventBridge transport sinks.
 *
 * Three sink implementations for the three output transports:
 * - {@link McpNotificationSink} — JSON-RPC notification via MCP server
 * - {@link WebSocketSink} — WebSocket broadcast
 * - {@link SSEManagerSink} — SSE via EventManager
 *
 * @module event-bridge-sinks
 */

import { randomUUID } from "node:crypto";
import type { ChitraguptaEvent, EventSink } from "./event-bridge-types.js";

// ─── MCP Notification Sink ───────────────────────────────────────────────────

/** Callback type for sending a JSON-RPC notification via the MCP transport. */
export type McpNotificationSendFn = (notification: {
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
}) => void;

/**
 * Delivers events as JSON-RPC 2.0 notifications over the MCP transport.
 *
 * Uses the `notifications/event` method, matching the MCP spec for
 * server-initiated notifications.
 *
 * @example
 * ```ts
 * const sink = new McpNotificationSink((n) => server.sendNotification(n));
 * bridge.addSink(sink);
 * ```
 */
export class McpNotificationSink implements EventSink {
	readonly id: string;
	private readonly sendFn: McpNotificationSendFn;

	constructor(sendFn: McpNotificationSendFn, id?: string) {
		this.sendFn = sendFn;
		this.id = id ?? `mcp-${randomUUID().slice(0, 8)}`;
	}

	deliver(event: ChitraguptaEvent): void {
		this.sendFn({
			jsonrpc: "2.0",
			method: "notifications/event",
			params: {
				type: event.type,
				id: event.id,
				timestamp: event.timestamp,
				agentId: event.agentId,
				...(event.sessionId ? { sessionId: event.sessionId } : {}),
				...this.extractPayload(event),
			},
		});
	}

	/** Strip base fields to get event-specific payload. */
	private extractPayload(event: ChitraguptaEvent): Record<string, unknown> {
		const { id: _id, timestamp: _ts, agentId: _ag, sessionId: _sid, type: _type, ...rest } = event;
		return rest;
	}
}

// ─── WebSocket Sink ──────────────────────────────────────────────────────────

/** Callback type for broadcasting a typed message over WebSocket. */
export type WsBroadcastFn = (type: string, data: unknown) => void;

/**
 * Delivers events via WebSocket broadcast.
 *
 * Wraps a `broadcastFn(type, data)` callback — typically the
 * ws-handler's broadcast function.
 *
 * @example
 * ```ts
 * const sink = new WebSocketSink((type, data) => wss.clients.forEach(c => c.send(JSON.stringify({ type, data }))));
 * bridge.addSink(sink);
 * ```
 */
export class WebSocketSink implements EventSink {
	readonly id: string;
	private readonly broadcastFn: WsBroadcastFn;

	constructor(broadcastFn: WsBroadcastFn, id?: string) {
		this.broadcastFn = broadcastFn;
		this.id = id ?? `ws-${randomUUID().slice(0, 8)}`;
	}

	deliver(event: ChitraguptaEvent): void {
		this.broadcastFn(event.type, event);
	}
}

// ─── SSE Manager Sink ────────────────────────────────────────────────────────

/** Callback type for broadcasting an SSE event. */
export type SseBroadcastFn = (event: string, data: unknown) => void;

/**
 * Delivers events via SSE through the EventManager's broadcastSSE.
 *
 * Wraps an `(event, data) => void` callback — typically bound to
 * `eventManager.broadcastSSE(event, data)`.
 *
 * @example
 * ```ts
 * const sink = new SSEManagerSink((evt, data) => eventManager.broadcastSSE(evt, data));
 * bridge.addSink(sink);
 * ```
 */
export class SSEManagerSink implements EventSink {
	readonly id: string;
	private readonly broadcastFn: SseBroadcastFn;

	constructor(broadcastFn: SseBroadcastFn, id?: string) {
		this.broadcastFn = broadcastFn;
		this.id = id ?? `sse-${randomUUID().slice(0, 8)}`;
	}

	deliver(event: ChitraguptaEvent): void {
		this.broadcastFn(event.type, event);
	}
}
