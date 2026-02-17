import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	ActorMailbox,
	Actor,
	MeshRouter,
	GossipProtocol,
	ActorSystem,
	ActorRef,
} from "../src/mesh/index.js";
import type {
	MeshEnvelope,
	MeshPriority,
	ActorBehavior,
	ActorContext,
	MessageReceiver,
	PeerView,
} from "../src/mesh/index.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a minimal MeshEnvelope for testing. */
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
	await new Promise<void>((r) => setTimeout(r, 10));
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTOR MAILBOX
// ═══════════════════════════════════════════════════════════════════════════

describe("ActorMailbox", () => {
	let mailbox: ActorMailbox;

	beforeEach(() => {
		mailbox = new ActorMailbox(5);
	});

	it("push/pop basic operations", () => {
		const env = makeEnvelope({ priority: 1 });
		expect(mailbox.push(env)).toBe(true);
		expect(mailbox.size).toBe(1);
		const popped = mailbox.pop();
		expect(popped).toBe(env);
		expect(mailbox.size).toBe(0);
	});

	it("priority ordering: critical > high > normal > low", () => {
		const low = makeEnvelope({ priority: 0, payload: "low" });
		const normal = makeEnvelope({ priority: 1, payload: "normal" });
		const high = makeEnvelope({ priority: 2, payload: "high" });
		const critical = makeEnvelope({ priority: 3, payload: "critical" });

		// Push in ascending order
		mailbox.push(low);
		mailbox.push(normal);
		mailbox.push(high);
		mailbox.push(critical);

		// Pop should return highest priority first
		expect(mailbox.pop()!.payload).toBe("critical");
		expect(mailbox.pop()!.payload).toBe("high");
		expect(mailbox.pop()!.payload).toBe("normal");
		expect(mailbox.pop()!.payload).toBe("low");
	});

	it("back-pressure when full (push returns false)", () => {
		// Capacity is 5
		for (let i = 0; i < 5; i++) {
			expect(mailbox.push(makeEnvelope())).toBe(true);
		}
		expect(mailbox.isFull).toBe(true);
		expect(mailbox.push(makeEnvelope())).toBe(false);
		expect(mailbox.size).toBe(5);
	});

	it("drain() returns all in priority order", () => {
		mailbox.push(makeEnvelope({ priority: 0, payload: "low" }));
		mailbox.push(makeEnvelope({ priority: 2, payload: "high" }));
		mailbox.push(makeEnvelope({ priority: 1, payload: "normal" }));

		const drained = mailbox.drain();
		expect(drained).toHaveLength(3);
		// Drain goes from highest lane to lowest
		expect(drained[0].payload).toBe("high");
		expect(drained[1].payload).toBe("normal");
		expect(drained[2].payload).toBe("low");
		expect(mailbox.isEmpty).toBe(true);
		expect(mailbox.size).toBe(0);
	});

	it("size, isEmpty, isFull getters", () => {
		expect(mailbox.size).toBe(0);
		expect(mailbox.isEmpty).toBe(true);
		expect(mailbox.isFull).toBe(false);

		mailbox.push(makeEnvelope());
		expect(mailbox.size).toBe(1);
		expect(mailbox.isEmpty).toBe(false);
		expect(mailbox.isFull).toBe(false);

		// Fill to capacity (5)
		for (let i = 1; i < 5; i++) {
			mailbox.push(makeEnvelope());
		}
		expect(mailbox.size).toBe(5);
		expect(mailbox.isFull).toBe(true);
	});

	it("peek() returns without removing", () => {
		const env = makeEnvelope({ priority: 3, payload: "peeked" });
		mailbox.push(env);
		mailbox.push(makeEnvelope({ priority: 0, payload: "low" }));

		const peeked = mailbox.peek();
		expect(peeked).toBe(env);
		expect(peeked!.payload).toBe("peeked");
		// Size should not change after peek
		expect(mailbox.size).toBe(2);
	});

	it("pop() returns undefined on empty mailbox", () => {
		expect(mailbox.pop()).toBeUndefined();
	});

	it("peek() returns undefined on empty mailbox", () => {
		expect(mailbox.peek()).toBeUndefined();
	});

	it("drain() returns empty array on empty mailbox", () => {
		const drained = mailbox.drain();
		expect(drained).toEqual([]);
	});

	it("FIFO within same priority lane", () => {
		const first = makeEnvelope({ priority: 1, payload: "first" });
		const second = makeEnvelope({ priority: 1, payload: "second" });
		const third = makeEnvelope({ priority: 1, payload: "third" });

		mailbox.push(first);
		mailbox.push(second);
		mailbox.push(third);

		expect(mailbox.pop()!.payload).toBe("first");
		expect(mailbox.pop()!.payload).toBe("second");
		expect(mailbox.pop()!.payload).toBe("third");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTOR
// ═══════════════════════════════════════════════════════════════════════════

describe("Actor", () => {
	let router: MeshRouter;

	beforeEach(() => {
		router = new MeshRouter();
	});

	afterEach(() => {
		router.destroy();
	});

	it("receives and processes messages", async () => {
		const received: unknown[] = [];
		const behavior: ActorBehavior = (env) => {
			received.push(env.payload);
		};

		const actor = new Actor("worker", behavior, router);
		router.addActor(actor);

		actor.receive(makeEnvelope({ to: "worker", payload: "task-1" }));
		await flush();

		expect(received).toEqual(["task-1"]);
	});

	it("calls behavior function with correct envelope and context", async () => {
		let capturedEnv: MeshEnvelope | undefined;
		let capturedCtx: ActorContext | undefined;

		const behavior: ActorBehavior = (env, ctx) => {
			capturedEnv = env;
			capturedCtx = ctx;
		};

		const actor = new Actor("inspector", behavior, router);
		router.addActor(actor);

		const envelope = makeEnvelope({ to: "inspector", payload: "inspect" });
		actor.receive(envelope);
		await flush();

		expect(capturedEnv).toBe(envelope);
		expect(capturedCtx).toBeDefined();
		expect(capturedCtx!.self).toBe("inspector");
		expect(typeof capturedCtx!.reply).toBe("function");
		expect(typeof capturedCtx!.send).toBe("function");
		expect(typeof capturedCtx!.ask).toBe("function");
		expect(typeof capturedCtx!.become).toBe("function");
		expect(typeof capturedCtx!.stop).toBe("function");
	});

	it("ctx.reply() sends reply back to sender", async () => {
		const replies: MeshEnvelope[] = [];

		// Create a "sender" that captures replies
		const senderActor: MessageReceiver = {
			actorId: "sender",
			receive(env) { replies.push(env); },
		};
		router.addActor(senderActor);

		const echoActor = new Actor("echo", (env, ctx) => {
			ctx.reply({ echoed: env.payload });
		}, router);
		router.addActor(echoActor);

		echoActor.receive(makeEnvelope({
			from: "sender",
			to: "echo",
			type: "ask",
			payload: "ping",
		}));
		await flush();

		expect(replies).toHaveLength(1);
		expect(replies[0].type).toBe("reply");
		expect(replies[0].to).toBe("sender");
		expect(replies[0].from).toBe("echo");
		expect((replies[0].payload as any).echoed).toBe("ping");
	});

	it("ctx.become() changes behavior (Erlang-style hot swap)", async () => {
		const log: string[] = [];

		const behaviorA: ActorBehavior = (_env, ctx) => {
			log.push("A");
			ctx.become(behaviorB);
		};
		const behaviorB: ActorBehavior = () => {
			log.push("B");
		};

		const actor = new Actor("chameleon", behaviorA, router);
		router.addActor(actor);

		// First message triggers behaviorA which swaps to B
		actor.receive(makeEnvelope({ to: "chameleon", payload: "m1" }));
		await flush();

		// Second message should hit behaviorB
		actor.receive(makeEnvelope({ to: "chameleon", payload: "m2" }));
		await flush();

		expect(log).toEqual(["A", "B"]);
	});

	it("ctx.stop() marks actor as dead", async () => {
		const actor = new Actor("mortal", (_env, ctx) => {
			ctx.stop();
		}, router);
		router.addActor(actor);

		expect(actor.isAlive).toBe(true);
		actor.receive(makeEnvelope({ to: "mortal" }));
		await flush();
		expect(actor.isAlive).toBe(false);
	});

	it("error in behavior does not crash actor", async () => {
		let callCount = 0;
		const actor = new Actor("resilient", () => {
			callCount++;
			if (callCount === 1) throw new Error("boom");
		}, router);
		router.addActor(actor);

		// First message throws
		actor.receive(makeEnvelope({ to: "resilient", payload: "crash" }));
		await flush();
		expect(actor.isAlive).toBe(true);

		// Second message still processes
		actor.receive(makeEnvelope({ to: "resilient", payload: "ok" }));
		await flush();
		expect(callCount).toBe(2);
	});

	it("dead actor ignores new messages", async () => {
		const received: unknown[] = [];
		const actor = new Actor("ghost", (env) => {
			received.push(env.payload);
		}, router);
		router.addActor(actor);

		actor.kill();
		actor.receive(makeEnvelope({ to: "ghost", payload: "ignored" }));
		await flush();

		expect(received).toEqual([]);
	});

	it("processes multiple messages in FIFO order", async () => {
		const order: number[] = [];
		const actor = new Actor("sequential", (env) => {
			order.push(env.payload as number);
		}, router);
		router.addActor(actor);

		for (let i = 0; i < 5; i++) {
			actor.receive(makeEnvelope({ to: "sequential", payload: i, priority: 1 }));
		}
		await flush();

		expect(order).toEqual([0, 1, 2, 3, 4]);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// MESH ROUTER
// ═══════════════════════════════════════════════════════════════════════════

describe("MeshRouter", () => {
	let router: MeshRouter;

	beforeEach(() => {
		router = new MeshRouter();
	});

	afterEach(() => {
		router.destroy();
	});

	it("point-to-point delivery to a specific actor", () => {
		const received: MeshEnvelope[] = [];
		const receiver: MessageReceiver = {
			actorId: "target",
			receive(env) { received.push(env); },
		};
		router.addActor(receiver);

		router.route(makeEnvelope({ to: "target", payload: "direct" }));

		expect(received).toHaveLength(1);
		expect(received[0].payload).toBe("direct");
	});

	it('broadcast (to="*") delivers to all actors except sender', () => {
		const receivedA: MeshEnvelope[] = [];
		const receivedB: MeshEnvelope[] = [];
		const receivedC: MeshEnvelope[] = [];

		router.addActor({ actorId: "a", receive(env) { receivedA.push(env); } });
		router.addActor({ actorId: "b", receive(env) { receivedB.push(env); } });
		router.addActor({ actorId: "c", receive(env) { receivedC.push(env); } });

		router.route(makeEnvelope({ from: "a", to: "*", payload: "broadcast" }));

		// Sender "a" should NOT receive
		expect(receivedA).toHaveLength(0);
		// Others should
		expect(receivedB).toHaveLength(1);
		expect(receivedC).toHaveLength(1);
		expect(receivedB[0].payload).toBe("broadcast");
	});

	it("topic pub/sub: subscribe + publish delivers to subscribers", () => {
		const receivedA: MeshEnvelope[] = [];
		const receivedB: MeshEnvelope[] = [];

		router.addActor({ actorId: "sub-a", receive(env) { receivedA.push(env); } });
		router.addActor({ actorId: "sub-b", receive(env) { receivedB.push(env); } });

		router.subscribe("sub-a", "news");
		router.subscribe("sub-b", "news");

		router.route(makeEnvelope({
			from: "publisher",
			to: "__topic__",
			topic: "news",
			payload: "breaking",
		}));

		expect(receivedA).toHaveLength(1);
		expect(receivedB).toHaveLength(1);
		expect(receivedA[0].payload).toBe("breaking");
	});

	it("TTL enforcement: expired messages are dropped", () => {
		const received: MeshEnvelope[] = [];
		router.addActor({ actorId: "target", receive(env) { received.push(env); } });

		const events: any[] = [];
		router.on((e) => events.push(e));

		// Create an envelope that is already expired
		router.route(makeEnvelope({
			to: "target",
			timestamp: Date.now() - 60_000,
			ttl: 1_000,
		}));

		expect(received).toHaveLength(0);
		expect(events.some((e) => e.type === "undeliverable" && e.reason === "TTL expired")).toBe(true);
	});

	it("loop prevention: message dropped if destination in hops", () => {
		const received: MeshEnvelope[] = [];
		router.addActor({ actorId: "looper", receive(env) { received.push(env); } });

		const events: any[] = [];
		router.on((e) => events.push(e));

		// The destination "looper" is already in hops
		router.route(makeEnvelope({
			to: "looper",
			hops: ["sender", "looper"],
		}));

		expect(received).toHaveLength(0);
		expect(events.some((e) =>
			e.type === "undeliverable" && e.reason.includes("loop"),
		)).toBe(true);
	});

	it("ask/reply correlation resolves pending ask", async () => {
		// Create an echo actor that replies to asks
		const echoActor = new Actor("echo", (env, ctx) => {
			ctx.reply({ echoed: env.payload });
		}, router);
		router.addActor(echoActor);

		const reply = await router.ask("caller", "echo", "hello?", { timeout: 2000 });

		expect(reply.type).toBe("reply");
		expect((reply.payload as any).echoed).toBe("hello?");
	});

	it("undeliverable callback for unknown actors", () => {
		const events: any[] = [];
		router.on((e) => events.push(e));

		router.route(makeEnvelope({ to: "nonexistent" }));

		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("undeliverable");
		expect(events[0].reason).toContain("nonexistent");
	});

	it("reply resolution matches correlationId", async () => {
		// Set up an actor that delays replies
		const actor = new Actor("delayed", (env, ctx) => {
			setTimeout(() => ctx.reply("pong"), 5);
		}, router);
		router.addActor(actor);

		const reply = await router.ask("tester", "delayed", "ping", { timeout: 2000 });

		expect(reply.correlationId).toBeDefined();
		expect(reply.payload).toBe("pong");
		expect(reply.from).toBe("delayed");
	});

	it("ask times out if no reply arrives", async () => {
		// Actor that never replies
		router.addActor({
			actorId: "silent",
			receive() { /* do nothing */ },
		});

		await expect(
			router.ask("caller", "silent", "hello", { timeout: 50 }),
		).rejects.toThrow("Ask timed out");
	});

	it("unsubscribe removes actor from topic", () => {
		const received: MeshEnvelope[] = [];
		router.addActor({ actorId: "sub", receive(env) { received.push(env); } });

		router.subscribe("sub", "events");
		router.unsubscribe("sub", "events");

		const events: any[] = [];
		router.on((e) => events.push(e));

		router.route(makeEnvelope({
			from: "pub",
			to: "__topic__",
			topic: "events",
			payload: "ignored",
		}));

		expect(received).toHaveLength(0);
		// Should get undeliverable since no subscribers
		expect(events.some((e) => e.type === "undeliverable")).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// GOSSIP PROTOCOL
// ═══════════════════════════════════════════════════════════════════════════

describe("GossipProtocol", () => {
	let gossip: GossipProtocol;

	beforeEach(() => {
		gossip = new GossipProtocol({
			gossipFanout: 3,
			suspectTimeoutMs: 100,
			deadTimeoutMs: 200,
			gossipIntervalMs: 50,
		});
	});

	afterEach(() => {
		gossip.stop();
	});

	it("register peer adds it as alive", () => {
		gossip.register("peer-1", ["coding"], ["tools"]);
		const alive = gossip.findAlive();

		expect(alive).toHaveLength(1);
		expect(alive[0].actorId).toBe("peer-1");
		expect(alive[0].status).toBe("alive");
		expect(alive[0].expertise).toEqual(["coding"]);
		expect(alive[0].capabilities).toEqual(["tools"]);
	});

	it("merge remote view: higher generation wins", () => {
		gossip.register("peer-a");
		const localView = gossip.getView();
		const localGen = localView[0].generation;

		// Merge a remote view with higher generation
		const changed = gossip.merge([
			{
				actorId: "peer-a",
				status: "suspect",
				generation: localGen + 10,
				lastSeen: Date.now(),
			},
		]);

		expect(changed).toHaveLength(1);
		const view = gossip.getView();
		expect(view[0].status).toBe("suspect");
	});

	it("merge does not overwrite with lower generation", () => {
		gossip.register("peer-b");
		const localView = gossip.getView();
		const localGen = localView[0].generation;

		const changed = gossip.merge([
			{
				actorId: "peer-b",
				status: "dead",
				generation: localGen - 1,
				lastSeen: Date.now() - 99_999,
			},
		]);

		expect(changed).toHaveLength(0);
		expect(gossip.findAlive()).toHaveLength(1);
	});

	it("selectTargets returns correct fanout count", () => {
		for (let i = 0; i < 10; i++) {
			gossip.register(`node-${i}`);
		}

		// Fanout is 3
		const targets = gossip.selectTargets();
		expect(targets.length).toBeLessThanOrEqual(3);
		expect(targets.length).toBeGreaterThan(0);
	});

	it("sweep transitions: alive -> suspect -> dead", async () => {
		const events: any[] = [];
		gossip.on((e) => events.push(e));

		// Register with an old lastSeen to simulate timeout
		gossip.merge([
			{
				actorId: "stale-peer",
				status: "alive",
				generation: 1,
				lastSeen: Date.now() - 150, // past suspectTimeoutMs (100ms)
			},
		]);

		// Sweep 1: alive -> suspect
		gossip.sweep();
		const view1 = gossip.getView().find((p) => p.actorId === "stale-peer");
		expect(view1?.status).toBe("suspect");
		expect(events.some((e) => e.type === "peer:suspect")).toBe(true);

		// Wait for dead timeout to be exceeded relative to lastSeen
		await new Promise<void>((r) => setTimeout(r, 60));

		// Sweep 2: suspect -> dead
		gossip.sweep();
		const view2 = gossip.getView().find((p) => p.actorId === "stale-peer");
		expect(view2?.status).toBe("dead");
		expect(events.some((e) => e.type === "peer:dead")).toBe(true);
	});

	it("findByExpertise matches capabilities", () => {
		gossip.register("coder", ["typescript", "rust"]);
		gossip.register("designer", ["figma", "css"]);
		gossip.register("polyglot", ["typescript", "python"]);

		const tsExperts = gossip.findByExpertise("typescript");
		expect(tsExperts).toHaveLength(2);
		expect(tsExperts.map((p) => p.actorId).sort()).toEqual(["coder", "polyglot"]);
	});

	it("findAlive returns only alive peers", () => {
		gossip.register("alive-1");
		gossip.register("alive-2");

		// Force one to suspect via merge with high generation
		gossip.merge([
			{
				actorId: "alive-1",
				status: "suspect",
				generation: 999,
				lastSeen: Date.now(),
			},
		]);

		const alive = gossip.findAlive();
		expect(alive).toHaveLength(1);
		expect(alive[0].actorId).toBe("alive-2");
	});

	it("start/stop lifecycle", () => {
		// start should not throw even if called twice
		gossip.start();
		gossip.start();

		// stop should clean up
		gossip.stop();
		// Further stop is safe
		gossip.stop();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTOR SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

describe("ActorSystem", () => {
	let system: ActorSystem;

	beforeEach(() => {
		system = new ActorSystem({
			maxMailboxSize: 100,
			defaultAskTimeout: 2000,
			gossipIntervalMs: 50_000, // Long interval to avoid sweep noise
		});
		system.start();
	});

	afterEach(() => {
		system.shutdown();
	});

	it("spawn() creates actor and returns ActorRef", () => {
		const ref = system.spawn("worker-1", {
			behavior: () => {},
		});

		expect(ref).toBeInstanceOf(ActorRef);
		expect(ref.actorId).toBe("worker-1");
		expect(system.actorCount).toBe(1);
	});

	it("spawn() throws on duplicate actor ID", () => {
		system.spawn("dup", { behavior: () => {} });
		expect(() => system.spawn("dup", { behavior: () => {} }))
			.toThrow('Actor "dup" already exists');
	});

	it("tell() delivers message to actor", async () => {
		const received: unknown[] = [];
		system.spawn("listener", {
			behavior: (env) => { received.push(env.payload); },
		});

		system.tell("external", "listener", "hello");
		await flush();

		expect(received).toEqual(["hello"]);
	});

	it("ask() with timeout gets reply", async () => {
		system.spawn("echo", {
			behavior: (env, ctx) => {
				ctx.reply({ echoed: env.payload });
			},
		});

		const reply = await system.ask("caller", "echo", "question", { timeout: 2000 });

		expect(reply.type).toBe("reply");
		expect((reply.payload as any).echoed).toBe("question");
	});

	it("broadcast() reaches all actors except sender", async () => {
		const receivedA: unknown[] = [];
		const receivedB: unknown[] = [];

		system.spawn("bcast-a", {
			behavior: (env) => { receivedA.push(env.payload); },
		});
		system.spawn("bcast-b", {
			behavior: (env) => { receivedB.push(env.payload); },
		});

		// Broadcast from "external" (not an actor)
		system.broadcast("external", "global-msg");
		await flush();

		expect(receivedA).toEqual(["global-msg"]);
		expect(receivedB).toEqual(["global-msg"]);
	});

	it("stop() kills actor and removes it from system", async () => {
		const received: unknown[] = [];
		system.spawn("doomed", {
			behavior: (env) => { received.push(env.payload); },
		});

		expect(system.actorCount).toBe(1);
		const stopped = system.stop("doomed");
		expect(stopped).toBe(true);
		expect(system.actorCount).toBe(0);

		// Messages to dead actor should not arrive
		system.tell("ext", "doomed", "after-death");
		await flush();
		expect(received).toEqual([]);
	});

	it("stop() returns false for nonexistent actor", () => {
		expect(system.stop("nope")).toBe(false);
	});

	it("subscribe()/unsubscribe() for topics", async () => {
		const received: unknown[] = [];
		system.spawn("topic-sub", {
			behavior: (env) => { received.push(env.payload); },
		});

		system.subscribe("topic-sub", "alerts");

		// Publish to the topic
		system.tell("publisher", "__topic__", "alert-1", { topic: "alerts" });
		await flush();
		expect(received).toEqual(["alert-1"]);

		// Unsubscribe
		system.unsubscribe("topic-sub", "alerts");

		system.tell("publisher", "__topic__", "alert-2", { topic: "alerts" });
		await flush();
		// Should still be just one
		expect(received).toEqual(["alert-1"]);
	});

	it("ref() returns ActorRef for existing actor", () => {
		system.spawn("reftest", { behavior: () => {} });

		const ref = system.ref("reftest");
		expect(ref).toBeInstanceOf(ActorRef);
		expect(ref!.actorId).toBe("reftest");
	});

	it("ref() returns undefined for nonexistent actor", () => {
		expect(system.ref("ghost")).toBeUndefined();
	});

	it("ActorRef.tell() delivers message", async () => {
		const received: unknown[] = [];
		const ref = system.spawn("ref-target", {
			behavior: (env) => { received.push(env.payload); },
		});

		ref.tell("external", "via-ref");
		await flush();

		expect(received).toEqual(["via-ref"]);
	});

	it("ActorRef.ask() works end-to-end", async () => {
		const ref = system.spawn("ref-echo", {
			behavior: (env, ctx) => {
				ctx.reply(`reply:${env.payload}`);
			},
		});

		const reply = await ref.ask("caller", "hi", { timeout: 2000 });
		expect(reply.payload).toBe("reply:hi");
	});

	it("shutdown cleans up all actors", () => {
		system.spawn("s1", { behavior: () => {} });
		system.spawn("s2", { behavior: () => {} });
		system.spawn("s3", { behavior: () => {} });

		expect(system.actorCount).toBe(3);
		expect(system.isRunning).toBe(true);

		system.shutdown();

		expect(system.actorCount).toBe(0);
		expect(system.isRunning).toBe(false);
	});

	it("spawn with custom behavior and expertise", () => {
		const events: any[] = [];
		system.on((e) => events.push(e));

		system.spawn("expert", {
			behavior: () => {},
			expertise: ["typescript", "testing"],
			capabilities: ["lint", "format"],
		});

		expect(events.some((e) =>
			e.type === "actor:spawned" && e.actorId === "expert",
		)).toBe(true);

		const experts = system.findByExpertise("typescript");
		expect(experts).toHaveLength(1);
		expect(experts[0].actorId).toBe("expert");
	});

	it("findAlive returns spawned actors", () => {
		system.spawn("live-1", { behavior: () => {} });
		system.spawn("live-2", { behavior: () => {} });

		const alive = system.findAlive();
		expect(alive).toHaveLength(2);
		const ids = alive.map((p) => p.actorId).sort();
		expect(ids).toEqual(["live-1", "live-2"]);
	});
});
