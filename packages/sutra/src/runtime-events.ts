/**
 * RuntimeEventStream — Job lifecycle monitoring layer on top of EventBridge.
 *
 * Wraps the EventBridge fan-out hub to provide a high-level API for publishing,
 * subscribing, and querying job lifecycle events. Agents publish status
 * transitions (queued -> running -> completed/failed), consumers subscribe for
 * real-time updates, and late joiners can replay recent history.
 *
 * Internally uses the EventBridge ring buffer for storage and a custom
 * {@link BackpressureSink} that tracks per-subscriber pending counts and drops
 * the oldest events when the limit is exceeded.
 *
 * @module runtime-events
 */

import { randomUUID } from "node:crypto";
import { EventBridge } from "./event-bridge.js";
import type { ChitraguptaEvent, EventSink } from "./event-bridge-types.js";
import { RingBuffer } from "./ring-buffer.js";
import {
	TERMINAL_STATUSES,
	type ActiveJobSnapshot,
	type JobStatus,
	type RuntimeEventStreamConfig,
	type RuntimeJobEvent,
} from "./runtime-events-types.js";

// Re-export public types for convenience
export type {
	ActiveJobSnapshot,
	JobStatus,
	RuntimeEventStreamConfig,
	RuntimeJobEvent,
} from "./runtime-events-types.js";

// ─── Defaults ───────────────────────────────────────────────────────────────

/** Default number of events kept in the ring buffer. */
const DEFAULT_BUFFER_SIZE = 500;

/** Default maximum pending events per subscriber before backpressure drop. */
const DEFAULT_MAX_PENDING = 1000;

/** Default number of events replayed on reconnect. */
const DEFAULT_REPLAY_COUNT = 50;

// ─── BackpressureSink ───────────────────────────────────────────────────────

/** Handler callback for runtime job events. */
type RuntimeJobHandler = (event: RuntimeJobEvent) => void;

/**
 * Internal EventSink that delivers RuntimeJobEvents to a subscriber handler
 * while enforcing per-subscriber backpressure.
 *
 * When the pending event count exceeds `maxPending`, the oldest queued
 * events are dropped to make room.
 */
class BackpressureSink implements EventSink {
	readonly id: string;
	private readonly handler: RuntimeJobHandler;
	private readonly pending: RingBuffer<RuntimeJobEvent>;
	private readonly maxPending: number;
	private draining = false;

	constructor(handler: RuntimeJobHandler, maxPending: number, id?: string) {
		this.handler = handler;
		this.maxPending = maxPending;
		this.pending = new RingBuffer<RuntimeJobEvent>(maxPending);
		this.id = id ?? `bp-${randomUUID().slice(0, 8)}`;
	}

	/**
	 * Called by EventBridge on every emitted event. We only care about
	 * runtime job events (type "runtime:job"), silently ignoring others.
	 */
	deliver(event: ChitraguptaEvent): void {
		if (event.type !== "runtime:job") return;

		const jobEvent = event.payload as unknown as RuntimeJobEvent;
		if (!jobEvent) return;

		this.pending.push(jobEvent);
		this.drain();
	}

	/** Flush all pending events to the handler, oldest first. */
	private drain(): void {
		if (this.draining) return;
		this.draining = true;

		try {
			const events = this.pending.toArray();
			this.pending.clear();
			for (const evt of events) {
				try {
					this.handler(evt);
				} catch {
					// Subscriber threw — best-effort delivery, keep draining.
				}
			}
		} finally {
			this.draining = false;
		}
	}

	/** Expose pending count for testing/monitoring. */
	get pendingCount(): number {
		return this.pending.size;
	}
}

// ─── RuntimeEventStream ─────────────────────────────────────────────────────

/**
 * High-level runtime event stream for job lifecycle monitoring.
 *
 * Built on top of {@link EventBridge}, this class provides:
 * - `publish()` — emit job state transitions
 * - `subscribe()` — receive events in real time with backpressure
 * - `getJobHistory()` — query past events for a specific job
 * - `getActiveJobs()` — list all non-terminal jobs
 * - `replayRecent()` — replay recent events for reconnecting consumers
 *
 * @example
 * ```ts
 * const stream = new RuntimeEventStream();
 * const unsub = stream.subscribe((evt) => console.log(evt.jobId, evt.status));
 * stream.publish({ jobId: "j1", agentId: "a1", status: "running", progress: 50 });
 * unsub(); // unsubscribe
 * stream.destroy();
 * ```
 */
export class RuntimeEventStream {
	private readonly bridge: EventBridge;
	private readonly jobBuffer: RingBuffer<RuntimeJobEvent>;
	private readonly sinkMap = new Map<string, BackpressureSink>();
	private readonly activeJobs = new Map<string, ActiveJobSnapshot>();
	private readonly maxPending: number;
	private readonly replayCount: number;
	private destroyed = false;

	constructor(config?: RuntimeEventStreamConfig) {
		const bufSize = config?.bufferSize ?? DEFAULT_BUFFER_SIZE;
		this.maxPending = config?.maxPendingPerSink ?? DEFAULT_MAX_PENDING;
		this.replayCount = config?.reconnectReplayCount ?? DEFAULT_REPLAY_COUNT;

		this.bridge = new EventBridge({ recentBufferSize: bufSize });
		this.jobBuffer = new RingBuffer<RuntimeJobEvent>(bufSize);
	}

	/**
	 * Publish a job lifecycle event. The timestamp is auto-generated.
	 *
	 * @param event - Job event fields (timestamp is added automatically).
	 */
	publish(event: Omit<RuntimeJobEvent, "timestamp">): void {
		this.assertAlive();

		const timestamped: RuntimeJobEvent = {
			...event,
			timestamp: Date.now(),
		};

		// Track in local job buffer for history queries
		this.jobBuffer.push(timestamped);

		// Update active jobs tracker
		this.updateActiveJobs(timestamped);

		// Emit through the EventBridge for fan-out to all sinks
		const base = EventBridge.createBase(event.agentId);
		const bridgeEvent = {
			...base,
			type: "runtime:job" as const,
			payload: timestamped,
		};
		this.bridge.emit(bridgeEvent as unknown as ChitraguptaEvent);
	}

	/**
	 * Subscribe to runtime job events. Returns an unsubscribe function.
	 *
	 * Each subscriber gets its own backpressure-managed sink — if the
	 * subscriber falls behind by more than `maxPendingPerSink` events,
	 * the oldest pending events are dropped.
	 *
	 * @param handler - Callback invoked for each job event.
	 * @returns A function that, when called, removes the subscription.
	 */
	subscribe(handler: (event: RuntimeJobEvent) => void): () => void {
		this.assertAlive();

		const sink = new BackpressureSink(handler, this.maxPending);
		this.sinkMap.set(sink.id, sink);
		this.bridge.addSink(sink);

		return () => {
			this.sinkMap.delete(sink.id);
			this.bridge.removeSink(sink.id);
		};
	}

	/**
	 * Get the event history for a specific job, oldest first.
	 *
	 * @param jobId - The job to query.
	 * @param limit - Maximum events to return. Defaults to all.
	 * @returns Array of events for the specified job.
	 */
	getJobHistory(jobId: string, limit?: number): RuntimeJobEvent[] {
		const all = this.jobBuffer.toArray();
		const filtered = all.filter((e) => e.jobId === jobId);

		if (limit !== undefined && limit < filtered.length) {
			return filtered.slice(filtered.length - limit);
		}
		return filtered;
	}

	/**
	 * Get a snapshot of all jobs that are not in a terminal state
	 * (completed, failed, or cancelled).
	 *
	 * @returns Array of active job snapshots.
	 */
	getActiveJobs(): ActiveJobSnapshot[] {
		return [...this.activeJobs.values()];
	}

	/**
	 * Replay the most recent events for reconnecting consumers.
	 *
	 * @param count - Number of recent events to return. Defaults to
	 *   the `reconnectReplayCount` from config (default: 50).
	 * @returns Array of recent events, oldest first.
	 */
	replayRecent(count?: number): RuntimeJobEvent[] {
		const n = count ?? this.replayCount;
		return this.jobBuffer.toArray(n);
	}

	/**
	 * Tear down the stream — destroys the underlying EventBridge,
	 * clears all buffers and subscriptions.
	 */
	destroy(): void {
		this.bridge.destroy();
		this.jobBuffer.clear();
		this.sinkMap.clear();
		this.activeJobs.clear();
		this.destroyed = true;
	}

	/** Number of active subscribers. */
	get subscriberCount(): number {
		return this.sinkMap.size;
	}

	// ─── Private ──────────────────────────────────────────────────────────

	/**
	 * Track active jobs — add/update on non-terminal statuses,
	 * remove on terminal statuses.
	 */
	private updateActiveJobs(event: RuntimeJobEvent): void {
		if (TERMINAL_STATUSES.has(event.status)) {
			this.activeJobs.delete(event.jobId);
		} else {
			this.activeJobs.set(event.jobId, {
				jobId: event.jobId,
				status: event.status,
				lastUpdate: event.timestamp,
			});
		}
	}

	private assertAlive(): void {
		if (this.destroyed) {
			throw new Error("RuntimeEventStream has been destroyed.");
		}
	}
}
