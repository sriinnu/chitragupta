/**
 * CapabilityRouter — unit tests for decentralized capability-aware routing.
 *
 * Tests: matching, scoring, selection strategies, edge cases, gossip integration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GossipProtocol } from "../src/mesh/gossip-protocol.js";
import { PeerGuard } from "../src/mesh/peer-guard.js";
import { CapabilityRouter } from "../src/mesh/capability-router.js";
import type { PeerView } from "../src/mesh/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePeer(
	actorId: string,
	capabilities: string[],
	opts?: Partial<PeerView>,
): PeerView {
	return {
		actorId,
		capabilities,
		status: "alive",
		generation: 1,
		lastSeen: Date.now(),
		originNodeId: `node-${actorId}`,
		...opts,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CapabilityRouter", () => {
	let gossip: GossipProtocol;
	let guard: PeerGuard;
	let router: CapabilityRouter;

	beforeEach(() => {
		gossip = new GossipProtocol({
			gossipIntervalMs: 60_000,
			suspectTimeoutMs: 5_000,
			deadTimeoutMs: 15_000,
		});
		guard = new PeerGuard();
		router = new CapabilityRouter(gossip, guard);
	});

	afterEach(() => {
		gossip.stop();
	});

	// ═══════════════════════════════════════════════════════════════════
	// MATCHING
	// ═══════════════════════════════════════════════════════════════════

	describe("findMatching", () => {
		it("returns peers with a single capability", () => {
			gossip.register("peer-a", [], ["code-review"]);
			gossip.register("peer-b", [], ["testing"]);
			gossip.register("peer-c", [], ["code-review", "typescript"]);

			const results = router.findMatching("code-review");
			const ids = results.map((p) => p.actorId).sort();
			expect(ids).toEqual(["peer-a", "peer-c"]);
		});

		it("returns empty array when no peers match", () => {
			gossip.register("peer-a", [], ["testing"]);
			expect(router.findMatching("code-review")).toEqual([]);
		});
	});

	describe("findMatchingAll", () => {
		it("intersects multiple capabilities", () => {
			gossip.register("peer-a", [], ["typescript", "review"]);
			gossip.register("peer-b", [], ["typescript"]);
			gossip.register("peer-c", [], ["typescript", "review", "testing"]);

			const results = router.findMatchingAll(["typescript", "review"]);
			const ids = results.map((p) => p.actorId).sort();
			expect(ids).toEqual(["peer-a", "peer-c"]);
		});

		it("returns empty when no peer has all capabilities", () => {
			gossip.register("peer-a", [], ["typescript"]);
			gossip.register("peer-b", [], ["review"]);
			expect(router.findMatchingAll(["typescript", "review"])).toEqual([]);
		});

		it("returns empty for empty capabilities array", () => {
			gossip.register("peer-a", [], ["typescript"]);
			expect(router.findMatchingAll([])).toEqual([]);
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// RESOLVE
	// ═══════════════════════════════════════════════════════════════════

	describe("resolve", () => {
		it("returns undefined when no peers match", () => {
			gossip.register("peer-a", [], ["testing"]);
			const result = router.resolve({ capabilities: ["code-review"] });
			expect(result).toBeUndefined();
		});

		it("returns undefined for empty capabilities", () => {
			gossip.register("peer-a", [], ["testing"]);
			expect(router.resolve({ capabilities: [] })).toBeUndefined();
		});

		it("returns matching peer for single capability", () => {
			gossip.register("peer-a", [], ["code-review"]);
			const result = router.resolve({ capabilities: ["code-review"] });
			expect(result?.actorId).toBe("peer-a");
		});

		it("returns matching peer for multiple capabilities", () => {
			gossip.register("peer-a", [], ["code-review"]);
			gossip.register("peer-b", [], ["code-review", "typescript"]);
			const result = router.resolve({ capabilities: ["code-review", "typescript"] });
			expect(result?.actorId).toBe("peer-b");
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// SCORING
	// ═══════════════════════════════════════════════════════════════════

	describe("score", () => {
		it("scores higher when all capabilities match", () => {
			const peerFull = makePeer("full", ["ts", "review"]);
			const peerPartial = makePeer("partial", ["ts"]);

			const scoreFull = router.score(peerFull, ["ts", "review"]);
			const scorePartial = router.score(peerPartial, ["ts", "review"]);
			expect(scoreFull).toBeGreaterThan(scorePartial);
		});

		it("scores higher for more reliable peers (via PeerGuard)", () => {
			gossip.register("reliable", [], ["coding"]);
			gossip.register("flaky", [], ["coding"]);

			guard.recordSuccess("node-reliable", "ws://reliable:8080", 10);
			guard.recordSuccess("node-reliable", "ws://reliable:8080", 10);
			guard.recordFailure("node-flaky", "ws://flaky:8080");
			guard.recordFailure("node-flaky", "ws://flaky:8080");

			const peerR = makePeer("reliable", ["coding"], { originNodeId: "node-reliable" });
			const peerF = makePeer("flaky", ["coding"], { originNodeId: "node-flaky" });

			expect(router.score(peerR, ["coding"])).toBeGreaterThan(router.score(peerF, ["coding"]));
		});

		it("degrades gracefully without PeerGuard", () => {
			const noGuardRouter = new CapabilityRouter(gossip);
			gossip.register("peer-a", [], ["coding"]);
			const peer = makePeer("peer-a", ["coding"]);
			const score = noGuardRouter.score(peer, ["coding"]);
			expect(score).toBeGreaterThan(0);
		});

		it("scores lower for loaded nodes", () => {
			const peerA = makePeer("light", ["coding"]);
			const peerB = makePeer("heavy", ["coding"]);

			router.updateLoad("node-light", 5);
			router.updateLoad("node-heavy", 500);

			expect(router.score(peerA, ["coding"])).toBeGreaterThan(
				router.score(peerB, ["coding"]),
			);
		});

		it("scores lower for stale peers", () => {
			const recent = makePeer("recent", ["coding"]);
			const stale = makePeer("stale", ["coding"], {
				lastSeen: Date.now() - 12 * 3_600_000, // 12 hours ago
			});

			expect(router.score(recent, ["coding"])).toBeGreaterThan(
				router.score(stale, ["coding"]),
			);
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// SELECTION STRATEGIES
	// ═══════════════════════════════════════════════════════════════════

	describe("strategy: best", () => {
		it("returns highest-scored peer", () => {
			// Merge with originNodeId so reliability scoring works
			gossip.merge([
				makePeer("best", ["coding"], { originNodeId: "node-best" }),
				makePeer("okay", ["coding"], { originNodeId: "node-okay" }),
			]);

			guard.recordSuccess("node-best", "ws://best:8080", 5);
			guard.recordSuccess("node-best", "ws://best:8080", 5);
			guard.recordFailure("node-okay", "ws://okay:8080");

			const result = router.resolve({
				capabilities: ["coding"],
				strategy: "best",
			});
			expect(result?.actorId).toBe("best");
		});
	});

	describe("strategy: weighted-random", () => {
		it("distributes roughly proportional to scores", () => {
			// Merge with originNodeId so reliability scoring works
			gossip.merge([
				makePeer("high", ["coding"], { originNodeId: "node-high" }),
				makePeer("low", ["coding"], { originNodeId: "node-low" }),
			]);

			// Make "high" vastly more reliable
			for (let i = 0; i < 50; i++) {
				guard.recordSuccess("node-high", "ws://high:8080", 5);
			}
			for (let i = 0; i < 50; i++) {
				guard.recordFailure("node-low", "ws://low:8080");
			}

			const counts: Record<string, number> = { high: 0, low: 0 };
			for (let i = 0; i < 500; i++) {
				const result = router.resolve({
					capabilities: ["coding"],
					strategy: "weighted-random",
				});
				if (result) counts[result.actorId]++;
			}
			// "high" should be selected significantly more often
			expect(counts.high).toBeGreaterThan(counts.low * 1.5);
		});
	});

	describe("strategy: round-robin", () => {
		it("cycles through qualifying peers", () => {
			gossip.register("rr-a", [], ["coding"]);
			gossip.register("rr-b", [], ["coding"]);
			gossip.register("rr-c", [], ["coding"]);

			const results: string[] = [];
			for (let i = 0; i < 6; i++) {
				const peer = router.resolve({
					capabilities: ["coding"],
					strategy: "round-robin",
				});
				if (peer) results.push(peer.actorId);
			}

			// Should cycle: each peer appears exactly twice in 6 picks
			expect(results.length).toBe(6);
			const uniquePeers = new Set(results);
			expect(uniquePeers.size).toBe(3);
			for (const id of uniquePeers) {
				expect(results.filter((r) => r === id).length).toBe(2);
			}
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// PEER STATUS FILTERING
	// ═══════════════════════════════════════════════════════════════════

	describe("peer status filtering", () => {
		it("excludes dead peers", () => {
			gossip.register("alive-peer", [], ["coding"]);
			gossip.register("dead-peer", [], ["coding"]);
			// Force dead-peer to dead status via merge with higher generation
			gossip.merge([{
				actorId: "dead-peer",
				capabilities: ["coding"],
				status: "dead",
				generation: 999,
				lastSeen: Date.now(),
			}]);

			const results = router.findMatching("coding");
			expect(results.map((p) => p.actorId)).toEqual(["alive-peer"]);
		});

		it("excludes suspect peers", () => {
			gossip.register("alive-peer", [], ["coding"]);
			gossip.register("suspect-peer", [], ["coding"]);
			gossip.merge([{
				actorId: "suspect-peer",
				capabilities: ["coding"],
				status: "suspect",
				generation: 999,
				lastSeen: Date.now(),
			}]);

			const results = router.findMatching("coding");
			expect(results.map((p) => p.actorId)).toEqual(["alive-peer"]);
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// GOSSIP INTEGRATION
	// ═══════════════════════════════════════════════════════════════════

	describe("gossip integration", () => {
		it("capabilities propagated via merge appear in findByCapability", () => {
			// Simulate a remote peer's view arriving via gossip
			gossip.merge([
				makePeer("remote-reviewer", ["code-review", "typescript"]),
			]);

			const results = router.findMatching("code-review");
			expect(results.length).toBe(1);
			expect(results[0].actorId).toBe("remote-reviewer");
		});

		it("resolve works with gossip-propagated capabilities", () => {
			gossip.merge([
				makePeer("remote-a", ["typescript", "review"]),
				makePeer("remote-b", ["python", "review"]),
			]);

			const result = router.resolve({ capabilities: ["typescript", "review"] });
			expect(result?.actorId).toBe("remote-a");
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// LOAD TRACKING
	// ═══════════════════════════════════════════════════════════════════

	describe("load tracking", () => {
		it("updateLoad and clearLoad work correctly", () => {
			const peerA = makePeer("a", ["coding"]);
			router.updateLoad("node-a", 200);
			const scoreBefore = router.score(peerA, ["coding"]);

			router.clearLoad();
			const scoreAfter = router.score(peerA, ["coding"]);
			expect(scoreAfter).toBeGreaterThan(scoreBefore);
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// PEER GUARD INTEGRATION
	// ═══════════════════════════════════════════════════════════════════

	describe("PeerGuard integration", () => {
		it("guard scores influence selection order", () => {
			gossip.register("trusted", [], ["review"]);
			gossip.register("untrusted", [], ["review"]);

			// Build trust history
			for (let i = 0; i < 10; i++) {
				guard.recordSuccess("node-trusted", "ws://trusted:8080", 5);
			}
			guard.recordFailure("node-untrusted", "ws://untrusted:8080");

			const result = router.resolve({
				capabilities: ["review"],
				strategy: "best",
			});
			expect(result?.actorId).toBe("trusted");
		});
	});
});
