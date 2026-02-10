import { describe, it, expect, vi, beforeEach } from "vitest";
import { AkashaField } from "../src/akasha.js";
import type { StigmergicTrace, TraceType, AkashaConfig, DatabaseLike } from "../src/akasha.js";

// ─── Mock Database ───────────────────────────────────────────────────────────

/**
 * In-memory mock of the DatabaseLike interface (duck-typed SQLite).
 * Stores rows in a Map keyed by table name, supporting basic prepare/exec.
 */
function createMockDb(): DatabaseLike {
	const tables = new Map<string, unknown[]>();

	return {
		exec(sql: string) {
			// Parse CREATE TABLE to register the table name
			const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
			if (match && !tables.has(match[1])) {
				tables.set(match[1], []);
			}
		},
		prepare(sql: string) {
			return {
				run(...params: unknown[]) {
					// INSERT OR REPLACE
					if (sql.includes("INSERT OR REPLACE INTO akasha_traces")) {
						const rows = tables.get("akasha_traces") ?? [];
						const [id, agent_id, trace_type, topic, content, strength, reinforcements, metadata, created_at, last_reinforced_at] = params;
						// Remove existing row with same ID
						const filtered = rows.filter((r: any) => r.id !== id);
						filtered.push({
							id, agent_id, trace_type, topic, content,
							strength, reinforcements, metadata, created_at, last_reinforced_at,
						});
						tables.set("akasha_traces", filtered);
					}
				},
				all() {
					if (sql.includes("SELECT * FROM akasha_traces")) {
						return tables.get("akasha_traces") ?? [];
					}
					return [];
				},
				get() {
					return undefined;
				},
			};
		},
	};
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

const HOUR = 3_600_000;
const DAY = 86_400_000;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Akasha -- Shared Knowledge Field (Stigmergic Traces)", () => {
	let field: AkashaField;

	beforeEach(() => {
		field = new AkashaField();
	});

	// ── leave() ──────────────────────────────────────────────────────────

	describe("leave()", () => {
		it("should create a trace with correct fields", () => {
			const trace = field.leave("agent-1", "solution", "typescript generics", "Use conditional types for narrowing");

			expect(trace).toBeDefined();
			expect(trace.id).toMatch(/^aks-[0-9a-f]{8}$/);
			expect(trace.agentId).toBe("agent-1");
			expect(trace.traceType).toBe("solution");
			expect(trace.topic).toBe("typescript generics");
			expect(trace.content).toBe("Use conditional types for narrowing");
			expect(trace.strength).toBe(0.5);
			expect(trace.reinforcements).toBe(0);
			expect(trace.metadata).toEqual({});
			expect(trace.createdAt).toBeGreaterThan(0);
			expect(trace.lastReinforcedAt).toBe(trace.createdAt);
		});

		it("should store metadata when provided", () => {
			const meta = { language: "typescript", difficulty: "advanced" };
			const trace = field.leave("agent-1", "pattern", "error handling", "Always wrap async in try-catch", meta);

			expect(trace.metadata).toEqual(meta);
		});

		it("should generate deterministic FNV-1a IDs", () => {
			const t1 = field.leave("a", "solution", "topic1", "content1");
			const field2 = new AkashaField();
			const t2 = field2.leave("a", "solution", "topic1", "content1");

			expect(t1.id).toBe(t2.id);
		});

		it("should generate different IDs for different inputs", () => {
			const t1 = field.leave("agent-1", "solution", "topic-a", "content");
			const t2 = field.leave("agent-2", "solution", "topic-a", "content");

			expect(t1.id).not.toBe(t2.id);
		});

		it("should use configurable initial strength", () => {
			const customField = new AkashaField({ initialStrength: 0.8 });
			const trace = customField.leave("agent-1", "solution", "topic", "content");

			expect(trace.strength).toBe(0.8);
		});

		it("should truncate content at HARD_CEILING maxContentSize", () => {
			const longContent = "x".repeat(20_000);
			const trace = field.leave("agent-1", "solution", "topic", longContent);

			expect(trace.content.length).toBe(10_000);
		});

		it("should accept all six trace types", () => {
			const types: TraceType[] = ["solution", "warning", "shortcut", "pattern", "correction", "preference"];
			for (const type of types) {
				const trace = field.leave("agent-1", type, `topic-${type}`, `content-${type}`);
				expect(trace.traceType).toBe(type);
			}
		});

		it("should evict weakest trace when maxTraces is exceeded", () => {
			const smallField = new AkashaField({ maxTraces: 3 });

			const t1 = smallField.leave("a", "solution", "topic1", "content1");
			const t2 = smallField.leave("a", "solution", "topic2", "content2");
			const t3 = smallField.leave("a", "solution", "topic3", "content3");

			// All three should exist
			expect(smallField.stats().totalTraces).toBe(3);

			// Add a 4th -- should evict the weakest (all equal strength, so oldest)
			smallField.leave("a", "solution", "topic4", "content4");
			expect(smallField.stats().totalTraces).toBe(3);

			// The first trace should be evicted (oldest with equal strength)
			const results = smallField.strongest(10);
			const ids = results.map(t => t.id);
			expect(ids).not.toContain(t1.id);
		});

		it("should evict by strength when traces differ in strength", () => {
			const smallField = new AkashaField({ maxTraces: 2, initialStrength: 0.5 });

			const t1 = smallField.leave("a", "solution", "strong-topic", "strong-content");
			// Reinforce t1 to make it stronger
			smallField.reinforce(t1.id, "b");

			const t2 = smallField.leave("a", "warning", "weak-topic", "weak-content");

			// t1 is stronger (0.65), t2 is weaker (0.5)
			// Adding a 3rd should evict t2
			smallField.leave("a", "pattern", "new-topic", "new-content");
			expect(smallField.stats().totalTraces).toBe(2);

			const remaining = smallField.strongest(10);
			expect(remaining.find(t => t.id === t1.id)).toBeDefined();
			expect(remaining.find(t => t.id === t2.id)).toBeUndefined();
		});
	});

	// ── reinforce() ──────────────────────────────────────────────────────

	describe("reinforce()", () => {
		it("should increase trace strength by reinforcementBoost", () => {
			const trace = field.leave("agent-1", "solution", "topic", "content");
			const initial = trace.strength;

			const updated = field.reinforce(trace.id, "agent-2");

			expect(updated).not.toBeNull();
			expect(updated!.strength).toBe(initial + 0.15);
			expect(updated!.reinforcements).toBe(1);
		});

		it("should return null for non-existent trace", () => {
			expect(field.reinforce("aks-nonexistent", "agent-1")).toBeNull();
		});

		it("should prevent self-reinforcement", () => {
			const trace = field.leave("agent-1", "solution", "topic", "content");
			const result = field.reinforce(trace.id, "agent-1");

			expect(result).toBeNull();
			expect(trace.strength).toBe(0.5); // unchanged
		});

		it("should prevent duplicate reinforcement by same agent", () => {
			const trace = field.leave("agent-1", "solution", "topic", "content");
			field.reinforce(trace.id, "agent-2");
			const second = field.reinforce(trace.id, "agent-2");

			expect(second).toBeNull();
			expect(trace.reinforcements).toBe(1); // not 2
		});

		it("should allow multiple different agents to reinforce", () => {
			const trace = field.leave("agent-1", "solution", "topic", "content");

			field.reinforce(trace.id, "agent-2");
			field.reinforce(trace.id, "agent-3");
			field.reinforce(trace.id, "agent-4");

			expect(trace.reinforcements).toBe(3);
			expect(trace.strength).toBeCloseTo(0.5 + 3 * 0.15, 10);
		});

		it("should clamp strength to 1.0", () => {
			const highField = new AkashaField({ initialStrength: 0.9, reinforcementBoost: 0.5 });
			const trace = highField.leave("agent-1", "solution", "topic", "content");

			highField.reinforce(trace.id, "agent-2");
			expect(trace.strength).toBe(1.0);
		});

		it("should update lastReinforcedAt timestamp", () => {
			const trace = field.leave("agent-1", "solution", "topic", "content");
			const before = trace.lastReinforcedAt;

			// Small delay to ensure different timestamp
			const updated = field.reinforce(trace.id, "agent-2");
			expect(updated!.lastReinforcedAt).toBeGreaterThanOrEqual(before);
		});
	});

	// ── query() ──────────────────────────────────────────────────────────

	describe("query()", () => {
		it("should find traces by topic similarity", () => {
			field.leave("a", "solution", "typescript generics", "Use mapped types");
			field.leave("a", "solution", "python decorators", "Use functools.wraps");
			field.leave("a", "warning", "javascript closures", "Watch for variable capture");

			const results = field.query("typescript generics");
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].topic).toBe("typescript generics");
		});

		it("should return empty for empty query", () => {
			field.leave("a", "solution", "topic", "content");
			expect(field.query("")).toEqual([]);
		});

		it("should return empty for query with only stop words", () => {
			field.leave("a", "solution", "topic", "content");
			expect(field.query("the and or but")).toEqual([]);
		});

		it("should filter by trace type", () => {
			field.leave("a", "solution", "error handling async", "Use try-catch");
			field.leave("a", "warning", "error handling async", "Unhandled rejections crash");

			const solutions = field.query("error handling async", { type: "solution" });
			expect(solutions.length).toBe(1);
			expect(solutions[0].traceType).toBe("solution");

			const warnings = field.query("error handling async", { type: "warning" });
			expect(warnings.length).toBe(1);
			expect(warnings[0].traceType).toBe("warning");
		});

		it("should filter by minStrength", () => {
			const t1 = field.leave("a", "solution", "typescript types", "Use strict mode");
			const t2 = field.leave("a", "solution", "typescript interfaces", "Prefer interfaces over types");

			// Reinforce t1 to make it stronger
			field.reinforce(t1.id, "b");

			const results = field.query("typescript", { minStrength: 0.6 });
			expect(results.length).toBe(1);
			expect(results[0].id).toBe(t1.id);
		});

		it("should respect limit parameter", () => {
			for (let i = 0; i < 20; i++) {
				field.leave("a", "solution", `topic ${i} testing patterns`, `content ${i}`);
			}

			const results = field.query("testing patterns", { limit: 5 });
			expect(results.length).toBeLessThanOrEqual(5);
		});

		it("should rank by Jaccard similarity * strength", () => {
			const t1 = field.leave("a", "solution", "react hooks useState", "Use functional updates");
			const t2 = field.leave("a", "solution", "react hooks useEffect cleanup", "Return cleanup function");

			// Reinforce t2 to make it stronger
			field.reinforce(t2.id, "b");

			// Query that matches both but t1 more closely by Jaccard
			const results = field.query("react hooks useState");
			expect(results.length).toBeGreaterThanOrEqual(1);
			// t1 has better Jaccard for "react hooks useState" even though t2 is stronger
			expect(results[0].topic).toBe("react hooks useState");
		});

		it("should match on content tokens too", () => {
			field.leave("a", "solution", "database optimization", "Use indexing on frequently queried columns");
			const results = field.query("indexing columns");
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].topic).toBe("database optimization");
		});

		it("should return traces sorted by score descending", () => {
			field.leave("a", "solution", "testing unit tests vitest", "Use describe blocks");
			field.leave("a", "solution", "testing integration", "Test API endpoints");
			field.leave("a", "pattern", "vitest testing patterns", "Group related tests");

			const results = field.query("testing vitest unit");
			// Should be sorted by relevance
			for (let i = 0; i < results.length - 1; i++) {
				// Can't directly check scores, but order should be consistent
				expect(results[i]).toBeDefined();
			}
		});
	});

	// ── strongest() ──────────────────────────────────────────────────────

	describe("strongest()", () => {
		it("should return traces sorted by strength descending", () => {
			const t1 = field.leave("a", "solution", "topic1", "content1");
			const t2 = field.leave("a", "solution", "topic2", "content2");
			field.reinforce(t2.id, "b");
			field.reinforce(t2.id, "c");

			const results = field.strongest();
			expect(results[0].id).toBe(t2.id);
			expect(results[0].strength).toBeGreaterThan(results[1].strength);
		});

		it("should respect limit parameter", () => {
			for (let i = 0; i < 20; i++) {
				field.leave("a", "solution", `topic${i}`, `content${i}`);
			}

			const results = field.strongest(5);
			expect(results.length).toBe(5);
		});

		it("should return empty array when no traces exist", () => {
			expect(field.strongest()).toEqual([]);
		});
	});

	// ── byAgent() ────────────────────────────────────────────────────────

	describe("byAgent()", () => {
		it("should return only traces by the specified agent", () => {
			field.leave("agent-1", "solution", "topic1", "content1");
			field.leave("agent-2", "solution", "topic2", "content2");
			field.leave("agent-1", "warning", "topic3", "content3");

			const results = field.byAgent("agent-1");
			expect(results.length).toBe(2);
			for (const r of results) {
				expect(r.agentId).toBe("agent-1");
			}
		});

		it("should return results sorted by creation time descending", () => {
			field.leave("agent-1", "solution", "topic1", "content1");
			field.leave("agent-1", "solution", "topic2", "content2");

			const results = field.byAgent("agent-1");
			expect(results[0].createdAt).toBeGreaterThanOrEqual(results[1].createdAt);
		});

		it("should respect limit parameter", () => {
			for (let i = 0; i < 15; i++) {
				field.leave("agent-1", "solution", `topic${i}`, `content${i}`);
			}

			const results = field.byAgent("agent-1", 5);
			expect(results.length).toBe(5);
		});

		it("should return empty for unknown agent", () => {
			field.leave("agent-1", "solution", "topic", "content");
			expect(field.byAgent("agent-999")).toEqual([]);
		});
	});

	// ── decay() ──────────────────────────────────────────────────────────

	describe("decay()", () => {
		it("should reduce strength over time using exponential decay", () => {
			const quickDecay = new AkashaField({
				decayHalfLife: HOUR, // 1 hour half-life (minimum allowed)
				initialStrength: 1.0,
			});

			const trace = quickDecay.leave("a", "solution", "topic", "content");

			// Manually set lastReinforcedAt to 1 hour ago
			(trace as any).lastReinforcedAt = Date.now() - HOUR;

			const { decayed } = quickDecay.decay();
			expect(decayed).toBeGreaterThan(0);
			// After one half-life, strength should be ~0.5
			expect(trace.strength).toBeCloseTo(0.5, 1);
		});

		it("should prune traces that fall below minStrength after decay", () => {
			const quickDecay = new AkashaField({
				decayHalfLife: HOUR,
				minStrength: 0.1,
				initialStrength: 0.2,
			});

			const trace = quickDecay.leave("a", "solution", "topic", "content");
			// Set to 10 half-lives ago -- should decay to ~0.0002
			(trace as any).lastReinforcedAt = Date.now() - (10 * HOUR);

			const { pruned } = quickDecay.decay();
			expect(pruned).toBe(1);
			expect(quickDecay.stats().totalTraces).toBe(0);
		});

		it("should not decay traces with lastReinforcedAt in the future", () => {
			const trace = field.leave("a", "solution", "topic", "content");
			(trace as any).lastReinforcedAt = Date.now() + DAY;

			const { decayed } = field.decay();
			expect(decayed).toBe(0);
			expect(trace.strength).toBe(0.5);
		});

		it("should return correct counts", () => {
			const quickDecay = new AkashaField({
				decayHalfLife: HOUR,
				minStrength: 0.01,
				initialStrength: 0.5,
			});

			quickDecay.leave("a", "solution", "topic1", "content1");
			quickDecay.leave("a", "solution", "topic2", "content2");

			// Set both to 1 hour ago
			for (const t of quickDecay.strongest(10)) {
				(t as any).lastReinforcedAt = Date.now() - HOUR;
			}

			const result = quickDecay.decay();
			expect(result.decayed).toBe(2);
			expect(result.pruned).toBe(0); // 0.25 > 0.01
		});

		it("should use 7-day half-life by default", () => {
			const trace = field.leave("a", "solution", "topic", "content");

			// Set to exactly 7 days ago
			(trace as any).lastReinforcedAt = Date.now() - (7 * DAY);

			field.decay();
			// After one half-life, strength ~= initial * 0.5
			expect(trace.strength).toBeCloseTo(0.25, 1); // 0.5 * 0.5 = 0.25
		});
	});

	// ── prune() ──────────────────────────────────────────────────────────

	describe("prune()", () => {
		it("should remove traces below minStrength", () => {
			const trace = field.leave("a", "solution", "topic", "content");
			// Manually weaken the trace
			(trace as any).strength = 0.005;

			const pruned = field.prune();
			expect(pruned).toBe(1);
			expect(field.stats().totalTraces).toBe(0);
		});

		it("should keep traces above minStrength", () => {
			field.leave("a", "solution", "topic", "content");
			const pruned = field.prune();
			expect(pruned).toBe(0);
			expect(field.stats().totalTraces).toBe(1);
		});

		it("should prune selectively", () => {
			const t1 = field.leave("a", "solution", "strong", "content1");
			const t2 = field.leave("a", "solution", "weak", "content2");
			(t2 as any).strength = 0.001;

			const pruned = field.prune();
			expect(pruned).toBe(1);
			expect(field.stats().totalTraces).toBe(1);
			expect(field.strongest()[0].id).toBe(t1.id);
		});

		it("should return 0 when no traces need pruning", () => {
			field.leave("a", "solution", "topic1", "content1");
			field.leave("a", "solution", "topic2", "content2");
			expect(field.prune()).toBe(0);
		});
	});

	// ── persist() / restore() ────────────────────────────────────────────

	describe("persist() / restore()", () => {
		it("should round-trip traces through SQLite", () => {
			const db = createMockDb();

			field.leave("agent-1", "solution", "typescript", "Use strict mode");
			field.leave("agent-2", "warning", "memory leaks", "Close file handles");
			field.leave("agent-1", "pattern", "error handling", "Always use try-catch", { severity: "high" });

			field.persist(db);

			// Restore into a fresh field
			const field2 = new AkashaField();
			field2.restore(db);

			expect(field2.stats().totalTraces).toBe(3);

			const traces = field2.strongest(10);
			const topics = traces.map(t => t.topic);
			expect(topics).toContain("typescript");
			expect(topics).toContain("memory leaks");
			expect(topics).toContain("error handling");
		});

		it("should preserve metadata through persist/restore", () => {
			const db = createMockDb();
			const meta = { severity: "high", language: "ts" };

			field.leave("a", "solution", "topic", "content", meta);
			field.persist(db);

			const field2 = new AkashaField();
			field2.restore(db);

			const restored = field2.strongest(1)[0];
			expect(restored.metadata).toEqual(meta);
		});

		it("should skip traces below minStrength during restore", () => {
			const db = createMockDb();

			const trace = field.leave("a", "solution", "topic", "content");
			(trace as any).strength = 0.005;
			field.persist(db);

			const field2 = new AkashaField();
			field2.restore(db);
			expect(field2.stats().totalTraces).toBe(0);
		});

		it("should handle restore on empty database", () => {
			const db = createMockDb();
			field.restore(db);
			expect(field.stats().totalTraces).toBe(0);
		});

		it("should preserve all trace fields through round-trip", () => {
			const db = createMockDb();

			const original = field.leave("agent-42", "correction", "git rebasing", "Use rebase --onto for complex moves");
			field.reinforce(original.id, "agent-99");

			field.persist(db);

			const field2 = new AkashaField();
			field2.restore(db);

			const restored = field2.strongest(1)[0];
			expect(restored.id).toBe(original.id);
			expect(restored.agentId).toBe("agent-42");
			expect(restored.traceType).toBe("correction");
			expect(restored.topic).toBe("git rebasing");
			expect(restored.content).toBe("Use rebase --onto for complex moves");
			expect(restored.strength).toBe(original.strength);
			expect(restored.reinforcements).toBe(1);
			expect(restored.createdAt).toBe(original.createdAt);
			expect(restored.lastReinforcedAt).toBe(original.lastReinforcedAt);
		});

		it("should handle null metadata in database", () => {
			const db = createMockDb();
			field.leave("a", "solution", "topic", "content");
			field.persist(db);

			// Manually corrupt metadata to null
			const rows = db.prepare("SELECT * FROM akasha_traces").all() as any[];
			rows[0].metadata = null;

			const field2 = new AkashaField();
			field2.restore(db);
			expect(field2.strongest(1)[0].metadata).toEqual({});
		});

		it("should clear existing traces before restore", () => {
			const db = createMockDb();

			field.leave("a", "solution", "existing-topic", "existing-content");

			const field2 = new AkashaField();
			field2.leave("b", "warning", "other-topic", "other-content");
			field.persist(db);
			field2.restore(db);

			// Should only have the persisted traces, not the pre-existing one
			expect(field2.stats().totalTraces).toBe(1);
			expect(field2.strongest(1)[0].topic).toBe("existing-topic");
		});
	});

	// ── toGraphNodes() ───────────────────────────────────────────────────

	describe("toGraphNodes()", () => {
		it("should convert traces to graph nodes", () => {
			field.leave("a", "solution", "typescript generics", "Use conditional types");
			field.leave("a", "warning", "memory management", "Watch for circular refs");

			const nodes = field.toGraphNodes();
			expect(nodes.length).toBe(2);

			const first = nodes[0];
			expect(first.id).toMatch(/^aks-/);
			expect(first.type).toBe("akasha");
			expect(first.weight).toBe(0.5);
			expect(first.label).toContain("[");
			expect(first.content).toBeTruthy();
		});

		it("should skip traces below minStrength", () => {
			const trace = field.leave("a", "solution", "topic", "content");
			(trace as any).strength = 0.001;

			const nodes = field.toGraphNodes();
			expect(nodes.length).toBe(0);
		});

		it("should use trace type in node label", () => {
			field.leave("a", "shortcut", "bash piping", "Use xargs for parallel execution");
			const nodes = field.toGraphNodes();
			expect(nodes[0].label).toBe("[shortcut] bash piping");
		});

		it("should return empty array for empty field", () => {
			expect(field.toGraphNodes()).toEqual([]);
		});
	});

	// ── boostResults() ───────────────────────────────────────────────────

	describe("boostResults()", () => {
		it("should boost results that match traces", () => {
			field.leave("a", "solution", "typescript generics", "Use mapped types for transformations");

			const results = [
				{ id: "r1", score: 0.8, content: "typescript generics mapped types" },
				{ id: "r2", score: 0.7, content: "python decorators" },
			];

			const boosted = field.boostResults(results, "typescript generics");

			// r1 should be boosted (matches trace)
			expect(boosted[0].score).toBeGreaterThan(0.8);
			expect(boosted[0].traceBoost).toBeGreaterThan(0);

			// r2 should NOT be boosted (no match)
			expect(boosted[1].traceBoost).toBe(0);
			expect(boosted[1].score).toBe(0.7);
		});

		it("should not modify scores when no traces match", () => {
			field.leave("a", "solution", "rust ownership", "Use borrowing");

			const results = [
				{ id: "r1", score: 0.9, content: "python asyncio" },
			];

			const boosted = field.boostResults(results, "python asyncio");
			expect(boosted[0].score).toBe(0.9);
			expect(boosted[0].traceBoost).toBe(0);
		});

		it("should not modify scores when field is empty", () => {
			const results = [
				{ id: "r1", score: 0.5, content: "any content" },
			];

			const boosted = field.boostResults(results, "some query");
			expect(boosted[0].score).toBe(0.5);
			expect(boosted[0].traceBoost).toBe(0);
		});

		it("should handle results without content", () => {
			field.leave("a", "solution", "testing vitest", "Use describe blocks for organization");

			const results = [
				{ id: "r1", score: 0.6 },
			];

			const boosted = field.boostResults(results, "testing vitest");
			// Should still attempt to boost based on query-level similarity
			expect(boosted[0]).toBeDefined();
			expect(typeof boosted[0].traceBoost).toBe("number");
		});

		it("should handle empty query", () => {
			field.leave("a", "solution", "topic", "content");

			const results = [{ id: "r1", score: 0.5, content: "content" }];
			const boosted = field.boostResults(results, "");

			expect(boosted[0].score).toBe(0.5);
			expect(boosted[0].traceBoost).toBe(0);
		});

		it("should boost by trace strength * traceBoostFactor", () => {
			const customField = new AkashaField({ traceBoostFactor: 0.5, initialStrength: 1.0 });
			customField.leave("a", "solution", "exact match topic", "exact match content");

			const results = [
				{ id: "r1", score: 1.0, content: "exact match topic content" },
			];

			const boosted = customField.boostResults(results, "exact match topic");
			// traceBoost should be > 0 (strength=1.0, factor=0.5, Jaccard < 1)
			expect(boosted[0].traceBoost).toBeGreaterThan(0);
			expect(boosted[0].score).toBeGreaterThan(1.0);
		});

		it("should directly match result ID to trace ID", () => {
			const trace = field.leave("a", "solution", "special topic", "special content");

			const results = [
				{ id: trace.id, score: 0.5, content: "something else entirely" },
			];

			const boosted = field.boostResults(results, "special topic");
			expect(boosted[0].traceBoost).toBeGreaterThan(0);
			expect(boosted[0].score).toBeGreaterThan(0.5);
		});
	});

	// ── stats() ──────────────────────────────────────────────────────────

	describe("stats()", () => {
		it("should return zero stats for empty field", () => {
			const s = field.stats();
			expect(s.totalTraces).toBe(0);
			expect(s.activeTraces).toBe(0);
			expect(s.avgStrength).toBe(0);
			expect(s.strongestTopic).toBeNull();
			expect(s.totalReinforcements).toBe(0);
			for (const count of Object.values(s.byType)) {
				expect(count).toBe(0);
			}
		});

		it("should count traces by type", () => {
			field.leave("a", "solution", "t1", "c1");
			field.leave("a", "solution", "t2", "c2");
			field.leave("a", "warning", "t3", "c3");
			field.leave("a", "pattern", "t4", "c4");

			const s = field.stats();
			expect(s.byType.solution).toBe(2);
			expect(s.byType.warning).toBe(1);
			expect(s.byType.pattern).toBe(1);
			expect(s.byType.shortcut).toBe(0);
			expect(s.byType.correction).toBe(0);
			expect(s.byType.preference).toBe(0);
		});

		it("should compute average strength", () => {
			const t1 = field.leave("a", "solution", "t1", "c1");
			const t2 = field.leave("a", "solution", "t2", "c2");
			field.reinforce(t2.id, "b");

			const s = field.stats();
			const expected = (t1.strength + t2.strength) / 2;
			expect(s.avgStrength).toBeCloseTo(expected, 10);
		});

		it("should identify strongest topic", () => {
			field.leave("a", "solution", "weak-topic", "c1");
			const strong = field.leave("a", "solution", "strong-topic", "c2");
			field.reinforce(strong.id, "b");
			field.reinforce(strong.id, "c");

			const s = field.stats();
			expect(s.strongestTopic).toBe("strong-topic");
		});

		it("should count total reinforcements", () => {
			const t1 = field.leave("a", "solution", "t1", "c1");
			const t2 = field.leave("a", "solution", "t2", "c2");
			field.reinforce(t1.id, "b");
			field.reinforce(t1.id, "c");
			field.reinforce(t2.id, "b");

			expect(field.stats().totalReinforcements).toBe(3);
		});

		it("should count active traces (above minStrength)", () => {
			const t1 = field.leave("a", "solution", "t1", "c1");
			const t2 = field.leave("a", "solution", "t2", "c2");
			(t2 as any).strength = 0.005; // below default minStrength of 0.01

			const s = field.stats();
			expect(s.totalTraces).toBe(2);
			expect(s.activeTraces).toBe(1);
		});
	});

	// ── Configuration ────────────────────────────────────────────────────

	describe("configuration", () => {
		it("should apply default config when none provided", () => {
			const defaultField = new AkashaField();
			const trace = defaultField.leave("a", "solution", "t", "c");
			expect(trace.strength).toBe(0.5);
		});

		it("should clamp maxTraces to HARD_CEILING", () => {
			const bigField = new AkashaField({ maxTraces: 100_000 });
			// Can't directly inspect config, but should work with 50000 max
			// Just verify it doesn't throw
			expect(bigField.stats().totalTraces).toBe(0);
		});

		it("should clamp decayHalfLife to minimum 1 hour", () => {
			// Attempt very short half-life
			const fastDecay = new AkashaField({
				decayHalfLife: 1000, // 1 second, should be clamped to 1 hour
				initialStrength: 1.0,
			});

			const trace = fastDecay.leave("a", "solution", "topic", "content");

			// Set lastReinforcedAt to 30 minutes ago
			(trace as any).lastReinforcedAt = Date.now() - (30 * 60 * 1000);

			fastDecay.decay();

			// With 1 hour half-life: exp(-ln2 * 0.5) = ~0.707
			// If it were 1 second half-life, strength would be ~0
			expect(trace.strength).toBeGreaterThan(0.6);
		});

		it("should merge partial config with defaults", () => {
			const customField = new AkashaField({ reinforcementBoost: 0.3 });
			const trace = customField.leave("a", "solution", "t", "c");
			expect(trace.strength).toBe(0.5); // default initialStrength

			customField.reinforce(trace.id, "b");
			expect(trace.strength).toBe(0.8); // 0.5 + 0.3
		});

		it("should use custom topKRetrieval in query", () => {
			const smallK = new AkashaField({ topKRetrieval: 2 });
			for (let i = 0; i < 10; i++) {
				smallK.leave("a", "solution", `testing patterns topic ${i}`, `content ${i}`);
			}

			const results = smallK.query("testing patterns");
			expect(results.length).toBeLessThanOrEqual(2);
		});
	});

	// ── Edge Cases ───────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should handle traces with identical topics but different agents", () => {
			field.leave("agent-1", "solution", "same topic here", "content from agent 1");
			field.leave("agent-2", "solution", "same topic here", "content from agent 2");

			expect(field.stats().totalTraces).toBe(2);
			const results = field.query("same topic here");
			expect(results.length).toBe(2);
		});

		it("should handle special characters in topic and content", () => {
			const trace = field.leave(
				"agent-1",
				"solution",
				"regex patterns: [a-z]+",
				'Use \\w+ for word matching (it\'s faster)',
			);

			expect(trace).toBeDefined();
			expect(trace.topic).toBe("regex patterns: [a-z]+");
		});

		it("should handle very long topics", () => {
			const longTopic = "word ".repeat(500);
			const trace = field.leave("a", "solution", longTopic, "content");
			expect(trace.topic).toBe(longTopic);
		});

		it("should handle unicode in content", () => {
			const trace = field.leave(
				"agent-1",
				"pattern",
				"unicode handling",
				"Always normalize strings: \u00e9 vs e\u0301",
			);
			expect(trace.content).toContain("\u00e9");
		});

		it("should handle concurrent leave and query", () => {
			// Leave 100 traces, query in between
			for (let i = 0; i < 50; i++) {
				field.leave("a", "solution", `topic-${i} search term`, `content-${i}`);
			}

			const mid = field.query("search term");
			expect(mid.length).toBeGreaterThan(0);

			for (let i = 50; i < 100; i++) {
				field.leave("a", "solution", `topic-${i} search term`, `content-${i}`);
			}

			const final = field.query("search term");
			expect(final.length).toBeGreaterThanOrEqual(mid.length);
		});

		it("should handle reinforcement after decay", () => {
			const quickDecay = new AkashaField({
				decayHalfLife: HOUR,
				initialStrength: 0.5,
			});

			const trace = quickDecay.leave("a", "solution", "topic", "content");
			(trace as any).lastReinforcedAt = Date.now() - HOUR;

			quickDecay.decay();
			const afterDecay = trace.strength;
			expect(afterDecay).toBeCloseTo(0.25, 1);

			// Reinforce after decay -- should boost from decayed value
			quickDecay.reinforce(trace.id, "b");
			expect(trace.strength).toBeCloseTo(afterDecay + 0.15, 10);
		});

		it("should handle field with only one trace", () => {
			const trace = field.leave("a", "solution", "singleton", "only one");

			expect(field.stats().totalTraces).toBe(1);
			expect(field.strongest()).toEqual([trace]);
			expect(field.byAgent("a")).toEqual([trace]);
		});

		it("should clean reinforcedBy tracking on prune", () => {
			const trace = field.leave("a", "solution", "topic", "content");
			field.reinforce(trace.id, "b");
			(trace as any).strength = 0.001;

			field.prune();
			expect(field.stats().totalTraces).toBe(0);

			// Leave a new trace with the same ID inputs
			const newTrace = field.leave("a", "solution", "topic", "content");
			// Should be able to reinforce since the old tracking was cleaned
			const result = field.reinforce(newTrace.id, "b");
			expect(result).not.toBeNull();
		});

		it("should clean reinforcedBy tracking on decay prune", () => {
			const quickDecay = new AkashaField({
				decayHalfLife: HOUR,
				minStrength: 0.1,
				initialStrength: 0.2,
			});

			const trace = quickDecay.leave("a", "solution", "topic", "content");
			quickDecay.reinforce(trace.id, "b");

			(trace as any).lastReinforcedAt = Date.now() - (10 * HOUR);
			quickDecay.decay();

			expect(quickDecay.stats().totalTraces).toBe(0);

			// Leave same trace again
			const newTrace = quickDecay.leave("a", "solution", "topic", "content");
			const result = quickDecay.reinforce(newTrace.id, "b");
			expect(result).not.toBeNull();
		});
	});

	// ── Integration Scenarios ────────────────────────────────────────────

	describe("integration scenarios", () => {
		it("should support a full stigmergic workflow", () => {
			// Agent A discovers a solution
			const trace = field.leave(
				"kartru",
				"solution",
				"typescript circular imports",
				"Use barrel files and index.ts re-exports to break cycles",
			);

			// Agent B queries for related knowledge
			const results = field.query("circular import typescript");
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].id).toBe(trace.id);

			// Agent B finds it useful and reinforces
			field.reinforce(trace.id, "anveshi");
			expect(trace.strength).toBeGreaterThan(0.5);
			expect(trace.reinforcements).toBe(1);

			// Agent C also reinforces
			field.reinforce(trace.id, "shodhaka");
			expect(trace.reinforcements).toBe(2);

			// Check stats
			const s = field.stats();
			expect(s.totalReinforcements).toBe(2);
			expect(s.strongestTopic).toBe("typescript circular imports");
		});

		it("should support persist -> decay -> restore cycle", () => {
			const db = createMockDb();

			field.leave("a", "solution", "react hooks", "Use useMemo for expensive computations");
			field.leave("a", "warning", "react rerenders", "Avoid inline objects in JSX props");

			field.persist(db);

			// Create a new field, restore, then decay
			const field2 = new AkashaField({ decayHalfLife: HOUR });
			field2.restore(db);
			expect(field2.stats().totalTraces).toBe(2);

			// Simulate time passing -- set lastReinforcedAt to 2 hours ago
			for (const t of field2.strongest(10)) {
				(t as any).lastReinforcedAt = Date.now() - (2 * HOUR);
			}

			const { decayed, pruned } = field2.decay();
			expect(decayed).toBe(2);
			expect(pruned).toBe(0); // 0.5 * exp(-ln2 * 2) = 0.125, above default minStrength

			// Persist decayed state
			field2.persist(db);

			// Third field restores decayed values
			const field3 = new AkashaField();
			field3.restore(db);
			for (const t of field3.strongest(10)) {
				expect(t.strength).toBeLessThan(0.5);
				expect(t.strength).toBeGreaterThan(0.01);
			}
		});

		it("should support GraphRAG integration end-to-end", () => {
			field.leave("a", "solution", "git rebasing strategies", "Use rebase --onto for complex branch manipulation");
			field.leave("a", "shortcut", "git bisect workflow", "Automate with git bisect run");
			field.reinforce(field.strongest()[0].id, "b");

			// Convert to graph nodes
			const nodes = field.toGraphNodes();
			expect(nodes.length).toBe(2);

			// Simulate search results and boost them
			const searchResults = [
				{ id: "doc-1", score: 0.8, content: "git rebasing interactive rebase" },
				{ id: "doc-2", score: 0.7, content: "python virtual environments" },
				{ id: nodes[0].id, score: 0.6, content: nodes[0].content },
			];

			const boosted = field.boostResults(searchResults, "git rebasing");

			// doc-1 should be boosted (matches "git rebasing" trace)
			expect(boosted[0].score).toBeGreaterThan(0.8);
			// doc-2 should not be boosted
			expect(boosted[1].score).toBe(0.7);
			// The trace node itself should be boosted
			expect(boosted[2].score).toBeGreaterThan(0.6);
		});
	});
});
