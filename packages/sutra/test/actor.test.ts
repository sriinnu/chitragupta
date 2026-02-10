import { describe, it, expect, vi, beforeEach } from "vitest";
import { Actor } from "../src/mesh/actor.js";
import type {
	ActorBehavior,
	MeshEnvelope,
	MessageSender,
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

/** Flush microtasks so actor drain loops run. */
async function flush(): Promise<void> {
	await new Promise<void>((r) => setTimeout(r, 20));
}

function makeRouter(): MessageSender & { routed: MeshEnvelope[] } {
	const routed: MeshEnvelope[] = [];
	return {
		routed,
		route(envelope: MeshEnvelope): void {
			routed.push(envelope);
		},
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Actor", () => {
	let router: ReturnType<typeof makeRouter>;

	beforeEach(() => {
		router = makeRouter();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// CONSTRUCTION
	// ═══════════════════════════════════════════════════════════════════════

	describe("construction", () => {
		it("should create an actor with the given id", () => {
			const actor = new Actor("test-actor", vi.fn(), router);
			expect(actor.actorId).toBe("test-actor");
		});

		it("should start alive", () => {
			const actor = new Actor("alive-actor", vi.fn(), router);
			expect(actor.isAlive).toBe(true);
		});

		it("should accept a custom mailbox size", async () => {
			const behavior = vi.fn();
			const actor = new Actor("sized", behavior, router, 5);
			// Push 5 messages — should all be accepted
			for (let i = 0; i < 5; i++) {
				actor.receive(makeEnvelope({ id: `m${i}`, to: "sized" }));
			}
			// 6th should be silently dropped (mailbox full)
			actor.receive(makeEnvelope({ id: "m5", to: "sized" }));
			// After flush, behavior should have been called 5 times
			await flush();
			expect(behavior).toHaveBeenCalledTimes(5);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// MESSAGE PROCESSING
	// ═══════════════════════════════════════════════════════════════════════

	describe("receive and processing", () => {
		it("should process a single envelope through the behavior", async () => {
			const behavior = vi.fn();
			const actor = new Actor("proc", behavior, router);

			actor.receive(makeEnvelope({ to: "proc", payload: "test" }));
			await flush();

			expect(behavior).toHaveBeenCalledTimes(1);
			expect(behavior.mock.calls[0][0].payload).toBe("test");
		});

		it("should process multiple envelopes sequentially", async () => {
			const order: string[] = [];
			const behavior: ActorBehavior = async (env) => {
				order.push(env.payload as string);
			};
			const actor = new Actor("seq", behavior, router);

			actor.receive(makeEnvelope({ to: "seq", payload: "first", priority: 1 }));
			actor.receive(makeEnvelope({ to: "seq", payload: "second", priority: 1 }));
			actor.receive(makeEnvelope({ to: "seq", payload: "third", priority: 1 }));
			await flush();

			expect(order).toEqual(["first", "second", "third"]);
		});

		it("should process higher priority messages before lower ones", async () => {
			const order: string[] = [];
			const behavior: ActorBehavior = async (env) => {
				order.push(env.payload as string);
			};
			const actor = new Actor("prio", behavior, router);

			// Push low first, then critical — critical should process first
			actor.receive(makeEnvelope({ to: "prio", payload: "low", priority: 0 }));
			actor.receive(makeEnvelope({ to: "prio", payload: "critical", priority: 3 }));
			await flush();

			expect(order[0]).toBe("critical");
			expect(order[1]).toBe("low");
		});

		it("should not process messages after being killed", async () => {
			const behavior = vi.fn();
			const actor = new Actor("killable", behavior, router);

			actor.kill();
			actor.receive(makeEnvelope({ to: "killable" }));
			await flush();

			expect(behavior).not.toHaveBeenCalled();
		});

		it("should silently drop messages when mailbox is full", async () => {
			const behavior = vi.fn();
			const actor = new Actor("tiny", behavior, router, 1);

			// First is accepted, second is dropped
			actor.receive(makeEnvelope({ to: "tiny", payload: "accepted" }));
			actor.receive(makeEnvelope({ to: "tiny", payload: "dropped" }));
			await flush();

			expect(behavior).toHaveBeenCalledTimes(1);
			expect(behavior.mock.calls[0][0].payload).toBe("accepted");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// KILL
	// ═══════════════════════════════════════════════════════════════════════

	describe("kill", () => {
		it("should mark the actor as not alive", () => {
			const actor = new Actor("mortal", vi.fn(), router);
			expect(actor.isAlive).toBe(true);
			actor.kill();
			expect(actor.isAlive).toBe(false);
		});

		it("should prevent further message acceptance", async () => {
			const behavior = vi.fn();
			const actor = new Actor("dead", behavior, router);
			actor.kill();
			actor.receive(makeEnvelope({ to: "dead" }));
			await flush();
			expect(behavior).not.toHaveBeenCalled();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// ACTOR CONTEXT — reply
	// ═══════════════════════════════════════════════════════════════════════

	describe("context.reply", () => {
		it("should route a reply envelope back to the sender", async () => {
			const behavior: ActorBehavior = (_env, ctx) => {
				ctx.reply("echo-back");
			};
			const actor = new Actor("echo", behavior, router);

			actor.receive(makeEnvelope({
				from: "caller",
				to: "echo",
				type: "tell",
				payload: "ping",
			}));
			await flush();

			expect(router.routed).toHaveLength(1);
			const reply = router.routed[0];
			expect(reply.type).toBe("reply");
			expect(reply.from).toBe("echo");
			expect(reply.to).toBe("caller");
			expect(reply.payload).toBe("echo-back");
		});

		it("should not reply to signal type envelopes", async () => {
			const behavior: ActorBehavior = (_env, ctx) => {
				ctx.reply("should-not-send");
			};
			const actor = new Actor("no-reply", behavior, router);

			actor.receive(makeEnvelope({
				to: "no-reply",
				type: "signal",
			}));
			await flush();

			expect(router.routed).toHaveLength(0);
		});

		it("should include correlationId matching the original envelope id", async () => {
			const behavior: ActorBehavior = (_env, ctx) => {
				ctx.reply("ack");
			};
			const actor = new Actor("corr", behavior, router);

			const original = makeEnvelope({ to: "corr", type: "ask", id: "ask-123" });
			actor.receive(original);
			await flush();

			expect(router.routed[0].correlationId).toBe("ask-123");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// ACTOR CONTEXT — send
	// ═══════════════════════════════════════════════════════════════════════

	describe("context.send", () => {
		it("should route a tell envelope to the target", async () => {
			const behavior: ActorBehavior = (_env, ctx) => {
				ctx.send("other-actor", "forwarded-data");
			};
			const actor = new Actor("forwarder", behavior, router);

			actor.receive(makeEnvelope({ to: "forwarder" }));
			await flush();

			expect(router.routed).toHaveLength(1);
			const sent = router.routed[0];
			expect(sent.type).toBe("tell");
			expect(sent.from).toBe("forwarder");
			expect(sent.to).toBe("other-actor");
			expect(sent.payload).toBe("forwarded-data");
		});

		it("should respect send options (priority, topic, ttl)", async () => {
			const behavior: ActorBehavior = (_env, ctx) => {
				ctx.send("target", "data", { priority: 3, topic: "urgent", ttl: 5000 });
			};
			const actor = new Actor("opts-sender", behavior, router);

			actor.receive(makeEnvelope({ to: "opts-sender" }));
			await flush();

			const sent = router.routed[0];
			expect(sent.priority).toBe(3);
			expect(sent.topic).toBe("urgent");
			expect(sent.ttl).toBe(5000);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// ACTOR CONTEXT — become (hot-swap behavior)
	// ═══════════════════════════════════════════════════════════════════════

	describe("context.become", () => {
		it("should hot-swap the behavior for subsequent messages", async () => {
			const results: string[] = [];
			const initialBehavior: ActorBehavior = (_env, ctx) => {
				results.push("initial");
				ctx.become((_env2) => {
					results.push("swapped");
				});
			};
			const actor = new Actor("chameleon", initialBehavior, router);

			actor.receive(makeEnvelope({ to: "chameleon", priority: 1 }));
			actor.receive(makeEnvelope({ to: "chameleon", priority: 1 }));
			await flush();

			expect(results).toEqual(["initial", "swapped"]);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// ACTOR CONTEXT — stop
	// ═══════════════════════════════════════════════════════════════════════

	describe("context.stop", () => {
		it("should stop the actor from within the behavior", async () => {
			const behavior: ActorBehavior = (_env, ctx) => {
				ctx.stop();
			};
			const actor = new Actor("self-destruct", behavior, router);

			actor.receive(makeEnvelope({ to: "self-destruct" }));
			await flush();

			expect(actor.isAlive).toBe(false);
		});

		it("should prevent processing of subsequent queued messages", async () => {
			const callCount = { value: 0 };
			const behavior: ActorBehavior = (_env, ctx) => {
				callCount.value++;
				ctx.stop();
			};
			const actor = new Actor("stopper", behavior, router);

			actor.receive(makeEnvelope({ to: "stopper", priority: 1 }));
			actor.receive(makeEnvelope({ to: "stopper", priority: 1 }));
			await flush();

			// Only the first message should have been processed
			expect(callCount.value).toBe(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// ERROR ISOLATION
	// ═══════════════════════════════════════════════════════════════════════

	describe("error isolation", () => {
		it("should continue processing after a behavior throws", async () => {
			const results: string[] = [];
			let first = true;
			const behavior: ActorBehavior = (env) => {
				if (first) {
					first = false;
					throw new Error("boom");
				}
				results.push(env.payload as string);
			};
			const actor = new Actor("resilient", behavior, router);

			actor.receive(makeEnvelope({ to: "resilient", payload: "crash", priority: 1 }));
			actor.receive(makeEnvelope({ to: "resilient", payload: "survive", priority: 1 }));
			await flush();

			expect(results).toEqual(["survive"]);
			expect(actor.isAlive).toBe(true);
		});

		it("should continue processing after an async behavior rejects", async () => {
			const results: string[] = [];
			let first = true;
			const behavior: ActorBehavior = async (env) => {
				if (first) {
					first = false;
					throw new Error("async boom");
				}
				results.push(env.payload as string);
			};
			const actor = new Actor("async-resilient", behavior, router);

			actor.receive(makeEnvelope({ to: "async-resilient", payload: "fail", priority: 1 }));
			actor.receive(makeEnvelope({ to: "async-resilient", payload: "ok", priority: 1 }));
			await flush();

			expect(results).toEqual(["ok"]);
			expect(actor.isAlive).toBe(true);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// CONTEXT — self
	// ═══════════════════════════════════════════════════════════════════════

	describe("context.self", () => {
		it("should expose the actor's own ID", async () => {
			let capturedSelf = "";
			const behavior: ActorBehavior = (_env, ctx) => {
				capturedSelf = ctx.self;
			};
			const actor = new Actor("identity", behavior, router);

			actor.receive(makeEnvelope({ to: "identity" }));
			await flush();

			expect(capturedSelf).toBe("identity");
		});
	});
});
