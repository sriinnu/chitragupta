import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MeshRouter } from "../src/mesh/mesh-router.js";
import type {
	MeshEnvelope,
	MessageReceiver,
	PeerChannel,
} from "../src/mesh/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEnvelope(overrides: Partial<MeshEnvelope> = {}): MeshEnvelope {
	return {
		id: overrides.id ?? crypto.randomUUID(),
		from: overrides.from ?? "sender",
		to: overrides.to ?? "receiver",
		type: overrides.type ?? "tell",
		payload: overrides.payload ?? "hello",
		priority: overrides.priority ?? 1,
		timestamp: overrides.timestamp ?? Date.now(),
		ttl: overrides.ttl ?? 30_000,
		hops: overrides.hops ?? ["sender"],
		topic: overrides.topic,
		correlationId: overrides.correlationId,
	};
}

function makeReceiver(id: string): MessageReceiver & { received: MeshEnvelope[] } {
	const received: MeshEnvelope[] = [];
	return {
		actorId: id,
		received,
		receive(envelope: MeshEnvelope): void {
			received.push(envelope);
		},
	};
}

function makePeerChannel(peerId: string, actorId?: string): PeerChannel & { received: MeshEnvelope[] } {
	const received: MeshEnvelope[] = [];
	return {
		peerId,
		actorId: actorId ?? peerId,
		received,
		receive(envelope: MeshEnvelope): void {
			received.push(envelope);
		},
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("MeshRouter", () => {
	let router: MeshRouter;

	beforeEach(() => {
		router = new MeshRouter(30_000, 2_000);
	});

	afterEach(() => {
		router.destroy();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// ACTOR REGISTRY
	// ═══════════════════════════════════════════════════════════════════════

	describe("actor registry", () => {
		it("should add and deliver to a local actor", () => {
			const recv = makeReceiver("local-1");
			router.addActor(recv);
			router.route(makeEnvelope({ to: "local-1" }));
			expect(recv.received).toHaveLength(1);
		});

		it("should remove an actor and emit undeliverable after removal", () => {
			const recv = makeReceiver("removable");
			router.addActor(recv);
			router.removeActor("removable");

			const events: unknown[] = [];
			router.on((e) => events.push(e));
			router.route(makeEnvelope({ to: "removable" }));

			expect(recv.received).toHaveLength(0);
			expect(events).toHaveLength(1);
			expect((events[0] as { type: string }).type).toBe("undeliverable");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// POINT-TO-POINT DELIVERY
	// ═══════════════════════════════════════════════════════════════════════

	describe("point-to-point delivery", () => {
		it("should deliver a tell envelope to the correct actor", () => {
			const a = makeReceiver("actor-a");
			const b = makeReceiver("actor-b");
			router.addActor(a);
			router.addActor(b);

			router.route(makeEnvelope({ to: "actor-b", payload: "for-b" }));

			expect(a.received).toHaveLength(0);
			expect(b.received).toHaveLength(1);
			expect(b.received[0].payload).toBe("for-b");
		});

		it("should emit delivered event on successful delivery", () => {
			const recv = makeReceiver("target");
			router.addActor(recv);

			const events: unknown[] = [];
			router.on((e) => events.push(e));
			router.route(makeEnvelope({ to: "target" }));

			expect(events).toHaveLength(1);
			expect((events[0] as { type: string }).type).toBe("delivered");
		});

		it("should emit undeliverable when no actor or channel exists", () => {
			const events: unknown[] = [];
			router.on((e) => events.push(e));
			router.route(makeEnvelope({ to: "nonexistent" }));

			expect(events).toHaveLength(1);
			const ev = events[0] as { type: string; reason: string };
			expect(ev.type).toBe("undeliverable");
			expect(ev.reason).toContain("nonexistent");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// PEER CHANNELS
	// ═══════════════════════════════════════════════════════════════════════

	describe("peer channels", () => {
		it("should deliver to a peer channel when no local actor matches", () => {
			const channel = makePeerChannel("remote-peer");
			router.addChannel(channel);

			router.route(makeEnvelope({ to: "remote-peer" }));
			expect(channel.received).toHaveLength(1);
		});

		it("should remove a peer channel", () => {
			const channel = makePeerChannel("removable-peer");
			router.addChannel(channel);
			router.removeChannel("removable-peer");

			const events: unknown[] = [];
			router.on((e) => events.push(e));
			router.route(makeEnvelope({ to: "removable-peer" }));

			expect(channel.received).toHaveLength(0);
			expect((events[0] as { type: string }).type).toBe("undeliverable");
		});

		it("should prefer local actor over peer channel with same ID", () => {
			const local = makeReceiver("shared-id");
			const peer = makePeerChannel("shared-id");
			router.addActor(local);
			router.addChannel(peer);

			router.route(makeEnvelope({ to: "shared-id" }));
			expect(local.received).toHaveLength(1);
			expect(peer.received).toHaveLength(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// TTL ENFORCEMENT
	// ═══════════════════════════════════════════════════════════════════════

	describe("TTL enforcement", () => {
		it("should discard expired envelopes", () => {
			const recv = makeReceiver("ttl-target");
			router.addActor(recv);

			const events: unknown[] = [];
			router.on((e) => events.push(e));

			// Envelope with timestamp in the past and short TTL
			router.route(makeEnvelope({
				to: "ttl-target",
				timestamp: Date.now() - 10_000,
				ttl: 5_000,
			}));

			expect(recv.received).toHaveLength(0);
			expect(events).toHaveLength(1);
			expect((events[0] as { reason: string }).reason).toBe("TTL expired");
		});

		it("should deliver envelopes that have not expired", () => {
			const recv = makeReceiver("ttl-ok");
			router.addActor(recv);
			router.route(makeEnvelope({
				to: "ttl-ok",
				timestamp: Date.now(),
				ttl: 30_000,
			}));
			expect(recv.received).toHaveLength(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// LOOP PREVENTION
	// ═══════════════════════════════════════════════════════════════════════

	describe("loop prevention", () => {
		it("should discard envelopes where destination is already in hops", () => {
			const recv = makeReceiver("loop-target");
			router.addActor(recv);

			const events: unknown[] = [];
			router.on((e) => events.push(e));

			router.route(makeEnvelope({
				to: "loop-target",
				hops: ["sender", "loop-target"],
			}));

			expect(recv.received).toHaveLength(0);
			expect((events[0] as { reason: string }).reason).toContain("loop");
		});

		it("should deliver envelopes where destination is not in hops", () => {
			const recv = makeReceiver("safe-target");
			router.addActor(recv);

			router.route(makeEnvelope({
				to: "safe-target",
				hops: ["sender", "intermediate"],
			}));

			expect(recv.received).toHaveLength(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// BROADCAST
	// ═══════════════════════════════════════════════════════════════════════

	describe("broadcast", () => {
		it("should deliver to all actors except the sender", () => {
			const sender = makeReceiver("bc-sender");
			const r1 = makeReceiver("bc-r1");
			const r2 = makeReceiver("bc-r2");
			router.addActor(sender);
			router.addActor(r1);
			router.addActor(r2);

			router.route(makeEnvelope({ from: "bc-sender", to: "*" }));

			expect(sender.received).toHaveLength(0);
			expect(r1.received).toHaveLength(1);
			expect(r2.received).toHaveLength(1);
		});

		it("should emit a broadcast event with recipientCount", () => {
			const r1 = makeReceiver("bc1");
			const r2 = makeReceiver("bc2");
			router.addActor(r1);
			router.addActor(r2);

			const events: unknown[] = [];
			router.on((e) => events.push(e));
			router.route(makeEnvelope({ from: "external", to: "*" }));

			expect(events).toHaveLength(1);
			const ev = events[0] as { type: string; recipientCount: number };
			expect(ev.type).toBe("broadcast");
			expect(ev.recipientCount).toBe(2);
		});

		it("should include peer channels in broadcast", () => {
			const r = makeReceiver("local");
			const ch = makePeerChannel("remote");
			router.addActor(r);
			router.addChannel(ch);

			router.route(makeEnvelope({ from: "ext", to: "*" }));

			expect(r.received).toHaveLength(1);
			expect(ch.received).toHaveLength(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// TOPIC PUB/SUB
	// ═══════════════════════════════════════════════════════════════════════

	describe("topic pub/sub", () => {
		it("should deliver to subscribers of a topic", () => {
			const r1 = makeReceiver("sub-1");
			const r2 = makeReceiver("sub-2");
			const r3 = makeReceiver("non-sub");
			router.addActor(r1);
			router.addActor(r2);
			router.addActor(r3);

			router.subscribe("sub-1", "news");
			router.subscribe("sub-2", "news");

			router.route(makeEnvelope({
				from: "publisher",
				to: "__topic__",
				topic: "news",
			}));

			expect(r1.received).toHaveLength(1);
			expect(r2.received).toHaveLength(1);
			expect(r3.received).toHaveLength(0);
		});

		it("should not deliver to an unsubscribed actor", () => {
			const r = makeReceiver("unsub-target");
			router.addActor(r);
			router.subscribe("unsub-target", "topic-a");
			router.unsubscribe("unsub-target", "topic-a");

			router.route(makeEnvelope({
				from: "pub",
				to: "__topic__",
				topic: "topic-a",
			}));

			expect(r.received).toHaveLength(0);
		});

		it("should emit undeliverable when no subscribers exist for a topic", () => {
			const events: unknown[] = [];
			router.on((e) => events.push(e));

			router.route(makeEnvelope({
				from: "pub",
				to: "__topic__",
				topic: "empty-topic",
			}));

			expect(events).toHaveLength(1);
			expect((events[0] as { reason: string }).reason).toContain("empty-topic");
		});

		it("should remove actor from topic subscriptions when actor is removed", () => {
			const r = makeReceiver("sub-removed");
			router.addActor(r);
			router.subscribe("sub-removed", "my-topic");
			router.removeActor("sub-removed");

			const events: unknown[] = [];
			router.on((e) => events.push(e));

			router.route(makeEnvelope({
				from: "pub",
				to: "__topic__",
				topic: "my-topic",
			}));

			// Should be undeliverable since the only subscriber was removed
			expect(events).toHaveLength(1);
			expect((events[0] as { type: string }).type).toBe("undeliverable");
		});

		it("should not deliver to the sender even if they are subscribed", () => {
			const pub = makeReceiver("self-pub");
			router.addActor(pub);
			router.subscribe("self-pub", "self-topic");

			router.route(makeEnvelope({
				from: "self-pub",
				to: "__topic__",
				topic: "self-topic",
			}));

			expect(pub.received).toHaveLength(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// ASK (request-reply)
	// ═══════════════════════════════════════════════════════════════════════

	describe("ask", () => {
		it("should resolve when a reply envelope arrives", async () => {
			const echoActor = makeReceiver("echo");
			// Override receive to auto-reply
			echoActor.receive = (env: MeshEnvelope) => {
				echoActor.received.push(env);
				const reply: MeshEnvelope = {
					id: crypto.randomUUID(),
					from: "echo",
					to: env.from,
					type: "reply",
					correlationId: env.id,
					payload: "echoed:" + env.payload,
					priority: env.priority,
					timestamp: Date.now(),
					ttl: env.ttl,
					hops: ["echo"],
				};
				router.route(reply);
			};
			router.addActor(echoActor);

			const result = await router.ask("caller", "echo", "ping");
			expect(result.payload).toBe("echoed:ping");
			expect(result.type).toBe("reply");
		});

		it("should reject on timeout", async () => {
			const silent = makeReceiver("silent");
			router.addActor(silent);

			await expect(
				router.ask("caller", "silent", "hello", { timeout: 100 }),
			).rejects.toThrow(/timed out/i);
		});

		it("should use default ask timeout when none specified", async () => {
			const shortRouter = new MeshRouter(30_000, 100);
			const silent = makeReceiver("silent2");
			shortRouter.addActor(silent);

			await expect(
				shortRouter.ask("caller", "silent2", "hello"),
			).rejects.toThrow(/timed out/i);

			shortRouter.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// EVENT SYSTEM
	// ═══════════════════════════════════════════════════════════════════════

	describe("event system", () => {
		it("should allow subscribing and unsubscribing from events", () => {
			const events: unknown[] = [];
			const unsub = router.on((e) => events.push(e));

			const recv = makeReceiver("ev-target");
			router.addActor(recv);
			router.route(makeEnvelope({ to: "ev-target" }));
			expect(events).toHaveLength(1);

			unsub();
			router.route(makeEnvelope({ to: "ev-target" }));
			expect(events).toHaveLength(1); // no new events
		});

		it("should not crash when an event handler throws", () => {
			router.on(() => { throw new Error("bad handler"); });
			const recv = makeReceiver("safe");
			router.addActor(recv);
			expect(() => router.route(makeEnvelope({ to: "safe" }))).not.toThrow();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// DESTROY
	// ═══════════════════════════════════════════════════════════════════════

	describe("destroy", () => {
		it("should reject all pending asks on destroy", async () => {
			const silent = makeReceiver("destroy-target");
			router.addActor(silent);

			const promise = router.ask("caller", "destroy-target", "data");
			router.destroy();

			await expect(promise).rejects.toThrow(/destroyed/i);
		});

		it("should clear all actors and channels on destroy", () => {
			const recv = makeReceiver("cleared");
			router.addActor(recv);
			router.destroy();

			// Re-subscribe to events after destroy
			const events: unknown[] = [];
			router.on((e) => events.push(e));
			router.route(makeEnvelope({ to: "cleared" }));

			// No delivery, no events (handlers cleared)
			expect(recv.received).toHaveLength(0);
		});
	});
});
