/**
 * @chitragupta/sutra/mesh — MeshRouter: distributed message routing.
 *
 * The MeshRouter is the nervous system of the actor mesh. It:
 *   - Delivers envelopes to local actors or peer channels
 *   - Manages request-reply correlation for `ask` patterns
 *   - Enforces TTL and loop-prevention via hop tracking
 *   - Supports topic-based pub/sub alongside point-to-point messaging
 *   - Broadcasts to all registered actors and peers
 *
 * The router emits events via a simple callback array pattern
 * (no Node EventEmitter dependency) for: delivered, undeliverable,
 * broadcast.
 *
 * Like the Vayu (wind) that carries prana through nadis, the router
 * carries envelopes through the mesh without altering their essence.
 */

import { randomUUID } from "node:crypto";
import type {
	AskOptions,
	MeshEnvelope,
	MeshPriority,
	MessageReceiver,
	MessageSender,
	PeerChannel,
	SendOptions,
} from "./types.js";

// ─── Event system ───────────────────────────────────────────────────────────

type RouterEvent =
	| { type: "delivered"; envelope: MeshEnvelope }
	| { type: "undeliverable"; envelope: MeshEnvelope; reason: string }
	| { type: "broadcast"; envelope: MeshEnvelope; recipientCount: number };

type RouterEventHandler = (event: RouterEvent) => void;

// ─── Pending ask tracker ────────────────────────────────────────────────────

interface PendingAsk {
	resolve: (envelope: MeshEnvelope) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

// ─── Router ─────────────────────────────────────────────────────────────────

const DEFAULT_TTL = 30_000;
const DEFAULT_ASK_TIMEOUT = 10_000;

/**
 * Distributed message router for the actor mesh.
 *
 * Implements the `MessageSender` contract so actors can route envelopes
 * through it without coupling to the delivery mechanism.
 */
export class MeshRouter implements MessageSender {
	private readonly actors = new Map<string, MessageReceiver>();
	private readonly channels = new Map<string, PeerChannel>();
	private readonly pending = new Map<string, PendingAsk>();
	private readonly topics = new Map<string, Set<string>>();
	private readonly eventHandlers: RouterEventHandler[] = [];
	private readonly defaultTTL: number;
	private readonly defaultAskTimeout: number;

	constructor(defaultTTL = DEFAULT_TTL, defaultAskTimeout = DEFAULT_ASK_TIMEOUT) {
		this.defaultTTL = defaultTTL;
		this.defaultAskTimeout = defaultAskTimeout;
	}

	// ─── Event subscription ────────────────────────────────────────

	/**
	 * Register a handler for router events.
	 * @returns An unsubscribe function.
	 */
	on(handler: RouterEventHandler): () => void {
		this.eventHandlers.push(handler);
		return () => {
			const idx = this.eventHandlers.indexOf(handler);
			if (idx >= 0) this.eventHandlers.splice(idx, 1);
		};
	}

	private emit(event: RouterEvent): void {
		for (const h of this.eventHandlers) {
			try { h(event); } catch { /* observer failures are non-fatal */ }
		}
	}

	// ─── Actor / channel registry ──────────────────────────────────

	addActor(receiver: MessageReceiver): void {
		this.actors.set(receiver.actorId, receiver);
	}

	removeActor(actorId: string): void {
		this.actors.delete(actorId);
		// Remove from all topic subscriptions
		for (const subscribers of this.topics.values()) {
			subscribers.delete(actorId);
		}
	}

	addChannel(channel: PeerChannel): void {
		this.channels.set(channel.peerId, channel);
	}

	removeChannel(peerId: string): void {
		this.channels.delete(peerId);
	}

	// ─── Topic pub/sub ─────────────────────────────────────────────

	subscribe(actorId: string, topic: string): void {
		let subs = this.topics.get(topic);
		if (!subs) {
			subs = new Set();
			this.topics.set(topic, subs);
		}
		subs.add(actorId);
	}

	unsubscribe(actorId: string, topic: string): void {
		const subs = this.topics.get(topic);
		if (!subs) return;
		subs.delete(actorId);
		if (subs.size === 0) this.topics.delete(topic);
	}

	// ─── Core routing ──────────────────────────────────────────────

	/**
	 * Route an envelope to its destination.
	 *
	 * Handles: replies to pending asks, TTL enforcement, loop
	 * prevention, broadcast ("*"), topic publish, point-to-point.
	 */
	route(envelope: MeshEnvelope): void {
		// 1. Handle replies to pending asks
		if (envelope.type === "reply" && envelope.correlationId) {
			const pending = this.pending.get(envelope.correlationId);
			if (pending) {
				clearTimeout(pending.timer);
				this.pending.delete(envelope.correlationId);
				pending.resolve(envelope);
				return;
			}
		}

		// 2. Intercept outbound asks — register pending before delivery
		if (envelope.type === "ask") {
			const extended = envelope as MeshEnvelope & {
				__resolve?: (e: MeshEnvelope) => void;
				__reject?: (e: Error) => void;
				__askTimeout?: number;
			};
			if (extended.__resolve && extended.__reject) {
				const timeout = extended.__askTimeout ?? this.defaultAskTimeout;
				const timer = setTimeout(() => {
					this.pending.delete(envelope.id);
					extended.__reject!(
						new Error(`Ask timed out after ${timeout}ms (to=${envelope.to})`),
					);
				}, timeout);
				this.pending.set(envelope.id, {
					resolve: extended.__resolve,
					reject: extended.__reject,
					timer,
				});
				// Clean transient properties before delivery
				delete extended.__resolve;
				delete extended.__reject;
				delete extended.__askTimeout;
			}
		}

		// 3. TTL check
		if (envelope.ttl > 0 && Date.now() - envelope.timestamp > envelope.ttl) {
			this.emit({
				type: "undeliverable",
				envelope,
				reason: "TTL expired",
			});
			return;
		}

		// 4. Loop prevention — discard if destination already in hops
		if (envelope.to !== "*" && envelope.hops.includes(envelope.to)) {
			this.emit({
				type: "undeliverable",
				envelope,
				reason: "Routing loop detected (destination in hops)",
			});
			return;
		}

		// 5. Broadcast
		if (envelope.to === "*") {
			this.doBroadcast(envelope);
			return;
		}

		// 6. Topic publish (if topic set and destination is "__topic__")
		if (envelope.topic && envelope.to === "__topic__") {
			this.doPublish(envelope);
			return;
		}

		// 7. Point-to-point delivery
		this.doDeliver(envelope);
	}

	// ─── Ask (external API) ────────────────────────────────────────

	/**
	 * Send an ask envelope and return a Promise for the reply.
	 */
	ask(
		from: string,
		to: string,
		payload: unknown,
		opts?: AskOptions,
	): Promise<MeshEnvelope> {
		const id = randomUUID();
		const timeout = opts?.timeout ?? this.defaultAskTimeout;

		return new Promise<MeshEnvelope>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Ask timed out after ${timeout}ms (to=${to})`));
			}, timeout);

			this.pending.set(id, { resolve, reject, timer });

			const envelope: MeshEnvelope = {
				id,
				from,
				to,
				type: "ask",
				topic: opts?.topic,
				payload,
				priority: opts?.priority ?? 1,
				timestamp: Date.now(),
				ttl: opts?.ttl ?? this.defaultTTL,
				hops: [from],
			};

			this.route(envelope);
		});
	}

	// ─── Delivery internals ────────────────────────────────────────

	/**
	 * Deliver to a local actor or forward via a peer channel.
	 */
	private doDeliver(envelope: MeshEnvelope): void {
		const local = this.actors.get(envelope.to);
		if (local) {
			local.receive(envelope);
			this.emit({ type: "delivered", envelope });
			return;
		}

		// Try peer channels
		for (const channel of this.channels.values()) {
			if (channel.peerId === envelope.to || channel.actorId === envelope.to) {
				channel.receive(envelope);
				this.emit({ type: "delivered", envelope });
				return;
			}
		}

		this.emit({
			type: "undeliverable",
			envelope,
			reason: `No local actor or peer channel for "${envelope.to}"`,
		});
	}

	/**
	 * Broadcast to all local actors and peer channels (except sender).
	 */
	private doBroadcast(envelope: MeshEnvelope): void {
		let count = 0;

		for (const [actorId, receiver] of this.actors) {
			if (actorId === envelope.from) continue;
			receiver.receive(envelope);
			count++;
		}

		for (const channel of this.channels.values()) {
			if (channel.peerId === envelope.from) continue;
			channel.receive(envelope);
			count++;
		}

		this.emit({ type: "broadcast", envelope, recipientCount: count });
	}

	/**
	 * Publish to all actors subscribed to the envelope's topic.
	 */
	private doPublish(envelope: MeshEnvelope): void {
		if (!envelope.topic) return;

		const subscribers = this.topics.get(envelope.topic);
		if (!subscribers || subscribers.size === 0) {
			this.emit({
				type: "undeliverable",
				envelope,
				reason: `No subscribers for topic "${envelope.topic}"`,
			});
			return;
		}

		let count = 0;
		for (const actorId of subscribers) {
			if (actorId === envelope.from) continue;
			const receiver = this.actors.get(actorId);
			if (receiver) {
				receiver.receive(envelope);
				count++;
			}
		}

		this.emit({ type: "broadcast", envelope, recipientCount: count });
	}

	// ─── Cleanup ───────────────────────────────────────────────────

	/**
	 * Reject all pending asks and clear internal state.
	 */
	destroy(): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(new Error("Router destroyed"));
			this.pending.delete(id);
		}
		this.actors.clear();
		this.channels.clear();
		this.topics.clear();
		this.eventHandlers.length = 0;
	}
}
