import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActorSystem, ActorRef } from "../src/mesh/actor-system.js";
import type {
	ActorBehavior,
	MeshEnvelope,
} from "../src/mesh/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function flush(): Promise<void> {
	await new Promise<void>((r) => setTimeout(r, 30));
}

/** Create a typed vi.fn() mock that satisfies the ActorBehavior signature. */
function mockBehavior(): ActorBehavior {
	return vi.fn() as unknown as ActorBehavior;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ActorSystem", () => {
	let system: ActorSystem;

	beforeEach(() => {
		system = new ActorSystem({
			maxMailboxSize: 1000,
			defaultTTL: 30_000,
			gossipIntervalMs: 60_000, // slow gossip to avoid timer noise
			defaultAskTimeout: 2_000,
		});
	});

	afterEach(() => {
		system.shutdown();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// LIFECYCLE
	// ═══════════════════════════════════════════════════════════════════════

	describe("lifecycle", () => {
		it("should not be running before start()", () => {
			expect(system.isRunning).toBe(false);
		});

		it("should be running after start()", () => {
			system.start();
			expect(system.isRunning).toBe(true);
		});

		it("should not be running after shutdown()", () => {
			system.start();
			system.shutdown();
			expect(system.isRunning).toBe(false);
		});

		it("should be idempotent for multiple start() calls", () => {
			system.start();
			system.start();
			expect(system.isRunning).toBe(true);
		});

		it("should be idempotent for multiple shutdown() calls", () => {
			system.start();
			system.shutdown();
			system.shutdown();
			expect(system.isRunning).toBe(false);
		});

		it("should kill all actors on shutdown", async () => {
			system.start();
			const ref = system.spawn("worker", { behavior: mockBehavior() });
			expect(system.actorCount).toBe(1);
			system.shutdown();
			expect(system.actorCount).toBe(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// SPAWN
	// ═══════════════════════════════════════════════════════════════════════

	describe("spawn", () => {
		it("should spawn an actor and return an ActorRef", () => {
			const ref = system.spawn("actor-1", { behavior: mockBehavior() });
			expect(ref).toBeInstanceOf(ActorRef);
			expect(ref.actorId).toBe("actor-1");
		});

		it("should increase actorCount on spawn", () => {
			expect(system.actorCount).toBe(0);
			system.spawn("a", { behavior: mockBehavior() });
			expect(system.actorCount).toBe(1);
			system.spawn("b", { behavior: mockBehavior() });
			expect(system.actorCount).toBe(2);
		});

		it("should throw when spawning a duplicate actor ID", () => {
			system.spawn("dup", { behavior: mockBehavior() });
			expect(() => system.spawn("dup", { behavior: mockBehavior() }))
				.toThrow('Actor "dup" already exists');
		});

		it("should emit actor:spawned event", () => {
			const events: unknown[] = [];
			system.on((e) => events.push(e));
			system.spawn("observed", { behavior: mockBehavior() });
			// Spawn emits actor:spawned + peer:discovered (from gossip)
			const spawnedEvents = events.filter((e) => (e as { type: string }).type === "actor:spawned");
			expect(spawnedEvents).toHaveLength(1);
			expect((spawnedEvents[0] as { actorId: string }).actorId).toBe("observed");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// STOP
	// ═══════════════════════════════════════════════════════════════════════

	describe("stop", () => {
		it("should stop an existing actor and return true", () => {
			system.spawn("to-stop", { behavior: mockBehavior() });
			expect(system.stop("to-stop")).toBe(true);
			expect(system.actorCount).toBe(0);
		});

		it("should return false when stopping a non-existent actor", () => {
			expect(system.stop("ghost")).toBe(false);
		});

		it("should emit actor:stopped event", () => {
			system.spawn("to-stop", { behavior: mockBehavior() });
			const events: unknown[] = [];
			system.on((e) => events.push(e));
			system.stop("to-stop");
			expect(events).toHaveLength(1);
			expect((events[0] as { type: string }).type).toBe("actor:stopped");
		});

		it("should make ref() return undefined for stopped actors", () => {
			system.spawn("ephemeral", { behavior: mockBehavior() });
			expect(system.ref("ephemeral")).toBeDefined();
			system.stop("ephemeral");
			expect(system.ref("ephemeral")).toBeUndefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// REF
	// ═══════════════════════════════════════════════════════════════════════

	describe("ref", () => {
		it("should return an ActorRef for an existing actor", () => {
			system.spawn("lookup", { behavior: mockBehavior() });
			const ref = system.ref("lookup");
			expect(ref).toBeDefined();
			expect(ref!.actorId).toBe("lookup");
		});

		it("should return undefined for a non-existent actor", () => {
			expect(system.ref("nonexistent")).toBeUndefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// TELL (fire-and-forget)
	// ═══════════════════════════════════════════════════════════════════════

	describe("tell", () => {
		it("should deliver a message to the target actor", async () => {
			const received: unknown[] = [];
			system.spawn("listener", {
				behavior: (env) => { received.push(env.payload); },
			});

			system.tell("external", "listener", "hello-tell");
			await flush();

			expect(received).toEqual(["hello-tell"]);
		});

		it("should support priority and topic options", async () => {
			let capturedEnv: MeshEnvelope | undefined;
			system.spawn("opts-listener", {
				behavior: (env) => { capturedEnv = env; },
			});

			system.tell("ext", "opts-listener", "data", { priority: 3, topic: "urgent" });
			await flush();

			expect(capturedEnv).toBeDefined();
			expect(capturedEnv!.priority).toBe(3);
			expect(capturedEnv!.topic).toBe("urgent");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// ASK (request-reply)
	// ═══════════════════════════════════════════════════════════════════════

	describe("ask", () => {
		it("should send and receive a reply", async () => {
			system.spawn("echo", {
				behavior: (env, ctx) => { ctx.reply(env.payload); },
			});

			const reply = await system.ask("caller", "echo", "ping");
			expect(reply.payload).toBe("ping");
			expect(reply.type).toBe("reply");
		});

		it("should timeout if no reply arrives", async () => {
			system.spawn("silent", {
				behavior: () => { /* no reply */ },
			});

			await expect(
				system.ask("caller", "silent", "hello", { timeout: 100 }),
			).rejects.toThrow(/timed out/i);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// BROADCAST
	// ═══════════════════════════════════════════════════════════════════════

	describe("broadcast", () => {
		it("should deliver to all actors except the sender", async () => {
			const received: string[] = [];
			system.spawn("sender-actor", { behavior: mockBehavior() });
			system.spawn("recv-1", {
				behavior: (env) => { received.push("recv-1:" + env.payload); },
			});
			system.spawn("recv-2", {
				behavior: (env) => { received.push("recv-2:" + env.payload); },
			});

			system.broadcast("sender-actor", "broadcast-data");
			await flush();

			expect(received).toContain("recv-1:broadcast-data");
			expect(received).toContain("recv-2:broadcast-data");
			expect(received).toHaveLength(2);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// PUB/SUB
	// ═══════════════════════════════════════════════════════════════════════

	describe("subscribe / unsubscribe", () => {
		it("should allow subscribing and unsubscribing without errors", () => {
			system.spawn("sub-actor", { behavior: mockBehavior() });
			expect(() => system.subscribe("sub-actor", "news")).not.toThrow();
			expect(() => system.unsubscribe("sub-actor", "news")).not.toThrow();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// EVENTS
	// ═══════════════════════════════════════════════════════════════════════

	describe("event system", () => {
		it("should allow unsubscribing from events", () => {
			const events: unknown[] = [];
			const unsub = system.on((e) => events.push(e));
			system.spawn("ev-1", { behavior: mockBehavior() });
			const countAfterFirst = events.length;
			expect(countAfterFirst).toBeGreaterThanOrEqual(1);

			unsub();
			system.spawn("ev-2", { behavior: mockBehavior() });
			expect(events).toHaveLength(countAfterFirst); // no new events after unsub
		});

		it("should not crash if an event handler throws", () => {
			system.on(() => { throw new Error("bad handler"); });
			expect(() => system.spawn("safe", { behavior: mockBehavior() })).not.toThrow();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// ACTORREF
	// ═══════════════════════════════════════════════════════════════════════

	describe("ActorRef", () => {
		it("should provide tell() for fire-and-forget", async () => {
			const received: unknown[] = [];
			const ref = system.spawn("ref-target", {
				behavior: (env) => { received.push(env.payload); },
			});

			ref.tell("external", "via-ref");
			await flush();

			expect(received).toEqual(["via-ref"]);
		});

		it("should provide ask() for request-reply", async () => {
			const ref = system.spawn("ref-echo", {
				behavior: (env, ctx) => { ctx.reply("re:" + env.payload); },
			});

			const reply = await ref.ask("caller", "ping");
			expect(reply.payload).toBe("re:ping");
		});

		it("should support equals() comparison", () => {
			const ref1 = system.spawn("eq-actor", { behavior: mockBehavior() });
			const ref2 = system.ref("eq-actor")!;
			expect(ref1.equals(ref2)).toBe(true);
		});

		it("should provide a toString() representation", () => {
			const ref = system.spawn("str-actor", { behavior: mockBehavior() });
			expect(ref.toString()).toBe("ActorRef(str-actor)");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// PEER DISCOVERY (via gossip)
	// ═══════════════════════════════════════════════════════════════════════

	describe("peer discovery", () => {
		it("should find actors by expertise", () => {
			system.spawn("expert", {
				behavior: mockBehavior(),
				expertise: ["typescript", "rust"],
			});
			const found = system.findByExpertise("typescript");
			expect(found).toHaveLength(1);
			expect(found[0].actorId).toBe("expert");
		});

		it("should return empty when no actors match expertise", () => {
			system.spawn("no-match", { behavior: mockBehavior(), expertise: ["python"] });
			expect(system.findByExpertise("go")).toEqual([]);
		});

		it("should find all alive peers", () => {
			system.spawn("a1", { behavior: mockBehavior() });
			system.spawn("a2", { behavior: mockBehavior() });
			const alive = system.findAlive();
			expect(alive).toHaveLength(2);
		});

		it("should find peers by capability", () => {
			system.spawn("reviewer", { behavior: mockBehavior(), capabilities: ["code-review"] });
			system.spawn("coder", { behavior: mockBehavior(), capabilities: ["coding"] });
			const reviewers = system.findByCapability("code-review");
			expect(reviewers).toHaveLength(1);
			expect(reviewers[0].actorId).toBe("reviewer");
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// AUTO-REGISTRATION (CapableActorBehavior)
	// ═══════════════════════════════════════════════════════════════════

	describe("CapableActorBehavior auto-registration", () => {
		it("extracts capabilities from CapableActorBehavior", () => {
			system.spawn("auto-cap", {
				behavior: {
					capabilities: ["code-review", "typescript"],
					handle: mockBehavior(),
				},
			});
			const caps = system.findByCapability("code-review");
			expect(caps).toHaveLength(1);
			expect(caps[0].actorId).toBe("auto-cap");
			expect(caps[0].capabilities).toContain("typescript");
		});

		it("merges CapableActorBehavior caps with explicit caps", () => {
			system.spawn("merged", {
				behavior: {
					capabilities: ["review"],
					expertise: ["security"],
					handle: mockBehavior(),
				},
				capabilities: ["typescript"],
				expertise: ["coding"],
			});
			const byReview = system.findByCapability("review");
			const byTs = system.findByCapability("typescript");
			expect(byReview).toHaveLength(1);
			expect(byTs).toHaveLength(1);
			const peer = byReview[0];
			expect(peer.capabilities).toContain("review");
			expect(peer.capabilities).toContain("typescript");
			expect(peer.expertise).toContain("security");
			expect(peer.expertise).toContain("coding");
		});

		it("plain ActorBehavior still works (no capabilities)", () => {
			system.spawn("plain", { behavior: mockBehavior() });
			const alive = system.findAlive();
			expect(alive.some((p) => p.actorId === "plain")).toBe(true);
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// MCP TOOL INTROSPECTION
	// ═══════════════════════════════════════════════════════════════════

	describe("spawnFromMCP", () => {
		it("registers tool names as capabilities", () => {
			const tools = [
				{ name: "memory_search", description: "Search memory" },
				{ name: "session_list", description: "List sessions" },
				{ name: "recall", description: "Recall data" },
			];
			system.spawnFromMCP("chitragupta", tools, async () => ({ ok: true }));
			const caps1 = system.findByCapability("memory-search");
			const caps2 = system.findByCapability("session-list");
			const caps3 = system.findByCapability("recall");
			expect(caps1).toHaveLength(1);
			expect(caps2).toHaveLength(1);
			expect(caps3).toHaveLength(1);
			expect(caps1[0].actorId).toBe("chitragupta");
		});

		it("dispatches ask to onToolCall and replies", async () => {
			const tools = [{ name: "search", description: "Search" }];
			const onToolCall = vi.fn().mockResolvedValue({ results: ["a", "b"] });
			const ref = system.spawnFromMCP("searcher", tools, onToolCall);
			const reply = await ref.ask("caller", { tool: "search", args: { q: "test" } });
			expect(onToolCall).toHaveBeenCalledWith("search", { q: "test" });
			expect(reply.payload).toEqual({ results: ["a", "b"] });
		});
	});
});
