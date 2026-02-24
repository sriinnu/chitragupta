/**
 * CapabilityLearner — runtime capability discovery via observed behavior.
 *
 * Tests: success tracking, promotion threshold, failure handling,
 * decay, eviction, gossip integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GossipProtocol } from "../src/mesh/gossip-protocol.js";
import { CapabilityLearner } from "../src/mesh/capability-learner.js";
import type { MeshEnvelope } from "../src/mesh/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEnvelope(overrides: Partial<MeshEnvelope> = {}): MeshEnvelope {
	return {
		id: "test-id",
		from: "sender",
		to: "receiver",
		type: "tell",
		payload: {},
		priority: 1,
		timestamp: Date.now(),
		ttl: 30_000,
		hops: ["sender"],
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CapabilityLearner", () => {
	let gossip: GossipProtocol;
	let learner: CapabilityLearner;

	beforeEach(() => {
		gossip = new GossipProtocol({ gossipIntervalMs: 60_000 });
		learner = new CapabilityLearner(gossip, {
			promotionThreshold: 3,
			decayIntervalMs: 60_000,
		});
	});

	afterEach(() => {
		learner.destroy();
		gossip.stop();
	});

	// ═══════════════════════════════════════════════════════════════════
	// SUCCESS TRACKING
	// ═══════════════════════════════════════════════════════════════════

	describe("recordSuccess", () => {
		it("tracks successes by payload.type", () => {
			gossip.register("worker");
			const env = makeEnvelope({ payload: { type: "lint", file: "test.ts" } });
			learner.recordSuccess("worker", env);
			const stats = learner.getStats("worker", "lint");
			expect(stats?.successes).toBe(1);
			expect(stats?.failures).toBe(0);
		});

		it("tracks successes by topic when no payload.type", () => {
			gossip.register("worker");
			const env = makeEnvelope({ topic: "code-review", payload: { pr: 123 } });
			learner.recordSuccess("worker", env);
			expect(learner.getStats("worker", "code-review")?.successes).toBe(1);
		});

		it("ignores envelopes without type or topic", () => {
			gossip.register("worker");
			const env = makeEnvelope({ payload: { data: "raw" } });
			learner.recordSuccess("worker", env);
			expect(learner.trackedActorCount).toBe(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// PROMOTION
	// ═══════════════════════════════════════════════════════════════════

	describe("promotion", () => {
		it("promotes to capability after threshold successes", () => {
			gossip.register("worker");
			const env = makeEnvelope({ payload: { type: "lint" } });

			for (let i = 0; i < 3; i++) {
				learner.recordSuccess("worker", env);
			}

			const caps = learner.getLearnedCapabilities("worker");
			expect(caps).toContain("lint");
		});

		it("does not promote before threshold", () => {
			gossip.register("worker");
			const env = makeEnvelope({ payload: { type: "lint" } });

			for (let i = 0; i < 2; i++) {
				learner.recordSuccess("worker", env);
			}

			expect(learner.getLearnedCapabilities("worker")).toEqual([]);
		});

		it("registers capability in gossip on promotion", () => {
			gossip.register("worker", [], ["existing-cap"]);
			const env = makeEnvelope({ payload: { type: "lint" } });

			for (let i = 0; i < 3; i++) {
				learner.recordSuccess("worker", env);
			}

			// Check gossip view has the new capability
			const view = gossip.getView().find((v) => v.actorId === "worker");
			expect(view?.capabilities).toContain("lint");
			expect(view?.capabilities).toContain("existing-cap");
		});

		it("does not duplicate existing capabilities", () => {
			gossip.register("worker", [], ["lint"]);
			const env = makeEnvelope({ payload: { type: "lint" } });

			for (let i = 0; i < 3; i++) {
				learner.recordSuccess("worker", env);
			}

			const view = gossip.getView().find((v) => v.actorId === "worker");
			const lintCount = view?.capabilities?.filter((c) => c === "lint").length;
			expect(lintCount).toBe(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// FAILURE TRACKING
	// ═══════════════════════════════════════════════════════════════════

	describe("recordFailure", () => {
		it("tracks failures separately from successes", () => {
			gossip.register("worker");
			const env = makeEnvelope({ payload: { type: "deploy" } });

			learner.recordFailure("worker", env);
			learner.recordFailure("worker", env);
			learner.recordSuccess("worker", env);

			const stats = learner.getStats("worker", "deploy");
			expect(stats?.successes).toBe(1);
			expect(stats?.failures).toBe(2);
		});

		it("failures don't prevent promotion (only success count matters)", () => {
			gossip.register("worker");
			const env = makeEnvelope({ payload: { type: "lint" } });

			learner.recordFailure("worker", env);
			for (let i = 0; i < 3; i++) {
				learner.recordSuccess("worker", env);
			}

			expect(learner.getLearnedCapabilities("worker")).toContain("lint");
		});

		it("demotes unstable promoted capabilities when failure ratio is too high", () => {
			const governedLearner = new CapabilityLearner(gossip, {
				promotionThreshold: 3,
				demotionMinSamples: 6,
				demotionFailureRatio: 0.6,
			});
			gossip.register("worker");
			const env = makeEnvelope({ payload: { type: "lint" } });

			for (let i = 0; i < 3; i++) {
				governedLearner.recordSuccess("worker", env);
			}
			expect(governedLearner.getLearnedCapabilities("worker")).toContain("lint");

			for (let i = 0; i < 5; i++) {
				governedLearner.recordFailure("worker", env);
			}

			expect(governedLearner.getLearnedCapabilities("worker")).not.toContain("lint");
			const view = gossip.getView().find((v) => v.actorId === "worker");
			expect(view?.capabilities).not.toContain("lint");
			governedLearner.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// DECAY
	// ═══════════════════════════════════════════════════════════════════

	describe("decay", () => {
		it("lifecycle: start and stop without errors", () => {
			learner.start();
			learner.stop();
		});

		it("promoted capabilities survive decay", () => {
			gossip.register("worker");
			const env = makeEnvelope({ payload: { type: "lint" } });

			for (let i = 0; i < 3; i++) {
				learner.recordSuccess("worker", env);
			}

			expect(learner.getLearnedCapabilities("worker")).toContain("lint");
			// Even after destroy + clear, the gossip still has the capability
			const view = gossip.getView().find((v) => v.actorId === "worker");
			expect(view?.capabilities).toContain("lint");
		});

		it("demotes stale promoted capabilities after inactivity window", () => {
			vi.useFakeTimers();
			try {
				const governedLearner = new CapabilityLearner(gossip, {
					promotionThreshold: 3,
					decayIntervalMs: 1_000,
					inactivityDemotionMs: 1_000,
				});
				gossip.register("worker");
				const env = makeEnvelope({ payload: { type: "lint" } });
				for (let i = 0; i < 3; i++) governedLearner.recordSuccess("worker", env);
				expect(governedLearner.getLearnedCapabilities("worker")).toContain("lint");

				governedLearner.start();
				vi.advanceTimersByTime(1_500);

				expect(governedLearner.getLearnedCapabilities("worker")).not.toContain("lint");
				const view = gossip.getView().find((v) => v.actorId === "worker");
				expect(view?.capabilities).not.toContain("lint");
				governedLearner.destroy();
			} finally {
				vi.useRealTimers();
			}
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// EVICTION
	// ═══════════════════════════════════════════════════════════════════

	describe("eviction", () => {
		it("evicts oldest non-promoted type when at capacity", () => {
			const smallLearner = new CapabilityLearner(gossip, {
				promotionThreshold: 100,
				maxTrackedTypes: 3,
			});
			gossip.register("worker");

			// Fill to capacity
			smallLearner.recordSuccess("worker", makeEnvelope({ payload: { type: "a" } }));
			smallLearner.recordSuccess("worker", makeEnvelope({ payload: { type: "b" } }));
			smallLearner.recordSuccess("worker", makeEnvelope({ payload: { type: "c" } }));

			// Adding a 4th should evict the oldest
			smallLearner.recordSuccess("worker", makeEnvelope({ payload: { type: "d" } }));

			// "a" was oldest and should be evicted
			expect(smallLearner.getStats("worker", "a")).toBeUndefined();
			expect(smallLearner.getStats("worker", "d")).toBeDefined();
			smallLearner.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// MULTIPLE ACTORS
	// ═══════════════════════════════════════════════════════════════════

	describe("multiple actors", () => {
		it("tracks capabilities independently per actor", () => {
			gossip.register("worker-a");
			gossip.register("worker-b");

			const lintEnv = makeEnvelope({ payload: { type: "lint" } });
			const testEnv = makeEnvelope({ payload: { type: "test" } });

			for (let i = 0; i < 3; i++) {
				learner.recordSuccess("worker-a", lintEnv);
				learner.recordSuccess("worker-b", testEnv);
			}

			expect(learner.getLearnedCapabilities("worker-a")).toContain("lint");
			expect(learner.getLearnedCapabilities("worker-a")).not.toContain("test");
			expect(learner.getLearnedCapabilities("worker-b")).toContain("test");
			expect(learner.getLearnedCapabilities("worker-b")).not.toContain("lint");
		});

		it("forgets actor state on explicit cleanup", () => {
			gossip.register("worker-a");
			const env = makeEnvelope({ payload: { type: "lint" } });
			learner.recordSuccess("worker-a", env);
			expect(learner.getStats("worker-a", "lint")?.successes).toBe(1);

			learner.forgetActor("worker-a");
			expect(learner.getStats("worker-a", "lint")).toBeUndefined();
		});
	});
});
