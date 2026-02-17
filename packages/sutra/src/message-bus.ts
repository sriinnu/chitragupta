/**
 * Sandesh — In-process message bus for cross-package communication.
 * Sanskrit: Sandesh (सन्देश) = message, communication.
 *
 * Provides a typed pub/sub event bus that allows packages to communicate
 * without direct imports. Supports wildcard subscriptions, once-only
 * handlers, and priority ordering.
 *
 * The bus is the nervous system of the Chitragupta platform — signals
 * propagate between packages like prana (प्राण) through nadis (नाडी),
 * each handler a chakra awakening to the vibration of its topic.
 */

import { randomUUID } from "node:crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BusMessage {
	/** Unique message identifier. */
	id: string;
	/** Topic this message was published to. */
	topic: string;
	/** Arbitrary payload data. */
	payload: unknown;
	/** Sender identifier (e.g., package or agent name). */
	sender: string;
	/** Unix timestamp in milliseconds. */
	timestamp: number;
}

export interface SubscriptionOptions {
	/** Only receive messages from this sender. */
	filterSender?: string;
	/** Priority for handler ordering. Higher = runs first. Default: 0 */
	priority?: number;
	/** Auto-unsubscribe after first message. Default: false */
	once?: boolean;
}

export type BusHandler = (message: BusMessage) => void | Promise<void>;

export interface MessageBusConfig {
	/** Maximum number of messages to retain per topic in the ring buffer. Default: 100 */
	maxHistoryPerTopic?: number;
	/** Maximum number of topics to track history for. Default: 500 */
	maxTrackedTopics?: number;
}

// ─── Internal Types ──────────────────────────────────────────────────────────

interface Subscription {
	id: string;
	handler: BusHandler;
	priority: number;
	filterSender?: string;
	once: boolean;
}

/** Ring buffer for message history — fixed-size, overwrites oldest on overflow. */
class RingBuffer<T> {
	private readonly buffer: (T | undefined)[];
	private head = 0;
	private count = 0;

	constructor(private readonly capacity: number) {
		this.buffer = new Array<T | undefined>(capacity);
	}

	push(item: T): void {
		this.buffer[this.head] = item;
		this.head = (this.head + 1) % this.capacity;
		if (this.count < this.capacity) this.count++;
	}

	toArray(limit?: number): T[] {
		const total = limit !== undefined ? Math.min(limit, this.count) : this.count;
		const result: T[] = [];
		// Start from the oldest entry
		const start = this.count < this.capacity
			? 0
			: this.head; // head points to next write = oldest
		const offset = this.count - total; // skip oldest entries if limit < count
		for (let i = 0; i < total; i++) {
			const idx = (start + offset + i) % this.capacity;
			result.push(this.buffer[idx] as T);
		}
		return result;
	}

	clear(): void {
		this.buffer.fill(undefined);
		this.head = 0;
		this.count = 0;
	}
}

// ─── Glob Matching ───────────────────────────────────────────────────────────

/**
 * Match a topic string against a colon-delimited glob pattern.
 *
 * Supported wildcards:
 *   - `*`  matches exactly one segment (e.g., `agent:*` matches `agent:foo`)
 *   - `**` matches zero or more segments (e.g., `agent:**` matches `agent:foo:bar`)
 *
 * @param pattern - The glob pattern (colon-delimited).
 * @param topic - The topic string to test.
 * @returns True if the topic matches the pattern.
 */
function matchTopic(pattern: string, topic: string): boolean {
	const patternParts = pattern.split(":");
	const topicParts = topic.split(":");
	return matchParts(patternParts, 0, topicParts, 0);
}

function matchParts(
	pattern: string[],
	pi: number,
	topic: string[],
	ti: number,
): boolean {
	while (pi < pattern.length && ti < topic.length) {
		const seg = pattern[pi];
		if (seg === "**") {
			// ** matches zero or more segments — try all offsets
			for (let skip = 0; skip <= topic.length - ti; skip++) {
				if (matchParts(pattern, pi + 1, topic, ti + skip)) return true;
			}
			return false;
		}
		if (seg !== "*" && seg !== topic[ti]) return false;
		pi++;
		ti++;
	}
	// Handle trailing ** patterns
	while (pi < pattern.length && pattern[pi] === "**") pi++;
	return pi === pattern.length && ti === topic.length;
}

// ─── MessageBus ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<MessageBusConfig> = {
	maxHistoryPerTopic: 100,
	maxTrackedTopics: 500,
};

/**
 * In-process message bus for loose coupling between packages.
 *
 * @example
 * ```ts
 * const bus = new MessageBus();
 * bus.subscribe("agent:status", (msg) => console.log(msg.payload));
 * bus.publish("agent:status", { state: "running" }, "orchestrator");
 *
 * // Wildcard subscription
 * bus.subscribePattern("agent:*", (msg) => console.log(msg.topic));
 *
 * // Wait for a specific message
 * const msg = await bus.waitFor("agent:ready", 5000);
 * ```
 */
export class MessageBus {
	private readonly config: Required<MessageBusConfig>;
	private readonly subscriptions = new Map<string, Subscription[]>();
	private readonly patternSubscriptions = new Map<string, Subscription[]>();
	private readonly history = new Map<string, RingBuffer<BusMessage>>();
	private destroyed = false;

	constructor(config?: MessageBusConfig) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// ─── Publish ───────────────────────────────────────────────────

	/**
	 * Publish a message to a topic. Returns the generated message ID.
	 *
	 * Handlers are invoked in priority order (highest first). Errors in
	 * individual handlers are caught and silently swallowed to prevent
	 * one misbehaving subscriber from disrupting others.
	 *
	 * @param topic - The topic to publish to.
	 * @param payload - The message payload.
	 * @param sender - Sender identifier. Defaults to "anonymous".
	 * @returns The generated message ID.
	 */
	publish(topic: string, payload: unknown, sender = "anonymous"): string {
		this.assertAlive();

		const message: BusMessage = {
			id: randomUUID(),
			topic,
			payload,
			sender,
			timestamp: Date.now(),
		};

		// Store in history
		this.recordHistory(topic, message);

		// Collect matching handlers: exact + pattern
		const handlers = this.collectHandlers(topic, message);

		// Sort by priority descending
		handlers.sort((a, b) => b.priority - a.priority);

		// Invoke handlers
		const toRemove: Array<{ source: Map<string, Subscription[]>; key: string; id: string }> = [];

		for (const sub of handlers) {
			try {
				sub.handler(message);
			} catch (_err) {
				// Error isolation: never let a handler crash the bus.
			}
			if (sub.once) {
				toRemove.push({ source: sub.source, key: sub.key, id: sub.id });
			}
		}

		// Clean up once-only subscriptions
		for (const { source, key, id } of toRemove) {
			const subs = source.get(key);
			if (subs) {
				const idx = subs.findIndex((s) => s.id === id);
				if (idx !== -1) subs.splice(idx, 1);
				if (subs.length === 0) source.delete(key);
			}
		}

		return message.id;
	}

	// ─── Subscribe ─────────────────────────────────────────────────

	/**
	 * Subscribe to a specific topic. Returns an unsubscribe function.
	 *
	 * @param topic - Exact topic to subscribe to.
	 * @param handler - Function invoked for each matching message.
	 * @param options - Subscription options (priority, sender filter, once).
	 * @returns A function that removes this subscription when called.
	 */
	subscribe(
		topic: string,
		handler: BusHandler,
		options?: SubscriptionOptions,
	): () => void {
		this.assertAlive();
		const sub = this.makeSub(handler, options);
		const list = this.subscriptions.get(topic) ?? [];
		list.push(sub);
		this.subscriptions.set(topic, list);

		return () => {
			const subs = this.subscriptions.get(topic);
			if (!subs) return;
			const idx = subs.findIndex((s) => s.id === sub.id);
			if (idx !== -1) subs.splice(idx, 1);
			if (subs.length === 0) this.subscriptions.delete(topic);
		};
	}

	/**
	 * Subscribe to all topics matching a glob pattern.
	 *
	 * Patterns use colon-delimited segments:
	 *   - `*` matches exactly one segment
	 *   - `**` matches zero or more segments
	 *
	 * @param pattern - Glob pattern (e.g., "agent:*", "system:**").
	 * @param handler - Function invoked for each matching message.
	 * @param options - Subscription options.
	 * @returns A function that removes this subscription when called.
	 */
	subscribePattern(
		pattern: string,
		handler: BusHandler,
		options?: SubscriptionOptions,
	): () => void {
		this.assertAlive();
		const sub = this.makeSub(handler, options);
		const list = this.patternSubscriptions.get(pattern) ?? [];
		list.push(sub);
		this.patternSubscriptions.set(pattern, list);

		return () => {
			const subs = this.patternSubscriptions.get(pattern);
			if (!subs) return;
			const idx = subs.findIndex((s) => s.id === sub.id);
			if (idx !== -1) subs.splice(idx, 1);
			if (subs.length === 0) this.patternSubscriptions.delete(pattern);
		};
	}

	// ─── Awaiting ──────────────────────────────────────────────────

	/**
	 * Wait for the next message on a topic.
	 *
	 * Creates a one-shot subscription that resolves a Promise when the
	 * next matching message arrives. Optional timeout prevents indefinite
	 * waiting — the Promise rejects if no message arrives in time.
	 *
	 * @param topic - The topic to wait for.
	 * @param timeout - Maximum wait time in ms. 0 = no timeout. Default: 0.
	 * @returns A promise resolving with the next message on the topic.
	 */
	waitFor(topic: string, timeout = 0): Promise<BusMessage> {
		this.assertAlive();

		return new Promise<BusMessage>((resolve, reject) => {
			let timer: ReturnType<typeof setTimeout> | undefined;

			const unsub = this.subscribe(topic, (msg) => {
				if (timer !== undefined) clearTimeout(timer);
				resolve(msg);
			}, { once: true });

			if (timeout > 0) {
				timer = setTimeout(() => {
					unsub();
					reject(new Error(`waitFor("${topic}") timed out after ${timeout}ms`));
				}, timeout);
			}
		});
	}

	// ─── History ───────────────────────────────────────────────────

	/**
	 * Get message history for a topic.
	 *
	 * Returns the most recent messages stored in the topic's ring buffer,
	 * ordered from oldest to newest.
	 *
	 * @param topic - The topic to retrieve history for.
	 * @param limit - Maximum number of messages. Defaults to all stored.
	 * @returns Array of messages, oldest first.
	 */
	getHistory(topic: string, limit?: number): BusMessage[] {
		const ring = this.history.get(topic);
		if (!ring) return [];
		return ring.toArray(limit);
	}

	// ─── Lifecycle ─────────────────────────────────────────────────

	/**
	 * Clear all subscriptions, pattern subscriptions, and history.
	 * The bus becomes inert — any further calls will throw.
	 */
	destroy(): void {
		this.subscriptions.clear();
		this.patternSubscriptions.clear();
		for (const ring of this.history.values()) ring.clear();
		this.history.clear();
		this.destroyed = true;
	}

	// ─── Private ───────────────────────────────────────────────────

	private assertAlive(): void {
		if (this.destroyed) {
			throw new Error("MessageBus has been destroyed. No further operations are allowed.");
		}
	}

	private makeSub(handler: BusHandler, options?: SubscriptionOptions): Subscription {
		return {
			id: randomUUID(),
			handler,
			priority: options?.priority ?? 0,
			filterSender: options?.filterSender,
			once: options?.once ?? false,
		};
	}

	private recordHistory(topic: string, message: BusMessage): void {
		let ring = this.history.get(topic);
		if (!ring) {
			// Evict oldest topic if we've hit the tracking limit
			if (this.history.size >= this.config.maxTrackedTopics) {
				const oldest = this.history.keys().next().value;
				if (oldest !== undefined) this.history.delete(oldest);
			}
			ring = new RingBuffer<BusMessage>(this.config.maxHistoryPerTopic);
			this.history.set(topic, ring);
		}
		ring.push(message);
	}

	/**
	 * Collect all handlers (exact + pattern) that match a given topic,
	 * decorated with their source map and key for cleanup of once-only subs.
	 */
	private collectHandlers(
		topic: string,
		message: BusMessage,
	): Array<Subscription & { source: Map<string, Subscription[]>; key: string }> {
		const result: Array<Subscription & { source: Map<string, Subscription[]>; key: string }> = [];

		// Exact subscriptions
		const exact = this.subscriptions.get(topic);
		if (exact) {
			for (const sub of exact) {
				if (sub.filterSender && sub.filterSender !== message.sender) continue;
				result.push({ ...sub, source: this.subscriptions, key: topic });
			}
		}

		// Pattern subscriptions
		for (const [pattern, subs] of this.patternSubscriptions) {
			if (!matchTopic(pattern, topic)) continue;
			for (const sub of subs) {
				if (sub.filterSender && sub.filterSender !== message.sender) continue;
				result.push({ ...sub, source: this.patternSubscriptions, key: pattern });
			}
		}

		return result;
	}
}
