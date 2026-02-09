import { describe, it, expect } from "vitest";
import {
	getRoot,
	getAncestors,
	getLineage,
	getLineagePath,
	getDescendants,
	getSiblings,
	findAgent,
	isDescendantOf,
	isAncestorOf,
	getTree,
	renderTree,
} from "../src/agent-tree.js";
import type { TreeAgent } from "../src/agent-tree.js";

// ─── Mock TreeAgent Factory ─────────────────────────────────────────────────

function createMockAgent(
	id: string,
	purpose: string,
	depth: number,
	opts: {
		parent?: ReturnType<typeof createMockAgent>;
		status?: "idle" | "running" | "completed" | "aborted" | "error";
		profileId?: string;
		model?: string;
	} = {},
): TreeAgent & { _children: TreeAgent[] } {
	const agent: TreeAgent & { _children: TreeAgent[] } = {
		id,
		purpose,
		depth,
		_children: [],
		getParent: () => opts.parent ?? null,
		getChildren: () => agent._children,
		getAgentStatus: () => opts.status ?? "idle",
		getProfileId: () => opts.profileId ?? "chitragupta",
		getModel: () => opts.model ?? "claude-opus-4-20250514",
	};
	return agent;
}

/**
 * Build a mock tree:
 *
 *   root (depth 0)
 *   +-- child-a (depth 1)
 *   |   +-- grandchild-a1 (depth 2)
 *   |   +-- grandchild-a2 (depth 2)
 *   +-- child-b (depth 1)
 *       +-- grandchild-b1 (depth 2)
 */
function buildTestTree() {
	const root = createMockAgent("root", "root-task", 0, { status: "completed" });
	const childA = createMockAgent("child-a", "code-review", 1, {
		parent: root,
		status: "completed",
	});
	const childB = createMockAgent("child-b", "doc-writing", 1, {
		parent: root,
		status: "running",
		profileId: "friendly",
	});
	const grandA1 = createMockAgent("ga1", "test-runner", 2, {
		parent: childA,
		status: "idle",
		profileId: "minimal",
	});
	const grandA2 = createMockAgent("ga2", "lint-checker", 2, {
		parent: childA,
		status: "error",
	});
	const grandB1 = createMockAgent("gb1", "readme-gen", 2, {
		parent: childB,
		status: "completed",
	});

	root._children = [childA, childB];
	childA._children = [grandA1, grandA2];
	childB._children = [grandB1];

	return { root, childA, childB, grandA1, grandA2, grandB1 };
}

describe("Agent Tree Traversal", () => {
	// ─── getRoot() ────────────────────────────────────────────────

	describe("getRoot()", () => {
		it("should return itself when agent has no parent", () => {
			const { root } = buildTestTree();
			expect(getRoot(root)).toBe(root);
		});

		it("should return root from a child node", () => {
			const { root, childA } = buildTestTree();
			expect(getRoot(childA)).toBe(root);
		});

		it("should return root from a grandchild node", () => {
			const { root, grandA1 } = buildTestTree();
			expect(getRoot(grandA1)).toBe(root);
		});
	});

	// ─── getAncestors() ─────────────────────────────────────────

	describe("getAncestors()", () => {
		it("should return empty array for root", () => {
			const { root } = buildTestTree();
			expect(getAncestors(root)).toEqual([]);
		});

		it("should return [parent] for a child", () => {
			const { root, childA } = buildTestTree();
			const ancestors = getAncestors(childA);
			expect(ancestors).toHaveLength(1);
			expect(ancestors[0]).toBe(root);
		});

		it("should return [parent, grandparent] for a grandchild", () => {
			const { root, childA, grandA1 } = buildTestTree();
			const ancestors = getAncestors(grandA1);
			expect(ancestors).toHaveLength(2);
			expect(ancestors[0]).toBe(childA);
			expect(ancestors[1]).toBe(root);
		});
	});

	// ─── getLineage() ───────────────────────────────────────────

	describe("getLineage()", () => {
		it("should return [self] for root", () => {
			const { root } = buildTestTree();
			const lineage = getLineage(root);
			expect(lineage).toHaveLength(1);
			expect(lineage[0]).toBe(root);
		});

		it("should return [root, parent, self] for grandchild", () => {
			const { root, childA, grandA1 } = buildTestTree();
			const lineage = getLineage(grandA1);
			expect(lineage).toHaveLength(3);
			expect(lineage[0]).toBe(root);
			expect(lineage[1]).toBe(childA);
			expect(lineage[2]).toBe(grandA1);
		});
	});

	// ─── getLineagePath() ───────────────────────────────────────

	describe("getLineagePath()", () => {
		it("should return purpose for root", () => {
			const { root } = buildTestTree();
			expect(getLineagePath(root)).toBe("root-task");
		});

		it("should join purposes with ' > ' for depth > 0", () => {
			const { grandA1 } = buildTestTree();
			expect(getLineagePath(grandA1)).toBe("root-task > code-review > test-runner");
		});
	});

	// ─── getDescendants() ───────────────────────────────────────

	describe("getDescendants()", () => {
		it("should return empty array for a leaf node", () => {
			const { grandA1 } = buildTestTree();
			expect(getDescendants(grandA1)).toEqual([]);
		});

		it("should return all descendants using depth-first traversal", () => {
			const { root } = buildTestTree();
			const desc = getDescendants(root);
			// 5 descendants: childA, childB, ga1, ga2, gb1
			expect(desc).toHaveLength(5);
			const ids = desc.map((a) => a.id);
			expect(ids).toContain("child-a");
			expect(ids).toContain("child-b");
			expect(ids).toContain("ga1");
			expect(ids).toContain("ga2");
			expect(ids).toContain("gb1");
		});

		it("should return direct children and their children for a middle node", () => {
			const { childA } = buildTestTree();
			const desc = getDescendants(childA);
			expect(desc).toHaveLength(2);
			const ids = desc.map((a) => a.id);
			expect(ids).toContain("ga1");
			expect(ids).toContain("ga2");
		});
	});

	// ─── getSiblings() ──────────────────────────────────────────

	describe("getSiblings()", () => {
		it("should return empty for root (no parent)", () => {
			const { root } = buildTestTree();
			expect(getSiblings(root)).toEqual([]);
		});

		it("should return sibling nodes", () => {
			const { childA, childB } = buildTestTree();
			const siblings = getSiblings(childA);
			expect(siblings).toHaveLength(1);
			expect(siblings[0]).toBe(childB);
		});

		it("should exclude self from siblings list", () => {
			const { grandA1, grandA2 } = buildTestTree();
			const siblings = getSiblings(grandA1);
			expect(siblings).toHaveLength(1);
			expect(siblings[0]).toBe(grandA2);
		});
	});

	// ─── findAgent() ────────────────────────────────────────────

	describe("findAgent()", () => {
		it("should find the root by ID", () => {
			const { root } = buildTestTree();
			expect(findAgent(root, "root")).toBe(root);
		});

		it("should find a grandchild from any node in the tree", () => {
			const { grandA1, grandB1 } = buildTestTree();
			// Search from grandA1 for gb1 (sibling subtree)
			const found = findAgent(grandA1, "gb1");
			expect(found).toBe(grandB1);
		});

		it("should return null for nonexistent agent", () => {
			const { root } = buildTestTree();
			expect(findAgent(root, "nonexistent")).toBeNull();
		});

		it("should find agents in different subtrees", () => {
			const { childA, grandB1 } = buildTestTree();
			const found = findAgent(childA, "gb1");
			expect(found).toBe(grandB1);
		});
	});

	// ─── isDescendantOf() ───────────────────────────────────────

	describe("isDescendantOf()", () => {
		it("should return true when agent is a descendant of the given ancestor", () => {
			const { grandA1 } = buildTestTree();
			expect(isDescendantOf(grandA1, "root")).toBe(true);
			expect(isDescendantOf(grandA1, "child-a")).toBe(true);
		});

		it("should return false for non-ancestors", () => {
			const { grandA1 } = buildTestTree();
			expect(isDescendantOf(grandA1, "child-b")).toBe(false);
			expect(isDescendantOf(grandA1, "gb1")).toBe(false);
		});

		it("should return false for root (no ancestors)", () => {
			const { root } = buildTestTree();
			expect(isDescendantOf(root, "anything")).toBe(false);
		});
	});

	// ─── isAncestorOf() ─────────────────────────────────────────

	describe("isAncestorOf()", () => {
		it("should return true when agent is an ancestor of the given descendant", () => {
			const { root } = buildTestTree();
			expect(isAncestorOf(root, "ga1")).toBe(true);
			expect(isAncestorOf(root, "child-a")).toBe(true);
		});

		it("should return false for non-descendants", () => {
			const { childB } = buildTestTree();
			expect(isAncestorOf(childB, "ga1")).toBe(false);
		});

		it("should return false for leaf nodes (no children)", () => {
			const { grandA1 } = buildTestTree();
			expect(isAncestorOf(grandA1, "root")).toBe(false);
		});
	});

	// ─── getTree() ──────────────────────────────────────────────

	describe("getTree()", () => {
		it("should build a correct tree snapshot from root", () => {
			const { root } = buildTestTree();
			const tree = getTree(root);

			expect(tree.totalAgents).toBe(6);
			expect(tree.maxDepth).toBe(2);
			expect(tree.root.id).toBe("root");
			expect(tree.root.children).toHaveLength(2);
		});

		it("should include correct node metadata", () => {
			const { root } = buildTestTree();
			const tree = getTree(root);

			expect(tree.root.status).toBe("completed");
			expect(tree.root.profileId).toBe("chitragupta");
			expect(tree.root.purpose).toBe("root-task");
		});

		it("should build a subtree when called on a non-root agent", () => {
			const { childA } = buildTestTree();
			const tree = getTree(childA);

			expect(tree.totalAgents).toBe(3); // childA + ga1 + ga2
			expect(tree.root.id).toBe("child-a");
			expect(tree.root.children).toHaveLength(2);
		});

		it("should build a single-node tree for a leaf", () => {
			const { grandA1 } = buildTestTree();
			const tree = getTree(grandA1);

			expect(tree.totalAgents).toBe(1);
			expect(tree.maxDepth).toBe(2);
			expect(tree.root.children).toHaveLength(0);
		});
	});

	// ─── renderTree() ───────────────────────────────────────────

	describe("renderTree()", () => {
		it("should render root as first line without connector", () => {
			const { root } = buildTestTree();
			const rendered = renderTree(root);
			const lines = rendered.split("\n");

			expect(lines[0]).toContain("root-task");
			expect(lines[0]).toContain("[chitragupta]");
			expect(lines[0]).toContain("(completed)");
		});

		it("should include all agents in the rendered tree", () => {
			const { root } = buildTestTree();
			const rendered = renderTree(root);

			expect(rendered).toContain("root-task");
			expect(rendered).toContain("code-review");
			expect(rendered).toContain("doc-writing");
			expect(rendered).toContain("test-runner");
			expect(rendered).toContain("lint-checker");
			expect(rendered).toContain("readme-gen");
		});

		it("should render correct number of lines for the tree", () => {
			const { root } = buildTestTree();
			const rendered = renderTree(root);
			const lines = rendered.split("\n");
			expect(lines).toHaveLength(6);
		});

		it("should render a single leaf as one line", () => {
			const { grandA1 } = buildTestTree();
			const rendered = renderTree(grandA1);
			const lines = rendered.split("\n");
			expect(lines).toHaveLength(1);
			expect(lines[0]).toContain("test-runner");
		});
	});
});
