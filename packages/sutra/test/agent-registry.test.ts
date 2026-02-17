import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentRegistry } from "@chitragupta/sutra";
import type { AgentEntry } from "@chitragupta/sutra";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeAgent(overrides: Partial<Omit<AgentEntry, "registeredAt" | "lastHeartbeat">> = {}) {
	return {
		id: overrides.id ?? "agent-1",
		name: overrides.name ?? "Test Agent",
		capabilities: overrides.capabilities ?? ["code-gen"],
		expertise: overrides.expertise ?? ["typescript"],
		status: overrides.status ?? ("idle" as const),
		load: overrides.load ?? 0,
		metadata: overrides.metadata,
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// AgentRegistry
// ═══════════════════════════════════════════════════════════════════════════

describe("AgentRegistry", () => {
	let registry: AgentRegistry;

	beforeEach(() => {
		registry = new AgentRegistry();
	});

	// ─── register / get ─────────────────────────────────────────────────

	describe("register / get", () => {
		it("should register an agent and retrieve it by ID", () => {
			registry.register(makeAgent({ id: "a1", name: "Alpha" }));
			const entry = registry.get("a1");
			expect(entry).toBeDefined();
			expect(entry!.id).toBe("a1");
			expect(entry!.name).toBe("Alpha");
		});

		it("should set registeredAt and lastHeartbeat timestamps on registration", () => {
			registry.register(makeAgent({ id: "a1" }));
			const entry = registry.get("a1")!;
			expect(entry.registeredAt).toBeGreaterThan(0);
			expect(entry.lastHeartbeat).toBeGreaterThan(0);
			expect(entry.lastHeartbeat).toBeGreaterThanOrEqual(entry.registeredAt);
		});

		it("should preserve registeredAt when re-registering an existing agent", () => {
			registry.register(makeAgent({ id: "a1" }));
			const firstRegisteredAt = registry.get("a1")!.registeredAt;

			// Small delay via fake timers
			vi.useFakeTimers();
			vi.advanceTimersByTime(100);
			registry.register(makeAgent({ id: "a1", name: "Updated Alpha" }));
			vi.useRealTimers();

			const entry = registry.get("a1")!;
			expect(entry.name).toBe("Updated Alpha");
			expect(entry.registeredAt).toBe(firstRegisteredAt);
		});

		it("should return undefined for an unregistered agent ID", () => {
			expect(registry.get("nonexistent")).toBeUndefined();
		});

		it("should throw when exceeding maxAgents capacity", () => {
			const small = new AgentRegistry({ maxAgents: 2 });
			small.register(makeAgent({ id: "a1" }));
			small.register(makeAgent({ id: "a2" }));
			expect(() => small.register(makeAgent({ id: "a3" }))).toThrow(/full/i);
		});

		it("should allow re-registering an existing agent when at capacity", () => {
			const small = new AgentRegistry({ maxAgents: 1 });
			small.register(makeAgent({ id: "a1" }));
			// Re-register same ID should NOT throw
			expect(() => small.register(makeAgent({ id: "a1", name: "Updated" }))).not.toThrow();
		});
	});

	// ─── unregister ─────────────────────────────────────────────────────

	describe("unregister", () => {
		it("should remove an agent so get returns undefined", () => {
			registry.register(makeAgent({ id: "a1" }));
			const removed = registry.unregister("a1");
			expect(removed).toBe(true);
			expect(registry.get("a1")).toBeUndefined();
		});

		it("should return false when unregistering a nonexistent agent", () => {
			expect(registry.unregister("ghost")).toBe(false);
		});

		it("should not affect other agents", () => {
			registry.register(makeAgent({ id: "a1" }));
			registry.register(makeAgent({ id: "a2" }));
			registry.unregister("a1");
			expect(registry.get("a2")).toBeDefined();
		});
	});

	// ─── updateStatus ───────────────────────────────────────────────────

	describe("updateStatus", () => {
		it("should change an agent's status", () => {
			registry.register(makeAgent({ id: "a1", status: "idle" }));
			const updated = registry.updateStatus("a1", "busy");
			expect(updated).toBe(true);
			expect(registry.get("a1")!.status).toBe("busy");
		});

		it("should update load when provided", () => {
			registry.register(makeAgent({ id: "a1", load: 0 }));
			registry.updateStatus("a1", "busy", 0.75);
			expect(registry.get("a1")!.load).toBe(0.75);
		});

		it("should clamp load to [0, 1]", () => {
			registry.register(makeAgent({ id: "a1" }));
			registry.updateStatus("a1", "busy", 1.5);
			expect(registry.get("a1")!.load).toBe(1);
			registry.updateStatus("a1", "busy", -0.5);
			expect(registry.get("a1")!.load).toBe(0);
		});

		it("should return false for unknown agent", () => {
			expect(registry.updateStatus("ghost", "idle")).toBe(false);
		});

		it("should update lastHeartbeat on status change", () => {
			vi.useFakeTimers();
			const t0 = Date.now();
			registry.register(makeAgent({ id: "a1" }));
			vi.advanceTimersByTime(500);
			registry.updateStatus("a1", "busy");
			expect(registry.get("a1")!.lastHeartbeat).toBe(t0 + 500);
			vi.useRealTimers();
		});
	});

	// ─── heartbeat ──────────────────────────────────────────────────────

	describe("heartbeat", () => {
		it("should update the lastHeartbeat timestamp", () => {
			vi.useFakeTimers();
			const t0 = Date.now();
			registry.register(makeAgent({ id: "a1" }));
			vi.advanceTimersByTime(1000);
			registry.heartbeat("a1");
			expect(registry.get("a1")!.lastHeartbeat).toBe(t0 + 1000);
			vi.useRealTimers();
		});

		it("should return true for existing agent", () => {
			registry.register(makeAgent({ id: "a1" }));
			expect(registry.heartbeat("a1")).toBe(true);
		});

		it("should return false for unknown agent", () => {
			expect(registry.heartbeat("ghost")).toBe(false);
		});
	});

	// ─── find (Jaccard scoring) ─────────────────────────────────────────

	describe("find", () => {
		beforeEach(() => {
			registry.register(makeAgent({
				id: "coder",
				capabilities: ["code-gen", "refactor", "test"],
				expertise: ["typescript", "rust"],
				status: "idle",
				load: 0,
			}));
			registry.register(makeAgent({
				id: "searcher",
				capabilities: ["search", "summarize"],
				expertise: ["web", "nlp"],
				status: "idle",
				load: 0.2,
			}));
			registry.register(makeAgent({
				id: "reviewer",
				capabilities: ["code-gen", "review"],
				expertise: ["typescript", "security"],
				status: "busy",
				load: 0.6,
			}));
		});

		it("should return agents filtered by default status (idle + busy)", () => {
			const results = registry.find({});
			expect(results.length).toBe(3);
		});

		it("should filter by explicit status", () => {
			const results = registry.find({ status: ["idle"] });
			const statuses = results.map((a) => a.status);
			expect(statuses.every((s) => s === "idle")).toBe(true);
		});

		it("should filter by maxLoad", () => {
			const results = registry.find({ maxLoad: 0.5 });
			for (const agent of results) {
				expect(agent.load).toBeLessThanOrEqual(0.5);
			}
		});

		it("should score higher for exact capability match", () => {
			const results = registry.find({ capabilities: ["code-gen", "refactor", "test"] });
			// "coder" has exact capability match → should be first
			expect(results[0]!.id).toBe("coder");
		});

		it("should score higher for capability + expertise overlap", () => {
			const results = registry.find({
				capabilities: ["code-gen"],
				expertise: ["typescript"],
			});
			// Scoring:
			// coder:    capJ=1/3=0.333, expJ=1/2=0.5, avail=1.0 → 0.6*0.333+0.3*0.5+0.1*1=0.45
			// reviewer: capJ=1/2=0.5,   expJ=1/2=0.5, avail=0.4 → 0.6*0.5+0.3*0.5+0.1*0.4=0.49
			// searcher: capJ=0,          expJ=0,       avail=0.8 → 0.08
			// reviewer wins due to higher capability Jaccard (fewer irrelevant caps)
			expect(results[0]!.id).toBe("reviewer");
			expect(results[1]!.id).toBe("coder");
			expect(results[2]!.id).toBe("searcher");
		});

		it("should exclude offline agents by default", () => {
			registry.register(makeAgent({ id: "offline-agent", status: "offline" }));
			const results = registry.find({ capabilities: ["code-gen"] });
			const ids = results.map((a) => a.id);
			expect(ids).not.toContain("offline-agent");
		});

		it("should include offline agents when explicitly requested", () => {
			registry.register(makeAgent({ id: "offline-agent", status: "offline" }));
			const results = registry.find({ status: ["offline"] });
			const ids = results.map((a) => a.id);
			expect(ids).toContain("offline-agent");
		});

		it("should return empty array when no agents match the status filter", () => {
			const results = registry.find({ status: ["offline"] });
			expect(results).toEqual([]);
		});

		it("should handle empty query (return all idle+busy agents)", () => {
			const results = registry.find({});
			expect(results.length).toBe(3);
		});
	});

	// ─── findBest ───────────────────────────────────────────────────────

	describe("findBest", () => {
		it("should return the highest-scored agent", () => {
			registry.register(makeAgent({
				id: "exact",
				capabilities: ["search", "summarize"],
				expertise: ["web"],
				status: "idle",
				load: 0,
			}));
			registry.register(makeAgent({
				id: "partial",
				capabilities: ["search"],
				expertise: ["backend"],
				status: "idle",
				load: 0,
			}));
			const best = registry.findBest(["search", "summarize"], ["web"]);
			expect(best).toBeDefined();
			expect(best!.id).toBe("exact");
		});

		it("should return undefined when no agents are registered", () => {
			const empty = new AgentRegistry();
			expect(empty.findBest(["anything"])).toBeUndefined();
		});

		it("should return undefined when no agents match the status filter", () => {
			registry.register(makeAgent({ id: "off", status: "offline" }));
			// findBest uses default status filter (idle + busy)
			expect(registry.findBest(["code-gen"])).toBeUndefined();
		});
	});

	// ─── Availability scoring ───────────────────────────────────────────

	describe("availability scoring", () => {
		it("should prefer idle agents with low load over busy agents with high load", () => {
			registry.register(makeAgent({
				id: "idle-agent",
				capabilities: ["task"],
				expertise: [],
				status: "idle",
				load: 0,
			}));
			registry.register(makeAgent({
				id: "busy-agent",
				capabilities: ["task"],
				expertise: [],
				status: "busy",
				load: 0.9,
			}));
			const results = registry.find({ capabilities: ["task"] });
			// Both have same capability score; idle agent has better availability (1-0=1 vs 1-0.9=0.1)
			expect(results[0]!.id).toBe("idle-agent");
		});
	});

	// ─── Jaccard scoring ────────────────────────────────────────────────

	describe("Jaccard scoring detail", () => {
		it("should score 1.0 for identical capability sets", () => {
			registry.register(makeAgent({
				id: "perfect",
				capabilities: ["a", "b", "c"],
				expertise: [],
				status: "idle",
				load: 0,
			}));
			const results = registry.find({ capabilities: ["a", "b", "c"] });
			// Jaccard(["a","b","c"], ["a","b","c"]) = 3/3 = 1.0
			// Score = 0.6*1 + 0.3*0 + 0.1*1 = 0.7
			expect(results).toHaveLength(1);
			expect(results[0]!.id).toBe("perfect");
		});

		it("should score 0 for completely disjoint capability sets", () => {
			registry.register(makeAgent({
				id: "disjoint",
				capabilities: ["x", "y"],
				expertise: [],
				status: "idle",
				load: 0,
			}));
			const results = registry.find({ capabilities: ["a", "b"] });
			// Jaccard(["a","b"], ["x","y"]) = 0/4 = 0
			// Score = 0.6*0 + 0.3*0 + 0.1*1 = 0.1
			// Still returned (just scored low) since status matches
			expect(results).toHaveLength(1);
		});

		it("should score partially for overlapping sets", () => {
			registry.register(makeAgent({
				id: "half",
				capabilities: ["a", "b", "c", "d"],
				expertise: [],
				status: "idle",
				load: 0,
			}));
			const results = registry.find({ capabilities: ["a", "b", "e", "f"] });
			// Jaccard(["a","b","e","f"], ["a","b","c","d"]) = 2/6 = 0.333
			expect(results).toHaveLength(1);
		});
	});

	// ─── sweep ──────────────────────────────────────────────────────────

	describe("sweep", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("should mark stale agents as offline", () => {
			registry.register(makeAgent({ id: "stale", status: "idle" }));
			vi.advanceTimersByTime(70_000); // Exceed default 60s timeout
			const swept = registry.sweep();
			expect(swept).toContain("stale");
			expect(registry.get("stale")!.status).toBe("offline");
		});

		it("should not mark agents that sent a recent heartbeat", () => {
			registry.register(makeAgent({ id: "alive", status: "idle" }));
			vi.advanceTimersByTime(50_000);
			registry.heartbeat("alive");
			vi.advanceTimersByTime(50_000); // 50s since last heartbeat (< 60s)
			const swept = registry.sweep();
			expect(swept).not.toContain("alive");
			expect(registry.get("alive")!.status).toBe("idle");
		});

		it("should skip agents already offline", () => {
			registry.register(makeAgent({ id: "off", status: "offline" }));
			vi.advanceTimersByTime(120_000);
			const swept = registry.sweep();
			expect(swept).not.toContain("off");
		});

		it("should accept a custom timeout", () => {
			registry.register(makeAgent({ id: "quick", status: "idle" }));
			vi.advanceTimersByTime(5_000);
			const swept = registry.sweep(3_000); // 5s > 3s custom timeout
			expect(swept).toContain("quick");
		});

		it("should return empty array when no agents are stale", () => {
			registry.register(makeAgent({ id: "fresh", status: "idle" }));
			const swept = registry.sweep();
			expect(swept).toEqual([]);
		});
	});

	// ─── getAll / clear ─────────────────────────────────────────────────

	describe("getAll / clear", () => {
		it("should return all registered agents", () => {
			registry.register(makeAgent({ id: "a1" }));
			registry.register(makeAgent({ id: "a2" }));
			registry.register(makeAgent({ id: "a3" }));
			const all = registry.getAll();
			expect(all).toHaveLength(3);
			const ids = all.map((a) => a.id).sort();
			expect(ids).toEqual(["a1", "a2", "a3"]);
		});

		it("should return empty array when no agents registered", () => {
			expect(registry.getAll()).toEqual([]);
		});

		it("should remove all agents on clear", () => {
			registry.register(makeAgent({ id: "a1" }));
			registry.register(makeAgent({ id: "a2" }));
			registry.clear();
			expect(registry.getAll()).toEqual([]);
			expect(registry.get("a1")).toBeUndefined();
			expect(registry.get("a2")).toBeUndefined();
		});
	});

	// ─── Edge cases ─────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should handle agents with empty capabilities and expertise", () => {
			registry.register(makeAgent({
				id: "empty",
				capabilities: [],
				expertise: [],
				status: "idle",
				load: 0,
			}));
			const results = registry.find({ capabilities: [], expertise: [] });
			expect(results).toHaveLength(1);
		});

		it("should handle find with undefined capabilities and expertise", () => {
			registry.register(makeAgent({ id: "a1", status: "idle" }));
			const results = registry.find({});
			expect(results).toHaveLength(1);
		});

		it("should store and retrieve metadata", () => {
			registry.register(makeAgent({
				id: "meta",
				metadata: { version: "1.0", region: "us-east" },
			}));
			const entry = registry.get("meta")!;
			expect(entry.metadata).toEqual({ version: "1.0", region: "us-east" });
		});
	});
});
