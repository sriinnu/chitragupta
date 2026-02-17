/**
 * @chitragupta/sutra/mesh — The Actor: fundamental unit of computation.
 *
 * Each actor encapsulates:
 *   - An identity (string ID)
 *   - A behaviour function that processes one envelope at a time
 *   - A priority mailbox (ActorMailbox)
 *   - A reference to the mesh router for outbound messages
 *
 * Processing is single-threaded per actor — `queueMicrotask` ensures
 * non-blocking cooperative scheduling while maintaining the guarantee
 * that an actor processes at most one message at a time.
 *
 * Like a Vedic rishi in meditation (dhyana), each actor processes its
 * stream of experience one sutra (thread) at a time, fully present
 * to each message before moving to the next.
 */

import { randomUUID } from "node:crypto";
import { ActorMailbox } from "./actor-mailbox.js";
import type {
	ActorBehavior,
	ActorContext,
	AskOptions,
	MeshEnvelope,
	MeshPriority,
	MessageReceiver,
	MessageSender,
	SendOptions,
} from "./types.js";

/**
 * A single actor in the mesh — receives envelopes, processes them
 * through its behavior function, and communicates via the router.
 */
export class Actor implements MessageReceiver {
	readonly actorId: string;
	private behavior: ActorBehavior;
	private readonly router: MessageSender;
	private readonly mailbox: ActorMailbox;
	private processing = false;
	private alive = true;

	constructor(
		id: string,
		behavior: ActorBehavior,
		router: MessageSender,
		mailboxSize?: number,
	) {
		this.actorId = id;
		this.behavior = behavior;
		this.router = router;
		this.mailbox = new ActorMailbox(mailboxSize);
	}

	// ─── Public ────────────────────────────────────────────────────

	get isAlive(): boolean {
		return this.alive;
	}

	/**
	 * Accept an envelope into this actor's mailbox and schedule draining.
	 */
	receive(envelope: MeshEnvelope): void {
		if (!this.alive) return;
		if (!this.mailbox.push(envelope)) {
			// Mailbox full — drop message (back-pressure signal)
			return;
		}
		this.schedule();
	}

	/**
	 * Mark this actor as dead. It will no longer accept or process messages.
	 */
	kill(): void {
		this.alive = false;
	}

	// ─── Private scheduling ────────────────────────────────────────

	/**
	 * Schedule a drain cycle if one is not already pending.
	 *
	 * Uses `queueMicrotask` so that the current synchronous call stack
	 * completes before draining begins — this prevents re-entrancy
	 * while keeping latency below a single event-loop tick.
	 */
	private schedule(): void {
		if (this.processing) return;
		this.processing = true;
		queueMicrotask(() => this.drain());
	}

	/**
	 * Drain the mailbox one envelope at a time, building a fresh
	 * ActorContext for each.
	 */
	private async drain(): Promise<void> {
		try {
			while (this.alive && !this.mailbox.isEmpty) {
				const envelope = this.mailbox.pop();
				if (!envelope) break;

				const ctx = this.buildContext(envelope);
				try {
					await this.behavior(envelope, ctx);
				} catch (_err) {
					// Error isolation: a faulty behavior must never crash
					// the mesh. The actor continues to live.
				}
			}
		} finally {
			this.processing = false;
			// If new messages arrived while we were draining, re-schedule.
			if (this.alive && !this.mailbox.isEmpty) {
				this.schedule();
			}
		}
	}

	// ─── Context factory ───────────────────────────────────────────

	/**
	 * Build an ActorContext scoped to a single incoming envelope.
	 */
	private buildContext(envelope: MeshEnvelope): ActorContext {
		const self = this.actorId;
		const router = this.router;
		const actor = this;

		return {
			self,

			reply(payload: unknown): void {
				if (envelope.type !== "ask" && envelope.type !== "tell") return;
				const replyEnv: MeshEnvelope = {
					id: randomUUID(),
					from: self,
					to: envelope.from,
					type: "reply",
					correlationId: envelope.id,
					payload,
					priority: envelope.priority,
					timestamp: Date.now(),
					ttl: envelope.ttl,
					hops: [self],
				};
				router.route(replyEnv);
			},

			send(to: string, payload: unknown, opts?: SendOptions): void {
				const env: MeshEnvelope = {
					id: randomUUID(),
					from: self,
					to,
					type: "tell",
					topic: opts?.topic,
					payload,
					priority: opts?.priority ?? 1,
					timestamp: Date.now(),
					ttl: opts?.ttl ?? envelope.ttl,
					hops: [self],
				};
				router.route(env);
			},

			ask(to: string, payload: unknown, opts?: AskOptions): Promise<MeshEnvelope> {
				const id = randomUUID();
				const env: MeshEnvelope = {
					id,
					from: self,
					to,
					type: "ask",
					topic: opts?.topic,
					payload,
					priority: opts?.priority ?? 1,
					timestamp: Date.now(),
					ttl: opts?.ttl ?? envelope.ttl,
					hops: [self],
				};
				// Delegate to the router's ask mechanism via a signal convention:
				// Attach a __askTimeout on the envelope so the router can set up
				// the pending reply. We route it and return a promise that the
				// router resolves when the reply arrives.
				(env as MeshEnvelope & { __askTimeout?: number }).__askTimeout =
					opts?.timeout;
				return new Promise<MeshEnvelope>((resolve, reject) => {
					(env as MeshEnvelope & {
						__resolve?: (e: MeshEnvelope) => void;
						__reject?: (e: Error) => void;
					}).__resolve = resolve;
					(env as MeshEnvelope & {
						__reject?: (e: Error) => void;
					}).__reject = reject;
					router.route(env);
				});
			},

			become(newBehavior: ActorBehavior): void {
				actor.behavior = newBehavior;
			},

			stop(): void {
				actor.alive = false;
			},
		};
	}
}
