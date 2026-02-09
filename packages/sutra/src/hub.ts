/**
 * CommHub — Central message broker and shared state coordinator.
 *
 * This is the beating heart of the inter-agent communication protocol.
 * It provides:
 * - Topic-based pub/sub message passing with request-reply patterns
 * - Shared memory regions with optimistic (CAS) locking and versioning
 * - Distributed coordination: locks, barriers, semaphores
 * - Result collection from parallel agent work
 * - Automatic TTL cleanup via periodic sweep
 */

import type {
	AgentEnvelope,
	Barrier,
	Channel,
	HubConfig,
	HubStats,
	Lock,
	ResultCollector,
	Semaphore,
	SharedMemoryRegion,
} from "./types.js";
import { LockManager, BarrierManager, SemaphoreManager } from "./hub-sync.js";
import { SharedMemoryManager } from "./hub-memory.js";
import type { RegionChangeHandler } from "./hub-memory.js";

/** Default hub configuration values. */
const DEFAULTS: Required<HubConfig> = {
	maxChannels: 100,
	maxMessageHistory: 1000,
	defaultMessageTTL: 60_000,
	lockTimeout: 30_000,
	enableLogging: false,
};

/** Cleanup sweep interval in milliseconds. */
const CLEANUP_INTERVAL = 10_000;

type MessageHandler = (envelope: AgentEnvelope) => void;

/**
 * Central message broker and shared state coordinator for inter-agent communication.
 *
 * @example
 * ```ts
 * const hub = new CommHub({ enableLogging: false });
 * hub.subscribe("agent-a", "tasks", (env) => console.log(env.payload));
 * hub.send({ from: "b", to: "agent-a", topic: "tasks", payload: "hello", priority: "normal" });
 * hub.destroy();
 * ```
 */
export class CommHub {
	// ─── Configuration ──────────────────────────────────────────────
	private readonly config: Required<HubConfig>;

	// ─── Message Passing ────────────────────────────────────────────
	private readonly channels = new Map<string, Channel>();
	private readonly handlers = new Map<string, Map<string, MessageHandler>>();
	private readonly pendingReplies = new Map<string, {
		resolve: (envelope: AgentEnvelope) => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}>();
	private totalMessages = 0;

	// ─── Delegates ──────────────────────────────────────────────────
	private readonly lockMgr: LockManager;
	private readonly barrierMgr: BarrierManager;
	private readonly semaphoreMgr: SemaphoreManager;
	private readonly memoryMgr: SharedMemoryManager;

	// ─── Lifecycle ──────────────────────────────────────────────────
	private cleanupTimer: ReturnType<typeof setInterval> | null = null;
	private destroyed = false;

	constructor(config: HubConfig = {}) {
		this.config = { ...DEFAULTS, ...config };
		const logFn = (msg: string) => this.log(msg);
		this.lockMgr = new LockManager(this.config.lockTimeout, logFn);
		this.barrierMgr = new BarrierManager(logFn);
		this.semaphoreMgr = new SemaphoreManager(logFn);
		this.memoryMgr = new SharedMemoryManager(logFn);
		this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);
	}

	// ═══════════════════════════════════════════════════════════════
	// MESSAGE PASSING
	// ═══════════════════════════════════════════════════════════════

	/**
	 * Send a message through the hub.
	 *
	 * Assigns a UUID and timestamp, delivers to the target agent (or broadcasts),
	 * and stores the message in the topic channel's history.
	 *
	 * @param envelope - Message envelope without `id` and `timestamp` (auto-generated).
	 * @returns The generated message ID.
	 * @throws If the hub has been destroyed.
	 */
	send(envelope: Omit<AgentEnvelope, "id" | "timestamp">, preAssignedId?: string): string {
		this.assertNotDestroyed();

		const id = preAssignedId ?? crypto.randomUUID();
		const full: AgentEnvelope = {
			...envelope, id, timestamp: Date.now(),
			ttl: envelope.ttl ?? this.config.defaultMessageTTL,
		};

		this.log(`[send] ${full.from} -> ${full.to} topic=${full.topic}`);
		this.totalMessages++;

		if (full.replyTo && this.pendingReplies.has(full.replyTo)) {
			const pending = this.pendingReplies.get(full.replyTo)!;
			clearTimeout(pending.timer);
			this.pendingReplies.delete(full.replyTo);
			pending.resolve(full);
			return id;
		}

		if (full.to === "*") this.deliverBroadcast(full);
		else this.deliverToAgent(full);

		this.storeInChannel(full);
		return id;
	}

	/**
	 * Send a message and wait for a reply (request-reply pattern).
	 *
	 * @param to - Target agent ID.
	 * @param topic - The message topic.
	 * @param payload - The message payload.
	 * @param from - The sending agent ID.
	 * @param timeout - Max time in ms to wait for a reply (default 30000).
	 * @returns A promise that resolves with the reply envelope.
	 * @throws If the hub is destroyed or the request times out.
	 */
	request(to: string, topic: string, payload: unknown, from: string, timeout = 30_000): Promise<AgentEnvelope> {
		this.assertNotDestroyed();
		return new Promise<AgentEnvelope>((resolve, reject) => {
			// Pre-generate the message ID and register the pending reply BEFORE
			// calling send(), because the subscriber may reply synchronously
			// during delivery — the reply must find a registered pending entry.
			const messageId = crypto.randomUUID();
			const timer = setTimeout(() => {
				this.pendingReplies.delete(messageId);
				reject(new Error(`Request timed out after ${timeout}ms (topic=${topic}, to=${to})`));
			}, timeout);
			this.pendingReplies.set(messageId, { resolve, reject, timer });

			this.send({ from, to, topic, payload, priority: "normal" }, messageId);
		});
	}

	/**
	 * Reply to a previously received message.
	 *
	 * @param originalMessageId - The ID of the message being replied to.
	 * @param from - The replying agent's ID.
	 * @param payload - The reply payload.
	 * @throws If the hub has been destroyed.
	 */
	reply(originalMessageId: string, from: string, payload: unknown): void {
		this.assertNotDestroyed();
		this.send({ from, to: "*", topic: "__reply__", payload, replyTo: originalMessageId, priority: "normal" });
	}

	/** Subscribe an agent to a topic. Returns an unsubscribe function. */
	subscribe(agentId: string, topic: string, handler: MessageHandler): () => void {
		this.assertNotDestroyed();

		if (!this.channels.has(topic)) {
			if (this.channels.size >= this.config.maxChannels) {
				throw new Error(`Cannot create channel "${topic}": max channels (${this.config.maxChannels}) reached.`);
			}
			this.channels.set(topic, { topic, subscribers: new Set(), history: [], maxHistory: this.config.maxMessageHistory });
		}

		const channel = this.channels.get(topic)!;
		channel.subscribers.add(agentId);

		if (!this.handlers.has(topic)) this.handlers.set(topic, new Map());
		this.handlers.get(topic)!.set(agentId, handler);

		this.log(`[subscribe] ${agentId} -> topic=${topic}`);

		return () => {
			channel.subscribers.delete(agentId);
			this.handlers.get(topic)?.delete(agentId);
			if (channel.subscribers.size === 0) {
				this.channels.delete(topic);
				this.handlers.delete(topic);
			}
		};
	}

	/** Broadcast a message to all subscribers of a topic. */
	broadcast(from: string, topic: string, payload: unknown): void {
		this.send({ from, to: "*", topic, payload, priority: "normal" });
	}

	/** Get messages for a specific agent, optionally filtered by topic and time. */
	getMessages(agentId: string, topic?: string, since?: number): AgentEnvelope[] {
		const now = Date.now();
		const results: AgentEnvelope[] = [];

		for (const channel of this.channels.values()) {
			if (topic && channel.topic !== topic) continue;
			for (const msg of channel.history) {
				if (msg.to !== agentId && msg.to !== "*") continue;
				if (since && msg.timestamp < since) continue;
				if (msg.ttl && msg.timestamp + msg.ttl < now) continue;
				results.push(msg);
			}
		}

		const priorityOrder: Record<string, number> = { high: 0, normal: 1, low: 2 };
		results.sort((a, b) => {
			const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
			if (pd !== 0) return pd;
			return a.timestamp - b.timestamp;
		});

		return results;
	}

	// ═══════════════════════════════════════════════════════════════
	// SHARED MEMORY (delegated)
	// ═══════════════════════════════════════════════════════════════

	createRegion(name: string, owner: string, accessList?: string[]): SharedMemoryRegion {
		this.assertNotDestroyed();
		return this.memoryMgr.createRegion(name, owner, accessList);
	}

	getRegion(name: string): SharedMemoryRegion | undefined {
		return this.memoryMgr.getRegion(name);
	}

	read(regionName: string, key: string): unknown {
		return this.memoryMgr.read(regionName, key);
	}

	write(regionName: string, key: string, value: unknown, agentId: string): void {
		this.assertNotDestroyed();
		this.memoryMgr.write(regionName, key, value, agentId);
	}

	deleteRegion(name: string, agentId: string): void {
		this.assertNotDestroyed();
		this.memoryMgr.deleteRegion(name, agentId);
	}

	watchRegion(regionName: string, handler: RegionChangeHandler): () => void {
		return this.memoryMgr.watchRegion(regionName, handler);
	}

	// ═══════════════════════════════════════════════════════════════
	// LOCKS (delegated)
	// ═══════════════════════════════════════════════════════════════

	acquireLock(resource: string, agentId: string, timeout?: number): Promise<Lock> {
		this.assertNotDestroyed();
		return this.lockMgr.acquireLock(resource, agentId, timeout);
	}

	releaseLock(resource: string, agentId: string): void {
		this.assertNotDestroyed();
		this.lockMgr.releaseLock(resource, agentId);
	}

	isLocked(resource: string): boolean {
		return this.lockMgr.isLocked(resource);
	}

	// ═══════════════════════════════════════════════════════════════
	// BARRIERS (delegated)
	// ═══════════════════════════════════════════════════════════════

	createBarrier(name: string, requiredCount: number): Barrier {
		this.assertNotDestroyed();
		return this.barrierMgr.createBarrier(name, requiredCount);
	}

	arriveAtBarrier(barrierName: string, agentId: string): Promise<void> {
		this.assertNotDestroyed();
		return this.barrierMgr.arriveAtBarrier(barrierName, agentId);
	}

	// ═══════════════════════════════════════════════════════════════
	// SEMAPHORES (delegated)
	// ═══════════════════════════════════════════════════════════════

	createSemaphore(name: string, permits: number): Semaphore {
		this.assertNotDestroyed();
		return this.semaphoreMgr.createSemaphore(name, permits);
	}

	acquireSemaphore(name: string, agentId: string): Promise<void> {
		this.assertNotDestroyed();
		return this.semaphoreMgr.acquireSemaphore(name, agentId);
	}

	releaseSemaphore(name: string, agentId: string): void {
		this.assertNotDestroyed();
		this.semaphoreMgr.releaseSemaphore(name, agentId);
	}

	// ═══════════════════════════════════════════════════════════════
	// RESULT COLLECTION (delegated)
	// ═══════════════════════════════════════════════════════════════

	createCollector<T = unknown>(expected: number): ResultCollector<T> {
		this.assertNotDestroyed();
		return this.memoryMgr.createCollector<T>(expected);
	}

	submitResult<T = unknown>(collectorId: string, agentId: string, result: T): void {
		this.assertNotDestroyed();
		this.memoryMgr.submitResult(collectorId, agentId, result);
	}

	submitError(collectorId: string, agentId: string, error: Error): void {
		this.assertNotDestroyed();
		this.memoryMgr.submitError(collectorId, agentId, error);
	}

	waitForAll<T = unknown>(collectorId: string, timeout?: number): Promise<Map<string, T>> {
		this.assertNotDestroyed();
		return this.memoryMgr.waitForAll<T>(collectorId, timeout);
	}

	// ═══════════════════════════════════════════════════════════════
	// LIFECYCLE
	// ═══════════════════════════════════════════════════════════════

	cleanup(): void {
		const now = Date.now();
		for (const channel of this.channels.values()) {
			channel.history = channel.history.filter((msg) => {
				if (!msg.ttl) return true;
				return msg.timestamp + msg.ttl > now;
			});
		}
		this.lockMgr.cleanupLocks((resource, holder) => this.lockMgr.releaseLock(resource, holder));
		this.memoryMgr.cleanupRegions();
	}

	getStats(): HubStats {
		let activeSubscriptions = 0;
		for (const channel of this.channels.values()) {
			activeSubscriptions += channel.subscribers.size;
		}
		return {
			channels: this.channels.size,
			totalMessages: this.totalMessages,
			activeSubscriptions,
			regions: this.memoryMgr.regionCount,
			activeLocks: this.lockMgr.lockCount,
			barriers: this.barrierMgr.barrierCount,
			semaphores: this.semaphoreMgr.semaphoreCount,
			collectors: this.memoryMgr.collectorCount,
		};
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;

		if (this.cleanupTimer !== null) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}

		for (const [id, pending] of this.pendingReplies.entries()) {
			clearTimeout(pending.timer);
			pending.reject(new Error("Hub destroyed"));
			this.pendingReplies.delete(id);
		}

		this.lockMgr.rejectAll("Hub destroyed");

		this.channels.clear();
		this.handlers.clear();
		this.lockMgr.clear();
		this.barrierMgr.clear();
		this.semaphoreMgr.clear();
		this.memoryMgr.clear();

		this.log("[hub:destroy]");
	}

	// ═══════════════════════════════════════════════════════════════
	// INTERNAL -- for use by deadlock detection and patterns
	// ═══════════════════════════════════════════════════════════════

	getLocks(): ReadonlyMap<string, Lock> {
		return this.lockMgr.getLocks();
	}

	forceReleaseLock(resource: string): void {
		this.lockMgr.forceReleaseLock(resource);
	}

	// ═══════════════════════════════════════════════════════════════
	// PRIVATE
	// ═══════════════════════════════════════════════════════════════

	private assertNotDestroyed(): void {
		if (this.destroyed) {
			throw new Error("CommHub has been destroyed. No further operations are allowed.");
		}
	}

	private log(_message: string): void {
		// Logging disabled — consumers should use the event bus for observability
	}

	private deliverToAgent(envelope: AgentEnvelope): void {
		const topicHandlers = this.handlers.get(envelope.topic);
		if (!topicHandlers) return;
		const handler = topicHandlers.get(envelope.to);
		if (handler) {
			try { handler(envelope); } catch (err) {
				this.log(`[deliver:error] Failed to deliver to ${envelope.to}: ${err}`);
			}
		}
	}

	private deliverBroadcast(envelope: AgentEnvelope): void {
		const topicHandlers = this.handlers.get(envelope.topic);
		if (!topicHandlers) return;
		for (const [agentId, handler] of topicHandlers) {
			if (agentId === envelope.from) continue;
			try { handler(envelope); } catch (err) {
				this.log(`[broadcast:error] Failed to deliver to ${agentId}: ${err}`);
			}
		}
	}

	private storeInChannel(envelope: AgentEnvelope): void {
		const channel = this.channels.get(envelope.topic);
		if (!channel) return;
		channel.history.push(envelope);
		if (channel.history.length > channel.maxHistory) {
			channel.history = channel.history.slice(channel.history.length - channel.maxHistory);
		}
	}
}
