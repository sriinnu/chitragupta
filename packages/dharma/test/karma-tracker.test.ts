import { describe, it, expect, beforeEach } from "vitest";
import { KarmaTracker } from "@chitragupta/dharma";
import type { KarmaEventType, KarmaEvent, KarmaScore, TrustLevel } from "@chitragupta/dharma";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("KarmaTracker", () => {
	let karma: KarmaTracker;

	beforeEach(() => {
		karma = new KarmaTracker();
	});

	// ─── Construction ─────────────────────────────────────────────────────

	describe("construction", () => {
		it("should default maxEventsPerAgent to 1000", () => {
			const k = new KarmaTracker();
			// Record 1001 events; only 1000 should remain
			for (let i = 0; i < 1001; i++) {
				k.record("agent-1", "task_success", `task ${i}`);
			}
			expect(k.getHistory("agent-1")).toHaveLength(1000);
		});

		it("should accept a custom maxEventsPerAgent", () => {
			const k = new KarmaTracker({ maxEventsPerAgent: 5 });
			for (let i = 0; i < 10; i++) {
				k.record("agent-1", "task_success", `task ${i}`);
			}
			expect(k.getHistory("agent-1")).toHaveLength(5);
		});
	});

	// ─── record + getScore ────────────────────────────────────────────────

	describe("record + getScore", () => {
		it("should record a single event and update the score", () => {
			karma.record("agent-1", "task_success", "Completed refactor");
			const score = karma.getScore("agent-1");
			expect(score.total).toBe(3);
			expect(score.positive).toBe(3);
			expect(score.negative).toBe(0);
			expect(score.eventCount).toBe(1);
		});

		it("should accumulate scores across multiple events", () => {
			karma.record("agent-1", "task_success", "Task 1"); // +3
			karma.record("agent-1", "task_success", "Task 2"); // +3
			karma.record("agent-1", "task_failure", "Task 3"); // -2
			const score = karma.getScore("agent-1");
			expect(score.total).toBe(4); // 3 + 3 - 2
			expect(score.positive).toBe(6);
			expect(score.negative).toBe(-2);
			expect(score.eventCount).toBe(3);
		});

		it("should track separate scores per agent", () => {
			karma.record("agent-1", "task_success", "Success"); // +3
			karma.record("agent-2", "task_failure", "Failure"); // -2

			expect(karma.getScore("agent-1").total).toBe(3);
			expect(karma.getScore("agent-2").total).toBe(-2);
		});

		it("should return zero score for unknown agents", () => {
			const score = karma.getScore("unknown-agent");
			expect(score.total).toBe(0);
			expect(score.positive).toBe(0);
			expect(score.negative).toBe(0);
			expect(score.eventCount).toBe(0);
			expect(score.agentId).toBe("unknown-agent");
		});

		it("should return the created KarmaEvent from record()", () => {
			const event = karma.record("agent-1", "creative_solution", "Elegant fix");
			expect(event.id).toBeDefined();
			expect(event.agentId).toBe("agent-1");
			expect(event.type).toBe("creative_solution");
			expect(event.delta).toBe(4);
			expect(event.reason).toBe("Elegant fix");
			expect(typeof event.timestamp).toBe("number");
		});

		it("should allow custom delta to override default", () => {
			const event = karma.record("agent-1", "task_success", "Custom reward", 100);
			expect(event.delta).toBe(100);
			expect(karma.getScore("agent-1").total).toBe(100);
		});

		it("should allow custom negative delta", () => {
			const event = karma.record("agent-1", "task_success", "Harsh penalty", -50);
			expect(event.delta).toBe(-50);
			expect(karma.getScore("agent-1").total).toBe(-50);
			expect(karma.getScore("agent-1").negative).toBe(-50);
		});
	});

	// ─── KARMA_DELTAS ─────────────────────────────────────────────────────

	describe("KARMA_DELTAS", () => {
		const expectedDeltas: Record<KarmaEventType, number> = {
			task_success: 3,
			task_failure: -2,
			task_timeout: -1,
			peer_review_positive: 5,
			peer_review_negative: -3,
			tool_misuse: -5,
			policy_violation: -10,
			helpful_response: 2,
			creative_solution: 4,
			collaboration: 3,
		};

		for (const [type, expectedDelta] of Object.entries(expectedDeltas)) {
			it(`should assign delta ${expectedDelta} for '${type}'`, () => {
				const event = karma.record("agent-1", type as KarmaEventType, "test");
				expect(event.delta).toBe(expectedDelta);
			});
		}

		it("should cover all 10 event types", () => {
			expect(Object.keys(expectedDeltas)).toHaveLength(10);
		});
	});

	// ─── computeTrustLevel (via getScore) ─────────────────────────────────

	describe("computeTrustLevel (via getScore)", () => {
		// Helper: set an agent's karma to a specific total
		function setKarma(agentId: string, target: number): void {
			// Use custom deltas to reach the exact target
			if (target >= 0) {
				karma.record(agentId, "task_success", "set karma", target);
			} else {
				karma.record(agentId, "task_failure", "set karma", target);
			}
		}

		it("should return 'untrusted' for negative total", () => {
			setKarma("a", -1);
			expect(karma.getScore("a").trustLevel).toBe("untrusted");
		});

		it("should return 'untrusted' for total = -100", () => {
			setKarma("a", -100);
			expect(karma.getScore("a").trustLevel).toBe("untrusted");
		});

		it("should return 'novice' for total = 0", () => {
			// Unknown agent has 0 karma
			expect(karma.getScore("a").trustLevel).toBe("novice");
		});

		it("should return 'novice' for total = 9", () => {
			setKarma("a", 9);
			expect(karma.getScore("a").trustLevel).toBe("novice");
		});

		it("should return 'trusted' for total = 10", () => {
			setKarma("a", 10);
			expect(karma.getScore("a").trustLevel).toBe("trusted");
		});

		it("should return 'trusted' for total = 49", () => {
			setKarma("a", 49);
			expect(karma.getScore("a").trustLevel).toBe("trusted");
		});

		it("should return 'veteran' for total = 50", () => {
			setKarma("a", 50);
			expect(karma.getScore("a").trustLevel).toBe("veteran");
		});

		it("should return 'veteran' for total = 149", () => {
			setKarma("a", 149);
			expect(karma.getScore("a").trustLevel).toBe("veteran");
		});

		it("should return 'elite' for total = 150", () => {
			setKarma("a", 150);
			expect(karma.getScore("a").trustLevel).toBe("elite");
		});

		it("should return 'elite' for total = 1000", () => {
			setKarma("a", 1000);
			expect(karma.getScore("a").trustLevel).toBe("elite");
		});
	});

	// ─── FIFO Eviction ────────────────────────────────────────────────────

	describe("FIFO eviction", () => {
		it("should evict the oldest event when exceeding maxEventsPerAgent", () => {
			const k = new KarmaTracker({ maxEventsPerAgent: 3 });
			k.record("a", "task_success", "event-0"); // oldest
			k.record("a", "task_failure", "event-1");
			k.record("a", "helpful_response", "event-2");
			k.record("a", "collaboration", "event-3"); // pushes out event-0

			const history = k.getHistory("a");
			expect(history).toHaveLength(3);
			expect(history[0].reason).toBe("event-1");
			expect(history[1].reason).toBe("event-2");
			expect(history[2].reason).toBe("event-3");
		});

		it("should correctly recalculate score after eviction", () => {
			const k = new KarmaTracker({ maxEventsPerAgent: 2 });
			k.record("a", "task_success", "e1"); // +3, then evicted
			k.record("a", "task_failure", "e2"); // -2
			k.record("a", "helpful_response", "e3"); // +2, evicts e1

			// Only e2 (-2) and e3 (+2) remain
			const score = k.getScore("a");
			expect(score.total).toBe(0); // -2 + 2
			expect(score.eventCount).toBe(2);
		});

		it("should evict multiple events if needed", () => {
			const k = new KarmaTracker({ maxEventsPerAgent: 2 });
			k.record("a", "task_success", "e1");
			k.record("a", "task_success", "e2");
			k.record("a", "task_success", "e3");
			k.record("a", "task_success", "e4");
			k.record("a", "task_success", "e5");

			const history = k.getHistory("a");
			expect(history).toHaveLength(2);
			expect(history[0].reason).toBe("e4");
			expect(history[1].reason).toBe("e5");
		});
	});

	// ─── getHistory ───────────────────────────────────────────────────────

	describe("getHistory", () => {
		it("should return empty array for unknown agent", () => {
			expect(karma.getHistory("unknown")).toEqual([]);
		});

		it("should return events in chronological order", () => {
			karma.record("a", "task_success", "first");
			karma.record("a", "task_failure", "second");
			karma.record("a", "helpful_response", "third");

			const history = karma.getHistory("a");
			expect(history).toHaveLength(3);
			expect(history[0].reason).toBe("first");
			expect(history[1].reason).toBe("second");
			expect(history[2].reason).toBe("third");
		});

		it("should return a defensive copy (not a reference)", () => {
			karma.record("a", "task_success", "event");
			const h1 = karma.getHistory("a");
			const h2 = karma.getHistory("a");
			expect(h1).not.toBe(h2);
			expect(h1).toEqual(h2);
		});
	});

	// ─── getLeaderboard ───────────────────────────────────────────────────

	describe("getLeaderboard", () => {
		it("should return empty array when no agents exist", () => {
			expect(karma.getLeaderboard()).toEqual([]);
		});

		it("should return scores sorted by total karma descending", () => {
			karma.record("low", "task_failure", "fail"); // -2
			karma.record("high", "peer_review_positive", "great"); // +5
			karma.record("mid", "task_success", "ok"); // +3

			const board = karma.getLeaderboard();
			expect(board).toHaveLength(3);
			expect(board[0].agentId).toBe("high");
			expect(board[0].total).toBe(5);
			expect(board[1].agentId).toBe("mid");
			expect(board[1].total).toBe(3);
			expect(board[2].agentId).toBe("low");
			expect(board[2].total).toBe(-2);
		});

		it("should include trustLevel for each entry", () => {
			karma.record("a", "task_success", "ok", 150); // elite
			karma.record("b", "task_failure", "fail", -5); // untrusted

			const board = karma.getLeaderboard();
			expect(board[0].trustLevel).toBe("elite");
			expect(board[1].trustLevel).toBe("untrusted");
		});

		it("should include all fields in KarmaScore", () => {
			karma.record("a", "task_success", "ok");
			const board = karma.getLeaderboard();
			expect(board[0]).toHaveProperty("agentId");
			expect(board[0]).toHaveProperty("total");
			expect(board[0]).toHaveProperty("positive");
			expect(board[0]).toHaveProperty("negative");
			expect(board[0]).toHaveProperty("eventCount");
			expect(board[0]).toHaveProperty("trustLevel");
		});
	});

	// ─── serialize / deserialize ──────────────────────────────────────────

	describe("serialize / deserialize", () => {
		it("should produce valid JSON with version: 1", () => {
			karma.record("a", "task_success", "test");
			const json = karma.serialize();
			const parsed = JSON.parse(json);
			expect(parsed.version).toBe(1);
			expect(parsed.events).toBeDefined();
		});

		it("should roundtrip preserve all agent data", () => {
			karma.record("agent-1", "task_success", "completed refactor");
			karma.record("agent-1", "task_failure", "broke build");
			karma.record("agent-2", "creative_solution", "novel approach");

			const json = karma.serialize();

			const restored = new KarmaTracker();
			restored.deserialize(json);

			expect(restored.getScore("agent-1").total).toBe(karma.getScore("agent-1").total);
			expect(restored.getScore("agent-2").total).toBe(karma.getScore("agent-2").total);
			expect(restored.getHistory("agent-1")).toHaveLength(2);
			expect(restored.getHistory("agent-2")).toHaveLength(1);
		});

		it("should preserve event details through roundtrip", () => {
			karma.record("a", "policy_violation", "tried to delete .env");
			const json = karma.serialize();

			const restored = new KarmaTracker();
			restored.deserialize(json);

			const history = restored.getHistory("a");
			expect(history).toHaveLength(1);
			expect(history[0].type).toBe("policy_violation");
			expect(history[0].delta).toBe(-10);
			expect(history[0].reason).toBe("tried to delete .env");
			expect(history[0].agentId).toBe("a");
		});

		it("should replace existing state on deserialize", () => {
			karma.record("old-agent", "task_success", "old event");

			const other = new KarmaTracker();
			other.record("new-agent", "task_failure", "new event");
			const json = other.serialize();

			karma.deserialize(json);

			expect(karma.getHistory("old-agent")).toHaveLength(0);
			expect(karma.getHistory("new-agent")).toHaveLength(1);
		});

		it("should enforce maxEventsPerAgent on deserialized data", () => {
			// Create a tracker with lots of events
			const big = new KarmaTracker({ maxEventsPerAgent: 100 });
			for (let i = 0; i < 50; i++) {
				big.record("a", "task_success", `event-${i}`);
			}
			const json = big.serialize();

			// Restore into a tracker with smaller capacity
			const small = new KarmaTracker({ maxEventsPerAgent: 10 });
			small.deserialize(json);
			expect(small.getHistory("a")).toHaveLength(10);
			// Should keep the LATEST 10 events
			expect(small.getHistory("a")[0].reason).toBe("event-40");
			expect(small.getHistory("a")[9].reason).toBe("event-49");
		});

		it("should throw on unsupported version", () => {
			const badJson = JSON.stringify({ version: 99, events: {} });
			expect(() => karma.deserialize(badJson)).toThrow(/unsupported.*version/i);
		});

		it("should throw on malformed JSON", () => {
			expect(() => karma.deserialize("not json")).toThrow();
		});

		it("should handle empty state", () => {
			const json = karma.serialize();
			const parsed = JSON.parse(json);
			expect(parsed.version).toBe(1);
			expect(Object.keys(parsed.events)).toHaveLength(0);
		});
	});

	// ─── reset ────────────────────────────────────────────────────────────

	describe("reset", () => {
		it("should clear all events and score for a specific agent", () => {
			karma.record("a", "task_success", "test");
			karma.record("a", "task_success", "test 2");
			karma.reset("a");

			expect(karma.getHistory("a")).toHaveLength(0);
			expect(karma.getScore("a").total).toBe(0);
			expect(karma.getScore("a").eventCount).toBe(0);
		});

		it("should not affect other agents", () => {
			karma.record("a", "task_success", "a-event");
			karma.record("b", "task_success", "b-event");
			karma.reset("a");

			expect(karma.getHistory("a")).toHaveLength(0);
			expect(karma.getHistory("b")).toHaveLength(1);
		});

		it("should be safe to call for unknown agent", () => {
			expect(() => karma.reset("nonexistent")).not.toThrow();
		});

		it("should remove agent from leaderboard", () => {
			karma.record("a", "task_success", "test");
			karma.record("b", "task_success", "test");
			karma.reset("a");

			const board = karma.getLeaderboard();
			expect(board).toHaveLength(1);
			expect(board[0].agentId).toBe("b");
		});
	});

	// ─── Negative score scenarios ─────────────────────────────────────────

	describe("negative score scenarios", () => {
		it("should handle deeply negative scores", () => {
			for (let i = 0; i < 10; i++) {
				karma.record("bad-agent", "policy_violation", `violation-${i}`); // -10 each
			}
			const score = karma.getScore("bad-agent");
			expect(score.total).toBe(-100);
			expect(score.positive).toBe(0);
			expect(score.negative).toBe(-100);
			expect(score.trustLevel).toBe("untrusted");
		});

		it("should handle mixed positive and negative events", () => {
			karma.record("a", "task_success", "s1"); // +3
			karma.record("a", "policy_violation", "v1"); // -10
			karma.record("a", "peer_review_positive", "p1"); // +5
			karma.record("a", "tool_misuse", "m1"); // -5

			const score = karma.getScore("a");
			expect(score.total).toBe(-7); // 3 - 10 + 5 - 5
			expect(score.positive).toBe(8); // 3 + 5
			expect(score.negative).toBe(-15); // -10 - 5
		});
	});

	// ─── Zero delta edge case ─────────────────────────────────────────────

	describe("zero delta edge case", () => {
		it("should handle custom delta of 0 as positive (>= 0)", () => {
			karma.record("a", "task_success", "zero impact", 0);
			const score = karma.getScore("a");
			expect(score.total).toBe(0);
			// delta of 0 goes to positive bucket (>= 0 check in source)
			expect(score.positive).toBe(0);
			expect(score.negative).toBe(0);
			expect(score.eventCount).toBe(1);
		});
	});
});
