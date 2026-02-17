import { describe, it, expect } from "vitest";
import {
	singlePattern,
	independentPattern,
	centralizedPattern,
	decentralizedPattern,
	hybridPattern,
} from "../src/orchestration-patterns.js";
import type { PatternConfig, PatternResult } from "../src/orchestration-patterns.js";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Orchestration Patterns", () => {
	// ── singlePattern ─────────────────────────────────────────────────

	describe("singlePattern", () => {
		it("executes a single task and returns success", async () => {
			const result = await singlePattern(
				"do something",
				async (task) => `done: ${task}`,
			);
			expect(result.pattern).toBe("single");
			expect(result.success).toBe(true);
			expect(result.results).toHaveLength(1);
			expect(result.results[0]).toBe("done: do something");
		});

		it("reports agentCount of 1", async () => {
			const result = await singlePattern("task", async () => "ok");
			expect(result.metrics.agentCount).toBe(1);
		});

		it("returns failure when executor throws", async () => {
			const result = await singlePattern(
				"fail",
				async () => { throw new Error("executor failed"); },
			);
			expect(result.success).toBe(false);
			expect(result.results[0]).toContain("executor failed");
		});

		it("measures duration", async () => {
			const result = await singlePattern("task", async () => {
				await new Promise((r) => setTimeout(r, 20));
				return "done";
			});
			expect(result.metrics.duration).toBeGreaterThanOrEqual(10);
		});

		it("retries on failure when configured", async () => {
			let attempt = 0;
			const result = await singlePattern(
				"flaky task",
				async () => {
					attempt++;
					if (attempt < 3) throw new Error("retry me");
					return "success on attempt 3";
				},
				{ retries: 3 },
			);
			expect(result.success).toBe(true);
			expect(result.results[0]).toBe("success on attempt 3");
			expect(result.metrics.retryCount).toBe(2);
		});

		it("fails after all retry attempts exhausted", async () => {
			const result = await singlePattern(
				"always fails",
				async () => { throw new Error("nope"); },
				{ retries: 2, retryBaseDelayMs: 10, retryMaxDelayMs: 20 },
			);
			expect(result.success).toBe(false);
		});
	});

	// ── independentPattern ────────────────────────────────────────────

	describe("independentPattern", () => {
		it("executes all subtasks concurrently", async () => {
			const result = await independentPattern(
				["task-a", "task-b", "task-c"],
				async (task) => `done: ${task}`,
			);
			expect(result.pattern).toBe("independent");
			expect(result.success).toBe(true);
			expect(result.results).toHaveLength(3);
			expect(result.results).toContain("done: task-a");
			expect(result.results).toContain("done: task-b");
			expect(result.results).toContain("done: task-c");
		});

		it("reports correct agentCount", async () => {
			const result = await independentPattern(
				["a", "b"],
				async () => "ok",
			);
			expect(result.metrics.agentCount).toBe(2);
		});

		it("reports failure when any subtask fails", async () => {
			const result = await independentPattern(
				["ok-task", "fail-task"],
				async (task) => {
					if (task === "fail-task") throw new Error("boom");
					return "ok";
				},
			);
			expect(result.success).toBe(false);
		});

		it("respects maxConcurrency", async () => {
			let concurrent = 0;
			let maxConcurrent = 0;

			const result = await independentPattern(
				["a", "b", "c", "d"],
				async () => {
					concurrent++;
					if (concurrent > maxConcurrent) maxConcurrent = concurrent;
					await new Promise((r) => setTimeout(r, 30));
					concurrent--;
					return "done";
				},
				{ maxConcurrency: 2 },
			);

			expect(result.success).toBe(true);
			expect(maxConcurrent).toBeLessThanOrEqual(2);
		});
	});

	// ── centralizedPattern ────────────────────────────────────────────

	describe("centralizedPattern", () => {
		it("decomposes, executes, and merges", async () => {
			const result = await centralizedPattern(
				"big task",
				(task) => ["sub-1", "sub-2"],
				async (subtask) => `result-${subtask}`,
				(results) => results.join("+"),
			);
			expect(result.pattern).toBe("centralized");
			expect(result.success).toBe(true);
			// Results include subtask outputs plus merged output
			expect(result.results).toContain("result-sub-1");
			expect(result.results).toContain("result-sub-2");
			expect(result.results).toContain("result-sub-1+result-sub-2");
		});

		it("executes directly when decomposer returns empty", async () => {
			const result = await centralizedPattern(
				"simple task",
				() => [],
				async (task) => `direct: ${task}`,
				(results) => results.join(","),
			);
			expect(result.success).toBe(true);
			expect(result.results).toHaveLength(2); // [direct result, merged (same)]
		});

		it("counts workers + coordinator in agentCount", async () => {
			const result = await centralizedPattern(
				"task",
				() => ["s1", "s2", "s3"],
				async () => "ok",
				(results) => "merged",
			);
			// 3 workers + 1 coordinator = 4
			expect(result.metrics.agentCount).toBe(4);
		});

		it("handles executor failure gracefully", async () => {
			const result = await centralizedPattern(
				"task",
				() => ["good", "bad"],
				async (subtask) => {
					if (subtask === "bad") throw new Error("failed");
					return "ok";
				},
				(results) => results.join(","),
			);
			// Should still succeed at pattern level (merger gets only fulfilled results)
			expect(result.success).toBe(true);
		});
	});

	// ── decentralizedPattern ──────────────────────────────────────────

	describe("decentralizedPattern", () => {
		it("spawns agents with mailboxes and shared task", async () => {
			const result = await decentralizedPattern(
				"collaborative task",
				3,
				async (agentId, inbox, sendTo) => {
					// Each agent receives the task in their inbox
					const taskMsg = inbox.find((m: any) => m.type === "task") as any;
					return `agent-${agentId}: ${taskMsg.payload}`;
				},
			);
			expect(result.pattern).toBe("decentralized");
			expect(result.success).toBe(true);
			expect(result.results).toHaveLength(3);
			expect(result.metrics.agentCount).toBe(3);
		});

		it("allows agents to send messages to each other", async () => {
			const result = await decentralizedPattern(
				"message passing",
				2,
				async (agentId, inbox, sendTo) => {
					if (agentId === 0) {
						sendTo(1, { from: 0, data: "hello" });
					}
					return `agent-${agentId}-inbox-${inbox.length}`;
				},
			);
			expect(result.success).toBe(true);
		});

		it("handles agent failure", async () => {
			const result = await decentralizedPattern(
				"risky task",
				2,
				async (agentId) => {
					if (agentId === 1) throw new Error("agent crashed");
					return "ok";
				},
			);
			expect(result.success).toBe(false);
		});

		it("enforces minimum of 1 agent", async () => {
			const result = await decentralizedPattern(
				"solo task",
				0, // should be clamped to 1
				async () => "done",
			);
			expect(result.metrics.agentCount).toBe(1);
		});
	});

	// ── hybridPattern ─────────────────────────────────────────────────

	describe("hybridPattern", () => {
		it("decomposes centrally and executes with peer awareness", async () => {
			const result = await hybridPattern(
				"complex task",
				(task) => ["part-a", "part-b"],
				async (subtask, peers) => {
					return `${subtask} (peers: ${peers.join(",")})`;
				},
				(results) => results.join(" | "),
			);
			expect(result.pattern).toBe("hybrid");
			expect(result.success).toBe(true);
			// Each executor should know about its peers
			const partA = result.results.find((r) => typeof r === "string" && r.includes("part-a")) as string;
			expect(partA).toContain("part-b"); // peers included
		});

		it("falls back to direct execution when decomposer returns empty", async () => {
			const result = await hybridPattern(
				"simple task",
				() => [],
				async (task, peers) => `direct: ${task}, peers: ${peers.length}`,
				(results) => results.join(","),
			);
			expect(result.success).toBe(true);
		});

		it("counts workers + coordinator in agentCount", async () => {
			const result = await hybridPattern(
				"task",
				() => ["s1", "s2"],
				async () => "ok",
				(results) => "merged",
			);
			// 2 workers + 1 coordinator = 3
			expect(result.metrics.agentCount).toBe(3);
		});

		it("merges only fulfilled results when some executors fail", async () => {
			const result = await hybridPattern(
				"task",
				() => ["good", "bad"],
				async (subtask) => {
					if (subtask === "bad") throw new Error("failed");
					return "ok";
				},
				(results) => results.join(","),
			);
			expect(result.success).toBe(true);
			// Merged result should only contain the good result
			const merged = result.results[result.results.length - 1];
			expect(merged).toBe("ok");
		});
	});

	// ── Cross-pattern ─────────────────────────────────────────────────

	describe("cross-pattern properties", () => {
		it("all patterns include duration in metrics", async () => {
			const patterns: PatternResult[] = [
				await singlePattern("t", async () => "r"),
				await independentPattern(["a"], async () => "r"),
				await centralizedPattern("t", () => ["a"], async () => "r", (r) => r),
				await decentralizedPattern("t", 1, async () => "r"),
				await hybridPattern("t", () => ["a"], async () => "r", (r) => r),
			];
			for (const p of patterns) {
				expect(p.metrics.duration).toBeGreaterThanOrEqual(0);
			}
		});

		it("all patterns have correct pattern name", async () => {
			const names = ["single", "independent", "centralized", "decentralized", "hybrid"];
			const patterns: PatternResult[] = [
				await singlePattern("t", async () => "r"),
				await independentPattern(["a"], async () => "r"),
				await centralizedPattern("t", () => ["a"], async () => "r", (r) => r),
				await decentralizedPattern("t", 1, async () => "r"),
				await hybridPattern("t", () => ["a"], async () => "r", (r) => r),
			];
			for (let i = 0; i < patterns.length; i++) {
				expect(patterns[i].pattern).toBe(names[i]);
			}
		});
	});
});
