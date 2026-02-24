/**
 * Realtime event types for Chitragupta's EventBridge.
 *
 * Defines a discriminated union of all realtime events that flow through
 * the system, plus the {@link EventSink} transport interface and
 * {@link EventBridgeConfig} configuration.
 *
 * @module event-bridge-types
 */

// ─── Base Event ──────────────────────────────────────────────────────────────

/** Base fields present on every Chitragupta realtime event. */
export interface ChitraguptaEventBase {
	/** Unique event identifier (UUID). */
	id: string;
	/** Epoch milliseconds when the event was emitted. */
	timestamp: number;
	/** The agent that produced this event. */
	agentId: string;
	/** Session the event belongs to (if applicable). */
	sessionId?: string;
}

// ─── Event Discriminated Union ───────────────────────────────────────────────

/** All realtime event types as a discriminated union on `type`. */
export type ChitraguptaEvent =
	| ChitraguptaEventBase & { type: "stream:text"; text: string }
	| ChitraguptaEventBase & { type: "stream:thinking"; text: string }
	| ChitraguptaEventBase & { type: "tool:start"; toolName: string; input: Record<string, unknown> }
	| ChitraguptaEventBase & { type: "tool:done"; toolName: string; durationMs: number; isError: boolean }
	| ChitraguptaEventBase & { type: "turn:start"; turnNumber: number }
	| ChitraguptaEventBase & { type: "turn:done"; turnNumber: number }
	| ChitraguptaEventBase & { type: "session:handover"; cursor: number }
	| ChitraguptaEventBase & { type: "memory:change"; changeType: "create" | "update" | "delete"; scope: string }
	| ChitraguptaEventBase & { type: "runtime:job"; payload: Record<string, unknown> };

/** Extract the `type` field from the event union. */
export type ChitraguptaEventType = ChitraguptaEvent["type"];

// ─── Transport Sink ──────────────────────────────────────────────────────────

/**
 * Transport sink — delivers realtime events to an output channel.
 *
 * Implementations bridge the EventBridge to a specific transport:
 * MCP notifications, WebSocket broadcasts, or SSE streams.
 */
export interface EventSink {
	/** Unique sink identifier for removal. */
	readonly id: string;
	/** Deliver a single event to this sink's transport. */
	deliver(event: ChitraguptaEvent): void;
}

// ─── Configuration ───────────────────────────────────────────────────────────

/** EventBridge configuration. */
export interface EventBridgeConfig {
	/** Number of recent events to keep in the ring buffer. Default: 200. */
	recentBufferSize?: number;
}
