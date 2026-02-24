/**
 * EventBridge — Lightweight fan-out hub for realtime events.
 *
 * Accepts events from agent subsystems, fans them out to all registered
 * {@link EventSink} instances, and keeps a ring buffer of recent events
 * for late-joining consumers.
 *
 * Uses the shared {@link RingBuffer} from `ring-buffer.ts`.
 *
 * @module event-bridge
 */

import { randomUUID } from "node:crypto";
import { RingBuffer } from "./ring-buffer.js";
import type {
	ChitraguptaEvent,
	ChitraguptaEventBase,
	ChitraguptaEventType,
	EventBridgeConfig,
	EventSink,
} from "./event-bridge-types.js";

/** Default ring buffer size for recent events. */
const DEFAULT_BUFFER_SIZE = 200;

/**
 * Fan-out event hub that distributes realtime events to transport sinks.
 *
 * @example
 * ```ts
 * const bridge = new EventBridge();
 * bridge.addSink(myMcpSink);
 * bridge.emit({ type: "tool:start", toolName: "grep", input: {}, ...base });
 * ```
 */
export class EventBridge {
	private readonly sinks: EventSink[] = [];
	private readonly recent: RingBuffer<ChitraguptaEvent>;
	private destroyed = false;

	constructor(config?: EventBridgeConfig) {
		const size = config?.recentBufferSize ?? DEFAULT_BUFFER_SIZE;
		this.recent = new RingBuffer<ChitraguptaEvent>(size);
	}

	/**
	 * Register a transport sink. Events will be delivered to it in order.
	 *
	 * @param sink - The sink to add.
	 */
	addSink(sink: EventSink): void {
		this.assertAlive();
		if (!this.sinks.some((s) => s.id === sink.id)) {
			this.sinks.push(sink);
		}
	}

	/**
	 * Remove a transport sink by its ID.
	 *
	 * @param sinkId - The ID of the sink to remove.
	 */
	removeSink(sinkId: string): void {
		const idx = this.sinks.findIndex((s) => s.id === sinkId);
		if (idx >= 0) this.sinks.splice(idx, 1);
	}

	/**
	 * Emit a realtime event. Fans out to all registered sinks and
	 * pushes the event into the recent-events ring buffer.
	 *
	 * @param event - The fully constructed event to emit.
	 */
	emit(event: ChitraguptaEvent): void {
		this.assertAlive();
		this.recent.push(event);
		for (const sink of this.sinks) {
			try {
				sink.deliver(event);
			} catch {
				// Best-effort delivery — don't let one broken sink block others.
			}
		}
	}

	/**
	 * Convenience helper to build a base event object from agent context.
	 *
	 * @param agentId - The emitting agent's ID.
	 * @param sessionId - Optional session context.
	 * @returns A base event with generated `id` and `timestamp`.
	 */
	static createBase(agentId: string, sessionId?: string): ChitraguptaEventBase {
		return {
			id: randomUUID(),
			timestamp: Date.now(),
			agentId,
			sessionId,
		};
	}

	/**
	 * Convenience to build and emit a typed event in one call.
	 *
	 * @param agentId - The emitting agent's ID.
	 * @param type - The event type discriminator.
	 * @param payload - Event-specific fields (excluding base fields).
	 * @param sessionId - Optional session context.
	 */
	emitTyped<T extends ChitraguptaEventType>(
		agentId: string,
		type: T,
		payload: Omit<Extract<ChitraguptaEvent, { type: T }>, keyof ChitraguptaEventBase | "type">,
		sessionId?: string,
	): void {
		const base = EventBridge.createBase(agentId, sessionId);
		const event = { ...base, type, ...payload } as unknown as ChitraguptaEvent;
		this.emit(event);
	}

	/**
	 * Get recent events from the ring buffer, oldest first.
	 *
	 * @param limit - Maximum events to return. Defaults to all buffered.
	 * @returns Array of recent events.
	 */
	getRecentEvents(limit?: number): ChitraguptaEvent[] {
		return this.recent.toArray(limit);
	}

	/** Get the number of registered sinks. */
	get sinkCount(): number {
		return this.sinks.length;
	}

	/** Tear down the bridge — removes all sinks and clears the buffer. */
	destroy(): void {
		this.sinks.length = 0;
		this.recent.clear();
		this.destroyed = true;
	}

	private assertAlive(): void {
		if (this.destroyed) {
			throw new Error("EventBridge has been destroyed.");
		}
	}
}
