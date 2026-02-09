import { describe, it, expect } from "vitest";
import { DAGEngine } from "../src/dag-workflow.js";
import type { DAGWorkflow, DAGNode, DAGExecutionResult } from "../src/dag-workflow.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(
	id: string,
	deps: string[] = [],
	executor?: (input: Map<string, unknown>) => Promise<unknown>,
): DAGNode {
	return {
		id,
		label: `Node ${id}`,
		dependencies: deps,
		executor: executor ?? (async () => `result-${id}`),
	};
}

function makeWorkflow(nodes: DAGNode[], id = "w1", name = "test"): DAGWorkflow {
	return { id, name, nodes };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("DAGEngine", () => {
	const engine = new DAGEngine();

	// ── validate ──────────────────────────────────────────────────────

	describe("validate", () => {
		it("validates a well-formed linear DAG", () => {
			const workflow = makeWorkflow([
				makeNode("a"),
				makeNode("b", ["a"]),
				makeNode("c", ["b"]),
			]);
			const { valid, errors } = engine.validate(workflow);
			expect(valid).toBe(true);
			expect(errors).toHaveLength(0);
		});

		it("rejects an empty workflow", () => {
			const workflow = makeWorkflow([]);
			const { valid, errors } = engine.validate(workflow);
			expect(valid).toBe(false);
			expect(errors.some((e) => e.includes("no nodes"))).toBe(true);
		});

		it("detects duplicate node IDs", () => {
			const workflow = makeWorkflow([
				makeNode("a"),
				makeNode("a"),
			]);
			const { valid, errors } = engine.validate(workflow);
			expect(valid).toBe(false);
			expect(errors.some((e) => e.includes("Duplicate"))).toBe(true);
		});

		it("detects missing dependency references", () => {
			const workflow = makeWorkflow([
				makeNode("a", ["nonexistent"]),
			]);
			const { valid, errors } = engine.validate(workflow);
			expect(valid).toBe(false);
			expect(errors.some((e) => e.includes("unknown node"))).toBe(true);
		});

		it("detects self-dependencies", () => {
			const workflow = makeWorkflow([
				makeNode("a", ["a"]),
			]);
			const { valid, errors } = engine.validate(workflow);
			expect(valid).toBe(false);
			expect(errors.some((e) => e.includes("depends on itself"))).toBe(true);
		});

		it("detects cycles", () => {
			const workflow = makeWorkflow([
				makeNode("a", ["c"]),
				makeNode("b", ["a"]),
				makeNode("c", ["b"]),
			]);
			const { valid, errors } = engine.validate(workflow);
			expect(valid).toBe(false);
			expect(errors.some((e) => e.toLowerCase().includes("cycle"))).toBe(true);
		});

		it("validates a diamond-shaped DAG (no cycle)", () => {
			const workflow = makeWorkflow([
				makeNode("a"),
				makeNode("b", ["a"]),
				makeNode("c", ["a"]),
				makeNode("d", ["b", "c"]),
			]);
			const { valid, errors } = engine.validate(workflow);
			expect(valid).toBe(true);
			expect(errors).toHaveLength(0);
		});
	});

	// ── getExecutionOrder ─────────────────────────────────────────────

	describe("getExecutionOrder", () => {
		it("produces correct levels for a linear chain", () => {
			const workflow = makeWorkflow([
				makeNode("a"),
				makeNode("b", ["a"]),
				makeNode("c", ["b"]),
			]);
			const levels = engine.getExecutionOrder(workflow);
			expect(levels).toHaveLength(3);
			expect(levels[0]).toEqual(["a"]);
			expect(levels[1]).toEqual(["b"]);
			expect(levels[2]).toEqual(["c"]);
		});

		it("groups independent nodes at the same level", () => {
			const workflow = makeWorkflow([
				makeNode("root"),
				makeNode("left", ["root"]),
				makeNode("right", ["root"]),
				makeNode("merge", ["left", "right"]),
			]);
			const levels = engine.getExecutionOrder(workflow);
			expect(levels).toHaveLength(3);
			expect(levels[0]).toEqual(["root"]);
			expect(levels[1].sort()).toEqual(["left", "right"]);
			expect(levels[2]).toEqual(["merge"]);
		});

		it("handles fully independent nodes (all in level 0)", () => {
			const workflow = makeWorkflow([
				makeNode("a"),
				makeNode("b"),
				makeNode("c"),
			]);
			const levels = engine.getExecutionOrder(workflow);
			expect(levels).toHaveLength(1);
			expect(levels[0].sort()).toEqual(["a", "b", "c"]);
		});
	});

	// ── execute ───────────────────────────────────────────────────────

	describe("execute", () => {
		it("executes all nodes and returns outputs", async () => {
			const workflow = makeWorkflow([
				makeNode("a", [], async () => "A"),
				makeNode("b", ["a"], async (input) => `B(${input.get("a")})`),
			]);
			const result = await engine.execute(workflow);
			expect(result.success).toBe(true);
			expect(result.outputs.get("a")).toBe("A");
			expect(result.outputs.get("b")).toBe("B(A)");
			expect(result.errors.size).toBe(0);
		});

		it("passes dependency outputs as input to dependent nodes", async () => {
			const workflow = makeWorkflow([
				makeNode("a", [], async () => 10),
				makeNode("b", [], async () => 20),
				makeNode("c", ["a", "b"], async (input) => {
					return (input.get("a") as number) + (input.get("b") as number);
				}),
			]);
			const result = await engine.execute(workflow);
			expect(result.success).toBe(true);
			expect(result.outputs.get("c")).toBe(30);
		});

		it("skips dependent nodes when a dependency fails", async () => {
			const workflow = makeWorkflow([
				makeNode("a", [], async () => { throw new Error("boom"); }),
				makeNode("b", ["a"], async () => "should not run"),
			]);
			const result = await engine.execute(workflow);
			expect(result.success).toBe(false);
			expect(result.errors.has("a")).toBe(true);
			expect(result.errors.has("b")).toBe(true);
			expect(result.errors.get("b")!.message).toContain("dependencies failed");
		});

		it("executes independent nodes concurrently", async () => {
			const executionLog: string[] = [];
			const workflow = makeWorkflow([
				makeNode("a", [], async () => {
					executionLog.push("a-start");
					await new Promise((r) => setTimeout(r, 50));
					executionLog.push("a-end");
					return "A";
				}),
				makeNode("b", [], async () => {
					executionLog.push("b-start");
					await new Promise((r) => setTimeout(r, 50));
					executionLog.push("b-end");
					return "B";
				}),
			]);
			const result = await engine.execute(workflow);
			expect(result.success).toBe(true);
			// Both should start before either ends (concurrent execution)
			expect(executionLog.indexOf("a-start")).toBeLessThan(executionLog.indexOf("a-end"));
			expect(executionLog.indexOf("b-start")).toBeLessThan(executionLog.indexOf("b-end"));
			// Both should have started (interleaved)
			expect(executionLog.indexOf("b-start")).toBeLessThan(executionLog.indexOf("a-end"));
		});

		it("records duration", async () => {
			const workflow = makeWorkflow([
				makeNode("a", [], async () => {
					await new Promise((r) => setTimeout(r, 10));
					return "done";
				}),
			]);
			const result = await engine.execute(workflow);
			expect(result.duration).toBeGreaterThanOrEqual(0);
		});

		it("sets the correct workflowId", async () => {
			const workflow = makeWorkflow([makeNode("a")], "my-workflow");
			const result = await engine.execute(workflow);
			expect(result.workflowId).toBe("my-workflow");
		});

		it("handles node timeout", async () => {
			const workflow = makeWorkflow([
				{
					id: "slow",
					label: "Slow node",
					dependencies: [],
					executor: async () => {
						await new Promise((r) => setTimeout(r, 5000));
						return "done";
					},
					timeout: 50,
				},
			]);
			const result = await engine.execute(workflow);
			expect(result.success).toBe(false);
			expect(result.errors.has("slow")).toBe(true);
			expect(result.errors.get("slow")!.message).toContain("timed out");
		});
	});

	// ── getCriticalPath ───────────────────────────────────────────────

	describe("getCriticalPath", () => {
		it("returns the longest dependency chain", () => {
			const workflow = makeWorkflow([
				makeNode("a"),
				makeNode("b", ["a"]),
				makeNode("c", ["b"]),
				makeNode("d", ["a"]), // short branch
			]);
			const path = engine.getCriticalPath(workflow);
			// Longest: a -> b -> c (3 nodes, length 2)
			expect(path).toEqual(["a", "b", "c"]);
		});

		it("returns a single node for a workflow with one node", () => {
			const workflow = makeWorkflow([makeNode("only")]);
			const path = engine.getCriticalPath(workflow);
			expect(path).toEqual(["only"]);
		});

		it("returns empty for an empty workflow", () => {
			const workflow = makeWorkflow([]);
			const path = engine.getCriticalPath(workflow);
			expect(path).toHaveLength(0);
		});

		it("handles diamond-shaped DAG", () => {
			const workflow = makeWorkflow([
				makeNode("a"),
				makeNode("b", ["a"]),
				makeNode("c", ["a"]),
				makeNode("d", ["b", "c"]),
			]);
			const path = engine.getCriticalPath(workflow);
			// Both a->b->d and a->c->d have length 2, either is valid
			expect(path.length).toBe(3);
			expect(path[0]).toBe("a");
			expect(path[path.length - 1]).toBe("d");
		});
	});
});
