import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GossipProtocol } from "../src/mesh/gossip-protocol.js";
import type { PeerView } from "../src/mesh/types.js";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("GossipProtocol", () => {
	let gossip: GossipProtocol;

	beforeEach(() => {
		gossip = new GossipProtocol({
			suspectTimeoutMs: 500,
			deadTimeoutMs: 1500,
			gossipFanout: 2,
			gossipIntervalMs: 60_000, // slow to avoid timer noise
		});
	});

	afterEach(() => {
		gossip.stop();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// REGISTRATION
	// ═══════════════════════════════════════════════════════════════════════

	describe("register", () => {
		it("should register a new peer as alive", () => {
			gossip.register("peer-1");
			const view = gossip.getView();
			expect(view).toHaveLength(1);
			expect(view[0].actorId).toBe("peer-1");
			expect(view[0].status).toBe("alive");
		});

		it("should store expertise and capabilities", () => {
			gossip.register("expert", ["typescript", "ai"], ["code-gen"]);
			const view = gossip.getView();
			expect(view[0].expertise).toEqual(["typescript", "ai"]);
			expect(view[0].capabilities).toEqual(["code-gen"]);
		});

		it("should emit peer:discovered for new peers", () => {
			const events: unknown[] = [];
			gossip.on((e) => events.push(e));
			gossip.register("new-peer");
			expect(events).toHaveLength(1);
			expect((events[0] as { type: string }).type).toBe("peer:discovered");
		});

		it("should refresh an existing peer without emitting discovered again", () => {
			gossip.register("re-reg");
			const events: unknown[] = [];
			gossip.on((e) => events.push(e));
			gossip.register("re-reg");
			// No peer:discovered on re-registration
			expect(events).toHaveLength(0);
		});

		it("should increment generation on each register call", () => {
			gossip.register("gen-peer");
			const gen1 = gossip.getView()[0].generation;
			gossip.register("gen-peer-2");
			const gen2 = gossip.getView().find((p) => p.actorId === "gen-peer-2")!.generation;
			expect(gen2).toBeGreaterThan(gen1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// UNREGISTER
	// ═══════════════════════════════════════════════════════════════════════

	describe("unregister", () => {
		it("should remove a peer from the view", () => {
			gossip.register("to-remove");
			expect(gossip.getView()).toHaveLength(1);
			gossip.unregister("to-remove");
			expect(gossip.getView()).toHaveLength(0);
		});

		it("should handle unregistering a non-existent peer gracefully", () => {
			expect(() => gossip.unregister("ghost")).not.toThrow();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// VIEW QUERIES
	// ═══════════════════════════════════════════════════════════════════════

	describe("getView", () => {
		it("should return an empty array when no peers exist", () => {
			expect(gossip.getView()).toEqual([]);
		});

		it("should return all registered peers", () => {
			gossip.register("p1");
			gossip.register("p2");
			gossip.register("p3");
			expect(gossip.getView()).toHaveLength(3);
		});
	});

	describe("findAlive", () => {
		it("should return only alive peers", () => {
			gossip.register("alive-1");
			gossip.register("alive-2");
			const alive = gossip.findAlive();
			expect(alive).toHaveLength(2);
			expect(alive.every((p) => p.status === "alive")).toBe(true);
		});

		it("should return empty when no peers are alive", () => {
			expect(gossip.findAlive()).toEqual([]);
		});
	});

	describe("findByExpertise", () => {
		it("should find peers with matching expertise", () => {
			gossip.register("ts-dev", ["typescript"]);
			gossip.register("py-dev", ["python"]);
			gossip.register("full-stack", ["typescript", "python"]);

			const tsExperts = gossip.findByExpertise("typescript");
			expect(tsExperts).toHaveLength(2);
			expect(tsExperts.map((p) => p.actorId).sort()).toEqual(["full-stack", "ts-dev"]);
		});

		it("should return empty when no peers match", () => {
			gossip.register("dev", ["java"]);
			expect(gossip.findByExpertise("haskell")).toEqual([]);
		});

		it("should not return suspect or dead peers", async () => {
			// Register with old timestamp to force suspect on sweep
			gossip.register("old-peer", ["rust"]);
			// Manually set lastSeen to the past
			const view = gossip.getView();
			(view[0] as { lastSeen: number }).lastSeen = Date.now() - 10_000;
			// Trigger sweep to mark as suspect
			gossip.sweep();
			expect(gossip.findByExpertise("rust")).toHaveLength(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// VIEW MERGING
	// ═══════════════════════════════════════════════════════════════════════

	describe("merge", () => {
		it("should add new peers from incoming views", () => {
			const incoming: PeerView[] = [
				{
					actorId: "remote-1",
					status: "alive",
					generation: 5,
					lastSeen: Date.now(),
				},
			];

			const changed = gossip.merge(incoming);
			expect(changed).toHaveLength(1);
			expect(gossip.getView()).toHaveLength(1);
			expect(gossip.getView()[0].actorId).toBe("remote-1");
		});

		it("should emit peer:discovered for new peers in merge", () => {
			const events: unknown[] = [];
			gossip.on((e) => events.push(e));

			gossip.merge([
				{ actorId: "discovered", status: "alive", generation: 1, lastSeen: Date.now() },
			]);

			expect(events).toHaveLength(1);
			expect((events[0] as { type: string }).type).toBe("peer:discovered");
		});

		it("should update a peer when incoming generation is higher", () => {
			gossip.register("upgradable");
			const localGen = gossip.getView()[0].generation;

			const changed = gossip.merge([
				{
					actorId: "upgradable",
					status: "alive",
					generation: localGen + 10,
					lastSeen: Date.now(),
					expertise: ["updated"],
				},
			]);

			expect(changed).toHaveLength(1);
			expect(gossip.getView()[0].expertise).toEqual(["updated"]);
		});

		it("should NOT update a peer when incoming generation is lower", () => {
			gossip.register("stable");
			const localGen = gossip.getView()[0].generation;

			const changed = gossip.merge([
				{
					actorId: "stable",
					status: "dead",
					generation: localGen - 1,
					lastSeen: Date.now() - 100_000,
				},
			]);

			expect(changed).toHaveLength(0);
			expect(gossip.getView()[0].status).toBe("alive");
		});

		it("should handle empty incoming array", () => {
			const changed = gossip.merge([]);
			expect(changed).toEqual([]);
		});

		it("should handle merge with multiple peers", () => {
			const incoming: PeerView[] = [
				{ actorId: "m1", status: "alive", generation: 1, lastSeen: Date.now() },
				{ actorId: "m2", status: "alive", generation: 2, lastSeen: Date.now() },
				{ actorId: "m3", status: "suspect", generation: 3, lastSeen: Date.now() },
			];
			const changed = gossip.merge(incoming);
			expect(changed).toHaveLength(3);
			expect(gossip.getView()).toHaveLength(3);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// FAILURE DETECTION (sweep)
	// ═══════════════════════════════════════════════════════════════════════

	describe("sweep", () => {
		it("should transition alive -> suspect after suspectTimeoutMs", () => {
			gossip.register("stale-peer");
			// Set lastSeen to past beyond suspect threshold
			const view = gossip.getView();
			(view[0] as { lastSeen: number }).lastSeen = Date.now() - 1_000;

			const events: unknown[] = [];
			gossip.on((e) => events.push(e));
			gossip.sweep();

			expect(view[0].status).toBe("suspect");
			expect(events).toHaveLength(1);
			expect((events[0] as { type: string }).type).toBe("peer:suspect");
		});

		it("should transition suspect -> dead after deadTimeoutMs", () => {
			gossip.register("dying-peer");
			const view = gossip.getView();
			// First mark as suspect
			(view[0] as { lastSeen: number }).lastSeen = Date.now() - 1_000;
			gossip.sweep();
			expect(view[0].status).toBe("suspect");

			// Now set lastSeen beyond dead threshold
			(view[0] as { lastSeen: number }).lastSeen = Date.now() - 2_000;

			const events: unknown[] = [];
			gossip.on((e) => events.push(e));
			gossip.sweep();

			expect(view[0].status).toBe("dead");
			expect(events).toHaveLength(1);
			expect((events[0] as { type: string }).type).toBe("peer:dead");
		});

		it("should not transition a recently-seen alive peer", () => {
			gossip.register("fresh-peer");
			gossip.sweep();
			expect(gossip.getView()[0].status).toBe("alive");
		});

		it("should increment generation on status transition", () => {
			gossip.register("gen-track");
			const view = gossip.getView();
			const initialGen = view[0].generation;

			(view[0] as { lastSeen: number }).lastSeen = Date.now() - 1_000;
			gossip.sweep();

			expect(view[0].generation).toBeGreaterThan(initialGen);
		});

		it("should not transition dead peers further", () => {
			gossip.register("already-dead");
			const view = gossip.getView();
			// Force to suspect first
			(view[0] as { lastSeen: number }).lastSeen = Date.now() - 1_000;
			gossip.sweep();
			// Force to dead
			(view[0] as { lastSeen: number }).lastSeen = Date.now() - 2_000;
			gossip.sweep();
			expect(view[0].status).toBe("dead");

			const events: unknown[] = [];
			gossip.on((e) => events.push(e));
			// Another sweep should not emit anything
			gossip.sweep();
			expect(events).toHaveLength(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// TARGET SELECTION
	// ═══════════════════════════════════════════════════════════════════════

	describe("selectTargets", () => {
		it("should return up to gossipFanout targets", () => {
			gossip.register("t1");
			gossip.register("t2");
			gossip.register("t3");
			gossip.register("t4");

			const targets = gossip.selectTargets();
			expect(targets.length).toBeLessThanOrEqual(2); // fanout = 2
			expect(targets.length).toBeGreaterThanOrEqual(1);
		});

		it("should return empty when no alive peers exist", () => {
			expect(gossip.selectTargets()).toEqual([]);
		});

		it("should exclude specified actor IDs", () => {
			gossip.register("sel-1");
			gossip.register("sel-2");

			const targets = gossip.selectTargets(["sel-1"]);
			const targetIds = targets.map((t) => t.actorId);
			expect(targetIds).not.toContain("sel-1");
		});

		it("should return fewer than fanout if not enough candidates", () => {
			gossip.register("only-one");
			const targets = gossip.selectTargets();
			expect(targets).toHaveLength(1);
		});

		it("should only select alive peers", () => {
			gossip.register("alive-sel");
			gossip.register("suspect-sel");
			// Make one suspect
			const view = gossip.getView();
			const suspect = view.find((p) => p.actorId === "suspect-sel")!;
			(suspect as { lastSeen: number }).lastSeen = Date.now() - 1_000;
			gossip.sweep();

			const targets = gossip.selectTargets();
			expect(targets.every((t) => t.status === "alive")).toBe(true);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// LIFECYCLE
	// ═══════════════════════════════════════════════════════════════════════

	describe("lifecycle", () => {
		it("should start periodic sweeping", () => {
			vi.useFakeTimers();
			const shortGossip = new GossipProtocol({
				gossipIntervalMs: 100,
				suspectTimeoutMs: 50,
				deadTimeoutMs: 150,
			});

			shortGossip.register("timer-peer");
			const view = shortGossip.getView();
			(view[0] as { lastSeen: number }).lastSeen = Date.now() - 200;

			shortGossip.start();
			vi.advanceTimersByTime(150);

			expect(view[0].status).toBe("suspect");

			shortGossip.stop();
			vi.useRealTimers();
		});

		it("should be idempotent for multiple start() calls", () => {
			expect(() => {
				gossip.start();
				gossip.start();
			}).not.toThrow();
			gossip.stop();
		});

		it("should stop periodic sweeping", () => {
			vi.useFakeTimers();
			gossip.start();
			gossip.stop();

			gossip.register("after-stop");
			const view = gossip.getView();
			(view[0] as { lastSeen: number }).lastSeen = Date.now() - 10_000;

			vi.advanceTimersByTime(10_000);
			// Should NOT have been swept since stopped
			expect(view[0].status).toBe("alive");
			vi.useRealTimers();
		});

		it("should pause without clearing state", () => {
			gossip.register("persist");
			gossip.start();
			gossip.pause();
			expect(gossip.getView()).toHaveLength(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// EVENT SYSTEM
	// ═══════════════════════════════════════════════════════════════════════

	describe("event system", () => {
		it("should allow unsubscribing from events", () => {
			const events: unknown[] = [];
			const unsub = gossip.on((e) => events.push(e));
			gossip.register("ev-1");
			expect(events).toHaveLength(1);

			unsub();
			gossip.register("ev-2");
			expect(events).toHaveLength(1);
		});

		it("should not crash when an event handler throws", () => {
			gossip.on(() => { throw new Error("bad handler"); });
			expect(() => gossip.register("safe")).not.toThrow();
		});
	});
});
