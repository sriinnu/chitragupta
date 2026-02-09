/**
 * Samiti (सामीति — Assembly) — Ambient Communication Channels.
 *
 * Provides persistent, topic-based channels that agents can listen to
 * and broadcast observations to asynchronously. Unlike CommHub (direct
 * message routing) or MessageBus (fire-and-forget pub/sub), Samiti
 * channels retain a bounded history and support severity/time filtering.
 *
 * Named after the Vedic samiti — the assembly of the people, where
 * every voice echoes through the hall and the wisest words linger
 * longest. Each channel is a dharma-kshetra (धर्मक्षेत्र) — a field
 * of collective awareness where ambient intelligence crystallizes
 * from the murmur of many agents.
 *
 * @module samiti
 */

// ─── FNV-1a (inline, zero-dependency) ────────────────────────────────────────

/** FNV-1a offset basis for 32-bit. */
const FNV_OFFSET = 0x811c9dc5;
/** FNV-1a prime for 32-bit. */
const FNV_PRIME = 0x01000193;

/**
 * Compute a 32-bit FNV-1a hash of the input string, returned as a
 * zero-padded hex string.
 */
function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** A message broadcast to a Samiti channel. */
export interface SamitiMessage {
	/** Deterministic ID — FNV-1a hash of timestamp + channel + sender. */
	id: string;
	/** Channel name (e.g., '#security', '#performance'). */
	channel: string;
	/** Agent ID or system component that sent the message. */
	sender: string;
	/** Severity level of the observation. */
	severity: "info" | "warning" | "critical";
	/** Freeform category tag (e.g., 'credential-leak', 'slow-query'). */
	category: string;
	/** Human-readable message content. */
	content: string;
	/** Optional structured payload data. */
	data?: unknown;
	/** Unix epoch ms when the message was created. */
	timestamp: number;
	/** Time-to-live in ms. 0 means infinite (never expires). */
	ttl: number;
	/** IDs of related messages for threading/correlation. */
	references?: string[];
}

/** A persistent, topic-based ambient channel. */
export interface SamitiChannel {
	/** Channel name (must start with '#'). */
	name: string;
	/** Human-readable description. */
	description: string;
	/** Maximum messages retained in the ring buffer. */
	maxHistory: number;
	/** Set of subscribed agent IDs. */
	subscribers: Set<string>;
	/** Ring buffer of messages (oldest first on read). */
	messages: SamitiMessage[];
	/** Unix epoch ms when the channel was created. */
	createdAt: number;
}

/** Configuration for the Samiti ambient channel system. */
export interface SamitiConfig {
	/** Maximum number of channels allowed. Default: 20. */
	maxChannels: number;
	/** Default ring buffer size for new channels. Default: 100. */
	defaultMaxHistory: number;
	/** Default TTL for messages in ms. Default: 86400000 (24h). */
	defaultTTL: number;
	/** Whether to enable persistence (reserved for future use). Default: false. */
	enablePersistence: boolean;
}

/** Options for filtering messages when listening. */
export interface ListenOptions {
	/** Only return messages after this timestamp (Unix epoch ms). */
	since?: number;
	/** Only return messages of this severity. */
	severity?: SamitiMessage["severity"];
	/** Maximum number of messages to return. */
	limit?: number;
}

/** Aggregate statistics for the Samiti system. */
export interface SamitiStats {
	/** Number of active channels. */
	channels: number;
	/** Total messages across all channels. */
	totalMessages: number;
	/** Total unique subscribers across all channels. */
	subscribers: number;
}

// ─── Hard Ceilings ───────────────────────────────────────────────────────────

/** System hard ceilings — cannot be exceeded regardless of configuration. */
const HARD_CEILINGS = {
	maxChannels: 100,
	maxHistory: 10_000,
	maxMessageSize: 1_048_576, // 1MB
	maxSubscribersPerChannel: 50,
} as const;

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SamitiConfig = {
	maxChannels: 20,
	defaultMaxHistory: 100,
	defaultTTL: 86_400_000, // 24 hours
	enablePersistence: false,
};

/** Pre-configured channels created on construction. */
const DEFAULT_CHANNELS: Array<{ name: string; description: string }> = [
	{ name: "#security", description: "Security findings, credential leaks, vulnerability alerts" },
	{ name: "#performance", description: "Performance regressions, memory leaks, slow queries" },
	{ name: "#correctness", description: "Logic errors, test failures, type mismatches" },
	{ name: "#style", description: "Code style violations, naming inconsistencies" },
	{ name: "#alerts", description: "System alerts, daemon events, threshold breaches" },
];

// ─── Ring Buffer ─────────────────────────────────────────────────────────────

/**
 * Fixed-size circular buffer. When at capacity, the oldest entry is
 * silently overwritten. Reads always return items oldest-first.
 */
class RingBuffer<T> {
	private readonly buffer: (T | undefined)[];
	private head = 0;
	private count = 0;

	constructor(private readonly capacity: number) {
		this.buffer = new Array<T | undefined>(capacity);
	}

	/** Add an item, overwriting the oldest if at capacity. */
	push(item: T): void {
		this.buffer[this.head] = item;
		this.head = (this.head + 1) % this.capacity;
		if (this.count < this.capacity) this.count++;
	}

	/** Return all items as an array, oldest first. Optionally limit count. */
	toArray(limit?: number): T[] {
		const total = limit !== undefined ? Math.min(limit, this.count) : this.count;
		const result: T[] = [];
		const start = this.count < this.capacity ? 0 : this.head;
		const offset = this.count - total;
		for (let i = 0; i < total; i++) {
			const idx = (start + offset + i) % this.capacity;
			result.push(this.buffer[idx] as T);
		}
		return result;
	}

	/** Current number of items in the buffer. */
	get size(): number {
		return this.count;
	}

	/**
	 * Remove items that match a predicate. Returns the count of removed items.
	 * After removal, the buffer is compacted to maintain contiguous storage.
	 */
	removeWhere(predicate: (item: T) => boolean): number {
		const kept: T[] = [];
		const arr = this.toArray();
		for (const item of arr) {
			if (!predicate(item)) kept.push(item);
		}
		const removed = this.count - kept.length;
		if (removed > 0) {
			this.buffer.fill(undefined);
			this.head = 0;
			this.count = 0;
			for (const item of kept) {
				this.push(item);
			}
		}
		return removed;
	}

	/** Clear the buffer entirely. */
	clear(): void {
		this.buffer.fill(undefined);
		this.head = 0;
		this.count = 0;
	}
}

// ─── Internal Channel State ──────────────────────────────────────────────────

/** Internal channel representation using a proper ring buffer. */
interface InternalChannel {
	name: string;
	description: string;
	maxHistory: number;
	subscribers: Set<string>;
	ring: RingBuffer<SamitiMessage>;
	createdAt: number;
}

// ─── Samiti ──────────────────────────────────────────────────────────────────

/**
 * Ambient Communication Channels for collective agent intelligence.
 *
 * Samiti provides persistent, topic-based channels where agents broadcast
 * observations (security findings, performance regressions, style violations)
 * and other agents or systems listen asynchronously. Each channel maintains
 * a bounded message history via a ring buffer, supports severity and time
 * filtering, and delivers real-time notifications to registered callbacks.
 *
 * @example
 * ```ts
 * const samiti = new Samiti();
 *
 * // Listen for security alerts in real-time
 * const unsub = samiti.onMessage("#security", (msg) => {
 *   if (msg.severity === "critical") escalate(msg);
 * });
 *
 * // Broadcast a finding
 * samiti.broadcast("#security", {
 *   sender: "anveshi-agent",
 *   severity: "warning",
 *   category: "credential-leak",
 *   content: "Hardcoded API key detected in config.ts:42",
 * });
 *
 * // Query recent critical alerts
 * const criticals = samiti.listen("#security", {
 *   severity: "critical",
 *   since: Date.now() - 3600000,
 * });
 *
 * unsub(); // Clean up
 * ```
 */
export class Samiti {
	private readonly config: SamitiConfig;
	private readonly channels = new Map<string, InternalChannel>();
	private readonly listeners = new Map<string, Set<(msg: SamitiMessage) => void>>();
	private destroyed = false;

	/**
	 * Create a new Samiti instance with optional configuration.
	 * Default channels (#security, #performance, #correctness, #style, #alerts)
	 * are created automatically.
	 *
	 * @param config - Partial configuration. Values are clamped to HARD_CEILINGS.
	 */
	constructor(config?: Partial<SamitiConfig>) {
		this.config = {
			...DEFAULT_CONFIG,
			...config,
			// Clamp to hard ceilings
			maxChannels: Math.min(
				config?.maxChannels ?? DEFAULT_CONFIG.maxChannels,
				HARD_CEILINGS.maxChannels,
			),
			defaultMaxHistory: Math.min(
				config?.defaultMaxHistory ?? DEFAULT_CONFIG.defaultMaxHistory,
				HARD_CEILINGS.maxHistory,
			),
		};

		// Auto-create default channels
		for (const ch of DEFAULT_CHANNELS) {
			this.createChannel(ch.name, ch.description);
		}
	}

	// ─── Channel Management ──────────────────────────────────────────

	/**
	 * Create a new ambient channel.
	 *
	 * @param name - Channel name (should start with '#').
	 * @param description - Human-readable channel description.
	 * @param maxHistory - Ring buffer capacity. Clamped to HARD_CEILINGS.maxHistory.
	 * @returns The created channel (as a public snapshot).
	 * @throws If the channel already exists or the max channel limit is reached.
	 */
	createChannel(name: string, description: string, maxHistory?: number): SamitiChannel {
		this.assertAlive();

		if (this.channels.has(name)) {
			throw new Error(`Channel "${name}" already exists.`);
		}
		if (this.channels.size >= this.config.maxChannels) {
			throw new Error(
				`Maximum channels reached (${this.config.maxChannels}). ` +
				`Delete a channel before creating a new one.`,
			);
		}

		const history = Math.min(
			maxHistory ?? this.config.defaultMaxHistory,
			HARD_CEILINGS.maxHistory,
		);

		const channel: InternalChannel = {
			name,
			description,
			maxHistory: history,
			subscribers: new Set(),
			ring: new RingBuffer<SamitiMessage>(history),
			createdAt: Date.now(),
		};

		this.channels.set(name, channel);
		return this.toPublicChannel(channel);
	}

	/**
	 * Delete an existing channel and all its messages.
	 *
	 * @param name - The channel to delete.
	 * @returns True if the channel was found and deleted, false otherwise.
	 */
	deleteChannel(name: string): boolean {
		this.assertAlive();

		const channel = this.channels.get(name);
		if (!channel) return false;

		channel.ring.clear();
		channel.subscribers.clear();
		this.channels.delete(name);
		this.listeners.delete(name);
		return true;
	}

	/**
	 * Get a channel by name.
	 *
	 * @param name - The channel to look up.
	 * @returns The channel snapshot, or undefined if not found.
	 */
	getChannel(name: string): SamitiChannel | undefined {
		const ch = this.channels.get(name);
		return ch ? this.toPublicChannel(ch) : undefined;
	}

	/**
	 * List all active channels.
	 *
	 * @returns Array of channel snapshots, ordered by creation time (oldest first).
	 */
	listChannels(): SamitiChannel[] {
		return [...this.channels.values()]
			.sort((a, b) => a.createdAt - b.createdAt)
			.map((ch) => this.toPublicChannel(ch));
	}

	// ─── Subscription ────────────────────────────────────────────────

	/**
	 * Subscribe an agent to a channel.
	 *
	 * @param channel - The channel name.
	 * @param agentId - The subscribing agent's identifier.
	 * @throws If the channel doesn't exist or max subscribers per channel is reached.
	 */
	subscribe(channel: string, agentId: string): void {
		this.assertAlive();

		const ch = this.channels.get(channel);
		if (!ch) {
			throw new Error(`Channel "${channel}" does not exist.`);
		}
		if (
			!ch.subscribers.has(agentId) &&
			ch.subscribers.size >= HARD_CEILINGS.maxSubscribersPerChannel
		) {
			throw new Error(
				`Channel "${channel}" has reached the subscriber limit ` +
				`(${HARD_CEILINGS.maxSubscribersPerChannel}).`,
			);
		}
		ch.subscribers.add(agentId);
	}

	/**
	 * Unsubscribe an agent from a channel.
	 *
	 * @param channel - The channel name.
	 * @param agentId - The agent to unsubscribe.
	 * @throws If the channel doesn't exist.
	 */
	unsubscribe(channel: string, agentId: string): void {
		this.assertAlive();

		const ch = this.channels.get(channel);
		if (!ch) {
			throw new Error(`Channel "${channel}" does not exist.`);
		}
		ch.subscribers.delete(agentId);
	}

	// ─── Messaging ───────────────────────────────────────────────────

	/**
	 * Broadcast a message to a channel.
	 *
	 * The message ID is computed deterministically via FNV-1a from the
	 * timestamp, channel name, and sender. The timestamp and TTL are
	 * auto-populated. Real-time listeners are notified synchronously.
	 *
	 * @param channel - The target channel name.
	 * @param message - Message fields (id, timestamp, and ttl are auto-set).
	 * @returns The fully-formed broadcast message.
	 * @throws If the channel doesn't exist or content exceeds maxMessageSize.
	 */
	broadcast(
		channel: string,
		message: Omit<SamitiMessage, "id" | "timestamp" | "ttl"> & { ttl?: number },
	): SamitiMessage {
		this.assertAlive();

		const ch = this.channels.get(channel);
		if (!ch) {
			throw new Error(`Channel "${channel}" does not exist.`);
		}

		// Validate message size
		const contentSize = message.content.length + JSON.stringify(message.data ?? "").length;
		if (contentSize > HARD_CEILINGS.maxMessageSize) {
			throw new Error(
				`Message size (${contentSize} bytes) exceeds maximum ` +
				`(${HARD_CEILINGS.maxMessageSize} bytes).`,
			);
		}

		const timestamp = Date.now();
		const id = `sam-${fnv1a(`${timestamp}:${channel}:${message.sender}`)}`;

		const full: SamitiMessage = {
			id,
			channel,
			sender: message.sender,
			severity: message.severity,
			category: message.category,
			content: message.content,
			data: message.data,
			timestamp,
			ttl: message.ttl ?? this.config.defaultTTL,
			references: message.references,
		};

		ch.ring.push(full);

		// Notify real-time listeners
		const channelListeners = this.listeners.get(channel);
		if (channelListeners) {
			for (const handler of channelListeners) {
				try {
					handler(full);
				} catch (_err) {
					// Error isolation: never let a listener crash the broadcast.
				}
			}
		}

		return full;
	}

	/**
	 * Query messages from a channel with optional filtering.
	 *
	 * Performs lazy TTL pruning before returning results — expired messages
	 * are removed from the ring buffer during each listen() call.
	 *
	 * @param channel - The channel to query.
	 * @param opts - Filter options (since, severity, limit).
	 * @returns Matching messages, oldest first.
	 */
	listen(channel: string, opts?: ListenOptions): SamitiMessage[] {
		this.assertAlive();

		const ch = this.channels.get(channel);
		if (!ch) return [];

		// Lazy TTL pruning
		this.pruneChannel(ch);

		let messages = ch.ring.toArray();

		// Filter by since
		if (opts?.since !== undefined) {
			messages = messages.filter((m) => m.timestamp >= opts.since!);
		}

		// Filter by severity
		if (opts?.severity !== undefined) {
			messages = messages.filter((m) => m.severity === opts.severity);
		}

		// Limit (return most recent N)
		if (opts?.limit !== undefined && messages.length > opts.limit) {
			messages = messages.slice(messages.length - opts.limit);
		}

		return messages;
	}

	/**
	 * Get the raw message history for a channel (no filtering, no pruning).
	 *
	 * @param channel - The channel name.
	 * @param limit - Maximum number of messages (most recent). Defaults to all.
	 * @returns Messages oldest first, or empty array if channel doesn't exist.
	 */
	getHistory(channel: string, limit?: number): SamitiMessage[] {
		const ch = this.channels.get(channel);
		if (!ch) return [];
		return ch.ring.toArray(limit);
	}

	// ─── Real-Time Listeners ─────────────────────────────────────────

	/**
	 * Register a real-time callback for new messages on a channel.
	 *
	 * The handler is invoked synchronously each time a message is broadcast
	 * to the channel. Errors thrown by the handler are silently swallowed
	 * to prevent one misbehaving listener from disrupting others.
	 *
	 * @param channel - The channel to listen on.
	 * @param handler - Callback invoked with each new message.
	 * @returns An unsubscribe function that removes this listener.
	 * @throws If the channel doesn't exist.
	 */
	onMessage(channel: string, handler: (msg: SamitiMessage) => void): () => void {
		this.assertAlive();

		if (!this.channels.has(channel)) {
			throw new Error(`Channel "${channel}" does not exist.`);
		}

		let set = this.listeners.get(channel);
		if (!set) {
			set = new Set();
			this.listeners.set(channel, set);
		}
		set.add(handler);

		return () => {
			const s = this.listeners.get(channel);
			if (s) {
				s.delete(handler);
				if (s.size === 0) this.listeners.delete(channel);
			}
		};
	}

	// ─── Maintenance ─────────────────────────────────────────────────

	/**
	 * Remove all TTL-expired messages across all channels.
	 *
	 * @returns Total number of messages pruned.
	 */
	pruneExpired(): number {
		this.assertAlive();

		let total = 0;
		for (const ch of this.channels.values()) {
			total += this.pruneChannel(ch);
		}
		return total;
	}

	// ─── Introspection ───────────────────────────────────────────────

	/**
	 * Get aggregate statistics for the Samiti system.
	 *
	 * @returns Channel count, total message count, and total unique subscriber count.
	 */
	stats(): SamitiStats {
		const uniqueSubs = new Set<string>();
		let totalMessages = 0;

		for (const ch of this.channels.values()) {
			totalMessages += ch.ring.size;
			for (const sub of ch.subscribers) {
				uniqueSubs.add(sub);
			}
		}

		return {
			channels: this.channels.size,
			totalMessages,
			subscribers: uniqueSubs.size,
		};
	}

	// ─── Lifecycle ───────────────────────────────────────────────────

	/**
	 * Destroy the Samiti instance, clearing all channels, messages, and listeners.
	 * Any further calls will throw.
	 */
	destroy(): void {
		for (const ch of this.channels.values()) {
			ch.ring.clear();
			ch.subscribers.clear();
		}
		this.channels.clear();
		this.listeners.clear();
		this.destroyed = true;
	}

	// ─── Private ─────────────────────────────────────────────────────

	/** Throw if the instance has been destroyed. */
	private assertAlive(): void {
		if (this.destroyed) {
			throw new Error("Samiti has been destroyed. No further operations are allowed.");
		}
	}

	/** Prune TTL-expired messages from a single channel. */
	private pruneChannel(ch: InternalChannel): number {
		const now = Date.now();
		return ch.ring.removeWhere((msg) => msg.ttl > 0 && now - msg.timestamp >= msg.ttl);
	}

	/** Convert an internal channel to its public snapshot representation. */
	private toPublicChannel(ch: InternalChannel): SamitiChannel {
		return {
			name: ch.name,
			description: ch.description,
			maxHistory: ch.maxHistory,
			subscribers: new Set(ch.subscribers),
			messages: ch.ring.toArray(),
			createdAt: ch.createdAt,
		};
	}
}
